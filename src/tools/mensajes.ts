// ARCHIVO: src/tools/mensajes.ts
// ─────────────────────────────────────────────────────────────────────────────
//  MENSAJES A TERCEROS (Lyra)
//  mensaje_enviar le escribe por WhatsApp a un contacto en nombre del jefe:
//    • contacto "libre" → va directo
//    • cualquier otro (o un número que no está en la agenda) → el jefe ve el
//      mensaje COMPLETO y a quién va, y responde ok / no
//    • "bloqueado" → nunca
//  Todo queda registrado con su estado (enviado, entregado, leído, falló).
// ─────────────────────────────────────────────────────────────────────────────
import type { DefTool } from "../registro/tipos.js";
import { query } from "../db/cliente.js";
import { resolverDestino, describir, enviarA, esJefe, guardarContacto, type Contacto } from "../motor/contactos.js";

const MODULO = "mensaje";

async function destinoDe(a: Record<string, any>): Promise<{ numero?: string; contacto?: Contacto | null; error?: string }> {
  const d = await resolverDestino(String(a.para || ""));
  if (d.tipo === "ambiguo") return { error: `"${a.para}" puede ser: ${d.opciones.map(describir).join(" | ")}. Pregúntale al jefe cuál.` };
  if (d.tipo === "desconocido") return { error: `No tengo a "${a.para}" en la agenda. Pídele el número al jefe (y guárdalo con contacto_guardar).` };
  if (d.tipo === "numero") return { numero: d.numero, contacto: null };
  if (d.contacto.permiso === "bloqueado") return { error: `${d.contacto.nombre} está bloqueado: no le escribo.` };
  if (!d.contacto.numero) return { error: `${d.contacto.nombre} no tiene número de WhatsApp guardado.` };
  return { numero: d.contacto.numero, contacto: d.contacto };
}

export const mensajeEnviar: DefTool = {
  nombre: "mensaje_enviar", modulo: MODULO,
  descripcion: "Le escribe por WhatsApp a un contacto en nombre del jefe (texto, y opcional un archivo). 'para' es el nombre, apodo o número. Si el contacto no es 'libre', el jefe ve el mensaje completo y lo aprueba antes de que salga. Escribe el mensaje tal cual lo va a leer la persona, en el tono de ese contacto, presentándote como la asistente de Sebastián si no te conoce. Opcional: seguimiento_horas para que te avise (o le recuerde) si no responde.",
  parametros: { type: "object", properties: {
    para: { type: "string", minLength: 2, description: "Nombre, apodo ('mi tío') o número con indicativo." },
    texto: { type: "string", minLength: 1, maxLength: 4000 },
    archivo_id: { type: "string", description: "Un archivo para adjuntar (el texto va como pie)." },
    en_audio: { type: "boolean", description: "Mandarlo como nota de voz (el texto se lee en voz alta)." },
    nombre: { type: "string", description: "Si 'para' es un número nuevo: nombre para guardarlo en la agenda." },
    seguimiento_horas: { type: "number", minimum: 0.25, maximum: 720, description: "Si no responde en este tiempo, hacer el seguimiento." },
    seguimiento: { type: "string", enum: ["avisarme", "recordarle"], description: "avisarme: avisarle al jefe. recordarle: proponer un recordatorio a la persona (con OK si no es libre)." },
  }, required: ["para", "texto"] },
  riesgo: "escritura", requiereAprobacion: true, timeoutSeg: 60,
  async necesitaAprobacion(a) {
    const d = await destinoDe(a);
    if (d.error) return false;                         // no va a salir nada: que el error llegue directo
    return d.contacto?.permiso !== "libre";
  },
  async vistaAprobacion(a) {
    const d = await destinoDe(a);
    if (d.error || !d.numero) return null;
    const { ventanaAbierta } = await import("../whatsapp/enviar.js");
    const abierta = await ventanaAbierta(d.numero);
    let adj = "";
    if (a.archivo_id) { const { obtenerArchivo } = await import("../dominio/archivos.js"); const f = await obtenerArchivo(String(a.archivo_id)).catch(() => null); adj = `📎 ${f?.nombre || a.archivo_id}`; }
    return [
      `⏸ *¿Le mando esto?*`,
      `Para: *${d.contacto ? describir(d.contacto) : `${a.nombre ? `${a.nombre} · ` : ""}${d.numero} (no está en tu agenda)`}*`,
      `───────────`, String(a.texto).slice(0, 3500), `───────────`, adj, a.en_audio ? "🎙 Va como nota de voz." : "",
      a.seguimiento_horas ? `⏰ Si no responde en ${a.seguimiento_horas} h: ${a.seguimiento === "recordarle" ? "le propongo un recordatorio" : "te aviso"}.` : "",
      abierta ? "" : `ℹ️ No te ha escrito en las últimas 24 h: WhatsApp obliga a mandarlo como plantilla (en una línea)${a.archivo_id ? " y el archivo puede no salir" : ""}.`,
      `Responde *ok* para enviarlo o *no* para cancelarlo (o dime qué cambio).`,
    ].filter(Boolean).join("\n");
  },
  async ejecutar(a, ctx) {
    const d = await destinoDe(a);
    if (d.error || !d.numero) return { ok: false, error: d.error || "Sin destino." };
    if (esJefe(d.numero)) return { ok: false, error: "Ese es el número del jefe: para escribirle a él no hace falta esta herramienta." };
    let contacto = d.contacto ?? null;
    if (!contacto && a.nombre) contacto = (await guardarContacto({ nombre: a.nombre, numero: d.numero }).catch(() => null))?.contacto ?? null;
    const r = await enviarA(d.numero, { texto: a.texto, archivoId: a.archivo_id, enAudio: !!a.en_audio }, { contacto, conversacionId: ctx?.conversacionId ?? null, seguimientoHoras: a.seguimiento_horas, seguimiento: a.seguimiento });
    if (!r.ok) return { ok: false, error: `No salió: ${r.error}` };
    return { ok: true, datos: { saliente: r.salienteId, wamid: r.id }, resumen: `✉️ Enviado a ${contacto ? contacto.nombre : d.numero}${r.viaPlantilla ? " (como plantilla, fuera de las 24 h)" : ""}. Te aviso cuando responda.` };
  },
};

// ── Envío a varios con UN solo OK ──
const personalizar = (t: string, c: Contacto | null) => t.replace(/\{nombre\}/g, c ? c.nombre.split(" ")[0] : "").replace(/\s+([,.!?])/g, "$1");
async function destinosLista(a: Record<string, any>) {
  const ok: { numero: string; contacto: Contacto | null }[] = [], errores: string[] = [];
  const vistos = new Set<string>();
  for (const p of (a.para || []) as string[]) {
    const d = await destinoDe({ para: p });
    if (d.error || !d.numero) { errores.push(d.error || p); continue; }
    if (esJefe(d.numero) || vistos.has(d.numero.slice(-10))) continue;
    vistos.add(d.numero.slice(-10)); ok.push({ numero: d.numero, contacto: d.contacto ?? null });
  }
  return { ok, errores };
}

export const mensajeEnviarLista: DefTool = {
  nombre: "mensaje_enviar_lista", modulo: MODULO,
  descripcion: "Manda el MISMO mensaje a varios contactos con un solo OK del jefe (una invitación, un aviso, un recordatorio de pago). Usa {nombre} en el texto para poner el primer nombre de cada uno. Si alguno no está en la agenda o es ambiguo, se avisa y no se manda a ese.",
  parametros: { type: "object", properties: {
    para: { type: "array", items: { type: "string" }, description: "Nombres, apodos o números." },
    texto: { type: "string", minLength: 1, maxLength: 3000 },
    seguimiento_horas: { type: "number", minimum: 0.25, maximum: 720 },
  }, required: ["para", "texto"] },
  riesgo: "escritura", requiereAprobacion: true, timeoutSeg: 300,
  async necesitaAprobacion(a) { const d = await destinosLista(a); return d.ok.length > 0 && d.ok.some((x) => x.contacto?.permiso !== "libre"); },
  async vistaAprobacion(a) {
    const d = await destinosLista(a); if (!d.ok.length) return null;
    const ej = d.ok[0];
    return [`⏸ *¿Le mando esto a ${d.ok.length} persona(s)?*`, d.ok.map((x) => `• ${x.contacto ? describir(x.contacto) : `${x.numero} (no está en tu agenda)`}`).join("\n"),
      `───────────`, personalizar(String(a.texto), ej.contacto).slice(0, 3000), `───────────`, /\{nombre\}/.test(a.texto) ? "(a cada uno con su nombre)" : "",
      d.errores.length ? `⚠️ No va a: ${d.errores.join(" · ")}` : "", `Responde *ok* para enviarlo o *no* para cancelarlo.`].filter(Boolean).join("\n");
  },
  async ejecutar(a, ctx) {
    const d = await destinosLista(a);
    if (!d.ok.length) return { ok: false, error: `No hay a quién mandarlo. ${d.errores.join(" · ")}` };
    const bien: string[] = [], mal: string[] = [];
    for (const x of d.ok) {
      const r = await enviarA(x.numero, { texto: personalizar(String(a.texto), x.contacto) }, { contacto: x.contacto, conversacionId: ctx?.conversacionId ?? null, seguimientoHoras: a.seguimiento_horas });
      (r.ok ? bien : mal).push(`${x.contacto?.nombre || x.numero}${r.ok ? "" : ` (${r.error})`}`);
      await new Promise((res) => setTimeout(res, 400));   // sin ráfagas
    }
    return { ok: bien.length > 0, datos: { enviados: bien, fallidos: mal }, resumen: `✉️ Enviado a ${bien.length}: ${bien.join(", ")}${mal.length ? `\n❌ Falló: ${mal.join(", ")}` : ""}${d.errores.length ? `\n⚠️ No se mandó: ${d.errores.join(" · ")}` : ""}`, ...(bien.length ? {} : { error: `No salió ninguno: ${mal.join(", ")}` }) };
  },
};

export const mensajeEstado: DefTool = {
  nombre: "mensaje_estado", modulo: MODULO,
  descripcion: "Los últimos mensajes que Lyra mandó a terceros y su estado (enviado, entregado, leído, falló, respondido). Opcional: solo los de un contacto.",
  parametros: { type: "object", properties: { para: { type: "string" }, limite: { type: "integer", minimum: 1, maximum: 50 } } },
  riesgo: "lectura", requiereAprobacion: false, timeoutSeg: 15,
  async ejecutar(a) {
    let filtro: string | null = null;
    if (a.para) { const d = await resolverDestino(a.para); filtro = d.tipo === "contacto" ? d.contacto.numero : d.tipo === "numero" ? d.numero : null; if (!filtro) return { ok: false, error: `No sé quién es "${a.para}".` }; }
    const xs = await query<any>(`SELECT s.*, c.nombre FROM mensajes_salientes s LEFT JOIN contactos c ON c.id = s.contacto_id
      WHERE ($1::text IS NULL OR right(s.numero, 10) = right($1, 10)) ORDER BY s.creado_en DESC LIMIT $2`, [filtro, a.limite ?? 10]);
    if (!xs.length) return { ok: true, datos: [], resumen: "No hay mensajes enviados a terceros." };
    const ic: Record<string, string> = { enviado: "✓", entregado: "✓✓", leido: "👁", fallido: "❌" };
    const f = (t: string) => new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(t));
    return { ok: true, datos: xs, resumen: xs.map((m) => `${ic[m.estado] || m.estado} ${f(m.creado_en)} → ${m.nombre || m.numero}: ${String(m.texto || `(${m.tipo})`).slice(0, 90)}${m.respondido_en ? " · respondió" : ""}${m.error ? ` · ${m.error}` : ""}`).join("\n") };
  },
};

export const mensajeRecibidos: DefTool = {
  nombre: "mensaje_recibidos", modulo: MODULO,
  descripcion: "Lo que le han escrito terceros al número de Emilia (últimas horas o de un contacto), con si ya se le avisó al jefe y la respuesta propuesta pendiente.",
  parametros: { type: "object", properties: { de: { type: "string", description: "Nombre, apodo o número." }, horas: { type: "number", minimum: 1, maximum: 720 } } },
  riesgo: "lectura", requiereAprobacion: false, timeoutSeg: 15,
  async ejecutar(a) {
    let filtro: string | null = null;
    if (a.de) { const d = await resolverDestino(a.de); filtro = d.tipo === "contacto" ? d.contacto.numero : d.tipo === "numero" ? d.numero : null; if (!filtro) return { ok: false, error: `No sé quién es "${a.de}".` }; }
    const xs = await query<any>(`SELECT t.*, c.nombre FROM mensajes_terceros t LEFT JOIN contactos c ON c.id = t.contacto_id
      WHERE t.creado_en > now() - make_interval(hours => $1) AND ($2::text IS NULL OR right(t.numero, 10) = right($2, 10)) ORDER BY t.creado_en DESC LIMIT 40`, [Math.round(a.horas ?? 24), filtro]);
    const ps = await query<any>(`SELECT p.*, c.nombre FROM lyra_propuestas p LEFT JOIN contactos c ON c.id = p.contacto_id WHERE p.estado = 'pendiente' ORDER BY creado_en DESC`);
    if (!xs.length && !ps.length) return { ok: true, datos: [], resumen: "Nadie ha escrito en ese tiempo." };
    const f = (t: string) => new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short" }).format(new Date(t));
    return { ok: true, datos: { recibidos: xs, propuestas: ps }, resumen: [...xs.map((m) => `${f(m.creado_en)} ${m.nombre || m.numero}: ${String(m.texto).slice(0, 140)}`), ...ps.map((p) => `💡 Respuesta propuesta para ${p.nombre || p.numero}: «${String(p.borrador).slice(0, 200)}»`)].join("\n") };
  },
};

export const mensajeConfigurar: DefTool = {
  nombre: "mensaje_configurar", modulo: MODULO,
  descripcion: "Cómo atiende Lyra a los terceros que escriben al número de Emilia: terceros = avisar (te avisa con una respuesta propuesta; por defecto), agente (el agente de WhatsApp les contesta solo, como antes) o ignorar. autorespuesta = lo que se le contesta una vez a un número desconocido (\"\" para no contestar nada).",
  parametros: { type: "object", properties: { terceros: { type: "string", enum: ["avisar", "agente", "ignorar"] }, autorespuesta: { type: "string", maxLength: 500 } } },
  riesgo: "escritura", requiereAprobacion: false, timeoutSeg: 15,
  async ejecutar(a) {
    const { guardarConfigIris } = await import("../motor/avisos.js");
    const { configLyra } = await import("../motor/terceros.js");
    const cambios: any = {};
    if (a.terceros) cambios.lyra_terceros = a.terceros;
    if (typeof a.autorespuesta === "string") cambios.lyra_autorespuesta = a.autorespuesta;
    if (Object.keys(cambios).length) await guardarConfigIris(cambios);
    const c = await configLyra();
    return { ok: true, datos: c, resumen: `Terceros: ${c.terceros === "avisar" ? "te aviso con una respuesta propuesta" : c.terceros === "agente" ? "el agente de WhatsApp les contesta" : "se ignoran"}. Desconocidos: ${c.autorespuesta.trim() ? `les respondo «${c.autorespuesta}»` : "no les respondo nada"}.` };
  },
};

export const toolsMensajes: DefTool[] = [mensajeEnviar, mensajeEnviarLista, mensajeEstado, mensajeRecibidos, mensajeConfigurar];
