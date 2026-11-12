// ARCHIVO: src/motor/vigilancia.ts
// ─────────────────────────────────────────────────────────────────────────────
//  VIGILANCIA DE IRIS — un solo motor para todo lo que tiene que estar vivo.
//  Cada monitor se revisa a su ritmo (reloj de Iris, cada minuto):
//   url          responde, tiempo de respuesta contra SU línea base, texto esperado,
//                certificado SSL (aviso 14 días antes)
//   proceso      proyecto de este PC corriendo y respondiendo (si cae: lo reinicia;
//                si no levanta, se lo pasa a Sage)
//   railway      último despliegue del servicio (si falla: te ofrece volver a la
//                versión anterior, con tu OK)
//   pc           disco y memoria de este PC
//   postgres     la base de Emilia responde
//   correo       las cuentas de correo siguen conectadas
//   crons        las tareas programadas sí se ejecutaron (vigila a los vigilantes)
//   copias       copia diaria de la base de Emilia, verificada y rotada
//   credenciales tokens de WhatsApp, GitHub y Railway vigentes
//  Avisa UNA vez cuando algo cae y UNA cuando vuelve (con lo que pasó y lo que se
//  hizo); si sigue caído, recuerda a los 30 min y luego cada 2 h. Todo queda como
//  incidente con su historia.
// ─────────────────────────────────────────────────────────────────────────────
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import tls from "node:tls";
import { execFile } from "node:child_process";
import { query } from "../db/cliente.js";
import { avisarJefe } from "./avisos.js";

export type Estado = "ok" | "lento" | "aviso" | "caido";
export interface Monitor {
  id: string; nombre: string; tipo: string; config: any; memoria: any; cada_seg: number; fallos_para_alertar: number; critico: boolean; activo: boolean; sistema: boolean;
  estado: Estado | "desconocido"; desde: string; ultimo_chequeo: string | null; ultimo_ok: string | null; fallos_seguidos: number; ultima_latencia_ms: number | null;
  ultimo_detalle: string | null; incidente_id: string | null;
}
export interface Resultado { estado: Estado; detalle: string; latencia_ms?: number; extra?: any }
const GRAVEDAD: Record<string, number> = { ok: 0, desconocido: 0, aviso: 1, lento: 2, caido: 3 };
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));
const hora = (iso: string | Date) => new Date(iso).toLocaleTimeString("es-CO", { timeZone: "America/Bogota", hour: "2-digit", minute: "2-digit" });
export const duracion = (ms: number) => ms < 60_000 ? `${Math.round(ms / 1000)} s` : ms < 3600_000 ? `${Math.round(ms / 60_000)} min` : `${Math.floor(ms / 3600_000)} h ${Math.round((ms % 3600_000) / 60_000)} min`;

// ── Revisiones por tipo ──────────────────────────────────────────────────────
async function lineaBase(id: string): Promise<number | null> {
  const [r] = await query<{ p50: number | null; n: number }>(`SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY latencia_ms) AS p50, count(*)::int AS n FROM monitor_chequeos WHERE monitor_id = $1 AND estado = 'ok' AND latencia_ms IS NOT NULL AND t > now() - interval '3 days'`, [id]);
  return r && r.n >= 5 ? Number(r.p50) : null;
}

function diasCertificado(host: string): Promise<number | null> {
  return new Promise((resolver) => {
    const s = tls.connect({ host, port: 443, servername: host, timeout: 10_000 }, () => {
      const c = s.getPeerCertificate(); s.end();
      resolver(c?.valid_to ? Math.floor((new Date(c.valid_to).getTime() - Date.now()) / 86400_000) : null);
    });
    s.on("error", () => resolver(null)); s.on("timeout", () => { s.destroy(); resolver(null); });
  });
}

async function revisarUrl(m: Monitor): Promise<Resultado> {
  const c = m.config;
  const t0 = Date.now();
  let status = 0, cuerpo = "", error = "";
  for (let intento = 0; intento < 2; intento++) {
    try {
      const r = await fetch(c.url, { method: c.metodo || "GET", redirect: "follow", headers: { "User-Agent": "Emilia-Iris/1.0 (vigilancia)" }, signal: AbortSignal.timeout((c.timeout_seg || 20) * 1000) });
      status = r.status; cuerpo = (await r.text().catch(() => "")).slice(0, 4000); error = "";
      if (status < 500) break;
    } catch (e: any) { error = e?.name === "TimeoutError" ? `no respondió en ${c.timeout_seg || 20} s` : e?.cause?.code || e?.message || String(e); }
    if (intento === 0) await dormir(2000);   // un reintento: no alarmar por un parpadeo
  }
  const ms = Date.now() - t0;
  if (!status) return { estado: "caido", detalle: `Sin respuesta: ${error}`, latencia_ms: ms };
  const [desde, hasta] = String(c.estados_ok || "200-399").split("-").map(Number);
  if (status < desde || status > (hasta || desde)) return { estado: "caido", detalle: `Respondió HTTP ${status}${cuerpo ? `: ${cuerpo.replace(/\s+/g, " ").slice(0, 160)}` : ""}`, latencia_ms: ms };
  if (c.esperado && !cuerpo.includes(c.esperado)) return { estado: "caido", detalle: `Responde ${status} pero no aparece "${c.esperado}" (¿muestra una página de error?).`, latencia_ms: ms };
  const base = await lineaBase(m.id);
  const umbral = Math.max(c.latencia_max_ms || 0, 2000, base ? base * 3 : 0);
  if (ms > umbral) return { estado: "lento", detalle: `Responde pero lento: ${ms} ms${base ? ` (normalmente ~${Math.round(base)} ms)` : ""}.`, latencia_ms: ms };
  // Certificado: una vez al día.
  if (/^https:/i.test(c.url) && (!m.memoria.ssl_revisado || Date.now() - new Date(m.memoria.ssl_revisado).getTime() > 86400_000)) {
    const dias = await diasCertificado(new URL(c.url).hostname);
    m.memoria.ssl_revisado = new Date().toISOString(); m.memoria.ssl_dias = dias;
    if (dias !== null && dias <= 14) return { estado: "aviso", detalle: `El certificado SSL vence en ${dias} día(s).`, latencia_ms: ms };
  } else if (m.memoria.ssl_dias !== undefined && m.memoria.ssl_dias !== null && m.memoria.ssl_dias <= 14) {
    return { estado: "aviso", detalle: `El certificado SSL vence en ${m.memoria.ssl_dias} día(s).`, latencia_ms: ms };
  }
  return { estado: "ok", detalle: `HTTP ${status} en ${ms} ms`, latencia_ms: ms };
}

async function revisarProcesoLocal(m: Monitor): Promise<Resultado> {
  const { obtenerProyecto } = await import("../dominio/proyectos.js");
  const { estadoProceso, saludProceso, leerLogs } = await import("./runtime.js");
  const p = await obtenerProyecto(m.config.proyecto);
  if (!p) return { estado: "caido", detalle: `El proyecto ${m.config.proyecto} ya no está registrado.` };
  const e = await estadoProceso(p);
  if (e.estado !== "corriendo") {
    const err = (await leerLogs(p, { ultimas: 20, soloErrores: true })).slice(-3).join(" | ");
    return { estado: "caido", detalle: `El proceso está ${e.estado}${e.codigo_salida != null ? ` (salió con código ${e.codigo_salida})` : ""}.${err ? ` Últimos errores: ${err.slice(0, 300)}` : ""}`, extra: { proyecto: p.nombre } };
  }
  if (!p.url_salud && !p.puerto) return { estado: "ok", detalle: `Corriendo (pid ${e.pid}).` };
  const s = await saludProceso(p);
  if (!s.ok) return { estado: "caido", detalle: `Corre (pid ${e.pid}) pero no responde: ${s.error || `HTTP ${s.status}`}.`, extra: { proyecto: p.nombre } };
  const base = await lineaBase(m.id);
  if ((s.latencia_ms || 0) > Math.max(2000, base ? base * 3 : 0)) return { estado: "lento", detalle: `Responde lento: ${s.latencia_ms} ms${base ? ` (normal ~${Math.round(base)} ms)` : ""}.`, latencia_ms: s.latencia_ms };
  return { estado: "ok", detalle: `Corriendo y responde en ${s.latencia_ms} ms.`, latencia_ms: s.latencia_ms };
}

async function revisarRailway(m: Monitor): Promise<Resultado> {
  const { railway } = await import("./publicar.js");
  const c = m.config;
  const d = await railway<any>(`query($input:DeploymentListInput!){deployments(input:$input,first:5){edges{node{id status createdAt meta}}}}`, { input: { serviceId: c.servicio_id, environmentId: c.entorno_id } });
  const deps = (d.deployments?.edges || []).map((e: any) => e.node);
  const ultimo = deps[0];
  if (!ultimo) return { estado: "aviso", detalle: "El servicio no tiene despliegues." };
  const anteriorBueno = deps.slice(1).find((x: any) => x.status === "SUCCESS" || x.status === "REMOVED");
  const commit = (x: any) => String(x?.meta?.commitMessage || "").split("\n")[0].slice(0, 80);
  if (["FAILED", "CRASHED"].includes(ultimo.status)) {
    return { estado: "caido", detalle: `El último despliegue ${ultimo.status === "CRASHED" ? "se cayó" : "falló"}${commit(ultimo) ? ` ("${commit(ultimo)}")` : ""}.`, extra: { deployment: ultimo.id, anterior: anteriorBueno?.id, anterior_fecha: anteriorBueno?.createdAt, anterior_commit: commit(anteriorBueno) } };
  }
  if (ultimo.status === "SLEEPING") return { estado: "ok", detalle: "Dormido (se despierta con la primera visita)." };
  const ESTADOS: Record<string, string> = { SUCCESS: "Desplegado y funcionando", BUILDING: "Construyendo", DEPLOYING: "Desplegando", INITIALIZING: "Arrancando", QUEUED: "En cola", WAITING: "En espera", REMOVED: "Retirado", SKIPPED: "Omitido" };
  return { estado: "ok", detalle: `${ESTADOS[ultimo.status] || ultimo.status}${commit(ultimo) ? ` · "${commit(ultimo)}"` : ""}.` };
}

async function revisarPc(m: Monitor): Promise<Resultado> {
  const problemas: string[] = [];
  const raiz = process.platform === "win32" ? path.parse(process.cwd()).root : "/";
  try {
    const s: any = await (fs as any).statfs(raiz);
    const libre = Number(s.bavail) * Number(s.bsize), total = Number(s.blocks) * Number(s.bsize), pct = total ? (libre / total) * 100 : 100;
    m.memoria.disco_libre_gb = +(libre / 1e9).toFixed(1); m.memoria.disco_pct = +pct.toFixed(1);
    if (pct < (m.config.disco_min_pct || 10) || libre < (m.config.disco_min_gb || 5) * 1e9) problemas.push(`disco ${raiz} casi lleno: quedan ${(libre / 1e9).toFixed(1)} GB (${pct.toFixed(0)} %)`);
  } catch { /* statfs no disponible */ }
  const usoRam = 1 - os.freemem() / os.totalmem();
  m.memoria.ram_pct = Math.round(usoRam * 100);
  const altas = [...(m.memoria.ram_altas || []), usoRam > 0.93 ? 1 : 0].slice(-3);
  m.memoria.ram_altas = altas;
  if (altas.length === 3 && altas.every(Boolean)) problemas.push(`memoria RAM al ${Math.round(usoRam * 100)} % hace rato`);
  return problemas.length ? { estado: "aviso", detalle: `Tu PC: ${problemas.join("; ")}.` } : { estado: "ok", detalle: `Disco libre ${m.memoria.disco_libre_gb ?? "?"} GB · RAM ${m.memoria.ram_pct} %` };
}

async function revisarPostgres(): Promise<Resultado> {
  const t0 = Date.now();
  try {
    const [r] = await query<{ tam: string }>(`SELECT pg_size_pretty(pg_database_size(current_database())) AS tam`);
    return { estado: "ok", detalle: `Responde en ${Date.now() - t0} ms · base de ${r.tam}`, latencia_ms: Date.now() - t0 };
  } catch (e: any) { return { estado: "caido", detalle: `La base de datos de Emilia no responde: ${e?.message || e}` }; }
}

async function revisarCorreo(): Promise<Resultado> {
  const xs = await query<{ cuenta: string; estado: string; error: string | null; actualizado_en: string }>(`SELECT cuenta, estado, error, actualizado_en FROM correo_cuentas`);
  const malas = xs.filter((x) => x.estado !== "conectada" && Date.now() - new Date(x.actualizado_en).getTime() > 10 * 60_000);
  return malas.length ? { estado: "caido", detalle: `Correo sin conexión: ${malas.map((x) => `${x.cuenta} (${x.error || x.estado})`).join("; ")}` } : { estado: "ok", detalle: xs.length ? `${xs.length} cuenta(s) conectada(s)` : "Sin cuentas de correo." };
}

/** Vigila a los vigilantes: ¿las tareas programadas de verdad corrieron? */
async function revisarCrons(): Promise<Resultado> {
  const xs = await query<{ nombre: string; config: any; ultimo_disparo: string | null; creado_en: string }>(`SELECT nombre, config, ultimo_disparo, creado_en FROM disparadores WHERE estado = 'activo' AND tipo = 'cron'`);
  const atrasadas: string[] = [];
  for (const d of xs) {
    const ref = new Date(d.ultimo_disparo || d.creado_en).getTime();
    const limite = d.config?.cada_minutos ? (2 * d.config.cada_minutos + 5) * 60_000 : 26 * 3600_000;   // expresiones: casi siempre diarias
    if (Date.now() - ref > limite) atrasadas.push(`${d.nombre} (última vez ${d.ultimo_disparo ? `hace ${duracion(Date.now() - ref)}` : "nunca"})`);
  }
  return atrasadas.length ? { estado: "aviso", detalle: `Tareas programadas que no se ejecutaron: ${atrasadas.join(", ")}.` } : { estado: "ok", detalle: `${xs.length} tarea(s) programada(s) al día.` };
}

// ── Copias de seguridad ──────────────────────────────────────────────────────
export const DIR_COPIAS = () => path.resolve(process.env.COPIAS_DIR || path.join(os.homedir(), "EmiliaCopias"));
function ejecutar(bin: string, args: string[], seg = 600): Promise<{ codigo: number; salida: string }> {
  return new Promise((r) => execFile(bin, args, { timeout: seg * 1000, maxBuffer: 20 * 1024 * 1024, windowsHide: true }, (e: any, so, se) => r({ codigo: e ? (typeof e.code === "number" ? e.code : 1) : 0, salida: `${so || ""}${se || ""}` })));
}
async function binarioPg(nombre: "pg_dump" | "pg_restore"): Promise<string> {
  if (process.env.PG_BIN) return path.join(process.env.PG_BIN, nombre + (process.platform === "win32" ? ".exe" : ""));
  if (process.platform === "win32") {
    for (const v of ["18", "17", "16", "15", "14"]) { const p = `C:\\Program Files\\PostgreSQL\\${v}\\bin\\${nombre}.exe`; if (await fs.access(p).then(() => true, () => false)) return p; }
  }
  return nombre;
}
/** Copia completa de la base de Emilia (formato custom), verificada con pg_restore --list, rotada (7 diarias + 4 domingos). */
export async function hacerCopia(): Promise<{ ok: boolean; archivo?: string; bytes?: number; detalle: string }> {
  const dir = DIR_COPIAS(); await fs.mkdir(dir, { recursive: true });
  const fecha = new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
  const archivo = path.join(dir, `emilia-${fecha}.dump`);
  const d = await ejecutar(await binarioPg("pg_dump"), ["--format=custom", "--no-owner", `--file=${archivo}`, process.env.DATABASE_URL || ""], 900);
  let ok = d.codigo === 0, detalle = d.codigo === 0 ? "" : `pg_dump falló: ${d.salida.slice(-400)}${/ENOENT|not recognized|no se reconoce/i.test(d.salida) ? " (no encuentro pg_dump: pon PG_BIN en el .env con la carpeta bin de PostgreSQL)" : ""}`;
  let bytes = 0;
  if (ok) {
    bytes = (await fs.stat(archivo)).size;
    const v = await ejecutar(await binarioPg("pg_restore"), ["--list", archivo], 120);
    const tablas = (v.salida.match(/ TABLE DATA /g) || []).length;
    ok = v.codigo === 0 && tablas > 5;
    detalle = ok ? `${(bytes / 1e6).toFixed(1)} MB, ${tablas} tablas, verificada` : `La copia no se pudo verificar: ${v.salida.slice(-300)}`;
  }
  await query(`INSERT INTO copias (archivo, bytes, ok, detalle) VALUES ($1,$2,$3,$4)`, [ok ? archivo : null, bytes || null, ok, detalle]);
  if (ok) {   // rotación: 7 diarias + 4 de domingo
    const todas = (await fs.readdir(dir)).filter((f) => /^emilia-\d{4}-\d{2}-\d{2}\.dump$/.test(f)).sort().reverse();
    const domingo = (f: string) => new Date(`${f.slice(7, 17)}T12:00:00-05:00`).getDay() === 0;
    const guardar = new Set([...todas.slice(0, 7), ...todas.filter(domingo).slice(0, 4)]);
    for (const f of todas) if (!guardar.has(f)) await fs.unlink(path.join(dir, f)).catch(() => {});
  }
  return { ok, archivo: ok ? archivo : undefined, bytes, detalle };
}
async function revisarCopias(m: Monitor): Promise<Resultado> {
  const horaCopia = m.config.hora || "03:00";
  const [ultima] = await query<{ t: string; ok: boolean; detalle: string }>(`SELECT t, ok, detalle FROM copias ORDER BY t DESC LIMIT 1`);
  const [ultimaBuena] = await query<{ t: string; detalle: string }>(`SELECT t, detalle FROM copias WHERE ok ORDER BY t DESC LIMIT 1`);
  const { ahoraBogota } = await import("./avisos.js");
  const { h, m: mm } = ahoraBogota();
  const [hh, mi] = horaCopia.split(":").map(Number);
  const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
  const yaHoy = ultimaBuena && new Date(ultimaBuena.t).toLocaleDateString("en-CA", { timeZone: "America/Bogota" }) === hoy;
  const intentoReciente = ultima && Date.now() - new Date(ultima.t).getTime() < 3600_000;
  if (!yaHoy && h * 60 + mm >= hh * 60 + mi && !intentoReciente) {
    const r = await hacerCopia();
    return r.ok ? { estado: "ok", detalle: `Copia de hoy lista: ${r.detalle}` } : { estado: "caido", detalle: `La copia de seguridad falló: ${r.detalle}` };
  }
  if (!ultimaBuena) return ultima && !ultima.ok ? { estado: "caido", detalle: `La copia de seguridad falló: ${ultima.detalle}` } : { estado: "ok", detalle: `Primera copia hoy a las ${horaCopia}.` };
  const edad = Date.now() - new Date(ultimaBuena.t).getTime();
  return edad > 50 * 3600_000 ? { estado: "caido", detalle: `La última copia buena es de hace ${duracion(edad)}.` } : { estado: "ok", detalle: `Última copia: ${ultimaBuena.detalle} (${duracion(edad)})` };
}

/** Tokens: que no estén vencidos ni por vencer. */
async function revisarCredenciales(): Promise<Resultado> {
  const malas: string[] = [], porVencer: string[] = [], bien: string[] = [];
  if (process.env.WHATSAPP_TOKEN) {
    try {
      const r = await fetch(`https://graph.facebook.com/${process.env.WHATSAPP_API_VERSION || "v21.0"}/${process.env.WHATSAPP_PHONE_ID}?fields=id`, { headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` }, signal: AbortSignal.timeout(15_000) });
      const d: any = await r.json().catch(() => ({}));
      if (d?.error?.code === 190) malas.push(`el token de WhatsApp venció o fue revocado (${d.error.message?.slice(0, 80)})`); else bien.push("WhatsApp");
    } catch { /* sin red: no es del token */ }
  }
  if (process.env.GITHUB_TOKEN) {
    try {
      const r = await fetch("https://api.github.com/user", { headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, "User-Agent": "Emilia" }, signal: AbortSignal.timeout(15_000) });
      const vence = r.headers.get("github-authentication-token-expiration");
      if (r.status === 401) malas.push("el token de GitHub ya no sirve");
      else if (vence) { const dias = Math.floor((new Date(vence).getTime() - Date.now()) / 86400_000); if (dias < 0) malas.push("el token de GitHub ya venció"); else if (dias <= 7) porVencer.push(`el token de GitHub vence en ${dias} día(s)`); else bien.push(`GitHub (vence en ${dias} d)`); }
      else bien.push("GitHub");
    } catch { /* sin red */ }
  }
  if (process.env.RAILWAY_TOKEN) {
    try { const { railway } = await import("./publicar.js"); await railway(`query{me{id}}`); bien.push("Railway"); }
    catch (e: any) { if (/Not Authorized|unauthorized|invalid/i.test(String(e?.message))) malas.push("el token de Railway ya no sirve"); }
  }
  const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);
  if (malas.length) return { estado: "caido", detalle: `${cap([...malas, ...porVencer].join("; "))}.` };
  if (porVencer.length) return { estado: "aviso", detalle: `${cap(porVencer.join("; "))}. Renuévalo antes para que nada se caiga.` };
  return { estado: "ok", detalle: bien.length ? `Vigentes: ${bien.join(", ")}` : "Sin credenciales que revisar." };
}

const REVISORES: Record<string, (m: Monitor) => Promise<Resultado>> = {
  url: revisarUrl, proceso: revisarProcesoLocal, railway: revisarRailway, pc: revisarPc, postgres: () => revisarPostgres(),
  correo: () => revisarCorreo(), crons: () => revisarCrons(), copias: revisarCopias, credenciales: () => revisarCredenciales(),
};

// ── Monitores del sistema (los crea Iris sola) ───────────────────────────────
export async function asegurarMonitoresSistema() {
  const base = [
    { nombre: "Este PC", tipo: "pc", cada_seg: 300, fallos: 1 },
    { nombre: "Base de datos de Emilia", tipo: "postgres", cada_seg: 120, fallos: 2, critico: true },
    { nombre: "Correo", tipo: "correo", cada_seg: 300, fallos: 1 },
    { nombre: "Tareas programadas", tipo: "crons", cada_seg: 600, fallos: 1 },
    { nombre: "Copias de seguridad", tipo: "copias", cada_seg: 1800, fallos: 1, config: { hora: process.env.COPIAS_HORA || "03:00" } },
    { nombre: "Credenciales", tipo: "credenciales", cada_seg: 6 * 3600, fallos: 1 },
  ];
  // Any (chatbot del mall): si está configurado, se vigila que esté arriba; la calidad la mide calidad-any.
  if (process.env.ANY_URL) base.push({ nombre: "Any (chatbot)", tipo: "url", cada_seg: 300, fallos: 2, critico: true, config: { url: `${process.env.ANY_URL.replace(/\/+$/, "")}/health` } } as any);
  for (const b of base) {
    await query(`INSERT INTO monitores (nombre, tipo, cada_seg, fallos_para_alertar, critico, sistema, config) VALUES ($1,$2,$3,$4,$5,true,$6) ON CONFLICT (nombre) DO NOTHING`,
      [b.nombre, b.tipo, b.cada_seg, b.fallos, !!(b as any).critico, JSON.stringify((b as any).config || {})]);
  }
}

// ── Motor ────────────────────────────────────────────────────────────────────
const accionesEnCurso = new Set<string>();

async function abrirIncidente(m: Monitor, r: Resultado): Promise<string> {
  const [i] = await query<{ id: string }>(`INSERT INTO incidentes (monitor_id, monitor, severidad, titulo, detalles) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [m.id, m.nombre, r.estado, `${m.nombre}: ${r.estado === "caido" ? "caído" : r.estado}`, JSON.stringify([{ t: new Date().toISOString(), detalle: r.detalle }])]);
  return i.id;
}
export async function anotarAccion(incidenteId: string, texto: string) {
  await query(`UPDATE incidentes SET acciones = acciones || $2::jsonb WHERE id = $1`, [incidenteId, JSON.stringify([{ t: new Date().toISOString(), accion: texto }])]);
}

/** Marca {clave: {incidente: true}} solo si no estaba; true si la marcó esta llamada. */
async function marcarUnaVez(id: string, clave: string, incidenteId: string): Promise<boolean> {
  const r = await query(`UPDATE monitores SET memoria = jsonb_set(memoria, ARRAY[$2::text], COALESCE(memoria->$2,'{}') || jsonb_build_object($3::text, true)) WHERE id = $1 AND NOT COALESCE(memoria->$2 ? $3, false) RETURNING id`, [id, clave, incidenteId]);
  return r.length > 0;
}

/** Lo que Iris hace sola ante una caída (sin bloquear el reloj). */
function reaccionar(m: Monitor, r: Resultado, incidenteId: string) {
  const clave = `${m.id}:${incidenteId}`;
  if (accionesEnCurso.has(clave)) return;
  accionesEnCurso.add(clave);
  (async () => {
    try {
      if (m.tipo === "proceso" && r.estado === "caido") {
        // Contador atómico: aunque dos revisiones se crucen, nunca pasa de 2 reinicios ni escala dos veces.
        const [{ n }] = await query<{ n: number }>(`UPDATE monitores SET memoria = jsonb_set(memoria, '{reinicios_incidente}', COALESCE(memoria->'reinicios_incidente','{}') || jsonb_build_object($2::text, COALESCE((memoria->'reinicios_incidente'->>$2)::int, 0) + 1)) WHERE id = $1 RETURNING (memoria->'reinicios_incidente'->>$2)::int AS n`, [m.id, incidenteId]);
        if (n <= 2) {
          const { obtenerProyecto } = await import("../dominio/proyectos.js");
          const { reiniciarProceso } = await import("./runtime.js");
          const p = await obtenerProyecto(m.config.proyecto);
          if (p) { const x = await reiniciarProceso(p).catch((e) => ({ ok: false, error: String(e?.message || e) })); await anotarAccion(incidenteId, `Reinicié ${p.nombre} (${(x as any).ok ? "arrancó" : `falló: ${(x as any).error}`}).`); }
        } else if (await marcarUnaVez(m.id, "escalado", incidenteId)) {
          await anotarAccion(incidenteId, "Reinicié 2 veces y no levanta: se lo pasé a Sage para que encuentre la causa y lo arregle (con tu OK para subir).");
          const { escalarASage } = await import("../skills/guardia.js");
          await escalarASage(m.config.proyecto, `${m.config.proyecto} se cae y no levanta`, r.detalle);
        }
      }
      if (m.tipo === "railway" && r.estado === "caido" && r.extra?.anterior && await marcarUnaVez(m.id, "rollback_ofrecido", incidenteId)) {
        const { pedirAprobacionYEsperar } = await import("./permisos-codigo.js");
        const { railway, logsDespliegue } = await import("./publicar.js");
        const logs = (await logsDespliegue(r.extra.deployment, 15).catch(() => "")).split("\n").slice(-6).join("\n");
        const ap = await pedirAprobacionYEsperar({ titulo: `${m.nombre}: ¿vuelvo a la versión anterior?`, detalle: `${r.detalle}\n${logs ? `Últimos logs:\n${logs.slice(-600)}\n` : ""}Versión buena anterior: ${r.extra.anterior_commit ? `"${r.extra.anterior_commit}" ` : ""}(${r.extra.anterior_fecha ? new Date(r.extra.anterior_fecha).toLocaleString("es-CO", { timeZone: "America/Bogota" }) : "?"}).\nResponde *ok* para volver a ella (Sage puede arreglar la nueva después).` });
        if (ap.aprobada) {
          try { await railway(`mutation($id:String!){deploymentRollback(id:$id)}`, { id: r.extra.anterior }); await anotarAccion(incidenteId, "Volví a la versión anterior en Railway (con tu OK)."); await avisarJefe(`↩️ ${m.nombre}: volviendo a la versión anterior. Te aviso cuando esté arriba.`); }
          catch (e: any) { await anotarAccion(incidenteId, `El rollback falló: ${e?.message || e}`); await avisarJefe(`❌ No pude volver a la versión anterior de ${m.nombre}: ${e?.message || e}`); }
        } else await anotarAccion(incidenteId, `No volví a la versión anterior (${ap.motivo}).`);
      }
    } catch (e: any) { console.warn("[vigilancia] reacción:", e?.message || e); }
    finally { accionesEnCurso.delete(clave); }
  })();
}

/** Lo que la reacción (en segundo plano) guarda en memoria no lo pisa la revisión. */
const CLAVES_REACCION = ["reinicios_incidente", "escalado", "rollback_ofrecido"];
const propiaDeRevision = (mem: any) => Object.fromEntries(Object.entries(mem || {}).filter(([k]) => !CLAVES_REACCION.includes(k)));

const ICONO: Record<string, string> = { caido: "🔴", lento: "🐢", aviso: "⚠️", ok: "✅" };

export async function revisarMonitor(m: Monitor): Promise<Resultado> {
  let r: Resultado;
  try { r = await Promise.race([REVISORES[m.tipo]?.(m) ?? Promise.resolve({ estado: "aviso" as Estado, detalle: `Tipo desconocido: ${m.tipo}` }), dormir(90_000).then(() => ({ estado: "caido" as Estado, detalle: "La revisión no terminó en 90 s." }))]); }
  catch (e: any) { r = { estado: m.tipo === "railway" ? "aviso" : "caido", detalle: `No pude revisarlo: ${String(e?.message || e).slice(0, 200)}` }; }
  await query(`INSERT INTO monitor_chequeos (monitor_id, estado, latencia_ms, detalle) VALUES ($1,$2,$3,$4)`, [m.id, r.estado, r.latencia_ms ?? null, r.detalle.slice(0, 500)]);

  const malo = r.estado !== "ok";
  const fallos = malo ? m.fallos_seguidos + 1 : 0;
  const confirma = malo && fallos >= (r.estado === "lento" ? Math.max(3, m.fallos_para_alertar) : m.fallos_para_alertar);
  let estado = m.estado, desde = m.desde, incidente = m.incidente_id;

  if (!malo && m.incidente_id) {
    // Volvió: cierra el incidente y cuenta lo que pasó.
    const [inc] = await query<any>(`UPDATE incidentes SET fin = now() WHERE id = $1 RETURNING *`, [m.incidente_id]);
    const dur = inc ? Date.now() - new Date(inc.inicio).getTime() : 0;
    const vistos = (inc?.detalles || []).map((x: any) => x.detalle);
    const hechos = (inc?.acciones || []).map((x: any) => x.accion);
    const resumen = `${ICONO.ok} *${m.nombre} volvió* tras ${duracion(dur)} (${inc ? hora(inc.inicio) : "?"}–${hora(new Date())}).\n• Qué pasó: ${[...new Set(vistos)].slice(0, 2).join(" / ").slice(0, 400)}${hechos.length ? `\n• Qué se hizo: ${hechos.join(" ").slice(0, 500)}` : "\n• Se recuperó solo."}\n• Ahora: ${r.detalle}`;
    await query(`UPDATE incidentes SET resumen = $2 WHERE id = $1`, [m.incidente_id, resumen]);
    await avisarJefe(resumen, m.critico ? "critico" : "normal", "vigilancia");
    estado = "ok"; desde = new Date().toISOString(); incidente = null;
  } else if (!malo) {
    if (estado !== "ok") { estado = "ok"; desde = new Date().toISOString(); }
  } else if (confirma) {
    if (!m.incidente_id) {
      incidente = await abrirIncidente(m, r);
      estado = r.estado; desde = new Date().toISOString();
      await avisarJefe(`${ICONO[r.estado]} *${m.nombre}* ${r.estado === "caido" ? "está CAÍDO" : r.estado === "lento" ? "está lento" : "necesita atención"}\n${r.detalle}${m.tipo === "proceso" && r.estado === "caido" ? "\nLo reinicio y te cuento." : m.tipo === "railway" && r.estado === "caido" && r.extra?.anterior ? "\nTe propongo volver a la versión anterior 👇" : ""}`, m.critico && r.estado === "caido" ? "critico" : "normal", "vigilancia");
      m.memoria.ultimo_recordatorio = new Date().toISOString();
    } else {
      await query(`UPDATE incidentes SET detalles = detalles || $2::jsonb, severidad = CASE WHEN $3 THEN $4 ELSE severidad END WHERE id = $1`,
        [m.incidente_id, JSON.stringify([{ t: new Date().toISOString(), detalle: r.detalle }]), GRAVEDAD[r.estado] > GRAVEDAD[estado], r.estado]);
      if (GRAVEDAD[r.estado] > GRAVEDAD[estado]) {   // empeoró (de lento a caído)
        await avisarJefe(`${ICONO[r.estado]} *${m.nombre}* empeoró: ${r.detalle}`, m.critico ? "critico" : "normal", "vigilancia");
        estado = r.estado;
      } else {
        const [inc] = await query<{ inicio: string }>(`SELECT inicio FROM incidentes WHERE id = $1`, [m.incidente_id]);
        const ult = new Date(m.memoria.ultimo_recordatorio || inc?.inicio || Date.now()).getTime(), lleva = Date.now() - new Date(inc?.inicio || Date.now()).getTime();
        const toca = lleva < 3600_000 ? lleva >= 30 * 60_000 && Date.now() - ult >= 25 * 60_000 : Date.now() - ult >= 2 * 3600_000;
        if (toca && estado === "caido") { await avisarJefe(`${ICONO.caido} *${m.nombre}* sigue caído (${duracion(lleva)}): ${r.detalle}`, "normal", "vigilancia"); m.memoria.ultimo_recordatorio = new Date().toISOString(); }
      }
    }
    if (incidente) reaccionar(m, r, incidente);
  }
  await query(`UPDATE monitores SET estado = $2, desde = $3, ultimo_chequeo = now(), ultimo_ok = CASE WHEN $4 THEN now() ELSE ultimo_ok END, fallos_seguidos = $5, ultima_latencia_ms = $6, ultimo_detalle = $7, incidente_id = $8, memoria = memoria || $9::jsonb WHERE id = $1`,
    [m.id, estado, desde, !malo, fallos, r.latencia_ms ?? null, r.detalle.slice(0, 500), incidente, JSON.stringify(propiaDeRevision(m.memoria))]);
  return r;
}

let revisando = false;
/** Lo llama el reloj de Iris cada minuto: revisa los monitores a los que les toca. */
export async function vigilar(): Promise<number> {
  if (revisando) return 0;
  revisando = true;
  try {
    const xs = await query<Monitor>(`SELECT * FROM monitores WHERE activo AND (ultimo_chequeo IS NULL OR ultimo_chequeo + make_interval(secs => cada_seg) <= now() + interval '5 seconds') ORDER BY ultimo_chequeo NULLS FIRST LIMIT 30`);
    await Promise.all(xs.map((m) => revisarMonitor(m).catch((e) => console.warn(`[vigilancia ${m.nombre}]`, e?.message || e))));
    if (Math.random() < 0.01) await query(`DELETE FROM monitor_chequeos WHERE t < now() - interval '35 days'`).catch(() => {});
    return xs.length;
  } finally { revisando = false; }
}

/** Disponibilidad y tiempos de los últimos N días (para el informe). */
export async function disponibilidad(dias = 7) {
  return query<{ nombre: string; tipo: string; estado: string; pct: number; p50: number | null; p95: number | null; caidas: number; caido_min: number }>(
    `SELECT m.nombre, m.tipo, m.estado,
       round(100.0 * avg(CASE WHEN c.estado IN ('ok','aviso') THEN 1 ELSE 0 END)::numeric, 2)::float AS pct,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY c.latencia_ms) AS p50, percentile_cont(0.95) WITHIN GROUP (ORDER BY c.latencia_ms) AS p95,
       (SELECT count(*) FROM incidentes i WHERE i.monitor_id = m.id AND i.inicio > now() - make_interval(days => $1))::int AS caidas,
       COALESCE((SELECT round(sum(EXTRACT(EPOCH FROM (COALESCE(i.fin, now()) - i.inicio)) / 60)) FROM incidentes i WHERE i.monitor_id = m.id AND i.severidad = 'caido' AND i.inicio > now() - make_interval(days => $1)), 0)::int AS caido_min
     FROM monitores m LEFT JOIN monitor_chequeos c ON c.monitor_id = m.id AND c.t > now() - make_interval(days => $1)
     WHERE m.activo GROUP BY m.id ORDER BY m.sistema, m.nombre`, [dias]);
}
