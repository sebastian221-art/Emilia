// ARCHIVO: src/tools/aprendizaje.ts
// Herramientas de System (módulo `aprender`): la pista de experimentos, la
// prueba local de prompts/reglas, la curiosidad y la cosecha de vueltas.
import type { DefTool } from "../registro/tipos.js";
import * as A from "../motor/aprendizaje.js";

const MODULO = "aprender";

export const aprenderExperimentoCrear: DefTool = {
  nombre: "aprender_experimento_crear", modulo: MODULO,
  descripcion: "Abre un experimento tipo 'pista': una hipótesis clara, una métrica numérica (más alto = mejor) y el nodo de la biblioteca que alimenta. Después se agregan variantes, se corren, se puntúan, se cruzan las mejores y se cierra con una conclusión.",
  parametros: { type: "object", properties: {
    titulo: { type: "string", minLength: 5 }, hipotesis: { type: "string", minLength: 10, description: "Qué creés que mejora qué y por qué." },
    metrica: { type: "string", minLength: 5, description: "Cómo se mide: 'puntaje del juez 0-100', 'tests que pasan', 'ms por tarea (negativo)', 'errores por 10 tareas (negativo)'." },
    dominio: { type: "string", enum: ["prompt", "regla", "codigo", "busqueda", "flujo", "general"], default: "general" },
    nodo_slug: { type: "string", description: "Slug del nodo de la biblioteca que este experimento alimenta (opcional)." },
    casos: { type: "array", description: "Para prompts/reglas: los casos de prueba FIJOS del experimento (los mismos para todas las variantes). Ideal: salidos de aprender_casos_reales. [{entrada, esperado?, referencia?}]", items: { type: "object", properties: { entrada: { type: "string" }, esperado: { type: "string" }, referencia: { type: "string" } }, required: ["entrada"] } },
    criterio: { type: "string", description: "Qué mira el juez en todos los casos (p. ej. 'brevedad sin perder lo accionable; nada inventado')." },
    casos_reales: { type: "object", description: "RECOMENDADO para prompts/reglas: la tool trae ella misma los casos reales (no se pueden inventar). {agente:'Emilia', canal:'whatsapp', dias:7, limite:8}", properties: { agente: { type: "string" }, canal: { type: "string" }, dias: { type: "integer" }, limite: { type: "integer" } } },
  }, required: ["titulo", "hipotesis", "metrica"] },
  riesgo: "escritura", requiereAprobacion: false,
  async ejecutar(a, ctx) {
    const esTexto = a.dominio === "prompt" || a.dominio === "regla";
    let casos: A.Caso[] = Array.isArray(a.casos) ? a.casos.slice(0, 10) : [];
    let origenCasos = casos.length ? "pasados a mano" : "";
    if (a.casos_reales || (esTexto && !casos.length)) {
      const cr = a.casos_reales || { agente: "Emilia", canal: "whatsapp", dias: 14, limite: 8 };
      const reales = await A.casosReales({ agente: cr.agente || null, canal: cr.canal || null, dias: cr.dias, limite: cr.limite || 8 });
      if (reales.length >= 2) { casos = reales.map(({ entrada, referencia }) => ({ entrada, referencia })); origenCasos = `${reales.length} casos REALES de ${cr.agente || "todos"} (${cr.canal || "todo canal"}, ${cr.dias || 14} días)`; }
      else if (!casos.length) return { ok: false, error: "No hay suficientes casos reales con ese filtro y no pasaste casos. Ampliá días/quitá el agente en casos_reales, o pasá casos realistas del dominio de Emilia." };
    }
    // Para prompts/reglas la métrica es SIEMPRE el juez: no se aceptan métricas inventadas (tasa de respuesta, satisfacción…).
    const metrica = esTexto ? `juez local 0-100${a.criterio ? ` · criterio del juez: ${a.criterio}` : " · criterio del juez: forma (brevedad, claridad, tono) con la misma información; nada inventado"}` : (a.criterio ? `${a.metrica} · criterio del juez: ${a.criterio}` : a.metrica);
    const id = await A.crearExperimento({ titulo: a.titulo, hipotesis: a.hipotesis, metrica, dominio: a.dominio, nodoSlug: a.nodo_slug, agenteId: ctx.agenteId, casos });
    return { ok: true, datos: { experimento_id: id, casos: casos.length, metrica }, resumen: `Experimento abierto [${id.slice(0, 8)}]: ${a.titulo}. Métrica: ${metrica}. Casos fijos: ${casos.length} (${origenCasos || "ninguno"})${casos.length ? " → aprender_probar_prompt(variante_id) los usa solo" : ""}. Ahora agregá 3-5 variantes distintas de verdad (no cosméticas) y corré cada una apenas la agregues.` };
  },
};

export const aprenderVarianteAgregar: DefTool = {
  nombre: "aprender_variante_agregar", modulo: MODULO,
  descripcion: "Agrega una variante a un experimento: un nombre, qué cambia (config) y de qué variantes se cruzó si es de una generación posterior.",
  parametros: { type: "object", properties: {
    experimento_id: { type: "string" }, nombre: { type: "string", minLength: 2 }, descripcion: { type: "string" },
    config: { type: "object", description: "Lo que define la variante: {instrucciones:'…'} para prompts/reglas, {parametro:valor} para ajustes, {comando:'…'} para código." },
    generacion: { type: "integer", default: 1 }, padres: { type: "array", items: { type: "string" }, description: "Ids (8 chars) de las variantes que se cruzaron." },
  }, required: ["experimento_id", "nombre"] },
  riesgo: "escritura", requiereAprobacion: false,
  async ejecutar(a) { const e = await A.experimentoPorId(a.experimento_id); if (!e) return { ok: false, error: "No existe ese experimento." }; const padres = (a.padres || []).map((p: string) => e.variantes.find((v: any) => v.id.startsWith(p))?.id).filter(Boolean); const id = await A.agregarVariante(e.id, { nombre: a.nombre, descripcion: a.descripcion, config: a.config, generacion: a.generacion, padres }); return { ok: true, datos: { variante_id: id }, resumen: `Variante [${id.slice(0, 8)}] "${a.nombre}" (gen ${a.generacion || 1}) agregada.` }; },
};

export const aprenderVariantePuntuar: DefTool = {
  nombre: "aprender_variante_puntuar", modulo: MODULO,
  descripcion: "Registra el resultado de correr una variante: puntaje numérico (según la métrica del experimento) y qué pasó. Varias corridas se promedian.",
  parametros: { type: "object", properties: { variante_id: { type: "string" }, puntaje: { type: "number" }, detalle: { type: "string" } }, required: ["variante_id", "puntaje"] },
  riesgo: "escritura", requiereAprobacion: false,
  async ejecutar(a) { const p = await A.puntuarVariante(a.variante_id, Number(a.puntaje), a.detalle); return { ok: true, resumen: `Variante ${String(a.variante_id).slice(0, 8)} → puntaje promedio ${p.toFixed(2)}.` }; },
};

export const aprenderExperimentoEstado: DefTool = {
  nombre: "aprender_experimento_estado", modulo: MODULO,
  descripcion: "Tabla de posiciones de un experimento (o lista de los abiertos si no pasás id): variantes ordenadas por puntaje, generaciones, cruces.",
  parametros: { type: "object", properties: { experimento_id: { type: "string" } }, required: [] },
  riesgo: "lectura", requiereAprobacion: false,
  async ejecutar(a) {
    if (!a.experimento_id) { const xs = await A.experimentosAbiertos(); return { ok: true, datos: xs, resumen: xs.length ? xs.map((e: any) => `[${e.id.slice(0, 8)}] ${e.titulo} · ${e.variantes} variantes · mejor ${e.mejor ?? "—"} · ${e.metrica}`).join("\n") : "No hay experimentos abiertos." }; }
    const e = await A.experimentoPorId(a.experimento_id); if (!e) return { ok: false, error: "No existe." };
    return { ok: true, datos: e, resumen: `${e.titulo} (${e.estado}) · hipótesis: ${e.hipotesis} · métrica: ${e.metrica}\n${A.tablaDe(e)}` };
  },
};

export const aprenderExperimentoCerrar: DefTool = {
  nombre: "aprender_experimento_cerrar", modulo: MODULO,
  descripcion: "Cierra un experimento con la conclusión (qué ganó, por cuánto, qué aprendimos, qué NO funcionó). Si alimenta un nodo, deja la evidencia tipo 'experimento' en la biblioteca.",
  parametros: { type: "object", properties: { experimento_id: { type: "string" }, conclusion: { type: "string", minLength: 20 }, mejor_variante_id: { type: "string" } }, required: ["experimento_id", "conclusion"] },
  riesgo: "escritura", requiereAprobacion: false,
  async ejecutar(a) { const r = await A.cerrarExperimento(a.experimento_id, a.conclusion, a.mejor_variante_id); return { ok: true, datos: r, resumen: `Cerrado. Ganó ${r.mejor ? `"${r.mejor.nombre}" (${Number(r.mejor.puntaje).toFixed(2)})` : "ninguna con puntaje"} sobre ${r.variantes} variantes. La conclusión quedó como evidencia en la biblioteca si había nodo.` }; },
};

export const aprenderProbarPrompt: DefTool = {
  nombre: "aprender_probar_prompt", modulo: MODULO,
  descripcion: "La pista local para prompts y reglas. Modo normal: pasás variante_id y la tool toma las instrucciones de esa variante (config.instrucciones), los casos FIJOS del experimento, hace que un juez puntúe cada respuesta 0-100 y REGISTRA el puntaje en la variante automáticamente. Rechaza variantes que copian las respuestas esperadas (trampa). Modo suelto: instrucciones + casos, sin registrar.",
  parametros: { type: "object", properties: {
    variante_id: { type: "string", description: "Id (8 chars) de la variante a correr. Recomendado." },
    instrucciones: { type: "string", description: "Solo en modo suelto: el prompt/regla a probar." },
    casos: { type: "array", description: "Solo en modo suelto (o si el experimento no guardó casos). Entre 2 y 10.", items: { type: "object", properties: { entrada: { type: "string" }, esperado: { type: "string" }, referencia: { type: "string" } }, required: ["entrada"] } },
    criterio: { type: "string", description: "Qué mira el juez (si el experimento ya lo definió, no hace falta)." },
  }, required: [] },
  riesgo: "lectura", requiereAprobacion: false, timeoutSeg: 240,
  async ejecutar(a) {
    let instrucciones = String(a.instrucciones || ""), casos: A.Caso[] = Array.isArray(a.casos) ? a.casos : [], criterio = a.criterio, v: any = null;
    if (a.variante_id) {
      v = await A.variantePorId(a.variante_id); if (!v) return { ok: false, error: "No existe esa variante." };
      instrucciones = String(v.config?.instrucciones || v.config?.prompt || v.config?.regla || instrucciones);
      if (!instrucciones.trim()) return { ok: false, error: "La variante no tiene config.instrucciones: agregala con ese campo (el texto literal de la regla/prompt)." };
      if (!casos.length) casos = Array.isArray(v.casos_experimento) ? v.casos_experimento : [];
      if (!criterio) { const m = String(v.metrica || "").match(/criterio del juez:\s*(.+)$/); if (m) criterio = m[1]; }
    }
    if (!instrucciones.trim() || casos.length < 2) return { ok: false, error: "Hacen falta instrucciones y al menos 2 casos (guardalos en el experimento al crearlo, con aprender_casos_reales)." };
    const trampa = A.huelenATrampa(instrucciones, casos);
    if (trampa) { if (v) await A.puntuarVariante(v.id, 0, `DESCARTADA por trampa: ${trampa}`); return { ok: false, error: `Variante inválida: ${trampa}` }; }
    const r = await A.probarPrompt({ instrucciones, casos: casos.slice(0, 10), criterio });
    if (v) await A.puntuarVariante(v.id, r.promedio, `juez ${r.promedio.toFixed(1)}/100 sobre ${r.resultados.length} casos`);
    return { ok: true, datos: { ...r, variante_id: v?.id, registrado: !!v }, resumen: `${v ? `Variante [${v.id.slice(0, 8)}] "${v.nombre}" → ` : ""}promedio ${r.promedio.toFixed(1)}/100${v ? " (registrado)" : ""}.\n${r.resultados.map((x, i) => `${i + 1}. ${x.puntaje} · ${x.motivo} · "${x.salida.slice(0, 90)}"`).join("\n")}` };
  },
};

export const aprenderCasosReales: DefTool = {
  nombre: "aprender_casos_reales", modulo: MODULO,
  descripcion: "Trae casos REALES para la pista: mensajes que de verdad llegaron a los agentes (del jefe o de terceros) y lo que respondieron. Sirven como casos de un experimento de prompts/reglas: entrada = el mensaje real, referencia = la respuesta real (el juez compara contra ella). Nunca inventes casos si podés usar estos.",
  parametros: { type: "object", properties: { agente: { type: "string", description: "Nombre del agente (Emilia, Echo…); vacío = todos." }, canal: { type: "string", enum: ["whatsapp", "panel"] }, dias: { type: "integer", default: 7, minimum: 1, maximum: 60 }, limite: { type: "integer", default: 10, minimum: 2, maximum: 40 } }, required: [] },
  riesgo: "lectura", requiereAprobacion: false,
  async ejecutar(a) { const xs = await A.casosReales({ agente: a.agente || null, canal: a.canal || null, dias: a.dias, limite: a.limite }); return { ok: true, datos: { casos: xs.map(({ entrada, referencia }) => ({ entrada, referencia })) }, resumen: xs.length ? `${xs.length} casos reales:\n${xs.map((c, i) => `${i + 1}. [${c.agente} · ${c.fecha}] "${c.entrada.slice(0, 100)}" → "${(c.referencia || "").slice(0, 100)}"`).join("\n")}\nPasalos tal cual en 'casos' al crear el experimento.` : "No hay conversaciones recientes con ese filtro; ampliá días o quitá el agente." }; },
};

export const aprenderCuriosidad: DefTool = {
  nombre: "aprender_curiosidad", modulo: MODULO,
  descripcion: "La cola de curiosidad: listar las preguntas pendientes (con 'sembrar' agrega automáticamente las que salen de la biblioteca y de los fallos), agregar una pregunta propia, o marcarla explorada/descartada con el hallazgo.",
  parametros: { type: "object", properties: {
    accion: { type: "string", enum: ["listar", "sembrar", "agregar", "resolver"], default: "listar" },
    pregunta: { type: "string" }, prioridad: { type: "integer", minimum: 1, maximum: 9 }, nodo_slug: { type: "string" },
    id: { type: "string" }, estado: { type: "string", enum: ["explorada", "descartada"] }, hallazgo: { type: "string" },
  }, required: [] },
  riesgo: "escritura", requiereAprobacion: false,
  async ejecutar(a) {
    const acc = a.accion || "listar";
    if (acc === "agregar") { if (!a.pregunta) return { ok: false, error: "Falta la pregunta." }; const id = await A.preguntar({ pregunta: a.pregunta, origen: "system", prioridad: a.prioridad, nodoSlug: a.nodo_slug }); return { ok: true, resumen: `Pregunta guardada [${id.slice(0, 8)}].` }; }
    if (acc === "resolver") { if (!a.id || !a.estado) return { ok: false, error: "Faltan id y estado." }; await A.resolverCuriosidad(a.id, a.estado, a.hallazgo); return { ok: true, resumen: `Pregunta ${a.id.slice(0, 8)} → ${a.estado}.` }; }
    let sembradas = 0; if (acc === "sembrar") sembradas = await A.sembrarCuriosidad();
    const xs = await A.curiosidadPendiente(12);
    return { ok: true, datos: xs, resumen: `${acc === "sembrar" ? `Sembradas ${sembradas}. ` : ""}${xs.length ? xs.map((c: any) => `[${c.id.slice(0, 8)}] (p${c.prioridad}, ${c.origen}) ${c.pregunta}${c.nodo_slug ? ` → ${c.nodo_slug}` : ""}`).join("\n") : "Nada pendiente: todo explorado."}` };
  },
};

export const aprenderVueltas: DefTool = {
  nombre: "aprender_vueltas", modulo: MODULO,
  descripcion: "Cosecha lo que pasó de verdad en las ejecuciones de TODOS los agentes en los últimos N días: tareas por agente, errores repetidos, correcciones del sistema y del jefe, herramientas más usadas, experimentos y curiosidad pendiente. Es la materia prima de la reflexión.",
  parametros: { type: "object", properties: { dias: { type: "integer", default: 1, minimum: 1, maximum: 30 } }, required: [] },
  riesgo: "lectura", requiereAprobacion: false,
  async ejecutar(a) { const t = await A.cosecharVueltas(Number(a.dias) || 1); return { ok: true, resumen: t }; },
};

export const aprenderLaboratorio: DefTool = {
  nombre: "aprender_laboratorio", modulo: MODULO,
  descripcion: "La pista de código: le pasás los archivos (nombre → contenido completo) y UN comando (node, python, npx tsx…), los escribe en una carpeta temporal propia (data/laboratorio/<id>) y corre el comando. Devuelve salida, código de salida y milisegundos. Sin red, sin tocar repos reales, sin pelear con la consola: es la forma de probar algoritmos, prototipos y comparar variantes. Para medir, hacé que el programa imprima el número al final (p. ej. 'PUNTAJE=87.5').",
  parametros: { type: "object", properties: {
    nombre: { type: "string", description: "Nombre corto del experimento (va en la carpeta)." },
    archivos: { type: "object", description: "{ 'mcts.js': '…código completo…', 'datos.json': '…' }. Contenido literal, sin escapes raros." },
    comando: { type: "string", minLength: 1, description: "Qué correr dentro de la carpeta: 'node mcts.js', 'python sim.py', 'node --test'." },
    timeout_seg: { type: "integer", default: 120, minimum: 5, maximum: 600 },
  }, required: ["archivos", "comando"] },
  riesgo: "ejecucion", requiereAprobacion: false, timeoutSeg: 660,
  async ejecutar(a) {
    const r = await A.laboratorio({ archivos: a.archivos || {}, comando: a.comando, timeoutSeg: a.timeout_seg, nombre: a.nombre });
    const puntaje = (r.stdout.match(/PUNTAJE\s*[=:]\s*(-?\d+(?:\.\d+)?)/i) || [])[1];
    return { ok: r.codigo === 0 && !r.timeout, datos: { ...r, puntaje: puntaje != null ? Number(puntaje) : undefined }, resumen: `[${r.id}] $ ${r.comando} → código ${r.codigo}${r.timeout ? " (timeout)" : ""} en ${r.ms} ms${puntaje != null ? ` · PUNTAJE ${puntaje}` : ""}\n${(r.stdout || r.stderr).slice(-1500)}`, error: r.codigo === 0 && !r.timeout ? undefined : `Salió con código ${r.codigo}${r.timeout ? " por timeout" : ""}: ${(r.stderr || r.stdout).slice(-800)}` };
  },
};

export const toolsAprendizaje: DefTool[] = [aprenderLaboratorio, aprenderCasosReales, aprenderExperimentoCrear, aprenderVarianteAgregar, aprenderVariantePuntuar, aprenderExperimentoEstado, aprenderExperimentoCerrar, aprenderProbarPrompt, aprenderCuriosidad, aprenderVueltas];