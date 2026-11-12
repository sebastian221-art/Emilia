// ARCHIVO: src/tools/agenda.ts
// ─────────────────────────────────────────────────────────────────────────────
//  TOOLS DE AGENDA Y CONFIGURACIÓN DE IRIS
// ─────────────────────────────────────────────────────────────────────────────
import type { DefTool } from "../registro/tipos.js";
import { crearItem, cambiarItem, itemPorRef, refAgenda, cuando, type ItemAgenda } from "../motor/agenda.js";
import { query } from "../db/cliente.js";
import { configIris, guardarConfigIris } from "../motor/avisos.js";
import { cuentaGoogle, googleConfigurado, eventosGoogle } from "../motor/google.js";

const MODULO = "agenda";
const linea = (it: ItemAgenda) => `• ${refAgenda(it.id)} ${{ cita: "📅", tarea: "✅", compromiso: "🤝", recordatorio: "⏰", vencimiento: "⏳" }[it.tipo]} ${cuando(it.inicio, it.todo_el_dia)} — *${it.titulo}*${it.lugar ? ` · 📍 ${it.lugar}` : ""}${it.estado === "propuesto" ? " (propuesta)" : ""}${it.google_id ? " · en Google" : ""}`;
const FECHA = { type: "string" as const, description: "Fecha y hora ISO 8601 con zona de Bogotá, ej. 2026-11-18T15:00:00-05:00. Calcula fechas relativas ('el martes', 'mañana a las 3') desde hoy." };

export const agendaCrear: DefTool = {
  nombre: "agenda_crear", modulo: MODULO,
  descripcion: "Agenda algo: cita, tarea, compromiso, vencimiento o recordatorio. Avisa por WhatsApp antes (por defecto 1 día y 1 hora antes; un recordatorio, a la hora exacta) y lo pone en Google Calendar si está conectado. Ej.: 'recuérdame llamar al hospital mañana a las 9', 'cita con Valentina el martes 3 pm'.",
  parametros: {
    type: "object",
    properties: {
      titulo: { type: "string", minLength: 2 }, inicio: FECHA, fin: { ...FECHA, description: "Opcional." },
      todo_el_dia: { type: "boolean" }, lugar: { type: "string" }, notas: { type: "string" },
      tipo: { type: "string", enum: ["cita", "tarea", "compromiso", "recordatorio", "vencimiento"], default: "cita" },
      recordatorios_min: { type: "array", items: { type: "integer" }, description: "Minutos antes para avisar (ej. [1440, 60, 10]). Opcional." },
    },
    required: ["titulo", "inicio"],
  },
  riesgo: "escritura", requiereAprobacion: false, timeoutSeg: 30,
  async ejecutar(a) {
    const ini = new Date(a.inicio);
    if (isNaN(ini.getTime())) return { ok: false, error: "No entendí la fecha. Usa ISO, ej. 2026-11-18T15:00:00-05:00." };
    const it = await crearItem({ titulo: a.titulo, inicio: ini.toISOString(), fin: a.fin ? new Date(a.fin).toISOString() : null, todo_el_dia: !!a.todo_el_dia, lugar: a.lugar, notas: a.notas, tipo: a.tipo, recordatorios: a.recordatorios_min, origen: "jefe" });
    return { ok: true, datos: it, resumen: `Agendado: ${linea(it)}\nTe aviso ${it.recordatorios.map((m) => (m === 0 ? "a la hora" : m >= 1440 ? `${m / 1440} día(s) antes` : m >= 60 ? `${m / 60} h antes` : `${m} min antes`)).join(" y ")}.${it.google_id ? "" : googleConfigurado() ? " (Google Calendar no conectado: npm run google:conectar)" : ""}` };
  },
};

export const agendaListar: DefTool = {
  nombre: "agenda_listar", modulo: MODULO,
  descripcion: "Lo que hay en la agenda: de hoy, de la semana o de un rango. Incluye propuestas sacadas de correos (para confirmar) y, si Google Calendar está conectado, lo que el jefe agendó allá.",
  parametros: { type: "object", properties: { dias: { type: "integer", default: 7, minimum: 1, maximum: 90 }, desde: { type: "string", description: "ISO (por defecto ahora)." }, incluir_hechos: { type: "boolean", default: false } } },
  riesgo: "lectura", requiereAprobacion: false, timeoutSeg: 30,
  async ejecutar(a) {
    const desde = a.desde ? new Date(a.desde) : new Date(Date.now() - 3600_000), hasta = new Date(desde.getTime() + (a.dias || 7) * 86400_000);
    const xs = await query<ItemAgenda>(`SELECT * FROM agenda WHERE estado = ANY($3::text[]) AND ((inicio >= $1 AND inicio < $2) OR (inicio IS NULL AND tipo IN ('compromiso','tarea'))) ORDER BY inicio NULLS LAST`, [desde, hasta, a.incluir_hechos ? ["confirmado", "propuesto", "hecho"] : ["confirmado", "propuesto"]]);
    const deGoogle = (await eventosGoogle(desde, hasta).catch(() => [])).filter((g) => !xs.some((x) => x.google_id === g.id));
    const partes = [xs.filter((x) => x.estado !== "propuesto").map(linea).join("\n"), xs.some((x) => x.estado === "propuesto") ? `\n🗓 *Propuestas de tus correos* (dime "agéndalo"):\n${xs.filter((x) => x.estado === "propuesto").map(linea).join("\n")}` : "", deGoogle.length ? `\n📆 *En tu Google Calendar*:\n${deGoogle.map((g) => `• ${cuando(g.inicio)} — ${g.titulo}${g.lugar ? ` · 📍 ${g.lugar}` : ""}`).join("\n")}` : ""].filter(Boolean);
    return { ok: true, datos: { agenda: xs, google: deGoogle }, resumen: partes.join("\n") || `Nada agendado en los próximos ${a.dias || 7} días.` };
  },
};

export const agendaCambiar: DefTool = {
  nombre: "agenda_cambiar", modulo: MODULO,
  descripcion: "Cambia algo de la agenda por su referencia #abcde: confirmar una propuesta ('agéndalo'), mover la fecha, marcar hecho, cancelar, cambiar recordatorios.",
  parametros: { type: "object", properties: { ref: { type: "string" }, estado: { type: "string", enum: ["confirmado", "hecho", "cancelado"] }, titulo: { type: "string" }, inicio: FECHA, fin: FECHA, lugar: { type: "string" }, notas: { type: "string" }, recordatorios_min: { type: "array", items: { type: "integer" } } }, required: ["ref"] },
  riesgo: "escritura", requiereAprobacion: false, timeoutSeg: 30,
  async ejecutar(a) {
    const it = await itemPorRef(a.ref);
    if (!it) return { ok: false, error: "No encuentro eso en la agenda." };
    const n = await cambiarItem(it.id, { estado: a.estado, titulo: a.titulo, inicio: a.inicio ? new Date(a.inicio).toISOString() : undefined, fin: a.fin ? new Date(a.fin).toISOString() : undefined, lugar: a.lugar, notas: a.notas, recordatorios: a.recordatorios_min });
    return { ok: true, datos: n, resumen: `${a.estado === "cancelado" ? "Cancelado" : a.estado === "hecho" ? "Hecho ✔" : "Listo"}: ${linea(n!)}` };
  },
};

export const irisConfigurar: DefTool = {
  nombre: "iris_configurar", modulo: MODULO,
  descripcion: "Ajusta cómo te asiste Iris: horas de silencio (ej. 22:00 a 07:00; solo lo crítico sale), personas importantes (avisa al instante sus correos), hora del resumen de la mañana y de la noche, desde qué importancia avisar correos al instante. Sin parámetros, muestra la configuración.",
  parametros: {
    type: "object",
    properties: {
      silencio_desde: { type: "string", description: "HH:MM, o 'no' para quitar el silencio." }, silencio_hasta: { type: "string", description: "HH:MM" },
      agregar_persona: { type: "object", properties: { nombre: { type: "string" }, correo: { type: "string" }, dominio: { type: "string" }, nota: { type: "string" } }, required: ["nombre"] },
      quitar_persona: { type: "string", description: "Nombre o correo." },
      resumen_manana: { type: "string", description: "HH:MM o 'no'." }, resumen_noche: { type: "string", description: "HH:MM o 'no'." },
      correo_avisar_desde: { type: "integer", minimum: 1, maximum: 5, description: "Importancia mínima (1-5) para avisar un correo al instante. Por defecto 4." },
    },
  },
  riesgo: "escritura", requiereAprobacion: false, timeoutSeg: 20,
  async ejecutar(a) {
    const cfg = await configIris();
    const hhmm = (s?: string) => (s && /^\d{1,2}:\d{2}$/.test(s) ? s.padStart(5, "0") : null);
    const cambios: any = {};
    if (a.silencio_desde) cambios.silencio = /^no$/i.test(a.silencio_desde) ? null : hhmm(a.silencio_desde) && hhmm(a.silencio_hasta) ? { desde: hhmm(a.silencio_desde), hasta: hhmm(a.silencio_hasta) } : cfg.silencio;
    if (a.agregar_persona) cambios.personas_importantes = [...cfg.personas_importantes.filter((p) => p.nombre.toLowerCase() !== String(a.agregar_persona.nombre).toLowerCase()), a.agregar_persona];
    if (a.quitar_persona) { const q = String(a.quitar_persona).toLowerCase(); cambios.personas_importantes = (cambios.personas_importantes || cfg.personas_importantes).filter((p: any) => p.nombre.toLowerCase() !== q && (p.correo || "").toLowerCase() !== q); }
    if (a.resumen_manana) cambios.resumen_manana = /^no$/i.test(a.resumen_manana) ? null : hhmm(a.resumen_manana);
    if (a.resumen_noche) cambios.resumen_noche = /^no$/i.test(a.resumen_noche) ? null : hhmm(a.resumen_noche);
    if (a.correo_avisar_desde) cambios.correo_avisar_desde = a.correo_avisar_desde;
    const n = Object.keys(cambios).length ? await guardarConfigIris(cambios) : cfg;
    const g = await cuentaGoogle();
    return { ok: true, datos: n, resumen: `⚙️ Iris:\n• Silencio: ${n.silencio ? `${n.silencio.desde} a ${n.silencio.hasta} (solo sale lo crítico)` : "no"}\n• Resumen de la mañana: ${n.resumen_manana || "no"} · de la noche: ${n.resumen_noche || "no"}\n• Correos: aviso al instante desde importancia ${n.correo_avisar_desde}/5\n• Personas importantes: ${n.personas_importantes.length ? n.personas_importantes.map((p) => `${p.nombre}${p.correo ? ` <${p.correo}>` : ""}${p.dominio ? ` @${p.dominio}` : ""}`).join(", ") : "ninguna todavía"}\n• Google Calendar: ${g ? `conectado${g.correo ? ` (${g.correo})` : ""}` : googleConfigurado() ? "falta conectar (npm run google:conectar)" : "sin configurar (GOOGLE_CLIENT_ID/SECRET)"}` };
  },
};

export const toolsAgenda = [agendaCrear, agendaListar, agendaCambiar, irisConfigurar];
