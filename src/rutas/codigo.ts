// ARCHIVO: src/rutas/codigo.ts
import { Router } from "express";
import { listarProyectos, sandboxesAbiertos, sesionesRecientes, obtenerSesion, sesionesDeSandbox, obtenerSandbox } from "../dominio/proyectos.js";
import { diffSandbox } from "../motor/sandbox.js";
import { ejecutarTool, crearContexto } from "../motor/ejecutor.js";
import { cancelarSesion } from "../motor/claude-code.js";
import { estadoProceso, iniciarProceso, detenerProceso, reiniciarProceso, leerLogs, saludProceso } from "../motor/runtime.js";
import { obtenerProyecto } from "../dominio/proyectos.js";

import { promises as fsp } from "node:fs";
import pathMod from "node:path";
import { query as q } from "../db/cliente.js";
import { iniciarFlujo } from "../motor/flujo.js";
import { ejecutarSkill } from "../motor/ejecutor.js";
import { conversacionDelJefe } from "../motor/permisos-codigo.js";
import { aprobacionesPendientes } from "../dominio/aprobaciones.js";
import { DIR_EXPERIMENTOS, enLaboratorio, LAB_DIR } from "../motor/laboratorio.js";
import { git, ramaBaseReal } from "../motor/sandbox.js";
import { listarDespliegues, estadoPublicado } from "../motor/publicar.js";
import { hallazgosAbiertos } from "../motor/guardia.js";
import { listarPerfiles, sesionesPcActivas, detenerSesionPc } from "../motor/computer-use.js";

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

// ── Runtime ──
rutasCodigo.get("/api/codigo/runtime", async (_req, res, next) => {
  try {
    const lista = await listarProyectos();
    const out = [];
    for (const p of lista) { const e = await estadoProceso(p); out.push({ ...e, proyecto: p.nombre, proyecto_id: p.id, cmd_start: p.cmd_start, puerto: p.puerto, url_salud: p.url_salud }); }
    res.json(out);
  } catch (e) { next(e); }
});
rutasCodigo.post("/api/codigo/runtime/:nombre/:accion", async (req, res, next) => {
  try {
    const p = await obtenerProyecto(req.params.nombre);
    if (!p) return res.status(404).json({ error: "Proyecto no encontrado" });
    const a = req.params.accion;
    const r = a === "iniciar" ? await iniciarProceso(p) : a === "detener" ? await detenerProceso(p) : a === "reiniciar" ? await reiniciarProceso(p) : a === "salud" ? await saludProceso(p) : null;
    if (!r) return res.status(400).json({ error: "Acción inválida" });
    res.status((r as any).ok ? 200 : 400).json(r);
  } catch (e) { next(e); }
});
rutasCodigo.get("/api/codigo/runtime/:nombre/logs", async (req, res, next) => {
  try {
    const p = await obtenerProyecto(req.params.nombre);
    if (!p) return res.status(404).json({ error: "Proyecto no encontrado" });
    res.json(await leerLogs(p, { ultimas: Number(req.query.ultimas) || 120, filtro: req.query.filtro as string, soloErrores: req.query.errores === "1" }));
  } catch (e) { next(e); }
});
// ═════════════════════════════════════════════════════════════════════════════
//  FASE 5 — todo lo de Sage en una página: ahora, entregar, laboratorio,
//  publicados, guardia y uso del PC. El panel solo escucha en 127.0.0.1.
// ═════════════════════════════════════════════════════════════════════════════
const enFondo = (p: Promise<unknown>) => { p.catch((e) => console.warn("[codigo]", e?.message || e)); };
const usaApi = () => process.env.CLAUDE_CODE_USAR_API === "true";

// ── Ahora: lo que está pasando ───────────────────────────────────────────────
rutasCodigo.get("/api/codigo/ahora", async (_req, res, next) => {
  try {
    const [enCurso, aprob, graves, leves, publicados, sandboxes] = await Promise.all([
      q(`SELECT s.id, s.encargo, s.inicio, s.modo, COALESCE(p.nombre, 'laboratorio') AS proyecto FROM sesiones_codigo s LEFT JOIN proyectos p ON p.id = s.proyecto_id WHERE s.estado = 'en_curso' ORDER BY s.inicio DESC`),
      aprobacionesPendientes(),
      q(`SELECT id, objetivo, titulo, estado, sandbox_id, ultimo_en FROM guardia_hallazgos WHERE severidad = 'grave' AND estado IN ('abierto','reparando','arreglo_listo','sin_arreglo') ORDER BY ultimo_en DESC`).catch(() => []),
      q(`SELECT count(*)::int AS n FROM guardia_hallazgos WHERE severidad = 'leve' AND estado = 'abierto'`).catch(() => [{ n: 0 }]),
      q(`SELECT count(*)::int AS n FROM despliegues`).catch(() => [{ n: 0 }]),
      q(`SELECT count(*)::int AS n FROM sandboxes WHERE estado = 'abierto'`).catch(() => [{ n: 0 }]),
    ]);
    const costo = async (sql: string) => Number((await q(sql).catch(() => [{ v: 0 }]))[0]?.v || 0);
    const hoy = `date_trunc('day', now() AT TIME ZONE 'America/Bogota') AT TIME ZONE 'America/Bogota'`;
    const semana = `now() - interval '7 days'`;
    res.json({
      claude_code: enCurso, pc: sesionesPcActivas(), aprobaciones: aprob, guardia: { graves, leves: leves[0].n },
      publicados: publicados[0].n, sandboxes: sandboxes[0].n,
      costos: {
        claude_code_hoy: await costo(`SELECT sum(costo_usd) AS v FROM sesiones_codigo WHERE inicio >= ${hoy}`),
        claude_code_semana: await costo(`SELECT sum(costo_usd) AS v FROM sesiones_codigo WHERE inicio >= ${semana}`),
        claude_code_plan_max: !usaApi(),
        pc_hoy: await costo(`SELECT sum(costo_usd) AS v FROM pc_sesiones WHERE inicio >= ${hoy}`),
        pc_semana: await costo(`SELECT sum(costo_usd) AS v FROM pc_sesiones WHERE inicio >= ${semana}`),
        api_hoy: await costo(`SELECT sum(costo_usd) AS v FROM consumo WHERE creado_en >= ${hoy}`),
        api_semana: await costo(`SELECT sum(costo_usd) AS v FROM consumo WHERE creado_en >= ${semana}`),
      },
    });
  } catch (e) { next(e); }
});

// ── Sandboxes: diff legible y acciones ───────────────────────────────────────
rutasCodigo.get("/api/codigo/sandboxes/:id/diff2", async (req, res, next) => {
  try {
    const s = await obtenerSandbox(req.params.id);
    if (!s) return res.status(404).json({ error: "Sandbox no encontrado" });
    const base = await ramaBaseReal(s.proyecto);
    const ref = (await git(s.ruta, `rev-parse --verify --quiet origin/${base}`)).codigo === 0 ? `origin/${base}` : base;
    const diff = (await git(s.ruta, `diff --no-color -U3 ${ref}`)).stdout;
    const nuevos = (await git(s.ruta, "ls-files --others --exclude-standard")).stdout.split("\n").map((x) => x.trim()).filter(Boolean);
    const sinSeguimiento: { archivo: string; contenido: string; truncado: boolean; binario: boolean }[] = [];
    for (const f of nuevos.slice(0, 40)) {
      const buf = await fsp.readFile(pathMod.join(s.ruta, f)).catch(() => Buffer.from(""));
      const binario = buf.subarray(0, 8000).includes(0);
      const texto = binario ? "" : buf.toString("utf8");
      sinSeguimiento.push({ archivo: f, contenido: texto.slice(0, 60_000), truncado: texto.length > 60_000, binario });
    }
    const commits = (await git(s.ruta, `log --format=%h%x09%an%x09%ar%x09%s ${ref}..HEAD`)).stdout.split("\n").filter(Boolean).map((l) => { const [h, a, t, ...m] = l.split("\t"); return { hash: h, autor: a, hace: t, mensaje: m.join(" ") }; });
    const atras = Number((await git(s.ruta, `rev-list --count HEAD..${ref}`)).stdout.trim()) || 0;
    res.json({ base: ref, diff: diff.slice(0, 600_000), truncado: diff.length > 600_000, sin_seguimiento: sinSeguimiento, commits, atras });
  } catch (e) { next(e); }
});
const accionSandbox = (tool: string) => async (req: any, res: any, next: any) => {
  try { const r = await ejecutarTool(tool, { sandbox_id: req.params.id }, ctx()); res.status(r.ok ? 200 : 400).json(r); } catch (e) { next(e); }
};
rutasCodigo.post("/api/codigo/sandboxes/:id/actualizar", accionSandbox("codigo_actualizar_sandbox"));
rutasCodigo.post("/api/codigo/sandboxes/:id/verificar", accionSandbox("codigo_verificar"));
/** Entregar: arranca el flujo entregar_cambios; su aprobación aparece aquí y en WhatsApp. */
rutasCodigo.post("/api/codigo/sandboxes/:id/entregar", async (req, res, next) => {
  try {
    const s = await obtenerSandbox(req.params.id);
    if (!s) return res.status(404).json({ error: "Sandbox no encontrado" });
    const conv = await conversacionDelJefe(null).catch(() => null);
    const r = await iniciarFlujo("entregar_cambios", { sandbox_id: s.id, ...(req.body?.mensaje ? { mensaje: String(req.body.mensaje) } : {}) }, { origen: "panel", conversacionId: conv });
    res.json(r);
  } catch (e) { next(e); }
});

// ── Laboratorio y publicados ─────────────────────────────────────────────────
rutasCodigo.get("/api/codigo/laboratorio", async (_req, res, next) => {
  try {
    const dirs = (await fsp.readdir(DIR_EXPERIMENTOS, { withFileTypes: true }).catch(() => [])).filter((d) => d.isDirectory()).map((d) => d.name).sort().reverse().slice(0, 60);
    const publicados = await listarDespliegues().catch(() => []);
    const out = [];
    for (const d of dirs) {
      const ruta = pathMod.join(DIR_EXPERIMENTOS, d);
      const archivos = [];
      for (const f of (await fsp.readdir(ruta, { withFileTypes: true }).catch(() => [])).slice(0, 80)) {
        if (f.name.startsWith(".") || f.name === "node_modules") continue;
        const st = await fsp.stat(pathMod.join(ruta, f.name)).catch(() => null);
        archivos.push({ nombre: f.name, carpeta: f.isDirectory(), bytes: st?.size || 0 });
      }
      const st = await fsp.stat(ruta).catch(() => null);
      const pub = publicados.find((p) => pathMod.resolve(p.carpeta).toLowerCase().startsWith(ruta.toLowerCase()));
      out.push({ nombre: d, ruta, modificado: st?.mtime, archivos, publicado: pub ? { nombre: pub.nombre, url: pub.url, estado: pub.estado, repo: pub.repo } : null });
    }
    res.json({ lab: LAB_DIR, experimentos: out });
  } catch (e) { next(e); }
});
/** Descarga un archivo del laboratorio (nunca .env ni llaves). */
rutasCodigo.get("/api/codigo/laboratorio/archivo", async (req, res, next) => {
  try {
    const ruta = pathMod.resolve(String(req.query.ruta || ""));
    if (!enLaboratorio(ruta) || /(^|[\\/])(\.env[^\\/]*|[^\\/]+\.(pem|key|p12|pfx)|id_(rsa|ed25519)[^\\/]*)$/i.test(ruta)) return res.status(403).json({ error: "Solo archivos del laboratorio (sin secretos)." });
    const st = await fsp.stat(ruta).catch(() => null);
    if (!st?.isFile()) return res.status(404).json({ error: "No existe." });
    res.download(ruta);
  } catch (e) { next(e); }
});
rutasCodigo.get("/api/codigo/publicados", async (_req, res, next) => { try { res.json(await listarDespliegues()); } catch (e) { next(e); } });
rutasCodigo.get("/api/codigo/publicados/:nombre/estado", async (req, res, next) => {
  try { res.json(await estadoPublicado(req.params.nombre)); } catch (e: any) { res.status(400).json({ error: e.message }); }
});

// ── Guardia ──────────────────────────────────────────────────────────────────
rutasCodigo.get("/api/codigo/guardia", async (_req, res, next) => {
  try {
    const vigilados = await q(`SELECT p.nombre, p.cmd_test, p.cmd_build, g.* FROM guardia_proyectos g JOIN proyectos p ON p.id = g.proyecto_id ORDER BY p.nombre`).catch(() => []);
    const abiertos = await hallazgosAbiertos().catch(() => []);
    const resueltos = await q(`SELECT * FROM guardia_hallazgos WHERE estado IN ('resuelto','entregado','ignorado') ORDER BY COALESCE(resuelto_en, ultimo_en) DESC LIMIT 20`).catch(() => []);
    const disparadores = await q(`SELECT nombre, estado, config, ultimo_disparo, ultimo_resultado FROM disparadores WHERE nombre LIKE 'guardia_%'`).catch(() => []);
    res.json({ vigilados, abiertos, resueltos, disparadores });
  } catch (e) { next(e); }
});
rutasCodigo.post("/api/codigo/guardia/configurar", async (req, res, next) => {
  try { const r = await ejecutarTool("guardia_configurar", req.body || {}, ctx()); res.status(r.ok ? 200 : 400).json(r); } catch (e) { next(e); }
});
rutasCodigo.post("/api/codigo/guardia/ronda", async (req, res) => {
  enFondo(ejecutarSkill("guardia_ronda", { ...(req.body?.proyecto ? { proyecto: String(req.body.proyecto) } : {}), forzar: !!req.body?.forzar }, ctx()));
  res.json({ ok: true, resumen: "Ronda de guardia en marcha: lo grave te llega por WhatsApp y aquí se actualiza." });
});
rutasCodigo.post("/api/codigo/guardia/:id/ignorar", async (req, res, next) => {
  try { const r = await ejecutarTool("guardia_ignorar", { id: req.params.id }, ctx()); res.status(r.ok ? 200 : 400).json(r); } catch (e) { next(e); }
});
rutasCodigo.post("/api/codigo/guardia/arreglar-leves", async (req, res) => {
  if (!req.body?.proyecto) return res.status(400).json({ error: "Falta proyecto." });
  enFondo(ejecutarSkill("guardia_arreglar_leves", { proyecto: String(req.body.proyecto) }, ctx()));
  res.json({ ok: true, resumen: `Sage está corrigiendo las fallas leves de ${req.body.proyecto} en un sandbox; te pide el OK para subirlo.` });
});

// ── Uso del PC ───────────────────────────────────────────────────────────────
rutasCodigo.get("/api/codigo/pc", async (_req, res, next) => {
  try {
    const recientes = await q(`SELECT id, perfil, objetivo, estado, modelo, pasos, costo_usd, comandos, resumen, pregunta, inicio, fin FROM pc_sesiones ORDER BY inicio DESC LIMIT 30`).catch(() => []);
    res.json({ activas: sesionesPcActivas(), recientes, perfiles: await listarPerfiles() });
  } catch (e) { next(e); }
});
rutasCodigo.get("/api/codigo/pc/:id", async (req, res, next) => {
  try {
    const [s] = await q(`SELECT * FROM pc_sesiones WHERE id::text = $1`, [req.params.id]);
    if (!s) return res.status(404).json({ error: "No existe." });
    const bit = await fsp.readFile(pathMod.join(s.carpeta || "-", "bitacora.jsonl"), "utf8").catch(() => "");
    const bitacora = bit.split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    const capturas = (await fsp.readdir(s.carpeta || "-").catch(() => [] as string[])).filter((f) => /^\d{3}(-zoom)?\.png$/.test(f)).sort();
    const perfil = (await listarPerfiles()).find((p) => p.nombre === s.perfil);
    res.json({ ...s, bitacora, capturas, datos_sensibles: !!perfil?.datos_sensibles });
  } catch (e) { next(e); }
});
rutasCodigo.get("/api/codigo/pc/:id/captura/:archivo", async (req, res, next) => {
  try {
    if (!/^\d{3}(-zoom)?\.png$/.test(req.params.archivo)) return res.status(400).end();
    const [s] = await q(`SELECT carpeta FROM pc_sesiones WHERE id::text = $1`, [req.params.id]);
    if (!s?.carpeta) return res.status(404).end();
    res.sendFile(pathMod.join(s.carpeta, req.params.archivo), (e) => { if (e && !res.headersSent) res.status(404).end(); });
  } catch (e) { next(e); }
});
rutasCodigo.post("/api/codigo/pc/detener", (req, res) => { res.json({ ok: true, detenidas: detenerSesionPc(req.body?.id ? String(req.body.id) : undefined) }); });
