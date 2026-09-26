// ARCHIVO: src/tools/registro.ts
import type { DefTool } from "../registro/tipos.js";
import { registro } from "../registro/registro.js";
import { recargarRegistro } from "../registro/cargar.js";
import { query } from "../db/cliente.js";
import { asignarTools, asignarSkills, asignarFlujos, toolsDeAgente, skillsDeAgente, flujosDeAgente } from "../dominio/agentes.js";

const MODULO = "registro";

export const registroRecargar: DefTool = {
  nombre: "registro_recargar", modulo: MODULO,
  descripcion: "Recarga el registro de capacidades desde el código sin reiniciar Emilia (tras integrar una tool/skill/flujo nueva). Si algo está mal, no toca el registro vigente y devuelve el error.",
  parametros: { type: "object", properties: {}, required: [] }, riesgo: "escritura", requiereAprobacion: false, timeoutSeg: 120,
  async ejecutar() {
    const r = await recargarRegistro();
    return r.ok ? { ok: true, datos: r, resumen: `Registro recargado: ${r.tools} tools, ${r.skills} skills, ${r.flujos} flujos.${r.nuevos.length ? " Nuevos: " + r.nuevos.join(", ") : " Sin capacidades nuevas."}` } : { ok: false, error: `La recarga falló (el registro anterior sigue activo): ${r.error}` };
  },
};

export const registroVerificar: DefTool = {
  nombre: "registro_verificar", modulo: MODULO,
  descripcion: "Comprueba si una capacidad (tool, skill o flujo) existe en el registro y devuelve su definición resumida.",
  parametros: { type: "object", properties: { nombre: { type: "string", minLength: 2 } }, required: ["nombre"] },
  riesgo: "lectura", requiereAprobacion: false,
  async ejecutar(a) {
    const t = registro.tool(a.nombre), s = registro.skill(a.nombre), f = registro.flujo(a.nombre);
    if (t) return { ok: true, datos: { tipo: "tool", nombre: t.nombre, descripcion: t.descripcion, parametros: t.parametros, riesgo: t.riesgo, requiereAprobacion: t.requiereAprobacion }, resumen: `tool ${t.nombre}: ${t.descripcion}` };
    if (s) return { ok: true, datos: { tipo: "skill", nombre: s.nombre, descripcion: s.descripcion, tools: s.tools }, resumen: `skill ${s.nombre}: ${s.descripcion}` };
    if (f) return { ok: true, datos: { tipo: "flujo", nombre: f.nombre, descripcion: f.descripcion, pasos: f.pasos.length }, resumen: `flujo ${f.nombre}: ${f.descripcion}` };
    return { ok: false, error: `"${a.nombre}" no está en el registro.` };
  },
};

export const registroAsignar: DefTool = {
  nombre: "registro_asignar", modulo: MODULO,
  descripcion: "Le asigna a un agente una capacidad ya registrada (tool, skill o flujo) por nombre, sumándola a las que tiene.",
  parametros: { type: "object", properties: { agente: { type: "string", minLength: 2 }, nombre: { type: "string", minLength: 2 } }, required: ["agente", "nombre"] },
  riesgo: "escritura", requiereAprobacion: false,
  async ejecutar(a) {
    const [ag] = await query<any>(`SELECT id, nombre FROM agentes WHERE lower(nombre)=lower($1) OR id::text=$1 LIMIT 1`, [a.agente]);
    if (!ag) return { ok: false, error: `Agente ${a.agente} no existe.` };
    const tipo = registro.tool(a.nombre) ? "tools" : registro.skill(a.nombre) ? "skills" : registro.flujo(a.nombre) ? "flujos" : null;
    if (!tipo) return { ok: false, error: `"${a.nombre}" no está en el registro (¿falta registro_recargar?).` };
    const [fila] = await query<{ id: string }>(`SELECT id FROM ${tipo} WHERE nombre=$1 AND activo=true`, [a.nombre]);
    if (!fila) return { ok: false, error: "No está sincronizada en la base." };
    const actuales = (tipo === "tools" ? await toolsDeAgente(ag.id) : tipo === "skills" ? await skillsDeAgente(ag.id) : await flujosDeAgente(ag.id)).map((x: any) => x.id);
    const ids = [...new Set([...actuales, fila.id])];
    if (tipo === "tools") await asignarTools(ag.id, ids); else if (tipo === "skills") await asignarSkills(ag.id, ids); else await asignarFlujos(ag.id, ids);
    return { ok: true, resumen: `${a.nombre} (${tipo.slice(0, -1)}) asignada a ${ag.nombre}.` };
  },
};

export const toolsRegistro: DefTool[] = [registroRecargar, registroVerificar, registroAsignar];