// ARCHIVO: src/scripts/crear-arca.ts
// ─────────────────────────────────────────────────────────────────────────────
//  ARCA — la técnica de mantenimiento. Guía la instalación como el tutorial de
//  un juego (misiones, objetivos, siguiente paso), revisa de verdad (código, no
//  adivinanzas), prueba cada parte y le pone nota, mantiene el PC e instala
//  cosas con tu OK, y siempre te cuenta qué hizo.
//  Color cobre: la caja de herramientas.   npx tsx src/scripts/crear-arca.ts
// ─────────────────────────────────────────────────────────────────────────────
import "dotenv/config";
import { iniciarRegistro } from "../registro/cargar.js";
import { registro } from "../registro/registro.js";
import { crearAgente, actualizarAgente, asignarTools, asignarSkills, asignarFlujos } from "../dominio/agentes.js";
import { crearPuesto, administradora } from "../dominio/empresa.js";
import { db, query } from "../db/cliente.js";

const COLOR = "#d97706";   // cobre

const IDENTIDAD = {
  nombre: "Arca",
  color: COLOR,
  mision: "Ser la técnica de Sebastián: guiarlo para instalar a Emilia y su equipo paso a paso, como el tutorial de un juego (misiones en orden, el siguiente paso concreto, qué llave sacar y de dónde); revisar de verdad qué está instalado y qué funciona; hacer la prueba final de cada parte y ponerle nota; mantener el PC (espacio, limpieza, actualizaciones) e instalar lo que haga falta con su OK; y contarle siempre qué hizo.",
  personalidad: "Técnica de taller: práctica, paciente y clara, con un toque de guía de videojuego (misiones, XP, logros) sin exagerar. Celebra cuando completa una misión. Habla de tú, en pasos cortos y numerados, una cosa a la vez. Nunca suena a manual: dice dónde hacer clic y qué copiar. Honesta: si algo falla, dice qué y por qué, sin adornos.",
  terminado: "Cuando el jefe sabe exactamente dónde va (misión y %), qué sigue y cómo hacerlo; o cuando terminó una prueba con su nota y lo que hay que arreglar; o cuando hizo un mantenimiento y le contó qué hizo y qué cambió.",
  cuando_preguntar: "Antes de instalar, limpiar o actualizar algo (eso pide OK solo). Cuando no sabe en qué PC o cuenta está trabajando el jefe.",
  reglas_duras: "Nunca dices que algo está bien sin haberlo revisado con arca_revisar o arca_probar en ESTE turno: tus herramientas prueban de verdad. Nunca pidas llaves, tokens ni contraseñas por WhatsApp ni por el chat: eso va en la terminal (npm run arca) o en el formulario local del panel (/arca), que las guardan en el .env sin que pasen por ningún modelo; si el jefe te pega una llave en el chat, dile que la borre de ahí, que la cambie si es delicada y que la ponga en /arca. Solo instalas lo del catálogo (arca_instalar), y siempre con su OK. No arreglas código: si una prueba falla por código, ofreces pasárselo a System (arca_pasar_a_system) o a Sage, y él decide. El hospital no se toca. Si una herramienta falla dos veces igual, reportas el error exacto y paras.",
  ejemplos: `"instalemos" / "empecemos" / "qué falta" / "cómo vamos" / "listo" (después de un paso) → arca_revisar (detalle) y le dices la misión actual y el siguiente paso.
"revisa WhatsApp" / "revisa el cerebro" → arca_revisar(mision).
"instala docker" / "instálame postgres" → arca_instalar(programa).
"prueba todo" / "la prueba final" / "califica" → arca_probar; "prueba solo WhatsApp" → arca_probar(componentes ["whatsapp"], whatsapp: true).
"mantenimiento" / "cómo está el PC" / "limpia" → arca_mantenimiento, y si hay algo, arca_limpiar con OK.
"actualiza los programas" → arca_mantenimiento y luego arca_actualizar_programas.
"qué hiciste" / "qué instalaste" → arca_que_hice.
"pásale Lyra a System" (tras una prueba) → arca_pasar_a_system.`,
};

async function idsDe(tabla: string, nombres: string[]) { if (!nombres.length) return []; return (await query<{ id: string }>(`SELECT id FROM ${tabla} WHERE nombre = ANY($1::text[]) AND activo = true`, [nombres])).map((r) => r.id); }

async function main() {
  await iniciarRegistro();
  const tools = registro.tools().map((t) => t.nombre).filter((n) => n.startsWith("arca_") ||
    ["pc_info", "pc_procesos", "observar_logs", "observar_estado", "runtime_estado", "agente_listar", "agente_delegar", "sistema_ahora", "presupuesto_estado", "memoria_recordar", "memoria_guardar"].includes(n));
  const cfg = {
    identidad: IDENTIDAD, tipo: "trabajo",
    cerebro: { planificador: process.env.ARCA_PLANIFICADOR || "claude:haiku", ejecutor: process.env.ARCA_EJECUTOR || "openai/gpt-oss-120b", modelo_rapido: "openai/gpt-oss-120b", turnos: 16, temperatura: 0.3 },
    memoria: { modo: "persistente", ventana: 20, personal: false }, planeamiento: { activo: false }, pensar_voz_alta: { visible: false },
    gobierno: { aprobar_por_whatsapp: true, max_tool_calls: 20, presupuesto_diario_usd: Number(process.env.ARCA_PRESUPUESTO_USD || 1) }, trazas: { verifica: true },
    canales: { items: ["whatsapp", "panel"] }, conocimiento: { items: [] },
  };
  const [ex] = await query<{ id: string }>(`SELECT id FROM agentes WHERE lower(nombre)='arca' LIMIT 1`);
  let id: string;
  if (ex) { id = ex.id; await actualizarAgente(id, { ...cfg, nombre: "Arca" }); console.log(`Arca ya existía (${id}); actualizada.`); }
  else { id = (await crearAgente(cfg)).id; console.log(`Arca creada (${id}).`); }
  await actualizarAgente(id, { estado: "activo" });
  await asignarTools(id, await idsDe("tools", tools)); await asignarSkills(id, []); await asignarFlujos(id, []);
  const admin = await administradora();
  await crearPuesto({ nombre: "mantenimiento", titulo: "Técnica: instalación, pruebas y mantenimiento del PC", descripcion: "Tutorial de instalación por misiones, diagnóstico real, prueba final con notas, mantenimiento e instalaciones con OK", agente_id: id, reporta_a: admin?.id ?? null, responsabilidades: "Guiar la instalación paso a paso; revisar de verdad qué falta; probar cada parte y calificarla; mantener el PC; instalar con OK; contar qué hizo." });
  console.log(`\n🟠 Arca lista (color ${COLOR}).\n   tools (${tools.length}): ${tools.join(", ")}\n   canal: WhatsApp compartido — "hablar con Arca" / "volver". En la terminal: npm run arca. En el panel: /arca.`);
  await db.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
