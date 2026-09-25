// ARCHIVO: src/dominio/proyectos.ts
import { promises as fs } from "node:fs";
import path from "node:path";
import { query } from "../db/cliente.js";

export interface Proyecto {
  id: string; nombre: string; ruta: string; rama_base: string;
  cmd_install: string | null; cmd_test: string | null; cmd_build: string | null; cmd_lint: string | null;
  notas: string; creado_en: string;
}
export interface Sandbox { id: string; proyecto_id: string; ruta: string; rama: string; estado: string; proposito: string; creado_en: string }
export interface SesionCodigo {
  id: string; sandbox_id: string; proyecto_id: string; encargo: string; estado: string; session_id_claude: string | null;
  pid: number | null; log: { t: string; tipo: string; texto: string }[]; resultado: string | null; error: string | null;
  costo_usd: number | null; turnos: number | null; duracion_ms: number | null; inicio: string; fin: string | null;
}

const RE_SLUG = /^[a-z][a-z0-9_]{1,40}$/;

export async function listarProyectos(): Promise<Proyecto[]> {
  return query<Proyecto>(`SELECT * FROM proyectos ORDER BY nombre`);
}
export async function obtenerProyecto(nombreOId: string): Promise<Proyecto | undefined> {
  const [p] = await query<Proyecto>(`SELECT * FROM proyectos WHERE nombre=$1 OR id::text=$1 LIMIT 1`, [nombreOId]);
  return p;
}
export async function registrarProyecto(p: Partial<Proyecto> & { nombre: string; ruta: string }): Promise<Proyecto> {
  if (!RE_SLUG.test(p.nombre)) throw new Error("El nombre del proyecto debe ser snake_case en minúsculas (ej. jelcom_envios).");
  const ruta = path.resolve(p.ruta);
  try { await fs.access(path.join(ruta, ".git")); } catch { throw new Error(`"${ruta}" no existe o no es un repositorio git (falta .git).`); }
  const [f] = await query<Proyecto>(
    `INSERT INTO proyectos (nombre, ruta, rama_base, cmd_install, cmd_test, cmd_build, cmd_lint, notas)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (nombre) DO UPDATE SET ruta=EXCLUDED.ruta, rama_base=EXCLUDED.rama_base, cmd_install=EXCLUDED.cmd_install,
       cmd_test=EXCLUDED.cmd_test, cmd_build=EXCLUDED.cmd_build, cmd_lint=EXCLUDED.cmd_lint, notas=EXCLUDED.notas, actualizado_en=now()
     RETURNING *`,
    [p.nombre, ruta, p.rama_base || "main", p.cmd_install || null, p.cmd_test || null, p.cmd_build || null, p.cmd_lint || null, p.notas || ""]);
  return f;
}
export async function borrarProyecto(nombreOId: string): Promise<void> {
  await query(`DELETE FROM proyectos WHERE nombre=$1 OR id::text=$1`, [nombreOId]);
}

// ── Sandboxes ──
export async function crearSandboxFila(proyectoId: string, ruta: string, rama: string, proposito: string): Promise<Sandbox> {
  const [s] = await query<Sandbox>(`INSERT INTO sandboxes (proyecto_id, ruta, rama, proposito) VALUES ($1,$2,$3,$4) RETURNING *`, [proyectoId, ruta, rama, proposito]);
  return s;
}
export async function obtenerSandbox(id: string): Promise<(Sandbox & { proyecto: Proyecto }) | undefined> {
  const [s] = await query<any>(`SELECT s.*, row_to_json(p.*) AS proyecto FROM sandboxes s JOIN proyectos p ON p.id=s.proyecto_id WHERE s.id::text=$1`, [id]);
  return s;
}
export async function sandboxesAbiertos(proyectoId?: string): Promise<(Sandbox & { proyecto_nombre: string })[]> {
  return query(`SELECT s.*, p.nombre AS proyecto_nombre FROM sandboxes s JOIN proyectos p ON p.id=s.proyecto_id WHERE s.estado='abierto' ${proyectoId ? "AND s.proyecto_id=$1" : ""} ORDER BY s.creado_en DESC`, proyectoId ? [proyectoId] : []);
}
export async function cerrarSandboxFila(id: string): Promise<void> {
  await query(`UPDATE sandboxes SET estado='cerrado', cerrado_en=now() WHERE id=$1`, [id]);
}

// ── Sesiones ──
export async function crearSesionFila(p: { sandboxId: string; proyectoId: string; encargo: string; agenteId?: string | null; conversacionId?: string | null }): Promise<SesionCodigo> {
  const [s] = await query<SesionCodigo>(
    `INSERT INTO sesiones_codigo (sandbox_id, proyecto_id, encargo, agente_id, conversacion_id) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [p.sandboxId, p.proyectoId, p.encargo, p.agenteId ?? null, p.conversacionId ?? null]);
  return s;
}
export async function obtenerSesion(id: string): Promise<SesionCodigo | undefined> {
  const [s] = await query<SesionCodigo>(`SELECT * FROM sesiones_codigo WHERE id::text=$1`, [id]);
  return s;
}
export async function sesionesDeSandbox(sandboxId: string, limite = 20): Promise<SesionCodigo[]> {
  return query<SesionCodigo>(`SELECT id, estado, encargo, session_id_claude, resultado, error, costo_usd, turnos, duracion_ms, inicio, fin FROM sesiones_codigo WHERE sandbox_id=$1 ORDER BY inicio DESC LIMIT $2`, [sandboxId, limite]);
}
export async function sesionesRecientes(limite = 30): Promise<any[]> {
  return query(`SELECT s.id, s.estado, s.encargo, s.costo_usd, s.turnos, s.inicio, s.fin, sb.rama, p.nombre AS proyecto
                FROM sesiones_codigo s JOIN sandboxes sb ON sb.id=s.sandbox_id JOIN proyectos p ON p.id=s.proyecto_id ORDER BY s.inicio DESC LIMIT $1`, [limite]);
}
export async function logSesion(id: string, tipo: string, texto: string): Promise<void> {
  await query(`UPDATE sesiones_codigo SET log = log || $1::jsonb WHERE id=$2`, [JSON.stringify([{ t: new Date().toISOString(), tipo, texto: texto.slice(0, 1500) }]), id]);
}