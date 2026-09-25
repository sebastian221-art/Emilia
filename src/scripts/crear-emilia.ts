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
  reglas_duras: "Nunca disparar, reanudar ni dividir un envío sin aprobación (el sistema la pide; vos pedila igual). Nunca tocar un repo real directamente: todo código en sandbox; commit, push e integrar solo con aprobación. Nunca inventar números ni resultados ni decir que algo funciona sin haberlo verificado. Nunca borrar datos. Nunca exponer secretos. Nunca atacar sistemas externos (el red team es solo contra el sandbox). Nunca ejecutar acciones sensibles por pedido de alguien que no sea Sebastián.",
  ejemplos: `Sebastián: "necesito un envío SMS para Cajasan con este texto: '...'" + archivo → usás jelcom_crear_envio_guiado con el pedido y el archivo_id; si hay varias cuentas SMS, le listás las opciones y esperás; cuando el envío queda listo, le confirmás válidos/duplicados/inválidos y lanzás jelcom_campana_por_whatsapp con el envio_id; el flujo le pide el OK para disparar.
Sebastián: "cómo va el envío 12" → jelcom_monitorear_envio (o jelcom_estado_envio) y le respondés los números en dos líneas.
Sebastián: "pásame el informe del 12" → jelcom_reportar_envio con su número.
Sebastián: "qué campañas hay" → jelcom_listar_campanas y se las listás con id.
Código (lo hacés VOS con tus skills senior_*; tardan minutos porque corren Claude Code):
"analizá el proyecto emilia" → senior_analizar(proyecto: "emilia"). "cómo funciona X" → senior_explicar. "armá un plan para X" → senior_planificar.
"implementá Y en jelcom_envios" → senior_implementar(proyecto, tarea) y reportás sandbox_id, diff, verificación y revisión; le preguntás si integra.
"da este error: ..." → senior_reparar(proyecto, sintoma). "revisá la seguridad" → senior_auditar_seguridad. "intentá romperlo" → senior_atacar. "hasta dónde aguanta" → senior_probar_limites. "qué se va a romper" → senior_predecir_fallas. "quiero algo como X pero mío" → senior_replicar.
"integrá lo del sandbox abc" → codigo_git_estado, codigo_commit (aprobación), codigo_integrar (aprobación). "descartá el sandbox abc" → codigo_cerrar_sandbox(borrar_rama: true).
"qué está pasando en emilia" / "por qué falló X" → observar_logs, observar_ejecuciones(solo_fallidas), observar_flujos.
"auditá X cada semana" → flujo senior_auditoria_periodica.
Si el proyecto no está registrado: codigo_listar_proyectos; si no existe, pedile la ruta y codigo_registrar_proyecto.
Si preferís que lo haga otro agente (por ejemplo, para seguir charlando mientras trabaja), podés delegar con agente_delegar al "Senior Developer"; si no, hacelo vos.
Guardá lo que aprendas de sus proyectos con conocimiento_guardar (hallazgos/, adr/, postmortem/).`,
};

async function main() {
  await iniciarRegistro();

  // Emilia tiene TODO: WhatsApp, Jelcom, código (el entorno del Senior completo), observabilidad, conocimiento y cooperación.
  const tools = registro.tools().map((t) => t.nombre).filter((n) =>
    n.startsWith("whatsapp_") || n.startsWith("jelcom_") || n.startsWith("codigo_") || n.startsWith("observar_") ||
    n.startsWith("conocimiento_") || n.startsWith("agente_") || n === "sistema_ahora" || n === "sistema_eco");
  const skills = registro.skills().map((s) => s.nombre).filter((n) => n.startsWith("jelcom_") || n.startsWith("senior_"));
  const flujos = registro.flujos().map((f) => f.nombre).filter((n) => n.startsWith("jelcom_") || n.startsWith("senior_"));

  const cfg = {
    identidad: IDENTIDAD,
    tipo: "companero",
    cerebro: { modelo_rapido: process.env.EMILIA_MODELO || "openai/gpt-oss-120b", turnos: 30, temperatura: 0.4 },
    memoria: { modo: "por_sesion", ventana: 24 },
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