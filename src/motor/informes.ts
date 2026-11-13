// ARCHIVO: src/motor/informes.ts
// ─────────────────────────────────────────────────────────────────────────────
//  VERIFICACIÓN, INFORMES E HISTORIAL de Soga.
//   • contrastar(): para cada afirmación clave, lee sus fuentes y comprueba
//     que de verdad lo digan (cifras y palabras), cuántos sitios
//     INDEPENDIENTES lo confirman y de cuándo es → certeza alta/media/baja.
//   • crearInforme(): informe en PDF bien presentado (resumen, secciones,
//     tabla comparativa con recomendación, fuentes con fecha, certeza).
//   • registrarInvestigacion(): historial con fuentes, certeza y costo.
// ─────────────────────────────────────────────────────────────────────────────
import { query } from "../db/cliente.js";
import { leer } from "./web.js";

// ════════════════════════════ CONTRASTAR FUENTES ══════════════════════════════
const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
/** Dominio "dueño" (dos sitios del mismo dueño no cuentan como independientes): docs.x.com y x.com → x.com; y.gov.co → y.gov.co. */
export function dominioRaiz(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    if (/^\d+(\.\d+){3}$/.test(host) || host.includes(":")) return host;   // IP: tal cual
    const h = host.split(".");
    const sld = h[h.length - 2] || "";
    return (h.length >= 3 && h[h.length - 1].length === 2 && /^(com|gov|edu|org|net|co|ac|gob|mil)$/.test(sld) ? h.slice(-3) : h.slice(-2)).join(".");
  } catch { return url; }
}
/** Cifras de un texto como números (4.500.000 / 4,5 / 0.10 / 11x / 2026). */
export function cifras(t: string): number[] {
  const out: number[] = [];
  for (const m of t.matchAll(/\d+(?:[.,]\d+)*/g)) {
    let s = m[0];
    if (/^\d{1,3}([.,]\d{3})+$/.test(s)) s = s.replace(/[.,]/g, "");                 // separador de miles
    else s = s.replace(/[.,](?=\d{3}[.,])/g, "").replace(",", ".");                    // decimales con coma
    const n = Number(s); if (!isNaN(n)) out.push(n);
  }
  return [...new Set(out)];
}
const PALABRAS_VACIAS = new Set(["para", "como", "sobre", "entre", "desde", "hasta", "este", "esta", "estos", "tiene", "tienen", "puede", "pueden", "cuesta", "cada", "tambien", "pero", "with", "that", "this", "from", "have", "más", "mas", "the", "and"]);
const claves = (t: string) => [...new Set(norm(t).split(/[^a-z0-9ñ]+/).filter((w) => w.length >= 4 && !/^\d+$/.test(w) && !PALABRAS_VACIAS.has(w)))];

export interface ResultadoFuente { url: string; dominio: string; fecha?: string; dice: "confirma" | "no_aparece" | "cifra_distinta" | "no_cargo"; detalle: string }
export interface Contraste { afirmacion: string; certeza: "alta" | "media" | "baja"; confirman: number; dominios: string[]; fuentes: ResultadoFuente[]; razon: string }

export async function contrastar(afirmaciones: { texto: string; urls: string[] }[]): Promise<Contraste[]> {
  const out: Contraste[] = [];
  for (const a of afirmaciones) {
    const nums = cifras(a.texto), ks = claves(a.texto);
    const fuentes: ResultadoFuente[] = [];
    for (const url of [...new Set(a.urls)].slice(0, 6)) {
      const dominio = dominioRaiz(url);
      let p;
      try { p = await leer(url, 60_000); } catch (e: any) { fuentes.push({ url, dominio, dice: "no_cargo", detalle: String(e?.message || e).slice(0, 100) }); continue; }
      if (p.texto.trim().length < 80) { fuentes.push({ url, dominio, dice: "no_cargo", detalle: "la página está vacía o no existe" }); continue; }
      const texto = norm(p.texto), numsPagina = new Set(cifras(p.texto));
      const cobertura = ks.length ? ks.filter((k) => texto.includes(k)).length / ks.length : 1;
      const numsOk = nums.filter((n) => numsPagina.has(n));
      let dice: ResultadoFuente["dice"], detalle: string;
      if (cobertura >= 0.5 && numsOk.length === nums.length) { dice = "confirma"; detalle = nums.length ? `aparecen las cifras ${nums.join(", ")}` : `habla de lo mismo (${Math.round(cobertura * 100)} % de las palabras clave)`; }
      else if (cobertura >= 0.5 && nums.length) { dice = "cifra_distinta"; detalle = `habla de lo mismo pero no aparece ${nums.filter((n) => !numsPagina.has(n)).join(", ")}: revisa qué cifra da`; }
      else { dice = "no_aparece"; detalle = `no encontré eso en la página (${Math.round(cobertura * 100)} % de las palabras clave)`; }
      fuentes.push({ url: p.url, dominio, fecha: p.fecha, dice, detalle });
    }
    const confirman = fuentes.filter((f) => f.dice === "confirma");
    const dominios = [...new Set(confirman.map((f) => f.dominio))];
    const viejas = confirman.filter((f) => f.fecha && Date.now() - new Date(f.fecha).getTime() > 548 * 86400_000).length;
    const distinta = fuentes.some((f) => f.dice === "cifra_distinta");
    const certeza: Contraste["certeza"] = dominios.length >= 2 && !distinta && viejas < confirman.length ? "alta" : dominios.length >= 1 ? "media" : "baja";
    const razon = [
      dominios.length ? `lo confirman ${dominios.length} sitio(s) independiente(s): ${dominios.join(", ")}` : "ninguna fuente lo confirma",
      distinta ? "alguna fuente da otra cifra" : "", viejas ? `${viejas} fuente(s) de hace más de año y medio` : "",
    ].filter(Boolean).join("; ");
    out.push({ afirmacion: a.texto, certeza, confirman: dominios.length, dominios, fuentes, razon });
  }
  return out;
}

// ════════════════════════════════ INFORMES ════════════════════════════════════
export interface Fuente { url: string; titulo?: string; fecha?: string; nota?: string }
export interface DatosInforme {
  titulo: string; pregunta?: string; resumen: string;
  secciones?: { titulo: string; texto: string }[];
  comparativa?: { columnas: string[]; filas: { nombre: string; valores: string[]; recomendado?: boolean }[]; recomendacion?: string };
  fuentes: Fuente[]; certeza?: { nivel: "alta" | "media" | "baja"; razon: string }; autor?: string;
}
const esc = (s: string) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** Markdown mínimo: párrafos, viñetas, **negrita**, `código` y links. */
export function mdHtml(t: string): string {
  const linea = (s: string) => esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>').replace(/(^|\s)(https?:\/\/[^\s<]+)/g, '$1<a href="$2">$2</a>');
  const out: string[] = []; let lista: string[] = [];
  const cerrar = () => { if (lista.length) { out.push(`<ul>${lista.map((l) => `<li>${l}</li>`).join("")}</ul>`); lista = []; } };
  for (const bloque of String(t || "").split(/\n/)) {
    const b = bloque.trim();
    if (/^[-•*]\s+/.test(b)) { lista.push(linea(b.replace(/^[-•*]\s+/, ""))); continue; }
    cerrar(); if (b) out.push(/^#{1,4}\s/.test(b) ? `<h3>${linea(b.replace(/^#+\s*/, ""))}</h3>` : `<p>${linea(b)}</p>`);
  }
  cerrar(); return out.join("\n");
}
const fechaLarga = () => new Date().toLocaleDateString("es-CO", { timeZone: "America/Bogota", day: "numeric", month: "long", year: "numeric" });

export function htmlInforme(d: DatosInforme): string {
  const color = { alta: "#16a34a", media: "#d97706", baja: "#dc2626" };
  const cmp = d.comparativa;
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(d.titulo)}</title><style>
  @page { size: A4; margin: 18mm 16mm; }
  body { font-family: "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #1f2937; font-size: 10.5pt; line-height: 1.5; }
  .cab { border-bottom: 3px solid #38bdf8; padding-bottom: 8px; margin-bottom: 14px; }
  .cab h1 { font-size: 19pt; margin: 0 0 4px; color: #0c4a6e; } .meta { color: #6b7280; font-size: 9pt; }
  .pregunta { background: #f0f9ff; border-left: 4px solid #38bdf8; padding: 8px 12px; margin: 10px 0; font-style: italic; }
  .resumen { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px 14px; margin-bottom: 12px; }
  h2 { font-size: 12.5pt; color: #0c4a6e; margin: 16px 0 6px; border-bottom: 1px solid #e5e7eb; padding-bottom: 3px; } h3 { font-size: 11pt; margin: 10px 0 4px; }
  table { border-collapse: collapse; width: 100%; font-size: 9.5pt; margin: 6px 0; page-break-inside: avoid; }
  th { background: #0c4a6e; color: white; text-align: left; padding: 6px; } td { border-bottom: 1px solid #e5e7eb; padding: 6px; vertical-align: top; }
  tr.rec td { background: #ecfdf5; font-weight: 600; } .rec-et { color: #16a34a; font-size: 8.5pt; }
  .certeza { display: inline-block; padding: 3px 10px; border-radius: 12px; color: white; font-weight: 600; font-size: 9pt; }
  ol.fuentes { font-size: 9pt; padding-left: 18px; } ol.fuentes li { margin-bottom: 4px; word-break: break-all; }
  a { color: #0369a1; text-decoration: none; } code { background: #f1f5f9; padding: 0 3px; border-radius: 3px; }
  .pie { margin-top: 18px; color: #9ca3af; font-size: 8pt; border-top: 1px solid #e5e7eb; padding-top: 6px; }
  </style></head><body>
  <div class="cab"><h1>${esc(d.titulo)}</h1><div class="meta">${esc(d.autor || "Soga · investigación de Emilia")} · ${fechaLarga()}</div></div>
  ${d.pregunta ? `<div class="pregunta">${esc(d.pregunta)}</div>` : ""}
  <div class="resumen"><strong>En resumen</strong>${mdHtml(d.resumen)}</div>
  ${d.certeza ? `<p><span class="certeza" style="background:${color[d.certeza.nivel] || "#6b7280"}">Certeza ${esc(d.certeza.nivel)}</span> ${esc(d.certeza.razon)}</p>` : ""}
  ${cmp?.filas?.length ? `<h2>Comparativa</h2><table><thead><tr><th>Opción</th>${cmp.columnas.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>
    ${cmp.filas.map((f) => `<tr class="${f.recomendado ? "rec" : ""}"><td>${esc(f.nombre)}${f.recomendado ? '<br><span class="rec-et">✔ recomendado</span>' : ""}</td>${cmp.columnas.map((_, i) => `<td>${esc(f.valores[i] ?? "")}</td>`).join("")}</tr>`).join("")}
    </tbody></table>${cmp.recomendacion ? `<div class="resumen"><strong>Recomendación</strong>${mdHtml(cmp.recomendacion)}</div>` : ""}` : ""}
  ${(d.secciones || []).map((s) => `<h2>${esc(s.titulo)}</h2>${mdHtml(s.texto)}`).join("\n")}
  ${d.fuentes?.length ? `<h2>Fuentes</h2><ol class="fuentes">${d.fuentes.map((f) => `<li><a href="${esc(f.url)}">${esc(f.titulo || f.url)}</a>${f.fecha ? ` · ${esc(f.fecha)}` : ""}${f.nota ? ` — ${esc(f.nota)}` : ""}<br><span style="color:#6b7280">${esc(f.url)}</span></li>`).join("")}</ol>` : ""}
  <div class="pie">Informe generado por Soga a partir de las fuentes listadas. Los datos que cambian (precios, versiones) son de la fecha indicada.</div>
  </body></html>`;
}

export async function pdfDeHtml(html: string): Promise<Buffer> {
  const { chromium } = await import("playwright");
  const b = await chromium.launch({ headless: true });
  try {
    const page = await b.newPage();
    await page.setContent(html, { waitUntil: "load" });
    return Buffer.from(await page.pdf({ format: "A4", printBackground: true, displayHeaderFooter: true, headerTemplate: "<span></span>",
      footerTemplate: `<div style="font-size:7pt;color:#9ca3af;width:100%;text-align:center"><span class="pageNumber"></span> / <span class="totalPages"></span></div>`, margin: { top: "16mm", bottom: "16mm", left: "14mm", right: "14mm" } }));
  } finally { await b.close(); }
}

const nombreArchivo = (t: string) => `${norm(t).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "informe"}.pdf`;

export async function crearInforme(d: DatosInforme, op: { agenteId?: string | null; enviar?: boolean; caption?: string } = {}): Promise<{ archivoId: string; nombre: string; bytes: number; enviado: boolean; error?: string }> {
  const pdf = await pdfDeHtml(htmlInforme(d));
  const { guardarArchivo } = await import("../dominio/archivos.js");
  const a = await guardarArchivo({ nombre: nombreArchivo(d.titulo), mime: "application/pdf", contenido: pdf, origen: "generado", agenteId: op.agenteId ?? null });
  let enviado = false, error: string | undefined;
  if (op.enviar !== false && process.env.WHATSAPP_NUMERO_JEFE) {
    // Solo al jefe (los agentes no le escriben a terceros).
    const { enviarDocumentoWhatsapp } = await import("../whatsapp/enviar.js");
    const r: any = await enviarDocumentoWhatsapp(process.env.WHATSAPP_NUMERO_JEFE, pdf, a.nombre, "application/pdf", op.caption || `📄 ${d.titulo}`);
    enviado = !!r?.ok; if (!enviado) error = r?.error || "no se pudo enviar";
  }
  return { archivoId: a.id, nombre: a.nombre, bytes: pdf.length, enviado, error };
}

// ═══════════════════════════════ HISTORIAL ════════════════════════════════════
export async function registrarInvestigacion(p: { pregunta: string; respuesta: string; profundidad?: string; fuentes?: Fuente[]; certeza?: string; agenteId?: string | null; archivoId?: string | null }) {
  // Costo aproximado: lo gastado en búsquedas de Claude desde la investigación anterior (máx. 1 h atrás).
  const [c] = await query<{ c: string }>(`SELECT COALESCE(sum(costo_usd),0) AS c FROM consumo WHERE proveedor = 'anthropic_busqueda' AND creado_en > GREATEST(now() - interval '1 hour', COALESCE((SELECT max(creado_en) FROM soga_investigaciones), now() - interval '1 hour'))`).catch(() => [{ c: "0" }]);
  const [r] = await query<{ id: string }>(`INSERT INTO soga_investigaciones (pregunta, respuesta, profundidad, fuentes, certeza, agente_id, archivo_id, costo_usd) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [p.pregunta.slice(0, 1000), p.respuesta.slice(0, 8000), p.profundidad || null, JSON.stringify((p.fuentes || []).slice(0, 20)), p.certeza || null, p.agenteId ?? null, p.archivoId ?? null, Number(c?.c || 0)]);
  return r.id;
}
export async function historialInvestigaciones(op: { buscar?: string; dias?: number; max?: number } = {}) {
  return query<any>(`SELECT id, pregunta, respuesta, profundidad, certeza, fuentes, archivo_id, costo_usd, creado_en FROM soga_investigaciones
    WHERE creado_en > now() - make_interval(days => $1) AND ($2::text IS NULL OR pregunta ILIKE '%' || $2 || '%' OR respuesta ILIKE '%' || $2 || '%')
    ORDER BY creado_en DESC LIMIT $3`, [op.dias || 30, op.buscar || null, op.max || 10]);
}
