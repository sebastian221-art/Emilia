import { Router } from "express";
import { crearFlujo, listarFlujos, obtenerFlujo, actualizarFlujo, borrarFlujo } from "../dominio/flujos.js";
import { ejecutarFlujo, reanudarFlujo } from "../motor/flujo.js";
import { aprobacionesPendientes, resolverAprobacion } from "../dominio/aprobaciones.js";

export const rutasFlujos = Router();

rutasFlujos.get("/api/flujos", async (_req, res, next) => {
  try { res.json(await listarFlujos()); } catch (e) { next(e); }
});
rutasFlujos.get("/api/flujos/:id", async (req, res, next) => {
  try {
    const f = await obtenerFlujo(req.params.id);
    if (!f) return res.status(404).json({ error: "Flujo no encontrado" });
    res.json(f);
  } catch (e) { next(e); }
});
rutasFlujos.post("/api/flujos", async (req, res, next) => {
  try { res.json(await crearFlujo(req.body)); } catch (e) { next(e); }
});
rutasFlujos.patch("/api/flujos/:id", async (req, res, next) => {
  try { res.json(await actualizarFlujo(req.params.id, req.body)); } catch (e) { next(e); }
});
rutasFlujos.delete("/api/flujos/:id", async (req, res, next) => {
  try { await borrarFlujo(req.params.id); res.json({ ok: true }); } catch (e) { next(e); }
});

// Ejecutar un flujo (opcionalmente con un agente que ejecute las acciones).
rutasFlujos.post("/api/flujos/:id/ejecutar", async (req, res, next) => {
  try { res.json(await ejecutarFlujo(req.params.id, req.body.agenteId || null, req.body.contexto || {})); } catch (e) { next(e); }
});

// Ver el estado/log de una ejecución de flujo.
rutasFlujos.get("/api/flujo-ejecuciones/:id", async (req, res, next) => {
  try {
    const { query } = await import("../db/cliente.js");
    const [ej] = await query(`SELECT * FROM flujo_ejecuciones WHERE id=$1`, [req.params.id]);
    res.json(ej || { error: "no encontrada" });
  } catch (e) { next(e); }
});

// ── Aprobaciones ──
rutasFlujos.get("/api/aprobaciones", async (_req, res, next) => {
  try { res.json(await aprobacionesPendientes()); } catch (e) { next(e); }
});
rutasFlujos.post("/api/aprobaciones/:id/resolver", async (req, res, next) => {
  try {
    const aprobada = !!req.body.aprobada;
    const { ejecucion_id } = await resolverAprobacion(req.params.id, aprobada);
    // Si la aprobación era de un flujo, lo reanudamos.
    if (ejecucion_id) await reanudarFlujo(ejecucion_id, aprobada);
    res.json({ ok: true });
  } catch (e) { next(e); }
});