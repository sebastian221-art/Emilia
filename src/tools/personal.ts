// ARCHIVO: src/tools/personal.ts
// ─────────────────────────────────────────────────────────────────────────────
//  BUSCAR EN LO TUYO (solo lectura): correos, archivos, conversaciones con los
//  agentes, agenda y biblioteca. Para "el correo donde…", "qué me dijo X sobre
//  Y", "el PDF de…". Ver completo un hallazgo con personal_ver.
// ─────────────────────────────────────────────────────────────────────────────
import type { DefTool } from "../registro/tipos.js";
import { buscarMio, verMio, LUGARES, type Lugar } from "../motor/buscar-mio.js";

const MODULO = "personal";
const ICONO: Record<Lugar, string> = { correo: "📧", archivo: "📎", conversacion: "💬", agenda: "📅", biblioteca: "📚" };

export const personalBuscar: DefTool = {
  nombre: "personal_buscar", modulo: MODULO,
  descripcion: "Busca en las cosas del jefe (solo lectura): sus correos (y en Gmail si no aparece), archivos que ha mandado o recibido (también DENTRO de PDF, Word y Excel), conversaciones con los agentes por WhatsApp y panel, su agenda y la biblioteca. Para 'busca el correo donde el hospital habló del contrato', 'qué me dijo Valentina sobre X', 'el PDF de la propuesta', 'cuándo hablamos de Y'.",
  parametros: { type: "object", properties: {
    consulta: { type: "string", minLength: 2, description: "Lo que busca, con las palabras clave (nombres, temas, cifras)." },
    donde: { type: "array", items: { type: "string", enum: LUGARES }, description: "Dónde buscar (por defecto en todo)." },
    persona: { type: "string", description: "Correos de/para esta persona (nombre o correo)." },
    desde: { type: "string", description: "AAAA-MM-DD" }, hasta: { type: "string", description: "AAAA-MM-DD" },
    max: { type: "integer", minimum: 1, maximum: 30, default: 12 },
  }, required: ["consulta"] },
  riesgo: "lectura", requiereAprobacion: false, timeoutSeg: 120,
  async ejecutar(a, ctx) {
    const r = await buscarMio(a.consulta, { donde: a.donde, persona: a.persona, desde: a.desde, hasta: a.hasta, max: a.max });
    let extra = "";
    const buscabaCorreo = !a.donde?.length || a.donde.includes("correo");
    if (buscabaCorreo && !r.hallazgos.some((h) => h.donde === "correo")) {
      // Más atrás de lo que Iris ha visto: directo en Gmail (solo encabezados, no marca nada como leído).
      try { const { correoBuscar } = await import("./correo.js"); const g: any = await correoBuscar.ejecutar({ consulta: [a.persona ? `from:${a.persona}` : "", r.palabras.join(" ")].filter(Boolean).join(" ") }, ctx); if (g?.ok && /En Gmail/.test(g.resumen)) extra = `\n\n${g.resumen}`; } catch { /* correo sin configurar */ }
    }
    if (!r.hallazgos.length && !extra) return { ok: true, datos: r, resumen: `No encontré nada con "${r.palabras.join(" ") || a.consulta}"${a.persona ? ` de ${a.persona}` : ""}. Prueba con otras palabras (un nombre, una cifra, el asunto) o sin filtro de fechas.` };
    const fecha = (d: string | null) => (d ? new Date(d).toLocaleDateString("es-CO", { timeZone: "America/Bogota", day: "numeric", month: "short", year: "numeric" }) : "");
    return { ok: true, datos: r, resumen: `${r.hallazgos.length} resultado(s):\n` + r.hallazgos.map((h) => `${ICONO[h.donde]} ${h.ref} · ${fecha(h.fecha)} · ${h.titulo}${h.extracto ? `\n   ${h.extracto}` : ""}`).join("\n") + extra + (r.hallazgos.length ? "\n\nPara verlo completo: personal_ver(ref)." : "") };
  },
};

export const personalVer: DefTool = {
  nombre: "personal_ver", modulo: MODULO,
  descripcion: "Abre completo algo que encontró personal_buscar, por su ref: #abcde (correo), archivo:xxxx, mensaje:xxxx (con la conversación alrededor), agenda:xxxx o nodo:slug. Solo lectura: no marca nada como leído.",
  parametros: { type: "object", properties: { ref: { type: "string", minLength: 4 }, max_chars: { type: "integer", minimum: 500, maximum: 40000, default: 8000 } }, required: ["ref"] },
  riesgo: "lectura", requiereAprobacion: false, timeoutSeg: 60,
  async ejecutar(a) {
    const r = await verMio(a.ref, a.max_chars || 8000);
    return r ? { ok: true, datos: r, resumen: `${r.titulo}\n\n${r.texto}` } : { ok: false, error: `No encuentro "${a.ref}". Usa la ref exacta que dio personal_buscar.` };
  },
};

export const toolsPersonal = [personalBuscar, personalVer];
