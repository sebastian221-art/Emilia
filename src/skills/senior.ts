// ARCHIVO: src/skills/senior.ts
// ─────────────────────────────────────────────────────────────────────────────
//  SKILLS DEL SENIOR DEVELOPER
//  Cada skill es un ENCARGO: le da a Claude Code una misión con reglas y
//  criterio de éxito, en un sandbox aislado, y orquesta el ciclo
//  abrir → encargar → verificar → (iterar) → devolver diff + resumen.
//  El pensamiento senior lo pone Claude Code; estas skills ponen el marco, la
//  verificación objetiva (build/lint/test) y la disciplina.
//  Nada toca el repo real: commit/integrar quedan para el jefe (tools con ⏸).
// ─────────────────────────────────────────────────────────────────────────────

import type { DefSkill, ContextoEjecucion, ResultadoTool } from "../registro/tipos.js";
import { avisarProgreso } from "../motor/actividad.js";

const MODULO = "senior";

const PROYECTO = { type: "string" as const, description: "Nombre del proyecto registrado (codigo_listar_proyectos).", minLength: 2 };
const TAREA = { type: "string" as const, description: "Qué necesitás, en tus palabras. Cuanto más claro, mejor.", minLength: 5 };

// Reglas base que van en TODO encargo a Claude Code.
const REGLAS = `Sos un ingeniero de software senior de primer nivel trabajando en un sandbox aislado (una copia del repo en su propia rama; el repo real no se ve afectado). Principios:
- Entendé antes de tocar: leé el código relevante y las convenciones del proyecto.
- Calidad sobre cantidad: cambios mínimos y precisos, legibles, con el estilo del proyecto. No reescribas de más.
- Nada de secretos hardcodeados, nada de dependencias nuevas sin necesidad real (si agregás una, justificá).
- Si algo es ambiguo o riesgoso, explicá el supuesto que tomaste en tu informe final.
- Terminá SIEMPRE con un informe claro: qué hiciste, qué archivos tocaste, cómo lo verificaste, qué quedó pendiente o qué habría que revisar.`;

/** Abre sandbox, corre el encargo, verifica e itera si hay build/lint/test que falla. Deja el sandbox ABIERTO para que el jefe vea el diff y decida. */
async function ejecutarEncargo(ctx: ContextoEjecucion, p: {
  proyecto: string; proposito: string; sistema: string; encargo: string;
  verificar: boolean; maxIteraciones?: number; maxTurnos?: number; timeoutSeg?: number;
  /** Segunda sesión de Claude que revisa el diff como par exigente; si encuentra bloqueantes, se itera una vez más. */
  revisionCruzada?: boolean;
  /** Guardar un resumen del resultado en el conocimiento del agente (hallazgos/). */
  guardarHallazgo?: boolean;
}): Promise<ResultadoTool> {
  const ab = await ctx.ejecutarTool("codigo_abrir_sandbox", { proyecto: p.proyecto, proposito: p.proposito });
  if (!ab.ok) return { ok: false, error: `No pude abrir el sandbox: ${ab.error}` };
  const sandbox_id = (ab.datos as any).sandbox_id;
  const rama = (ab.datos as any).rama;
  await ctx.traza("skill", `sandbox ${sandbox_id} (${rama}) para: ${p.proposito}`);
  await avisarProgreso(ctx.conversacionId, `🧪 Sandbox listo (${rama.replace("senior/", "")}). Claude Code empieza a trabajar; te aviso cada paso.`);

  let sesionClaude: string | undefined;
  let ultimo: ResultadoTool = { ok: false, error: "sin ejecución" };
  const maxIter = p.verificar ? Math.max(1, p.maxIteraciones ?? 3) : 1;

  for (let intento = 1; intento <= maxIter; intento++) {
    const encargo = intento === 1 ? p.encargo
      : `${p.encargo}\n\n(La verificación anterior falló con lo siguiente. Corregilo y dejá el proyecto pasando build/lint/tests:)\n${(ultimo.datos as any)?.verificacion || ultimo.error || ""}`;
    const cc = await ctx.ejecutarTool("codigo_ejecutar_claude", {
      sandbox_id, encargo, contexto: p.sistema,
      max_turnos: p.maxTurnos ?? 80, timeout_seg: p.timeoutSeg ?? 1500,
      continuar_sesion: sesionClaude, esperar: true,
    });
    sesionClaude = (cc.datos as any)?.session_id_claude || sesionClaude;
    if (!cc.ok) { ultimo = { ok: false, error: `Claude Code: ${cc.error}`, datos: { sandbox_id, rama } }; await avisarProgreso(ctx.conversacionId, `❌ Claude Code falló: ${String(cc.error).slice(0, 200)}`); break; }
    await avisarProgreso(ctx.conversacionId, `🛠 Claude terminó (${(cc.datos as any)?.turnos ?? "?"} turnos, ${(cc.datos as any)?.duracion_s ?? "?"}s). ${p.verificar ? "Verificando build/lint/tests…" : ""}`);

    if (!p.verificar) { ultimo = { ok: true, datos: { sandbox_id, rama, informe: (cc.datos as any)?.resultado } }; break; }

    const ver = await ctx.ejecutarTool("codigo_verificar", { sandbox_id });
    if (ver.ok) { ultimo = { ok: true, datos: { sandbox_id, rama, informe: (cc.datos as any)?.resultado, verificacion: ver.resumen, intentos: intento } }; await avisarProgreso(ctx.conversacionId, `✔ Verificación en verde (intento ${intento}).${p.revisionCruzada ? " Ahora un segundo Claude lo revisa…" : ""}`); break; }
    ultimo = { ok: false, error: `Verificación falló (intento ${intento}/${maxIter})`, datos: { sandbox_id, rama, informe: (cc.datos as any)?.resultado, verificacion: ver.resumen } };
    await ctx.traza("skill", `intento ${intento}: verificación falló, reintentando`);
    await avisarProgreso(ctx.conversacionId, `⚠ La verificación falló (intento ${intento}/${maxIter}): ${String(ver.error || "").slice(0, 160)}. Claude corrige…`);
  }

  // Revisión cruzada: un segundo Claude, sin el contexto del primero, revisa el diff.
  let revision = "";
  if (ultimo.ok && p.revisionCruzada) {
    const rv = await ctx.ejecutarTool("codigo_ejecutar_claude", {
      sandbox_id, esperar: true, max_turnos: 30, timeout_seg: 900,
      contexto: `${REGLAS}
Sos un REVISOR de código independiente y exigente (no escribiste estos cambios). Tu trabajo es encontrar problemas reales: bugs, casos límite no cubiertos, riesgos de seguridad, tests insuficientes, violaciones de convenciones. No hagas cambios; solo revisá.`,
      encargo: `Revisá los cambios de este sandbox respecto a la rama base (usá git diff contra ${(await ctx.ejecutarTool("codigo_git_estado", { sandbox_id })).datos ? "la rama base del proyecto" : "main"}). Contexto del encargo original: "${p.encargo.slice(0, 600)}". Entregá: VEREDICTO: APROBADO o BLOQUEANTE en la primera línea; luego la lista de hallazgos (bloqueante/mayor/menor) con archivo:línea y qué corregir.`,
    });
    revision = (rv.datos as any)?.resultado || rv.error || "";
    await ctx.traza("skill", `revisión cruzada: ${/^\s*VEREDICTO:\s*BLOQUEANTE/im.test(revision) ? "BLOQUEANTE" : "aprobado"}`);
    await avisarProgreso(ctx.conversacionId, /^\s*VEREDICTO:\s*BLOQUEANTE/im.test(revision) ? "🔍 El revisor encontró problemas bloqueantes; Claude los corrige…" : "🔍 Revisión cruzada: aprobado.");
    if (/^\s*VEREDICTO:\s*BLOQUEANTE/im.test(revision)) {
      const fix = await ctx.ejecutarTool("codigo_ejecutar_claude", { sandbox_id, esperar: true, max_turnos: p.maxTurnos ?? 80, timeout_seg: p.timeoutSeg ?? 1500, continuar_sesion: sesionClaude, contexto: p.sistema, encargo: `Un revisor independiente encontró problemas BLOQUEANTES en tu trabajo. Corregilos todos y dejá build/lint/tests en verde:\n${revision.slice(0, 4000)}` });
      const ver2 = await ctx.ejecutarTool("codigo_verificar", { sandbox_id });
      if (!fix.ok || !ver2.ok) ultimo = { ok: false, error: `Tras la revisión cruzada no quedó en verde: ${fix.error || ver2.error}`, datos: { ...(ultimo.datos as any), verificacion: ver2.resumen } };
      else ultimo = { ok: true, datos: { ...(ultimo.datos as any), informe: `${(ultimo.datos as any)?.informe || ""}\n\n[Corregido tras revisión cruzada]\n${(fix.datos as any)?.resultado || ""}`, verificacion: ver2.resumen } };
    }
  }

  // Diff final para el informe (siempre, aunque haya fallado: sirve para ver qué quedó).
  const d = await ctx.ejecutarTool("codigo_diff", { sandbox_id });
  const diff = (d.datos as any) || {};
  const informe = (ultimo.datos as any)?.informe || "";
  const cuerpo = [
    `RESULTADO REAL DE CLAUDE CODE sobre el código actual de "${p.proyecto}". Basá tu respuesta SOLO en esto.`,
    ultimo.ok ? `✅ Listo en el sandbox (rama ${rama}).` : `⚠ No quedó del todo (rama ${rama}).`,
    informe && `\nInforme del Senior:\n${informe}`,
    diff.resumen && `\nCambios:\n${diff.resumen}`,
    (ultimo.datos as any)?.verificacion && `\nVerificación:\n${(ultimo.datos as any).verificacion}`,
    revision && `\nRevisión cruzada:\n${revision.slice(0, 1200)}`,
    ultimo.error && `\nProblema: ${ultimo.error}`,
    `\n\nRevisá el diff en la página Flujos o pedime "mostrame el diff del sandbox ${sandbox_id}". Si te sirve, decime "commit y integrá" (te pido aprobación). Si no, "descartá el sandbox ${sandbox_id}".`,
  ].filter(Boolean).join("\n");

  if (p.guardarHallazgo !== false) {
    const fecha = new Date().toISOString().slice(0, 10);
    await ctx.ejecutarTool("conocimiento_guardar", {
      nombre: `hallazgos/${p.proyecto}/${fecha}-${p.proposito.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 30)}.md`,
      contenido: `# ${p.proposito} (${p.proyecto}, ${fecha})\nResultado: ${ultimo.ok ? "ok" : "incompleto"} · rama ${rama}\nArchivos: ${(diff.archivos || []).slice(0, 15).join(", ")}\n\n${informe.slice(0, 1800)}${revision ? `\n\nRevisión: ${revision.slice(0, 600)}` : ""}`,
    }).catch(() => {});
  }
  return { ok: ultimo.ok, datos: { sandbox_id, rama, diff: diff.resumen, archivos: diff.archivos, informe, verificacion: (ultimo.datos as any)?.verificacion, revision }, resumen: cuerpo, error: ultimo.ok ? undefined : ultimo.error };
}

/** Encargo de solo lectura: no abre rama para escribir, usa un sandbox y no verifica. */
async function ejecutarLectura(ctx: ContextoEjecucion, p: { proyecto: string; proposito: string; sistema: string; encargo: string; maxTurnos?: number; guardar?: boolean }): Promise<ResultadoTool> {
  const ab = await ctx.ejecutarTool("codigo_abrir_sandbox", { proyecto: p.proyecto, proposito: p.proposito });
  if (!ab.ok) return { ok: false, error: `No pude abrir el sandbox: ${ab.error}` };
  const sandbox_id = (ab.datos as any).sandbox_id;
  await avisarProgreso(ctx.conversacionId, `🧪 Sandbox listo. Claude Code está leyendo el proyecto (${p.proposito})…`);
  const cc = await ctx.ejecutarTool("codigo_ejecutar_claude", { sandbox_id, encargo: p.encargo, contexto: p.sistema, max_turnos: p.maxTurnos ?? 60, timeout_seg: 1200, esperar: true });
  await ctx.ejecutarTool("codigo_cerrar_sandbox", { sandbox_id, borrar_rama: true });   // lectura: no deja rastro
  if (!cc.ok) return { ok: false, error: `Claude Code: ${cc.error}` };
  const informe = (cc.datos as any)?.resultado || "";
  const fecha = new Date().toISOString().slice(0, 16).replace("T", " ");
  const encabezado = `INFORME REAL DE CLAUDE CODE sobre el código actual de "${p.proyecto}" (${fecha}). Basá tu respuesta SOLO en este informe; ignorá análisis anteriores de la conversación, pueden estar desactualizados.\n\n`;
  if (p.guardar !== false) {
    const fecha = new Date().toISOString().slice(0, 10);
    await ctx.ejecutarTool("conocimiento_guardar", { nombre: `hallazgos/${p.proyecto}/${fecha}-${p.proposito.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 30)}.md`, contenido: `# ${p.proposito} (${p.proyecto}, ${fecha})\n\n${informe.slice(0, 2500)}` }).catch(() => {});
  }
  return { ok: true, datos: { informe, fecha }, resumen: encabezado + (informe || "Listo.") };
}

const toolsBase = ["conocimiento_guardar", "conocimiento_buscar", "codigo_abrir_sandbox", "codigo_ejecutar_claude", "codigo_estado_sesion", "codigo_verificar", "codigo_diff", "codigo_cerrar_sandbox", "codigo_ejecutar_comando", "codigo_leer_archivo", "codigo_buscar", "codigo_git_estado"];

// ─── Encargos ────────────────────────────────────────────────────────────────
export const seniorAnalizar: DefSkill = {
  nombre: "senior_analizar", modulo: MODULO,
  descripcion: "Analiza a fondo un proyecto o una parte de él: arquitectura, flujos, dependencias, deuda técnica y riesgos. Solo lectura; no modifica nada. Devuelve un informe.",
  cuandoUsar: "Cuando el jefe pide 'analizá X', 'cómo está armado', 'qué problemas tiene', 'explicá la arquitectura'.",
  parametros: { type: "object", properties: { proyecto: PROYECTO, foco: { type: "string", description: "Qué analizar en particular (opcional; si se omite, todo el proyecto)." } }, required: ["proyecto"] },
  riesgo: "lectura", requiereAprobacion: false, timeoutSeg: 3600,
  tools: toolsBase,
  async ejecutar(a, ctx) {
    return ejecutarLectura(ctx, {
      proyecto: a.proyecto, proposito: `analisis ${a.foco || "general"}`, sistema: REGLAS,
      encargo: `Analizá ${a.foco ? `esto en particular: ${a.foco}` : "este proyecto en su conjunto"}. Recorré el código, entendé cómo funciona y entregá un informe con: (1) arquitectura y componentes principales, (2) flujos clave de datos/control, (3) dependencias y riesgos, (4) deuda técnica y puntos frágiles, (5) 3 a 5 recomendaciones priorizadas. No modifiques ningún archivo.`,
    });
  },
};

export const seniorExplicar: DefSkill = {
  nombre: "senior_explicar", modulo: MODULO,
  descripcion: "Explica cómo funciona algo del código (una función, un módulo, un flujo) en lenguaje claro, con referencias a archivos y líneas. Solo lectura.",
  cuandoUsar: "Cuando el jefe pregunta 'cómo funciona X', 'dónde está Y', 'por qué pasa Z'.",
  parametros: { type: "object", properties: { proyecto: PROYECTO, pregunta: { type: "string", description: "Qué querés que te explique.", minLength: 3 } }, required: ["proyecto", "pregunta"] },
  riesgo: "lectura", requiereAprobacion: false, timeoutSeg: 3600,
  tools: toolsBase,
  async ejecutar(a, ctx) {
    return ejecutarLectura(ctx, { proyecto: a.proyecto, proposito: "explicar", sistema: REGLAS, encargo: `Respondé esta pregunta sobre el código, leyendo lo que haga falta: "${a.pregunta}". Explicá claro, citando archivos y líneas concretas. No modifiques nada.`, maxTurnos: 40 });
  },
};

export const seniorPlanificar: DefSkill = {
  nombre: "senior_planificar", modulo: MODULO,
  descripcion: "Convierte un pedido en un plan de ingeniería concreto: pasos verificables, archivos a tocar, riesgos y criterio de aceptación. Si la tarea es grande, la descompone en sub-tareas ordenadas. No escribe código.",
  cuandoUsar: "Antes de implementar algo grande, o cuando el jefe pide 'armá un plan para X'.",
  parametros: { type: "object", properties: { proyecto: PROYECTO, objetivo: TAREA }, required: ["proyecto", "objetivo"] },
  riesgo: "lectura", requiereAprobacion: false, timeoutSeg: 3600,
  tools: toolsBase,
  async ejecutar(a, ctx) {
    return ejecutarLectura(ctx, {
      proyecto: a.proyecto, proposito: "plan", sistema: REGLAS,
      encargo: `Armá un PLAN para lograr: "${a.objetivo}". Leé el código necesario primero. Entregá: (1) enfoque en 2-3 frases, (2) pasos concretos y ordenados, cada uno verificable, (3) archivos que se tocarían, (4) riesgos y cómo mitigarlos, (5) criterio de aceptación (cómo sabremos que quedó bien), (6) si es grande, dividilo en sub-tareas que se puedan hacer y verificar por separado. No escribas código todavía.`,
    });
  },
};

export const seniorImplementar: DefSkill = {
  nombre: "senior_implementar", modulo: MODULO,
  descripcion: "Implementa una funcionalidad o cambio de calidad en el sandbox, con tests, y no da por terminado hasta que build/lint/tests pasen (itera si fallan). Deja el sandbox listo para que el jefe revise el diff y decida integrarlo.",
  cuandoUsar: "Cuando el jefe pide 'hacé X', 'agregá Y', 'implementá Z', 'cambiá tal cosa'.",
  parametros: {
    type: "object",
    properties: {
      proyecto: PROYECTO,
      tarea: TAREA,
      con_tests: { type: "boolean", description: "Pedir que escriba/actualice tests.", default: true },
      max_iteraciones: { type: "integer", description: "Cuántas veces reintenta si la verificación falla.", default: 3, minimum: 1, maximum: 6 },
      revision_cruzada: { type: "boolean", description: "Un segundo Claude revisa el resultado como par exigente antes de entregarlo.", default: true },
    },
    required: ["proyecto", "tarea"],
  },
  riesgo: "escritura", requiereAprobacion: false, timeoutSeg: 5400,
  tools: toolsBase,
  async ejecutar(a, ctx) {
    return ejecutarEncargo(ctx, {
      proyecto: a.proyecto, proposito: a.tarea.slice(0, 40), sistema: REGLAS,
      encargo: `Implementá: "${a.tarea}".${a.con_tests !== false ? " Escribí o actualizá los tests que correspondan." : ""} Dejá el proyecto compilando y con los tests pasando. Cuando termines, corré vos mismo el build y los tests para confirmar, y en tu informe decí qué archivos tocaste y cómo lo verificaste.`,
      verificar: true, maxIteraciones: a.max_iteraciones ?? 3, revisionCruzada: a.revision_cruzada !== false,
    });
  },
};

export const seniorReparar: DefSkill = {
  nombre: "senior_reparar", modulo: MODULO,
  descripcion: "Diagnostica un bug o error a partir de un síntoma/log/traza, encuentra la causa raíz, lo arregla y agrega un test de regresión. Verifica que quede pasando. Deja el sandbox para revisión.",
  cuandoUsar: "Cuando el jefe reporta 'falla X', 'da este error', pega un log/stacktrace, o 'arreglá Y'.",
  parametros: { type: "object", properties: { proyecto: PROYECTO, sintoma: { type: "string", description: "Qué falla, con el error/log/traza si lo hay.", minLength: 5 }, max_iteraciones: { type: "integer", default: 4, minimum: 1, maximum: 6 } }, required: ["proyecto", "sintoma"] },
  riesgo: "escritura", requiereAprobacion: false, timeoutSeg: 5400,
  tools: toolsBase,
  async ejecutar(a, ctx) {
    return ejecutarEncargo(ctx, {
      proyecto: a.proyecto, proposito: `fix ${a.sintoma.slice(0, 30)}`, sistema: REGLAS,
      encargo: `Hay un problema: "${a.sintoma}". Reproducilo si podés, encontrá la CAUSA RAÍZ (no un parche superficial), arreglalo, y agregá un test que falle sin el fix y pase con él. Dejá build y tests en verde. En tu informe: causa raíz, qué cambiaste y el test que agregaste.`,
      verificar: true, maxIteraciones: a.max_iteraciones ?? 4, revisionCruzada: true,
    });
  },
};

export const seniorAuditarSeguridad: DefSkill = {
  nombre: "senior_auditar_seguridad", modulo: MODULO,
  descripcion: "Auditoría de seguridad de solo lectura: superficie de ataque, secretos expuestos, inyección, autenticación/permisos, dependencias vulnerables. Devuelve hallazgos priorizados por severidad. No modifica nada.",
  cuandoUsar: "Cuando el jefe pide 'revisá la seguridad', 'está seguro esto', 'buscá vulnerabilidades'.",
  parametros: { type: "object", properties: { proyecto: PROYECTO, foco: { type: "string", description: "Área a priorizar (opcional)." } }, required: ["proyecto"] },
  riesgo: "lectura", requiereAprobacion: false, timeoutSeg: 3600,
  tools: toolsBase,
  async ejecutar(a, ctx) {
    return ejecutarLectura(ctx, {
      proyecto: a.proyecto, proposito: "auditoria seguridad", sistema: REGLAS,
      encargo: `Hacé una auditoría de SEGURIDAD${a.foco ? ` con foco en: ${a.foco}` : ""}. Revisá: secretos/credenciales en el código, validación de entradas e inyección (SQL, comandos, path), autenticación y autorización, manejo de sesiones/tokens, exposición de datos, configuración insegura, y dependencias vulnerables (mirá package.json y, si podés, corré el auditor del gestor). Entregá una lista de hallazgos ORDENADOS por severidad (crítico/alto/medio/bajo), cada uno con: dónde (archivo:línea), por qué es un riesgo, y cómo corregirlo. No modifiques código.`,
    });
  },
};

export const seniorAtacar: DefSkill = {
  nombre: "senior_atacar", modulo: MODULO,
  descripcion: "Red team en el sandbox: intenta ACTIVAMENTE romper o vulnerar el propio sistema (payloads, casos límite, abuso de endpoints, condiciones de carrera) y reporta qué logró explotar y cómo cerrarlo. Trabaja en el sandbox aislado, nunca contra producción.",
  cuandoUsar: "Cuando el jefe pide 'intentá romperlo', 'probá si es vulnerable', 'atacá el sistema'.",
  parametros: { type: "object", properties: { proyecto: PROYECTO, objetivo: { type: "string", description: "Qué parte atacar (endpoint, flujo, módulo). Opcional." } }, required: ["proyecto"] },
  riesgo: "ejecucion", requiereAprobacion: false, timeoutSeg: 5400,
  tools: toolsBase,
  async ejecutar(a, ctx) {
    return ejecutarEncargo(ctx, {
      proyecto: a.proyecto, proposito: "red team", sistema: `${REGLAS}\nEstás en modo RED TEAM, en un sandbox aislado y desechable. Está EXPLÍCITAMENTE autorizado intentar romper este sistema para descubrir sus debilidades: podés escribir scripts de prueba, mandar payloads maliciosos, forzar casos límite y condiciones de carrera CONTRA el código del sandbox. Nunca contra sistemas externos ni de terceros.`,
      encargo: `Intentá vulnerar${a.objetivo ? ` esto: ${a.objetivo}` : " este sistema"}. Levantá lo que necesites en el sandbox, escribí pruebas de ataque (inyección, autenticación rota, abuso de límites, entradas maliciosas, concurrencia) y documentá cada intento: qué probaste, si funcionó, y el impacto. Para lo que SÍ lograste explotar, proponé el fix concreto. No integres cambios: esto es diagnóstico. Informe final ordenado por severidad de lo explotable.`,
      verificar: false, maxTurnos: 120, timeoutSeg: 2400,
    });
  },
};

export const seniorProbarLimites: DefSkill = {
  nombre: "senior_probar_limites", modulo: MODULO,
  descripcion: "Prueba hasta dónde aguanta el sistema en el sandbox: carga, concurrencia, volumen de datos, y caos (procesos caídos, red lenta/cortada, DB saturada). Reporta dónde y cómo se degrada o cae.",
  cuandoUsar: "Cuando el jefe pide 'hasta dónde aguanta', 'probá la carga', 'qué pasa si se cae X'.",
  parametros: { type: "object", properties: { proyecto: PROYECTO, escenario: { type: "string", description: "Qué estresar en particular (opcional)." } }, required: ["proyecto"] },
  riesgo: "ejecucion", requiereAprobacion: false, timeoutSeg: 5400,
  tools: toolsBase,
  async ejecutar(a, ctx) {
    return ejecutarEncargo(ctx, {
      proyecto: a.proyecto, proposito: "pruebas de limite", sistema: REGLAS,
      encargo: `Probá los LÍMITES del sistema${a.escenario ? ` (foco: ${a.escenario})` : ""} en el sandbox. Diseñá y corré pruebas de: carga (muchas peticiones), concurrencia (operaciones en paralelo, condiciones de carrera), volumen (muchos datos), y caos (matar el proceso a mitad, simular red lenta o DB saturada). Medí y reportá: en qué punto se degrada, dónde se cae, qué se corrompe, y qué recomendás para aguantar más. Podés escribir scripts de prueba. No integres cambios de producción.`,
      verificar: false, maxTurnos: 120, timeoutSeg: 2400,
    });
  },
};

export const seniorPredecirFallas: DefSkill = {
  nombre: "senior_predecir_fallas", modulo: MODULO,
  descripcion: "Análisis predictivo (solo lectura): qué se va a romper cuando el sistema crezca o cambie el entorno. Cuellos de botella, race conditions latentes, límites de API/DB, supuestos frágiles. Devuelve riesgos futuros ordenados por probabilidad e impacto.",
  cuandoUsar: "Cuando el jefe pregunta 'qué se va a romper', 'aguanta si crece', 'qué riesgos hay a futuro'.",
  parametros: { type: "object", properties: { proyecto: PROYECTO, escenario_crecimiento: { type: "string", description: "Cómo esperás que crezca (usuarios, datos, tráfico). Opcional." } }, required: ["proyecto"] },
  riesgo: "lectura", requiereAprobacion: false, timeoutSeg: 3600,
  tools: toolsBase,
  async ejecutar(a, ctx) {
    return ejecutarLectura(ctx, {
      proyecto: a.proyecto, proposito: "prediccion de fallas", sistema: REGLAS,
      encargo: `Análisis PREDICTIVO de fallas${a.escenario_crecimiento ? ` bajo este crecimiento: ${a.escenario_crecimiento}` : ""}. Leyendo el código, identificá qué se va a romper antes de que pase: cuellos de botella de rendimiento, condiciones de carrera latentes, límites de API o de base de datos, memoria/recursos, supuestos que dejan de valer al escalar, puntos únicos de falla. Entregá una lista ordenada por (probabilidad × impacto), cada ítem con: qué falla, cuándo/por qué se dispararía, y cómo prevenirlo. No modifiques nada.`,
    });
  },
};

export const seniorReplicar: DefSkill = {
  nombre: "senior_replicar", modulo: MODULO,
  descripcion: "Analiza cómo funciona algo existente (una herramienta, una librería, un sistema, un endpoint) y diseña un equivalente funcional PROPIO, a su criterio, adaptado a este proyecto. No copia código: entiende el qué y el porqué y lo recrea a su manera. Puede quedar en un informe de diseño o implementarlo en el sandbox.",
  cuandoUsar: "Cuando el jefe dice 'quiero algo como X pero mío', 'analizá cómo funciona Y y hacé mi versión', 'replicá esa funcionalidad'.",
  parametros: {
    type: "object",
    properties: {
      proyecto: PROYECTO,
      referencia: { type: "string", description: "Qué funcionalidad/sistema tomar como referencia (nombre, cómo funciona, o dónde mirar).", minLength: 3 },
      implementar: { type: "boolean", description: "true = además de diseñar, implementarlo en el sandbox con tests. false = solo diseño e informe.", default: false },
    },
    required: ["proyecto", "referencia"],
  },
  riesgo: "escritura", requiereAprobacion: false, timeoutSeg: 5400,
  tools: toolsBase,
  async ejecutar(a, ctx) {
    const diseno = `Estudiá cómo funciona esta referencia: "${a.referencia}". Entendé QUÉ hace y POR QUÉ, sus decisiones de diseño y sus límites. Después diseñá un EQUIVALENTE FUNCIONAL propio, adaptado a este proyecto y a su stack, a tu criterio de ingeniero senior. No copies código: recreá la capacidad a tu manera, mejorando lo que se pueda para este contexto.`;
    if (!a.implementar) {
      return ejecutarLectura(ctx, { proyecto: a.proyecto, proposito: `diseno equivalente ${a.referencia.slice(0, 25)}`, sistema: REGLAS, encargo: `${diseno} Entregá un informe de diseño: enfoque, componentes, interfaz/API propuesta, cómo encaja en el proyecto, y un plan de implementación. No escribas el código todavía.` });
    }
    return ejecutarEncargo(ctx, {
      proyecto: a.proyecto, proposito: `replica ${a.referencia.slice(0, 25)}`, sistema: REGLAS,
      encargo: `${diseno} Luego IMPLEMENTALO en el sandbox con tests, siguiendo las convenciones del proyecto. Dejá build y tests en verde. En tu informe: en qué te inspiraste, qué decidiste distinto y por qué, qué archivos creaste/tocaste y cómo lo verificaste.`,
      verificar: true, maxIteraciones: 3, maxTurnos: 120, timeoutSeg: 2400, revisionCruzada: true,
    });
  },
};

// ─── Auto-mejora: crear una capacidad nueva de Emilia ───────────────────────
const CONTRATO_CAPACIDAD = `CONTRATO DEL REGISTRO DE EMILIA (src/registro/tipos.ts):
- Una TOOL es un objeto DefTool: { nombre (snake_case, empieza con "<modulo>_"), modulo, descripcion (lo lee el modelo: qué hace y cuándo usarla), parametros (JSON Schema con type "object", properties, required), riesgo ("lectura"|"escritura"|"ejecucion"|"sistema"), requiereAprobacion (true si es irreversible/sensible), timeoutSeg?, async ejecutar(args, ctx) → { ok, datos?, resumen?, error? } }.
  ctx tiene: agenteId, ejecucionId, conversacionId, traza(tipo, texto), ejecutarTool(nombre, args), modelo(mensajes).
- Una SKILL es DefSkill: igual pero con tools: string[] (las tools que puede usar) y ejecutar (código, usando ctx.ejecutarTool) o procedimiento (texto para el modelo).
- Un FLUJO es DefFlujo: { nombre, modulo, descripcion, parametros, riesgo, inicio, pasos: PasoFlujo[] } con pasos tool|skill|condicion|aprobacion|esperar|repetir|subflujo|fin.
- Cada archivo exporta un array (ej. export const toolsClima: DefTool[] = [...]).
- Para que se cargue, se agrega UNA línea al manifiesto src/registro/modulos.ts: { ruta: "tools/<archivo>.ts", exporta: "<nombreDelArray>", tipo: "tools" }.
- Mirá src/tools/sistema.ts y src/tools/jelcom.ts como ejemplos canónicos. Sin dependencias nuevas salvo necesidad real (justificar). Credenciales SIEMPRE por process.env (documentá el nombre de la variable en la descripción del módulo).
- Verificación: npx tsc --noEmit -p . debe pasar, y el nombre de la tool debe validar contra el registro (snake_case, prefijo del módulo).`;

export const seniorCrearCapacidad: DefSkill = {
  nombre: "senior_crear_capacidad", modulo: MODULO,
  descripcion: "AUTO-MEJORA (usar preferentemente vía el flujo capacidad_nueva): escribe una capacidad nueva de Emilia (tool, skill o flujo) en un sandbox del proyecto 'emilia', verificada y revisada. IMPORTANTE: una capacidad en sandbox NO existe para el sistema hasta integrar + registro_recargar; no se puede 'probar antes'.",
  cuandoUsar: "Cuando falta una herramienta que ninguna tool actual cubre (ej. 'consultar el clima', 'leer Google Sheets', 'mandar correo') o el jefe pide 'creá una tool/skill que…'.",
  parametros: {
    type: "object",
    properties: {
      tipo: { type: "string", enum: ["tool", "skill", "flujo"] },
      nombre: { type: "string", description: "snake_case con prefijo de módulo, ej. clima_consultar.", minLength: 3 },
      modulo: { type: "string", description: "Módulo/archivo, ej. clima → src/tools/clima.ts.", minLength: 2 },
      especificacion: { type: "string", description: "Qué hace exactamente, parámetros, comportamiento, errores, qué API/servicio usa y con qué credencial (.env).", minLength: 20 },
    },
    required: ["tipo", "nombre", "modulo", "especificacion"],
  },
  riesgo: "escritura", requiereAprobacion: false, timeoutSeg: 5400,
  tools: toolsBase,
  async ejecutar(a, ctx) {
    const carpeta = a.tipo === "tool" ? "tools" : a.tipo === "skill" ? "skills" : "flujos";
    const exporta = `${carpeta}${a.modulo.charAt(0).toUpperCase()}${a.modulo.slice(1)}`;
    return ejecutarEncargo(ctx, {
      proyecto: "emilia", proposito: `capacidad ${a.nombre}`, sistema: `${REGLAS}\n\n${CONTRATO_CAPACIDAD}`,
      encargo: `Creá la ${a.tipo} "${a.nombre}" en el módulo "${a.modulo}": archivo src/${carpeta}/${a.modulo}.ts (si ya existe, agregala ahí), exportando el array "${exporta}" (o el existente). Especificación:\n${a.especificacion}\n\nPasos: 1) leé src/registro/tipos.ts y un ejemplo (src/tools/sistema.ts). 2) implementá con manejo de errores y descripción clara para el modelo. 3) registrala en src/registro/modulos.ts (una línea; si el módulo ya estaba, no dupliques). 4) si usa credenciales, leelas de process.env y documentá la variable. 5) corré npx tsc --noEmit -p . y dejalo en verde. 6) en el informe: archivo creado, nombre exacto de la capacidad, parámetros, y qué variable de .env hace falta si aplica.`,
      verificar: true, maxIteraciones: 3, maxTurnos: 100, timeoutSeg: 2400, revisionCruzada: true,
    });
  },
};

export const skillsSenior: DefSkill[] = [
  seniorAnalizar, seniorExplicar, seniorPlanificar, seniorImplementar, seniorReparar,
  seniorAuditarSeguridad, seniorAtacar, seniorProbarLimites, seniorPredecirFallas, seniorReplicar, seniorCrearCapacidad,
];