// ARCHIVO: src/rutas/registro.ts
import { Router } from "express";
import { serializarTodo, registro, validarArgs } from "../registro/registro.js";
import { ejecutarTool, ejecutarSkill, crearContexto } from "../motor/ejecutor.js";

export const rutasRegistro = Router();

/** Catálogo completo de lo que existe en código (para la UI espejo). */
rutasRegistro.get("/api/registro", (_req, res) => {
  res.json(serializarTodo());
});

/** Una tool puntual, con su schema. */
rutasRegistro.get("/api/registro/tools/:nombre", (req, res) => {
  const t = registro.tool(req.params.nombre);
  if (!t) return res.status(404).json({ error: "Tool no registrada" });
  res.json(serializarTodo().tools.find((x) => x.nombre === t.nombre));
});

/**
 * Probar una tool desde la UI, con argumentos reales.
 * Body: { args: {...} }. Valida contra el schema antes de ejecutar.
 * Las que requieren aprobación piden confirmación explícita ({ confirmado: true }):
 * la página muestra qué se va a ejecutar y el humano confirma.
 */
rutasRegistro.post("/api/registro/tools/:nombre/probar", async (req, res, next) => {
  try {
    const t = registro.tool(req.params.nombre);
    if (!t) return res.status(404).json({ error: "Tool no registrada" });
    if (t.requiereAprobacion && req.body?.confirmado !== true) return res.status(409).json({ ok: false, requiereConfirmacion: true, error: `${t.nombre} requiere aprobación (riesgo: ${t.riesgo}). Confirmá para ejecutarla.` });
    const val = validarArgs(t.parametros, req.body?.args || {});
    if (!val.ok) return res.status(400).json({ ok: false, error: "Argumentos inválidos", errores: val.errores });
    const inicio = Date.now();
    const r = await ejecutarTool(t.nombre, val.valor, crearContexto(null, null));
    res.json({ ...r, duracion_ms: Date.now() - inicio });
  } catch (e) { next(e); }
});

/** Probar una skill desde la UI: de código o guiada creada en la página Skills (el ejecutor resuelve cuál). */
rutasRegistro.post("/api/registro/skills/:nombre/probar", async (req, res, next) => {
  try {
    const sk = registro.skill(req.params.nombre);
    if (sk?.requiereAprobacion && req.body?.confirmado !== true) return res.status(409).json({ ok: false, requiereConfirmacion: true, error: `${sk.nombre} requiere aprobación (riesgo: ${sk.riesgo}). Confirmá para ejecutarla.` });
    const inicio = Date.now();
    const r = await ejecutarSkill(req.params.nombre, req.body?.args || {}, crearContexto(null, null));
    res.json({ ...r, duracion_ms: Date.now() - inicio });
  } catch (e) { next(e); }
});