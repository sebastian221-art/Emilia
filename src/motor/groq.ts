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
  // Solo pruebas: un modelo falso inyectado (nunca se define en producción).
  if ((globalThis as any).__modeloPrueba) return (globalThis as any).__modeloPrueba(mensajes, tools, op);
  const { verificarTopeGlobal } = await import("../seguridad/gasto.js");
  const { contextoActual } = await import("../seguridad/contexto.js");
  const c = contextoActual();
  await verificarTopeGlobal(c.prioridad || "normal");
  const r = await conResiliencia(mensajes, tools, op);
  // Todo lo que pasa por acá queda contado (también lo de fondo: alma, Lyra, System…).
  if (r.uso) {
    const { registrarConsumo } = await import("./presupuesto.js");
    const m = r.uso.modelo || op.modelo || MODELO_POR_DEFECTO;
    registrarConsumo({ agenteId: c.agenteId ?? null, ejecucionId: c.ejecucionId ?? null, proveedor: /claude|anthropic/i.test(m) ? "anthropic" : "groq", modelo: m, tokensIn: r.uso.entrada, tokensOut: r.uso.salida, cacheLectura: r.uso.cacheLectura, cacheEscritura: r.uso.cacheEscritura }).catch(() => {});
  }
  return r;
}

// ═══════════ RESILIENCIA: reintentos, plan B entre proveedores y cortacircuitos ═══════════
//  • Error pasajero (429, 5xx, overloaded, timeout, red): reintenta con espera creciente (respeta retry-after).
//  • Si el proveedor sigue fallando: plan B (Groq ↔ Claude) con el modelo de respaldo configurado.
//  • Cortacircuitos: si un proveedor falla 3 veces en 2 min, se salta 3 min directo al plan B (no se pierde tiempo).
//  Errores de la petición (400 por argumentos, 401 de llave) no se reintentan: se devuelven tal cual.
export const proveedorDe = (m?: string) => (/^(claude|anthropic):/i.test(m || "") ? "claude" : "groq");
const fallos: Record<string, number[]> = { groq: [], claude: [] };
const abiertoHasta: Record<string, number> = { groq: 0, claude: 0 };
const ultimoError: Record<string, string> = {};
export function estadoProveedores() {
  const ahora = Date.now();
  return (["groq", "claude"] as const).map((p) => ({ proveedor: p, fallosRecientes: fallos[p].filter((t) => ahora - t < 120_000).length, cortado: abiertoHasta[p] > ahora, hasta: abiertoHasta[p] > ahora ? new Date(abiertoHasta[p]).toISOString() : null, ultimoError: ultimoError[p] || null }));
}
export function _reiniciarResiliencia() { fallos.groq = []; fallos.claude = []; abiertoHasta.groq = 0; abiertoHasta.claude = 0; }
function esPasajero(e: any): boolean {
  const st = Number(e?.status || e?.error?.status || e?.response?.status || 0);
  const t = `${e?.message || ""} ${e?.error?.type || ""} ${e?.code || ""}`;
  if ([408, 409, 425, 429, 500, 502, 503, 504, 529].includes(st)) return true;
  return /overloaded|rate.?limit|timeout|timed out|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|socket hang up|fetch failed|network|temporarily|Service Unavailable|internal server error/i.test(t);
}
function esperaDe(e: any, intento: number): number {
  const ra = Number(e?.headers?.["retry-after"] || e?.response?.headers?.get?.("retry-after") || 0);
  if (ra > 0 && ra < 30) return ra * 1000;
  return Math.min(8000, 700 * 2 ** intento) + Math.random() * 300;
}
function anotarFallo(p: string, e: any) {
  const ahora = Date.now();
  fallos[p] = [...fallos[p].filter((t) => ahora - t < 120_000), ahora];
  ultimoError[p] = String(e?.message || e).slice(0, 200);
  if (fallos[p].length >= 3) { abiertoHasta[p] = ahora + 180_000; console.warn(`[modelos] ${p} falló ${fallos[p].length} veces en 2 min: uso el plan B por 3 min.`); }
}
function modeloRespaldo(modelo: string): string | null {
  const claudeActiva = !!process.env.ANTHROPIC_API_KEY && (process.env.CLAUDE_API_ACTIVA || "true").toLowerCase() !== "false";
  if (proveedorDe(modelo) === "claude") return process.env.MODELO_RESPALDO_GROQ || MODELO_POR_DEFECTO;
  return claudeActiva && process.env.MODELO_RESPALDO_CLAUDE !== "no" ? (process.env.MODELO_RESPALDO_CLAUDE || "claude:haiku") : null;
}
async function conResiliencia(mensajes: ChatCompletionMessageParam[], tools: ChatCompletionTool[], op: OpcionesModelo): Promise<RespuestaModelo> {
  const modelo = op.modelo || MODELO_POR_DEFECTO;
  const prov = proveedorDe(modelo);
  const respaldo = modeloRespaldo(modelo);
  if (abiertoHasta[prov] > Date.now() && respaldo) return llamarUnaVez(mensajes, tools, { ...op, modelo: respaldo });
  const intentos = Number(process.env.MODELO_REINTENTOS || 2);
  let ultimo: any;
  for (let i = 0; i <= intentos; i++) {
    try {
      const r = await llamarUnaVez(mensajes, tools, op);
      fallos[prov] = [];
      return r;
    } catch (e: any) {
      ultimo = e;
      if (!esPasajero(e)) throw e;
      anotarFallo(prov, e);
      if (abiertoHasta[prov] > Date.now()) break;
      if (i < intentos) await new Promise((r) => setTimeout(r, esperaDe(e, i)));
    }
  }
  if (respaldo) {
    console.warn(`[modelos] ${modelo} no respondió (${String(ultimo?.message || ultimo).slice(0, 120)}): plan B con ${respaldo}.`);
    const r = await llamarUnaVez(mensajes, tools, { ...op, modelo: respaldo });
    return { ...r, uso: r.uso ? { ...r.uso, modelo: respaldo } : r.uso };
  }
  throw ultimo;
}

async function llamarUnaVez(mensajes: ChatCompletionMessageParam[], tools: ChatCompletionTool[], op: OpcionesModelo): Promise<RespuestaModelo> {
  if ((globalThis as any).__proveedorPrueba) return (globalThis as any).__proveedorPrueba(mensajes, tools, op);   // solo pruebas de resiliencia
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
    return llamarUnaVez(mensajes, tools, { ...op, modelo: MODELO_POR_DEFECTO });
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
          messages: [...mensajes, { role: "system", content: `Tu última llamada${nombreTool ? ` a ${nombreTool}` : ""} salió con argumentos que NO eran JSON válido (quedaron cortados). Repetila ahora con JSON válido y argumentos MÁS CORTOS: textos de 1-2 líneas por campo, sin comillas dobles dentro de los textos (usa comillas simples), sin campos vacíos ni null. Si no entra en una llamada, haz primero una versión breve y completa después.` }],
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
          messages: [...mensajes, { role: "system", content: "Tu salida anterior no se pudo interpretar. Responde de una de dos formas: o llamas una herramienta con sus argumentos en JSON válido, o escribes tu respuesta final en texto. No mezcles razonamiento suelto con llamadas." }],
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
          messages: [...mensajes, { role: "system", content: "Responde SOLO con texto plano. No intentes llamar ninguna herramienta." }],
        });
        const m = resp.choices[0]?.message;
        return { texto: (m?.content ?? "").trim(), razonamiento: (m as any)?.reasoning, toolCalls: [] };
      } catch { /* cae al throw */ }
    }
    throw e;
  }
}

function clamp(n: number, a: number, b: number) { return Number.isFinite(n) ? Math.min(b, Math.max(a, n)) : 0.3; }