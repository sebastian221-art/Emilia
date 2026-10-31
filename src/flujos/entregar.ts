// ARCHIVO: src/flujos/entregar.ts
// ─────────────────────────────────────────────────────────────────────────────
//  FLUJO: entregar_cambios — del sandbox al repo real con UN solo OK
//  Muestra qué se va a integrar (archivos, verificación), pide una aprobación,
//  y el código hace todo: commit (si falta), merge a la rama base, push (si el
//  proyecto tiene remoto y se pidió), cierre de TODOS los sandboxes de ese
//  proyecto, reinicio del proceso si estaba corriendo, y reporte. El modelo no
//  interviene entre paso y paso: no hay nada que pueda perder.
// ─────────────────────────────────────────────────────────────────────────────

import type { DefFlujo } from "../registro/tipos.js";

export const entregarCambios: DefFlujo = {
  nombre: "entregar_cambios",
  modulo: "entregar",
  descripcion: "Lleva los cambios de un sandbox al repo real con UN solo OK: verifica, muestra el resumen, pide aprobación, y hace commit + integración + push (opcional) + cierre de sandboxes + reinicio del proyecto si corre. Reporta al jefe.",
  parametros: {
    type: "object",
    properties: {
      sandbox_id: { type: "string", description: "Sandbox con los cambios.", minLength: 8 },
      mensaje: { type: "string", description: "Mensaje de commit (opcional; se arma uno si falta)." },
      push: { type: "boolean", description: "Hacer push a GitHub después de integrar (si el proyecto tiene remoto).", default: true },
      reiniciar: { type: "boolean", description: "Reiniciar el proceso del proyecto si estaba corriendo.", default: true },
      verificar: { type: "boolean", description: "Correr build/lint/tests antes de pedir el OK.", default: true },
    },
    required: ["sandbox_id"],
  },
  riesgo: "sistema",
  inicio: "estado",
  pasos: [
    { id: "estado", tipo: "tool", tool: "codigo_git_estado", args: (c) => ({ sandbox_id: c.sandbox_id }), guardarEn: "git" },
    { id: "diff", tipo: "tool", tool: "codigo_diff", args: (c) => ({ sandbox_id: c.sandbox_id, max_chars: 4000 }), guardarEn: "diff" },
    { id: "hay_cambios", tipo: "condicion", si: (c) => !!(c.diff?.archivos?.length) || /\\bM |\\?\\? |A /.test(String(c.git?.estado || "")) || /ahead|adelante/i.test(String(c.git?.resumen || "")), entonces: "verificar_o_no", sino: "fin_sin_cambios" },
    { id: "verificar_o_no", tipo: "condicion", si: (c) => c.verificar !== false, entonces: "verificar", sino: "aprobar" },
    { id: "verificar", tipo: "tool", tool: "codigo_verificar", args: (c) => ({ sandbox_id: c.sandbox_id }), guardarEn: "ver", siFalla: "continuar" },
    { id: "verifico_ok", tipo: "condicion", si: (c) => !!c.__resultados?.verificar?.ok, entonces: "aprobar", sino: "fin_no_verifica" },
    { id: "aprobar", tipo: "aprobacion", mensaje: (c) => `🧩 *Listo para integrar al repo real*\n• Sandbox ${String(c.sandbox_id).slice(0, 8)} → rama base del proyecto\n• Archivos: ${(c.diff?.archivos || []).slice(0, 12).join(", ") || "(ver diff)"}${(c.diff?.archivos || []).length > 12 ? ` y ${(c.diff?.archivos || []).length - 12} más` : ""}\n• Verificación: ${c.ver?.resumen ? String(c.ver.resumen).split("\n")[0] : "sin verificar"}\n• Luego: integro a ${c.proyecto ? c.proyecto : "la rama base"} y subo a GitHub (Railway despliega solo)\n${c.reiniciar !== false ? "• Y reinicio el proyecto local si está corriendo\n" : ""}\n¿Integro? Un solo OK y hago todo (no te pido más nada).` },
    { id: "nombre_proy", tipo: "tool", tool: "codigo_listar_sandboxes", args: {}, guardarEn: "sbs", siFalla: "continuar" },
    { id: "resolver_proyecto", tipo: "condicion", si: (c) => { const sb = (c.sbs || []).find((x: any) => x.id === c.sandbox_id || String(x.id).startsWith(String(c.sandbox_id).slice(0, 8))); if (sb) c.proyecto = sb.proyecto_nombre || sb.proyecto; return true; }, entonces: "commit", sino: "commit" },
    { id: "commit", tipo: "tool", tool: "codigo_commit", args: (c) => ({ sandbox_id: c.sandbox_id, mensaje: c.mensaje || `Cambios integrados por Emilia (${new Date().toISOString().slice(0, 10)})` }), preaprobado: true, siFalla: "continuar", guardarEn: "commit" },
    { id: "integrar", tipo: "tool", tool: "codigo_integrar", args: (c) => ({ sandbox_id: c.sandbox_id }), preaprobado: true, guardarEn: "integrado" },
    { id: "cerrar", tipo: "tool", tool: "codigo_cerrar_sandbox", args: (c) => ({ sandbox_id: c.sandbox_id, borrar_rama: true }), siFalla: "continuar" },
    { id: "cerrar_otros", tipo: "repetir", hasta: (c) => !((c.sbs || []).filter((x: any) => (x.proyecto_nombre || x.proyecto) === c.proyecto && x.id !== c.sandbox_id && !c.__cerrados?.includes(x.id)).length), maxVeces: 10, cuerpo: ["cerrar_uno"] },
    { id: "cerrar_uno", tipo: "tool", tool: "codigo_cerrar_sandbox", args: (c) => { const otro = (c.sbs || []).find((x: any) => (x.proyecto_nombre || x.proyecto) === c.proyecto && x.id !== c.sandbox_id && !(c.__cerrados || []).includes(x.id)); c.__cerrados = [...(c.__cerrados || []), otro?.id]; return { sandbox_id: otro?.id, borrar_rama: true }; }, siFalla: "continuar" },
    { id: "reiniciar_o_no", tipo: "condicion", si: (c) => c.reiniciar !== false && !!c.proyecto, entonces: "estado_proc", sino: "fin" },
    { id: "estado_proc", tipo: "tool", tool: "runtime_estado", args: (c) => ({ proyecto: c.proyecto }), guardarEn: "proc", siFalla: "continuar" },
    { id: "corria", tipo: "condicion", si: (c) => (c.proc?.[0]?.estado) === "corriendo", entonces: "reiniciar", sino: "fin" },
    { id: "reiniciar", tipo: "tool", tool: "runtime_reiniciar", args: (c) => ({ proyecto: c.proyecto }), siFalla: "continuar", guardarEn: "reinicio" },
    { id: "fin", tipo: "fin", resultado: (c) => ({ proyecto: c.proyecto, archivos: c.diff?.archivos, integrado: !!c.integrado, push: /Push a origin/i.test(String(c.integrado?.resumen || "")), reiniciado: !!c.reinicio }) },
    { id: "fin_sin_cambios", tipo: "fin", fallo: true, resultado: (c) => ({ error: `El sandbox ${c.sandbox_id} no tiene cambios respecto a la rama base. Nada que integrar.` }) },
    { id: "fin_no_verifica", tipo: "fin", fallo: true, resultado: (c) => ({ error: `La verificación falló; no integro. ${c.ver?.error || c.ver?.resumen || ""}`.slice(0, 600) }) },
  ],
  reporte: (c, r: any) => r?.error ? `❌ ${r.error}` : `✅ Integrado${r?.proyecto ? ` en ${r.proyecto}` : ""} y subido a GitHub: ${(r?.archivos || []).length} archivo(s).${r?.reiniciado ? " Proyecto local reiniciado." : ""} Railway desplegará solo en un momento. Sandbox cerrado.`,
};

export const flujosEntregar: DefFlujo[] = [entregarCambios];