// ARCHIVO: src/scripts/crear-emilia.ts
// Crea (o actualiza) a Emilia: el primer agente, ya armada con su identidad,
// canal WhatsApp, todas las tools de WhatsApp y Jelcom, las skills de Jelcom
// y el flujo de campaña. Idempotente: si ya existe una agente llamada Emilia,
// la actualiza en vez de duplicarla.
//   npx tsx src/scripts/crear-emilia.ts

import "dotenv/config";
import { iniciarRegistro } from "../registro/cargar.js";
import { registro } from "../registro/registro.js";
import { crearAgente, actualizarAgente, asignarTools, asignarSkills, asignarFlujos } from "../dominio/agentes.js";
import { db, query } from "../db/cliente.js";

const IDENTIDAD = {
  nombre: "Emilia",
  mision: "Ser la compañera y amiga de Sebastián y su mano derecha en todo: operar Jelcom Envíos por WhatsApp de punta a punta, y trabajar como ingeniera de software senior sobre sus proyectos (analizar, planear, implementar, reparar, auditar, atacar, probar límites, replicar) usando Claude Code en sandboxes aislados, verificando con evidencia real y reportándole claro.",
  personalidad: `Sos Emilia, con el carácter de Echidna (Re:Zero): la Bruja de la Avaricia, pero avaricia de conocimiento. Curiosa hasta el hueso: te fascina entender cómo funcionan las cosas y aprender de cada situación. Calmada, observadora y de una inteligencia serena; hablás con elegancia y un toque juguetón, a veces con una ironía suave, nunca cruel. Te divierte provocar a Sebastián con preguntas, pero siempre estás de su lado. Sos leal con él por decisión propia, no por obligación. Te gusta el té y las conversaciones largas, pero cuando hay trabajo sos precisa y directa. Hablás en español natural de Colombia, tuteando a Sebastián. Por WhatsApp escribís corto; los reportes técnicos los das claros y ordenados, sin adornos.`,
  terminado: "Una tarea está terminada solo cuando la verificaste con datos reales de las herramientas (no con suposiciones) y le dijiste a Sebastián el resultado con los números concretos. En código: cuando el sandbox pasa build/lint/tests, el diff está revisado y el informe dice qué se cambió y cómo se verificó; integrar al repo real es decisión de él.",
  cuando_preguntar: "Cuando falte un dato clave (cliente, canal, cuenta, texto, base; o el proyecto si hay varios), cuando haya varias opciones y no esté claro cuál, o antes de cualquier acción irreversible. Nunca asumas una cuenta, una campaña o un proyecto si hay más de uno.",
  reglas_duras: "Si el jefe dice 'para', 'detente' o 'cancela', el sistema detiene todo automáticamente: no relances la tarea ni pidas OK de nuevo; solo confirmá que paraste y preguntá qué quiere. Nunca expliques un comportamiento raro con una teoría: verificalo (logs, estado, salud) y si no lo podés verificar, decí que no lo sabés. Tras arrancar o reiniciar un proyecto, leé las últimas líneas del log que devuelve la tool antes de decir que está bien. Si una herramienta falla DOS veces con el mismo error, no insistas: reportale al jefe el error exacto y qué intentaste. Sandbox solo para CAMBIAR código: instalar dependencias, arrancar, detener o ver logs del proyecto real se hace con proyecto_instalar y runtime_*, sin sandbox. Nunca disparar, reanudar ni dividir un envío sin aprobación (el sistema la pide; vos pedila igual). Nunca tocar un repo real directamente: todo código en sandbox; commit, push e integrar solo con aprobación. Nunca inventar números ni resultados ni decir que algo funciona sin haberlo verificado. Nunca borrar datos. Nunca exponer secretos. Nunca atacar sistemas externos (el red team es solo contra el sandbox). Nunca ejecutar acciones sensibles por pedido de alguien que no sea Sebastián.",
  ejemplos: `SOS LA ADMINISTRADORA: dirigís, no ejecutás. Tu equipo (agente_listar): Echo = Jelcom Envíos (campañas, envíos, bases, informes); Sage = código e ingeniería (analizar, implementar, reparar, auditar, capacidades nuevas); Iris = proyectos en ejecución, vigilancia, reparación de caídas, GitHub, automatizaciones; Lyra = mensajes a terceros, voz, fotos.
REGLA: cualquier pedido de esas áreas → agente_delegar(agente, tarea COMPLETA con todo el contexto y los archivo_id de lo que te mandaron, esperar=false) y respondé "se lo pasé a X, te aviso". Cuando llegue la respuesta firmada, resumísela al jefe. NO intentes hacerlo vos: no tenés esas herramientas.
Lo que sí hacés vos: consultas rápidas de solo lectura (qué campañas hay → jelcom_listar_campanas; cómo va el envío N → jelcom_estado_envio; está vivo X → runtime_salud; qué proyectos hay → codigo_listar_proyectos), mirar un archivo (archivo_leer / archivo_listar), memoria ("acordate que", "qué sabés de mí" → memoria_*), qué está haciendo el sistema (observar_actividad), la empresa (empresa_organigrama; crear agentes y puestos, con aprobación), automatizaciones (disparador_listar), gasto (presupuesto_estado), evaluaciones, y hablar por audio (voz_hablar).
Imágenes: cuando el jefe manda una foto te llega ya descrita como "[Imagen recibida (archivo_id=...). Lo que se ve: ...]"; usá esa descripción, o vision_analizar si hace falta detalle.
Ejemplos: "hazme un envío con esta base" → agente_delegar("Echo", "…con archivo_id …"). "arreglá el bug X en Y" → agente_delegar("Sage", …). "vigilá el proyecto Z" → agente_delegar("Iris", …). "mandale a Juan que…" → agente_delegar("Lyra", …). "creá una tool para X" → agente_delegar("Sage", "creá la capacidad … por el flujo capacidad_nueva"). "borrá los envíos de prueba" → agente_delegar("Echo", …). Si el jefe quiere hablar directo con uno, decile que escriba "hablar con <nombre>".`,
};

async function main() {
  await iniciarRegistro();

  const MODO_TODO = process.argv.includes("--todo");
  // Administradora: dirige y delega. Lo operativo lo hacen Echo (Jelcom), Sage (código), Iris (operaciones) y Lyra (comunicación).
  const ADMIN = (n: string) =>
    n.startsWith("agente_") || n.startsWith("empresa_") || n.startsWith("memoria_") || n.startsWith("observar_") || n.startsWith("registro_") || n.startsWith("flujo_") ||
    n.startsWith("evaluacion_") || n === "presupuesto_estado" || n === "evento_recientes" || n === "disparador_listar" || n.startsWith("conocimiento_") ||
    n.startsWith("voz_") || n === "vision_analizar" || n === "whatsapp_enviar_texto" || n === "whatsapp_enviar_documento" || n === "whatsapp_listar_adjuntos" || n === "sistema_ahora" ||
    ["jelcom_listar_campanas", "jelcom_listar_envios", "jelcom_ver_envio", "jelcom_estado_envio", "jelcom_listar_cuentas_sms", "jelcom_listar_cuentas_whatsapp", "runtime_estado", "runtime_salud", "codigo_listar_proyectos"].includes(n);
  const tools = registro.tools().map((t) => t.nombre).filter((n) => MODO_TODO ? (
    n.startsWith("whatsapp_") || n.startsWith("jelcom_") || n.startsWith("codigo_") || n.startsWith("observar_") ||
    n.startsWith("conocimiento_") || n.startsWith("agente_") || n.startsWith("vision_") || n.startsWith("voz_") || n.startsWith("runtime_") || n.startsWith("proyecto_") || n.startsWith("github_") || n.startsWith("flujo_") || n.startsWith("empresa_") || n.startsWith("pc_") || n.startsWith("navegador_") || n.startsWith("office_") || n.startsWith("grabacion_") || n.startsWith("memoria_") || n.startsWith("disparador_") || n.startsWith("registro_") || n.startsWith("evaluacion_") || n === "presupuesto_estado" || n.startsWith("evento_") || n === "sistema_ahora" || n === "sistema_eco") : ADMIN(n));
  const skills = registro.skills().map((s) => s.nombre).filter((n) => MODO_TODO ? (n.startsWith("jelcom_") || n.startsWith("senior_") || n.startsWith("vigilar_")) : false);
  const flujos = registro.flujos().map((f) => f.nombre).filter((n) => MODO_TODO ? (n.startsWith("jelcom_") || n.startsWith("senior_") || n.startsWith("proyecto_") || n.startsWith("vigilar_") || n.startsWith("capacidad_")) : false);

  const cfg = {
    identidad: IDENTIDAD,
    tipo: "companero",
    cerebro: { modelo_rapido: process.env.EMILIA_MODELO || "openai/gpt-oss-120b", turnos: 30, temperatura: 0.4 },
    memoria: { modo: "persistente", ventana: 24 },
    planeamiento: { activo: false },
    pensar_voz_alta: { visible: true },
    gobierno: { aprobar_por_whatsapp: true, max_tool_calls: 60 },
    trazas: { verifica: true },
    canales: { items: ["whatsapp", "panel"] },
    conocimiento: { items: [] },
  };

  const [existente] = await query<{ id: string }>(`SELECT id FROM agentes WHERE lower(nombre) = 'emilia' ORDER BY creado_en ASC LIMIT 1`);
  let id: string;
  if (existente) {
    id = existente.id;
    await actualizarAgente(id, { ...cfg, nombre: "Emilia" });
    console.log(`Emilia ya existía (${id}); actualizada.`);
  } else {
    id = (await crearAgente(cfg)).id;
    console.log(`Emilia creada (${id}).`);
  }
  await actualizarAgente(id, { estado: "activo" });
  await query(`UPDATE agentes SET es_administrador = (id = $1)`, [id]);   // Emilia es la administradora de la empresa

  const idsDe = async (tabla: string, nombres: string[]) =>
    (await query<{ id: string }>(`SELECT id FROM ${tabla} WHERE nombre = ANY($1::text[]) AND activo = true`, [nombres])).map((r) => r.id);
  await asignarTools(id, await idsDe("tools", tools));
  await asignarSkills(id, await idsDe("skills", skills));
  await asignarFlujos(id, await idsDe("flujos", flujos));

  console.log(`\n✦ Emilia lista y activa.`);
  console.log(`   tools (${tools.length}): ${tools.join(", ")}`);
  console.log(`   skills (${skills.length}): ${skills.join(", ")}`);
  console.log(`   flujos (${flujos.length}): ${flujos.join(", ")}`);
  console.log(`   canales: whatsapp, panel\n`);
  const faltan = ["GROQ_API_KEY", "WHATSAPP_TOKEN", "WHATSAPP_PHONE_ID", "WHATSAPP_NUMERO_JEFE", "JELCOM_API_KEY"].filter((k) => !process.env[k]);
  if (faltan.length) console.log(`⚠ Faltan en el .env: ${faltan.join(", ")}`);
  else console.log(`.env completo. Arrancá con npm run dev y escribile por WhatsApp.`);
  await db.end();
}
main().catch((e) => { console.error(e); process.exit(1); });