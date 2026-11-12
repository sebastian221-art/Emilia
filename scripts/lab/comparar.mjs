// ARCHIVO: scripts/lab/comparar.mjs
// ─────────────────────────────────────────────────────────────────────────────
//  Compara dos capturas (original vs. réplica) y dice qué tan parecidas son.
//  Uso: node comparar.mjs <original.png> <replica.png> [diferencias.png]
//  Recorta las dos al tamaño común, cuenta píxeles distintos y guarda una imagen
//  con las diferencias en rojo, para ver dónde ajustar.
// ─────────────────────────────────────────────────────────────────────────────
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const { PNG } = require("pngjs");
const pixelmatchMod = require("pixelmatch");
const pixelmatch = pixelmatchMod.default || pixelmatchMod;

const [a, b, salida = "diferencias.png"] = process.argv.slice(2);
if (!a || !b) { console.error("Uso: node comparar.mjs <original.png> <replica.png> [diferencias.png]"); process.exit(1); }
const A = PNG.sync.read(readFileSync(a)), B = PNG.sync.read(readFileSync(b));
const w = Math.min(A.width, B.width), h = Math.min(A.height, B.height);
const recortar = (img) => { const o = new PNG({ width: w, height: h }); PNG.bitblt(img, o, 0, 0, w, h, 0, 0); return o; };
const ra = recortar(A), rb = recortar(B), diff = new PNG({ width: w, height: h });
const distintos = pixelmatch(ra.data, rb.data, diff.data, w, h, { threshold: 0.15 });
writeFileSync(salida, PNG.sync.write(diff));
const parecido = (100 * (1 - distintos / (w * h))).toFixed(1);
console.log(JSON.stringify({ parecido_pct: Number(parecido), pixeles_distintos: distintos, comparado: `${w}x${h}`, tamaños: { original: `${A.width}x${A.height}`, replica: `${B.width}x${B.height}` }, diferencias: salida }));
