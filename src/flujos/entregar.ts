// ARCHIVO: src/flujos/entregar.ts
// ─────────────────────────────────────────────────────────────────────────────
//  FLUJO: entregar_cambios — del sandbox a GitHub con UN solo OK
//   1. Commit en la rama del sandbox (si quedó algo sin commit).
//   2. Lo pone al día con lo último de GitHub (rebase): si alguien subió
//      cambios mientras Sage trabajaba, no se pisan. Conflicto = se detiene.
//   3. Verifica (build, lint, tests) YA sobre esa versión actualizada.
//   4. Te muestra archivos, verificación y destino, y pide UNA aprobación.
//   5. Sube directo a la rama base en GitHub (Railway despliega solo) sin tocar
//      tu carpeta de trabajo; si tu copia local está limpia, la pone al día.
//   6. Cierra los sandboxes del proyecto y reinicia el proyecto si corría.
// ─────────────────────────────────────────────────────────────────────────────
import type { DefFlujo } from "../registro/tipos.js";

const lista = (xs: string[] = [], n = 12) => xs.length ? `${xs.slice(0, n).join(", ")}${xs.length > n ? ` y ${xs.length - n} más` : ""}` : "(ver diff)";

export const entregarCambios: DefFlujo = {
  nombre: "entregar_cambios",
  modulo: "entregar",
  descripcion: "Lleva los cambios de un sandbox a GitHub con UN solo OK: commit, actualización con lo último de GitHub, verificación, aprobación, subida a la rama base (Railway despliega), cierre de sandboxes y reinicio del proyecto si corría.",
  parametros: {
    type: "object",
    properties: {
      sandbox_id: { type: "string", description: "Sandbox con los cambios.", minLength: 8 },
      mensaje: { type: "string", description: "Mensaje de commit (opcional; se arma uno si falta)." },
      reiniciar: { type: "boolean", description: "Reiniciar el proceso del proyecto si estaba corriendo.", default: true },
      verificar: { type: "boolean", description: "Correr build/lint/tests antes de pedir el OK.", default: true },
    },
    required: ["sandbox_id"],
  },
  riesgo: "sistema",
  inicio: "proyecto",
  pasos: [
    { id: "proyecto", tipo: "tool", tool: "codigo_listar_sandboxes", args: {}, guardarEn: "sbs", siFalla: "continuar" },
    { id: "resolver", tipo: "condicion", si: (c) => { const sb = (c.sbs || []).find((x: any) => x.sandbox_id === c.sandbox_id || String(x.sandbox_id).startsWith(String(c.sandbox_id).slice(0, 8))); if (sb) { c.proyecto = sb.proyecto; c.rama = sb.rama; c.sandbox_id = sb.sandbox_id; } return !!sb; }, entonces: "commit", sino: "fin_no_existe" },
    { id: "commit", tipo: "tool", tool: "codigo_commit", args: (c) => ({ sandbox_id: c.sandbox_id, mensaje: c.mensaje || `Cambios de Sage (${new Date().toISOString().slice(0, 10)})` }), siFalla: "continuar", guardarEn: "commit" },
    { id: "actualizar", tipo: "tool", tool: "codigo_actualizar_sandbox", args: (c) => ({ sandbox_id: c.sandbox_id }), guardarEn: "actualizado", siFalla: "continuar" },
    { id: "al_dia", tipo: "condicion", si: (c) => !!c.__resultados?.actualizar?.ok, entonces: "diff", sino: "fin_conflicto" },
    { id: "diff", tipo: "tool", tool: "codigo_diff", args: (c) => ({ sandbox_id: c.sandbox_id, max_chars: 4000 }), guardarEn: "diff" },
    { id: "hay_cambios", tipo: "condicion", si: (c) => !!(c.diff?.archivos?.length), entonces: "verificar_o_no", sino: "fin_sin_cambios" },
    { id: "verificar_o_no", tipo: "condicion", si: (c) => c.verificar !== false, entonces: "verificar", sino: "aprobar" },
    { id: "verificar", tipo: "tool", tool: "codigo_verificar", args: (c) => ({ sandbox_id: c.sandbox_id }), guardarEn: "ver", siFalla: "continuar" },
    { id: "verifico_ok", tipo: "condicion", si: (c) => !!c.__resultados?.verificar?.ok, entonces: "aprobar", sino: "fin_no_verifica" },
    { id: "aprobar", tipo: "aprobacion", textoFinal: true, mensaje: (c) => [
        `🧩 *Listo para subir: ${c.proyecto}*`,
        `📄 ${c.diff?.archivos?.length || 0} archivo(s): ${lista(c.diff?.archivos)}`,
        `🔄 ${c.actualizado?.mensaje || "Al día con GitHub."}`,
        `✅ Verificación: ${c.verificar === false ? "omitida" : String(c.__resultados?.verificar?.resumen || "sin comandos configurados").split("\n").filter((l: string) => /^[✔✘]/.test(l) || !/^[✔✘]/.test(String(c.__resultados?.verificar?.resumen || ""))).slice(0, 4).join(" · ")}`,
        `🚀 Sube a la rama base en GitHub (Railway despliega solo)${c.reiniciar !== false ? " y reinicio el proyecto local si corre" : ""}.`,
        ``, `¿Lo subo? Responde *ok* o *no*.`,
      ].join("\n") },
    { id: "integrar", tipo: "tool", tool: "codigo_integrar", args: (c) => ({ sandbox_id: c.sandbox_id }), preaprobado: true, guardarEn: "integrado" },
    { id: "cerrar", tipo: "tool", tool: "codigo_cerrar_sandbox", args: (c) => ({ sandbox_id: c.sandbox_id, borrar_rama: true }), siFalla: "continuar" },
    { id: "cerrar_otros", tipo: "repetir", hasta: (c) => !((c.sbs || []).filter((x: any) => x.proyecto === c.proyecto && x.sandbox_id !== c.sandbox_id && !(c.__cerrados || []).includes(x.sandbox_id)).length), maxVeces: 10, cuerpo: ["cerrar_uno"] },
    { id: "reiniciar_o_no", tipo: "condicion", si: (c) => c.reiniciar !== false && !!c.proyecto, entonces: "estado_proc", sino: "fin" },
    { id: "estado_proc", tipo: "tool", tool: "runtime_estado", args: (c) => ({ proyecto: c.proyecto }), guardarEn: "proc", siFalla: "continuar" },
    { id: "corria", tipo: "condicion", si: (c) => (Array.isArray(c.proc) ? c.proc[0]?.estado : c.proc?.estado) === "corriendo", entonces: "reiniciar", sino: "fin" },
    { id: "reiniciar", tipo: "tool", tool: "runtime_reiniciar", args: (c) => ({ proyecto: c.proyecto }), siFalla: "continuar", guardarEn: "reinicio" },
    { id: "fin", tipo: "fin", resultado: (c) => ({ proyecto: c.proyecto, archivos: c.diff?.archivos, subido: String(c.__resultados?.integrar?.resumen || ""), reiniciado: !!c.reinicio }) },

    { id: "cerrar_uno", tipo: "tool", tool: "codigo_cerrar_sandbox", args: (c) => { const otro = (c.sbs || []).find((x: any) => x.proyecto === c.proyecto && x.sandbox_id !== c.sandbox_id && !(c.__cerrados || []).includes(x.sandbox_id)); c.__cerrados = [...(c.__cerrados || []), otro?.sandbox_id]; return { sandbox_id: otro?.sandbox_id, borrar_rama: true }; }, siFalla: "continuar" },

    { id: "fin_no_existe", tipo: "fin", fallo: true, resultado: (c) => ({ error: `No encuentro el sandbox ${c.sandbox_id} abierto.` }) },
    { id: "fin_conflicto", tipo: "fin", fallo: true, resultado: (c) => ({ error: `No subí nada: ${c.__resultados?.actualizar?.error || "no pude actualizar el sandbox con GitHub"}. Dime "resuelve los conflictos del sandbox ${String(c.sandbox_id).slice(0, 8)}" y le pido a Claude Code que los arregle.` }) },
    { id: "fin_sin_cambios", tipo: "fin", fallo: true, resultado: (c) => ({ error: `El sandbox ${String(c.sandbox_id).slice(0, 8)} no tiene cambios respecto a la rama base. Nada que subir.` }) },
    { id: "fin_no_verifica", tipo: "fin", fallo: true, resultado: (c) => ({ error: `La verificación falló, no subo nada.\n${String(c.__resultados?.verificar?.resumen || c.__resultados?.verificar?.error || "").slice(0, 900)}` }) },
  ],
  reporte: (c, r: any) => r?.error ? `❌ ${r.error}` : `✅ *${r?.proyecto || "Proyecto"} actualizado en GitHub*: ${(r?.archivos || []).length} archivo(s).\n${r?.subido || ""}${r?.reiniciado ? "\n🔁 Proyecto local reiniciado." : ""}\nRailway despliega solo en un momento.`,
};

export const flujosEntregar = [entregarCambios];
