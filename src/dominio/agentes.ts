import { query } from "../db/cliente.js";

// Las piezas que van como objeto JSON (config con sub-campos).
const PIEZAS_OBJETO = [
  "identidad", "cerebro", "memoria", "planeamiento", "descomposicion",
  "autocorreccion", "reflexion", "pensar_voz_alta", "subagentes",
  "escalamiento", "limites", "trazas", "gobierno",
];
// Las piezas que van como array JSON (listas). gobierno es mixto: lo tratamos como objeto arriba.
const PIEZAS_LISTA_ITEMS = ["skills", "tools", "conocimiento", "flujos", "disparadores", "canales"];

/**
 * Normaliza el objeto de estado que manda el front (donde las listas vienen
 * como {items:[...], _extra:{...}}) a la forma que guardamos en la base.
 * Para las listas guardamos {items, _extra} completo, así conservamos también
 * la config extra de cada lista (ej. "cómo usa los documentos").
 */
export async function crearAgente(cfg: any): Promise<{ id: string }> {
  const nombre = cfg?.identidad?.nombre?.trim();
  if (!nombre) throw new Error("El agente necesita un nombre (identidad.nombre).");

  const tipo = cfg?.tipo || "trabajo";

  const cols = [
    "nombre", "tipo",
    ...PIEZAS_OBJETO,
    ...PIEZAS_LISTA_ITEMS,
  ];
  const valores = [
    nombre,
    tipo,
    ...PIEZAS_OBJETO.map((k) => JSON.stringify(cfg[k] ?? {})),
    ...PIEZAS_LISTA_ITEMS.map((k) => JSON.stringify(cfg[k] ?? [])),
  ];
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");

  const [fila] = await query<{ id: string }>(
    `INSERT INTO agentes (${cols.join(", ")}) VALUES (${placeholders}) RETURNING id`,
    valores
  );
  return { id: fila.id };
}

export async function listarAgentes(): Promise<any[]> {
  return query(`SELECT * FROM agentes ORDER BY creado_en DESC`);
}

export async function obtenerAgente(id: string): Promise<any | undefined> {
  const [a] = await query(`SELECT * FROM agentes WHERE id = $1`, [id]);
  return a;
}

/** Actualiza solo las piezas que vengan en `cambios`. Cada pieza es una columna JSON. */
export async function actualizarAgente(id: string, cambios: any): Promise<any | undefined> {
  const editables = ["nombre", "tipo", "estado", ...PIEZAS_OBJETO, ...PIEZAS_LISTA_ITEMS];
  const entradas = Object.entries(cambios).filter(([k]) => editables.includes(k));
  if (entradas.length === 0) return obtenerAgente(id);

  const sets = entradas.map(([k], i) => `${k} = $${i + 2}`).join(", ");
  const vals = entradas.map(([k, v]) =>
    (k === "nombre" || k === "tipo" || k === "estado") ? v : JSON.stringify(v)
  );

  const [fila] = await query(
    `UPDATE agentes SET ${sets}, actualizado_en = now() WHERE id = $1 RETURNING *`,
    [id, ...vals]
  );
  return fila;
}

/**
 * Asigna un conjunto de skills (por sus IDs de la biblioteca) a un agente.
 * Guardamos los IDs en la pieza "skills" del agente, junto a sus nombres
 * (para mostrarlos sin tener que ir a buscarlos cada vez).
 */
export async function asignarSkills(agenteId: string, skillIds: string[]): Promise<void> {
  // Traemos nombre + datos de cada skill para guardarlos resueltos.
  const skills = skillIds.length
    ? await query<{ id: string; nombre: string; nivel_riesgo: string }>(
        `SELECT id, nombre, nivel_riesgo FROM skills WHERE id = ANY($1::uuid[])`, [skillIds])
    : [];
  const valor = { items: skills.map((s) => s.nombre), ids: skills.map((s) => s.id) };
  await query(`UPDATE agentes SET skills = $1, actualizado_en = now() WHERE id = $2`,
    [JSON.stringify(valor), agenteId]);
}

/** Devuelve las skills COMPLETAS (con su config) que tiene asignadas un agente. */
export async function skillsDeAgente(agenteId: string): Promise<any[]> {
  const [ag] = await query<{ skills: any }>(`SELECT skills FROM agentes WHERE id = $1`, [agenteId]);
  const ids = ag?.skills?.ids || [];
  if (!ids.length) return [];
  return query(`SELECT * FROM skills WHERE id = ANY($1::uuid[])`, [ids]);
}

/** Asigna tools directamente a un agente (por IDs de la biblioteca de tools). */
export async function asignarTools(agenteId: string, toolIds: string[]): Promise<void> {
  const tools = toolIds.length
    ? await query<{ id: string; nombre: string }>(`SELECT id, nombre FROM tools WHERE id = ANY($1::uuid[])`, [toolIds])
    : [];
  const valor = { items: tools.map((t) => t.nombre), ids: tools.map((t) => t.id) };
  await query(`UPDATE agentes SET tools = $1, actualizado_en = now() WHERE id = $2`, [JSON.stringify(valor), agenteId]);
}

export async function toolsDeAgente(agenteId: string): Promise<any[]> {
  const [ag] = await query<{ tools: any }>(`SELECT tools FROM agentes WHERE id = $1`, [agenteId]);
  const ids = ag?.tools?.ids || [];
  if (!ids.length) return [];
  return query(`SELECT * FROM tools WHERE id = ANY($1::uuid[])`, [ids]);
}
export async function borrarAgente(id: string): Promise<void> {
  await query(`DELETE FROM agentes WHERE id = $1`, [id]);
}