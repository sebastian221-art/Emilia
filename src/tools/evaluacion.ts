// ARCHIVO: src/tools/evaluacion.ts
import type { DefTool } from "../registro/tipos.js";
import { query } from "../db/cliente.js";
import { correrEvaluacion, type Caso } from "../motor/evaluacion.js";
import { gasto } from "../motor/presupuesto.js";

const MODULO = "evaluacion";
async function agentePorNombre(n: string) { const [a] = await query<any>(`SELECT id, nombre FROM agentes WHERE lower(nombre)=lower($1) OR id::text=$1 LIMIT 1`, [n]); return a; }

export const evaluacionCrear: DefTool = {
  nombre: "evaluacion_crear", modulo: MODULO,
  descripcion: "Crea (o reemplaza) una evaluación para un agente: una lista de casos (mensaje del jefe + criterio esperado y/o tools que debería usar). Sirve para medir si un cambio mejoró o empeoró al agente.",
  parametros: {
    type: "object",
    properties: {
      nombre: { type: "string", minLength: 2 }, agente: { type: "string", minLength: 2 }, descripcion: { type: "string" },
      casos: { type: "array", items: { type: "object" }, description: "[{mensaje, esperado?, tools_esperadas?: [nombres], notas?}]" },
    },
    required: ["nombre", "agente", "casos"],
  },
  riesgo: "escritura", requiereAprobacion: false,
  async ejecutar(a) {
    const ag = await agentePorNombre(a.agente); if (!ag) return { ok: false, error: `Agente ${a.agente} no existe.` };
    const casos: Caso[] = (a.casos || []).filter((c: any) => c?.mensaje);
    if (!casos.length) return { ok: false, error: "Necesito al menos un caso con 'mensaje'." };
    await query(`INSERT INTO evaluaciones (nombre, agente_id, descripcion, casos) VALUES ($1,$2,$3,$4) ON CONFLICT (nombre) DO UPDATE SET agente_id=EXCLUDED.agente_id, descripcion=EXCLUDED.descripcion, casos=EXCLUDED.casos`, [a.nombre, ag.id, a.descripcion || "", JSON.stringify(casos)]);
    return { ok: true, resumen: `Evaluación "${a.nombre}" para ${ag.nombre} con ${casos.length} caso(s). Corrala con evaluacion_correr.` };
  },
};

export const evaluacionDesdeConversacion: DefTool = {
  nombre: "evaluacion_desde_conversacion", modulo: MODULO,
  descripcion: "Arma casos de evaluación a partir de los últimos intercambios reales de la conversación actual del jefe con el agente: cada pedido del jefe se vuelve un caso, con la respuesta dada y las tools usadas como referencia esperada. Luego se puede editar.",
  parametros: { type: "object", properties: { nombre: { type: "string", minLength: 2 }, agente: { type: "string", minLength: 2 }, ultimos: { type: "integer", default: 8, minimum: 1, maximum: 40 } }, required: ["nombre", "agente"] },
  riesgo: "escritura", requiereAprobacion: false,
  async ejecutar(a, ctx) {
    const ag = await agentePorNombre(a.agente); if (!ag) return { ok: false, error: `Agente ${a.agente} no existe.` };
    if (!ctx.conversacionId) return { ok: false, error: "Necesito una conversación." };
    const msgs = await query<any>(`SELECT rol, contenido, creado_en FROM mensajes WHERE conversacion_id=$1 ORDER BY creado_en DESC LIMIT $2`, [ctx.conversacionId, (a.ultimos || 8) * 2 + 2]);
    const orden = msgs.reverse(); const casos: Caso[] = [];
    const trivial = /^\s*(ok|okay|sí|si|no|dale|listo|gracias|hola|bien|por qu[eé]\s*\??|y\?|hazlo|hacelo|probemos.*)\s*[.!?]*\s*$/i;
    for (let i = 0; i < orden.length; i++) {
      if (orden[i].rol !== "usuario") continue;
      const texto = String(orden[i].contenido || "").trim();
      if (texto.length < 15 || trivial.test(texto) || texto.startsWith("[")) continue;   // aprobaciones, monosílabos, adjuntos
      if (/evaluaci[oó]n|presupuesto|gast(o|ado)|cu[aá]nto has gastado/i.test(texto)) continue;   // meta: no evaluarse a sí misma
      const resp = orden.slice(i + 1).find((m) => m.rol === "agente");
      if (resp && /Necesito tu OK|⏸/.test(resp.contenido)) continue;   // la respuesta fue una pausa por aprobación, no un resultado
      const [ej] = await query<any>(`SELECT id FROM ejecuciones WHERE conversacion_id=$1 AND inicio >= $2 ORDER BY inicio ASC LIMIT 1`, [ctx.conversacionId, orden[i].creado_en]);
      const tools = ej ? (await query<{ detalle: string }>(`SELECT detalle FROM pasos WHERE ejecucion_id=$1 AND tipo='tool'`, [ej.id])).map((p) => p.detalle.split("(")[0].trim()) : [];
      casos.push({ mensaje: orden[i].contenido, esperado: resp ? `Una respuesta equivalente a: "${resp.contenido.slice(0, 300)}"` : undefined, tools_esperadas: [...new Set(tools)] });
      if (casos.length >= (a.ultimos || 8)) break;
    }
    if (!casos.length) return { ok: false, error: "No encontré pedidos del jefe en esta conversación." };
    await query(`INSERT INTO evaluaciones (nombre, agente_id, descripcion, casos) VALUES ($1,$2,$3,$4) ON CONFLICT (nombre) DO UPDATE SET casos=EXCLUDED.casos`, [a.nombre, ag.id, "Generada desde conversación", JSON.stringify(casos)]);
    return { ok: true, datos: { casos }, resumen: `Evaluación "${a.nombre}" con ${casos.length} caso(s) tomados de esta conversación:\n${casos.map((c) => `• ${c.mensaje.slice(0, 60)} → tools: ${c.tools_esperadas?.join(", ") || "ninguna"}`).join("\n")}` };
  },
};

export const evaluacionCorrer: DefTool = {
  nombre: "evaluacion_correr", modulo: MODULO,
  descripcion: "Corre una evaluación: reproduce cada caso contra el agente en modo SIMULADO (no ejecuta acciones reales) y devuelve puntaje por caso y total, con el juicio de cada uno. Útil tras cambiar prompts o el esqueleto.",
  parametros: { type: "object", properties: { nombre: { type: "string", minLength: 2 } }, required: ["nombre"] },
  riesgo: "ejecucion", requiereAprobacion: false, timeoutSeg: 1800,
  async ejecutar(a) {
    const r = await correrEvaluacion(a.nombre);
    return { ok: true, datos: r, resumen: `Puntaje total: ${(r.puntaje * 100).toFixed(0)}%\n` + r.resultados.map((x) => `${x.puntaje >= 0.8 ? "✔" : x.puntaje >= 0.5 ? "◐" : "✘"} ${(x.puntaje * 100).toFixed(0)}% · ${x.caso.slice(0, 50)}${x.juicio ? " — " + x.juicio : ""}${x.error ? " — ERROR " + x.error : ""}`).join("\n") };
  },
};

export const evaluacionHistorial: DefTool = {
  nombre: "evaluacion_historial", modulo: MODULO,
  descripcion: "Puntajes de las últimas corridas de una evaluación (para ver si el agente mejora o empeora con el tiempo).",
  parametros: { type: "object", properties: { nombre: { type: "string", minLength: 2 }, limite: { type: "integer", default: 10 } }, required: ["nombre"] },
  riesgo: "lectura", requiereAprobacion: false,
  async ejecutar(a) {
    const l = await query<any>(`SELECT c.puntaje, c.costo_usd, c.inicio, c.fin FROM evaluacion_corridas c JOIN evaluaciones e ON e.id=c.evaluacion_id WHERE e.nombre=$1 ORDER BY c.inicio DESC LIMIT $2`, [a.nombre, a.limite || 10]);
    return { ok: true, datos: l, resumen: l.length ? l.map((c) => `${new Date(c.inicio).toLocaleString("es-CO", { dateStyle: "short", timeStyle: "short" })}: ${c.puntaje != null ? (c.puntaje * 100).toFixed(0) + "%" : "en curso"}${c.costo_usd ? ` · $${Number(c.costo_usd).toFixed(4)}` : ""}`).join("\n") : "Sin corridas." };
  },
};

export const presupuestoEstado: DefTool = {
  nombre: "presupuesto_estado", modulo: "presupuesto",
  descripcion: "Cuánto se ha gastado (Groq + Claude Code) hoy, esta semana o este mes, por agente o en total, y el tope diario configurado.",
  parametros: { type: "object", properties: { agente: { type: "string", description: "Nombre del agente (opcional: sin él, total del sistema)." }, periodo: { type: "string", enum: ["hoy", "semana", "mes"], default: "hoy" } }, required: [] },
  riesgo: "lectura", requiereAprobacion: false,
  async ejecutar(a) {
    let agenteId: string | null = null, tope = 0, nombre = "todo el sistema";
    if (a.agente) { const [ag] = await query<any>(`SELECT id, nombre, gobierno FROM agentes WHERE lower(nombre)=lower($1)`, [a.agente]); if (!ag) return { ok: false, error: "Agente no existe." }; agenteId = ag.id; nombre = ag.nombre; tope = Number(ag.gobierno?.presupuesto_diario_usd) || 0; }
    const g = await gasto(agenteId, a.periodo || "hoy");
    return { ok: true, datos: { ...g, tope_diario_usd: tope }, resumen: `${nombre} · ${a.periodo || "hoy"}: $${g.total_usd} (Groq $${g.groq_usd} en ${g.llamadas_groq} llamadas / ${g.tokens_in + g.tokens_out} tokens · Claude Code $${g.claude_usd} en ${g.sesiones_claude} sesiones)${tope ? ` · tope diario $${tope}` : ""}` };
  },
};

export const toolsEvaluacion: DefTool[] = [evaluacionCrear, evaluacionDesdeConversacion, evaluacionCorrer, evaluacionHistorial, presupuestoEstado];