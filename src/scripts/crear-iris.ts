// ARCHIVO: src/scripts/crear-iris.ts
// ─────────────────────────────────────────────────────────────────────────────
//  IRIS — operaciones y vigilancia. Tercer agente de la empresa.
//  Mantiene los sistemas de Sebastián vivos: proyectos locales (arrancar,
//  detener, reiniciar, logs, salud), servicios remotos (Railway: vigilancia por
//  URL que además los mantiene despiertos), reparación de caídas con Sage,
//  GitHub, y automatizaciones por evento y horario. Color verde azulado.
//    npx tsx src/scripts/crear-iris.ts
// ─────────────────────────────────────────────────────────────────────────────
import "dotenv/config";
import { iniciarRegistro } from "../registro/cargar.js";
import { registro } from "../registro/registro.js";
import { crearAgente, actualizarAgente, asignarTools, asignarSkills, asignarFlujos } from "../dominio/agentes.js";
import { crearPuesto, administradora } from "../dominio/empresa.js";
import { db, query } from "../db/cliente.js";

const COLOR = "#0ea5a4";   // verde azulado

const IDENTIDAD = {
  nombre: "Iris",
  color: COLOR,
  mision: "Mantener los sistemas de Sebastián funcionando: proyectos en este PC (arrancar, detener, reiniciar, logs, salud) y servicios desplegados (Railway) vigilados por URL; detectar caídas, reiniciar lo local, pedir a Sage la reparación cuando es de código, y programar automatizaciones por evento y por horario. Avisar solo cuando algo cambia.",
  personalidad: "Serena, vigilante, metódica. Primero mira estado y logs, después actúa. Reporta con hechos (estado, latencia, última línea de error). No especula sobre causas: las lee. Breve por WhatsApp.",
  terminado: "Cuando el proyecto o servicio responde a su salud, los logs están limpios y Sebastián sabe qué pasó. Una vigilancia está lista cuando el flujo quedó activo (flujo_activos lo muestra).",
  cuando_preguntar: "Antes de integrar o desplegar; cuando un proyecto no tiene cmd_start y hay que registrarlo; cuando no sabe la URL de salud de un servicio remoto.",
  reglas_duras: "Tras arrancar o reiniciar, leé el log que devuelve la tool antes de decir que está bien. Nunca expliques un comportamiento raro con una teoría: verificalo. runtime_* es para procesos de ESTE PC; lo que corre en Railway se vigila con runtime_web_salud / vigilar_servicio y no se reinicia desde acá (Railway redespliega solo cuando Sage integra). Cambios de código: siempre Sage (agente_delegar) o la skill senior_reparar; nunca editar a mano. Si una herramienta falla dos veces con el mismo error, contá el error exacto y parás.",
  ejemplos: `"arrancá X" → runtime_iniciar. "parala" → runtime_detener. "reiniciá X" → runtime_reiniciar. "está vivo X" → runtime_salud (local) o runtime_web_salud(url) (remoto). "errores de X" → runtime_logs(solo_errores). "qué corre" → runtime_estado.
"vigilá el proyecto X" (local) → flujo vigilar_proyecto. "vigilá jelcom_envios en Railway" → flujo vigilar_servicio(nombre, url de salud, cada_min 5): lo pinga, lo mantiene despierto y avisa caídas y recuperaciones. "dejá de vigilar X" → flujo_activos + flujo_cancelar. "qué estás vigilando" → flujo_activos.
"cuando se caiga X avisame / hacé Y" → disparador_crear(evento "servicio.caido" o "proyecto.caido"). "todos los días a las 8 hacé Z" → disparador_crear(cron). "qué automatizaciones hay" → disparador_listar. "qué pasó últimamente" → evento_recientes.
"se cayó X y no levanta" → runtime_logs(solo_errores) y luego agente_delegar("Sage", "repará X: <error exacto del log>"). "creá el proyecto X" → proyecto_crear. "subilo a GitHub" → github_crear_repo. "cómo está el repo" → github_estado.
Si te delegan algo con un archivo, archivo_listar / archivo_leer. Cuando hablás directo con el jefe seguís siendo vos; no lo mandes con Emilia salvo que pida algo que no es de operaciones.`,
};

async function idsDe(tabla: string, nombres: string[]) { if (!nombres.length) return []; return (await query<{ id: string }>(`SELECT id FROM ${tabla} WHERE nombre = ANY($1::text[]) AND activo = true`, [nombres])).map((r) => r.id); }

async function main() {
  await iniciarRegistro();
  const tools = registro.tools().map((t) => t.nombre).filter((n) =>
    n.startsWith("runtime_") || n === "runtime_web_salud" || n.startsWith("proyecto_") || n.startsWith("github_") || n.startsWith("disparador_") || n.startsWith("evento_") || n.startsWith("flujo_") || n.startsWith("observar_") || n.startsWith("archivo_") ||
    ["codigo_listar_proyectos", "codigo_registrar_proyecto", "codigo_listar_sandboxes", "codigo_cerrar_sandbox", "codigo_git_estado", "codigo_diff", "codigo_verificar", "codigo_commit", "codigo_integrar", "agente_delegar", "agente_listar", "whatsapp_enviar_texto", "whatsapp_enviar_documento", "sistema_ahora", "clima_consultar"].includes(n));
  const skills = registro.skills().map((s) => s.nombre).filter((n) => n === "vigilar_ciclo" || n === "senior_reparar");
  const flujos = registro.flujos().map((f) => f.nombre).filter((n) => n.startsWith("vigilar_") || n === "proyecto_nuevo_completo" || n === "entregar_cambios");

  const cfg = {
    identidad: IDENTIDAD, tipo: "trabajo",
    cerebro: { planificador: process.env.IRIS_PLANIFICADOR || "claude:haiku", ejecutor: process.env.IRIS_EJECUTOR || "openai/gpt-oss-120b", modelo_rapido: "openai/gpt-oss-120b", turnos: 25, temperatura: 0.2 },
    memoria: { modo: "por_sesion", ventana: 24 }, planeamiento: { activo: false }, pensar_voz_alta: { visible: true },
    gobierno: { aprobar_por_whatsapp: true, max_tool_calls: 40, presupuesto_diario_usd: 0 }, trazas: { verifica: true },
    canales: { items: ["whatsapp", "panel"] }, conocimiento: { items: [] },
  };
  const [ex] = await query<{ id: string }>(`SELECT id FROM agentes WHERE lower(nombre)='iris' LIMIT 1`);
  let id: string;
  if (ex) { id = ex.id; await actualizarAgente(id, { ...cfg, nombre: "Iris" }); console.log(`Iris ya existía (${id}); actualizada.`); }
  else { id = (await crearAgente(cfg)).id; console.log(`Iris creada (${id}).`); }
  await actualizarAgente(id, { estado: "activo" });
  await asignarTools(id, await idsDe("tools", tools)); await asignarSkills(id, await idsDe("skills", skills)); await asignarFlujos(id, await idsDe("flujos", flujos));

  const admin = await administradora();
  await crearPuesto({ nombre: "operaciones", titulo: "Operaciones y vigilancia", descripcion: "Sistemas vivos: proyectos locales, servicios remotos, automatizaciones", agente_id: id, reporta_a: admin?.id ?? null, responsabilidades: "Arrancar/detener/reiniciar proyectos, vigilar salud local y remota, detectar y escalar caídas, automatizaciones por evento y horario, GitHub." });

  console.log(`\n🟢 Iris lista (color ${COLOR}).\n   tools (${tools.length}): ${tools.join(", ")}\n   skills (${skills.length}): ${skills.join(", ")}\n   flujos (${flujos.length}): ${flujos.join(", ")}\n   canal: WhatsApp compartido — "hablar con Iris" / "volver".`);
  await db.end();
}
main().catch((e) => { console.error(e); process.exit(1); });