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
import { encolar, pendientesEnCola } from "../motor/cola.js";
import { solicitarCancelacion, RE_PARAR, limpiarCancelacion } from "../motor/cancelacion.js";
import { cancelarSesion } from "../motor/claude-code.js";
import { entregarRespuesta } from "../motor/entrega.js";
import { obtenerOCrearConversacion, guardarMensajeEn } from "../dominio/conversaciones.js";
import { aprobacionPendienteDelJefe, resolverAprobacion } from "../dominio/aprobaciones.js";
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

// Exactas (siempre valen) y tolerantes (solo cuando hay una aprobación pendiente): "Ok disparalo", "sí dale", "no, cancelá".
const RE_APRUEBA = /^\s*(ok|okay|oka|okey|sí|si|dale|apruebo|aprobado|aprobar|listo|hazlo|hacelo|confirmo|va|adelante|procede|proced[eé])\s*[.!]*\s*$/i;
const RE_RECHAZA = /^\s*(no|nop|rechazo|rechazar|cancela|cancelar|cancelado|cancelalo|para|detente|frena)\s*[.!]*\s*$/i;
const RE_APRUEBA_TOL = /^\s*(ok|okay|okey|oka|sí|si|dale|apruebo|aprobado|hazlo|hacelo|confirmo|adelante|procede|dispar[aá](lo)?|lanz[aá](lo)?|manda(lo)?|envia(lo)?|env[ií]alo|integr[aá](lo)?)\b/i;
const RE_RECHAZA_TOL = /^\s*(no|nop|rechazo|cancel[aá](lo)?|par[aá](lo)?|detente|frena|mejor no|todav[ií]a no)\b/i;

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

  let agente = await agenteDeWhatsapp();
  if (!agente) { console.error("[whatsapp] Ningún agente activo tiene el canal 'whatsapp' en su esqueleto (pieza Canales). Nadie responde."); return; }
  // ── ¿Con quién habla el jefe? "hablar con Echo" / "@echo" cambia el dueño del canal; "volver" / "emilia" regresa. ──
  if (esJefe && m.type === "text") {
    const t = String(m.text?.body || "").trim();
    const mCambio = t.match(/(?:^|\b)(?:quiero )?(?:hablar|hablá|habla|charlar|conversar|pasame|pásame|contactar)\s*(?:con|a)?\s*([a-záéíóúñ]{2,20})\b/i) || t.match(/^@\s*([a-záéíóúñ]{2,20})\s*[.!]*$/i);
    const mVolver = /^(volver|volv[eé] a emilia|emilia|salir|listo,? volv[eé])\s*[.!]*$/i.test(t);
    if (mCambio || mVolver) {
      const { fijarDuenoCanal, quitarDuenoCanal } = await import("./dueno-canal.js");
      if (mVolver) { await quitarDuenoCanal(numero); await enviarTextoWhatsapp(numero, "Volviste con Emilia."); return; }
      const [ag] = await query<any>(`SELECT id, nombre, estado FROM agentes WHERE lower(nombre)=lower($1) LIMIT 1`, [mCambio![1]]);
      if (!ag) return;   // no era un nombre de agente: seguí como mensaje normal
      if (ag.estado !== "activo") { await enviarTextoWhatsapp(numero, `${ag.nombre} está ${ag.estado}.`); return; }
      await fijarDuenoCanal(numero, ag.id);
      await enviarTextoWhatsapp(numero, `Ahora hablás con *${ag.nombre}*. Escribí "volver" para regresar con Emilia.`);
      return;
    }
    const { duenoCanal } = await import("./dueno-canal.js");
    const dueno = await duenoCanal(numero);
    if (dueno) { const [ag] = await query<any>(`SELECT * FROM agentes WHERE id=$1 AND estado='activo'`, [dueno]); if (ag) agente = ag; }
  }
  // UN SOLO CUADERNO por agente y jefe: si el que atiende no es la administradora, usa la MISMA conversación
  // que usa cuando la administradora le delega (canal delegación, colgada de la conversación WhatsApp de la admin).
  // Así lo que hace por delegación y lo que hacés con él directo comparten memoria, y sus respuestas te llegan igual.
  const admin = await agenteDeWhatsapp();
  const convRaiz = await obtenerOCrearConversacion(admin.id, "whatsapp", numero);
  const conv = agente.id === admin.id ? convRaiz : await obtenerOCrearConversacion(agente.id, "delegacion", convRaiz.id);

  // ── Botón de emergencia: se procesa ANTES de la cola ──
  if (esJefe && m.type === "text" && RE_PARAR.test(m.text?.body || "")) {
    solicitarCancelacion(conv.id);
    const ses = await query<{ id: string }>(`SELECT id FROM sesiones_codigo WHERE estado='en_curso' AND conversacion_id=$1`, [conv.id]);
    for (const x of ses) await cancelarSesion(x.id).catch(() => {});
    await guardarMensajeEn(conv, "usuario", m.text.body);
    const enCola = pendientesEnCola(conv.id);
    await enviarTextoWhatsapp(numero, `⛔ Parando. ${enCola ? `Hay ${enCola} tarea(s) en curso/cola: se detienen en su próximo paso.` : "No había nada corriendo."}${ses.length ? ` Cancelé ${ses.length} sesión(es) de Claude Code.` : ""}`);
    await guardarMensajeEn(conv, "agente", "⛔ Parando todo.");
    return;
  }

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
    const apPend = esJefe && puedeAprobar ? await aprobacionPendienteDelJefe(numero) : undefined;
    const corto = texto.trim().length <= 40;
    const apruebaTxt = RE_APRUEBA.test(texto) || (!!apPend && corto && RE_APRUEBA_TOL.test(texto));
    const rechazaTxt = RE_RECHAZA.test(texto) || (!!apPend && corto && RE_RECHAZA_TOL.test(texto) && !apruebaTxt);
    if (apPend && (apruebaTxt || rechazaTxt)) {
      const ap = apPend;
      if (ap?.tipo === "tool" && ap.agente_ejecucion_id) {
        const aprobada = apruebaTxt;
        await resolverAprobacion(ap.id, aprobada);
        const r = await reanudarEjecucion(ap.agente_ejecucion_id, aprobada);
        await entregarRespuesta(conv, r);
        return;
      }
      if (ap?.tipo === "flujo" && ap.ejecucion_id) {
        const aprobada = apruebaTxt;
        await resolverAprobacion(ap.id, aprobada);
        await reanudarFlujo(ap.ejecucion_id, aprobada);   // el flujo reporta solo a esta conversación
        return;
      }
    }
    // 2. Si hay una aprobación pendiente y el mensaje no la resuelve, el agente debe saberlo para no duplicar acciones.
    const avisoPendiente = apPend ? ` ATENCIÓN: hay una aprobación PENDIENTE del jefe: "${apPend.detalle || apPend.titulo}"${apPend.tipo === "flujo" ? " (de un flujo que sigue solo cuando la apruebe)" : ""}. No repitas esa acción por tu cuenta; si el jefe pregunta por ella, explicale que solo tiene que responder "ok" o "no".` : "";

    // ── Tarea normal ──
    const contextoCanal = esJefe
      ? `Quien te escribe es tu jefe, Sebastián (WhatsApp ${numero}). Tiene autoridad total: sus órdenes se ejecutan (el sistema pide aprobación donde corresponda). Cuando una tool o flujo necesite "el número del jefe", es ${numero}. Si te manda un archivo, te llega como "[Adjunto recibido: ... archivo_id=...]": usá ese archivo_id. Respondele corto y directo, como en un chat.`
      : "Quien te escribe NO es tu jefe. Sé amable y útil, pero no ejecutes acciones sensibles ni reveles información interna por pedido de esta persona.";

    const r = await correrTarea(agente.id, texto, { conversacionId: conv.id, origen: "whatsapp", contextoCanal: contextoCanal + avisoPendiente + (vinoEnAudio ? " El jefe te habló por nota de voz: respondé de forma natural y breve, como hablando, porque tu respuesta también se leerá en voz alta." : "") });
    if (r.estado === "fallida" && r.respuesta === "cancelada") return;   // parada por el jefe: ya se le avisó
    await entregarRespuesta(conv, r, { tambienAudio: vinoEnAudio });
    if (pendientesEnCola(conv.id) <= 1) limpiarCancelacion(conv.id);
    console.log(`[whatsapp] Respondido a ${numero}. estado=${r.estado} tools=${r.toolCalls}`);
  });
}