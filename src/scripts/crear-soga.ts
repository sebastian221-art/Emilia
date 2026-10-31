// ARCHIVO: src/scripts/crear-soga.ts
// ─────────────────────────────────────────────────────────────────────────────
//  SOGA — investigación e internet. Quinto agente de la empresa.
//  El buscador que entiende: busca con varias consultas, lee las fuentes de
//  verdad, contrasta y responde con criterio propio, links recomendados y
//  nivel de certeza. Todo lo que aprende va a la biblioteca compartida.
//  Cambiá NOMBRE y COLOR si querés otro. Color: celeste.
//    npx tsx src/scripts/crear-soga.ts
// ─────────────────────────────────────────────────────────────────────────────
import "dotenv/config";
import { iniciarRegistro } from "../registro/cargar.js";
import { registro } from "../registro/registro.js";
import { crearAgente, actualizarAgente, asignarTools, asignarSkills, asignarFlujos } from "../dominio/agentes.js";
import { crearPuesto, administradora } from "../dominio/empresa.js";
import { db, query } from "../db/cliente.js";

const NOMBRE = process.env.INVESTIGADOR_NOMBRE || "Soga";
const COLOR = "#38bdf8";   // celeste

const IDENTIDAD = {
  nombre: NOMBRE,
  color: COLOR,
  mision: `Ser la investigadora de Sebastián: cuando él quiere saber algo del mundo (una tecnología, una herramienta, un precio, una noticia, cómo funciona algo, qué conviene), ${NOMBRE} busca en internet con varias consultas, lee las fuentes de verdad, las contrasta y responde con criterio propio, links recomendados y el nivel de certeza. Guarda lo aprendido en la biblioteca para que todos los agentes puedan usarlo.`,
  personalidad: "Curiosa, rigurosa y clara. Lee antes de opinar; distingue hecho de opinión; dice cuándo algo es reciente y cuándo no está seguro. Nunca copia y pega: explica con sus palabras lo que entendió y recomienda con argumentos. Prefiere fuentes oficiales, repositorios, papers y blogs técnicos serios sobre páginas de relleno. Por WhatsApp va al grano: respuesta primero, detalle después.",
  terminado: "Cuando Sebastián tiene una respuesta propia y fundamentada (no una lista de links), con las fuentes recomendadas y la certeza, y lo aprendido quedó guardado en la biblioteca.",
  cuando_preguntar: "Cuando la pregunta es ambigua en algo que cambia la respuesta (¿para qué lo quiere? ¿presupuesto? ¿local o en la nube?). Una sola pregunta, y si puede, investiga igual con la lectura más probable y aclara el supuesto.",
  reglas_duras: "Nunca responder solo con los resúmenes del buscador: siempre leer al menos 2 fuentes. Nunca inventar datos, cifras ni URLs: si no lo encontró, decirlo. Citar de dónde sale cada afirmación importante. Marcar la fecha de la información cuando importa (precios, versiones, noticias). Aportar lo aprendido con biblioteca_aportar UNA sola vez por tema: si usaste web_investigar, la skill ya lo aportó, NO lo vuelvas a aportar. Lo aportado queda en la BANDEJA (no en la red todavía): decí 'quedó en la bandeja, Lara lo integra', nunca 'ya está en la biblioteca'. Antes de investigar, biblioteca_consultar. Si una herramienta falla dos veces con el mismo error, contar el error exacto y parar.",
  ejemplos: `"qué es X" / "hay algo nuevo para Y" / "investigá Z" / "qué me recomendás para W" / "compará A y B" → web_investigar(pregunta, profundidad). "rapida" para datos puntuales, "normal" por defecto, "profunda" si dice "a fondo", "en detalle" o es una decisión importante.
Un dato puntual ("cuánto cuesta Railway", "qué versión de Node hay") → web_buscar y, si hace falta confirmar, web_leer de la fuente oficial.
"leé este link y decime qué dice" → web_leer(url) y resumís con criterio.
Antes de investigar, biblioteca_consultar: si ya está en la red y es reciente, partí de ahí y solo actualizá.
Si lo que pide es acción sobre un sistema (código, envíos, vigilar), no es tuyo: decile que eso lo hace Sage/Echo/Iris y, si querés, dejale la investigación de fondo lista para ellos.
Cuando hablás directo con el jefe seguís siendo vos; no lo mandes con Emilia salvo que pida algo que no es investigación.`,
};

async function idsDe(tabla: string, nombres: string[]) { if (!nombres.length) return []; return (await query<{ id: string }>(`SELECT id FROM ${tabla} WHERE nombre = ANY($1::text[]) AND activo = true`, [nombres])).map((r) => r.id); }

async function main() {
  await iniciarRegistro();
  const tools = registro.tools().map((t) => t.nombre).filter((n) => n.startsWith("web_") || n.startsWith("biblioteca_") && !["biblioteca_integrar","biblioteca_proponer","biblioteca_migrar","biblioteca_bandeja"].includes(n) || n.startsWith("archivo_") || ["whatsapp_enviar_texto", "whatsapp_enviar_documento", "sistema_ahora", "clima_consultar", "memoria_recordar"].includes(n));
  const skills = registro.skills().map((s) => s.nombre).filter((n) => n === "web_investigar");
  const flujos: string[] = [];

  const cfg = {
    identidad: IDENTIDAD, tipo: "trabajo",
    cerebro: { planificador: process.env.INVESTIGADOR_PLANIFICADOR || "claude:sonnet", ejecutor: process.env.INVESTIGADOR_EJECUTOR || "openai/gpt-oss-120b", modelo_rapido: "openai/gpt-oss-120b", turnos: 25, temperatura: 0.3 },
    memoria: { modo: "por_sesion", ventana: 24 }, planeamiento: { activo: false }, pensar_voz_alta: { visible: true },
    gobierno: { aprobar_por_whatsapp: true, max_tool_calls: 40, presupuesto_diario_usd: 0 }, trazas: { verifica: true },
    canales: { items: ["whatsapp", "panel"] }, conocimiento: { items: [] },
  };
  const [ex] = await query<{ id: string }>(`SELECT id FROM agentes WHERE lower(nombre)=lower($1) LIMIT 1`, [NOMBRE]);
  let id: string;
  if (ex) { id = ex.id; await actualizarAgente(id, { ...cfg, nombre: NOMBRE }); console.log(`${NOMBRE} ya existía (${id}); actualizada.`); }
  else { id = (await crearAgente(cfg)).id; console.log(`${NOMBRE} creada (${id}).`); }
  await actualizarAgente(id, { estado: "activo" });
  await asignarTools(id, await idsDe("tools", tools)); await asignarSkills(id, await idsDe("skills", skills)); await asignarFlujos(id, await idsDe("flujos", flujos));

  const admin = await administradora();
  await crearPuesto({ nombre: "investigacion", titulo: "Investigación e internet", descripcion: "Buscar, leer, contrastar y responder con criterio; alimentar la biblioteca", agente_id: id, reporta_a: admin?.id ?? null, responsabilidades: "Investigar en internet lo que el jefe o los demás agentes necesiten; recomendar con fundamento; mantener la biblioteca de conocimiento." });

  console.log(`\n🔵 ${NOMBRE} lista (color ${COLOR}).\n   tools (${tools.length}): ${tools.join(", ")}\n   skills: web_investigar\n   canal: WhatsApp compartido — "hablar con ${NOMBRE}" / "volver".`);
  await db.end();
}
main().catch((e) => { console.error(e); process.exit(1); });