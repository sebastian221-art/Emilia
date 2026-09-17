import { query } from "../db/cliente.js";

export async function crearFlujo(datos: any): Promise<{ id: string }> {
  const nombre = datos.nombre?.trim();
  if (!nombre) throw new Error("El flujo necesita un nombre.");
  const definicion = { nodos: datos.nodos || [], conexiones: datos.conexiones || [] };
  const [f] = await query<{ id: string }>(
    `INSERT INTO flujos (nombre, definicion) VALUES ($1,$2) RETURNING id`,
    [nombre, JSON.stringify(definicion)]
  );
  return { id: f.id };
}
export async function listarFlujos() { return query(`SELECT id, nombre, creado_en FROM flujos ORDER BY creado_en DESC`); }
export async function obtenerFlujo(id: string) { const [f] = await query(`SELECT * FROM flujos WHERE id=$1`, [id]); return f; }
export async function actualizarFlujo(id: string, datos: any): Promise<{ id: string }> {
  const definicion = { nodos: datos.nodos || [], conexiones: datos.conexiones || [] };
  await query(`UPDATE flujos SET nombre=$1, definicion=$2, actualizado_en=now() WHERE id=$3`,
    [datos.nombre, JSON.stringify(definicion), id]);
  return { id };
}
export async function borrarFlujo(id: string) { await query(`DELETE FROM flujos WHERE id=$1`, [id]); }