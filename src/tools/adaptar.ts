// ARCHIVO: src/tools/adaptar.ts
// ─────────────────────────────────────────────────────────────────────────────
//  ADAPTACIÓN (System): tablero de salud, señales, gemelos en el laboratorio y
//  cambios con niveles (1 solo y reversible · 2 con OK · 3 con OK + Sage).
// ─────────────────────────────────────────────────────────────────────────────
import type { DefTool } from "../registro/tipos.js";
import * as E from "../motor/evolucion.js";

const MODULO = "adaptar";

export const adaptarTablero: DefTool = {
  nombre: "adaptar_tablero", modulo: MODULO,
  descripcion: "El tablero de salud del equipo: por agente, tareas, % bien, problemas (fallas + correcciones del jefe + aprobaciones rechazadas), tiempo y costo, últimos 7 días contra los 7 anteriores. Opcional: un agente.",
  parametros: { type: "object", properties: { agente: { type: "string" }, recalcular: { type: "boolean", description: "Recalcular las métricas antes (tarda unos segundos)." } } },
  riesgo: "lectura", requiereAprobacion: false, timeoutSeg: 60,
  async ejecutar(a) { if (a.recalcular) await E.ponerAlDiaMetricas(); return { ok: true, resumen: await E.tablero(a.agente) }; },
};

export const adaptarSenales: DefTool = {
  nombre: "adaptar_senales", modulo: MODULO,
  descripcion: "Las señales de los sensores (lento, flojo, caro, error repetido, desactualizado, repetitivo, corrección, evolución) con su evidencia. 'detectar' corre los sensores ahora; 'marcar' cambia el estado de una (investigando, resuelta, descartada).",
  parametros: { type: "object", properties: { accion: { type: "string", enum: ["listar", "detectar", "marcar"], default: "listar" }, id: { type: "string" }, estado: { type: "string", enum: ["investigando", "resuelta", "descartada"] } } },
  riesgo: "escritura", requiereAprobacion: false, timeoutSeg: 120,
  async ejecutar(a) {
    if (a.accion === "marcar") { if (!a.id || !a.estado) return { ok: false, error: "Necesito id y estado." }; await E.marcarSenal(a.id, a.estado); return { ok: true, resumen: `Señal ${a.id} → ${a.estado}.` }; }
    let nuevas = 0;
    if (a.accion === "detectar") { await E.ponerAlDiaMetricas(); nuevas = await E.detectarSenales() + await E.minarCorrecciones(7).catch(() => 0); }
    const xs = await E.senalesAbiertas(12);
    return { ok: true, datos: xs, resumen: `${a.accion === "detectar" ? `${nuevas} señal(es) nueva(s).\n` : ""}${xs.length ? xs.map((s) => `[S-${s.id.slice(0, 6)}] (p${s.prioridad}, ${s.tipo}${s.agente ? `, ${s.agente}` : ""}) ${s.titulo}${s.detalle ? `\n   ${s.detalle}` : ""}\n   evidencia: ${JSON.stringify(s.evidencia).slice(0, 500)}`).join("\n") : "Sin señales abiertas: el equipo está sano."}` };
  },
};

export const adaptarGemelo: DefTool = {
  nombre: "adaptar_gemelo", modulo: MODULO,
  descripcion: "Laboratorio: crea un gemelo de un agente con cambios en su configuración (p. ej. {\"cerebro.ejecutor\": \"openai/gpt-oss-20b\"} o {\"identidad.ejemplos\": \"nuevo ejemplo…\"} o {\"identidad.reglas_duras\": \"…\"}) y lo compara con el agente actual en los MISMOS casos reales con un juez. Devuelve puntajes, segundos por caso y el veredicto (mejor/igual/peor). Úsalo SIEMPRE antes de proponer un cambio de agente.",
  parametros: { type: "object", properties: {
    agente: { type: "string", minLength: 2 }, cambios: { type: "object", description: "{ ruta: valor } en la configuración del agente." },
    criterio: { type: "string", description: "Qué mide el juez (por defecto: correcto, claro, en su tono, sin inventar)." }, max: { type: "integer", minimum: 3, maximum: 12 },
  }, required: ["agente", "cambios"] },
  riesgo: "lectura", requiereAprobacion: false, timeoutSeg: 900,
  async ejecutar(a) {
    try {
      const { probarGemelo, textoGemelo } = await import("../motor/laboratorio-system.js");
      const r = await probarGemelo({ agente: a.agente, cambios: a.cambios || {}, criterio: a.criterio, max: a.max });
      return { ok: true, datos: r, resumen: `${textoGemelo(r)}\n${r.detalle.map((d) => `- ${d.entrada}: ${d.actual} → ${d.gemelo}${d.motivo ? ` (${d.motivo})` : ""}`).join("\n")}\n${r.nota}` };
    } catch (e: any) { return { ok: false, error: e?.message || String(e) }; }
  },
};

export const adaptarProponer: DefTool = {
  nombre: "adaptar_proponer", modulo: MODULO,
  descripcion: "Propone (o aplica, si es nivel 1) un cambio para adaptar el sistema. El sistema decide el nivel mínimo: nivel 1 (se aplica solo y se revierte si empeora) solo para modelo (cerebro.ejecutor/planificador/modelo_rapido), cerebro.turnos, cerebro.temperatura, memoria.ventana y AGREGAR ejemplos (identidad.ejemplos); reglas, identidad, gobierno → nivel 2 (OK del jefe); código o herramientas (sin ruta) → nivel 3 (OK + Sage). Siempre con evidencia en números (gemelo, laboratorio, tablero).",
  parametros: { type: "object", properties: {
    titulo: { type: "string", minLength: 5 }, motivo: { type: "string", minLength: 10 }, evidencia: { type: "string", description: "Los números: gemelo actual 71 vs. nuevo 84 en 8 casos reales; tablero; etc." },
    tipo: { type: "string", enum: ["modelo", "ejemplo", "config", "regla", "identidad", "herramienta", "codigo"] },
    agente: { type: "string" }, ruta: { type: "string" }, valor: { description: "El valor nuevo (texto, número u objeto)." },
    nivel: { type: "integer", minimum: 1, maximum: 3, description: "Solo para subirlo (nunca baja del mínimo)." }, senal_id: { type: "string" },
  }, required: ["titulo", "motivo", "tipo"] },
  riesgo: "escritura", requiereAprobacion: false, timeoutSeg: 120,
  async ejecutar(a) {
    try {
      let senalId: string | null = null;
      if (a.senal_id) { const { query } = await import("../db/cliente.js"); const [s] = await query<any>(`SELECT id FROM sys_senales WHERE id::text LIKE $1 || '%'`, [String(a.senal_id).replace(/^s-/i, "")]); senalId = s?.id ?? null; }
      const r = await E.proponerCambio({ titulo: a.titulo, motivo: a.motivo, evidencia: a.evidencia, tipo: a.tipo, agente: a.agente, ruta: a.ruta, despues: a.valor, nivel: a.nivel, senalId });
      return { ok: r.estado !== "fallido", datos: r, resumen: r.mensaje, ...(r.estado === "fallido" ? { error: r.mensaje } : {}) };
    } catch (e: any) { return { ok: false, error: e?.message || String(e) }; }
  },
};

export const adaptarCambios: DefTool = {
  nombre: "adaptar_cambios", modulo: MODULO,
  descripcion: "Los cambios de adaptación (propuestos, aplicados midiéndose, confirmados, revertidos, rechazados) con su resultado medido.",
  parametros: { type: "object", properties: { estado: { type: "string", enum: ["propuesto", "aplicado", "confirmado", "revertido", "rechazado", "en_sage"] } } },
  riesgo: "lectura", requiereAprobacion: false, timeoutSeg: 15,
  async ejecutar(a) {
    const xs = await E.listarCambios(a.estado ? [a.estado] : undefined);
    return { ok: true, datos: xs, resumen: xs.length ? xs.map((c) => `${E.refCambio(c.id)} [${c.estado}, nivel ${c.nivel}] ${c.titulo}${c.agente ? ` (${c.agente})` : ""}${c.medir_hasta && c.estado === "aplicado" ? ` · se mide hasta ${new Date(c.medir_hasta).toLocaleDateString("es-CO")}` : ""}${c.resultado?.resumen ? `\n   ${c.resultado.resumen}` : ""}`).join("\n") : "No hay cambios." };
  },
};

export const adaptarRevertir: DefTool = {
  nombre: "adaptar_revertir", modulo: MODULO,
  descripcion: "Devuelve un cambio aplicado a como estaba (C-xxxx). Los de nivel 1 se revierten solos; los de nivel 2 piden el OK del jefe.",
  parametros: { type: "object", properties: { ref: { type: "string", minLength: 4 }, motivo: { type: "string" } }, required: ["ref"] },
  riesgo: "escritura", requiereAprobacion: true, timeoutSeg: 30,
  async necesitaAprobacion(a) { const c = await E.cambioPorRef(a.ref); return !!c && c.nivel > 1; },
  async ejecutar(a) { const c = await E.cambioPorRef(a.ref); if (!c) return { ok: false, error: "No existe ese cambio." }; const r = await E.revertirCambio(c.id, a.motivo || "System"); return r.ok ? { ok: true, resumen: r.mensaje } : { ok: false, error: r.error }; },
};

export const adaptarInventario: DefTool = {
  nombre: "adaptar_inventario", modulo: MODULO,
  descripcion: "Qué usa hoy el sistema (modelos por agente, voz, memoria, búsqueda, PC, código, integraciones): la base para saber qué podría evolucionar. 'evolucion' además cruza el radar de Soga de los últimos días con el inventario y levanta señales de evolución.",
  parametros: { type: "object", properties: { evolucion: { type: "boolean" }, dias: { type: "integer", minimum: 1, maximum: 30 } } },
  riesgo: "lectura", requiereAprobacion: false, timeoutSeg: 180,
  async ejecutar(a) { const inv = await E.inventario(); const n = a.evolucion ? await E.evolucionDesdeRadar(a.dias || 7) : 0; return { ok: true, resumen: `${inv}${a.evolucion ? `\n\n${n} candidato(s) nuevo(s) de evolución (adaptar_senales).` : ""}` }; },
};

export const toolsAdaptar: DefTool[] = [adaptarTablero, adaptarSenales, adaptarGemelo, adaptarProponer, adaptarCambios, adaptarRevertir, adaptarInventario];
