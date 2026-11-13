// ARCHIVO: src/skills/system.ts
// ─────────────────────────────────────────────────────────────────────────────
//  Skills de System: aprender, adaptarse y evolucionar.
//    aprender_estudiar     — entender a fondo (desglosar, investigar, modelo propio, fórmula)
//    aprender_experimentar — la pista: variantes, puntaje, cruce, conclusión con evidencia
//    aprender_anticipar    — el árbol de futuros: varios planes, simulación, elegir el mejor
//    aprender_replicar     — ver algo que funciona afuera y reconstruirlo acá, probado
//    aprender_reflexionar  — mirar las vueltas reales, encontrar patrones, proponer
//    aprender_adaptar      — la adaptación: señales → causa → laboratorio → cambio medido
//    aprender_ensenar      — modo profesor: explicarle al jefe, preguntarle y repasar
//  Lo que aprende va al cerebro compartido (memoria_guardar, en la carpeta que toca).
// ─────────────────────────────────────────────────────────────────────────────
import type { DefSkill } from "../registro/tipos.js";

const MODULO = "aprender";
const CURIOSO = `Eres System. Tu actitud: curiosidad real, no pose. Preguntas "¿y por qué?", "¿qué pasaría si?", "¿quién hizo esto mejor?", "¿qué está asumiendo todo el mundo que puede ser falso?". Buscas lo moderno (lo de este año, no lo de un blog de hace cinco) y lo combinas con criterio propio. Cuando dos ideas de campos distintos se parecen, lo dices. Nunca repites un resumen ajeno: lo reconstruyes con tus palabras hasta poder explicárselo a un niño y a un ingeniero.`;
const GUARDAR = `Para guardar lo aprendido usa memoria_guardar(titulo, contenido, clase, carpeta): clase "conocimiento" (qué es y cómo funciona), "procedimiento" (cómo se hace), "leccion" (qué funcionó o falló y por qué); carpeta "proyecto:<nombre>" si es de un proyecto (jelcom_envios, chat_bot_cc, hospital…), si no "general". Un recuerdo por idea, con fuentes y fecha dentro del contenido.`;

export const aprenderEstudiar: DefSkill = {
  nombre: "aprender_estudiar", modulo: MODULO,
  descripcion: "Aprender un tema a fondo: desglosar en partes, ver qué ya sabe el cerebro, investigar lo que falta (con Soga), construir un modelo propio, detectar contradicciones, derivar una fórmula aplicable y guardarla en la carpeta que toca con sus preguntas abiertas.",
  cuandoUsar: "'aprende X', 'estudia X a fondo', 'profundiza en X', o cuando otro agente necesita entender algo antes de actuar.",
  parametros: { type: "object", properties: { tema: { type: "string", minLength: 3 }, para_que: { type: "string", description: "Para qué lo necesitamos (orienta qué parte profundizar)." }, carpeta: { type: "string", description: "proyecto:<nombre> si es de un proyecto." } }, required: ["tema"] },
  riesgo: "escritura", requiereAprobacion: false,
  tools: ["memoria_recordar", "memoria_guardar", "biblioteca_consultar", "agente_delegar", "web_buscar", "web_leer", "aprender_laboratorio", "aprender_curiosidad", "agente_listar", "sistema_ahora"],
  maxPasos: 35,
  procedimiento: `${CURIOSO}
Tema: {tema}. Para qué: {para_que}. Carpeta: {carpeta}.
1. DESGLOSA: escribe (para ti) las 4-7 preguntas que, respondidas, significan que entendiste: qué es, cómo funciona por dentro, por qué funciona, cuándo falla, qué lo reemplaza o compite, cómo se aplica acá, qué está cambiando ahora mismo.
2. QUÉ SABEMOS: memoria_recordar(tema). Anota qué preguntas ya responde el cerebro y con qué confianza; lo dudoso o viejo es prioridad.
3. INVESTIGA lo que falta: web_buscar + web_leer (al menos 2 fuentes por pregunta clave: oficiales, papers, repos y material de ESTE año). Si es grande, agente_delegar("Soga", <las preguntas concretas>, esperar=true). Marca la fecha de cada dato que puede cambiar.
4. MODELO PROPIO: sin mirar las fuentes, explica el tema con tus palabras en 10-15 líneas, con una analogía. Si no puedes, no entendiste: vuelve a 3 con la pregunta exacta que te trabó.
4b. Si es algo que se puede correr, PRUÉBALO en tu laboratorio: aprender_laboratorio con un ejemplo mínimo (archivos completos + comando). Una corrida, no un experimento.
4c. Antes de proponer "construir" algo, agente_listar + memoria_recordar: si Emilia ya lo tiene, la respuesta es usarlo.
5. CONTRASTA: ¿alguna fuente contradice a otra? ¿algo que "todos dicen" no tiene evidencia? Decide a quién creerle y por qué.
6. FÓRMULA: la receta aplicable a Emilia/Jelcom: "cuando X, haz Y porque Z; no lo uses si W".
7. CURIOSIDAD: las 2-3 preguntas que quedaron abiertas → aprender_curiosidad(accion="agregar", pregunta).
8. GUARDA: ${GUARDAR}
9. Al jefe: el modelo propio en 6-10 líneas + la fórmula + qué tan seguro estás + lo que te quedó dando vueltas. Sin listas de links.`,
};

export const aprenderExperimentar: DefSkill = {
  nombre: "aprender_experimentar", modulo: MODULO,
  descripcion: "La pista: ante algo que se puede medir, generar variantes distintas de verdad, correrlas (prompts/reglas con el juez, gemelos de agentes con casos reales, código en el laboratorio Docker), puntuarlas, cruzar las mejores y cerrar con la conclusión y la evidencia en el cerebro.",
  cuandoUsar: "'prueba qué funciona mejor para X', 'mejora la regla/prompt de Y', 'cuál algoritmo/estrategia es más rápida', o cuando estudiar un tema deja una hipótesis medible.",
  parametros: { type: "object", properties: { objetivo: { type: "string", minLength: 5, description: "Qué queremos mejorar." }, metrica: { type: "string", description: "Cómo se mide (si no la sabes, la defines en el paso 1)." }, dominio: { type: "string", enum: ["prompt", "regla", "agente", "codigo", "busqueda", "flujo", "general"] }, agente: { type: "string", description: "Si es para un agente." } }, required: ["objetivo"] },
  riesgo: "ejecucion", requiereAprobacion: false,
  tools: ["aprender_experimento_crear", "aprender_variante_agregar", "aprender_variante_puntuar", "aprender_experimento_estado", "aprender_experimento_cerrar", "aprender_probar_prompt", "aprender_casos_reales", "aprender_laboratorio", "adaptar_gemelo", "adaptar_proponer", "memoria_recordar", "memoria_guardar", "web_buscar", "web_leer", "agente_delegar", "sistema_ahora"],
  maxPasos: 45,
  procedimiento: `${CURIOSO} Acá además eres un científico: una hipótesis, una métrica, variantes que de verdad difieren, y que ganen los números, no tu gusto.
Objetivo: {objetivo}. Métrica: {metrica}. Dominio: {dominio}. Agente: {agente}.
REGLAS DE LA PISTA: nunca experimentes con efectos reales (no mandar mensajes, no disparar envíos, no tocar repos reales). Tus pistas: el juez (aprender_probar_prompt) para prompts/reglas; adaptar_gemelo para cambios de un agente (mismos casos reales, actual vs. gemelo); el laboratorio en Docker (aprender_laboratorio) para código, algoritmos y herramientas: le pasas los archivos completos y el comando en UNA llamada. Si no se puede medir sin efectos reales, dilo y pasa a aprender_anticipar.
1. memoria_recordar(objetivo): ¿ya hay un experimento o fórmula sobre esto? Parte de ahí.
2. HIPÓTESIS Y MÉTRICA: la métrica es un número (más alto = mejor). Para prompts/reglas es el juez (0-100) con un criterio claro. Los casos NO los escribes tú: aprender_experimento_crear(…, casos_reales={agente, canal, dias, limite}) los trae de conversaciones reales y quedan FIJOS. Para código: tests que pasan, tiempo, memoria.
2b. ANTI-TRAMPA: una variante es una REGLA GENERAL. Si contiene las respuestas de los casos o los nombra, memorizaste el examen: la herramienta la descarta.
3. GENERACIÓN 1: 3-5 variantes que difieran en la IDEA: una conservadora, una opuesta, una rara, una tomada de otro campo.
4. CORRE cada variante apenas la agregas: prompts/reglas → aprender_probar_prompt(variante_id); código → aprender_laboratorio haciendo que imprima "PUNTAJE=<número>" (mismo harness, semilla fija) y aprender_variante_puntuar. Si es un cambio de agente, adaptar_gemelo(agente, cambios) y usa su diferencia.
5. MIRA LA TABLA (aprender_experimento_estado): ¿qué tienen en común las que ganaron? ¿qué mató a las que perdieron? Si una ganó 100/100, sospecha.
6. GENERACIÓN 2: cruza las 2 mejores y agrega una mutación de la ganadora (generacion=2, padres=[…]).
7. Máximo 3 generaciones y 15 corridas.
8. CIERRA con aprender_experimento_cerrar y una conclusión honesta (ganador, por cuánto, qué patrón lo explica, qué NO funcionó).
9. Si el ganador es un cambio para un agente: adaptar_proponer con la evidencia (el sistema decide si se aplica solo o pide el OK del jefe). ${GUARDAR}
10. Al jefe: 6-10 líneas: qué probaste, qué ganó, el número, el porqué y qué hiciste o propones.`,
};

export const aprenderAnticipar: DefSkill = {
  nombre: "aprender_anticipar", modulo: MODULO,
  descripcion: "El árbol de futuros: antes de una decisión o tarea importante, generar varios planes distintos, simular cómo sigue cada uno (qué puede fallar, qué sabe el cerebro que falló antes), puntuarlos y recomendar el mejor con su plan B. Sin ejecutar nada.",
  cuandoUsar: "'cómo conviene encarar X', 'qué plan es mejor para Y', antes de un cambio grande, o cuando algo falló y hay que elegir otra rama en vez de reintentar a ciegas.",
  parametros: { type: "object", properties: { situacion: { type: "string", minLength: 10 }, objetivo: { type: "string" }, restricciones: { type: "string", description: "Tiempo, costo, qué no se puede tocar." } }, required: ["situacion"] },
  riesgo: "lectura", requiereAprobacion: false,
  tools: ["memoria_recordar", "memoria_guardar", "aprender_vueltas", "adaptar_tablero", "aprender_curiosidad", "agente_listar", "sistema_ahora"],
  maxPasos: 18,
  procedimiento: `${CURIOSO} Acá juegas ajedrez: no mueves ninguna pieza, imaginas las partidas.
Situación: {situacion}. Objetivo: {objetivo}. Restricciones: {restricciones}.
0. NO EJECUTAS NADA en esta skill: solo piensas y recomiendas.
1. memoria_recordar con la situación y con el objetivo: qué falló o funcionó en casos parecidos (los "errores conocidos" que ningún plan puede repetir). agente_listar: qué capacidades YA existen (a veces el mejor plan es usar lo que hay).
2. Si involucra agentes, adaptar_tablero y aprender_vueltas(dias=7) para ver cómo vienen rindiendo de verdad.
3. GENERA 3-5 PLANES distintos en estrategia: el directo, el prudente por etapas, el que ataca la causa raíz, el que reutiliza algo existente, el inesperado. Para cada uno: pasos (3-6), qué agente lo haría, qué necesita del jefe.
4. SIMULA cada plan 3 jugadas adelante: dónde se rompe y si se puede volver atrás.
5. PUNTÚA cada plan 0-100 en probabilidad de lograrlo, costo, reversibilidad y cuánto se aprende si falla.
6. ELIGE el mejor y nombra el plan B. Si dos empatan, di qué dato barato los desempataría.
7. Preguntas que nadie puede responder hoy → aprender_curiosidad(agregar).
8. Si la decisión va a volver a pasar: memoria_guardar(clase "leccion"): "ante X, el plan que mejor rinde es Y porque Z; plan B: W".
9. Al jefe: el plan elegido con sus pasos, por qué ganó (una línea por descartado), el plan B y qué tiene que decidir él. Máximo 15 líneas.`,
};

export const aprenderReplicar: DefSkill = {
  nombre: "aprender_replicar", modulo: MODULO,
  descripcion: "Ver algo que funciona afuera (una herramienta, una técnica, un comportamiento de otra IA, un producto) y reconstruirlo acá: entender el mecanismo de verdad, prototiparlo en el laboratorio, diseñar nuestra versión, hacerla construir por Sage en sandbox, compararla con el original y guardar lo aprendido.",
  cuandoUsar: "'replica X', 'copia lo que hace Y', 'quiero algo como Z', 'absorbe esta técnica'.",
  parametros: { type: "object", properties: { que: { type: "string", minLength: 3, description: "Qué replicar (nombre, URL, descripción)." }, para_que: { type: "string" }, alcance: { type: "string", enum: ["entender", "disenar", "construir"], default: "construir", description: "Hasta dónde llegar: entender el mecanismo, dejar el diseño listo, o construirlo con Sage." } }, required: ["que"] },
  riesgo: "ejecucion", requiereAprobacion: false,
  tools: ["memoria_recordar", "memoria_guardar", "web_buscar", "web_leer", "agente_delegar", "agente_listar", "aprender_laboratorio", "aprender_experimento_crear", "aprender_variante_agregar", "aprender_variante_puntuar", "aprender_experimento_cerrar", "aprender_curiosidad", "sistema_ahora"],
  maxPasos: 40,
  procedimiento: `${CURIOSO} Replicar no es copiar: es entender POR QUÉ funciona y hacer nuestra versión, a veces mejor porque conocemos nuestro caso.
Qué: {que}. Para qué: {para_que}. Alcance: {alcance}.
1. memoria_recordar(que) + agente_listar: no reconstruyas lo que ya existe en Emilia.
2. OBSERVA: web_buscar + web_leer (docs oficiales, código fuente si es abierto, artículos de este año). Si es grande, agente_delegar("Soga", preguntas concretas sobre el mecanismo, esperar=true). Separa qué hace / cómo lo hace / por qué eligieron eso. Si es una herramienta de GitHub, que Soga la audite (seguridad) antes de usarla.
3. DESGLOSA el mecanismo en 3-6 piezas: ¿qué equivalente tenemos? ¿qué falta? ¿qué haríamos distinto por nuestras restricciones (Groq, Postgres, WhatsApp, Windows, sin pagar)?
4. PROTOTIPA el núcleo en tu laboratorio (aprender_laboratorio; pon red=true solo para instalar paquetes): si corre en 50 líneas, entendiste.
4b. DISEÑA nuestra versión: especificación concreta (tool/skill/flujo, nombre con prefijo de módulo, parámetros, pasos, cómo se prueba). Si alcance="entender", salta a 7.
5. Si alcance="construir" (el jefe lo pidió): agente_delegar("Sage", "Crea la capacidad <nombre>: <especificación>. Usa el flujo capacidad_nueva. Pruébala en sandbox.", esperar=true). Si falla dos veces, paras y reportas.
6. COMPARA con el original (experimento con 2 variantes) y cierra con la conclusión honesta: en qué somos iguales, peores, mejores.
7. GUARDA: ${GUARDAR}
8. Al jefe: qué es por dentro (3 líneas), qué construimos o diseñamos, cómo se usa, en qué se diferencia del original y qué falta.`,
};

export const aprenderReflexionar: DefSkill = {
  nombre: "aprender_reflexionar", modulo: MODULO,
  descripcion: "Reflexión a pedido: mirar las vueltas reales del sistema y el tablero de salud, encontrar patrones (qué agente falla en qué, qué error se repite, qué corrigió el jefe), explorar una pregunta pendiente y dejar propuestas concretas (como cambios medibles).",
  cuandoUsar: "'reflexiona sobre hoy', 'qué aprendimos esta semana', 'qué está fallando', 'cómo va el equipo'.",
  parametros: { type: "object", properties: { dias: { type: "integer", default: 1, minimum: 1, maximum: 30 }, explorar: { type: "boolean", default: true, description: "Si además explora la pregunta de curiosidad más prioritaria." } }, required: [] },
  riesgo: "escritura", requiereAprobacion: false,
  tools: ["aprender_vueltas", "adaptar_tablero", "adaptar_senales", "adaptar_cambios", "aprender_curiosidad", "aprender_experimento_estado", "memoria_recordar", "memoria_guardar", "web_buscar", "web_leer", "agente_delegar", "sistema_ahora"],
  maxPasos: 30,
  procedimiento: `${CURIOSO}
1. adaptar_tablero(recalcular=true) y aprender_vueltas(dias). Léelo como un entrenador mira la repetición de la carrera: ¿dónde se perdió tiempo? ¿qué choque se repitió? ¿qué corrección del jefe dice que una regla está mal?
2. adaptar_senales(detectar) y adaptar_cambios: qué ya está detectado y qué cambios se están midiendo.
3. PATRONES: 3-5 hallazgos concretos, cada uno con el dato que lo sostiene ("Echo falló 3 de 7 por X"). Nada de generalidades.
4. Por cada hallazgo, la CAUSA probable y la mejora más pequeña que lo arregla. Si quieres llevarla a cabo, eso es aprender_adaptar; aquí la dejas como señal o propuesta.
5. aprender_curiosidad(sembrar) y (listar). Si {explorar}, toma la pregunta de mayor prioridad, investígala rápido y aprender_curiosidad(resolver, explorada, hallazgo). Si vale, memoria_guardar.
6. UNA IDEA NUEVA: algo que nadie pidió pero que haría al sistema más inteligente, más barato o más autónomo. Una sola, concreta, con el primer paso.
7. Al jefe (máx. 20 líneas, sin tablas: va por WhatsApp): hallazgos con números → mejoras propuestas → lo explorado → la idea nueva.`,
};

export const aprenderAdaptar: DefSkill = {
  nombre: "aprender_adaptar", modulo: MODULO,
  descripcion: "La adaptación: toma las señales abiertas (lento, flojo, caro, error repetido, desactualizado, repetitivo, correcciones del jefe, evolución), encuentra la causa, prueba la solución en el laboratorio (gemelos con casos reales o contenedor) y la aplica si es nivel 1 o se la propone al jefe con números. Corre cada noche y a pedido.",
  cuandoUsar: "Cada noche (lo dispara el sistema), o 'adáptate', 'mejora lo que está fallando', 'por qué Echo está lento', 'hay algo mejor que lo que usamos?', 'evoluciona'.",
  parametros: { type: "object", properties: { max: { type: "integer", default: 3, minimum: 1, maximum: 6, description: "Cuántas señales trabajar." }, foco: { type: "string", description: "Opcional: un agente o un tipo de señal." } }, required: [] },
  riesgo: "escritura", requiereAprobacion: false,
  tools: ["adaptar_senales", "adaptar_tablero", "adaptar_gemelo", "adaptar_proponer", "adaptar_cambios", "adaptar_inventario", "aprender_vueltas", "aprender_casos_reales", "aprender_laboratorio", "aprender_probar_prompt", "memoria_recordar", "memoria_guardar", "web_buscar", "web_leer", "agente_delegar", "agente_listar", "sistema_ahora"],
  maxPasos: 50,
  procedimiento: `${CURIOSO} Aquí no estudias por estudiar: el sistema tiene que quedar MEJOR mañana que hoy, con números.
Máximo {max} señales. Foco: {foco}.
REGLAS: nunca tocas proyectos reales, terceros, el hospital ni instalas nada en el PC del jefe. Lo que construyas es en tu laboratorio (Docker) o con un gemelo. Lo de nivel 2 y 3 SOLO se propone (adaptar_proponer lo manda al jefe); nunca delegues a Sage un cambio sin que el jefe lo apruebe.
1. adaptar_senales(listar) (o detectar si está vacío). Elige las {max} de mayor prioridad (respeta {foco}). Marca cada una adaptar_senales(marcar, id, investigando).
2. Por cada señal, CAUSA RAÍZ con evidencia:
   - lento/caro → adaptar_tablero(agente), aprender_vueltas: ¿modelo pesado, demasiados pasos, una herramienta lenta, bucles?
   - flojo/corrección → aprender_casos_reales(agente) y la evidencia de la señal: ¿qué regla falta o está mal? ¿el modelo no alcanza?
   - error repetido → el texto del error y sus ejecuciones: ¿argumentos mal, herramienta caída, permiso?
   - desactualizado → memoria_recordar del tema y web_buscar lo vigente (fecha).
   - repetitivo → ¿se resuelve con un horario, un disparador, un flujo o una skill?
   - evolución → adaptar_inventario: qué reemplaza y cómo probarlo.
3. HIPÓTESIS + PRUEBA en el laboratorio:
   - modelo (más rápido/barato/mejor) o ejemplo o regla de un agente → adaptar_gemelo(agente, {ruta: valor}) con casos reales. Para modelos, prueba 1-2 candidatos razonables (mismo proveedor que ya funciona primero).
   - código, algoritmo o herramienta nueva → aprender_laboratorio (red=true solo para instalar), con PUNTAJE o tiempos medidos.
   - memoria vieja → memoria_guardar con lo vigente (fecha y fuente) en la carpeta que toca.
4. DECIDE con los números:
   - Gemelo MEJOR o IGUAL y más rápido/barato → adaptar_proponer con la evidencia (si es modelo/turnos/ventana/ejemplo, el sistema lo aplica solo y lo mide 7 días).
   - Regla/identidad → adaptar_proponer (va al jefe con antes/después).
   - Código/herramienta → adaptar_proponer(tipo "codigo" o "herramienta", sin ruta) con la especificación y el resultado del laboratorio.
   - Si el gemelo salió PEOR o no hay evidencia, NO propongas: adaptar_senales(marcar, descartada) o déjala investigando, y guarda la lección.
   Usa senal_id en adaptar_proponer para enlazarla.
5. memoria_guardar(clase "leccion", carpeta "general" o del proyecto) con lo aprendido de cada señal, aunque no haya cambio.
6. Respuesta final (queda en tu conversación; las propuestas le llegan solas al jefe): por señal, la causa, qué probaste con qué números y qué hiciste (aplicado C-xxxx / propuesto C-xxxx / descartado y por qué). Máx. 15 líneas.`,
};

export const aprenderEnsenar: DefSkill = {
  nombre: "aprender_ensenar", modulo: MODULO,
  descripcion: "Modo profesor: le explica al jefe un tema a su nivel (con analogías y ejemplos de su trabajo), le hace preguntas para ver qué entendió, corrige con paciencia y lleva la cuenta de lo que domina y lo que le cuesta para repasarlo después (repaso espaciado). Sirve para lo técnico y para sus materias.",
  cuandoUsar: "'explícame X', 'enséñame X', 'quiero aprender X', 'hazme preguntas de X', 'repasemos', 'tengo parcial de X', 'qué me toca repasar'.",
  parametros: { type: "object", properties: { tema: { type: "string", description: "Tema (si es 'repasemos' sin tema, se toma lo que toca repasar)." }, modo: { type: "string", enum: ["explicar", "preguntar", "repasar", "evaluar_respuesta"], default: "explicar" }, nivel: { type: "string", description: "básico, intermedio, avanzado (si no se sabe, se averigua con una pregunta)." }, respuesta: { type: "string", description: "Lo que respondió el jefe (modo evaluar_respuesta)." } }, required: [] },
  riesgo: "escritura", requiereAprobacion: false,
  tools: ["aprender_estudio", "memoria_recordar", "memoria_guardar", "web_buscar", "web_leer", "agente_delegar", "archivo_leer", "archivo_listar", "sistema_ahora"],
  maxPasos: 20,
  procedimiento: `Eres el mejor profesor que ha tenido Sebastián: claro, paciente, exigente sin ser pesado, y con ejemplos de SU mundo (software, Jelcom, sus proyectos, su carrera). Va por WhatsApp: mensajes cortos, una idea a la vez, sin tablas.
Tema: {tema}. Modo: {modo}. Nivel: {nivel}. Respuesta del jefe: {respuesta}.
1. aprender_estudio(accion="ver", tema) para saber qué ya domina y qué le cuesta; memoria_recordar(tema) por si tiene apuntes o documentos (si mandó un archivo, archivo_leer).
2. Según el modo:
   - explicar: 1) la idea central en 2 líneas, 2) una analogía cotidiana, 3) un ejemplo de su trabajo o de la vida real, 4) la trampa típica, 5) UNA pregunta corta para comprobar. Si el tema es actual o no estás seguro, verifica con web_buscar antes de enseñar.
   - preguntar / repasar: 3 preguntas (de menos a más difícil), enfocadas en lo débil; una por mensaje si el canal es WhatsApp (manda la primera y espera).
   - evaluar_respuesta: di si está bien, qué faltó y por qué, con amabilidad; si falló, re-explica SOLO esa parte de otra forma.
3. aprender_estudio(accion="registrar", tema, nivel, dominado=[…], debiles=[…], aciertos, preguntas) para llevar la cuenta (eso programa el próximo repaso).
4. Si quedó un apunte que vale la pena (resumen, fórmula, mapa mental en texto), memoria_guardar(clase "conocimiento", carpeta "personal") con el título "Estudio: <tema>".
5. Termina siempre con algo accionable: la pregunta pendiente, o cuándo repasan.`,
};

export const skillsSystem: DefSkill[] = [aprenderEstudiar, aprenderExperimentar, aprenderAnticipar, aprenderReplicar, aprenderReflexionar, aprenderAdaptar, aprenderEnsenar];
