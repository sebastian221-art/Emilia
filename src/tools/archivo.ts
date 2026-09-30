// ARCHIVO: src/tools/archivo.ts
// ─────────────────────────────────────────────────────────────────────────────
//  TOOLS DE ARCHIVOS — leer, listar y crear archivos que cualquier agente pueda
//  usar (bases, CSV, Excel, texto). Van en el núcleo de todos los agentes.
// ─────────────────────────────────────────────────────────────────────────────
import type { DefTool } from "../registro/tipos.js";
import { query } from "../db/cliente.js";
import { leerArchivo, guardarArchivo, archivosDeConversacion, archivosRecientes } from "../dominio/archivos.js";

const MODULO = "archivo";

async function vistaPrevia(contenido: Buffer, nombre: string, mime: string, maxLineas: number): Promise<{ tipo: string; texto: string; lineas?: number; columnas?: string[] }> {
  const ext = nombre.toLowerCase().split(".").pop() || "";
  if (ext === "xlsx" || ext === "xls") {
    try {
      const nombreMod = "xlsx"; const XLSX: any = await import(nombreMod);
      const wb = XLSX.read(contenido, { type: "buffer" }); const ws = wb.Sheets[wb.SheetNames[0]];
      const filas: string[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" });
      return { tipo: "excel", columnas: filas[0] || [], lineas: Math.max(0, filas.length - 1), texto: filas.slice(0, maxLineas).map((f) => f.join(" | ")).join("\n") };
    } catch { return { tipo: "excel", texto: "(no pude leer el Excel localmente: falta el paquete 'xlsx')" }; }
  }
  if (mime.startsWith("image/")) return { tipo: "imagen", texto: "(es una imagen: usá vision_analizar)" };
  if (mime.startsWith("audio/")) return { tipo: "audio", texto: "(es un audio: usá voz_transcribir)" };
  if (ext === "pdf") return { tipo: "pdf", texto: "(PDF: no hay lector de texto de PDF todavía)" };
  const texto = contenido.toString("utf-8").replace(/^\uFEFF/, "");
  const lineas = texto.split(/\r?\n/);
  return { tipo: ext === "csv" ? "csv" : "texto", lineas: lineas.filter((l) => l.trim()).length, columnas: ext === "csv" ? (lineas[0] || "").split(/[;,\t]/).map((c) => c.trim().replace(/^"|"$/g, "")) : undefined, texto: lineas.slice(0, maxLineas).join("\n").slice(0, 6000) };
}

export const archivoLeer: DefTool = {
  nombre: "archivo_leer", modulo: MODULO,
  descripcion: "Lee un archivo recibido o generado (por archivo_id): CSV/Excel (columnas, cuántas filas, primeras filas) o texto. Para saber qué contiene una base antes de usarla.",
  parametros: { type: "object", properties: { archivo_id: { type: "string", minLength: 8 }, lineas: { type: "integer", default: 15, minimum: 1, maximum: 200 } }, required: ["archivo_id"] },
  riesgo: "lectura", requiereAprobacion: false, timeoutSeg: 60,
  async ejecutar(a) {
    const { meta, contenido } = await leerArchivo(a.archivo_id);
    const v = await vistaPrevia(contenido, meta.nombre, meta.mime, a.lineas || 15);
    return { ok: true, datos: { nombre: meta.nombre, mime: meta.mime, kb: Math.round(meta.tam_bytes / 1024), ...v }, resumen: `"${meta.nombre}" (${v.tipo}${v.lineas != null ? `, ${v.lineas} filas` : ""})${v.columnas ? `\nColumnas: ${v.columnas.join(", ")}` : ""}\n${v.texto}` };
  },
};

export const archivoListar: DefTool = {
  nombre: "archivo_listar", modulo: MODULO,
  descripcion: "Lista archivos disponibles: los de esta conversación (y los que el jefe mandó al administrador si trabajás por delegación) o, si no hay, los recientes del sistema.",
  parametros: { type: "object", properties: { limite: { type: "integer", default: 10, minimum: 1, maximum: 40 }, solo_bases: { type: "boolean", description: "Solo csv/xlsx.", default: false } }, required: [] },
  riesgo: "lectura", requiereAprobacion: false,
  async ejecutar(a, ctx) {
    let l = ctx.conversacionId ? await archivosDeConversacion(ctx.conversacionId, a.limite || 10) : await archivosRecientes(a.limite || 10);
    if (a.solo_bases) l = l.filter((x) => /\.(csv|xlsx|xls)$/i.test(x.nombre));
    const datos = l.map((x) => ({ archivo_id: x.id, nombre: x.nombre, mime: x.mime, kb: Math.round(x.tam_bytes / 1024), origen: x.origen, fecha: x.creado_en }));
    return { ok: true, datos, resumen: datos.length ? datos.map((d) => `${d.nombre} · ${d.kb} KB · ${d.origen} · archivo_id ${d.archivo_id}`).join("\n") : "No hay archivos." };
  },
};

export const archivoDesdeDocumento: DefTool = {
  nombre: "archivo_desde_documento", modulo: MODULO,
  descripcion: "Convierte un documento de conocimiento del agente (los que se suben en 'Documentos' del panel) en un archivo adjunto con archivo_id, para poder subirlo a Jelcom, mandarlo por WhatsApp, etc.",
  parametros: { type: "object", properties: { nombre: { type: "string", description: "Nombre (o parte) del documento.", minLength: 2 }, agente: { type: "string", description: "Agente dueño del documento (por defecto vos)." } }, required: ["nombre"] },
  riesgo: "lectura", requiereAprobacion: false,
  async ejecutar(a, ctx) {
    let agenteId = ctx.agenteId;
    if (a.agente) { const [ag] = await query<{ id: string }>(`SELECT id FROM agentes WHERE lower(nombre)=lower($1)`, [a.agente]); if (ag) agenteId = ag.id; }
    const [doc] = await query<any>(`SELECT * FROM documentos WHERE ($1::uuid IS NULL OR agente_id=$1) AND nombre ILIKE $2 ORDER BY creado_en DESC LIMIT 1`, [agenteId, `%${a.nombre}%`]);
    if (!doc) return { ok: false, error: `No encontré un documento que contenga "${a.nombre}".` };
    const ext = (doc.nombre.split(".").pop() || "").toLowerCase();
    const mime = ext === "csv" ? "text/csv" : ext === "json" ? "application/json" : "text/plain";
    const arch = await guardarArchivo({ nombre: doc.nombre.includes(".") ? doc.nombre : `${doc.nombre}.txt`, mime, contenido: Buffer.from(doc.contenido, "utf-8"), origen: "panel", conversacionId: ctx.conversacionId ?? null, agenteId: ctx.agenteId });
    return { ok: true, datos: { archivo_id: arch.id, nombre: arch.nombre }, resumen: `Documento "${doc.nombre}" convertido en archivo (archivo_id ${arch.id}).` };
  },
};

export const toolsArchivo: DefTool[] = [archivoLeer, archivoListar, archivoDesdeDocumento];