// ARCHIVO: src/motor/cancelacion.ts
// Botón de emergencia: el jefe dice "para/stop/detente/cancela" y todo lo que
// corre en su conversación se detiene en el siguiente paso (loop, operador,
// sesiones de Claude, tareas en cola).
const solicitadas = new Map<string, number>();   // conversacionId → timestamp
const VIGENCIA_MS = 90_000;                        // las tareas encoladas que arranquen dentro de este lapso también se cancelan

export const RE_PARAR = /^\s*(par[aá](l[oa]|te)?|det[eé]n(e|te|ete)?|deten[eé]lo|stop|cancel[aá](l[oa])?|basta|frena|para todo|deja de .*|no sigas|abort[aá]r?)\s*[.!]*\s*$/i;

export function solicitarCancelacion(conversacionId: string) { solicitadas.set(conversacionId, Date.now()); }
export function cancelada(conversacionId: string | null | undefined): boolean {
  if (!conversacionId) return false;
  const t = solicitadas.get(conversacionId);
  if (!t) return false;
  if (Date.now() - t > VIGENCIA_MS) { solicitadas.delete(conversacionId); return false; }
  return true;
}
export function limpiarCancelacion(conversacionId: string) { solicitadas.delete(conversacionId); }