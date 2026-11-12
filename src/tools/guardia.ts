// ARCHIVO: src/tools/guardia.ts
// ─────────────────────────────────────────────────────────────────────────────
//  TOOLS DE LA GUARDIA — qué vigilar, cómo va y qué ignorar
// ─────────────────────────────────────────────────────────────────────────────
import type { DefTool } from "../registro/tipos.js";
import { query } from "../db/cliente.js";
import { obtenerProyecto } from "../dominio/proyectos.js";
import { hallazgosAbiertos, marcarHallazgo } from "../motor/guardia.js";

const MODULO = "guardia";

export const guardiaConfigurar: DefTool = {
  nombre: "guardia_configurar", modulo: MODULO,
  descripcion: "Activa, ajusta o apaga la guardia de un proyecto registrado: url_produccion (se revisa que responda), auto_reparar (lo grave se arregla en sandbox y te pide OK) y activo. Lo publicado por Sage en Railway se vigila solo.",
  parametros: {
    type: "object",
    properties: {
      proyecto: { type: "string", minLength: 2 },
      activo: { type: "boolean", description: "Vigilarlo o no (por defecto sí)." },
      url_produccion: { type: "string", description: "URL pública a revisar (p. ej. la de Railway). Vacío para quitarla." },
      auto_reparar: { type: "boolean", description: "Arreglar lo grave en sandbox automáticamente (siempre pide OK para subir)." },
    },
    required: ["proyecto"],
  },
  riesgo: "escritura", requiereAprobacion: false, timeoutSeg: 20,
  async ejecutar(a) {
    const p = await obtenerProyecto(a.proyecto);
    if (!p) return { ok: false, error: `Proyecto "${a.proyecto}" no registrado (codigo_listar_proyectos).` };
    const url = a.url_produccion === undefined ? undefined : String(a.url_produccion).trim() || null;
    const [c] = await query(
      `INSERT INTO guardia_proyectos (proyecto_id, activo, url_produccion, auto_reparar) VALUES ($1, COALESCE($2, true), $3, COALESCE($4, true))
       ON CONFLICT (proyecto_id) DO UPDATE SET activo = COALESCE($2, guardia_proyectos.activo),
         url_produccion = CASE WHEN $5 THEN $3 ELSE guardia_proyectos.url_produccion END, auto_reparar = COALESCE($4, guardia_proyectos.auto_reparar)
       RETURNING *`,
      [p.id, a.activo ?? null, url ?? null, a.auto_reparar ?? null, url !== undefined]);
    return { ok: true, datos: c, resumen: `🛡 Guardia de ${p.nombre}: ${c.activo ? "activa" : "apagada"}${c.url_produccion ? ` · producción ${c.url_produccion}` : ""} · ${c.auto_reparar ? "lo grave lo arreglo en sandbox y te pido OK" : "solo aviso, no reparo"}.${p.cmd_test || p.cmd_build ? "" : " ⚠ El proyecto no tiene cmd_test ni cmd_build: solo puedo vigilar proceso, logs y URL."}` };
  },
};

export const guardiaEstado: DefTool = {
  nombre: "guardia_estado", modulo: MODULO,
  descripcion: "Qué vigila la guardia, cuándo fue la última ronda y los hallazgos abiertos (graves y leves) con su estado.",
  parametros: { type: "object", properties: { proyecto: { type: "string", description: "Solo este (opcional)." } } },
  riesgo: "lectura", requiereAprobacion: false, timeoutSeg: 20,
  async ejecutar(a) {
    const cfgs = await query(`SELECT p.nombre, g.activo, g.url_produccion, g.auto_reparar, g.ultimo_commit, g.ultima_ronda FROM guardia_proyectos g JOIN proyectos p ON p.id = g.proyecto_id ORDER BY p.nombre`);
    const hs = await hallazgosAbiertos(a.proyecto);
    const lineas = [
      cfgs.length ? `Vigilados:\n${cfgs.map((c: any) => `• ${c.nombre}: ${c.activo ? "activa" : "apagada"}${c.url_produccion ? ` · ${c.url_produccion}` : ""} · última ronda ${c.ultima_ronda ? new Date(c.ultima_ronda).toLocaleString("es-CO") : "nunca"}${c.ultimo_commit ? ` · verificado ${String(c.ultimo_commit).slice(0, 7)}` : ""}`).join("\n")}` : "No hay proyectos registrados en la guardia (lo publicado en Railway se vigila solo).",
      hs.length ? `\nAbiertos:\n${hs.map((h) => `• [${h.id.slice(0, 8)}] ${h.severidad === "grave" ? "🚨" : "📝"} ${h.objetivo}: ${h.titulo} — ${h.estado}${h.veces > 1 ? ` (×${h.veces})` : ""}`).join("\n")}` : "\nSin hallazgos abiertos.",
    ];
    return { ok: true, datos: { vigilados: cfgs, abiertos: hs }, resumen: lineas.join("\n") };
  },
};

export const guardiaIgnorar: DefTool = {
  nombre: "guardia_ignorar", modulo: MODULO,
  descripcion: "Marca un hallazgo de la guardia como ignorado (no se vuelve a avisar mientras sea el mismo). Usa el id de 8 caracteres que muestra guardia_estado.",
  parametros: { type: "object", properties: { id: { type: "string", minLength: 8 } }, required: ["id"] },
  riesgo: "escritura", requiereAprobacion: false, timeoutSeg: 20,
  async ejecutar(a) {
    const [h] = await query<{ id: string; titulo: string }>(`SELECT id, titulo FROM guardia_hallazgos WHERE id::text LIKE $1 || '%' LIMIT 2`, [String(a.id).toLowerCase()]);
    if (!h) return { ok: false, error: "No encuentro ese hallazgo." };
    await marcarHallazgo(h.id, { estado: "ignorado" });
    return { ok: true, resumen: `Ignorado: ${h.titulo}` };
  },
};

export const toolsGuardia = [guardiaConfigurar, guardiaEstado, guardiaIgnorar];
