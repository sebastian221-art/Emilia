// ARCHIVO: src/whatsapp/agente-canal.ts
// Quién atiende el WhatsApp: el primer agente activo que declara el canal
// 'whatsapp' en su esqueleto (la administradora, Emilia).
import { query } from "../db/cliente.js";
import { tieneCanal, obtenerAgente } from "../dominio/agentes.js";

export async function agenteDeWhatsapp(): Promise<any | undefined> {
  const activos = await query<any>(`SELECT id, canales FROM agentes WHERE estado='activo' ORDER BY creado_en ASC`);
  const elegido = activos.find((a) => tieneCanal(a, "whatsapp"));
  return elegido ? obtenerAgente(elegido.id) : undefined;
}
