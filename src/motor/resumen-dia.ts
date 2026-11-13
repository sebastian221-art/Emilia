// ARCHIVO: src/motor/resumen-dia.ts
// ─────────────────────────────────────────────────────────────────────────────
//  RESUMEN DE LA MAÑANA Y DE LA NOCHE (Iris)
//  Mañana: tu día (agenda + Google), correos por responder y gente que no te
//  ha contestado, compromisos que vencen, sistemas, copia de anoche y Any.
//  Noche: qué se hizo, qué quedó pendiente, qué pasó con los sistemas y qué
//  hay mañana. Horas en iris_config (resumen_manana / resumen_noche).
//  Solo lo que sirve: una sección vacía no sale.
// ─────────────────────────────────────────────────────────────────────────────
import { query } from "../db/cliente.js";
import { configIris, avisarJefe, ahoraBogota } from "./avisos.js";
import { refCorreo } from "./correo.js";

const TZ = "America/Bogota";
/** Medianoche de Bogotá (UTC-5, sin horario de verano) del día con desplazamiento `dias`. */
export function inicioDiaBogota(dias = 0, base = new Date()): Date {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(base).split("-").map(Number);
  return new Date(Date.UTC(p[0], p[1] - 1, p[2] + dias, 5, 0, 0));
}
const fechaHoy = () => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
const hora = (d: string | Date) => new Date(d).toLocaleTimeString("es-CO", { timeZone: TZ, hour: "numeric", minute: "2-digit" });
const dia = (d: string | Date) => new Date(d).toLocaleDateString("es-CO", { timeZone: TZ, weekday: "short", day: "numeric", month: "short" });
const corto = (s: string | null | undefined, n: number) => { const t = String(s || "").replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const hace = (d: string | Date) => { const h = (Date.now() - new Date(d).getTime()) / 3600_000; return h < 24 ? `${Math.max(1, Math.round(h))} h` : `${Math.round(h / 24)} día(s)`; };

async function agendaEntre(desde: Date, hasta: Date): Promise<string[]> {
  const items = await query<any>(`SELECT titulo, inicio, todo_el_dia, lugar, tipo, estado FROM agenda WHERE estado IN ('confirmado','propuesto') AND inicio >= $1 AND inicio < $2 ORDER BY todo_el_dia DESC, inicio`, [desde, hasta]);
  const lineas = items.map((i) => `• ${i.todo_el_dia ? "Todo el día" : hora(i.inicio)} ${i.titulo}${i.lugar ? ` (${i.lugar})` : ""}${i.tipo === "vencimiento" ? " ⏰ vence" : ""}${i.estado === "propuesto" ? " — ❔ sin confirmar" : ""}`);
  try {
    const { eventosGoogle } = await import("./google.js");
    const propios = new Set(items.map((i) => corto(i.titulo, 40).toLowerCase()));
    for (const e of await eventosGoogle(desde, hasta)) if (!propios.has(corto(e.titulo, 40).toLowerCase())) lineas.push(`• ${/T/.test(e.inicio) ? hora(e.inicio) : "Todo el día"} ${e.titulo}${e.lugar ? ` (${e.lugar})` : ""} 📆`);
  } catch { /* Google no conectado */ }
  return lineas;
}

async function seccionCorreos(desde: Date): Promise<string[]> {
  const out: string[] = [];
  const porResponder = await query<any>(`SELECT id, quien, de_nombre, resumen, importancia, fecha FROM correos WHERE direccion = 'recibido' AND requiere_respuesta AND estado NOT IN ('respondido','archivado','atendido')
    AND fecha > now() - interval '7 days' ORDER BY importancia DESC NULLS LAST, fecha LIMIT 5`);
  if (porResponder.length) out.push(`Por responder (${porResponder.length}):\n${porResponder.map((c) => `• ${c.quien || c.de_nombre || "?"} ${refCorreo(c.id)}: ${corto(c.resumen, 90)} (hace ${hace(c.fecha)})`).join("\n")}`);
  const sinRespuesta = await query<any>(`SELECT id, para, asunto, fecha FROM correos WHERE direccion = 'enviado' AND espera_respuesta AND estado <> 'contestaron'
    AND fecha < now() - interval '2 days' AND fecha > now() - interval '21 days' ORDER BY fecha LIMIT 4`);
  if (sinRespuesta.length) out.push(`No te han contestado:\n${sinRespuesta.map((c) => `• ${corto(String(c.para).replace(/<.*?>/g, ""), 40)} — "${corto(c.asunto, 60)}" (hace ${hace(c.fecha)}) ${refCorreo(c.id)}`).join("\n")}`);
  const [r] = await query<any>(`SELECT count(*)::int AS n, string_agg(DISTINCT COALESCE(categoria,'otro'), ', ') AS cats FROM correos WHERE direccion = 'recibido' AND estado = 'en_resumen' AND creado_en >= $1`, [desde]);
  if (r.n) out.push(`${r.n} correo(s) sin importancia (${r.cats}): nada que hacer.`);
  return out;
}

async function seccionCompromisos(dias: number): Promise<string[]> {
  const xs = await query<any>(`SELECT titulo, inicio, tipo FROM agenda WHERE estado = 'confirmado' AND tipo IN ('tarea','compromiso','vencimiento') AND inicio >= $2 AND inicio < now() + make_interval(days => $1) ORDER BY inicio LIMIT 6`, [dias, inicioDiaBogota(1)]);   // lo de hoy ya sale en «Tu día»
  const vencidos = await query<any>(`SELECT titulo, inicio FROM agenda WHERE estado = 'confirmado' AND tipo IN ('tarea','compromiso','vencimiento') AND inicio < now() AND inicio > now() - interval '14 days' ORDER BY inicio LIMIT 4`);
  return [
    ...vencidos.map((x) => `• ⚠️ Se pasó: ${x.titulo} (${dia(x.inicio)})`),
    ...xs.map((x) => `• ${dia(x.inicio)}: ${x.titulo}`),
  ];
}

async function seccionSistemas(desde: Date): Promise<string[]> {
  const out: string[] = [];
  const mons = await query<any>(`SELECT nombre, estado, desde, ultimo_detalle FROM monitores WHERE activo ORDER BY nombre`).catch(() => []);
  if (!mons.length) return out;
  const malos = mons.filter((m) => m.estado !== "ok" && m.estado !== "desconocido");
  out.push(malos.length ? malos.map((m) => `• ${m.estado === "caido" ? "🔴" : m.estado === "lento" ? "🐢" : "⚠️"} ${m.nombre}: ${corto(m.ultimo_detalle, 90)}${m.desde ? ` (desde ${hace(m.desde)})` : ""}`).join("\n") : `🟢 Todo arriba (${mons.length} cosas vigiladas).`);
  const incs = await query<any>(`SELECT m.nombre, i.inicio, i.fin FROM incidentes i JOIN monitores m ON m.id = i.monitor_id WHERE i.inicio >= $1 ORDER BY i.inicio`, [desde]).catch(() => []);
  const cerrados = incs.filter((i) => i.fin);
  if (cerrados.length) out.push(`Hubo ${cerrados.length} caída(s) que ya se resolvieron: ${[...new Set(cerrados.map((i) => i.nombre))].join(", ")}.`);
  const [c] = await query<any>(`SELECT ok, bytes, t AS creado_en, detalle FROM copias ORDER BY t DESC LIMIT 1`).catch(() => []);
  if (c) out.push(c.ok && Date.now() - new Date(c.creado_en).getTime() < 30 * 3600_000 ? `💾 Copia de la base: ✔ ${dia(c.creado_en)} ${hora(c.creado_en)}` : `💾 ⚠️ Copia de la base: ${c.ok ? `la última es de ${dia(c.creado_en)}` : `falló (${corto(c.detalle, 80)})`}`);
  return out;
}

async function seccionAny(desde: Date, hasta: Date): Promise<string | null> {
  const [a] = await query<any>(`SELECT count(*) FILTER (WHERE veredicto <> 'omitida')::int AS ev, count(*) FILTER (WHERE veredicto='bien')::int AS bien, count(*) FILTER (WHERE veredicto='mal')::int AS mal
    FROM any_evaluaciones WHERE fecha >= $1 AND fecha < $2`, [desde, hasta]).catch(() => [] as any[]);
  if (!a?.ev) return null;
  return `🤖 Any: ${a.ev} respuestas · ${Math.round((a.bien / a.ev) * 100)} % bien${a.mal ? ` · ${a.mal} mal (pídeme "fallos de Any")` : " 👌"}`;
}

const bloque = (titulo: string, lineas: string[]) => lineas.length ? `\n*${titulo}*\n${lineas.join("\n")}` : "";

export async function resumenManana(): Promise<string> {
  const hoy = inicioDiaBogota(0), manana = inicioDiaBogota(1), ayer = inicioDiaBogota(-1);
  const fecha = new Date().toLocaleDateString("es-CO", { timeZone: TZ, weekday: "long", day: "numeric", month: "long" });
  const [agenda, correos, compromisos, sistemas, any] = await Promise.all([agendaEntre(hoy, manana), seccionCorreos(new Date(Date.now() - 24 * 3600_000)), seccionCompromisos(3), seccionSistemas(ayer), seccionAny(ayer, hoy)]);
  const partes = [
    `☀️ Buenos días. Hoy es ${fecha}.`,
    agenda.length ? bloque("📅 Tu día", agenda) : "\n📅 No tienes nada en la agenda hoy.",
    bloque("📧 Correo", correos),
    bloque("🤝 Compromisos que vienen", compromisos),
    bloque("🖥 Sistemas", sistemas),
    any ? `\n${any.replace("Any:", "Any ayer:")}` : "",
  ];
  return partes.filter(Boolean).join("\n").trim();
}

export async function resumenNoche(): Promise<string> {
  const hoy = inicioDiaBogota(0), manana = inicioDiaBogota(1), pasado = inicioDiaBogota(2);
  const [hechos] = await query<any>(`SELECT count(*)::int AS n FROM agenda WHERE estado = 'hecho' AND actualizado_en >= $1`, [hoy]);
  const [resp] = await query<any>(`SELECT count(*)::int AS n FROM correos WHERE direccion = 'enviado' AND fecha >= $1`, [hoy]);
  const [rec] = await query<any>(`SELECT count(*)::int AS n FROM correos WHERE direccion = 'recibido' AND creado_en >= $1`, [hoy]);
  const [agendaManana, correos, sistemas, any] = await Promise.all([agendaEntre(manana, pasado), seccionCorreos(hoy), seccionSistemas(hoy), seccionAny(hoy, manana)]);
  const hecho = [rec.n ? `• Te llegaron ${rec.n} correo(s) y enviaste ${resp.n}.` : "", hechos.n ? `• Marcaste ${hechos.n} cosa(s) de la agenda como hechas.` : ""].filter(Boolean);
  return [
    "🌙 Cierre del día.",
    bloque("Hoy", hecho),
    bloque("📧 Quedó pendiente", correos.filter((c) => !/sin importancia/.test(c))),
    bloque("🖥 Sistemas", sistemas),
    any ? `\n${any.replace("Any:", "Any hoy:")}` : "",
    agendaManana.length ? bloque("📅 Mañana", agendaManana) : "\n📅 Mañana no tienes nada agendado.",
  ].filter(Boolean).join("\n").trim();
}

/** Lo llama el reloj de Iris cada minuto. */
export async function resumenSiToca(): Promise<"manana" | "noche" | null> {
  const cfg = await configIris(), { h, m } = ahoraBogota(), ahora = h * 60 + m, hoy = fechaHoy();
  const [f] = await query<{ valor: any }>(`SELECT valor FROM iris_config WHERE clave = 'resumen_estado'`);
  const est = f?.valor || {};
  const toca = (hhmm: string | null, enviado: string | undefined, ventanaMin: number) => {
    if (!hhmm || enviado === hoy) return false;
    const [hh, mm] = hhmm.split(":").map(Number), t = hh * 60 + (mm || 0);
    return ahora >= t && ahora < t + ventanaMin;   // si Emilia estuvo apagada a esa hora y prende mucho después, no llega a destiempo
  };
  let cual: "manana" | "noche" | null = null;
  if (toca(cfg.resumen_manana, est.manana, 5 * 60)) cual = "manana";
  else if (toca(cfg.resumen_noche, est.noche, 3 * 60)) cual = "noche";
  if (!cual) return null;
  est[cual] = hoy;
  await query(`INSERT INTO iris_config (clave, valor) VALUES ('resumen_estado', $1) ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor, actualizado_en = now()`, [JSON.stringify(est)]);
  // La mañana la da Emilia (con lo de todo el equipo y una línea suya); sin alma, el resumen de Iris de siempre.
  const deEmilia = cual === "manana" && (process.env.ALMA || "true") !== "false";
  const texto = cual === "manana" ? (deEmilia ? await (await import("./administradora.js")).buenosDias().catch(() => resumenManana()) : await resumenManana()) : await resumenNoche();
  await avisarJefe(texto, "normal", "resumen", deEmilia ? "emilia" : "iris");
  return cual;
}
