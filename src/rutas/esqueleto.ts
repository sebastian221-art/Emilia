// ARCHIVO: src/rutas/esqueleto.ts
// ─────────────────────────────────────────────────────────────────────────────
//  El esqueleto se sirve desde el backend. Los archivos public/crear/piezas-1.js
//  y piezas-2.js SE BORRAN del disco: este router los genera desde
//  src/esqueleto/piezas.ts, así crear.js y espacio.html siguen funcionando sin
//  cambios y no pueden mostrar una pieza que el motor no lea.
//  IMPORTANTE: montar este router ANTES de express.static en server.ts.
// ─────────────────────────────────────────────────────────────────────────────

import { Router } from "express";
import { PIEZAS, DEFAULTS, PIEZAS_OBJETO, PIEZAS_LISTA } from "../esqueleto/piezas.js";

export const rutasEsqueleto = Router();

// Para la UI nueva (Fase 5) y para inspección.
rutasEsqueleto.get("/api/esqueleto", (_req, res) => {
  res.json({ piezas: PIEZAS, defaults: DEFAULTS, objeto: PIEZAS_OBJETO, listas: PIEZAS_LISTA });
});

// Compatibilidad con crear.js / espacio.html actuales.
rutasEsqueleto.get("/crear/piezas-1.js", (_req, res) => {
  res.type("application/javascript").set("Cache-Control", "no-store")
    .send(`// Generado desde src/esqueleto/piezas.ts — no editar a mano.\nconst DEF_PIEZAS = ${JSON.stringify(PIEZAS)};\nconst DEF_PIEZAS_DEFAULTS = ${JSON.stringify(DEFAULTS)};\n`);
});
rutasEsqueleto.get("/crear/piezas-2.js", (_req, res) => {
  res.type("application/javascript").set("Cache-Control", "no-store")
    .send(`// Generado desde src/esqueleto/piezas.ts — vacío a propósito (todo vive en piezas-1.js).\nconst DEF_PIEZAS_2 = [];\n`);
});