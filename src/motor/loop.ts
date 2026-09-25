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
import { historialParaModelo, resumirSiHaceFalta } from "./memoria.js";
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
  origen?: "panel" | "whatsapp" | "flujo" | "api";
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
}

// ─── Arranque ────────────────────────────────────────────────────────────────
export async function correrTarea(agenteId: string, mensajeUsuario: string, op: OpcionesTarea = {}): Promise<ResultadoTarea> {
  const ag = await obtenerAgente(agenteId);
  if (!ag) throw new Error("Agente no encontrado");
  if (ag.estado !== "activo") throw new Error(`El agente está en estado '${ag.estado}'. Activalo para que trabaje.`);
  if (!process.env.GROQ_API_KEY) throw new Error("Falta GROQ_API_KEY en el .env de emilia. Agregala y reiniciá el servidor.");

  const conv = op.conversacionId ? await obtenerConversacion(op.conversacionId) : undefined;
  const { definiciones: tools, invocables } = await herramientasDeAgente(agenteId);
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
    mensajes, pendientes: [], turnos: 0, toolCalls: 0, mensajesEnviados: [],
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
  if (conv && r.estado !== "esperando_aprobacion") resumirSiHaceFalta(conv, ag.memoria).catch(() => {});
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
  const { definiciones: tools, invocables } = await herramientasDeAgente(fila.agente_id);

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
    mensajesEnviados: fila.mensajes_enviados || [],
  };
  const ctx = crearContexto(estado.agenteId, estado.ejId, null, estado.conversacionId);
  await ctx.traza("aprobacion", aprobada ? `Aprobado: ${pendientes[0].nombre}. Continúa.` : `Rechazado: ${pendientes[0].nombre}. Continúa sin ejecutarla.`);
  await query(`UPDATE ejecuciones SET estado='en_curso' WHERE id=$1`, [estado.ejId]);

  const r = await bucle(estado, tools, invocables, ctx);
  if (estado.conversacionId && r.estado !== "esperando_aprobacion") {
    const conv = await obtenerConversacion(estado.conversacionId);
    if (conv) resumirSiHaceFalta(conv, ag.memoria).catch(() => {});
  }
  return r;
}

// ─── El bucle ────────────────────────────────────────────────────────────────
async function bucle(e: Estado, tools: ChatCompletionTool[], invocables: Map<string, Invocable>, ctx: ContextoEjecucion): Promise<ResultadoTarea> {
  const ag = e.ag;
  let respuestaFinal = "";

  try {
    while (true) {
      // 1. Procesar tool calls pendientes (del turno actual o de una reanudación).
      const pausa = await procesarPendientes(e, invocables, ctx);
      if (pausa) return pausa;

      // 2. Presupuesto.
      if (e.turnos >= e.maxTurnos) {
        respuestaFinal = "Me quedé sin presupuesto de turnos para esta tarea. Contame si querés que siga con más.";
        await ctx.traza("verificacion", `Presupuesto de ${e.maxTurnos} turnos agotado.`);
        break;
      }

      // 3. Siguiente turno con el modelo.
      e.turnos++;
      const r = await llamarModelo(e.mensajes, tools, { modelo: e.modelo, temperatura: e.temperatura });
      if (r.razonamiento && ag.pensar_voz_alta?.visible) await ctx.traza("pensamiento", r.razonamiento);

      const asistente: any = { role: "assistant", content: r.texto || null };
      if (r.toolCalls.length) {
        asistente.tool_calls = r.toolCalls.map((t) => ({ id: t.id, type: "function", function: { name: t.nombre, arguments: JSON.stringify(t.argumentos) } }));
      }
      e.mensajes.push(asistente);

      if (!r.toolCalls.length) {
        respuestaFinal = r.texto;
        const afirma = /(envi[eé]|mand[eé]|consult[eé]|ejecut|llam[eé])/i.test(respuestaFinal);
        if (afirma && e.toolCalls === 0 && (ag.trazas?.verifica ?? true)) {
          await ctx.traza("verificacion", "El agente afirma haber hecho acciones pero no usó ninguna herramienta real.");
        } else {
          await ctx.traza("verificacion", `Completado con ${e.toolCalls} llamada(s) real(es) a herramientas.`);
        }
        break;
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
    const inv = invocables.get(tc.nombre);

    if (!inv) {
      e.mensajes.push({ role: "tool", tool_call_id: tc.id, content: `La herramienta '${tc.nombre}' no existe. Tus herramientas disponibles son: ${nombres.join(", ") || "(ninguna)"}. Usá una de esas con su nombre exacto.` });
      await ctx.traza("error", `Tool call a nombre inexistente: ${tc.nombre}`);
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
      const detalle = `${inv.nombre}(${JSON.stringify(tc.argumentos)})`;
      const ap = await crearAprobacionTool({ agenteEjecucionId: e.ejId, agenteId: e.agenteId, conversacionId: e.conversacionId, tool: inv.nombre, args: tc.argumentos, detalle });
      await ctx.traza("aprobacion", `Esperando tu aprobación para ${detalle}`);
      await query(
        `UPDATE ejecuciones SET estado='esperando_aprobacion', mensajes=$1, pendientes=$2, turnos_usados=$3, tool_calls=$4, mensajes_enviados=$5 WHERE id=$6`,
        [JSON.stringify(e.mensajes), JSON.stringify(e.pendientes), e.turnos, e.toolCalls, JSON.stringify(e.mensajesEnviados), e.ejId]);
      return {
        ok: true, estado: "esperando_aprobacion", aprobacionId: ap.id,
        respuesta: `⏸ Necesito tu aprobación para ejecutar *${inv.nombre}* con: ${JSON.stringify(tc.argumentos)}.\nRespondé "ok" para aprobar o "no" para rechazar (o resolvelo desde el panel de Aprobaciones).`,
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

    // ── Aviso previo si va a tardar (skills/tools largas por WhatsApp) ──
    const tSeg = inv.tipo === "skill" ? (registro.skill(inv.nombre)?.timeoutSeg ?? 300) : inv.tipo === "tool" ? (registro.tool(inv.nombre)?.timeoutSeg ?? 30) : 0;
    if (e.conversacionId && tSeg > 120 && !e.avisoLargoEnviado) {
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
        resultado = { ok: true, datos: { ejecucionId: f.ejecucionId, estado: f.estado }, resumen: `Flujo ${inv.nombre} ${f.estado === "completado" ? "completado" : f.estado === "fallido" ? `falló: ${f.error}` : `iniciado (estado: ${f.estado}). Te avisa por este canal.`}` };
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
      ? `Tus herramientas reales son exactamente estas: ${nombres.join(", ")}. Usá solo esos nombres, con los parámetros que declaran. Si una requiere aprobación, pedila igual: el sistema pausa y pide el OK.`
      : "No tenés herramientas asignadas: solo podés responder con texto.",
    "Usás tus herramientas de verdad cuando hacen falta. Nunca afirmes haber hecho algo (enviar, consultar) sin haber llamado la herramienta correspondiente. Si una herramienta devuelve error, leelo y corregí los argumentos o explicá el problema. Sé honesto.",
  ].filter(Boolean).join("\n");

  const contexto = await contextoDeAgente(ag.id);
  return contexto ? `${partes}\n\n=== CONTEXTO / DOCUMENTOS ===\n${contexto}\n=== FIN ===` : partes;
}