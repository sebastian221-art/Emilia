// ARCHIVO: src/tools/web.ts
// Buscador interno: buscar en internet y leer páginas. Sin claves ni costo.
import type { DefTool } from "../registro/tipos.js";
import { buscar, leer, ErrorBuscador } from "../motor/web.js";

const MODULO = "web";

export const webBuscar: DefTool = {
  nombre: "web_buscar", modulo: MODULO,
  descripcion: "Busca en internet (DuckDuckGo/Bing) y devuelve títulos, URLs y resúmenes. Úsalo para cualquier pregunta sobre el mundo actual, tecnologías, precios, noticias, documentación, 'qué es X', 'cómo se hace Y'. Después, leé las páginas relevantes con web_leer para responder con fundamento.",
  parametros: { type: "object", properties: { consulta: { type: "string", minLength: 2, description: "Lo que buscarías en Google. Podés hacer varias búsquedas con distintas palabras." }, max: { type: "integer", default: 8, minimum: 1, maximum: 15 }, region: { type: "string", description: "Región/idioma (co-es, us-en, es-es…).", default: "co-es" } }, required: ["consulta"] },
  riesgo: "lectura", requiereAprobacion: false, timeoutSeg: 60,
  async ejecutar(a) {
    let r;
    try { r = await buscar(a.consulta, a.max || 8, a.region || "co-es"); }
    catch (e: any) { if (e instanceof ErrorBuscador) return { ok: false, error: `BUSCADOR CAÍDO: ${e.message} NO repitas la búsqueda con otras palabras. Decile al jefe que internet no está disponible ahora y, si podés, respondé con lo que ya sabés avisando que no tiene fuentes frescas.` }; throw e; }
    if (!r.length) return { ok: false, error: `El buscador respondió pero no hay resultados para "${a.consulta}" (es raro: probá UNA variante más corta o en inglés; si tampoco, no insistas).` };
    return { ok: true, datos: r, resumen: r.map((x, i) => `${i + 1}. ${x.titulo} — ${x.url}\n   ${x.resumen.slice(0, 180)}`).join("\n") };
  },
};

export const webLeer: DefTool = {
  nombre: "web_leer", modulo: MODULO,
  descripcion: "Lee una página web, artículo, documentación o PDF por URL y devuelve su texto limpio (sin menús ni scripts) más los enlaces principales. Para leer de verdad lo que dice una fuente antes de responder.",
  parametros: { type: "object", properties: { url: { type: "string", minLength: 8 }, max_chars: { type: "integer", default: 12000, minimum: 500, maximum: 60000 } }, required: ["url"] },
  riesgo: "lectura", requiereAprobacion: false, timeoutSeg: 60,
  async ejecutar(a) {
    try {
      const p = await leer(a.url, a.max_chars || 12000);
      return { ok: true, datos: { titulo: p.titulo, url: p.url, caracteres: p.caracteres, recortado: p.recortado, enlaces: p.enlaces.slice(0, 15) }, resumen: `${p.titulo} — ${p.url} (${p.caracteres} caracteres${p.recortado ? ", recortado" : ""})\n\n${p.texto}` };
    } catch (e: any) { return { ok: false, error: `No pude leer ${a.url}: ${e?.message || String(e)}` }; }
  },
};

export const toolsWeb: DefTool[] = [webBuscar, webLeer];