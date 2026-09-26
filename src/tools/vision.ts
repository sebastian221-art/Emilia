// ARCHIVO: src/tools/vision.ts
// ─────────────────────────────────────────────────────────────────────────────
//  TOOLS DE VISIÓN — preguntar sobre imágenes ya recibidas o generadas
// ─────────────────────────────────────────────────────────────────────────────

import type { DefTool } from "../registro/tipos.js";
import { leerArchivo, archivosDeConversacion, archivosRecientes } from "../dominio/archivos.js";
import { analizarImagenes, esImagen } from "../motor/vision.js";

const MODULO = "vision";

export const visionAnalizar: DefTool = {
  nombre: "vision_analizar", modulo: MODULO,
  descripcion: "Mira una o más imágenes (por archivo_id) y responde una pregunta sobre ellas o las describe: leer un error de un pantallazo, transcribir texto o una tabla, identificar qué hay. Con json=true devuelve datos estructurados (ej. extraer una tabla).",
  parametros: {
    type: "object",
    properties: {
      archivo_ids: { type: "array", items: { type: "string" }, description: "Ids de los archivos de imagen (hasta 3). Si se omite, usa la última imagen recibida en esta conversación." },
      pregunta: { type: "string", description: "Qué querés saber o extraer. Si se omite, describe." },
      json: { type: "boolean", description: "Pedir respuesta JSON.", default: false },
    },
    required: [],
  },
  riesgo: "lectura", requiereAprobacion: false, timeoutSeg: 90,
  async ejecutar(a, ctx) {
    let ids: string[] = Array.isArray(a.archivo_ids) ? a.archivo_ids : [];
    if (!ids.length) {
      const recientes = ctx.conversacionId ? await archivosDeConversacion(ctx.conversacionId, 10) : await archivosRecientes(10);
      const ultima = recientes.find((x) => esImagen(x.mime));
      if (!ultima) return { ok: false, error: "No encontré ninguna imagen reciente. Pedí que la manden o pasá archivo_ids." };
      ids = [ultima.id];
    }
    const imagenes = [];
    for (const id of ids.slice(0, 3)) {
      const { meta, contenido } = await leerArchivo(id);
      if (!esImagen(meta.mime)) return { ok: false, error: `El archivo "${meta.nombre}" no es una imagen (${meta.mime}).` };
      imagenes.push({ contenido, mime: meta.mime });
    }
    const r = await analizarImagenes(imagenes, { pregunta: a.pregunta, json: !!a.json });
    if (!r.ok) return { ok: false, error: r.error };
    return { ok: true, datos: { texto: r.texto, json: r.json, modelo: r.modelo, archivo_ids: ids }, resumen: r.texto };
  },
};

export const toolsVision: DefTool[] = [visionAnalizar];