// ARCHIVO: src/scripts/probar-voz.ts
// Prueba de la Fase 8.2:
//   npx tsx src/scripts/probar-voz.ts                    → genera hola.mp3 con la voz configurada
//   npx tsx src/scripts/probar-voz.ts C:\ruta\nota.ogg   → transcribe ese audio
import "dotenv/config";
import { promises as fs } from "node:fs";
import { sintetizar, transcribir } from "../motor/voz.js";

async function main() {
  const ruta = process.argv[2];
  if (ruta) {
    const b = await fs.readFile(ruta);
    const mime = ruta.endsWith(".ogg") ? "audio/ogg" : ruta.endsWith(".wav") ? "audio/wav" : ruta.endsWith(".m4a") ? "audio/mp4" : "audio/mpeg";
    const t0 = Date.now(); const t = await transcribir(b, mime);
    console.log(`transcripción (${Date.now() - t0} ms): ${t.ok ? t.texto : "✘ " + t.error}`);
    return;
  }
  const t0 = Date.now();
  const v = await sintetizar("Hola Sebastián, soy Emilia. Si escuchás esto, ya tengo voz. ¿En qué te ayudo?");
  if (!v.ok || !v.audio) { console.log("✘", v.error); process.exit(1); }
  await fs.writeFile("hola.mp3", v.audio.contenido);
  console.log(`✔ hola.mp3 generado con ${v.proveedor} en ${Date.now() - t0} ms (${Math.round(v.audio.contenido.length / 1024)} KB). Abrilo para escuchar.`);
}
main().catch((e) => { console.error(e); process.exit(1); });