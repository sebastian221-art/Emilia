import { Router } from "express";
import { listarAgentes, obtenerAgente, actualizarAgente, asignarSkills, skillsDeAgente, asignarTools, toolsDeAgente } from "../dominio/agentes.js";

export const rutasAgentes = Router();

// Lista todos los agentes (para la grilla).
rutasAgentes.get("/api/agentes", async (_req, res, next) => {
  try {
    res.json(await listarAgentes());
  } catch (e) { next(e); }
});

// Tools que tiene asignadas un agente.
rutasAgentes.get("/api/agentes/:id/tools", async (req, res, next) => {
  try { res.json(await toolsDeAgente(req.params.id)); } catch (e) { next(e); }
});

// Asignar tools a un agente.
rutasAgentes.put("/api/agentes/:id/tools", async (req, res, next) => {
  try {
    await asignarTools(req.params.id, req.body.toolIds || []);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Guardar posición en el lienzo.
rutasAgentes.put("/api/agentes/:id/posicion", async (req, res, next) => {
  try {
    const { query } = await import("../db/cliente.js");
    await query(`UPDATE agentes SET pos_x=$1, pos_y=$2 WHERE id=$3`, [Math.round(req.body.x), Math.round(req.body.y), req.params.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Skills que tiene asignadas un agente (completas).
rutasAgentes.get("/api/agentes/:id/skills", async (req, res, next) => {
  try { res.json(await skillsDeAgente(req.params.id)); } catch (e) { next(e); }
});

// Asignar skills a un agente (por IDs de la biblioteca).
rutasAgentes.put("/api/agentes/:id/skills", async (req, res, next) => {
  try {
    console.log(`[skills] Asignando a agente ${req.params.id}:`, req.body.skillIds);
    await asignarSkills(req.params.id, req.body.skillIds || []);
    const [check] = await (await import("../db/cliente.js")).query(`SELECT skills FROM agentes WHERE id=$1`, [req.params.id]);
    console.log(`[skills] Guardado confirmado:`, JSON.stringify(check?.skills));
    res.json({ ok: true, guardado: check?.skills });
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

// Editar un agente (cambiar estado, piezas, etc.).
rutasAgentes.patch("/api/agentes/:id", async (req, res, next) => {
  try {
    res.json(await actualizarAgente(req.params.id, req.body));
  } catch (e) { next(e); }
});