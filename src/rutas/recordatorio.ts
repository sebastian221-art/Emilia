import { Router } from "express";
import { query } from "../db/cliente.js";
import { ejecutarTool } from "../motor/ejecutor.js";

export const rutasRecordatorio = Router();

/**
 * Envía un recordatorio por la plantilla de WhatsApp aprobada.
 * Body: { numero, texto, plantilla? }
 * Sirve para que Emilia (o vos desde el panel) escribas primero, incluso
 * fuera de la ventana de 24h.
 */
rutasRecordatorio.post("/api/recordatorio", async (req, res, next) => {
  try {
    const { numero, texto, plantilla } = req.body;
    if (!numero || !texto) return res.status(400).json({ error: "Faltan 'numero' o 'texto'." });

    const [toolWa] = await query<any>(`SELECT * FROM tools WHERE descripcion ILIKE '%whatsapp%' OR nombre ILIKE '%whatsapp%' LIMIT 1`);
    if (!toolWa) return res.status(400).json({ error: "No hay una tool de WhatsApp configurada." });

    const resultado = await ejecutarTool(toolWa, {
      destino: numero,
      plantilla: plantilla || "recordatorio_emilia",
      variable: texto,
    });
    res.json(resultado);
  } catch (e) { next(e); }
});