// ARCHIVO: src/motor/aprendizaje.ts
// ─────────────────────────────────────────────────────────────────────────────
//  Motor de aprendizaje de System: la "pista" (experimentos con variantes y
//  puntaje, generaciones que cruzan lo mejor), la curiosidad (preguntas que el
//  sistema se hace solo) y la cosecha de "vueltas" (lo que pasó de verdad en
//  las ejecuciones de todos los agentes) para la reflexión nocturna.
// ─────────────────────────────────────────────────────────────────────────────
import { query } from "../db/cliente.js";
import { llamarModelo } from "./groq.js";
import { promises as fs } from "node:fs";
import path from "node:path";
import { exec } from "node:child_process";

// ── Experimentos ──
export type Caso = { entrada: string; esperado?: string; referencia?: string };
export async function crearExperimento(p: { titulo: string; hipotesis: string; metrica: string; dominio?: string; nodoSlug?: string | null; agenteId?: string | null; casos?: Caso[] }) {
  const [e] = await query<{ id: string }>(`INSERT INTO exp_experimentos (titulo, hipotesis, metrica, dominio, nodo_slug, agente_id, casos) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [p.titulo, p.hipotesis, p.metrica, p.dominio || "general", p.nodoSlug ?? null, p.agenteId ?? null, JSON.stringify(p.casos || [])]);
  return e.id;
}
export async function variantePorId(id: string) {
  const [v] = await query<any>(`SELECT v.*, e.casos AS casos_experimento, e.metrica FROM exp_variantes v JOIN exp_experimentos e ON e.id=v.experimento_id WHERE v.id::text LIKE $1 LIMIT 1`, [`${id}%`]);
  return v || null;
}
/** ¿Las instrucciones "hacen trampa" copiando las respuestas esperadas de los casos? (Goodhart: ganar el juez sin aprender nada.) */
export function huelenATrampa(instrucciones: string, casos: Caso[]): string | null {
  const norm = (t: string) => t.toLowerCase().replace(/\s+/g, " ").trim();
  const ins = norm(instrucciones);
  for (const c of casos) {
    const esp = norm(c.esperado || ""); if (esp.length < 20) continue;
    // ventana de 25 caracteres del esperado dentro de las instrucciones
    for (let i = 0; i + 25 <= esp.length; i += 8) if (ins.includes(esp.slice(i, i + 25))) return `las instrucciones contienen literalmente parte de la respuesta esperada ("${esp.slice(i, i + 25)}…"). Eso no es una regla, es memorizar el examen: la variante queda descartada.`;
    const ent = norm(c.entrada); if (ent.length >= 25 && ins.includes(ent.slice(0, 25))) return `las instrucciones mencionan literalmente el caso de prueba ("${ent.slice(0, 25)}…"): una regla general no puede nombrar los casos. Variante descartada.`;
  }
  return null;
}
/** Casos reales: lo que de verdad le escribieron a los agentes y lo que respondieron (para que la pista no sea inventada). */
export async function casosReales(p: { agente?: string | null; dias?: number; limite?: number; canal?: string | null } = {}): Promise<(Caso & { agente: string; fecha: string })[]> {
  const filas = await query<any>(`
    WITH u AS (
      SELECT m.id, m.conversacion_id, m.contenido, m.creado_en, c.agente_id, c.canal, a.nombre AS agente
      FROM mensajes m JOIN conversaciones c ON c.id=m.conversacion_id JOIN agentes a ON a.id=c.agente_id
      WHERE m.rol='usuario' AND m.creado_en > now() - ($1::int || ' days')::interval
        AND ($2::text IS NULL OR lower(a.nombre)=lower($2)) AND ($3::text IS NULL OR c.canal=$3)
        AND length(m.contenido) BETWEEN 8 AND 600 AND m.contenido !~* '^(ok|dale|si|sí|no|listo|volver|hablar con)'
    )
    SELECT u.agente, u.contenido AS entrada, u.creado_en,
      (SELECT r.contenido FROM mensajes r WHERE r.conversacion_id=u.conversacion_id AND r.rol='agente' AND r.creado_en > u.creado_en ORDER BY r.creado_en LIMIT 1) AS respuesta
    FROM u ORDER BY u.creado_en DESC LIMIT $4`, [Math.max(1, Math.min(60, p.dias || 7)), p.agente ?? null, p.canal ?? null, Math.max(1, Math.min(40, p.limite || 12))]);
  return filas.filter((f) => f.respuesta).map((f) => ({ entrada: f.entrada, referencia: String(f.respuesta).slice(0, 700), agente: f.agente, fecha: new Date(f.creado_en).toLocaleString("es-CO") }));
}
export async function experimentoPorId(id: string) {
  const [e] = await query<any>(`SELECT * FROM exp_experimentos WHERE id::text LIKE $1 ORDER BY creado_en DESC LIMIT 1`, [`${id}%`]);
  if (!e) return null;
  const variantes = await query<any>(`SELECT * FROM exp_variantes WHERE experimento_id=$1 ORDER BY puntaje DESC NULLS LAST, generacion DESC, creado_en`, [e.id]);
  return { ...e, variantes };
}
export async function agregarVariante(expId: string, p: { nombre: string; descripcion?: string; config?: any; generacion?: number; padres?: string[] }) {
  const [v] = await query<{ id: string }>(`INSERT INTO exp_variantes (experimento_id, nombre, descripcion, config, generacion, padres) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [expId, p.nombre, p.descripcion ?? null, JSON.stringify(p.config || {}), p.generacion || 1, p.padres || []]);
  return v.id;
}
export async function puntuarVariante(varId: string, puntaje: number, detalle?: string) {
  // Promedio móvil: varias corridas de la misma variante se promedian (así el ruido no manda).
  const [v] = await query<any>(`SELECT puntaje, corridas FROM exp_variantes WHERE id::text LIKE $1 LIMIT 1`, [`${varId}%`]);
  if (!v) throw new Error("No existe esa variante.");
  const n = Number(v.corridas) || 0; const prev = v.puntaje == null ? null : Number(v.puntaje);
  const nuevo = prev == null ? puntaje : (prev * n + puntaje) / (n + 1);
  await query(`UPDATE exp_variantes SET puntaje=$1, corridas=corridas+1, detalle=COALESCE($2, detalle) WHERE id::text LIKE $3`, [nuevo, detalle ?? null, `${varId}%`]);
  return nuevo;
}
export async function cerrarExperimento(expId: string, conclusion: string, mejorVariante?: string | null) {
  const e = await experimentoPorId(expId); if (!e) throw new Error("No existe el experimento.");
  const mejor = mejorVariante ? e.variantes.find((v: any) => v.id.startsWith(mejorVariante)) : e.variantes.find((v: any) => v.puntaje != null);
  await query(`UPDATE exp_experimentos SET estado='cerrado', conclusion=$1, mejor_variante=$2, cerrado_en=now() WHERE id=$3`, [conclusion, mejor?.id ?? null, e.id]);
  // Lo aprendido va a la biblioteca como evidencia de tipo experimento (si el experimento alimenta un nodo).
  if (e.nodo_slug) {
    try {
      const B = await import("./biblioteca.js");
      const nodo = await B.nodoPorSlug(e.nodo_slug);
      if (nodo) await B.evidenciar(nodo.id, { afirmacion: `${e.titulo}: ${conclusion}`.slice(0, 300), origen: "experimento", fuente: `experimento:${e.id}`, resultado: "apoya", detalle: mejor ? `mejor variante: ${mejor.nombre} (${Number(mejor.puntaje).toFixed(2)}) sobre ${e.variantes.length}` : undefined, agenteId: e.agente_id });
    } catch { /* la biblioteca puede no estar */ }
  }
  return { mejor, variantes: e.variantes.length };
}
export const experimentosAbiertos = () => query<any>(`SELECT e.*, (SELECT COUNT(*) FROM exp_variantes v WHERE v.experimento_id=e.id)::int AS variantes, (SELECT MAX(puntaje) FROM exp_variantes v WHERE v.experimento_id=e.id) AS mejor FROM exp_experimentos e WHERE estado='abierto' ORDER BY creado_en DESC`);

/** Tabla de posiciones de un experimento, lista para que el modelo decida cruzar/cerrar. */
export function tablaDe(e: any): string {
  const vs = e.variantes as any[];
  if (!vs.length) return "Sin variantes todavía.";
  return vs.map((v, i) => `${i + 1}. [${v.id.slice(0, 8)}] ${v.nombre} · gen ${v.generacion} · ${v.puntaje == null ? "sin correr" : `puntaje ${Number(v.puntaje).toFixed(2)} (${v.corridas} corrida${v.corridas === 1 ? "" : "s"})`}${v.padres?.length ? ` · cruce de ${v.padres.map((p: string) => p.slice(0, 8)).join("+")}` : ""}${v.descripcion ? `\n   ${String(v.descripcion).slice(0, 160)}` : ""}`).join("\n");
}

// ── Pista local para prompts/reglas: correr N casos contra unas instrucciones y puntuar con un juez ──
export async function probarPrompt(p: { instrucciones: string; casos: Caso[]; modelo?: string; juez?: string; criterio?: string }) {
  const resultados: { entrada: string; salida: string; puntaje: number; motivo: string }[] = [];
  for (const c of p.casos.slice(0, 8)) {
    let salida = "";
    // Pista JUSTA para experimentos de forma: si el caso trae la respuesta real como referencia (y no un esperado),
    // el modelo de prueba recibe esa información como "datos disponibles" y solo tiene que decirla según la regla.
    // Así el juez compara forma contra forma (misma información), no castiga que el modelo "no sepa" el dato.
    const entrada = !c.esperado && c.referencia ? `${c.entrada}\n\n[Información disponible para responder (usala, no inventes nada fuera de esto): ${c.referencia}]` : c.entrada;
    try { salida = (await llamarModelo([{ role: "system", content: p.instrucciones }, { role: "user", content: entrada }], [], { modelo: p.modelo, temperatura: 0.2 })).texto; }
    catch (e: any) { salida = `[error: ${e?.message?.slice(0, 100)}]`; }
    let puntaje = 0, motivo = "";
    try {
      const j = await llamarModelo([
        { role: "system", content: `Sos un juez estricto e insobornable. Evaluá la RESPUESTA según el criterio: ${p.criterio || "cumple lo esperado en fondo y forma"}. ${c.esperado ? "Hay una respuesta ESPERADA: medí si la RESPUESTA logra lo mismo (no exige palabras idénticas)." : c.referencia ? "No hay respuesta esperada; hay una RESPUESTA REAL anterior como referencia y el modelo tuvo esa misma información disponible: juzgá SOLO la forma (según el criterio) comparando la nueva contra la real: ¿la dice mejor, igual o peor? No penalices por información que ambas comparten." : "No hay respuesta esperada: juzgá solo por el criterio."} Penalizá datos inventados. Devolvé SOLO JSON: {"puntaje": 0-100, "motivo": "una línea"}.` },
        { role: "user", content: `ENTRADA: ${c.entrada}${c.esperado ? `\n\nESPERADO: ${c.esperado}` : ""}${c.referencia ? `\n\nRESPUESTA REAL ANTERIOR (referencia): ${c.referencia}` : ""}\n\nRESPUESTA: ${salida}` },
      ], [], { modelo: p.juez, temperatura: 0 });
      const m = j.texto.match(/\{[\s\S]*\}/); const o = m ? JSON.parse(m[0]) : {};
      puntaje = Math.max(0, Math.min(100, Number(o.puntaje) || 0)); motivo = String(o.motivo || "").slice(0, 200);
    } catch { motivo = "juez no respondió JSON"; }
    resultados.push({ entrada: c.entrada.slice(0, 120), salida: salida.slice(0, 300), puntaje, motivo });
  }
  const promedio = resultados.length ? resultados.reduce((a, r) => a + r.puntaje, 0) / resultados.length : 0;
  return { promedio, resultados };
}

// ── Curiosidad ──
export async function preguntar(p: { pregunta: string; origen?: string; prioridad?: number; nodoSlug?: string | null }) {
  const [r] = await query<{ id: string }>(`INSERT INTO curiosidad (pregunta, origen, prioridad, nodo_slug) VALUES ($1,$2,$3,$4) ON CONFLICT (pregunta) DO UPDATE SET prioridad=LEAST(curiosidad.prioridad, EXCLUDED.prioridad) RETURNING id`,
    [p.pregunta.trim().slice(0, 300), p.origen || "system", Math.max(1, Math.min(9, p.prioridad ?? 5)), p.nodoSlug ?? null]);
  return r.id;
}
export const curiosidadPendiente = (limite = 10) => query<any>(`SELECT * FROM curiosidad WHERE estado IN ('pendiente','explorando') ORDER BY prioridad, creado_en LIMIT $1`, [limite]);
export async function resolverCuriosidad(id: string, estado: "explorada" | "descartada", hallazgo?: string) {
  await query(`UPDATE curiosidad SET estado=$1, hallazgo=$2, explorada_en=now() WHERE id::text LIKE $3`, [estado, hallazgo ?? null, `${id}%`]);
}
/** Siembra curiosidad desde lo que el sistema ya sabe que no sabe: preguntas abiertas de la biblioteca, nodos dudosos, fallos repetidos. */
export async function sembrarCuriosidad(): Promise<number> {
  let n = 0;
  try {
    const nodos = await query<any>(`SELECT slug, titulo, estado, ficha->>'preguntas_abiertas' AS pa FROM bib_nodos WHERE borrado_en IS NULL AND (ficha ? 'preguntas_abiertas' OR estado IN ('dudoso','contradicho')) LIMIT 40`);
    for (const x of nodos) {
      if (x.pa) for (const q of String(x.pa).split(/\n|\?/).map((s) => s.trim()).filter((s) => s.length > 12).slice(0, 2)) { await preguntar({ pregunta: q.endsWith("?") ? q : q + "?", origen: "biblioteca", prioridad: 6, nodoSlug: x.slug }); n++; }
      if (x.estado !== "probable" && x.estado !== "verificado") { await preguntar({ pregunta: `¿Sigue siendo cierto lo que sabemos de "${x.titulo}"? Está en estado ${x.estado}.`, origen: "biblioteca", prioridad: 4, nodoSlug: x.slug }); n++; }
    }
    const fallos = await query<any>(`SELECT substring(detalle from 1 for 90) AS d, COUNT(*)::int AS c FROM pasos WHERE tipo='error' AND creado_en > now() - interval '7 days' GROUP BY 1 HAVING COUNT(*) >= 3 ORDER BY c DESC LIMIT 5`);
    for (const f of fallos) { await preguntar({ pregunta: `¿Por qué se repite este error (${f.c} veces en 7 días): "${f.d}"? ¿Cómo evitarlo de raíz?`, origen: "fallo", prioridad: 2 }); n++; }
  } catch { /* tablas pueden no existir */ }
  return n;
}

// ── Cosecha de vueltas: qué pasó de verdad, para reflexionar ──
export async function cosecharVueltas(dias = 1): Promise<string> {
  const iv = `${Math.max(1, Math.min(30, dias))} days`;
  const porAgente = await query<any>(`SELECT a.nombre, COUNT(*)::int AS total, COUNT(*) FILTER (WHERE e.estado='completada')::int AS ok, COUNT(*) FILTER (WHERE e.estado='fallida')::int AS fallidas,
      ROUND(AVG(e.turnos_usados)::numeric,1) AS turnos_prom, ROUND(AVG(e.tool_calls)::numeric,1) AS tools_prom
    FROM ejecuciones e JOIN agentes a ON a.id=e.agente_id WHERE e.fin > now() - $1::interval GROUP BY a.nombre ORDER BY total DESC`, [iv]).catch(() => [] as any[]);
  const errores = await query<any>(`SELECT substring(p.detalle from 1 for 140) AS d, COUNT(*)::int AS c FROM pasos p WHERE p.tipo='error' AND p.creado_en > now() - $1::interval GROUP BY 1 ORDER BY c DESC LIMIT 8`, [iv]).catch(() => [] as any[]);
  const verificaciones = await query<any>(`SELECT substring(p.detalle from 1 for 140) AS d, COUNT(*)::int AS c FROM pasos p WHERE p.tipo='verificacion' AND p.creado_en > now() - $1::interval AND (p.detalle ILIKE '%rechazada%' OR p.detalle ILIKE '%exigió%' OR p.detalle ILIKE '%bloque%' OR p.detalle ILIKE '%no existe%' OR p.detalle ILIKE '%delegar%') GROUP BY 1 ORDER BY c DESC LIMIT 8`, [iv]).catch(() => [] as any[]);
  const correcciones = await query<any>(`SELECT substring(m.contenido from 1 for 160) AS d, m.creado_en FROM mensajes m WHERE m.rol='usuario' AND m.creado_en > now() - $1::interval AND m.contenido ~* '^(no|mal|eso no|empeor|otra vez|no era|te equivoc|est[aá] mal|no funcion|no sirv|para|basta)' ORDER BY m.creado_en DESC LIMIT 10`, [iv]).catch(() => [] as any[]);
  const herramientas = await query<any>(`SELECT substring(p.detalle from 1 for 40) AS d, COUNT(*)::int AS c FROM pasos p WHERE p.tipo='tool' AND p.creado_en > now() - $1::interval GROUP BY 1 ORDER BY c DESC LIMIT 10`, [iv]).catch(() => [] as any[]);
  const exps = await experimentosAbiertos().catch(() => [] as any[]);
  const cur = await curiosidadPendiente(8).catch(() => [] as any[]);
  const L = (xs: any[], f: (x: any) => string, vacio = "ninguno") => xs.length ? xs.map(f).join("\n") : vacio;
  return [
    `=== VUELTAS DE LOS ÚLTIMOS ${dias} DÍA(S) ===`,
    `Por agente:\n${L(porAgente, (a) => `- ${a.nombre}: ${a.total} tareas, ${a.ok} ok, ${a.fallidas} fallidas, ${a.turnos_prom} turnos y ${a.tools_prom} herramientas por tarea en promedio`)}`,
    `Errores más repetidos:\n${L(errores, (e) => `- ×${e.c} ${e.d}`)}`,
    `Correcciones del sistema (honestidad, bloqueos, herramientas ajenas):\n${L(verificaciones, (v) => `- ×${v.c} ${v.d}`)}`,
    `Correcciones del jefe (mensajes que empiezan con 'no', 'mal', 'empeoró'…):\n${L(correcciones, (c) => `- ${new Date(c.creado_en).toLocaleString("es-CO")}: ${c.d}`)}`,
    `Herramientas más usadas:\n${L(herramientas, (h) => `- ×${h.c} ${h.d}`)}`,
    `Experimentos abiertos:\n${L(exps, (e) => `- [${e.id.slice(0, 8)}] ${e.titulo} · ${e.variantes} variantes · mejor ${e.mejor ?? "—"}`)}`,
    `Curiosidad pendiente:\n${L(cur, (c) => `- (p${c.prioridad}) ${c.pregunta}`)}`,
    `=== FIN ===`,
  ].join("\n\n");
}

// ── Laboratorio: la pista de código. Archivos + comando → carpeta temporal propia → resultado. Una sola llamada. ──
const LAB_BASE = path.resolve(process.env.LABORATORIO_DIR || path.join("data", "laboratorio"));
export async function laboratorio(p: { archivos: Record<string, string>; comando: string; timeoutSeg?: number; experimentoId?: string | null; nombre?: string }) {
  const c = p.comando.toLowerCase();
  if (/\b(rm\s+-rf?\s+[\/~]|rmdir\s+\/s|del\s+\/[sq]|format\s+[a-z]:|shutdown|reg\s+(add|delete)|diskpart|curl|wget|invoke-webrequest)\b/.test(c) || /[a-z][a-z0-9+.-]*:\/\//i.test(p.comando)) {
    throw new Error("El laboratorio es local y sin red: nada de borrar fuera, apagar, ni llamar URLs. Si necesitás datos de internet, traelos antes con web_leer y pasalos como archivo.");
  }
  const id = `${new Date().toISOString().slice(0, 10)}-${(p.nombre || "exp").replace(/[^a-z0-9_-]/gi, "").slice(0, 30) || "exp"}-${Math.random().toString(36).slice(2, 7)}`;
  const dir = path.join(LAB_BASE, id);
  await fs.mkdir(dir, { recursive: true });
  const escritos: string[] = [];
  for (const [nombre, contenido] of Object.entries(p.archivos || {})) {
    const abs = path.resolve(dir, nombre);
    if (!abs.startsWith(dir)) throw new Error(`Ruta fuera del laboratorio: ${nombre}`);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, String(contenido ?? ""), "utf-8");
    escritos.push(nombre);
  }
  const timeout = Math.max(5, Math.min(600, p.timeoutSeg || 120)) * 1000;
  const t0 = Date.now();
  const r = await new Promise<{ codigo: number; stdout: string; stderr: string; timeout: boolean }>((res) => {
    const child = exec(p.comando, { cwd: dir, timeout, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, NO_COLOR: "1", CI: "1" }, windowsHide: true }, (err: any, stdout, stderr) => {
      res({ codigo: err ? (typeof err.code === "number" ? err.code : 1) : 0, stdout: String(stdout || ""), stderr: String(stderr || ""), timeout: !!err?.killed });
    });
    void child;
  });
  const ms = Date.now() - t0;
  return { id, dir, archivos: escritos, comando: p.comando, codigo: r.codigo, timeout: r.timeout, ms, stdout: r.stdout.slice(-8000), stderr: r.stderr.slice(-4000) };
}