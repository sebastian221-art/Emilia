// ARCHIVO: src/tools/pc-extra.ts
// OCR, foco, Office por COM y grabadora, como tools sueltas del módulo pc/office/grabacion.
import type { DefTool } from "../registro/tipos.js";
import { exigirPc } from "../motor/pc.js";
import { ocrPantalla, clicTexto } from "../motor/ocr.js";
import { enfocarVentana, ventanaActivaInfo } from "../motor/pc-control.js";
import { excelEscribir, excelLeer, wordCrear, wordLeer, outlookEnviar } from "../motor/office.js";
import { iniciarGrabacion, detenerGrabacion, grabando } from "../motor/grabadora.js";

const libre = () => (process.env.PC_CONTROL_LIBRE || "").toLowerCase() === "true";
function guardaLibre() { if (!libre()) throw new Error("Las acciones directas requieren PC_CONTROL_LIBRE=true, o usá pc_operar."); }

export const pcOcr: DefTool = {
  nombre: "pc_ocr", modulo: "pc",
  descripcion: "Lee el texto de la pantalla principal con OCR nativo de Windows (con posiciones). Funciona en cualquier app, incluso sin accesibilidad. Más fiable que la visión para leer.",
  parametros: { type: "object", properties: { buscar: { type: "string", description: "Si se pasa, solo devuelve líneas que lo contengan." } }, required: [] },
  riesgo: "lectura", requiereAprobacion: false, timeoutSeg: 60,
  async ejecutar(a) { const o = await ocrPantalla(); const l = a.buscar ? o.lineas.filter((x) => x.toLowerCase().includes(String(a.buscar).toLowerCase())) : o.lineas; return { ok: true, datos: { lineas: l, palabras: o.palabras.length }, resumen: l.slice(0, 80).join("\n") || "(no se leyó texto)" }; },
};
export const pcClicTexto: DefTool = {
  nombre: "pc_clic_texto", modulo: "pc",
  descripcion: "Clic en un texto que se ve en pantalla (por OCR): 'Guardar', 'Aceptar', el nombre de un archivo… Sin coordenadas ni modelo de visión.",
  parametros: { type: "object", properties: { texto: { type: "string", minLength: 1 }, ocurrencia: { type: "integer", default: 1, minimum: 1 } }, required: ["texto"] },
  riesgo: "ejecucion", requiereAprobacion: false, timeoutSeg: 60,
  async ejecutar(a) { exigirPc(); guardaLibre(); const r = await clicTexto(a.texto, a.ocurrencia || 1); return r.ok ? { ok: true, resumen: `Clic en "${r.caja?.texto}".` } : { ok: false, error: `${r.error} Veo: ${(r.vistos || []).slice(0, 12).join(" · ")}` }; },
};
export const pcEnfocar: DefTool = {
  nombre: "pc_enfocar", modulo: "pc",
  descripcion: "Trae al frente la ventana de un programa (por proceso: notepad, calculatorapp, chrome, excel…) o por parte del título. Devuelve cuál quedó activa.",
  parametros: { type: "object", properties: { proceso: { type: "string" }, titulo: { type: "string" } }, required: [] },
  riesgo: "ejecucion", requiereAprobacion: false, timeoutSeg: 30,
  async ejecutar(a) { exigirPc(); const r = await enfocarVentana({ proceso: a.proceso, titulo: a.titulo }); return r.ok ? { ok: true, resumen: `Al frente: "${r.ventana.titulo}" (${r.ventana.proceso}).` } : { ok: false, error: r.error }; },
};
export const pcVentanaActiva: DefTool = {
  nombre: "pc_ventana_activa", modulo: "pc",
  descripcion: "Qué ventana está al frente ahora (título y proceso).",
  parametros: { type: "object", properties: {}, required: [] }, riesgo: "lectura", requiereAprobacion: false,
  async ejecutar() { exigirPc(); const v = await ventanaActivaInfo(); return { ok: true, datos: v, resumen: `"${v.titulo}" (${v.proceso}, pid ${v.pid})` }; },
};

export const officeExcelEscribir: DefTool = {
  nombre: "office_excel_escribir", modulo: "office",
  descripcion: "Escribe valores o fórmulas en celdas de un archivo Excel (lo crea si no existe) sin abrir la interfaz. celdas: {\"A1\":\"Nombre\",\"B1\":42,\"C1\":\"=A1&B1\"}.",
  parametros: { type: "object", properties: { ruta: { type: "string", minLength: 3 }, celdas: { type: "object" }, hoja: { type: "string" } }, required: ["ruta", "celdas"] },
  riesgo: "escritura", requiereAprobacion: false, timeoutSeg: 120,
  async ejecutar(a) { const r = await excelEscribir(a.ruta, a.celdas || {}, a.hoja); return r.ok ? { ok: true, resumen: `Guardado ${r.ruta} (${Object.keys(a.celdas || {}).length} celdas).` } : { ok: false, error: r.error }; },
};
export const officeExcelLeer: DefTool = {
  nombre: "office_excel_leer", modulo: "office",
  descripcion: "Lee un rango de un Excel (texto por celda).",
  parametros: { type: "object", properties: { ruta: { type: "string", minLength: 3 }, rango: { type: "string", default: "A1:F30" }, hoja: { type: "string" } }, required: ["ruta"] },
  riesgo: "lectura", requiereAprobacion: false, timeoutSeg: 120,
  async ejecutar(a) { const r = await excelLeer(a.ruta, a.rango || "A1:F30", a.hoja); return r.ok ? { ok: true, datos: r.filas, resumen: (r.filas || []).map((f) => f.join(" | ")).join("\n").slice(0, 4000) || "(vacío)" } : { ok: false, error: r.error }; },
};
export const officeWordCrear: DefTool = {
  nombre: "office_word_crear", modulo: "office",
  descripcion: "Crea un documento Word (.docx) con un título opcional y texto (párrafos por línea), sin abrir la interfaz.",
  parametros: { type: "object", properties: { ruta: { type: "string", minLength: 3 }, texto: { type: "string", minLength: 1 }, titulo: { type: "string" } }, required: ["ruta", "texto"] },
  riesgo: "escritura", requiereAprobacion: false, timeoutSeg: 120,
  async ejecutar(a) { const r = await wordCrear(a.ruta, a.texto, a.titulo); return r.ok ? { ok: true, resumen: `Creado ${r.ruta}.` } : { ok: false, error: r.error }; },
};
export const officeWordLeer: DefTool = {
  nombre: "office_word_leer", modulo: "office",
  descripcion: "Lee el texto de un documento Word.",
  parametros: { type: "object", properties: { ruta: { type: "string", minLength: 3 } }, required: ["ruta"] },
  riesgo: "lectura", requiereAprobacion: false, timeoutSeg: 120,
  async ejecutar(a) { const r = await wordLeer(a.ruta); return r.ok ? { ok: true, datos: { texto: r.texto }, resumen: (r.texto || "").slice(0, 4000) } : { ok: false, error: r.error }; },
};
export const officeOutlookEnviar: DefTool = {
  nombre: "office_outlook_enviar", modulo: "office",
  descripcion: "Envía un correo desde Outlook de escritorio (cuenta por defecto), con adjuntos opcionales. Requiere aprobación.",
  parametros: { type: "object", properties: { para: { type: "string", minLength: 3 }, asunto: { type: "string", minLength: 1 }, cuerpo: { type: "string" }, cc: { type: "string" }, adjuntos: { type: "array", items: { type: "string" } } }, required: ["para", "asunto", "cuerpo"] },
  riesgo: "ejecucion", requiereAprobacion: true, timeoutSeg: 90,
  async ejecutar(a) { const r = await outlookEnviar({ para: a.para, asunto: a.asunto, cuerpo: a.cuerpo, cc: a.cc, adjuntos: a.adjuntos }); return r.ok ? { ok: true, resumen: `Correo enviado a ${a.para}.` } : { ok: false, error: r.error }; },
};

export const grabacionIniciar: DefTool = {
  nombre: "grabacion_iniciar", modulo: "grabacion",
  descripcion: "Empieza a grabar lo que el jefe hace en el PC (clics con el nombre del control, teclas y texto) para convertirlo en una receta que el operador pueda repetir. El jefe hace la tarea y luego dice 'terminá la grabación como X'.",
  parametros: { type: "object", properties: {}, required: [] }, riesgo: "ejecucion", requiereAprobacion: false,
  async ejecutar() { const r = await iniciarGrabacion(); return r.ok ? { ok: true, resumen: "Grabando. Hacé la tarea con calma; cuando termines, decime 'terminá la grabación como <nombre>'." } : { ok: false, error: r.error }; },
};
export const grabacionDetener: DefTool = {
  nombre: "grabacion_detener", modulo: "grabacion",
  descripcion: "Detiene la grabación y la guarda como receta con el nombre dado. Devuelve la secuencia aprendida.",
  parametros: { type: "object", properties: { nombre: { type: "string", minLength: 2 } }, required: ["nombre"] },
  riesgo: "escritura", requiereAprobacion: false,
  async ejecutar(a, ctx) { const r = await detenerGrabacion(a.nombre, ctx.agenteId); return r.ok ? { ok: true, datos: r, resumen: `Receta "${a.nombre}" guardada (${r.pasos} pasos):\n${r.receta}` } : { ok: false, error: r.error }; },
};
export const grabacionEstado: DefTool = {
  nombre: "grabacion_estado", modulo: "grabacion",
  descripcion: "¿Hay una grabación en curso?",
  parametros: { type: "object", properties: {}, required: [] }, riesgo: "lectura", requiereAprobacion: false,
  async ejecutar() { return { ok: true, resumen: grabando() ? "Sí, grabando." : "No hay grabación en curso." }; },
};

export const toolsPcExtra: DefTool[] = [pcOcr, pcClicTexto, pcEnfocar, pcVentanaActiva, officeExcelEscribir, officeExcelLeer, officeWordCrear, officeWordLeer, officeOutlookEnviar, grabacionIniciar, grabacionDetener, grabacionEstado];