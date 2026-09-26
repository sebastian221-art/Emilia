// ARCHIVO: src/dominio/archivos.ts
import { promises as fs } from "node:fs";
import path from "node:path";
import { query } from "../db/cliente.js";

export interface Archivo {
  id: string; conversacion_id: string | null; agente_id: string | null;
  nombre: string; mime: string; tam_bytes: number; ruta: string; origen: string; creado_en: string;
}

const DIR = path.resolve(process.env.DATA_DIR || "data", "archivos");

export async function guardarArchivo(p: {
  nombre: string; mime: string; contenido: Buffer; origen: "whatsapp" | "generado" | "panel";
  conversacionId?: string | null; agenteId?: string | null;
}): Promise<Archivo> {
  await fs.mkdir(DIR, { recursive: true });
  const seguro = p.nombre.replace(/[^\w.\-áéíóúñÁÉÍÓÚÑ ]+/g, "_").slice(0, 120) || "archivo";
  const ruta = path.join(DIR, `${Date.now()}_${seguro}`);
  await fs.writeFile(ruta, p.contenido);
  const [a] = await query<Archivo>(
    `INSERT INTO archivos (conversacion_id, agente_id, nombre, mime, tam_bytes, ruta, origen) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [p.conversacionId ?? null, p.agenteId ?? null, seguro, p.mime, p.contenido.length, ruta, p.origen]);
  return a;
}

export async function obtenerArchivo(id: string): Promise<Archivo | undefined> {
  const [a] = await query<Archivo>(`SELECT * FROM archivos WHERE id=$1`, [id]);
  return a;
}
export async function leerArchivo(id: string): Promise<{ meta: Archivo; contenido: Buffer }> {
  const meta = await obtenerArchivo(id);
  if (!meta) throw new Error(`Archivo ${id} no existe.`);
  return { meta, contenido: await fs.readFile(meta.ruta) };
}
export async function archivosDeConversacion(convId: string, limite = 10): Promise<Archivo[]> {
  return query<Archivo>(`SELECT * FROM archivos WHERE conversacion_id=$1 ORDER BY creado_en DESC LIMIT $2`, [convId, limite]);
}
/**
 * Limpieza: borra del disco y de la tabla los audios (recibidos o generados) con
 * más de `diasAudio` días, y los archivos generados (informes, etc.) con más de
 * `diasGenerados`. Las bases de contactos que mandó el jefe se conservan `diasSubidos`.
 * Se corre al arrancar y una vez al día (ver server.ts).
 */
export async function limpiarArchivosViejos(op: { diasAudio?: number; diasGenerados?: number; diasSubidos?: number } = {}): Promise<{ borrados: number; liberado_kb: number }> {
  const dA = op.diasAudio ?? Number(process.env.ARCHIVOS_DIAS_AUDIO || 2);
  const dG = op.diasGenerados ?? Number(process.env.ARCHIVOS_DIAS_GENERADOS || 14);
  const dS = op.diasSubidos ?? Number(process.env.ARCHIVOS_DIAS_SUBIDOS || 60);
  const viejos = await query<Archivo>(
    `SELECT * FROM archivos WHERE
       (mime LIKE 'audio/%' AND creado_en < now() - ($1 || ' days')::interval)
       OR (origen = 'generado' AND mime NOT LIKE 'audio/%' AND creado_en < now() - ($2 || ' days')::interval)
       OR (origen <> 'generado' AND mime NOT LIKE 'audio/%' AND creado_en < now() - ($3 || ' days')::interval)`,
    [String(dA), String(dG), String(dS)]);
  let liberado = 0;
  for (const a of viejos) {
    try { await fs.unlink(a.ruta); liberado += a.tam_bytes; } catch { /* ya no estaba */ }
    await query(`DELETE FROM archivos WHERE id=$1`, [a.id]);
  }
  if (viejos.length) console.log(`[archivos] Limpieza: ${viejos.length} archivo(s) borrados, ${Math.round(liberado / 1024)} KB liberados.`);
  return { borrados: viejos.length, liberado_kb: Math.round(liberado / 1024) };
}

export async function archivosRecientes(limite = 10): Promise<Archivo[]> {
  return query<Archivo>(`SELECT * FROM archivos ORDER BY creado_en DESC LIMIT $1`, [limite]);
}