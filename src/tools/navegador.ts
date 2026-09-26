// ARCHIVO: src/tools/navegador.ts
import type { DefTool } from "../registro/tipos.js";
import { irA, leerPagina, clic, escribir, capturaPagina, cerrarNavegador } from "../motor/navegador.js";
import { analizarImagen } from "../motor/vision.js";
import { guardarArchivo } from "../dominio/archivos.js";

const MODULO = "navegador";

export const navegadorIr: DefTool = {
  nombre: "navegador_ir", modulo: MODULO,
  descripcion: "Abre una URL en el navegador controlado por Emilia y devuelve título y URL final. Después usá navegador_leer para ver el contenido.",
  parametros: { type: "object", properties: { url: { type: "string", minLength: 3 } }, required: ["url"] },
  riesgo: "lectura", requiereAprobacion: false, timeoutSeg: 150,
  async ejecutar(a) { const r = await irA(a.url); return { ok: true, datos: r, resumen: `${r.titulo} — ${r.url}` }; },
};
export const navegadorLeer: DefTool = {
  nombre: "navegador_leer", modulo: MODULO,
  descripcion: "Lee la página actual: texto visible, enlaces y campos de formulario (para decidir dónde hacer clic o escribir).",
  parametros: { type: "object", properties: { max_chars: { type: "integer", default: 6000, minimum: 500, maximum: 30000 } }, required: [] },
  riesgo: "lectura", requiereAprobacion: false, timeoutSeg: 60,
  async ejecutar(a) { const r = await leerPagina(a.max_chars || 6000); return { ok: true, datos: r, resumen: `${r.titulo} — ${r.url}\n\n${r.texto.slice(0, 3000)}\n\nEnlaces: ${r.enlaces.slice(0, 15).map((e) => e.texto).join(" · ")}\nCampos: ${r.campos.slice(0, 15).map((c) => c.nombre || c.placeholder || c.tipo).join(" · ")}` }; },
};
export const navegadorClic: DefTool = {
  nombre: "navegador_clic", modulo: MODULO,
  descripcion: "Hace clic en un elemento por su texto visible o selector CSS.",
  parametros: { type: "object", properties: { objetivo: { type: "string", minLength: 1 } }, required: ["objetivo"] },
  riesgo: "ejecucion", requiereAprobacion: false, timeoutSeg: 60,
  async ejecutar(a) { try { return { ok: true, resumen: await clic(a.objetivo) }; } catch (e: any) { return { ok: false, error: `No pude hacer clic en "${a.objetivo}": ${e?.message?.split("\n")[0]}` }; } },
};
export const navegadorEscribir: DefTool = {
  nombre: "navegador_escribir", modulo: MODULO,
  descripcion: "Escribe en un campo (por placeholder, label o selector CSS), opcionalmente presiona Enter.",
  parametros: { type: "object", properties: { objetivo: { type: "string", minLength: 1 }, texto: { type: "string" }, enter: { type: "boolean", default: false } }, required: ["objetivo", "texto"] },
  riesgo: "ejecucion", requiereAprobacion: false, timeoutSeg: 60,
  async ejecutar(a) { try { return { ok: true, resumen: await escribir(a.objetivo, a.texto, !!a.enter) }; } catch (e: any) { return { ok: false, error: `No pude escribir en "${a.objetivo}": ${e?.message?.split("\n")[0]}` }; } },
};
export const navegadorVer: DefTool = {
  nombre: "navegador_ver", modulo: MODULO,
  descripcion: "Captura la página actual y la describe con visión (útil cuando el texto no alcanza: gráficos, layouts, captchas).",
  parametros: { type: "object", properties: { pregunta: { type: "string" } }, required: [] },
  riesgo: "lectura", requiereAprobacion: false, timeoutSeg: 90,
  async ejecutar(a, ctx) {
    const png = await capturaPagina();
    const arch = await guardarArchivo({ nombre: `pagina_${Date.now()}.png`, mime: "image/png", contenido: png, origen: "generado", conversacionId: ctx.conversacionId ?? null, agenteId: ctx.agenteId });
    const v = await analizarImagen(png, "image/png", { pregunta: a.pregunta || "Describí esta página web: qué es, qué elementos principales hay y qué acciones se pueden hacer." });
    return v.ok ? { ok: true, datos: { archivo_id: arch.id, texto: v.texto }, resumen: `${v.texto}\n(captura archivo_id ${arch.id})` } : { ok: false, error: v.error };
  },
};
export const navegadorCerrar: DefTool = {
  nombre: "navegador_cerrar", modulo: MODULO,
  descripcion: "Cierra el navegador controlado.",
  parametros: { type: "object", properties: {}, required: [] }, riesgo: "lectura", requiereAprobacion: false,
  async ejecutar() { await cerrarNavegador(); return { ok: true, resumen: "Navegador cerrado." }; },
};

export const toolsNavegador: DefTool[] = [navegadorIr, navegadorLeer, navegadorClic, navegadorEscribir, navegadorVer, navegadorCerrar];