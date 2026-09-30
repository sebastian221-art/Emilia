// ARCHIVO: src/motor/enrutador.ts
// ─────────────────────────────────────────────────────────────────────────────
//  ENRUTADOR DE HERRAMIENTAS
//  Groq acepta máximo 128 funciones por llamada y un agente grande supera eso.
//  Además, darle 130 funciones a un modelo empeora sus decisiones. Por tarea:
//   1. Núcleo siempre activo (sistema, memoria, observar, agente, registro, whatsapp básico).
//   2. Un modelo pequeño elige qué MÓDULOS son relevantes para el pedido.
//   3. Si el agente descubre que le falta un módulo, llama modulo_cargar y
//      sus herramientas entran en los turnos siguientes.
//  .env: ENRUTADOR_MODELO (defecto llama-3.1-8b-instant), ENRUTADOR_MAX_MODULOS (8)
// ─────────────────────────────────────────────────────────────────────────────
import type { ChatCompletionTool } from "groq-sdk/resources/chat/completions";
import type { Invocable } from "./herramientas.js";
import { llamarModelo } from "./groq.js";

export const TOPE_GROQ = 128;
const NUCLEO = new Set(["sistema", "memoria", "observar", "agente", "registro", "modulo", "archivo"]);
const NUCLEO_TOOLS = new Set(["whatsapp_enviar_texto", "whatsapp_enviar_documento", "whatsapp_listar_adjuntos", "vision_analizar", "flujo_activos", "flujo_cancelar", "pc_ver_pantalla", "pc_elementos", "pc_leer_ventana", "pc_ventanas"]);

/** Descripción corta de cada módulo, para que el enrutador (y el agente) sepan qué hay. */
export const MODULOS_DESC: Record<string, string> = {
  sistema: "utilidades (hora, eco)", whatsapp: "enviar mensajes/plantillas/archivos por WhatsApp", jelcom: "Jelcom Envíos: campañas, cuentas, envíos SMS/WhatsApp, bases, informes",
  codigo: "sandboxes, Claude Code, diff, verificar, commit/integrar", senior: "ingeniería: analizar, planificar, implementar, reparar, auditar, atacar, replicar código", runtime: "arrancar/detener/reiniciar proyectos, logs, salud",
  proyecto: "crear proyectos desde cero, instalar deps", github: "repos, push, PR en GitHub", vigilar: "vigilancia de proyectos en ejecución", capacidad: "crear capacidades nuevas de Emilia (auto-mejora)",
  agente: "listar/delegar a otros agentes", empresa: "puestos, trabajadores, organigrama", observar: "logs, ejecuciones, flujos, actividad del sistema", conocimiento: "notas durables del agente (hallazgos, postmortems)",
  memoria: "memoria de largo plazo sobre el jefe", vision: "entender imágenes", voz: "hablar y transcribir audio", pc: "el computador: archivos, pantalla, abrir/cerrar programas, PowerShell, controles por accesibilidad, y OPERARLO para cumplir tareas (pc_operar)", navegador: "navegar páginas web, leer, clic, escribir",
  disparador: "automatizaciones: eventos, cron, webhooks", evento: "emitir/ver eventos", registro: "recargar/verificar/asignar capacidades", flujo: "flujos activos y cancelarlos", evaluacion: "evaluar agentes y ver gasto", presupuesto: "gasto de tokens/dinero",
  clima: "clima por ciudad", archivo: "leer/listar archivos recibidos, convertir documentos en archivos", office: "Excel, Word y Outlook sin abrir la interfaz (celdas, documentos, correos)", grabacion: "grabar lo que hace el jefe en el PC y convertirlo en receta",
};

function moduloDe(nombre: string): string { return nombre.split("_")[0]; }

/** Descripción de un módulo: la conocida, o derivada de sus propias tools (así las capacidades nuevas quedan enrutables solas). */
function descModulo(m: string, invocables: Map<string, Invocable>): string {
  if (MODULOS_DESC[m]) return MODULOS_DESC[m];
  const props = [...invocables.values()].filter((i) => moduloDe(i.nombre) === m).map((i) => i.descripcion.split(/[.(]/)[0].trim().slice(0, 50));
  return props.slice(0, 3).join("; ") || "…";
}

export function resumenModulos(invocables: Map<string, Invocable>): string {
  const mods = new Map<string, number>();
  for (const n of invocables.keys()) mods.set(moduloDe(n), (mods.get(moduloDe(n)) || 0) + 1);
  return [...mods.entries()].map(([m, n]) => `${m} (${n}: ${descModulo(m, invocables)})`).join("; ");
}

/** Elige módulos relevantes para el pedido. Devuelve el conjunto de módulos activos. */
export async function elegirModulos(pedido: string, invocables: Map<string, Invocable>, contexto?: string): Promise<Set<string>> {
  const todos = [...new Set([...invocables.keys()].map(moduloDe))];
  const activos = new Set(todos.filter((m) => NUCLEO.has(m)));
  const candidatos = todos.filter((m) => !NUCLEO.has(m));
  if (invocables.size <= TOPE_GROQ - 1 || !candidatos.length) { for (const m of candidatos) activos.add(m); return activos; }

  const max = Number(process.env.ENRUTADOR_MAX_MODULOS || 8);
  const lista = candidatos.map((m) => `- ${m}: ${descModulo(m, invocables)}`).join("\n");
  try {
    const r = await llamarModelo([{ role: "user", content: `Elegí qué módulos de herramientas hacen falta para atender este pedido. Sé generoso con los relacionados (máx ${max}).\nPedido: "${pedido.slice(0, 800)}"${contexto ? `\nContexto: ${contexto.slice(0, 300)}` : ""}\nMódulos:\n${lista}\nRespondé SOLO JSON: {"modulos":["a","b"]}` }], [], { modelo: process.env.ENRUTADOR_MODELO || "llama-3.1-8b-instant", temperatura: 0 });
    const parsed = JSON.parse(r.texto.replace(/```json|```/g, "").trim());
    for (const m of (parsed.modulos || []).slice(0, max)) if (candidatos.includes(m)) activos.add(m);
  } catch { /* heurística abajo */ }
  // Heurística de respaldo por palabras clave (siempre suma).
  const t = pedido.toLowerCase();
  const claves: Record<string, RegExp> = { jelcom: /env[ií]o|campa[ñn]|sms|base de|informe|jelcom|cajasan/, codigo: /c[oó]digo|sandbox|diff|commit|integr|repo|bug|error en|implement|endpoint|funci[oó]n|clase|archivo\.ts/, senior: /analiz|implement|repar|arregl|audit|segur|romper|l[ií]mite|replic|plan|explic[aá] c[oó]mo/, runtime: /arranc|deten|reinici|corriendo|vivo|logs? de|salud/, proyecto: /proyecto nuevo|cre[aá] (un |el )?proyecto|instal[aá]/, github: /github|push|pull request|pr\b/, vigilar: /vigil|pendiente de|guardia/, capacidad: /tool nueva|capacidad|habilidad|cre[aá] una tool|skill nueva/, empresa: /puesto|empresa|organigrama|trabajador|encargad/, pc: /pantalla|escritorio|descargas|archivo|carpeta|abr[ií]|cerr[aá]|powershell|programa|portapapeles|calculadora|excel|word|clic|escrib[ií] en|en (la|el) (app|ventana)|hac[eé] en|ventana|controles|botones|men[uú]|bloc|notepad|pc\b|computador/, navegador: /entr[aá] a|p[aá]gina|web|navega|http/, voz: /audio|voz|habl/, disparador: /cuando|cada vez|todos los|automatiz|webhook|cron|program[aá]/, evaluacion: /evalua|gast/, presupuesto: /gast|presupuesto|cu[aá]nto cost/, conocimiento: /nota|hallazgo|postmortem/, clima: /clima|temperatura|lluvia/ };
  for (const [m, re] of Object.entries(claves)) if (candidatos.includes(m) && re.test(t)) activos.add(m);
  return activos;
}

/** Definiciones para el modelo: núcleo + módulos activos + la pseudo-tool modulo_cargar. Recorta a 128. */
export function definicionesActivas(invocables: Map<string, Invocable>, activos: Set<string>): ChatCompletionTool[] {
  const lista = [...invocables.values()].filter((i) => activos.has(moduloDe(i.nombre)) || NUCLEO_TOOLS.has(i.nombre));
  // Sin "requiere aprobación" en lo que ve el modelo: el sistema la pide solo, y si el modelo lo lee, pregunta por texto y no actúa.
  const defs: ChatCompletionTool[] = lista.map((i) => ({ type: "function", function: { name: i.nombre, description: i.descripcion.replace(/\s*Requiere aprobación[^.]*\.?/gi, "").trim(), parameters: i.parametros as any } }));
  const faltan = [...new Set([...invocables.keys()].map(moduloDe))].filter((m) => !activos.has(m));
  if (faltan.length) defs.push({ type: "function", function: { name: "modulo_cargar", description: `Carga las herramientas de un módulo que no tenés activo ahora. Módulos disponibles: ${faltan.map((m) => `${m} (${descModulo(m, invocables)})`).join("; ")}. Después de cargarlo, sus herramientas aparecen en tu lista.`, parameters: { type: "object", properties: { modulo: { type: "string", description: "Nombre del módulo." } }, required: ["modulo"] } } });
  return defs.slice(0, TOPE_GROQ);
}

export const esPseudoToolModulo = (nombre: string) => nombre === "modulo_cargar";
export { moduloDe };