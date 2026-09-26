// ARCHIVO: src/skills/vigilar.ts
// ─────────────────────────────────────────────────────────────────────────────
//  SKILL: vigilar_ciclo — un ciclo de guardia sobre un proyecto en ejecución
//  Observa (proceso, salud, errores en logs) → si está caído o no responde,
//  reinicia (con tope) → si sigue mal o hay errores nuevos, manda al Senior a
//  reparar en sandbox → devuelve qué pasó y si hay un arreglo esperando OK.
//  Avisa por WhatsApp solo cuando el estado CAMBIA (no spamea).
// ─────────────────────────────────────────────────────────────────────────────

import { createHash } from "node:crypto";
import type { DefSkill } from "../registro/tipos.js";
import { ejecutarSkill } from "../motor/ejecutor.js";

const MODULO = "vigilar";
type Nivel = "sano" | "caido" | "no_responde" | "errores";

export const vigilarCiclo: DefSkill = {
  nombre: "vigilar_ciclo", modulo: MODULO,
  descripcion: "Un ciclo de vigilancia de un proyecto: revisa proceso, salud y errores; reinicia si cayó (con tope); si persiste o hay errores nuevos, pide al Senior una reparación en sandbox y devuelve el resultado. Pensada para correr en bucle dentro del flujo vigilar_proyecto.",
  cuandoUsar: "Dentro del flujo vigilar_proyecto, o cuando el jefe pide 'revisá cómo está X ahora mismo y arreglalo si hace falta'.",
  parametros: {
    type: "object",
    properties: {
      proyecto: { type: "string", minLength: 2 },
      numero_aviso: { type: "string", description: "WhatsApp del jefe para avisos (opcional)." },
      reinicios_previos: { type: "integer", default: 0, minimum: 0 },
      max_reinicios: { type: "integer", default: 3, minimum: 0, maximum: 20 },
      auto_reparar: { type: "boolean", default: true },
      nivel_previo: { type: "string", description: "Nivel del ciclo anterior (para avisar solo cambios)." },
      huella_previa: { type: "string", description: "Huella de errores del ciclo anterior." },
      reparacion_pendiente: { type: "boolean", description: "Si ya hay un arreglo esperando aprobación, no lanzar otro.", default: false },
    },
    required: ["proyecto"],
  },
  riesgo: "escritura", requiereAprobacion: false, timeoutSeg: 5400,
  tools: ["runtime_estado", "runtime_salud", "runtime_logs", "runtime_reiniciar", "whatsapp_enviar_texto"],
  async ejecutar(a, ctx) {
    const avisar = async (texto: string) => { if (a.numero_aviso) await ctx.ejecutarTool("whatsapp_enviar_texto", { numero: a.numero_aviso, texto }); };
    const observar = async () => {
      const est = await ctx.ejecutarTool("runtime_estado", { proyecto: a.proyecto });
      const proceso = (est.datos as any)?.[0]?.estado || "desconocido";
      const sal = await ctx.ejecutarTool("runtime_salud", { proyecto: a.proyecto, esperar_seg: 6 });
      const logs = await ctx.ejecutarTool("runtime_logs", { proyecto: a.proyecto, ultimas: 40, solo_errores: true });
      const errores: string[] = ((logs.datos as any)?.lineas || []).slice(-15);
      const huella = createHash("sha1").update(errores.join("\n")).digest("hex").slice(0, 12);
      let nivel: Nivel = "sano";
      if (proceso !== "corriendo") nivel = "caido";
      else if (!sal.ok) nivel = "no_responde";
      else if (errores.length && huella !== a.huella_previa) nivel = "errores";
      return { proceso, saludOk: !!sal.ok, saludError: (sal.datos as any)?.error, errores, huella, nivel };
    };

    let obs = await observar();
    let reinicios = Number(a.reinicios_previos) || 0;
    const max = a.max_reinicios ?? 3;
    let mensaje = "";
    const cambio = obs.nivel !== (a.nivel_previo || "sano");

    // 1. Caído o no responde → reiniciar (con tope).
    if ((obs.nivel === "caido" || obs.nivel === "no_responde") && reinicios < max) {
      reinicios++;
      const r = await ctx.ejecutarTool("runtime_reiniciar", { proyecto: a.proyecto });
      await ctx.traza("skill", `vigilar ${a.proyecto}: ${obs.nivel} → reinicio ${reinicios}/${max}`);
      const obs2 = await observar();
      if (obs2.nivel === "sano") {
        mensaje = `♻ ${a.proyecto} estaba ${obs.nivel === "caido" ? "caído" : "sin responder"}; lo reinicié (${reinicios}/${max}) y volvió: OK.`;
        await avisar(mensaje);
        return { ok: true, datos: { nivel: "sano", reinicios, huella: obs2.huella, necesita_aprobacion: false, mensaje }, resumen: mensaje };
      }
      obs = obs2;
      mensaje = `⚠ ${a.proyecto}: reinicié (${reinicios}/${max}) pero sigue ${obs.nivel}${r.ok ? "" : ` (el reinicio falló: ${r.error})`}.`;
    } else if (obs.nivel === "sano") {
      if (cambio) await avisar(`✅ ${a.proyecto} volvió a estar sano.`);
      return { ok: true, datos: { nivel: "sano", reinicios: 0, huella: obs.huella, necesita_aprobacion: false }, resumen: `${a.proyecto}: sano.` };
    }

    // 2. Sigue mal o hay errores nuevos → reparar con el Senior (una vez; si ya hay arreglo pendiente, solo avisar).
    const detalle = `${obs.nivel === "caido" ? "El proceso está caído" : obs.nivel === "no_responde" ? `No responde en salud (${obs.saludError})` : "Errores recientes en logs"}${reinicios >= max && obs.nivel !== "errores" ? ` tras ${reinicios} reinicios` : ""}.`;
    if (!a.auto_reparar || a.reparacion_pendiente) {
      const m = `${mensaje || "⚠ " + a.proyecto + ": " + detalle}${a.reparacion_pendiente ? " Ya hay un arreglo esperando tu OK." : ""}\nÚltimos errores:\n${obs.errores.slice(-5).join("\n")}`;
      if (cambio || obs.huella !== a.huella_previa) await avisar(m);
      return { ok: true, datos: { nivel: obs.nivel, reinicios, huella: obs.huella, necesita_aprobacion: false, mensaje: m }, resumen: m };
    }
    await avisar(`${mensaje || "⚠ " + a.proyecto + ": " + detalle} Mando al Senior a diagnosticar y reparar; te aviso con el arreglo.`);
    const rep = await ejecutarSkill("senior_reparar", {
      proyecto: a.proyecto,
      sintoma: `${detalle}\nEstado del proceso: ${obs.proceso}. Salud: ${obs.saludOk ? "ok" : obs.saludError}.\nÚltimas líneas de error del log:\n${obs.errores.join("\n")}`,
      max_iteraciones: 3,
    }, ctx);
    const d = (rep.datos as any) || {};
    if (rep.ok && d.sandbox_id) {
      const m = `🔧 Arreglo listo para ${a.proyecto} en sandbox ${d.sandbox_id} (verificado y revisado).\n${(d.informe || "").slice(0, 500)}\nDecime "ok" para integrarlo y reiniciar, o "no" para dejarlo.`;
      return { ok: true, datos: { nivel: obs.nivel, reinicios, huella: obs.huella, necesita_aprobacion: true, sandbox_id: d.sandbox_id, informe: d.informe, mensaje: m }, resumen: m };
    }
    const m = `❌ ${a.proyecto}: el Senior no logró un arreglo verificado. ${rep.error || ""}${d.sandbox_id ? ` Lo que quedó está en el sandbox ${d.sandbox_id}.` : ""}`;
    await avisar(m);
    return { ok: true, datos: { nivel: obs.nivel, reinicios, huella: obs.huella, necesita_aprobacion: false, sandbox_id: d.sandbox_id, mensaje: m }, resumen: m };
  },
};

export const skillsVigilar: DefSkill[] = [vigilarCiclo];