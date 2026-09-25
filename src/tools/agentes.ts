// ARCHIVO: src/tools/agentes.ts
// ─────────────────────────────────────────────────────────────────────────────
//  TOOLS DE AGENTES — cooperación entre agentes
//  Un agente puede listar a los demás y DELEGARLES una tarea. El sub-agente
//  trabaja con sus propias tools/skills/memoria, en su conversación de
//  delegación, y su respuesta final llega a quien delegó por su propio canal
//  (si el jefe pidió por WhatsApp, le llega por WhatsApp). Las aprobaciones
//  que pida el sub-agente las resuelve el jefe igual que siempre ("ok"/"no").
// ─────────────────────────────────────────────────────────────────────────────

import type { DefTool } from "../registro/tipos.js";
import { query } from "../db/cliente.js";
import { obtenerOCrearConversacion, guardarMensajeEn } from "../dominio/conversaciones.js";
import { correrTarea } from "../motor/loop.js";
import { entregarRespuesta } from "../motor/entrega.js";
import { encolar } from "../motor/cola.js";

const MODULO = "agente";

async function agentePorNombre(nombre: string) {
  const [a] = await query<any>(`SELECT id, nombre, tipo, estado, identidad FROM agentes WHERE lower(nombre) = lower($1) OR id::text = $1 LIMIT 1`, [nombre.trim()]);
  return a;
}

export const agenteListar: DefTool = {
  nombre: "agente_listar", modulo: MODULO,
  descripcion: "Lista los agentes del sistema con su nombre, misión y estado. Útil para saber a quién delegar.",
  parametros: { type: "object", properties: {}, required: [] }, riesgo: "lectura", requiereAprobacion: false,
  async ejecutar(_a, ctx) {
    const filas = await query<any>(`SELECT id, nombre, tipo, estado, identidad->>'mision' AS mision FROM agentes ORDER BY creado_en`);
    const lista = filas.filter((f) => f.id !== ctx.agenteId).map((f) => ({ nombre: f.nombre, tipo: f.tipo, estado: f.estado, mision: f.mision }));
    return { ok: true, datos: lista, resumen: lista.length ? lista.map((a) => `${a.nombre} (${a.estado}): ${(a.mision || "").slice(0, 100)}`).join("\n") : "No hay otros agentes." };
  },
};

export const agenteDelegar: DefTool = {
  nombre: "agente_delegar", modulo: MODULO,
  descripcion: "Le encarga una tarea a otro agente (por nombre). Con esperar=false (por defecto) el otro agente trabaja en segundo plano y su respuesta llega a esta misma conversación cuando termine; respondé enseguida que se lo pasaste. Con esperar=true bloquea hasta tener su respuesta (solo para cosas cortas).",
  parametros: {
    type: "object",
    properties: {
      agente: { type: "string", description: "Nombre del agente al que delegar (agente_listar).", minLength: 2 },
      tarea: { type: "string", description: "La tarea completa, con todo el contexto que el otro agente necesita (proyecto, qué, criterios). Él no ve esta conversación.", minLength: 5 },
      esperar: { type: "boolean", description: "Esperar la respuesta.", default: false },
    },
    required: ["agente", "tarea"],
  },
  riesgo: "ejecucion", requiereAprobacion: false, timeoutSeg: 7200,
  async ejecutar(a, ctx) {
    const ag = await agentePorNombre(a.agente);
    if (!ag) return { ok: false, error: `No existe un agente llamado "${a.agente}". Usá agente_listar.` };
    if (ag.id === ctx.agenteId) return { ok: false, error: "No podés delegarte a vos mismo." };
    if (ag.estado !== "activo") return { ok: false, error: `${ag.nombre} está ${ag.estado}; activalo primero.` };
    if (!ctx.conversacionId) return { ok: false, error: "Delegar requiere una conversación (panel o WhatsApp) para devolver la respuesta." };

    // Conversación de delegación del sub-agente, ligada a la conversación padre.
    const conv = await obtenerOCrearConversacion(ag.id, "delegacion", ctx.conversacionId);
    const [padre] = await query<any>(`SELECT a.nombre FROM conversaciones c JOIN agentes a ON a.id=c.agente_id WHERE c.id=$1`, [ctx.conversacionId]);
    const contextoCanal = `Te delegó esta tarea el agente ${padre?.nombre || "otro agente"} en nombre de Sebastián (el jefe). Tu respuesta final le llega a Sebastián por su canal: escribí para él, claro y completo. Si necesitás aprobación para algo, pedila: el sistema se la muestra a él.`;

    const trabajo = async () => {
      await guardarMensajeEn(conv, "usuario", a.tarea);
      const r = await correrTarea(ag.id, a.tarea, { conversacionId: conv.id, origen: "api", contextoCanal });
      await entregarRespuesta(conv, r);   // → reenvía a la conversación padre
      return r;
    };

    if (a.esperar) {
      const r = await encolar(conv.id, trabajo);
      return { ok: r.ok, datos: { agente: ag.nombre, estado: r.estado, respuesta: r.respuesta, ejecucionId: r.ejecucionId }, resumen: `${ag.nombre} respondió (${r.estado}):\n${r.respuesta}`, error: r.ok ? undefined : r.respuesta };
    }
    encolar(conv.id, trabajo).catch((e) => console.error(`[delegar] ${ag.nombre} falló:`, e?.message || e));
    await ctx.traza("tool", `delegado a ${ag.nombre}: ${a.tarea.slice(0, 120)}`);
    return { ok: true, datos: { agente: ag.nombre, estado: "en_curso" }, resumen: `Tarea entregada a ${ag.nombre}. Trabaja en segundo plano; su respuesta llegará a esta conversación cuando termine. Decile al jefe que ya está en manos de ${ag.nombre} y que le avisás.` };
  },
};

export const toolsAgentes: DefTool[] = [agenteListar, agenteDelegar];