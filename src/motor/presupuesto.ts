// ARCHIVO: src/motor/presupuesto.ts
// ─────────────────────────────────────────────────────────────────────────────
//  PRESUPUESTO — cuánto gasta cada agente (Groq + Claude Code) y tope diario.
//  gobierno.presupuesto_diario_usd (0 = sin tope). Precios estimados por .env:
//  GROQ_USD_POR_MILLON_IN / _OUT (defecto gpt-oss-120b: 0.15 / 0.60).
// ─────────────────────────────────────────────────────────────────────────────
import { query } from "../db/cliente.js";

const PRECIO_IN = () => Number(process.env.GROQ_USD_POR_MILLON_IN || 0.15);
const PRECIO_OUT = () => Number(process.env.GROQ_USD_POR_MILLON_OUT || 0.60);

export function costoGroq(tokensIn: number, tokensOut: number): number {
  return (tokensIn * PRECIO_IN() + tokensOut * PRECIO_OUT()) / 1_000_000;
}

// Precios de la API de Claude (USD por millón de tokens; platform.claude.com/docs/en/about-claude/pricing).
// Caché: lectura 0.1x del precio de entrada, escritura 1.25x. Se pueden pisar por .env.
const PRECIOS_CLAUDE: Record<string, { in: number; out: number }> = {
  sonnet: { in: Number(process.env.CLAUDE_SONNET_USD_IN || 2), out: Number(process.env.CLAUDE_SONNET_USD_OUT || 10) },
  haiku: { in: Number(process.env.CLAUDE_HAIKU_USD_IN || 1), out: Number(process.env.CLAUDE_HAIKU_USD_OUT || 5) },
  opus: { in: Number(process.env.CLAUDE_OPUS_USD_IN || 4), out: Number(process.env.CLAUDE_OPUS_USD_OUT || 20) },
};
export function costoClaude(modelo: string, tokensIn: number, tokensOut: number, cacheLectura = 0, cacheEscritura = 0): number {
  const fam = /haiku/i.test(modelo) ? "haiku" : /opus/i.test(modelo) ? "opus" : "sonnet";
  const p = PRECIOS_CLAUDE[fam];
  const entradaNormal = Math.max(0, tokensIn - cacheLectura - cacheEscritura);
  return (entradaNormal * p.in + cacheLectura * p.in * 0.1 + cacheEscritura * p.in * 1.25 + tokensOut * p.out) / 1_000_000;
}

export async function registrarConsumo(p: { agenteId: string | null; ejecucionId?: string | null; proveedor: string; modelo?: string; tokensIn?: number; tokensOut?: number; cacheLectura?: number; cacheEscritura?: number; costoUsd?: number }) {
  const costo = p.costoUsd ?? (p.proveedor === "anthropic" ? costoClaude(p.modelo || "", p.tokensIn || 0, p.tokensOut || 0, p.cacheLectura || 0, p.cacheEscritura || 0) : p.proveedor.startsWith("groq") ? costoGroq(p.tokensIn || 0, p.tokensOut || 0) : 0);
  await query(`INSERT INTO consumo (agente_id, ejecucion_id, proveedor, modelo, tokens_in, tokens_out, costo_usd) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [p.agenteId, p.ejecucionId ?? null, p.proveedor, p.modelo ?? null, p.tokensIn || 0, p.tokensOut || 0, costo]).catch(() => {});
}

/** Gasto de un agente (o de todos) en una ventana. Incluye Claude Code (sesiones_codigo.costo_usd). */
export async function gasto(agenteId: string | null, desde: "hoy" | "semana" | "mes" = "hoy") {
  const intervalo = desde === "hoy" ? "date_trunc('day', now())" : desde === "semana" ? "now() - interval '7 days'" : "now() - interval '30 days'";
  const [g] = await query<any>(`SELECT COALESCE(SUM(costo_usd) FILTER (WHERE proveedor LIKE 'groq%'),0)::float AS groq, COALESCE(SUM(costo_usd) FILTER (WHERE proveedor='anthropic'),0)::float AS api_claude, COALESCE(SUM(tokens_in),0)::int AS tokens_in, COALESCE(SUM(tokens_out),0)::int AS tokens_out, COUNT(*)::int AS llamadas, COUNT(*) FILTER (WHERE proveedor='anthropic')::int AS llamadas_claude FROM consumo WHERE creado_en >= ${intervalo} ${agenteId ? "AND agente_id=$1" : ""}`, agenteId ? [agenteId] : []);
  const [c] = await query<any>(`SELECT COALESCE(SUM(costo_usd),0)::float AS claude, COUNT(*)::int AS sesiones FROM sesiones_codigo WHERE inicio >= ${intervalo} ${agenteId ? "AND agente_id=$1" : ""}`, agenteId ? [agenteId] : []);
  const total = g.groq + g.api_claude + c.claude;
  return { groq_usd: +g.groq.toFixed(4), api_claude_usd: +g.api_claude.toFixed(4), claude_code_usd: +c.claude.toFixed(4), claude_usd: +(g.api_claude + c.claude).toFixed(4), total_usd: +total.toFixed(4), tokens_in: g.tokens_in, tokens_out: g.tokens_out, llamadas_groq: g.llamadas - g.llamadas_claude, llamadas_claude: g.llamadas_claude, sesiones_claude: c.sesiones };
}

/** ¿Puede el agente seguir gastando hoy? */
export async function dentroDePresupuesto(agente: any): Promise<{ ok: boolean; tope: number; gastado: number }> {
  const tope = Number(agente?.gobierno?.presupuesto_diario_usd) || 0;
  if (!tope) return { ok: true, tope: 0, gastado: 0 };
  const g = await gasto(agente.id, "hoy");
  return { ok: g.total_usd < tope, tope, gastado: g.total_usd };
}