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
      `───────────`, String(a.texto).slice(0, 3500), `───────────`, adj,
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
    const r = await enviarA(d.numero, { texto: a.texto, archivoId: a.archivo_id }, { contacto, conversacionId: ctx?.conversacionId ?? null, seguimientoHoras: a.seguimiento_horas, seguimiento: a.seguimiento });
    if (!r.ok) return { ok: false, error: `No salió: ${r.error}` };
    return { ok: true, datos: { saliente: r.salienteId, wamid: r.id }, resumen: `✉️ Enviado a ${contacto ? contacto.nombre : d.numero}${r.viaPlantilla ? " (como plantilla, fuera de las 24 h)" : ""}. Te aviso cuando responda.` };
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

export const toolsMensajes: DefTool[] = [mensajeEnviar, mensajeEstado];
