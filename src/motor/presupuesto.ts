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

// Precios de la API de Claude, USD por millón de tokens (tabla oficial, revisada 2026-10-31:
// platform.claude.com/docs/about-claude/pricing). in / out / escritura de caché 5 min / lectura de caché.
// OJO: el `input_tokens` de la API YA excluye los tokens de caché; se suman aparte.
type Precio = { in: number; out: number; w: number; r: number };
const PRECIOS_CLAUDE: { patron: RegExp; precio: (promptTotal: number) => Precio }[] = [
  { patron: /haiku-5-5/i, precio: (t) => (t > 100_000 ? { in: 0.5, out: 2.5, w: 0.625, r: 0.05 } : { in: 0.1, out: 0.5, w: 0.125, r: 0.01 }) },
  { patron: /haiku-4-5/i, precio: () => ({ in: 1, out: 5, w: 1.25, r: 0.1 }) },
  { patron: /haiku/i, precio: () => ({ in: 0.8, out: 4, w: 1, r: 0.08 }) },
  { patron: /sonnet-5-5/i, precio: () => ({ in: 2, out: 10, w: 2.5, r: 0.1 }) },
  { patron: /sonnet-5/i, precio: () => ({ in: 2, out: 10, w: 2.5, r: 0.2 }) },
  { patron: /sonnet/i, precio: () => ({ in: 3, out: 15, w: 3.75, r: 0.3 }) },
  { patron: /opus-5-5/i, precio: () => ({ in: 4, out: 20, w: 5, r: 0.2 }) },
  { patron: /opus-4-[01]\b|opus-4$|opus-4-2025/i, precio: () => ({ in: 15, out: 75, w: 18.75, r: 1.5 }) },
  { patron: /opus/i, precio: () => ({ in: 5, out: 25, w: 6.25, r: 0.5 }) },
  { patron: /fable|mythos/i, precio: () => ({ in: 10, out: 50, w: 12.5, r: 0.25 }) },
];
export function costoClaude(modelo: string, tokensIn: number, tokensOut: number, cacheLectura = 0, cacheEscritura = 0): number {
  const promptTotal = tokensIn + cacheLectura + cacheEscritura;
  const p = (PRECIOS_CLAUDE.find((x) => x.patron.test(modelo)) ?? PRECIOS_CLAUDE[3]).precio(promptTotal);
  return (tokensIn * p.in + cacheLectura * p.r + cacheEscritura * p.w + tokensOut * p.out) / 1_000_000;
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