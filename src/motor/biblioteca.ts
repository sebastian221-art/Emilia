// ARCHIVO: src/motor/biblioteca.ts
// ─────────────────────────────────────────────────────────────────────────────
//  BIBLIOTECA — operaciones sobre la red de conocimiento.
//  Aportar (bandeja) → integrar (Lara crea/actualiza nodo + conexiones +
//  evidencias) → consultar (por significado + vecinos) → usar (refuerzo) →
//  envejecer (debilita lo que nadie usa) → podar (propuestas al jefe).
// ─────────────────────────────────────────────────────────────────────────────
import { query } from "../db/cliente.js";
import { embedDoc, versionEmbeddings } from "./embeddings.js";

export interface Nodo { id: string; slug: string; titulo: string; tipo: string; resumen: string; ficha: any; estado: string; confianza: number; fuerza: number; etiquetas: string[]; aprendido_por: string | null; verificado_por: string | null; usos: number; creado_en: string; actualizado_en: string; ultimo_uso_en: string | null }

export const slugDe = (t: string) => t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);

// ── Bandeja (lo que aportan los agentes) ──
export async function aportar(p: { titulo: string; contenido: string; origen?: string; fuentes?: any[]; etiquetas?: string[]; agenteId?: string | null }) {
  const [e] = await query<{ id: string }>(`INSERT INTO bib_entradas (titulo, contenido, origen, fuentes, etiquetas, agente_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [p.titulo, p.contenido, p.origen || "agente", JSON.stringify(p.fuentes || []), p.etiquetas || [], p.agenteId ?? null]);
  return e.id;
}
export const entradasPendientes = (limite = 20) => query<any>(`SELECT e.*, a.nombre AS agente FROM bib_entradas e LEFT JOIN agentes a ON a.id=e.agente_id WHERE e.estado='pendiente' ORDER BY e.creado_en ASC LIMIT $1`, [limite]);

// ── Nodos ──
export async function crearOActualizarNodo(p: { slug?: string; titulo: string; tipo?: string; resumen: string; ficha?: any; estado?: string; confianza?: number; etiquetas?: string[]; aprendidoPor?: string | null; verificadoPor?: string | null }): Promise<Nodo> {
  const slug = p.slug || slugDe(p.titulo);
  const texto = `${p.titulo}. ${p.resumen}. ${Object.values(p.ficha || {}).filter((v) => typeof v === "string").join(" ").slice(0, 1200)}`;
  const vec = await embedDoc(texto), version = await versionEmbeddings();
  const { hayPgvector } = await import("./cerebro.js"); const conVec = await hayPgvector();
  const [n] = await query<Nodo>(`INSERT INTO bib_nodos (slug, titulo, tipo, resumen, ficha, estado, confianza, etiquetas, aprendido_por, verificado_por, embedding, emb_version${conVec ? ", vec" : ""})
    VALUES ($1,$2,COALESCE($3,'concepto'),$4,$5,COALESCE($6,'probable'),COALESCE($7,0.6),$8,$9,$10,$11,$12${conVec ? ",$13::vector" : ""})
    ON CONFLICT (slug) DO UPDATE SET titulo=EXCLUDED.titulo, tipo=COALESCE($3, bib_nodos.tipo), resumen=EXCLUDED.resumen,
      ficha = bib_nodos.ficha || EXCLUDED.ficha, estado=COALESCE($6, bib_nodos.estado), confianza=COALESCE($7, bib_nodos.confianza),
      etiquetas = (SELECT ARRAY(SELECT DISTINCT unnest(bib_nodos.etiquetas || EXCLUDED.etiquetas))), verificado_por=COALESCE(EXCLUDED.verificado_por, bib_nodos.verificado_por),
      embedding=EXCLUDED.embedding, emb_version=EXCLUDED.emb_version, actualizado_en=now(), borrado_en=NULL${conVec ? ", vec=EXCLUDED.vec" : ""}
    RETURNING *`,
    [slug, p.titulo, p.tipo || null, p.resumen, JSON.stringify(p.ficha || {}), p.estado ?? null, p.confianza == null ? null : Number(p.confianza), p.etiquetas || [], p.aprendidoPor ?? null, p.verificadoPor ?? null, vec, version, ...(conVec ? [`[${vec.join(",")}]`] : [])]);
  return n;
}
export const nodoPorSlug = async (slug: string) => (await query<Nodo>(`SELECT * FROM bib_nodos WHERE slug=$1 AND borrado_en IS NULL`, [slug]))[0];
export const nodoPorId = async (id: string) => (await query<Nodo>(`SELECT * FROM bib_nodos WHERE id=$1`, [id]))[0];

export async function conectar(origen: string, destino: string, relacion: string, p: { peso?: number; nota?: string; creadoPor?: string | null } = {}) {
  const a = await nodoPorSlug(origen) || await nodoPorId(origen); const b = await nodoPorSlug(destino) || await nodoPorId(destino);
  if (!a || !b) throw new Error(`No existe ${!a ? origen : destino} en la biblioteca.`);
  await query(`INSERT INTO bib_conexiones (origen_id, destino_id, relacion, peso, nota, creado_por) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (origen_id, destino_id, relacion) DO UPDATE SET peso=EXCLUDED.peso, nota=COALESCE(EXCLUDED.nota, bib_conexiones.nota)`, [a.id, b.id, relacion, p.peso ?? 1, p.nota ?? null, p.creadoPor ?? null]);
}
export async function evidenciar(nodo: string, p: { afirmacion: string; origen: string; fuente?: string; resultado?: string; detalle?: string; agenteId?: string | null; fechaFuente?: string | null }) {
  const n = await nodoPorSlug(nodo) || await nodoPorId(nodo); if (!n) throw new Error(`No existe ${nodo}.`);
  await query(`INSERT INTO bib_evidencias (nodo_id, afirmacion, origen, fuente, resultado, detalle, agente_id, fecha_fuente) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [n.id, p.afirmacion, p.origen, p.fuente ?? null, p.resultado || "apoya", p.detalle ?? null, p.agenteId ?? null, p.fechaFuente ?? null]);
  await recalcularConfianza(n.id);
}

/** Confianza = f(evidencias que apoyan vs contradicen, orígenes distintos, usos que funcionaron vs fallaron, edad). */
export async function recalcularConfianza(nodoId: string) {
  const [e] = await query<any>(`SELECT COUNT(*) FILTER (WHERE resultado='apoya')::int AS apoya, COUNT(*) FILTER (WHERE resultado='contradice')::int AS contra, COUNT(DISTINCT origen) FILTER (WHERE resultado='apoya')::int AS origenes FROM bib_evidencias WHERE nodo_id=$1`, [nodoId]);
  const [u] = await query<any>(`SELECT COUNT(*) FILTER (WHERE resultado='funciono')::int AS ok, COUNT(*) FILTER (WHERE resultado='fallo')::int AS mal FROM bib_usos WHERE nodo_id=$1`, [nodoId]);
  const [actual] = await query<any>(`SELECT estado, confianza FROM bib_nodos WHERE id=$1`, [nodoId]);
  if (!actual) return;
  const senales = e.apoya + e.contra + u.ok + u.mal;
  if (!senales) return;   // sin evidencia ni uso no hay nada que recalcular: se respeta lo que puso quien lo creó/editó
  let c = 0.4 + Math.min(0.3, e.apoya * 0.08) + Math.min(0.15, Math.max(0, e.origenes - 1) * 0.075) + Math.min(0.15, u.ok * 0.05) - e.contra * 0.15 - u.mal * 0.1;
  c = Math.max(0.05, Math.min(0.99, c));
  // Un 'verificado' puesto a mano (jefe o Lara) se respeta mientras nada lo contradiga; 'obsoleto' solo lo cambia una persona.
  const estado = actual.estado === "obsoleto" ? "obsoleto"
    : e.contra > e.apoya ? "contradicho"
    : actual.estado === "verificado" && e.contra === 0 && u.mal <= u.ok ? "verificado"
    : c >= 0.8 && e.origenes >= 2 ? "verificado" : c < 0.4 ? "dudoso" : "probable";
  if (estado === "verificado" && actual.estado === "verificado") c = Math.max(c, Number(actual.confianza) || 0);
  await query(`UPDATE bib_nodos SET confianza=$1, estado=$2, actualizado_en=now() WHERE id=$3`, [c, estado, nodoId]);
}

// ── Consulta: por significado + vecinos ──
export async function buscarSemantico(texto: string, limite = 5, filtro: { tipo?: string; etiqueta?: string } = {}): Promise<(Nodo & { score: number })[]> {
  // Usa el cerebro (significado + palabras + vecinos); nunca devuelve lo privado ni las capacidades.
  const { recordar } = await import("./cerebro.js");
  let xs = (await recordar(texto, { max: limite * 3, incluirPrivado: false, reforzar: false })).filter((x) => x.clase !== "capacidad");
  if (filtro.tipo) xs = xs.filter((x) => x.tipo === filtro.tipo);
  if (filtro.etiqueta) xs = xs.filter((x) => x.etiquetas?.includes(filtro.etiqueta!));
  // Relevancia real: parecido en significado, o que de verdad comparta las palabras (no un puntaje relativo que siempre "pasa").
  return xs.map((x) => ({ ...(x as any), score: +Math.max(x.sim || 0, x.via === "ambos" ? 0.6 : x.via === "palabras" ? 0.45 : 0, x.via?.startsWith("conectado") ? 0.36 : 0).toFixed(3) }))
    .filter((x) => x.score > 0.2).sort((a, b) => b.score - a.score).slice(0, limite);
}
export async function vecinos(nodoId: string, limite = 12) {
  return query<any>(`SELECT c.relacion, c.peso, c.nota, n.id, n.slug, n.titulo, n.tipo, n.estado, n.confianza, 'sale' AS direccion FROM bib_conexiones c JOIN bib_nodos n ON n.id=c.destino_id WHERE c.origen_id=$1 AND n.borrado_en IS NULL
    UNION ALL SELECT c.relacion, c.peso, c.nota, n.id, n.slug, n.titulo, n.tipo, n.estado, n.confianza, 'entra' FROM bib_conexiones c JOIN bib_nodos n ON n.id=c.origen_id WHERE c.destino_id=$1 AND n.borrado_en IS NULL LIMIT $2`, [nodoId, limite]);
}
export const evidencias = (nodoId: string) => query<any>(`SELECT e.*, a.nombre AS agente FROM bib_evidencias e LEFT JOIN agentes a ON a.id=e.agente_id WHERE e.nodo_id=$1 ORDER BY e.creado_en DESC`, [nodoId]);

/** Lo que un agente debe saber para una tarea: nodos relevantes con ficha corta, vecinos y avisos de edad. */
export async function contextoPara(texto: string, limite = 4): Promise<string> {
  const top = (await buscarSemantico(texto, limite)).filter((n) => n.score > 0.35);
  if (!top.length) return "";
  const partes: string[] = [];
  for (const n of top) {
    const edadDias = Math.floor((Date.now() - new Date(n.actualizado_en).getTime()) / 86400000);
    const aviso = n.estado === "contradicho" ? " ⚠ CONTRADICHO" : n.estado === "dudoso" ? " ⚠ dudoso" : edadDias > 90 && /precio|versi[oó]n|costo|plan|api/i.test(n.resumen + JSON.stringify(n.ficha)) ? ` ⚠ tiene ${edadDias} días (precios/versiones pueden haber cambiado)` : "";
    const f = n.ficha || {};
    partes.push(`▸ ${n.titulo} [${n.tipo}, ${n.estado}, confianza ${Math.round(n.confianza * 100)}%${aviso}]\n  ${n.resumen}${f.formula ? `\n  Fórmula: ${String(f.formula).slice(0, 300)}` : ""}${f.trampas ? `\n  Trampas: ${String(f.trampas).slice(0, 200)}` : ""}`);
    await query(`UPDATE bib_nodos SET usos=usos+1, ultimo_uso_en=now(), fuerza=LEAST(3, fuerza+0.1) WHERE id=$1`, [n.id]);
  }
  return `=== LO QUE SABE LA BIBLIOTECA (usalo; si lo aplicás y funciona o falla, registralo con biblioteca_usar) ===\n${partes.join("\n")}\n=== FIN BIBLIOTECA ===`;
}

export async function registrarUso(nodo: string, resultado: "consultado" | "funciono" | "fallo", p: { agenteId?: string | null; ejecucionId?: string | null; nota?: string } = {}) {
  const n = await nodoPorSlug(nodo) || await nodoPorId(nodo); if (!n) throw new Error(`No existe ${nodo}.`);
  await query(`INSERT INTO bib_usos (nodo_id, agente_id, ejecucion_id, resultado, nota) VALUES ($1,$2,$3,$4,$5)`, [n.id, p.agenteId ?? null, p.ejecucionId ?? null, resultado, p.nota ?? null]);
  await query(`UPDATE bib_nodos SET usos=usos+1, ultimo_uso_en=now(), fuerza=GREATEST(0.1, LEAST(3, fuerza + $2)) WHERE id=$1`, [n.id, resultado === "funciono" ? 0.3 : resultado === "fallo" ? -0.3 : 0.05]);
  await recalcularConfianza(n.id);
}

/** Envejecimiento: lo que nadie usa pierde fuerza; lo muy viejo y débil pasa a propuesta de revisión. */
export async function envejecer(guardianaId?: string | null) {
  await query(`UPDATE bib_nodos SET fuerza = GREATEST(0.1, fuerza - 0.02) WHERE borrado_en IS NULL AND (ultimo_uso_en IS NULL OR ultimo_uso_en < now() - interval '14 days')`);
  const debiles = await query<Nodo>(`SELECT * FROM bib_nodos WHERE borrado_en IS NULL AND fuerza <= 0.3 AND actualizado_en < now() - interval '60 days' AND id NOT IN (SELECT nodo_id FROM bib_propuestas WHERE estado='pendiente' AND nodo_id IS NOT NULL)`);
  for (const n of debiles) await proponer({ tipo: "refrescar", nodoId: n.id, motivo: `"${n.titulo}" lleva ${Math.floor((Date.now() - new Date(n.actualizado_en).getTime()) / 86400000)} días sin actualizarse y casi no se usa. ¿Lo refresco con Soga, lo archivo o lo borro?`, propuestoPor: guardianaId });
  return debiles.length;
}

// ── Propuestas y papelera ──
export async function proponer(p: { tipo: string; nodoId?: string | null; nodo2Id?: string | null; motivo: string; datos?: any; propuestoPor?: string | null }) {
  const [r] = await query<{ id: string }>(`INSERT INTO bib_propuestas (tipo, nodo_id, nodo2_id, motivo, datos, propuesto_por) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`, [p.tipo, p.nodoId ?? null, p.nodo2Id ?? null, p.motivo, JSON.stringify(p.datos || {}), p.propuestoPor ?? null]);
  return r.id;
}
export async function resolverPropuesta(id: string, aprobar: boolean) {
  const [p] = await query<any>(`UPDATE bib_propuestas SET estado=$1, resuelto_en=now() WHERE id=$2 AND estado='pendiente' RETURNING *`, [aprobar ? "aprobada" : "rechazada", id]);
  if (!p || !aprobar) return p;
  if (p.tipo === "borrar" && p.nodo_id) await query(`UPDATE bib_nodos SET borrado_en=now() WHERE id=$1`, [p.nodo_id]);
  if (p.tipo === "marcar" && p.nodo_id) await query(`UPDATE bib_nodos SET estado=$1, actualizado_en=now() WHERE id=$2`, [p.datos?.estado || "dudoso", p.nodo_id]);
  if (p.tipo === "fusionar" && p.nodo_id && p.nodo2_id) {
    // El nodo2 se absorbe en el nodo: conexiones y evidencias pasan, el nodo2 va a la papelera.
    await query(`UPDATE bib_evidencias SET nodo_id=$1 WHERE nodo_id=$2`, [p.nodo_id, p.nodo2_id]);
    await query(`UPDATE bib_usos SET nodo_id=$1 WHERE nodo_id=$2`, [p.nodo_id, p.nodo2_id]);
    await query(`INSERT INTO bib_conexiones (origen_id, destino_id, relacion, peso, nota, creado_por) SELECT $1, destino_id, relacion, peso, nota, creado_por FROM bib_conexiones WHERE origen_id=$2 AND destino_id<>$1 ON CONFLICT DO NOTHING`, [p.nodo_id, p.nodo2_id]);
    await query(`INSERT INTO bib_conexiones (origen_id, destino_id, relacion, peso, nota, creado_por) SELECT origen_id, $1, relacion, peso, nota, creado_por FROM bib_conexiones WHERE destino_id=$2 AND origen_id<>$1 ON CONFLICT DO NOTHING`, [p.nodo_id, p.nodo2_id]);
    await query(`UPDATE bib_nodos SET borrado_en=now() WHERE id=$1`, [p.nodo2_id]);
    await recalcularConfianza(p.nodo_id);
  }
  if (p.tipo === "conectar" && p.nodo_id && p.nodo2_id) await query(`INSERT INTO bib_conexiones (origen_id, destino_id, relacion, nota) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`, [p.nodo_id, p.nodo2_id, p.datos?.relacion || "relacionado_con", p.datos?.nota ?? null]);
  return p;
}
export const propuestasPendientes = () => query<any>(`SELECT p.*, n.titulo AS nodo_titulo, n2.titulo AS nodo2_titulo, a.nombre AS propuesto_por_nombre FROM bib_propuestas p LEFT JOIN bib_nodos n ON n.id=p.nodo_id LEFT JOIN bib_nodos n2 ON n2.id=p.nodo2_id LEFT JOIN agentes a ON a.id=p.propuesto_por WHERE p.estado='pendiente' ORDER BY p.creado_en`);
export const papelera = () => query<Nodo>(`SELECT * FROM bib_nodos WHERE borrado_en IS NOT NULL ORDER BY borrado_en DESC`);
export const restaurar = (id: string) => query(`UPDATE bib_nodos SET borrado_en=NULL WHERE id=$1`, [id]);
export const borrarDefinitivo = (id: string) => query(`DELETE FROM bib_nodos WHERE id=$1 AND borrado_en IS NOT NULL`, [id]);

/** Resumen para el panel y para Lara. */
export async function estadisticas() {
  const [n] = await query<any>(`SELECT COUNT(*) FILTER (WHERE borrado_en IS NULL)::int AS nodos, COUNT(*) FILTER (WHERE estado='verificado' AND borrado_en IS NULL)::int AS verificados, COUNT(*) FILTER (WHERE estado IN ('dudoso','contradicho') AND borrado_en IS NULL)::int AS dudosos, COUNT(*) FILTER (WHERE borrado_en IS NOT NULL)::int AS papelera FROM bib_nodos`);
  const [c] = await query<any>(`SELECT COUNT(*)::int AS conexiones FROM bib_conexiones c JOIN bib_nodos a ON a.id=c.origen_id JOIN bib_nodos b ON b.id=c.destino_id WHERE a.borrado_en IS NULL AND b.borrado_en IS NULL`);
  const [e] = await query<any>(`SELECT COUNT(*)::int AS pendientes FROM bib_entradas WHERE estado='pendiente'`);
  const [p] = await query<any>(`SELECT COUNT(*)::int AS propuestas FROM bib_propuestas WHERE estado='pendiente'`);
  return { ...n, ...c, entradas_pendientes: e.pendientes, propuestas_pendientes: p.propuestas };
}

/** Migración: lo que cada agente tenía en documentos (biblioteca/, hallazgos/, adr/, postmortem/) entra a la bandeja. */
export async function migrarConocimientoAntiguo(): Promise<number> {
  const docs = await query<any>(`SELECT d.id, d.nombre, d.contenido, d.agente_id FROM documentos d WHERE d.tipo='nota' AND (d.nombre LIKE 'biblioteca/%' OR d.nombre LIKE 'hallazgos/%' OR d.nombre LIKE 'adr/%' OR d.nombre LIKE 'postmortem/%' OR d.nombre LIKE 'recetas/%') AND NOT EXISTS (SELECT 1 FROM bib_entradas e WHERE e.origen='migracion' AND e.titulo=d.nombre)`);
  for (const d of docs) await query(`INSERT INTO bib_entradas (titulo, contenido, origen, etiquetas, agente_id) VALUES ($1,$2,'migracion',$3,$4)`, [d.nombre, d.contenido, [d.nombre.split("/")[0]], d.agente_id]);
  return docs.length;
}