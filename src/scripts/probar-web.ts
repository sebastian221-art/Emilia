// ARCHIVO: src/scripts/probar-web.ts
// Prueba rápida del buscador interno:  npx tsx src/scripts/probar-web.ts "lo que quieras buscar"
import "dotenv/config";
import { buscar, leer } from "../motor/web.js";
const q = process.argv.slice(2).join(" ") || "qué es YOLO visión por computador";
console.log(`🔎 Buscando: ${q}`);
const r = await buscar(q, 5);
if (!r.length) { console.log("✘ Sin resultados (DuckDuckGo, Bing y Brave fallaron). ¿Hay internet / algún proxy?"); process.exit(1); }
for (const [i, x] of r.entries()) console.log(`${i + 1}. ${x.titulo.slice(0, 80)}\n   ${x.url}\n   ${x.resumen.slice(0, 120)}`);
console.log(`\n📖 Leyendo el primero…`);
const p = await leer(r[0].url, 1500);
console.log(`${p.titulo} (${p.caracteres} caracteres)\n${p.texto.slice(0, 600)}`);