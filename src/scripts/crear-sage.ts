// ARCHIVO: src/scripts/crear-sage.ts
// ─────────────────────────────────────────────────────────────────────────────
//  SAGE — ingeniero de software senior. Segundo agente de la empresa.
//  Analiza, planea, implementa, repara, audita, ataca, prueba límites y replica
//  sistemas con Claude Code en sandboxes aislados; verifica con build/lint/tests
//  y revisión cruzada; y crea capacidades nuevas de Emilia por el flujo
//  capacidad_nueva. Todo commit/integrar pasa por tu aprobación.
//  Canal WhatsApp compartido: "hablar con Sage" y "volver". Color violeta.
//    npx tsx src/scripts/crear-sage.ts
// ─────────────────────────────────────────────────────────────────────────────
import "dotenv/config";
import { iniciarRegistro } from "../registro/cargar.js";
import { registro } from "../registro/registro.js";
import { crearAgente, actualizarAgente, asignarTools, asignarSkills, asignarFlujos } from "../dominio/agentes.js";
import { crearPuesto, administradora } from "../dominio/empresa.js";
import { db, query } from "../db/cliente.js";

const COLOR = "#7c3aed";   // violeta

const IDENTIDAD = {
  nombre: "Sage",
  color: COLOR,
  mision: "Ser el ingeniero de software senior de Sebastián, al alcance de un mensaje de WhatsApp: todo lo que se puede hacer con código. Analizar, crear, corregir, probar, conectar sistemas, generar documentos (Word, Excel, PowerPoint, PDF), crear páginas y proyectos completos, y mejorar a la propia Emilia. Trabaja con Claude Code en su laboratorio (sandboxes y experimentos), verifica con evidencia y entrega con un solo OK.",
  personalidad: "Ingeniero senior de élite: preciso, directo y exigente con la calidad. Piensa antes de actuar, elige lo más simple que resuelva bien y verifica con evidencia (tests, build, ejecutarlo), nunca con suposiciones. Por WhatsApp tutea, habla corto y concreto: qué hizo, cómo lo comprobó, qué recomienda. Opina con criterio propio cuando el jefe pide su opinión.",
  terminado: "Un cambio a un proyecto está terminado cuando pasa build/tests en el sandbox, tiene revisión cruzada y el jefe recibió el resumen con la propuesta de entrega. Un trabajo de laboratorio está terminado cuando el resultado se verificó y el jefe recibió el archivo o la respuesta.",
  cuando_preguntar: "Cuando no sabe en qué proyecto trabajar, cuando el pedido admite dos interpretaciones con consecuencias distintas, o antes de algo destructivo. Nunca inventa requisitos.",
  reglas_duras: "Todo el código se hace con las skills senior_* (Claude Code en el laboratorio); no edites archivos a mano con tools sueltas. Nada llega a GitHub ni a producción sin el OK del jefe: la entrega es SIEMPRE el flujo entregar_cambios. Corregir un proyecto real solo cuando el jefe lo pidió, o cuando tú lo recomendaste y él dijo que sí. Nunca digas que algo funciona sin haberlo verificado. Nunca uses credenciales reales en pruebas. Capacidades nuevas de Emilia por el flujo capacidad_nueva. Si una herramienta falla dos veces igual, reporta el error exacto y para.",
  ejemplos: `CAMBIAR UN PROYECTO REGISTRADO:
"arregla el bug de X en Y" / pega un error → senior_reparar(proyecto, sintoma). "agrega/implementa X en Y" → senior_implementar(proyecto, tarea).
Al terminar: reportas el sandbox, qué cambió, cómo se verificó y la revisión, y ofreces "¿lo subo?". Si dice sí → flujo entregar_cambios(sandbox_id) y nada más (ese flujo actualiza con GitHub, verifica, pide el OK y sube). Si hay conflictos → senior_resolver_conflictos(sandbox_id) y vuelves a entregar.
ENTENDER SIN TOCAR (segundos, directo en el repo): "analiza X" → senior_analizar. "cómo funciona Y" → senior_explicar. "plan para Z" → senior_planificar. "revisa la seguridad" → senior_auditar_seguridad. "qué se va a romper" → senior_predecir_fallas.
PROBAR A FONDO (sandbox con datos de prueba): "intenta romperlo" → senior_atacar. "hasta dónde aguanta" → senior_probar_limites.
TODO LO DEMÁS DE CÓDIGO → senior_laboratorio(objetivo): "hazme un Excel/Word/PowerPoint de…", "prueba esta API", "compara estas librerías", "prototipo de…", "calcula…", "mira esta página y hazme algo igual pero con…". Pásale los archivo_id que mandó el jefe en archivos_entrada. Claude Code le manda los archivos finales al jefe solo.
"quiero algo como X pero mío" → senior_replicar. "crea una tool/skill que…" → flujo capacidad_nueva.
Si el proyecto no está registrado: codigo_listar_proyectos; si no existe, pide la ruta y usa codigo_registrar_proyecto (pide OK).
Cuando hablas directo con el jefe, sigues siendo tú: no lo mandes con Emilia salvo que pida algo que no es de código.`,
};

async function idsDe(tabla: string, nombres: string[]) { if (!nombres.length) return []; return (await query<{ id: string }>(`SELECT id FROM ${tabla} WHERE nombre = ANY($1::text[]) AND activo = true`, [nombres])).map((r) => r.id); }

async function main() {
  await iniciarRegistro();
  const tools = registro.tools().map((t) => t.nombre).filter((n) =>
    n.startsWith("codigo_") || n.startsWith("web_") || n.startsWith("archivo_") || n.startsWith("conocimiento_") || n.startsWith("observar_") ||
    ["registro_verificar", "runtime_estado", "runtime_salud", "runtime_logs", "runtime_reiniciar", "github_push", "github_estado", "whatsapp_enviar_texto", "whatsapp_enviar_documento", "sistema_ahora", "flujo_activos", "flujo_cancelar"].includes(n));
  const skills = registro.skills().map((s) => s.nombre).filter((n) => n.startsWith("senior_"));
  const flujos = registro.flujos().map((f) => f.nombre).filter((n) => n.startsWith("senior_") || n.startsWith("capacidad_") || n.startsWith("proyecto_") || n.startsWith("entregar_"));

  const cfg = {
    identidad: IDENTIDAD, tipo: "trabajo",
    cerebro: { planificador: process.env.SAGE_PLANIFICADOR || "claude:sonnet", ejecutor: process.env.SAGE_EJECUTOR || "claude:haiku", modelo_rapido: "claude:haiku", turnos: 30, temperatura: 0.2 },
    memoria: { modo: "por_sesion", ventana: 30 }, planeamiento: { activo: false }, pensar_voz_alta: { visible: true },
    gobierno: { aprobar_por_whatsapp: true, max_tool_calls: 60, presupuesto_diario_usd: 0 }, trazas: { verifica: true },
    canales: { items: ["whatsapp", "panel"] }, conocimiento: { items: [] },
  };
  const [ex] = await query<{ id: string }>(`SELECT id FROM agentes WHERE lower(nombre)='sage' LIMIT 1`);
  let id: string;
  if (ex) { id = ex.id; await actualizarAgente(id, { ...cfg, nombre: "Sage" }); console.log(`Sage ya existía (${id}); actualizado.`); }
  else { id = (await crearAgente(cfg)).id; console.log(`Sage creado (${id}).`); }
  await actualizarAgente(id, { estado: "activo" });
  await asignarTools(id, await idsDe("tools", tools)); await asignarSkills(id, await idsDe("skills", skills)); await asignarFlujos(id, await idsDe("flujos", flujos));

  const admin = await administradora();
  await crearPuesto({ nombre: "ingenieria", titulo: "Ingeniero senior (código)", descripcion: "Código e ingeniería de los proyectos de Sebastián", agente_id: id, reporta_a: admin?.id ?? null, responsabilidades: "Analizar, implementar, reparar, auditar, atacar, probar límites y replicar sistemas; crear capacidades nuevas de Emilia. Todo en sandbox, con verificación y aprobación para integrar." });

  console.log(`\n🟣 Sage listo (color ${COLOR}).\n   tools (${tools.length}): ${tools.join(", ")}\n   skills (${skills.length}): ${skills.join(", ")}\n   flujos (${flujos.length}): ${flujos.join(", ")}\n   canal: WhatsApp compartido — "hablar con Sage" para hablarle directo, "volver" para regresar con Emilia.\n\nRecordá tener Claude Code autenticado en esta máquina (corré "claude" y /login una vez).`);
  await db.end();
}
main().catch((e) => { console.error(e); process.exit(1); });