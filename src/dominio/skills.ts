import { query } from "../db/cliente.js";

export async function crearSkill(datos: any): Promise<{ id: string }> {
  const nombre = datos.nombre?.trim();
  if (!nombre) throw new Error("La skill necesita un nombre.");
  const [fila] = await query<{ id: string }>(
    `INSERT INTO skills (nombre, descripcion, nivel_riesgo, secciones)
     VALUES ($1,$2,$3,$4) RETURNING id`,
    [nombre, datos.descripcion || "", datos.nivel_riesgo || "lectura", JSON.stringify(datos.secciones || {})]
  );
  return { id: fila.id };
}

export async function listarSkills(): Promise<any[]> {
  return query(`SELECT * FROM skills ORDER BY creado_en DESC`);
}

export async function obtenerSkill(id: string): Promise<any | undefined> {
  const [s] = await query(`SELECT * FROM skills WHERE id = $1`, [id]);
  return s;
}

export async function actualizarSkill(id: string, datos: any): Promise<{ id: string }> {
  await query(
    `UPDATE skills SET nombre=$1, descripcion=$2, nivel_riesgo=$3, secciones=$4, actualizado_en=now() WHERE id=$5`,
    [datos.nombre, datos.descripcion || "", datos.nivel_riesgo || "lectura", JSON.stringify(datos.secciones || {}), id]
  );
  return { id };
}

export async function borrarSkill(id: string): Promise<void> {
  await query(`DELETE FROM skills WHERE id = $1`, [id]);
}