// ARCHIVO: src/dominio/agentes.ts
import { query } from "../db/cliente.js";
import { PIEZAS_OBJETO, PIEZAS_LISTA, CLAVES_VALIDAS, DEFAULTS } from "../esqueleto/piezas.js";

/**
 * Crea un agente con la config que manda el front. Solo entran las piezas
 * del esqueleto real (src/esqueleto/piezas.ts); cualquier otra clave se ignora.
 * Las piezas objeto se completan con sus defaults.
 */
export async function crearAgente(cfg: any): Promise<{ id: string }> {
  const nombre = cfg?.identidad?.nombre?.trim();
  if (!nombre) throw new Error("El agente necesita un nombre (identidad.nombre).");
  const tipo = cfg?.tipo || "trabajo";

  const cols = ["nombre", "tipo", ...PIEZAS_OBJETO, ...PIEZAS_LISTA];
  const valores = [
    nombre, tipo,
    ...PIEZAS_OBJETO.map((k) => JSON.stringify({ ...(DEFAULTS[k] || {}), ...(cfg[k] ?? {}) })),
    ...PIEZAS_LISTA.map((k) => JSON.stringify(cfg[k] ?? { items: [] })),
  ];
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
  const [fila] = await query<{ id: string }>(`INSERT INTO agentes (${cols.join(", ")}) VALUES (${placeholders}) RETURNING id`, valores);
  return { id: fila.id };
}

export async function listarAgentes(): Promise<any[]> {
  return query(`SELECT * FROM agentes ORDER BY creado_en DESC`);
}

export async function obtenerAgente(id: string): Promise<any | undefined> {
  const [a] = await query(`SELECT * FROM agentes WHERE id = $1`, [id]);
  if (!a) return undefined;
  // Defaults en lectura: el motor nunca ve una pieza objeto vacía.
  for (const k of PIEZAS_OBJETO) a[k] = { ...(DEFAULTS[k] || {}), ...(a[k] || {}) };
  return a;
}

/** Actualiza solo las piezas que vengan en `cambios` y sean del esqueleto real. */
export async function actualizarAgente(id: string, cambios: any): Promise<any | undefined> {
  const entradas = Object.entries(cambios).filter(([k]) => k === "nombre" || k === "tipo" || k === "estado" || CLAVES_VALIDAS.has(k));
  if (entradas.length === 0) return obtenerAgente(id);

  const sets = entradas.map(([k], i) => `${k} = $${i + 2}`).join(", ");
  const vals = entradas.map(([k, v]) => (k === "nombre" || k === "tipo" || k === "estado") ? v : JSON.stringify(v));
  await query(`UPDATE agentes SET ${sets}, actualizado_en = now() WHERE id = $1`, [id, ...vals]);
  return obtenerAgente(id);
}

export async function borrarAgente(id: string): Promise<void> {
  await query(`DELETE FROM agentes WHERE id = $1`, [id]);
}

// ── Asignaciones (por id de la biblioteca; se guardan ids + nombres resueltos) ──

async function asignarLista(agenteId: string, pieza: "skills" | "tools" | "flujos", tabla: string, ids: string[]) {
  const filas = ids.length
    ? await query<{ id: string; nombre: string }>(`SELECT id, nombre FROM ${tabla} WHERE id = ANY($1::uuid[]) AND activo = true`, [ids])
    : [];
  const valor = { items: filas.map((f) => f.nombre), ids: filas.map((f) => f.id) };
  await query(`UPDATE agentes SET ${pieza} = $1, actualizado_en = now() WHERE id = $2`, [JSON.stringify(valor), agenteId]);
}
async function listaCompleta(agenteId: string, pieza: "skills" | "tools" | "flujos", tabla: string): Promise<any[]> {
  const [ag] = await query<any>(`SELECT ${pieza} FROM agentes WHERE id = $1`, [agenteId]);
  const ids = ag?.[pieza]?.ids || [];
  if (!ids.length) return [];
  return query(`SELECT * FROM ${tabla} WHERE id = ANY($1::uuid[]) AND activo = true`, [ids]);
}

export const asignarSkills = (agenteId: string, ids: string[]) => asignarLista(agenteId, "skills", "skills", ids);
export const skillsDeAgente = (agenteId: string) => listaCompleta(agenteId, "skills", "skills");
export const asignarTools = (agenteId: string, ids: string[]) => asignarLista(agenteId, "tools", "tools", ids);
export const toolsDeAgente = (agenteId: string) => listaCompleta(agenteId, "tools", "tools");
export const asignarFlujos = (agenteId: string, ids: string[]) => asignarLista(agenteId, "flujos", "flujos", ids);
export const flujosDeAgente = (agenteId: string) => listaCompleta(agenteId, "flujos", "flujos");

/** ¿Este agente atiende el canal dado? ('panel' siempre sí.) */
export function tieneCanal(agente: any, canal: string): boolean {
  if (canal === "panel") return true;
  const items: string[] = agente?.canales?.items || [];
  return items.some((c) => String(c).toLowerCase().includes(canal));
}