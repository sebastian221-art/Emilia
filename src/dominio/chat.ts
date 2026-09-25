// ARCHIVO: src/dominio/chat.ts
// Compatibilidad: estas funciones existían antes de las conversaciones.
// Ahora pasan por la conversación del panel. El listado del agente sigue
// devolviendo TODOS sus mensajes (panel + WhatsApp) porque así lo muestra la
// UI actual; en Fase 5 la UI filtra por conversación.

import { query } from "../db/cliente.js";
import { obtenerOCrearConversacion, guardarMensajeEn } from "./conversaciones.js";

export async function guardarMensaje(agenteId: string, rol: "usuario" | "agente" | "pensamiento" | "sistema", contenido: string) {
  const conv = await obtenerOCrearConversacion(agenteId, "panel", "panel");
  return guardarMensajeEn(conv, rol, contenido);
}

export async function mensajesDe(agenteId: string, limite = 100) {
  const filas = await query(
    `SELECT m.*, c.canal, c.contacto FROM mensajes m
     LEFT JOIN conversaciones c ON c.id = m.conversacion_id
     WHERE m.agente_id = $1 ORDER BY m.creado_en DESC LIMIT $2`,
    [agenteId, limite]
  );
  return filas.reverse();
}

export async function pasosDeUltimaEjecucion(agenteId: string) {
  const [ej] = await query<{ id: string }>(
    `SELECT id FROM ejecuciones WHERE agente_id = $1 ORDER BY inicio DESC LIMIT 1`,
    [agenteId]
  );
  if (!ej) return [];
  return query(`SELECT tipo, detalle, creado_en FROM pasos WHERE ejecucion_id = $1 ORDER BY creado_en ASC`, [ej.id]);
}