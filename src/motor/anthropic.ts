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
export function clienteAnthropic() { return get(); }
function get() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("Falta ANTHROPIC_API_KEY en .env para usar modelos Claude.");
  // Las claves de usuario (sk-ant-usr…) no están atadas a un workspace: Anthropic exige el header anthropic-workspace-id.
  // Alternativa: crear la clave DENTRO de un workspace (console → Workspaces → API Keys) y no hace falta el header.
  if (!cliente) cliente = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, defaultHeaders: process.env.ANTHROPIC_WORKSPACE_ID ? { "anthropic-workspace-id": process.env.ANTHROPIC_WORKSPACE_ID } : undefined });
  return cliente;
}

/**
 * Separa el system en dos partes: lo ESTABLE (identidad, reglas, documentos: igual en
 * todas las tareas → caché que dura entre tareas) y lo DINÁMICO (memoria, acciones
 * recientes, biblioteca del pedido). armarSistema la pone; Groq la borra.
 */
export const MARCA_DINAMICO = "\n\n<<<CONTEXTO_DINAMICO>>>\n\n";

export const ALIAS_CLAUDE: Record<string, () => string> = {
  sonnet: () => process.env.CLAUDE_SONNET_ID || "claude-sonnet-5-5",
  // Haiku 5.5: $0.10 / $0.50 por millón (≤100k de prompt), 10x más barato que Haiku 4.5.
  haiku: () => process.env.CLAUDE_HAIKU_ID || "claude-haiku-5-5",
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
  let vistoNoSystem = false;
  const push = (role: "user" | "assistant", content: any[]) => {
    const prev = out[out.length - 1];
    if (prev && prev.role === role) prev.content.push(...content); else out.push({ role, content });
  };
  for (const m of mensajes as any[]) {
    // Solo el PRIMER system va al system de Claude. Los que el motor mete después
    // (empujones, resúmenes, correcciones) van como texto de usuario en su lugar:
    // si se sumaran al system, el prefijo cambiaría y el caché se rompería cada turno.
    if (m.role === "system") {
      if (!systemPartes.length && !vistoNoSystem) { systemPartes.push(String(m.content || "")); continue; }
      push("user", [{ type: "text", text: `[Indicación del sistema] ${String(m.content || "")}` }]);
      continue;
    }
    vistoNoSystem = true;
    if (m.role === "user") { push("user", [{ type: "text", text: String(m.content || "") || "(vacío)" }]); continue; }
    if (m.role === "assistant") { push("assistant", aBloquesAsistente(m)); continue; }
    if (m.role === "tool") { push("user", [{ type: "tool_result", tool_use_id: m.tool_call_id, content: String(m.content || "") }]); continue; }
  }
  // La API exige que el primer mensaje sea user y que no termine en assistant sin motivo; si el último es assistant (empujón), está bien.
  if (!out.length || out[0].role !== "user") out.unshift({ role: "user", content: [{ type: "text", text: "(inicio)" }] });
  return { system: systemPartes.join("\n\n"), messages: out };
}

/** System en bloques: el estable con caché propio (sobrevive entre tareas) y el dinámico detrás. */
function bloquesSystem(system: string): any[] | undefined {
  if (!system) return undefined;
  const i = system.indexOf(MARCA_DINAMICO);
  if (i < 0) return [{ type: "text", text: system, cache_control: { type: "ephemeral" } }];
  const estable = system.slice(0, i).trim(), dinamico = system.slice(i + MARCA_DINAMICO.length).trim();
  return [
    { type: "text", text: estable || "(sin identidad)", cache_control: { type: "ephemeral" } },
    ...(dinamico ? [{ type: "text", text: dinamico }] : []),
  ];
}

/**
 * Punto de caché en el último bloque del historial: en el loop cada turno re-manda
 * todo lo anterior; así el siguiente turno lee ese prefijo al 10% del precio.
 * (Máximo 4 puntos por llamada: tools + system estable + este = 3.)
 */
function conCacheEnHistorial(messages: any[]): any[] {
  const ult = messages[messages.length - 1];
  if (!ult || !Array.isArray(ult.content) || !ult.content.length) return messages;
  const copia = messages.slice(0, -1);
  const contenido = ult.content.map((b: any, i: number) => (i === ult.content.length - 1 ? { ...b, cache_control: { type: "ephemeral" } } : b));
  copia.push({ ...ult, content: contenido });
  return copia;
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
    system: bloquesSystem(system),
    messages: conCacheEnHistorial(messages),
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
    system: bloquesSystem(system),
    messages: conCacheEnHistorial(messages),
  } as any);
  let texto = "";
  stream.on("text", (t: string) => { texto += t; op.onDelta(t); });
  const fin: any = await stream.finalMessage();
  const u = fin?.usage || {};
  return { texto: texto.trim(), uso: { entrada: u.input_tokens || 0, salida: u.output_tokens || 0, modelo, cacheLectura: u.cache_read_input_tokens || 0, cacheEscritura: u.cache_creation_input_tokens || 0 } };
}