// ARCHIVO: src/tools/memoria.ts
// ─────────────────────────────────────────────────────────────────────────────
//  TOOLS DE MEMORIA — sobre el CEREBRO COMPARTIDO (bib_nodos): recordar,
//  guardar (sin duplicar), olvidar (a la papelera, se puede recuperar).
//  Lo personal del jefe solo se ve cuando se le está atendiendo a él.
// ─────────────────────────────────────────────────────────────────────────────
import type { DefTool } from "../registro/tipos.js";
import { query } from "../db/cliente.js";
import { recordar, guardarRecuerdo, CLASES, type Clase } from "../motor/cerebro.js";

const MODULO = "memoria";

/** ¿Esta conversación es con el jefe (o viene de él)? Si es con un tercero, lo personal no se toca. */
export async function conversacionDelJefe(conversacionId?: string | null): Promise<boolean> {
  if (!conversacionId) return true;
  const jefe = (process.env.WHATSAPP_NUMERO_JEFE || "").replace(/\D/g, "");
  let id: string | null = conversacionId;
  for (let i = 0; i < 4 && id; i++) {
    const filas: any[] = await query<any>(`SELECT canal, contacto FROM conversaciones WHERE id::text = $1`, [id]).catch(() => []);
    const c: any = filas[0];
    if (!c) return true;
    if (c.canal === "panel") return true;
    if (c.canal === "whatsapp") return !jefe || c.contacto === jefe;
    id = c.canal === "delegacion" ? c.contacto : null;
  }
  return true;
}
const fecha = (d: string | null) => (d ? new Date(d).toLocaleDateString("es-CO", { timeZone: "America/Bogota", day: "numeric", month: "short", year: "numeric" }) : "");

export const memoriaRecordar: DefTool = {
  nombre: "memoria_recordar", modulo: MODULO,
  descripcion: "Busca en el cerebro compartido (memoria y conocimiento del equipo) por significado y palabras: hechos, lo que pasó, cómo se hace algo, personas, lecciones, y lo que se sabe del jefe. Para 'te acuerdas de…', 'qué sabemos de…', 'qué pasó con…', 'cómo se arregló…'.",
  parametros: { type: "object", properties: {
    texto: { type: "string", minLength: 2 },
    carpeta: { type: "string", description: "Limitar a una carpeta: general, personal o proyecto:<nombre>." },
    clase: { type: "string", enum: CLASES },
    limite: { type: "integer", default: 10, minimum: 1, maximum: 30 },
  }, required: ["texto"] },
  riesgo: "lectura", requiereAprobacion: false,
  async ejecutar(a, ctx) {
    const delJefe = await conversacionDelJefe(ctx?.conversacionId);
    if (a.carpeta === "personal" && !delJefe) return { ok: false, error: "Lo personal del jefe no se consulta en conversaciones con otras personas." };
    const xs = await recordar(a.texto, { espacios: a.carpeta ? [a.carpeta] : ["*"], clases: a.clase ? [a.clase as Clase] : undefined, max: a.limite || 10, incluirPrivado: delJefe });
    const { abrirResumen } = await import("../motor/cifrado.js");
    const lineas = [];
    for (const x of xs) lineas.push(`• [${x.clase}${x.espacio !== "general" ? ` · ${x.espacio}` : ""}] ${x.titulo}: ${(await abrirResumen(x as any)).slice(0, 400)} (${x.estado}, confianza ${Math.round(x.confianza * 100)} %, ${fecha(x.ocurrio_en || x.actualizado_en)}) — ref ${x.slug}`);
    return { ok: true, datos: xs.map(({ ficha: _f, ...x }) => x), resumen: lineas.length ? lineas.join("\n") : "No tengo nada guardado sobre eso." };
  },
};

export const memoriaGuardar: DefTool = {
  nombre: "memoria_guardar", modulo: MODULO,
  descripcion: "Guarda algo en el cerebro compartido para no olvidarlo (si ya existe algo igual, lo refuerza o actualiza en vez de duplicar). Úsalo cuando el jefe pide recordar algo, cuenta algo durable de su vida, de una persona o de un proyecto, o cuando aprendes cómo se resolvió algo.",
  parametros: { type: "object", properties: {
    titulo: { type: "string", minLength: 2, description: "Corto y buscable: 'Cumpleaños de la mamá', 'Cómo se reinicia el chatbot', 'Caída de jelcom-envios por memoria'." },
    contenido: { type: "string", minLength: 3, description: "Lo que hay que recordar, concreto (fechas, nombres, cifras, pasos)." },
    clase: { type: "string", enum: CLASES, description: "hecho, episodio (algo que pasó), procedimiento (cómo se hace), persona, perfil (sobre el jefe), leccion…" },
    carpeta: { type: "string", description: "general (defecto), personal (vida del jefe, sus relaciones) o proyecto:<nombre>." },
    importancia: { type: "number", minimum: 0, maximum: 1, description: "0.9+ si es esencial (siempre presente)." },
    cuando: { type: "string", description: "Para episodios: cuándo pasó (AAAA-MM-DD)." },
    clave: { type: "string", description: "(compatibilidad) igual que titulo." },
    sujeto: { type: "string", description: "(compatibilidad) 'jefe' o el nombre de la persona/proyecto." },
  }, required: ["contenido"] },
  riesgo: "escritura", requiereAprobacion: false,
  async ejecutar(a, ctx) {
    const sujeto = a.sujeto && a.sujeto !== "jefe" ? a.sujeto : null;
    const titulo = a.titulo || (a.clave ? `${sujeto ? `${sujeto}: ` : ""}${String(a.clave).replace(/_/g, " ")}` : String(a.contenido).slice(0, 60));
    const clase: Clase = a.clase || (sujeto ? "persona" : a.sujeto === "jefe" ? "perfil" : "hecho");
    const carpeta = a.carpeta || (clase === "perfil" || clase === "persona" ? "personal" : "general");
    if (carpeta === "personal" && !(await conversacionDelJefe(ctx?.conversacionId))) return { ok: false, error: "No guardo cosas personales del jefe desde conversaciones con otras personas." };
    const r = await guardarRecuerdo({ titulo, contenido: a.contenido, clase, espacio: carpeta, importancia: a.importancia, ocurrioEn: a.cuando || null, confianza: 0.95, origenRef: ctx?.conversacionId ? `conversacion:${ctx.conversacionId}` : null, agenteId: ctx?.agenteId ?? null });
    return { ok: true, datos: { slug: r.nodo.slug, accion: r.accion }, resumen: r.accion === "reforzado" ? `Ya lo sabía ("${r.parecido?.titulo}"); lo reforcé.` : `${r.accion === "creado" ? "Guardado" : "Actualizado"}: ${r.nodo.titulo}${r.parecido && r.accion === "actualizado" ? ` (junto con lo que ya sabía)` : ""}.` };
  },
};

export const memoriaOlvidar: DefTool = {
  nombre: "memoria_olvidar", modulo: MODULO,
  descripcion: "Olvida un recuerdo (va a la papelera de la biblioteca; el jefe lo puede recuperar). Por su ref (slug) o por texto: si hay varios parecidos, los lista para elegir.",
  parametros: { type: "object", properties: { ref_o_texto: { type: "string", minLength: 2 }, clave_o_texto: { type: "string", description: "(compatibilidad)" } }, required: [] },
  riesgo: "escritura", requiereAprobacion: false,
  async ejecutar(a, ctx) {
    const q = a.ref_o_texto || a.clave_o_texto; if (!q) return { ok: false, error: "Dime qué olvidar." };
    let [n] = await query<any>(`UPDATE bib_nodos SET borrado_en = now() WHERE slug = $1 AND borrado_en IS NULL RETURNING titulo`, [q]);
    if (n) return { ok: true, resumen: `Olvidado: ${n.titulo} (está en la papelera por si acaso).` };
    const xs = await recordar(q, { max: 5, incluirPrivado: await conversacionDelJefe(ctx?.conversacionId), reforzar: false });
    if (!xs.length) return { ok: true, resumen: "No tenía nada parecido." };
    if (xs.length === 1 || (xs[0].score || 0) > 2 * (xs[1].score || 0)) {
      [n] = await query<any>(`UPDATE bib_nodos SET borrado_en = now() WHERE id = $1 RETURNING titulo`, [xs[0].id]);
      return { ok: true, resumen: `Olvidado: ${n.titulo} (está en la papelera por si acaso).` };
    }
    return { ok: false, error: `Hay varios parecidos; dime cuál (por su ref):\n${xs.map((x) => `• ${x.slug}: ${x.titulo}`).join("\n")}` };
  },
};

export const toolsMemoria: DefTool[] = [memoriaRecordar, memoriaGuardar, memoriaOlvidar];
