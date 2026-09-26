// ARCHIVO: src/tools/flujos.ts
import type { DefTool } from "../registro/tipos.js";
import { flujosActivos, cancelarFlujo } from "../motor/flujo.js";

const MODULO = "flujo";

export const flujoActivos: DefTool = {
  nombre: "flujo_activos", modulo: MODULO,
  descripcion: "Lista los flujos en ejecución (vigilancias, campañas, auditorías) con su id, estado, nodo actual y argumentos.",
  parametros: { type: "object", properties: { nombre: { type: "string", description: "Filtrar por nombre de flujo (opcional)." } }, required: [] },
  riesgo: "lectura", requiereAprobacion: false,
  async ejecutar(a) {
    const l = await flujosActivos(a.nombre);
    return { ok: true, datos: l, resumen: l.length ? l.map((f) => `${f.id.slice(0, 8)}… ${f.nombre_flujo} · ${f.estado} @${f.nodo_actual} · ${JSON.stringify(f.args).slice(0, 80)}`).join("\n") : "No hay flujos activos." };
  },
};

export const flujoCancelar: DefTool = {
  nombre: "flujo_cancelar", modulo: MODULO,
  descripcion: "Detiene un flujo activo por su id (ej. dejar de vigilar un proyecto o cortar una campaña en monitoreo).",
  parametros: { type: "object", properties: { ejecucion_id: { type: "string", minLength: 8 }, motivo: { type: "string" } }, required: ["ejecucion_id"] },
  riesgo: "escritura", requiereAprobacion: false,
  async ejecutar(a) {
    const l = await flujosActivos();
    const f = l.find((x) => x.id === a.ejecucion_id || x.id.startsWith(a.ejecucion_id));
    if (!f) return { ok: false, error: "No hay un flujo activo con ese id." };
    const r = await cancelarFlujo(f.id, a.motivo || "Cancelado por el jefe.");
    return { ok: true, datos: r, resumen: `Flujo ${f.nombre_flujo} (${f.id.slice(0, 8)}…) cancelado.` };
  },
};

export const toolsFlujos: DefTool[] = [flujoActivos, flujoCancelar];