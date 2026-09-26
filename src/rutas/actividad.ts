// ARCHIVO: src/rutas/actividad.ts
import { Router } from "express";
import { actividadActual } from "../motor/actividad.js";
export const rutasActividad = Router();
rutasActividad.get("/api/actividad", async (_req, res, next) => { try { res.json(await actividadActual()); } catch (e) { next(e); } });