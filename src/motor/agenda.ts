// ARCHIVO: src/motor/agenda.ts
// ─────────────────────────────────────────────────────────────────────────────
//  AGENDA DE IRIS: citas, tareas, compromisos, vencimientos y recordatorios.
//  • Lo que el jefe pide ("recuérdame…", "agenda…") → confirmado.
//  • Fechas que aparecen en correos → PROPUESTAS (él confirma con un "agéndalo").
//  • Lo que el jefe PROMETE en sus correos → compromisos con recordatorio.
//  • Reloj cada minuto: recordatorios por WhatsApp (por defecto 1 día y 1 hora antes).
//  • Si Google Calendar está conectado, todo lo confirmado se refleja allá.
// ─────────────────────────────────────────────────────────────────────────────
import { query } from "../db/cliente.js";
import { avisarJefe } from "./avisos.js";
import { sincronizarEvento, borrarEvento } from "./google.js";
import type { FilaCorreo } from "./correo.js";

export interface ItemAgenda {
  id: string; titulo: string; inicio: string | null; fin: string | null; todo_el_dia: boolean; lugar: string | null; notas: string | null;
  tipo: "cita" | "tarea" | "compromiso" | "recordatorio" | "vencimiento"; origen: string; correo_id: string | null;
  estado: "propuesto" | "confirmado" | "hecho" | "cancelado"; recordatorios: number[]; avisados: number[]; google_id: string | null; creado_en: string;
}

export const refAgenda = (id: string) => `#${id.slice(0, 5)}`;
export const cuando = (iso: string | null, todoElDia = false) => !iso ? "sin fecha" : new Date(iso).toLocaleString("es-CO", { timeZone: "America/Bogota", weekday: "short", day: "numeric", month: "short", ...(todoElDia ? {} : { hour: "2-digit", minute: "2-digit" }) });

async function reflejarEnGoogle(it: ItemAgenda) {
  try {
    if (it.estado === "cancelado") { if (it.google_id) { await borrarEvento(it.google_id); await query(`UPDATE agenda SET google_id = NULL WHERE id = $1`, [it.id]); } return; }
    if (it.estado !== "confirmado" || !it.inicio) return;
    const gid = await sincronizarEvento(it);
    if (gid && gid !== it.google_id) await query(`UPDATE agenda SET google_id = $2 WHERE id = $1`, [it.id, gid]);
  } catch (e: any) { console.warn("[agenda] Google:", e?.message || e); }
}

export async function crearItem(p: Partial<ItemAgenda> & { titulo: string }): Promise<ItemAgenda> {
  const recordatorios = p.recordatorios ?? (p.tipo === "recordatorio" ? [0] : p.tipo === "compromiso" || p.tipo === "tarea" || p.tipo === "vencimiento" ? [1440, 0] : [1440, 60]);
  const [it] = await query<ItemAgenda>(
    `INSERT INTO agenda (titulo, inicio, fin, todo_el_dia, lugar, notas, tipo, origen, correo_id, estado, recordatorios)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [p.titulo.slice(0, 300), p.inicio || null, p.fin || null, !!p.todo_el_dia, p.lugar || null, p.notas || null, p.tipo || "cita", p.origen || "jefe", p.correo_id || null, p.estado || "confirmado", JSON.stringify(recordatorios)]);
  await reflejarEnGoogle(it);
  return it;
}

export async function cambiarItem(id: string, cambios: Partial<ItemAgenda>): Promise<ItemAgenda | undefined> {
  const campos = ["titulo", "inicio", "fin", "todo_el_dia", "lugar", "notas", "tipo", "estado", "recordatorios"] as const;
  const sets: string[] = [], vals: unknown[] = [id];
  for (const c of campos) if (cambios[c] !== undefined) { vals.push(c === "recordatorios" ? JSON.stringify(cambios[c]) : cambios[c]); sets.push(`${c} = $${vals.length}`); }
  if (cambios.inicio !== undefined || cambios.recordatorios !== undefined) sets.push(`avisados = '[]'`);   // cambió la hora: los recordatorios vuelven a valer
  if (!sets.length) return (await query<ItemAgenda>(`SELECT * FROM agenda WHERE id = $1`, [id]))[0];
  const [it] = await query<ItemAgenda>(`UPDATE agenda SET ${sets.join(", ")}, actualizado_en = now() WHERE id = $1 RETURNING *`, vals);
  if (it) await reflejarEnGoogle(it);
  return it;
}

export async function itemPorRef(ref: string): Promise<ItemAgenda | undefined> {
  const r = String(ref || "").replace(/^#/, "").trim().toLowerCase();
  return r ? (await query<ItemAgenda>(`SELECT * FROM agenda WHERE id::text LIKE $1 || '%' LIMIT 1`, [r]))[0] : undefined;
}

export async function itemsEntre(desde: Date, hasta: Date, estados = ["confirmado"]): Promise<ItemAgenda[]> {
  return query<ItemAgenda>(`SELECT * FROM agenda WHERE estado = ANY($3::text[]) AND inicio >= $1 AND inicio < $2 ORDER BY inicio`, [desde, hasta, estados]);
}

// ── Desde el correo ──────────────────────────────────────────────────────────
export async function proponerDesdeCorreo(f: FilaCorreo, x: { titulo: string; inicio: string; fin?: string | null; lugar?: string | null }) {
  const inicio = new Date(x.inicio);
  if (isNaN(inicio.getTime()) || inicio.getTime() < Date.now() - 3600_000) return;   // fechas pasadas o ilegibles: nada
  const [ya] = await query(`SELECT 1 FROM agenda WHERE correo_id = $1 AND lower(titulo) = lower($2)`, [f.id, x.titulo]);
  if (ya) return;
  await crearItem({ titulo: x.titulo, inicio: inicio.toISOString(), fin: x.fin || null, lugar: x.lugar || null, notas: `Del correo de ${f.quien || f.de_correo}: "${f.asunto}"`, tipo: /vence|pago|plazo|fecha l[ií]mite/i.test(x.titulo) ? "vencimiento" : "cita", origen: "correo", correo_id: f.id, estado: "propuesto" });
}

export async function compromisoDesdeCorreo(f: FilaCorreo, c: { que: string; fecha_limite?: string | null }) {
  const [ya] = await query(`SELECT 1 FROM agenda WHERE correo_id = $1 AND lower(titulo) = lower($2)`, [f.id, c.que]);
  if (ya) return;
  const fecha = c.fecha_limite && /^\d{4}-\d{2}-\d{2}/.test(c.fecha_limite) ? new Date(`${c.fecha_limite.slice(0, 10)}T09:00:00-05:00`) : null;
  await crearItem({ titulo: c.que, inicio: fecha?.toISOString() || null, todo_el_dia: !!fecha, notas: `Lo prometiste en tu correo a ${(f.para || "").split("<")[0].trim()}: "${f.asunto}"`, tipo: "compromiso", origen: "correo", correo_id: f.id, estado: "confirmado" });
}

// ── Reloj de recordatorios ───────────────────────────────────────────────────
function textoRecordatorio(it: ItemAgenda, minutos: number): string {
  const falta = minutos >= 1440 ? (minutos === 1440 ? "mañana" : `en ${Math.round(minutos / 1440)} días`) : minutos >= 60 ? `en ${Math.round(minutos / 60)} h` : minutos > 0 ? `en ${minutos} min` : "ahora";
  const icono = { cita: "📅", tarea: "✅", compromiso: "🤝", recordatorio: "⏰", vencimiento: "⏳" }[it.tipo];
  return `${icono} *${it.tipo === "recordatorio" ? "Recordatorio" : `${it.titulo}`}* — ${falta} (${cuando(it.inicio, it.todo_el_dia)})${it.tipo === "recordatorio" ? `\n${it.titulo}` : ""}${it.lugar ? `\n📍 ${it.lugar}` : ""}${it.notas ? `\n${it.notas.slice(0, 300)}` : ""} ${refAgenda(it.id)}`;
}

export async function revisarRecordatorios(ahora = new Date()): Promise<number> {
  const xs = await query<ItemAgenda>(`SELECT * FROM agenda WHERE estado = 'confirmado' AND inicio IS NOT NULL AND inicio > $1::timestamptz - interval '10 minutes' AND inicio < $1::timestamptz + interval '8 days'`, [ahora]);
  let n = 0;
  for (const it of xs) {
    const t = new Date(it.inicio!).getTime();
    // Del recordatorio más lejano al más cercano; si se pasaron varios (Emilia apagada), solo el más cercano.
    const debidos = it.recordatorios.filter((m) => !it.avisados.includes(m) && ahora.getTime() >= t - m * 60_000).sort((a, b) => a - b);
    if (!debidos.length) continue;
    const m = debidos[0];
    if (ahora.getTime() > t + 10 * 60_000 && m !== 0) { await query(`UPDATE agenda SET avisados = $2 WHERE id = $1`, [it.id, JSON.stringify([...it.avisados, ...debidos])]); continue; }
    await avisarJefe(textoRecordatorio(it, m), it.tipo === "recordatorio" || m <= 60 ? "critico" : "normal", "agenda");
    await query(`UPDATE agenda SET avisados = $2 WHERE id = $1`, [it.id, JSON.stringify([...it.avisados, ...debidos])]);
    n++;
  }
  return n;
}
