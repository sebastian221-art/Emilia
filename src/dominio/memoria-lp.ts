// ARCHIVO: src/dominio/memoria-lp.ts
import { query } from "../db/cliente.js";

export interface Hecho {
  id: string; sujeto: string; clave: string; contenido: string; categoria: string; confianza: number;
  fuente: string | null; creado_en: string; actualizado_en: string;
}

export async function listarHechos(sujeto?: string, limite = 80): Promise<Hecho[]> {
  return query<Hecho>(`SELECT * FROM memoria_largo_plazo ${sujeto ? "WHERE sujeto=$1" : ""} ORDER BY actualizado_en DESC LIMIT $${sujeto ? 2 : 1}`, sujeto ? [sujeto, limite] : [limite]);
}

export async function buscarHechos(texto: string, limite = 15): Promise<Hecho[]> {
  return query<Hecho>(`SELECT * FROM memoria_largo_plazo WHERE clave ILIKE $1 OR contenido ILIKE $1 OR sujeto ILIKE $1 ORDER BY actualizado_en DESC LIMIT $2`, [`%${texto}%`, limite]);
}

export async function guardarHecho(h: { sujeto?: string; clave: string; contenido: string; categoria?: string; confianza?: number; fuente?: string; conversacionId?: string | null; agenteId?: string | null }): Promise<Hecho> {
  const clave = h.clave.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "hecho";
  const [f] = await query<Hecho>(
    `INSERT INTO memoria_largo_plazo (sujeto, clave, contenido, categoria, confianza, fuente, conversacion_id, agente_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (sujeto, clave) DO UPDATE SET contenido=EXCLUDED.contenido, categoria=EXCLUDED.categoria,
       confianza=GREATEST(memoria_largo_plazo.confianza, EXCLUDED.confianza), fuente=COALESCE(EXCLUDED.fuente, memoria_largo_plazo.fuente), actualizado_en=now()
     RETURNING *`,
    [h.sujeto || "jefe", clave, h.contenido.trim().slice(0, 500), h.categoria || "general", h.confianza ?? 0.8, h.fuente || null, h.conversacionId ?? null, h.agenteId ?? null]);
  return f;
}

export async function olvidarHecho(sujetoOClave: string, clave?: string): Promise<number> {
  const filas = clave
    ? await query(`DELETE FROM memoria_largo_plazo WHERE sujeto=$1 AND clave=$2 RETURNING id`, [sujetoOClave, clave])
    : await query(`DELETE FROM memoria_largo_plazo WHERE clave=$1 OR contenido ILIKE $2 RETURNING id`, [sujetoOClave, `%${sujetoOClave}%`]);
  return filas.length;
}

/** Bloque de texto para el system prompt. */
export async function memoriaParaPrompt(limite = 60): Promise<string> {
  const hechos = await listarHechos(undefined, limite);
  if (!hechos.length) return "";
  const porSujeto = new Map<string, Hecho[]>();
  for (const h of hechos) (porSujeto.get(h.sujeto) || porSujeto.set(h.sujeto, []).get(h.sujeto)!).push(h);
  const bloques = [...porSujeto.entries()].map(([s, hs]) => `${s === "jefe" ? "Sobre Sebastián (el jefe)" : `Sobre ${s}`}:\n${hs.map((h) => `- ${h.contenido}${h.fuente === "inferido" ? " (inferido)" : ""}`).join("\n")}`);
  return bloques.join("\n");
}