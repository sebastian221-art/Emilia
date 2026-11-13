// ARCHIVO: src/tools/cerebro.ts
// ─────────────────────────────────────────────────────────────────────────────
//  TOOLS DEL CEREBRO (Lara): cómo está la memoria, dormir ya, preguntas
//  pendientes para el jefe y su respuesta, informe y exportar a PDF.
// ─────────────────────────────────────────────────────────────────────────────
import type { DefTool } from "../registro/tipos.js";
import { query } from "../db/cliente.js";
import { estadoCerebro, espacioProyecto } from "../motor/cerebro.js";
import { conversacionDelJefe } from "./memoria.js";

const MODULO = "cerebro";

export const cerebroEstado: DefTool = {
  nombre: "cerebro_estado", modulo: MODULO,
  descripcion: "Cómo está el cerebro compartido: cuántos recuerdos por tipo y carpeta, conexiones, si usa pgvector, la llave de cifrado, qué hizo anoche el sueño y qué preguntas hay pendientes.",
  parametros: { type: "object", properties: {} },
  riesgo: "lectura", requiereAprobacion: false, timeoutSeg: 30,
  async ejecutar() {
    const e = await estadoCerebro();
    const { obtenerLlave } = await import("../motor/cifrado.js");
    const [s] = await query<{ valor: any }>(`SELECT valor FROM iris_config WHERE clave = 'sueno_ultimo'`);
    const [p] = await query<{ n: number }>(`SELECT count(*)::int AS n FROM bib_propuestas WHERE estado = 'pendiente'`);
    const [b] = await query<{ n: number }>(`SELECT count(*)::int AS n FROM bib_entradas WHERE estado = 'pendiente'`);
    const u = s?.valor;
    return { ok: true, datos: { ...e, sueno: u }, resumen: [
      `🧠 ${e.porClase.reduce((a: number, x: any) => a + x.n, 0)} recuerdos · ${e.conexiones} conexiones · ${e.pgvector ? "pgvector ✔" : "sin pgvector (búsqueda de respaldo)"} · embeddings ${String(e.embeddings).split(":")[0]} · lo personal ${await obtenerLlave() ? "cifrado 🔒" : "SIN cifrar ⚠"}`,
      `Por tipo: ${e.porClase.map((x: any) => `${x.clase} ${x.n}`).join(", ")}`,
      `Por carpeta: ${e.porEspacio.map((x: any) => `${x.espacio} ${x.n}`).join(", ")}`,
      u ? `Anoche (${u.fecha}): ${u.bandeja} de la bandeja, ${u.unidos} unidos, ${u.conectados} conectados, ${u.lecciones} lecciones, ${u.contradicciones} contradicciones, ${u.vencidos} vencidos${u.cosecha ? `, cosecha ${u.cosecha}` : ""}${u.errores?.length ? ` · ⚠ ${u.errores.join("; ")}` : ""}` : "El sueño aún no ha corrido.",
      `Pendiente: ${b.n} en la bandeja · ${p.n} pregunta(s)/propuesta(s) para el jefe`,
    ].join("\n") };
  },
};

export const cerebroDormir: DefTool = {
  nombre: "cerebro_dormir", modulo: MODULO,
  descripcion: "Ordena la memoria YA (lo que normalmente hace de noche): integra la bandeja, une duplicados, detecta contradicciones, saca lecciones, resume carpetas, retira lo vencido. Con cosechar=true también recoge lo que vivió el equipo esta semana (caídas, arreglos, errores de Any).",
  parametros: { type: "object", properties: { cosechar: { type: "boolean" } } },
  riesgo: "escritura", requiereAprobacion: false, timeoutSeg: 1800,
  async ejecutar(a) {
    const { dormir } = await import("../motor/sueno.js");
    const i = await dormir({ cosechar: !!a.cosechar });
    return { ok: true, datos: i, resumen: `🧠 Listo (${Math.round(i.duracion_ms / 1000)} s): ${i.bandeja} de la bandeja, ${i.unidos} unidos, ${i.conectados} conectados, ${i.lecciones} lecciones, ${i.resumenes} carpetas resumidas, ${i.vencidos} vencidos${a.cosechar ? `, ${i.cosecha} cosechados` : ""}.${i.preguntas.length ? `\nPreguntas para el jefe:\n${i.preguntas.map((p, k) => `${k + 1}) ${p}`).join("\n")}` : ""}${i.errores.length ? `\n⚠ ${i.errores.join("; ")}` : ""}` };
  },
};

export const cerebroPreguntas: DefTool = {
  nombre: "cerebro_preguntas", modulo: MODULO,
  descripcion: "Lo que la memoria necesita que el jefe decida: contradicciones (¿qué es cierto?) y propuestas (borrar, fusionar, marcar dudoso, refrescar), numeradas para que responda corto.",
  parametros: { type: "object", properties: {} },
  riesgo: "lectura", requiereAprobacion: false, timeoutSeg: 20,
  async ejecutar() {
    const xs = await query<any>(`SELECT p.id, p.tipo, p.motivo, a.titulo AS t1, b.titulo AS t2 FROM bib_propuestas p LEFT JOIN bib_nodos a ON a.id = p.nodo_id LEFT JOIN bib_nodos b ON b.id = p.nodo2_id WHERE p.estado = 'pendiente' ORDER BY (p.tipo = 'contradiccion') DESC, p.creado_en LIMIT 15`);
    if (!xs.length) return { ok: true, datos: [], resumen: "No hay nada pendiente. 👌" };
    return { ok: true, datos: xs, resumen: xs.map((x, i) => `${i + 1}) ${x.tipo === "contradiccion" ? `❓ ${x.motivo}\n   A: ${x.t1}\n   B: ${x.t2}` : `${x.tipo}: ${x.motivo}`} [${x.id.slice(0, 8)}]`).join("\n") + "\n\nResponde por número: \"1 A\", \"2 B\", \"3 ninguno: <cómo es>\", o \"sí/no\" para las propuestas." };
  },
};

export const cerebroResponder: DefTool = {
  nombre: "cerebro_responder", modulo: MODULO,
  descripcion: "Aplica la respuesta del jefe a una pregunta de la memoria (usa el id de 8 caracteres de cerebro_preguntas). Contradicción: cierto='A' o 'B' (el otro queda como ya no cierto, con historial) o correccion='cómo es en realidad'. Propuesta: aprobar true/false.",
  parametros: { type: "object", properties: {
    id: { type: "string", minLength: 8 }, cierto: { type: "string", enum: ["A", "B", "ninguno"] }, correccion: { type: "string" }, aprobar: { type: "boolean" },
  }, required: ["id"] },
  riesgo: "escritura", requiereAprobacion: false, timeoutSeg: 60,
  async ejecutar(a) {
    const [p] = await query<any>(`SELECT * FROM bib_propuestas WHERE id::text LIKE $1 || '%' AND estado = 'pendiente' LIMIT 1`, [String(a.id).toLowerCase()]);
    if (!p) return { ok: false, error: "No encuentro esa pregunta pendiente (cerebro_preguntas)." };
    if (p.tipo !== "contradiccion") {
      if (a.aprobar === undefined) return { ok: false, error: "Para una propuesta dime aprobar true o false." };
      const { resolverPropuesta } = await import("../motor/biblioteca.js");
      await resolverPropuesta(p.id, !!a.aprobar);
      return { ok: true, resumen: `${a.aprobar ? "✔ Hecho" : "✘ Descartado"}: ${p.tipo} — ${p.motivo}` };
    }
    const { escribirContenido } = await import("../motor/cerebro.js");
    const { abrirResumen } = await import("../motor/cifrado.js");
    const [na] = await query<any>(`SELECT * FROM bib_nodos WHERE id = $1`, [p.nodo_id]); const [nb] = await query<any>(`SELECT * FROM bib_nodos WHERE id = $1`, [p.nodo2_id]);
    const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(new Date());
    const descartar = async (n: any) => { if (!n) return; await query(`UPDATE bib_nodos SET estado = 'obsoleto', importancia = importancia * 0.5, ficha = ficha || $2::jsonb WHERE id = $1`, [n.id, JSON.stringify({ descartado: { fecha: hoy, por: "jefe" } })]); };
    const confirmar = async (n: any) => { if (!n) return; await query(`UPDATE bib_nodos SET estado = 'verificado', confianza = GREATEST(confianza, 0.95), verificado_por = NULL WHERE id = $1`, [n.id]); await query(`INSERT INTO bib_evidencias (nodo_id, afirmacion, origen, resultado, detalle) VALUES ($1, $2, 'jefe', 'apoya', 'el jefe lo confirmó')`, [n.id, n.titulo]); };
    let resumen = "";
    if (a.cierto === "A" || a.cierto === "B") {
      const [bueno, malo] = a.cierto === "A" ? [na, nb] : [nb, na];
      await confirmar(bueno); await descartar(malo);
      resumen = `✔ Queda como cierto: ${bueno?.titulo}. "${malo?.titulo}" pasa a "ya no es cierto" (con historial).`;
    } else {
      if (!a.correccion) return { ok: false, error: "Si ninguno es cierto, dime cómo es en realidad (correccion)." };
      const base = na || nb;
      const historial = [...(base.ficha?.historial || []), { antes: base.privado ? "(privado)" : await abrirResumen(base), hasta: hoy, origen: "jefe" }];
      await escribirContenido(base.id, a.correccion, { historial }); await confirmar(base);
      if (na && nb) await descartar(base.id === na.id ? nb : na);
      resumen = `✔ Corregido: ${base.titulo} → ${a.correccion}`;
    }
    await query(`UPDATE bib_propuestas SET estado = 'aprobada', resuelto_en = now(), datos = datos || $2::jsonb WHERE id = $1`, [p.id, JSON.stringify({ respuesta: a.cierto || "correccion", correccion: a.correccion || null })]);
    return { ok: true, resumen };
  },
};

export const cerebroInforme: DefTool = {
  nombre: "cerebro_informe", modulo: MODULO,
  descripcion: "Informe de la memoria del último mes: cuánto creció, qué se aprendió (lecciones), qué se usa más, lo importante que está viejo y qué carpetas tienen poco (huecos para que Soga investigue o el jefe documente). Llega solo el día 1 de cada mes.",
  parametros: { type: "object", properties: { dias: { type: "integer", default: 30 } } },
  riesgo: "lectura", requiereAprobacion: false, timeoutSeg: 40,
  async ejecutar(a) {
    const { informeCerebro } = await import("../motor/sueno.js");
    return { ok: true, resumen: await informeCerebro(a.dias || 30) };
  },
};

export const cerebroExportar: DefTool = {
  nombre: "cerebro_exportar", modulo: MODULO,
  descripcion: "Exporta una carpeta (o un tema) del cerebro como PDF ordenado (resumen, cómo se hace, fallas y lecciones, datos, lo que pasó) y se lo manda al jefe por WhatsApp. Para tener a mano o compartir la documentación de un proyecto. Lo personal solo si él lo pide.",
  parametros: { type: "object", properties: { carpeta: { type: "string", description: "general, personal o el nombre del proyecto." }, tema: { type: "string", description: "Opcional: solo lo relacionado con este tema." } }, required: ["carpeta"] },
  riesgo: "escritura", requiereAprobacion: false, timeoutSeg: 180,
  async ejecutar(a, ctx) {
    const carpeta = a.carpeta === "general" || a.carpeta === "personal" ? a.carpeta : espacioProyecto(String(a.carpeta).replace(/^proyecto:/, ""));
    if (carpeta === "personal" && !(await conversacionDelJefe(ctx?.conversacionId))) return { ok: false, error: "Lo personal solo se exporta para el jefe." };
    const { exportarCarpeta } = await import("../motor/sueno.js");
    const r = await exportarCarpeta(carpeta, a.tema, ctx?.agenteId ?? null);
    return r.ok ? { ok: true, datos: r, resumen: `📄 ${r.nombre} (${r.recuerdos} recuerdos)${r.enviado ? " — ya te lo mandé por WhatsApp." : "."}` } : { ok: false, error: r.error! };
  },
};

export const toolsCerebro = [cerebroEstado, cerebroDormir, cerebroPreguntas, cerebroResponder, cerebroInforme, cerebroExportar];
