// ARCHIVO: src/motor/memoria.ts
// ─────────────────────────────────────────────────────────────────────────────
//  MEMORIA CONVERSACIONAL
//  Lo que el agente "recuerda" de una conversación:
//   - un resumen comprimido de lo viejo (guardado en la conversación)
//   - los últimos N mensajes tal cual (ventana)
//  Se controla con la pieza `memoria` del esqueleto:
//     memoria.modo     = 'ninguna' | 'por_sesion' | 'persistente'
//     memoria.ventana  = cuántos mensajes recientes entran tal cual (def. 20)
//  'por_sesion' y 'persistente' se comportan igual por ahora: la conversación
//  ES la sesión y persiste. La diferencia (memoria entre conversaciones
//  distintas) es trabajo futuro.
// ─────────────────────────────────────────────────────────────────────────────

import type { ChatCompletionMessageParam } from "groq-sdk/resources/chat/completions";
import { llamarModelo } from "./groq.js";
import { mensajesDesde, guardarResumen, ultimosMensajes, type Conversacion, type Mensaje } from "../dominio/conversaciones.js";
import { guardarHecho, listarHechos } from "../dominio/memoria-lp.js";
import { query } from "../db/cliente.js";

const VENTANA_DEF = 20;
const UMBRAL_RESUMEN = 40;   // cuando hay más de esto sin resumir, se resume lo que sobra de la ventana

export interface ConfigMemoria { modo?: string; ventana?: number }

/**
 * Historial listo para el modelo: [resumen como system] + últimos N mensajes.
 * No incluye el mensaje que se está procesando ahora (se agrega aparte).
 */
export async function historialParaModelo(conv: Conversacion, cfg: ConfigMemoria | undefined, excluirUltimo = true): Promise<ChatCompletionMessageParam[]> {
  const modo = cfg?.modo || "por_sesion";
  if (modo === "ninguna") return [];

  const ventana = Math.max(2, Number(cfg?.ventana) || VENTANA_DEF);
  const salida: ChatCompletionMessageParam[] = [];

  if (conv.resumen) {
    salida.push({ role: "system", content: `Resumen de lo conversado antes con este contacto (memoria):\n${conv.resumen}` });
  }

  let recientes = await ultimosMensajes(conv.id, ventana + (excluirUltimo ? 1 : 0));
  if (excluirUltimo && recientes.length) recientes = recientes.slice(0, -1);
  // Solo mensajes posteriores al resumen (los anteriores ya están comprimidos).
  if (conv.resumen_hasta) recientes = recientes.filter((m) => m.creado_en > conv.resumen_hasta!);

  for (const m of recientes) {
    if (m.rol === "usuario") salida.push({ role: "user", content: m.contenido });
    else if (m.rol === "agente") salida.push({ role: "assistant", content: m.contenido });
    // pensamiento/sistema no se reinyectan
  }
  return salida;
}

/**
 * Si la conversación acumuló muchos mensajes sin resumir, comprime los que
 * quedan fuera de la ventana en un resumen (fusionado con el anterior).
 * Se llama al terminar cada tarea; no bloquea la respuesta al usuario.
 */
export async function resumirSiHaceFalta(conv: Conversacion, cfg: ConfigMemoria | undefined): Promise<void> {
  const modo = cfg?.modo || "por_sesion";
  if (modo === "ninguna") return;
  const ventana = Math.max(2, Number(cfg?.ventana) || VENTANA_DEF);

  const sinResumir = (await mensajesDesde(conv.id, conv.resumen_hasta)).filter((m) => m.rol === "usuario" || m.rol === "agente");
  if (sinResumir.length <= UMBRAL_RESUMEN) return;

  const aResumir = sinResumir.slice(0, sinResumir.length - ventana);
  if (!aResumir.length) return;

  const texto = aResumir.map((m) => `${m.rol === "usuario" ? "Usuario" : "Agente"}: ${m.contenido}`).join("\n");
  const prompt = [
    conv.resumen ? `Resumen previo:\n${conv.resumen}\n\n` : "",
    `Nuevos mensajes a incorporar:\n${texto}\n\n`,
    "Escribí UN resumen actualizado (máx. 250 palabras) en español, en tercera persona, con: qué pidió el usuario, qué se hizo, datos concretos (nombres, números, ids, fechas), decisiones tomadas y pendientes. Sin saludos ni relleno. Solo el resumen.",
  ].join("");

  try {
    const r = await llamarModelo([{ role: "user", content: prompt }], []);
    if (r.texto.trim()) {
      const hasta = aResumir[aResumir.length - 1].creado_en;
      await guardarResumen(conv.id, r.texto.trim(), hasta);
      console.log(`[memoria] Resumida conversación ${conv.id}: ${aResumir.length} mensajes comprimidos.`);
    }
  } catch (e: any) {
    console.warn(`[memoria] No se pudo resumir ${conv.id}: ${e?.message || e}`);
  }
}

/** Formato corto de un mensaje para trazas/UI. */
export function resumenMensaje(m: Mensaje): string {
  return `${m.rol}: ${m.contenido.slice(0, 80)}`;
}


// ─── Memoria de largo plazo: extracción automática ──────────────────────────
const CADA_MENSAJES = Number(process.env.MEMORIA_LP_CADA || 6);

/**
 * Cada N mensajes del jefe en una conversación, lee lo nuevo y extrae hechos
 * DURABLES sobre él o su mundo (no tareas del momento). Solo en modo
 * 'persistente'. Los guarda con upsert por clave; lo que ya está no se repite.
 */
export async function extraerHechosSiHaceFalta(conv: Conversacion, cfg: ConfigMemoria | undefined, esJefe: boolean): Promise<void> {
  if ((cfg?.modo || "por_sesion") !== "persistente" || !esJefe) return;
  const [fila] = await query<{ memoria_extraida_hasta: string | null }>(`SELECT memoria_extraida_hasta FROM conversaciones WHERE id=$1`, [conv.id]);
  const nuevos = (await mensajesDesde(conv.id, fila?.memoria_extraida_hasta ?? null)).filter((m) => m.rol === "usuario" || m.rol === "agente");
  const delJefe = nuevos.filter((m) => m.rol === "usuario");
  if (delJefe.length < CADA_MENSAJES) return;

  const existentes = await listarHechos("jefe", 80);
  const texto = nuevos.map((m) => `${m.rol === "usuario" ? "Jefe" : "Agente"}: ${m.contenido.slice(0, 600)}`).join("\n");
  const prompt = `Sos el módulo de memoria de largo plazo de un asistente personal. Del siguiente fragmento de conversación, extraé SOLO hechos durables sobre el jefe (Sebastián) o su mundo: datos personales que él dijo, preferencias (cómo quiere las cosas), su trabajo, proyectos, personas, decisiones tomadas. NO extraigas tareas puntuales, estados momentáneos, ni cosas que ya están en la lista de hechos conocidos (salvo que cambien).
Hechos ya conocidos:\n${existentes.map((h) => `- [${h.clave}] ${h.contenido}`).join("\n") || "(ninguno)"}

Fragmento:\n${texto}

Respondé SOLO con JSON: {"hechos":[{"sujeto":"jefe","clave":"slug_corto","contenido":"frase concreta","categoria":"personal|preferencia|trabajo|proyecto|persona|decision","fuente":"dicho|inferido","confianza":0.0-1.0}]}. Si no hay nada nuevo: {"hechos":[]}. Usá la misma clave que un hecho conocido si lo actualiza.`;
  try {
    const r = await llamarModelo([{ role: "user", content: prompt }], []);
    const parsed = JSON.parse(r.texto.replace(/```json|```/g, "").trim());
    let n = 0;
    for (const h of parsed?.hechos || []) {
      if (!h?.clave || !h?.contenido) continue;
      if (Number(h.confianza ?? 0.8) < 0.5) continue;
      await guardarHecho({ sujeto: h.sujeto || "jefe", clave: h.clave, contenido: h.contenido, categoria: h.categoria, confianza: Number(h.confianza ?? 0.8), fuente: h.fuente || "dicho", conversacionId: conv.id, agenteId: conv.agente_id });
      n++;
    }
    const hasta = nuevos[nuevos.length - 1].creado_en;
    await query(`UPDATE conversaciones SET memoria_extraida_hasta=$1 WHERE id=$2`, [hasta, conv.id]);
    if (n) console.log(`[memoria-lp] ${n} hecho(s) nuevo(s) desde la conversación ${conv.id.slice(0, 8)}.`);
  } catch (e: any) {
    console.warn(`[memoria-lp] No se pudo extraer: ${e?.message || e}`);
  }
}