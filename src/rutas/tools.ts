import { Router } from "express";
import { crearTool, listarTools, obtenerTool, actualizarTool, borrarTool, explorarTool } from "../dominio/tools.js";

export const rutasTools = Router();

rutasTools.get("/api/tools", async (_req, res, next) => {
  try { res.json(await listarTools()); } catch (e) { next(e); }
});
rutasTools.get("/api/tools/:id", async (req, res, next) => {
  try {
    const t = await obtenerTool(req.params.id);
    if (!t) return res.status(404).json({ error: "Tool no encontrada" });
    res.json(t);
  } catch (e) { next(e); }
});
rutasTools.post("/api/tools", async (req, res, next) => {
  try { res.json(await crearTool(req.body)); } catch (e) { next(e); }
});
rutasTools.patch("/api/tools/:id", async (req, res, next) => {
  try { res.json(await actualizarTool(req.params.id, req.body)); } catch (e) { next(e); }
});
rutasTools.delete("/api/tools/:id", async (req, res, next) => {
  try { await borrarTool(req.params.id); res.json({ ok: true }); } catch (e) { next(e); }
});
rutasTools.post("/api/tools/:id/analizar", async (req, res, next) => {
  try { res.json(await explorarTool(req.params.id)); } catch (e) { next(e); }
});