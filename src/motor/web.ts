// ARCHIVO: src/motor/web.ts
// ─────────────────────────────────────────────────────────────────────────────
//  WEB — buscar y leer internet (ver «SOGA — MOTOR EN CAPAS» más abajo).
//  buscar(): DuckDuckGo HTML (gratis, sin API). Resultados con título, url y
//  resumen. leer(): descarga una página y la deja en texto limpio (sin menús,
//  scripts ni estilos), con título y enlaces principales. Soporta HTML y PDF
//  (texto) y respeta un límite de tamaño. Si DuckDuckGo falla, cae a Bing HTML.
// ─────────────────────────────────────────────────────────────────────────────

import { textoDeDocumento } from "./texto-documento.js";
import { query as consulta } from "../db/cliente.js";

export interface ResultadoBusqueda { titulo: string; url: string; resumen: string; fuente: string; fecha?: string; motor?: string }
export interface PaginaLeida { titulo: string; url: string; texto: string; enlaces: { texto: string; href: string }[]; caracteres: number; recortado: boolean; via?: "simple" | "lightpanda" | "chromium"; fecha?: string }

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

function decodificarEntidades(t: string): string {
  return t.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
}
function quitarEtiquetas(h: string): string { return decodificarEntidades(h.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim(); }

async function fetchTexto(url: string, timeoutSeg = 20, extraHeaders: Record<string, string> = {}): Promise<{ ok: boolean; status: number; texto: string; tipo: string; urlFinal: string }> {
  const ctrl = new AbortController(); const to = setTimeout(() => ctrl.abort(), timeoutSeg * 1000);
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "es-CO,es;q=0.9,en;q=0.7", ...extraHeaders }, redirect: "follow", signal: ctrl.signal });
    const tipo = r.headers.get("content-type") || "";
    if (/application\/pdf/i.test(tipo) || /\.pdf(\?|$)/i.test(url)) {
      const buf = Buffer.from(await r.arrayBuffer());
      let texto = "";
      texto = (await textoDeDocumento(buf, "application/pdf", "", 200000)) || "(PDF: no pude extraer texto; puede ser un PDF escaneado o protegido)";
      return { ok: r.ok, status: r.status, texto, tipo: "pdf", urlFinal: r.url || url };
    }
    const cuerpo = Buffer.from(await r.arrayBuffer());
    if (cuerpo.subarray(0, 5).toString("latin1") === "%PDF-") {   // PDF servido sin content-type ni extensión
      let texto = "";
      texto = (await textoDeDocumento(cuerpo, "application/pdf", "", 200000)) || "(PDF: no pude extraer texto; puede ser un PDF escaneado o protegido)";
      return { ok: r.ok, status: r.status, texto, tipo: "pdf", urlFinal: r.url || url };
    }
    if (/^(image|audio|video|application\/(zip|octet-stream|x-))/i.test(tipo)) return { ok: r.ok, status: r.status, texto: `(contenido binario ${tipo}: no es texto legible)`, tipo: "binario", urlFinal: r.url || url };
    return { ok: r.ok, status: r.status, texto: cuerpo.toString("utf8"), tipo: tipo.includes("html") ? "html" : "texto", urlFinal: r.url || url };
  } finally { clearTimeout(to); }
}

// ── Caché por consulta (10 min) y respiro entre búsquedas, para no quemar los buscadores gratuitos ──
const cache = new Map<string, { t: number; r: ResultadoBusqueda[] }>();
let ultimaBusqueda = 0;
export class ErrorBuscador extends Error { constructor(m: string) { super(m); this.name = "ErrorBuscador"; } }

/** Brave Search API (plan gratuito: 2.000/mes). BRAVE_SEARCH_API_KEY en .env. */
async function buscarBrave(q: string, max: number, region: string): Promise<ResultadoBusqueda[] | null> {
  const key = process.env.BRAVE_SEARCH_API_KEY; if (!key) return null;
  const lang = region.split("-")[1] || "es"; let country = (region.split("-")[0] || "co").toUpperCase();
  // Brave solo acepta ciertos países; Colombia no está. Fuera de la lista → ALL (con el idioma igual se prioriza lo hispano).
  const PAISES = new Set(["AR","AU","AT","BE","BR","CA","CL","DK","FI","FR","DE","HK","IN","ID","IT","JP","KR","MY","MX","NL","NZ","NO","CN","PL","PT","PH","RU","SA","ZA","ES","SE","CH","TW","TR","GB","US","ALL"]);
  if (!PAISES.has(country)) country = "ALL";
  const ctrl = new AbortController(); const to = setTimeout(() => ctrl.abort(), 15000);
  try {
    const url = (conPais: boolean) => `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q.slice(0, 400))}&count=${Math.min(max, 20)}&search_lang=${lang}${conPais ? `&country=${country}` : ""}`;
    let r = await fetch(url(true), { headers: { "X-Subscription-Token": key, Accept: "application/json" }, signal: ctrl.signal });
    if (r.status === 422) r = await fetch(url(false), { headers: { "X-Subscription-Token": key, Accept: "application/json" }, signal: ctrl.signal });   // parámetro no aceptado → sin país
    if (!r.ok) throw new ErrorBuscador(`Brave API respondió ${r.status}${r.status === 429 ? " (límite de uso)" : ""}`);
    const j: any = await r.json();
    return (j?.web?.results || []).slice(0, max).map((x: any) => ({ titulo: String(x.title || ""), url: String(x.url || ""), resumen: quitarEtiquetas(String(x.description || "")), fuente: (() => { try { return new URL(x.url).hostname.replace(/^www\./, ""); } catch { return ""; } })() }));
  } finally { clearTimeout(to); }
}

/**
 * Búsqueda web. Orden: Brave API (si hay clave) → DuckDuckGo HTML → Bing HTML → Brave HTML.
 * Si NINGUNO responde (bloqueo por IP, sin red), lanza ErrorBuscador: no es "falta de resultados"
 * y el agente no debe reintentar con otras palabras.
 */
async function buscarRespaldo(consulta: string, max = 8, region = "co-es", reciente?: Reciente): Promise<ResultadoBusqueda[]> {
  const q = consulta.trim(); if (!q) return [];
  const clave = `${q}|${max}|${region}|${reciente || ""}`; const c = cache.get(clave);
  if (c && Date.now() - c.t < 10 * 60000) return c.r;
  const espera = 1500 - (Date.now() - ultimaBusqueda); if (espera > 0) await new Promise((r) => setTimeout(r, espera));
  ultimaBusqueda = Date.now();
  const out: ResultadoBusqueda[] = [];
  let respondioAlguno = false;
  if (!reciente) try { const b = await buscarBrave(q, max, region); if (b) { respondioAlguno = true; if (b.length) { cache.set(clave, { t: Date.now(), r: b }); return b; } } } catch (e: any) { if (!(e instanceof ErrorBuscador)) throw e; console.warn(`[web] ${e.message}`); }
  try {
    const r = await fetchTexto(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}&kl=${encodeURIComponent(region)}${reciente ? `&df=${{ dia: "d", semana: "w", mes: "m", año: "y" }[reciente]}` : ""}`, 20);
    if (r.status === 200 && r.texto.length > 2000) respondioAlguno = true;
    if (/anomaly|bot|captcha|blocked/i.test(r.texto.slice(0, 3000)) && r.texto.length < 20000) respondioAlguno = false;
    const bloques = r.texto.split(/<div class="result results_links/).slice(1);
    for (const b of bloques) {
      const m = b.match(/<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
      if (!m) continue;
      let href = m[1];
      const uddg = href.match(/[?&]uddg=([^&]+)/); if (uddg) href = decodeURIComponent(uddg[1]);
      if (/duckduckgo\.com\/y\.js|ad_provider/.test(href)) continue;
      const sn = b.match(/<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/) || b.match(/<div class="result__snippet"[^>]*>([\s\S]*?)<\/div>/);
      out.push({ titulo: quitarEtiquetas(m[2]), url: href, resumen: sn ? quitarEtiquetas(sn[1]) : "", fuente: new URL(href).hostname.replace(/^www\./, "") });
      if (out.length >= max) break;
    }
  } catch { /* cae a Bing */ }
  if (out.length) { cache.set(clave, { t: Date.now(), r: out }); return out; }
  try {
    const r = await fetchTexto(`https://www.bing.com/search?q=${encodeURIComponent(q)}&setlang=es&cc=CO`, 20);
    if (r.status === 200 && /b_algo/.test(r.texto)) respondioAlguno = true;
    const bloques = r.texto.split(/<li class="b_algo"/).slice(1);
    for (const b of bloques) {
      const m = b.match(/<h2>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/); if (!m) continue;
      const sn = b.match(/<p[^>]*>([\s\S]*?)<\/p>/);
      const href = m[1]; try { out.push({ titulo: quitarEtiquetas(m[2]), url: href, resumen: sn ? quitarEtiquetas(sn[1]) : "", fuente: new URL(href).hostname.replace(/^www\./, "") }); } catch { /* url rara */ }
      if (out.length >= max) break;
    }
  } catch { /* cae a Brave */ }
  if (out.length) return out;
  try {
    const r = await fetchTexto(`https://search.brave.com/search?q=${encodeURIComponent(q)}&source=web`, 20);
    for (const m of r.texto.matchAll(/<a[^>]+href="(https?:\/\/[^"]+)"[^>]+class="[^"]*(?:result-header|h svelte)[^"]*"[^>]*>([\s\S]*?)<\/a>/gi)) {
      const href = m[1]; if (/brave\.com/.test(href)) continue;
      try { out.push({ titulo: quitarEtiquetas(m[2]), url: href, resumen: "", fuente: new URL(href).hostname.replace(/^www\./, "") }); } catch { /* url rara */ }
      if (out.length >= max) break;
    }
  } catch { /* sin resultados */ }
  if (out.length) { cache.set(clave, { t: Date.now(), r: out }); return out; }
  if (!respondioAlguno) throw new ErrorBuscador("Ningún buscador respondió (bloqueo temporal por muchas consultas seguidas, sin red, o cambió el HTML). No sirve reintentar con otras palabras: esperá unos minutos o configurá BRAVE_SEARCH_API_KEY en .env.");
  return out;
}

/** Texto limpio de una página: quita scripts, estilos, nav, footer, menús; conserva párrafos y encabezados. */
export function limpiarHtml(html: string): { titulo: string; texto: string; enlaces: { texto: string; href: string }[] } {
  const titulo = quitarEtiquetas(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "");
  let h = html.replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|noscript|svg|canvas|iframe|template)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(nav|footer|header|aside|form)[\s\S]*?<\/\1>/gi, " ");
  const enlaces: { texto: string; href: string }[] = [];
  for (const m of h.matchAll(/<a[^>]+href="(https?:\/\/[^"#]+)"[^>]*>([\s\S]*?)<\/a>/gi)) { const t = quitarEtiquetas(m[2]); if (t.length > 3 && enlaces.length < 40) enlaces.push({ texto: t.slice(0, 80), href: m[1] }); }
  // Preferir el contenido principal si existe.
  const main = h.match(/<(main|article)[^>]*>([\s\S]*?)<\/\1>/i)?.[2]; if (main && main.length > 500) h = main;
  h = h.replace(/<(h[1-6])[^>]*>/gi, "\n\n## ").replace(/<\/(h[1-6])>/gi, "\n").replace(/<(p|div|li|tr|br|section)[^>]*>/gi, "\n").replace(/<\/(p|div|li|tr|section)>/gi, "\n");
  const texto = decodificarEntidades(h.replace(/<[^>]+>/g, " ")).replace(/[ \t]+/g, " ").replace(/\n\s*\n\s*\n+/g, "\n\n").trim();
  return { titulo, texto, enlaces };
}

/** Lee una URL (HTML, texto o PDF) → texto limpio, recortado a maxChars. */
async function leerSimple(url: string, maxChars = 12000): Promise<PaginaLeida & { html?: string; status?: number }> {
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;
  const r = await fetchTexto(url, 25);
  if (!r.ok && !r.texto) throw new Error(`HTTP ${r.status} al leer ${url}`);
  let titulo = "", texto = "", enlaces: { texto: string; href: string }[] = [];
  if (r.tipo === "html") { const l = limpiarHtml(r.texto); titulo = l.titulo; texto = l.texto; enlaces = l.enlaces; }
  else { texto = r.texto.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim(); titulo = url; }
  const html = r.tipo === "html" ? r.texto : undefined;
  const recortado = texto.length > maxChars;
  return { status: r.status, titulo: titulo || url, url: r.urlFinal, texto: recortado ? texto.slice(0, maxChars) + "\n\n[... recortado]" : texto, enlaces, caracteres: texto.length, recortado, via: "simple", html, fecha: html ? fechaDeHtml(html) : undefined };
}
// ═════════════════════════════════════════════════════════════════════════════
//  SOGA — MOTOR EN CAPAS
//  Buscar:  SearXNG propio (Docker, gratis, muchos buscadores a la vez)
//           → Brave API (si hay clave) → DuckDuckGo → Bing → Brave HTML
//           → búsqueda de Claude (de pago, con citas; tope diario).
//  Con motor "claude" se va directo a Claude (datos que tienen que estar al día).
//  Leer:    descarga simple → si la página se arma con JavaScript, Lightpanda
//           (Docker) → si falla, Chromium local.
//  Caché en la base con vencimiento según qué tan fresco tiene que ser el dato.
// ═════════════════════════════════════════════════════════════════════════════

export type Reciente = "dia" | "semana" | "mes" | "año";
export type Motor = "auto" | "gratis" | "claude";
export interface OpcionesBusqueda { max?: number; region?: string; reciente?: Reciente; motor?: Motor; agenteId?: string | null; idioma?: string }

const hoyBogota = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(new Date());
async function sumarUso(motor: string, d: { n?: number; fallos?: number; costo?: number }) {
  await consulta(`INSERT INTO web_uso (dia, motor, n, fallos, costo) VALUES ($1,$2,$3,$4,$5)
    ON CONFLICT (dia, motor) DO UPDATE SET n = web_uso.n + EXCLUDED.n, fallos = web_uso.fallos + EXCLUDED.fallos, costo = web_uso.costo + EXCLUDED.costo`,
    [hoyBogota(), motor, d.n || 0, d.fallos || 0, d.costo || 0]).catch(() => {});
}
async function cacheLeer<T>(clave: string): Promise<T | null> {
  const [f] = await consulta<{ datos: T }>(`SELECT datos FROM web_cache WHERE clave = $1 AND vence > now()`, [clave]).catch(() => [] as any[]);
  return f?.datos ?? null;
}
async function cacheGuardar(clave: string, datos: unknown, minutos: number) {
  await consulta(`INSERT INTO web_cache (clave, datos, vence) VALUES ($1, $2, now() + make_interval(mins => $3)) ON CONFLICT (clave) DO UPDATE SET datos = EXCLUDED.datos, vence = EXCLUDED.vence, creado_en = now()`,
    [clave, JSON.stringify(datos), minutos]).catch(() => {});
  if (Math.random() < 0.02) consulta(`DELETE FROM web_cache WHERE vence < now() - interval '1 day'`).catch(() => {});
}
const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };

// ── SearXNG ──────────────────────────────────────────────────────────────────
const urlSearx = () => (process.env.SEARXNG_URL ?? "http://127.0.0.1:8888").replace(/\/+$/, "");
let searxPausaHasta = 0;
async function buscarSearx(q: string, max: number, op: OpcionesBusqueda): Promise<ResultadoBusqueda[] | null> {
  const base = urlSearx(); if (!base || Date.now() < searxPausaHasta) return null;
  const tr = op.reciente ? { dia: "day", semana: "week", mes: "month", año: "year" }[op.reciente] : "";
  try {
    const r = await fetch(`${base}/search?q=${encodeURIComponent(q.slice(0, 400))}&format=json&language=${encodeURIComponent(op.idioma || "all")}${tr ? `&time_range=${tr}` : ""}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
    if (!r.ok) { if (r.status === 403) console.warn("[web] SearXNG no tiene activado el formato json (settings.yml → search.formats)."); searxPausaHasta = Date.now() + 5 * 60_000; return null; }
    const j: any = await r.json();
    const vistos = new Set<string>();
    return (j.results || []).filter((x: any) => x.url && !vistos.has(x.url) && vistos.add(x.url)).slice(0, max).map((x: any) => ({
      titulo: quitarEtiquetas(String(x.title || "")), url: String(x.url), resumen: quitarEtiquetas(String(x.content || "")), fuente: host(x.url),
      fecha: x.publishedDate ? String(x.publishedDate).slice(0, 10) : undefined, motor: `searxng:${(x.engines || [x.engine]).filter(Boolean).join("+")}`,
    }));
  } catch { searxPausaHasta = Date.now() + 2 * 60_000; return null; }
}
export async function searxDisponible(): Promise<boolean> {
  const base = urlSearx(); if (!base) return false;
  try { const r = await fetch(`${base}/healthz`, { signal: AbortSignal.timeout(4000) }); return r.ok; } catch { return false; }
}

// ── Búsqueda de Claude (server tool web_search; $10 por 1.000 búsquedas + tokens) ──
export interface RespuestaClaude { respuesta: string; resultados: ResultadoBusqueda[]; citas: { url: string; titulo: string; texto: string }[]; busquedas: number; costoUsd: number; modelo: string }
export const topeClaudeDia = () => Number(process.env.SOGA_CLAUDE_BUSQUEDAS_DIA || 60);
export const claudeBusquedaActiva = () => !!process.env.ANTHROPIC_API_KEY && (process.env.SOGA_CLAUDE_BUSQUEDA || "true").toLowerCase() !== "false";
async function usoHoy(motor: string): Promise<{ n: number; costo: number }> {
  const [f] = await consulta<{ n: number; costo: string }>(`SELECT n, costo FROM web_uso WHERE dia = $1 AND motor = $2`, [hoyBogota(), motor]).catch(() => [] as any[]);
  return { n: f?.n || 0, costo: Number(f?.costo || 0) };
}

/** Le pregunta a Claude con búsqueda web: respuesta corta, con citas y fechas. */
export async function buscarConClaude(pregunta: string, op: { maxUsos?: number; dominios?: string[]; agenteId?: string | null; instruccion?: string } = {}): Promise<RespuestaClaude> {
  if (!claudeBusquedaActiva()) throw new ErrorBuscador("La búsqueda de Claude no está activa (falta ANTHROPIC_API_KEY o SOGA_CLAUDE_BUSQUEDA=false).");
  const usadas = (await usoHoy("claude")).n, tope = topeClaudeDia();
  if (usadas >= tope) throw new ErrorBuscador(`Llegué al tope diario de búsquedas de Claude (${tope}). Mañana se renueva; mientras tanto uso los buscadores gratis.`);
  const { clienteAnthropic, resolverModeloClaude } = await import("./anthropic.js");
  const { costoClaude, registrarConsumo } = await import("./presupuesto.js");
  const modelo = resolverModeloClaude(process.env.SOGA_MODELO_BUSQUEDA || "claude:haiku");
  const maxUsos = Math.max(1, Math.min(op.maxUsos || 3, tope - usadas));
  const herramienta: any = { type: "web_search_20250305", name: "web_search", max_uses: maxUsos,
    user_location: { type: "approximate", city: "Bucaramanga", region: "Santander", country: "CO", timezone: "America/Bogota" } };
  if (op.dominios?.length) herramienta.allowed_domains = op.dominios;
  const sistema = `Eres el buscador de Soga. Hoy es ${hoyBogota()}. Busca en internet y responde en español, corto y exacto, solo con lo que encontraste. Da fechas (de cuándo es cada dato), cifras exactas y la fuente oficial cuando exista. Si las fuentes no coinciden, dilo. Si no encontraste algo, dilo; nunca inventes.${op.instruccion ? `\n${op.instruccion}` : ""}`;
  const mensajes: any[] = [{ role: "user", content: pregunta }];
  let texto = "", busquedas = 0, tokIn = 0, tokOut = 0;
  const resultados: ResultadoBusqueda[] = [], citas: RespuestaClaude["citas"] = [], vistos = new Set<string>();
  for (let vuelta = 0; vuelta < 4; vuelta++) {
    const r: any = await clienteAnthropic().messages.create({ model: modelo, max_tokens: 1500, system: sistema, messages: mensajes, tools: [herramienta] } as any);
    tokIn += r.usage?.input_tokens || 0; tokOut += r.usage?.output_tokens || 0; busquedas += r.usage?.server_tool_use?.web_search_requests || 0;
    for (const b of r.content || []) {
      if (b.type === "web_search_tool_result" && Array.isArray(b.content)) for (const x of b.content) if (x.url && !vistos.has(x.url)) { vistos.add(x.url); resultados.push({ titulo: x.title || "", url: x.url, resumen: "", fuente: host(x.url), fecha: x.page_age || undefined, motor: "claude" }); }
      if (b.type === "text") { texto += b.text; for (const c of b.citations || []) if (c.url) citas.push({ url: c.url, titulo: c.title || "", texto: c.cited_text || "" }); }
    }
    if (r.stop_reason !== "pause_turn") break;
    mensajes.push({ role: "assistant", content: r.content });   // continuar el turno pausado tal cual
  }
  const costoTokens = costoClaude(modelo, tokIn, tokOut), costoBusq = busquedas * 0.01;
  await sumarUso("claude", { n: busquedas, costo: costoTokens + costoBusq });
  registrarConsumo({ agenteId: op.agenteId ?? null, proveedor: "anthropic", modelo, tokensIn: tokIn, tokensOut: tokOut }).catch(() => {});
  if (costoBusq) registrarConsumo({ agenteId: op.agenteId ?? null, proveedor: "anthropic_busqueda", modelo: "web_search", costoUsd: costoBusq }).catch(() => {});
  for (const c of citas) { const r = resultados.find((x) => x.url === c.url); if (r && !r.resumen) r.resumen = c.texto; }
  return { respuesta: texto.trim(), resultados, citas, busquedas, costoUsd: costoTokens + costoBusq, modelo };
}

/**
 * Búsqueda web en capas. Si NINGÚN motor responde (sin red, bloqueos), lanza
 * ErrorBuscador: no es "falta de resultados" y el agente no debe reintentar.
 */
export async function buscar(consultaTexto: string, max = 8, region = "co-es", op: OpcionesBusqueda = {}): Promise<ResultadoBusqueda[]> {
  const q = consultaTexto.trim(); if (!q) return [];
  const motor = op.motor || "auto";
  const clave = `b|${motor}|${op.reciente || ""}|${max}|${region}|${q.toLowerCase()}`;
  const enCache = await cacheLeer<ResultadoBusqueda[]>(clave);
  if (enCache?.length) return enCache;
  const vence = op.reciente === "dia" ? 60 : op.reciente ? 180 : 12 * 60;
  if (motor === "claude") {
    const r = await buscarConClaude(q, { maxUsos: 2, agenteId: op.agenteId });
    const out = r.resultados.slice(0, max);
    if (out.length) await cacheGuardar(clave, out, vence);
    return out;
  }
  const sx = await buscarSearx(q, max, op);
  if (sx?.length) { await sumarUso("searxng", { n: 1 }); await cacheGuardar(clave, sx, vence); return sx; }
  let falloGratis: ErrorBuscador | null = null;
  try {
    const r = await buscarRespaldo(q, max, region, op.reciente);
    if (r.length) { await sumarUso("respaldo", { n: 1 }); const out = r.map((x) => ({ ...x, motor: x.motor || "respaldo" })); await cacheGuardar(clave, out, vence); return out; }
    if (sx) return [];          // SearXNG respondió vacío y los otros también: de verdad no hay resultados
  } catch (e) { if (!(e instanceof ErrorBuscador)) throw e; falloGratis = e; await sumarUso("respaldo", { fallos: 1 }); }
  if (motor === "auto" && claudeBusquedaActiva()) {
    try { const r = await buscarConClaude(q, { maxUsos: 1, agenteId: op.agenteId }); const out = r.resultados.slice(0, max); if (out.length) await cacheGuardar(clave, out, vence); return out; }
    catch (e) { if (!(e instanceof ErrorBuscador)) console.warn("[web] claude:", (e as any)?.message || e); }
  }
  if (falloGratis) throw falloGratis;
  return [];
}

// ── Lectura con navegador para páginas que se arman con JavaScript ──────────
/** ¿La descarga simple trajo solo el "cascarón" de una app JavaScript? */
export function pareceAppJs(html: string, textoLimpio: string): boolean {
  if (textoLimpio.length > 1200) return false;
  const scripts = (html.match(/<script\b/gi) || []).length;
  return /id=["'](root|app|__next|__nuxt|svelte)["']|data-reactroot|ng-version|<noscript>[^<]*(javascript|JavaScript)/.test(html) || (scripts >= 5 && textoLimpio.length < 600);
}
function fechaDeHtml(html: string): string | undefined {
  const m = html.match(/(?:article:(?:modified|published)_time|og:updated_time|dateModified|datePublished)["']?\s*(?:content=|:)\s*["'](\d{4}-\d{2}-\d{2})/i);
  return m?.[1];
}
let navegador: any = null, navegadorUsado = 0;
async function htmlRenderizado(url: string): Promise<{ html: string; url: string; via: "lightpanda" | "chromium" }> {
  const { chromium } = await import("playwright");
  const cdp = process.env.LIGHTPANDA_URL ?? "http://127.0.0.1:9222";
  if (cdp) {
    let b: any = null;
    try {
      b = await chromium.connectOverCDP(cdp, { timeout: 5000 });
      const ctx = b.contexts()[0] || await b.newContext(); const page = await ctx.newPage();
      await page.goto(url, { waitUntil: "networkidle", timeout: 25_000 }).catch(async () => { await page.waitForTimeout(1500); });
      const html = await page.content(); const final = page.url();
      await page.close().catch(() => {});
      if (html && html.length > 500) return { html, url: final, via: "lightpanda" };
    } catch { /* Lightpanda apagado o no pudo con la página → Chromium */ }
    finally { await b?.close().catch(() => {}); }
  }
  if (!navegador) navegador = await chromium.launch({ headless: true });
  navegadorUsado = Date.now();
  const ctx = await navegador.newContext({ userAgent: UA, locale: "es-CO" });
  try {
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 }).catch(async () => { await page.waitForTimeout(2000); });
    return { html: await page.content(), url: page.url(), via: "chromium" };
  } finally {
    await ctx.close().catch(() => {});
    setTimeout(() => { if (navegador && Date.now() - navegadorUsado > 110_000) { navegador.close().catch(() => {}); navegador = null; } }, 120_000).unref?.();
  }
}

/** Lee una URL (HTML, texto o PDF) → texto limpio. Si la página es una app JavaScript, la abre en un navegador. */
export async function leer(url: string, maxChars = 12000, op: { renderizar?: boolean; frescoMin?: number; sinCache?: boolean } = {}): Promise<PaginaLeida> {
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;
  const clave = `l|${op.renderizar ? "r" : ""}|${maxChars}|${url}`;
  const enCache = op.sinCache ? null : await cacheLeer<PaginaLeida>(clave);
  if (enCache) return enCache;
  let p: (PaginaLeida & { html?: string }) | null = null, errorSimple: any = null;
  if (!op.renderizar) { try { p = await leerSimple(url, maxChars); } catch (e) { errorSimple = e; } }
  const necesitaNavegador = op.renderizar || !p || (p.html !== undefined && pareceAppJs(p.html, p.texto)) || (!!p && [403, 429, 503].includes((p as any).status) && p.texto.length < 1500);
  if (necesitaNavegador && (process.env.SOGA_NAVEGADOR || "true") !== "false") {
    try {
      const r = await htmlRenderizado(url);
      const l = limpiarHtml(r.html);
      if (l.texto.length > (p?.texto.length || 0)) {
        const recortado = l.texto.length > maxChars;
        p = { titulo: l.titulo || url, url: r.url, texto: recortado ? l.texto.slice(0, maxChars) + "\n\n[... recortado]" : l.texto, enlaces: l.enlaces, caracteres: l.texto.length, recortado, via: r.via, fecha: fechaDeHtml(r.html) };
      }
    } catch (e) { if (!p) throw errorSimple || e; }
  }
  if (!p) throw errorSimple || new Error(`No pude leer ${url}`);
  const { html: _h, status: _s, ...limpio } = p as any;
  await cacheGuardar(clave, limpio, op.frescoMin ?? 6 * 60);
  return limpio;
}

/** Estado de los motores y uso de hoy (para web_estado y el panel). */
export async function estadoMotores() {
  const [searx, lightpanda] = await Promise.all([searxDisponible(), (async () => {
    const u = process.env.LIGHTPANDA_URL ?? "http://127.0.0.1:9222"; if (!u) return false;
    try { const r = await fetch(`${u.replace(/^ws/, "http")}/json/version`, { signal: AbortSignal.timeout(3000) }); return r.ok; } catch { return false; }
  })()]);
  const uso = await consulta<{ motor: string; n: number; fallos: number; costo: string }>(`SELECT motor, n, fallos, costo FROM web_uso WHERE dia = $1`, [hoyBogota()]).catch(() => []);
  const [mes] = await consulta<{ costo: string }>(`SELECT COALESCE(sum(costo),0) AS costo FROM web_uso WHERE dia >= date_trunc('month', now())`).catch(() => [{ costo: "0" }] as any);
  return { searx, lightpanda, claude: claudeBusquedaActiva(), brave: !!process.env.BRAVE_SEARCH_API_KEY, topeClaude: topeClaudeDia(), uso, costoMes: Number(mes?.costo || 0) };
}
