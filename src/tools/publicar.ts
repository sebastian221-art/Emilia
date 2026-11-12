// ARCHIVO: src/tools/publicar.ts
// ─────────────────────────────────────────────────────────────────────────────
//  TOOLS DE PUBLICAR — del laboratorio a GitHub + Railway (con link y estado)
//  Solo publican carpetas del laboratorio (experimentos). Los proyectos reales
//  se entregan con entregar_cambios. Subir y desplegar siempre pide el OK del jefe.
// ─────────────────────────────────────────────────────────────────────────────
import path from "node:path";
import type { DefTool } from "../registro/tipos.js";
import { publicarCarpeta, estadoPublicado, listarDespliegues } from "../motor/publicar.js";
import { enLaboratorio } from "../motor/laboratorio.js";
import { SANDBOX_DIR } from "../motor/sandbox.js";

const MODULO = "publicar";

function carpetaValida(c: string): string {
  const ruta = path.resolve(String(c || ""));
  const sb = path.resolve(SANDBOX_DIR).toLowerCase();
  if (!enLaboratorio(ruta)) throw new Error("Solo publico carpetas del laboratorio (experimentos). Los proyectos registrados se entregan con entregar_cambios.");
  if (ruta.toLowerCase() === sb || ruta.toLowerCase().startsWith(sb + path.sep)) throw new Error("Eso es un sandbox de un proyecto real: se entrega con entregar_cambios, no se publica aparte.");
  return ruta;
}

export const publicarProyecto: DefTool = {
  nombre: "publicar_proyecto", modulo: MODULO,
  descripcion: "Publica una carpeta del laboratorio: crea el repo en GitHub (privado por defecto) o reusa el suyo, sube el código (sin .env ni secretos), la despliega en Railway con dominio público, espera a que quede arriba y comprueba que la URL responde. Si ya estaba publicada, sube la nueva versión y Railway la redespliega. Devuelve repo, URL y estado (logs si falló).",
  parametros: {
    type: "object",
    properties: {
      carpeta: { type: "string", description: "Carpeta del proyecto dentro del laboratorio." },
      nombre: { type: "string", description: "Nombre del repo/proyecto (si no, sale de la carpeta)." },
      descripcion: { type: "string", description: "Descripción corta del repo." },
      privado: { type: "boolean", default: true, description: "Repo privado (por defecto sí)." },
      desplegar: { type: "boolean", default: true, description: "Desplegar en Railway (false = solo GitHub)." },
      variables: { type: "object", description: "Variables de entorno para Railway (nada de credenciales reales del jefe sin que él lo pida)." },
      mensaje: { type: "string", description: "Mensaje del commit." },
    },
    required: ["carpeta"],
  },
  riesgo: "sistema", requiereAprobacion: true, timeoutSeg: 1200,
  async ejecutar(a, ctx) {
    const carpeta = carpetaValida(a.carpeta);
    const avances: string[] = [];
    const r = await publicarCarpeta({ ...a, carpeta, esperaSeg: 600, alAvanzar: (t) => { avances.push(t); ctx.traza("avance", t).catch(() => {}); } });
    const lineas = [
      `📦 GitHub: ${r.repo_url} (${r.nuevo ? "repo nuevo" : "actualizado"}, commit ${r.commit})`,
      r.url ? `🌐 ${r.url}` : "",
      r.estado ? `🚂 Railway: ${r.estado}${r.en_progreso ? " (sigue en curso: revisa con publicar_estado)" : ""}` : "",
      r.responde ? (r.responde.ok ? `✅ La URL responde (HTTP ${r.responde.status}).` : `⚠ La URL no responde bien (${r.responde.status ?? "sin respuesta"}).`) : "",
      r.logs ? `\nLogs:\n${r.logs.slice(-2500)}` : "",
    ].filter(Boolean);
    const ok = a.desplegar === false || r.estado === "SUCCESS" || !!r.en_progreso;
    return { ok, datos: r, resumen: lineas.join("\n"), error: ok ? undefined : lineas.join("\n") };
  },
};

export const publicarEstado: DefTool = {
  nombre: "publicar_estado", modulo: MODULO,
  descripcion: "Estado de un proyecto publicado por Sage: último despliegue en Railway, si la URL responde y los logs si falló.",
  parametros: { type: "object", properties: { nombre: { type: "string", description: "Nombre, carpeta o repo (owner/nombre)." } }, required: ["nombre"] },
  riesgo: "lectura", requiereAprobacion: false, timeoutSeg: 120,
  async ejecutar(a) {
    const e: any = await estadoPublicado(a.nombre);
    return { ok: true, datos: e, resumen: [`${e.nombre}: ${e.estado || "sin despliegue"}`, e.url ? `🌐 ${e.url}` : "", e.responde ? `URL: ${e.responde.ok ? "responde" : "no responde"} (${e.responde.status ?? "-"})` : "", e.logs ? `Logs:\n${String(e.logs).slice(-2000)}` : ""].filter(Boolean).join("\n") };
  },
};

export const publicarListar: DefTool = {
  nombre: "publicar_listar", modulo: MODULO,
  descripcion: "Lista lo que Sage ha publicado (repo, URL, último estado).",
  parametros: { type: "object", properties: {} },
  riesgo: "lectura", requiereAprobacion: false, timeoutSeg: 20,
  async ejecutar() {
    const xs = await listarDespliegues();
    return { ok: true, datos: xs, resumen: xs.length ? xs.map((x) => `• ${x.nombre} — ${x.url || "(solo GitHub)"} — ${x.estado || "?"}`).join("\n") : "Todavía no hay nada publicado." };
  },
};

export const toolsPublicar = [publicarProyecto, publicarEstado, publicarListar];
