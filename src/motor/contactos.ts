// ARCHIVO: src/motor/contactos.ts
// ─────────────────────────────────────────────────────────────────────────────
//  AGENDA DE CONTACTOS Y ENVÍOS DE LYRA
//  Cada contacto tiene número, apodos ("mi tío"), relación, tono y PERMISO:
//    • pedir_ok (por defecto): todo mensaje espera el OK del jefe
//    • libre: gente de confianza, Lyra le escribe directo
//    • bloqueado: nunca se le escribe
//  Cada contacto está conectado a su persona en el cerebro (lo que Lara sabe).
//  Cada mensaje enviado queda registrado con su estado (entregado/leído/falló).
// ─────────────────────────────────────────────────────────────────────────────
import { query } from "../db/cliente.js";

export type Permiso = "pedir_ok" | "libre" | "bloqueado";
export interface Contacto { id: string; nombre: string; apodos: string[]; numero: string | null; relacion: string | null; permiso: Permiso; tono: string | null; notas: string | null; persona_slug: string | null; ultimo_contacto: string | null }

/** Solo dígitos con indicativo. Celulares de Colombia sin indicativo (3xx…, 10 dígitos) → 57. */
export function normalizarNumero(n: string | null | undefined): string | null {
  let d = String(n || "").replace(/\D/g, "");
  if (!d) return null;
  if (d.startsWith("00")) d = d.slice(2);
  if (d.length === 10 && d.startsWith("3")) d = `57${d}`;
  return d.length >= 8 && d.length <= 15 ? d : null;
}
const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
export const esJefe = (numero: string) => { const j = normalizarNumero(process.env.WHATSAPP_NUMERO_JEFE); return !!j && normalizarNumero(numero)?.slice(-10) === j.slice(-10); };

export async function contactoPorNumero(numero: string): Promise<Contacto | null> {
  const n = normalizarNumero(numero); if (!n) return null;
  const [c] = await query<Contacto>(`SELECT * FROM contactos WHERE right(numero, 10) = right($1, 10) LIMIT 1`, [n]);
  return c || null;
}

/** Busca por nombre, apodo o relación ("Juan", "mi tío", "la de compras"). Devuelve los candidatos, el mejor primero. */
export async function buscarContactos(texto: string): Promise<Contacto[]> {
  const n = normalizarNumero(texto);
  if (n && /^\+?[\d\s()-]{8,}$/.test(texto.trim())) { const c = await contactoPorNumero(n); return c ? [c] : []; }
  const q = norm(texto).replace(/^((a|al|mi|mis|el|la|los|las|de|del|un|una) )+/, "");
  if (!q) return [];
  const xs = await query<Contacto & { pts: number; exacto: boolean }>(`SELECT c.*,
      (translate(lower(nombre), 'áéíóúñ', 'aeioun') = $1 OR EXISTS (SELECT 1 FROM unnest(apodos) a WHERE translate(lower(a), 'áéíóúñ', 'aeioun') IN ($1, 'mi ' || $1))) AS exacto, (
      CASE WHEN translate(lower(nombre), 'áéíóúñ', 'aeioun') = $1 THEN 10 ELSE 0 END
    + CASE WHEN EXISTS (SELECT 1 FROM unnest(apodos) a WHERE translate(lower(a), 'áéíóúñ', 'aeioun') IN ($1, 'mi ' || $1)) THEN 9 ELSE 0 END
    + CASE WHEN translate(lower(nombre), 'áéíóúñ', 'aeioun') LIKE $1 || '%' THEN 5 ELSE 0 END
    + CASE WHEN translate(lower(nombre), 'áéíóúñ', 'aeioun') LIKE '%' || $1 || '%' THEN 3 ELSE 0 END
    + CASE WHEN EXISTS (SELECT 1 FROM unnest(apodos) a WHERE translate(lower(a), 'áéíóúñ', 'aeioun') LIKE '%' || $1 || '%') THEN 3 ELSE 0 END
    + CASE WHEN translate(lower(coalesce(relacion, '')), 'áéíóúñ', 'aeioun') LIKE '%' || $1 || '%' THEN 2 ELSE 0 END) AS pts
    FROM contactos c ORDER BY pts DESC, ultimo_contacto DESC NULLS LAST LIMIT 5`, [q]);
  const top = xs.filter((x) => x.pts > 0);
  // Si uno coincide exacto (nombre o apodo) y ningún otro, solo ese.
  const exactos = top.filter((x) => x.exacto);
  return exactos.length === 1 ? exactos : top;
}

export async function guardarContacto(p: { nombre: string; numero?: string | null; apodos?: string[]; relacion?: string | null; permiso?: Permiso; tono?: string | null; notas?: string | null }): Promise<{ contacto: Contacto; nuevo: boolean }> {
  const numero = p.numero ? normalizarNumero(p.numero) : null;
  if (p.numero && !numero) throw new Error(`"${p.numero}" no parece un número válido (con indicativo, p. ej. 573001234567).`);
  if (numero && esJefe(numero)) throw new Error("Ese es tu propio número.");
  const [ya] = numero ? await query<Contacto>(`SELECT * FROM contactos WHERE right(numero, 10) = right($1, 10)`, [numero]) : await query<Contacto>(`SELECT * FROM contactos WHERE lower(nombre) = lower($1) LIMIT 1`, [p.nombre]);
  const apodos = [...new Set([...(ya?.apodos || []), ...(p.apodos || [])].map((a) => a.trim()).filter(Boolean))];
  const [c] = ya
    ? await query<Contacto>(`UPDATE contactos SET nombre = $2, numero = COALESCE($3, numero), apodos = $4, relacion = COALESCE($5, relacion), permiso = COALESCE($6, permiso), tono = COALESCE($7, tono), notas = COALESCE($8, notas), actualizado_en = now() WHERE id = $1 RETURNING *`,
        [ya.id, p.nombre, numero, apodos, p.relacion ?? null, p.permiso ?? null, p.tono ?? null, p.notas ?? null])
    : await query<Contacto>(`INSERT INTO contactos (nombre, numero, apodos, relacion, permiso, tono, notas) VALUES ($1,$2,$3,$4,COALESCE($5,'pedir_ok'),$6,$7) RETURNING *`,
        [p.nombre, numero, apodos, p.relacion ?? null, p.permiso ?? null, p.tono ?? null, p.notas ?? null]);
  // Su persona en el cerebro (carpeta personal, cifrada): así Lara y Lyra saben lo mismo de ella.
  try {
    const { guardarRecuerdo } = await import("./cerebro.js");
    const r = await guardarRecuerdo({ slug: c.persona_slug || undefined, titulo: `${c.nombre}${c.relacion ? `, ${c.relacion}` : ""}`, contenido: [`${c.nombre}${c.relacion ? ` (${c.relacion})` : ""}.`, c.numero ? `WhatsApp: ${c.numero}.` : "", c.apodos.length ? `Le dice: ${c.apodos.join(", ")}.` : "", c.tono ? `Tono para escribirle: ${c.tono}.` : "", c.notas || ""].filter(Boolean).join(" "),
      clase: "persona", espacio: "personal", importancia: 0.6, confianza: 0.95, origenRef: `contacto:${c.id}`, etiquetas: ["contacto"] });
    if (!c.persona_slug) await query(`UPDATE contactos SET persona_slug = $2 WHERE id = $1`, [c.id, r.nodo.slug]);
    c.persona_slug = r.nodo.slug;
  } catch (e: any) { console.warn("[contactos] no pude conectarlo al cerebro:", e?.message || e); }
  return { contacto: c, nuevo: !ya };
}

export type Destino = { tipo: "contacto"; contacto: Contacto } | { tipo: "numero"; numero: string } | { tipo: "ambiguo"; opciones: Contacto[] } | { tipo: "desconocido"; texto: string };
/** "Juan", "mi tío", "573001234567" → a quién va. */
export async function resolverDestino(para: string): Promise<Destino> {
  const xs = await buscarContactos(para);
  if (xs.length === 1) return { tipo: "contacto", contacto: xs[0] };
  if (xs.length > 1) return { tipo: "ambiguo", opciones: xs };
  const n = normalizarNumero(para);
  if (n && /\d{7,}/.test(para.replace(/\D/g, ""))) return { tipo: "numero", numero: n };
  return { tipo: "desconocido", texto: para };
}
export const describir = (c: Contacto) => `${c.nombre}${c.relacion ? ` (${c.relacion})` : ""}${c.numero ? ` · ${c.numero}` : ""}`;

export interface Envio { ok: boolean; id?: string; error?: string; viaPlantilla?: boolean; salienteId?: string }
/** Manda de verdad (el permiso ya se resolvió antes: OK del jefe o contacto libre) y lo registra. */
export async function enviarA(numero: string, contenido: { texto?: string; archivoId?: string; audio?: { buffer: Buffer; mime: string }; enAudio?: boolean }, op: { contacto?: Contacto | null; conversacionId?: string | null; gestionId?: string | null; seguimientoHoras?: number; seguimiento?: "recordarle" | "avisarme"; tipo?: string } = {}): Promise<Envio> {
  const W = await import("../whatsapp/enviar.js");
  const plantilla = process.env.WHATSAPP_PLANTILLA_TERCEROS || process.env.WHATSAPP_PLANTILLA_AVISO || "recordatorio_emilia";
  let r: { ok: boolean; id?: string; error?: string; viaPlantilla?: boolean } = { ok: false, error: "Nada que enviar." };
  let tipo = "texto";
  if (contenido.archivoId) {
    const { leerArchivo } = await import("../dominio/archivos.js");
    const a = await leerArchivo(contenido.archivoId).catch(() => null);
    if (!a) return { ok: false, error: "No encuentro ese archivo." };
    if (a.meta.mime.startsWith("image/")) { r = await W.enviarImagenWhatsapp(numero, a.contenido, a.meta.mime, contenido.texto); tipo = "imagen"; }
    else { r = await W.enviarDocumentoWhatsapp(numero, a.contenido, a.meta.nombre, a.meta.mime, contenido.texto); tipo = "documento"; }
  } else if (contenido.enAudio && contenido.texto) {
    // Nota de voz: el texto aprobado se convierte en audio (queda registrado el texto).
    const { sintetizar, prepararTexto } = await import("./voz.js");
    const v = await sintetizar(prepararTexto(contenido.texto));
    if (!v.ok || !v.audio) return { ok: false, error: `No pude generar la nota de voz: ${v.error}` };
    r = await W.enviarAudioWhatsapp(numero, v.audio.contenido, v.audio.mime); tipo = "audio";
  } else if (contenido.audio) {
    r = await W.enviarAudioWhatsapp(numero, contenido.audio.buffer, contenido.audio.mime); tipo = "audio";
  } else if (contenido.texto) r = await W.enviarTextoWhatsapp(numero, contenido.texto, { plantilla });
  if (!r.ok) return { ok: false, error: r.error };
  const [s] = await query<{ id: string }>(`INSERT INTO mensajes_salientes (contacto_id, numero, tipo, texto, wamid, conversacion_id, gestion_id, seguimiento_en, seguimiento) VALUES ($1,$2,$3,$4,$5,$6,$7, CASE WHEN $8::float > 0 THEN now() + make_interval(secs => $8::float * 3600) END, $9) RETURNING id`,
    [op.contacto?.id ?? null, numero, op.tipo || (r.viaPlantilla ? "plantilla" : tipo), contenido.texto ?? null, r.id ?? null, op.conversacionId ?? null, op.gestionId ?? null, op.seguimientoHoras ?? 0, op.seguimientoHoras ? op.seguimiento || "avisarme" : null]);
  if (op.contacto) await query(`UPDATE contactos SET ultimo_contacto = now() WHERE id = $1`, [op.contacto.id]);
  return { ok: true, id: r.id, viaPlantilla: r.viaPlantilla, salienteId: s.id };
}

/** Arranque: los números que ya estaban en las personas del cerebro pasan a la agenda (pedir_ok). Idempotente. */
export async function migrarContactosDelCerebro(): Promise<number> {
  const { abrirResumen } = await import("./cifrado.js");
  const xs = await query<any>(`SELECT n.id, n.slug, n.titulo, n.resumen, n.cifrado FROM bib_nodos n WHERE n.clase = 'persona' AND n.borrado_en IS NULL
    AND NOT EXISTS (SELECT 1 FROM contactos c WHERE c.persona_slug = n.slug) LIMIT 2000`).catch(() => []);
  let n = 0;
  for (const x of xs) {
    const t = await abrirResumen(x);
    const m = t.match(/(?:\+?57[\s-]?)?3\d{2}[\s-]?\d{3}[\s-]?\d{4}\b|\+\d[\d\s-]{9,16}\d/);
    const numero = m ? normalizarNumero(m[0]) : null;
    if (!numero || esJefe(numero) || (await contactoPorNumero(numero))) continue;
    const nombre = String(x.titulo).split(/[,(—-]/)[0].trim().slice(0, 80) || "Sin nombre";
    await query(`INSERT INTO contactos (nombre, numero, persona_slug) VALUES ($1,$2,$3) ON CONFLICT (numero) DO NOTHING`, [nombre, numero, x.slug]);
    n++;
  }
  if (n) console.log(`[contactos] ${n} contacto(s) pasados del cerebro a la agenda (todos en "pedir OK").`);
  return n;
}
