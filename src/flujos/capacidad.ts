// ARCHIVO: src/flujos/capacidad.ts
// ─────────────────────────────────────────────────────────────────────────────
//  FLUJO: capacidad_nueva — auto-mejora de punta a punta
//  Senior escribe la capacidad → tu OK → commit + integrar al repo de Emilia →
//  (si corre con tsx watch, Emilia se reinicia sola; el flujo sobrevive y sigue)
//  → recargar registro → verificar → asignar al agente que la pidió → reporte.
// ─────────────────────────────────────────────────────────────────────────────

import type { DefFlujo } from "../registro/tipos.js";

export const capacidadNueva: DefFlujo = {
  nombre: "capacidad_nueva",
  modulo: "capacidad",
  descripcion: "Crea una capacidad nueva de Emilia (tool/skill/flujo): el Senior la escribe en sandbox, verificada y revisada; con tu OK se integra al código de Emilia, se recarga el registro y queda asignada al agente que la pidió.",
  parametros: {
    type: "object",
    properties: {
      tipo: { type: "string", enum: ["tool", "skill", "flujo"] },
      nombre: { type: "string", minLength: 3 },
      modulo: { type: "string", minLength: 2 },
      especificacion: { type: "string", minLength: 20 },
      asignar_a: { type: "string", description: "Agente que recibe la capacidad (defecto: Emilia).", default: "Emilia" },
    },
    required: ["tipo", "nombre", "modulo", "especificacion"],
  },
  riesgo: "sistema",
  inicio: "crear",
  pasos: [
    { id: "crear",     tipo: "skill", skill: "senior_crear_capacidad", args: (c) => ({ tipo: c.tipo, nombre: c.nombre, modulo: c.modulo, especificacion: c.especificacion }), guardarEn: "impl" },
    { id: "quedo",     tipo: "condicion", si: (c) => !!c.impl?.sandbox_id && !!c.__resultados?.crear?.ok, entonces: "aprobar", sino: "fin_fallo" },
    { id: "aprobar",   tipo: "aprobacion", mensaje: (c) => `El Senior escribió la ${c.tipo} *${c.nombre}* (sandbox ${c.impl.sandbox_id}, verificada y revisada).\n${String(c.impl.informe || "").slice(0, 400)}\n¿La integro a Emilia y la activo?` },
    { id: "commit",    tipo: "tool", tool: "codigo_commit", args: (c) => ({ sandbox_id: c.impl.sandbox_id, mensaje: `Nueva capacidad: ${c.nombre} (auto-mejora)` }), preaprobado: true },
    { id: "integrar",  tipo: "tool", tool: "codigo_integrar", args: (c) => ({ sandbox_id: c.impl.sandbox_id }), preaprobado: true },
    { id: "cerrar",    tipo: "tool", tool: "codigo_cerrar_sandbox", args: (c) => ({ sandbox_id: c.impl.sandbox_id, borrar_rama: true }), siFalla: "continuar" },
    // Si Emilia corre con tsx watch, aquí se reinicia sola; la espera persistida hace que el flujo continúe tras el reinicio.
    { id: "esperar",   tipo: "esperar", segundos: 25 },
    { id: "recargar",  tipo: "tool", tool: "registro_recargar", args: {}, guardarEn: "recarga", siFalla: "continuar" },
    { id: "verificar", tipo: "tool", tool: "registro_verificar", args: (c) => ({ nombre: c.nombre }), guardarEn: "def" },
    { id: "asignar",   tipo: "tool", tool: "registro_asignar", args: (c) => ({ agente: c.asignar_a || "Emilia", nombre: c.nombre }), siFalla: "continuar" },
    { id: "fin",       tipo: "fin", resultado: (c) => ({ nombre: c.nombre, tipo: c.tipo, definicion: c.def, informe: c.impl?.informe }) },
    { id: "fin_fallo", tipo: "fin", fallo: true, resultado: (c) => ({ nombre: c.nombre, error: "No quedó verificada.", sandbox_id: c.impl?.sandbox_id, informe: c.impl?.informe }) },
  ],
  reporte: (c, r: any) => r?.error
    ? `⚠ No pude dejar lista la ${c.tipo} ${c.nombre}. Sandbox ${r.sandbox_id}; mirá el diff en Código.`
    : `✅ Nueva capacidad activa: *${c.nombre}* (${c.tipo}), asignada a ${c.asignar_a || "Emilia"}. ${r?.definicion?.descripcion || ""}${String(r?.informe || "").includes("env") ? "\n(Revisá si el informe pide una variable en el .env.)" : ""}`,
};

export const flujosCapacidad: DefFlujo[] = [capacidadNueva];