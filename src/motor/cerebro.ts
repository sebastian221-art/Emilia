// ARCHIVO: src/motor/cerebro.ts
// ─────────────────────────────────────────────────────────────────────────────
//  CEREBRO COMPARTIDO DE EMILIA
//  Toda la memoria y el conocimiento del equipo en una sola red (bib_nodos):
//    • clases: hecho, episodio, procedimiento, persona, perfil, lección,
//      capacidad, conocimiento, resumen
//    • carpetas (espacios): general, personal, proyecto:<slug>
//  Recordar funciona como una red:
//    1. por SIGNIFICADO (pgvector, o vectores en arreglo si no está)
//    2. por PALABRAS (texto indexado)
//    3. se fusionan (RRF) y se ENCIENDEN los vecinos conectados
//       (activación que se propaga, más débil a cada salto)
//    4. se pondera por confianza, fuerza (uso), importancia y frescura
//    5. lo que se usa se REFUERZA, y lo que se recuerda junto se conecta
//  Al agente le llega un bloque con presupuesto fijo: primero el resumen de
//  la carpeta, después lo más relevante. Crece sin ponerse lento.
// ─────────────────────────────────────────────────────────────────────────────
import { db, query } from "../db/cliente.js";
import { embed, embedDoc, coseno, versionEmbeddings } from "./embeddings.js";
import { slugDe } from "./biblioteca.js";

export type Clase = "conocimiento" | "hecho" | "episodio" | "procedimiento" | "persona" | "perfil" | "leccion" | "capacidad" | "resumen";
export const CLASES: Clase[] = ["conocimiento", "hecho", "episodio", "procedimiento", "persona", "perfil", "leccion", "capacidad", "resumen"];
export interface Recuerdo { id: string; slug: string; titulo: string; resumen: string; clase: Clase; espacio: string; tipo: string; estado: string; confianza: number; fuerza: number; importancia: number; etiquetas: string[]; ocurrio_en: string | null; actualizado_en: string; privado: boolean; ficha: any; score?: number; via?: string }

// ── ¿Hay pgvector? ───────────────────────────────────────────────────────────
let conVector: boolean | null = null;
export async function hayPgvector(): Promise<boolean> {
  if (conVector !== null) return conVector;
  if (process.env.CEREBRO_SIN_PGVECTOR === "true") return (conVector = false);
  const [r] = await query<{ n: number }>(`SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = 'bib_nodos' AND column_name = 'vec'`).catch(() => [{ n: 0 }]);
  conVector = r.n > 0; return conVector;
}
const lit = (v: number[]) => `[${v.map((x) => (Number.isFinite(x) ? x.toFixed(6) : "0")).join(",")}]`;
const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const VACIAS = new Set(["para", "como", "sobre", "donde", "cuando", "porque", "esta", "este", "estos", "esas", "tiene", "hacer", "algo", "todo", "pero", "entonces", "tambien", "que", "los", "las", "una", "uno", "del", "con", "por", "mas", "muy", "hay", "fue", "ser", "the", "and", "for", "with"]);
const palabras = (q: string) => [...new Set(norm(q).split(/[^a-z0-9ñ]+/).filter((w) => w.length >= 3 && !VACIAS.has(w)))].slice(0, 12);

// ── Carpetas ─────────────────────────────────────────────────────────────────
export const espacioProyecto = (proyecto: string) => `proyecto:${slugDe(proyecto).replace(/-/g, "_")}`;
export async function asegurarEspacio(slug: string, p: { nombre?: string; descripcion?: string; proyecto?: string } = {}) {
  const tipo = slug === "general" ? "general" : slug === "personal" ? "personal" : "proyecto";
  await query(`INSERT INTO bib_espacios (slug, nombre, tipo, descripcion, proyecto) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (slug) DO UPDATE SET descripcion = COALESCE(EXCLUDED.descripcion, bib_espacios.descripcion), proyecto = COALESCE(EXCLUDED.proyecto, bib_espacios.proyecto)`,
    [slug, p.nombre || slug.replace(/^proyecto:/, ""), tipo, p.descripcion || null, p.proyecto || null]);
}
export const espacios = () => query<any>(`SELECT e.*, (SELECT count(*)::int FROM bib_nodos n WHERE n.espacio = e.slug AND n.borrado_en IS NULL) AS nodos FROM bib_espacios e ORDER BY e.tipo, e.slug`);

// ── Guardar un recuerdo (sin duplicar) ───────────────────────────────────────
export interface NuevoRecuerdo {
  titulo: string; contenido: string; clase?: Clase; espacio?: string; tipo?: string; slug?: string;
  etiquetas?: string[]; importancia?: number; confianza?: number; estado?: string; ficha?: any;
  ocurrioEn?: string | Date | null; vigenteHasta?: string | Date | null; origenRef?: string | null; privado?: boolean;
  agenteId?: string | null; conectarCon?: { slug: string; relacion: string }[];
}
export interface ResultadoGuardar { nodo: Recuerdo; accion: "creado" | "actualizado" | "reforzado"; parecido?: { slug: string; titulo: string; sim: number } }

/** Vecinos por significado dentro de la misma carpeta (para no duplicar y para conectar). */
async function masParecidos(vec: number[], espacio: string, clase: string | null, n = 3, excluirId?: string): Promise<{ id: string; slug: string; titulo: string; resumen: string; clase: string; sim: number }[]> {
  if (await hayPgvector()) {
    return query<any>(`SELECT id, slug, titulo, resumen, clase, 1 - (vec <=> $1::vector) AS sim FROM bib_nodos
      WHERE borrado_en IS NULL AND vec IS NOT NULL AND espacio = $2 AND ($3::text IS NULL OR clase = $3) AND ($5::uuid IS NULL OR id <> $5)
      ORDER BY vec <=> $1::vector LIMIT $4`, [lit(vec), espacio, clase, n, excluirId || null]);
  }
  const xs = await query<any>(`SELECT id, slug, titulo, resumen, clase, embedding FROM bib_nodos WHERE borrado_en IS NULL AND embedding IS NOT NULL AND espacio = $1 AND ($2::text IS NULL OR clase = $2) AND ($3::uuid IS NULL OR id <> $3)`, [espacio, clase, excluirId || null]);
  return xs.map((x) => ({ ...x, sim: coseno(vec, x.embedding), embedding: undefined })).sort((a, b) => b.sim - a.sim).slice(0, n);
}

/** "2026-11-03" es un día de Bogotá (no medianoche UTC, que en Colombia cae el día anterior). */
const fechaBogota = (d: string | Date | null | undefined) => (!d ? null : d instanceof Date ? d : /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(`${d}T12:00:00-05:00`) : new Date(d));

export async function guardarRecuerdo(p: NuevoRecuerdo): Promise<ResultadoGuardar> {
  const espacio = p.espacio || "general", clase = p.clase || "hecho";
  if (espacio !== "general" && espacio !== "personal") await asegurarEspacio(espacio);
  const vec = await embedDoc(`${p.titulo}. ${p.contenido}`), version = await versionEmbeddings();
  let slug = p.slug;
  let parecido: ResultadoGuardar["parecido"];
  let contenido = p.contenido;
  if (!slug) {
    // ¿Ya lo sabemos? Mismo significado en la misma carpeta y clase → se refuerza/actualiza en vez de duplicar.
    const [c] = await masParecidos(vec, espacio, clase, 1);
    const umbral = version.startsWith("hashing") ? 0.9 : 0.93;
    if (c && (c.sim >= umbral || norm(c.titulo) === norm(p.titulo))) {
      parecido = { slug: c.slug, titulo: c.titulo, sim: +c.sim.toFixed(3) };
      const viejo = norm(c.resumen), nuevo = norm(p.contenido);
      // ¿Lo nuevo ya está dicho? (todas sus frases aparecen en lo que sabíamos)
      const frases = nuevo.split(/(?<=[.;:!?])\s+|\n+/).map((f) => f.replace(/[.;:!?\s]+$/, "").trim()).filter((f) => f.length > 8);
      const yaDicho = viejo.includes(nuevo.replace(/[.;:!?\s]+$/, "")) || (frases.length > 0 && frases.every((f) => viejo.includes(f)));
      if (yaDicho || c.sim >= 0.985) {
        await query(`UPDATE bib_nodos SET fuerza = LEAST(3, fuerza + 0.2), usos = usos + 1, actualizado_en = now(), importancia = GREATEST(importancia, $2) WHERE id = $1`, [c.id, p.importancia ?? 0]);
        const [n] = await query<Recuerdo>(`SELECT * FROM bib_nodos WHERE id = $1`, [c.id]);
        return { nodo: n, accion: "reforzado", parecido };
      }
      slug = c.slug;   // mismo tema con datos nuevos: se SUMAN al mismo nodo (nunca se pierde lo que ya sabíamos)
      contenido = `${c.resumen.trim()}\n${p.contenido.trim()}`;
    } else slug = `${clase === "conocimiento" ? "" : `${clase}-`}${slugDe(p.titulo).slice(0, 60)}`;
    // slug libre en otra carpeta
    const [ocupado] = await query<{ espacio: string }>(`SELECT espacio FROM bib_nodos WHERE slug = $1`, [slug]);
    if (ocupado && ocupado.espacio !== espacio) slug = `${slug}-${slugDe(espacio).slice(0, 20)}`;
  }
  const existia = (await query(`SELECT 1 FROM bib_nodos WHERE slug = $1`, [slug])).length > 0;
  const vecFinal = contenido === p.contenido ? vec : await embedDoc(`${p.titulo}. ${contenido}`);
  const conVec = await hayPgvector();
  const [n] = await query<Recuerdo>(`INSERT INTO bib_nodos (slug, titulo, tipo, resumen, ficha, estado, confianza, etiquetas, aprendido_por, embedding, espacio, clase, importancia, ocurrio_en, vigente_hasta, origen_ref, emb_version, privado${conVec ? ", vec" : ""})
    VALUES ($1,$2,COALESCE($3,'concepto'),$4,$5,COALESCE($6,'probable'),COALESCE($7,0.7),$8,$9,$10,$11,$12,COALESCE($13,0.5),$14,$15,$16,$17,COALESCE($18,false)${conVec ? ",$19::vector" : ""})
    ON CONFLICT (slug) DO UPDATE SET titulo = EXCLUDED.titulo, resumen = EXCLUDED.resumen, ficha = bib_nodos.ficha || EXCLUDED.ficha,
      estado = COALESCE($6, bib_nodos.estado), confianza = GREATEST(bib_nodos.confianza, COALESCE($7, bib_nodos.confianza)),
      etiquetas = (SELECT ARRAY(SELECT DISTINCT unnest(bib_nodos.etiquetas || EXCLUDED.etiquetas))), embedding = EXCLUDED.embedding,
      clase = EXCLUDED.clase, espacio = EXCLUDED.espacio, importancia = GREATEST(bib_nodos.importancia, EXCLUDED.importancia),
      ocurrio_en = COALESCE(EXCLUDED.ocurrio_en, bib_nodos.ocurrio_en), vigente_hasta = EXCLUDED.vigente_hasta, origen_ref = COALESCE(EXCLUDED.origen_ref, bib_nodos.origen_ref),
      emb_version = EXCLUDED.emb_version, privado = bib_nodos.privado OR EXCLUDED.privado, fuerza = LEAST(3, bib_nodos.fuerza + 0.1), actualizado_en = now(), borrado_en = NULL${conVec ? ", vec = EXCLUDED.vec" : ""}
    RETURNING *`,
    [slug, p.titulo.slice(0, 200), p.tipo || null, contenido.slice(-4000), JSON.stringify(p.ficha || {}), p.estado ?? null, p.confianza ?? null, p.etiquetas || [], p.agenteId ?? null, vecFinal, espacio, clase,
     p.importancia ?? null, fechaBogota(p.ocurrioEn), fechaBogota(p.vigenteHasta), p.origenRef ?? null, version, p.privado ?? (espacio === "personal"), ...(conVec ? [lit(vecFinal)] : [])]);
  // Conexiones: las pedidas + "relacionado_con" a lo más parecido (si se parece bastante) para que la red crezca sola.
  for (const c of p.conectarCon || []) {
    const [d] = await query<{ id: string }>(`SELECT id FROM bib_nodos WHERE slug = $1 AND borrado_en IS NULL`, [c.slug]);
    if (d && d.id !== n.id) await query(`INSERT INTO bib_conexiones (origen_id, destino_id, relacion, creado_por) VALUES ($1,$2,$3,$4) ON CONFLICT (origen_id, destino_id, relacion) DO NOTHING`, [n.id, d.id, c.relacion, p.agenteId ?? null]);
  }
  for (const v of await masParecidos(vec, espacio, null, 3, n.id)) if (v.sim >= 0.75) await query(`INSERT INTO bib_conexiones (origen_id, destino_id, relacion, peso) VALUES ($1,$2,'relacionado_con',$3) ON CONFLICT (origen_id, destino_id, relacion) DO NOTHING`, [n.id, v.id, +v.sim.toFixed(2)]);
  return { nodo: n, accion: existia ? "actualizado" : "creado", parecido };
}

// ── Recordar ─────────────────────────────────────────────────────────────────
export interface OpcionesRecordar { espacios?: string[]; clases?: Clase[]; max?: number; agenteId?: string | null; reforzar?: boolean; incluirPrivado?: boolean }

/** Búsqueda por significado, con pgvector (HNSW con búsqueda iterativa para que el filtro por carpeta no deje huecos). */
async function porSignificado(vec: number[], esp: string[] | null, clases: string[] | null, privado: boolean, n: number): Promise<{ id: string; sim: number }[]> {
  if (await hayPgvector()) {
    const cli = await db.connect();
    try {
      await cli.query("BEGIN");
      await cli.query("SET LOCAL hnsw.iterative_scan = relaxed_order").catch(() => {});
      await cli.query("SET LOCAL hnsw.ef_search = 100").catch(() => {});
      const r = await cli.query(`SELECT id, 1 - (vec <=> $1::vector) AS sim FROM bib_nodos WHERE borrado_en IS NULL AND vec IS NOT NULL
        AND ($2::text[] IS NULL OR espacio = ANY($2)) AND ($3::text[] IS NULL OR clase = ANY($3)) AND ($4 OR NOT privado)
        ORDER BY vec <=> $1::vector LIMIT $5`, [lit(vec), esp, clases, privado, n]);
      await cli.query("COMMIT");
      return r.rows.map((x: any) => ({ id: x.id, sim: Number(x.sim) }));
    } catch (e) { await cli.query("ROLLBACK").catch(() => {}); throw e; } finally { cli.release(); }
  }
  const xs = await query<any>(`SELECT id, embedding FROM bib_nodos WHERE borrado_en IS NULL AND embedding IS NOT NULL AND ($1::text[] IS NULL OR espacio = ANY($1)) AND ($2::text[] IS NULL OR clase = ANY($2)) AND ($3 OR NOT privado)`, [esp, clases, privado]);
  return xs.map((x) => ({ id: x.id, sim: coseno(vec, x.embedding) })).sort((a, b) => b.sim - a.sim).slice(0, n);
}
async function porPalabras(q: string, esp: string[] | null, clases: string[] | null, privado: boolean, n: number): Promise<{ id: string; rank: number }[]> {
  const ws = palabras(q); if (!ws.length) return [];
  return query<any>(`SELECT id, ts_rank(busqueda, to_tsquery('simple', $1)) AS rank FROM bib_nodos WHERE borrado_en IS NULL AND busqueda @@ to_tsquery('simple', $1)
    AND ($2::text[] IS NULL OR espacio = ANY($2)) AND ($3::text[] IS NULL OR clase = ANY($3)) AND ($4 OR NOT privado) ORDER BY rank DESC LIMIT $5`,
    [ws.map((w) => `${w.replace(/[^a-z0-9ñ]/g, "")}:*`).join(" | "), esp, clases, privado, n]);
}

export async function recordar(consulta: string, op: OpcionesRecordar = {}): Promise<Recuerdo[]> {
  const max = op.max || 8, esp = op.espacios?.length && !op.espacios.includes("*") ? op.espacios : null, clases = op.clases?.length ? op.clases : null;
  const privado = op.incluirPrivado ?? (esp ? esp.includes("personal") : false);
  const vec = await embed(consulta);
  const [sig, pal] = await Promise.all([porSignificado(vec, esp, clases, privado, 40), porPalabras(consulta, esp, clases, privado, 20)]);
  // Fusión por rangos (RRF): lo que aparece arriba en ambas listas gana.
  const puntos = new Map<string, { s: number; via: string; sim: number }>();
  sig.forEach((x, i) => { if (x.sim < 0.2) return; puntos.set(x.id, { s: 1 / (40 + i) + x.sim * 0.02, via: "significado", sim: x.sim }); });
  pal.forEach((x, i) => { const e = puntos.get(x.id); const s = 1 / (40 + i); if (e) { e.s += s; e.via = "ambos"; } else puntos.set(x.id, { s, via: "palabras", sim: 0 }); });
  if (!puntos.size) return [];
  // Activación de vecinos: las semillas encienden lo conectado (más débil por salto).
  const semillas = [...puntos].sort((a, b) => b[1].s - a[1].s).slice(0, 8);
  const ids = semillas.map(([id]) => id);
  const vecinos = await query<{ desde: string; hacia: string; peso: number; relacion: string }>(`
    SELECT c.origen_id AS desde, c.destino_id AS hacia, c.peso, c.relacion FROM bib_conexiones c JOIN bib_nodos n ON n.id = c.destino_id WHERE c.origen_id = ANY($1) AND n.borrado_en IS NULL AND ($2::text[] IS NULL OR n.espacio = ANY($2)) AND ($3 OR NOT n.privado)
    UNION ALL SELECT c.destino_id, c.origen_id, c.peso, c.relacion FROM bib_conexiones c JOIN bib_nodos n ON n.id = c.origen_id WHERE c.destino_id = ANY($1) AND n.borrado_en IS NULL AND ($2::text[] IS NULL OR n.espacio = ANY($2)) AND ($3 OR NOT n.privado)`, [ids, esp, privado]);
  for (const v of vecinos) {
    const base = puntos.get(v.desde)?.s || 0, act = base * 0.45 * Math.min(1, Number(v.peso) || 1) * (v.relacion === "contradice" ? 0.6 : 1);
    const e = puntos.get(v.hacia);
    if (e) e.s += act * 0.5; else puntos.set(v.hacia, { s: act, via: `conectado (${v.relacion})`, sim: 0 });
  }
  const candidatos = [...puntos.keys()];
  const filas = await query<Recuerdo>(`SELECT id, slug, titulo, resumen, clase, espacio, tipo, estado, confianza, fuerza, importancia, etiquetas, ocurrio_en, actualizado_en, privado, ficha, vigente_hasta FROM bib_nodos WHERE id = ANY($1) AND borrado_en IS NULL`, [candidatos]);
  const ahora = Date.now();
  const res = filas.map((f: any) => {
    const p = puntos.get(f.id)!;
    const caducado = f.vigente_hasta && new Date(f.vigente_hasta).getTime() < ahora;
    const edadDias = (ahora - new Date(f.ocurrio_en || f.actualizado_en).getTime()) / 86400_000;
    const frescura = f.clase === "episodio" ? 0.6 + 0.4 * Math.exp(-edadDias / 120) : 1;
    const score = p.s * (0.55 + 0.45 * Number(f.confianza)) * (0.75 + 0.25 * Math.min(1, Number(f.fuerza))) * (0.7 + 0.6 * Number(f.importancia)) * frescura
      * (f.estado === "contradicho" ? 0.5 : f.estado === "dudoso" ? 0.75 : 1) * (caducado ? 0.4 : 1);
    return { ...f, score: +score.toFixed(5), via: p.via };
  }).sort((a, b) => b.score - a.score).slice(0, max);
  if (op.reforzar !== false && res.length) reforzar(res.slice(0, 5).map((r) => r.id)).catch(() => {});
  return res;
}

/** Lo que se recuerda se fortalece; lo que se recuerda JUNTO se conecta (Hebb: "se activan juntas, se conectan"). */
async function reforzar(ids: string[]) {
  await query(`UPDATE bib_nodos SET usos = usos + 1, ultimo_uso_en = now(), fuerza = LEAST(3, fuerza + 0.05) WHERE id = ANY($1)`, [ids]);
  const top = ids.slice(0, 3);
  for (let i = 0; i < top.length; i++) for (let j = i + 1; j < top.length; j++) {
    const [a, b] = [top[i], top[j]].sort();
    await query(`INSERT INTO bib_conexiones (origen_id, destino_id, relacion, peso) VALUES ($1,$2,'coactiva',0.2)
      ON CONFLICT (origen_id, destino_id, relacion) DO UPDATE SET peso = LEAST(1, bib_conexiones.peso + 0.05)`, [a, b]);
  }
}

// ── Contexto para cada agente ────────────────────────────────────────────────
const ETIQ: Record<string, string> = { hecho: "hecho", episodio: "pasó", procedimiento: "cómo se hace", persona: "persona", perfil: "sobre Sebastián", leccion: "lección", capacidad: "capacidad", conocimiento: "saber", resumen: "resumen" };
const corto = (s: string, n: number) => { const t = String(s || "").replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const fechaCorta = (d: string | null) => (d ? new Date(d).toLocaleDateString("es-CO", { timeZone: "America/Bogota", day: "numeric", month: "short", year: "2-digit" }) : "");

export interface OpcionesContexto { espacios?: string[]; personal?: boolean; presupuesto?: number; agenteId?: string | null }
/**
 * Lo que el agente debe tener presente para este pedido, en un bloque con tope
 * de tamaño: núcleo de quién es el jefe (si lo atiende a él), resúmenes de las
 * carpetas tocadas y los recuerdos más relevantes (con fecha y confianza).
 */
export async function contextoCerebro(pedido: string, op: OpcionesContexto = {}): Promise<string> {
  const presupuesto = (op.presupuesto || Number(process.env.CEREBRO_PRESUPUESTO || 1500)) * 4;   // ~4 caracteres por token
  const esp = op.espacios?.length ? [...op.espacios] : ["*"];
  const conPersonal = !!op.personal;
  const buscarEn = esp.includes("*") ? null : [...esp, ...(conPersonal ? ["personal"] : [])];
  const partes: string[] = []; let usado = 0;
  const enNucleo = new Set<string>();
  const meter = (t: string) => { if (usado + t.length > presupuesto) return false; partes.push(t); usado += t.length; return true; };
  // 1) Núcleo: lo más importante de quién es el jefe (pocas líneas, siempre).
  if (conPersonal) {
    const nucleo = await query<any>(`SELECT titulo, resumen, cifrado FROM bib_nodos WHERE borrado_en IS NULL AND clase = 'perfil' AND importancia >= 0.8 ORDER BY importancia DESC, fuerza DESC LIMIT 8`);
    const { abrirResumen } = await import("./cifrado.js").catch(() => ({ abrirResumen: null as any }));
    const lineas = [];
    for (const n of nucleo) { lineas.push(`- ${corto(abrirResumen ? await abrirResumen(n) : n.resumen, 160)}`); enNucleo.add(n.titulo); }
    if (lineas.length) meter(`Quién es Sebastián (lo esencial):\n${lineas.join("\n")}`);
  }
  if (!pedido.trim()) return partes.length ? `=== CEREBRO COMPARTIDO ===\n${partes.join("\n\n")}\n=== FIN ===` : "";
  // 2) Lo relevante para el pedido.
  const rs = await recordar(pedido.slice(0, 800), { espacios: buscarEn || ["*"], max: 14, agenteId: op.agenteId, incluirPrivado: conPersonal });
  // Solo lo que de verdad aporta: nada por debajo de un tercio del mejor, ni lo que ya está en el núcleo.
  const mejor = rs[0]?.score || 0;
  const rel = rs.filter((r) => (r.score || 0) >= mejor * 0.33 && !enNucleo.has(r.titulo));
  // 3) Resumen de las carpetas que aparecen (de proyectos), una vez cada una.
  const carpetas = [...new Set(rel.map((r) => r.espacio).filter((e) => e.startsWith("proyecto:")))].slice(0, 2);
  if (carpetas.length) {
    const es = await query<any>(`SELECT slug, nombre, resumen FROM bib_espacios WHERE slug = ANY($1) AND resumen IS NOT NULL`, [carpetas]);
    for (const e of es) meter(`Carpeta ${e.nombre}: ${corto(e.resumen, 600)}`);
  }
  const { abrirResumen } = await import("./cifrado.js").catch(() => ({ abrirResumen: null as any }));
  const lineas: string[] = [];
  for (const r of rel) {
    const resumen = r.privado && abrirResumen ? await abrirResumen(r as any) : r.resumen;
    const aviso = r.estado === "contradicho" ? " ⚠ contradicho" : r.estado === "dudoso" ? " ⚠ dudoso" : "";
    const cuando = r.clase === "episodio" ? ` (${fechaCorta(r.ocurrio_en || r.actualizado_en)})` : "";
    const linea = `• [${ETIQ[r.clase] || r.clase}${r.espacio !== "general" ? ` · ${r.espacio.replace(/^proyecto:/, "")}` : ""}${cuando}] ${r.titulo}: ${corto(resumen, r.clase === "procedimiento" || r.clase === "leccion" ? 420 : 260)}${aviso}${r.via?.startsWith("conectado") ? " ↳ relacionado" : ""}`;
    if (usado + linea.length + 1 > presupuesto) break;
    lineas.push(linea); usado += linea.length + 1;
  }
  if (lineas.length) partes.push(`Lo que el equipo sabe y recuerda sobre esto:\n${lineas.join("\n")}`);
  if (!partes.length) return "";
  return `=== CEREBRO COMPARTIDO (memoria y conocimiento del equipo; úsalo con naturalidad, sin recitarlo. Si algo de aquí funciona o falla al aplicarlo, regístralo con biblioteca_usar; si te enteras de algo que vale la pena recordar, memoria_guardar) ===\n${partes.join("\n\n")}\n=== FIN CEREBRO ===`;
}

// ── Mantenimiento ────────────────────────────────────────────────────────────
/** Rehace los vectores que faltan o que se hicieron con otro modelo (de a pocos). */
export async function revectorizar(max = 200): Promise<number> {
  const version = await versionEmbeddings(), conVec = await hayPgvector();
  const xs = await query<any>(`SELECT id, titulo, resumen, ficha FROM bib_nodos WHERE borrado_en IS NULL AND (emb_version IS DISTINCT FROM $1 OR ${conVec ? "vec IS NULL" : "embedding IS NULL"}) LIMIT $2`, [version, max]);
  for (const x of xs) {
    const v = await embedDoc(`${x.titulo}. ${x.resumen}. ${Object.values(x.ficha || {}).filter((s) => typeof s === "string").join(" ").slice(0, 1000)}`);
    await query(`UPDATE bib_nodos SET embedding = $2, emb_version = $3${conVec ? ", vec = $4::vector" : ""} WHERE id = $1`, [x.id, v, version, ...(conVec ? [lit(v)] : [])]);
  }
  return xs.length;
}

/** Rehace el vector de un nodo (después de corregir su contenido). */
export async function revectorizarNodo(id: string) {
  const [x] = await query<any>(`SELECT titulo, resumen FROM bib_nodos WHERE id = $1`, [id]); if (!x) return;
  const v = await embedDoc(`${x.titulo}. ${x.resumen}`), version = await versionEmbeddings(), conVec = await hayPgvector();
  await query(`UPDATE bib_nodos SET embedding = $2, emb_version = $3${conVec ? ", vec = $4::vector" : ""} WHERE id = $1`, [id, v, version, ...(conVec ? [lit(v)] : [])]);
}

/** Pasa la memoria vieja (memoria_largo_plazo) al cerebro, una sola vez. */
export async function migrarMemoriaVieja(): Promise<number> {
  const [hecho] = await query(`SELECT 1 FROM iris_config WHERE clave = 'cerebro_migrado'`).catch(() => [] as any[]);
  if (hecho) return 0;
  const xs = await query<any>(`SELECT * FROM memoria_largo_plazo ORDER BY creado_en`).catch(() => []);
  for (const h of xs) {
    const deJefe = h.sujeto === "jefe";
    const clase: Clase = deJefe ? "perfil" : h.categoria === "persona" ? "persona" : "hecho";
    const espacio = deJefe || h.categoria === "personal" || h.categoria === "persona" ? "personal" : "general";
    await guardarRecuerdo({ slug: `mem-${slugDe(h.sujeto)}-${slugDe(h.clave)}`.slice(0, 90), titulo: deJefe ? h.clave.replace(/_/g, " ") : `${h.sujeto}: ${h.clave.replace(/_/g, " ")}`, contenido: h.contenido, clase, espacio,
      confianza: Number(h.confianza) || 0.8, importancia: h.categoria === "personal" || h.categoria === "preferencia" ? 0.8 : 0.6, origenRef: h.conversacion_id ? `conversacion:${h.conversacion_id}` : "memoria_vieja", etiquetas: [h.categoria] });
  }
  await query(`INSERT INTO iris_config (clave, valor) VALUES ('cerebro_migrado', $1) ON CONFLICT (clave) DO NOTHING`, [JSON.stringify({ hechos: xs.length, en: new Date().toISOString() })]);
  return xs.length;
}

export async function estadoCerebro() {
  const porClase = await query<any>(`SELECT clase, count(*)::int AS n FROM bib_nodos WHERE borrado_en IS NULL GROUP BY 1 ORDER BY 2 DESC`);
  const porEspacio = await query<any>(`SELECT espacio, count(*)::int AS n FROM bib_nodos WHERE borrado_en IS NULL GROUP BY 1 ORDER BY 2 DESC`);
  const [c] = await query<any>(`SELECT count(*)::int AS n FROM bib_conexiones`);
  return { pgvector: await hayPgvector(), embeddings: await versionEmbeddings(), porClase, porEspacio, conexiones: c.n };
}
