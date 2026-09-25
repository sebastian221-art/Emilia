// ARCHIVO: src/dominio/flujos.ts
import { query } from "../db/cliente.js";

/** Lista para la UI: solo activos; primero los de código. */
export async function listarFlujos() {
  return query(`SELECT id, nombre, descripcion, origen, modulo, activo, definicion, creado_en FROM flujos WHERE activo = true ORDER BY (origen = 'codigo') DESC, modulo NULLS LAST, creado_en DESC`);
}
export async function obtenerFlujo(id: string) {
  const [f] = await query(`SELECT * FROM flujos WHERE id=$1`, [id]);
  return f;
}
export async function obtenerFlujoPorNombre(nombre: string) {
  const [f] = await query(`SELECT * FROM flujos WHERE nombre=$1`, [nombre]);
  return f;
}
/** Ejecuciones recientes (para la UI de flujos y para el espacio del agente). */
export async function ejecucionesDeFlujos(filtro: { flujoId?: string; agenteId?: string; limite?: number } = {}) {
  const cond: string[] = [], args: any[] = [];
  if (filtro.flujoId) { args.push(filtro.flujoId); cond.push(`flujo_id = $${args.length}`); }
  if (filtro.agenteId) { args.push(filtro.agenteId); cond.push(`agente_id = $${args.length}`); }
  args.push(filtro.limite || 30);
  return query(
    `SELECT id, flujo_id, nombre_flujo, agente_id, conversacion_id, estado, nodo_actual, origen, args, resultado, error, inicio, fin
     FROM flujo_ejecuciones ${cond.length ? "WHERE " + cond.join(" AND ") : ""} ORDER BY inicio DESC LIMIT $${args.length}`, args);
}
export async function ejecucionDeFlujo(id: string) {
  const [e] = await query(`SELECT * FROM flujo_ejecuciones WHERE id=$1`, [id]);
  return e;
}

// Los flujos ya no se crean ni editan desde la UI: viven en src/flujos/.
export async function crearFlujo(): Promise<never> { throw new Error("Los flujos se definen en código (src/flujos/) y se registran solos."); }
export async function actualizarFlujo(): Promise<never> { throw new Error("Los flujos se definen en código (src/flujos/). Editalos ahí."); }
export async function borrarFlujo(id: string) {
  const f = await obtenerFlujo(id);
  if (f?.origen === "codigo") throw new Error("Este flujo viene del registro. Para retirarlo, quitalo del código.");
  await query(`DELETE FROM flujos WHERE id=$1`, [id]);
}