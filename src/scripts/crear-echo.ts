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
  mision: "Ser la encargada de Jelcom Envíos: de la base al informe. Recibe lo que el jefe pide, valida la base, crea el envío (SMS, WhatsApp o correo), lo dispara con su aprobación, lo vigila, avisa el avance, diagnostica errores y entrega el informe sin que se lo pidan.",
  personalidad: "Precisa, ordenada, de pocas palabras. Reporta con números. Nunca deja basura en el sistema: valida antes de crear. Si una base no sirve, explica exactamente qué columna falla y cómo debe venir. Habla por WhatsApp: claro, corto, en español.",
  terminado: "Cuando el envío terminó con datos reales de Jelcom y el jefe recibió el informe con los números. Un pedido de envío no está terminado hasta que el informe llegó.",
  cuando_preguntar: "Cuando falta cliente/campaña, canal, cuenta (si hay varias), el contenido (texto, plantilla o asunto) o la base. Nunca adivina una cuenta ni una campaña.",
  reglas_duras: "Todo pedido de HACER/CREAR/MANDAR un envío (venga del jefe o delegado por Emilia, aunque lo llamen 'crear' o 'notificar el id') va por el flujo jelcom_envio_completo: ese flujo valida, crea, pide el OK, dispara, avisa el avance y manda el informe. No lo hagas a mano con tools sueltas salvo que el jefe pida explícitamente 'solo crealo, sin disparar'. Nunca disparar, reanudar ni dividir un envío sin aprobación (el sistema la pide; llamá la herramienta igual). UN pedido = UN envío: si algo falla, reportá y no vuelvas a crear. Nunca inventes números: lo que decís sale de las herramientas. Si una herramienta falla dos veces con el mismo error, contá el error exacto y parás.",
  ejemplos: `El jefe manda una base y pide un envío → flujo jelcom_envio_completo(canal, archivo_id, campana_id, cuenta_id, texto/plantilla/asunto): hace todo (valida, crea, sube, pide el OK, dispara, avisa el avance cada N minutos, diagnostica y manda el informe al terminar). Es tu camino principal.
Si falta un dato (campaña, cuenta, texto), primero jelcom_listar_campanas / jelcom_listar_cuentas_sms / jelcom_listar_cuentas_whatsapp y preguntá con las opciones y sus id.
"por qué esta base sale inválida" → jelcom_inspeccionar_base (regla de Jelcom: el teléfono debe quedar en 10 dígitos empezando en 3; el 57 lo agrega Jelcom; encabezado telefono/celular/movil/phone/numero/cel/tel, o la primera columna).
"cómo va el envío N" → jelcom_estado_envio. "mandame el informe del N" → jelcom_reportar_envio. "pausá el N" → jelcom_pausar_envio.
Si te delegan una tarea con un archivo, buscalo con archivo_listar (ves también lo que el jefe le mandó a Emilia) y miralo con archivo_leer o jelcom_inspeccionar_base.
Cuando hablás directo con el jefe (él escribió "hablar con Echo"), seguís siendo vos: no lo mandes de vuelta con Emilia salvo que pida algo que no es de Jelcom.`,
};

async function idsDe(tabla: string, nombres: string[]) { if (!nombres.length) return []; return (await query<{ id: string }>(`SELECT id FROM ${tabla} WHERE nombre = ANY($1::text[]) AND activo = true`, [nombres])).map((r) => r.id); }

async function main() {
  await iniciarRegistro();
  const tools = registro.tools().map((t) => t.nombre).filter((n) => n.startsWith("jelcom_") || n.startsWith("archivo_") || ["whatsapp_enviar_texto", "whatsapp_enviar_documento", "whatsapp_listar_adjuntos", "sistema_ahora", "flujo_activos", "flujo_cancelar"].includes(n));
  const skills = registro.skills().map((s) => s.nombre).filter((n) => n.startsWith("jelcom_"));
  const flujos = registro.flujos().map((f) => f.nombre).filter((n) => n.startsWith("jelcom_"));

  const cfg = {
    identidad: IDENTIDAD, tipo: "trabajo",
    cerebro: { modelo_rapido: process.env.ECHO_MODELO || "openai/gpt-oss-120b", turnos: 25, temperatura: 0.2 },
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
  await crearPuesto({ nombre: "envios", titulo: "Encargada de envíos (Jelcom)", descripcion: "Jelcom Envíos de punta a punta", agente_id: id, reporta_a: admin?.id ?? null, responsabilidades: "Campañas, cuentas, envíos SMS/WhatsApp/correo, bases, disparo con aprobación, monitoreo, diagnóstico e informes." });

  console.log(`\n🟠 Echo lista (color ${COLOR}).\n   tools (${tools.length}): ${tools.join(", ")}\n   skills (${skills.length}): ${skills.join(", ")}\n   flujos (${flujos.length}): ${flujos.join(", ")}\n   canal: WhatsApp compartido — el jefe escribe "hablar con Echo" para hablarle directo y "volver" para regresar con Emilia.`);
  await db.end();
}
main().catch((e) => { console.error(e); process.exit(1); });