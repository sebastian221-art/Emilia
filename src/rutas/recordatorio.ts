// ARCHIVO: src/rutas/recordatorio.ts
import { Router } from "express";
import { enviarPlantillaWhatsapp } from "../whatsapp/enviar.js";

export const rutasRecordatorio = Router();

/**
 * Envía un recordatorio por la plantilla de WhatsApp aprobada.
 * Body: { numero, texto, plantilla? }
 * Sirve para escribir primero, incluso fuera de la ventana de 24h.
 */
rutasRecordatorio.post("/api/recordatorio", async (req, res, next) => {
  try {
    const { numero, texto, plantilla } = req.body;
    if (!numero || !texto) return res.status(400).json({ error: "Faltan 'numero' o 'texto'." });
    const r = await enviarPlantillaWhatsapp(numero, plantilla || "recordatorio_emilia", texto);
    res.status(r.ok ? 200 : 400).json(r);
  } catch (e) { next(e); }
});