// ARCHIVO: src/flujos/senior.ts
// ─────────────────────────────────────────────────────────────────────────────
//  FLUJOS DEL SENIOR — encargos programados
//  Auditoría periódica: cada N días corre auditoría de seguridad + predicción
//  de fallas sobre un proyecto y reporta al jefe. Las esperas largas se
//  persisten, así que sobrevive reinicios.
// ─────────────────────────────────────────────────────────────────────────────

import type { DefFlujo } from "../registro/tipos.js";

const MODULO = "senior";

export const seniorAuditoriaPeriodica: DefFlujo = {
  nombre: "senior_auditoria_periodica",
  modulo: MODULO,
  descripcion: "Cada N días audita la seguridad y predice fallas de un proyecto, y reporta al jefe por su canal. Corre hasta que lo detengas (máx. 1 año).",
  parametros: {
    type: "object",
    properties: {
      proyecto: { type: "string", description: "Proyecto registrado.", minLength: 2 },
      cada_dias: { type: "integer", description: "Frecuencia en días.", default: 7, minimum: 1, maximum: 60 },
    },
    required: ["proyecto"],
  },
  riesgo: "lectura",
  inicio: "ciclo",
  pasos: [
    { id: "ciclo", tipo: "repetir", hasta: () => false, maxVeces: 365, cuerpo: ["auditar", "predecir", "espera"], cadaSegundos: 0 },
    { id: "fin", tipo: "fin", resultado: (c) => ({ proyecto: c.proyecto, auditorias: c.__iteraciones?.ciclo }) },
    // cuerpo
    { id: "auditar", tipo: "skill", skill: "senior_auditar_seguridad", args: (c) => ({ proyecto: c.proyecto }), guardarEn: "auditoria", siFalla: "continuar" },
    { id: "predecir", tipo: "skill", skill: "senior_predecir_fallas", args: (c) => ({ proyecto: c.proyecto }), guardarEn: "prediccion", siFalla: "continuar" },
    { id: "espera", tipo: "esperar", segundos: (c) => (Number(c.cada_dias) || 7) * 86400 },
  ],
  reporte: (c, r: any) => `🔎 Auditoría periódica de ${c.proyecto} terminada (${r?.auditorias ?? 0} ciclos).`,
};

export const flujosSenior: DefFlujo[] = [seniorAuditoriaPeriodica];