// ARCHIVO: src/tools/voz.ts
import type { DefTool } from "../registro/tipos.js";
import { sintetizar, transcribir } from "../motor/voz.js";
import { enviarAudioWhatsapp } from "../whatsapp/enviar.js";
import { leerArchivo, guardarArchivo } from "../dominio/archivos.js";

const MODULO = "voz";

export const vozHablar: DefTool = {
  nombre: "voz_hablar", modulo: MODULO,
  descripcion: "Convierte un texto a voz y lo manda como audio de WhatsApp a un número. Para avisos importantes o cuando el jefe pide que le hables.",
  parametros: { type: "object", properties: { numero: { type: "string", description: "Número con código de país, solo dígitos.", minLength: 8 }, texto: { type: "string", description: "Lo que va a decir (natural, sin markdown).", minLength: 1, maxLength: 1500 } }, required: ["numero", "texto"] },
  riesgo: "ejecucion", requiereAprobacion: false, timeoutSeg: 90,
  async ejecutar(a) {
    const v = await sintetizar(a.texto);
    if (!v.ok || !v.audio) return { ok: false, error: v.error };
    const r = await enviarAudioWhatsapp(a.numero, v.audio.contenido, v.audio.mime);
    return r.ok ? { ok: true, resumen: `Audio enviado a ${a.numero} (${v.proveedor}).` } : { ok: false, error: r.error };
  },
};

export const vozTranscribir: DefTool = {
  nombre: "voz_transcribir", modulo: MODULO,
  descripcion: "Transcribe un archivo de audio ya recibido (por archivo_id) a texto.",
  parametros: { type: "object", properties: { archivo_id: { type: "string", minLength: 8 }, idioma: { type: "string", default: "es" } }, required: ["archivo_id"] },
  riesgo: "lectura", requiereAprobacion: false, timeoutSeg: 120,
  async ejecutar(a) {
    const { meta, contenido } = await leerArchivo(a.archivo_id);
    const t = await transcribir(contenido, meta.mime, a.idioma || "es");
    return t.ok ? { ok: true, datos: { texto: t.texto }, resumen: t.texto } : { ok: false, error: t.error };
  },
};

export const vozGenerarAudio: DefTool = {
  nombre: "voz_generar_audio", modulo: MODULO,
  descripcion: "Genera un archivo de audio a partir de un texto y lo guarda (devuelve archivo_id) sin enviarlo.",
  parametros: { type: "object", properties: { texto: { type: "string", minLength: 1, maxLength: 1500 } }, required: ["texto"] },
  riesgo: "lectura", requiereAprobacion: false, timeoutSeg: 90,
  async ejecutar(a, ctx) {
    const v = await sintetizar(a.texto);
    if (!v.ok || !v.audio) return { ok: false, error: v.error };
    const arch = await guardarArchivo({ nombre: v.audio.nombre, mime: v.audio.mime, contenido: v.audio.contenido, origen: "generado", conversacionId: ctx.conversacionId ?? null, agenteId: ctx.agenteId });
    return { ok: true, datos: { archivo_id: arch.id }, resumen: `Audio generado (archivo_id ${arch.id}).` };
  },
};

export const toolsVoz: DefTool[] = [vozHablar, vozTranscribir, vozGenerarAudio];