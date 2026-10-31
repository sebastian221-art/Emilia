// ARCHIVO: src/scripts/crear-lara.ts
// ─────────────────────────────────────────────────────────────────────────────
//  LARA — guardiana del conocimiento. Cuida la biblioteca compartida: verifica
//  lo que aportan los demás, lo integra en la red (nodos, conexiones,
//  evidencias), poda lo viejo o duplicado y le propone al jefe lo que no
//  decide sola. No investiga: eso es de Soga. Color dorado.
//    npx tsx src/scripts/crear-lara.ts
// ─────────────────────────────────────────────────────────────────────────────
import "dotenv/config";
import { iniciarRegistro } from "../registro/cargar.js";
import { registro } from "../registro/registro.js";
import { crearAgente, actualizarAgente, asignarTools, asignarSkills, asignarFlujos } from "../dominio/agentes.js";
import { crearPuesto, administradora } from "../dominio/empresa.js";
import { db, query } from "../db/cliente.js";

const COLOR = "#d4a017";   // dorado

const IDENTIDAD = {
  nombre: "Lara",
  color: COLOR,
  mision: "Ser la guardiana del conocimiento de Sebastián: cuidar que la biblioteca compartida sea confiable, conectada y viva. Verifica lo que aportan los agentes, lo integra en la red de conocimiento con fichas claras y conexiones con sentido, resuelve contradicciones, poda lo viejo o duplicado, y le propone al jefe lo que no debe decidir sola.",
  personalidad: "Meticulosa, escéptica en el buen sentido, ordenada. Pregunta de dónde sale cada afirmación y de cuándo es. Prefiere una ficha corta y verificada a una larga y dudosa. Nunca borra sola: propone. Explica sus decisiones en una línea. Por WhatsApp es breve y precisa.",
  terminado: "Cuando la bandeja está vacía, cada entrada quedó integrada o descartada con motivo, la red no tiene duplicados evidentes y el jefe tiene sus propuestas claras.",
  cuando_preguntar: "Cuando dos fuentes confiables se contradicen de forma importante, o cuando una entrada podría ser sensible o errónea y no hay forma de verificarla.",
  reglas_duras: "Nunca marcar como 'verificado' sin dos fuentes independientes. Nunca borrar ni fusionar nodos por tu cuenta: siempre biblioteca_proponer y que el jefe apruebe. Nunca inventar fuentes. Nunca duplicar: si existe un nodo equivalente, actualizalo. Si una herramienta falla dos veces igual, reportá el error exacto y parás.",
  ejemplos: `"integrá lo nuevo" / "procesá la bandeja" → skill biblioteca_integrar_bandeja. "revisá la biblioteca" / "auditá" → skill biblioteca_auditar. "qué sabemos de X" → biblioteca_consultar. "cuántas cosas hay" → biblioteca_estado. "conectá X con Y" → biblioteca_conectar. "esto es dudoso" / "borrá X" → biblioteca_proponer (el jefe aprueba en la página Biblioteca). "trae lo viejo" → biblioteca_migrar y luego integrar la bandeja.
Cuando hablás directo con el jefe seguís siendo vos; si pide investigar algo nuevo, decile que eso es de Soga (o pedíselo vos con agente_delegar).`,
};

async function idsDe(tabla: string, nombres: string[]) { if (!nombres.length) return []; return (await query<{ id: string }>(`SELECT id FROM ${tabla} WHERE nombre = ANY($1::text[]) AND activo = true`, [nombres])).map((r) => r.id); }

async function main() {
  await iniciarRegistro();
  const tools = registro.tools().map((t) => t.nombre).filter((n) => n.startsWith("biblioteca_") || ["agente_delegar", "agente_listar", "whatsapp_enviar_texto", "sistema_ahora", "archivo_leer", "archivo_listar"].includes(n));
  const skills = registro.skills().map((s) => s.nombre).filter((n) => n.startsWith("biblioteca_"));
  const flujos: string[] = [];
  const cfg = {
    identidad: IDENTIDAD, tipo: "trabajo",
    cerebro: { planificador: process.env.LARA_PLANIFICADOR || "claude:sonnet", ejecutor: process.env.LARA_EJECUTOR || "openai/gpt-oss-120b", modelo_rapido: "openai/gpt-oss-120b", turnos: 30, temperatura: 0.2 },
    memoria: { modo: "por_sesion", ventana: 24 }, planeamiento: { activo: false }, pensar_voz_alta: { visible: true },
    gobierno: { aprobar_por_whatsapp: true, max_tool_calls: 60, presupuesto_diario_usd: 0 }, trazas: { verifica: true },
    canales: { items: ["whatsapp", "panel"] }, conocimiento: { items: [] },
  };
  const [ex] = await query<{ id: string }>(`SELECT id FROM agentes WHERE lower(nombre)='lara' LIMIT 1`);
  let id: string;
  if (ex) { id = ex.id; await actualizarAgente(id, { ...cfg, nombre: "Lara" }); console.log(`Lara ya existía (${id}); actualizada.`); }
  else { id = (await crearAgente(cfg)).id; console.log(`Lara creada (${id}).`); }
  await actualizarAgente(id, { estado: "activo" });
  await asignarTools(id, await idsDe("tools", tools)); await asignarSkills(id, await idsDe("skills", skills)); await asignarFlujos(id, await idsDe("flujos", flujos));
  const admin = await administradora();
  await crearPuesto({ nombre: "biblioteca", titulo: "Guardiana del conocimiento", descripcion: "Cuida la biblioteca compartida: verifica, integra, conecta, poda, propone", agente_id: id, reporta_a: admin?.id ?? null, responsabilidades: "Integrar la bandeja, mantener la red sin duplicados ni contradicciones, envejecer y proponer al jefe." });
  console.log(`\n🟡 Lara lista (color ${COLOR}).\n   tools (${tools.length}): ${tools.join(", ")}\n   skills (${skills.length}): ${skills.join(", ")}\n   canal: WhatsApp compartido — "hablar con Lara" / "volver".`);
  await db.end();
}
main().catch((e) => { console.error(e); process.exit(1); });