// ARCHIVO: src/tools/whatsapp.ts
// ─────────────────────────────────────────────────────────────────────────────
//  TOOLS DE WHATSAPP
//  Acciones que el agente decide hacer (escribirle a alguien, mandar un
//  archivo). Responder al contacto de la conversación NO es una tool: lo hace
//  el canal con la respuesta final del agente.
// ─────────────────────────────────────────────────────────────────────────────

import type { DefTool } from "../registro/tipos.js";
import { enviarTextoWhatsapp, enviarPlantillaWhatsapp, enviarDocumentoWhatsapp } from "../whatsapp/enviar.js";
import { leerArchivo, archivosDeConversacion, archivosRecientes } from "../dominio/archivos.js";

const MODULO = "whatsapp";
const NUMERO = { type: "string" as const, description: "Número con código de país, solo dígitos (ej. 573001234567). Si el pedido dice 'a mí' o 'al jefe', usá el número del jefe que aparece en tu contexto.", minLength: 8 };

export const whatsappEnviarTexto: DefTool = {
  nombre: "whatsapp_enviar_texto",
  modulo: MODULO,
  descripcion: "Envía un mensaje de texto por WhatsApp a un número. Solo funciona si ese número escribió en las últimas 24 h; si no, usá whatsapp_enviar_plantilla.",
  parametros: { type: "object", properties: { numero: NUMERO, texto: { type: "string", description: "Texto del mensaje.", minLength: 1 } }, required: ["numero", "texto"] },
  riesgo: "ejecucion",
  requiereAprobacion: false,
  async ejecutar(a) {
    const r = await enviarTextoWhatsapp(a.numero, a.texto);
    return r.ok ? { ok: true, datos: { id: r.id }, resumen: `Mensaje enviado a ${a.numero}.` } : { ok: false, error: r.error };
  },
};

export const whatsappEnviarPlantilla: DefTool = {
  nombre: "whatsapp_enviar_plantilla",
  modulo: MODULO,
  descripcion: "Envía una plantilla aprobada de WhatsApp (sirve fuera de la ventana de 24 h). Por defecto usa 'recordatorio_emilia' con una variable de texto.",
  parametros: {
    type: "object",
    properties: {
      numero: NUMERO,
      variable: { type: "string", description: "Texto que va en la variable del cuerpo de la plantilla.", minLength: 1 },
      plantilla: { type: "string", description: "Nombre de la plantilla.", default: "recordatorio_emilia" },
      idioma: { type: "string", description: "Código de idioma de la plantilla.", default: "es" },
    },
    required: ["numero", "variable"],
  },
  riesgo: "ejecucion",
  requiereAprobacion: false,
  async ejecutar(a) {
    const r = await enviarPlantillaWhatsapp(a.numero, a.plantilla || "recordatorio_emilia", a.variable, a.idioma || "es");
    return r.ok ? { ok: true, datos: { id: r.id }, resumen: `Plantilla ${a.plantilla || "recordatorio_emilia"} enviada a ${a.numero}.` } : { ok: false, error: r.error };
  },
};

export const whatsappEnviarDocumento: DefTool = {
  nombre: "whatsapp_enviar_documento",
  modulo: MODULO,
  descripcion: "Envía un archivo (Excel, PDF, CSV…) por WhatsApp. El archivo se identifica por su archivo_id (lo devuelven las tools que generan archivos, o whatsapp_listar_adjuntos).",
  parametros: {
    type: "object",
    properties: {
      numero: NUMERO,
      archivo_id: { type: "string", description: "Id del archivo a enviar.", minLength: 8 },
      caption: { type: "string", description: "Texto que acompaña al archivo (opcional)." },
    },
    required: ["numero", "archivo_id"],
  },
  riesgo: "ejecucion",
  requiereAprobacion: false,
  timeoutSeg: 120,
  async ejecutar(a) {
    const { meta, contenido } = await leerArchivo(a.archivo_id);
    const r = await enviarDocumentoWhatsapp(a.numero, contenido, meta.nombre, meta.mime, a.caption);
    return r.ok ? { ok: true, datos: { id: r.id, nombre: meta.nombre }, resumen: `Archivo "${meta.nombre}" enviado a ${a.numero}.` } : { ok: false, error: r.error };
  },
};

export const whatsappListarAdjuntos: DefTool = {
  nombre: "whatsapp_listar_adjuntos",
  modulo: MODULO,
  descripcion: "Lista los archivos recibidos recientemente (adjuntos de WhatsApp o generados). Devuelve archivo_id, nombre, tipo y fecha. Usalo para encontrar la base que te mandaron.",
  parametros: { type: "object", properties: { limite: { type: "integer", description: "Cuántos listar.", default: 8, minimum: 1, maximum: 30 } }, required: [] },
  riesgo: "lectura",
  requiereAprobacion: false,
  async ejecutar(a, ctx) {
    const lista = ctx.conversacionId ? await archivosDeConversacion(ctx.conversacionId, a.limite || 8) : await archivosRecientes(a.limite || 8);
    const datos = lista.map((x) => ({ archivo_id: x.id, nombre: x.nombre, mime: x.mime, kb: Math.round(x.tam_bytes / 1024), origen: x.origen, fecha: x.creado_en }));
    return { ok: true, datos, resumen: datos.length ? `${datos.length} archivo(s): ${datos.map((d) => `${d.nombre} (${d.archivo_id.slice(0, 8)}…)`).join(", ")}` : "No hay archivos recientes." };
  },
};

export const toolsWhatsapp: DefTool[] = [whatsappEnviarTexto, whatsappEnviarPlantilla, whatsappEnviarDocumento, whatsappListarAdjuntos];