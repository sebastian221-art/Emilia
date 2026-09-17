import { Router } from "express";
import { guardarMensaje, mensajesDe, pasosDeUltimaEjecucion } from "../dominio/chat.js";
import { correrTarea } from "../motor/loop.js";

export const rutasChat = Router();

// Historial de mensajes de un agente.
rutasChat.get("/api/agentes/:id/mensajes", async (req, res, next) => {
  try { res.json(await mensajesDe(req.params.id)); } catch (e) { next(e); }
});

// Pasos (razonamiento/trazas) de la última ejecución.
rutasChat.get("/api/agentes/:id/pasos", async (req, res, next) => {
  try { res.json(await pasosDeUltimaEjecucion(req.params.id)); } catch (e) { next(e); }
});

// Enviar un mensaje: se guarda, el motor lo procesa, se guarda la respuesta.
rutasChat.post("/api/agentes/:id/chat", async (req, res, next) => {
  try {
    const { mensaje } = req.body;
    if (!mensaje?.trim()) return res.status(400).json({ error: "Mensaje vacío" });

    await guardarMensaje(req.params.id, "usuario", mensaje);
    const resultado = await correrTarea(req.params.id, mensaje);
    await guardarMensaje(req.params.id, "agente", resultado.respuesta);

    res.json({ ok: resultado.ok, respuesta: resultado.respuesta, ejecucionId: resultado.ejecucionId });
  } catch (e) { next(e); }
});