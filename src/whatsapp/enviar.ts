// ARCHIVO: src/whatsapp/enviar.ts
// ─────────────────────────────────────────────────────────────────────────────
//  CANAL WHATSAPP — cliente de la Cloud API de Meta
//  Texto, plantilla, documento (subida + envío) y descarga de adjuntos.
//  Las tools de src/tools/whatsapp.ts se construyen sobre esto; el canal
//  (entrega.ts, webhook.ts) también lo usa directo.
//  .env: WHATSAPP_TOKEN, WHATSAPP_PHONE_ID
// ─────────────────────────────────────────────────────────────────────────────

const VERSION_API = process.env.WHATSAPP_API_VERSION || "v21.0";
const GRAPH = `https://graph.facebook.com/${VERSION_API}`;

function config() {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_ID;
  if (!token || !phoneId) throw new Error("Falta WHATSAPP_TOKEN o WHATSAPP_PHONE_ID en el .env.");
  return { token, phoneId, urlMensajes: `${GRAPH}/${phoneId}/messages` };
}
const limpiar = (n: string) => String(n).replace(/\D/g, "");

export interface ResultadoEnvio { ok: boolean; id?: string; error?: string }

/**
 * ¿Los agentes pueden escribirle a este número por su cuenta? Solo al jefe y a
 * WHATSAPP_NUMEROS_PERMITIDOS (coma). WHATSAPP_PERMITIR_TERCEROS=true lo abre.
 * (Responderle a quien escribió no pasa por acá: eso lo hace el canal.)
 */
export function destinoPermitido(numero: string): boolean {
  if (process.env.WHATSAPP_PERMITIR_TERCEROS === "true") return true;
  const n = limpiar(numero).slice(-10);
  const ok = [process.env.WHATSAPP_NUMERO_JEFE || "", ...(process.env.WHATSAPP_NUMEROS_PERMITIDOS || "").split(",")].map((x) => limpiar(x).slice(-10)).filter(Boolean);
  return ok.includes(n);
}

/**
 * Ventana de 24 h de WhatsApp: fuera de ella Meta acepta el texto pero NUNCA lo
 * entrega. Se mira el último mensaje que esa persona nos escribió (a cualquier agente).
 */
async function ventanaAbierta(to: string): Promise<boolean> {
  try {
    const { query } = await import("../db/cliente.js");
    const [f] = await query<{ ultimo: string | null }>(
      `SELECT max(m.creado_en) AS ultimo FROM mensajes m JOIN conversaciones c ON c.id = m.conversacion_id
        WHERE c.canal = 'whatsapp' AND right(regexp_replace(c.contacto, '\D', '', 'g'), 10) = $1 AND m.rol = 'usuario'`, [to.slice(-10)]);
    return !!f?.ultimo && Date.now() - new Date(f.ultimo).getTime() < 23.5 * 3600_000;
  } catch { return true; }   // si no se puede saber, se intenta como texto
}

export async function enviarTextoWhatsapp(numero: string, texto: string): Promise<ResultadoEnvio> {
  const to = limpiar(numero);
  if (!to) return { ok: false, error: "Número vacío." };
  // Fuera de la ventana: va como plantilla aprobada (una variable con el texto en una línea).
  const plantilla = process.env.WHATSAPP_PLANTILLA_AVISO || "recordatorio_emilia";
  if (plantilla !== "ninguna" && !(await ventanaAbierta(to))) {
    const linea = texto.replace(/\s*\n+\s*/g, " · ").replace(/[\t]/g, " ").replace(/ {4,}/g, "   ").trim().slice(0, 900);
    const r = await enviarPlantillaWhatsapp(to, plantilla, linea, process.env.WHATSAPP_PLANTILLA_AVISO_IDIOMA || "es");
    if (r.ok) return r;
    console.warn(`[whatsapp] Fuera de la ventana de 24 h y la plantilla "${plantilla}" falló (${r.error}); intento como texto.`);
  }
  const partes = partir(texto, 4000);
  if (!partes.length) return { ok: false, error: "Texto vacío." };
  let ultimo: ResultadoEnvio = { ok: false };
  for (const p of partes) {
    ultimo = await postMensaje({ messaging_product: "whatsapp", to, type: "text", text: { body: p } });
    if (!ultimo.ok) return ultimo;
  }
  return ultimo;
}

export async function enviarPlantillaWhatsapp(numero: string, plantilla: string, variable?: string, idioma = "es"): Promise<ResultadoEnvio> {
  const componentes = variable ? [{ type: "body", parameters: [{ type: "text", text: variable }] }] : [];
  return postMensaje({
    messaging_product: "whatsapp", to: limpiar(numero), type: "template",
    template: { name: plantilla, language: { code: idioma }, ...(componentes.length ? { components: componentes } : {}) },
  });
}

/** Sube un archivo a Meta y lo manda como documento. */
export async function enviarDocumentoWhatsapp(numero: string, contenido: Buffer, nombre: string, mime: string, caption?: string): Promise<ResultadoEnvio> {
  const subida = await subirMedia(contenido, nombre, mime);
  if (!subida.ok) return subida;
  return postMensaje({
    messaging_product: "whatsapp", to: limpiar(numero), type: "document",
    document: { id: subida.id, filename: nombre, ...(caption ? { caption: caption.slice(0, 1000) } : {}) },
  });
}

/** Manda un audio (mp3/ogg) como mensaje de audio. */
export async function enviarAudioWhatsapp(numero: string, contenido: Buffer, mime = "audio/mpeg"): Promise<ResultadoEnvio> {
  const subida = await subirMedia(contenido, mime.includes("ogg") ? "audio.ogg" : "audio.mp3", mime);
  if (!subida.ok) return subida;
  return postMensaje({ messaging_product: "whatsapp", to: limpiar(numero), type: "audio", audio: { id: subida.id } });
}

export async function subirMedia(contenido: Buffer, nombre: string, mime: string): Promise<ResultadoEnvio> {
  let cfg; try { cfg = config(); } catch (e: any) { return { ok: false, error: e.message }; }
  try {
    const fd = new FormData();
    fd.append("messaging_product", "whatsapp");
    fd.append("type", mime);
    fd.append("file", new Blob([new Uint8Array(contenido)], { type: mime }), nombre);
    const resp = await fetch(`${GRAPH}/${cfg.phoneId}/media`, { method: "POST", headers: { Authorization: `Bearer ${cfg.token}` }, body: fd, signal: AbortSignal.timeout(60000) });
    const data: any = await resp.json().catch(() => ({}));
    if (!resp.ok) return { ok: false, error: data?.error?.message || `HTTP ${resp.status}` };
    return { ok: true, id: data.id };
  } catch (e: any) { return { ok: false, error: e?.message || String(e) }; }
}

/** Descarga un adjunto entrante por su media id. */
export async function descargarMedia(mediaId: string): Promise<{ ok: boolean; contenido?: Buffer; mime?: string; error?: string }> {
  let cfg; try { cfg = config(); } catch (e: any) { return { ok: false, error: e.message }; }
  try {
    const meta = await fetch(`${GRAPH}/${mediaId}`, { headers: { Authorization: `Bearer ${cfg.token}` }, signal: AbortSignal.timeout(20000) });
    const info: any = await meta.json().catch(() => ({}));
    if (!meta.ok || !info.url) return { ok: false, error: info?.error?.message || `No se pudo resolver el media ${mediaId}` };
    const bin = await fetch(info.url, { headers: { Authorization: `Bearer ${cfg.token}` }, signal: AbortSignal.timeout(120000) });
    if (!bin.ok) return { ok: false, error: `Descarga falló: HTTP ${bin.status}` };
    return { ok: true, contenido: Buffer.from(await bin.arrayBuffer()), mime: info.mime_type || bin.headers.get("content-type") || "application/octet-stream" };
  } catch (e: any) { return { ok: false, error: e?.message || String(e) }; }
}

async function postMensaje(body: unknown): Promise<ResultadoEnvio> {
  let cfg; try { cfg = config(); } catch (e: any) { return { ok: false, error: e.message }; }
  try {
    const resp = await fetch(cfg.urlMensajes, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.token}` },
      body: JSON.stringify(body), signal: AbortSignal.timeout(20000),
    });
    const data: any = await resp.json().catch(() => ({}));
    if (!resp.ok) return { ok: false, error: data?.error?.message || `HTTP ${resp.status}` };
    return { ok: true, id: data?.messages?.[0]?.id };
  } catch (e: any) { return { ok: false, error: e?.message || String(e) }; }
}

function partir(texto: string, max: number): string[] {
  const t = (texto || "").trim();
  if (!t) return [];
  if (t.length <= max) return [t];
  const partes: string[] = []; let resto = t;
  while (resto.length > max) {
    let corte = resto.lastIndexOf("\n", max);
    if (corte < max * 0.5) corte = resto.lastIndexOf(" ", max);
    if (corte < max * 0.5) corte = max;
    partes.push(resto.slice(0, corte).trim()); resto = resto.slice(corte).trim();
  }
  if (resto) partes.push(resto);
  return partes;
}