// ARCHIVO: src/rutas/chat.ts
import { Router } from "express";
import { mensajesDe, pasosDeUltimaEjecucion } from "../dominio/chat.js";
import { obtenerOCrearConversacion, conversacionesDeAgente, obtenerConversacion, guardarMensajeEn, ultimosMensajes } from "../dominio/conversaciones.js";
import { correrTarea } from "../motor/loop.js";
import { encolar } from "../motor/cola.js";
import { entregarRespuesta } from "../motor/entrega.js";
import { query } from "../db/cliente.js";

export const rutasChat = Router();

// Historial de mensajes de un agente (todas sus conversaciones; la UI actual lo muestra así).
rutasChat.get("/api/agentes/:id/mensajes", async (req, res, next) => {
  try { res.json(await mensajesDe(req.params.id)); } catch (e) { next(e); }
});

// Pasos (razonamiento/trazas) de la última ejecución.
rutasChat.get("/api/agentes/:id/pasos", async (req, res, next) => {
  try { res.json(await pasosDeUltimaEjecucion(req.params.id)); } catch (e) { next(e); }
});

// Conversaciones del agente (panel + cada número de WhatsApp).
rutasChat.get("/api/agentes/:id/conversaciones", async (req, res, next) => {
  try { res.json(await conversacionesDeAgente(req.params.id)); } catch (e) { next(e); }
});

// Mensajes de una conversación puntual.
rutasChat.get("/api/conversaciones/:id/mensajes", async (req, res, next) => {
  try {
    const conv = await obtenerConversacion(req.params.id);
    if (!conv) return res.status(404).json({ error: "Conversación no encontrada" });
    res.json(await ultimosMensajes(conv.id, Number(req.query.limite) || 200));
  } catch (e) { next(e); }
});

// Ejecuciones recientes de un agente (para la pestaña Trazas).
rutasChat.get("/api/agentes/:id/ejecuciones", async (req, res, next) => {
  try {
    res.json(await query(
      `SELECT id, estado, origen, conversacion_id, turnos_usados, tool_calls, respuesta, inicio, fin
       FROM ejecuciones WHERE agente_id=$1 ORDER BY inicio DESC LIMIT $2`,
      [req.params.id, Number(req.query.limite) || 30]));
  } catch (e) { next(e); }
});
rutasChat.get("/api/ejecuciones/:id/pasos", async (req, res, next) => {
  try { res.json(await query(`SELECT tipo, detalle, creado_en FROM pasos WHERE ejecucion_id=$1 ORDER BY creado_en ASC`, [req.params.id])); } catch (e) { next(e); }
});

// Enviar un mensaje desde el panel: conversación 'panel', en cola, con memoria.
rutasChat.post("/api/agentes/:id/chat", async (req, res, next) => {
  try {
    const { mensaje } = req.body;
    if (!mensaje?.trim()) return res.status(400).json({ error: "Mensaje vacío" });

    const conv = await obtenerOCrearConversacion(req.params.id, "panel", "panel");
    const resultado = await encolar(conv.id, async () => {
      await guardarMensajeEn(conv, "usuario", mensaje);
      const r = await correrTarea(req.params.id, mensaje, { conversacionId: conv.id, origen: "panel" });
      await entregarRespuesta(conv, r);
      return r;
    });

    res.json({
      ok: resultado.ok, estado: resultado.estado, respuesta: resultado.respuesta,
      ejecucionId: resultado.ejecucionId, aprobacionId: resultado.aprobacionId,
    });
  } catch (e) { next(e); }
});