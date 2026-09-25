// ARCHIVO: src/flujos/sistema.ts
// ─────────────────────────────────────────────────────────────────────────────
//  FLUJOS DE SISTEMA
//  Flujo de prueba que recorre todos los tipos de paso. Sirve para validar el
//  motor (aprobación, repetir, esperar, sub-flujo, fin) sin tocar negocio.
// ─────────────────────────────────────────────────────────────────────────────

import type { DefFlujo } from "../registro/tipos.js";

const MODULO = "sistema";

/** Sub-flujo mínimo: devuelve la hora. */
export const sistemaHora: DefFlujo = {
  nombre: "sistema_hora",
  modulo: MODULO,
  descripcion: "Sub-flujo de prueba: consulta la hora y la devuelve.",
  parametros: { type: "object", properties: {}, required: [] },
  riesgo: "lectura",
  inicio: "hora",
  pasos: [
    { id: "hora", tipo: "tool", tool: "sistema_ahora", args: {}, guardarEn: "hora" },
    { id: "fin", tipo: "fin", resultado: (ctx) => ctx.hora },
  ],
};

export const sistemaPruebaCompleta: DefFlujo = {
  nombre: "sistema_prueba_completa",
  modulo: MODULO,
  descripcion: "Flujo de prueba que recorre sub-flujo → condición → aprobación → repetir → tool sensible → fin. Sirve para validar el motor de flujos.",
  parametros: {
    type: "object",
    properties: {
      veces: { type: "integer", description: "Cuántas iteraciones hacer en el paso repetir.", minimum: 1, maximum: 5, default: 2 },
      espera: { type: "integer", description: "Segundos de espera entre iteraciones (si > 10 se persiste).", minimum: 0, maximum: 120, default: 1 },
    },
    required: [],
  },
  riesgo: "ejecucion",
  inicio: "hora",
  pasos: [
    { id: "hora",     tipo: "subflujo", flujo: "sistema_hora", args: {}, guardarEn: "hora" },
    { id: "eco",      tipo: "tool", tool: "sistema_eco", args: (ctx) => ({ texto: `Arranqué a las ${ctx.hora?.legible}` }), guardarEn: "eco" },
    { id: "hay_eco",  tipo: "condicion", si: (ctx) => Boolean(ctx.eco?.texto), entonces: "aprobar", sino: "fin_error" },
    { id: "aprobar",  tipo: "aprobacion", mensaje: (ctx) => `¿Apruebo continuar con ${ctx.veces ?? 2} iteraciones?` },
    { id: "bucle",    tipo: "repetir", hasta: (ctx) => (ctx.__iter ?? 0) >= (ctx.veces ?? 2), maxVeces: 5, cuerpo: ["contador"], cadaSegundos: 0 },
    { id: "pausa",    tipo: "esperar", segundos: (ctx) => ctx.espera ?? 1 },
    { id: "sensible", tipo: "tool", tool: "sistema_accion_sensible", args: { accion: "cierre del flujo de prueba" }, guardarEn: "cierre" },
    { id: "fin",      tipo: "fin", resultado: (ctx) => ({ hora: ctx.hora, ultima: ctx.ultima, cierre: ctx.cierre, iteraciones: ctx.__iteraciones?.bucle }) },
    { id: "fin_error", tipo: "fin", fallo: true, resultado: () => ({ error: "el eco no devolvió texto" }) },
    // Cuerpo del repetir (no se entra en orden lineal):
    { id: "contador", tipo: "tool", tool: "sistema_eco", args: (ctx) => ({ texto: `iteración ${(ctx.__iter ?? 0) + 1}` }), guardarEn: "ultima" },
  ],
  reporte: (ctx, r: any) => `✅ Prueba completa: ${r?.iteraciones ?? 0} iteración(es), última "${r?.ultima?.texto}", cierre: ${r?.cierre?.ejecutada}.`,
};

export const flujosSistema: DefFlujo[] = [sistemaHora, sistemaPruebaCompleta];