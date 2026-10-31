// ARCHIVO: src/motor/embeddings.ts
// Vectores de significado, LOCALES y gratis (@xenova/transformers, modelo
// multilingüe pequeño, 384 dims, corre en CPU). Primera llamada descarga el
// modelo (~100 MB) a data/modelos. Si el paquete no está, cae a un vector de
// hashing de palabras (peor, pero la búsqueda sigue funcionando).
import path from "node:path";

const MODELO = process.env.EMBEDDINGS_MODELO || "Xenova/multilingual-e5-small";
let pipe: any = null; let intentado = false;

async function cargar() {
  if (pipe || intentado) return pipe;
  intentado = true;
  try {
    const nombreMod = "@xenova/transformers"; const t: any = await import(nombreMod);
    t.env.cacheDir = path.resolve(process.env.DATA_DIR || "data", "modelos");
    t.env.allowLocalModels = true;
    pipe = await t.pipeline("feature-extraction", MODELO, { quantized: true });
    console.log(`[embeddings] modelo ${MODELO} listo.`);
  } catch (e: any) { console.warn(`[embeddings] sin @xenova/transformers (${e?.message?.slice(0, 80)}); uso hashing. Instalá con: npm install @xenova/transformers`); }
  return pipe;
}

const DIMS = 384;
function hashing(texto: string): number[] {
  const v = new Array(DIMS).fill(0);
  for (const w of texto.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").split(/[^a-z0-9]+/).filter((x) => x.length > 2)) {
    let h = 2166136261; for (let i = 0; i < w.length; i++) { h ^= w.charCodeAt(i); h = Math.imul(h, 16777619); }
    v[Math.abs(h) % DIMS] += 1; v[Math.abs(h >> 8) % DIMS] += 0.5;
  }
  const n = Math.sqrt(v.reduce((a, b) => a + b * b, 0)) || 1; return v.map((x) => x / n);
}

export async function embed(texto: string): Promise<number[]> {
  const p = await cargar();
  const t = texto.slice(0, 2000);
  if (!p) return hashing(t);
  const out = await p((MODELO.includes("e5") ? "query: " : "") + t, { pooling: "mean", normalize: true });
  return Array.from(out.data as Float32Array);
}

export function coseno(a: number[], b: number[]): number {
  if (!a?.length || !b?.length || a.length !== b.length) return 0;
  let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s;
}