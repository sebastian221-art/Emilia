// ARCHIVO: src/whatsapp/dueno-canal.ts
// Quién atiende el WhatsApp del jefe en este momento (por defecto la
// administradora). Persistido en la tabla canal_dueno para sobrevivir reinicios.
import { query } from "../db/cliente.js";

let asegurado = false;
async function asegurar() { if (asegurado) return; await query(`CREATE TABLE IF NOT EXISTS canal_dueno (contacto TEXT PRIMARY KEY, agente_id UUID NOT NULL, desde TIMESTAMPTZ NOT NULL DEFAULT now())`); asegurado = true; }

export async function duenoCanal(contacto: string): Promise<string | null> { await asegurar(); const [f] = await query<{ agente_id: string }>(`SELECT agente_id FROM canal_dueno WHERE contacto=$1`, [contacto]); return f?.agente_id || null; }
export async function fijarDuenoCanal(contacto: string, agenteId: string) { await asegurar(); await query(`INSERT INTO canal_dueno (contacto, agente_id) VALUES ($1,$2) ON CONFLICT (contacto) DO UPDATE SET agente_id=EXCLUDED.agente_id, desde=now()`, [contacto, agenteId]); }
export async function quitarDuenoCanal(contacto: string) { await asegurar(); await query(`DELETE FROM canal_dueno WHERE contacto=$1`, [contacto]); }