// ARCHIVO: src/motor/cola.ts
// ─────────────────────────────────────────────────────────────────────────────
//  COLA POR CLAVE
//  Encadena promesas por clave (normalmente el id de conversación). Dos
//  mensajes seguidos del mismo contacto se procesan uno después del otro;
//  conversaciones distintas corren en paralelo. Sin dependencias.
// ─────────────────────────────────────────────────────────────────────────────

const colas = new Map<string, Promise<unknown>>();
const largo = new Map<string, number>();

export function encolar<T>(clave: string, fn: () => Promise<T>): Promise<T> {
  const anterior = colas.get(clave) ?? Promise.resolve();
  largo.set(clave, (largo.get(clave) ?? 0) + 1);

  const siguiente = anterior
    .catch(() => undefined)              // un fallo previo no bloquea la cola
    .then(fn)
    .finally(() => {
      const n = (largo.get(clave) ?? 1) - 1;
      if (n <= 0) { colas.delete(clave); largo.delete(clave); }
      else largo.set(clave, n);
    });

  colas.set(clave, siguiente);
  return siguiente;
}

/** Cuántos trabajos hay en espera/ejecución para una clave. */
export function pendientesEnCola(clave: string): number {
  return largo.get(clave) ?? 0;
}