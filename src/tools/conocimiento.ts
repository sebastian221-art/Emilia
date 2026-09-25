// ARCHIVO: src/tools/conocimiento.ts
// ─────────────────────────────────────────────────────────────────────────────
//  TOOLS DE CONOCIMIENTO — memoria durable del agente
//  Un agente guarda notas (hallazgos, decisiones, postmortems, convenciones)
//  como documentos propios. Entran a su contexto automáticamente (los más
//  nuevos primero, hasta el tope) y se pueden buscar cuando son muchos.
// ─────────────────────────────────────────────────────────────────────────────

import type { DefTool } from "../registro/tipos.js";
import { query } from "../db/cliente.js";

const MODULO = "conocimiento";

export const conocimientoGuardar: DefTool = {
  nombre: "conocimiento_guardar", modulo: MODULO,
  descripcion: "Guarda (o actualiza) una nota durable en tu base de conocimiento: un hallazgo, una decisión de arquitectura, un postmortem, una convención del proyecto. La vas a tener en tu contexto en futuras tareas. Usá nombres con prefijo: 'adr/', 'postmortem/', 'hallazgos/', 'convenciones/'.",
  parametros: { type: "object", properties: { nombre: { type: "string", description: "Nombre único, ej. 'postmortem/2026-09-25-webhook-duplicados.md'.", minLength: 3 }, contenido: { type: "string", description: "La nota, concreta y útil para el futuro (qué, por qué, qué hacer).", minLength: 10 } }, required: ["nombre", "contenido"] },
  riesgo: "escritura", requiereAprobacion: false,
  async ejecutar(a, ctx) {
    if (!ctx.agenteId) return { ok: false, error: "Solo un agente puede guardar conocimiento." };
    const [ex] = await query<any>(`SELECT id FROM documentos WHERE agente_id=$1 AND nombre=$2`, [ctx.agenteId, a.nombre]);
    if (ex) await query(`UPDATE documentos SET contenido=$1, tam_bytes=$2 WHERE id=$3`, [a.contenido, Buffer.byteLength(a.contenido), ex.id]);
    else await query(`INSERT INTO documentos (agente_id, nombre, tipo, contenido, tam_bytes) VALUES ($1,$2,'nota',$3,$4)`, [ctx.agenteId, a.nombre, a.contenido, Buffer.byteLength(a.contenido)]);
    return { ok: true, resumen: `Nota "${a.nombre}" ${ex ? "actualizada" : "guardada"} en tu conocimiento.` };
  },
};

export const conocimientoBuscar: DefTool = {
  nombre: "conocimiento_buscar", modulo: MODULO,
  descripcion: "Busca en tus notas y documentos por texto. Devuelve nombre y fragmentos relevantes. Usalo cuando tu contexto no incluya algo que recordás haber guardado.",
  parametros: { type: "object", properties: { texto: { type: "string", minLength: 2 }, limite: { type: "integer", default: 5, minimum: 1, maximum: 20 } }, required: ["texto"] },
  riesgo: "lectura", requiereAprobacion: false,
  async ejecutar(a, ctx) {
    if (!ctx.agenteId) return { ok: false, error: "Solo un agente puede buscar su conocimiento." };
    const filas = await query<any>(`SELECT nombre, contenido FROM documentos WHERE agente_id=$1 AND (nombre ILIKE $2 OR contenido ILIKE $2) ORDER BY creado_en DESC LIMIT $3`, [ctx.agenteId, `%${a.texto}%`, a.limite || 5]);
    const datos = filas.map((f) => { const i = f.contenido.toLowerCase().indexOf(String(a.texto).toLowerCase()); return { nombre: f.nombre, fragmento: f.contenido.slice(Math.max(0, i - 200), i + 400) }; });
    return { ok: true, datos, resumen: datos.length ? datos.map((d) => `▸ ${d.nombre}\n${d.fragmento}`).join("\n\n") : "No encontré nada con ese texto." };
  },
};

export const conocimientoListar: DefTool = {
  nombre: "conocimiento_listar", modulo: MODULO,
  descripcion: "Lista tus notas y documentos (nombre, tamaño, fecha).",
  parametros: { type: "object", properties: { prefijo: { type: "string", description: "Filtrar por prefijo, ej. 'postmortem/'." } }, required: [] },
  riesgo: "lectura", requiereAprobacion: false,
  async ejecutar(a, ctx) {
    if (!ctx.agenteId) return { ok: false, error: "Solo un agente." };
    const filas = await query<any>(`SELECT nombre, tam_bytes, creado_en FROM documentos WHERE agente_id=$1 ${a.prefijo ? "AND nombre LIKE $2" : ""} ORDER BY creado_en DESC`, a.prefijo ? [ctx.agenteId, `${a.prefijo}%`] : [ctx.agenteId]);
    return { ok: true, datos: filas, resumen: filas.length ? filas.map((f) => `${f.nombre} (${Math.round(f.tam_bytes / 1024)} KB)`).join("\n") : "Sin notas todavía." };
  },
};

export const toolsConocimiento: DefTool[] = [conocimientoGuardar, conocimientoBuscar, conocimientoListar];