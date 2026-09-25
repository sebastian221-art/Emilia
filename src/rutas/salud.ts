// ARCHIVO: src/rutas/salud.ts
import { Router } from "express";
import { createRequire } from "node:module";

// El proyecto es ESM ("type": "module"), así que para leer el JSON con
// require hace falta construirlo con createRequire en vez del global.
const require = createRequire(import.meta.url);
const paquete = require("../../package.json");

export const rutasSalud = Router();

rutasSalud.get("/api/salud", (_req, res) => {
  res.json({ ok: true, version: paquete.version, uptime: process.uptime() });
});
