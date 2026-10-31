// ARCHIVO: src/motor/skill-guiada.ts
// ─────────────────────────────────────────────────────────────────────────────
//  SKILLS GUIADAS
//  Una skill guiada es un procedimiento en lenguaje natural + una lista de
//  tools permitidas. Se ejecuta en un sub-loop propio del modelo, con SOLO
//  esas tools, un presupuesto de pasos y un criterio de éxito. Devuelve un
//  resultado compacto al loop principal (que no ve el detalle interno: solo
//  el resumen). Sirve tanto para skills del registro sin `ejecutar` como para
//  las creadas desde la página Skills (se convierten con `desdeFilaUI`).
// ─────────────────────────────────────────────────────────────────────────────

import type { ChatCompletionMessageParam, ChatCompletionTool } from "groq-sdk/resources/chat/completions";
import { registro } from "../registro/registro.js";
import type { ContextoEjecucion, ResultadoTool, NivelRiesgo } from "../registro/tipos.js";
import { crearContexto } from "./ejecutor.js";
import { MODELO_POR_DEFECTO } from "./groq.js";

export interface SkillGuiada {
  nombre: string;
  descripcion: string;
  procedimiento: string;
  tools: string[];
  entradas?: string;
  salida?: string;
  criterioExito?: string;
  siFalta?: "pregunta" | "asume" | "falla";
  maxPasos?: number;
  riesgo?: NivelRiesgo;
}

/** Convierte una skill creada desde la UI (fila de `skills`, origen ui) a guiada. */
export function desdeFilaUI(fila: any): SkillGuiada {
  const sec = fila.secciones || {};
  const tools = String(sec.recursos?.tools || "").split(",").map((s: string) => s.trim()).filter(Boolean);
  return {
    nombre: fila.nombre,
    descripcion: fila.descripcion || sec.identidad?.descripcion || "",
    procedimiento: sec.procedimiento?.pasos || fila.procedimiento || "",
    tools,
    entradas: sec.io?.entradas,
    salida: sec.io?.salida,
    criterioExito: sec.verificacion?.criterio,
    siFalta: sec.io?.si_falta,
    maxPasos: Number(registro.skill(fila.nombre)?.maxPasos) || Number(sec.complejidad?.presupuesto) || 10,
    riesgo: fila.nivel_riesgo,
  };
}

export async function ejecutarSkillGuiada(sk: SkillGuiada, args: Record<string, unknown>, ctxBase?: ContextoEjecucion): Promise<ResultadoTool> {
  // Solo tools que existan en el registro (las de UI ya no se ejecutan desde skills).
  const permitidas = sk.tools.filter((t) => registro.tieneTool(t));
  const faltantes = sk.tools.filter((t) => !registro.tieneTool(t));
  if (!sk.procedimiento.trim()) return { ok: false, error: `La skill "${sk.nombre}" no tiene procedimiento.` };

  const ctx = crearContexto(ctxBase?.agenteId ?? null, ctxBase?.ejecucionId ?? null, permitidas);
  const tools: ChatCompletionTool[] = permitidas.map((n) => {
    const d = registro.tool(n)!;
    return { type: "function", function: { name: d.nombre, description: `${d.descripcion} (riesgo: ${d.riesgo})`, parameters: d.parametros as any } };
  });

  const sistema = [
    `Estás ejecutando la skill "${sk.nombre}": ${sk.descripcion}`,
    sk.entradas ? `Datos que necesita: ${sk.entradas}` : "",
    // {clave} dentro del procedimiento se reemplaza por el argumento recibido (si no vino, queda '—').
    `Procedimiento a seguir:\n${sk.procedimiento.replace(/\{([a-z_]+)\}/g, (m, k) => (k in (args || {}) && args[k] != null && args[k] !== "") ? String(args[k]) : (m === m.toLowerCase() ? "—" : m))}`,
    sk.salida ? `Qué debés devolver al terminar: ${sk.salida}` : "",
    sk.criterioExito ? `Criterio de éxito: ${sk.criterioExito}` : "",
    sk.siFalta === "pregunta" ? "Si te falta un dato imprescindible, NO lo inventes: terminá y decí exactamente qué falta." : "",
    sk.siFalta === "falla" ? "Si te falta un dato imprescindible, terminá reportando el fallo." : "",
    permitidas.length ? `Tools disponibles (solo estas): ${permitidas.join(", ")}.` : "No tenés tools: resolvé con razonamiento y texto.",
    faltantes.length ? `(Aviso: las tools ${faltantes.join(", ")} están declaradas pero no existen en el registro; no las uses.)` : "",
    "Cuando termines, tu ÚLTIMO mensaje debe ser el resultado final en texto claro, empezando con 'OK:' si cumpliste el criterio o 'FALLO:' si no.",
  ].filter(Boolean).join("\n");

  const mensajes: ChatCompletionMessageParam[] = [
    { role: "system", content: sistema },
    { role: "user", content: `Argumentos recibidos: ${JSON.stringify(args)}. Ejecutá el procedimiento.` },
  ];

  const maxPasos = Math.max(1, Math.min(sk.maxPasos ?? 10, 60));
  let pasos = 0, llamadas = 0;
  await ctx.traza("skill", `▶ ${sk.nombre} (guiada) con ${JSON.stringify(args).slice(0, 200)}`);

  const yaLlamadas = new Map<string, string>();   // misma tool + mismos argumentos → no se repite (ahorra pasos y evita bucles)
  while (pasos < maxPasos) {
    pasos++;
    const r = await ctx.modelo(mensajes, tools);
    const asistente: any = { role: "assistant", content: r.texto || null };
    if (r.toolCalls.length) asistente.tool_calls = r.toolCalls.map((t) => ({ id: t.id, type: "function", function: { name: t.nombre, arguments: JSON.stringify(t.argumentos) } }));
    mensajes.push(asistente);

    if (!r.toolCalls.length) {
      const texto = r.texto.trim();
      const ok = /^ok\b/i.test(texto) && !/^fallo\b/i.test(texto);
      await ctx.traza("skill", `■ ${sk.nombre} → ${ok ? "ok" : "fallo"} (${llamadas} tools, ${pasos} pasos)`);
      return { ok, datos: { texto, pasos, llamadas }, resumen: texto.replace(/^(ok|fallo):\s*/i, ""), error: ok ? undefined : texto.replace(/^fallo:\s*/i, "") || "La skill no cumplió el criterio." };
    }

    for (const tc of r.toolCalls) {
      llamadas++;
      const clave = `${tc.nombre}|${tc.nombre === "web_leer" ? String(tc.argumentos?.url || "") : JSON.stringify(tc.argumentos || {})}`;
      if (yaLlamadas.has(clave)) {
        const previo = yaLlamadas.get(clave)!;
        await ctx.traza("verificacion", `${sk.nombre}: llamada repetida a ${tc.nombre} con los mismos argumentos; se devolvió el resultado anterior.`);
        mensajes.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify({ ok: false, error: `Ya llamaste ${tc.nombre} con exactamente esos argumentos en esta skill. No repitas: usá lo que ya tenés (abajo) o cambiá de enfoque.`, resultado_anterior: previo.slice(0, 2500) }) });
        continue;
      }
      const res = await ctx.ejecutarTool(tc.nombre, tc.argumentos);   // el contexto ya restringe a `permitidas`
      yaLlamadas.set(clave, JSON.stringify(res));
      await ctx.traza("tool", `${sk.nombre} › ${tc.nombre}(${JSON.stringify(tc.argumentos).slice(0, 150)}) → ${res.ok ? "ok" : "ERROR"} ${(res.resumen || res.error || "").slice(0, 200)}`);
      mensajes.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(res).slice(0, 4000) });
    }
  }

  await ctx.traza("skill", `■ ${sk.nombre} → se agotó el presupuesto de ${maxPasos} pasos`);
  return { ok: false, error: `La skill "${sk.nombre}" agotó sus ${maxPasos} pasos sin terminar.`, datos: { pasos, llamadas } };
}

export { MODELO_POR_DEFECTO };