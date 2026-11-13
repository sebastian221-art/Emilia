// ARCHIVO: src/tools/web.ts
// ─────────────────────────────────────────────────────────────────────────────
//  BUSCADOR de Emilia (lo usa sobre todo Soga): buscar en internet por capas
//  (SearXNG propio → gratis → Claude), leer páginas (también las que se arman
//  con JavaScript), verificar un dato con fuentes citadas y ver el estado.
// ─────────────────────────────────────────────────────────────────────────────
import type { DefTool } from "../registro/tipos.js";
import { buscar, leer, ErrorBuscador, buscarConClaude, estadoMotores } from "../motor/web.js";

const MODULO = "web";

export const webBuscar: DefTool = {
  nombre: "web_buscar", modulo: MODULO,
  descripcion: "Busca en internet y devuelve títulos, URLs, fechas y resúmenes. Para cualquier pregunta sobre el mundo actual: tecnologías, herramientas, precios, noticias, documentación, 'qué es X', 'cómo se hace Y'. Después lee las páginas relevantes con web_leer. Usa reciente='semana'/'dia' para noticias y novedades.",
  parametros: { type: "object", properties: {
    consulta: { type: "string", minLength: 2, description: "Lo que buscarías en Google. Haz varias búsquedas con palabras distintas (y en inglés si es técnico)." },
    max: { type: "integer", default: 8, minimum: 1, maximum: 15 },
    region: { type: "string", description: "Región/idioma para los buscadores de respaldo (co-es, us-en…).", default: "co-es" },
    reciente: { type: "string", enum: ["dia", "semana", "mes", "año"], description: "Solo resultados de ese periodo (noticias, lanzamientos, precios)." },
    motor: { type: "string", enum: ["auto", "gratis", "claude"], description: "auto (por defecto): gratis primero y Claude si fallan. claude: búsqueda de Claude (cuesta; para datos que tienen que estar al día)." },
  }, required: ["consulta"] },
  riesgo: "lectura", requiereAprobacion: false, timeoutSeg: 90,
  async ejecutar(a, ctx) {
    let r;
    try { r = await buscar(a.consulta, a.max || 8, a.region || "co-es", { reciente: a.reciente, motor: a.motor, agenteId: ctx?.agenteId ?? null }); }
    catch (e: any) { if (e instanceof ErrorBuscador) return { ok: false, error: `BUSCADOR CAÍDO: ${e.message} NO repitas la búsqueda con otras palabras. Dile al jefe que internet no está disponible ahora.` }; throw e; }
    if (!r.length) return { ok: false, error: `No hay resultados para "${a.consulta}"${a.reciente ? ` en el último periodo (${a.reciente})` : ""}. Prueba UNA variante más corta, en inglés${a.reciente ? " o sin el filtro de fecha" : ""}; si tampoco, no insistas.` };
    const motores = [...new Set(r.map((x) => String(x.motor || "").split(":")[0]).filter(Boolean))].join(", ");
    return { ok: true, datos: r, resumen: `(${r.length} resultados${motores ? ` · ${motores}` : ""})\n` + r.map((x, i) => `${i + 1}. ${x.titulo} — ${x.url}${x.fecha ? ` [${x.fecha}]` : ""}\n   ${x.resumen.slice(0, 200)}`).join("\n") };
  },
};

export const webLeer: DefTool = {
  nombre: "web_leer", modulo: MODULO,
  descripcion: "Lee una página web, artículo, documentación o PDF por URL y devuelve su texto limpio más los enlaces principales. Si la página se arma con JavaScript (apps, tiendas, paneles, muchas documentaciones), la abre sola en un navegador. Para leer de verdad lo que dice una fuente antes de responder.",
  parametros: { type: "object", properties: {
    url: { type: "string", minLength: 8 },
    max_chars: { type: "integer", default: 12000, minimum: 500, maximum: 60000 },
    renderizar: { type: "boolean", description: "Forzar el navegador (si la lectura normal salió vacía o incompleta)." },
    fresco: { type: "boolean", description: "Ignorar la copia guardada y leer de nuevo (precios, estados que cambian)." },
  }, required: ["url"] },
  riesgo: "lectura", requiereAprobacion: false, timeoutSeg: 90,
  async ejecutar(a) {
    try {
      const p = await leer(a.url, a.max_chars || 12000, { renderizar: !!a.renderizar, frescoMin: a.fresco ? 1 : undefined, sinCache: !!a.fresco });
      return { ok: true, datos: { titulo: p.titulo, url: p.url, caracteres: p.caracteres, recortado: p.recortado, via: p.via, fecha: p.fecha, enlaces: p.enlaces.slice(0, 15) },
        resumen: `${p.titulo} — ${p.url} (${p.caracteres} caracteres${p.recortado ? ", recortado" : ""}${p.fecha ? ` · fecha de la página ${p.fecha}` : ""}${p.via && p.via !== "simple" ? ` · leída con navegador (${p.via})` : ""})\n\n${p.texto}` };
    } catch (e: any) { return { ok: false, error: `No pude leer ${a.url}: ${e?.message || String(e)}` }; }
  },
};

export const webVerificar: DefTool = {
  nombre: "web_verificar", modulo: MODULO,
  descripcion: "Respuesta ACTUALIZADA y con fuentes citadas para un dato que cambia: precios (de modelos, servicios, planes), versiones, si algo ya salió o sigue vigente, quién es X hoy, o para comprobar una afirmación. Usa la búsqueda de Claude (cuesta ~1 centavo por búsqueda; hay tope diario). Devuelve la respuesta, las citas y las fechas.",
  parametros: { type: "object", properties: {
    pregunta: { type: "string", minLength: 5, description: "La pregunta o la afirmación a comprobar, concreta (p. ej. 'precio actual por millón de tokens de Claude Haiku 5.5')." },
    dominios: { type: "array", items: { type: "string" }, description: "Solo buscar en estos dominios (p. ej. la página oficial: anthropic.com, railway.com)." },
    busquedas: { type: "integer", minimum: 1, maximum: 5, description: "Máximo de búsquedas (por defecto 3)." },
  }, required: ["pregunta"] },
  riesgo: "lectura", requiereAprobacion: false, timeoutSeg: 120,
  async ejecutar(a, ctx) {
    try {
      const r = await buscarConClaude(a.pregunta, { maxUsos: a.busquedas || 3, dominios: a.dominios, agenteId: ctx?.agenteId ?? null });
      const fuentes = [...new Map(r.citas.map((c) => [c.url, c])).values()].slice(0, 6);
      const fecha = (u: string) => r.resultados.find((x) => x.url === u)?.fecha;
      return { ok: true, datos: r, resumen: `${r.respuesta || "(sin respuesta)"}\n\nFuentes:\n${(fuentes.length ? fuentes : r.resultados.slice(0, 5).map((x) => ({ url: x.url, titulo: x.titulo, texto: "" }))).map((c) => `• ${c.titulo || c.url} — ${c.url}${fecha(c.url) ? ` [${fecha(c.url)}]` : ""}`).join("\n")}\n(${r.busquedas} búsqueda(s) · US$${r.costoUsd.toFixed(3)})` };
    } catch (e: any) {
      if (e instanceof ErrorBuscador) return { ok: false, error: `${e.message} Usa web_buscar + web_leer de la página oficial.` };
      return { ok: false, error: `La búsqueda de Claude falló: ${e?.message || e}. Usa web_buscar + web_leer.` };
    }
  },
};

export const webEstado: DefTool = {
  nombre: "web_estado", modulo: MODULO,
  descripcion: "Cómo está el buscador: qué motores están arriba (SearXNG, Lightpanda, Claude, respaldo), cuántas búsquedas van hoy y cuánto ha costado en el mes.",
  parametros: { type: "object", properties: {} },
  riesgo: "lectura", requiereAprobacion: false, timeoutSeg: 30,
  async ejecutar() {
    const e = await estadoMotores();
    const uso = (m: string) => e.uso.find((u) => u.motor === m);
    const c = uso("claude");
    return { ok: true, datos: e, resumen: [
      `🔎 SearXNG: ${e.searx ? "🟢 arriba" : "⚪ apagado (docker compose -f scripts/soga/docker-compose.yml up -d)"}${uso("searxng") ? ` · ${uso("searxng")!.n} hoy` : ""}`,
      `🐼 Lightpanda: ${e.lightpanda ? "🟢 arriba" : "⚪ apagado (uso Chromium para páginas con JavaScript)"}`,
      `🤖 Búsqueda de Claude: ${e.claude ? `🟢 ${c?.n || 0}/${e.topeClaude} hoy` : "⚪ apagada"}${e.brave ? " · Brave API 🟢" : ""}`,
      `🆓 Respaldo (DuckDuckGo/Bing): ${uso("respaldo")?.n || 0} hoy${uso("respaldo")?.fallos ? ` · ${uso("respaldo")!.fallos} fallos` : ""}`,
      `💵 Costo de búsquedas este mes: US$${e.costoMes.toFixed(2)}`,
    ].join("\n") };
  },
};

export const toolsWeb = [webBuscar, webLeer, webVerificar, webEstado];
