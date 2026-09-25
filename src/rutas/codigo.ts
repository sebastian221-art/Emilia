// ARCHIVO: src/rutas/codigo.ts
import { Router } from "express";
import { listarProyectos, sandboxesAbiertos, sesionesRecientes, obtenerSesion, sesionesDeSandbox, obtenerSandbox } from "../dominio/proyectos.js";
import { diffSandbox } from "../motor/sandbox.js";
import { ejecutarTool, crearContexto } from "../motor/ejecutor.js";
import { cancelarSesion } from "../motor/claude-code.js";

export const rutasCodigo = Router();
const ctx = () => crearContexto(null, null);

rutasCodigo.get("/api/codigo/proyectos", async (_req, res, next) => { try { res.json(await listarProyectos()); } catch (e) { next(e); } });
rutasCodigo.post("/api/codigo/proyectos", async (req, res, next) => {
  try { const r = await ejecutarTool("codigo_registrar_proyecto", req.body || {}, ctx()); res.status(r.ok ? 200 : 400).json(r); } catch (e) { next(e); }
});

rutasCodigo.get("/api/codigo/sandboxes", async (_req, res, next) => { try { res.json(await sandboxesAbiertos()); } catch (e) { next(e); } });
rutasCodigo.get("/api/codigo/sandboxes/:id/diff", async (req, res, next) => {
  try {
    const s = await obtenerSandbox(req.params.id);
    if (!s) return res.status(404).json({ error: "Sandbox no encontrado" });
    res.json(await diffSandbox(s.ruta, s.proyecto.rama_base, Number(req.query.max) || 40000));
  } catch (e) { next(e); }
});
rutasCodigo.post("/api/codigo/sandboxes/:id/cerrar", async (req, res, next) => {
  try { const r = await ejecutarTool("codigo_cerrar_sandbox", { sandbox_id: req.params.id, borrar_rama: !!req.body?.borrar_rama }, ctx()); res.status(r.ok ? 200 : 400).json(r); } catch (e) { next(e); }
});

rutasCodigo.get("/api/codigo/sesiones", async (req, res, next) => {
  try { res.json(req.query.sandboxId ? await sesionesDeSandbox(String(req.query.sandboxId)) : await sesionesRecientes(Number(req.query.limite) || 30)); } catch (e) { next(e); }
});
rutasCodigo.get("/api/codigo/sesiones/:id", async (req, res, next) => {
  try { const s = await obtenerSesion(req.params.id); if (!s) return res.status(404).json({ error: "no encontrada" }); res.json(s); } catch (e) { next(e); }
});
rutasCodigo.post("/api/codigo/sesiones/:id/cancelar", async (req, res, next) => {
  try { res.json({ ok: await cancelarSesion(req.params.id) }); } catch (e) { next(e); }
});