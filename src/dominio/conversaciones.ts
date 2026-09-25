// ARCHIVO: src/dominio/conversaciones.ts
// ─────────────────────────────────────────────────────────────────────────────
//  CONVERSACIONES
//  Una conversación = (agente, canal, contacto). El chat del panel es la
//  conversación canal='panel' contacto='panel'. Cada número de WhatsApp tiene
//  la suya. Es la unidad de memoria conversacional y de cola de procesamiento.
// ─────────────────────────────────────────────────────────────────────────────

import { query } from "../db/cliente.js";

export type Canal = "panel" | "whatsapp" | "delegacion";   // delegacion: un agente le encarga a otro; contacto = conversación padre

export interface Conversacion {
  id: string;
  agente_id: string;
  canal: Canal;
  contacto: string;
  titulo: string;
  resumen: string;
  resumen_hasta: string | null;
  ultimo_mensaje_en: string;
  creado_en: string;
}

export interface Mensaje {
  id: string;
  conversacion_id: string;
  agente_id: string;
  rol: "usuario" | "agente" | "pensamiento" | "sistema";
  contenido: string;
  creado_en: string;
}

export async function obtenerOCrearConversacion(agenteId: string, canal: Canal, contacto: string): Promise<Conversacion> {
  const titulo = canal === "panel" ? "Chat del panel" : canal === "delegacion" ? "Delegaciones recibidas" : `WhatsApp ${contacto}`;
  const [c] = await query<Conversacion>(
    `INSERT INTO conversaciones (agente_id, canal, contacto, titulo) VALUES ($1,$2,$3,$4)
     ON CONFLICT (agente_id, canal, contacto) DO UPDATE SET agente_id = EXCLUDED.agente_id
     RETURNING *`,
    [agenteId, canal, contacto, titulo]
  );
  return c;
}

export async function obtenerConversacion(id: string): Promise<Conversacion | undefined> {
  const [c] = await query<Conversacion>(`SELECT * FROM conversaciones WHERE id = $1`, [id]);
  return c;
}

export async function conversacionesDeAgente(agenteId: string): Promise<Conversacion[]> {
  return query<Conversacion>(`SELECT * FROM conversaciones WHERE agente_id = $1 ORDER BY ultimo_mensaje_en DESC`, [agenteId]);
}

export async function guardarMensajeEn(conv: Conversacion, rol: Mensaje["rol"], contenido: string): Promise<Mensaje> {
  const [m] = await query<Mensaje>(
    `INSERT INTO mensajes (agente_id, conversacion_id, rol, contenido) VALUES ($1,$2,$3,$4) RETURNING *`,
    [conv.agente_id, conv.id, rol, contenido]
  );
  await query(`UPDATE conversaciones SET ultimo_mensaje_en = now() WHERE id = $1`, [conv.id]);
  return m;
}

/** Últimos N mensajes de la conversación, en orden cronológico. */
export async function ultimosMensajes(convId: string, limite: number): Promise<Mensaje[]> {
  const filas = await query<Mensaje>(
    `SELECT * FROM mensajes WHERE conversacion_id = $1 ORDER BY creado_en DESC LIMIT $2`,
    [convId, limite]
  );
  return filas.reverse();
}

/** Mensajes de una conversación posteriores a una fecha (para resumir lo viejo). */
export async function mensajesDesde(convId: string, desde: string | null): Promise<Mensaje[]> {
  return desde
    ? query<Mensaje>(`SELECT * FROM mensajes WHERE conversacion_id = $1 AND creado_en > $2 ORDER BY creado_en ASC`, [convId, desde])
    : query<Mensaje>(`SELECT * FROM mensajes WHERE conversacion_id = $1 ORDER BY creado_en ASC`, [convId]);
}

export async function guardarResumen(convId: string, resumen: string, hasta: string): Promise<void> {
  await query(`UPDATE conversaciones SET resumen = $1, resumen_hasta = $2 WHERE id = $3`, [resumen, hasta, convId]);
}