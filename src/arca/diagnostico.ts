// ARCHIVO: src/arca/diagnostico.ts
// ─────────────────────────────────────────────────────────────────────────────
//  ARCA · DIAGNÓSTICO — todo en código, nada adivinado por un modelo.
//  Cada chequeo mira de verdad: corre el programa, se conecta a la base, llama a
//  la API con tu llave. Si dice ✅ es porque lo probó.
//  Funciona SIN la base y sin el servidor (así Arca te guía desde cero).
// ─────────────────────────────────────────────────────────────────────────────
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type Estado = "ok" | "falta" | "error" | "aviso" | "omitido";
export interface Chequeo {
  id: string; mision: string; nombre: string; estado: Estado; detalle: string;
  /** Pasos para arreglarlo, en orden (lo que Arca te dice que hagas). */
  pasos?: string[];
  /** Si se puede instalar solo con winget (con tu OK): id del catálogo de Arca. */
  instalable?: string;
  ms?: number;
}

const esWin = process.platform === "win32";
const RAIZ = process.cwd();

export function correr(cmd: string, args: string[], seg = 20): Promise<{ codigo: number; salida: string }> {
  return new Promise((res) => {
    execFile(cmd, args, { timeout: seg * 1000, windowsHide: true, maxBuffer: 8 << 20, shell: esWin && !/\.exe$/i.test(cmd) }, (err: any, out, errOut) => {
      res({ codigo: err ? (typeof err.code === "number" ? err.code : 127) : 0, salida: `${out || ""}${errOut || ""}`.trim() });
    });
  });
}
const ps = (script: string, seg = 30) => correr("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], seg);

async function conTiempo(f: () => Promise<Omit<Chequeo, "ms">>): Promise<Chequeo> {
  const t = Date.now();
  try { const c = await f(); return { ...c, ms: Date.now() - t }; }
  catch (e: any) { return { id: "?", mision: "?", nombre: "?", estado: "error", detalle: String(e?.message || e), ms: Date.now() - t }; }
}
const fetchJ = async (url: string, op: RequestInit = {}, seg = 15) => {
  const r = await fetch(url, { ...op, signal: AbortSignal.timeout(seg * 1000) });
  const j: any = await r.json().catch(() => ({}));
  return { status: r.status, ok: r.ok, j };
};
const vacio = (v?: string) => !v || !v.trim();

// ─── Misión 1: lo básico ────────────────────────────────────────────────────
async function node(): Promise<Omit<Chequeo, "ms">> {
  const v = process.versions.node, mayor = Number(v.split(".")[0]);
  return mayor >= 20
    ? { id: "node", mision: "basico", nombre: "Node.js", estado: "ok", detalle: `v${v}` }
    : { id: "node", mision: "basico", nombre: "Node.js", estado: "error", detalle: `v${v}: hace falta la 20 o más nueva.`, pasos: ["Instala Node LTS (Arca puede hacerlo con winget)", "Cierra y abre la terminal"], instalable: "node" };
}
async function git(): Promise<Omit<Chequeo, "ms">> {
  const r = await correr("git", ["--version"]);
  return r.codigo === 0 ? { id: "git", mision: "basico", nombre: "Git", estado: "ok", detalle: r.salida.replace("git version ", "v") }
    : { id: "git", mision: "basico", nombre: "Git", estado: "falta", detalle: "No está instalado.", pasos: ["Instala Git (Arca puede hacerlo)"], instalable: "git" };
}
async function dependencias(): Promise<Omit<Chequeo, "ms">> {
  const faltan = ["express", "pg", "tsx", "groq-sdk", "@anthropic-ai/sdk", "three"].filter((m) => !fs.existsSync(path.join(RAIZ, "node_modules", m)));
  return !faltan.length ? { id: "npm", mision: "basico", nombre: "Paquetes de Emilia", estado: "ok", detalle: "Instalados." }
    : { id: "npm", mision: "basico", nombre: "Paquetes de Emilia", estado: "falta", detalle: `Faltan: ${faltan.join(", ")}.`, pasos: ["En la carpeta de Emilia: npm ci"] };
}
async function envArchivo(): Promise<Omit<Chequeo, "ms">> {
  return fs.existsSync(path.resolve(process.env.ENV_ARCHIVO || ".env")) ? { id: "env", mision: "basico", nombre: "Archivo .env", estado: "ok", detalle: "Existe." }
    : { id: "env", mision: "basico", nombre: "Archivo .env", estado: "falta", detalle: "No existe todavía.", pasos: ["Arca lo crea a partir de .env.example y te va pidiendo cada llave"] };
}
async function postgres(): Promise<Omit<Chequeo, "ms">> {
  const base = { id: "postgres", mision: "basico", nombre: "PostgreSQL" };
  if (vacio(process.env.DATABASE_URL)) return { ...base, estado: "falta", detalle: "Falta DATABASE_URL en el .env.", pasos: ["Instala PostgreSQL 16 (Arca puede hacerlo) y anota la clave del usuario postgres", "Crea la base: npm run crear-base", "Pon DATABASE_URL=postgresql://postgres:TU_CLAVE@localhost:5432/emilia"], instalable: "postgres" };
  if (/:(CLAVE|TU_CLAVE|password)@/i.test(process.env.DATABASE_URL!)) return { ...base, estado: "falta", detalle: "DATABASE_URL todavía tiene la clave de ejemplo.", pasos: ["Instala PostgreSQL 16 si no está (Arca puede hacerlo) y anota la clave del usuario postgres", "Pon esa clave en DATABASE_URL (en vez de CLAVE)", "Crea la base y las tablas: opción [m]"], instalable: "postgres" };
  const pg = (await import("pg")).default;
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });
  try {
    await c.connect();
    const v = (await c.query("SHOW server_version")).rows[0].server_version;
    return { ...base, estado: Number(String(v).split(".")[0]) >= 14 ? "ok" : "aviso", detalle: `v${v}, conectada.` };
  } catch (e: any) {
    const m = String(e?.message || e);
    const pasos = /ECONNREFUSED|connect/i.test(m) ? ["PostgreSQL no está corriendo: abre «Servicios» de Windows y arranca postgresql-x64-16 (o reinstálalo con Arca)"]
      : /password|autentica/i.test(m) ? ["La clave de DATABASE_URL no es la del usuario postgres"]
      : /does not exist|no existe/i.test(m) ? ["Falta crear la base: npm run crear-base"] : ["Revisa DATABASE_URL"];
    return { ...base, estado: "error", detalle: m.slice(0, 200), pasos, instalable: /ECONNREFUSED/.test(m) ? "postgres" : undefined };
  } finally { await c.end().catch(() => {}); }
}
async function pgvector(): Promise<Omit<Chequeo, "ms">> {
  const base = { id: "pgvector", mision: "basico", nombre: "pgvector (memoria por significado)" };
  if (vacio(process.env.DATABASE_URL)) return { ...base, estado: "omitido", detalle: "Primero la base." };
  const pg = (await import("pg")).default;
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });
  try {
    await c.connect();
    const ext = (await c.query(`SELECT extversion FROM pg_extension WHERE extname='vector'`)).rows[0];
    if (ext) return { ...base, estado: "ok", detalle: `v${ext.extversion}` };
    const disp = (await c.query(`SELECT default_version FROM pg_available_extensions WHERE name='vector'`)).rows[0];
    return disp ? { ...base, estado: "falta", detalle: "Está instalada pero no activada en la base.", pasos: ["npm run migrate (la activa)"] }
      : { ...base, estado: "falta", detalle: "No está instalada en PostgreSQL.", pasos: ["Descarga pgvector para Windows (el .zip de la versión de tu PostgreSQL) desde github.com/andreiramani/pgvector_pgsql_windows/releases", "Copia vector.dll a C:\\Program Files\\PostgreSQL\\16\\lib y los vector*.sql/.control a ...\\share\\extension", "npm run migrate"] };
  } catch (e: any) { return { ...base, estado: "omitido", detalle: "Primero la base." }; }
  finally { await c.end().catch(() => {}); }
}
async function migraciones(): Promise<Omit<Chequeo, "ms">> {
  const base = { id: "migraciones", mision: "basico", nombre: "Tablas de Emilia" };
  if (vacio(process.env.DATABASE_URL)) return { ...base, estado: "omitido", detalle: "Primero la base." };
  const pg = (await import("pg")).default;
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });
  try {
    await c.connect();
    const faltan: string[] = [];
    for (const t of ["agentes", "ejecuciones", "bib_espacios", "contactos", "sys_cambios", "alma_yo", "seguridad_eventos", "arca_progreso"]) {
      const r = await c.query(`SELECT to_regclass($1) AS t`, [t]); if (!r.rows[0].t) faltan.push(t);
    }
    return !faltan.length ? { ...base, estado: "ok", detalle: "Todas al día." } : { ...base, estado: "falta", detalle: `Faltan: ${faltan.join(", ")}.`, pasos: ["npm run migrate"] };
  } catch { return { ...base, estado: "omitido", detalle: "Primero la base." } }
  finally { await c.end().catch(() => {}); }
}
async function pgDump(): Promise<Omit<Chequeo, "ms">> {
  const bin = process.env.PG_BIN ? path.join(process.env.PG_BIN, esWin ? "pg_dump.exe" : "pg_dump") : "pg_dump";
  let r = await correr(bin, ["--version"]);
  if (r.codigo !== 0 && esWin && !process.env.PG_BIN) {
    for (const v of ["17", "16", "15"]) { const p = `C:\\Program Files\\PostgreSQL\\${v}\\bin\\pg_dump.exe`; if (fs.existsSync(p)) return { id: "pg_dump", mision: "autonomia", nombre: "pg_dump (copias de la base)", estado: "aviso", detalle: `Está en ${path.dirname(p)} pero no en el PATH.`, pasos: [`Pon en el .env: PG_BIN=${path.dirname(p)}`] }; }
  }
  return r.codigo === 0 ? { id: "pg_dump", mision: "autonomia", nombre: "pg_dump (copias de la base)", estado: "ok", detalle: r.salida.split("\n")[0] }
    : { id: "pg_dump", mision: "autonomia", nombre: "pg_dump (copias de la base)", estado: "falta", detalle: "No lo encuentro: sin él no hay copias diarias.", pasos: ["Pon PG_BIN en el .env con la carpeta bin de PostgreSQL"] };
}

// ─── Misión 2: el cerebro (modelos y memoria) ──────────────────────────────
export async function probarGroq(llave = process.env.GROQ_API_KEY): Promise<Omit<Chequeo, "ms">> {
  const base = { id: "groq", mision: "cerebro", nombre: "Llave de Groq" };
  if (vacio(llave)) return { ...base, estado: "falta", detalle: "Falta GROQ_API_KEY.", pasos: ["Entra a console.groq.com → API Keys → Create API Key", "Pégamela y la pruebo"] };
  const r = await fetchJ("https://api.groq.com/openai/v1/models", { headers: { Authorization: `Bearer ${llave}` } });
  if (r.ok) { const n = (r.j.data || []).length; return { ...base, estado: "ok", detalle: `Funciona (${n} modelos disponibles).` }; }
  return { ...base, estado: "error", detalle: r.status === 401 ? "La llave no sirve (401)." : `Groq respondió ${r.status}.`, pasos: ["Crea una llave nueva en console.groq.com y pégamela"] };
}
export async function probarAnthropic(llave = process.env.ANTHROPIC_API_KEY): Promise<Omit<Chequeo, "ms">> {
  const base = { id: "anthropic", mision: "cerebro", nombre: "Llave de Claude (Anthropic)" };
  if (vacio(llave)) return { ...base, estado: "falta", detalle: "Falta ANTHROPIC_API_KEY (Emilia, el alma y Sage la usan).", pasos: ["Entra a console.anthropic.com → API Keys → Create Key", "Carga saldo en Billing (con 5 USD arrancas)", "Pégamela y la pruebo"] };
  const r = await fetchJ("https://api.anthropic.com/v1/models?limit=50", { headers: { "x-api-key": llave!, "anthropic-version": "2023-06-01" } });
  if (r.ok) { const ids: string[] = (r.j.data || []).map((m: any) => m.id); const tiene = (x: RegExp) => ids.some((i) => x.test(i)); return { ...base, estado: tiene(/sonnet/) && tiene(/haiku/) ? "ok" : "aviso", detalle: `Funciona${tiene(/sonnet/) ? " · Sonnet ✓" : " · sin Sonnet"}${tiene(/haiku/) ? " · Haiku ✓" : " · sin Haiku"}.` }; }
  return { ...base, estado: "error", detalle: r.status === 401 ? "La llave no sirve (401)." : `Anthropic respondió ${r.status}: ${String(r.j?.error?.message || "").slice(0, 120)}`, pasos: ["Revisa la llave en console.anthropic.com (y que tenga saldo)"] };
}
async function cerebroLlave(): Promise<Omit<Chequeo, "ms">> {
  const base = { id: "cerebro_llave", mision: "cerebro", nombre: "Llave de la memoria personal" };
  if (process.env.CEREBRO_LLAVE) { const ok = Buffer.from(process.env.CEREBRO_LLAVE, "base64").length === 32; return ok ? { ...base, estado: "ok", detalle: "En el .env." } : { ...base, estado: "error", detalle: "CEREBRO_LLAVE no tiene 32 bytes.", pasos: ["Bórrala del .env y deja que Emilia cree una (se protege con tu usuario de Windows)"] }; }
  const f = path.resolve(process.env.DATA_DIR || "data", "cerebro.llave");
  return fs.existsSync(f) ? { ...base, estado: "ok", detalle: esWin ? "Protegida con tu usuario de Windows (DPAPI)." : "En data/cerebro.llave." }
    : { ...base, estado: "aviso", detalle: "Se crea sola la primera vez que arranca Emilia.", pasos: ["Arranca Emilia una vez", "Después haz el respaldo: npm run respaldo:llaves"] };
}

// ─── Misión 3: WhatsApp ─────────────────────────────────────────────────────
async function waToken(): Promise<Omit<Chequeo, "ms">> {
  const base = { id: "wa_token", mision: "whatsapp", nombre: "Token y número de WhatsApp (Meta)" };
  const t = process.env.WHATSAPP_TOKEN, id = process.env.WHATSAPP_PHONE_ID;
  if (vacio(t) || vacio(id)) return { ...base, estado: "falta", detalle: `Falta ${vacio(t) ? "WHATSAPP_TOKEN" : ""}${vacio(t) && vacio(id) ? " y " : ""}${vacio(id) ? "WHATSAPP_PHONE_ID" : ""}.`, pasos: ["developers.facebook.com → Mis apps → Crear app (tipo Empresa) → agrega el producto WhatsApp", "En WhatsApp → Configuración de la API: copia el «Identificador del número de teléfono» (WHATSAPP_PHONE_ID)", "Token PERMANENTE: business.facebook.com → Configuración → Usuarios del sistema → Agregar (admin) → Generar token con whatsapp_business_messaging y whatsapp_business_management", "Pégamelos y los pruebo"] };
  const r = await fetchJ(`https://graph.facebook.com/${process.env.WHATSAPP_API_VERSION || "v21.0"}/${id}?fields=display_phone_number,verified_name,quality_rating`, { headers: { Authorization: `Bearer ${t}` } });
  if (r.ok) return { ...base, estado: "ok", detalle: `${r.j.verified_name || "Número"} ${r.j.display_phone_number || ""} · calidad ${r.j.quality_rating || "?"}.` };
  const m = String(r.j?.error?.message || r.status);
  return { ...base, estado: "error", detalle: m.slice(0, 160), pasos: /expired|Session has expired/i.test(m) ? ["El token venció: usa un token PERMANENTE de usuario del sistema (los temporales duran 24 h)"] : ["Revisa el token y el PHONE_ID"] };
}
async function waPlantillas(): Promise<Omit<Chequeo, "ms">> {
  const base = { id: "wa_plantillas", mision: "whatsapp", nombre: "Plantillas aprobadas" };
  const waba = process.env.WHATSAPP_WABA_ID, t = process.env.WHATSAPP_TOKEN;
  const nombres = [process.env.WHATSAPP_PLANTILLA_AVISO || "recordatorio_emilia", process.env.WHATSAPP_PLANTILLA_TERCEROS || "mensaje_de_sebastian"];
  const pasosCrear = ["business.facebook.com → WhatsApp Manager → Plantillas → Crear", `«${nombres[0]}» (Utilidad, español): cuerpo «{{1}}»`, `«${nombres[1]}» (Utilidad, español): cuerpo «Mensaje de Sebastián: {{1}}»`, "Espera la aprobación (suele tardar minutos)"];
  if (vacio(t)) return { ...base, estado: "omitido", detalle: "Primero el token." };
  if (vacio(waba)) return { ...base, estado: "aviso", detalle: "Sin WHATSAPP_WABA_ID no puedo revisarlas.", pasos: ["WhatsApp → Configuración de la API: copia el «Identificador de la cuenta de WhatsApp Business» a WHATSAPP_WABA_ID", ...pasosCrear] };
  const r = await fetchJ(`https://graph.facebook.com/${process.env.WHATSAPP_API_VERSION || "v21.0"}/${waba}/message_templates?fields=name,status,language&limit=200`, { headers: { Authorization: `Bearer ${t}` } });
  if (!r.ok) return { ...base, estado: "error", detalle: String(r.j?.error?.message || r.status).slice(0, 160) };
  const est = Object.fromEntries((r.j.data || []).map((p: any) => [p.name, p.status]));
  const mal = nombres.filter((n) => est[n] !== "APPROVED");
  return !mal.length ? { ...base, estado: "ok", detalle: `${nombres.join(" y ")}: aprobadas.` }
    : { ...base, estado: "falta", detalle: mal.map((n) => `${n}: ${est[n] ? est[n].toLowerCase() : "no existe"}`).join(" · "), pasos: pasosCrear };
}
async function waSeguridad(): Promise<Omit<Chequeo, "ms">> {
  const base = { id: "wa_seguridad", mision: "whatsapp", nombre: "App Secret, verify token y tu número" };
  const falta = ["WHATSAPP_APP_SECRET", "WHATSAPP_VERIFY_TOKEN", "WHATSAPP_NUMERO_JEFE"].filter((k) => vacio(process.env[k]));
  if (process.env.WHATSAPP_SIN_FIRMA === "true") return { ...base, estado: "error", detalle: "WHATSAPP_SIN_FIRMA=true: bórralo (solo es para pruebas).", pasos: ["Quita WHATSAPP_SIN_FIRMA del .env"] };
  return !falta.length ? { ...base, estado: "ok", detalle: `Todo puesto · jefe …${String(process.env.WHATSAPP_NUMERO_JEFE).replace(/\D/g, "").slice(-4)}.` }
    : { ...base, estado: "falta", detalle: `Falta ${falta.join(", ")}.`, pasos: [falta.includes("WHATSAPP_APP_SECRET") ? "App Secret: tu app en Meta → Configuración de la app → Básica → Clave secreta" : "", falta.includes("WHATSAPP_VERIFY_TOKEN") ? "Verify token: inventa una frase (Arca te genera una) y úsala igual en Meta" : "", falta.includes("WHATSAPP_NUMERO_JEFE") ? "Tu número con código de país, solo dígitos (57…)" : ""].filter(Boolean) };
}
async function tunel(): Promise<Omit<Chequeo, "ms">> {
  const base = { id: "tunel", mision: "whatsapp", nombre: "Túnel (para que Meta te encuentre)" };
  if (vacio(process.env.NGROK_AUTHTOKEN)) return { ...base, estado: "falta", detalle: "Falta NGROK_AUTHTOKEN.", pasos: ["Crea cuenta gratis en ngrok.com", "dashboard.ngrok.com → Your Authtoken → cópialo a NGROK_AUTHTOKEN", "dashboard.ngrok.com → Domains → crea tu dominio fijo gratis → NGROK_DOMAIN (así la URL no cambia en cada reinicio)"] };
  if (vacio(process.env.NGROK_DOMAIN)) return { ...base, estado: "aviso", detalle: "Sin NGROK_DOMAIN la URL cambia en cada reinicio y Meta deja de llegar.", pasos: ["dashboard.ngrok.com → Domains → crea el dominio gratis → ponlo en NGROK_DOMAIN"] };
  return { ...base, estado: "ok", detalle: `Dominio fijo ${process.env.NGROK_DOMAIN}.` };
}
async function webhook(): Promise<Omit<Chequeo, "ms">> {
  const base = { id: "webhook", mision: "whatsapp", nombre: "Webhook de punta a punta" };
  const dom = process.env.NGROK_DOMAIN;
  let url: string | null = dom ? `https://${dom}` : null;
  try { const t = await import("../whatsapp/tunel.js"); url = t.urlTunel || url; } catch {}
  if (!url || vacio(process.env.WHATSAPP_VERIFY_TOKEN)) return { ...base, estado: "omitido", detalle: "Primero el túnel y el verify token." };
  try {
    const reto = String(Math.floor(Math.random() * 1e9));
    const r = await fetch(`${url}/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(process.env.WHATSAPP_VERIFY_TOKEN!)}&hub.challenge=${reto}`, { signal: AbortSignal.timeout(15_000) });
    const t = await r.text();
    return t.trim() === reto ? { ...base, estado: "ok", detalle: `${url}/webhook/whatsapp responde desde internet.`, pasos: undefined }
      : { ...base, estado: "error", detalle: `Respondió ${r.status} sin el reto.`, pasos: ["¿Emilia está prendida? (npm run vigia)", "Revisa que el verify token sea el mismo en Meta y en el .env"] };
  } catch (e: any) { return { ...base, estado: "error", detalle: `No llego desde internet: ${String(e?.message || e).slice(0, 100)}`, pasos: ["Prende Emilia (levanta el túnel)", "En Meta → WhatsApp → Configuración → Webhook: URL " + url + "/webhook/whatsapp, el verify token, y suscribe «messages»"] }; }
}

// ─── Misión 4: las manos (PC) ───────────────────────────────────────────────
async function docker(): Promise<Omit<Chequeo, "ms">> {
  const base = { id: "docker", mision: "manos", nombre: "Docker (laboratorio de System)" };
  const v = await correr("docker", ["--version"]);
  if (v.codigo !== 0) return { ...base, estado: "falta", detalle: "No está instalado.", pasos: ["Instala Docker Desktop (Arca puede hacerlo)", "Ábrelo una vez y acepta los términos", "Activa «Start Docker Desktop when you sign in»"], instalable: "docker" };
  const i = await correr("docker", ["info", "--format", "{{.ServerVersion}}"], 20);
  return i.codigo === 0 ? { ...base, estado: "ok", detalle: `Corriendo (motor ${i.salida}).` } : { ...base, estado: "aviso", detalle: "Instalado pero apagado.", pasos: ["Abre Docker Desktop"] };
}
async function whatsappEscritorio(): Promise<Omit<Chequeo, "ms">> {
  const base = { id: "wa_escritorio", mision: "manos", nombre: "WhatsApp de escritorio (tu WhatsApp personal)" };
  if (!esWin) return { ...base, estado: "omitido", detalle: "Solo en Windows." };
  const r = await ps("(Get-AppxPackage -Name '*WhatsApp*' | Select-Object -First 1).Version");
  return r.codigo === 0 && r.salida ? { ...base, estado: "ok", detalle: `Instalado (v${r.salida}).` }
    : { ...base, estado: "falta", detalle: "No está instalado.", pasos: ["Instálalo (Arca puede hacerlo) y vincúlalo con tu celular (QR)"], instalable: "whatsapp" };
}
async function navegadores(): Promise<Omit<Chequeo, "ms">> {
  const base = { id: "playwright", mision: "manos", nombre: "Navegador de los agentes (Playwright)" };
  try {
    const { chromium } = await import("playwright");
    const p = chromium.executablePath();
    return fs.existsSync(p) ? { ...base, estado: "ok", detalle: "Chromium listo." } : { ...base, estado: "falta", detalle: "Falta el Chromium de Playwright.", pasos: ["npx playwright install chromium"] };
  } catch { return { ...base, estado: "falta", detalle: "Playwright no está.", pasos: ["npm ci"] }; }
}
async function claudeCode(): Promise<Omit<Chequeo, "ms">> {
  const base = { id: "claude_code", mision: "manos", nombre: "Claude Code (las manos de Sage)" };
  const r = await correr(process.env.CLAUDE_CODE_BIN || "claude", ["--version"]);
  return r.codigo === 0 ? { ...base, estado: "ok", detalle: r.salida.split("\n")[0] }
    : { ...base, estado: "falta", detalle: "No está instalado: Sage no puede programar.", pasos: ["npm install -g @anthropic-ai/claude-code", "Corre «claude» una vez e inicia sesión"], instalable: "claude_code" };
}
async function equipo(): Promise<Omit<Chequeo, "ms">> {
  const libreRam = os.freemem() / 1e9, totalRam = os.totalmem() / 1e9;
  let disco = "";
  let libreGb = Infinity;
  try { const st: any = await (fs.promises as any).statfs(RAIZ); libreGb = (st.bavail * st.bsize) / 1e9; disco = ` · disco libre ${libreGb.toFixed(0)} GB`; } catch {}
  const estado: Estado = totalRam < 8 || libreGb < 10 ? "aviso" : "ok";
  return { id: "equipo", mision: "manos", nombre: "El PC", estado, detalle: `${os.cpus().length} núcleos · RAM ${totalRam.toFixed(0)} GB (${libreRam.toFixed(1)} libres)${disco}`, pasos: estado === "aviso" ? [totalRam < 8 ? "Con menos de 8 GB de RAM Docker y los modelos van justos" : "", libreGb < 10 ? "Libera espacio (Arca te dice qué se puede borrar)" : ""].filter(Boolean) : undefined };
}

// ─── Misión 5: servicios ────────────────────────────────────────────────────
async function google(): Promise<Omit<Chequeo, "ms">> {
  const base = { id: "google", mision: "servicios", nombre: "Google (calendario de Iris)" };
  if (vacio(process.env.GOOGLE_CLIENT_ID) || vacio(process.env.GOOGLE_CLIENT_SECRET)) return { ...base, estado: "falta", detalle: "Falta GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET.", pasos: ["console.cloud.google.com → crea un proyecto → habilita Google Calendar API", "Pantalla de consentimiento: externa, agrégate como usuario de prueba", "Credenciales → ID de cliente OAuth → App de escritorio → copia ID y secreto al .env", "npm run google:conectar"] };
  try {
    const { query } = await import("../db/cliente.js");
    const [g] = await query<any>(`SELECT valor FROM iris_config WHERE clave='google'`);
    if (!g?.valor?.refresh_token) return { ...base, estado: "falta", detalle: "Las credenciales están, falta conectar tu cuenta.", pasos: ["npm run google:conectar"] };
    const r = await fetchJ("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!, refresh_token: g.valor.refresh_token, grant_type: "refresh_token" }) });
    return r.ok ? { ...base, estado: "ok", detalle: `Conectado${g.valor.correo ? ` (${g.valor.correo})` : ""}.` } : { ...base, estado: "error", detalle: "Google rechazó la conexión (¿la revocaste o venció la app de prueba?).", pasos: ["npm run google:conectar"] };
  } catch { return { ...base, estado: "omitido", detalle: "Primero la base." }; }
}
async function railway(): Promise<Omit<Chequeo, "ms">> {
  const base = { id: "railway", mision: "servicios", nombre: "Railway (tus proyectos en la nube)" };
  if (vacio(process.env.RAILWAY_TOKEN)) return { ...base, estado: "falta", detalle: "Falta RAILWAY_TOKEN.", pasos: ["railway.com → Account Settings → Tokens → crea uno (sin workspace = acceso a todo)", "Pégamelo y lo pruebo"] };
  const r = await fetchJ("https://backboard.railway.com/graphql/v2", { method: "POST", headers: { Authorization: `Bearer ${process.env.RAILWAY_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify({ query: "{ me { email projects { edges { node { name } } } } }" }) });
  if (r.ok && r.j?.data?.me) return { ...base, estado: "ok", detalle: `Funciona · ${(r.j.data.me.projects?.edges || []).length} proyecto(s).` };
  return { ...base, estado: "error", detalle: String(r.j?.errors?.[0]?.message || r.status).slice(0, 140), pasos: ["Crea un token de cuenta (no de proyecto) en railway.com → Account → Tokens"] };
}
async function github(): Promise<Omit<Chequeo, "ms">> {
  const base = { id: "github", mision: "servicios", nombre: "GitHub (repos para Sage)" };
  if (vacio(process.env.GITHUB_TOKEN)) return { ...base, estado: "falta", detalle: "Falta GITHUB_TOKEN.", pasos: ["github.com → Settings → Developer settings → Fine-grained tokens → acceso a tus repos con Contents y Pull requests (lectura y escritura)", "Pégamelo y lo pruebo"] };
  const r = await fetchJ("https://api.github.com/user", { headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, "User-Agent": "emilia-arca" } });
  return r.ok ? { ...base, estado: "ok", detalle: `Funciona (${r.j.login}).` } : { ...base, estado: "error", detalle: `GitHub respondió ${r.status}.`, pasos: ["Crea un token nuevo y pégamelo"] };
}
async function correo(): Promise<Omit<Chequeo, "ms">> {
  const base = { id: "correo", mision: "servicios", nombre: "Correos (Iris)" };
  const cuentas = [1, 2, 3].filter((i) => !vacio(process.env[`CORREO_${i}_USUARIO`]));
  if (!cuentas.length) return { ...base, estado: "falta", detalle: "No hay cuentas de correo.", pasos: ["Gmail: myaccount.google.com → Seguridad → Verificación en 2 pasos → Contraseñas de aplicaciones → crea una", "Pon CORREO_1_USUARIO y CORREO_1_CLAVE (la contraseña de aplicación, no la tuya)"] };
  const { ImapFlow } = await import("imapflow");
  const malas: string[] = [];
  for (const i of cuentas) {
    const u = process.env[`CORREO_${i}_USUARIO`]!;
    const c = new ImapFlow({ host: process.env[`CORREO_${i}_IMAP_HOST`] || "imap.gmail.com", port: Number(process.env[`CORREO_${i}_IMAP_PORT`] || 993), secure: true, auth: { user: u, pass: process.env[`CORREO_${i}_CLAVE`] || "" }, logger: false });
    try { await Promise.race([c.connect(), new Promise((_, rj) => setTimeout(() => rj(new Error("tiempo")), 15_000))]); await c.logout().catch(() => {}); }
    catch { malas.push(u.replace(/^(.{2}).*(@.*)$/, "$1…$2")); }
  }
  return !malas.length ? { ...base, estado: "ok", detalle: `${cuentas.length} cuenta(s) entran.` } : { ...base, estado: "error", detalle: `No entran: ${malas.join(", ")}.`, pasos: ["Usa una contraseña de aplicación (no tu clave normal)"] };
}
async function any(): Promise<Omit<Chequeo, "ms">> {
  const base = { id: "any", mision: "servicios", nombre: "Any (el bot de la empresa)" };
  const f = ["ANY_URL", "ANY_USUARIO", "ANY_CLAVE"].filter((k) => vacio(process.env[k]));
  if (f.length) return { ...base, estado: "falta", detalle: `Falta ${f.join(", ")}.`, pasos: ["Pon la URL del panel de Any y el usuario/clave de lectura"] };
  try { const r = await fetch(process.env.ANY_URL!, { signal: AbortSignal.timeout(10_000) }); return { ...base, estado: r.status < 500 ? "ok" : "error", detalle: `Responde (${r.status}).` }; }
  catch (e: any) { return { ...base, estado: "error", detalle: `No responde: ${String(e?.message || e).slice(0, 80)}` }; }
}

// ─── Misión 6: autonomía ────────────────────────────────────────────────────
async function arranque(): Promise<Omit<Chequeo, "ms">> {
  const base = { id: "arranque", mision: "autonomia", nombre: "Arranca con Windows" };
  if (!esWin) return { ...base, estado: "omitido", detalle: "Solo en Windows." };
  const r = await ps("(Get-ScheduledTask -TaskName 'Emilia' -ErrorAction SilentlyContinue).State");
  return r.salida ? { ...base, estado: "ok", detalle: `Tarea «Emilia»: ${r.salida}.` } : { ...base, estado: "falta", detalle: "No arranca sola.", pasos: ["npm run inicio:instalar"] };
}
async function energia(): Promise<Omit<Chequeo, "ms">> {
  const base = { id: "energia", mision: "autonomia", nombre: "Que el PC no se duerma" };
  if (!esWin) return { ...base, estado: "omitido", detalle: "Solo en Windows." };
  const r = await ps("powercfg /query SCHEME_CURRENT SUB_SLEEP STANDBYIDLE | Select-String 'AC Power Setting Index|Índice de configuración de corriente alterna'");
  const m = r.salida.match(/0x([0-9a-f]+)/i);
  const seg = m ? parseInt(m[1], 16) : -1;
  return seg === 0 ? { ...base, estado: "ok", detalle: "Enchufado no se suspende." }
    : { ...base, estado: "aviso", detalle: seg > 0 ? `Enchufado se suspende a los ${Math.round(seg / 60)} min: Emilia se duerme con él.` : "No pude leer la energía.", pasos: ["Configuración → Sistema → Inicio/apagado y suspensión → «Al estar enchufado, suspender después de»: Nunca (la pantalla sí se puede apagar)"] };
}
async function copias(): Promise<Omit<Chequeo, "ms">> {
  const base = { id: "copias", mision: "autonomia", nombre: "Copias de la base y respaldo de llaves" };
  const { ultimoRespaldo } = await import("../seguridad/respaldo-llaves.js");
  const ur = ultimoRespaldo();
  const dir = path.resolve(process.env.COPIAS_DIR || path.join(os.homedir(), "EmiliaCopias"));
  const nube = /onedrive|google ?drive|dropbox/i.test(dir);
  const pasos = [!ur ? "npm run respaldo:llaves (llave del cerebro + .env, cifrados con tu frase)" : "", !nube ? `Pon COPIAS_DIR en una carpeta de OneDrive (ej. ${path.join(os.homedir(), "OneDrive", "EmiliaCopias")}) para que las copias salgan del PC` : ""].filter(Boolean);
  return !pasos.length ? { ...base, estado: "ok", detalle: `Copias en ${dir} · llaves respaldadas el ${ur!.t.slice(0, 10)}.` }
    : { ...base, estado: ur ? "aviso" : "falta", detalle: `${ur ? `Llaves respaldadas el ${ur.t.slice(0, 10)}` : "Nunca respaldaste la llave del cerebro"}${nube ? "" : " · las copias quedan solo en este disco"}.`, pasos };
}

// ─── Todo junto ─────────────────────────────────────────────────────────────
export const CHEQUEOS: Record<string, () => Promise<Omit<Chequeo, "ms">>> = {
  node, git, npm: dependencias, env: envArchivo, postgres, pgvector, migraciones,
  groq: () => probarGroq(), anthropic: () => probarAnthropic(), cerebro_llave: cerebroLlave,
  wa_token: waToken, wa_seguridad: waSeguridad, wa_plantillas: waPlantillas, tunel, webhook,
  equipo, docker, wa_escritorio: whatsappEscritorio, playwright: navegadores, claude_code: claudeCode,
  google, railway, github, correo, any,
  arranque, energia, pg_dump: pgDump, copias,
};

const NOMBRES: Record<string, string> = { groq: "Llave de Groq", anthropic: "Llave de Claude (Anthropic)", wa_token: "Token y número de WhatsApp (Meta)", wa_plantillas: "Plantillas aprobadas", webhook: "Webhook de punta a punta", google: "Google (calendario de Iris)", railway: "Railway", github: "GitHub", correo: "Correos (Iris)", any: "Any", postgres: "PostgreSQL", docker: "Docker" };

/** Corre todos los chequeos (o los de una misión) en paralelo, con tope de tiempo. */
export async function diagnosticar(op: { mision?: string; ids?: string[] } = {}): Promise<Chequeo[]> {
  const { MISIONES } = await import("./tutorial.js");
  const ids = op.ids || (op.mision ? MISIONES.find((m) => m.id === op.mision)?.chequeos || [] : Object.keys(CHEQUEOS));
  const rs = await Promise.all(ids.map((id) => conTiempo(async () => {
    const c = await Promise.race([CHEQUEOS[id](), new Promise<never>((_, rj) => setTimeout(() => rj(new Error("tardó más de 40 s")), 40_000))]);
    return c;
  }).then((c) => (c.id === "?" ? { ...c, id, mision: MISIONES.find((m) => m.chequeos.includes(id))?.id || "?", nombre: NOMBRES[id] || id, detalle: /fetch failed|ENOTFOUND|ETIMEDOUT|ECONNRESET|aborted|timeout/i.test(c.detalle) ? `No pude llegar al servicio (${c.detalle}).` : c.detalle, pasos: /fetch failed|ENOTFOUND|ETIMEDOUT|ECONNRESET|aborted|timeout/i.test(c.detalle) ? ["Revisa que el PC tenga internet (y que ningún antivirus o proxy lo bloquee)", "Vuelve a revisar"] : c.pasos } : c))));
  return rs;
}
