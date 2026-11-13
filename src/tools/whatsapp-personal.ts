// ARCHIVO: src/tools/whatsapp-personal.ts
// ─────────────────────────────────────────────────────────────────────────────
//  TU WHATSAPP PERSONAL (Lyra, por la pantalla de tu PC)
//  Revisar (solo lectura), responder en un chat (con tu OK y el texto exacto),
//  agendar lo que salió y configurar la revisión programada.
// ─────────────────────────────────────────────────────────────────────────────
import type { DefTool } from "../registro/tipos.js";
import { revisarWhatsappPersonal, responderEnWhatsappPersonal, itemDeRevision, agendarItem, configWaPersonal, guardarConfigWaPersonal } from "../motor/whatsapp-personal.js";
import { query } from "../db/cliente.js";

const MODULO = "whatsapp";

export const whatsappPersonalRevisar: DefTool = {
  nombre: "whatsapp_personal_revisar", modulo: MODULO,
  descripcion: "Lee el WhatsApp PERSONAL del jefe en su WhatsApp de escritorio (por la pantalla del PC, perfil de solo lectura) y le dice, por chat o grupo con mensajes sin leer, de qué hablan, si lo mencionan, la urgencia y qué sugiere: ignorar, responder (con borrador), agendar o leer. Opcional: solo un chat. Tarda unos minutos. Ojo: abrir los chats los marca como leídos.",
  parametros: { type: "object", properties: { chat: { type: "string", description: "Solo este chat o grupo (nombre como aparece en WhatsApp)." } } },
  riesgo: "lectura", requiereAprobacion: false, timeoutSeg: 900,
  async ejecutar(a, ctx) {
    try {
      const r = await revisarWhatsappPersonal({ origen: "jefe", agenteId: ctx?.agenteId ?? null, conversacionId: ctx?.conversacionId ?? null, soloChat: a.chat });
      return r.ok ? { ok: true, datos: { revision: r.revisionId, chats: r.items }, resumen: r.informe } : { ok: false, error: r.informe };
    } catch (e: any) { return { ok: false, error: `No pude leer tu WhatsApp: ${e?.message || e}` }; }
  },
};

async function objetivo(a: Record<string, any>): Promise<{ chat?: string; texto?: string; error?: string; item?: any }> {
  if (a.numero) {
    const it = await itemDeRevision(Number(a.numero));
    if (!it) return { error: `No hay un chat ${a.numero} en el último informe.` };
    const texto = String(a.texto || it.borrador || "").trim();
    return texto ? { chat: it.chat, texto, item: it } : { error: `Para «${it.chat}» no hay borrador: dime el texto.` };
  }
  if (!a.chat || !a.texto) return { error: "Necesito el chat (o su número en el informe) y el texto." };
  return { chat: String(a.chat), texto: String(a.texto) };
}

export const whatsappPersonalResponder: DefTool = {
  nombre: "whatsapp_personal_responder", modulo: MODULO,
  descripcion: "Responde en un chat del WhatsApp PERSONAL del jefe (por la pantalla del PC). El jefe aprueba el texto exacto y el chat; el sistema solo deja escribir ese texto (una vez) y el nombre del chat. 'numero' = el número del chat en el último informe (usa su borrador si no das texto).",
  parametros: { type: "object", properties: { numero: { type: "integer", minimum: 1 }, chat: { type: "string" }, texto: { type: "string", maxLength: 3000 } } },
  riesgo: "escritura", requiereAprobacion: true, timeoutSeg: 420,
  async necesitaAprobacion(a) { return !(await objetivo(a)).error; },
  async vistaAprobacion(a) {
    const o = await objetivo(a); if (o.error) return null;
    return `⏸ *¿Lo mando desde tu WhatsApp?*\nChat: *${o.chat}*\n───────────\n${o.texto}\n───────────\nLo escribo en tu WhatsApp de escritorio (una vez, verificando que es el chat correcto).\nResponde *ok* para enviarlo o *no* para cancelarlo.`;
  },
  async ejecutar(a, ctx) {
    const o = await objetivo(a); if (o.error) return { ok: false, error: o.error };
    try {
      const r = await responderEnWhatsappPersonal(o.chat!, o.texto!, { agenteId: ctx?.agenteId ?? null, conversacionId: ctx?.conversacionId ?? null });
      if (o.item) await query(`UPDATE wa_personal_items SET estado = $2, borrador = $3 WHERE id = $1`, [o.item.id, r.ok ? "respondido" : "fallo", o.texto]);
      return r.ok ? { ok: true, resumen: `✅ Respondí en «${o.chat}».` } : { ok: false, error: `No quedó enviado: ${r.detalle}` };
    } catch (e: any) { return { ok: false, error: e?.message || String(e) }; }
  },
};

export const whatsappPersonalAgendar: DefTool = {
  nombre: "whatsapp_personal_agendar", modulo: MODULO,
  descripcion: "Pone en la agenda lo que salió de un chat del último informe de su WhatsApp (por su número en el informe).",
  parametros: { type: "object", properties: { numero: { type: "integer", minimum: 1 } }, required: ["numero"] },
  riesgo: "escritura", requiereAprobacion: false, timeoutSeg: 30,
  async ejecutar(a) {
    const it = await itemDeRevision(Number(a.numero)); if (!it) return { ok: false, error: `No hay un chat ${a.numero} en el último informe.` };
    return { ok: true, resumen: await agendarItem(it) };
  },
};

export const whatsappPersonalConfigurar: DefTool = {
  nombre: "whatsapp_personal_configurar", modulo: MODULO,
  descripcion: "Configura la revisión de su WhatsApp personal: horas de revisión automática (['09:00','13:00','19:00'], [] para apagarla), si incluye grupos, máximo de chats por revisión y chats silenciados (nunca se muestran).",
  parametros: { type: "object", properties: {
    horas: { type: "array", items: { type: "string" } }, incluir_grupos: { type: "boolean" }, max_chats: { type: "integer", minimum: 1, maximum: 40 },
    silenciar: { type: "array", items: { type: "string" } }, quitar_silencio: { type: "array", items: { type: "string" } },
  } },
  riesgo: "escritura", requiereAprobacion: false, timeoutSeg: 15,
  async ejecutar(a) {
    const actual = await configWaPersonal();
    if (a.horas && !a.horas.every((h: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(h))) return { ok: false, error: "Las horas van como HH:MM (24 h), p. ej. 09:00 o 19:30." };
    let sil = actual.silenciados;
    if (a.silenciar) sil = [...new Set([...sil, ...a.silenciar.map((x: string) => x.trim())])];
    if (a.quitar_silencio) sil = sil.filter((x) => !a.quitar_silencio.some((q: string) => q.toLowerCase() === x.toLowerCase()));
    const c = await guardarConfigWaPersonal({ horas: a.horas, incluir_grupos: a.incluir_grupos, max_chats: a.max_chats, silenciados: sil });
    return { ok: true, datos: c, resumen: `📱 Revisión de tu WhatsApp: ${c.horas.length ? `a las ${c.horas.join(", ")}` : "solo cuando me la pidas"} · ${c.incluir_grupos ? "con grupos" : "sin grupos"} · hasta ${c.max_chats} chats${c.silenciados.length ? ` · silenciados: ${c.silenciados.join(", ")}` : ""}.` };
  },
};

export const toolsWhatsappPersonal: DefTool[] = [whatsappPersonalRevisar, whatsappPersonalResponder, whatsappPersonalAgendar, whatsappPersonalConfigurar];
