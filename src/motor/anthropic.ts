// ARCHIVO: src/motor/anthropic.ts
// ─────────────────────────────────────────────────────────────────────────────
//  ADAPTADOR CLAUDE (API de Anthropic) con la MISMA interfaz que Groq.
//  Recibe mensajes y tools en formato OpenAI (lo que usa todo el motor) y los
//  traduce a la Messages API: system aparte, tool_calls → tool_use,
//  mensajes "tool" → tool_result. Caché de prompt en el system y en las tools
//  (son idénticos turno a turno: cada lectura de caché cuesta 10% del precio).
//  Modelos por alias: claude:sonnet, claude:haiku (ids configurables por .env).
// ─────────────────────────────────────────────────────────────────────────────
import Anthropic from "@anthropic-ai/sdk";
import type { ChatCompletionMessageParam, ChatCompletionTool } from "groq-sdk/resources/chat/completions";
import type { RespuestaModelo } from "./groq.js";

let cliente: Anthropic | null = null;
function get() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("Falta ANTHROPIC_API_KEY en .env para usar modelos Claude.");
  // Las claves de usuario (sk-ant-usr…) no están atadas a un workspace: Anthropic exige el header anthropic-workspace-id.
  // Alternativa: crear la clave DENTRO de un workspace (console → Workspaces → API Keys) y no hace falta el header.
  if (!cliente) cliente = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, defaultHeaders: process.env.ANTHROPIC_WORKSPACE_ID ? { "anthropic-workspace-id": process.env.ANTHROPIC_WORKSPACE_ID } : undefined });
  return cliente;
}

export const ALIAS_CLAUDE: Record<string, () => string> = {
  sonnet: () => process.env.CLAUDE_SONNET_ID || "claude-sonnet-5-5",
  haiku: () => process.env.CLAUDE_HAIKU_ID || "claude-haiku-4-5-20251001",
  opus: () => process.env.CLAUDE_OPUS_ID || "claude-opus-5-5",
};

/** "claude:sonnet" → id real; "claude:claude-xxx" → tal cual. */
export function resolverModeloClaude(nombre: string): string {
  const alias = nombre.replace(/^(claude|anthropic):/, "").trim();
  return ALIAS_CLAUDE[alias]?.() || alias;
}
export const esClaude = (modelo?: string) => /^(claude|anthropic):/i.test(String(modelo || ""));

function aBloquesAsistente(m: any): any[] {
  const bloques: any[] = [];
  if (m.content && String(m.content).trim()) bloques.push({ type: "text", text: String(m.content) });
  for (const tc of m.tool_calls || []) {
    let input: any = {}; try { input = JSON.parse(tc.function?.arguments || "{}"); } catch { input = {}; }
    bloques.push({ type: "tool_use", id: tc.id, name: tc.function?.name, input });
  }
  return bloques.length ? bloques : [{ type: "text", text: "(sin contenido)" }];
}

/** Convierte el historial OpenAI a Messages API (system aparte, roles alternados, tool_result en user). */
export function convertir(mensajes: ChatCompletionMessageParam[]): { system: string; messages: any[] } {
  const systemPartes: string[] = []; const out: any[] = [];
  const push = (role: "user" | "assistant", content: any[]) => {
    const prev = out[out.length - 1];
    if (prev && prev.role === role) prev.content.push(...content); else out.push({ role, content });
  };
  for (const m of mensajes as any[]) {
    if (m.role === "system") { systemPartes.push(String(m.content || "")); continue; }
    if (m.role === "user") { push("user", [{ type: "text", text: String(m.content || "") || "(vacío)" }]); continue; }
    if (m.role === "assistant") { push("assistant", aBloquesAsistente(m)); continue; }
    if (m.role === "tool") { push("user", [{ type: "tool_result", tool_use_id: m.tool_call_id, content: String(m.content || "") }]); continue; }
  }
  // La API exige que el primer mensaje sea user y que no termine en assistant sin motivo; si el último es assistant (empujón), está bien.
  if (!out.length || out[0].role !== "user") out.unshift({ role: "user", content: [{ type: "text", text: "(inicio)" }] });
  // Los system "intermedios" que el motor mete como empujones van al final del system (son instrucciones).
  return { system: systemPartes.join("\n\n"), messages: out };
}

const SIN_TEMPERATURA = new Set<string>();   // modelos que no aceptan temperature (se aprende en la primera llamada)

export async function llamarClaude(
  mensajes: ChatCompletionMessageParam[],
  tools: ChatCompletionTool[],
  op: { modelo: string; temperatura?: number; forzarTool?: boolean; maxTokens?: number }
): Promise<RespuestaModelo> {
  const modelo = resolverModeloClaude(op.modelo);
  const { system, messages } = convertir(mensajes);
  const toolsA = tools.map((t: any, i) => ({
    name: t.function?.name, description: t.function?.description || "", input_schema: (t.function?.parameters as any) || { type: "object", properties: {} },
    ...(i === tools.length - 1 ? { cache_control: { type: "ephemeral" } } : {}),   // caché: todas las tools hasta la última
  }));
  // Los modelos nuevos (Sonnet 5.5+) rechazan `temperature` ("deprecated for this model"): se manda solo a los
  // que la aceptan, y si uno la rechaza se recuerda y se reintenta sin ella.
  const cuerpo = (conTemp: boolean) => ({
    model: modelo,
    max_tokens: op.maxTokens ?? 4096,
    ...(conTemp ? { temperature: Math.min(1, Math.max(0, op.temperatura ?? 0.3)) } : {}),
    system: system ? [{ type: "text", text: system, cache_control: { type: "ephemeral" } }] : undefined,
    messages,
    tools: toolsA.length ? toolsA : undefined,
    tool_choice: toolsA.length ? (op.forzarTool ? { type: "any" } : { type: "auto" }) : undefined,
  });
  let resp: any;
  try { resp = await get().messages.create(cuerpo(!SIN_TEMPERATURA.has(modelo)) as any); }
  catch (e: any) {
    if (/temperature/i.test(String(e?.message || "")) && !SIN_TEMPERATURA.has(modelo)) { SIN_TEMPERATURA.add(modelo); resp = await get().messages.create(cuerpo(false) as any); }
    else throw e;
  }
  const texto = (resp.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n").trim();
  const toolCalls = (resp.content || []).filter((b: any) => b.type === "tool_use").map((b: any) => ({ id: b.id, nombre: b.name, argumentos: (b.input || {}) as Record<string, unknown> }));
  const u = resp.usage || {};
  return {
    texto, toolCalls,
    uso: { entrada: u.input_tokens || 0, salida: u.output_tokens || 0, modelo, cacheLectura: u.cache_read_input_tokens || 0, cacheEscritura: u.cache_creation_input_tokens || 0 } as any,
  };
}

/** Igual que llamarClaude pero SOLO texto y en streaming: llama onDelta con cada trozo. Para la charla por voz. */
export async function streamClaude(mensajes: ChatCompletionMessageParam[], op: { modelo: string; maxTokens?: number; onDelta: (t: string) => void }): Promise<{ texto: string; uso: any }> {
  const modelo = resolverModeloClaude(op.modelo);
  const { system, messages } = convertir(mensajes);
  const stream = get().messages.stream({
    model: modelo, max_tokens: op.maxTokens ?? 600,
    system: system ? [{ type: "text", text: system, cache_control: { type: "ephemeral" } }] : undefined,
    messages,
  } as any);
  let texto = "";
  stream.on("text", (t: string) => { texto += t; op.onDelta(t); });
  const fin: any = await stream.finalMessage();
  const u = fin?.usage || {};
  return { texto: texto.trim(), uso: { entrada: u.input_tokens || 0, salida: u.output_tokens || 0, modelo, cacheLectura: u.cache_read_input_tokens || 0, cacheEscritura: u.cache_creation_input_tokens || 0 } };
}