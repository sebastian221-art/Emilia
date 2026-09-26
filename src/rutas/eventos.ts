// ARCHIVO: src/rutas/eventos.ts
import { Router } from "express";
import { recibirWebhook } from "../motor/eventos.js";
import { listarDisparadores, eventosRecientes } from "../dominio/disparadores.js";

export const rutasEventos = Router();

/** Webhook entrante: POST /api/eventos/:nombre?token=... (o cabecera X-Hub-Signature-256 con secreto). */
rutasEventos.post("/api/eventos/:nombre", async (req, res) => {
  const r = await recibirWebhook(req.params.nombre, req.body, { token: String(req.query.token || req.header("x-emilia-token") || ""), firma: req.header("x-hub-signature-256") || undefined, rawBody: (req as any).rawBody });
  res.status(r.ok ? 200 : 403).json(r);
});
rutasEventos.get("/api/disparadores", async (_req, res, next) => { try { res.json(await listarDisparadores()); } catch (e) { next(e); } });
rutasEventos.get("/api/eventos", async (req, res, next) => { try { res.json(await eventosRecientes(Number(req.query.limite) || 50)); } catch (e) { next(e); } });