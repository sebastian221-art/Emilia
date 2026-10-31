// ARCHIVO: src/tools/biblioteca.ts
// Tools de la biblioteca. Para TODOS: consultar, aportar, registrar uso.
// Para la guardiana (Lara): integrar entradas, conectar, evidenciar, proponer, envejecer.
import type { DefTool } from "../registro/tipos.js";
import * as B from "../motor/biblioteca.js";

const MODULO = "biblioteca";

export const bibliotecaConsultar: DefTool = {
  nombre: "biblioteca_consultar", modulo: MODULO,
  descripcion: "Busca en la biblioteca compartida por SIGNIFICADO (no hace falta la palabra exacta): qué sabemos de un tema, con su ficha, estado de verdad, confianza y conceptos conectados. Consultala ANTES de investigar en internet o de implementar algo.",
  parametros: { type: "object", properties: { pregunta: { type: "string", minLength: 3 }, limite: { type: "integer", default: 5, minimum: 1, maximum: 15 }, con_vecinos: { type: "boolean", default: true } }, required: ["pregunta"] },
  riesgo: "lectura", requiereAprobacion: false,
  async ejecutar(a) {
    const top = await B.buscarSemantico(a.pregunta, a.limite || 5);
    if (!top.length || top[0].score < 0.3) return { ok: true, datos: [], resumen: "La biblioteca no tiene nada relevante sobre eso todavía." };
    const partes: string[] = [];
    for (const n of top.filter((x) => x.score >= 0.3)) {
      const f = n.ficha || {};
      let t = `▸ ${n.titulo} (${n.slug}) [${n.tipo} · ${n.estado} · confianza ${Math.round(n.confianza * 100)}% · usos ${n.usos} · ${new Date(n.actualizado_en).toLocaleDateString("es-CO")}]\n${n.resumen}`;
      for (const k of ["que_es", "como_funciona", "para_que", "cuando_usar", "cuando_no", "trampas", "formula", "ejemplos", "preguntas_abiertas"]) if (f[k]) t += `\n  ${k.replace(/_/g, " ")}: ${String(f[k]).slice(0, 400)}`;
      if (a.con_vecinos !== false) { const v = await B.vecinos(n.id, 8); if (v.length) t += `\n  conexiones: ${v.map((x: any) => `${x.direccion === "sale" ? "→" : "←"} ${x.relacion} ${x.titulo}`).join("; ")}`; }
      partes.push(t);
      await B.registrarUso(n.id, "consultado").catch(() => {});
    }
    return { ok: true, datos: top, resumen: partes.join("\n\n") };
  },
};

export const bibliotecaAportar: DefTool = {
  nombre: "biblioteca_aportar", modulo: MODULO,
  descripcion: "Aporta algo que aprendiste a la biblioteca compartida (va a la bandeja; la guardiana lo verifica e integra). Usalo al terminar una investigación, un experimento, una reparación o cuando descubras algo que otros agentes deberían saber. Incluí fuentes.",
  parametros: { type: "object", properties: { titulo: { type: "string", minLength: 3 }, contenido: { type: "string", description: "Lo aprendido, estructurado: qué es, cómo funciona, para qué sirve, cuándo usar/no usar, trampas, fórmula/receta si la hay.", minLength: 20 }, fuentes: { type: "array", items: { type: "string" }, description: "URLs, rutas, ejecuciones o 'experimento: …'." }, etiquetas: { type: "array", items: { type: "string" } } }, required: ["titulo", "contenido"] },
  riesgo: "escritura", requiereAprobacion: false,
  async ejecutar(a, ctx) {
    const id = await B.aportar({ titulo: a.titulo, contenido: a.contenido, fuentes: a.fuentes || [], etiquetas: a.etiquetas || [], agenteId: ctx.agenteId, origen: "agente" });
    return { ok: true, datos: { entrada_id: id }, resumen: `Aportado a la bandeja de la biblioteca ("${a.titulo}"). La guardiana lo integrará.` };
  },
};

export const bibliotecaUsar: DefTool = {
  nombre: "biblioteca_usar", modulo: MODULO,
  descripcion: "Registra que aplicaste un conocimiento de la biblioteca y si funcionó o falló. Eso refuerza o debilita ese conocimiento para todos. Usalo cuando apliques algo que leíste en la biblioteca.",
  parametros: { type: "object", properties: { slug: { type: "string", minLength: 2 }, resultado: { type: "string", enum: ["funciono", "fallo"] }, nota: { type: "string" } }, required: ["slug", "resultado"] },
  riesgo: "escritura", requiereAprobacion: false,
  async ejecutar(a, ctx) { await B.registrarUso(a.slug, a.resultado, { agenteId: ctx.agenteId, ejecucionId: ctx.ejecucionId, nota: a.nota }); return { ok: true, resumen: `Registrado: ${a.slug} → ${a.resultado}.` }; },
};

// ── Guardiana ──
export const bibliotecaBandeja: DefTool = {
  nombre: "biblioteca_bandeja", modulo: MODULO,
  descripcion: "Entradas pendientes de integrar (lo que aportaron los agentes y la migración). Para la guardiana.",
  parametros: { type: "object", properties: { limite: { type: "integer", default: 10, minimum: 1, maximum: 50 } }, required: [] },
  riesgo: "lectura", requiereAprobacion: false,
  async ejecutar(a) { const e = await B.entradasPendientes(a.limite || 10); return { ok: true, datos: e, resumen: e.length ? e.map((x: any) => `#${x.id.slice(0, 8)} "${x.titulo}" (${x.origen}${x.agente ? ", " + x.agente : ""}, ${new Date(x.creado_en).toLocaleDateString("es-CO")})\n${String(x.contenido).slice(0, 500)}${String(x.contenido).length > 500 ? "…" : ""}\nfuentes: ${JSON.stringify(x.fuentes).slice(0, 300)}`).join("\n\n") : "Bandeja vacía." }; },
};

export const bibliotecaIntegrar: DefTool = {
  nombre: "biblioteca_integrar", modulo: MODULO,
  descripcion: "La guardiana convierte una entrada de la bandeja en un nodo de la red (o lo actualiza): ficha estructurada, estado, etiquetas, conexiones y evidencias. Si ya existe un nodo equivalente, pasá su slug para actualizarlo en vez de duplicar.",
  parametros: { type: "object", properties: {
    entrada_id: { type: "string", description: "Id (o sus primeros 8 caracteres) de la entrada." },
    slug: { type: "string", description: "Slug del nodo (nuevo o existente)." },
    titulo: { type: "string" }, tipo: { type: "string", enum: ["concepto", "herramienta", "tecnica", "proyecto", "leccion", "formula", "persona", "fuente"] },
    resumen: { type: "string", minLength: 10 },
    ficha: { type: "object", description: "{que_es, como_funciona, para_que, cuando_usar, cuando_no, trampas, formula, ejemplos, preguntas_abiertas}. Cada campo: 1-3 líneas, texto plano, sin comillas dobles adentro. Omití los que no sepas (no mandes null)." },
    estado: { type: "string", enum: ["verificado", "probable", "dudoso"] },
    etiquetas: { type: "array", items: { type: "string" } },
    conexiones: { type: "array", items: { type: "object", properties: { destino: { type: "string" }, relacion: { type: "string" }, nota: { type: "string" } } }, description: "Conexiones a otros nodos existentes (por slug)." },
    evidencias: { type: "array", items: { type: "object", properties: { afirmacion: { type: "string" }, origen: { type: "string" }, fuente: { type: "string" }, fecha_fuente: { type: "string" } } } },
    descartar: { type: "boolean", description: "true para descartar la entrada sin integrarla (duplicada, sin valor).", default: false },
    nota: { type: "string", description: "Nota de la guardiana sobre qué decidió y por qué." },
  }, required: ["entrada_id"] },
  riesgo: "escritura", requiereAprobacion: false,
  async ejecutar(a, ctx) {
    const { query } = await import("../db/cliente.js");
    const [e] = await query<any>(`SELECT * FROM bib_entradas WHERE id::text LIKE $1 AND estado='pendiente'`, [`${a.entrada_id}%`]);
    if (!e) return { ok: false, error: "No encontré esa entrada pendiente." };
    if (a.descartar) { await query(`UPDATE bib_entradas SET estado='descartada', nota_guardiana=$1, procesado_en=now() WHERE id=$2`, [a.nota ?? null, e.id]); return { ok: true, resumen: `Entrada "${e.titulo}" descartada.` }; }
    if (!a.titulo || !a.resumen) return { ok: false, error: "Para integrar hacen falta titulo y resumen (y ficha si podés)." };
    const nodo = await B.crearOActualizarNodo({ slug: a.slug, titulo: a.titulo, tipo: a.tipo, resumen: a.resumen, ficha: a.ficha || {}, estado: a.estado, etiquetas: [...(a.etiquetas || []), ...(e.etiquetas || [])], aprendidoPor: e.agente_id, verificadoPor: ctx.agenteId });
    const fuentes: string[] = Array.isArray(e.fuentes) ? e.fuentes.map((f: any) => typeof f === "string" ? f : f?.url || JSON.stringify(f)) : [];
    for (const f of fuentes.slice(0, 10)) await B.evidenciar(nodo.id, { afirmacion: a.resumen.slice(0, 200), origen: e.origen === "migracion" ? "documento" : "investigacion", fuente: f, agenteId: e.agente_id }).catch(() => {});
    for (const ev of a.evidencias || []) await B.evidenciar(nodo.id, { afirmacion: ev.afirmacion, origen: ev.origen || "investigacion", fuente: ev.fuente, fechaFuente: ev.fecha_fuente || null, agenteId: ctx.agenteId }).catch(() => {});
    const hechas: string[] = [], fallidas: string[] = [];
    for (const c of a.conexiones || []) { try { await B.conectar(nodo.slug, c.destino, c.relacion || "relacionado_con", { nota: c.nota, creadoPor: ctx.agenteId }); hechas.push(`${c.relacion} ${c.destino}`); } catch { fallidas.push(c.destino); } }
    await query(`UPDATE bib_entradas SET estado='integrada', nodo_id=$1, nota_guardiana=$2, procesado_en=now() WHERE id=$3`, [nodo.id, a.nota ?? null, e.id]);
    const final = await B.nodoPorId(nodo.id);
    const aviso = a.estado === "verificado" && final?.estado !== "verificado" ? " (pediste 'verificado' pero con evidencia de un solo origen queda 'probable': para verificar hacen falta 2 orígenes distintos que apoyen)" : "";
    return { ok: true, datos: { nodo_id: nodo.id, slug: nodo.slug, estado: final?.estado, confianza: final?.confianza }, resumen: `Nodo "${nodo.titulo}" (${nodo.slug}) integrado en estado ${final?.estado} (confianza ${Math.round((final?.confianza || 0) * 100)}%)${aviso}. Conexiones: ${hechas.join(", ") || "ninguna"}${fallidas.length ? ` · no existen: ${fallidas.join(", ")}` : ""}.` };
  },
};

export const bibliotecaConectar: DefTool = {
  nombre: "biblioteca_conectar", modulo: MODULO,
  descripcion: "Crea una conexión con nombre entre dos nodos existentes (usa, es_parte_de, reemplaza_a, compite_con, se_contradice_con, se_aplico_en, depende_de, relacionado_con).",
  parametros: { type: "object", properties: { origen: { type: "string" }, destino: { type: "string" }, relacion: { type: "string" }, nota: { type: "string" } }, required: ["origen", "destino", "relacion"] },
  riesgo: "escritura", requiereAprobacion: false,
  async ejecutar(a, ctx) { await B.conectar(a.origen, a.destino, a.relacion, { nota: a.nota, creadoPor: ctx.agenteId }); return { ok: true, resumen: `${a.origen} —${a.relacion}→ ${a.destino}` }; },
};

export const bibliotecaEvidenciar: DefTool = {
  nombre: "biblioteca_evidenciar", modulo: MODULO,
  descripcion: "Agrega una evidencia a un nodo (apoya o contradice) con su origen y fuente. Recalcula confianza y estado.",
  parametros: { type: "object", properties: { slug: { type: "string" }, afirmacion: { type: "string", minLength: 5 }, origen: { type: "string", enum: ["investigacion", "codigo", "experimento", "operacion", "jefe", "documento"] }, fuente: { type: "string" }, resultado: { type: "string", enum: ["apoya", "contradice", "neutral"], default: "apoya" }, detalle: { type: "string" }, fecha_fuente: { type: "string" } }, required: ["slug", "afirmacion", "origen"] },
  riesgo: "escritura", requiereAprobacion: false,
  async ejecutar(a, ctx) { await B.evidenciar(a.slug, { afirmacion: a.afirmacion, origen: a.origen, fuente: a.fuente, resultado: a.resultado, detalle: a.detalle, fechaFuente: a.fecha_fuente || null, agenteId: ctx.agenteId }); const n = await B.nodoPorSlug(a.slug); return { ok: true, resumen: `Evidencia agregada a ${a.slug}. Ahora: ${n?.estado}, confianza ${Math.round((n?.confianza || 0) * 100)}%.` }; },
};

export const bibliotecaProponer: DefTool = {
  nombre: "biblioteca_proponer", modulo: MODULO,
  descripcion: "La guardiana propone al jefe borrar, fusionar, marcar (dudoso/obsoleto) o refrescar un nodo. No ejecuta: el jefe aprueba en la página Biblioteca o por chat.",
  parametros: { type: "object", properties: { tipo: { type: "string", enum: ["borrar", "fusionar", "marcar", "refrescar", "conectar"] }, slug: { type: "string" }, slug2: { type: "string", description: "Para fusionar/conectar: el otro nodo." }, motivo: { type: "string", minLength: 10 }, datos: { type: "object" } }, required: ["tipo", "slug", "motivo"] },
  riesgo: "escritura", requiereAprobacion: false,
  async ejecutar(a, ctx) {
    const n = await B.nodoPorSlug(a.slug); if (!n) return { ok: false, error: `No existe ${a.slug}.` };
    const n2 = a.slug2 ? await B.nodoPorSlug(a.slug2) : null; if (a.slug2 && !n2) return { ok: false, error: `No existe ${a.slug2}.` };
    const id = await B.proponer({ tipo: a.tipo, nodoId: n.id, nodo2Id: n2?.id ?? null, motivo: a.motivo, datos: a.datos || {}, propuestoPor: ctx.agenteId });
    return { ok: true, datos: { propuesta_id: id }, resumen: `Propuesta "${a.tipo}" sobre "${n.titulo}" registrada para el jefe.` };
  },
};

export const bibliotecaEstado: DefTool = {
  nombre: "biblioteca_estado", modulo: MODULO,
  descripcion: "Estadísticas de la biblioteca: nodos, verificados, dudosos, conexiones, bandeja y propuestas pendientes. Opcionalmente ejecuta el envejecimiento (debilita lo que nadie usa y propone refrescar lo muy viejo).",
  parametros: { type: "object", properties: { envejecer: { type: "boolean", default: false } }, required: [] },
  riesgo: "lectura", requiereAprobacion: false,
  async ejecutar(a, ctx) { let prop = 0; if (a.envejecer) prop = await B.envejecer(ctx.agenteId); const s = await B.estadisticas(); return { ok: true, datos: { ...s, propuestas_nuevas: prop }, resumen: `Biblioteca: ${s.nodos} nodos (${s.verificados} verificados, ${s.dudosos} dudosos/contradichos, ${s.papelera} en papelera), ${s.conexiones} conexiones, ${s.entradas_pendientes} entradas por integrar, ${s.propuestas_pendientes} propuestas para el jefe${a.envejecer ? ` · envejecimiento: ${prop} propuestas nuevas` : ""}.` }; },
};

export const bibliotecaMigrar: DefTool = {
  nombre: "biblioteca_migrar", modulo: MODULO,
  descripcion: "Lleva a la bandeja todo el conocimiento antiguo que los agentes guardaron en sus documentos (biblioteca/, hallazgos/, adr/, postmortem/, recetas/). Idempotente.",
  parametros: { type: "object", properties: {}, required: [] }, riesgo: "escritura", requiereAprobacion: false,
  async ejecutar() { const n = await B.migrarConocimientoAntiguo(); return { ok: true, resumen: `${n} documento(s) llevados a la bandeja.` }; },
};

export const toolsBiblioteca: DefTool[] = [bibliotecaConsultar, bibliotecaAportar, bibliotecaUsar, bibliotecaBandeja, bibliotecaIntegrar, bibliotecaConectar, bibliotecaEvidenciar, bibliotecaProponer, bibliotecaEstado, bibliotecaMigrar];