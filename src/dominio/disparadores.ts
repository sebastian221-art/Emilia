// ARCHIVO: src/dominio/disparadores.ts
import { query } from "../db/cliente.js";

export interface Disparador {
  id: string; nombre: string; descripcion: string; tipo: "webhook" | "cron" | "evento";
  config: Record<string, any>; accion: { tipo: "flujo" | "skill" | "agente"; nombre: string; args?: Record<string, unknown>; instruccion?: string };
  agente_id: string | null; estado: string; ultimo_disparo: string | null; veces: number; ultimo_resultado: string | null; creado_en: string;
}

export async function listarDisparadores(): Promise<Disparador[]> { return query<Disparador>(`SELECT * FROM disparadores ORDER BY creado_en`); }
export async function obtenerDisparador(nombreOId: string): Promise<Disparador | undefined> { const [d] = await query<Disparador>(`SELECT * FROM disparadores WHERE nombre=$1 OR id::text=$1 LIMIT 1`, [nombreOId]); return d; }
export async function crearDisparador(d: Omit<Disparador, "id" | "estado" | "ultimo_disparo" | "veces" | "ultimo_resultado" | "creado_en">): Promise<Disparador> {
  if (!/^[a-z][a-z0-9_]{1,40}$/.test(d.nombre)) throw new Error("El nombre debe ser snake_case.");
  const [f] = await query<Disparador>(
    `INSERT INTO disparadores (nombre, descripcion, tipo, config, accion, agente_id) VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (nombre) DO UPDATE SET descripcion=EXCLUDED.descripcion, tipo=EXCLUDED.tipo, config=EXCLUDED.config, accion=EXCLUDED.accion, agente_id=EXCLUDED.agente_id RETURNING *`,
    [d.nombre, d.descripcion || "", d.tipo, JSON.stringify(d.config || {}), JSON.stringify(d.accion), d.agente_id ?? null]);
  return f;
}
export async function cambiarEstadoDisparador(id: string, estado: "activo" | "pausado") { await query(`UPDATE disparadores SET estado=$1 WHERE id=$2`, [estado, id]); }
export async function borrarDisparador(id: string) { await query(`DELETE FROM disparadores WHERE id=$1`, [id]); }
export async function marcarDisparo(id: string, resultado: string) { await query(`UPDATE disparadores SET ultimo_disparo=now(), veces=veces+1, ultimo_resultado=$1 WHERE id=$2`, [resultado.slice(0, 500), id]); }
export async function registrarEvento(nombre: string, datos: unknown, origen: string) { await query(`INSERT INTO eventos (nombre, datos, origen) VALUES ($1,$2,$3)`, [nombre, JSON.stringify(datos ?? {}), origen]); }
export async function eventosRecientes(limite = 30) { return query(`SELECT * FROM eventos ORDER BY creado_en DESC LIMIT $1`, [limite]); }