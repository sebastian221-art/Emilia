// ARCHIVO: src/motor/web.ts
// ─────────────────────────────────────────────────────────────────────────────
//  WEB — buscar y leer internet sin navegador ni claves.
//  buscar(): DuckDuckGo HTML (gratis, sin API). Resultados con título, url y
//  resumen. leer(): descarga una página y la deja en texto limpio (sin menús,
//  scripts ni estilos), con título y enlaces principales. Soporta HTML y PDF
//  (texto) y respeta un límite de tamaño. Si DuckDuckGo falla, cae a Bing HTML.
// ─────────────────────────────────────────────────────────────────────────────

export interface ResultadoBusqueda { titulo: string; url: string; resumen: string; fuente: string }
export interface PaginaLeida { titulo: string; url: string; texto: string; enlaces: { texto: string; href: string }[]; caracteres: number; recortado: boolean }

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
      try { const nombreMod = "pdf-parse"; const mod: any = await import(nombreMod); const parse = mod.default || mod; const d = await parse(buf); texto = String(d.text || ""); } catch { texto = "(PDF: no pude extraer texto; falta el paquete pdf-parse → npm install pdf-parse)"; }
      return { ok: r.ok, status: r.status, texto, tipo: "pdf", urlFinal: r.url || url };
    }
    const cuerpo = Buffer.from(await r.arrayBuffer());
    if (cuerpo.subarray(0, 5).toString("latin1") === "%PDF-") {   // PDF servido sin content-type ni extensión
      let texto = "";
      try { const nombreMod = "pdf-parse"; const mod: any = await import(nombreMod); const parse = mod.default || mod; const d = await parse(cuerpo); texto = String(d.text || ""); } catch { texto = "(PDF: no pude extraer texto; falta el paquete pdf-parse → npm install pdf-parse)"; }
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
export async function buscar(consulta: string, max = 8, region = "co-es"): Promise<ResultadoBusqueda[]> {
  const q = consulta.trim(); if (!q) return [];
  const clave = `${q}|${max}|${region}`; const c = cache.get(clave);
  if (c && Date.now() - c.t < 10 * 60000) return c.r;
  const espera = 1500 - (Date.now() - ultimaBusqueda); if (espera > 0) await new Promise((r) => setTimeout(r, espera));
  ultimaBusqueda = Date.now();
  const out: ResultadoBusqueda[] = [];
  let respondioAlguno = false;
  try { const b = await buscarBrave(q, max, region); if (b) { respondioAlguno = true; if (b.length) { cache.set(clave, { t: Date.now(), r: b }); return b; } } } catch (e: any) { if (!(e instanceof ErrorBuscador)) throw e; console.warn(`[web] ${e.message}`); }
  try {
    const r = await fetchTexto(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}&kl=${encodeURIComponent(region)}`, 20);
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
export async function leer(url: string, maxChars = 12000): Promise<PaginaLeida> {
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;
  const r = await fetchTexto(url, 25);
  if (!r.ok && !r.texto) throw new Error(`HTTP ${r.status} al leer ${url}`);
  let titulo = "", texto = "", enlaces: { texto: string; href: string }[] = [];
  if (r.tipo === "html") { const l = limpiarHtml(r.texto); titulo = l.titulo; texto = l.texto; enlaces = l.enlaces; }
  else { texto = r.texto.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim(); titulo = url; }
  const recortado = texto.length > maxChars;
  return { titulo: titulo || url, url: r.urlFinal, texto: recortado ? texto.slice(0, maxChars) + "\n\n[... recortado]" : texto, enlaces, caracteres: texto.length, recortado };
}