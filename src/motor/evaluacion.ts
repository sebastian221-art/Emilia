// ARCHIVO: src/motor/evaluacion.ts
// ─────────────────────────────────────────────────────────────────────────────
//  EVALUACIÓN DE AGENTES
//  Un caso = mensaje del jefe + lo esperado (criterio en texto y/o tools que
//  debería usar). Correr una evaluación = reproducir cada caso contra el agente
//  en una conversación aislada (canal 'evaluacion') y en MODO SIMULADO (nada
//  que escriba/ejecute corre de verdad), y juzgar: tools usadas vs esperadas
//  + un juez (Groq) que compara la respuesta con el criterio. Sirve para saber
//  si un cambio de prompt/esqueleto mejoró o empeoró al agente.
// ─────────────────────────────────────────────────────────────────────────────
import { query } from "../db/cliente.js";
import { correrTarea } from "./loop.js";
import { llamarModelo } from "./groq.js";
import { obtenerOCrearConversacion } from "../dominio/conversaciones.js";
import { gasto } from "./presupuesto.js";
import { registro } from "../registro/registro.js";

export interface Caso { mensaje: string; esperado?: string; tools_esperadas?: string[]; notas?: string }

export async function correrEvaluacion(evaluacionId: string): Promise<{ corridaId: string; puntaje: number; resultados: any[] }> {
  const [ev] = await query<any>(`SELECT * FROM evaluaciones WHERE id::text=$1 OR nombre=$1 LIMIT 1`, [evaluacionId]);
  if (!ev) throw new Error("Evaluación no encontrada.");
  const [ag] = await query<any>(`SELECT * FROM agentes WHERE id=$1`, [ev.agente_id]);
  if (!ag) throw new Error("El agente de la evaluación no existe.");
  const [corrida] = await query<{ id: string }>(`INSERT INTO evaluacion_corridas (evaluacion_id) VALUES ($1) RETURNING id`, [ev.id]);
  const antes = await gasto(ag.id, "hoy");
  const resultados: any[] = [];

  for (const [i, caso] of (ev.casos as Caso[]).entries()) {
    // Conversación aislada por corrida+caso: sin memoria de otras pruebas.
    const conv = await obtenerOCrearConversacion(ag.id, "evaluacion" as any, `${corrida.id.slice(0, 8)}-${i}`);
    let respuesta = "", tools: string[] = [], error: string | undefined;
    try {
      const r = await correrTarea(ag.id, caso.mensaje, { conversacionId: conv.id, origen: "evaluacion", simulado: true, contextoCanal: "Esto es una EVALUACIÓN: respondé como si fuera el jefe por WhatsApp. Las acciones sensibles están simuladas." });
      respuesta = r.respuesta;
      tools = (await query<{ detalle: string }>(`SELECT detalle FROM pasos WHERE ejecucion_id=$1 AND tipo='tool' ORDER BY creado_en`, [r.ejecucionId])).map((p) => p.detalle.replace(/^\[SIMULADO\]\s*/, "").split("(")[0].trim());
    } catch (e: any) { error = e?.message || String(e); }

    // Puntaje por tools (si se esperaban) + juicio del modelo sobre la respuesta.
    let pTools: number | null = null;
    if (caso.tools_esperadas?.length) { const usadas = new Set(tools); pTools = caso.tools_esperadas.filter((t) => usadas.has(t)).length / caso.tools_esperadas.length; }
    // Si el caso involucra acciones (no lectura), en simulación la respuesta no es comparable: solo cuentan las tools.
    const conAcciones = (caso.tools_esperadas || []).some((t) => { const d = registro.tool(t) || registro.skill(t); return d && d.riesgo !== "lectura"; });
    let pJuez: number | null = null, juicio = conAcciones ? "(caso con acciones: se puntúa por el camino de tools, no por el texto)" : "";
    if (caso.esperado && respuesta && !conAcciones) {
      try {
        const j = await llamarModelo([{ role: "user", content: `Sos un evaluador estricto. Pedido del jefe: "${caso.mensaje}"\nCriterio de lo esperado: "${caso.esperado}"\nRespuesta del agente: "${respuesta.slice(0, 2000)}"\nTools que usó: ${tools.join(", ") || "ninguna"}.\nRespondé SOLO JSON: {"puntaje": 0.0-1.0, "juicio": "una frase: qué cumplió y qué no"}.` }], []);
        const parsed = JSON.parse(j.texto.replace(/```json|```/g, "").trim());
        pJuez = Math.max(0, Math.min(1, Number(parsed.puntaje))); juicio = String(parsed.juicio || "");
      } catch { juicio = "(no se pudo juzgar)"; }
    }
    const partes = [pTools, pJuez].filter((x): x is number => x != null);
    const puntaje = error ? 0 : partes.length ? partes.reduce((a, b) => a + b, 0) / partes.length : (respuesta ? 1 : 0);
    resultados.push({ caso: caso.mensaje, respuesta: respuesta.slice(0, 1200), tools_usadas: tools, tools_esperadas: caso.tools_esperadas || [], puntaje: +puntaje.toFixed(2), juicio, error });
    // limpiar la conversación de evaluación
    await query(`DELETE FROM conversaciones WHERE id=$1`, [conv.id]).catch(() => {});
  }
  const despues = await gasto(ag.id, "hoy");
  const total = resultados.length ? resultados.reduce((a, r) => a + r.puntaje, 0) / resultados.length : 0;
  await query(`UPDATE evaluacion_corridas SET puntaje=$1, resultados=$2, costo_usd=$3, fin=now() WHERE id=$4`, [+total.toFixed(3), JSON.stringify(resultados), +(despues.total_usd - antes.total_usd).toFixed(4), corrida.id]);
  return { corridaId: corrida.id, puntaje: +total.toFixed(3), resultados };
}