// ARCHIVO: src/tools/radar.ts
// ─────────────────────────────────────────────────────────────────────────────
//  TOOLS DEL RADAR (Soga): qué vigila en el mundo, agregar/quitar temas,
//  revisar ya, ver novedades y ajustar umbrales, hora y perfil.
// ─────────────────────────────────────────────────────────────────────────────
import type { DefTool } from "../registro/tipos.js";
import { query } from "../db/cliente.js";
import { temas, ejecutarRadar, configRadar, guardarConfigRadar, resumenRadar, PERFIL_POR_DEFECTO } from "../motor/radar.js";

const MODULO = "radar";
const TIPO = { tema: "🔎 tema", repos: "⭐ repos nuevos", versiones: "🏷 versiones", modelos: "🤖 modelos", secop: "🏛 SECOP", proyectos: "🔐 librerías" } as const;

export const radarTemas: DefTool = {
  nombre: "radar_temas", modulo: MODULO,
  descripcion: "Qué vigila el radar de Soga en el mundo (temas, modelos y precios, versiones de herramientas, repos nuevos, contratos SECOP, librerías de los proyectos), cada cuánto, cuándo revisó y cómo está configurado.",
  parametros: { type: "object", properties: {} },
  riesgo: "lectura", requiereAprobacion: false, timeoutSeg: 20,
  async ejecutar() {
    const ts = await temas(), cfg = await configRadar();
    const [h] = await query<any>(`SELECT count(*) FILTER (WHERE visto_en > now() - interval '7 days')::int AS semana, count(*) FILTER (WHERE destino = 'avisado' AND visto_en > now() - interval '7 days')::int AS avisados FROM radar_vistos`);
    return { ok: true, datos: { temas: ts, config: cfg }, resumen: `📡 Radar ${cfg.activo ? "encendido" : "APAGADO"} · resumen diario ${cfg.hora_resumen} · aviso inmediato desde ${cfg.umbral_aviso}/10, resumen desde ${cfg.umbral_resumen}/10\nEsta semana: ${h.semana} hallazgos nuevos, ${h.avisados} avisados.\n\n` +
      ts.map((t) => `${t.activo ? "" : "⏸ "}${TIPO[t.tipo]} · *${t.nombre}* (${t.frecuencia}) — ${t.ultimo ? `revisado ${new Date(t.ultimo).toLocaleString("es-CO", { timeZone: "America/Bogota", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}` : "aún no"}\n   ${t.config.consultas?.join(" · ") || t.config.repos?.join(" · ") || t.config.textos?.join(" · ") || (t.config.precios ? `nuevos + precios de ${t.config.precios.join(", ")}` : "todos los proyectos registrados")}`).join("\n") };
  },
};

export const radarAgregar: DefTool = {
  nombre: "radar_agregar", modulo: MODULO,
  descripcion: "Agrega (o actualiza) algo al radar. tipo 'tema' con consultas (mejor en inglés), 'versiones' con repos de GitHub (dueño/nombre) para avisar nuevas versiones, 'repos' con consultas de GitHub (topic:x), 'secop' con textos de contratos, 'modelos' con ids de OpenRouter cuyo precio vigilar.",
  parametros: { type: "object", properties: {
    nombre: { type: "string", minLength: 3 },
    tipo: { type: "string", enum: ["tema", "versiones", "repos", "secop", "modelos"] },
    consultas: { type: "array", items: { type: "string" }, description: "Para 'tema' y 'repos'." },
    repos: { type: "array", items: { type: "string" }, description: "Para 'versiones'." },
    textos: { type: "array", items: { type: "string" }, description: "Para 'secop'." },
    departamento: { type: "string", description: "Para 'secop' (opcional)." },
    modelos: { type: "array", items: { type: "string" }, description: "Para 'modelos': ids a vigilar el precio." },
    frecuencia: { type: "string", enum: ["diario", "semanal"] },
  }, required: ["nombre", "tipo"] },
  riesgo: "escritura", requiereAprobacion: false, timeoutSeg: 20,
  async ejecutar(a) {
    const config = a.tipo === "tema" || a.tipo === "repos" ? { consultas: a.consultas || [a.nombre], ...(a.tipo === "repos" ? { estrellas_min: 200, dias: 14 } : {}) }
      : a.tipo === "versiones" ? { repos: a.repos || [] } : a.tipo === "secop" ? { textos: a.textos || [a.nombre], dias: 3, ...(a.departamento ? { departamento: a.departamento } : {}) } : { nuevos: false, precios: a.modelos || [] };
    await temas();   // asegura los de por defecto
    await query(`INSERT INTO radar_temas (nombre, tipo, config, frecuencia) VALUES ($1,$2,$3,COALESCE($4,'diario')) ON CONFLICT (nombre) DO UPDATE SET tipo = EXCLUDED.tipo, config = EXCLUDED.config, frecuencia = COALESCE($4, radar_temas.frecuencia), activo = true`, [a.nombre, a.tipo, JSON.stringify(config), a.frecuencia || null]);
    return { ok: true, resumen: `📡 Listo: vigilo "${a.nombre}" (${TIPO[a.tipo as keyof typeof TIPO]}, ${a.frecuencia || "diario"}). Lo reviso en la próxima vuelta; si quieres ya, pídeme "revisa el radar".` };
  },
};

export const radarQuitar: DefTool = {
  nombre: "radar_quitar", modulo: MODULO,
  descripcion: "Pausa (o reactiva) un tema del radar por su nombre.",
  parametros: { type: "object", properties: { nombre: { type: "string" }, reactivar: { type: "boolean" } }, required: ["nombre"] },
  riesgo: "escritura", requiereAprobacion: false, timeoutSeg: 20,
  async ejecutar(a) {
    const [t] = await query<any>(`UPDATE radar_temas SET activo = $2 WHERE nombre ILIKE '%' || $1 || '%' RETURNING nombre`, [a.nombre, !!a.reactivar]);
    return t ? { ok: true, resumen: `${a.reactivar ? "▶ Reactivado" : "⏸ Pausado"}: ${t.nombre}.` } : { ok: false, error: `No hay un tema "${a.nombre}" (radar_temas).` };
  },
};

export const radarAhora: DefTool = {
  nombre: "radar_ahora", modulo: MODULO,
  descripcion: "Revisa el radar YA (todo, o solo un tema) y cuenta lo nuevo que encontró, con su relevancia. Lo importante también llega solo como aviso.",
  parametros: { type: "object", properties: { tema: { type: "string", description: "Solo este tema (parte del nombre)." } } },
  riesgo: "lectura", requiereAprobacion: false, timeoutSeg: 900,
  async ejecutar(a) {
    const r = await ejecutarRadar({ forzar: true, soloTema: a.tema, avisar: false });
    const pendientes = await query<any>(`SELECT titulo, porque, url, relevancia FROM radar_vistos WHERE destino IN ('avisado','resumen') AND visto_en > now() - interval '15 minutes' ORDER BY relevancia DESC LIMIT 12`);
    if (pendientes.length) await query(`UPDATE radar_vistos SET destino = 'resumido' WHERE destino = 'resumen' AND visto_en > now() - interval '15 minutes'`);
    return { ok: true, datos: r, resumen: `Revisé: ${r.temas.join(", ") || "nada"}. ${r.nuevos} hallazgo(s) nuevo(s): ${r.avisados.length} importantes, ${r.resumen} interesantes, ${r.descartados} descartados.${r.errores.length ? `\n⚠ ${r.errores.join(" · ")}` : ""}` +
      (pendientes.length ? `\n\n${pendientes.map((p) => `• [${p.relevancia}/10] ${p.titulo}${p.porque ? ` — ${p.porque}` : ""}${p.url ? `\n  ${p.url}` : ""}`).join("\n")}` : "") };
  },
};

export const radarNovedades: DefTool = {
  nombre: "radar_novedades", modulo: MODULO,
  descripcion: "Lo que encontró el radar en los últimos días (de más a menos relevante), aunque no se haya avisado. Para 'qué hay de nuevo', 'novedades del radar', 'qué salió esta semana en IA'.",
  parametros: { type: "object", properties: { dias: { type: "integer", default: 7 }, tema: { type: "string" }, min_relevancia: { type: "integer", default: 5 }, max: { type: "integer", default: 15 } } },
  riesgo: "lectura", requiereAprobacion: false, timeoutSeg: 20,
  async ejecutar(a) {
    const xs = await query<any>(`SELECT * FROM radar_vistos WHERE visto_en > now() - make_interval(days => $1) AND relevancia >= $2 AND ($3::text IS NULL OR tema ILIKE '%' || $3 || '%') ORDER BY relevancia DESC, visto_en DESC LIMIT $4`, [a.dias || 7, a.min_relevancia ?? 5, a.tema || null, a.max || 15]);
    if (!xs.length) return { ok: true, datos: [], resumen: `Nada con relevancia ≥ ${a.min_relevancia ?? 5} en los últimos ${a.dias || 7} días${a.tema ? ` en "${a.tema}"` : ""}.` };
    return { ok: true, datos: xs, resumen: xs.map((x) => `• [${x.relevancia}/10 · ${x.tema}] ${x.titulo}${x.porque ? ` — ${x.porque}` : ""}${x.url ? `\n  ${x.url}` : ""}`).join("\n") };
  },
};

export const radarConfigurar: DefTool = {
  nombre: "radar_configurar", modulo: MODULO,
  descripcion: "Ajusta el radar: encender/apagar, hora del resumen diario, desde qué puntaje avisar de inmediato o mandar al resumen, y qué agregarle al perfil del jefe (para puntuar mejor). 'ver_resumen' muestra el resumen pendiente.",
  parametros: { type: "object", properties: {
    activo: { type: "boolean" }, hora_resumen: { type: "string", description: "HH:MM" },
    umbral_aviso: { type: "integer", minimum: 5, maximum: 10 }, umbral_resumen: { type: "integer", minimum: 1, maximum: 9 },
    perfil_agregar: { type: "string", description: "Algo más sobre sus intereses (se suma al perfil)." }, perfil_reiniciar: { type: "boolean" }, ver_resumen: { type: "boolean" },
  } },
  riesgo: "escritura", requiereAprobacion: false, timeoutSeg: 20,
  async ejecutar(a) {
    if (a.ver_resumen) return { ok: true, resumen: (await resumenRadar(false)) || "No hay nada pendiente para el resumen." };
    const cfg = await configRadar();
    const cambios: any = {};
    for (const k of ["activo", "hora_resumen", "umbral_aviso", "umbral_resumen"]) if (a[k] !== undefined) cambios[k] = a[k];
    if (a.hora_resumen && !/^\d{1,2}:\d{2}$/.test(a.hora_resumen)) return { ok: false, error: "La hora va como HH:MM (p. ej. 12:30)." };
    if (a.perfil_reiniciar) cambios.perfil = PERFIL_POR_DEFECTO;
    if (a.perfil_agregar) cambios.perfil = `${cambios.perfil || cfg.perfil} ${String(a.perfil_agregar).trim()}`;
    await guardarConfigRadar(cambios);
    const n = await configRadar();
    return { ok: true, resumen: `📡 Radar ${n.activo ? "encendido" : "apagado"} · resumen ${n.hora_resumen} · aviso ≥${n.umbral_aviso}/10 · resumen ≥${n.umbral_resumen}/10${a.perfil_agregar ? "\nPerfil actualizado." : ""}` };
  },
};

export const toolsRadar = [radarTemas, radarAgregar, radarQuitar, radarAhora, radarNovedades, radarConfigurar];
