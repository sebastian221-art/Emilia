import Groq from "groq-sdk";
import type { ChatCompletionMessageParam, ChatCompletionTool } from "groq-sdk/resources/chat/completions";

let cliente: Groq | null = null;
function get() {
  if (!cliente) cliente = new Groq({ apiKey: process.env.GROQ_API_KEY });
  return cliente;
}

export const MODELO_POR_DEFECTO = "openai/gpt-oss-120b";

export interface RespuestaModelo {
  texto: string;
  razonamiento?: string;
  toolCalls: { id: string; nombre: string; argumentos: Record<string, unknown> }[];
}

/** Una llamada al modelo, con o sin tools. Normaliza la respuesta a un formato propio. */
export async function llamarModelo(
  mensajes: ChatCompletionMessageParam[],
  tools: ChatCompletionTool[] = [],
  modelo = MODELO_POR_DEFECTO,
  forzarTool = false
): Promise<RespuestaModelo> {
  try {
    const resp = await get().chat.completions.create({
      model: modelo,
      temperature: 0.3,
      messages: mensajes,
      tools: tools.length ? tools : undefined,
      tool_choice: tools.length ? (forzarTool ? "required" : "auto") : undefined,
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
    };
  } catch (e: any) {
    // gpt-oss de Groq a veces "escupe" una tool call mal formada y Groq
    // rechaza con error 400 — PERO el error incluye lo que el modelo quería
    // hacer (failed_generation). Lo rescatamos en vez de perderlo.
    const msg = String(e?.error?.message || e?.message || "");

    // failed_generation puede venir en distintas capas del error del SDK. Lo buscamos en todas.
    let failedGen =
      e?.error?.failed_generation ||
      e?.error?.error?.failed_generation ||
      e?.failed_generation ||
      null;
    // Último recurso: extraerlo del texto del mensaje de error.
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
          // Devolvemos esta tool call como si el modelo la hubiera hecho bien.
          return {
            texto: "",
            razonamiento: undefined,
            toolCalls: [{ id: "rescatado_" + Date.now(), nombre: parsed.name, argumentos: parsed.arguments }],
          };
        }
      } catch { /* si no parsea, seguimos abajo */ }
    }

    // Caso 2: intentó llamar tool cuando no le dimos ninguna → reintentar solo texto.
    if (msg.includes("Tool choice is none") || msg.includes("tool_use_failed")) {
      try {
        const resp = await get().chat.completions.create({
          model: modelo,
          temperature: 0.3,
          messages: [...mensajes, { role: "system", content: "Respondé SOLO con texto plano. No intentes llamar ninguna herramienta." }],
        });
        const m = resp.choices[0]?.message;
        return { texto: (m?.content ?? "").trim(), razonamiento: (m as any)?.reasoning, toolCalls: [] };
      } catch { /* cae al throw */ }
    }
    throw e;
  }
}