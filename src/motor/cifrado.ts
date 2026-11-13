// ARCHIVO: src/motor/cifrado.ts
// ─────────────────────────────────────────────────────────────────────────────
//  CIFRADO DE LA MEMORIA PERSONAL (AES-256-GCM)
//  Lo personal del jefe (relaciones, problemas, salud, logros, metas…) se
//  guarda cifrado: si alguien copia la base, no lo puede leer.
//  La llave (32 bytes) NO vive en la base:
//    • CEREBRO_LLAVE en el .env (base64), si se definió; si no,
//    • Windows: archivo data/cerebro.llave protegido con DPAPI (el mismo
//      mecanismo de las credenciales de Windows): solo TU usuario de Windows
//      en ESTE PC lo puede abrir. Se crea sola la primera vez.
//    • Otros sistemas: archivo data/cerebro.llave con permisos 600.
//  Respaldo: `npm run cerebro:llave` muestra la llave para guardarla en un
//  lugar seguro (si se reinstala Windows, sin ella no se recupera lo personal).
// ─────────────────────────────────────────────────────────────────────────────
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const ejec = promisify(execFile);
const RUTA = () => path.resolve(process.env.DATA_DIR || "data", "cerebro.llave");
let llave: Buffer | null | undefined;
let avisado = false;

async function dpapi(modo: "Protect" | "Unprotect", b64: string): Promise<string> {
  const ps = `Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String('${b64}'); [Convert]::ToBase64String([System.Security.Cryptography.ProtectedData]::${modo}($b, [Text.Encoding]::UTF8.GetBytes('Emilia-cerebro'), 'CurrentUser'))`;
  const { stdout } = await ejec("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], { timeout: 20_000, windowsHide: true });
  return stdout.trim();
}

/** La llave de 32 bytes (o null si no se pudo: entonces lo personal queda marcado privado pero sin cifrar, y se avisa). */
export async function obtenerLlave(): Promise<Buffer | null> {
  if (llave !== undefined) return llave;
  const env = process.env.CEREBRO_LLAVE;
  if (env) { const b = Buffer.from(env, "base64"); llave = b.length === 32 ? b : null; if (!llave) console.warn("[cifrado] CEREBRO_LLAVE no es de 32 bytes en base64."); return llave; }
  if (process.env.CEREBRO_CIFRADO === "false") return (llave = null);
  try {
    const guardada = (await fs.readFile(RUTA(), "utf8").catch(() => "")).trim();
    if (guardada) {
      const b64 = process.platform === "win32" ? await dpapi("Unprotect", guardada) : guardada;
      const b = Buffer.from(b64, "base64"); if (b.length === 32) return (llave = b);
      throw new Error("la llave guardada está dañada");
    }
    const nueva = crypto.randomBytes(32);
    await fs.mkdir(path.dirname(RUTA()), { recursive: true });
    await fs.writeFile(RUTA(), process.platform === "win32" ? await dpapi("Protect", nueva.toString("base64")) : nueva.toString("base64"), { mode: 0o600 });
    console.log(`[cifrado] Llave nueva de la memoria personal en ${RUTA()}${process.platform === "win32" ? " (protegida con tu usuario de Windows)" : ""}. Haz un respaldo con: npm run cerebro:llave`);
    return (llave = nueva);
  } catch (e: any) {
    if (!avisado) { avisado = true; console.warn(`[cifrado] No pude obtener la llave (${e?.message || e}): lo personal se guarda sin cifrar.`); }
    return (llave = null);
  }
}
/** Solo pruebas: olvidar la llave en memoria. */
export const _reiniciarLlave = () => { llave = undefined; };

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
export const MARCA_CIFRADO = "🔒";
/** Lo que se guarda en la base para un contenido privado: resumen = 🔒 y el texto real cifrado. */
export async function sellar(contenido: string): Promise<{ resumen: string; cifrado: Buffer | null }> {
  const k = await obtenerLlave();
  return k ? { resumen: MARCA_CIFRADO, cifrado: cifrar(JSON.stringify({ resumen: contenido }), k) } : { resumen: contenido, cifrado: null };
}
/** El resumen legible de un nodo (descifra si está cifrado y hay llave). */
export async function abrirResumen(n: { resumen: string; cifrado?: Buffer | null }): Promise<string> {
  if (!n.cifrado) return n.resumen;
  const k = await obtenerLlave();
  if (!k) return "(recuerdo privado cifrado: falta la llave)";
  try { return JSON.parse(descifrar(n.cifrado, k)).resumen ?? n.resumen; } catch { return "(no pude descifrar este recuerdo)"; }
}
