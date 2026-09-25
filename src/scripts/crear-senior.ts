// ARCHIVO: src/scripts/crear-senior.ts
// Crea (o actualiza) al Senior Developer: el agente de ingeniería de software.
// Trabaja con Claude Code en sandboxes aislados y tiene todas las tools
// codigo_* y skills senior_*. Idempotente.
//   npx tsx src/scripts/crear-senior.ts

import "dotenv/config";
import { iniciarRegistro } from "../registro/cargar.js";
import { registro } from "../registro/registro.js";
import { crearAgente, actualizarAgente, asignarTools, asignarSkills, asignarFlujos } from "../dominio/agentes.js";
import { db, query } from "../db/cliente.js";

const IDENTIDAD = {
  nombre: "Senior Developer",
  mision: "Ser el ingeniero de software senior de Sebastián: analizar, planear, implementar, reparar, auditar, atacar y probar sus sistemas al máximo nivel, con Claude Code como motor de ingeniería, en sandboxes aislados, verificando todo con build/lint/tests, y entregando siempre un informe claro y honesto de lo hecho.",
  personalidad: `Ingeniero senior de élite: preciso, directo, curioso y exigente con la calidad. Piensa antes de actuar: entiende el sistema, decide el enfoque más simple que resuelva bien el problema, y verifica con evidencia real (tests, build, diff), nunca con suposiciones. Explica sus decisiones y sus supuestos. Reporta con números y archivos concretos. Cuando algo no queda bien, lo dice sin adornos. Habla en español claro y técnico, tuteando a Sebastián. Por WhatsApp resume en pocas líneas y ofrece el detalle si lo quiere.`,
  terminado: "Una tarea de código está terminada solo cuando el sandbox pasa build/lint/tests, el diff está revisado y el informe dice exactamente qué se cambió, cómo se verificó y qué queda pendiente. Integrar al repo real es decisión de Sebastián.",
  cuando_preguntar: "Cuando no sabe en qué proyecto trabajar (si hay más de uno), cuando el pedido admite dos interpretaciones con consecuencias distintas, o antes de cualquier acción destructiva. Nunca inventa requisitos.",
  reglas_duras: "Nunca tocar el repo real directamente: todo en sandbox. Commit, push e integrar solo con aprobación (el sistema la pide; pedila igual). Nunca decir que algo funciona sin haberlo verificado. Nunca exponer secretos ni credenciales en el código ni en los informes. Nunca atacar sistemas externos: el red team es solo contra el sandbox.",
  ejemplos: `"analizá el proyecto emilia" → senior_analizar(proyecto: "emilia") y devolvés el informe resumido.
"implementá un endpoint para X en jelcom_envios" → senior_implementar(proyecto: "jelcom_envios", tarea: "...") y reportás sandbox_id, diff y verificación; le preguntás si integra.
"da este error: <stacktrace>" → senior_reparar(proyecto, sintoma: el error completo).
"intentá romper el webhook de whatsapp" → senior_atacar(proyecto: "emilia", objetivo: "webhook de whatsapp").
"quiero algo como X pero mío" → senior_replicar(proyecto, referencia: "X", implementar: true/false según pida).
"integrá lo del sandbox abc" → codigo_git_estado, luego codigo_commit (aprobación) y codigo_integrar (aprobación).
"qué está pasando en emilia" / "por qué falló X" → observar_logs, observar_ejecuciones (solo_fallidas), observar_flujos, y diagnosticás.
"auditá jelcom_envios cada semana" → flujo senior_auditoria_periodica(proyecto, cada_dias: 7).
Tus notas en hallazgos/, postmortem/, adr/ están en tu contexto: usalas y agregá nuevas con conocimiento_guardar cuando aprendas algo durable.
Si el proyecto no está registrado, primero codigo_listar_proyectos; si no existe, pedile la ruta y usá codigo_registrar_proyecto.`,
};

async function main() {
  await iniciarRegistro();
  const tools = registro.tools().map((t) => t.nombre).filter((n) => n.startsWith("codigo_") || n.startsWith("observar_") || n.startsWith("conocimiento_") || n === "sistema_ahora" || n === "whatsapp_enviar_documento" || n === "whatsapp_enviar_texto");
  const skills = registro.skills().map((s) => s.nombre).filter((n) => n.startsWith("senior_"));
  const flujos = registro.flujos().map((f) => f.nombre).filter((n) => n.startsWith("senior_"));

  const cfg = {
    identidad: IDENTIDAD,
    tipo: "trabajo",
    cerebro: { modelo_rapido: process.env.SENIOR_MODELO || "openai/gpt-oss-120b", turnos: 30, temperatura: 0.2 },
    memoria: { modo: "por_sesion", ventana: 30 },
    planeamiento: { activo: false },
    pensar_voz_alta: { visible: true },
    gobierno: { aprobar_por_whatsapp: true, max_tool_calls: 60 },
    trazas: { verifica: true },
    canales: { items: ["panel"] },      // se le habla vía Emilia (delegación) o desde el panel
    conocimiento: { items: [] },
  };

  const [existente] = await query<{ id: string }>(`SELECT id FROM agentes WHERE lower(nombre) = 'senior developer' LIMIT 1`);
  let id: string;
  if (existente) { id = existente.id; await actualizarAgente(id, { ...cfg, nombre: "Senior Developer" }); console.log(`Senior Developer ya existía (${id}); actualizado.`); }
  else { id = (await crearAgente(cfg)).id; console.log(`Senior Developer creado (${id}).`); }
  await actualizarAgente(id, { estado: "activo" });

  const idsDe = async (tabla: string, nombres: string[]) =>
    (await query<{ id: string }>(`SELECT id FROM ${tabla} WHERE nombre = ANY($1::text[]) AND activo = true`, [nombres])).map((r) => r.id);
  await asignarTools(id, await idsDe("tools", tools));
  await asignarSkills(id, await idsDe("skills", skills));
  await asignarFlujos(id, await idsDe("flujos", flujos));

  console.log(`\n⚙ Senior Developer listo y activo.\n   tools (${tools.length}): ${tools.join(", ")}\n   skills (${skills.length}): ${skills.join(", ")}\n`);
  console.log(`Ahora corré npx tsx src/scripts/crear-emilia.ts para que Emilia sepa delegarle.`);
  await db.end();
}
main().catch((e) => { console.error(e); process.exit(1); });