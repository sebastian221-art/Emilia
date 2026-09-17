import { Router } from "express";
import { crearSkill, listarSkills, obtenerSkill, actualizarSkill, borrarSkill } from "../dominio/skills.js";

export const rutasSkills = Router();

rutasSkills.get("/api/skills", async (_req, res, next) => {
  try { res.json(await listarSkills()); } catch (e) { next(e); }
});
rutasSkills.get("/api/skills/:id", async (req, res, next) => {
  try {
    const s = await obtenerSkill(req.params.id);
    if (!s) return res.status(404).json({ error: "Skill no encontrada" });
    res.json(s);
  } catch (e) { next(e); }
});
rutasSkills.post("/api/skills", async (req, res, next) => {
  try { res.json(await crearSkill(req.body)); } catch (e) { next(e); }
});
rutasSkills.patch("/api/skills/:id", async (req, res, next) => {
  try { res.json(await actualizarSkill(req.params.id, req.body)); } catch (e) { next(e); }
});
rutasSkills.delete("/api/skills/:id", async (req, res, next) => {
  try { await borrarSkill(req.params.id); res.json({ ok: true }); } catch (e) { next(e); }
});