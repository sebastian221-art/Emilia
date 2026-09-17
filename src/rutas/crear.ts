import { Router } from "express";
import { crearAgente } from "../dominio/agentes.js";

export const rutasCrear = Router();

// Recibe toda la config del esqueleto que arma el front y crea el agente.
rutasCrear.post("/api/agentes", async (req, res, next) => {
  try {
    const resultado = await crearAgente(req.body);
    res.json(resultado);
  } catch (e) {
    next(e);
  }
});