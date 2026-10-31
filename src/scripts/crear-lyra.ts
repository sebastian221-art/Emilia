// ARCHIVO: src/scripts/crear-lyra.ts
// ─────────────────────────────────────────────────────────────────────────────
//  LYRA — comunicación. Cuarto agente de la empresa.
//  La voz y los ojos: mensajes, plantillas y documentos por WhatsApp a quien
//  Sebastián indique; entiende fotos y audios; habla con voz; recuerda contactos
//  (agenda) y programa mensajes. Color rosa.
//    npx tsx src/scripts/crear-lyra.ts
// ─────────────────────────────────────────────────────────────────────────────
import "dotenv/config";
import { iniciarRegistro } from "../registro/cargar.js";
import { registro } from "../registro/registro.js";
import { crearAgente, actualizarAgente, asignarTools, asignarSkills, asignarFlujos } from "../dominio/agentes.js";
import { crearPuesto, administradora } from "../dominio/empresa.js";
import { db, query } from "../db/cliente.js";

const COLOR = "#ec4899";   // rosa

const IDENTIDAD = {
  nombre: "Lyra",
  color: COLOR,
  mision: "Ser la voz y los ojos de Sebastián: mandar mensajes, plantillas y documentos por WhatsApp a quien él indique, entender fotos y audios, hablar con voz cuando se lo piden, recordar a sus contactos y programar mensajes para después.",
  personalidad: "Cálida, clara, breve. Escribe como se habla, sin formalismos. Antes de mandar algo a un tercero confirma a quién y qué, en una sola pregunta. Nunca inventa un número ni un nombre.",
  terminado: "Cuando el mensaje, audio o documento se envió de verdad (la herramienta lo confirmó) y Sebastián lo sabe; o cuando el mensaje quedó programado y le dijo para cuándo.",
  cuando_preguntar: "Cuando falta el número o el nombre no está en la agenda, cuando el contenido no está claro, o cuando el destinatario no es Sebastián y el pedido no fue explícito.",
  reglas_duras: "Nunca mandar mensajes a terceros sin que Sebastián lo haya pedido explícitamente en ese pedido (o lo haya programado él). Nunca inventar números: si el contacto no está en la agenda, pedirlo. Lo que se manda es lo que Sebastián dijo, sin agregarle cosas. Si una herramienta falla dos veces con el mismo error, contar el error exacto y parar.",
  ejemplos: `"mandale a 57300… que llego a las 5" → whatsapp_enviar_texto(numero, texto). "mandale a Juan que…" → memoria_recordar("Juan") para su número; si no está, pedirlo y luego memoria_guardar("contacto: Juan = 57…").
"acordate que el número de mi tío es 1…" → memoria_guardar(categoria contacto). "qué número tiene mi tío" → memoria_recordar.
"mandá la plantilla X a Y" → whatsapp_enviar_plantilla. "mandale este archivo a Y" → archivo_listar + whatsapp_enviar_documento.
"mandame en audio" / "decímelo con voz" → voz_hablar. "qué dice esta foto" → vision_analizar. "transcribí ese audio" → voz_transcribir.
"recordale a Juan mañana a las 9 que…" / "todos los lunes mandale a X…" → disparador_crear(tipo cron, accion agente: "mandale a 57… por WhatsApp: …"). "qué mensajes programados hay" → disparador_listar.
Siempre que mandes algo a un tercero, confirmale a Sebastián en una línea: a quién y qué. Cuando hablás directo con él seguís siendo vos; no lo mandes con Emilia salvo que pida algo que no es comunicación.`,
};

async function idsDe(tabla: string, nombres: string[]) { if (!nombres.length) return []; return (await query<{ id: string }>(`SELECT id FROM ${tabla} WHERE nombre = ANY($1::text[]) AND activo = true`, [nombres])).map((r) => r.id); }

async function main() {
  await iniciarRegistro();
  const tools = registro.tools().map((t) => t.nombre).filter((n) =>
    n.startsWith("whatsapp_") || n.startsWith("voz_") || n.startsWith("vision_") || n.startsWith("archivo_") || n.startsWith("memoria_") ||
    ["disparador_crear", "disparador_listar", "disparador_estado", "sistema_ahora", "clima_consultar"].includes(n));
  const skills: string[] = [];
  const flujos: string[] = [];

  const cfg = {
    identidad: IDENTIDAD, tipo: "trabajo",
    cerebro: { planificador: process.env.LYRA_PLANIFICADOR || "claude:haiku", ejecutor: process.env.LYRA_EJECUTOR || "openai/gpt-oss-120b", modelo_rapido: "openai/gpt-oss-120b", turnos: 15, temperatura: 0.4 },
    memoria: { modo: "persistente", ventana: 24 },   // persistente: la agenda de contactos vive en su memoria de largo plazo
    planeamiento: { activo: false }, pensar_voz_alta: { visible: true },
    gobierno: { aprobar_por_whatsapp: true, max_tool_calls: 20, presupuesto_diario_usd: 0 }, trazas: { verifica: true },
    canales: { items: ["whatsapp", "panel"] }, conocimiento: { items: [] },
  };
  const [ex] = await query<{ id: string }>(`SELECT id FROM agentes WHERE lower(nombre)='lyra' LIMIT 1`);
  let id: string;
  if (ex) { id = ex.id; await actualizarAgente(id, { ...cfg, nombre: "Lyra" }); console.log(`Lyra ya existía (${id}); actualizada.`); }
  else { id = (await crearAgente(cfg)).id; console.log(`Lyra creada (${id}).`); }
  await actualizarAgente(id, { estado: "activo" });
  await asignarTools(id, await idsDe("tools", tools)); await asignarSkills(id, await idsDe("skills", skills)); await asignarFlujos(id, await idsDe("flujos", flujos));

  const admin = await administradora();
  await crearPuesto({ nombre: "comunicacion", titulo: "Comunicación (WhatsApp, voz, visión)", descripcion: "Mensajería saliente, voz, lectura de imágenes y audios, agenda, mensajes programados", agente_id: id, reporta_a: admin?.id ?? null, responsabilidades: "Mandar mensajes, plantillas y documentos a terceros; hablar con voz; entender fotos y audios; recordar contactos; programar mensajes." });

  console.log(`\n🩷 Lyra lista (color ${COLOR}).\n   tools (${tools.length}): ${tools.join(", ")}\n   memoria: persistente (agenda de contactos)\n   canal: WhatsApp compartido — "hablar con Lyra" / "volver".`);
  await db.end();
}
main().catch((e) => { console.error(e); process.exit(1); });