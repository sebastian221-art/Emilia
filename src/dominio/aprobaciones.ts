// ARCHIVO: src/dominio/aprobaciones.ts
import { query } from "../db/cliente.js";

export interface Aprobacion {
  id: string;
  tipo: "flujo" | "tool";
  ejecucion_id: string | null;          // flujo_ejecuciones.id (tipo flujo)
  agente_ejecucion_id: string | null;   // ejecuciones.id (tipo tool)
  conversacion_id: string | null;
  agente_id: string | null;
  titulo: string;
  detalle: string | null;
  tool: string | null;
  args: any;
  estado: "pendiente" | "aprobada" | "rechazada";
  creado_en: string;
  resuelto_en: string | null;
}

export async function aprobacionesPendientes(): Promise<Aprobacion[]> {
  return query<Aprobacion>(`SELECT * FROM aprobaciones WHERE estado='pendiente' ORDER BY creado_en ASC`);
}

export async function obtenerAprobacion(id: string): Promise<Aprobacion | undefined> {
  const [a] = await query<Aprobacion>(`SELECT * FROM aprobaciones WHERE id = $1`, [id]);
  return a;
}

/** Crea una aprobación para una tool pedida por el agente dentro de una ejecución. */
export async function crearAprobacionTool(p: {
  agenteEjecucionId: string; agenteId: string; conversacionId: string | null;
  tool: string; args: Record<string, unknown>; detalle: string;
}): Promise<Aprobacion> {
  const [a] = await query<Aprobacion>(
    `INSERT INTO aprobaciones (tipo, agente_ejecucion_id, agente_id, conversacion_id, tool, args, titulo, detalle)
     VALUES ('tool',$1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [p.agenteEjecucionId, p.agenteId, p.conversacionId, p.tool, JSON.stringify(p.args), `Ejecutar ${p.tool}`, p.detalle]
  );
  return a;
}

/** La aprobación pendiente más antigua de una conversación (para resolver por WhatsApp con "ok"/"no"). */
export async function aprobacionPendienteDeConversacion(conversacionId: string): Promise<Aprobacion | undefined> {
  const [a] = await query<Aprobacion>(
    `SELECT * FROM aprobaciones
     WHERE estado = 'pendiente' AND (
       conversacion_id = $1::uuid
       OR conversacion_id IN (SELECT id FROM conversaciones WHERE canal = 'delegacion' AND contacto = $1::text)
     )
     ORDER BY creado_en ASC LIMIT 1`,
    [conversacionId]
  );
  return a;
}

/** Marca resuelta y devuelve la fila completa (el que llama decide qué reanudar). */
export async function resolverAprobacion(id: string, aprobada: boolean): Promise<Aprobacion | undefined> {
  const [a] = await query<Aprobacion>(
    `UPDATE aprobaciones SET estado=$1, resuelto_en=now() WHERE id=$2 AND estado='pendiente' RETURNING *`,
    [aprobada ? "aprobada" : "rechazada", id]
  );
  return a;
}


/**
 * Aprobación pendiente más antigua cuyo ORIGEN es el jefe con este número, sin
 * importar en qué conversación se creó (directa, delegación de cualquier
 * profundidad, o flujo). Sube por la cadena de delegaciones hasta la
 * conversación de WhatsApp raíz y compara el contacto.
 */
export async function aprobacionPendienteDelJefe(numero: string): Promise<Aprobacion | undefined> {
  const limpio = numero.replace(/\D/g, "");
  const pendientes = await query<Aprobacion>(`SELECT * FROM aprobaciones WHERE estado='pendiente' AND conversacion_id IS NOT NULL ORDER BY creado_en ASC LIMIT 30`);
  for (const a of pendientes) {
    let convId: string | null = a.conversacion_id;
    for (let i = 0; i < 6 && convId; i++) {
      const [c] = await query<{ canal: string; contacto: string }>(`SELECT canal, contacto FROM conversaciones WHERE id=$1`, [convId]);
      if (!c) break;
      if (c.canal === "whatsapp") { if (c.contacto.replace(/\D/g, "") === limpio) return a; break; }
      if (c.canal === "delegacion") { convId = c.contacto; continue; }
      break;
    }
  }
  return undefined;
}