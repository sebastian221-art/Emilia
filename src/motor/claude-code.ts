// ARCHIVO: src/motor/claude-code.ts
// ─────────────────────────────────────────────────────────────────────────────
//  CLAUDE CODE — el motor de ingeniería de Sage
//  Lanza `claude -p` (salida stream-json) en un sandbox, en un experimento del
//  laboratorio o (modo lectura) directo en el repo, y lo deja observable.
//   - Tu plan Max: al proceso NO se le pasa ANTHROPIC_API_KEY (si estuviera,
//     Claude Code cobraría por la API). CLAUDE_CODE_USAR_API=true lo cambia.
//   - Permisos reales: hook PreToolUse → Emilia decide permitir / negar /
//     preguntarle al jefe por WhatsApp (motor/permisos-codigo.ts).
//   - Herramientas de Emilia por MCP (mandar archivos, avisos, biblioteca…).
//   - Tope de gasto (--max-budget-usd), timeout que SÍ mata el proceso,
//     máximo CLAUDE_CODE_PARALELO sesiones a la vez y una por sandbox.
//  .env: CLAUDE_CODE_BIN, CLAUDE_CODE_MODELO, CLAUDE_CODE_PARALELO (3),
//        CLAUDE_CODE_PRESUPUESTO_USD (5), CLAUDE_CODE_USAR_API (false)
// ─────────────────────────────────────────────────────────────────────────────
import { spawn, type ChildProcess } from "node:child_process";
import { query } from "../db/cliente.js";
import { crearSesionFila, obtenerSesion, logSesion, type SesionCodigo } from "../dominio/proyectos.js";
import { matar } from "./sandbox.js";
import { prepararLaboratorio, rutasConfig, tokenInterno, urlInterna } from "./laboratorio.js";
import type { Modo } from "./permisos-codigo.js";

const BIN = process.env.CLAUDE_CODE_BIN || "claude";
const procesos = new Map<string, ChildProcess>();

export interface OpcionesSesion {
  sandboxId?: string | null;
  proyectoId?: string | null;
  cwd: string;
  encargo: string;                 // prompt principal
  sistema?: string;                // contexto/reglas que van antes del encargo
  modo?: Modo;                     // escritura (por defecto) | lectura | experimento
  maxTurnos?: number;              // --max-turns
  presupuestoUsd?: number;         // --max-budget-usd
  timeoutSeg?: number;             // pasado esto, se mata el proceso
  raices?: string[];               // otras carpetas donde puede escribir sin preguntar
  continuarSesionClaude?: string;  // --resume <session_id>
  modelo?: string;
  agenteId?: string | null;
  conversacionId?: string | null;
}

// ─── Cola: N sesiones a la vez y una sola por carpeta ────────────────────────
const enUso = new Set<string>();
const espera: { clave: string; arrancar: () => void }[] = [];
const maxParalelo = () => Math.max(1, Number(process.env.CLAUDE_CODE_PARALELO) || 3);
function pedirTurno(clave: string): Promise<void> {
  return new Promise((r) => { espera.push({ clave, arrancar: r }); repartir(); });
}
function liberarTurno(clave: string) { enUso.delete(clave); repartir(); }
function repartir() {
  for (let i = 0; i < espera.length && enUso.size < maxParalelo(); ) {
    const e = espera[i];
    if (enUso.has(e.clave)) { i++; continue; }
    espera.splice(i, 1); enUso.add(e.clave); e.arrancar();
  }
}

/** El entorno del proceso: sin la API key (usa tu plan) y con lo que necesitan el hook y el MCP. */
/** Variables del sistema operativo y de herramientas que Claude Code sí necesita para funcionar. */
const ENTORNO_PERMITIDO = /^(PATH|PATHEXT|HOME|USERPROFILE|HOMEDRIVE|HOMEPATH|USERNAME|USER|LOGNAME|SHELL|COMSPEC|SYSTEMROOT|SYSTEMDRIVE|WINDIR|OS|TEMP|TMP|TMPDIR|APPDATA|LOCALAPPDATA|PROGRAMDATA|PROGRAMFILES|PROGRAMFILES\(X86\)|PROGRAMW6432|COMMONPROGRAMFILES.*|ALLUSERSPROFILE|PUBLIC|PROCESSOR_.*|NUMBER_OF_PROCESSORS|LANG|LC_.*|TZ|TERM|COLORTERM|XDG_.*|NVM_.*|NODE_EXTRA_CA_CERTS|SSL_CERT_FILE|HTTPS?_PROXY|NO_PROXY|https?_proxy|no_proxy|PYTHON.*|PLAYWRIGHT_BROWSERS_PATH|CLAUDE_CONFIG_DIR|CLAUDE_CODE_GIT_BASH_PATH|PSModulePath)$/i;

function entornoClaude(sesionId: string, op: OpcionesSesion): NodeJS.ProcessEnv {
  // Solo lo que el sistema necesita: Claude Code NO hereda los secretos de Emilia
  // (base de datos, WhatsApp, GitHub, Railway…). Si necesita algo, lo pide por MCP.
  const env: NodeJS.ProcessEnv = { FORCE_COLOR: "0" };
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && ENTORNO_PERMITIDO.test(k)) env[k] = v;
  for (const k of (process.env.CLAUDE_CODE_ENTORNO_EXTRA || "").split(",").map((x) => x.trim()).filter(Boolean)) if (process.env[k] !== undefined) env[k] = process.env[k];
  if (process.env.CLAUDE_CODE_USAR_API === "true") { for (const k of ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"]) if (process.env[k]) env[k] = process.env[k]; }
  Object.assign(env, {
    EMILIA_URL: urlInterna(), EMILIA_TOKEN: tokenInterno(), EMILIA_SESION: sesionId, EMILIA_MODO: op.modo || "escritura",
    EMILIA_RAICES: (op.raices || []).join("|"), MCP_TOOL_TIMEOUT: String(((Number(process.env.PERMISO_ESPERA_SEG) || 900) + 1500) * 1000),
  });
  return env;
}

const comillas = (s: string) => (/[\s"&|<>^]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s);

/** Inicia una sesión y devuelve enseguida (corre en segundo plano, cuando le toque turno). */
export async function iniciarSesionClaude(op: OpcionesSesion): Promise<SesionCodigo> {
  const modo: Modo = op.modo || "escritura";
  const sesion = await crearSesionFila({ sandboxId: op.sandboxId ?? null, proyectoId: op.proyectoId ?? null, encargo: op.encargo, agenteId: op.agenteId, conversacionId: op.conversacionId, modo, cwd: op.cwd });
  const clave = op.sandboxId || op.cwd;
  if (enUso.has(clave) || enUso.size >= maxParalelo()) await logSesion(sesion.id, "cola", "En cola: esperando turno (hay otras sesiones corriendo).");
  pedirTurno(clave).then(() => lanzar(sesion.id, op, modo, clave)).catch(async (e) => { liberarTurno(clave); await finalizar(sesion.id, "fallida", { error: String(e?.message || e) }); });
  return sesion;
}

async function lanzar(id: string, op: OpcionesSesion, modo: Modo, clave: string) {
  const fila = await obtenerSesion(id);
  if (fila?.estado !== "en_curso") { liberarTurno(clave); return; }   // la cancelaron en la cola
  await prepararLaboratorio();
  const cfg = rutasConfig();
  const presupuesto = op.presupuestoUsd ?? (Number(process.env.CLAUDE_CODE_PRESUPUESTO_USD) || 5);
  const args = ["-p", "--output-format", "stream-json", "--verbose",
    // Modo normal + hook: el "allow" del hook de Emilia autoriza cada acción; si el hook
    // no cargara, Claude Code niega lo no autorizado (falla cerrado). bypassPermissions
    // sería al revés (todo abierto) y además Claude Code lo rechaza si corre como root.
    "--permission-mode", "default",
    "--settings", comillas(cfg.settings), "--mcp-config", comillas(cfg.mcp),
    "--max-budget-usd", String(presupuesto)];
  if (modo === "lectura") args.push("--disallowedTools", "Write", "Edit", "MultiEdit", "NotebookEdit");   // doble candado
  if (op.maxTurnos) args.push("--max-turns", String(op.maxTurnos));
  if (op.continuarSesionClaude) args.push("--resume", op.continuarSesionClaude);
  const modelo = op.modelo || process.env.CLAUDE_CODE_MODELO;
  if (modelo) args.push("--model", modelo);

  let hijo: ChildProcess;
  try {
    // shell:true para que Windows resuelva claude.cmd; el prompt va por stdin.
    hijo = spawn(BIN, args, { cwd: op.cwd, shell: true, windowsHide: true, env: entornoClaude(id, { ...op, modo }) });
  } catch (e: any) {
    liberarTurno(clave);
    await finalizar(id, "fallida", { error: `No se pudo lanzar Claude Code: ${e?.message || e}` });
    return;
  }
  procesos.set(id, hijo);
  await query(`UPDATE sesiones_codigo SET pid=$1, inicio=now() WHERE id=$2`, [hijo.pid ?? null, id]);
  await logSesion(id, "inicio", `Claude Code (${modo}, tope $${presupuesto}${process.env.CLAUDE_CODE_USAR_API === "true" ? ", por API" : ", con tu plan"}) en ${op.cwd}`);

  const prompt = op.sistema ? `${op.sistema.trim()}\n\n────────────────\nENCARGO:\n${op.encargo}` : op.encargo;
  hijo.stdin?.write(prompt);
  hijo.stdin?.end();

  const limite = (op.timeoutSeg ?? 1800) * 1000;
  let porTiempo = false;
  const reloj = setTimeout(() => { porTiempo = true; matar(hijo.pid); }, limite);

  let resto = "", stderr = "", resultado: any = null;
  hijo.stdout?.on("data", (d) => {
    resto += d.toString();
    const lineas = resto.split("\n"); resto = lineas.pop() || "";
    for (const l of lineas) { const ev = parsear(l); if (ev) { procesarEvento(id, ev).catch(() => {}); if (ev.type === "result") resultado = ev; } }
  });
  hijo.stderr?.on("data", (d) => { stderr += d.toString(); if (stderr.length > 20000) stderr = stderr.slice(-20000); });
  hijo.on("close", async (codigo) => {
    clearTimeout(reloj);
    procesos.delete(id);
    liberarTurno(clave);
    avisos.delete(id);
    if (resto.trim()) { const ev = parsear(resto); if (ev) { await procesarEvento(id, ev); if (ev.type === "result") resultado = ev; } }
    const actual = await obtenerSesion(id);
    if (actual?.estado === "cancelada") return;
    if (porTiempo) { await finalizar(id, "fallida", { error: `Se pasó del tiempo máximo (${Math.round(limite / 60000)} min) y lo detuve.`, session: resultado?.session_id }); return; }
    if (resultado) {
      const txt = String(resultado.result ?? "");
      const authFall = (resultado.is_error || txt.length < 400) && /failed to authenticate|oauth (session|token)|not logged in|please run \/login|session expired|invalid api key|credit balance is too low/i.test(txt);
      const sinPresupuesto = /budget|presupuesto/i.test(String(resultado.subtype || "")) || /max.?budget/i.test(txt.slice(0, 300));
      const ok = !resultado.is_error && !/^error/.test(String(resultado.subtype || "")) && !authFall;
      const costo = Number(resultado.total_cost_usd || 0);
      // Con tu plan Max el costo es una estimación (no se cobra): queda en el log, no en el presupuesto.
      if (costo && process.env.CLAUDE_CODE_USAR_API === "true") { const { registrarConsumo } = await import("./presupuesto.js"); registrarConsumo({ agenteId: op.agenteId ?? null, proveedor: "claude_code", modelo: modelo || "claude", costoUsd: costo }).catch(() => {}); }
      await finalizar(id, ok ? "completada" : "fallida", {
        resultado: txt, session: resultado.session_id, costo, turnos: resultado.num_turns, duracion: resultado.duration_ms,
        error: ok ? undefined
          : authFall ? `Claude Code no pudo autenticarse (${txt.slice(0, 160)}). En el PC de Emilia abre una terminal, corre "claude", escribe /login y vuelve a intentar.`
          : sinPresupuesto ? `Llegó al tope de gasto de $${presupuesto} para esta tarea. Puedo seguir con un tope mayor si me dices.`
          : `Claude Code terminó con ${resultado.subtype || "error"}${resultado.is_error ? ": " + txt.slice(0, 300) : ""}`,
      });
    } else {
      await finalizar(id, "fallida", { error: `Claude Code salió con código ${codigo} sin resultado. ${stderr.trim().slice(-600) || "(sin stderr)"}` });
    }
  });
  hijo.on("error", async (e) => {
    clearTimeout(reloj);
    procesos.delete(id);
    liberarTurno(clave);
    await finalizar(id, "fallida", { error: `Error lanzando Claude Code: ${e.message}. ¿Está instalado y en el PATH? (CLAUDE_CODE_BIN=${BIN})` });
  });
}

/** Espera a que termine (o hasta timeoutSeg). Devuelve la fila actual. */
export async function esperarSesion(id: string, timeoutSeg = 900): Promise<SesionCodigo> {
  const limite = Date.now() + timeoutSeg * 1000;
  while (Date.now() < limite) {
    const s = await obtenerSesion(id);
    if (!s) throw new Error("Sesión no encontrada");
    if (s.estado !== "en_curso") return s;
    await new Promise((r) => setTimeout(r, 2500));
  }
  return (await obtenerSesion(id))!;
}

export async function cancelarSesion(id: string): Promise<boolean> {
  const s = await obtenerSesion(id);
  if (!s || s.estado !== "en_curso") return false;
  const p = procesos.get(id);
  await finalizar(id, "cancelada", { error: "Cancelada por el usuario." });
  matar(p?.pid ?? s.pid ?? undefined);
  procesos.delete(id);
  return true;
}

export function sesionesActivas(): string[] { return [...procesos.keys()]; }

/** Al arrancar: las sesiones 'en_curso' de un proceso anterior ya no existen. */
export async function recuperarSesionesHuerfanas(): Promise<void> {
  const filas = await query<{ id: string }>(`SELECT id FROM sesiones_codigo WHERE estado='en_curso'`);
  for (const f of filas) await finalizar(f.id, "fallida", { error: "El servidor se reinició mientras corría; la sesión se perdió. Se puede continuar con su session_id." });
  if (filas.length) console.log(`[claude-code] ${filas.length} sesión(es) huérfana(s) marcadas como fallidas.`);
}

// ─── internos ───────────────────────────────────────────────────────────────
function parsear(linea: string): any | null {
  const l = linea.trim(); if (!l.startsWith("{")) return null;
  try { return JSON.parse(l); } catch { return null; }
}

/** "Sigo trabajando" al jefe: como mucho uno cada 5 minutos, y solo en tareas largas. */
const avisos = new Map<string, { ultimo: number; acciones: number }>();
async function avisoPeriodico(id: string, texto: string) {
  const a = avisos.get(id) || { ultimo: Date.now(), acciones: 0 };
  a.acciones++; avisos.set(id, a);
  if (Date.now() - a.ultimo < 5 * 60_000) return;
  a.ultimo = Date.now();
  const [s] = await query<{ conversacion_id: string | null }>(`SELECT conversacion_id FROM sesiones_codigo WHERE id=$1`, [id]).catch(() => [] as any);
  if (!s?.conversacion_id) return;
  const { avisarProgreso } = await import("./actividad.js");
  await avisarProgreso(s.conversacion_id, `⌛ Sigo trabajando (${a.acciones} acciones). Ahora: ${texto.slice(0, 120)}`);
}

async function procesarEvento(id: string, ev: any) {
  if (ev.type === "system" && ev.subtype === "init") {
    const mcp = (ev.mcp_servers || []).map((m: any) => `${m.name}:${m.status}`).join(", ");
    await logSesion(id, "sistema", `sesión ${ev.session_id} · modelo ${ev.model || "?"} · ${(ev.tools || []).length} herramientas${mcp ? ` · MCP ${mcp}` : ""}`);
    if (ev.session_id) await query(`UPDATE sesiones_codigo SET session_id_claude=$1 WHERE id=$2`, [ev.session_id, id]);
    return;
  }
  if (ev.type === "assistant") {
    for (const b of ev.message?.content || []) {
      if (b.type === "text" && b.text?.trim()) await logSesion(id, "claude", b.text.trim());
      else if (b.type === "tool_use") { const t = `${b.name} ${resumirInput(b.name, b.input)}`; await logSesion(id, "tool", t); avisoPeriodico(id, t).catch(() => {}); }
    }
    return;
  }
  if (ev.type === "user") {
    for (const b of ev.message?.content || []) {
      if (b.type === "tool_result" && b.is_error) {
        const c = typeof b.content === "string" ? b.content : (b.content || []).map((x: any) => x.text || "").join(" ");
        await logSesion(id, "error", String(c).slice(0, 400));
      }
    }
    return;
  }
  if (ev.type === "result") await logSesion(id, "resultado", `${ev.subtype} · ${ev.num_turns ?? "?"} turnos · ~$${Number(ev.total_cost_usd || 0).toFixed(4)} · ${Math.round((ev.duration_ms || 0) / 1000)}s`);
}

function resumirInput(_nombre: string, input: any): string {
  if (!input) return "";
  const i = input;
  if (i.command) return `$ ${String(i.command).slice(0, 160)}`;
  if (i.file_path) return `${i.file_path}${i.old_string ? " (edit)" : i.content ? " (write)" : ""}`;
  if (i.pattern) return `"${i.pattern}"${i.path ? " en " + i.path : ""}`;
  if (i.description) return String(i.description).slice(0, 120);
  return JSON.stringify(i).slice(0, 120);
}

async function finalizar(id: string, estado: "completada" | "fallida" | "cancelada", d: { resultado?: string; session?: string; costo?: number; turnos?: number; duracion?: number; error?: string }) {
  await query(
    `UPDATE sesiones_codigo SET estado=$1, resultado=COALESCE($2, resultado), session_id_claude=COALESCE($3, session_id_claude), costo_usd=$4, turnos=$5, duracion_ms=$6, error=$7, fin=now(), pid=NULL WHERE id=$8 AND estado IN ('en_curso', $1)`,
    [estado, d.resultado ?? null, d.session ?? null, d.costo ?? null, d.turnos ?? null, d.duracion ?? null, d.error ?? null, id]);
}
