// ARCHIVO: src/tools/gestiones.ts
// ─────────────────────────────────────────────────────────────────────────────
//  GESTIONES (Lyra): conversaciones con un objetivo. El jefe aprueba una vez
//  (a quién, qué lograr, los límites y el primer mensaje); Lyra sigue sola
//  dentro de esos límites y le pregunta lo que se salga.
// ─────────────────────────────────────────────────────────────────────────────
import type { DefTool } from "../registro/tipos.js";
import { query } from "../db/cliente.js";
import { resolverDestino, describir, guardarContacto, esJefe, type Contacto } from "../motor/contactos.js";
import { iniciarGestion, gestionPorRef, respuestaJefeGestion, refGestion, type Gestion } from "../motor/gestiones.js";

const MODULO = "gestion";

async function destino(a: Record<string, any>): Promise<{ numero?: string; contacto?: Contacto | null; error?: string }> {
  const d = await resolverDestino(String(a.con || ""));
  if (d.tipo === "ambiguo") return { error: `"${a.con}" puede ser: ${d.opciones.map(describir).join(" | ")}. ¿Cuál?` };
  if (d.tipo === "desconocido") return { error: `No tengo a "${a.con}" en la agenda: pídele el número al jefe.` };
  if (d.tipo === "numero") return esJefe(d.numero) ? { error: "Ese es el número del jefe." } : { numero: d.numero, contacto: null };
  if (d.contacto.permiso === "bloqueado") return { error: `${d.contacto.nombre} está bloqueado.` };
  if (!d.contacto.numero) return { error: `${d.contacto.nombre} no tiene WhatsApp guardado.` };
  return { numero: d.contacto.numero, contacto: d.contacto };
}

export const gestionIniciar: DefTool = {
  nombre: "gestion_iniciar", modulo: MODULO,
  descripcion: "Lyra habla con alguien por WhatsApp hasta lograr algo: agendar una cita, confirmar una reunión, preguntar y traer la respuesta, coordinar una entrega, recordar un pago. Define el objetivo, los límites (qué puede aceptar sin preguntarte: horarios, días, montos, qué no decir) y el primer mensaje. Tú lo apruebas una vez; ella sigue sola dentro de los límites, te consulta lo que se salga, y al acordar algo lo pone en tu agenda y te cuenta.",
  parametros: { type: "object", properties: {
    con: { type: "string", minLength: 2, description: "Nombre, apodo o número." },
    objetivo: { type: "string", minLength: 5, description: "Qué hay que lograr, concreto." },
    limites: { type: "string", description: "Qué puede aceptar sin preguntar. Ej.: 'solo martes o jueves después de las 2 pm; hasta 150 mil; no dar su número personal'." },
    primer_mensaje: { type: "string", minLength: 2, description: "El primer mensaje tal cual lo va a leer la persona." },
    nombre: { type: "string", description: "Si 'con' es un número nuevo: nombre para la agenda." },
    agendar: { type: "boolean", description: "Si se acuerda una fecha, ponerla en la agenda (por defecto sí)." },
    esperar_horas: { type: "number", minimum: 1, maximum: 168, description: "Cuánto esperar respuesta antes de insistir (por defecto 24)." },
  }, required: ["con", "objetivo", "primer_mensaje"] },
  riesgo: "escritura", requiereAprobacion: true, timeoutSeg: 120,
  async necesitaAprobacion(a) { return !(await destino(a)).error; },   // si no va a salir nada, el error llega directo
  async vistaAprobacion(a) {
    const d = await destino(a); if (d.error || !d.numero) return null;
    return [`⏸ *¿Hago esta gestión?*`, `Con: *${d.contacto ? describir(d.contacto) : `${a.nombre ? `${a.nombre} · ` : ""}${d.numero} (no está en tu agenda)`}*`,
      `🎯 ${a.objetivo}`, `🚧 Límites: ${a.limites || "ninguno extra (te pregunto ante cualquier duda)"}`,
      `Primer mensaje:\n───────────\n${String(a.primer_mensaje).slice(0, 2000)}\n───────────`,
      `Después sigo yo sola dentro de esos límites${a.agendar === false ? "" : ", y si se acuerda una fecha la pongo en tu agenda"}. Lo que se salga te lo pregunto.`,
      `Responde *ok* para empezar o *no* para cancelar.`].join("\n");
  },
  async ejecutar(a, ctx) {
    const d = await destino(a); if (d.error || !d.numero) return { ok: false, error: d.error || "Sin destino." };
    let contacto = d.contacto ?? null;
    if (!contacto && a.nombre) contacto = (await guardarContacto({ nombre: a.nombre, numero: d.numero }).catch(() => null))?.contacto ?? null;
    try {
      const { gestion } = await iniciarGestion({ numero: d.numero, contacto, objetivo: a.objetivo, limites: a.limites, primerMensaje: a.primer_mensaje, agendar: a.agendar, esperarHoras: a.esperar_horas, conversacionId: ctx?.conversacionId ?? null });
      return { ok: true, datos: { ref: refGestion(gestion.id) }, resumen: `🤝 Gestión ${refGestion(gestion.id)} en marcha con ${contacto?.nombre || d.numero}. Te cuento cuando haya respuesta o necesite que decidas algo.` };
    } catch (e: any) { return { ok: false, error: e?.message || String(e) }; }
  },
};

const linea = async (g: Gestion) => {
  const c = g.contacto_id ? (await query<any>(`SELECT nombre FROM contactos WHERE id = $1`, [g.contacto_id]))[0] : null;
  const ic: Record<string, string> = { activa: "🔄", esperando_jefe: "❓", cerrada: "✅", fallida: "❌", cancelada: "🚫", sin_respuesta: "💤" };
  return `${ic[g.estado] || ""} ${refGestion(g.id)} · ${c?.nombre || g.numero} · ${g.objetivo.slice(0, 90)}${g.estado === "esperando_jefe" ? `\n   ❓ ${g.pregunta_jefe}` : g.resultado ? `\n   → ${g.resultado}` : ""} (${g.turnos} msj)`;
};

export const gestionEstado: DefTool = {
  nombre: "gestion_estado", modulo: MODULO,
  descripcion: "Las gestiones de Lyra: las abiertas (y las que esperan tu decisión) o una en particular (ref G-xxxx) con toda su conversación.",
  parametros: { type: "object", properties: { ref: { type: "string" }, todas: { type: "boolean", description: "Incluir las cerradas de los últimos 14 días." } } },
  riesgo: "lectura", requiereAprobacion: false, timeoutSeg: 15,
  async ejecutar(a) {
    if (a.ref) {
      const g = await gestionPorRef(a.ref); if (!g) return { ok: false, error: `No encuentro la gestión ${a.ref}.` };
      const h = await query<any>(`SELECT * FROM (SELECT 'Lyra' de, texto, creado_en FROM mensajes_salientes WHERE gestion_id = $1 UNION ALL SELECT 'Contacto', texto, creado_en FROM mensajes_terceros WHERE right(numero, 10) = right($2, 10) AND creado_en >= $3) x ORDER BY creado_en`, [g.id, g.numero, g.creado_en]);
      return { ok: true, datos: { gestion: g, hilo: h }, resumen: `${await linea(g)}\n🚧 ${g.limites || "sin límites extra"}\n${h.map((x) => `${x.de}: ${String(x.texto).slice(0, 300)}`).join("\n")}` };
    }
    const xs = await query<Gestion>(`SELECT * FROM gestiones WHERE estado IN ('activa','esperando_jefe') OR ($1 AND actualizado_en > now() - interval '14 days') ORDER BY estado = 'esperando_jefe' DESC, actualizado_en DESC LIMIT 30`, [!!a.todas]);
    return { ok: true, datos: xs, resumen: xs.length ? (await Promise.all(xs.map(linea))).join("\n") : "No hay gestiones abiertas." };
  },
};

export const gestionResponder: DefTool = {
  nombre: "gestion_responder", modulo: MODULO,
  descripcion: "Pasa a Lyra la decisión del jefe sobre una gestión que espera su respuesta (lo que dijo él, tal cual: 'el jueves no, que sea el viernes a las 3', 'sí, acepta los 180 mil'). Ella sigue la conversación con la persona. Si no das ref, usa la única que esté esperando.",
  parametros: { type: "object", properties: { ref: { type: "string" }, respuesta: { type: "string", minLength: 1 } }, required: ["respuesta"] },
  riesgo: "escritura", requiereAprobacion: false, timeoutSeg: 120,
  async ejecutar(a) {
    let g = a.ref ? await gestionPorRef(a.ref) : null;
    if (!a.ref) {
      const xs = await query<Gestion>(`SELECT * FROM gestiones WHERE estado = 'esperando_jefe' ORDER BY actualizado_en DESC`);
      if (xs.length > 1) return { ok: false, error: `Hay ${xs.length} gestiones esperando: ${(await Promise.all(xs.map(linea))).join(" | ")}. ¿Cuál?` };
      g = xs[0] || null;
    }
    if (!g) return { ok: false, error: "No hay ninguna gestión esperando tu respuesta." };
    if (g.estado !== "esperando_jefe" && g.estado !== "activa") return { ok: false, error: `${refGestion(g.id)} ya está ${g.estado}.` };
    try {
      const r = await respuestaJefeGestion(g, a.respuesta);
      return { ok: true, resumen: r.accion === "responder" ? `Le escribí: «${r.detalle}»` : r.accion === "cerrada" ? `✅ Cerrada: ${r.detalle}` : r.accion === "consultar_jefe" ? `Necesito otra decisión: ${r.detalle}` : `Listo (${r.accion}).` };
    } catch (e: any) { return { ok: false, error: e?.message || String(e) }; }
  },
};

export const gestionCancelar: DefTool = {
  nombre: "gestion_cancelar", modulo: MODULO,
  descripcion: "Cancela una gestión (Lyra deja de responderle a esa persona sobre eso). Opcional: un último mensaje de cierre (sale con tu OK si el contacto no es libre: usa mensaje_enviar).",
  parametros: { type: "object", properties: { ref: { type: "string", minLength: 2 }, motivo: { type: "string" } }, required: ["ref"] },
  riesgo: "escritura", requiereAprobacion: false, timeoutSeg: 15,
  async ejecutar(a) {
    const g = await gestionPorRef(a.ref); if (!g) return { ok: false, error: `No encuentro ${a.ref}.` };
    await query(`UPDATE gestiones SET estado = 'cancelada', resultado = $2, actualizado_en = now() WHERE id = $1 AND estado IN ('activa','esperando_jefe')`, [g.id, a.motivo || "Cancelada por el jefe"]);
    return { ok: true, resumen: `🚫 ${refGestion(g.id)} cancelada.` };
  },
};

export const toolsGestiones: DefTool[] = [gestionIniciar, gestionEstado, gestionResponder, gestionCancelar];
