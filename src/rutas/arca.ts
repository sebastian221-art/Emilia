// ARCHIVO: src/rutas/arca.ts
// El taller de Arca en el panel: el tutorial, revisar, probar, y el formulario
// LOCAL para poner llaves (van directo al .env; nunca pasan por un modelo).
import { Router } from "express";

export const rutasArca = Router();

rutasArca.get("/api/arca/tutorial", async (_req, res, next) => {
  try {
    const { tutorialGuardado } = await import("../arca/estado.js");
    const { VARIABLES } = await import("../arca/env.js");
    const t = await tutorialGuardado();
    const vars = VARIABLES.map((v) => ({ nombre: v.nombre, pregunta: v.pregunta, secreto: v.secreto, chequeo: v.chequeo, puesta: !!process.env[v.nombre]?.trim(), generable: !!v.generar }));
    res.json({ ...t, variables: vars });
  } catch (e) { next(e); }
});

rutasArca.post("/api/arca/revisar", async (req, res, next) => {
  try {
    const { revisar, celebrar } = await import("../arca/estado.js");
    const { VARIABLES } = await import("../arca/env.js");
    const r = await revisar({ mision: req.body?.mision });
    res.json({ ...r.tutorial, celebracion: celebrar(r.nuevas), variables: VARIABLES.map((v) => ({ nombre: v.nombre, pregunta: v.pregunta, secreto: v.secreto, chequeo: v.chequeo, puesta: !!process.env[v.nombre]?.trim(), generable: !!v.generar })) });
  } catch (e) { next(e); }
});

rutasArca.post("/api/arca/llave", async (req, res) => {
  try {
    const { escribirVariable, variable } = await import("../arca/env.js");
    const nombre = String(req.body?.nombre || "");
    const def = variable(nombre);
    if (!def) return res.status(400).json({ error: "Esa variable no es de la instalación." });
    let valor = String(req.body?.valor ?? "").trim();
    if (!valor && def.generar) valor = def.generar();
    if (!valor) return res.status(400).json({ error: "Vacío." });
    escribirVariable(nombre, valor);
    const { anotar } = await import("../arca/mantenimiento.js");
    await anotar("llave", nombre, true, "puesta desde el panel");
    const { revisar } = await import("../arca/estado.js");
    const r = await revisar({ ids: [def.chequeo] });
    const c = r.chequeos.find((x) => x.id === def.chequeo);
    res.json({ ok: true, generado: def.generar && !req.body?.valor ? valor : undefined, chequeo: c, reiniciar: /^(DATABASE_URL|WHATSAPP_|NGROK_|CEREBRO_)/.test(nombre) });
  } catch (e: any) { res.status(400).json({ error: String(e?.message || e) }); }
});

rutasArca.post("/api/arca/probar", async (req, res, next) => {
  try {
    const { probarTodo } = await import("../arca/pruebas.js");
    res.json(await probarTodo({ componentes: req.body?.componentes, enviarWhatsapp: !!req.body?.whatsapp }));
  } catch (e) { next(e); }
});

rutasArca.get("/api/arca/informe", async (_req, res, next) => {
  try {
    const { query } = await import("../db/cliente.js");
    const [inf] = await query<any>(`SELECT id, nota, datos, texto, creado_en FROM arca_informes WHERE tipo='pruebas' ORDER BY creado_en DESC LIMIT 1`);
    const { queHice } = await import("../arca/mantenimiento.js");
    res.json({ informe: inf || null, acciones: await queHice(14) });
  } catch (e) { next(e); }
});

// Botones del taller: el clic tuyo en el panel (local, con X-Emilia) ES el OK.
rutasArca.get("/api/arca/mantenimiento", async (_req, res, next) => {
  try { const { revisarMantenimiento } = await import("../arca/mantenimiento.js"); res.json(await revisarMantenimiento()); } catch (e) { next(e); }
});
rutasArca.post("/api/arca/instalar", async (req, res, next) => {
  try { const { instalar } = await import("../arca/mantenimiento.js"); res.json(await instalar(String(req.body?.programa || ""))); } catch (e) { next(e); }
});
rutasArca.post("/api/arca/limpiar", async (req, res, next) => {
  try { const { limpiar } = await import("../arca/mantenimiento.js"); const que = (Array.isArray(req.body?.que) ? req.body.que : []).filter((x: string) => ["logs", "temp", "docker"].includes(x)); if (!que.length) return res.status(400).json({ error: "¿Qué limpio? logs, temp o docker." }); res.json(await limpiar(que)); } catch (e) { next(e); }
});
