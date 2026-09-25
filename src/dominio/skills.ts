// ARCHIVO: src/dominio/skills.ts
import { query } from "../db/cliente.js";

export async function crearSkill(datos: any): Promise<{ id: string }> {
  const nombre = datos.nombre?.trim();
  if (!nombre) throw new Error("La skill necesita un nombre.");
  const [fila] = await query<{ id: string }>(
    `INSERT INTO skills (nombre, descripcion, nivel_riesgo, secciones, origen)
     VALUES ($1,$2,$3,$4,'ui') RETURNING id`,
    [nombre, datos.descripcion || "", datos.nivel_riesgo || "lectura", JSON.stringify(datos.secciones || {})]
  );
  return { id: fila.id };
}

/** Lista para la UI: primero las de código (activas), después las de la UI. */
export async function listarSkills(): Promise<any[]> {
  return query(`SELECT * FROM skills WHERE activo = true ORDER BY (origen = 'codigo') DESC, modulo NULLS LAST, creado_en DESC`);
}

export async function obtenerSkill(id: string): Promise<any | undefined> {
  const [s] = await query(`SELECT * FROM skills WHERE id = $1`, [id]);
  return s;
}

export async function actualizarSkill(id: string, datos: any): Promise<{ id: string }> {
  const actual = await obtenerSkill(id);
  if (!actual) throw new Error("Skill no encontrada.");
  if (actual.origen === "codigo") throw new Error(`"${actual.nombre}" está definida en código (src/skills/). Se edita ahí, no desde la UI.`);
  await query(
    `UPDATE skills SET nombre=$1, descripcion=$2, nivel_riesgo=$3, secciones=$4, actualizado_en=now() WHERE id=$5`,
    [datos.nombre, datos.descripcion || "", datos.nivel_riesgo || "lectura", JSON.stringify(datos.secciones || {}), id]
  );
  return { id };
}

export async function borrarSkill(id: string): Promise<void> {
  const actual = await obtenerSkill(id);
  if (actual?.origen === "codigo") throw new Error(`"${actual.nombre}" está definida en código. Para retirarla, quitala del registro.`);
  await query(`DELETE FROM skills WHERE id = $1`, [id]);
}