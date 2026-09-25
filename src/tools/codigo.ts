// ARCHIVO: src/tools/codigo.ts
// ─────────────────────────────────────────────────────────────────────────────
//  TOOLS DE CÓDIGO — el entorno del Senior Developer
//  Proyectos → sandbox (worktree aislado) → sesiones de Claude Code observables
//  → comandos/tests/diff en el sandbox → git con aprobación para lo que toca
//  el repo real (commit, push, integrar).
// ─────────────────────────────────────────────────────────────────────────────

import { promises as fs } from "node:fs";
import path from "node:path";
import type { DefTool } from "../registro/tipos.js";
import {
  listarProyectos, obtenerProyecto, registrarProyecto, borrarProyecto,
  crearSandboxFila, obtenerSandbox, sandboxesAbiertos, cerrarSandboxFila, obtenerSesion, sesionesDeSandbox,
} from "../dominio/proyectos.js";
import { crearWorktree, borrarWorktree, ejecutarComando, diffSandbox, estadoGit, commitSandbox, pushSandbox, integrarEnBase } from "../motor/sandbox.js";
import { iniciarSesionClaude, esperarSesion, cancelarSesion } from "../motor/claude-code.js";
import { encolar } from "../motor/cola.js";

const MODULO = "codigo";
const SANDBOX_ID = { type: "string" as const, description: "Id del sandbox (lo devuelve codigo_abrir_sandbox).", minLength: 8 };

async function sandboxAbierto(id: string) {
  const s = await obtenerSandbox(id);
  if (!s) throw new Error(`Sandbox ${id} no existe.`);
  if (s.estado !== "abierto") throw new Error(`El sandbox ${id} está cerrado.`);
  return s;
}
function dentro(base: string, rel: string): string {
  const abs = path.resolve(base, rel);
  if (!abs.startsWith(path.resolve(base))) throw new Error("Ruta fuera del sandbox.");
  return abs;
}

// ─── Proyectos ───────────────────────────────────────────────────────────────
export const codigoListarProyectos: DefTool = {
  nombre: "codigo_listar_proyectos", modulo: MODULO,
  descripcion: "Lista los proyectos (repos) registrados: nombre, ruta, rama base, comandos de test/build y notas.",
  parametros: { type: "object", properties: {}, required: [] }, riesgo: "lectura", requiereAprobacion: false,
  async ejecutar() {
    const lista = await listarProyectos();
    return { ok: true, datos: lista, resumen: lista.length ? lista.map((p) => `${p.nombre} → ${p.ruta} (${p.rama_base})`).join("\n") : "No hay proyectos registrados. Usá codigo_registrar_proyecto." };
  },
};

export const codigoRegistrarProyecto: DefTool = {
  nombre: "codigo_registrar_proyecto", modulo: MODULO,
  descripcion: "Registra (o actualiza) un proyecto: un repositorio git local donde el Senior puede trabajar. Los comandos son opcionales pero permiten verificar automáticamente.",
  parametros: {
    type: "object",
    properties: {
      nombre: { type: "string", description: "Slug snake_case, ej. jelcom_envios.", minLength: 2 },
      ruta: { type: "string", description: "Ruta absoluta del repo, ej. C:\\\\Users\\\\Sebas\\\\proyectos\\\\emilia", minLength: 3 },
      rama_base: { type: "string", description: "Rama base.", default: "main" },
      cmd_install: { type: "string", description: "Comando para instalar dependencias (por defecto npm install si hay package.json)." },
      cmd_test: { type: "string", description: "Comando de tests, ej. npm test." },
      cmd_build: { type: "string", description: "Comando de build/compilación, ej. npx tsc --noEmit." },
      cmd_lint: { type: "string", description: "Comando de lint." },
      notas: { type: "string", description: "Lo que el Senior debe saber del proyecto (stack, convenciones, cuidados)." },
    },
    required: ["nombre", "ruta"],
  },
  riesgo: "escritura", requiereAprobacion: false,
  async ejecutar(a) {
    const p = await registrarProyecto(a as any);
    return { ok: true, datos: p, resumen: `Proyecto ${p.nombre} registrado en ${p.ruta} (base ${p.rama_base}).` };
  },
};

export const codigoEliminarProyecto: DefTool = {
  nombre: "codigo_eliminar_proyecto", modulo: MODULO,
  descripcion: "Quita un proyecto del registro (no borra el repo del disco). Requiere aprobación.",
  parametros: { type: "object", properties: { proyecto: { type: "string", description: "Nombre del proyecto." } }, required: ["proyecto"] },
  riesgo: "escritura", requiereAprobacion: true,
  async ejecutar(a) { await borrarProyecto(a.proyecto); return { ok: true, resumen: `Proyecto ${a.proyecto} quitado del registro.` }; },
};

// ─── Sandbox ─────────────────────────────────────────────────────────────────
export const codigoAbrirSandbox: DefTool = {
  nombre: "codigo_abrir_sandbox", modulo: MODULO,
  descripcion: "Abre un sandbox: copia aislada del proyecto (git worktree) en una rama nueva, con sus dependencias. Todo el trabajo del Senior pasa ahí; el repo real no se toca.",
  parametros: { type: "object", properties: { proyecto: { type: "string", description: "Nombre del proyecto.", minLength: 2 }, proposito: { type: "string", description: "Para qué es (da nombre a la rama), ej. 'arreglar login'.", minLength: 3 } }, required: ["proyecto", "proposito"] },
  riesgo: "escritura", requiereAprobacion: false, timeoutSeg: 900,
  async ejecutar(a) {
    const p = await obtenerProyecto(a.proyecto);
    if (!p) return { ok: false, error: `Proyecto "${a.proyecto}" no registrado.` };
    const w = await crearWorktree(p, a.proposito);
    const s = await crearSandboxFila(p.id, w.ruta, w.rama, a.proposito);
    return { ok: true, datos: { sandbox_id: s.id, ruta: w.ruta, rama: w.rama, instalacion: w.instalacion }, resumen: `Sandbox ${s.id} abierto en rama ${w.rama}${w.instalacion ? ` · ${w.instalacion}` : ""}.` };
  },
};

export const codigoListarSandboxes: DefTool = {
  nombre: "codigo_listar_sandboxes", modulo: MODULO,
  descripcion: "Lista los sandboxes abiertos (proyecto, rama, propósito, id).",
  parametros: { type: "object", properties: {}, required: [] }, riesgo: "lectura", requiereAprobacion: false,
  async ejecutar() {
    const l = await sandboxesAbiertos();
    return { ok: true, datos: l.map((s) => ({ sandbox_id: s.id, proyecto: s.proyecto_nombre, rama: s.rama, proposito: s.proposito, creado_en: s.creado_en })), resumen: l.length ? l.map((s) => `${s.id.slice(0, 8)}… ${s.proyecto_nombre}/${s.rama} — ${s.proposito}`).join("\n") : "No hay sandboxes abiertos." };
  },
};

export const codigoCerrarSandbox: DefTool = {
  nombre: "codigo_cerrar_sandbox", modulo: MODULO,
  descripcion: "Cierra un sandbox y borra su worktree. La rama se conserva salvo que borrar_rama=true (irreversible si no se integró ni se hizo push).",
  parametros: { type: "object", properties: { sandbox_id: SANDBOX_ID, borrar_rama: { type: "boolean", description: "Borrar también la rama.", default: false } }, required: ["sandbox_id"] },
  riesgo: "escritura", requiereAprobacion: false, timeoutSeg: 120,
  async ejecutar(a) {
    const s = await sandboxAbierto(a.sandbox_id);
    await borrarWorktree(s.proyecto, s.ruta, s.rama, !!a.borrar_rama);
    await cerrarSandboxFila(s.id);
    return { ok: true, resumen: `Sandbox cerrado. Rama ${s.rama} ${a.borrar_rama ? "borrada" : "conservada"}.` };
  },
};

// ─── Claude Code ─────────────────────────────────────────────────────────────
export const codigoEjecutarClaude: DefTool = {
  nombre: "codigo_ejecutar_claude", modulo: MODULO,
  descripcion: "Le da un encargo a Claude Code dentro del sandbox. Claude lee el repo, planea, escribe código, corre comandos y devuelve un informe. Con esperar=true (por defecto) bloquea hasta que termine (máx. timeout); con esperar=false devuelve la sesion_id para observarla con codigo_estado_sesion.",
  parametros: {
    type: "object",
    properties: {
      sandbox_id: SANDBOX_ID,
      encargo: { type: "string", description: "El encargo completo y preciso: qué hacer, dónde, criterios de aceptación, qué no tocar, cómo verificar.", minLength: 10 },
      contexto: { type: "string", description: "Reglas y contexto que van antes del encargo (convenciones del proyecto, límites)." },
      max_turnos: { type: "integer", description: "Tope de turnos de Claude Code.", default: 60, minimum: 1, maximum: 300 },
      continuar_sesion: { type: "string", description: "session_id de Claude de una sesión anterior para continuarla con el mismo contexto." },
      esperar: { type: "boolean", description: "Esperar a que termine.", default: true },
      timeout_seg: { type: "integer", description: "Máximo a esperar si esperar=true.", default: 900, minimum: 30, maximum: 3600 },
    },
    required: ["sandbox_id", "encargo"],
  },
  riesgo: "ejecucion", requiereAprobacion: false, timeoutSeg: 3700,
  async ejecutar(a, ctx) {
    const s = await sandboxAbierto(a.sandbox_id);
    // Una sesión de Claude a la vez por sandbox.
    const sesion = await encolar(`claude:${s.id}`, () => iniciarSesionClaude({
      sandboxId: s.id, proyectoId: s.proyecto_id, cwd: s.ruta, encargo: a.encargo, sistema: a.contexto,
      maxTurnos: a.max_turnos || 60, continuarSesionClaude: a.continuar_sesion, agenteId: ctx.agenteId, conversacionId: ctx.conversacionId,
    }));
    if (a.esperar === false) return { ok: true, datos: { sesion_id: sesion.id, estado: "en_curso" }, resumen: `Sesión ${sesion.id} iniciada en segundo plano.` };
    const fin = await esperarSesion(sesion.id, a.timeout_seg || 900);
    if (fin.estado === "en_curso") return { ok: true, datos: { sesion_id: fin.id, estado: "en_curso" }, resumen: `La sesión ${fin.id} sigue corriendo tras ${a.timeout_seg || 900}s. Observala con codigo_estado_sesion.` };
    return {
      ok: fin.estado === "completada",
      datos: { sesion_id: fin.id, estado: fin.estado, session_id_claude: fin.session_id_claude, resultado: fin.resultado, costo_usd: fin.costo_usd, turnos: fin.turnos, duracion_s: Math.round((fin.duracion_ms || 0) / 1000) },
      resumen: fin.estado === "completada" ? `Claude Code terminó (${fin.turnos} turnos, ${Math.round((fin.duracion_ms || 0) / 1000)}s):\n${(fin.resultado || "").slice(0, 3000)}` : undefined,
      error: fin.estado === "completada" ? undefined : fin.error || `Sesión ${fin.estado}.`,
    };
  },
};

export const codigoEstadoSesion: DefTool = {
  nombre: "codigo_estado_sesion", modulo: MODULO,
  descripcion: "Estado y log en vivo de una sesión de Claude Code: qué está haciendo, qué herramientas usó, si terminó y su resultado.",
  parametros: { type: "object", properties: { sesion_id: { type: "string", minLength: 8 }, ultimos: { type: "integer", description: "Cuántas líneas de log devolver.", default: 20, minimum: 1, maximum: 200 } }, required: ["sesion_id"] },
  riesgo: "lectura", requiereAprobacion: false,
  async ejecutar(a) {
    const s = await obtenerSesion(a.sesion_id);
    if (!s) return { ok: false, error: "Sesión no encontrada." };
    const log = (s.log || []).slice(-(a.ultimos || 20));
    return { ok: true, datos: { estado: s.estado, session_id_claude: s.session_id_claude, resultado: s.resultado, error: s.error, costo_usd: s.costo_usd, turnos: s.turnos, log }, resumen: `Sesión ${s.estado}${s.turnos ? ` · ${s.turnos} turnos` : ""}\n${log.map((l) => `[${l.tipo}] ${l.texto.slice(0, 200)}`).join("\n")}` };
  },
};

export const codigoCancelarSesion: DefTool = {
  nombre: "codigo_cancelar_sesion", modulo: MODULO,
  descripcion: "Cancela una sesión de Claude Code en curso.",
  parametros: { type: "object", properties: { sesion_id: { type: "string", minLength: 8 } }, required: ["sesion_id"] },
  riesgo: "ejecucion", requiereAprobacion: false,
  async ejecutar(a) { const ok = await cancelarSesion(a.sesion_id); return ok ? { ok: true, resumen: "Sesión cancelada." } : { ok: false, error: "No había una sesión en curso con ese id." }; },
};

export const codigoListarSesiones: DefTool = {
  nombre: "codigo_listar_sesiones", modulo: MODULO,
  descripcion: "Lista las sesiones de Claude Code de un sandbox (para retomar una con continuar_sesion).",
  parametros: { type: "object", properties: { sandbox_id: SANDBOX_ID }, required: ["sandbox_id"] },
  riesgo: "lectura", requiereAprobacion: false,
  async ejecutar(a) {
    const l = await sesionesDeSandbox(a.sandbox_id);
    return { ok: true, datos: l, resumen: l.length ? l.map((s) => `${s.id.slice(0, 8)}… ${s.estado} · ${s.encargo.slice(0, 60)}`).join("\n") : "Sin sesiones." };
  },
};

// ─── Trabajo en el sandbox ───────────────────────────────────────────────────
export const codigoEjecutarComando: DefTool = {
  nombre: "codigo_ejecutar_comando", modulo: MODULO,
  descripcion: "Ejecuta un comando de shell DENTRO del sandbox (tests, build, scripts, git de lectura). Devuelve salida y código de salida.",
  parametros: { type: "object", properties: { sandbox_id: SANDBOX_ID, comando: { type: "string", minLength: 1 }, timeout_seg: { type: "integer", default: 120, minimum: 5, maximum: 1800 } }, required: ["sandbox_id", "comando"] },
  riesgo: "ejecucion", requiereAprobacion: false, timeoutSeg: 1900,
  async ejecutar(a) {
    const s = await sandboxAbierto(a.sandbox_id);
    const r = await ejecutarComando(s.ruta, a.comando, a.timeout_seg || 120);
    return { ok: r.codigo === 0 && !r.timeout, datos: { codigo: r.codigo, stdout: r.stdout.slice(-6000), stderr: r.stderr.slice(-3000), duracion_ms: r.duracion_ms, timeout: r.timeout }, resumen: `$ ${a.comando} → código ${r.codigo}${r.timeout ? " (timeout)" : ""}\n${(r.stdout || r.stderr).slice(-1500)}`, error: r.codigo === 0 && !r.timeout ? undefined : `Salió con código ${r.codigo}${r.timeout ? " por timeout" : ""}: ${(r.stderr || r.stdout).slice(-800)}` };
  },
};

export const codigoVerificar: DefTool = {
  nombre: "codigo_verificar", modulo: MODULO,
  descripcion: "Corre las verificaciones del proyecto en el sandbox (build, lint y tests, los que estén configurados) y resume qué pasó y qué falló.",
  parametros: { type: "object", properties: { sandbox_id: SANDBOX_ID }, required: ["sandbox_id"] },
  riesgo: "ejecucion", requiereAprobacion: false, timeoutSeg: 1900,
  async ejecutar(a) {
    const s = await sandboxAbierto(a.sandbox_id);
    const pasos = [["build", s.proyecto.cmd_build], ["lint", s.proyecto.cmd_lint], ["test", s.proyecto.cmd_test]].filter(([, c]) => c) as [string, string][];
    if (!pasos.length) return { ok: true, datos: { sin_verificaciones: true }, resumen: "El proyecto no tiene comandos de build/lint/test configurados; no hay nada automático que verificar." };
    const resultados: any[] = [];
    let todoOk = true;
    for (const [nombre, cmd] of pasos) {
      const r = await ejecutarComando(s.ruta, cmd, 600);
      const ok = r.codigo === 0 && !r.timeout;
      todoOk &&= ok;
      resultados.push({ paso: nombre, comando: cmd, ok, codigo: r.codigo, salida: (ok ? r.stdout : r.stderr || r.stdout).slice(-2500) });
    }
    return { ok: todoOk, datos: { resultados }, resumen: resultados.map((r) => `${r.ok ? "✔" : "✘"} ${r.paso} (${r.comando})${r.ok ? "" : `\n${r.salida.slice(-800)}`}`).join("\n"), error: todoOk ? undefined : `Fallaron: ${resultados.filter((r) => !r.ok).map((r) => r.paso).join(", ")}` };
  },
};

export const codigoDiff: DefTool = {
  nombre: "codigo_diff", modulo: MODULO,
  descripcion: "Diff de lo que cambió en el sandbox respecto a la rama base (archivos tocados y el diff, recortado).",
  parametros: { type: "object", properties: { sandbox_id: SANDBOX_ID, max_chars: { type: "integer", default: 12000, minimum: 500, maximum: 60000 } }, required: ["sandbox_id"] },
  riesgo: "lectura", requiereAprobacion: false, timeoutSeg: 120,
  async ejecutar(a) {
    const s = await sandboxAbierto(a.sandbox_id);
    const d = await diffSandbox(s.ruta, s.proyecto.rama_base, a.max_chars || 12000);
    return { ok: true, datos: d, resumen: `${d.resumen}\n\n${d.diff.slice(0, 4000)}${d.truncado ? "\n[...diff recortado]" : ""}` };
  },
};

export const codigoLeerArchivo: DefTool = {
  nombre: "codigo_leer_archivo", modulo: MODULO,
  descripcion: "Lee un archivo del sandbox (o un rango de líneas).",
  parametros: { type: "object", properties: { sandbox_id: SANDBOX_ID, ruta: { type: "string", description: "Ruta relativa al sandbox.", minLength: 1 }, desde: { type: "integer", minimum: 1 }, hasta: { type: "integer", minimum: 1 } }, required: ["sandbox_id", "ruta"] },
  riesgo: "lectura", requiereAprobacion: false,
  async ejecutar(a) {
    const s = await sandboxAbierto(a.sandbox_id);
    const abs = dentro(s.ruta, a.ruta);
    const texto = await fs.readFile(abs, "utf-8");
    const lineas = texto.split("\n");
    const d = Math.max(1, a.desde || 1), h = Math.min(lineas.length, a.hasta || Math.min(lineas.length, d + 400));
    const trozo = lineas.slice(d - 1, h).map((l, i) => `${d + i}: ${l}`).join("\n");
    return { ok: true, datos: { ruta: a.ruta, total_lineas: lineas.length, desde: d, hasta: h, contenido: trozo.slice(0, 20000) }, resumen: trozo.slice(0, 3000) };
  },
};

export const codigoBuscar: DefTool = {
  nombre: "codigo_buscar", modulo: MODULO,
  descripcion: "Busca texto (regex) en los archivos del sandbox. Devuelve archivo:línea y la línea.",
  parametros: { type: "object", properties: { sandbox_id: SANDBOX_ID, patron: { type: "string", minLength: 1 }, max: { type: "integer", default: 40, minimum: 1, maximum: 200 } }, required: ["sandbox_id", "patron"] },
  riesgo: "lectura", requiereAprobacion: false, timeoutSeg: 60,
  async ejecutar(a) {
    const s = await sandboxAbierto(a.sandbox_id);
    const r = await ejecutarComando(s.ruta, `git grep -n -I -E "${String(a.patron).replace(/"/g, '\\"')}" -- . ":!node_modules" ":!dist"`, 60);
    const lineas = r.stdout.split("\n").filter(Boolean).slice(0, a.max || 40);
    return { ok: true, datos: { coincidencias: lineas }, resumen: lineas.length ? lineas.join("\n").slice(0, 4000) : "Sin coincidencias." };
  },
};

// ─── Git hacia el repo real (aprobación) ─────────────────────────────────────
export const codigoGitEstado: DefTool = {
  nombre: "codigo_git_estado", modulo: MODULO,
  descripcion: "Rama actual, cambios sin commit y últimos commits del sandbox.",
  parametros: { type: "object", properties: { sandbox_id: SANDBOX_ID }, required: ["sandbox_id"] },
  riesgo: "lectura", requiereAprobacion: false,
  async ejecutar(a) { const s = await sandboxAbierto(a.sandbox_id); const e = await estadoGit(s.ruta); return { ok: true, datos: e, resumen: `rama ${e.rama}\n${e.estado}\n${e.ultimos_commits}` }; },
};

export const codigoCommit: DefTool = {
  nombre: "codigo_commit", modulo: MODULO,
  descripcion: "Hace commit de todo lo cambiado en el sandbox (en su rama). Requiere aprobación.",
  parametros: { type: "object", properties: { sandbox_id: SANDBOX_ID, mensaje: { type: "string", description: "Mensaje de commit claro.", minLength: 5 } }, required: ["sandbox_id", "mensaje"] },
  riesgo: "ejecucion", requiereAprobacion: true, timeoutSeg: 120,
  async ejecutar(a) { const s = await sandboxAbierto(a.sandbox_id); const r = await commitSandbox(s.ruta, a.mensaje); return r.codigo === 0 ? { ok: true, resumen: `Commit hecho en ${s.rama}:\n${r.stdout.slice(0, 500)}` } : { ok: false, error: (r.stderr || r.stdout).slice(-800) }; },
};

export const codigoPush: DefTool = {
  nombre: "codigo_push", modulo: MODULO,
  descripcion: "Sube la rama del sandbox al remoto (origin). Requiere aprobación.",
  parametros: { type: "object", properties: { sandbox_id: SANDBOX_ID }, required: ["sandbox_id"] },
  riesgo: "ejecucion", requiereAprobacion: true, timeoutSeg: 240,
  async ejecutar(a) { const s = await sandboxAbierto(a.sandbox_id); const r = await pushSandbox(s.ruta, s.rama); return r.codigo === 0 ? { ok: true, resumen: `Rama ${s.rama} subida.\n${(r.stderr || r.stdout).slice(-500)}` } : { ok: false, error: (r.stderr || r.stdout).slice(-800) }; },
};

export const codigoIntegrar: DefTool = {
  nombre: "codigo_integrar", modulo: MODULO,
  descripcion: "Integra (merge) la rama del sandbox en la rama base del REPO REAL. Es el paso que lleva el trabajo a tu código de verdad. Requiere aprobación; el repo real debe estar sin cambios pendientes y los commits del sandbox hechos.",
  parametros: { type: "object", properties: { sandbox_id: SANDBOX_ID }, required: ["sandbox_id"] },
  riesgo: "sistema", requiereAprobacion: true, timeoutSeg: 240,
  async ejecutar(a) {
    const s = await sandboxAbierto(a.sandbox_id);
    const e = await estadoGit(s.ruta);
    if (e.estado !== "(limpio)") return { ok: false, error: "El sandbox tiene cambios sin commit. Hacé commit primero (codigo_commit)." };
    const r = await integrarEnBase(s.proyecto, s.rama);
    return r.codigo === 0 ? { ok: true, resumen: `Rama ${s.rama} integrada en ${s.proyecto.rama_base} del repo real.\n${r.stdout.slice(-500)}` } : { ok: false, error: (r.stderr || r.stdout).slice(-800) };
  },
};

export const toolsCodigo: DefTool[] = [
  codigoListarProyectos, codigoRegistrarProyecto, codigoEliminarProyecto,
  codigoAbrirSandbox, codigoListarSandboxes, codigoCerrarSandbox,
  codigoEjecutarClaude, codigoEstadoSesion, codigoCancelarSesion, codigoListarSesiones,
  codigoEjecutarComando, codigoVerificar, codigoDiff, codigoLeerArchivo, codigoBuscar,
  codigoGitEstado, codigoCommit, codigoPush, codigoIntegrar,
];