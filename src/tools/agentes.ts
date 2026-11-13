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
    const jefeNum = (process.env.WHATSAPP_NUMERO_JEFE || "").replace(/\D/g, "");
    const [convPadre] = await query<any>(`SELECT canal FROM conversaciones WHERE id=$1`, [ctx.conversacionId]).catch(() => [] as any);
    const porWhatsapp = convPadre?.canal === "whatsapp";
    const contextoCanal = `Te delegó esta tarea el agente ${padre?.nombre || "otro agente"} en nombre de Sebastián (el jefe)${jefeNum ? `, cuyo WhatsApp es ${jefeNum} (usalo cuando haya que mandarle algo: no se lo preguntes)` : ""}. Tu respuesta final le llega a Sebastián por ${porWhatsapp ? "WhatsApp" : "el panel"}: escribí para él, claro y completo.${porWhatsapp ? " FORMATO WHATSAPP: sin tablas, sin encabezados con #, sin bloques de código; solo *negrita*, _cursiva_ y listas con guiones; máximo ~15 líneas (si hay más, resumí y ofrecé el detalle)." : ""} Si necesitás aprobación para algo, pedila: el sistema se la muestra a él.`;

    // El pedido LITERAL del jefe viaja junto con la tarea: así el trabajador no hereda un recorte del administrador.
    const [ultimoJefe] = await query<{ contenido: string }>(`SELECT contenido FROM mensajes WHERE conversacion_id=$1 AND rol='usuario' ORDER BY creado_en DESC LIMIT 1`, [ctx.conversacionId]).catch(() => [] as any);
    const literal = ultimoJefe?.contenido && ultimoJefe.contenido.trim() !== a.tarea.trim() ? `\n\nPEDIDO LITERAL DEL JEFE (manda sobre cualquier resumen): "${ultimoJefe.contenido.slice(0, 1200)}"` : "";
    const tareaCompleta = `${a.tarea}${literal}`;
    // Encargo: queda registrado (para "¿en qué quedó lo de…?", demoras y reintentos).
    const { registrarEncargo, cerrarEncargo, refEncargo } = await import("../motor/administradora.js");
    const encargoId = await registrarEncargo({ agente: ag.nombre, tarea: tareaCompleta, convPadre: ctx.conversacionId, convDelegacion: conv.id }).catch(() => null);
    const trabajo = async () => {
      await guardarMensajeEn(conv, "usuario", tareaCompleta);
      let r: any;
      try { r = await correrTarea(ag.id, tareaCompleta, { conversacionId: conv.id, origen: "api", contextoCanal }); }
      catch (e: any) { if (encargoId) await cerrarEncargo(encargoId, { estado: "fallida", respuesta: `Error: ${e?.message || e}` }); throw e; }
      if (encargoId) await cerrarEncargo(encargoId, r).catch(() => {});
      await entregarRespuesta(conv, r);   // → reenvía a la conversación padre
      return r;
    };

    if (a.esperar) {
      const r = await encolar(conv.id, trabajo);
      return { ok: r.ok, datos: { agente: ag.nombre, estado: r.estado, respuesta: r.respuesta, ejecucionId: r.ejecucionId }, resumen: `${ag.nombre} respondió (${r.estado}):\n${r.respuesta}`, error: r.ok ? undefined : r.respuesta };
    }
    encolar(conv.id, trabajo).catch((e) => console.error(`[delegar] ${ag.nombre} falló:`, e?.message || e));
    await ctx.traza("tool", `delegado a ${ag.nombre}: ${a.tarea.slice(0, 120)}`);
    return { ok: true, datos: { agente: ag.nombre, estado: "en_curso", encargo: encargoId ? refEncargo(encargoId) : null }, resumen: `Tarea entregada a ${ag.nombre}${encargoId ? ` (${refEncargo(encargoId)})` : ""}. Trabaja en segundo plano; su respuesta llegará a esta conversación cuando termine. Dile al jefe que ya está en manos de ${ag.nombre} y que le avisas.` };
  },
};

export const agentePendientes: DefTool = {
  nombre: "agente_pendientes", modulo: MODULO,
  descripcion: "Lo que el equipo tiene entre manos: encargos en curso, esperando OK del jefe, y lo terminado o fallido en las últimas 24 h; y las misiones abiertas. Para '¿en qué quedó lo de…?', '¿qué tengo abierto?', '¿cómo va lo que le pedí a Sage?'.",
  parametros: { type: "object", properties: { agente: { type: "string" } } },
  riesgo: "lectura", requiereAprobacion: false, timeoutSeg: 15,
  async ejecutar(a) {
    const A = await import("../motor/administradora.js");
    await A.sincronizarEncargos();
    const es = (await A.encargosAbiertos()).filter((e) => !a.agente || e.agente.toLowerCase() === String(a.agente).toLowerCase());
    const ms = await A.misionesAbiertas();
    return { ok: true, datos: { encargos: es, misiones: ms }, resumen: [...ms.map(A.lineaMision), ...es.map(A.lineaEncargo)].join("\n") || "No hay nada pendiente con el equipo." };
  },
};

export const agenteReintentar: DefTool = {
  nombre: "agente_reintentar", modulo: MODULO,
  descripcion: "Vuelve a lanzar un encargo que falló (E-xxxx), con el mismo agente u otro.",
  parametros: { type: "object", properties: { ref: { type: "string", minLength: 3 }, agente: { type: "string", description: "Otro agente, si conviene." } }, required: ["ref"] },
  riesgo: "ejecucion", requiereAprobacion: false, timeoutSeg: 30,
  async ejecutar(a) { try { const A = await import("../motor/administradora.js"); return { ok: true, resumen: await A.reintentarEncargo(a.ref, false, a.agente) }; } catch (e: any) { return { ok: false, error: e?.message || String(e) }; } },
};

export const agenteMision: DefTool = {
  nombre: "agente_mision", modulo: MODULO,
  descripcion: "Para pedidos que necesitan VARIOS agentes en orden (p. ej. 'averigua X y mándaselo a Juan', 'arregla Y, despliégalo y avísame si queda bien'): defines los pasos (agente + tarea concreta + de qué pasos depende). El sistema lanza cada paso cuando sus dependencias terminan, le pasa los resultados anteriores, reintenta una vez si algo falla, y al final le llega al jefe UNA respuesta consolidada. Lo que pida aprobación le llega como siempre. Para un solo agente usa agente_delegar.",
  parametros: { type: "object", properties: {
    objetivo: { type: "string", minLength: 5 },
    pasos: { type: "array", items: { type: "object", properties: { agente: { type: "string" }, tarea: { type: "string", description: "Completa y concreta: el agente no ve esta conversación." }, depende_de: { type: "array", items: { type: "integer" }, description: "Números de los pasos que deben terminar antes (1 = el primero)." } }, required: ["agente", "tarea"] } },
  }, required: ["objetivo", "pasos"] },
  riesgo: "ejecucion", requiereAprobacion: false, timeoutSeg: 60,
  async ejecutar(a, ctx) {
    try {
      const A = await import("../motor/administradora.js");
      const m = await A.crearMision({ objetivo: a.objetivo, pasos: a.pasos, convPadre: ctx?.conversacionId ?? null });
      return { ok: true, datos: m, resumen: `🧭 Misión ${m.ref} en marcha (${a.pasos.length} pasos: ${a.pasos.map((p: any, i: number) => `${i + 1}. ${p.agente}`).join(", ")}). Dile al jefe que le avisas cuando esté todo.` };
    } catch (e: any) { return { ok: false, error: e?.message || String(e) }; }
  },
};

export const agenteMisionEstado: DefTool = {
  nombre: "agente_mision_estado", modulo: MODULO,
  descripcion: "Cómo va una misión (M-xxxx) o todas las abiertas: cada paso con su estado y lo que resultó. 'cancelar' la detiene.",
  parametros: { type: "object", properties: { ref: { type: "string" }, cancelar: { type: "boolean" } } },
  riesgo: "escritura", requiereAprobacion: false, timeoutSeg: 15,
  async ejecutar(a) {
    const A = await import("../motor/administradora.js");
    const { query } = await import("../db/cliente.js");
    if (a.ref && a.cancelar) { const r = await query(`UPDATE misiones SET estado = 'cancelada', actualizado_en = now() WHERE id::text LIKE $1 || '%' AND estado IN ('en_curso','atascada') RETURNING id`, [String(a.ref).replace(/^m-/i, "")]); return r.length ? { ok: true, resumen: `🚫 Misión ${a.ref} cancelada (lo que ya estaba corriendo termina su paso).` } : { ok: false, error: "No encuentro esa misión abierta." }; }
    const ms = a.ref ? await query<any>(`SELECT * FROM misiones WHERE id::text LIKE $1 || '%'`, [String(a.ref).replace(/^m-/i, "")]) : await A.misionesAbiertas();
    if (!ms.length) return { ok: true, resumen: "No hay misiones." };
    return { ok: true, datos: ms, resumen: ms.map((m: any) => `${A.lineaMision(m)}${a.ref ? `\n${(m.pasos || []).filter((p: any) => p.resultado).map((p: any) => `   → ${p.n}: ${String(p.resultado).slice(0, 300)}`).join("\n")}` : ""}${m.final ? `\n${m.final.slice(0, 600)}` : ""}`).join("\n\n") };
  },
};

export const agenteResumenes: DefTool = {
  nombre: "agente_resumenes", modulo: MODULO,
  descripcion: "Una sola voz: configura qué avisos no urgentes del equipo se juntan en un resumen de Emilia y a qué horas (lo crítico y lo que espera respuesta siempre llega al instante). Sin parámetros, muestra la configuración.",
  parametros: { type: "object", properties: { activo: { type: "boolean" }, horas: { type: "array", items: { type: "string" }, description: "['12:30','18:30']" }, origenes: { type: "array", items: { type: "string" }, description: "Orígenes que van al resumen: system (informes de System), radar (novedades de Soga), sueno (informes del cerebro), evaluacion, vigilancia, any…" }, ahora: { type: "boolean", description: "Mandar ya lo acumulado." } } },
  riesgo: "escritura", requiereAprobacion: false, timeoutSeg: 60,
  async ejecutar(a) {
    const A = await import("../motor/administradora.js");
    if (a.horas && !a.horas.every((h: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(h))) return { ok: false, error: "Horas como HH:MM." };
    if (a.activo !== undefined || a.horas || a.origenes) { const { guardarConfigIris } = await import("../motor/avisos.js"); const c = await A.configVoz(); await guardarConfigIris({ voz_unica: { ...c, ...(a.activo !== undefined ? { activo: a.activo } : {}), ...(a.horas ? { horas: a.horas } : {}), ...(a.origenes ? { origenes: a.origenes.map((x: string) => x.toLowerCase()) } : {}) } } as any); }
    if (a.ahora) { const t = await A.resumenEquipoSiToca(true); if (!t) return { ok: true, resumen: "No hay nada acumulado." }; }
    const c = await A.configVoz();
    return { ok: true, datos: c, resumen: c.activo ? `📬 Resumen del equipo a las ${c.horas.join(" y ")} con lo no urgente de: ${c.origenes.join(", ")}. Lo crítico llega al instante.` : "Una sola voz apagada: cada agente avisa al instante." };
  },
};

export const toolsAgentes: DefTool[] = [agenteListar, agenteDelegar, agentePendientes, agenteReintentar, agenteMision, agenteMisionEstado, agenteResumenes];