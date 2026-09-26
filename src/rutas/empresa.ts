// ARCHIVO: src/rutas/empresa.ts
import { Router } from "express";
import { listarPuestos, administradora } from "../dominio/empresa.js";
import { flujosActivos } from "../motor/flujo.js";
import { query } from "../db/cliente.js";

export const rutasEmpresa = Router();

rutasEmpresa.get("/api/empresa", async (_req, res, next) => {
  try {
    const [admin, puestos, activos, agentes] = await Promise.all([administradora(), listarPuestos(), flujosActivos(), query<any>(`SELECT id, nombre, tipo, estado, es_administrador, identidad->>'mision' AS mision FROM agentes ORDER BY creado_en`)]);
    res.json({
      administradora: admin ? { id: admin.id, nombre: admin.nombre } : null,
      agentes: agentes.map((a) => ({ ...a, puesto: puestos.find((p) => p.agente_id === a.id)?.nombre || null })),
      puestos: puestos.map((p) => ({ ...p, flujos: (p.flujos || []).map((f) => ({ ...f, activo: activos.some((x) => x.id === f.ejecucion_id), nodo: activos.find((x) => x.id === f.ejecucion_id)?.nodo_actual })) })),
    });
  } catch (e) { next(e); }
});