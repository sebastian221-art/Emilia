// ARCHIVO: src/tools/observar.ts
// ─────────────────────────────────────────────────────────────────────────────
//  TOOLS DE OBSERVABILIDAD — mirar hacia adentro de Emilia
//  Logs del servidor, ejecuciones fallidas con sus trazas, flujos en curso,
//  sesiones de Claude Code activas, estado del proceso. Es lo que un senior
//  necesita para diagnosticar sin pedirte que le pegues la consola.
// ─────────────────────────────────────────────────────────────────────────────

import type { DefTool } from "../registro/tipos.js";
import { query } from "../db/cliente.js";
import { leerBitacora } from "../motor/bitacora.js";
import { sesionesActivas } from "../motor/claude-code.js";

const MODULO = "observar";

export const observarLogs: DefTool = {
  nombre: "observar_logs", modulo: MODULO,
  descripcion: "Últimas líneas de la consola del servidor de Emilia (log/warn/error), con filtro opcional por texto. Para diagnosticar qué está pasando ahora.",
  parametros: { type: "object", properties: { ultimas: { type: "integer", default: 60, minimum: 5, maximum: 400 }, nivel: { type: "string", enum: ["log", "warn", "error"], description: "Solo este nivel o superior." }, filtro: { type: "string", description: "Texto a buscar (ej. 'whatsapp', 'error')." } }, required: [] },
  riesgo: "lectura", requiereAprobacion: false,
  async ejecutar(a) {
    const l = leerBitacora({ ultimas: a.ultimas, nivel: a.nivel, filtro: a.filtro });
    return { ok: true, datos: l, resumen: l.length ? l.map((x) => `${x.t.slice(11, 19)} [${x.nivel}] ${x.texto.slice(0, 220)}`).join("\n") : "Sin líneas que coincidan." };
  },
};

export const observarEjecuciones: DefTool = {
  nombre: "observar_ejecuciones", modulo: MODULO,
  descripcion: "Ejecuciones recientes de los agentes (tareas), con estado y, para las fallidas o la indicada, sus pasos/trazas completas.",
  parametros: { type: "object", properties: { solo_fallidas: { type: "boolean", default: false }, agente: { type: "string", description: "Nombre del agente (opcional)." }, ejecucion_id: { type: "string", description: "Ver los pasos de esta ejecución en detalle." }, limite: { type: "integer", default: 15, minimum: 1, maximum: 100 } }, required: [] },
  riesgo: "lectura", requiereAprobacion: false,
  async ejecutar(a) {
    if (a.ejecucion_id) {
      const [ej] = await query<any>(`SELECT e.*, ag.nombre AS agente FROM ejecuciones e JOIN agentes ag ON ag.id=e.agente_id WHERE e.id::text=$1`, [a.ejecucion_id]);
      if (!ej) return { ok: false, error: "Ejecución no encontrada." };
      const pasos = await query<any>(`SELECT tipo, detalle, creado_en FROM pasos WHERE ejecucion_id=$1 ORDER BY creado_en`, [ej.id]);
      return { ok: true, datos: { ejecucion: ej, pasos }, resumen: `${ej.agente} · ${ej.estado} · ${ej.turnos_usados} turnos\n` + pasos.map((p) => `[${p.tipo}] ${String(p.detalle).slice(0, 300)}`).join("\n") };
    }
    const cond: string[] = [], args: any[] = [];
    if (a.solo_fallidas) cond.push(`e.estado='fallida'`);
    if (a.agente) { args.push(a.agente); cond.push(`lower(ag.nombre)=lower($${args.length})`); }
    args.push(a.limite || 15);
    const filas = await query<any>(`SELECT e.id, e.estado, e.origen, e.turnos_usados, e.tool_calls, e.respuesta, e.inicio, ag.nombre AS agente FROM ejecuciones e JOIN agentes ag ON ag.id=e.agente_id ${cond.length ? "WHERE " + cond.join(" AND ") : ""} ORDER BY e.inicio DESC LIMIT $${args.length}`, args);
    return { ok: true, datos: filas, resumen: filas.length ? filas.map((f) => `${f.id.slice(0, 8)} ${f.agente} ${f.estado} (${f.tool_calls} tools) ${String(f.respuesta || "").slice(0, 80)}`).join("\n") : "Sin ejecuciones." };
  },
};

export const observarFlujos: DefTool = {
  nombre: "observar_flujos", modulo: MODULO,
  descripcion: "Flujos en curso o recientes con su estado, nodo actual y últimas líneas de log.",
  parametros: { type: "object", properties: { solo_activos: { type: "boolean", default: true }, limite: { type: "integer", default: 10, minimum: 1, maximum: 50 } }, required: [] },
  riesgo: "lectura", requiereAprobacion: false,
  async ejecutar(a) {
    const filas = await query<any>(`SELECT id, nombre_flujo, estado, nodo_actual, origen, error, inicio, log FROM flujo_ejecuciones ${a.solo_activos !== false ? "WHERE estado IN ('en_curso','esperando','esperando_aprobacion','esperando_subflujo')" : ""} ORDER BY inicio DESC LIMIT $1`, [a.limite || 10]);
    const datos = filas.map((f) => ({ ...f, log: (f.log || []).slice(-5) }));
    return { ok: true, datos, resumen: datos.length ? datos.map((f) => `${f.id.slice(0, 8)} ${f.nombre_flujo} ${f.estado} @${f.nodo_actual}${f.error ? " · " + f.error : ""}`).join("\n") : "Sin flujos activos." };
  },
};

export const observarEstado: DefTool = {
  nombre: "observar_estado", modulo: MODULO,
  descripcion: "Estado general del proceso de Emilia: uptime, memoria, sesiones de Claude Code activas, flujos activos, aprobaciones pendientes, sandboxes abiertos.",
  parametros: { type: "object", properties: {}, required: [] }, riesgo: "lectura", requiereAprobacion: false,
  async ejecutar() {
    const [[fl], [ap], [sb], [ag]] = await Promise.all([
      query<any>(`SELECT count(*)::int AS n FROM flujo_ejecuciones WHERE estado IN ('en_curso','esperando','esperando_aprobacion','esperando_subflujo')`),
      query<any>(`SELECT count(*)::int AS n FROM aprobaciones WHERE estado='pendiente'`),
      query<any>(`SELECT count(*)::int AS n FROM sandboxes WHERE estado='abierto'`),
      query<any>(`SELECT count(*)::int AS n FROM agentes WHERE estado='activo'`),
    ]);
    const mem = process.memoryUsage();
    const datos = { uptime_min: Math.round(process.uptime() / 60), memoria_mb: Math.round(mem.rss / 1048576), node: process.version, sesiones_claude_activas: sesionesActivas().length, flujos_activos: fl.n, aprobaciones_pendientes: ap.n, sandboxes_abiertos: sb.n, agentes_activos: ag.n };
    return { ok: true, datos, resumen: Object.entries(datos).map(([k, v]) => `${k}: ${v}`).join(" · ") };
  },
};

export const toolsObservar: DefTool[] = [observarLogs, observarEjecuciones, observarFlujos, observarEstado];