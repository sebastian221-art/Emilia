import { query } from "../db/cliente.js";

export async function subirDocumento(agenteId: string, nombre: string, tipo: string, contenido: string) {
  const [doc] = await query(
    `INSERT INTO documentos (agente_id, nombre, tipo, contenido, tam_bytes)
     VALUES ($1,$2,$3,$4,$5) RETURNING id, nombre, tipo, tam_bytes, creado_en`,
    [agenteId, nombre, tipo, contenido, Buffer.byteLength(contenido, "utf-8")]
  );
  return doc;
}

export async function documentosDe(agenteId: string) {
  // No traemos el contenido completo en el listado (puede ser grande) — solo metadata.
  return query(
    `SELECT id, nombre, tipo, tam_bytes, creado_en FROM documentos WHERE agente_id = $1 ORDER BY creado_en DESC`,
    [agenteId]
  );
}

export async function borrarDocumento(id: string) {
  await query(`DELETE FROM documentos WHERE id = $1`, [id]);
}

/**
 * Devuelve todos los documentos como un bloque de texto, para inyectar en el
 * contexto del agente cuando trabaja. Con un tope de tamaño para no reventar
 * el contexto del modelo — si hay mucho, se trunca cada documento.
 */
export async function contextoDeAgente(agenteId: string, topePorDoc = 4000): Promise<string> {
  const docs = await query<{ nombre: string; contenido: string }>(
    `SELECT nombre, contenido FROM documentos WHERE agente_id = $1 ORDER BY creado_en ASC`,
    [agenteId]
  );
  if (!docs.length) return "";
  return docs.map((d) => `--- Documento: ${d.nombre} ---\n${(d.contenido || "").slice(0, topePorDoc)}`).join("\n\n");
}