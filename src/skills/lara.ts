// ARCHIVO: src/skills/lara.ts
// Skills de la guardiana: integrar la bandeja y auditar la red.
import type { DefSkill } from "../registro/tipos.js";

export const bibliotecaIntegrarBandeja: DefSkill = {
  nombre: "biblioteca_integrar_bandeja",
  modulo: "biblioteca",
  descripcion: "La guardiana procesa la bandeja: por cada entrada verifica (fuentes, contradicciones con lo existente, fecha), la integra como nodo con ficha estructurada y conexiones, o la descarta con motivo. Deja la red más completa y confiable.",
  cuandoUsar: "Cuando hay entradas pendientes (cada noche, o cuando el jefe dice 'integrá lo nuevo').",
  parametros: { type: "object", properties: { maximo: { type: "integer", default: 5, minimum: 1, maximum: 20 } }, required: [] },
  riesgo: "escritura", requiereAprobacion: false,
  tools: ["biblioteca_bandeja", "biblioteca_consultar", "biblioteca_integrar", "biblioteca_conectar", "biblioteca_evidenciar", "biblioteca_proponer", "sistema_ahora"],
  maxPasos: 30,
  procedimiento: `Sos la guardiana del conocimiento. Tu criterio: nada entra sin verificar; nada se duplica; todo queda conectado.
1. biblioteca_bandeja(maximo). Si está vacía, terminá con "OK: bandeja vacía".
2. Por cada entrada: (a) biblioteca_consultar con su tema para ver si YA existe un nodo equivalente o relacionado. (b) Leé el contenido con ojo crítico: ¿tiene fuentes? ¿es reciente? ¿contradice algo existente? ¿es opinión o hecho?
3. Decidí: 
   - Si es nuevo y sólido → biblioteca_integrar con slug nuevo, tipo correcto, resumen de 1-3 líneas, ficha estructurada (que_es, como_funciona, para_que, cuando_usar, cuando_no, trampas, formula si la hay, preguntas_abiertas), estado "probable" (o "verificado" solo si hay 2+ fuentes independientes y confiables), etiquetas, y conexiones a nodos existentes (usa, es_parte_de, depende_de, compite_con, relacionado_con).
   - Si ya existe un nodo equivalente → biblioteca_integrar con ESE slug (actualiza y suma evidencias), nunca uno nuevo.
   - Si contradice algo existente → integrá igual y biblioteca_evidenciar en el nodo existente con resultado "contradice"; si la contradicción es seria, biblioteca_proponer tipo "marcar" (dudoso) con el motivo.
   - Si es basura, duplicado exacto o sin valor → biblioteca_integrar con descartar=true y nota del motivo.
4. Al final, resumí: cuántas integradas, actualizadas, descartadas, propuestas al jefe, y qué quedó con dudas.`,
};

export const bibliotecaAuditar: DefSkill = {
  nombre: "biblioteca_auditar",
  modulo: "biblioteca",
  descripcion: "La guardiana revisa la salud de la red: nodos sin conexiones, sin evidencias, contradicciones, duplicados por significado, y lo que envejeció. Propone al jefe fusiones, borrados y refrescos.",
  cuandoUsar: "Periódicamente (semanal) o cuando el jefe pide 'revisá la biblioteca'.",
  parametros: { type: "object", properties: { envejecer: { type: "boolean", default: true } }, required: [] },
  riesgo: "escritura", requiereAprobacion: false,
  tools: ["biblioteca_estado", "biblioteca_consultar", "biblioteca_proponer", "biblioteca_conectar", "sistema_ahora"],
  maxPasos: 25,
  procedimiento: `1. biblioteca_estado(envejecer) para el panorama.
2. Buscá duplicados: elegí 5-8 temas amplios de la biblioteca (tecnologías, proyectos, lecciones) y biblioteca_consultar cada uno; si dos nodos distintos hablan de lo mismo, biblioteca_proponer tipo "fusionar" (slug el que mejor está, slug2 el que se absorbe) con motivo.
3. Nodos huérfanos: si en las consultas ves nodos sin conexiones que claramente se relacionan con otros, biblioteca_conectar directamente (eso no necesita al jefe).
4. Dudosos/contradichos: para cada uno, decidí si proponer "refrescar" (que Soga lo investigue de nuevo) o "borrar" si ya no sirve.
5. Resumí al jefe: salud de la red, qué conectaste, y las propuestas que le dejaste para aprobar.`,
};

export const skillsLara: DefSkill[] = [bibliotecaIntegrarBandeja, bibliotecaAuditar];