// ARCHIVO: src/tools/informes.ts
// ─────────────────────────────────────────────────────────────────────────────
//  VERIFICAR, INFORMAR Y RECORDAR (Soga): contrastar afirmaciones contra sus
//  fuentes, informe en PDF (se lo manda al jefe por WhatsApp) e historial.
// ─────────────────────────────────────────────────────────────────────────────
import type { DefTool } from "../registro/tipos.js";
import { contrastar, crearInforme, registrarInvestigacion, historialInvestigaciones } from "../motor/informes.js";

const fuentesEsq = { type: "array" as const, items: { type: "object" as const, properties: { url: { type: "string" as const }, titulo: { type: "string" as const }, fecha: { type: "string" as const }, nota: { type: "string" as const } }, required: ["url"] } };

export const webContrastar: DefTool = {
  nombre: "web_contrastar", modulo: "web",
  descripcion: "Comprueba las afirmaciones CLAVE de una investigación contra sus fuentes: lee cada página y verifica que de verdad lo diga (cifras y palabras), cuántos sitios INDEPENDIENTES lo confirman y de cuándo son. Devuelve certeza alta/media/baja por afirmación. Úsala antes de responder algo importante (precios, cifras, 'X ya salió', recomendaciones).",
  parametros: { type: "object", properties: {
    afirmaciones: { type: "array", items: { type: "object", properties: {
      texto: { type: "string", minLength: 5, description: "La afirmación concreta, con su cifra si tiene (p. ej. 'el plan Hobby de Railway cuesta 5 dólares al mes')." },
      urls: { type: "array", items: { type: "string" }, description: "Las páginas que lo respaldan (las que leíste)." },
    }, required: ["texto", "urls"] } },
  }, required: ["afirmaciones"] },
  riesgo: "lectura", requiereAprobacion: false, timeoutSeg: 240,
  async ejecutar(a) {
    const r = await contrastar(a.afirmaciones);
    const icono = { alta: "🟢", media: "🟡", baja: "🔴" } as const;
    const DICE = { confirma: "✔ lo confirma", no_aparece: "✘ no lo dice", cifra_distinta: "⚠ otra cifra", no_cargo: "⚪ no cargó" } as const;
    const global = r.some((x) => x.certeza === "baja") ? "baja" : r.every((x) => x.certeza === "alta") ? "alta" : "media";
    return { ok: true, datos: { afirmaciones: r, certeza_global: global }, resumen: `Certeza global: ${icono[global]} ${global}\n` + r.map((x) => `${icono[x.certeza]} ${x.afirmacion}\n   ${x.razon}\n${x.fuentes.map((f) => `   ${DICE[f.dice]} — ${f.dominio}${f.fecha ? ` (${f.fecha})` : ""}: ${f.detalle}`).join("\n")}`).join("\n") };
  },
};

export const informeCrear: DefTool = {
  nombre: "informe_crear", modulo: "informe",
  descripcion: "Hace un informe en PDF bien presentado (resumen, secciones, tabla comparativa con la opción recomendada resaltada, fuentes con fecha y certeza) y se lo manda al jefe por WhatsApp. Para investigaciones profundas, comparaciones de herramientas/modelos/precios, o cuando pida 'hazme un informe / un documento / pásamelo en PDF'.",
  parametros: { type: "object", properties: {
    titulo: { type: "string", minLength: 3 },
    pregunta: { type: "string", description: "Lo que pidió el jefe." },
    resumen: { type: "string", minLength: 10, description: "La respuesta en 3-8 líneas (admite viñetas con '- ' y **negrita**)." },
    secciones: { type: "array", items: { type: "object", properties: { titulo: { type: "string" }, texto: { type: "string" } }, required: ["titulo", "texto"] } },
    comparativa: { type: "object", properties: {
      columnas: { type: "array", items: { type: "string" }, description: "Criterios (precio, licencia, pros, contras…)." },
      filas: { type: "array", items: { type: "object", properties: { nombre: { type: "string" }, valores: { type: "array", items: { type: "string" } }, recomendado: { type: "boolean" } }, required: ["nombre", "valores"] } },
      recomendacion: { type: "string", description: "Cuál conviene para el caso del jefe y por qué." },
    }, required: ["columnas", "filas"] },
    fuentes: fuentesEsq,
    certeza: { type: "object", properties: { nivel: { type: "string", enum: ["alta", "media", "baja"] }, razon: { type: "string" } }, required: ["nivel", "razon"] },
    enviar: { type: "boolean", description: "Mandarlo al jefe por WhatsApp (por defecto sí)." },
  }, required: ["titulo", "resumen", "fuentes"] },
  riesgo: "escritura", requiereAprobacion: false, timeoutSeg: 120,
  async ejecutar(a, ctx) {
    try {
      const r = await crearInforme({ titulo: a.titulo, pregunta: a.pregunta, resumen: a.resumen, secciones: a.secciones, comparativa: a.comparativa, fuentes: a.fuentes || [], certeza: a.certeza }, { agenteId: ctx?.agenteId ?? null, enviar: a.enviar });
      return { ok: true, datos: r, resumen: `📄 Informe "${r.nombre}" (${Math.round(r.bytes / 1024)} KB, archivo_id ${r.archivoId})${r.enviado ? " — ya se lo mandé por WhatsApp." : r.error ? ` — no pude mandarlo por WhatsApp (${r.error}); queda en archivos.` : "."}` };
    } catch (e: any) { return { ok: false, error: `No pude crear el PDF: ${e?.message || e}` }; }
  },
};

export const investigacionRegistrar: DefTool = {
  nombre: "investigacion_registrar", modulo: "investigacion",
  descripcion: "Guarda en el historial una investigación terminada: la pregunta, tu respuesta, las fuentes con fecha y la certeza (y el informe si hiciste uno). Llámala al final de cada investigación.",
  parametros: { type: "object", properties: {
    pregunta: { type: "string", minLength: 3 }, respuesta: { type: "string", minLength: 3 },
    profundidad: { type: "string", enum: ["rapida", "normal", "profunda"] }, fuentes: fuentesEsq,
    certeza: { type: "string", enum: ["alta", "media", "baja"] }, archivo_id: { type: "string" },
  }, required: ["pregunta", "respuesta"] },
  riesgo: "escritura", requiereAprobacion: false, timeoutSeg: 20,
  async ejecutar(a, ctx) {
    const id = await registrarInvestigacion({ pregunta: a.pregunta, respuesta: a.respuesta, profundidad: a.profundidad, fuentes: a.fuentes, certeza: a.certeza, agenteId: ctx?.agenteId ?? null, archivoId: a.archivo_id || null });
    return { ok: true, datos: { id }, resumen: "Guardada en el historial de investigaciones." };
  },
};

export const investigacionHistorial: DefTool = {
  nombre: "investigacion_historial", modulo: "investigacion",
  descripcion: "Lo que Soga ya investigó: preguntas, respuestas, certeza, fuentes, costo e informe. Para 'qué averiguaste sobre X', 'lo que me investigaste la semana pasada', o para no repetir una investigación reciente.",
  parametros: { type: "object", properties: { buscar: { type: "string" }, dias: { type: "integer", default: 30 }, max: { type: "integer", minimum: 1, maximum: 30, default: 10 } } },
  riesgo: "lectura", requiereAprobacion: false, timeoutSeg: 20,
  async ejecutar(a) {
    const xs = await historialInvestigaciones({ buscar: a.buscar, dias: a.dias, max: a.max });
    if (!xs.length) return { ok: true, datos: [], resumen: `No hay investigaciones${a.buscar ? ` sobre "${a.buscar}"` : ""} en los últimos ${a.dias || 30} días.` };
    const total = xs.reduce((s, x) => s + Number(x.costo_usd || 0), 0);
    return { ok: true, datos: xs, resumen: xs.map((x) => `• ${new Date(x.creado_en).toLocaleDateString("es-CO", { timeZone: "America/Bogota", day: "numeric", month: "short" })} — ${x.pregunta}${x.certeza ? ` [certeza ${x.certeza}]` : ""}${x.archivo_id ? " 📄" : ""}\n  ${String(x.respuesta).replace(/\s+/g, " ").slice(0, 220)}${(x.fuentes || []).length ? `\n  Fuentes: ${(x.fuentes as any[]).slice(0, 3).map((f) => f.url).join(" · ")}` : ""}`).join("\n") + `\n(Costo en búsquedas de Claude: US$${total.toFixed(3)})` };
  },
};

export const toolsInformes = [webContrastar, informeCrear, investigacionRegistrar, investigacionHistorial];
