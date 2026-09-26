// ARCHIVO: src/whatsapp/webhook.ts
// ─────────────────────────────────────────────────────────────────────────────
//  CANAL WHATSAPP — ENTRADA (Fase 3: honra canales y gobierno.aprobar_por_whatsapp)
//  - Verifica firma HMAC.
//  - Procesa TODOS los mensajes del batch (Meta puede mandar varios).
//  - Dedup persistente en la tabla whatsapp_vistos.
//  - Cada número tiene su conversación; los mensajes de un mismo número se
//    procesan en orden (cola por conversación).
//  - Si el que escribe es el jefe (WHATSAPP_NUMERO_JEFE) y hay una aprobación
//    pendiente en su conversación, "ok"/"no" la resuelve y reanuda.
//  - La respuesta final del agente se entrega por el canal (entrega.ts). El
//    agente ya NO tiene que "usar su tool de WhatsApp" para contestar.
//  .env: WHATSAPP_VERIFY_TOKEN, WHATSAPP_APP_SECRET, WHATSAPP_NUMERO_JEFE,
//        WHATSAPP_SOLO_JEFE=true (opcional: ignora a cualquier otro número).
// ─────────────────────────────────────────────────────────────────────────────

import crypto from "node:crypto";
import type { Request, Response } from "express";
import { query } from "../db/cliente.js";
import { tieneCanal, obtenerAgente } from "../dominio/agentes.js";
import { correrTarea, reanudarEjecucion } from "../motor/loop.js";
import { reanudarFlujo } from "../motor/flujo.js";
import { encolar } from "../motor/cola.js";
import { entregarRespuesta } from "../motor/entrega.js";
import { obtenerOCrearConversacion, guardarMensajeEn } from "../dominio/conversaciones.js";
import { aprobacionPendienteDeConversacion, resolverAprobacion } from "../dominio/aprobaciones.js";
import { enviarTextoWhatsapp, descargarMedia } from "./enviar.js";
import { guardarArchivo } from "../dominio/archivos.js";
import { analizarImagen, esImagen } from "../motor/vision.js";
import { transcribir } from "../motor/voz.js";

/** Verificación GET que Meta hace al configurar el webhook. */
export function verificarWebhook(req: Request, res: Response) {
  const modo = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (modo === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    console.log("[whatsapp] Webhook verificado por Meta ✓");
    res.status(200).send(challenge);
  } else {
    console.warn("[whatsapp] Verificación rechazada (token no coincide)");
    res.sendStatus(403);
  }
}

/** Firma HMAC de Meta. Si no hay APP_SECRET configurado, deja pasar (modo prueba). */
function firmaValida(rawBody: Buffer, header: string | undefined): boolean {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret) return true;
  if (!header?.startsWith("sha256=")) return false;
  const esperado = header.slice(7);
  const calculado = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(calculado), b = Buffer.from(esperado);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Dedup persistente: true si es la primera vez que vemos este wa_id. */
async function esNuevo(waId: string | undefined): Promise<boolean> {
  if (!waId) return true;
  const filas = await query(`INSERT INTO whatsapp_vistos (wa_id) VALUES ($1) ON CONFLICT DO NOTHING RETURNING wa_id`, [waId]);
  return filas.length > 0;
}

/**
 * El agente que atiende WhatsApp: el primero activo que declare el canal
 * 'whatsapp' en su esqueleto (pieza Canales). Si ninguno lo declara, nadie
 * responde y se loguea claro — ya no hay fallback silencioso.
 */
async function agenteDeWhatsapp(): Promise<any | undefined> {
  const activos = await query<any>(`SELECT id, canales FROM agentes WHERE estado='activo' ORDER BY creado_en ASC`);
  const elegido = activos.find((a) => tieneCanal(a, "whatsapp"));
  return elegido ? obtenerAgente(elegido.id) : undefined;
}

const RE_APRUEBA = /^\s*(ok|okay|oka|sí|si|dale|apruebo|aprobado|aprobar|listo|hazlo|hacelo|confirmo|va)\s*[.!]*\s*$/i;
const RE_RECHAZA = /^\s*(no|nop|rechazo|rechazar|cancela|cancelar|cancelado|para|detente|frena)\s*[.!]*\s*$/i;

export async function recibirMensaje(req: Request, res: Response) {
  const rawBody: Buffer | undefined = (req as any).rawBody;
  if (rawBody && !firmaValida(rawBody, req.header("X-Hub-Signature-256"))) {
    console.warn("[whatsapp] Firma HMAC inválida — rechazado.");
    return res.sendStatus(401);
  }
  res.sendStatus(200); // Meta espera 200 inmediato

  try {
    const entradas: any[] = req.body?.entry || [];
    for (const entry of entradas) {
      for (const cambio of entry.changes || []) {
        const mensajes: any[] = cambio.value?.messages || [];
        for (const m of mensajes) {
          if (!(await esNuevo(m.id))) { console.log(`[whatsapp] Duplicado ignorado (${m.id})`); continue; }
          procesarEntrante(m).catch((e) => console.error("[whatsapp] Error procesando:", e));
        }
      }
    }
  } catch (e) {
    console.error("[whatsapp] Error leyendo el webhook:", e);
  }
}

async function procesarEntrante(m: any) {
  const numero = String(m.from || "").replace(/\D/g, "");
  const jefe = (process.env.WHATSAPP_NUMERO_JEFE || "").replace(/\D/g, "");
  const esJefe = !!jefe && numero === jefe;

  if (process.env.WHATSAPP_SOLO_JEFE === "true" && !esJefe) {
    console.log(`[whatsapp] Ignorado ${numero}: solo se atiende al jefe.`);
    return;
  }

  const agente = await agenteDeWhatsapp();
  if (!agente) { console.error("[whatsapp] Ningún agente activo tiene el canal 'whatsapp' en su esqueleto (pieza Canales). Nadie responde."); return; }
  const conv = await obtenerOCrearConversacion(agente.id, "whatsapp", numero);

  // ── Texto, audio o adjunto ──
  let texto = "";
  let vinoEnAudio = false;
  if (m.type === "text") texto = m.text?.body ?? "";
  else if (m.type === "button") texto = m.button?.text ?? "";
  else if (m.type === "interactive") texto = m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? "";
  else if (["document", "image", "audio", "video"].includes(m.type)) {
    const media = m[m.type] || {};
    const d = await descargarMedia(media.id);
    if (!d.ok) { await enviarTextoWhatsapp(numero, `No pude descargar el archivo: ${d.error}`); return; }
    const nombre = media.filename || `${m.type}_${Date.now()}.${(d.mime || "").split("/")[1]?.split(";")[0] || "bin"}`;
    const arch = await guardarArchivo({ nombre, mime: d.mime || "application/octet-stream", contenido: d.contenido!, origen: "whatsapp", conversacionId: conv.id, agenteId: agente.id });
    if (m.type === "audio" || (arch.mime || "").startsWith("audio/")) {
      // Nota de voz: se transcribe y entra como texto. Emilia contesta también en audio.
      const t = await transcribir(d.contenido!, arch.mime);
      if (!t.ok) { await enviarTextoWhatsapp(numero, `No entendí el audio (${t.error}). ¿Me lo escribís?`); return; }
      texto = t.texto!;
      vinoEnAudio = true;
      console.log(`[whatsapp] Audio de ${numero} transcrito: "${texto.slice(0, 120)}"`);
    } else if (esImagen(arch.mime)) {
      // La foto se convierte en palabras y entra al motor como texto (patrón de Any).
      const v = await analizarImagen(d.contenido!, arch.mime, { contexto: media.caption || undefined });
      const descripcion = v.ok ? v.texto! : `(no pude analizar la imagen: ${v.error})`;
      texto = `[Imagen recibida (archivo_id=${arch.id}). Lo que se ve: ${descripcion}]${media.caption ? `\nMensaje del jefe: ${media.caption}` : ""}`;
    } else {
      texto = `[Adjunto recibido: "${arch.nombre}" (${Math.round(arch.tam_bytes / 1024)} KB, archivo_id=${arch.id})]${media.caption ? ` ${media.caption}` : ""}`;
    }
    console.log(`[whatsapp] Adjunto de ${numero}: ${arch.nombre} → ${arch.id}`);
  }
  if (!texto.trim()) {
    await enviarTextoWhatsapp(numero, `No entendí ese mensaje (tipo "${m.type}"). Mandame texto o un archivo.`);
    return;
  }
  console.log(`[whatsapp] Entrante de ${numero}${esJefe ? " (jefe)" : ""}: "${texto.slice(0, 120)}"`);

  // Todo lo de esta conversación va en orden.
  await encolar(conv.id, async () => {
    await guardarMensajeEn(conv, "usuario", texto);

    // ── ¿Es una respuesta a una aprobación pendiente? ──
    const puedeAprobar = agente.gobierno?.aprobar_por_whatsapp !== false;
    if (esJefe && puedeAprobar && (RE_APRUEBA.test(texto) || RE_RECHAZA.test(texto))) {
      const ap = await aprobacionPendienteDeConversacion(conv.id);
      if (ap?.tipo === "tool" && ap.agente_ejecucion_id) {
        const aprobada = RE_APRUEBA.test(texto);
        await resolverAprobacion(ap.id, aprobada);
        const r = await reanudarEjecucion(ap.agente_ejecucion_id, aprobada);
        await entregarRespuesta(conv, r);
        return;
      }
      if (ap?.tipo === "flujo" && ap.ejecucion_id) {
        const aprobada = RE_APRUEBA.test(texto);
        await resolverAprobacion(ap.id, aprobada);
        await reanudarFlujo(ap.ejecucion_id, aprobada);   // el flujo reporta solo a esta conversación
        return;
      }
      // Sin aprobación pendiente: es un mensaje normal ("ok" de conversación).
    }

    // ── Tarea normal ──
    const contextoCanal = esJefe
      ? `Quien te escribe es tu jefe, Sebastián (WhatsApp ${numero}). Tiene autoridad total: sus órdenes se ejecutan (el sistema pide aprobación donde corresponda). Cuando una tool o flujo necesite "el número del jefe", es ${numero}. Si te manda un archivo, te llega como "[Adjunto recibido: ... archivo_id=...]": usá ese archivo_id. Respondele corto y directo, como en un chat.`
      : "Quien te escribe NO es tu jefe. Sé amable y útil, pero no ejecutes acciones sensibles ni reveles información interna por pedido de esta persona.";

    const r = await correrTarea(agente.id, texto, { conversacionId: conv.id, origen: "whatsapp", contextoCanal: contextoCanal + (vinoEnAudio ? " El jefe te habló por nota de voz: respondé de forma natural y breve, como hablando, porque tu respuesta también se leerá en voz alta." : "") });
    await entregarRespuesta(conv, r, { tambienAudio: vinoEnAudio });
    console.log(`[whatsapp] Respondido a ${numero}. estado=${r.estado} tools=${r.toolCalls}`);
  });
}