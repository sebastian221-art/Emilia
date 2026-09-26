// ARCHIVO: src/motor/runtime.ts
// ─────────────────────────────────────────────────────────────────────────────
//  RUNTIME DE PROYECTOS
//  Arranca, detiene y observa el proceso de cada proyecto (su cmd_start), en el
//  repo real o en un sandbox. El proceso corre DESACOPLADO de Emilia con sus
//  logs a archivo, así sobrevive a reinicios de Emilia y ella los re-adopta
//  al arrancar (verifica el pid). Logs: DATA_DIR/logs/<proyecto>.log.
// ─────────────────────────────────────────────────────────────────────────────

import { spawn } from "node:child_process";
import { promises as fs, openSync, closeSync } from "node:fs";
import path from "node:path";
import { query } from "../db/cliente.js";
import { obtenerProyecto, obtenerSandbox, type Proyecto } from "../dominio/proyectos.js";
import { matar } from "./sandbox.js";

const DIR_LOGS = path.resolve(process.env.DATA_DIR || "data", "logs");
const MAX_LOG_BYTES = 5 * 1024 * 1024;

export interface Proceso {
  proyecto_id: string; pid: number | null; estado: "corriendo" | "detenido" | "caido"; ruta_trabajo: string | null;
  comando: string | null; ruta_log: string | null; inicio: string | null; fin: string | null; codigo_salida: number | null; reinicios: number;
}

async function fila(proyectoId: string): Promise<Proceso | undefined> {
  const [f] = await query<Proceso>(`SELECT * FROM procesos WHERE proyecto_id=$1`, [proyectoId]);
  return f;
}

/** ¿Hay algo escuchando en el puerto? (conexión TCP local) */
export async function puertoEnUso(puerto: number): Promise<boolean> {
  const net = await import("node:net");
  return new Promise((resolve) => {
    const s = net.createConnection({ host: "127.0.0.1", port: puerto });
    const fin = (v: boolean) => { try { s.destroy(); } catch {} resolve(v); };
    s.once("connect", () => fin(true));
    s.once("error", () => fin(false));
    setTimeout(() => fin(false), 1500);
  });
}

/** Pids que escuchan en el puerto (Windows: netstat; Unix: lsof). */
export async function pidsEnPuerto(puerto: number): Promise<number[]> {
  const { ejecutarComando } = await import("./sandbox.js");
  if (process.platform === "win32") {
    const r = await ejecutarComando(process.cwd(), `netstat -ano -p tcp | findstr /R /C:":${puerto} .*LISTENING"`, 15);
    return [...new Set(r.stdout.split("\n").map((l) => Number(l.trim().split(/\s+/).pop())).filter((n) => n > 0))];
  }
  const r = await ejecutarComando(process.cwd(), `lsof -t -iTCP:${puerto} -sTCP:LISTEN`, 15);
  return [...new Set(r.stdout.split("\n").map((l) => Number(l.trim())).filter((n) => n > 0))];
}

/** Libera el puerto matando lo que escuche ahí. Devuelve los pids matados. */
export async function liberarPuerto(puerto: number): Promise<number[]> {
  const pids = await pidsEnPuerto(puerto);
  for (const pid of pids) matar(pid);
  if (pids.length) await new Promise((r) => setTimeout(r, 1500));
  return pids;
}

function pidVivo(pid: number | null | undefined): boolean {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (e: any) { return e?.code === "EPERM"; }
}

/** Refresca el estado con la realidad del SO (el proceso pudo morir solo). */
export async function estadoProceso(proyecto: Proyecto): Promise<Proceso> {
  let f = await fila(proyecto.id);
  if (!f) {
    await query(`INSERT INTO procesos (proyecto_id, estado) VALUES ($1,'detenido') ON CONFLICT DO NOTHING`, [proyecto.id]);
    f = (await fila(proyecto.id))!;
  }
  if (f.estado === "corriendo" && !pidVivo(f.pid)) {
    await query(`UPDATE procesos SET estado='caido', fin=now(), actualizado_en=now() WHERE proyecto_id=$1`, [proyecto.id]);
    f = (await fila(proyecto.id))!;
  }
  return f;
}

export async function iniciarProceso(proyecto: Proyecto, op: { sandboxId?: string; comando?: string } = {}): Promise<{ ok: boolean; pid?: number; error?: string; ruta_log?: string; zombis?: number[] }> {
  const actual = await estadoProceso(proyecto);
  if (actual.estado === "corriendo") return { ok: false, error: `${proyecto.nombre} ya está corriendo (pid ${actual.pid}). Usá reiniciar si querés relanzarlo.` };
  const comando = op.comando || proyecto.cmd_start;
  if (!comando) return { ok: false, error: `El proyecto ${proyecto.nombre} no tiene cmd_start configurado (ej. "npm run dev"). Registralo con codigo_registrar_proyecto.` };

  // Puerto ocupado por un proceso viejo (zombi de un arranque anterior) → liberarlo y avisar.
  let zombis: number[] = [];
  if (proyecto.puerto && (await puertoEnUso(proyecto.puerto))) {
    zombis = await liberarPuerto(proyecto.puerto);
    if (await puertoEnUso(proyecto.puerto)) return { ok: false, error: `El puerto ${proyecto.puerto} sigue ocupado (pids ${zombis.join(", ") || "desconocidos"}) y no pude liberarlo. Otro programa lo usa.` };
  }

  let cwd = proyecto.ruta;
  if (op.sandboxId) {
    const sb = await obtenerSandbox(op.sandboxId);
    if (!sb || sb.estado !== "abierto") return { ok: false, error: "Sandbox no encontrado o cerrado." };
    cwd = sb.ruta;
  }
  await fs.mkdir(DIR_LOGS, { recursive: true });
  const rutaLog = path.join(DIR_LOGS, `${proyecto.nombre}.log`);
  await rotarSiHaceFalta(rutaLog);

  const env: Record<string, string> = { ...process.env as any, ...(proyecto.env_extra || {}), FORCE_COLOR: "0" };
  if (proyecto.puerto) env.PORT = String(proyecto.puerto);

  let fd: number;
  try { fd = openSync(rutaLog, "a"); } catch (e: any) { return { ok: false, error: `No pude abrir el log: ${e.message}` }; }
  const marca = `\n===== ${new Date().toISOString()} · inicio: ${comando} (cwd ${cwd}) =====\n`;
  await fs.appendFile(rutaLog, marca);

  const hijo = spawn(comando, { cwd, shell: true, env, detached: true, stdio: ["ignore", fd, fd], windowsHide: true });
  hijo.unref();
  closeSync(fd);
  const pid = hijo.pid ?? null;
  hijo.on("exit", async (codigo) => {
    // Solo se entera si Emilia sigue viva; si no, estadoProceso() lo detecta después por el pid.
    const [antes] = await query<{ estado: string }>(`SELECT estado FROM procesos WHERE proyecto_id=$1`, [proyecto.id]).catch(() => [] as any);
    await query(`UPDATE procesos SET estado='caido', fin=now(), codigo_salida=$1, actualizado_en=now() WHERE proyecto_id=$2 AND pid=$3`, [codigo, proyecto.id, pid]).catch(() => {});
    await fs.appendFile(rutaLog, `\n===== ${new Date().toISOString()} · salió con código ${codigo} =====\n`).catch(() => {});
    if (antes?.estado === "corriendo") {   // no fue un detener nuestro: se cayó solo
      const { emitir } = await import("./eventos.js");
      emitir("proyecto.caido", { proyecto: proyecto.nombre, codigo_salida: codigo, pid }).catch(() => {});
    }
  });
  await query(
    `INSERT INTO procesos (proyecto_id, pid, estado, ruta_trabajo, comando, ruta_log, inicio, fin, codigo_salida, actualizado_en)
     VALUES ($1,$2,'corriendo',$3,$4,$5,now(),NULL,NULL,now())
     ON CONFLICT (proyecto_id) DO UPDATE SET pid=EXCLUDED.pid, estado='corriendo', ruta_trabajo=EXCLUDED.ruta_trabajo, comando=EXCLUDED.comando,
       ruta_log=EXCLUDED.ruta_log, inicio=now(), fin=NULL, codigo_salida=NULL, reinicios=procesos.reinicios+1, actualizado_en=now()`,
    [proyecto.id, pid, cwd, comando, rutaLog]);
  return { ok: true, pid: pid ?? undefined, ruta_log: rutaLog, ...(zombis.length ? { zombis } : {}) };
}

export async function detenerProceso(proyecto: Proyecto): Promise<{ ok: boolean; error?: string }> {
  const f = await estadoProceso(proyecto);
  if (f.estado !== "corriendo" || !f.pid) return { ok: false, error: `${proyecto.nombre} no está corriendo.` };
  matar(f.pid);
  await new Promise((r) => setTimeout(r, 1500));
  // Verificar que el puerto quedó libre; si el hijo de node sobrevivió al cmd/npm, matarlo por puerto.
  if (proyecto.puerto && (await puertoEnUso(proyecto.puerto))) {
    const extra = await liberarPuerto(proyecto.puerto);
    if (extra.length && f.ruta_log) await fs.appendFile(f.ruta_log, `\n===== ${new Date().toISOString()} · procesos huérfanos en :${proyecto.puerto} matados: ${extra.join(", ")} =====\n`).catch(() => {});
    if (await puertoEnUso(proyecto.puerto)) return { ok: false, error: `Maté el pid ${f.pid} pero el puerto ${proyecto.puerto} sigue ocupado. Revisá con netstat -ano | findstr :${proyecto.puerto}.` };
  }
  await query(`UPDATE procesos SET estado='detenido', fin=now(), actualizado_en=now() WHERE proyecto_id=$1`, [proyecto.id]);
  if (f.ruta_log) await fs.appendFile(f.ruta_log, `\n===== ${new Date().toISOString()} · detenido por Emilia =====\n`).catch(() => {});
  return { ok: true };
}

export async function reiniciarProceso(proyecto: Proyecto, op: { sandboxId?: string } = {}) {
  const f = await estadoProceso(proyecto);
  if (f.estado === "corriendo") await detenerProceso(proyecto);
  return iniciarProceso(proyecto, op);
}

export async function leerLogs(proyecto: Proyecto, op: { ultimas?: number; filtro?: string; soloErrores?: boolean } = {}): Promise<string[]> {
  const rutaLog = path.join(DIR_LOGS, `${proyecto.nombre}.log`);
  let texto = "";
  try { texto = await fs.readFile(rutaLog, "utf-8"); } catch { return []; }
  let lineas = texto.split("\n").filter(Boolean);
  if (op.soloErrores) lineas = lineas.filter((l) => /error|exception|unhandled|fatal|econn|etimedout|traceback|✘/i.test(l));
  if (op.filtro) { const f = op.filtro.toLowerCase(); lineas = lineas.filter((l) => l.toLowerCase().includes(f)); }
  return lineas.slice(-(op.ultimas || 80)).map((l) => l.slice(0, 500));
}

export async function saludProceso(proyecto: Proyecto): Promise<{ ok: boolean; status?: number; latencia_ms?: number; error?: string; url?: string }> {
  const url = proyecto.url_salud || (proyecto.puerto ? `http://localhost:${proyecto.puerto}/` : null);
  if (!url) return { ok: false, error: "Sin url_salud ni puerto configurados." };
  const t0 = Date.now();
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    return { ok: r.ok, status: r.status, latencia_ms: Date.now() - t0, url, error: r.ok ? undefined : `HTTP ${r.status}` };
  } catch (e: any) { return { ok: false, latencia_ms: Date.now() - t0, url, error: e?.cause?.code || e?.message || String(e) }; }
}

/** Al arrancar Emilia: re-adopta los procesos vivos, marca caídos los muertos, y lanza los de autoarranque. */
export async function retomarProcesos(): Promise<void> {
  const filas = await query<any>(`SELECT p.*, pr.nombre FROM procesos p JOIN proyectos pr ON pr.id=p.proyecto_id`);
  for (const f of filas) {
    if (f.estado === "corriendo" && !pidVivo(f.pid)) await query(`UPDATE procesos SET estado='caido', fin=now(), actualizado_en=now() WHERE proyecto_id=$1`, [f.proyecto_id]);
  }
  const auto = await query<Proyecto>(`SELECT * FROM proyectos WHERE autoarranque = true AND cmd_start IS NOT NULL`);
  for (const p of auto) {
    const e = await estadoProceso(p);
    if (e.estado !== "corriendo") { const r = await iniciarProceso(p); console.log(`[runtime] autoarranque ${p.nombre}: ${r.ok ? "pid " + r.pid : r.error}`); }
  }
  const vivos = filas.filter((f) => f.estado === "corriendo" && pidVivo(f.pid)).map((f) => f.nombre);
  if (vivos.length) console.log(`[runtime] Procesos re-adoptados: ${vivos.join(", ")}`);
}

async function rotarSiHaceFalta(ruta: string) {
  try {
    const st = await fs.stat(ruta);
    if (st.size > MAX_LOG_BYTES) await fs.rename(ruta, ruta.replace(/\.log$/, `.${Date.now()}.log`));
  } catch { /* no existe */ }
}

export { obtenerProyecto };