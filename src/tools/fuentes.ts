// ARCHIVO: src/tools/fuentes.ts
// ─────────────────────────────────────────────────────────────────────────────
//  TOOLS DE FUENTES ESPECIALES (Soga): video/audio, GitHub, papers, foros,
//  paquetes y seguridad, modelos de IA, SECOP y TRM.
// ─────────────────────────────────────────────────────────────────────────────
import type { DefTool } from "../registro/tipos.js";
import * as F from "../motor/fuentes.js";

const MODULO = "fuente";
const err = (e: any, extra = "") => ({ ok: false as const, error: `${e?.message || e}${extra}` });
const n = (x: number) => x.toLocaleString("es-CO");
const usd = (x: number) => (x === 0 ? "gratis" : x < 0.01 ? `$${x.toFixed(4)}` : `$${x.toFixed(2)}`);
const min = (s: number) => (s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")} min` : "");

export const fuenteVideo: DefTool = {
  nombre: "fuente_video", modulo: MODULO,
  descripcion: "Transcribe y resume un video o audio por URL: YouTube, Vimeo, X, TikTok, pódcast o mp3. Usa los subtítulos y, si no hay, baja el audio y lo transcribe. Devuelve el resumen con minutos (o el texto completo con transcripcion=true). Para 'qué dice este video', 'resúmeme esta charla', 'qué herramientas muestra'.",
  parametros: { type: "object", properties: {
    url: { type: "string", minLength: 8 },
    enfoque: { type: "string", description: "En qué fijarse (p. ej. 'las herramientas que menciona y precios')." },
    transcripcion: { type: "boolean", description: "Devolver el texto completo con marcas de tiempo en vez del resumen." },
    idioma: { type: "string", description: "Idioma preferido (es, en)." },
    max_chars: { type: "integer", minimum: 2000, maximum: 60000, default: 20000 },
  }, required: ["url"] },
  riesgo: "lectura", requiereAprobacion: false, timeoutSeg: 1200,
  async ejecutar(a) {
    try {
      const t = await F.transcribirVideo(a.url, { idioma: a.idioma });
      const cab = `🎬 ${t.titulo}${t.canal ? ` — ${t.canal}` : ""}${t.fecha ? ` · ${t.fecha}` : ""}${t.duracionSeg ? ` · ${min(t.duracionSeg)}` : ""}\n${t.url}\n(${t.origen === "audio" ? "transcrito del audio" : t.origen === "subtitulos" ? "subtítulos" : "subtítulos automáticos"}, ${t.idioma})`;
      if (a.transcripcion) { const max = a.max_chars || 20000; return { ok: true, datos: { ...t, texto: undefined }, resumen: `${cab}\n\n${t.texto.slice(0, max)}${t.texto.length > max ? "\n[... recortado]" : ""}` }; }
      return { ok: true, datos: { ...t, texto: undefined }, resumen: `${cab}\n\n${await F.resumirTranscripcion(t, a.enfoque)}` };
    } catch (e) { return err(e); }
  },
};

export const fuenteGithub: DefTool = {
  nombre: "fuente_github", modulo: MODULO,
  descripcion: "Ficha de un repositorio de GitHub (dueño/nombre o URL): qué es, estrellas, licencia, si está vivo (commits en 30 días, último cambio), última versión con sus notas y el README. Para evaluar una herramienta o librería antes de recomendarla.",
  parametros: { type: "object", properties: { repo: { type: "string", minLength: 3 }, readme_chars: { type: "integer", minimum: 0, maximum: 30000, default: 6000 } }, required: ["repo"] },
  riesgo: "lectura", requiereAprobacion: false, timeoutSeg: 60,
  async ejecutar(a) {
    try {
      const r = await F.infoRepo(a.repo, { readmeChars: a.readme_chars ?? 6000 });
      return { ok: true, datos: r, resumen: [
        `📦 ${r.repo} — ${r.url}`, r.descripcion,
        `⭐ ${n(r.estrellas)} · 🍴 ${n(r.forks)} · ${r.lenguaje || "?"} · licencia ${r.licencia} · issues abiertos ${n(r.issues_abiertos)}`,
        `Salud: ${r.salud} · creado ${r.creado} · último cambio ${r.ultimo_push}`,
        r.ultima_version ? `Última versión: ${r.ultima_version.tag} (${r.ultima_version.fecha})${r.ultima_version.notas ? `\n${r.ultima_version.notas.slice(0, 500)}` : ""}` : "Sin versiones publicadas.",
        r.temas.length ? `Temas: ${r.temas.join(", ")}` : "", r.web ? `Web: ${r.web}` : "",
        r.readme ? `\n── README ──\n${r.readme}` : "",
      ].filter(Boolean).join("\n") };
    } catch (e) { return err(e); }
  },
};

export const fuenteGithubBuscar: DefTool = {
  nombre: "fuente_github_buscar", modulo: MODULO,
  descripcion: "Busca repositorios en GitHub (herramientas, librerías, servidores MCP, skills, agentes…). Usa la sintaxis de GitHub si quieres: 'mcp server language:typescript', 'topic:ai-agents'. Ordena por estrellas o por actualizados.",
  parametros: { type: "object", properties: {
    consulta: { type: "string", minLength: 2 },
    orden: { type: "string", enum: ["estrellas", "actualizados"] },
    activos_dias: { type: "integer", description: "Solo repos con cambios en los últimos N días (p. ej. 90)." },
    max: { type: "integer", minimum: 1, maximum: 30, default: 10 },
  }, required: ["consulta"] },
  riesgo: "lectura", requiereAprobacion: false, timeoutSeg: 60,
  async ejecutar(a) {
    try {
      const xs = await F.buscarRepos(a.consulta, { orden: a.orden, max: a.max, activosDesde: a.activos_dias ? new Date(Date.now() - a.activos_dias * 86400_000).toISOString().slice(0, 10) : undefined });
      if (!xs.length) return { ok: false, error: `GitHub no tiene repos para "${a.consulta}".` };
      return { ok: true, datos: xs, resumen: xs.map((r: any, i: number) => `${i + 1}. ${r.repo} ⭐${n(r.estrellas)} · ${r.lenguaje || "?"} · ${r.licencia} · último cambio ${r.ultimo_push}${r.archivado ? " · ARCHIVADO" : ""}\n   ${r.descripcion.slice(0, 160)} — ${r.url}`).join("\n") };
    } catch (e) { return err(e); }
  },
};

export const fuentePapers: DefTool = {
  nombre: "fuente_papers", modulo: MODULO,
  descripcion: "Busca papers científicos en arXiv (IA, computación, matemáticas, robótica, física…). Devuelve título, fecha, autores, resumen y PDF (léelo con web_leer).",
  parametros: { type: "object", properties: { consulta: { type: "string", minLength: 2, description: "Mejor en inglés." }, recientes: { type: "boolean", description: "Los más nuevos primero (si no, por relevancia)." }, max: { type: "integer", minimum: 1, maximum: 20, default: 8 } }, required: ["consulta"] },
  riesgo: "lectura", requiereAprobacion: false, timeoutSeg: 60,
  async ejecutar(a) {
    try {
      const xs = await F.buscarPapers(a.consulta, { recientes: a.recientes, max: a.max });
      if (!xs.length) return { ok: false, error: `arXiv no tiene papers para "${a.consulta}". Prueba en inglés o con otras palabras.` };
      return { ok: true, datos: xs, resumen: xs.map((p, i) => `${i + 1}. ${p.titulo} (${p.fecha}) — ${p.autores.join(", ")}\n   ${p.resumen.slice(0, 260)}\n   ${p.url}${p.pdf ? ` · PDF ${p.pdf}` : ""}`).join("\n") };
    } catch (e) { return err(e); }
  },
};

export const fuenteForos: DefTool = {
  nombre: "fuente_foros", modulo: MODULO,
  descripcion: "Qué opina la gente que de verdad lo usa: busca en Hacker News y Reddit, con puntos, fecha y los mejores comentarios de los hilos más discutidos. Para experiencias reales, problemas comunes, comparaciones honestas.",
  parametros: { type: "object", properties: {
    consulta: { type: "string", minLength: 2, description: "Mejor en inglés." },
    sitio: { type: "string", enum: ["ambos", "hn", "reddit"], default: "ambos" },
    dias: { type: "integer", description: "Solo de los últimos N días." },
    max: { type: "integer", minimum: 1, maximum: 15, default: 6 },
  }, required: ["consulta"] },
  riesgo: "lectura", requiereAprobacion: false, timeoutSeg: 90,
  async ejecutar(a) {
    try {
      const r = await F.buscarForos(a.consulta, { sitio: a.sitio, desdeDias: a.dias, max: a.max });
      if (!r.hilos.length) return { ok: false, error: `Sin hilos para "${a.consulta}". ${r.avisos.join(" ")}` };
      return { ok: true, datos: r, resumen: r.hilos.map((h) => `• [${h.sitio}${h.comunidad ? ` ${h.comunidad}` : ""}] ${h.titulo} — ${h.puntos} pts, ${h.comentarios} comentarios, ${h.fecha}\n  ${h.url}${h.texto ? `\n  ${h.texto.slice(0, 200)}` : ""}${h.mejores_comentarios.length ? `\n  Comentarios:\n${h.mejores_comentarios.map((c) => `   › ${c.replace(/\s+/g, " ").slice(0, 280)}`).join("\n")}` : ""}`).join("\n") + (r.avisos.length ? `\n⚠ ${r.avisos.join(" ")}` : "") };
    } catch (e) { return err(e); }
  },
};

export const fuentePaquete: DefTool = {
  nombre: "fuente_paquete", modulo: MODULO,
  descripcion: "Una librería de npm o PyPI: última versión y fecha, si está obsoleta, licencia, descargas y fallos de seguridad conocidos (OSV). Con 'version' dice si ESA versión tiene fallos y en cuál se corrigen.",
  parametros: { type: "object", properties: { nombre: { type: "string", minLength: 1 }, ecosistema: { type: "string", enum: ["npm", "PyPI"], default: "npm" }, version: { type: "string" } }, required: ["nombre"] },
  riesgo: "lectura", requiereAprobacion: false, timeoutSeg: 60,
  async ejecutar(a) {
    try {
      const eco = (a.ecosistema || "npm") as F.Ecosistema;
      const [i, v] = await Promise.all([F.infoPaquete(a.nombre, eco), F.vulnerabilidades(a.nombre, eco, a.version)]);
      return { ok: true, datos: { info: i, vulnerabilidades: v }, resumen: [
        `📦 ${i.nombre} (${eco}) — última ${i.ultima} (${i.fecha_ultima})${i.obsoleto ? ` · ⚠ OBSOLETA: ${i.obsoleto}` : ""}`,
        i.descripcion, `Licencia ${i.licencia || "?"}${i.descargas_semana != null ? ` · ${n(i.descargas_semana)} descargas/semana` : ""}${i.repo ? ` · ${i.repo}` : ""}`,
        v.length ? `🔐 ${v.length} fallo(s) de seguridad${a.version ? ` en ${a.version}` : " conocidos"}:\n${v.slice(0, 8).map((x) => `  • ${x.id} [${x.severidad}] ${x.resumen}${x.corregida_en ? ` → corregido en ${x.corregida_en}` : ""}`).join("\n")}` : `🔐 Sin fallos de seguridad conocidos${a.version ? ` en ${a.version}` : ""}.`,
      ].filter(Boolean).join("\n") };
    } catch (e) { return err(e); }
  },
};

export const fuenteDependencias: DefTool = {
  nombre: "fuente_dependencias", modulo: MODULO,
  descripcion: "Revisa las librerías de un proyecto registrado (package.json / requirements.txt): cuáles tienen fallos de seguridad, cuáles están obsoletas y cuáles atrasadas (con salto de versión mayor). Solo lee; el arreglo lo hace Sage si el jefe lo pide.",
  parametros: { type: "object", properties: { proyecto: { type: "string", minLength: 2 } }, required: ["proyecto"] },
  riesgo: "lectura", requiereAprobacion: false, timeoutSeg: 240,
  async ejecutar(a) {
    try {
      const r = await F.revisarDependencias(a.proyecto);
      const graves = r.vulnerables.filter((x) => x.vulns.some((v) => /high|critical|alta|cr[ií]tica/.test(v.severidad)));
      return { ok: true, datos: r, resumen: [
        `🔎 ${r.proyecto}: ${r.revisadas} librerías revisadas.`,
        r.vulnerables.length ? `🔐 Con fallos de seguridad (${r.vulnerables.length}${graves.length ? `, ${graves.length} graves` : ""}):\n${r.vulnerables.map((x) => `  • ${x.nombre}@${x.version}: ${x.vulns.slice(0, 3).map((v) => `${v.id} [${v.severidad}]${v.corregida_en ? ` → ${v.corregida_en}` : ""}`).join("; ")}`).join("\n")}` : "🔐 Ninguna con fallos de seguridad conocidos. ✅",
        r.obsoletas.length ? `⚠ Obsoletas:\n${r.obsoletas.map((x) => `  • ${x.nombre}: ${x.mensaje}`).join("\n")}` : "",
        r.atrasadas.length ? `⏫ Atrasadas (${r.atrasadas.length}):\n${r.atrasadas.slice(0, 15).map((x) => `  • ${x.nombre} ${x.version} → ${x.ultima}${x.salto_mayor ? " (versión mayor: puede romper)" : ""}`).join("\n")}` : "",
        r.vulnerables.length ? "\nSi quieres, se lo paso a Sage para actualizar en un sandbox y probar antes de subir." : "",
      ].filter(Boolean).join("\n") };
    } catch (e) { return err(e); }
  },
};

export const fuenteModelos: DefTool = {
  nombre: "fuente_modelos", modulo: MODULO,
  descripcion: "Catálogo vivo de modelos de IA (más de 300, vía OpenRouter): precio por millón de tokens de entrada/salida, contexto, si ve imágenes/audio, y fecha de salida. Para 'cuánto cuesta X', 'qué modelos nuevos hay', 'el más barato que vea imágenes', 'compara A y B'. Para el precio OFICIAL directo del proveedor confirma con web_verificar.",
  parametros: { type: "object", properties: {
    buscar: { type: "string", description: "Palabras del nombre (p. ej. 'claude haiku', 'llama 4', 'gemini flash')." },
    proveedor: { type: "string", description: "anthropic, openai, google, meta-llama, mistralai, deepseek, qwen, x-ai…" },
    orden: { type: "string", enum: ["nuevos", "precio", "contexto"] },
    gratis: { type: "boolean" },
    entrada: { type: "string", enum: ["imagen", "audio", "video", "archivo"], description: "Que acepte este tipo de entrada." },
    max: { type: "integer", minimum: 1, maximum: 40, default: 12 },
  } },
  riesgo: "lectura", requiereAprobacion: false, timeoutSeg: 60,
  async ejecutar(a) {
    try {
      const r = await F.buscarModelos({ buscar: a.buscar, proveedor: a.proveedor, orden: a.orden, gratis: a.gratis, entrada: a.entrada, max: a.max });
      if (!r.modelos.length) return { ok: false, error: "Ningún modelo coincide con ese filtro." };
      return { ok: true, datos: r, resumen: `${r.total} modelo(s)${r.total > r.modelos.length ? `, muestro ${r.modelos.length}` : ""} · precios en US$ por millón de tokens (entrada / salida), vía OpenRouter:\n` + r.modelos.map((m) => `• ${m.nombre} (${m.id}) — ${usd(m.entrada_usd_m)} / ${usd(m.salida_usd_m)} · contexto ${m.contexto ? `${n(Math.round(m.contexto / 1000))}k` : "?"} · ${m.entradas.join("+")} · salió ${m.creado}`).join("\n") };
    } catch (e) { return err(e); }
  },
};

export const fuenteSecop: DefTool = {
  nombre: "fuente_secop", modulo: MODULO,
  descripcion: "Busca procesos de contratación pública en SECOP II (Colombia, datos.gov.co): entidad, objeto, estado, modalidad, precio base, fechas y link. Para oportunidades de Jelcom (software, sistemas de información, hospitales, mensajería, IA…).",
  parametros: { type: "object", properties: {
    texto: { type: "string", minLength: 3, description: "Palabras del objeto (p. ej. 'software hospital', 'mensajería de texto', 'sistema de información')." },
    dias: { type: "integer", description: "Publicados en los últimos N días (30 por defecto)." },
    departamento: { type: "string", description: "Filtrar por departamento/ciudad (p. ej. Santander)." },
    solo_abiertos: { type: "boolean", description: "Solo los que aún reciben ofertas (por defecto sí)." },
    precio_min: { type: "number", description: "Precio base mínimo en pesos." },
    max: { type: "integer", minimum: 1, maximum: 40, default: 15 },
  }, required: ["texto"] },
  riesgo: "lectura", requiereAprobacion: false, timeoutSeg: 90,
  async ejecutar(a) {
    try {
      const xs = await F.buscarSecop(a.texto, { dias: a.dias, departamento: a.departamento, soloAbiertos: a.solo_abiertos, precioMin: a.precio_min, max: a.max });
      if (!xs.length) return { ok: false, error: `Sin procesos ${a.solo_abiertos === false ? "" : "abiertos "}para "${a.texto}" en los últimos ${a.dias || 30} días${a.departamento ? ` en ${a.departamento}` : ""}.` };
      return { ok: true, datos: xs, resumen: xs.map((p, i) => `${i + 1}. ${p.entidad}${p.ciudad || p.departamento ? ` (${[p.ciudad, p.departamento].filter(Boolean).join(", ")})` : ""}\n   ${p.nombre || p.descripcion.slice(0, 140)}\n   ${p.estado || "?"} · ${p.modalidad || "?"}${p.precio_base ? ` · $${n(p.precio_base)}` : ""} · publicado ${p.publicado}${p.cierre ? ` · cierre ${p.cierre}` : ""}${p.url ? `\n   ${p.url}` : ""}`).join("\n") };
    } catch (e) { return err(e); }
  },
};

export const fuenteTrm: DefTool = {
  nombre: "fuente_trm", modulo: MODULO,
  descripcion: "TRM oficial del dólar en Colombia (Superfinanciera, datos.gov.co): la de hoy o la de una fecha, con los últimos días. Para convertir precios en dólares a pesos.",
  parametros: { type: "object", properties: { fecha: { type: "string", description: "AAAA-MM-DD (opcional)." }, usd: { type: "number", description: "Monto en dólares a convertir (opcional)." } } },
  riesgo: "lectura", requiereAprobacion: false, timeoutSeg: 40,
  async ejecutar(a) {
    try {
      const t = await F.trm(a.fecha);
      return { ok: true, datos: t, resumen: `💵 TRM: $${n(t.valor)} (vigente ${t.desde}${t.hasta && t.hasta !== t.desde ? ` a ${t.hasta}` : ""})${a.usd ? `\nUS$${n(a.usd)} = $${n(Math.round(a.usd * t.valor))} pesos` : ""}\nÚltimos días: ${t.historial.slice(1, 6).map((h) => `${h.fecha} $${n(h.valor)}`).join(" · ")}` };
    } catch (e) { return err(e); }
  },
};

export const toolsFuentes = [fuenteVideo, fuenteGithub, fuenteGithubBuscar, fuentePapers, fuenteForos, fuentePaquete, fuenteDependencias, fuenteModelos, fuenteSecop, fuenteTrm];
