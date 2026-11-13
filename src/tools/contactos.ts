// ARCHIVO: src/tools/contactos.ts
// ─────────────────────────────────────────────────────────────────────────────
//  AGENDA (Lyra): guardar, buscar y listar contactos, y su permiso.
//  Marcar a alguien como "libre" (Lyra le escribe sin preguntar) siempre pide
//  el OK del jefe; bajar el permiso (pedir_ok, bloqueado) no.
// ─────────────────────────────────────────────────────────────────────────────
import type { DefTool } from "../registro/tipos.js";
import { query } from "../db/cliente.js";
import { guardarContacto, buscarContactos, describir, type Contacto } from "../motor/contactos.js";

const MODULO = "contacto";
const ICONO: Record<string, string> = { pedir_ok: "✋", libre: "✅", bloqueado: "⛔" };
const linea = (c: Contacto) => `${ICONO[c.permiso] || ""} ${describir(c)}${c.apodos.length ? ` — le dices: ${c.apodos.join(", ")}` : ""}${c.tono ? ` — tono: ${c.tono}` : ""}`;

export const contactoGuardar: DefTool = {
  nombre: "contacto_guardar", modulo: MODULO,
  descripcion: "Guarda o actualiza un contacto de la agenda del jefe: nombre, número de WhatsApp (con indicativo; un celular colombiano de 10 dígitos se completa con 57), cómo le dice (apodos: 'mi tío', 'el de compras'), relación, tono para escribirle y notas. Queda conectado a su persona en el cerebro. Los contactos nuevos quedan en 'pedir OK'; para cambiar el permiso usa contacto_permiso.",
  parametros: { type: "object", properties: {
    nombre: { type: "string", minLength: 2 }, numero: { type: "string" },
    apodos: { type: "array", items: { type: "string" } }, relacion: { type: "string", description: "tío, cliente de Jelcom, jefa del hospital…" },
    tono: { type: "string", description: "Cómo escribirle: formal, cercano, con usted, corto…" }, notas: { type: "string" },
  }, required: ["nombre"] },
  riesgo: "escritura", requiereAprobacion: false, timeoutSeg: 30,
  async ejecutar(a) {
    try {
      const { contacto, nuevo } = await guardarContacto({ nombre: a.nombre, numero: a.numero, apodos: a.apodos, relacion: a.relacion, tono: a.tono, notas: a.notas });
      return { ok: true, datos: contacto, resumen: `${nuevo ? "📇 Contacto nuevo" : "📇 Contacto actualizado"}: ${linea(contacto)}${nuevo ? "\n(Permiso: pedir OK — te pregunto antes de cada mensaje.)" : ""}` };
    } catch (e: any) { return { ok: false, error: e?.message || String(e) }; }
  },
};

export const contactoBuscar: DefTool = {
  nombre: "contacto_buscar", modulo: MODULO,
  descripcion: "Busca en la agenda por nombre, apodo, relación o número ('Juan', 'mi tío', 'la de compras'). Úsala antes de escribirle a alguien para saber exactamente a quién va.",
  parametros: { type: "object", properties: { texto: { type: "string", minLength: 2 } }, required: ["texto"] },
  riesgo: "lectura", requiereAprobacion: false, timeoutSeg: 15,
  async ejecutar(a) {
    const xs = await buscarContactos(a.texto);
    if (!xs.length) return { ok: true, datos: [], resumen: `No tengo a "${a.texto}" en la agenda. Pídele el número al jefe y guárdalo con contacto_guardar.` };
    return { ok: true, datos: xs, resumen: (xs.length > 1 ? `Hay ${xs.length} posibles, pregúntale al jefe cuál:\n` : "") + xs.map(linea).join("\n") };
  },
};

export const contactoListar: DefTool = {
  nombre: "contacto_listar", modulo: MODULO,
  descripcion: "La agenda del jefe (o solo los de un permiso: pedir_ok, libre, bloqueado), con el último contacto.",
  parametros: { type: "object", properties: { permiso: { type: "string", enum: ["pedir_ok", "libre", "bloqueado"] }, limite: { type: "integer", minimum: 1, maximum: 200 } } },
  riesgo: "lectura", requiereAprobacion: false, timeoutSeg: 15,
  async ejecutar(a) {
    const xs = await query<Contacto>(`SELECT * FROM contactos WHERE ($1::text IS NULL OR permiso = $1) ORDER BY ultimo_contacto DESC NULLS LAST, nombre LIMIT $2`, [a.permiso ?? null, a.limite ?? 60]);
    return { ok: true, datos: xs, resumen: xs.length ? `${xs.length} contacto(s) (✋ pedir OK · ✅ libre · ⛔ bloqueado):\n${xs.map(linea).join("\n")}` : "La agenda está vacía." };
  },
};

export const contactoPermiso: DefTool = {
  nombre: "contacto_permiso", modulo: MODULO,
  descripcion: "Cambia el permiso de un contacto: pedir_ok (te pregunto antes de cada mensaje), libre (le escribo directo: solo gente de mucha confianza; pide tu OK) o bloqueado (nunca le escribo ni le respondo).",
  parametros: { type: "object", properties: { contacto: { type: "string", minLength: 2, description: "Nombre, apodo o número." }, permiso: { type: "string", enum: ["pedir_ok", "libre", "bloqueado"] } }, required: ["contacto", "permiso"] },
  riesgo: "escritura", requiereAprobacion: true, timeoutSeg: 15,
  necesitaAprobacion: async (a) => a.permiso === "libre",
  async vistaAprobacion(a) {
    const xs = await buscarContactos(String(a.contacto));
    return `⏸ *Necesito tu OK*\nMarcar como *libre* a ${xs.length === 1 ? describir(xs[0]) : a.contacto}: Lyra le podrá escribir sin preguntarte.\nResponde *ok* para aprobar o *no* para rechazar.`;
  },
  async ejecutar(a) {
    const xs = await buscarContactos(a.contacto);
    if (!xs.length) return { ok: false, error: `No tengo a "${a.contacto}" en la agenda.` };
    if (xs.length > 1) return { ok: false, error: `Hay varios: ${xs.map(describir).join(" | ")}. ¿Cuál?` };
    const [c] = await query<Contacto>(`UPDATE contactos SET permiso = $2, actualizado_en = now() WHERE id = $1 RETURNING *`, [xs[0].id, a.permiso]);
    return { ok: true, datos: c, resumen: `Listo: ${linea(c)}` };
  },
};

export const toolsContactos: DefTool[] = [contactoGuardar, contactoBuscar, contactoListar, contactoPermiso];
