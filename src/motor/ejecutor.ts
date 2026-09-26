// ARCHIVO: src/motor/ejecutor.ts
// ─────────────────────────────────────────────────────────────────────────────
//  EJECUTOR
//  Única puerta para ejecutar una tool o una skill, venga del loop del agente,
//  de un flujo, de otra skill o del botón "Probar" de la UI.
//
//  Tools: solo del registro (código). Skills: del registro (código o guiada)
//  o guiadas creadas en la página Skills. No hay heurísticas ni legado.
//
//  No hay heurísticas por string acá. Si el nombre no existe, se dice.
// ─────────────────────────────────────────────────────────────────────────────

import { registro, validarArgs } from "../registro/registro.js";
import type { ContextoEjecucion, ResultadoTool } from "../registro/tipos.js";
import { llamarModelo } from "./groq.js";
import { query } from "../db/cliente.js";
import { ejecutarSkillGuiada, desdeFilaUI } from "./skill-guiada.js";

// ─── Contexto ────────────────────────────────────────────────────────────────
/**
 * Arma el contexto que reciben tools y skills. `toolsPermitidas` restringe lo
 * que una skill puede invocar; null = sin restricción (loop del agente).
 */
export function crearContexto(
  agenteId: string | null,
  ejecucionId: string | null,
  toolsPermitidas: string[] | null = null,
  conversacionId: string | null = null,
): ContextoEjecucion {
  const ctx: ContextoEjecucion = {
    agenteId,
    ejecucionId,
    conversacionId,
    async traza(tipo, detalle) {
      if (!ejecucionId) { console.log(`[traza sin ejecución] ${tipo}: ${detalle}`); return; }
      await query(`INSERT INTO pasos (ejecucion_id, tipo, detalle) VALUES ($1,$2,$3)`, [ejecucionId, tipo, (detalle || "").slice(0, 2000)]);
    },
    async ejecutarTool(nombre, args) {
      if (toolsPermitidas && !toolsPermitidas.includes(nombre)) {
        return { ok: false, error: `Esta skill no tiene permiso para usar la tool "${nombre}". Permitidas: ${toolsPermitidas.join(", ")}.` };
      }
      return ejecutarTool(nombre, args, ctx);
    },
    modelo(mensajes, tools = []) { return llamarModelo(mensajes, tools); },
  };
  return ctx;
}

// ─── Tools ───────────────────────────────────────────────────────────────────
/**
 * Ejecuta una tool por nombre.
 * Compatibilidad: si en vez de nombre llega una FILA de la tabla tools (uso
 * viejo desde webhook.ts / recordatorio.ts), se va directo al legado.
 */
export async function ejecutarTool(
  nombreOFila: string | any,
  args: Record<string, unknown>,
  ctx?: ContextoEjecucion,
): Promise<ResultadoTool> {
  if (typeof nombreOFila !== "string") return { ok: false, error: "Las tools ya no se ejecutan por fila: usá el nombre del registro." };
  const nombre = nombreOFila;
  const contexto = ctx || crearContexto(null, null);

  const def = registro.tool(nombre);
  if (def) {
    const val = validarArgs(def.parametros, args || {});
    if (!val.ok) {
      return { ok: false, error: `Argumentos inválidos para ${nombre}: ${val.errores.join(" ")}` };
    }
    const timeoutMs = (def.timeoutSeg ?? 30) * 1000;
    try {
      const r = normalizar(await conTimeout(def.ejecutar(val.valor, contexto), timeoutMs, `La tool ${nombre} superó ${def.timeoutSeg ?? 30}s.`), nombre);
      if (val.ignorados.length) {
        // El modelo mandó argumentos que la tool no tiene: se lo decimos para que no los confunda con el resultado.
        r.resumen = `${r.resumen || ""}\n(Aviso: los argumentos ${val.ignorados.join(", ")} no existen en esta tool y se ignoraron. El resultado real es SOLO lo de arriba.)`.trim();
      }
      return r;
    } catch (e: any) {
      return { ok: false, error: `${nombre} lanzó una excepción: ${e?.message || String(e)}` };
    }
  }

  return { ok: false, error: `La tool "${nombre}" no existe. Tools disponibles: ${registro.tools().map((t) => t.nombre).join(", ") || "(ninguna)"}.` };
}

// ─── Skills ──────────────────────────────────────────────────────────────────
/**
 * Ejecuta una skill por nombre (o por fila de la UI).
 *  - Skill en código (registro, con `ejecutar`): corre con contexto restringido a sus tools.
 *  - Skill guiada (registro, solo `procedimiento`): sub-loop del modelo (skill-guiada.ts).
 *  - Skill creada en la UI (fila origen ui): se convierte a guiada y corre igual.
 */
export async function ejecutarSkill(
  nombreOFila: string | any,
  args: Record<string, unknown>,
  ctxBase?: ContextoEjecucion,
): Promise<ResultadoTool> {
  if (typeof nombreOFila !== "string") return ejecutarSkillGuiada(desdeFilaUI(nombreOFila), args, ctxBase);
  const nombre = nombreOFila;

  const def = registro.skill(nombre);
  if (def) {
    const val = validarArgs(def.parametros, args || {});
    if (!val.ok) return { ok: false, error: `Argumentos inválidos para ${nombre}: ${val.errores.join(" ")}` };
    if (def.ejecutar) {
      const ctx = crearContexto(ctxBase?.agenteId ?? null, ctxBase?.ejecucionId ?? null, def.tools);
      try {
        const tSeg = def.timeoutSeg ?? 300;
        const r = await conTimeout(def.ejecutar(val.valor, ctx), tSeg * 1000, `La skill ${nombre} superó ${Math.round(tSeg / 60)} minutos.`);
        return normalizar(r, nombre);
      } catch (e: any) {
        return { ok: false, error: `${nombre} lanzó una excepción: ${e?.message || String(e)}` };
      }
    }
    return ejecutarSkillGuiada({
      nombre: def.nombre, descripcion: def.descripcion, procedimiento: def.procedimiento || "",
      tools: def.tools, riesgo: def.riesgo,
    }, val.valor, ctxBase);
  }

  const [fila] = await query<any>(`SELECT * FROM skills WHERE nombre = $1 AND origen = 'ui' AND activo = true LIMIT 1`, [nombre]);
  if (fila) return ejecutarSkillGuiada(desdeFilaUI(fila), args, ctxBase);

  return { ok: false, error: `La skill "${nombre}" no existe.` };
}

// ─── Utilidades ──────────────────────────────────────────────────────────────
function conTimeout<T>(p: Promise<T>, ms: number, msg: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(msg)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

function normalizar(r: any, nombre: string): ResultadoTool {
  if (!r || typeof r !== "object" || typeof r.ok !== "boolean") {
    return { ok: false, error: `${nombre} devolvió un resultado inválido (debe ser {ok, datos?, resumen?, error?}).` };
  }
  if (!r.ok && !r.error) r.error = "Falló sin detalle.";
  return r;
}