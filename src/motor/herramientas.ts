// ARCHIVO: src/motor/herramientas.ts
// ─────────────────────────────────────────────────────────────────────────────
//  HERRAMIENTAS DEL AGENTE
//  Convierte lo que el agente tiene asignado (tools + skills, por id en su
//  esqueleto) en la lista de funciones que se le entrega al modelo, con el
//  schema real de cada una. También devuelve un mapa para que el loop sepa,
//  al recibir una tool call, qué es (tool/skill), si requiere aprobación y
//  cómo ejecutarla.
// ─────────────────────────────────────────────────────────────────────────────

import type { ChatCompletionTool } from "groq-sdk/resources/chat/completions";
import { registro } from "../registro/registro.js";
import type { EsquemaJson, NivelRiesgo } from "../registro/tipos.js";
import { skillsDeAgente, toolsDeAgente, flujosDeAgente } from "../dominio/agentes.js";

export interface Invocable {
  nombre: string;
  tipo: "tool" | "skill" | "flujo";
  origen: "codigo" | "ui";
  riesgo: NivelRiesgo;
  requiereAprobacion: boolean;
  descripcion: string;
  parametros: EsquemaJson;
  /** Fila de la base (solo para origen ui, que el ejecutor legado necesita). */
  fila?: any;
}

export async function herramientasDeAgente(agenteId: string): Promise<{ definiciones: ChatCompletionTool[]; invocables: Map<string, Invocable> }> {
  const invocables = new Map<string, Invocable>();

  // ── Tools asignadas directamente ──
  for (const fila of await toolsDeAgente(agenteId)) {
    if (fila.activo === false) continue;
    const def = registro.tool(fila.nombre);
    if (def) {
      invocables.set(def.nombre, {
        nombre: def.nombre, tipo: "tool", origen: "codigo", riesgo: def.riesgo,
        requiereAprobacion: !!def.requiereAprobacion, descripcion: def.descripcion, parametros: def.parametros,
      });
    }
    // Tools de la UI vieja: ya no se ofrecen al modelo (no hay ejecutor para ellas).
  }

  // ── Skills asignadas ──
  for (const fila of await skillsDeAgente(agenteId)) {
    if (fila.activo === false) continue;
    const def = registro.skill(fila.nombre);
    if (def) {
      invocables.set(def.nombre, {
        nombre: def.nombre, tipo: "skill", origen: "codigo", riesgo: def.riesgo,
        requiereAprobacion: !!def.requiereAprobacion,
        descripcion: def.cuandoUsar ? `${def.descripcion} Cuándo usarla: ${def.cuandoUsar}` : def.descripcion,
        parametros: def.parametros,
      });
    } else if (fila.origen === "ui" || !fila.origen) {
      // Skill guiada creada en la página Skills: se ofrece con una entrada libre.
      const sec = fila.secciones || {};
      invocables.set(fila.nombre, {
        nombre: fila.nombre, tipo: "skill", origen: "ui",
        riesgo: (fila.nivel_riesgo || "lectura") as NivelRiesgo,
        requiereAprobacion: !!sec.riesgo?.aprobacion,
        descripcion: `${fila.descripcion || fila.nombre}${sec.identidad?.cuando_usar ? ` Cuándo usarla: ${sec.identidad.cuando_usar}` : ""}`,
        parametros: { type: "object", properties: { pedido: { type: "string", description: sec.io?.entradas ? `Datos para la skill: ${sec.io.entradas}` : "Qué querés que haga, con los datos necesarios." } }, required: ["pedido"] },
        fila,
      });
    }
  }

  // ── Flujos asignados: el agente los dispara como una función más ──
  for (const fila of await flujosDeAgente(agenteId)) {
    const def = registro.flujo(fila.nombre);
    if (!def) continue;
    invocables.set(def.nombre, {
      nombre: def.nombre, tipo: "flujo", origen: "codigo", riesgo: def.riesgo, requiereAprobacion: false,
      descripcion: `FLUJO: ${def.descripcion} Al llamarlo arranca en segundo plano y te avisa por la conversación cuando termina o necesita aprobación.`,
      parametros: def.parametros,
    });
  }

  const definiciones: ChatCompletionTool[] = [...invocables.values()].map((i) => ({
    type: "function",
    function: {
      name: i.nombre,
      description: `${i.descripcion} (riesgo: ${i.riesgo}${i.requiereAprobacion ? ", requiere aprobación" : ""})`,
      parameters: i.parametros as any,
    },
  }));

  return { definiciones, invocables };
}