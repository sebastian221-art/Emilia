// ARCHIVO: src/seguridad/contexto.ts
// Contexto de la llamada en curso (quién gasta y con qué prioridad), sin tener
// que pasarlo por cada función: lo usan el tope de gasto global y el registro
// de consumo de llamarModelo.
import { AsyncLocalStorage } from "node:async_hooks";

export interface ContextoLlamada { agenteId?: string | null; ejecucionId?: string | null; prioridad?: "normal" | "jefe" }
const als = new AsyncLocalStorage<ContextoLlamada>();

export function conContexto<T>(c: ContextoLlamada, fn: () => Promise<T>): Promise<T> {
  return als.run({ ...(als.getStore() || {}), ...c }, fn);
}
/** Anota la ejecución en el contexto en curso (se conoce después de crearla). */
export function fijarEjecucion(id: string) { const s = als.getStore(); if (s) s.ejecucionId = id; }
export const contextoActual = (): ContextoLlamada => als.getStore() || {};
