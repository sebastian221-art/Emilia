// ARCHIVO: src/dominio/empresa.ts
import { query } from "../db/cliente.js";

export interface Puesto {
  id: string; nombre: string; titulo: string; descripcion: string; agente_id: string | null; reporta_a: string | null;
  proyecto_id: string | null; campana_jelcom_id: number | null; responsabilidades: string;
  flujos: { flujo: string; args: Record<string, unknown>; ejecucion_id: string; estado?: string }[]; estado: string; creado_en: string;
}

export async function listarPuestos(): Promise<(Puesto & { agente: string | null; reporta_a_nombre: string | null; proyecto: string | null })[]> {
  return query(`SELECT p.*, a.nombre AS agente, r.nombre AS reporta_a_nombre, pr.nombre AS proyecto
                FROM puestos p LEFT JOIN agentes a ON a.id=p.agente_id LEFT JOIN agentes r ON r.id=p.reporta_a LEFT JOIN proyectos pr ON pr.id=p.proyecto_id
                ORDER BY p.creado_en`);
}
export async function obtenerPuesto(nombreOId: string): Promise<(Puesto & { agente: string | null; proyecto: string | null }) | undefined> {
  const [p] = await query(`SELECT p.*, a.nombre AS agente, pr.nombre AS proyecto FROM puestos p LEFT JOIN agentes a ON a.id=p.agente_id LEFT JOIN proyectos pr ON pr.id=p.proyecto_id WHERE p.nombre=$1 OR p.id::text=$1 LIMIT 1`, [nombreOId]);
  return p;
}
export async function crearPuesto(p: Partial<Puesto> & { nombre: string; titulo: string }): Promise<Puesto> {
  if (!/^[a-z][a-z0-9_]{1,40}$/.test(p.nombre)) throw new Error("El nombre del puesto debe ser snake_case (ej. cajasan).");
  const [f] = await query<Puesto>(
    `INSERT INTO puestos (nombre, titulo, descripcion, agente_id, reporta_a, proyecto_id, campana_jelcom_id, responsabilidades)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (nombre) DO UPDATE SET titulo=EXCLUDED.titulo, descripcion=EXCLUDED.descripcion, agente_id=COALESCE(EXCLUDED.agente_id, puestos.agente_id),
       reporta_a=COALESCE(EXCLUDED.reporta_a, puestos.reporta_a), proyecto_id=COALESCE(EXCLUDED.proyecto_id, puestos.proyecto_id),
       campana_jelcom_id=COALESCE(EXCLUDED.campana_jelcom_id, puestos.campana_jelcom_id),
       responsabilidades=CASE WHEN EXCLUDED.responsabilidades='' THEN puestos.responsabilidades ELSE EXCLUDED.responsabilidades END, actualizado_en=now()
     RETURNING *`,
    [p.nombre, p.titulo, p.descripcion || "", p.agente_id ?? null, p.reporta_a ?? null, p.proyecto_id ?? null, p.campana_jelcom_id ?? null, p.responsabilidades || ""]);
  return f;
}
export async function actualizarPuesto(id: string, cambios: Partial<Puesto>): Promise<void> {
  const campos = Object.entries(cambios).filter(([k]) => ["titulo", "descripcion", "agente_id", "reporta_a", "proyecto_id", "campana_jelcom_id", "responsabilidades", "flujos", "estado"].includes(k));
  if (!campos.length) return;
  const sets = campos.map(([k], i) => `${k}=$${i + 2}`).join(", ");
  await query(`UPDATE puestos SET ${sets}, actualizado_en=now() WHERE id=$1`, [id, ...campos.map(([k, v]) => (k === "flujos" ? JSON.stringify(v) : v))]);
}
export async function borrarPuesto(id: string): Promise<void> { await query(`DELETE FROM puestos WHERE id=$1`, [id]); }

export async function administradora(): Promise<any | undefined> {
  const [a] = await query(`SELECT * FROM agentes WHERE es_administrador = true AND estado='activo' ORDER BY creado_en LIMIT 1`);
  if (a) return a;
  const [e] = await query(`SELECT * FROM agentes WHERE lower(nombre)='emilia' LIMIT 1`);
  return e;
}