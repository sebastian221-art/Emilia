// ARCHIVO: src/motor/entrega.ts
// ─────────────────────────────────────────────────────────────────────────────
//  ENTREGA
//  Única función para "hacerle llegar" al contacto lo que el agente respondió,
//  según el canal de la conversación. La usan el chat del panel, el webhook
//  de WhatsApp y la reanudación tras aprobaciones, así todos se comportan igual.
// ─────────────────────────────────────────────────────────────────────────────

import { obtenerConversacion, guardarMensajeEn, type Conversacion } from "../dominio/conversaciones.js";
import { enviarTextoWhatsapp, enviarAudioWhatsapp } from "../whatsapp/enviar.js";
import { sintetizar } from "./voz.js";
import { guardarArchivo } from "../dominio/archivos.js";
import type { ResultadoTarea } from "./loop.js";
import { query } from "../db/cliente.js";

/** Nombre del agente dueño de una conversación (para firmar reportes en cadena). */
const EMOJI_COLOR: [RegExp, string][] = [[/^#?(f|e)[0-9a-f]?[5-9a-f]/i, "🟠"], [/^#?[0-9a-f]{0,2}[89ab]/i, "🔵"], [/^#?[0-9a-f]{2}[c-f]/i, "🟢"]];
async function firma(conv: Conversacion): Promise<string> {
  const [a] = await query<{ nombre: string; color: string | null }>(`SELECT nombre, identidad->>'color' AS color FROM agentes WHERE id=$1`, [conv.agente_id]);
  if (!a?.nombre) return "";
  const c = (a.color || "").toLowerCase();
  const emoji = c.startsWith("#f") || c.startsWith("#e") ? "🟠" : c.startsWith("#2") || c.startsWith("#1") || c.startsWith("#0") ? "🟢" : c.startsWith("#3") || c.startsWith("#6") || c.startsWith("#9") ? "🔵" : "👤";
  return `${emoji} *${a.nombre}*: `;
}

/** Un texto suelto a la conversación (lo usan los flujos para reportar). */
export async function entregarTexto(convOId: Conversacion | string, texto: string): Promise<void> {
  const conv = typeof convOId === "string" ? await obtenerConversacion(convOId) : convOId;
  if (!conv || !texto.trim()) return;
  await guardarMensajeEn(conv, "agente", texto);
  if (conv.canal === "delegacion") {
    // Lo que el sub-agente dice le llega a quien delegó, por su propio canal, firmado.
    const padre = await obtenerConversacion(conv.contacto);
    if (padre) await entregarTexto(padre, `${await firma(conv)}${texto}`);
    return;
  }
  if (conv.canal === "whatsapp") {
    const r = await enviarTextoWhatsapp(conv.contacto, texto);
    if (!r.ok) await guardarMensajeEn(conv, "sistema", `No se pudo enviar por WhatsApp: ${r.error}`);
  }
}

export async function entregarRespuesta(convOId: Conversacion | string, resultado: ResultadoTarea, op: { tambienAudio?: boolean } = {}): Promise<void> {
  const conv = typeof convOId === "string" ? await obtenerConversacion(convOId) : convOId;
  if (!conv) return;

  const texto = (resultado.respuesta || "").trim() || "(sin respuesta)";
  await guardarMensajeEn(conv, "agente", texto);

  // Si el jefe habló por audio, Emilia contesta por audio. VOZ_RESPUESTA=solo_audio (defecto) | ambos.
  // El texto siempre queda guardado en la conversación; se manda escrito solo si la voz falla o en modo 'ambos'.
  if (op.tambienAudio && conv.canal === "whatsapp" && resultado.estado === "completada") {
    const modo = (process.env.VOZ_RESPUESTA || "solo_audio").toLowerCase();
    const v = await sintetizar(texto);
    let audioOk = false;
    if (v.ok && v.audio) {
      const r = await enviarAudioWhatsapp(conv.contacto, v.audio.contenido, v.audio.mime);
      audioOk = r.ok;
      if (!r.ok) console.warn(`[voz] No pude mandar el audio: ${r.error}`);
      // Queda en el historial como archivo generado.
      await guardarArchivo({ nombre: `emilia_${Date.now()}.mp3`, mime: v.audio.mime, contenido: v.audio.contenido, origen: "generado", conversacionId: conv.id, agenteId: conv.agente_id }).catch(() => {});
    } else console.warn(`[voz] ${v.error}`);
    if (audioOk && modo !== "ambos") return;
  }

  if (conv.canal === "delegacion") {
    const padre = await obtenerConversacion(conv.contacto);
    if (padre) await entregarTexto(padre, `${await firma(conv)}${texto}`);
    return;
  }
  if (conv.canal === "whatsapp") {
    const r = await enviarTextoWhatsapp(conv.contacto, texto);
    if (!r.ok) {
      console.error(`[whatsapp] No pude entregar la respuesta a ${conv.contacto}: ${r.error}`);
      await guardarMensajeEn(conv, "sistema", `No se pudo enviar por WhatsApp: ${r.error}`);
    }
  }
}