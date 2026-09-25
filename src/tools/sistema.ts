// ARCHIVO: src/tools/sistema.ts
// ─────────────────────────────────────────────────────────────────────────────
//  TOOLS DE SISTEMA
//  No hacen nada de negocio. Existen para probar el registro, el ejecutor,
//  las aprobaciones, los reintentos y los flujos sin tocar WhatsApp ni Jelcom.
//  Cada una es también el ejemplo canónico de cómo se escribe una tool.
// ─────────────────────────────────────────────────────────────────────────────

import type { DefTool } from "../registro/tipos.js";

const MODULO = "sistema";

export const sistemaEco: DefTool = {
  nombre: "sistema_eco",
  modulo: MODULO,
  descripcion: "Devuelve exactamente el texto que recibe. Sirve para comprobar que una llamada a herramienta llega y vuelve bien.",
  parametros: {
    type: "object",
    properties: {
      texto: { type: "string", description: "Texto a devolver tal cual.", minLength: 1 },
    },
    required: ["texto"],
  },
  riesgo: "lectura",
  requiereAprobacion: false,
  async ejecutar(args) {
    return { ok: true, datos: { texto: args.texto }, resumen: `Eco: "${args.texto}"` };
  },
};

export const sistemaAhora: DefTool = {
  nombre: "sistema_ahora",
  modulo: MODULO,
  descripcion: "Devuelve la fecha y hora actual en Colombia (America/Bogota), en formato legible y en ISO.",
  parametros: { type: "object", properties: {}, required: [] },
  riesgo: "lectura",
  requiereAprobacion: false,
  async ejecutar() {
    const ahora = new Date();
    const legible = ahora.toLocaleString("es-CO", { timeZone: "America/Bogota", dateStyle: "full", timeStyle: "short" });
    return { ok: true, datos: { iso: ahora.toISOString(), legible, zona: "America/Bogota" }, resumen: `Ahora es ${legible}.` };
  },
};

export const sistemaEsperar: DefTool = {
  nombre: "sistema_esperar",
  modulo: MODULO,
  descripcion: "Espera la cantidad de segundos indicada (máximo 60) y luego responde. Sirve para probar esperas y timeouts.",
  parametros: {
    type: "object",
    properties: {
      segundos: { type: "number", description: "Segundos a esperar (0 a 60).", minimum: 0, maximum: 60 },
    },
    required: ["segundos"],
  },
  riesgo: "lectura",
  requiereAprobacion: false,
  timeoutSeg: 90,
  async ejecutar(args) {
    const s = Number(args.segundos);
    await new Promise((r) => setTimeout(r, s * 1000));
    return { ok: true, datos: { esperado: s }, resumen: `Esperé ${s} segundo(s).` };
  },
};

export const sistemaFallar: DefTool = {
  nombre: "sistema_fallar",
  modulo: MODULO,
  descripcion: "Falla a propósito. Con modo 'error' devuelve ok=false; con modo 'excepcion' lanza una excepción. Sirve para probar cómo reacciona el agente ante fallos.",
  parametros: {
    type: "object",
    properties: {
      modo: { type: "string", enum: ["error", "excepcion"], description: "Cómo fallar.", default: "error" },
      mensaje: { type: "string", description: "Mensaje del fallo.", default: "Fallo simulado" },
    },
    required: [],
  },
  riesgo: "lectura",
  requiereAprobacion: false,
  async ejecutar(args) {
    const msg = String(args.mensaje || "Fallo simulado");
    if (args.modo === "excepcion") throw new Error(msg);
    return { ok: false, error: msg };
  },
};

export const sistemaAccionSensible: DefTool = {
  nombre: "sistema_accion_sensible",
  modulo: MODULO,
  descripcion: "Simula una acción irreversible (como disparar un envío). No hace nada real, pero está marcada como que requiere aprobación humana: sirve para probar el circuito de aprobaciones.",
  parametros: {
    type: "object",
    properties: {
      accion: { type: "string", description: "Descripción de la acción que se simula.", minLength: 3 },
    },
    required: ["accion"],
  },
  riesgo: "ejecucion",
  requiereAprobacion: true,
  async ejecutar(args) {
    return { ok: true, datos: { ejecutada: args.accion }, resumen: `Acción sensible simulada: ${args.accion}` };
  },
};

export const toolsSistema: DefTool[] = [sistemaEco, sistemaAhora, sistemaEsperar, sistemaFallar, sistemaAccionSensible];