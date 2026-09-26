// ARCHIVO: src/scripts/probar-vision.ts
// Prueba de la Fase 8.1 sin WhatsApp:
//   npx tsx src/scripts/probar-vision.ts <ruta-a-una-imagen.png|jpg> ["pregunta opcional"]

import "dotenv/config";
import { promises as fs } from "node:fs";
import path from "node:path";
import { analizarImagen } from "../motor/vision.js";

async function main() {
  const ruta = process.argv[2];
  if (!ruta) { console.log("Uso: npx tsx src/scripts/probar-vision.ts <imagen> [pregunta]"); process.exit(1); }
  const contenido = await fs.readFile(ruta);
  const ext = path.extname(ruta).toLowerCase().replace(".", "");
  const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
  const t0 = Date.now();
  const r = await analizarImagen(contenido, mime, { pregunta: process.argv[3] });
  console.log(`modelo: ${r.modelo} · ${Date.now() - t0} ms`);
  console.log(r.ok ? `\n${r.texto}` : `✘ ${r.error}`);
}
main().catch((e) => { console.error(e); process.exit(1); });