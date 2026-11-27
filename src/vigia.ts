// ARCHIVO: src/vigia.ts
// ─────────────────────────────────────────────────────────────────────────────
//  EL VIGÍA — el proceso que mantiene viva a Emilia.  npm run vigia
//  · Arranca el servidor y lo vuelve a levantar si se cae (con espera creciente;
//    si se cae 5 veces en 15 min, para 10 min y te avisa).
//  · Cada minuto pregunta /api/salud: si no responde 3 veces seguidas, lo
//    reinicia. Si responde pero la BASE está caída, no reinicia en bucle: te avisa.
//  · Guarda los logs en logs/emilia-AAAA-MM-DD.log (14 días), con las llaves tapadas.
//  · Actualizaciones SOLO con tu OK: revisa GitHub cada día y te avisa; cuando
//    dices «actualiza emilia», baja los cambios, instala, migra, arranca y, si la
//    versión nueva no queda sana, vuelve sola a la anterior.
//  Te avisa por WhatsApp directo (sin pasar por el servidor, que puede estar caído).
//  En Windows lo arranca la tarea programada «Emilia» al iniciar sesión
//  (scripts/windows/instalar-inicio.ps1).
// ─────────────────────────────────────────────────────────────────────────────
import "dotenv/config";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { redactar } from "./seguridad/secretos.js";

const RAIZ = process.cwd();
const PORT = Number(process.env.PORT ?? 3000);
const DATA = path.resolve(process.env.DATA_DIR || "data");
const LOGS = path.resolve(process.env.LOGS_DIR || "logs");
const PEDIDO = path.join(DATA, "actualizar.pedido");
const ESTADO = path.join(DATA, "vigia.json");
const GRACIA_MS = Number(process.env.VIGIA_GRACIA_SEG || 240) * 1000;   // arrancar carga modelos: no lo juzgues antes
const CADA_MS = Number(process.env.VIGIA_CADA_SEG || 60) * 1000;
const esWin = process.platform === "win32";

fs.mkdirSync(DATA, { recursive: true }); fs.mkdirSync(LOGS, { recursive: true });

// ── Estado persistente (para que el servidor y Arca lo lean) ──
interface EstadoVigia { inicio: string; reinicios: { t: string; motivo: string }[]; version: string | null; actualizacion?: { t: string; de: string; a: string; ok: boolean; detalle: string }; pendiente?: { hash: string; commits: number; avisado: string } }
let estado: EstadoVigia = (() => { try { return JSON.parse(fs.readFileSync(ESTADO, "utf8")); } catch { return { inicio: new Date().toISOString(), reinicios: [], version: null }; } })();
estado.inicio = new Date().toISOString();
const guardar = () => { try { fs.writeFileSync(ESTADO, JSON.stringify(estado, null, 2)); } catch {} };

// ── Logs con rotación ──
let logDia = "", logStream: fs.WriteStream | null = null;
function log(linea: string) {
  const dia = new Date().toISOString().slice(0, 10);
  if (dia !== logDia) {
    logStream?.end(); logDia = dia;
    logStream = fs.createWriteStream(path.join(LOGS, `emilia-${dia}.log`), { flags: "a" });
    try { for (const f of fs.readdirSync(LOGS)) { const m = f.match(/^emilia-(\d{4}-\d{2}-\d{2})\.log$/); if (m && Date.now() - Date.parse(m[1]) > 14 * 86_400_000) fs.unlinkSync(path.join(LOGS, f)); } } catch {}
  }
  const t = redactar(linea);
  logStream!.write(`${new Date().toISOString()} ${t}\n`);
  process.stdout.write(t + "\n");
}
const ultimas: string[] = [];
const recordar = (l: string) => { ultimas.push(l); if (ultimas.length > 40) ultimas.shift(); };

// ── Avisos al jefe por WhatsApp, directo a Meta ──
export async function avisarDirecto(texto: string): Promise<boolean> {
  const token = process.env.WHATSAPP_TOKEN, phone = process.env.WHATSAPP_PHONE_ID, jefe = (process.env.WHATSAPP_NUMERO_JEFE || "").replace(/\D/g, "");
  if (!token || !phone || !jefe) { log(`[vigía] (sin WhatsApp configurado) ${texto}`); return false; }
  const url = `https://graph.facebook.com/${process.env.WHATSAPP_API_VERSION || "v21.0"}/${phone}/messages`;
  const post = (cuerpo: any) => fetch(url, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(cuerpo), signal: AbortSignal.timeout(20_000) }).then(async (r) => ({ ok: r.ok, j: await r.json().catch(() => ({})) })).catch((e) => ({ ok: false, j: { error: { message: String(e?.message || e) } } }));
  // Plantilla primero (funciona fuera de la ventana de 24 h); si no existe, texto.
  const plantilla = process.env.WHATSAPP_PLANTILLA_AVISO || "recordatorio_emilia";
  const linea = texto.replace(/\s*\n+\s*/g, " · ").slice(0, 1000);
  let r = await post({ messaging_product: "whatsapp", to: jefe, type: "template", template: { name: plantilla, language: { code: process.env.WHATSAPP_PLANTILLA_IDIOMA || process.env.WHATSAPP_PLANTILLA_AVISO_IDIOMA || "es" }, components: [{ type: "body", parameters: [{ type: "text", text: linea }] }] } });
  if (!r.ok) r = await post({ messaging_product: "whatsapp", to: jefe, type: "text", text: { body: texto.slice(0, 4000) } });
  if (!r.ok) log(`[vigía] no pude avisarte por WhatsApp: ${JSON.stringify(r.j).slice(0, 200)}`);
  return r.ok;
}

// ── Git ──
const git = (...a: string[]) => execFileSync("git", a, { cwd: RAIZ, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 120_000 }).trim();
const versionActual = () => { try { return git("rev-parse", "--short", "HEAD"); } catch { return null; } };

// ── El servidor ──
let hijo: ChildProcess | null = null;
let arrancadoEn = 0, fallosSalud = 0, apagando = false, enPausaHasta = 0, avisoBaseEn = 0;
const cmdNode = process.execPath;

function arrancar(motivo: string) {
  if (hijo) return;
  estado.version = versionActual(); guardar();
  log(`[vigía] Arrancando Emilia (${estado.version || "sin git"}) — ${motivo}`);
  hijo = spawn(cmdNode, ["--import", "tsx", process.env.VIGIA_SERVIDOR || "src/server.ts"], { cwd: RAIZ, env: { ...process.env, EMILIA_VIGIA: "1", EMILIA_VERSION: estado.version || "" }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  arrancadoEn = Date.now(); fallosSalud = 0;
  for (const s of [hijo.stdout!, hijo.stderr!]) {
    let resto = "";
    s.on("data", (b: Buffer) => { const partes = (resto + b.toString("utf8")).split("\n"); resto = partes.pop() || ""; for (const l of partes) { log(l); recordar(l); } });
  }
  hijo.on("exit", (codigo, senal) => {
    hijo = null;
    if (apagando || actualizando) return;   // en una actualización, la decide actualizar() (vuelve atrás si hace falta)
    const motivo = `se cerró (código ${codigo ?? "-"}${senal ? `, señal ${senal}` : ""})`;
    log(`[vigía] Emilia ${motivo}.`);
    alCaer(motivo);
  });
}

function detener(): Promise<void> {
  return new Promise((res) => {
    if (!hijo) return res();
    const h = hijo; const fin = setTimeout(() => { matarArbol(h); }, 15_000);
    h.once("exit", () => { clearTimeout(fin); res(); });
    if (esWin) matarArbol(h, false); else h.kill("SIGTERM");
  });
}
function matarArbol(h: ChildProcess, forzado = true) {
  try {
    if (esWin) execFileSync("taskkill", ["/PID", String(h.pid), "/T", ...(forzado ? ["/F"] : [])], { stdio: "ignore" });
    else h.kill(forzado ? "SIGKILL" : "SIGTERM");
  } catch {}
}

async function alCaer(motivo: string) {
  const ahora = Date.now();
  estado.reinicios.push({ t: new Date().toISOString(), motivo });
  estado.reinicios = estado.reinicios.filter((r) => ahora - Date.parse(r.t) < 7 * 86_400_000).slice(-50);
  guardar();
  const recientes = estado.reinicios.filter((r) => ahora - Date.parse(r.t) < 15 * 60_000).length;
  const error = ultimas.filter((l) => /error|✘|fall|exception|EADDRINUSE|ECONNREFUSED/i.test(l)).slice(-3).join(" | ").slice(0, 400);
  if (recientes >= 5) {
    enPausaHasta = ahora + 10 * 60_000;
    log("[vigía] 5 caídas en 15 min: espero 10 min antes de reintentar.");
    await avisarDirecto(`🛑 Me caí ${recientes} veces en 15 minutos y no logro quedarme arriba. Espero 10 min y vuelvo a intentar. Último error: ${redactar(error) || motivo}. Si sigue, pídele a Arca un diagnóstico (npm run arca).`);
    setTimeout(() => arrancar("reintento tras la pausa"), 10 * 60_000);
    return;
  }
  const espera = [5, 10, 30, 60][Math.min(recientes - 1, 3)] * 1000;
  if (recientes === 1) avisarDirecto(`⚠️ Me caí (${motivo}) y me estoy levantando sola.${error ? ` Error: ${redactar(error)}` : ""}`).catch(() => {});
  setTimeout(() => arrancar(`tras caída (${motivo})`), espera);
}

async function revisarSalud() {
  if (!hijo || apagando || Date.now() < enPausaHasta || Date.now() - arrancadoEn < GRACIA_MS) return;
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/api/salud`, { signal: AbortSignal.timeout(10_000) });
    const j: any = await r.json().catch(() => ({}));
    fallosSalud = 0;
    if (!j.db) {
      if (Date.now() - avisoBaseEn > 3_600_000) { avisoBaseEn = Date.now(); log("[vigía] La base no responde."); await avisarDirecto("⚠️ La base de datos (PostgreSQL) no me responde. Sigo prendida pero sin memoria ni tareas. Revisa que el servicio de PostgreSQL esté corriendo (Arca te guía: npm run arca)."); }
    } else if (avisoBaseEn) { avisoBaseEn = 0; log("[vigía] La base volvió."); }
  } catch (e: any) {
    fallosSalud++;
    log(`[vigía] /api/salud no respondió (${fallosSalud}/3): ${e?.message || e}`);
    if (fallosSalud >= 3 && hijo) {
      log("[vigía] Emilia está colgada: la reinicio.");
      fallosSalud = 0; arrancadoEn = Date.now();   // no lo vuelvas a juzgar mientras muere y arranca
      const h = hijo; matarArbol(h);   // el 'exit' dispara alCaer → arranca de nuevo
    }
  }
}

// ── Actualizaciones (solo con tu OK) ──
async function buscarActualizacion() {
  try {
    git("fetch", "--quiet");
    const n = Number(git("rev-list", "--count", "HEAD..@{u}"));
    if (!n) return;
    const hash = git("rev-parse", "--short", "@{u}");
    if (estado.pendiente?.hash === hash) return;   // ya te avisé de esta
    const lista = git("log", "--format=- %s", "-n", "6", "HEAD..@{u}");
    estado.pendiente = { hash, commits: n, avisado: new Date().toISOString() }; guardar();
    await avisarDirecto(`🆕 Hay ${n} cambio(s) nuevo(s) para Emilia:\n${lista}\nPara instalarlos escríbeme «actualiza emilia». Si la versión nueva falla, vuelvo sola a la de ahora.`);
  } catch (e: any) { log(`[vigía] No pude revisar actualizaciones: ${e?.message || e}`); }
}

async function npm(args: string[], seg = 900) {
  const cmd = esWin ? "npm.cmd" : "npm";
  execFileSync(cmd, args, { cwd: RAIZ, stdio: ["ignore", "pipe", "pipe"], timeout: seg * 1000, shell: esWin });
}

async function esperarSana(ms: number): Promise<boolean> {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    await new Promise((r) => setTimeout(r, 5000));
    if (!hijo) return false;
    try { const r = await fetch(`http://127.0.0.1:${PORT}/api/salud`, { signal: AbortSignal.timeout(5000) }); if (r.ok) return true; } catch {}
  }
  return false;
}

let actualizando = false;
export async function actualizar(): Promise<{ ok: boolean; detalle: string }> {
  if (actualizando) return { ok: false, detalle: "ya hay una actualización en curso" };
  actualizando = true;
  const de = versionActual() || "?";
  const lockAntes = fs.existsSync(path.join(RAIZ, "package-lock.json")) ? fs.readFileSync(path.join(RAIZ, "package-lock.json"), "utf8") : "";
  try {
    if (git("status", "--porcelain", "--untracked-files=no")) throw new Error("hay cambios locales sin subir en la carpeta de Emilia; no los piso");
    git("fetch", "--quiet");
    git("merge", "--ff-only", "@{u}");
    const a = versionActual() || "?";
    if (a === de) return { ok: true, detalle: "ya estabas en la última versión" };
    log(`[vigía] Actualizando ${de} → ${a}`);
    const lockAhora = fs.readFileSync(path.join(RAIZ, "package-lock.json"), "utf8");
    if (lockAhora !== lockAntes) await npm(["ci", "--no-audit", "--no-fund"]);
    await npm(["run", "migrate"], 300);
    apagando = true; await detener(); apagando = false;
    arrancar(`actualización ${de} → ${a}`);
    const sana = await esperarSana(GRACIA_MS + 60_000);
    if (!sana) throw Object.assign(new Error("la versión nueva no quedó sana"), { volver: true, a });
    estado.actualizacion = { t: new Date().toISOString(), de, a, ok: true, detalle: "ok" }; delete estado.pendiente; guardar();
    return { ok: true, detalle: `actualizada de ${de} a ${a}` };
  } catch (e: any) {
    const detalle = redactar(String(e?.message || e)).slice(0, 300);
    if ((versionActual() || de) !== de) {
      log(`[vigía] Falló la actualización (${detalle}): vuelvo a ${de}.`);
      try {
        git("reset", "--hard", de);
        if (fs.readFileSync(path.join(RAIZ, "package-lock.json"), "utf8") !== (lockAntes || "")) await npm(["ci", "--no-audit", "--no-fund"]);
      } catch (e2: any) { log(`[vigía] ¡No pude volver a ${de}!: ${e2?.message || e2}`); }
      apagando = true; await detener(); apagando = false;
      arrancar(`vuelta a ${de} tras actualización fallida`);
    }
    estado.actualizacion = { t: new Date().toISOString(), de, a: e?.a || "?", ok: false, detalle }; guardar();
    return { ok: false, detalle };
  } finally { actualizando = false; }
}

async function revisarPedido() {
  if (!fs.existsSync(PEDIDO)) return;
  try { fs.unlinkSync(PEDIDO); } catch {}
  const r = await actualizar();
  await avisarDirecto(r.ok ? `✅ Emilia actualizada: ${r.detalle}.` : `⚠️ No pude actualizar: ${r.detalle}. Sigo en la versión anterior, funcionando.`);
}

// ── Arranque ──
if (process.argv[1] && /vigia\.(ts|js|mjs)$/.test(process.argv[1]) && !process.env.VIGIA_NO_ARRANCAR) {
  log(`[vigía] Vigía arriba (pid ${process.pid}). Panel en http://127.0.0.1:${PORT}`);
  arrancar("inicio");
  setInterval(revisarSalud, CADA_MS);
  setInterval(revisarPedido, 15_000);
  const horaAct = process.env.VIGIA_HORA_ACTUALIZACIONES || "04:30";
  let ultimoDia = "";
  setInterval(() => { const d = new Date(), hm = d.toTimeString().slice(0, 5), dia = d.toDateString(); if (hm >= horaAct && dia !== ultimoDia) { ultimoDia = dia; buscarActualizacion(); } }, 60_000);
  const salir = async () => { apagando = true; log("[vigía] Apagando."); await detener(); process.exit(0); };
  process.on("SIGINT", salir); process.on("SIGTERM", salir);
}
