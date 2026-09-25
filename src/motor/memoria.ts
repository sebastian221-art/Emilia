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