// ARCHIVO: src/rutas/flujos.ts
import { Router } from "express";
import { listarFlujos, obtenerFlujo, borrarFlujo, ejecucionesDeFlujos, ejecucionDeFlujo } from "../dominio/flujos.js";
import { iniciarFlujo, reanudarFlujo } from "../motor/flujo.js";
import { aprobacionesPendientes, resolverAprobacion, obtenerAprobacion } from "../dominio/aprobaciones.js";
import { reanudarEjecucion } from "../motor/loop.js";
import { entregarRespuesta } from "../motor/entrega.js";
import { encolar } from "../motor/cola.js";
import { registro, serializarFlujo } from "../registro/registro.js";

export const rutasFlujos = Router();

rutasFlujos.get("/api/flujos", async (_req, res, next) => {
  try { res.json(await listarFlujos()); } catch (e) { next(e); }
});
rutasFlujos.get("/api/flujos/:id", async (req, res, next) => {
  try {
    const f = await obtenerFlujo(req.params.id);
    if (!f) return res.status(404).json({ error: "Flujo no encontrado" });
    const def = registro.flujo(f.nombre);
    res.json({ ...f, definicion: def ? serializarFlujo(def) : f.definicion });
  } catch (e) { next(e); }
});
rutasFlujos.delete("/api/flujos/:id", async (req, res, next) => {
  try { await borrarFlujo(req.params.id); res.json({ ok: true }); } catch (e) { next(e); }
});

/** Iniciar un flujo. Body: { args, agenteId?, conversacionId? } */
rutasFlujos.post("/api/flujos/:id/ejecutar", async (req, res, next) => {
  try {
    const r = await iniciarFlujo(req.params.id, req.body?.args || req.body?.contexto || {}, {
      agenteId: req.body?.agenteId || null, conversacionId: req.body?.conversacionId || null, origen: "panel",
    });
    res.json(r);
  } catch (e) { next(e); }
});

rutasFlujos.get("/api/flujo-ejecuciones", async (req, res, next) => {
  try { res.json(await ejecucionesDeFlujos({ flujoId: req.query.flujoId as string, agenteId: req.query.agenteId as string, limite: Number(req.query.limite) || 30 })); } catch (e) { next(e); }
});
rutasFlujos.get("/api/flujo-ejecuciones/:id", async (req, res, next) => {
  try {
    const ej = await ejecucionDeFlujo(req.params.id);
    if (!ej) return res.status(404).json({ error: "no encontrada" });
    res.json(ej);
  } catch (e) { next(e); }
});

// ── Aprobaciones (de tools en ejecuciones de agente, y de flujos) ──
rutasFlujos.get("/api/aprobaciones", async (_req, res, next) => {
  try { res.json(await aprobacionesPendientes()); } catch (e) { next(e); }
});

rutasFlujos.post("/api/aprobaciones/:id/resolver", async (req, res, next) => {
  try {
    const aprobada = !!req.body.aprobada;
    const previa = await obtenerAprobacion(req.params.id);
    if (!previa) return res.status(404).json({ error: "Aprobación no encontrada" });
    if (previa.estado !== "pendiente") return res.status(409).json({ error: `Ya estaba ${previa.estado}.` });
    const ap = await resolverAprobacion(previa.id, aprobada);
    if (!ap) return res.status(409).json({ error: "No se pudo resolver (¿ya resuelta?)." });

    if (ap.tipo === "tool" && ap.agente_ejecucion_id) {
      const clave = ap.conversacion_id || ap.agente_ejecucion_id;
      const r = await encolar(clave, async () => {
        const r = await reanudarEjecucion(ap.agente_ejecucion_id!, aprobada);
        if (ap.conversacion_id) await entregarRespuesta(ap.conversacion_id, r);
        return r;
      });
      return res.json({ ok: true, tipo: "tool", estado: r.estado, respuesta: r.respuesta, ejecucionId: r.ejecucionId, aprobacionId: r.aprobacionId });
    }
    if (ap.tipo === "flujo" && ap.ejecucion_id) {
      const r = await reanudarFlujo(ap.ejecucion_id, aprobada);
      return res.json({ ok: true, tipo: "flujo", ...r });
    }
    res.json({ ok: true });
  } catch (e) { next(e); }
});