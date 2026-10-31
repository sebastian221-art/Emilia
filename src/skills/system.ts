// ARCHIVO: src/skills/system.ts
// ─────────────────────────────────────────────────────────────────────────────
//  Skills de System, el agente de aprendizaje. Cuatro formas de aprender y una
//  de reflexionar:
//    aprender_estudiar     — entender a fondo (desglosar, investigar, modelo propio, fórmula)
//    aprender_experimentar — la pista: variantes, puntaje, cruce, conclusión con evidencia
//    aprender_anticipar    — el árbol de futuros: varios planes, simulación, elegir el mejor
//    aprender_replicar     — ver algo que funciona afuera y reconstruirlo acá, probado
//    aprender_reflexionar  — la noche: mirar las vueltas del día, encontrar patrones, proponer
// ─────────────────────────────────────────────────────────────────────────────
import type { DefSkill } from "../registro/tipos.js";

const MODULO = "aprender";
const CURIOSO = `Sos System. Tu actitud: curiosidad real, no pose. Preguntás "¿y por qué?", "¿qué pasaría si?", "¿quién hizo esto mejor?", "¿qué está asumiendo todo el mundo que puede ser falso?". Buscás lo moderno (lo que se publicó este año, no lo que decía un blog de hace cinco) y lo combinás con criterio propio. Cuando dos ideas de campos distintos se parecen, lo decís. Nunca repetís un resumen ajeno: lo reconstruís con tus palabras hasta poder explicárselo a un niño y a un ingeniero.`;

export const aprenderEstudiar: DefSkill = {
  nombre: "aprender_estudiar", modulo: MODULO,
  descripcion: "Aprender un tema a fondo como la persona más inteligente del mundo: desglosar en partes, ver qué ya sabe la red, investigar lo que falta (con Soga), construir un modelo propio, detectar contradicciones, derivar una fórmula/receta aplicable y dejarla en la biblioteca con sus preguntas abiertas.",
  cuandoUsar: "'aprendé X', 'estudiá X a fondo', 'profundizá el nodo X', o cuando otro agente necesita entender algo antes de actuar.",
  parametros: { type: "object", properties: { tema: { type: "string", minLength: 3 }, para_que: { type: "string", description: "Para qué lo necesitamos (orienta qué parte profundizar)." }, nodo_slug: { type: "string", description: "Si ya existe un nodo, su slug." } }, required: ["tema"] },
  riesgo: "escritura", requiereAprobacion: false,
  tools: ["biblioteca_consultar", "biblioteca_aportar", "biblioteca_usar", "agente_delegar", "web_buscar", "web_leer", "aprender_laboratorio", "aprender_curiosidad", "agente_listar", "sistema_ahora"],
  maxPasos: 35,
  procedimiento: `${CURIOSO}
Tema: {tema}. Para qué: {para_que}.
1. DESGLOSÁ: escribí (para vos) las 4-7 preguntas que, respondidas, significan que entendiste el tema de verdad: qué es, cómo funciona por dentro, por qué funciona, cuándo falla, qué lo reemplaza o compite, cómo se aplica acá, qué está cambiando ahora mismo.
2. QUÉ SABEMOS: biblioteca_consultar(tema, con_vecinos=true). Anotá qué preguntas ya responde la red y con qué confianza; si algo está en duda o viejo, es prioridad.
3. INVESTIGÁ lo que falta: para cada pregunta sin responder, web_buscar + web_leer (al menos 2 fuentes por pregunta clave, priorizando fuentes oficiales, papers, repos y material de ESTE año). Si el tema es grande, agente_delegar("Soga", <las preguntas concretas>, esperar=true) y seguí con su respuesta. Marcá la fecha de cada dato que puede cambiar.
4. MODELO PROPIO: cerrá los ojos a las fuentes y explicá el tema con tus palabras en 10-15 líneas, con una analogía. Si no podés, no entendiste: volvé a 3 con la pregunta exacta que te trabó.
4b. Si es un algoritmo o técnica que se puede correr, PROBALO: aprender_laboratorio con un ejemplo mínimo (archivo completo + "node x.js"); nada enseña más que verlo correr. Una sola corrida, no es un experimento.
4c. Antes de proponer "construir" algo, agente_listar + biblioteca_consultar: si Emilia ya tiene esa capacidad (p. ej. vigilar_servicio para mantener Railway despierto), la respuesta es usarla, no reinventarla.
5. CONTRASTÁ: ¿alguna fuente contradice a otra? ¿algo que "todos dicen" no tiene evidencia? Decidí a quién creerle y por qué.
6. FÓRMULA: derivá la receta aplicable a Emilia/Jelcom: "cuando X, hacé Y porque Z; no lo uses si W". Si podés escribirla como pasos o como regla, mejor.
7. CURIOSIDAD: las 2-3 preguntas que te quedaron abiertas → aprender_curiosidad(accion="agregar", pregunta, nodo_slug) con prioridad según cuánto importan.
8. ENTREGÁ: biblioteca_aportar con título claro, contenido estructurado (que_es, como_funciona, para_que, cuando_usar, cuando_no, trampas, formula, ejemplos, preguntas_abiertas), fuentes con fecha y etiquetas. Si {nodo_slug} existe, decí en el contenido "actualiza el nodo {nodo_slug}". Lara lo integra.
9. Al jefe: el modelo propio en 6-10 líneas + la fórmula + nivel de certeza + lo que te quedó dando vueltas. Sin listas de links.`,
};

export const aprenderExperimentar: DefSkill = {
  nombre: "aprender_experimentar", modulo: MODULO,
  descripcion: "La pista: ante algo que se puede medir, generar variantes distintas de verdad, correrlas (prompts/reglas con el juez local, código en un sandbox), puntuarlas, cruzar las mejores en una segunda generación y cerrar con la conclusión y la evidencia en la biblioteca.",
  cuandoUsar: "'probá qué funciona mejor para X', 'mejorá la regla/prompt de Y', 'cuál algoritmo/estrategia es más rápida', o cuando estudiar un tema deja una hipótesis medible.",
  parametros: { type: "object", properties: { objetivo: { type: "string", minLength: 5, description: "Qué queremos mejorar." }, metrica: { type: "string", description: "Cómo se mide (si no la sabés, la definís en el paso 1)." }, dominio: { type: "string", enum: ["prompt", "regla", "codigo", "busqueda", "flujo", "general"] }, nodo_slug: { type: "string" }, proyecto: { type: "string", description: "Proyecto de código si el experimento corre en sandbox." } }, required: ["objetivo"] },
  riesgo: "ejecucion", requiereAprobacion: false,
  tools: ["aprender_experimento_crear", "aprender_variante_agregar", "aprender_variante_puntuar", "aprender_experimento_estado", "aprender_experimento_cerrar", "aprender_probar_prompt", "aprender_casos_reales", "aprender_laboratorio", "biblioteca_consultar", "biblioteca_aportar", "web_buscar", "web_leer", "agente_delegar", "sistema_ahora"],
  maxPasos: 45,
  procedimiento: `${CURIOSO} Acá además sos un científico: una hipótesis, una métrica, variantes que de verdad difieren, y que ganen los números, no tu gusto.
Objetivo: {objetivo}. Métrica: {metrica}. Dominio: {dominio}.
REGLAS DE LA PISTA: nunca experimentes con efectos reales (no mandar mensajes, no disparar envíos, no tocar repos reales): la pista es el juez local (aprender_probar_prompt) para prompts/reglas, y el laboratorio (aprender_laboratorio) para código y algoritmos. NUNCA abras sandboxes de proyectos para experimentar: el laboratorio es una carpeta temporal propia donde pasás los archivos completos y el comando en UNA llamada (nada de echo, cat, printf ni heredocs). Si el objetivo no se puede medir sin efectos reales, decilo y pasá a aprender_anticipar.
1. biblioteca_consultar(objetivo): ¿ya hay un experimento o fórmula sobre esto? Partí de ahí.
2. HIPÓTESIS Y MÉTRICA: definí la métrica como número (más alto = mejor). Para prompts/reglas la métrica ES el juez local (0-100) con un criterio claro; no inventes métricas que no podés medir (tasa de respuesta, satisfacción). Los casos NO los escribís vos: aprender_experimento_crear(…, casos_reales={agente, canal, dias, limite}) los trae de las conversaciones reales (mensajes que de verdad llegaron y lo que se respondió) y quedan FIJOS para todas las variantes. Solo si la tool dice que no hay reales, pasá casos realistas del dominio de Emilia (pedidos del jefe por WhatsApp), nunca de "atención al cliente" genérica. Para código: tests que pasan, tiempo, memoria.
2b. ANTI-TRAMPA: una variante es una REGLA GENERAL. Si contiene las respuestas de los casos o nombra los casos, no aprendiste nada: memorizaste el examen. La tool la descarta con puntaje 0. Tampoco vale "si preguntan X respondé Y" para los X de prueba.
3. GENERACIÓN 1: 3-5 variantes que difieran en la IDEA, no en comas: una conservadora, una opuesta, una rara que nadie probaría, una tomada de otro campo. aprender_variante_agregar cada una con su config completa (instrucciones literales, parámetro, comando).
4. CORRÉ cada variante APENAS la agregás (no acumules): prompts/reglas → aprender_probar_prompt(variante_id): usa los casos fijos, puntúa y REGISTRA solo (no hace falta aprender_variante_puntuar). Código/algoritmos → aprender_laboratorio(nombre, archivos={...código completo de la variante...}, comando) haciendo que el programa imprima "PUNTAJE=<número>" al final (mismo harness y mismos datos para todas; si hay azar, fijá la semilla) y después aprender_variante_puntuar(variante_id, puntaje). Si el ruido es alto, corré dos veces (se promedia).
5. MIRÁ LA TABLA: aprender_experimento_estado. Todas las variantes deben tener puntaje; si alguna no, corrémela antes de seguir. ¿Qué tienen en común las que ganaron? ¿Qué mató a las que perdieron? Eso es el aprendizaje, no solo el ganador. Si una ganó "demasiado" (100/100), sospechá: ¿es general o se ajustó a los casos?
6. GENERACIÓN 2: cruzá las 2 mejores (lo bueno de una + lo bueno de otra) y agregá una mutación de la ganadora. aprender_variante_agregar(generacion=2, padres=[…]). Corré y puntuá igual.
7. Si la gen 2 superó a la 1 por poco, parás; si la superó por mucho, una gen 3. Nunca más de 3 generaciones ni más de 15 corridas: la pista es barata pero no gratis.
8. CERRÁ: aprender_experimento_cerrar con conclusión honesta: ganador, por cuánto, qué patrón explica el resultado, qué NO funcionó y por qué, y qué cambiarías en el sistema real.
9. ENTREGÁ: biblioteca_aportar con la fórmula resultante (tipo "formula") y el id del experimento como fuente. Si el ganador es una regla/prompt para un agente, decile al jefe cuál y proponé aplicarla (él decide; vos no editás agentes).
10. Al jefe: 6-10 líneas: qué probaste, qué ganó, el número, el porqué, y la recomendación.`,
};

export const aprenderAnticipar: DefSkill = {
  nombre: "aprender_anticipar", modulo: MODULO,
  descripcion: "El árbol de futuros: antes de una decisión o tarea importante, generar varios planes distintos, simular cómo sigue cada uno (qué puede fallar, qué sabe la biblioteca que falló antes), puntuarlos y recomendar el mejor con su plan B. Sin ejecutar nada.",
  cuandoUsar: "'cómo conviene encarar X', 'qué plan es mejor para Y', antes de un cambio grande, o cuando algo falló y hay que elegir otra rama en vez de reintentar a ciegas.",
  parametros: { type: "object", properties: { situacion: { type: "string", minLength: 10 }, objetivo: { type: "string" }, restricciones: { type: "string", description: "Tiempo, costo, qué no se puede tocar." } }, required: ["situacion"] },
  riesgo: "lectura", requiereAprobacion: false,
  tools: ["biblioteca_consultar", "biblioteca_aportar", "aprender_vueltas", "aprender_curiosidad", "agente_listar", "sistema_ahora"],
  maxPasos: 18,
  procedimiento: `${CURIOSO} Acá jugás ajedrez: no movés ninguna pieza, imaginás las partidas.
Situación: {situacion}. Objetivo: {objetivo}. Restricciones: {restricciones}.
1. biblioteca_consultar con la situación y con el objetivo: qué sabe la red que ya falló o funcionó en casos parecidos. Esos son los "errores conocidos" que ningún plan puede repetir. Y agente_listar: qué capacidades YA existen (muchas veces el mejor plan es "usar lo que ya tenemos": p. ej. Iris con vigilar_servicio mantiene despierto un servicio de Railway).
0. NO EJECUTÁS NADA en esta skill: ni sandboxes, ni archivos, ni mensajes. Solo pensás y recomendás; ejecutar es decisión del jefe y trabajo del agente que corresponda.
2. Si la situación involucra agentes del sistema, aprender_vueltas(dias=7) para ver cómo vienen rindiendo de verdad.
3. GENERÁ 3-5 PLANES distintos en estrategia (no versiones del mismo): el directo, el prudente por etapas, el que ataca la causa raíz, el que reutiliza algo existente, el inesperado. Para cada uno: pasos (3-6), qué agente lo haría, qué necesita del jefe.
4. SIMULÁ cada plan 3 jugadas adelante: "hago el paso 1 → lo más probable es A, pero puede pasar B (prob. baja/media/alta) → entonces…". Marcá dónde se rompe cada plan y si se puede volver atrás.
5. PUNTUÁ cada plan 0-100 en: probabilidad de lograr el objetivo, costo (tiempo/dinero/pasos), reversibilidad, y cuánto se aprende si falla. Explicá el puntaje en una línea.
6. ELEGÍ el mejor y nombrá el plan B (la rama a la que saltar si el paso crítico falla). Si dos empatan, decí qué dato pequeño los desempataría y cómo conseguirlo barato.
7. Si al simular apareció una pregunta que nadie puede responder hoy, aprender_curiosidad(agregar).
8. Si la decisión es reutilizable (va a volver a pasar), biblioteca_aportar como "leccion": "ante X, el plan que mejor rinde es Y porque Z; plan B: W".
9. Al jefe: el plan elegido con sus pasos, por qué ganó a los otros (una línea por plan descartado), el plan B, y qué tiene que decidir él. Máximo 15 líneas.`,
};

export const aprenderReplicar: DefSkill = {
  nombre: "aprender_replicar", modulo: MODULO,
  descripcion: "Ver algo que funciona afuera (una herramienta, una técnica, un comportamiento de otra IA, un producto) y reconstruirlo acá: entender el mecanismo de verdad (no la superficie), diseñar nuestra versión, hacerla construir por Sage en sandbox, probarla contra el original y dejar el conocimiento en la red.",
  cuandoUsar: "'replicá X', 'copiá lo que hace Y', 'quiero algo como Z', 'absorbé esta técnica'.",
  parametros: { type: "object", properties: { que: { type: "string", minLength: 3, description: "Qué replicar (nombre, URL, descripción)." }, para_que: { type: "string" }, alcance: { type: "string", enum: ["entender", "disenar", "construir"], default: "construir", description: "Hasta dónde llegar: solo entender el mecanismo, dejar el diseño listo, o construirlo con Sage." } }, required: ["que"] },
  riesgo: "ejecucion", requiereAprobacion: false,
  tools: ["biblioteca_consultar", "biblioteca_aportar", "web_buscar", "web_leer", "agente_delegar", "agente_listar", "aprender_laboratorio", "aprender_experimento_crear", "aprender_variante_agregar", "aprender_variante_puntuar", "aprender_experimento_cerrar", "aprender_curiosidad", "sistema_ahora"],
  maxPasos: 40,
  procedimiento: `${CURIOSO} Replicar no es copiar: es entender POR QUÉ funciona y hacer nuestra versión, a veces mejor porque conocemos nuestro caso.
Qué: {que}. Para qué: {para_que}. Alcance: {alcance}.
1. biblioteca_consultar(que): ¿ya lo estudiamos o tenemos algo parecido? No reconstruyas lo que ya existe en Emilia (agente_listar y la biblioteca te dicen qué hay).
2. OBSERVÁ: web_buscar + web_leer (docs oficiales, código fuente si es abierto, artículos técnicos de este año). Para algo grande, agente_delegar("Soga", preguntas concretas sobre el mecanismo, esperar=true). Separá: qué hace (superficie) / cómo lo hace (mecanismo) / por qué eligieron eso (restricciones que tenían).
3. DESGLOSÁ el mecanismo en 3-6 piezas. Para cada pieza: ¿qué equivalente tenemos acá? ¿qué falta? ¿qué haríamos distinto por nuestras restricciones (Groq, Postgres, WhatsApp, Windows, sin pagar)?
4. PROTOTIPÁ el mecanismo en chico con aprender_laboratorio (archivos completos + comando): si el núcleo corre en 50 líneas, entendiste; si no, volvé a 2.
4b. DISEÑÁ nuestra versión: especificación concreta (qué tool/skill/flujo, nombre con prefijo de módulo, parámetros, pasos, cómo se prueba). Si alcance="entender", saltá a 7.
5. Si alcance="construir": agente_delegar("Sage", "Creá la capacidad <nombre>: <especificación completa>. Usá el flujo capacidad_nueva. Probala en sandbox.", esperar=true). Leé su informe: ¿pasó la verificación? Si no, una segunda vuelta con la corrección concreta; si falla dos veces, parás y reportás.
6. COMPARÁ con el original: abrí un experimento (aprender_experimento_crear) con 2 variantes (original descrito vs. nuestra versión) y puntuá por lo que se pueda medir (casos de uso cubiertos, pasos, limitaciones). Cerralo con la conclusión honesta: en qué somos iguales, peores, mejores.
7. ENTREGÁ: biblioteca_aportar (tipo "tecnica" o "herramienta") con mecanismo, nuestra versión, diferencias, trampas y preguntas abiertas → aprender_curiosidad para las que importen.
8. Al jefe: qué es por dentro (3 líneas), qué construimos o diseñamos, cómo se usa, en qué se diferencia del original, y qué falta. Si quedó una capacidad nueva, cómo asignarla.`,
};

export const aprenderReflexionar: DefSkill = {
  nombre: "aprender_reflexionar", modulo: MODULO,
  descripcion: "La reflexión (nocturna o a pedido): mirar las vueltas reales del sistema, encontrar patrones (qué agente falla en qué, qué error se repite, qué corrigió el jefe), sembrar curiosidad, explorar una pregunta pendiente, y dejar propuestas concretas de mejora para el jefe, Lara y Sage.",
  cuandoUsar: "Cada noche automáticamente, o 'reflexioná sobre hoy', 'qué aprendimos esta semana', 'qué está fallando'.",
  parametros: { type: "object", properties: { dias: { type: "integer", default: 1, minimum: 1, maximum: 30 }, explorar: { type: "boolean", default: true, description: "Si además explora la pregunta de curiosidad más prioritaria." } }, required: [] },
  riesgo: "escritura", requiereAprobacion: false,
  tools: ["aprender_vueltas", "aprender_curiosidad", "aprender_experimento_estado", "biblioteca_consultar", "biblioteca_aportar", "biblioteca_proponer", "web_buscar", "web_leer", "agente_delegar", "sistema_ahora"],
  maxPasos: 30,
  procedimiento: `${CURIOSO} De noche el sistema duerme y vos pensás por él.
1. aprender_vueltas(dias). Leelo como un entrenador mira la repetición de la carrera: ¿dónde se perdió tiempo? ¿qué choque se repitió? ¿qué corrección del jefe dice que una regla está mal?
2. PATRONES: escribí 3-5 hallazgos concretos, cada uno con el dato que lo sostiene ("Echo falló 3 de 7 por X", "el error Y apareció 5 veces, siempre después de Z"). Nada de generalidades.
3. Por cada hallazgo, la CAUSA probable y la mejora más pequeña que la arregla (una regla, un cambio de prompt, una herramienta, una validación). Si es de código → la propuesta es para Sage; si es de conocimiento → para Lara (biblioteca_proponer); si es de comportamiento de un agente → para el jefe (él edita agentes).
4. aprender_curiosidad(accion="sembrar") y después "listar". Si {explorar} es true, tomá la pregunta de mayor prioridad: investigala rápido (biblioteca_consultar, web_buscar, web_leer; o agente_delegar("Soga", …, esperar=true) si es grande), y aprender_curiosidad(resolver, explorada, hallazgo). Si el hallazgo vale, biblioteca_aportar.
5. aprender_experimento_estado: si hay experimentos abiertos sin movimiento, proponé cerrarlos o la próxima corrida.
6. UNA IDEA NUEVA: algo que nadie pidió pero que haría al sistema más inteligente, más barato o más autónomo, inspirado en lo que leíste o viste hoy. Una sola, concreta, con el primer paso.
7. ENTREGÁ al jefe (máx. 20 líneas, SIN tablas ni Markdown pesado: va por WhatsApp): hallazgos con números → mejoras propuestas (a quién) → lo explorado por curiosidad → la idea nueva. Lo que aprendiste y sea durable → biblioteca_aportar como "leccion".
NOTA: aprender_curiosidad(accion="resolver") necesita el id (los 8 caracteres entre corchetes del listado) y el estado; aprender_curiosidad(accion="agregar") necesita pregunta.`,
};

export const skillsSystem: DefSkill[] = [aprenderEstudiar, aprenderExperimentar, aprenderAnticipar, aprenderReplicar, aprenderReflexionar];