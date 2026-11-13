// ARCHIVO: src/motor/iris-reloj.ts
// ─────────────────────────────────────────────────────────────────────────────
//  Arranque de Iris al prender Emilia: correo en tiempo real + un reloj cada
//  minuto (recordatorios de la agenda, avisos diferidos por el silencio y
//  los demás relojes de Iris que se registren aquí).
// ─────────────────────────────────────────────────────────────────────────────
import { iniciarCorreo } from "./correo.js";
import { revisarRecordatorios } from "./agenda.js";
import { entregarDiferidos } from "./avisos.js";
import { vigilar, asegurarMonitoresSistema } from "./vigilancia.js";
import { revisarAnyEnFondo, informeSemanalSiToca } from "./calidad-any.js";
import { resumenSiToca } from "./resumen-dia.js";
import { radarSiToca } from "./radar.js";

type Tarea = { nombre: string; fn: () => Promise<unknown> };
const tareas: Tarea[] = [
  { nombre: "recordatorios", fn: () => revisarRecordatorios() },
  { nombre: "diferidos", fn: () => entregarDiferidos() },
  { nombre: "vigilancia", fn: () => vigilar() },
  { nombre: "any", fn: async () => { revisarAnyEnFondo(); } },   // cada ANY_CADA_MIN (15) por dentro; no frena el reloj
  { nombre: "any_informe", fn: () => informeSemanalSiToca() },
  { nombre: "resumen", fn: () => resumenSiToca() },
  { nombre: "radar", fn: () => radarSiToca() },               // Soga: la corrida va en segundo plano
];
/** Otros módulos de Iris (vigilancia, resúmenes, Any) se cuelgan del mismo reloj. */
export function cadaMinuto(nombre: string, fn: () => Promise<unknown>) { tareas.push({ nombre, fn }); }

let reloj: NodeJS.Timeout | null = null;
let corriendo = false;
export async function tic() {
  if (corriendo) return;
  corriendo = true;
  try { for (const t of tareas) await t.fn().catch((e) => console.warn(`[iris ${t.nombre}]`, e?.message || e)); }
  finally { corriendo = false; }
}
export function iniciarIris() {
  iniciarCorreo();
  asegurarMonitoresSistema().catch((e) => console.warn("[iris] monitores:", e?.message || e));
  if (reloj) return;
  reloj = setInterval(() => { tic(); }, 60_000);
  setTimeout(() => tic(), 5_000);
  console.log("[iris] reloj activo (agenda, avisos, vigilancia, Any y resúmenes).");
}
