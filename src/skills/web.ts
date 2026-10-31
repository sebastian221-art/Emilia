// ARCHIVO: src/skills/web.ts
// ─────────────────────────────────────────────────────────────────────────────
//  SKILL web_investigar — el "buscador que entiende".
//  Dada una pregunta, busca con varias consultas, elige las mejores fuentes,
//  las LEE, contrasta lo que dicen, y responde con criterio: qué es, cómo
//  funciona, qué conviene, con los links recomendados y qué tan seguro está.
//  Lo aprendido se guarda en el conocimiento del agente (biblioteca/…) para
//  que la próxima vez no empiece de cero.
// ─────────────────────────────────────────────────────────────────────────────
import type { DefSkill } from "../registro/tipos.js";

export const webInvestigar: DefSkill = {
  nombre: "web_investigar",
  modulo: "web",
  descripcion: "Investiga en internet una pregunta o tema: busca con varias consultas, lee las fuentes más relevantes (no solo los resúmenes), contrasta, y entrega una respuesta propia con criterio, los links recomendados y el nivel de certeza. Guarda lo aprendido en la biblioteca. Para 'qué es X', 'hay algo nuevo para Y', 'compará A y B', 'cómo funciona Z', 'qué me recomendás para W'.",
  cuandoUsar: "Cuando el jefe pregunta algo que requiere información actual o externa, pide que investigue/busque/averigüe, o quiere recomendaciones con fundamento. No para charla ni para cosas que ya están en su memoria.",
  parametros: {
    type: "object",
    properties: {
      pregunta: { type: "string", minLength: 5, description: "La pregunta o tema, tal como lo dijo el jefe." },
      profundidad: { type: "string", enum: ["rapida", "normal", "profunda"], description: "rapida: 1 búsqueda y 2 fuentes. normal: 2-3 búsquedas y 3-4 fuentes. profunda: 4-5 búsquedas, 6-8 fuentes, contraste explícito.", default: "normal" },
      idioma: { type: "string", description: "Idioma preferido de las fuentes (es, en).", default: "es" },
    },
    required: ["pregunta"],
  },
  riesgo: "lectura",
  requiereAprobacion: false,
  tools: ["web_buscar", "web_leer", "biblioteca_consultar", "biblioteca_aportar", "sistema_ahora"],
  maxPasos: 25,
  procedimiento: `Sos un investigador riguroso. La regla de oro: NUNCA respondas solo con los resúmenes del buscador; LEÉ las fuentes. Y nunca copies y pegues: la respuesta es TUYA, en tus palabras, con lo que entendiste.
1. Mirá primero qué sabe la biblioteca compartida: biblioteca_consultar(pregunta). Si hay un nodo reciente, verificado y suficiente, partí de ahí y solo actualizá lo que falte (y decile al jefe que ya lo sabíamos).
2. Pensá 2-3 consultas distintas para la pregunta (según profundidad): una literal, una en inglés si el tema es técnico (la mayoría de la documentación está en inglés), y una con otro ángulo (ej. "X vs Y", "X 2026", "X open source", "X precio").
3. web_buscar con cada consulta. REGLAS DE FALLO: si una búsqueda dice "BUSCADOR CAÍDO", NO busques más: pasá al paso 7 y respondé con lo que ya sabés, avisando que internet no estuvo disponible y que no tiene fuentes frescas. Si una búsqueda devuelve "no hay resultados", probá UNA sola variante (más corta o en inglés) y seguí con la siguiente consulta; nunca más de 5 búsquedas en total en modo normal (8 en profunda). Elegí las fuentes más confiables y relevantes: documentación oficial, repositorios (GitHub), papers, blogs técnicos reconocidos, medios serios. Desconfiá de páginas de relleno, listas SEO y foros sin fuentes.
4. web_leer las elegidas (2 a 8 según profundidad). Si una página no carga o no sirve, probá la siguiente. Tomá nota de: qué afirma, de cuándo es, y si coincide o contradice a las demás.
5. Contrastá: ¿las fuentes coinciden? ¿hay algo más nuevo que lo demás? ¿qué es opinión y qué es hecho?
6. Aportá lo aprendido a la biblioteca compartida: biblioteca_aportar(titulo = el tema en 2-5 palabras, contenido estructurado: qué es, cómo funciona, para qué, cuándo usar/no, trampas, y la fecha de la información; fuentes = las URLs leídas; etiquetas). La guardiana lo integra en la red.
7. Respondé al jefe. Formato: (a) respuesta directa en 2-6 líneas con criterio ("sí existe, es X, funciona así, lo que te conviene es…"); (b) 3-6 puntos clave si hace falta; (c) "Links recomendados": 2-5 con una línea de por qué cada uno; (d) "Certeza": alta/media/baja y por qué (fuentes coinciden, es reciente, falta info). Si pide recomendación, dala con argumentos, no una lista neutra. Si no encontraste nada sólido, decilo sin inventar.`,
};

export const skillsWeb: DefSkill[] = [webInvestigar];