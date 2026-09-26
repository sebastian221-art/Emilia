// ARCHIVO: src/flujos/proyecto.ts
// ─────────────────────────────────────────────────────────────────────────────
//  FLUJO: proyecto nuevo completo
//  crear desde cero → implementar la primera funcionalidad (Senior, con
//  verificación y revisión) → aprobación → commit + integrar → arrancar →
//  salud → (opcional) repo en GitHub y push → reporte.
// ─────────────────────────────────────────────────────────────────────────────

import type { DefFlujo } from "../registro/tipos.js";

export const proyectoNuevoCompleto: DefFlujo = {
  nombre: "proyecto_nuevo_completo",
  modulo: "proyecto",
  descripcion: "Crea un proyecto desde cero, le implementa la primera funcionalidad con el Senior (verificada y revisada), la integra con tu aprobación, lo arranca, comprueba salud y, si querés, lo sube a GitHub. Te reporta cada paso.",
  parametros: {
    type: "object",
    properties: {
      nombre: { type: "string", description: "snake_case.", minLength: 2 },
      descripcion: { type: "string", description: "Qué es el proyecto.", minLength: 5 },
      primera_tarea: { type: "string", description: "Qué debe implementar el Senior primero (funcionalidad inicial).", minLength: 10 },
      plantilla: { type: "string", enum: ["node_ts_express", "node_ts_basico", "vacio"], default: "node_ts_express" },
      puerto: { type: "integer", minimum: 1024, maximum: 65535 },
      subir_a_github: { type: "boolean", default: true },
      privado: { type: "boolean", default: true },
    },
    required: ["nombre", "descripcion", "primera_tarea"],
  },
  riesgo: "ejecucion",
  inicio: "crear",
  pasos: [
    { id: "crear",      tipo: "tool", tool: "proyecto_crear", args: (c) => ({ nombre: c.nombre, descripcion: c.descripcion, plantilla: c.plantilla || "node_ts_express", puerto: c.puerto }), guardarEn: "creado" },
    { id: "implementar", tipo: "skill", skill: "senior_implementar", args: (c) => ({ proyecto: c.nombre, tarea: `${c.primera_tarea}\n\nContexto del proyecto: ${c.descripcion}`, con_tests: true, revision_cruzada: true }), guardarEn: "impl" },
    { id: "salio_bien", tipo: "condicion", si: (c) => !!c.impl?.sandbox_id && !!c.__resultados?.implementar?.ok, entonces: "aprobar_integrar", sino: "fin_sin_integrar" },
    { id: "aprobar_integrar", tipo: "aprobacion", mensaje: (c) => `El Senior implementó "${c.primera_tarea.slice(0, 80)}" en ${c.nombre} (sandbox ${c.impl.sandbox_id}, verificado y revisado). ¿Integro al repo?` },
    { id: "commit",     tipo: "tool", tool: "codigo_commit", args: (c) => ({ sandbox_id: c.impl.sandbox_id, mensaje: `Primera funcionalidad: ${c.primera_tarea.slice(0, 60)}` }) },   // ⏸ automático
    { id: "integrar",   tipo: "tool", tool: "codigo_integrar", args: (c) => ({ sandbox_id: c.impl.sandbox_id }) },                                                                  // ⏸ automático
    { id: "cerrar_sb",  tipo: "tool", tool: "codigo_cerrar_sandbox", args: (c) => ({ sandbox_id: c.impl.sandbox_id, borrar_rama: true }), siFalla: "continuar" },
    { id: "arrancar",   tipo: "tool", tool: "runtime_iniciar", args: (c) => ({ proyecto: c.nombre }), siFalla: "continuar", guardarEn: "proceso" },
    { id: "esperar",    tipo: "esperar", segundos: 6 },
    { id: "salud",      tipo: "tool", tool: "runtime_salud", args: (c) => ({ proyecto: c.nombre }), siFalla: "continuar", guardarEn: "salud" },
    { id: "a_github",   tipo: "condicion", si: (c) => c.subir_a_github !== false, entonces: "repo", sino: "fin" },
    { id: "repo",       tipo: "tool", tool: "github_crear_repo", args: (c) => ({ proyecto: c.nombre, privado: c.privado !== false, descripcion: c.descripcion }), siFalla: "continuar", guardarEn: "repo" },   // ⏸ automático
    { id: "fin",        tipo: "fin", resultado: (c) => ({ proyecto: c.nombre, ruta: c.creado?.ruta, salud: c.salud, repo: c.repo?.url, informe: c.impl?.informe }) },
    { id: "fin_sin_integrar", tipo: "fin", fallo: true, resultado: (c) => ({ proyecto: c.nombre, error: "La implementación no quedó verificada; revisá el sandbox.", sandbox_id: c.impl?.sandbox_id, informe: c.impl?.informe }) },
  ],
  reporte: (c, r: any) => r?.error
    ? `⚠ ${c.nombre}: se creó el proyecto pero la primera funcionalidad no quedó en verde. Sandbox ${r.sandbox_id}. Mirá el diff en Código.`
    : `✅ Proyecto *${c.nombre}* listo en ${r?.ruta}.\nSalud: ${r?.salud?.ok ? `OK (${r.salud.status}, ${r.salud.latencia_ms} ms)` : r?.salud?.error || "sin verificar"}${r?.repo ? `\nGitHub: ${r.repo}` : ""}`,
};

export const flujosProyecto: DefFlujo[] = [proyectoNuevoCompleto];