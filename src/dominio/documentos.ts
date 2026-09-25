// ARCHIVO: src/dominio/documentos.ts
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
  return query(
    `SELECT id, nombre, tipo, tam_bytes, creado_en FROM documentos WHERE agente_id = $1 ORDER BY creado_en DESC`,
    [agenteId]
  );
}

export async function borrarDocumento(id: string) {
  await query(`DELETE FROM documentos WHERE id = $1`, [id]);
}

/**
 * Documentos como bloque de texto para el contexto del agente.
 * Dos topes: por documento y TOTAL. Si el total se pasa, los documentos
 * más nuevos entran completos (hasta su tope) y los viejos se recortan o se
 * omiten, y se deja una nota para que el agente sepa que hay más.
 * (RAG bajo demanda para documentos grandes queda para más adelante.)
 */
export async function contextoDeAgente(agenteId: string, topePorDoc = 4000, topeTotal = 16000): Promise<string> {
  const docs = await query<{ nombre: string; contenido: string }>(
    `SELECT nombre, contenido FROM documentos WHERE agente_id = $1 ORDER BY creado_en DESC`,
    [agenteId]
  );
  if (!docs.length) return "";

  const bloques: string[] = [];
  let usado = 0, omitidos = 0;
  for (const d of docs) {
    const texto = (d.contenido || "").slice(0, topePorDoc);
    const bloque = `--- Documento: ${d.nombre} ---\n${texto}`;
    if (usado + bloque.length > topeTotal) {
      const resto = topeTotal - usado;
      if (resto > 400) { bloques.push(bloque.slice(0, resto) + "\n[...recortado]"); usado = topeTotal; }
      else omitidos++;
      continue;
    }
    bloques.push(bloque);
    usado += bloque.length;
  }
  if (omitidos) bloques.push(`[Hay ${omitidos} documento(s) más que no entraron en el contexto por tamaño.]`);
  return bloques.reverse().join("\n\n"); // cronológico
}