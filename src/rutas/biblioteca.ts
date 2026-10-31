// ARCHIVO: src/rutas/biblioteca.ts
// API de la página Biblioteca: grafo, búsqueda, ficha, propuestas, papelera, edición.
import { Router } from "express";
import { query } from "../db/cliente.js";
import * as B from "../motor/biblioteca.js";
import { pedirAAgente } from "../motor/pedir.js";

export const rutasBiblioteca = Router();

rutasBiblioteca.get("/api/biblioteca/estado", async (_q, res, next) => { try { res.json(await B.estadisticas()); } catch (e) { next(e); } });
rutasBiblioteca.get("/api/biblioteca/grafo", async (req, res, next) => {
  try {
    const nodos = await query<any>(`SELECT id, slug, titulo, tipo, estado, confianza, fuerza, usos, etiquetas, actualizado_en FROM bib_nodos WHERE borrado_en IS NULL ORDER BY fuerza DESC LIMIT $1`, [Number(req.query.limite) || 400]);
    const ids = nodos.map((n) => n.id);
    const con = ids.length ? await query<any>(`SELECT origen_id, destino_id, relacion, peso FROM bib_conexiones WHERE origen_id = ANY($1::uuid[]) AND destino_id = ANY($1::uuid[])`, [ids]) : [];
    res.json({ nodos, conexiones: con });
  } catch (e) { next(e); }
});
rutasBiblioteca.get("/api/biblioteca/buscar", async (req, res, next) => { try { res.json(await B.buscarSemantico(String(req.query.q || ""), Number(req.query.limite) || 10)); } catch (e) { next(e); } });
rutasBiblioteca.get("/api/biblioteca/nodos/:id", async (req, res, next) => {
  try {
    const n = await B.nodoPorId(req.params.id); if (!n) return res.status(404).json({ error: "no existe" });
    const [vec, ev, usos] = await Promise.all([B.vecinos(n.id, 30), B.evidencias(n.id), query<any>(`SELECT u.*, a.nombre AS agente FROM bib_usos u LEFT JOIN agentes a ON a.id=u.agente_id WHERE u.nodo_id=$1 ORDER BY u.creado_en DESC LIMIT 30`, [n.id])]);
    const [ap] = n.aprendido_por ? await query<any>(`SELECT nombre FROM agentes WHERE id=$1`, [n.aprendido_por]) : [null];
    const [ve] = n.verificado_por ? await query<any>(`SELECT nombre FROM agentes WHERE id=$1`, [n.verificado_por]) : [null];
    const { embedding: _e, ...resto } = n as any;
    res.json({ ...resto, aprendido_por_nombre: ap?.nombre, verificado_por_nombre: ve?.nombre, vecinos: vec, evidencias: ev, usos_lista: usos });
  } catch (e) { next(e); }
});
rutasBiblioteca.put("/api/biblioteca/nodos/:id", async (req, res, next) => {
  try {
    const n = await B.nodoPorId(req.params.id); if (!n) return res.status(404).json({ error: "no existe" });
    const b = req.body || {};
    const actualizado = await B.crearOActualizarNodo({ slug: n.slug, titulo: b.titulo ?? n.titulo, tipo: b.tipo ?? n.tipo, resumen: b.resumen ?? n.resumen, ficha: b.ficha ?? n.ficha, estado: b.estado ?? n.estado, etiquetas: b.etiquetas ?? n.etiquetas });
    if (b.confianza != null) await query(`UPDATE bib_nodos SET confianza=$1 WHERE id=$2`, [Number(b.confianza), n.id]);
    res.json(actualizado);
  } catch (e) { next(e); }
});
rutasBiblioteca.delete("/api/biblioteca/nodos/:id", async (req, res, next) => { try { await query(`UPDATE bib_nodos SET borrado_en=now() WHERE id=$1`, [req.params.id]); res.json({ ok: true }); } catch (e) { next(e); } });
rutasBiblioteca.post("/api/biblioteca/nodos/:id/restaurar", async (req, res, next) => { try { await B.restaurar(req.params.id); res.json({ ok: true }); } catch (e) { next(e); } });
rutasBiblioteca.delete("/api/biblioteca/papelera/:id", async (req, res, next) => { try { await B.borrarDefinitivo(req.params.id); res.json({ ok: true }); } catch (e) { next(e); } });
rutasBiblioteca.get("/api/biblioteca/papelera", async (_q, res, next) => { try { res.json(await B.papelera()); } catch (e) { next(e); } });
rutasBiblioteca.get("/api/biblioteca/propuestas", async (_q, res, next) => { try { res.json(await B.propuestasPendientes()); } catch (e) { next(e); } });
rutasBiblioteca.post("/api/biblioteca/propuestas/:id", async (req, res, next) => { try { res.json(await B.resolverPropuesta(req.params.id, !!req.body?.aprobar)); } catch (e) { next(e); } });
rutasBiblioteca.get("/api/biblioteca/bandeja", async (_q, res, next) => { try { res.json(await B.entradasPendientes(100)); } catch (e) { next(e); } });
rutasBiblioteca.post("/api/biblioteca/conexiones", async (req, res, next) => { try { await B.conectar(req.body.origen, req.body.destino, req.body.relacion || "relacionado_con", { nota: req.body.nota }); res.json({ ok: true }); } catch (e) { next(e); } });
rutasBiblioteca.delete("/api/biblioteca/conexiones", async (req, res, next) => { try { await query(`DELETE FROM bib_conexiones WHERE origen_id=$1 AND destino_id=$2 AND relacion=$3`, [req.body.origen_id, req.body.destino_id, req.body.relacion]); res.json({ ok: true }); } catch (e) { next(e); } });
// El jefe pide trabajo sobre un nodo desde la página: refrescar (Soga), profundizar (System), verificar (Lara).
rutasBiblioteca.post("/api/biblioteca/nodos/:id/pedir", async (req, res, next) => {
  try {
    const n = await B.nodoPorId(req.params.id); if (!n) return res.status(404).json({ error: "no existe" });
    const accion = String(req.body?.accion || "");
    const tareas: Record<string, [string, string]> = {
      refrescar: ["Soga", `Refrescá el nodo "${n.titulo}" (slug ${n.slug}) de la biblioteca: buscá si hay información más nueva o que lo contradiga (fecha de hoy), leé al menos 2 fuentes y aportá lo nuevo con biblioteca_aportar indicando que es una actualización de ${n.slug}. Resumen actual: ${n.resumen}`],
      profundizar: ["System", `Aprendé a fondo "${n.titulo}" (slug ${n.slug} en la biblioteca): desglosalo, investigá lo que falte, probalo si se puede, reflexioná y mejorá la ficha (qué es, cómo funciona, cuándo usar, cuándo no, trampas, fórmula propia). Entregá lo aprendido a la biblioteca.`],
      verificar: ["Lara", `Verificá el nodo "${n.titulo}" (slug ${n.slug}): revisá sus evidencias, buscá contradicciones con otros nodos, decidí su estado y confianza, y conectalo con lo que corresponda. Si hace falta más evidencia, pedísela a Soga.`],
    };
    const t = tareas[accion]; if (!t) return res.status(400).json({ error: "accion inválida" });
    res.json({ ok: true, agente: await pedirAAgente(t[0], t[1]) });
  } catch (e: any) { res.status(400).json({ error: e?.message || String(e) }); }
});
rutasBiblioteca.post("/api/biblioteca/pedir", async (req, res, next) => {
  try {
    const accion = String(req.body?.accion || "");
    const tareas: Record<string, string> = {
      integrar: "Integrá todo lo que hay en la bandeja de la biblioteca (biblioteca_integrar_bandeja). Fusioná con nodos existentes cuando sea el mismo tema.",
      migrar: "Traé el conocimiento viejo a la bandeja (biblioteca_migrar) y después integralo (biblioteca_integrar_bandeja).",
      auditar: "Hacé una auditoría de la biblioteca (biblioteca_auditar): duplicados, nodos sin evidencia, contradicciones, cosas viejas. Dejá tus propuestas para que el jefe las apruebe.",
    };
    const t = tareas[accion]; if (!t) return res.status(400).json({ error: "accion inválida" });
    res.json({ ok: true, agente: await pedirAAgente("Lara", t) });
  } catch (e: any) { res.status(400).json({ error: e?.message || String(e) }); }
});
// El jefe aporta directamente (va a la bandeja como origen 'jefe').
rutasBiblioteca.post("/api/biblioteca/aportar", async (req, res, next) => { try { const id = await B.aportar({ titulo: req.body.titulo, contenido: req.body.contenido, origen: "jefe", fuentes: req.body.fuentes || [], etiquetas: req.body.etiquetas || [] }); res.json({ ok: true, id }); } catch (e) { next(e); } });