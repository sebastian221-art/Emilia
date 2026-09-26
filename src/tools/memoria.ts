// ARCHIVO: src/tools/memoria.ts
// ─────────────────────────────────────────────────────────────────────────────
//  TOOLS DE MEMORIA DE LARGO PLAZO — consultar, guardar, corregir, olvidar
// ─────────────────────────────────────────────────────────────────────────────
import type { DefTool } from "../registro/tipos.js";
import { listarHechos, buscarHechos, guardarHecho, olvidarHecho } from "../dominio/memoria-lp.js";

const MODULO = "memoria";

export const memoriaRecordar: DefTool = {
  nombre: "memoria_recordar", modulo: MODULO,
  descripcion: "Busca en la memoria de largo plazo (hechos durables sobre el jefe y su mundo) por texto. Si no hay texto, lista lo más reciente.",
  parametros: { type: "object", properties: { texto: { type: "string" }, limite: { type: "integer", default: 20, minimum: 1, maximum: 100 } }, required: [] },
  riesgo: "lectura", requiereAprobacion: false,
  async ejecutar(a) {
    const l = a.texto ? await buscarHechos(a.texto, a.limite || 20) : await listarHechos(undefined, a.limite || 20);
    return { ok: true, datos: l.map((h) => ({ sujeto: h.sujeto, clave: h.clave, contenido: h.contenido, categoria: h.categoria, fuente: h.fuente, desde: h.creado_en })), resumen: l.length ? l.map((h) => `• [${h.sujeto}/${h.clave}] ${h.contenido}`).join("\n") : "No tengo nada guardado sobre eso." };
  },
};

export const memoriaGuardar: DefTool = {
  nombre: "memoria_guardar", modulo: MODULO,
  descripcion: "Guarda o corrige un hecho durable en la memoria de largo plazo (lo que el jefe pide recordar, o una preferencia/dato que dijo explícitamente). Misma clave = actualiza.",
  parametros: {
    type: "object",
    properties: {
      clave: { type: "string", description: "slug corto, ej. 'cumpleanos', 'prefiere_audio', 'proyecto_satella'.", minLength: 2 },
      contenido: { type: "string", description: "El hecho en una frase concreta.", minLength: 3 },
      sujeto: { type: "string", description: "'jefe' (defecto) o el nombre de la persona/proyecto al que se refiere.", default: "jefe" },
      categoria: { type: "string", enum: ["personal", "preferencia", "trabajo", "proyecto", "persona", "decision", "general"], default: "general" },
    },
    required: ["clave", "contenido"],
  },
  riesgo: "escritura", requiereAprobacion: false,
  async ejecutar(a, ctx) {
    const h = await guardarHecho({ sujeto: a.sujeto || "jefe", clave: a.clave, contenido: a.contenido, categoria: a.categoria, confianza: 1, fuente: "manual", conversacionId: ctx.conversacionId ?? null, agenteId: ctx.agenteId });
    return { ok: true, datos: h, resumen: `Guardado: [${h.sujeto}/${h.clave}] ${h.contenido}` };
  },
};

export const memoriaOlvidar: DefTool = {
  nombre: "memoria_olvidar", modulo: MODULO,
  descripcion: "Borra hechos de la memoria de largo plazo por clave exacta o por texto que contengan.",
  parametros: { type: "object", properties: { clave_o_texto: { type: "string", minLength: 2 }, sujeto: { type: "string", description: "Si se pasa junto con una clave exacta, borra solo ese." } }, required: ["clave_o_texto"] },
  riesgo: "escritura", requiereAprobacion: false,
  async ejecutar(a) {
    const n = a.sujeto ? await olvidarHecho(a.sujeto, a.clave_o_texto) : await olvidarHecho(a.clave_o_texto);
    return { ok: true, datos: { borrados: n }, resumen: n ? `Olvidado (${n} hecho(s)).` : "No había nada que coincidiera." };
  },
};

export const toolsMemoria: DefTool[] = [memoriaRecordar, memoriaGuardar, memoriaOlvidar];