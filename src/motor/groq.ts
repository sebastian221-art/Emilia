// ARCHIVO: src/motor/groq.ts
import Groq from "groq-sdk";
import type { ChatCompletionMessageParam, ChatCompletionTool } from "groq-sdk/resources/chat/completions";

let cliente: Groq | null = null;
function get() {
  if (!cliente) cliente = new Groq({ apiKey: process.env.GROQ_API_KEY });
  return cliente;
}

export const MODELO_POR_DEFECTO = "openai/gpt-oss-120b";
let avisoClaudeDado = false;

export interface RespuestaModelo {
  texto: string;
  razonamiento?: string;
  toolCalls: { id: string; nombre: string; argumentos: Record<string, unknown> }[];
  uso?: { entrada: number; salida: number; modelo: string; cacheLectura?: number; cacheEscritura?: number };
}

export interface OpcionesModelo {
  modelo?: string;
  temperatura?: number;
  forzarTool?: boolean;
}

/**
 * Una llamada al modelo, con o sin tools. Normaliza la respuesta.
 * Compatibilidad: el 3er parámetro puede ser el nombre del modelo (uso viejo)
 * o un objeto de opciones {modelo, temperatura, forzarTool}.
 */
export async function llamarModelo(
  mensajes: ChatCompletionMessageParam[],
  tools: ChatCompletionTool[] = [],
  modeloUOpciones: string | OpcionesModelo = MODELO_POR_DEFECTO,
  forzarToolLegado = false
): Promise<RespuestaModelo> {
  const op: OpcionesModelo = typeof modeloUOpciones === "string" ? { modelo: modeloUOpciones, forzarTool: forzarToolLegado } : modeloUOpciones;
  const modelo = op.modelo || MODELO_POR_DEFECTO;
  const temperature = clamp(op.temperatura ?? 0.3, 0, 1);

  // Proveedor por prefijo: "claude:sonnet" / "claude:haiku" / "anthropic:<id>" → API de Anthropic. Lo demás → Groq.
  // Sin ANTHROPIC_API_KEY (o con CLAUDE_API_ACTIVA=false) los modelos Claude caen al modelo de Groq por defecto: nada se rompe.
  if (/^(claude|anthropic):/i.test(modelo)) {
    const activa = !!process.env.ANTHROPIC_API_KEY && (process.env.CLAUDE_API_ACTIVA || "true").toLowerCase() !== "false";
    if (activa) {
      const { llamarClaude } = await import("./anthropic.js");
      return llamarClaude(mensajes, tools, { modelo, temperatura: temperature, forzarTool: op.forzarTool });
    }
    if (!avisoClaudeDado) { avisoClaudeDado = true; console.warn(`[modelos] ${modelo} pedido pero la API de Claude no está activa (falta ANTHROPIC_API_KEY o CLAUDE_API_ACTIVA=false): uso ${MODELO_POR_DEFECTO}.`); }
    return llamarModelo(mensajes, tools, { ...op, modelo: MODELO_POR_DEFECTO });
  }

  // La marca que separa system estable/dinámico es solo para el caché de Claude.
  mensajes = mensajes.map((m: any) => (m.role === "system" && typeof m.content === "string" && m.content.includes("<<<CONTEXTO_DINAMICO>>>") ? { ...m, content: m.content.replace(/\s*<<<CONTEXTO_DINAMICO>>>\s*/g, "\n\n") } : m));
  try {
    const resp = await get().chat.completions.create({
      model: modelo,
      temperature,
      messages: mensajes,
      tools: tools.length ? tools : undefined,
      tool_choice: tools.length ? (op.forzarTool ? "required" : "auto") : undefined,
    });
    const m = resp.choices[0]?.message;
    return {
      texto: (m?.content ?? "").trim(),
      razonamiento: (m as any)?.reasoning,
      toolCalls: (m?.tool_calls ?? []).map((t) => {
        let args: Record<string, unknown> = {};
        try { args = JSON.parse(t.function.arguments || "{}"); } catch {}
        return { id: t.id, nombre: t.function.name, argumentos: args };
      }),
      uso: { entrada: resp.usage?.prompt_tokens ?? 0, salida: resp.usage?.completion_tokens ?? 0, modelo },
    };
  } catch (e: any) {
    // gpt-oss de Groq a veces "escupe" una tool call mal formada y Groq la
    // rechaza con 400 — PERO el error incluye lo que el modelo quería hacer
    // (failed_generation). Lo rescatamos en vez de perderlo.
    const msg = [e?.message, e?.error?.message, e?.error?.code, e?.code, e?.error?.error?.code].filter(Boolean).join(" | ");
    let failedGen = e?.error?.failed_generation || e?.error?.error?.failed_generation || e?.failed_generation || null;
    if (!failedGen) {
      try {
        const jsonEnMsg = String(e?.message || "").match(/\{[\s\S]*\}/)?.[0];
        if (jsonEnMsg) failedGen = JSON.parse(jsonEnMsg)?.error?.failed_generation || null;
      } catch { /* nada */ }
    }
    if (failedGen && (msg.includes("tool_use_failed") || msg.includes("Tool choice is none"))) {
      try {
        const parsed = JSON.parse(failedGen);
        if (parsed?.name && parsed?.arguments) {
          return { texto: "", razonamiento: undefined, toolCalls: [{ id: "rescatado_" + Date.now(), nombre: parsed.name, argumentos: parsed.arguments }] };
        }
      } catch { /* si no parsea, seguimos abajo */ }
      // El JSON de la llamada salió roto (suele pasar con argumentos largos y anidados): un reintento con
      // la instrucción de repetir la llamada con argumentos más cortos y JSON válido.
      const nombreTool = String(failedGen).match(/"name"\s*:\s*"([^"]+)"/)?.[1];
      try {
        const resp = await get().chat.completions.create({
          model: modelo, temperature,
          messages: [...mensajes, { role: "system", content: `Tu última llamada${nombreTool ? ` a ${nombreTool}` : ""} salió con argumentos que NO eran JSON válido (quedaron cortados). Repetila ahora con JSON válido y argumentos MÁS CORTOS: textos de 1-2 líneas por campo, sin comillas dobles dentro de los textos (usá comillas simples), sin campos vacíos ni null. Si no entra en una llamada, hacé primero una versión breve y completá después.` }],
          tools: tools.length ? tools : undefined,
          tool_choice: tools.length ? "auto" : undefined,
        });
        const m = resp.choices[0]?.message;
        return {
          texto: (m?.content ?? "").trim(), razonamiento: (m as any)?.reasoning,
          toolCalls: (m?.tool_calls ?? []).map((t) => { let args: Record<string, unknown> = {}; try { args = JSON.parse(t.function.arguments || "{}"); } catch {} return { id: t.id, nombre: t.function.name, argumentos: args }; }),
        };
      } catch { /* cae a los rescates de abajo */ }
    }
    // El modelo escribió texto suelto donde iba una tool call (output_parse_failed) → reintentar
    // una vez con un empujón; si vuelve a fallar, cae al reintento solo texto.
    if (msg.includes("output_parse_failed") || msg.includes("Parsing failed") || msg.includes("could not be parsed")) {
      try {
        const resp = await get().chat.completions.create({
          model: modelo, temperature,
          messages: [...mensajes, { role: "system", content: "Tu salida anterior no se pudo interpretar. Respondé de una de dos formas: o llamás una herramienta con sus argumentos en JSON válido, o escribís tu respuesta final en texto. No mezcles razonamiento suelto con llamadas." }],
          tools: tools.length ? tools : undefined,
          tool_choice: tools.length ? "auto" : undefined,
        });
        const m = resp.choices[0]?.message;
        return {
          texto: (m?.content ?? "").trim(), razonamiento: (m as any)?.reasoning,
          toolCalls: (m?.tool_calls ?? []).map((t) => { let args: Record<string, unknown> = {}; try { args = JSON.parse(t.function.arguments || "{}"); } catch {} return { id: t.id, nombre: t.function.name, argumentos: args }; }),
        };
      } catch { /* cae al siguiente rescate */ }
    }
    // Intentó llamar tool cuando no le dimos ninguna → reintentar solo texto.
    if (msg.includes("Tool choice is none") || msg.includes("tool_use_failed") || msg.includes("output_parse_failed") || msg.includes("Parsing failed")) {
      try {
        const resp = await get().chat.completions.create({
          model: modelo, temperature,
          messages: [...mensajes, { role: "system", content: "Respondé SOLO con texto plano. No intentes llamar ninguna herramienta." }],
        });
        const m = resp.choices[0]?.message;
        return { texto: (m?.content ?? "").trim(), razonamiento: (m as any)?.reasoning, toolCalls: [] };
      } catch { /* cae al throw */ }
    }
    throw e;
  }
}

function clamp(n: number, a: number, b: number) { return Number.isFinite(n) ? Math.min(b, Math.max(a, n)) : 0.3; }