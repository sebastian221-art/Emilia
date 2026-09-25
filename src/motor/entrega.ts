// ARCHIVO: src/motor/entrega.ts
// ─────────────────────────────────────────────────────────────────────────────
//  ENTREGA
//  Única función para "hacerle llegar" al contacto lo que el agente respondió,
//  según el canal de la conversación. La usan el chat del panel, el webhook
//  de WhatsApp y la reanudación tras aprobaciones, así todos se comportan igual.
// ─────────────────────────────────────────────────────────────────────────────

import { obtenerConversacion, guardarMensajeEn, type Conversacion } from "../dominio/conversaciones.js";
import { enviarTextoWhatsapp } from "../whatsapp/enviar.js";
import type { ResultadoTarea } from "./loop.js";

/** Un texto suelto a la conversación (lo usan los flujos para reportar). */
export async function entregarTexto(convOId: Conversacion | string, texto: string): Promise<void> {
  const conv = typeof convOId === "string" ? await obtenerConversacion(convOId) : convOId;
  if (!conv || !texto.trim()) return;
  await guardarMensajeEn(conv, "agente", texto);
  if (conv.canal === "delegacion") {
    // Lo que el sub-agente dice le llega a quien delegó, por su propio canal.
    const padre = await obtenerConversacion(conv.contacto);
    if (padre) await entregarTexto(padre, texto);
    return;
  }
  if (conv.canal === "whatsapp") {
    const r = await enviarTextoWhatsapp(conv.contacto, texto);
    if (!r.ok) await guardarMensajeEn(conv, "sistema", `No se pudo enviar por WhatsApp: ${r.error}`);
  }
}

export async function entregarRespuesta(convOId: Conversacion | string, resultado: ResultadoTarea): Promise<void> {
  const conv = typeof convOId === "string" ? await obtenerConversacion(convOId) : convOId;
  if (!conv) return;

  const texto = (resultado.respuesta || "").trim() || "(sin respuesta)";
  await guardarMensajeEn(conv, "agente", texto);

  if (conv.canal === "delegacion") {
    const padre = await obtenerConversacion(conv.contacto);
    if (padre) await entregarTexto(padre, texto);
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