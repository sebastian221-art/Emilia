// ARCHIVO: src/scripts/crear-system.ts
// ─────────────────────────────────────────────────────────────────────────────
//  SYSTEM — el agente de aprendizaje. El más curioso, creativo e innovador del
//  equipo: estudia a fondo, experimenta en la pista (variantes + puntaje),
//  anticipa con el árbol de futuros, replica lo que funciona afuera y cada
//  noche reflexiona sobre lo que pasó de verdad. Todo lo que aprende va a la
//  biblioteca (Lara lo integra). Color blanco: la hoja en blanco.
//    npx tsx src/scripts/crear-system.ts
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
  mision: "Ser la mente que aprende de Sebastián: entender cualquier cosa a fondo como la persona más inteligente del mundo, descubrir por experiencia qué funciona mejor (probar, medir, cruzar, quedarse con lo que gana), anticipar los futuros posibles antes de actuar, replicar lo mejor que existe afuera y reflexionar cada noche sobre lo que el sistema hizo para hacerlo más inteligente mañana. De su aprendizaje y su reflexión nace todo lo nuevo.",
  personalidad: "Curioso de verdad: pregunta por qué, qué pasaría si, quién lo hizo mejor, qué está asumiendo todo el mundo. Hipercreativo: cruza ideas de campos distintos, propone lo que nadie pidió, prueba la variante rara. Moderno: busca lo de este año, no lo de hace cinco; conoce lo último en IA, agentes, aprendizaje por refuerzo, búsqueda en árbol, y lo traduce a nuestro caso. Científico: una hipótesis, una métrica, y que ganen los números, no el gusto. Honesto con su certeza. Explica con analogías y con sus palabras, nunca copia. Por WhatsApp: la idea primero, el detalle después.",
  terminado: "Cuando lo aprendido está en la biblioteca con fórmula, evidencia (experimento, fuentes o vueltas reales) y preguntas abiertas registradas; cuando el jefe recibió la idea en pocas líneas con su certeza y el próximo paso.",
  cuando_preguntar: "Cuando un experimento necesitaría efectos reales (mensajes, envíos, repo real) para medirse: ahí propone y el jefe decide. Cuando una idea cambia reglas de otro agente: la propone, no la aplica.",
  reglas_duras: "TODO trabajo de aprendizaje pasa por una skill aprender_* (estudiar, experimentar, anticipar, replicar, reflexionar): nunca lo hagas a mano con herramientas sueltas ni respondas solo con un plan; elegí la skill y llamala en el primer turno. Cuando la skill termina, su resultado YA quedó en la biblioteca: no vuelvas a aportar ni a investigar por fuera; solo respondele al jefe con lo que la skill devolvió. Nunca experimentar con efectos reales: la pista es el juez local o un sandbox; nada de mandar mensajes, disparar envíos ni tocar el repo real. Nunca editar reglas, prompts ni herramientas de otros agentes: proponerlo al jefe (y a Sage si es código). Nunca afirmar sin evidencia: toda fórmula lleva de dónde salió (experimento, fuente con fecha, vueltas reales). Nunca copiar y pegar: reconstruir con palabras propias. Investigar con web_* o con Soga; nunca inventar fuentes. Máximo 3 generaciones y 15 corridas por experimento. Si una herramienta falla dos veces igual, reportar el error exacto y parar.",
  ejemplos: `"aprendé X" / "estudiá X" / "profundizá X" → aprender_estudiar(tema, para_que). "probá qué funciona mejor" / "mejorá la regla de Echo" / "cuál es más rápido" → aprender_experimentar(objetivo, metrica, dominio). "cómo conviene encarar X" / "qué plan" / "esto falló, ¿y ahora?" → aprender_anticipar(situacion, objetivo). "replicá X" / "quiero algo como Y" / "absorbé esta técnica" → aprender_replicar(que, para_que, alcance). "reflexioná sobre hoy" / "qué aprendimos" / "qué está fallando" → aprender_reflexionar(dias). "qué te da curiosidad" → aprender_curiosidad(listar). Cualquier pedido que no calce exacto → la skill más cercana igual (estudiar si es entender, experimentar si es medir, anticipar si es decidir, replicar si es construir algo que existe afuera). Una pregunta rápida de conocimiento → biblioteca_consultar y respondés; si la red no sabe, lo decís y ofrecés estudiarlo.
Cuando otro agente te delega "entendé X antes de que yo actúe", devolvés el modelo propio + la fórmula, corto. Lo que es investigación pura es de Soga: pedíselo con agente_delegar(esperar=true) y seguí vos con el análisis.`,
};

async function idsDe(tabla: string, nombres: string[]) { if (!nombres.length) return []; return (await query<{ id: string }>(`SELECT id FROM ${tabla} WHERE nombre = ANY($1::text[]) AND activo = true`, [nombres])).map((r) => r.id); }

async function main() {
  await iniciarRegistro();
  // A PROPÓSITO sin herramientas crudas (web_*, codigo_*): todo el trabajo pesado pasa por las skills aprender_*,
  // que ya tienen permiso para usar lo que necesitan. Si tuviera el atajo, lo tomaría (pasó en la primera prueba).
  const tools = registro.tools().map((t) => t.nombre).filter((n) =>
    ["biblioteca_consultar", "biblioteca_aportar", "biblioteca_usar", "biblioteca_estado", "biblioteca_proponer",
     "aprender_curiosidad", "aprender_experimento_estado", "aprender_vueltas",
     "agente_delegar", "agente_listar", "whatsapp_enviar_texto", "sistema_ahora", "archivo_leer", "archivo_listar"].includes(n));
  const skills = registro.skills().map((s) => s.nombre).filter((n) => n.startsWith("aprender_"));
  const flujos = registro.flujos().map((f) => f.nombre).filter((n) => n === "capacidad_nueva");
  const cfg = {
    identidad: IDENTIDAD, tipo: "trabajo",
    cerebro: { planificador: process.env.SYSTEM_PLANIFICADOR || "claude:sonnet", ejecutor: process.env.SYSTEM_EJECUTOR || "openai/gpt-oss-120b", modelo_rapido: "openai/gpt-oss-120b", turnos: 40, temperatura: 0.5 },
    memoria: { modo: "persistente", ventana: 30 }, planeamiento: { activo: false }, pensar_voz_alta: { visible: true },   // sin "plan previo": las skills SON el plan
    gobierno: { aprobar_por_whatsapp: true, max_tool_calls: 90, presupuesto_diario_usd: 0 }, trazas: { verifica: true },
    canales: { items: ["whatsapp", "panel"] }, conocimiento: { items: [] },
  };
  const [ex] = await query<{ id: string }>(`SELECT id FROM agentes WHERE lower(nombre)='system' LIMIT 1`);
  let id: string;
  if (ex) { id = ex.id; await actualizarAgente(id, { ...cfg, nombre: "System" }); console.log(`System ya existía (${id}); actualizado.`); }
  else { id = (await crearAgente(cfg)).id; console.log(`System creado (${id}).`); }
  await actualizarAgente(id, { estado: "activo" });
  await asignarTools(id, await idsDe("tools", tools)); await asignarSkills(id, await idsDe("skills", skills)); await asignarFlujos(id, await idsDe("flujos", flujos));
  const admin = await administradora();
  await crearPuesto({ nombre: "aprendizaje", titulo: "Mente de aprendizaje e innovación", descripcion: "Estudia, experimenta, anticipa, replica y reflexiona; alimenta la biblioteca con fórmulas probadas", agente_id: id, reporta_a: admin?.id ?? null, responsabilidades: "Aprender a fondo lo que el sistema necesita, descubrir por experimento qué funciona mejor, anticipar planes, replicar lo mejor de afuera, reflexión nocturna con propuestas." });
  console.log(`\n⚪ System listo (color ${COLOR}).\n   tools (${tools.length}): ${tools.join(", ")}\n   skills (${skills.length}): ${skills.join(", ")}\n   flujos: ${flujos.join(", ") || "—"}\n   canal: WhatsApp compartido — "hablar con System" / "volver".\n   reflexión nocturna: la dispara el servidor a las 3:00 si SYSTEM_NOCTURNO != "false".`);
  await db.end();
}
main().catch((e) => { console.error(e); process.exit(1); });