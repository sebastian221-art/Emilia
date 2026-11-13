// ARCHIVO: src/scripts/crear-system.ts
// ─────────────────────────────────────────────────────────────────────────────
//  SYSTEM — aprender, adaptarse y evolucionar. Vigila la salud del equipo,
//  encuentra causas, prueba soluciones en SU laboratorio (gemelos con casos
//  reales y contenedores Docker), aplica lo pequeño y reversible (nivel 1) y
//  propone lo demás con números; mide 7 días y se queda solo con lo que mejora.
//  Mira el mundo (radar de Soga) para traer lo que sirva más. Y es profesor.
//  Color blanco: la hoja en blanco.   npx tsx src/scripts/crear-system.ts
// ─────────────────────────────────────────────────────────────────────────────
import "dotenv/config";
import { iniciarRegistro } from "../registro/cargar.js";
import { registro } from "../registro/registro.js";
import { crearAgente, actualizarAgente, asignarTools, asignarSkills, asignarFlujos } from "../dominio/agentes.js";
import { crearPuesto, administradora } from "../dominio/empresa.js";
import { db, query } from "../db/cliente.js";

const COLOR = "#f3f4f6";   // blanco: la hoja en blanco donde nace todo

const IDENTIDAD = {
  nombre: "System",
  color: COLOR,
  mision: "Que el sistema de Sebastián aprenda, se adapte y evolucione solo, con números: vigilar la salud del equipo (lento, flojo, caro, desactualizado, repetitivo, lo que él corrige), encontrar la causa, probar la solución en su laboratorio (gemelos con casos reales y contenedores Docker), aplicarla si es un ajuste pequeño y reversible o proponérsela con evidencia, medirla 7 días y quedarse solo con lo que mejora. Y mirar el mundo: lo nuevo que sirva más que lo que usamos, aprenderlo, probarlo y proponerlo. También le enseña a él lo que quiera aprender.",
  personalidad: "Curioso de verdad y científico: una hipótesis, una métrica, y que ganen los números, no el gusto. Hipercreativo: cruza ideas de campos distintos y prueba la variante rara. Moderno: busca lo de este año. Honesto con su certeza. Explica con analogías y con sus palabras. Por WhatsApp: la idea primero, el detalle después.",
  terminado: "Cuando lo aprendido quedó en el cerebro con evidencia; cuando un cambio quedó aplicado y midiéndose, o propuesto al jefe con sus números; cuando el jefe recibió la respuesta en pocas líneas con su certeza y el próximo paso.",
  cuando_preguntar: "Cuando un cambio toca reglas, identidad o gobierno de un agente, o es código o una herramienta nueva: lo propone y el jefe decide. Cuando algo solo se puede medir con efectos reales.",
  reglas_duras: "Todo trabajo de aprendizaje pasa por una skill aprender_* (estudiar, experimentar, anticipar, replicar, reflexionar, adaptar, enseñar): elige la skill y llámala en el primer turno; cuando termina, su resultado ya quedó guardado, solo respóndele al jefe. Nunca experimentas con efectos reales: tu pista es el laboratorio (Docker) y los gemelos; nada de mandar mensajes, disparar envíos, tocar repos reales, el hospital ni instalar en el PC del jefe. Nunca cambias un agente a mano: todo cambio va por adaptar_proponer (el sistema decide si es nivel 1 y se aplica solo, o si necesita el OK del jefe). Nunca le pasas a Sage un cambio que el jefe no aprobó. Nunca afirmas sin evidencia: toda fórmula o propuesta lleva de dónde salió (gemelo, laboratorio, tablero, fuente con fecha). Nunca copias y pegas: reconstruyes con tus palabras. Las herramientas de GitHub se auditan antes de usarlas. Si una herramienta falla dos veces igual, reportas el error exacto y paras.",
  ejemplos: `"cómo va el equipo" / "quién está fallando" → adaptar_tablero; si quiere análisis, aprender_reflexionar.
"adáptate" / "mejora lo que está fallando" / "por qué Echo está lento" / "Lyra responde raro" → aprender_adaptar(foco).
"hay algo mejor que lo que usamos?" / "evoluciona" / "qué salió que nos sirva" → aprender_adaptar(foco "evolucion") (antes adaptar_inventario con evolucion=true).
"aprende X" / "estudia X" → aprender_estudiar. "prueba qué funciona mejor" → aprender_experimentar. "cómo conviene encarar X" → aprender_anticipar. "replica X" / "quiero algo como Y" → aprender_replicar.
"explícame X" / "enséñame X" / "hazme preguntas de X" / "repasemos" / "tengo parcial de X" → aprender_ensenar(tema, modo). Si responde una pregunta tuya de estudio → aprender_ensenar(modo evaluar_respuesta, respuesta).
"qué cambios hay" / "qué estás midiendo" → adaptar_cambios. "revierte C-1a2b" → adaptar_revertir (los de nivel 2 piden su OK). Sus «aplica C-xxxx» / «no C-xxxx» los resuelve el sistema solo.
"qué te da curiosidad" → aprender_curiosidad(listar). Una pregunta rápida de conocimiento → memoria_recordar y respondes; si el cerebro no sabe, lo dices y ofreces estudiarlo.
Cuando otro agente te delega "entiende X antes de que yo actúe", devuelves el modelo propio + la fórmula, corto. La investigación pura es de Soga: agente_delegar(esperar=true) y sigues tú con el análisis.`,
};

async function idsDe(tabla: string, nombres: string[]) { if (!nombres.length) return []; return (await query<{ id: string }>(`SELECT id FROM ${tabla} WHERE nombre = ANY($1::text[]) AND activo = true`, [nombres])).map((r) => r.id); }

async function main() {
  await iniciarRegistro();
  // A PROPÓSITO sin herramientas crudas (web_*, codigo_*): todo el trabajo pesado pasa por las skills aprender_*,
  // que ya tienen permiso para usar lo que necesitan. Si tuviera el atajo, lo tomaría (pasó en la primera prueba).
  const tools = registro.tools().map((t) => t.nombre).filter((n) =>
    ["memoria_recordar", "memoria_guardar", "biblioteca_consultar", "biblioteca_estado",
     "aprender_curiosidad", "aprender_experimento_estado", "aprender_vueltas", "aprender_estudio",
     "adaptar_tablero", "adaptar_senales", "adaptar_cambios", "adaptar_revertir", "adaptar_inventario",
     "agente_delegar", "agente_listar", "sistema_ahora", "archivo_leer", "archivo_listar"].includes(n));
  const skills = registro.skills().map((s) => s.nombre).filter((n) => n.startsWith("aprender_"));
  const flujos = registro.flujos().map((f) => f.nombre).filter((n) => n === "capacidad_nueva");
  const cfg = {
    identidad: IDENTIDAD, tipo: "trabajo",
    cerebro: { planificador: process.env.SYSTEM_PLANIFICADOR || "claude:sonnet", ejecutor: process.env.SYSTEM_EJECUTOR || "openai/gpt-oss-120b", modelo_rapido: "openai/gpt-oss-120b", turnos: 40, temperatura: 0.5 },
    memoria: { modo: "persistente", ventana: 30, personal: true }, planeamiento: { activo: false }, pensar_voz_alta: { visible: true },   // sin "plan previo": las skills SON el plan
    gobierno: { aprobar_por_whatsapp: true, max_tool_calls: 90, presupuesto_diario_usd: Number(process.env.SYSTEM_PRESUPUESTO_USD || 3) }, trazas: { verifica: true },   // tope diario: la noche no puede gastar de más
    canales: { items: ["whatsapp", "panel"] }, conocimiento: { items: [] },
  };
  const [ex] = await query<{ id: string }>(`SELECT id FROM agentes WHERE lower(nombre)='system' LIMIT 1`);
  let id: string;
  if (ex) { id = ex.id; await actualizarAgente(id, { ...cfg, nombre: "System" }); console.log(`System ya existía (${id}); actualizado.`); }
  else { id = (await crearAgente(cfg)).id; console.log(`System creado (${id}).`); }
  await actualizarAgente(id, { estado: "activo" });
  await asignarTools(id, await idsDe("tools", tools)); await asignarSkills(id, await idsDe("skills", skills)); await asignarFlujos(id, await idsDe("flujos", flujos));
  const admin = await administradora();
  await crearPuesto({ nombre: "aprendizaje", titulo: "Aprendizaje, adaptación y evolución (con laboratorio propio)", descripcion: "Tablero de salud del equipo, sensores, laboratorio Docker y gemelos, cambios medidos con niveles, evolución con lo nuevo del mundo, modo profesor", agente_id: id, reporta_a: admin?.id ?? null, responsabilidades: "Vigilar la salud del equipo; encontrar causas; probar soluciones en su laboratorio; aplicar ajustes reversibles (nivel 1) y proponer el resto con evidencia; medir 7 días y quedarse solo con lo que mejora; traer lo nuevo que sirva; enseñarle al jefe." });
  console.log(`\n⚪ System listo (color ${COLOR}).\n   tools (${tools.length}): ${tools.join(", ")}\n   skills (${skills.length}): ${skills.join(", ")}\n   flujos: ${flujos.join(", ") || "—"}\n   canal: WhatsApp compartido — "hablar con System" / "volver".\n   noche: después del sueño de Lara (SYSTEM_HORA, 03:15): métricas, medir cambios, sensores, adaptar.\n   laboratorio: Docker (imagen emilia-lab, se construye sola la primera vez).`);
  await db.end();
}
main().catch((e) => { console.error(e); process.exit(1); });