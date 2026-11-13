// ARCHIVO: src/motor/cifrado.ts
// ─────────────────────────────────────────────────────────────────────────────
//  CIFRADO DE LA MEMORIA PERSONAL (AES-256-GCM). Lo personal (relaciones,
//  problemas, salud, finanzas…) queda cifrado en la base: si alguien copia la
//  base, no lo puede leer. La llave vive fuera de la base (ver obtenerLlave).
// ─────────────────────────────────────────────────────────────────────────────
import crypto from "node:crypto";

let llave: Buffer | null | undefined;
/** La llave de 32 bytes. Se completa en la parte de memoria personal (Credential Manager). */
export async function obtenerLlave(): Promise<Buffer | null> {
  if (llave !== undefined) return llave;
  const b64 = process.env.CEREBRO_LLAVE;
  llave = b64 && Buffer.from(b64, "base64").length === 32 ? Buffer.from(b64, "base64") : null;
  return llave;
}
export function cifrar(texto: string, k: Buffer): Buffer {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv("aes-256-gcm", k, iv);
  const datos = Buffer.concat([c.update(texto, "utf8"), c.final()]);
  return Buffer.concat([Buffer.from([1]), iv, c.getAuthTag(), datos]);   // v1 | iv(12) | tag(16) | datos
}
export function descifrar(b: Buffer, k: Buffer): string {
  if (b[0] !== 1) throw new Error("Formato de cifrado desconocido.");
  const iv = b.subarray(1, 13), tag = b.subarray(13, 29), datos = b.subarray(29);
  const d = crypto.createDecipheriv("aes-256-gcm", k, iv); d.setAuthTag(tag);
  return Buffer.concat([d.update(datos), d.final()]).toString("utf8");
}
/** El resumen legible de un nodo (descifra si está cifrado y hay llave). */
export async function abrirResumen(n: { resumen: string; cifrado?: Buffer | null }): Promise<string> {
  if (!n.cifrado) return n.resumen;
  const k = await obtenerLlave();
  if (!k) return "(recuerdo privado cifrado: falta la llave)";
  try { return JSON.parse(descifrar(n.cifrado, k)).resumen ?? n.resumen; } catch { return "(no pude descifrar este recuerdo)"; }
}
