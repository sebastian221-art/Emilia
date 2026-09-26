// ARCHIVO: src/motor/claude-code.ts
// ─────────────────────────────────────────────────────────────────────────────
//  CLAUDE CODE — corredor headless observable
//  Lanza `claude -p` en el sandbox con salida stream-json, guarda cada evento
//  en sesiones_codigo.log (visible en vivo), captura el resultado final
//  (texto, session_id para continuar, costo, turnos) y permite cancelar.
//  Las sesiones sobreviven al orquestador: si el servidor se reinicia, las que
//  quedaron 'en_curso' sin proceso se marcan fallidas con motivo claro.
//  .env: CLAUDE_CODE_BIN (por defecto "claude"), CLAUDE_CODE_MODELO (opcional)
// ─────────────────────────────────────────────────────────────────────────────

import { spawn, type ChildProcess } from "node:child_process";
import { query } from "../db/cliente.js";
import { crearSesionFila, obtenerSesion, logSesion, type SesionCodigo } from "../dominio/proyectos.js";
import { matar } from "./sandbox.js";

const BIN = process.env.CLAUDE_CODE_BIN || "claude";
const procesos = new Map<string, ChildProcess>();

export interface OpcionesSesion {
  sandboxId: string;
  proyectoId: string;
  cwd: string;
  encargo: string;                 // prompt principal
  sistema?: string;                // contexto/reglas que van antes del encargo
  maxTurnos?: number;              // --max-turns
  continuarSesionClaude?: string;  // --resume <session_id>
  modelo?: string;
  agenteId?: string | null;
  conversacionId?: string | null;
}

/** Inicia una sesión y devuelve enseguida (corre en segundo plano). */
export async function iniciarSesionClaude(op: OpcionesSesion): Promise<SesionCodigo> {
  const sesion = await crearSesionFila({ sandboxId: op.sandboxId, proyectoId: op.proyectoId, encargo: op.encargo, agenteId: op.agenteId, conversacionId: op.conversacionId });

  const args = ["-p", "--output-format", "stream-json", "--verbose", "--dangerously-skip-permissions"];
  if (op.maxTurnos) args.push("--max-turns", String(op.maxTurnos));
  if (op.continuarSesionClaude) args.push("--resume", op.continuarSesionClaude);
  const modelo = op.modelo || process.env.CLAUDE_CODE_MODELO;
  if (modelo) args.push("--model", modelo);

  let hijo: ChildProcess;
  try {
    // shell:true para que Windows resuelva claude.cmd; el prompt va por stdin
    // (sin límites de longitud ni problemas de comillas).
    hijo = spawn(BIN, args, { cwd: op.cwd, shell: true, windowsHide: true, env: { ...process.env, FORCE_COLOR: "0" } });
  } catch (e: any) {
    await finalizar(sesion.id, "fallida", { error: `No se pudo lanzar Claude Code: ${e?.message || e}` });
    return (await obtenerSesion(sesion.id))!;
  }
  procesos.set(sesion.id, hijo);
  await query(`UPDATE sesiones_codigo SET pid=$1 WHERE id=$2`, [hijo.pid ?? null, sesion.id]);
  await logSesion(sesion.id, "inicio", `claude ${args.join(" ")} (cwd: ${op.cwd})`);

  // El "sistema" del encargo va dentro del prompt (por stdin), no como flag:
  // con shell:true los flags con espacios/comillas se rompen en Windows.
  const prompt = op.sistema ? `${op.sistema.trim()}\n\n────────────────\nENCARGO:\n${op.encargo}` : op.encargo;
  hijo.stdin?.write(prompt);
  hijo.stdin?.end();

  let resto = "", stderr = "", resultado: any = null;
  hijo.stdout?.on("data", (d) => {
    resto += d.toString();
    const lineas = resto.split("\n"); resto = lineas.pop() || "";
    for (const l of lineas) { const ev = parsear(l); if (ev) { procesarEvento(sesion.id, ev).catch(() => {}); if (ev.type === "result") resultado = ev; } }
  });
  hijo.stderr?.on("data", (d) => { stderr += d.toString(); if (stderr.length > 20000) stderr = stderr.slice(-20000); });
  hijo.on("close", async (codigo) => {
    procesos.delete(sesion.id);
    if (resto.trim()) { const ev = parsear(resto); if (ev) { await procesarEvento(sesion.id, ev); if (ev.type === "result") resultado = ev; } }
    const fila = await obtenerSesion(sesion.id);
    if (fila?.estado === "cancelada") return;
    if (resultado) {
      const txt = String(resultado.result ?? "");
      // Fallo de autenticación real: Claude lo devuelve como error corto, no dentro de un informe.
      const authFall = (resultado.is_error || txt.length < 400) && /failed to authenticate|oauth (session|token)|not logged in|please run \/login|session expired|invalid api key|credit balance is too low/i.test(txt);
      const ok = !resultado.is_error && resultado.subtype !== "error_max_turns" && resultado.subtype !== "error_during_execution" && !authFall;
      await finalizar(sesion.id, ok ? "completada" : "fallida", {
        resultado: txt, session: resultado.session_id, costo: resultado.total_cost_usd, turnos: resultado.num_turns, duracion: resultado.duration_ms,
        error: ok ? undefined : authFall ? `Claude Code no pudo autenticarse (${txt.slice(0, 160)}). En la máquina donde corre Emilia, abrí una terminal, corré "claude", escribí /login, completá el navegador y volvé a intentar.` : `Claude Code terminó con ${resultado.subtype || "error"}${resultado.is_error ? ": " + txt.slice(0, 300) : ""}`,
      });
    } else {
      await finalizar(sesion.id, "fallida", { error: `Claude Code salió con código ${codigo} sin resultado. ${stderr.trim().slice(-600) || "(sin stderr)"}` });
    }
  });
  hijo.on("error", async (e) => {
    procesos.delete(sesion.id);
    await finalizar(sesion.id, "fallida", { error: `Error lanzando Claude Code: ${e.message}. ¿Está instalado y en el PATH? (CLAUDE_CODE_BIN=${BIN})` });
  });

  return sesion;
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
  matar(p?.pid ?? s.pid ?? undefined);
  procesos.delete(id);
  await finalizar(id, "cancelada", { error: "Cancelada por el usuario." });
  return true;
}

export function sesionesActivas(): string[] { return [...procesos.keys()]; }

/** Al arrancar: las sesiones 'en_curso' de un proceso anterior ya no existen. */
export async function recuperarSesionesHuerfanas(): Promise<void> {
  const filas = await query<{ id: string }>(`SELECT id FROM sesiones_codigo WHERE estado='en_curso'`);
  for (const f of filas) await finalizar(f.id, "fallida", { error: "El servidor se reinició mientras corría; la sesión se perdió. Podés continuarla con su session_id si lo dejó." });
  if (filas.length) console.log(`[claude-code] ${filas.length} sesión(es) huérfana(s) marcadas como fallidas.`);
}

// ─── internos ───────────────────────────────────────────────────────────────
function parsear(linea: string): any | null {
  const l = linea.trim(); if (!l.startsWith("{")) return null;
  try { return JSON.parse(l); } catch { return null; }
}

const contadorAvisos = new Map<string, number>();
async function avisoPeriodico(id: string, texto: string) {
  const n = (contadorAvisos.get(id) || 0) + 1; contadorAvisos.set(id, n);
  if (n % 12 !== 0) return;
  const [s] = await query<{ conversacion_id: string | null; turnos: number | null }>(`SELECT conversacion_id FROM sesiones_codigo WHERE id=$1`, [id]).catch(() => [] as any);
  if (!s?.conversacion_id) return;
  const { avisarProgreso } = await import("./actividad.js");
  await avisarProgreso(s.conversacion_id, `⌛ Claude sigue: ${texto.slice(0, 140)}`);
}

async function procesarEvento(id: string, ev: any) {
  if (ev.type === "system" && ev.subtype === "init") { await logSesion(id, "sistema", `sesión ${ev.session_id} · modelo ${ev.model || "?"} · tools ${(ev.tools || []).length}`); if (ev.session_id) await query(`UPDATE sesiones_codigo SET session_id_claude=$1 WHERE id=$2`, [ev.session_id, id]); return; }
  if (ev.type === "assistant") {
    for (const b of ev.message?.content || []) {
      if (b.type === "text" && b.text?.trim()) await logSesion(id, "claude", b.text.trim());
      else if (b.type === "tool_use") { const t = `${b.name} ${resumirInput(b.name, b.input)}`; await logSesion(id, "tool", t); avisoPeriodico(id, t).catch(() => {}); }
    }
    return;
  }
  if (ev.type === "user") {
    for (const b of ev.message?.content || []) {
      if (b.type === "tool_result") {
        const c = typeof b.content === "string" ? b.content : (b.content || []).map((x: any) => x.text || "").join(" ");
        if (b.is_error) await logSesion(id, "error", String(c).slice(0, 400));
      }
    }
    return;
  }
  if (ev.type === "result") await logSesion(id, "resultado", `${ev.subtype} · ${ev.num_turns} turnos · $${Number(ev.total_cost_usd || 0).toFixed(4)} · ${Math.round((ev.duration_ms || 0) / 1000)}s`);
}

function resumirInput(nombre: string, input: any): string {
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
    `UPDATE sesiones_codigo SET estado=$1, resultado=COALESCE($2, resultado), session_id_claude=COALESCE($3, session_id_claude), costo_usd=$4, turnos=$5, duracion_ms=$6, error=$7, fin=now(), pid=NULL WHERE id=$8`,
    [estado, d.resultado ?? null, d.session ?? null, d.costo ?? null, d.turnos ?? null, d.duracion ?? null, d.error ?? null, id]);
}