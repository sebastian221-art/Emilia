// ARCHIVO: src/rutas/oficina.ts
//  La oficina en vivo para el panel: estado de todo y estación de cada agente.
import { Router } from "express";
import { estadoOficina, estacionAgente } from "../motor/oficina.js";

export const rutasOficina = Router();
rutasOficina.get("/api/oficina/estado", async (_req, res, next) => { try { res.json(await estadoOficina()); } catch (e) { next(e); } });
rutasOficina.get("/api/oficina/agente/:id", async (req, res, next) => {
  try { const r = await estacionAgente(req.params.id); if (!r) return res.status(404).json({ error: "No existe ese agente." }); res.json(r); } catch (e) { next(e); }
});
