// ARCHIVO: src/motor/oficina.ts
// ─────────────────────────────────────────────────────────────────────────────
//  LA OFICINA EN VIVO (lo que ve el panel)
//  Una sola foto del momento: cada agente con su estado (trabajando, esperando
//  tu OK, en reunión por una misión, inactivo, con error, en pausa), lo que está
//  haciendo ahora mismo, sus números de hoy; las misiones con sus
//  participantes; las aprobaciones; el gasto; los proveedores de modelos; el
//  ánimo de Emilia; y el pulso reciente (últimos pasos de todos).
//  La estación de trabajo de un agente: ahora, encargos, historial, métricas,
//  aprobaciones, su conversación directa y lo propio de su área.
// ─────────────────────────────────────────────────────────────────────────────
import { query } from "../db/cliente.js";

export type EstadoAgente = "trabajando" | "esperando" | "reunion" | "inactivo" | "error" | "pausado";
const hoyIni = `((now() AT TIME ZONE 'America/Bogota')::date)::timestamp AT TIME ZONE 'America/Bogota'`;

/** Paso crudo → frase corta para el monitor ("Usando jelcom_estado_envio", "Pensando…"). */
export function fraseDePaso(tipo: string, detalle: string): string {
  const d = String(detalle || "").replace(/\s+/g, " ").trim();
  if (tipo === "tool") { const m = d.match(/^([a-z0-9_]+)/); return m ? `Usando ${m[1]}` : d.slice(0, 80); }
  if (tipo === "aprobacion") return "Esperando tu OK";
  if (tipo === "error") return `Error: ${d.slice(0, 70)}`;
  if (tipo === "skill") return `Skill: ${d.slice(0, 70)}`;
  if (tipo === "plan") return `Planeando: ${d.slice(0, 70)}`;
  if (tipo === "pensamiento") return `Pensando: ${d.slice(0, 70)}`;
  if (tipo === "verificacion") return /^Completado/.test(d) ? "Terminó una tarea" : `Verificando: ${d.slice(0, 60)}`;
  if (tipo === "respuesta" || tipo === "final") return "Escribiendo la respuesta";
  return d.slice(0, 80) || "Pensando…";
}

function colorDeAnimo(e: any): string {
  if (!e) return "#a78bfa";
  if (e.enojo > 0.4) return "#f87171";
  if (e.preocupacion > 0.5) return "#fbbf24";
  if (e.timidez > 0.45) return "#f9a8d4";
  if (e.animo > 0.55 || e.entusiasmo > 0.7) return "#5eead4";
  if (e.animo < -0.2) return "#818cf8";
  return "#a78bfa";
}

export async function estadoOficina() {
  const [ags, ejes, sesiones, ultFallas, hoy, costos, aprob, misiones, pasos, encargos] = await Promise.all([
    query<any>(`SELECT a.id, a.nombre, a.estado, a.es_administrador, a.identidad->>'color' AS color, a.identidad->>'mision' AS mision,
        (SELECT p.titulo FROM puestos p WHERE p.agente_id = a.id ORDER BY p.creado_en LIMIT 1) AS puesto
      FROM agentes a ORDER BY a.es_administrador DESC, a.creado_en`).catch(() => query<any>(`SELECT id, nombre, estado, es_administrador, identidad->>'color' AS color, identidad->>'mision' AS mision, NULL AS puesto FROM agentes ORDER BY creado_en`)),
    query<any>(`SELECT e.id, e.agente_id, e.estado, e.inicio, e.origen, e.tool_calls,
        (SELECT p.tipo FROM pasos p WHERE p.ejecucion_id = e.id ORDER BY p.creado_en DESC LIMIT 1) AS ult_tipo,
        (SELECT left(p.detalle, 300) FROM pasos p WHERE p.ejecucion_id = e.id ORDER BY p.creado_en DESC LIMIT 1) AS ult_detalle,
        (SELECT left(m.contenido, 200) FROM mensajes m WHERE m.conversacion_id = e.conversacion_id AND m.rol = 'usuario' AND m.creado_en <= e.inicio + interval '5 seconds' ORDER BY m.creado_en DESC LIMIT 1) AS tarea
      FROM ejecuciones e WHERE e.estado IN ('en_curso','esperando_aprobacion') AND e.inicio > now() - interval '3 hours' ORDER BY e.inicio DESC`),
    query<any>(`SELECT s.id, s.encargo, s.inicio, (SELECT l->>'texto' FROM jsonb_array_elements(s.log) l ORDER BY l->>'t' DESC LIMIT 1) AS ultimo FROM sesiones_codigo s WHERE s.estado = 'en_curso'`).catch(() => []),
    query<any>(`SELECT DISTINCT ON (agente_id) agente_id, estado, fin FROM ejecuciones WHERE fin > now() - interval '10 minutes' ORDER BY agente_id, fin DESC`),
    query<any>(`SELECT agente_id, count(*)::int AS tareas, count(*) FILTER (WHERE estado = 'completada')::int AS ok, count(*) FILTER (WHERE estado = 'fallida')::int AS fallidas FROM ejecuciones WHERE inicio >= ${hoyIni} GROUP BY 1`),
    query<any>(`SELECT agente_id, sum(costo_usd)::float AS usd FROM consumo WHERE creado_en >= ${hoyIni} GROUP BY 1`).catch(() => []),
    query<any>(`SELECT a.id, a.tipo, a.titulo, left(a.detalle, 400) AS detalle, a.creado_en, a.agente_id, ag.nombre AS agente FROM aprobaciones a LEFT JOIN agentes ag ON ag.id = a.agente_id WHERE a.estado = 'pendiente' ORDER BY a.creado_en`),
    query<any>(`SELECT id, objetivo, pasos, estado, creado_en FROM misiones WHERE estado IN ('en_curso','atascada') ORDER BY creado_en DESC LIMIT 6`).catch(() => []),
    query<any>(`SELECT p.tipo, left(p.detalle, 220) AS detalle, p.creado_en, ag.nombre AS agente, ag.identidad->>'color' AS color FROM pasos p JOIN ejecuciones e ON e.id = p.ejecucion_id JOIN agentes ag ON ag.id = e.agente_id ORDER BY p.creado_en DESC LIMIT 40`),
    query<any>(`SELECT agente, estado, count(*)::int AS n FROM encargos WHERE estado IN ('en_curso','esperando_jefe') GROUP BY 1, 2`).catch(() => []),
  ]);
  const porAg = (xs: any[]) => new Map(xs.map((x) => [x.agente_id, x]));
  const mHoy = porAg(hoy), mCosto = porAg(costos), mFalla = porAg(ultFallas);
  // Participantes de misiones activas (por nombre).
  const enReunion = new Map<string, string>();
  for (const m of misiones) {
    const ps = (m.pasos || []) as any[];
    const vivos = [...new Set(ps.filter((p) => p.estado !== "saltado").map((p) => String(p.agente).toLowerCase()))];
    if (vivos.length >= 2) for (const a of vivos) if (!enReunion.has(a)) enReunion.set(a, m.id);
  }
  const agentes = ags.map((a) => {
    const ej = ejes.find((e) => e.agente_id === a.id && e.estado === "esperando_aprobacion") || ejes.find((e) => e.agente_id === a.id);
    const espera = aprob.find((x) => x.agente_id === a.id);
    let estado: EstadoAgente = "inactivo", actividad = "";
    if (a.estado !== "activo") { estado = "pausado"; actividad = `En ${a.estado}`; }
    else if (ej?.estado === "esperando_aprobacion" || espera) { estado = "esperando"; actividad = espera?.titulo || "Esperando tu OK"; }
    else if (ej) { estado = "trabajando"; actividad = fraseDePaso(ej.ult_tipo, ej.ult_detalle); }
    else if (/^sage$/i.test(a.nombre) && sesiones.length) { estado = "trabajando"; actividad = `Claude Code: ${String(sesiones[0].ultimo || sesiones[0].encargo || "programando").slice(0, 80)}`; }
    else if (enReunion.has(a.nombre.toLowerCase())) { estado = "reunion"; actividad = "En la sala de juntas"; }
    else if (mFalla.get(a.id)?.estado === "fallida") { estado = "error"; actividad = "Su última tarea falló"; }
    const h = mHoy.get(a.id) || { tareas: 0, ok: 0, fallidas: 0 };
    const enc = encargos.filter((e: any) => e.agente === a.nombre);
    return {
      id: a.id, nombre: a.nombre, color: a.color || "#a78bfa", admin: !!a.es_administrador, puesto: a.puesto || null, mision: String(a.mision || "").slice(0, 240),
      estado, actividad, tarea: ej?.tarea ? String(ej.tarea).replace(/\s+/g, " ").slice(0, 160) : null, desde: ej?.inicio || null,
      mision_id: enReunion.get(a.nombre.toLowerCase()) || null,
      hoy: { tareas: h.tareas, ok: h.ok, fallidas: h.fallidas, usd: Number(mCosto.get(a.id)?.usd || 0) },
      encargos: enc.reduce((s: number, e: any) => s + e.n, 0),
    };
  });
  // Emilia por dentro.
  let alma: any = null;
  try {
    const A = await import("./alma.js");
    const e = await A.leerEstado();
    alma = { descripcion: A.describirEstado(e), color: colorDeAnimo(e), dims: Object.fromEntries(A.DIMS.map((d) => [d, +Number(e[d]).toFixed(2)])), causa: e.causas.at(-1)?.texto || null };
  } catch { /* sin alma */ }
  let proveedores: any[] = [];
  try { proveedores = (await import("./groq.js")).estadoProveedores(); } catch { /* nada */ }
  const cuenta = (s: EstadoAgente) => agentes.filter((a) => a.estado === s).length;
  const tot = hoy.reduce((s, x) => ({ tareas: s.tareas + x.tareas, ok: s.ok + x.ok }), { tareas: 0, ok: 0 });
  return {
    ahora: new Date().toISOString(),
    agentes,
    resumen: { trabajando: cuenta("trabajando"), esperando: cuenta("esperando"), reunion: cuenta("reunion"), inactivo: cuenta("inactivo"), error: cuenta("error"),
      tareasHoy: tot.tareas, exitoHoy: tot.tareas ? Math.round((tot.ok / tot.tareas) * 100) : null, gastoHoy: +costos.reduce((s, x) => s + Number(x.usd || 0), 0).toFixed(4),
      encargosAbiertos: encargos.reduce((s: number, e: any) => s + e.n, 0) },
    aprobaciones: aprob.map((x) => ({ id: x.id, tipo: x.tipo, titulo: x.titulo, detalle: x.detalle, agente: x.agente, creado_en: x.creado_en })),
    misiones: misiones.map((m) => ({ id: m.id, ref: `M-${m.id.slice(0, 4)}`, objetivo: m.objetivo, estado: m.estado, pasos: (m.pasos || []).map((p: any) => ({ n: p.n, agente: p.agente, estado: p.estado, tarea: String(p.tarea).slice(0, 120) })) })),
    pulso: pasos.map((p) => ({ agente: p.agente, color: p.color, tipo: p.tipo, texto: fraseDePaso(p.tipo, p.detalle), detalle: p.detalle, t: p.creado_en })),
    alma, proveedores,
  };
}

/** La estación de trabajo de un agente. */
export async function estacionAgente(id: string) {
  const [a] = await query<any>(`SELECT * FROM agentes WHERE id = $1`, [id]);
  if (!a) return null;
  const nombre = a.nombre;
  const [ejes, ahora, encargos, aprob, metr, serie, conv, toolsN] = await Promise.all([
    query<any>(`SELECT id, estado, inicio, fin, origen, tool_calls, turnos_usados, left(respuesta, 400) AS respuesta FROM ejecuciones WHERE agente_id = $1 ORDER BY inicio DESC LIMIT 12`, [id]),
    query<any>(`SELECT p.tipo, left(p.detalle, 400) AS detalle, p.creado_en FROM pasos p JOIN ejecuciones e ON e.id = p.ejecucion_id WHERE e.agente_id = $1 AND e.inicio > now() - interval '6 hours' ORDER BY p.creado_en DESC LIMIT 25`, [id]),
    query<any>(`SELECT id, tarea, estado, left(resultado, 300) AS resultado, creado_en, terminado_en FROM encargos WHERE agente = $1 ORDER BY creado_en DESC LIMIT 12`, [nombre]).catch(() => []),
    query<any>(`SELECT id, tipo, titulo, left(detalle, 600) AS detalle, creado_en FROM aprobaciones WHERE agente_id = $1 AND estado = 'pendiente' ORDER BY creado_en`, [id]),
    import("./evolucion.js").then((E) => E.resumenVentana(6, 0, nombre)).then((r) => r[0] || null).catch(() => null),
    query<any>(`SELECT to_char(dia, 'MM-DD') AS dia, tareas, ok, fallidas, correcciones, seg_prom::float AS seg, costo_usd::float AS usd FROM sys_metricas WHERE agente = $1 AND dia > now() - interval '14 days' ORDER BY dia`, [nombre]).catch(() => []),
    query<any>(`SELECT m.rol, left(m.contenido, 1200) AS contenido, m.creado_en FROM mensajes m JOIN conversaciones c ON c.id = m.conversacion_id WHERE c.agente_id = $1 AND c.canal = 'panel' ORDER BY m.creado_en DESC LIMIT 20`, [id]),
    query<any>(`SELECT jsonb_array_length(COALESCE(tools->'ids', '[]')) AS tools, jsonb_array_length(COALESCE(skills->'ids', '[]')) AS skills FROM agentes WHERE id = $1`, [id]).catch(() => [{ tools: null, skills: null }]),
  ]);
  const extra = await extrasDe(nombre, !!a.es_administrador).catch((e) => ({ error: String(e?.message || e) }));
  return {
    agente: { id: a.id, nombre, color: a.identidad?.color || "#a78bfa", admin: !!a.es_administrador, estado: a.estado, mision: a.identidad?.mision || "", personalidad: String(a.identidad?.personalidad || "").slice(0, 400),
      modelos: { planificador: a.cerebro?.planificador, ejecutor: a.cerebro?.ejecutor }, tools: toolsN[0]?.tools, skills: toolsN[0]?.skills },
    ahora: ahora.map((p) => ({ ...p, frase: fraseDePaso(p.tipo, p.detalle) })),
    ejecuciones: ejes, encargos, aprobaciones: aprob, metricas: metr, serie, conversacion: conv.reverse(), extra,
  };
}

/** Lo propio del área de cada agente. */
async function extrasDe(nombre: string, admin: boolean): Promise<any> {
  const n = nombre.toLowerCase();
  if (admin) {
    const A = await import("./alma.js");
    const [{ yo, version }, e] = await Promise.all([A.leerYo(), A.leerEstado()]);
    const ms = await query<any>(`SELECT id, objetivo, estado, pasos FROM misiones ORDER BY creado_en DESC LIMIT 5`).catch(() => []);
    return { tipo: "emilia", animo: { descripcion: A.describirEstado(e), color: colorDeAnimo(e), dims: Object.fromEntries(A.DIMS.map((d) => [d, +Number(e[d]).toFixed(2)])), causas: e.causas.slice(-4) }, yo: { version, metas: yo.metas, gustos: yo.gustos.slice(0, 8), preguntas: yo.preguntas.slice(0, 3) }, misiones: ms };
  }
  if (n === "sage") {
    const [sb, gu, se] = await Promise.all([
      query<any>(`SELECT s.id, p.nombre AS proyecto, s.rama, s.estado, s.creado_en FROM sandboxes s JOIN proyectos p ON p.id = s.proyecto_id WHERE s.estado = 'abierto' ORDER BY s.creado_en DESC LIMIT 8`).catch(() => []),
      query<any>(`SELECT objetivo, severidad, titulo, estado FROM guardia_hallazgos WHERE estado NOT IN ('resuelto','ignorado') ORDER BY severidad, creado_en DESC LIMIT 8`).catch(() => []),
      query<any>(`SELECT s.encargo, s.estado, s.inicio FROM sesiones_codigo s ORDER BY s.inicio DESC LIMIT 5`).catch(() => []),
    ]);
    return { tipo: "sage", sandboxes: sb, guardia: gu, sesiones: se };
  }
  if (n === "system") {
    const E = await import("./evolucion.js");
    return { tipo: "system", tablero: await E.tablero(), cambios: (await E.listarCambios()).slice(0, 8).map((c: any) => ({ ref: E.refCambio(c.id), titulo: c.titulo, estado: c.estado, nivel: c.nivel, resultado: c.resultado?.resumen || null })), senales: (await E.senalesAbiertas(6)).map((s: any) => ({ tipo: s.tipo, titulo: s.titulo, prioridad: s.prioridad })) };
  }
  if (n === "lyra") {
    const [g, p, c] = await Promise.all([
      query<any>(`SELECT id, objetivo, estado, turnos, pregunta_jefe FROM gestiones WHERE estado IN ('activa','esperando_jefe') OR actualizado_en > now() - interval '2 days' ORDER BY actualizado_en DESC LIMIT 8`).catch(() => []),
      query<any>(`SELECT numero, left(borrador, 200) AS borrador, creado_en FROM lyra_propuestas WHERE estado = 'pendiente' ORDER BY creado_en DESC LIMIT 5`).catch(() => []),
      query<any>(`SELECT permiso, count(*)::int AS n FROM contactos GROUP BY 1`).catch(() => []),
    ]);
    return { tipo: "lyra", gestiones: g.map((x: any) => ({ ...x, ref: `G-${x.id.slice(0, 4)}` })), propuestas: p, contactos: c };
  }
  if (n === "lara") {
    const { estadoCerebro } = await import("./cerebro.js");
    return { tipo: "lara", cerebro: await estadoCerebro() };
  }
  if (n === "iris") {
    const [mo, ag] = await Promise.all([
      query<any>(`SELECT nombre, tipo, estado, ultimo_chequeo, left(ultimo_detalle, 140) AS detalle FROM monitores ORDER BY estado = 'ok', nombre LIMIT 20`).catch(() => []),
      query<any>(`SELECT titulo, inicio, tipo FROM agenda WHERE inicio >= now() - interval '1 hour' AND inicio < now() + interval '2 days' AND estado <> 'cancelado' ORDER BY inicio LIMIT 10`).catch(() => []),
    ]);
    return { tipo: "iris", monitores: mo, agenda: ag };
  }
  if (n === "soga") {
    const r = await query<any>(`SELECT tema, titulo, url, relevancia, visto_en FROM radar_vistos ORDER BY visto_en DESC LIMIT 8`).catch(() => []);
    return { tipo: "soga", radar: r };
  }
  return { tipo: "general" };
}
