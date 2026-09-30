// ARCHIVO: src/tools/pc-operar.ts
// ─────────────────────────────────────────────────────────────────────────────
//  TOOLS DE OPERACIÓN DEL PC (computer use visual, nivel 2)
//  pc_operar: le das una tarea en lenguaje natural y el operador la ejecuta
//  mirando la pantalla (una aprobación por tarea). Primitivas pc_clic /
//  pc_escribir / pc_tecla / pc_scroll para que el agente actúe él mismo con
//  pc_ver_pantalla; libres solo con PC_CONTROL_LIBRE=true (si no, aprobación).
// ─────────────────────────────────────────────────────────────────────────────
import type { DefTool } from "../registro/tipos.js";
import { operarPc } from "../motor/operador-pc.js";
import { operarV2 } from "../motor/operador-v2.js";
import { elementosVentana, clicElemento, escribirEnElemento, textoVentana } from "../motor/uia.js";
import { clic, escribirTexto, tecla, scroll, tamanoPantalla, ventanaActiva } from "../motor/pc-control.js";
import { exigirPc } from "../motor/pc.js";
import { avisarProgreso } from "../motor/actividad.js";

const MODULO = "pc";
const libre = () => (process.env.PC_CONTROL_LIBRE || "").toLowerCase() === "true";

export const pcOperar: DefTool = {
  nombre: "pc_operar", modulo: MODULO,
  descripcion: "OPERA el computador para cumplir una tarea en lenguaje natural: planifica, usa comandos y teclado cuando alcanza, controles por nombre (accesibilidad) cuando hay que hacer clic, y visión solo como último recurso; verifica el resultado y aprende la receta. Ej: 'en la calculadora hacé 2x2 y decime el resultado', 'abrí el bloc de notas, escribí X y guardalo en el escritorio como y.txt', 'en Excel poné Hola en A1'. Si la tarea requiere contraseñas o pagos, se detiene y pregunta.",
  parametros: {
    type: "object",
    properties: {
      tarea: { type: "string", description: "Qué hacer, concreto, con el resultado esperado (y rutas/nombres exactos si los hay).", minLength: 5 },
      modo: { type: "string", enum: ["auto", "visual"], description: "auto (defecto): planificador por capas. visual: solo el operador de visión (para apps sin accesibilidad).", default: "auto" },
    },
    required: ["tarea"],
  },
  riesgo: "sistema", requiereAprobacion: true, timeoutSeg: 900,
  async ejecutar(a, ctx) {
    exigirPc();
    await avisarProgreso(ctx.conversacionId, `🖱 Voy a operar el PC: "${a.tarea.slice(0, 120)}". No toques el mouse; te aviso.`);
    if (a.modo === "visual") {
      const r = await operarPc(a.tarea, { maxPasos: 40, permitirTexto: true, contexto: { conversacionId: ctx.conversacionId, agenteId: ctx.agenteId }, onPaso: async (p) => { await ctx.traza("tool", `pc_operar(visual) paso ${p.n}: ${p.accion} ${p.detalle}${p.error ? " ERROR " + p.error : ""} — ${p.motivo}`); } });
      const bit = r.pasos.map((p) => `${p.n}. ${p.accion} ${p.detalle}${p.error ? " ✘ " + p.error : ""}`).join("\n");
      return r.estado === "cumplida" ? { ok: true, datos: r, resumen: `✅ ${r.resumen}` } : { ok: false, error: `${r.resumen}\n${bit}`, datos: r };
    }
    let contador = 0;
    const r = await operarV2(a.tarea, {
      agenteId: ctx.agenteId, conversacionId: ctx.conversacionId,
      onPaso: async (b) => { contador++; await ctx.traza("tool", `pc_operar ${b.n}: [${b.capa}] ${b.accion}(${b.args}) → ${b.error ? "ERROR " + b.error : b.resultado}`); if (contador % 4 === 0) await avisarProgreso(ctx.conversacionId, `🖱 ${b.n}: ${b.accion} ${b.error ? "✘ " + b.error.slice(0, 80) : "✔"}`); },
    });
    const bit = r.bitacora.map((b) => `${b.n}. [${b.capa}] ${b.accion}(${b.args}) → ${b.error ? "✘ " + b.error : b.resultado}`).join("\n");
    if (r.estado === "cumplida") return { ok: true, datos: { ...r, bitacora: r.bitacora.length }, resumen: `✅ ${r.resumen}${r.lecturas.length ? "\nLo leído: " + r.lecturas.join(" | ").slice(0, 600) : ""}\n(${r.bitacora.length} pasos${r.captura_id ? "; captura " + r.captura_id : ""})` };
    if (r.estado === "cancelada") return { ok: false, error: "Detenido por el jefe.", datos: r };
    if (r.estado === "necesita_jefe") return { ok: false, error: `Necesito una decisión del jefe: ${r.pregunta}\nHasta ahí:\n${bit}`, datos: r };
    return { ok: false, error: `${r.resumen}\nBitácora:\n${bit}`, datos: r };
  },
};

export const pcElementos: DefTool = {
  nombre: "pc_elementos", modulo: MODULO,
  descripcion: "Lista los controles de la ventana activa por accesibilidad (botones, campos, menús, textos) con nombre, tipo, valor y posición. Es la forma precisa de saber qué hay en pantalla y cómo se llama cada botón.",
  parametros: { type: "object", properties: { filtro: { type: "string", description: "Filtrar por texto en nombre/tipo/valor." } }, required: [] },
  riesgo: "lectura", requiereAprobacion: false, timeoutSeg: 60,
  async ejecutar(a) { const r = await elementosVentana(a.filtro); const l = r.elementos.filter((e) => e.nombre || e.valor).slice(0, 80); return { ok: true, datos: { ventana: r.ventana, elementos: l }, resumen: `Ventana "${r.ventana}" — ${r.elementos.length} controles:\n` + l.map((e) => `${e.tipo}: ${e.nombre}${e.valor ? " = " + e.valor.slice(0, 40) : ""}${e.habilitado ? "" : " (deshabilitado)"}`).join("\n") }; },
};
export const pcLeerVentana: DefTool = {
  nombre: "pc_leer_ventana", modulo: MODULO,
  descripcion: "Texto visible de la ventana activa leído por accesibilidad (más preciso que la visión para resultados, campos, listas).",
  parametros: { type: "object", properties: {}, required: [] }, riesgo: "lectura", requiereAprobacion: false, timeoutSeg: 60,
  async ejecutar() { const r = await textoVentana(); return { ok: true, datos: r, resumen: `[${r.ventana}]\n${r.texto.slice(0, 3000) || "(sin texto accesible)"}` }; },
};
export const pcClicElemento: DefTool = {
  nombre: "pc_clic_elemento", modulo: MODULO,
  descripcion: "Clic en un control de la ventana activa POR NOMBRE (el nombre que muestra pc_elementos), sin coordenadas. Usa Invoke de accesibilidad y, si no, clic físico en su centro.",
  parametros: { type: "object", properties: { nombre: { type: "string", minLength: 1 }, tipo: { type: "string", description: "Button, MenuItem, ListItem, TabItem… (opcional)" } }, required: ["nombre"] },
  riesgo: "ejecucion", requiereAprobacion: false, timeoutSeg: 60,
  async ejecutar(a) { exigirPc(); guardaLibre(); const r = await clicElemento(a.nombre, a.tipo); return r.ok ? { ok: true, resumen: `Clic en "${r.elemento?.nombre}" (${r.metodo}).` } : { ok: false, error: r.error }; },
};
export const pcEscribirElemento: DefTool = {
  nombre: "pc_escribir_elemento", modulo: MODULO,
  descripcion: "Escribe en un campo de la ventana activa POR NOMBRE (ej. 'Nombre de archivo'). Con nombre '*' usa el primer campo de texto.",
  parametros: { type: "object", properties: { nombre: { type: "string", minLength: 1 }, texto: { type: "string" } }, required: ["nombre", "texto"] },
  riesgo: "ejecucion", requiereAprobacion: false, timeoutSeg: 60,
  async ejecutar(a) { exigirPc(); guardaLibre(); const r = await escribirEnElemento(a.nombre, a.texto); return r.ok ? { ok: true, resumen: `Escrito en "${r.elemento?.nombre}" (${r.metodo}).` } : { ok: false, error: r.error }; },
};

function guardaLibre() { if (!libre()) throw new Error("Las acciones directas de mouse/teclado requieren PC_CONTROL_LIBRE=true en el .env, o usá pc_operar (que pide una aprobación por tarea)."); }

export const pcClic: DefTool = {
  nombre: "pc_clic", modulo: MODULO,
  descripcion: "Clic en coordenadas de pantalla (píxeles absolutos; obtenelas con pc_ver_pantalla preguntando dónde está el elemento).",
  parametros: { type: "object", properties: { x: { type: "integer" }, y: { type: "integer" }, boton: { type: "string", enum: ["izquierdo", "derecho", "medio"], default: "izquierdo" }, doble: { type: "boolean", default: false } }, required: ["x", "y"] },
  riesgo: "ejecucion", requiereAprobacion: false, timeoutSeg: 30,
  async ejecutar(a) { exigirPc(); guardaLibre(); const p = await tamanoPantalla(); await clic(a.x + p.x, a.y + p.y, { boton: a.boton, doble: !!a.doble }); return { ok: true, resumen: `Clic en (${a.x},${a.y}). Ventana activa: ${await ventanaActiva().catch(() => "?")}` }; },
};
export const pcEscribir: DefTool = {
  nombre: "pc_escribir", modulo: MODULO,
  descripcion: "Teclea texto donde está el foco (hacé clic antes en el campo).",
  parametros: { type: "object", properties: { texto: { type: "string", minLength: 1 }, enter: { type: "boolean", default: false } }, required: ["texto"] },
  riesgo: "ejecucion", requiereAprobacion: false, timeoutSeg: 30,
  async ejecutar(a) { exigirPc(); guardaLibre(); await escribirTexto(a.texto); if (a.enter) await tecla("enter"); return { ok: true, resumen: `Escrito: "${String(a.texto).slice(0, 60)}"${a.enter ? " + Enter" : ""}` }; },
};
export const pcTecla: DefTool = {
  nombre: "pc_tecla", modulo: MODULO,
  descripcion: "Presiona una tecla o atajo: 'enter', 'tab', 'esc', 'ctrl+s', 'alt+f4', 'ctrl+shift+t', 'win'.",
  parametros: { type: "object", properties: { teclas: { type: "string", minLength: 1 } }, required: ["teclas"] },
  riesgo: "ejecucion", requiereAprobacion: false, timeoutSeg: 30,
  async ejecutar(a) { exigirPc(); guardaLibre(); await tecla(a.teclas); return { ok: true, resumen: `Tecla: ${a.teclas}` }; },
};
export const pcScroll: DefTool = {
  nombre: "pc_scroll", modulo: MODULO,
  descripcion: "Scroll en la posición dada (o el centro): arriba o abajo N pasos.",
  parametros: { type: "object", properties: { direccion: { type: "string", enum: ["arriba", "abajo"], default: "abajo" }, cantidad: { type: "integer", default: 3, minimum: 1, maximum: 30 }, x: { type: "integer" }, y: { type: "integer" } }, required: [] },
  riesgo: "ejecucion", requiereAprobacion: false, timeoutSeg: 30,
  async ejecutar(a) { exigirPc(); guardaLibre(); const p = await tamanoPantalla(); await scroll((a.x ?? p.ancho / 2) + p.x, (a.y ?? p.alto / 2) + p.y, a.direccion === "abajo" ? -(a.cantidad || 3) : (a.cantidad || 3)); return { ok: true, resumen: `Scroll ${a.direccion || "abajo"} x${a.cantidad || 3}` }; },
};

export const toolsPcOperar: DefTool[] = [pcOperar, pcElementos, pcLeerVentana, pcClicElemento, pcEscribirElemento, pcClic, pcEscribir, pcTecla, pcScroll];