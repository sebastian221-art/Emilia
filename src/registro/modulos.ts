// ARCHIVO: src/registro/modulos.ts
// ─────────────────────────────────────────────────────────────────────────────
//  MANIFIESTO DE MÓDULOS
//  La lista de archivos que aportan tools, skills y flujos. Es lo único que
//  hay que tocar para agregar una capacidad nueva (una línea). El registro
//  los importa al arrancar y también puede RECARGARLOS sin reiniciar
//  (registro_recargar), porque los importa por ruta con cache-bust.
//  Cada entrada: ruta relativa a src/ y el nombre del export (un array).
// ─────────────────────────────────────────────────────────────────────────────

export interface ModuloCapacidades { ruta: string; exporta: string; tipo: "tools" | "skills" | "flujos" }

export const MODULOS: ModuloCapacidades[] = [
  // ── tools ──
  { ruta: "tools/sistema.ts",      exporta: "toolsSistema",      tipo: "tools" },
  { ruta: "tools/archivo.ts",      exporta: "toolsArchivo",      tipo: "tools" },
  { ruta: "tools/web.ts",          exporta: "toolsWeb",          tipo: "tools" },
  { ruta: "tools/fuentes.ts",      exporta: "toolsFuentes",      tipo: "tools" },
  { ruta: "tools/personal.ts",     exporta: "toolsPersonal",     tipo: "tools" },
  { ruta: "tools/biblioteca.ts",   exporta: "toolsBiblioteca",   tipo: "tools" },
  { ruta: "tools/aprendizaje.ts",  exporta: "toolsAprendizaje",  tipo: "tools" },
  { ruta: "tools/whatsapp.ts",     exporta: "toolsWhatsapp",     tipo: "tools" },
  { ruta: "tools/jelcom.ts",       exporta: "toolsJelcom",       tipo: "tools" },
  { ruta: "tools/codigo.ts",       exporta: "toolsCodigo",       tipo: "tools" },
  { ruta: "tools/publicar.ts",     exporta: "toolsPublicar",     tipo: "tools" },
  { ruta: "tools/guardia.ts",      exporta: "toolsGuardia",      tipo: "tools" },
  { ruta: "tools/correo.ts",       exporta: "toolsCorreo",       tipo: "tools" },
  { ruta: "tools/agenda.ts",       exporta: "toolsAgenda",       tipo: "tools" },
  { ruta: "tools/vigilancia.ts",   exporta: "toolsVigilancia",   tipo: "tools" },
  { ruta: "tools/any.ts",          exporta: "toolsAny",          tipo: "tools" },
  { ruta: "tools/agentes.ts",      exporta: "toolsAgentes",      tipo: "tools" },
  { ruta: "tools/observar.ts",     exporta: "toolsObservar",     tipo: "tools" },
  { ruta: "tools/conocimiento.ts", exporta: "toolsConocimiento", tipo: "tools" },
  { ruta: "tools/vision.ts",       exporta: "toolsVision",       tipo: "tools" },
  { ruta: "tools/voz.ts",          exporta: "toolsVoz",          tipo: "tools" },
  { ruta: "tools/runtime.ts",      exporta: "toolsRuntime",      tipo: "tools" },
  { ruta: "tools/web-salud.ts",    exporta: "toolsWebSalud",     tipo: "tools" },
  { ruta: "tools/proyecto.ts",     exporta: "toolsProyecto",     tipo: "tools" },
  { ruta: "tools/flujos.ts",       exporta: "toolsFlujos",       tipo: "tools" },
  { ruta: "tools/empresa.ts",      exporta: "toolsEmpresa",      tipo: "tools" },
  { ruta: "tools/pc.ts",           exporta: "toolsPc",           tipo: "tools" },
  { ruta: "tools/pc-operar.ts",    exporta: "toolsPcOperar",     tipo: "tools" },
  { ruta: "tools/pc-extra.ts",     exporta: "toolsPcExtra",      tipo: "tools" },
  { ruta: "tools/pc-claude.ts",    exporta: "toolsPcClaude",     tipo: "tools" },
  { ruta: "tools/navegador.ts",    exporta: "toolsNavegador",    tipo: "tools" },
  { ruta: "tools/memoria.ts",      exporta: "toolsMemoria",      tipo: "tools" },
  { ruta: "tools/disparadores.ts", exporta: "toolsDisparadores", tipo: "tools" },
  { ruta: "tools/registro.ts",     exporta: "toolsRegistro",     tipo: "tools" },
  { ruta: "tools/evaluacion.ts",   exporta: "toolsEvaluacion",   tipo: "tools" },
  // ── skills ──
  { ruta: "skills/sistema.ts",     exporta: "skillsSistema",     tipo: "skills" },
  { ruta: "skills/jelcom.ts",      exporta: "skillsJelcom",      tipo: "skills" },
  { ruta: "skills/senior.ts",      exporta: "skillsSenior",      tipo: "skills" },
  { ruta: "skills/vigilar.ts",     exporta: "skillsVigilar",     tipo: "skills" },
  { ruta: "skills/guardia.ts",     exporta: "skillsGuardia",     tipo: "skills" },
  { ruta: "skills/web.ts",         exporta: "skillsWeb",         tipo: "skills" },
  { ruta: "skills/lara.ts",        exporta: "skillsLara",        tipo: "skills" },
  { ruta: "skills/system.ts",      exporta: "skillsSystem",      tipo: "skills" },
  // ── flujos ──
  { ruta: "flujos/sistema.ts",     exporta: "flujosSistema",     tipo: "flujos" },
  { ruta: "flujos/jelcom.ts",      exporta: "flujosJelcom",      tipo: "flujos" },
  { ruta: "flujos/senior.ts",      exporta: "flujosSenior",      tipo: "flujos" },
  { ruta: "flujos/proyecto.ts",    exporta: "flujosProyecto",    tipo: "flujos" },
  { ruta: "flujos/vigilar.ts",     exporta: "flujosVigilar",     tipo: "flujos" },
  { ruta: "flujos/vigilar-url.ts", exporta: "flujosVigilarUrl",  tipo: "flujos" },
  { ruta: "flujos/capacidad.ts",   exporta: "flujosCapacidad",   tipo: "flujos" },
  { ruta: "flujos/entregar.ts",    exporta: "flujosEntregar",    tipo: "flujos" },
];