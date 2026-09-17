import { query } from "../db/cliente.js";

export async function guardarMensaje(agenteId: string, rol: string, contenido: string) {
  const [m] = await query(
    `INSERT INTO mensajes (agente_id, rol, contenido) VALUES ($1,$2,$3) RETURNING *`,
    [agenteId, rol, contenido]
  );
  return m;
}

export async function mensajesDe(agenteId: string, limite = 50) {
  return query(
    `SELECT * FROM mensajes WHERE agente_id = $1 ORDER BY creado_en ASC LIMIT $2`,
    [agenteId, limite]
  );
}

export async function pasosDeUltimaEjecucion(agenteId: string) {
  const [ej] = await query<{ id: string }>(
    `SELECT id FROM ejecuciones WHERE agente_id = $1 ORDER BY inicio DESC LIMIT 1`,
    [agenteId]
  );
  if (!ej) return [];
  return query(`SELECT tipo, detalle, creado_en FROM pasos WHERE ejecucion_id = $1 ORDER BY creado_en ASC`, [ej.id]);
}