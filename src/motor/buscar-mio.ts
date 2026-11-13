// ARCHIVO: src/motor/buscar-mio.ts
// ─────────────────────────────────────────────────────────────────────────────
//  BUSCAR EN LO TUYO (Soga, solo lectura): correos, archivos (también dentro
//  de PDF/Word/Excel), conversaciones con los agentes (WhatsApp y panel),
//  agenda y biblioteca. "el correo donde el hospital habló del contrato",
//  "qué me dijo Valentina sobre X", "el PDF de la propuesta".
//  Nada se envía, se marca ni se cambia: solo se encuentra y se muestra.
// ─────────────────────────────────────────────────────────────────────────────
import fs from "node:fs/promises";
import { query } from "../db/cliente.js";
import { refCorreo } from "./correo.js";

export type Lugar = "correo" | "archivo" | "conversacion" | "agenda" | "biblioteca";
export const LUGARES: Lugar[] = ["correo", "archivo", "conversacion", "agenda", "biblioteca"];
export interface Hallazgo { donde: Lugar; ref: string; titulo: string; fecha: string | null; extracto: string; puntaje: number }

const VACIAS = new Set(["el", "la", "los", "las", "un", "una", "de", "del", "al", "que", "en", "con", "por", "para", "sobre", "donde", "dónde", "me", "mi", "mis", "lo", "le", "se", "y", "o", "a", "es", "fue", "qué", "cual", "cuál", "busca", "buscar", "encuentra", "correo", "mensaje", "archivo", "dijo", "habló", "hablo"]);
const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
export function palabrasClave(q: string): string[] {
  return [...new Set(norm(q).split(/[^a-z0-9ñ@._-]+/).filter((w) => w.length >= 3 && !VACIAS.has(w)))].slice(0, 8);
}
// Normalización en SQL igual a la de JS (minúsculas y sin tildes) sin depender de la extensión unaccent.
const N = (expr: string) => `translate(lower(${expr}), 'áéíóúüàèìòùâêîôûäëïöñ', 'aeiouuaeiouaeiouaeioñ')`;
/** Puntaje = cuántas palabras aparecen; exige la mayoría. Devuelve [expresión, mínimo, params]. */
function puntaje(campos: string[], ws: string[], desde: number): { expr: string; params: string[] } {
  const texto = N(`concat_ws(' ', ${campos.join(", ")})`);
  return { expr: ws.map((_, i) => `(CASE WHEN ${texto} LIKE '%' || $${desde + i} || '%' THEN 1 ELSE 0 END)`).join(" + ") || "0", params: ws };
}
export function extracto(texto: string | null | undefined, ws: string[], largo = 220): string {
  const t = String(texto || "").replace(/\s+/g, " ").trim(); if (!t) return "";
  const n = norm(t); let i = -1;
  for (const w of ws) { i = n.indexOf(w); if (i >= 0) break; }
  if (i < 0) return t.slice(0, largo);
  const ini = Math.max(0, i - 80);
  return `${ini > 0 ? "…" : ""}${t.slice(ini, ini + largo)}${ini + largo < t.length ? "…" : ""}`;
}

/** Extrae el texto de los archivos que aún no se han indexado (de a pocos, para no tardar). */
export async function indexarArchivos(max = 40): Promise<number> {
  const { textoDeDocumento } = await import("./texto-documento.js");
  const xs = await query<{ id: string; ruta: string; mime: string; nombre: string; tam_bytes: number }>(
    `SELECT id, ruta, mime, nombre, tam_bytes FROM archivos WHERE indexado_en IS NULL ORDER BY creado_en DESC LIMIT $1`, [max]);
  for (const a of xs) {
    let texto = "";
    if (a.tam_bytes <= 15 * 1024 * 1024 && !/^(image|audio|video)\//.test(a.mime)) {
      try { texto = (await textoDeDocumento(await fs.readFile(a.ruta), a.mime, a.nombre, 200_000)) || ""; } catch { /* archivo movido o ilegible */ }
    }
    await query(`UPDATE archivos SET texto = $2, indexado_en = now() WHERE id = $1`, [a.id, texto.slice(0, 200_000) || null]);
  }
  return xs.length;
}

export interface OpcionesMio { donde?: Lugar[]; desde?: string; hasta?: string; persona?: string; max?: number }
export async function buscarMio(consulta: string, op: OpcionesMio = {}): Promise<{ hallazgos: Hallazgo[]; palabras: string[] }> {
  const ws = palabrasClave(consulta);
  const donde = op.donde?.length ? op.donde : LUGARES;
  const max = op.max || 12;
  if (!ws.length && !op.persona) return { hallazgos: [], palabras: ws };
  const minimo = Math.max(1, Math.ceil(ws.length * 0.6));
  const desde = op.desde ? new Date(op.desde) : new Date("2000-01-01"), hasta = op.hasta ? new Date(`${op.hasta}T23:59:59-05:00`) : new Date("2999-01-01");
  const persona = op.persona ? `%${norm(op.persona)}%` : null;
  const todos: Hallazgo[] = [];

  if (donde.includes("correo")) {
    const p = puntaje(["asunto", "de_nombre", "de_correo", "para", "quien", "resumen", "texto"], ws, 5);
    const titulo = puntaje(["asunto", "de_nombre", "quien"], ws, 5);   // lo que dice de qué y de quién es pesa más
    const filas = await query<any>(`SELECT id, asunto, quien, de_nombre, de_correo, para, direccion, fecha, resumen, texto, adjuntos, (${p.expr}) + 0.5 * (${titulo.expr}) AS pts FROM correos
      WHERE fecha BETWEEN $1 AND $2 AND ($3::text IS NULL OR ${N("concat_ws(' ', de_nombre, de_correo, para, quien)")} LIKE $3) AND (${p.expr}) >= $4
      ORDER BY pts DESC, fecha DESC LIMIT $${5 + ws.length}`, [desde, hasta, persona, ws.length ? minimo : 0, ...p.params, max]);
    for (const f of filas) todos.push({ donde: "correo", ref: refCorreo(f.id), titulo: `${f.direccion === "enviado" ? `Tú → ${String(f.para || "").split("<")[0].trim()}` : f.quien || f.de_nombre || f.de_correo}: ${f.asunto || "(sin asunto)"}${(f.adjuntos || []).length ? ` 📎${f.adjuntos.length}` : ""}`, fecha: f.fecha, extracto: extracto(`${f.resumen || ""} ${f.texto || ""}`, ws), puntaje: Number(f.pts) + 0.5 });
  }
  if (donde.includes("archivo")) {
    await indexarArchivos().catch(() => 0);
    const p = puntaje(["nombre", "texto"], ws, 4);
    const filas = await query<any>(`SELECT id, nombre, mime, origen, creado_en, texto, ${p.expr} AS pts FROM archivos
      WHERE creado_en BETWEEN $1 AND $2 AND (${p.expr}) >= $3 ORDER BY pts DESC, creado_en DESC LIMIT $${4 + ws.length}`, [desde, hasta, ws.length ? minimo : 99, ...p.params, max]);
    for (const f of filas) todos.push({ donde: "archivo", ref: `archivo:${f.id.slice(0, 8)}`, titulo: `${f.nombre} (${f.origen})`, fecha: f.creado_en, extracto: extracto(f.texto, ws) || "(sin texto: imagen o audio)", puntaje: f.pts + 0.3 });
  }
  if (donde.includes("conversacion")) {
    const p = puntaje(["m.contenido"], ws, 4);
    const filas = await query<any>(`SELECT DISTINCT ON (m.conversacion_id) m.id, m.contenido, m.rol, m.creado_en, a.nombre AS agente, c.canal, ${p.expr} AS pts
      FROM mensajes m JOIN conversaciones c ON c.id = m.conversacion_id JOIN agentes a ON a.id = m.agente_id
      WHERE m.rol IN ('usuario','agente') AND m.creado_en BETWEEN $1 AND $2 AND (${p.expr}) >= $3
      ORDER BY m.conversacion_id, pts DESC, m.creado_en DESC LIMIT 60`, [desde, hasta, ws.length ? minimo : 99, ...p.params]);
    for (const f of filas.sort((a, b) => b.pts - a.pts || +new Date(b.creado_en) - +new Date(a.creado_en)).slice(0, max))
      todos.push({ donde: "conversacion", ref: `mensaje:${f.id.slice(0, 8)}`, titulo: `${f.rol === "usuario" ? "Tú" : f.agente} (${f.agente}, ${f.canal})`, fecha: f.creado_en, extracto: extracto(f.contenido, ws), puntaje: f.pts });
  }
  if (donde.includes("agenda")) {
    const p = puntaje(["titulo", "lugar", "notas"], ws, 4);
    const filas = await query<any>(`SELECT id, titulo, inicio, lugar, notas, tipo, estado, ${p.expr} AS pts FROM agenda
      WHERE COALESCE(inicio, creado_en) BETWEEN $1 AND $2 AND (${p.expr}) >= $3 ORDER BY pts DESC, inicio DESC NULLS LAST LIMIT $${4 + ws.length}`, [desde, hasta, ws.length ? minimo : 99, ...p.params, max]);
    for (const f of filas) todos.push({ donde: "agenda", ref: `agenda:${f.id.slice(0, 8)}`, titulo: `${f.titulo}${f.lugar ? ` (${f.lugar})` : ""} — ${f.tipo}, ${f.estado}`, fecha: f.inicio, extracto: extracto(f.notas, ws), puntaje: f.pts });
  }
  if (donde.includes("biblioteca")) {
    let filas: any[] = [];
    try { const { buscarSemantico } = await import("./biblioteca.js"); filas = (await buscarSemantico(consulta, 5)).filter((n: any) => n.score > 0.35).map((n: any) => ({ ...n, pts: 1 + n.score })); } catch { /* sin embeddings */ }
    if (!filas.length) {
      const p = puntaje(["titulo", "resumen", "ficha::text", "array_to_string(etiquetas, ' ')"], ws, 2);
      filas = await query<any>(`SELECT id, slug, titulo, resumen, ficha, estado, actualizado_en, ${p.expr} AS pts FROM bib_nodos WHERE borrado_en IS NULL AND (${p.expr}) >= $1 ORDER BY pts DESC LIMIT $${2 + ws.length}`, [ws.length ? minimo : 99, ...p.params, Math.min(max, 6)]);
    }
    for (const f of filas) todos.push({ donde: "biblioteca", ref: `nodo:${f.slug}`, titulo: `${f.titulo} (${f.estado})`, fecha: f.actualizado_en || null, extracto: extracto(f.resumen, ws), puntaje: f.pts });
  }
  todos.sort((a, b) => b.puntaje - a.puntaje || +new Date(b.fecha || 0) - +new Date(a.fecha || 0));
  return { hallazgos: todos.slice(0, max), palabras: ws };
}

/** Abre completo un hallazgo por su ref (#abcde, archivo:xxxx, mensaje:xxxx, agenda:xxxx, nodo:slug). Solo lectura. */
export async function verMio(ref: string, maxChars = 8000): Promise<{ titulo: string; texto: string } | null> {
  const r = ref.trim();
  if (/^#?[0-9a-f]{5,}$/i.test(r)) {
    const [c] = await query<any>(`SELECT * FROM correos WHERE id::text LIKE $1 || '%' ORDER BY fecha DESC LIMIT 1`, [r.replace("#", "").toLowerCase()]);
    if (!c) return null;
    return { titulo: `${c.direccion === "enviado" ? "Enviado a" : "De"} ${c.direccion === "enviado" ? c.para : `${c.de_nombre || ""} <${c.de_correo}>`} · ${new Date(c.fecha).toLocaleString("es-CO", { timeZone: "America/Bogota" })}\nAsunto: ${c.asunto}`,
      texto: `${c.resumen ? `Resumen: ${c.resumen}\n\n` : ""}${String(c.texto || "").slice(0, maxChars)}${(c.adjuntos || []).length ? `\n\nAdjuntos: ${c.adjuntos.map((x: any) => x.nombre).join(", ")}` : ""}` };
  }
  const [tipo, id] = r.split(":");
  if (tipo === "archivo") {
    const [a] = await query<any>(`SELECT * FROM archivos WHERE id::text LIKE $1 || '%' LIMIT 1`, [id]);
    if (!a) return null;
    if (!a.indexado_en) { await indexarArchivos(1).catch(() => 0); }
    const [b] = await query<any>(`SELECT texto FROM archivos WHERE id = $1`, [a.id]);
    return { titulo: `${a.nombre} (${a.mime}, ${Math.round(a.tam_bytes / 1024)} KB, ${a.origen}) · id ${a.id}`, texto: String(b?.texto || "(sin texto legible)").slice(0, maxChars) };
  }
  if (tipo === "mensaje") {
    const [m] = await query<any>(`SELECT * FROM mensajes WHERE id::text LIKE $1 || '%' LIMIT 1`, [id]);
    if (!m) return null;
    const ctx = await query<any>(`SELECT * FROM (
        (SELECT m.rol, m.contenido, m.creado_en, a.nombre FROM mensajes m JOIN agentes a ON a.id = m.agente_id WHERE m.conversacion_id = $1 AND m.rol IN ('usuario','agente') AND m.creado_en <= $2 ORDER BY m.creado_en DESC LIMIT 4)
        UNION ALL
        (SELECT m.rol, m.contenido, m.creado_en, a.nombre FROM mensajes m JOIN agentes a ON a.id = m.agente_id WHERE m.conversacion_id = $1 AND m.rol IN ('usuario','agente') AND m.creado_en > $2 ORDER BY m.creado_en ASC LIMIT 3)
      ) x ORDER BY creado_en`, [m.conversacion_id, m.creado_en]);
    return { titulo: `Conversación del ${new Date(m.creado_en).toLocaleString("es-CO", { timeZone: "America/Bogota" })}`, texto: ctx.map((x) => `${x.rol === "usuario" ? "Tú" : x.nombre} (${new Date(x.creado_en).toLocaleTimeString("es-CO", { timeZone: "America/Bogota", hour: "numeric", minute: "2-digit" })}): ${String(x.contenido).slice(0, 1200)}`).join("\n\n").slice(0, maxChars) };
  }
  if (tipo === "agenda") {
    const [g] = await query<any>(`SELECT * FROM agenda WHERE id::text LIKE $1 || '%' LIMIT 1`, [id]);
    return g ? { titulo: `${g.titulo} (${g.tipo}, ${g.estado})`, texto: `Cuándo: ${g.inicio ? new Date(g.inicio).toLocaleString("es-CO", { timeZone: "America/Bogota" }) : "sin fecha"}${g.lugar ? `\nDónde: ${g.lugar}` : ""}${g.notas ? `\n${g.notas}` : ""}` } : null;
  }
  if (tipo === "nodo") {
    const [n] = await query<any>(`SELECT * FROM bib_nodos WHERE slug = $1 AND borrado_en IS NULL`, [id]);
    return n ? { titulo: `${n.titulo} (${n.tipo}, ${n.estado}, confianza ${Math.round(n.confianza * 100)} %)`, texto: `${n.resumen}\n\n${JSON.stringify(n.ficha, null, 1).slice(0, maxChars)}` } : null;
  }
  return null;
}
