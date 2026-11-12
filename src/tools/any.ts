// ARCHIVO: src/tools/any.ts
// ─────────────────────────────────────────────────────────────────────────────
//  TOOLS DE CALIDAD DE ANY (Iris) — cómo va el chatbot del centro comercial,
//  qué respondió mal, informe, y arreglos SOLO con OK del jefe.
// ─────────────────────────────────────────────────────────────────────────────
import type { DefTool } from "../registro/tipos.js";
import { query } from "../db/cliente.js";
import { anyConfigurado, apiAny, revisarAny, informeAny, textoFallo, olvidarCatalogo, limpiarTexto } from "../motor/calidad-any.js";

const MODULO = "any";
const NO_CONFIG = { ok: false, error: "Any no está configurado: faltan ANY_URL, ANY_USUARIO y ANY_CLAVE en el .env de Emilia." };

export const anyCalidad: DefTool = {
  nombre: "any_calidad", modulo: MODULO,
  descripcion: "Cómo va Any (chatbot del centro comercial) hoy o en los últimos días: % bien/mal y las respuestas que salieron mal o dudosas, con qué debió decir. Úsala para 'cómo va Any', 'fallos de Any', 'qué respondió mal'.",
  parametros: { type: "object", properties: {
    dias: { type: "number", description: "Ventana en días (por defecto 1)." },
    incluir_dudosas: { type: "boolean", description: "También las dudosas (por defecto solo las malas)." },
  } },
  riesgo: "lectura", requiereAprobacion: false, timeoutSeg: 30,
  async ejecutar(a) {
    if (!anyConfigurado()) return NO_CONFIG;
    const dias = Number(a.dias || 1);
    const [t] = await query<any>(`SELECT count(*) FILTER (WHERE veredicto <> 'omitida')::int AS ev, count(*) FILTER (WHERE veredicto='bien')::int AS bien, count(*) FILTER (WHERE veredicto='mal')::int AS mal, count(*) FILTER (WHERE veredicto='dudosa')::int AS dudosa
      FROM any_evaluaciones WHERE fecha > now() - make_interval(days => $1)`, [dias]);
    const fallos = await query<any>(`SELECT * FROM any_evaluaciones WHERE fecha > now() - make_interval(days => $1) AND veredicto = ANY($2) AND COALESCE(revision,'') <> 'falso_positivo'
      ORDER BY gravedad DESC, fecha DESC LIMIT 8`, [dias, a.incluir_dudosas ? ["mal", "dudosa"] : ["mal"]]);
    const [e] = await query<{ valor: any }>(`SELECT valor FROM iris_config WHERE clave = 'any_estado'`);
    const pct = (x: number) => t.ev ? Math.round((x / t.ev) * 100) : 0;
    return { ok: true, datos: { resumen: t, fallos }, resumen: [
      `🤖 Any (${dias === 1 ? "último día" : `${dias} días`}): ${t.ev} respuestas evaluadas · ✅ ${pct(t.bien)} % · 🤔 ${pct(t.dudosa)} % · ❌ ${pct(t.mal)} %`,
      e?.valor?.error ? `⚠️ Última revisión con error: ${e.valor.error}` : e?.valor?.ultimo_ciclo ? `Última revisión: ${new Date(e.valor.ultimo_ciclo).toLocaleString("es-CO", { timeZone: "America/Bogota" })}` : "Aún no he revisado a Any.",
      fallos.length ? `\n${fallos.map(textoFallo).join("\n")}` : "\nNada mal en esa ventana. 👌",
    ].join("\n") };
  },
};

export const anyInforme: DefTool = {
  nombre: "any_informe", modulo: MODULO,
  descripcion: "Informe de calidad de Any: % de acierto por herramienta, tiempos, qué tipo de errores, preguntas que no supo (para la base de conocimiento) y problemas de código (para Sage). Llega solo los lunes.",
  parametros: { type: "object", properties: { dias: { type: "number", description: "Por defecto 7." } } },
  riesgo: "lectura", requiereAprobacion: false, timeoutSeg: 40,
  async ejecutar(a) {
    if (!anyConfigurado()) return NO_CONFIG;
    return { ok: true, resumen: await informeAny(Number(a.dias || 7)) };
  },
};

export const anyRevisarAhora: DefTool = {
  nombre: "any_revisar_ahora", modulo: MODULO,
  descripcion: "Revisa ya las conversaciones nuevas de Any (normalmente lo hago cada 15 min) y avisa si algo salió mal.",
  parametros: { type: "object", properties: {} },
  riesgo: "lectura", requiereAprobacion: false, timeoutSeg: 240,
  async ejecutar() {
    if (!anyConfigurado()) return NO_CONFIG;
    const r = await revisarAny({ forzar: true });
    if (r.error) return { ok: false, error: r.error };
    return { ok: true, datos: r, resumen: r.nuevas ? `Revisé ${r.evaluadas} respuesta(s) nueva(s) de Any: ${r.mal ? `❌ ${r.mal} mal${r.avisos ? " (ya te las mandé)" : ""}` : "todas bien 👌"}.` : "Any no tiene conversaciones nuevas desde la última revisión." };
  },
};

export const anyVer: DefTool = {
  nombre: "any_ver", modulo: MODULO,
  descripcion: "Muestra una conversación de Any por su número (#123): qué preguntó el cliente, qué herramienta eligió Any y por qué, los pasos con tiempos y qué respondió. Para entender POR QUÉ respondió así.",
  parametros: { type: "object", properties: { traza_id: { type: "number" } }, required: ["traza_id"] },
  riesgo: "lectura", requiereAprobacion: false, timeoutSeg: 40,
  async ejecutar(a) {
    if (!anyConfigurado()) return NO_CONFIG;
    const id = Number(String(a.traza_id).replace(/\D/g, ""));
    const [ev] = await query<any>(`SELECT * FROM any_evaluaciones WHERE traza_id = $1`, [id]);
    const t = (await apiAny<any[]>(`/orquestador/trazas?limit=200`).catch(() => [])).find((x) => x.id === id);
    if (!t && !ev) return { ok: false, error: `No encuentro la conversación #${id}.` };
    const lineas = [
      `#${id} · ${ev?.cliente || "cliente"} · ${new Date(ev?.fecha || t?.created_at).toLocaleString("es-CO", { timeZone: "America/Bogota" })}`,
      `Cliente: ${limpiarTexto(t?.mensaje_usuario ?? ev?.pregunta)}`,
      t ? `Any eligió *${t.herramienta_elegida || "?"}* por ${t.metodo_decision || "?"}${t.razon_decision ? `: ${limpiarTexto(t.razon_decision).slice(0, 300)}` : ""}` : `Herramienta: ${ev?.herramienta || "?"}`,
      t?.pasos?.length ? `Pasos:\n${t.pasos.slice(0, 12).map((p: any) => `  ${p.paso}${p.ms ? ` (${Math.round(p.ms)} ms)` : ""}: ${limpiarTexto(String(p.detalle)).slice(0, 160)}`).join("\n")}` : "",
      `Respondió${t?.tiempo_total_ms ? ` en ${(t.tiempo_total_ms / 1000).toFixed(1)} s` : ""}: ${limpiarTexto(t?.respuesta_bot ?? ev?.respuesta)}`,
      ev && ev.veredicto !== "omitida" ? `\nMi evaluación: ${ev.veredicto}${ev.problema ? ` — ${ev.problema}` : ""}${ev.respuesta_correcta ? `\nDebió decir: ${ev.respuesta_correcta}` : ""}${ev.sugerencia ? `\nArreglo (${ev.arreglo}): ${ev.sugerencia}` : ""}${ev.revision ? `\nTú la marcaste: ${ev.revision}${ev.nota_jefe ? ` (${ev.nota_jefe})` : ""}` : ""}` : "",
    ];
    return { ok: true, resumen: lineas.filter(Boolean).join("\n") };
  },
};

export const anyMarcar: DefTool = {
  nombre: "any_marcar", modulo: MODULO,
  descripcion: "Corrige mi evaluación de una respuesta de Any: 'falso_positivo' (sí estaba bien; lo aprendo para no repetir el error), 'confirmada' (sí estaba mal) o 'arreglada' (ya se corrigió).",
  parametros: { type: "object", properties: {
    traza_id: { type: "number" },
    como: { type: "string", enum: ["falso_positivo", "confirmada", "arreglada"] },
    nota: { type: "string", description: "Por qué (p. ej. 'el horario cambió, ahora es hasta las 9')." },
  }, required: ["traza_id", "como"] },
  riesgo: "escritura", requiereAprobacion: false, timeoutSeg: 20,
  async ejecutar(a) {
    const id = Number(String(a.traza_id).replace(/\D/g, ""));
    const [ev] = await query<any>(`UPDATE any_evaluaciones SET revision = $2, nota_jefe = COALESCE($3, nota_jefe) WHERE traza_id = $1 RETURNING *`, [id, a.como, a.nota || null]);
    if (!ev) return { ok: false, error: `No tengo evaluada la #${id}.` };
    if (a.como === "falso_positivo") await query(`INSERT INTO any_aprendizajes (texto) VALUES ($1)`, [`Ante "${String(ev.pregunta).slice(0, 120)}", la respuesta de Any "${String(ev.respuesta).slice(0, 160)}" era CORRECTA${a.nota ? `: ${a.nota}` : ""}.`]);
    else if (a.nota) await query(`INSERT INTO any_aprendizajes (texto) VALUES ($1)`, [`Sobre "${String(ev.pregunta).slice(0, 120)}": ${a.nota}`]);
    return { ok: true, resumen: a.como === "falso_positivo" ? `Entendido, #${id} estaba bien. Lo tengo en cuenta para las próximas.` : `#${id} marcada como ${a.como}.` };
  },
};

export const anyAgregarConocimiento: DefTool = {
  nombre: "any_agregar_conocimiento", modulo: MODULO,
  descripcion: "Agrega una entrada a la base de conocimiento de Any (el dato que le faltaba). CAMBIA a Any en producción: pide OK del jefe. Úsala solo si el jefe lo pidió o aceptó la sugerencia.",
  parametros: { type: "object", properties: {
    titulo: { type: "string", minLength: 3, maxLength: 150 },
    contenido: { type: "string", minLength: 5, description: "El dato tal como Any debe usarlo." },
  }, required: ["titulo", "contenido"] },
  riesgo: "ejecucion", requiereAprobacion: true, timeoutSeg: 40,
  async ejecutar(a) {
    if (!anyConfigurado()) return NO_CONFIG;
    const r = await apiAny<any>("/knowledge", { method: "POST", body: JSON.stringify({ title: String(a.titulo).trim(), content: String(a.contenido).trim() }) });
    olvidarCatalogo();
    return { ok: true, datos: r, resumen: `📚 Agregado a la base de conocimiento de Any: "${a.titulo}" (id ${r?.entry?.id ?? "?"}). Desde ya lo usa.` };
  },
};

export const anyPasarASage: DefTool = {
  nombre: "any_pasar_a_sage", modulo: MODULO,
  descripcion: "Le pasa a Sage respuestas de Any que fallaron por CÓDIGO para que encuentre la causa y la arregle en un sandbox (Sage pide OK antes de subir). Solo cuando el jefe lo pida.",
  parametros: { type: "object", properties: {
    traza_ids: { type: "array", items: { type: "number" } },
    instruccion: { type: "string", description: "Lo que el jefe quiere (opcional)." },
  }, required: ["traza_ids"] },
  riesgo: "escritura", requiereAprobacion: false, timeoutSeg: 60,
  async ejecutar(a) {
    const proyecto = process.env.ANY_PROYECTO || "chat_bot_cc";
    const { obtenerProyecto } = await import("../dominio/proyectos.js");
    if (!await obtenerProyecto(proyecto)) return { ok: false, error: `El proyecto de Any ("${proyecto}") no está registrado para Sage. Regístralo con codigo_registrar_proyecto o pon ANY_PROYECTO en el .env.` };
    const evs = await query<any>(`SELECT * FROM any_evaluaciones WHERE traza_id = ANY($1) ORDER BY traza_id`, [(a.traza_ids as any[]).map((x) => Number(String(x).replace(/\D/g, "")))]);
    if (!evs.length) return { ok: false, error: "No tengo evaluadas esas conversaciones." };
    const detalle = `${a.instruccion ? `El jefe pide: ${a.instruccion}\n\n` : ""}Respuestas de Any que fallaron (las trazas completas están en /orquestador/trazas del panel de Any):\n${evs.map((e) => `- Traza #${e.traza_id} (herramienta ${e.herramienta || "?"}): cliente preguntó "${e.pregunta}". Any respondió "${String(e.respuesta).slice(0, 400)}". Problema: ${e.problema || e.categoria}. Debió: ${e.respuesta_correcta || "?"}. Idea: ${e.sugerencia || "-"}`).join("\n")}\nNo cambies datos de producción; arregla la lógica y agrega una prueba que reproduzca el caso.`;
    const { escalarASage } = await import("../skills/guardia.js");
    escalarASage(proyecto, `Any responde mal: ${evs[0].problema || evs[0].categoria}`.slice(0, 140), detalle).catch((e) => console.warn("[any] sage:", e?.message || e));
    return { ok: true, resumen: `🔧 Se lo pasé a Sage (${evs.length} caso(s)). Lo arregla en un sandbox y te pide OK antes de subir nada a Any.` };
  },
};

export const toolsAny = [anyCalidad, anyInforme, anyRevisarAhora, anyVer, anyMarcar, anyAgregarConocimiento, anyPasarASage];
