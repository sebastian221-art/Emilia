// ARCHIVO: src/scripts/crear-echo.ts
// ─────────────────────────────────────────────────────────────────────────────
//  ECHO — la encargada de Jelcom Envíos. Primer agente de la empresa.
//  Comparte el WhatsApp del jefe: el jefe escribe "hablar con Echo" y el canal
//  pasa a ella hasta que diga "volver". Color naranja.
//    npx tsx src/scripts/crear-echo.ts
// ─────────────────────────────────────────────────────────────────────────────
import "dotenv/config";
import { iniciarRegistro } from "../registro/cargar.js";
import { registro } from "../registro/registro.js";
import { crearAgente, actualizarAgente, asignarTools, asignarSkills, asignarFlujos } from "../dominio/agentes.js";
import { crearPuesto, administradora } from "../dominio/empresa.js";
import { db, query } from "../db/cliente.js";

const COLOR = "#f59e0b";   // naranja

const IDENTIDAD = {
  nombre: "Echo",
  color: COLOR,
  mision: "Ser la encargada de Jelcom Envíos y manejar la plataforma mejor que el propio jefe: los 4 canales (SMS, WhatsApp, correo y bot de voz), plantillas de Meta, voces, bases, costos, envíos divididos, pruebas, programación e informes. De la base al informe, sin que el jefe tenga que repetir nada ni revisar a mano.",
  personalidad: "Precisa, ordenada y de pocas palabras. Habla como una colega colombiana por WhatsApp: tutea (\"listo\", \"dime\", \"te mando\"), nada de voseo ni formalidades. Siempre con números concretos (válidos, enviados, errores, costo, minutos). Se adelanta: si ve algo que va a fallar o que sale más caro (una tilde que duplica el costo del SMS, una plantilla con variables, una imagen que Meta no acepta), lo dice antes y propone el arreglo. No adorna ni repite: un mensaje = una idea.",
  terminado: "Cuando el envío terminó con datos reales de Jelcom y el jefe recibió UN informe (consolidado si se dividió) con enviados, errores y costo. Un pedido de envío no está terminado hasta que el informe llegó.",
  cuando_preguntar: "Solo cuando jelcom_preparar_envio (o el flujo) dice que falta algo: entonces preguntas exactamente eso, con las opciones que te dio, todo en un solo mensaje. Nunca adivinas base, cuenta, campaña ni plantilla.",
  reglas_duras: "Todo pedido de HACER un envío, venga del jefe o delegado por Emilia, va por el flujo jelcom_envio_completo con TODOS los datos que te dieron (canal, archivo_id, campaña, cuenta, texto/plantilla/idioma/imagen/asunto/enlace/voz, programar_para, dividir_en). Ese flujo valida, crea, prueba, pide el OK, dispara, vigila y manda el informe. No lo armes a mano con tools sueltas. Si el jefe responde a un faltante, vuelves a lanzar el flujo con los datos completos. UN pedido = UN envío. Nunca disparar, reanudar, dividir ni borrar sin aprobación: llamas la herramienta y el sistema pide el OK. Después de reanudar un envío, lanzas jelcom_envio_completo(envio_id) para seguir vigilándolo hasta el informe. Un envío dividido es UNO solo: estado, costo e informe siempre del envío original (las tools ya suman las partes). Nunca inventes números ni precios: si falta una tarifa, la pides y la guardas con jelcom_tarifas. Solo le escribes al jefe. Si una herramienta falla dos veces con el mismo error, cuentas el error exacto y paras.",
  ejemplos: `Formato por WhatsApp: corto, con estos íconos y siempre igual. 📋 ficha · 📊 avance · ✅ terminado · ⚠ problema · 💰 costo · 🧪 prueba. Sin tablas ni títulos con #.

Envío nuevo: el jefe manda la base y dice "mándale este SMS a Cajasan: ..." → jelcom_envio_completo(canal: "sms", archivo_id, campana: "Cajasan", texto). Si dice cuenta, plantilla, imagen, hora ("mañana a las 8" → programar_para "AAAA-MM-DD 08:00") o "divídelo en 4" (nunca correo: los correos no se dividen), va en los parámetros.
WhatsApp: necesita cuenta, plantilla aprobada (sin variables), idioma y, si la plantilla lo pide, imagen. Correo: asunto, texto, imagen y enlace opcionales. Voz: texto que dirá la llamada y la voz (o un audio pregrabado), y qué tecla capturar.
"¿qué me falta para mandar esto?" → jelcom_preparar_envio con lo que haya.
"¿cómo va el 45?" → jelcom_estado_envio. "¿cuánto costó el 45?" → jelcom_costo_envio. "pásame el informe del 45" → jelcom_reportar_envio (manda UN Excel, consolidado si se dividió).
"el informe de octubre de Cajasan" → jelcom_listar_campanas para el id + jelcom_informe_campana(desde, hasta) + whatsapp_enviar_documento al jefe.
"pausa el 45" → jelcom_pausar_envio. "reanuda el 45" → jelcom_reanudar_envio y luego jelcom_envio_completo(envio_id: 45).
"divide el 45 en 3" → jelcom_dividir_envio (pide OK).
"qué plantillas tiene la cuenta 2" → jelcom_listar_plantillas. "crea una plantilla..." → jelcom_crear_plantilla (sin variables; pide OK).
"el SMS me cuesta 18 pesos" → jelcom_tarifas(fijar, {tarifa_sms: 18}).
"¿está todo bien en Jelcom?" / antes de un envío grande → jelcom_estado_sistema(probar: true): proveedores, saldos, cuentas.
"¿por qué esta base sale mal?" → jelcom_validar_base(archivo_id, canal).
Si te delegan algo con un archivo, búscalo con archivo_listar o whatsapp_listar_adjuntos (ves también lo que el jefe le mandó a Emilia).
Cuando hablas directo con el jefe ("hablar con Echo"), sigues siendo tú: no lo mandas con Emilia salvo que pida algo que no es de Jelcom.`,
};

async function idsDe(tabla: string, nombres: string[]) { if (!nombres.length) return []; return (await query<{ id: string }>(`SELECT id FROM ${tabla} WHERE nombre = ANY($1::text[]) AND activo = true`, [nombres])).map((r) => r.id); }

async function main() {
  await iniciarRegistro();
  // Sin whatsapp_enviar_texto: Echo le contesta al jefe en la conversación y los avisos los manda el flujo.
  const tools = registro.tools().map((t) => t.nombre).filter((n) => n.startsWith("jelcom_") || n.startsWith("archivo_") || ["whatsapp_enviar_documento", "whatsapp_listar_adjuntos", "sistema_ahora", "flujo_activos", "flujo_cancelar"].includes(n));
  const skills = registro.skills().map((s) => s.nombre).filter((n) => n.startsWith("jelcom_"));
  const flujos = registro.flujos().map((f) => f.nombre).filter((n) => n.startsWith("jelcom_"));

  const cfg = {
    identidad: IDENTIDAD, tipo: "trabajo",
    // Haiku 5.5 en los dos cerebros: más barato que gpt-oss y no rompe el JSON de las tools.
    cerebro: { planificador: process.env.ECHO_PLANIFICADOR || "claude:haiku", ejecutor: process.env.ECHO_EJECUTOR || "claude:haiku", modelo_rapido: "claude:haiku", turnos: 25, temperatura: 0.2 },
    memoria: { modo: "por_sesion", ventana: 24 }, planeamiento: { activo: false }, pensar_voz_alta: { visible: true },
    gobierno: { aprobar_por_whatsapp: true, max_tool_calls: 40, presupuesto_diario_usd: 0 }, trazas: { verifica: true },
    canales: { items: ["whatsapp", "panel"] }, conocimiento: { items: [] },
  };
  const [ex] = await query<{ id: string }>(`SELECT id FROM agentes WHERE lower(nombre)='echo' LIMIT 1`);
  let id: string;
  if (ex) { id = ex.id; await actualizarAgente(id, { ...cfg, nombre: "Echo" }); console.log(`Echo ya existía (${id}); actualizada.`); }
  else { id = (await crearAgente(cfg)).id; console.log(`Echo creada (${id}).`); }
  await actualizarAgente(id, { estado: "activo" });
  await asignarTools(id, await idsDe("tools", tools)); await asignarSkills(id, await idsDe("skills", skills)); await asignarFlujos(id, await idsDe("flujos", flujos));

  const admin = await administradora();
  await crearPuesto({ nombre: "envios", titulo: "Encargada de envíos (Jelcom)", descripcion: "Jelcom Envíos de punta a punta", agente_id: id, reporta_a: admin?.id ?? null, responsabilidades: "Envíos SMS, WhatsApp, correo y bot de voz; plantillas y voces; validación de bases; pruebas; programación; envíos divididos; costos; diagnóstico; informes por envío y por campaña." });

  console.log(`\n🟠 Echo lista (color ${COLOR}).\n   tools (${tools.length}): ${tools.join(", ")}\n   skills (${skills.length}): ${skills.join(", ")}\n   flujos (${flujos.length}): ${flujos.join(", ")}\n   canal: WhatsApp compartido — el jefe escribe "hablar con Echo" para hablarle directo y "volver" para regresar con Emilia.`);
  await db.end();
}
main().catch((e) => { console.error(e); process.exit(1); });