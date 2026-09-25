// ARCHIVO: src/rutas/agentes.ts
import { Router } from "express";
import {
  listarAgentes, obtenerAgente, actualizarAgente, borrarAgente,
  asignarSkills, skillsDeAgente, asignarTools, toolsDeAgente, asignarFlujos, flujosDeAgente,
} from "../dominio/agentes.js";
import { query } from "../db/cliente.js";

export const rutasAgentes = Router();

// Lista todos los agentes (para la grilla).
rutasAgentes.get("/api/agentes", async (_req, res, next) => {
  try { res.json(await listarAgentes()); } catch (e) { next(e); }
});

// ── Asignaciones desde la biblioteca (registro) ──
rutasAgentes.get("/api/agentes/:id/tools", async (req, res, next) => {
  try { res.json(await toolsDeAgente(req.params.id)); } catch (e) { next(e); }
});
rutasAgentes.put("/api/agentes/:id/tools", async (req, res, next) => {
  try { await asignarTools(req.params.id, req.body.toolIds || []); res.json({ ok: true }); } catch (e) { next(e); }
});
rutasAgentes.get("/api/agentes/:id/skills", async (req, res, next) => {
  try { res.json(await skillsDeAgente(req.params.id)); } catch (e) { next(e); }
});
rutasAgentes.put("/api/agentes/:id/skills", async (req, res, next) => {
  try { await asignarSkills(req.params.id, req.body.skillIds || []); res.json({ ok: true }); } catch (e) { next(e); }
});
rutasAgentes.get("/api/agentes/:id/flujos", async (req, res, next) => {
  try { res.json(await flujosDeAgente(req.params.id)); } catch (e) { next(e); }
});
rutasAgentes.put("/api/agentes/:id/flujos", async (req, res, next) => {
  try { await asignarFlujos(req.params.id, req.body.flujoIds || []); res.json({ ok: true }); } catch (e) { next(e); }
});

// Guardar posición en el lienzo de "Ver agentes".
rutasAgentes.put("/api/agentes/:id/posicion", async (req, res, next) => {
  try {
    await query(`UPDATE agentes SET pos_x=$1, pos_y=$2 WHERE id=$3`, [Math.round(req.body.x), Math.round(req.body.y), req.params.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Un agente puntual (para su espacio interno).
rutasAgentes.get("/api/agentes/:id", async (req, res, next) => {
  try {
    const a = await obtenerAgente(req.params.id);
    if (!a) return res.status(404).json({ error: "Agente no encontrado" });
    res.json(a);
  } catch (e) { next(e); }
});
rutasAgentes.delete("/api/agentes/:id", async (req, res, next) => {
  try { await borrarAgente(req.params.id); res.json({ ok: true }); } catch (e) { next(e); }
});
// Editar un agente (estado, piezas del esqueleto).
rutasAgentes.patch("/api/agentes/:id", async (req, res, next) => {
  try { res.json(await actualizarAgente(req.params.id, req.body)); } catch (e) { next(e); }
});