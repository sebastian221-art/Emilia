// ARCHIVO: src/tools/web-salud.ts
// Salud de servicios REMOTOS (Railway, VPS, APIs de terceros): ping HTTP con
// latencia. Complementa a runtime_salud (que es para procesos en este PC).
import type { DefTool } from "../registro/tipos.js";

export const webSalud: DefTool = {
  nombre: "runtime_web_salud", modulo: "runtime",
  descripcion: "Chequea un servicio remoto por URL (ej. tu backend en Railway): responde o no, código HTTP, latencia y un trozo del cuerpo. Para saber si algo desplegado está vivo, sin tocar el PC.",
  parametros: { type: "object", properties: { url: { type: "string", description: "URL completa (https://...).", minLength: 8 }, esperado: { type: "string", description: "Texto que debería aparecer en la respuesta (opcional)." }, timeout_seg: { type: "integer", default: 15, minimum: 2, maximum: 60 } }, required: ["url"] },
  riesgo: "lectura", requiereAprobacion: false, timeoutSeg: 70,
  async ejecutar(a) {
    const t0 = Date.now();
    try {
      const ctrl = new AbortController(); const to = setTimeout(() => ctrl.abort(), (a.timeout_seg || 15) * 1000);
      const r = await fetch(a.url, { signal: ctrl.signal, redirect: "follow" }); clearTimeout(to);
      const cuerpo = (await r.text().catch(() => "")).slice(0, 300);
      const latencia = Date.now() - t0;
      const ok = r.status < 500 && (!a.esperado || cuerpo.includes(a.esperado));
      return { ok, datos: { status: r.status, latencia_ms: latencia, cuerpo }, resumen: `${a.url} → ${r.status} en ${latencia} ms${a.esperado ? (cuerpo.includes(a.esperado) ? " · contiene lo esperado" : " · NO contiene lo esperado") : ""}${ok ? "" : " ✘"}`, error: ok ? undefined : `${r.status}${a.esperado && !cuerpo.includes(a.esperado) ? " sin el texto esperado" : ""}` };
    } catch (e: any) {
      return { ok: false, datos: { latencia_ms: Date.now() - t0 }, resumen: `${a.url} → sin respuesta: ${e?.name === "AbortError" ? "timeout" : e?.message}`, error: e?.name === "AbortError" ? `timeout (${a.timeout_seg || 15}s)` : (e?.message || String(e)) };
    }
  },
};

export const toolsWebSalud: DefTool[] = [webSalud];