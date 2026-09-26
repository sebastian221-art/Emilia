// ARCHIVO: src/tools/runtime.ts
// ─────────────────────────────────────────────────────────────────────────────
//  TOOLS DE RUNTIME — ejecutar y observar proyectos
// ─────────────────────────────────────────────────────────────────────────────

import type { DefTool } from "../registro/tipos.js";
import { listarProyectos, obtenerProyecto } from "../dominio/proyectos.js";
import { iniciarProceso, detenerProceso, reiniciarProceso, estadoProceso, leerLogs, saludProceso } from "../motor/runtime.js";

const MODULO = "runtime";
const PROY = { type: "string" as const, description: "Nombre del proyecto registrado.", minLength: 2 };

async function proy(nombre: string) {
  const p = await obtenerProyecto(nombre);
  if (!p) throw new Error(`Proyecto "${nombre}" no registrado (codigo_listar_proyectos).`);
  return p;
}

export const runtimeIniciar: DefTool = {
  nombre: "runtime_iniciar", modulo: MODULO,
  descripcion: "Arranca el proceso de un proyecto (su cmd_start) en el repo real, o en un sandbox si pasás sandbox_id. Queda corriendo aparte de Emilia, con logs a archivo.",
  parametros: { type: "object", properties: { proyecto: PROY, sandbox_id: { type: "string", description: "Correrlo desde un sandbox en vez del repo real (para probar cambios)." }, comando: { type: "string", description: "Comando alternativo al cmd_start (opcional)." } }, required: ["proyecto"] },
  riesgo: "ejecucion", requiereAprobacion: false, timeoutSeg: 60,
  async ejecutar(a) {
    const p = await proy(a.proyecto);
    const r = await iniciarProceso(p, { sandboxId: a.sandbox_id, comando: a.comando });
    if (!r.ok) return { ok: false, error: r.error };
    // Esperar hasta 20 s a que responda (tsx/npm tardan en levantar).
    let salud: any = null;
    if (p.url_salud || p.puerto) {
      const limite = Date.now() + 20000;
      while (Date.now() < limite) {
        await new Promise((x) => setTimeout(x, 2000));
        salud = await saludProceso(p);
        if (salud.ok) break;
        const e = await estadoProceso(p);
        if (e.estado !== "corriendo") { salud = { ok: false, error: `el proceso murió al arrancar (código ${e.codigo_salida}); mirá runtime_logs` }; break; }
      }
    }
    const cola = await leerLogs(p, { ultimas: 8 });
    const e2 = await estadoProceso(p);
    const vivo = e2.estado === "corriendo";
    return {
      ok: vivo, datos: { ...r, salud, proceso: e2.estado, ultimas_lineas: cola },
      resumen: `${p.nombre} ${vivo ? "arrancado" : "ARRANCÓ Y MURIÓ"} (pid ${r.pid}).${r.zombis?.length ? ` Antes maté un proceso viejo que ocupaba el puerto (pid ${r.zombis.join(", ")}).` : ""}${salud ? (salud.ok ? ` Responde OK (${salud.status}, ${salud.latencia_ms} ms).` : ` No responde: ${salud.error}.`) : ""}\nÚltimas líneas del log:\n${cola.join("\n") || "(vacío)"}`,
      error: vivo ? undefined : `El proceso salió con código ${e2.codigo_salida}. Log:\n${cola.join("\n")}`,
    };
  },
};

export const runtimeDetener: DefTool = {
  nombre: "runtime_detener", modulo: MODULO,
  descripcion: "Detiene el proceso de un proyecto.",
  parametros: { type: "object", properties: { proyecto: PROY }, required: ["proyecto"] },
  riesgo: "ejecucion", requiereAprobacion: false, timeoutSeg: 30,
  async ejecutar(a) { const p = await proy(a.proyecto); const r = await detenerProceso(p); return r.ok ? { ok: true, resumen: `${p.nombre} detenido.` } : { ok: false, error: r.error }; },
};

export const runtimeReiniciar: DefTool = {
  nombre: "runtime_reiniciar", modulo: MODULO,
  descripcion: "Reinicia el proceso de un proyecto (detiene si corre y vuelve a arrancar). Útil tras integrar cambios.",
  parametros: { type: "object", properties: { proyecto: PROY, sandbox_id: { type: "string" } }, required: ["proyecto"] },
  riesgo: "ejecucion", requiereAprobacion: false, timeoutSeg: 60,
  async ejecutar(a) {
    const p = await proy(a.proyecto);
    const r = await reiniciarProceso(p, { sandboxId: a.sandbox_id });
    if (!r.ok) return { ok: false, error: r.error };
    await new Promise((x) => setTimeout(x, 4000));
    const e = await estadoProceso(p);
    const s = (p.url_salud || p.puerto) ? await saludProceso(p) : null;
    const cola = await leerLogs(p, { ultimas: 8 });
    const vivo = e.estado === "corriendo";
    return {
      ok: vivo, datos: { ...r, proceso: e.estado, salud: s, ultimas_lineas: cola },
      resumen: `${p.nombre} ${vivo ? "reiniciado" : "REINICIÓ Y MURIÓ"} (pid ${r.pid}).${r.zombis?.length ? ` Maté un proceso viejo en el puerto (pid ${r.zombis.join(", ")}).` : ""}${s ? (s.ok ? ` Responde OK (${s.status}, ${s.latencia_ms} ms).` : ` No responde: ${s.error}.`) : ""}\nÚltimas líneas del log:\n${cola.join("\n") || "(vacío)"}`,
      error: vivo ? undefined : `El proceso salió con código ${e.codigo_salida}. Log:\n${cola.join("\n")}`,
    };
  },
};

export const runtimeEstado: DefTool = {
  nombre: "runtime_estado", modulo: MODULO,
  descripcion: "Estado de los procesos de los proyectos: corriendo/detenido/caído, pid, desde cuándo, último código de salida. Sin proyecto, lista todos.",
  parametros: { type: "object", properties: { proyecto: { type: "string", description: "Opcional." } }, required: [] },
  riesgo: "lectura", requiereAprobacion: false,
  async ejecutar(a) {
    const lista = a.proyecto ? [await proy(a.proyecto)] : await listarProyectos();
    const datos = [];
    for (const p of lista) {
      const e = await estadoProceso(p);
      datos.push({ proyecto: p.nombre, estado: e.estado, pid: e.pid, inicio: e.inicio, fin: e.fin, codigo_salida: e.codigo_salida, reinicios: e.reinicios, cmd_start: p.cmd_start, puerto: p.puerto, url_salud: p.url_salud, en_sandbox: e.ruta_trabajo && e.ruta_trabajo !== p.ruta });
    }
    return { ok: true, datos, resumen: datos.length ? datos.map((d) => `${d.proyecto}: ${d.estado}${d.pid ? ` (pid ${d.pid})` : ""}${d.codigo_salida != null ? ` · salió con ${d.codigo_salida}` : ""}${!d.cmd_start ? " · sin cmd_start" : ""}`).join("\n") : "No hay proyectos." };
  },
};

export const runtimeLogs: DefTool = {
  nombre: "runtime_logs", modulo: MODULO,
  descripcion: "Últimas líneas del log de un proyecto en ejecución (stdout+stderr), con filtro por texto o solo errores. Es lo primero que se mira para diagnosticar.",
  parametros: { type: "object", properties: { proyecto: PROY, ultimas: { type: "integer", default: 60, minimum: 5, maximum: 500 }, filtro: { type: "string" }, solo_errores: { type: "boolean", default: false } }, required: ["proyecto"] },
  riesgo: "lectura", requiereAprobacion: false,
  async ejecutar(a) {
    const p = await proy(a.proyecto);
    const l = await leerLogs(p, { ultimas: a.ultimas, filtro: a.filtro, soloErrores: !!a.solo_errores });
    return { ok: true, datos: { lineas: l }, resumen: l.length ? l.join("\n") : "Sin líneas de log (¿arrancó alguna vez?)." };
  },
};

export const runtimeSalud: DefTool = {
  nombre: "runtime_salud", modulo: MODULO,
  descripcion: "Chequeo de salud HTTP del proyecto (url_salud o su puerto): responde o no, código y latencia. Reintenta unos segundos si acaba de arrancar.",
  parametros: { type: "object", properties: { proyecto: PROY, esperar_seg: { type: "integer", description: "Segundos máximos a reintentar si no responde.", default: 10, minimum: 0, maximum: 60 } }, required: ["proyecto"] },
  riesgo: "lectura", requiereAprobacion: false, timeoutSeg: 90,
  async ejecutar(a) {
    const p = await proy(a.proyecto);
    const e = await estadoProceso(p);
    let s = await saludProceso(p);
    const limite = Date.now() + (a.esperar_seg ?? 10) * 1000;
    while (!s.ok && e.estado === "corriendo" && Date.now() < limite) { await new Promise((x) => setTimeout(x, 2000)); s = await saludProceso(p); }
    return { ok: s.ok, datos: { proceso: e.estado, ...s }, resumen: `${p.nombre}: proceso ${e.estado} · salud ${s.ok ? `OK (${s.status}, ${s.latencia_ms} ms)` : `FALLA: ${s.error}`}${s.url ? ` [${s.url}]` : ""}`, error: s.ok ? undefined : s.error };
  },
};

export const toolsRuntime: DefTool[] = [runtimeIniciar, runtimeDetener, runtimeReiniciar, runtimeEstado, runtimeLogs, runtimeSalud];