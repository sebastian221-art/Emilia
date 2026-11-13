// ARCHIVO: src/tools/herramientas.ts
// ─────────────────────────────────────────────────────────────────────────────
//  CAZADORA DE HERRAMIENTAS (Soga): buscar en GitHub, auditar sin ejecutar,
//  pasarle a Sage la prueba en sandbox y llevar el registro.
// ─────────────────────────────────────────────────────────────────────────────
import type { DefTool } from "../registro/tipos.js";
import { cazar, evaluarRepo, herramientasEvaluadas, marcarHerramienta, type Evaluacion } from "../motor/cazador.js";

const MODULO = "herramienta";
const VER = { recomendable: "🟢 recomendable", con_cuidado: "🟡 con cuidado", no_recomendable: "🔴 NO recomendable" } as const;
const SEV = { alto: "🚨", medio: "⚠️", bajo: "·" } as const;
const ficha = (e: Evaluacion, corta = false) => [
  `${VER[e.veredicto]} · *${e.repo}* (${e.puntaje}/100) — ${e.url}`,
  `⭐ ${e.info.estrellas.toLocaleString("es-CO")} · ${e.info.lenguaje || "?"} · licencia ${e.info.licencia} · ${e.info.salud}${e.info.ultima_version ? ` · ${e.info.ultima_version.tag} (${e.info.ultima_version.fecha})` : ""}`,
  e.resumen,
  !corta && e.integracion ? `Cómo se integraría: ${e.integracion}` : "",
  e.hallazgos.length ? `Auditoría (${e.archivos_revisados} archivos leídos, nada ejecutado):\n${e.hallazgos.slice(0, corta ? 3 : 10).map((h) => `  ${SEV[h.severidad]} ${h.que}${h.archivo ? ` — ${h.archivo}${h.linea ? `:${h.linea}` : ""}` : ""}${!corta && h.fragmento ? `\n     \`${h.fragmento}\`` : ""}`).join("\n")}` : `Auditoría (${e.archivos_revisados} archivos leídos, nada ejecutado): sin señales de riesgo.`,
].filter(Boolean).join("\n");

export const herramientaBuscar: DefTool = {
  nombre: "herramienta_buscar", modulo: MODULO,
  descripcion: "Busca en GitHub herramientas para una necesidad (servidores MCP, skills de agentes, librerías, herramientas) y AUDITA las mejores sin ejecutarlas: salud, licencia, dueño, código sospechoso, librerías con fallos, y si de verdad sirve. Devuelve un ranking con veredicto. Para 'busca un MCP para X', 'hay alguna librería para Y', 'qué skill sirve para Z'.",
  parametros: { type: "object", properties: {
    necesidad: { type: "string", minLength: 3, description: "Qué se quiere lograr (mejor en inglés para GitHub, p. ej. 'postgres database', 'pdf generation', 'google calendar')." },
    tipo: { type: "string", enum: ["mcp", "skill", "libreria", "herramienta", "cualquiera"] },
    lenguaje: { type: "string", description: "typescript, python… (opcional)." },
    max: { type: "integer", minimum: 1, maximum: 6, default: 4 },
  }, required: ["necesidad"] },
  riesgo: "lectura", requiereAprobacion: false, timeoutSeg: 600,
  async ejecutar(a) {
    try {
      const r = await cazar(a.necesidad, { tipo: a.tipo, lenguaje: a.lenguaje, max: a.max });
      if (!r.evaluaciones.length) return { ok: false, error: `No encontré repos activos para "${a.necesidad}" (${r.consultas.join(" · ")}). Prueba en inglés o con otras palabras.` };
      return { ok: true, datos: r, resumen: `Revisé ${r.evaluaciones.length} candidato(s) para "${a.necesidad}":\n\n${r.evaluaciones.map((e, i) => `${i + 1}. ${ficha(e, true)}`).join("\n\n")}\n\nNada se instaló. Si una te sirve, puedo pedirle a Sage que la pruebe en un sandbox (herramienta_probar).` };
    } catch (e: any) { return { ok: false, error: String(e?.message || e) }; }
  },
};

export const herramientaEvaluar: DefTool = {
  nombre: "herramienta_evaluar", modulo: MODULO,
  descripcion: "Audita UN repo de GitHub a fondo sin ejecutarlo (salud, licencia, dueño, scripts de instalación, código sospechoso con archivo y línea, librerías con fallos) y dice qué hace, si sirve y cómo se integraría. Para 'vi este repo, ¿sirve? ¿es seguro?'.",
  parametros: { type: "object", properties: { repo: { type: "string", minLength: 3 }, necesidad: { type: "string" } }, required: ["repo"] },
  riesgo: "lectura", requiereAprobacion: false, timeoutSeg: 300,
  async ejecutar(a) {
    try { const e = await evaluarRepo(a.repo, { necesidad: a.necesidad }); return { ok: true, datos: e, resumen: ficha(e) }; }
    catch (e: any) { return { ok: false, error: String(e?.message || e) }; }
  },
};

export const herramientaProbar: DefTool = {
  nombre: "herramienta_probar", modulo: MODULO,
  descripcion: "Le pide a Sage que pruebe una herramienta ya auditada en un SANDBOX aislado (instalación sin scripts, sin credenciales reales, nada a producción) y reporte si funciona. Integrarla a Emilia después es otro paso que pide OK del jefe. No se puede con las 'NO recomendables'.",
  parametros: { type: "object", properties: { repo: { type: "string", minLength: 3 }, que_probar: { type: "string", minLength: 5, description: "Qué tiene que comprobar Sage (p. ej. 'que el servidor MCP liste tablas de una base Postgres de prueba')." } }, required: ["repo", "que_probar"] },
  riesgo: "escritura", requiereAprobacion: false, timeoutSeg: 60,
  async ejecutar(a, ctx) {
    const [e] = (await herramientasEvaluadas()).filter((x) => x.repo.toLowerCase() === String(a.repo).replace(/^https?:\/\/github\.com\//, "").replace(/\/$/, "").toLowerCase());
    if (!e) return { ok: false, error: "Primero audítala con herramienta_evaluar." };
    if (e.veredicto === "no_recomendable") return { ok: false, error: `La auditoría la marcó como NO recomendable (${(e.hallazgos || []).filter((h: any) => h.severidad === "alto").map((h: any) => h.que).join("; ")}). No se prueba.` };
    const tarea = `Prueba esta herramienta en un SANDBOX aislado y repórtame si funciona. NO la integres a Emilia ni a ningún proyecto.
Repo: ${e.url} (auditoría de Soga: ${e.veredicto}, ${e.puntaje}/100${(e.hallazgos || []).length ? `; ojo con: ${(e.hallazgos as any[]).slice(0, 4).map((h) => h.que).join("; ")}` : ""}).
Qué comprobar: ${a.que_probar}
Reglas: 1) clónala en el laboratorio/sandbox, nunca en un proyecto real; 2) instala SIN scripts (npm install --ignore-scripts / pip install --no-build-isolation solo si hace falta) y revisa qué intenta descargar; 3) sin credenciales reales ni datos de clientes (usa datos de prueba); 4) corre sus pruebas si tiene y la prueba pedida; 5) reporta: ¿funcionó?, qué tuviste que hacer, problemas, y cómo se integraría a Emilia (archivos y pasos). Integrar es aparte y con OK del jefe.`;
    const { agenteDelegar } = await import("./agentes.js");
    const d: any = await agenteDelegar.ejecutar({ agente: "Sage", tarea }, ctx);
    if (!d?.ok) return { ok: false, error: `No pude pasársela a Sage: ${d?.error || "error"}` };
    await marcarHerramienta(e.repo, "probando");
    return { ok: true, datos: d.datos, resumen: `🧪 Se la pasé a Sage para probar ${e.repo} en un sandbox (sin scripts de instalación ni datos reales). Te cuenta el resultado; integrarla sería aparte y con tu OK.` };
  },
};

export const herramientaLista: DefTool = {
  nombre: "herramienta_lista", modulo: MODULO,
  descripcion: "Herramientas de GitHub que Soga ya encontró y auditó, con su veredicto y estado (evaluada, probando, probada, integrada, descartada).",
  parametros: { type: "object", properties: { estado: { type: "string", enum: ["evaluada", "probando", "probada", "integrada", "descartada"] } } },
  riesgo: "lectura", requiereAprobacion: false, timeoutSeg: 20,
  async ejecutar(a) {
    const xs = await herramientasEvaluadas(a.estado);
    if (!xs.length) return { ok: true, datos: [], resumen: "Aún no he evaluado herramientas." };
    return { ok: true, datos: xs, resumen: xs.map((x) => `• ${VER[x.veredicto as keyof typeof VER]} ${x.repo} (${x.puntaje}/100) — ${x.estado}${x.necesidad ? ` · para: ${x.necesidad}` : ""}\n  ${String(x.resumen || "").split("\n")[0].slice(0, 160)}`).join("\n") };
  },
};

export const herramientaMarcar: DefTool = {
  nombre: "herramienta_marcar", modulo: MODULO,
  descripcion: "Cambia el estado de una herramienta evaluada: probada (Sage la probó bien), integrada (ya está en Emilia), descartada (no sirve o el jefe no la quiere).",
  parametros: { type: "object", properties: { repo: { type: "string" }, estado: { type: "string", enum: ["probada", "integrada", "descartada", "evaluada"] } }, required: ["repo", "estado"] },
  riesgo: "escritura", requiereAprobacion: false, timeoutSeg: 20,
  async ejecutar(a) {
    const r = await marcarHerramienta(a.repo, a.estado);
    return r ? { ok: true, resumen: `${r}: ${a.estado}.` } : { ok: false, error: `No tengo evaluada "${a.repo}".` };
  },
};

export const toolsHerramientas = [herramientaBuscar, herramientaEvaluar, herramientaProbar, herramientaLista, herramientaMarcar];
