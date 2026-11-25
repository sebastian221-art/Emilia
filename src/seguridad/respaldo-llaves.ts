// ARCHIVO: src/seguridad/respaldo-llaves.ts
// Respaldo cifrado de lo que NO está en la copia de la base: la llave del
// cerebro (sin ella la memoria personal no se puede leer) y el .env (tus llaves).
// Se cifra con una frase que solo tú sabes (scrypt + AES-256-GCM): el archivo
// se puede guardar en OneDrive o en una USB sin miedo.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const MAGIA = "EMILIA-LLAVES-1";
const N = 1 << 17, r = 8, p = 1;

export interface ContenidoRespaldo { creado: string; cerebro_llave: string | null; env: string | null; equipo: string }

export function cifrarRespaldo(c: ContenidoRespaldo, frase: string): Buffer {
  if (frase.length < 10) throw new Error("La frase tiene que tener al menos 10 caracteres.");
  const sal = crypto.randomBytes(16), iv = crypto.randomBytes(12);
  const llave = crypto.scryptSync(frase, sal, 32, { N, r, p, maxmem: 256 * 1024 * 1024 });
  const cif = crypto.createCipheriv("aes-256-gcm", llave, iv);
  const datos = Buffer.concat([cif.update(JSON.stringify(c), "utf8"), cif.final()]);
  return Buffer.concat([Buffer.from(MAGIA), sal, iv, cif.getAuthTag(), datos]);
}

export function descifrarRespaldo(b: Buffer, frase: string): ContenidoRespaldo {
  if (b.subarray(0, MAGIA.length).toString() !== MAGIA) throw new Error("Ese archivo no es un respaldo de llaves de Emilia.");
  let o = MAGIA.length;
  const sal = b.subarray(o, o += 16), iv = b.subarray(o, o += 12), tag = b.subarray(o, o += 16), datos = b.subarray(o);
  const llave = crypto.scryptSync(frase, sal, 32, { N, r, p, maxmem: 256 * 1024 * 1024 });
  const d = crypto.createDecipheriv("aes-256-gcm", llave, iv); d.setAuthTag(tag);
  try { return JSON.parse(Buffer.concat([d.update(datos), d.final()]).toString("utf8")); }
  catch { throw new Error("Frase incorrecta (o el archivo está dañado)."); }
}

/** Dónde se anota cuándo fue el último respaldo (lo revisan Arca y la vigilancia). */
export const MARCA = () => path.resolve(process.env.DATA_DIR || "data", "respaldo-llaves.json");
export function ultimoRespaldo(): { t: string; archivo: string } | null {
  try { return JSON.parse(fs.readFileSync(MARCA(), "utf8")); } catch { return null; }
}
