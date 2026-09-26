// ARCHIVO: src/motor/actividad.ts
// ─────────────────────────────────────────────────────────────────────────────
//  ACTIVIDAD — qué está haciendo el sistema AHORA, en un solo lugar.
//  Tareas de agentes en curso (último paso), sesiones de Claude Code activas
//  (último evento), flujos activos (nodo), aprobaciones pendientes, colas.
//  Lo usan la página Actividad y la tool observar_actividad.
// ─────────────────────────────────────────────────────────────────────────────

import { query } from "../db/cliente.js";
import { sesionesActivas } from "./claude-code.js";
import { entregarTexto } from "./entrega.js";
import { obtenerConversacion } from "../dominio/conversaciones.js";

export async function actividadActual() {
  const [tareas, sesiones, flujos, aprobaciones, pasos] = await Promise.all([
    query<any>(`SELECT e.id, e.estado, e.origen, e.inicio, e.turnos_usados, e.tool_calls, ag.nombre AS agente,
                  (SELECT p.tipo || ': ' || left(p.detalle, 160) FROM pasos p WHERE p.ejecucion_id=e.id ORDER BY p.creado_en DESC LIMIT 1) AS ultimo_paso
                FROM ejecuciones e JOIN agentes ag ON ag.id=e.agente_id
                WHERE e.estado IN ('en_curso','esperando_aprobacion') AND e.inicio > now() - interval '6 hours' ORDER BY e.inicio DESC LIMIT 20`),
    query<any>(`SELECT s.id, s.estado, s.encargo, s.inicio, s.turnos, p.nombre AS proyecto, sb.rama,
                  (SELECT l->>'texto' FROM jsonb_array_elements(s.log) l ORDER BY l->>'t' DESC LIMIT 1) AS ultimo_evento,
                  jsonb_array_length(s.log) AS eventos
                FROM sesiones_codigo s JOIN proyectos p ON p.id=s.proyecto_id JOIN sandboxes sb ON sb.id=s.sandbox_id
                WHERE s.estado='en_curso' ORDER BY s.inicio DESC`),
    query<any>(`SELECT id, nombre_flujo, estado, nodo_actual, inicio, despertar_en,
                  (SELECT l->>'texto' FROM jsonb_array_elements(log) l ORDER BY l->>'t' DESC LIMIT 1) AS ultimo_log
                FROM flujo_ejecuciones WHERE estado IN ('en_curso','esperando','esperando_aprobacion','esperando_subflujo') ORDER BY inicio DESC LIMIT 20`),
    query<any>(`SELECT a.id, a.tipo, a.titulo, a.detalle, a.creado_en, ag.nombre AS agente FROM aprobaciones a LEFT JOIN agentes ag ON ag.id=a.agente_id WHERE a.estado='pendiente' ORDER BY a.creado_en`),
    query<any>(`SELECT p.tipo, left(p.detalle, 220) AS detalle, p.creado_en, ag.nombre AS agente FROM pasos p JOIN ejecuciones e ON e.id=p.ejecucion_id JOIN agentes ag ON ag.id=e.agente_id ORDER BY p.creado_en DESC LIMIT 60`),
  ]);
  return { ahora: new Date().toISOString(), tareas, sesiones_claude: sesiones, sesiones_activas_en_proceso: sesionesActivas().length, flujos, aprobaciones, ultimos_pasos: pasos };
}

export function resumirActividad(a: Awaited<ReturnType<typeof actividadActual>>): string {
  const l: string[] = [];
  if (a.tareas.length) l.push(`Tareas en curso (${a.tareas.length}):\n` + a.tareas.map((t) => `• ${t.agente} · ${t.estado} · ${t.turnos_usados} turnos · ${t.ultimo_paso || "(arrancando)"}`).join("\n"));
  if (a.sesiones_claude.length) l.push(`Claude Code trabajando (${a.sesiones_claude.length}):\n` + a.sesiones_claude.map((s) => `• ${s.proyecto}/${String(s.rama).replace("senior/", "")} · ${s.eventos} eventos · ${s.ultimo_evento || "iniciando"}`).join("\n"));
  if (a.flujos.length) l.push(`Flujos activos (${a.flujos.length}):\n` + a.flujos.map((f) => `• ${f.nombre_flujo} · ${f.estado} @${f.nodo_actual}${f.despertar_en ? ` (despierta ${new Date(f.despertar_en).toLocaleTimeString("es-CO")})` : ""}`).join("\n"));
  if (a.aprobaciones.length) l.push(`Esperando tu OK (${a.aprobaciones.length}):\n` + a.aprobaciones.map((x) => `• ${x.detalle || x.titulo}`).join("\n"));
  return l.length ? l.join("\n\n") : "Nada en curso ahora mismo. Todo quieto.";
}

/** Aviso corto de progreso al jefe por su conversación (si la hay). */
export async function avisarProgreso(conversacionId: string | null | undefined, texto: string) {
  if (!conversacionId) return;
  const conv = await obtenerConversacion(conversacionId);
  if (!conv) return;
  // Solo por WhatsApp (en el panel se ve en trazas); y sin duplicar el guardado en panel.
  if (conv.canal === "whatsapp") await entregarTexto(conv, texto).catch(() => {});
}