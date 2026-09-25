// ARCHIVO: src/skills/sistema.ts
// ─────────────────────────────────────────────────────────────────────────────
//  SKILLS DE SISTEMA
//  Ejemplo canónico de skill en código: orquesta varias tools con lógica
//  propia y devuelve un resultado compuesto. El ejecutor solo le deja llamar
//  las tools listadas en `tools`.
// ─────────────────────────────────────────────────────────────────────────────

import type { DefSkill } from "../registro/tipos.js";

const MODULO = "sistema";

export const sistemaDiagnostico: DefSkill = {
  nombre: "sistema_diagnostico",
  modulo: MODULO,
  descripcion: "Corre un diagnóstico del motor: comprueba hora, eco y una espera corta, y devuelve un informe de qué funcionó. Úsala cuando te pidan verificar que el sistema de herramientas está sano.",
  cuandoUsar: "Cuando el usuario pide 'probá el sistema', 'hacé un diagnóstico' o 'verificá que las herramientas funcionan'.",
  parametros: {
    type: "object",
    properties: {
      incluir_espera: { type: "boolean", description: "Si true, incluye una espera de 2 segundos en la prueba.", default: false },
    },
    required: [],
  },
  riesgo: "lectura",
  requiereAprobacion: false,
  tools: ["sistema_ahora", "sistema_eco", "sistema_esperar"],
  async ejecutar(args, ctx) {
    const informe: string[] = [];
    let todoOk = true;

    const hora = await ctx.ejecutarTool("sistema_ahora", {});
    informe.push(hora.ok ? `✔ hora: ${hora.resumen}` : `✘ hora: ${hora.error}`);
    todoOk &&= hora.ok;

    const eco = await ctx.ejecutarTool("sistema_eco", { texto: "diagnostico" });
    const ecoBien = eco.ok && (eco.datos as any)?.texto === "diagnostico";
    informe.push(ecoBien ? "✔ eco: devolvió el texto exacto" : `✘ eco: ${eco.error || "no devolvió el texto exacto"}`);
    todoOk &&= ecoBien;

    if (args.incluir_espera) {
      const t0 = Date.now();
      const esp = await ctx.ejecutarTool("sistema_esperar", { segundos: 2 });
      const ms = Date.now() - t0;
      const espBien = esp.ok && ms >= 1900;
      informe.push(espBien ? `✔ espera: ${ms} ms` : `✘ espera: ${esp.error || `duró solo ${ms} ms`}`);
      todoOk &&= espBien;
    }

    await ctx.traza("skill", `sistema_diagnostico → ${todoOk ? "todo ok" : "hubo fallos"}`);
    return {
      ok: todoOk,
      datos: { lineas: informe },
      resumen: `Diagnóstico ${todoOk ? "exitoso" : "con fallos"}:\n${informe.join("\n")}`,
      error: todoOk ? undefined : "Alguna prueba falló (ver resumen).",
    };
  },
};

export const skillsSistema: DefSkill[] = [sistemaDiagnostico];