// ARCHIVO: src/tools/carpetas.ts
// ─────────────────────────────────────────────────────────────────────────────
//  CARPETAS DE CONOCIMIENTO (Lara): crear la carpeta de un proyecto, importar
//  documentos / carpetas del PC / el repo, y ver qué sabe cada carpeta.
// ─────────────────────────────────────────────────────────────────────────────
import type { DefTool } from "../registro/tipos.js";
import { query } from "../db/cliente.js";
import { espacios, asegurarEspacio, espacioProyecto } from "../motor/cerebro.js";
import { importarTexto, importarCarpetaPc, importarRepo } from "../motor/carpetas.js";

const MODULO = "carpeta";
const nombreCarpeta = (c: string) => (c === "general" || c === "personal" ? c : c.startsWith("proyecto:") ? espacioProyecto(c.slice(9)) : espacioProyecto(c));

export const carpetaListar: DefTool = {
  nombre: "carpeta_listar", modulo: MODULO,
  descripcion: "Las carpetas del cerebro compartido (general, personal y una por proyecto) con cuántos recuerdos tiene cada una y su resumen.",
  parametros: { type: "object", properties: {} },
  riesgo: "lectura", requiereAprobacion: false, timeoutSeg: 20,
  async ejecutar() {
    const xs = await espacios();
    return { ok: true, datos: xs, resumen: xs.map((e: any) => `📁 ${e.slug} — ${e.nombre} (${e.nodos} recuerdos)${e.resumen ? `\n   ${String(e.resumen).slice(0, 220)}` : e.descripcion ? `\n   ${String(e.descripcion).slice(0, 160)}` : ""}`).join("\n") };
  },
};

export const carpetaCrear: DefTool = {
  nombre: "carpeta_crear", modulo: MODULO,
  descripcion: "Crea (o actualiza) la carpeta de conocimiento de un proyecto (p. ej. chat_bot_cc, hospital_san_gil, jelcom_envios). Si el proyecto está registrado para Sage, puedes importar su repo con carpeta_importar(desde_repo).",
  parametros: { type: "object", properties: { proyecto: { type: "string", minLength: 2 }, descripcion: { type: "string" } }, required: ["proyecto"] },
  riesgo: "escritura", requiereAprobacion: false, timeoutSeg: 20,
  async ejecutar(a) {
    const slug = espacioProyecto(a.proyecto);
    await asegurarEspacio(slug, { nombre: a.proyecto, descripcion: a.descripcion });
    return { ok: true, resumen: `📁 Carpeta ${slug} lista. Ahora puedes darme sus documentos (archivo, texto o carpeta del PC) o su repo.` };
  },
};

export const carpetaImportar: DefTool = {
  nombre: "carpeta_importar", modulo: MODULO,
  descripcion: "Mete conocimiento a una carpeta: un archivo que mandó el jefe (archivo_id: PDF, Word, Markdown…), un texto pegado, una carpeta del PC (ruta) o el repo de un proyecto registrado (desde_repo). Cada documento queda completo por secciones y además se sacan sus piezas clave (cómo se hace, fallas conocidas y su arreglo, datos técnicos, decisiones).",
  parametros: { type: "object", properties: {
    carpeta: { type: "string", minLength: 2, description: "Nombre del proyecto (o general)." },
    archivo_id: { type: "string" }, texto: { type: "string" }, nombre: { type: "string", description: "Nombre del documento (si es texto pegado)." },
    ruta: { type: "string", description: "Carpeta del PC con documentos." }, desde_repo: { type: "boolean", description: "Leer el repo del proyecto registrado (README, docs, scripts, despliegue, estructura)." },
  }, required: ["carpeta"] },
  riesgo: "escritura", requiereAprobacion: false, timeoutSeg: 1800,
  async ejecutar(a, ctx) {
    const carpeta = nombreCarpeta(a.carpeta);
    if (carpeta === "personal") return { ok: false, error: "La carpeta personal se llena con lo que el jefe cuenta, no con importaciones." };
    try {
      const res: string[] = [];
      if (a.archivo_id) {
        const { obtenerArchivo } = await import("../dominio/archivos.js");
        const { textoDeDocumento } = await import("../motor/texto-documento.js");
        const f: any = await obtenerArchivo(a.archivo_id); if (!f) return { ok: false, error: "No encuentro ese archivo (archivo_listar)." };
        const fs = await import("node:fs/promises");
        const t = await textoDeDocumento(await fs.readFile(f.ruta), f.mime, f.nombre, 600_000);
        const r = await importarTexto(carpeta, { nombre: a.nombre || f.nombre, texto: t || "", origen: `archivo:${f.id}`, agenteId: ctx?.agenteId ?? null });
        res.push(r.omitido ? `• ${f.nombre}: ${r.omitido}` : `• ${f.nombre}: ${r.secciones} secciones, ${r.piezas} piezas clave`);
      }
      if (a.texto) { const r = await importarTexto(carpeta, { nombre: a.nombre || "Notas", texto: a.texto, origen: "texto", agenteId: ctx?.agenteId ?? null }); res.push(r.omitido ? `• ${a.nombre || "Notas"}: ${r.omitido}` : `• ${a.nombre || "Notas"}: ${r.secciones} secciones, ${r.piezas} piezas clave`); }
      if (a.ruta) { const rs = await importarCarpetaPc(carpeta, a.ruta, { agenteId: ctx?.agenteId ?? null }); res.push(`• Carpeta ${a.ruta}: ${rs.filter((r) => !r.omitido).length} documento(s) importados, ${rs.reduce((s, r) => s + r.piezas, 0)} piezas clave${rs.some((r) => r.omitido) ? ` (${rs.filter((r) => r.omitido).length} omitidos)` : ""}`); }
      if (a.desde_repo) { const r = await importarRepo(a.carpeta.replace(/^proyecto:/, ""), { agenteId: ctx?.agenteId ?? null }); res.push(`• Repo: ficha técnica + ${r.documentos.filter((d) => !d.omitido).length} documento(s) (${r.documentos.reduce((s, d) => s + d.piezas, 0)} piezas clave)`); }
      if (!res.length) return { ok: false, error: "Dame qué importar: archivo_id, texto, ruta o desde_repo." };
      return { ok: true, resumen: `📁 ${carpeta}:\n${res.join("\n")}\nEsta noche actualizo el resumen de la carpeta.` };
    } catch (e: any) { return { ok: false, error: String(e?.message || e) }; }
  },
};

export const carpetaVer: DefTool = {
  nombre: "carpeta_ver", modulo: MODULO,
  descripcion: "Qué sabe una carpeta: su resumen, documentos, procedimientos, fallas conocidas y lecciones (lo más importante primero).",
  parametros: { type: "object", properties: { carpeta: { type: "string", minLength: 2 }, max: { type: "integer", default: 25 } }, required: ["carpeta"] },
  riesgo: "lectura", requiereAprobacion: false, timeoutSeg: 20,
  async ejecutar(a) {
    const c = nombreCarpeta(a.carpeta);
    if (c === "personal") return { ok: false, error: "Lo personal se consulta con memoria_recordar(carpeta=personal), atendiendo al jefe." };
    const [e] = await query<any>(`SELECT * FROM bib_espacios WHERE slug = $1`, [c]);
    if (!e) return { ok: false, error: `No existe la carpeta ${c} (carpeta_listar).` };
    const xs = await query<any>(`SELECT clase, titulo, left(resumen, 200) AS resumen FROM bib_nodos WHERE espacio = $1 AND borrado_en IS NULL AND NOT (etiquetas @> ARRAY['seccion']) ORDER BY CASE clase WHEN 'resumen' THEN 0 WHEN 'procedimiento' THEN 1 WHEN 'leccion' THEN 2 WHEN 'hecho' THEN 3 ELSE 4 END, importancia DESC, actualizado_en DESC LIMIT $2`, [c, a.max || 25]);
    const [t] = await query<any>(`SELECT count(*)::int AS n FROM bib_nodos WHERE espacio = $1 AND borrado_en IS NULL`, [c]);
    return { ok: true, datos: { carpeta: e, items: xs }, resumen: `📁 ${e.nombre} (${t.n} recuerdos)${e.resumen ? `\n${e.resumen}` : ""}\n\n${xs.map((x) => `• [${x.clase}] ${x.titulo}: ${String(x.resumen).replace(/\s+/g, " ")}`).join("\n")}` };
  },
};

export const toolsCarpetas = [carpetaListar, carpetaCrear, carpetaImportar, carpetaVer];
