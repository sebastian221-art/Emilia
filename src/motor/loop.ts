// ARCHIVO: src/motor/loop.ts
// ─────────────────────────────────────────────────────────────────────────────
//  LOOP DEL AGENTE (Fase 3)
//  Lee del esqueleto exactamente lo que src/esqueleto/piezas.ts declara.
//  - Memoria: si hay conversación, inyecta resumen + últimos mensajes.
//  - Aprobaciones reales: cuando el modelo pide una tool que requiere OK,
//    la ejecución se PERSISTE (hilo completo + tool calls pendientes), se
//    crea la aprobación y se devuelve estado 'esperando_aprobacion'.
//    reanudarEjecucion() retoma exactamente ahí, apruebe o rechace.
//  - Sin heurísticas de nombres: lo que el agente tiene es lo que hay.
// ─────────────────────────────────────────────────────────────────────────────

import { query } from "../db/cliente.js";
import { obtenerAgente } from "../dominio/agentes.js";
import { contextoDeAgente } from "../dominio/documentos.js";
import { obtenerConversacion, type Conversacion } from "../dominio/conversaciones.js";
import { crearAprobacionTool } from "../dominio/aprobaciones.js";
import { llamarModelo, MODELO_POR_DEFECTO } from "./groq.js";
import { ejecutarTool, ejecutarSkill, crearContexto } from "./ejecutor.js";
import { herramientasDeAgente, type Invocable } from "./herramientas.js";
import { iniciarFlujo } from "./flujo.js";
import { textoAprobacion, detalleAprobacion } from "./aprobacion-texto.js";
import { historialParaModelo, resumirSiHaceFalta, extraerHechosSiHaceFalta } from "./memoria.js";
import { memoriaParaPrompt } from "../dominio/memoria-lp.js";
import { dentroDePresupuesto, registrarConsumo } from "./presupuesto.js";
import { elegirModulos, definicionesActivas, esPseudoToolModulo, moduloDe, resumenModulos } from "./enrutador.js";
import { cancelada } from "./cancelacion.js";
import { entregarTexto } from "./entrega.js";
import { registro } from "../registro/registro.js";
import type { ChatCompletionMessageParam, ChatCompletionTool } from "groq-sdk/resources/chat/completions";
import type { ContextoEjecucion } from "../registro/tipos.js";

export type EstadoTarea = "completada" | "fallida" | "esperando_aprobacion";

export interface ResultadoTarea {
  ok: boolean;
  estado: EstadoTarea;
  respuesta: string;
  ejecucionId: string;
  conversacionId: string | null;
  turnos: number;
  toolCalls: number;
  mensajesEnviados: string[];
  aprobacionId?: string;
}

export interface OpcionesTarea {
  conversacionId?: string | null;
  origen?: "panel" | "whatsapp" | "flujo" | "api" | "evaluacion";
  /** Modo simulado (evaluaciones): las tools que no son de lectura NO se ejecutan; se devuelve un resultado ficticio. */
  simulado?: boolean;
  /** Texto extra para el system prompt (ej. "hablás con tu jefe por WhatsApp"). */
  contextoCanal?: string;
}

interface ToolCallPendiente {
  id: string;
  nombre: string;
  argumentos: Record<string, unknown>;
  decision?: "aprobada" | "rechazada";
}

interface Estado {
  ejId: string;
  agenteId: string;
  conversacionId: string | null;
  ag: any;
  modelo: string;
  temperatura: number;
  maxTurnos: number;
  maxToolCalls: number;
  mensajes: ChatCompletionMessageParam[];
  pendientes: ToolCallPendiente[];
  turnos: number;
  toolCalls: number;
  mensajesEnviados: string[];
  avisoLargoEnviado?: boolean;
  empujonDado?: boolean;
  empujonPermiso?: boolean;
  enfoqueReanudacion?: string;
  flujoLanzado?: boolean;
  simulado?: boolean;
  modulosActivos?: Set<string>;
  firmasRecientes?: string[];
  repeticionesSeguidas?: number;
  empujonHonestidad?: boolean;
}

// ─── Arranque ────────────────────────────────────────────────────────────────
export async function correrTarea(agenteId: string, mensajeUsuario: string, op: OpcionesTarea = {}): Promise<ResultadoTarea> {
  const ag = await obtenerAgente(agenteId);
  if (!ag) throw new Error("Agente no encontrado");
  if (ag.estado !== "activo") throw new Error(`El agente está en estado '${ag.estado}'. Activalo para que trabaje.`);
  if (!process.env.GROQ_API_KEY) throw new Error("Falta GROQ_API_KEY en el .env de emilia. Agregala y reiniciá el servidor.");

  if (cancelada(op.conversacionId)) {
    const [ej0] = await query<{ id: string }>(`INSERT INTO ejecuciones (agente_id, estado, conversacion_id, origen, respuesta, fin) VALUES ($1,'fallida',$2,$3,'cancelada',now()) RETURNING id`, [agenteId, op.conversacionId ?? null, op.origen || "panel"]);
    return { ok: false, estado: "fallida", respuesta: "cancelada", ejecucionId: ej0.id, conversacionId: op.conversacionId ?? null, turnos: 0, toolCalls: 0, mensajesEnviados: [] };
  }
  const pres = await dentroDePresupuesto(ag);
  if (!pres.ok) {
    const [ej0] = await query<{ id: string }>(`INSERT INTO ejecuciones (agente_id, estado, conversacion_id, origen, respuesta, fin) VALUES ($1,'fallida',$2,$3,$4,now()) RETURNING id`, [agenteId, op.conversacionId ?? null, op.origen || "panel", "presupuesto agotado"]);
    return { ok: false, estado: "fallida", respuesta: `Hoy ya gasté ${pres.gastado.toFixed(2)} USD de mi tope de ${pres.tope} USD. Para seguir, subí el presupuesto en mi esqueleto (gobierno → presupuesto diario) o esperá a mañana.`, ejecucionId: ej0.id, conversacionId: op.conversacionId ?? null, turnos: 0, toolCalls: 0, mensajesEnviados: [] };
  }
  const conv = op.conversacionId ? await obtenerConversacion(op.conversacionId) : undefined;
  const { invocables } = await herramientasDeAgente(agenteId);
  const modulosActivos = await elegirModulos(mensajeUsuario, invocables, conv?.resumen?.slice(0, 300));
  const tools = definicionesActivas(invocables, modulosActivos);
  const sistema = await armarSistema(ag, invocables, conv, op.contextoCanal);

  const [ej] = await query<{ id: string }>(
    `INSERT INTO ejecuciones (agente_id, estado, conversacion_id, origen) VALUES ($1,'en_curso',$2,$3) RETURNING id`,
    [agenteId, conv?.id ?? null, op.origen || "panel"]);

  const mensajes: ChatCompletionMessageParam[] = [{ role: "system", content: sistema }];
  if (conv) mensajes.push(...await historialParaModelo(conv, ag.memoria));
  mensajes.push({ role: "user", content: mensajeUsuario });

  const estado: Estado = {
    ejId: ej.id, agenteId, conversacionId: conv?.id ?? null, ag,
    modelo: ag.cerebro?.modelo_rapido || MODELO_POR_DEFECTO,
    temperatura: Number(ag.cerebro?.temperatura ?? 0.3),
    maxTurnos: Number(ag.cerebro?.turnos) || 20,
    maxToolCalls: Number(ag.gobierno?.max_tool_calls) || 30,
    mensajes, pendientes: [], turnos: 0, toolCalls: 0, mensajesEnviados: [], simulado: !!op.simulado, modulosActivos,
  };
  const ctx = crearContexto(agenteId, ej.id, null, conv?.id ?? null);

  // Plan previo si está activo.
  if (ag.planeamiento?.activo) {
    try {
      const rp = await llamarModelo([{ role: "system", content: `${sistema}\n\nArmá un plan breve (3-6 pasos). Solo el plan.` }, { role: "user", content: mensajeUsuario }], [], { modelo: estado.modelo, temperatura: estado.temperatura });
      await query(`UPDATE ejecuciones SET plan=$1 WHERE id=$2`, [rp.texto, ej.id]);
      if (rp.razonamiento && ag.pensar_voz_alta?.visible) await ctx.traza("pensamiento", rp.razonamiento);
      mensajes.push({ role: "assistant", content: `Mi plan:\n${rp.texto}` });
      mensajes.push({ role: "user", content: "Dale, ejecutá el plan usando tus herramientas de verdad." });
    } catch (e: any) { await ctx.traza("error", `No se pudo planear: ${e?.message || e}`); }
  }

  const r = await bucle(estado, tools, invocables, ctx);
  if (conv && r.estado !== "esperando_aprobacion") {
    resumirSiHaceFalta(conv, ag.memoria).catch(() => {});
    const esJefe = conv.canal === "panel" || (conv.canal === "whatsapp" && conv.contacto === (process.env.WHATSAPP_NUMERO_JEFE || "").replace(/\D/g, ""));
    extraerHechosSiHaceFalta(conv, ag.memoria, esJefe).catch(() => {});
  }
  return r;
}

// ─── Reanudación ─────────────────────────────────────────────────────────────
/**
 * Retoma una ejecución pausada por aprobación. La primera tool call pendiente
 * es la que se aprobó/rechazó. Devuelve el resultado como si la tarea hubiera
 * seguido de corrido (puede volver a pausar si hay otra aprobación después).
 */
export async function reanudarEjecucion(ejecucionId: string, aprobada: boolean): Promise<ResultadoTarea> {
  const [fila] = await query<any>(`SELECT * FROM ejecuciones WHERE id = $1`, [ejecucionId]);
  if (!fila) throw new Error("Ejecución no encontrada");
  if (fila.estado !== "esperando_aprobacion") throw new Error(`La ejecución está '${fila.estado}', no esperando aprobación.`);

  const ag = await obtenerAgente(fila.agente_id);
  if (!ag) throw new Error("Agente no encontrado");
  const { invocables } = await herramientasDeAgente(fila.agente_id);
  const ultimoUsuario = [...(fila.mensajes || [])].reverse().find((m: any) => m.role === "user")?.content || "";
  const modulosActivos = await elegirModulos(String(ultimoUsuario), invocables);
  for (const p of (fila.pendientes || []) as ToolCallPendiente[]) modulosActivos.add(moduloDe(p.nombre));
  const tools = definicionesActivas(invocables, modulosActivos);

  const pendientes: ToolCallPendiente[] = fila.pendientes || [];
  if (!pendientes.length) throw new Error("La ejecución no tiene tool calls pendientes.");
  pendientes[0].decision = aprobada ? "aprobada" : "rechazada";

  const estado: Estado = {
    ejId: fila.id, agenteId: fila.agente_id, conversacionId: fila.conversacion_id, ag,
    modelo: ag.cerebro?.modelo_rapido || MODELO_POR_DEFECTO,
    temperatura: Number(ag.cerebro?.temperatura ?? 0.3),
    maxTurnos: Number(ag.cerebro?.turnos) || 20,
    maxToolCalls: Number(ag.gobierno?.max_tool_calls) || 30,
    mensajes: fila.mensajes || [], pendientes,
    turnos: fila.turnos_usados || 0, toolCalls: fila.tool_calls || 0,
    mensajesEnviados: fila.mensajes_enviados || [], modulosActivos,
  };
  const ctx = crearContexto(estado.agenteId, estado.ejId, null, estado.conversacionId);
  await ctx.traza("aprobacion", aprobada ? `Aprobado: ${pendientes[0].nombre}. Continúa.` : `Rechazado: ${pendientes[0].nombre}. Continúa sin ejecutarla.`);
  await query(`UPDATE ejecuciones SET estado='en_curso' WHERE id=$1`, [estado.ejId]);
  estado.enfoqueReanudacion = pendientes[0].nombre;

  const r = await bucle(estado, tools, invocables, ctx);
  if (estado.conversacionId && r.estado !== "esperando_aprobacion") {
    const conv = await obtenerConversacion(estado.conversacionId);
    if (conv) resumirSiHaceFalta(conv, ag.memoria).catch(() => {});
  }
  return r;
}

// ─── El bucle ────────────────────────────────────────────────────────────────
async function bucle(e: Estado, toolsIniciales: ChatCompletionTool[], invocables: Map<string, Invocable>, ctx: ContextoEjecucion): Promise<ResultadoTarea> {
  const ag = e.ag;
  let respuestaFinal = "";
  let tools = toolsIniciales;

  try {
    while (true) {
      // 1. Procesar tool calls pendientes (del turno actual o de una reanudación).
      const pausa = await procesarPendientes(e, invocables, ctx);
      if (pausa) return pausa;
      if (e.enfoqueReanudacion) {
        e.mensajes.push({ role: "user", content: `(La acción ${e.enfoqueReanudacion} que esperaba aprobación ya se resolvió. Respondele al jefe SOLO sobre el resultado de esa acción, en una o dos líneas. No retomes temas anteriores.)` });
        e.enfoqueReanudacion = undefined;
      }

      // 2. Presupuesto.
      if (e.turnos >= e.maxTurnos) {
        respuestaFinal = "Me quedé sin presupuesto de turnos para esta tarea. Contame si querés que siga con más.";
        await ctx.traza("verificacion", `Presupuesto de ${e.maxTurnos} turnos agotado.`);
        break;
      }

      // 3. Siguiente turno con el modelo.
      e.turnos++;
      if (e.modulosActivos) tools = definicionesActivas(invocables, e.modulosActivos);
      const r = await llamarModelo(e.mensajes, tools, { modelo: e.modelo, temperatura: e.temperatura });
      if (r.uso) registrarConsumo({ agenteId: e.agenteId, ejecucionId: e.ejId, proveedor: "groq", modelo: r.uso.modelo, tokensIn: r.uso.entrada, tokensOut: r.uso.salida }).catch(() => {});
      if (r.razonamiento && ag.pensar_voz_alta?.visible) await ctx.traza("pensamiento", r.razonamiento);

      const asistente: any = { role: "assistant", content: r.texto || null };
      if (r.toolCalls.length) {
        asistente.tool_calls = r.toolCalls.map((t) => ({ id: t.id, type: "function", function: { name: t.nombre, arguments: JSON.stringify(t.argumentos) } }));
      }
      e.mensajes.push(asistente);

      if (!r.toolCalls.length && !r.texto.trim() && !e.empujonDado) {
        // Pensó pero no actuó ni respondió: un empujón, una sola vez.
        e.empujonDado = true;
        e.mensajes.push({ role: "user", content: "No llegó ninguna acción ni respuesta. Si necesitás una herramienta, llamala ahora; si no, escribí tu respuesta final." });
        continue;
      }
      // Pidió permiso por texto sin llamar nada: no vale. Un empujón (una vez).
      const pidePermiso = /(necesito|requiero) (tu |su )?(ok|aprobaci[oó]n|permiso|autorizaci[oó]n)|¿\s*proced(o|emos)\s*\?|¿\s*(quer[eé]s|deseas|quieres) que (proceda|lo haga|ejecute|abra|integre|cree)|dame (tu )?(ok|aprobaci[oó]n)|respond[eé] \*?ok\*?|⏸/i;
      if (!r.toolCalls.length && pidePermiso.test(r.texto) && e.toolCalls === 0 && !e.empujonPermiso && invocables.size) {
        e.empujonPermiso = true;
        e.mensajes.push({ role: "user", content: "No pidas permiso por texto. Llamá la herramienta que corresponde ahora mismo: si requiere aprobación, el sistema se la pide al jefe automáticamente." });
        await ctx.traza("verificacion", "Pidió permiso por texto sin llamar la herramienta; se le exigió actuar.");
        continue;
      }
      if (!r.toolCalls.length) {
        respuestaFinal = r.texto;
        const afirma = /\b(envi[eé]|mand[eé]|consult[eé]|ejecut[eé]|llam[eé]|cre[eé]|abr[ií]|guard[eé]|integr[eé]|hice|realic[eé]|lanc[eé]|configur[eé]|actualic[eé])\b/i.test(respuestaFinal);
        const usadas = (e.firmasRecientes || []).map((f) => f.split("|")[0]);
        const diceNavegador = /desde el navegador|en el navegador|abr[ií] el navegador/i.test(respuestaFinal) && !usadas.some((u) => u.startsWith("navegador_"));
        const sinTools = afirma && e.toolCalls === 0;
        if ((sinTools || diceNavegador) && (ag.trazas?.verifica ?? true) && !e.empujonHonestidad) {
          // Una sola vez: exigir que la respuesta coincida con lo que realmente hizo.
          e.empujonHonestidad = true;
          e.mensajes.push({ role: "user", content: `Tu respuesta afirma acciones que no coinciden con las herramientas que usaste en esta tarea (${usadas.length ? usadas.join(", ") : "ninguna"}). Reescribila diciendo EXACTAMENTE qué hiciste (con qué herramienta) y qué NO hiciste. Si en realidad falta hacer algo, llamá la herramienta ahora.` });
          await ctx.traza("verificacion", `Respuesta rechazada por no coincidir con las acciones reales (${sinTools ? "afirma sin herramientas" : "dice navegador sin usarlo"}); se le exigió corregir.`);
          continue;
        }
        if (sinTools) await ctx.traza("verificacion", "El agente afirma haber hecho acciones pero no usó ninguna herramienta real.");
        else await ctx.traza("verificacion", `Completado con ${e.toolCalls} llamada(s) real(es) a herramientas.`);
        break;
      }

      if (e.flujoLanzado) {
        // El flujo ya se encarga: no dejar que el agente duplique el trabajo.
        for (const tc of r.toolCalls) e.mensajes.push({ role: "tool", tool_call_id: tc.id, content: "No ejecutado: ya lanzaste un flujo que se encarga de esto y te avisará. Respondé al jefe en una línea y terminá." });
        await ctx.traza("verificacion", `Ignoradas ${r.toolCalls.length} tool call(s) posteriores al lanzamiento de un flujo.`);
        continue;
      }
      e.pendientes = r.toolCalls.map((t) => ({ id: t.id, nombre: t.nombre, argumentos: t.argumentos }));
    }

    await query(
      `UPDATE ejecuciones SET estado='completada', turnos_usados=$1, tool_calls=$2, respuesta=$3, mensajes=NULL, pendientes='[]', mensajes_enviados=$4, fin=now() WHERE id=$5`,
      [e.turnos, e.toolCalls, respuestaFinal, JSON.stringify(e.mensajesEnviados), e.ejId]);
    return { ok: true, estado: "completada", respuesta: respuestaFinal || "(sin respuesta de texto)", ejecucionId: e.ejId, conversacionId: e.conversacionId, turnos: e.turnos, toolCalls: e.toolCalls, mensajesEnviados: e.mensajesEnviados };
  } catch (err: any) {
    const detalle = [
      err?.message ? `Mensaje: ${err.message}` : "",
      err?.status ? `Status: ${err.status}` : "",
      err?.code ? `Código: ${err.code}` : "",
      err?.error?.message ? `Detalle API: ${err.error.message}` : "",
      err?.cause?.code ? `Causa: ${err.cause.code}` : "",
    ].filter(Boolean).join(" · ") || String(err);
    await ctx.traza("error", detalle);
    await query(`UPDATE ejecuciones SET estado='fallida', turnos_usados=$1, tool_calls=$2, mensajes=NULL, fin=now() WHERE id=$3`, [e.turnos, e.toolCalls, e.ejId]);
    return { ok: false, estado: "fallida", respuesta: `Hubo un error: ${detalle}`, ejecucionId: e.ejId, conversacionId: e.conversacionId, turnos: e.turnos, toolCalls: e.toolCalls, mensajesEnviados: e.mensajesEnviados };
  }
}

/**
 * Consume e.pendientes en orden. Si una requiere aprobación y no tiene
 * decisión, persiste todo y devuelve el resultado de pausa. Si no, null.
 */
async function procesarPendientes(e: Estado, invocables: Map<string, Invocable>, ctx: ContextoEjecucion): Promise<ResultadoTarea | null> {
  const nombres = [...invocables.keys()];
  while (e.pendientes.length) {
    const tc = e.pendientes[0];

    if (esPseudoToolModulo(tc.nombre)) {
      const m = String(tc.argumentos.modulo || "").toLowerCase().trim();
      const existe = [...invocables.keys()].some((n) => moduloDe(n) === m);
      if (existe && e.modulosActivos) { e.modulosActivos.add(m); await ctx.traza("tool", `módulo cargado: ${m}`); }
      e.mensajes.push({ role: "tool", tool_call_id: tc.id, content: existe ? `Módulo ${m} cargado: ${[...invocables.keys()].filter((n) => moduloDe(n) === m).join(", ")}. Ya podés llamar esas herramientas.` : `No existe el módulo "${m}". Módulos: ${[...new Set([...invocables.keys()].map(moduloDe))].join(", ")}.` });
      e.pendientes.shift();
      continue;
    }

    const inv = invocables.get(tc.nombre);

    if (!inv) {
      // ¿Existe en el registro pero la tiene otro agente? → indicar a quién delegar.
      const existeGlobal = registro.tool(tc.nombre) || registro.skill(tc.nombre) || registro.flujo(tc.nombre);
      if (existeGlobal && invocables.has("agente_delegar")) {
        // Las asignaciones viven en agentes.tools/skills/flujos como {items:[nombres], ids:[...]}.
        const duenos = await query<{ nombre: string }>(`SELECT nombre FROM agentes WHERE estado='activo' AND id<>$2 AND (
            (tools->'items') ? $1 OR (skills->'items') ? $1 OR (flujos->'items') ? $1)`, [tc.nombre, e.agenteId]).catch(() => [] as any);
        const quien = (duenos as { nombre: string }[]).map((d) => d.nombre);
        e.mensajes.push({ role: "tool", tool_call_id: tc.id, content: `'${tc.nombre}' existe pero NO es tuya: ${quien.length ? `la tiene ${quien.join(" y ")}` : "no está asignada a nadie"}. ${quien.length ? `Delegá con agente_delegar(agente: "${quien[0]}", tarea: <el pedido completo con contexto y archivo_ids>, esperar: false) y avisale al jefe que se lo pasaste.` : "Pedile al jefe que la asigne (registro_asignar)."}` });
        await ctx.traza("verificacion", `Intentó ${tc.nombre} (de ${quien.join("/") || "nadie"}); se le indicó delegar.`);
        e.pendientes.shift();
        continue;
      }
      const parecidas = masParecidas(tc.nombre, nombres, 3);
      e.mensajes.push({ role: "tool", tool_call_id: tc.id, content: `La herramienta '${tc.nombre}' NO existe.${parecidas.length ? ` ¿Quisiste decir ${parecidas.map((x) => `'${x}'`).join(" o ")}? Usá el nombre exacto.` : ""} Herramientas disponibles: ${nombres.join(", ") || "(ninguna)"}.` });
      await ctx.traza("error", `Tool call a nombre inexistente: ${tc.nombre}${parecidas.length ? " (parecidas: " + parecidas.join(", ") + ")" : ""}`);
      e.pendientes.shift();
      continue;
    }

    // ── 3. Bucle mecánico: misma tool con los mismos argumentos, dos veces seguidas ──
    const firmaTc = `${tc.nombre}|${JSON.stringify(tc.argumentos || {})}`;
    e.firmasRecientes = e.firmasRecientes || [];
    const repetida = e.firmasRecientes.length && e.firmasRecientes[e.firmasRecientes.length - 1] === firmaTc;
    const vecesSeguidas = repetida ? (e.repeticionesSeguidas || 1) + 1 : 1;
    e.repeticionesSeguidas = vecesSeguidas;
    e.firmasRecientes.push(firmaTc); if (e.firmasRecientes.length > 20) e.firmasRecientes.shift();
    if (vecesSeguidas >= 2 && inv.riesgo !== "lectura" || vecesSeguidas >= 3) {
      e.mensajes.push({ role: "tool", tool_call_id: tc.id, content: `NO EJECUTADO: es la ${vecesSeguidas}ª vez seguida que llamás ${tc.nombre} con exactamente los mismos argumentos. Repetirlo no cambia el resultado. Cambiá de estrategia o reportale al jefe el error exacto que te devolvió antes.` });
      await ctx.traza("verificacion", `Bloqueada llamada repetida (${vecesSeguidas}x): ${tc.nombre}`);
      e.pendientes.shift();
      continue;
    }

    if (tc.decision === "rechazada") {
      e.mensajes.push({ role: "tool", tool_call_id: tc.id, content: `El humano RECHAZÓ ejecutar ${tc.nombre}. No la ejecutes ni la vuelvas a pedir. Continuá sin esa acción y explicale qué queda sin hacer.` });
      e.pendientes.shift();
      continue;
    }

    if (inv.requiereAprobacion && tc.decision !== "aprobada") {
      // ── PAUSA ──
      const detalle = detalleAprobacion(inv.nombre, tc.argumentos);
      const ap = await crearAprobacionTool({ agenteEjecucionId: e.ejId, agenteId: e.agenteId, conversacionId: e.conversacionId, tool: inv.nombre, args: tc.argumentos, detalle });
      await ctx.traza("aprobacion", `Esperando tu aprobación: ${detalle}`);
      import("./eventos.js").then(({ emitir }) => emitir("aprobacion.pendiente", { tool: inv.nombre, agente_id: e.agenteId, aprobacion_id: ap.id })).catch(() => {});
      await query(
        `UPDATE ejecuciones SET estado='esperando_aprobacion', mensajes=$1, pendientes=$2, turnos_usados=$3, tool_calls=$4, mensajes_enviados=$5 WHERE id=$6`,
        [JSON.stringify(e.mensajes), JSON.stringify(e.pendientes), e.turnos, e.toolCalls, JSON.stringify(e.mensajesEnviados), e.ejId]);
      return {
        ok: true, estado: "esperando_aprobacion", aprobacionId: ap.id,
        respuesta: textoAprobacion(inv.nombre, tc.argumentos),
        ejecucionId: e.ejId, conversacionId: e.conversacionId, turnos: e.turnos, toolCalls: e.toolCalls, mensajesEnviados: e.mensajesEnviados,
      };
    }

    // ── Límite duro de herramientas por tarea (gobierno.max_tool_calls) ──
    if (e.toolCalls >= e.maxToolCalls) {
      e.mensajes.push({ role: "tool", tool_call_id: tc.id, content: `Límite alcanzado: ya usaste ${e.maxToolCalls} llamadas a herramientas en esta tarea. No podés llamar más. Cerrá con lo que tenés y explicá qué quedó pendiente.` });
      await ctx.traza("verificacion", `Límite de ${e.maxToolCalls} tool calls alcanzado; se rechazó ${inv.nombre}.`);
      e.pendientes.shift();
      continue;
    }

    if (cancelada(e.conversacionId)) {
      await ctx.traza("verificacion", "Detenido por el jefe.");
      await query(`UPDATE ejecuciones SET estado='fallida', respuesta='cancelada', fin=now() WHERE id=$1`, [e.ejId]);
      return { ok: false, estado: "fallida", respuesta: "cancelada", ejecucionId: e.ejId, conversacionId: e.conversacionId, turnos: e.turnos, toolCalls: e.toolCalls, mensajesEnviados: e.mensajesEnviados };
    }

    // ── Modo simulado (evaluaciones): nada que escriba/ejecute se corre de verdad ──
    if (e.simulado && inv.riesgo !== "lectura") {
      e.toolCalls++;
      await ctx.traza("tool", `[SIMULADO] ${inv.nombre}(${JSON.stringify(tc.argumentos).slice(0, 200)})`);
      e.mensajes.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify({ ok: true, simulado: true, resumen: `(simulación) ${inv.nombre} se habría ejecutado con esos argumentos. Continuá como si hubiera salido bien.` }) });
      e.pendientes.shift();
      continue;
    }

    // ── Aviso previo si va a tardar (skills/tools largas por WhatsApp) ──
    // Solo lo que de verdad tarda: skills del Senior y sesiones de Claude Code.
    const esLargo = (inv.tipo === "skill" && (registro.skill(inv.nombre)?.timeoutSeg ?? 300) > 300) || inv.nombre === "codigo_ejecutar_claude" || inv.nombre === "codigo_abrir_sandbox";
    if (e.conversacionId && esLargo && !e.avisoLargoEnviado) {
      e.avisoLargoEnviado = true;
      const conv = await obtenerConversacion(e.conversacionId);
      if (conv?.canal === "whatsapp") {
        await entregarTexto(conv, inv.nombre.startsWith("senior_")
          ? "⏳ Voy con eso. Corre Claude Code sobre el proyecto y puede tardar varios minutos; te escribo apenas termine."
          : "⏳ Voy con eso, puede tardar unos minutos; te aviso cuando termine.");
      }
    }

    // ── Ejecutar ──
    e.toolCalls++;
    let resultado;
    if (inv.tipo === "flujo") {
      try {
        const f = await iniciarFlujo(inv.nombre, tc.argumentos, { agenteId: e.agenteId, conversacionId: e.conversacionId, origen: "agente" });
        const enMarcha = f.estado !== "completado" && f.estado !== "fallido";
        resultado = { ok: true, datos: { ejecucionId: f.ejecucionId, estado: f.estado }, resumen: `Flujo ${inv.nombre} ${f.estado === "completado" ? "completado" : f.estado === "fallido" ? `falló: ${f.error}` : `EN MARCHA (estado: ${f.estado}). El flujo hace TODO lo que sigue por su cuenta (pedir aprobaciones, integrar, recargar, avisar por este canal). NO hagas nada más al respecto ni llames otras herramientas: respondele al jefe en una línea que ya está en marcha y terminá tu turno.`}` };
        if (enMarcha) e.flujoLanzado = true;
      } catch (err: any) { resultado = { ok: false, error: err?.message || String(err) }; }
    } else if (inv.tipo === "skill") {
      resultado = await ejecutarSkill(inv.origen === "codigo" ? inv.nombre : inv.fila, tc.argumentos, ctx);
    } else {
      resultado = await ejecutarTool(inv.nombre, tc.argumentos, ctx);
    }

    await ctx.traza("tool", `${inv.nombre}(${JSON.stringify(tc.argumentos).slice(0, 200)}) → ${resultado.ok ? "ok" : "ERROR"} ${(resultado.resumen || resultado.error || JSON.stringify(resultado.datos ?? "")).slice(0, 300)}`);
    if (resultado.ok) {
      const textoEnviado = String(tc.argumentos.mensaje ?? tc.argumentos.texto ?? "");
      if (textoEnviado && inv.nombre.startsWith("whatsapp_enviar")) e.mensajesEnviados.push(textoEnviado);
    }
    e.mensajes.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(resultado).slice(0, 4000) });
    e.pendientes.shift();
  }
  return null;
}

// ─── System prompt ───────────────────────────────────────────────────────────
async function armarSistema(ag: any, invocables: Map<string, Invocable>, conv: Conversacion | undefined, contextoCanal?: string): Promise<string> {
  const id = ag.identidad || {};
  const nombres = [...invocables.keys()];
  const partes = [
    id.nombre ? `Sos ${id.nombre}.` : "",
    id.mision ? `Misión: ${id.mision}` : "",
    id.personalidad ? `Personalidad: ${id.personalidad}` : "",
    id.terminado ? `Considerás una tarea terminada cuando: ${id.terminado}` : "",
    id.reglas_duras ? `Reglas que NUNCA rompés: ${id.reglas_duras}` : "",
    id.cuando_preguntar ? `Pedís aclaración en vez de asumir cuando: ${id.cuando_preguntar}` : "",
    id.ejemplos ? `Ejemplos de cómo resolvés pedidos:\n${id.ejemplos}` : "",
    conv ? `Canal: ${conv.canal === "panel" ? "chat del panel de control" : `WhatsApp, contacto ${conv.contacto}`}. Tu respuesta final de texto es lo que le llega a la persona por ese canal: escribí directamente para ella, sin reportes técnicos.` : "",
    conv?.canal === "whatsapp" ? `FORMATO WHATSAPP: sin tablas, sin encabezados con #, sin bloques de código; solo *negrita*, _cursiva_ y listas con guiones. Máximo ~15 líneas por mensaje. Si el resultado de una herramienta es un informe largo, mandá un RESUMEN de lo importante (5-10 líneas con lo accionable) y terminá con una pregunta corta tipo "¿te mando el detalle completo?". Si lo pide, entonces sí mandá el informe completo (podés partirlo en varios mensajes).` : "",
    contextoCanal || "",
    nombres.length
      ? `Tenés ${nombres.length} herramientas agrupadas en módulos: ${resumenModulos(invocables)}. En cada tarea se te cargan los módulos relevantes; si te falta uno, llamá modulo_cargar(modulo) y sus herramientas aparecen. Usá solo nombres exactos de tu lista, con los parámetros que declaran. Nunca preguntes si podés: llamá la herramienta; cuando algo necesita OK del jefe, el sistema lo pide solo.`
      : "No tenés herramientas asignadas: solo podés responder con texto.",
    "Usás tus herramientas de verdad cuando hacen falta. Nunca afirmes haber hecho algo (enviar, consultar) sin haber llamado la herramienta correspondiente. Si una herramienta devuelve error, leelo y corregí los argumentos o explicá el problema. Sé honesto.",
    "REGLA DE ESTADO ACTUAL: cualquier pregunta sobre cómo están las cosas AHORA (qué hay en pantalla, qué archivos hay, qué campañas/envíos/procesos existen, cómo va algo) se responde llamando la herramienta en ESTE turno. Lo que viste en turnos anteriores ya no vale. Y el resultado es lo que la herramienta DEVUELVE, nunca lo que vos pusiste en sus argumentos: no inventes datos en los argumentos.",
    "REGLA DE APROBACIONES: no pidas permiso por texto. Si una acción requiere aprobación, llamá la herramienta igual: el sistema pausa y le pide el OK al jefe por su canal. Preguntar '¿procedo?' y no llamar nada deja la tarea a medias.",
    "REGLA DE FUENTE: cuando una herramienta devuelve un resultado (informe, datos, estado), tu respuesta se basa SOLO en ese resultado. No mezcles con lo que dijiste antes en la conversación ni con lo que creés recordar del sistema: lo anterior puede estar desactualizado; el resultado de la herramienta es la verdad actual.",
  ].filter(Boolean).join("\n");

  const memoriaLp = (ag.memoria?.modo === "persistente") ? await memoriaParaPrompt(60) : "";
  const contexto = await contextoDeAgente(ag.id);
  return [
    partes,
    memoriaLp ? `=== LO QUE SABÉS DE LARGO PLAZO (memoria persistente; usalo con naturalidad, sin recitarlo) ===\n${memoriaLp}\n=== FIN MEMORIA ===` : "",
    contexto ? `=== CONTEXTO / DOCUMENTOS ===\n${contexto}\n=== FIN ===` : "",
  ].filter(Boolean).join("\n\n");
}


// ─── Similitud simple para sugerir nombres de herramientas ───────────────────
function distancia(a: string, b: string): number {
  const m = a.length, n = b.length; const d: number[][] = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[m][n];
}
function masParecidas(nombre: string, candidatos: string[], n: number): string[] {
  const base = nombre.toLowerCase().replace(/^(browser|web|navigator|window)_/, "navegador_").replace(/[^a-z0-9_]/g, "");
  return candidatos
    .map((c) => ({ c, s: distancia(base, c) / Math.max(base.length, c.length) + (c.split("_")[1] && base.includes(c.split("_")[1]) ? -0.3 : 0) + (c.split("_")[0] && base.startsWith(c.split("_")[0]) ? -0.2 : 0) }))
    .sort((a, b) => a.s - b.s).filter((x) => x.s < 0.7).slice(0, n).map((x) => x.c);
}