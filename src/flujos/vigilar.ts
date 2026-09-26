// ARCHIVO: src/flujos/vigilar.ts
// ─────────────────────────────────────────────────────────────────────────────
//  FLUJO: vigilar_proyecto — guardia permanente de un proyecto en ejecución
//  Cada N segundos corre vigilar_ciclo. Si el Senior dejó un arreglo, pide tu
//  OK y con él: commit → integrar → instalar deps → reiniciar → cerrar sandbox.
//  Corre hasta que lo detengas (flujo_cancelar). Sobrevive reinicios de Emilia.
// ─────────────────────────────────────────────────────────────────────────────

import type { DefFlujo } from "../registro/tipos.js";

const jefe = (c: Record<string, any>) => c.numero || process.env.WHATSAPP_NUMERO_JEFE || "";

export const vigilarProyecto: DefFlujo = {
  nombre: "vigilar_proyecto",
  modulo: "vigilar",
  descripcion: "Vigila un proyecto en ejecución de forma permanente: cada N segundos revisa proceso, salud y errores; lo reinicia si cae; si persiste, el Senior lo repara en sandbox y te pide OK para integrar y reiniciar. Te avisa solo cuando algo cambia. Se detiene con flujo_cancelar.",
  parametros: {
    type: "object",
    properties: {
      proyecto: { type: "string", minLength: 2 },
      cada_segundos: { type: "integer", description: "Intervalo entre revisiones.", default: 300, minimum: 30, maximum: 86400 },
      max_reinicios: { type: "integer", description: "Reinicios automáticos antes de escalar al Senior.", default: 3, minimum: 0, maximum: 20 },
      auto_reparar: { type: "boolean", description: "Permitir que el Senior intente reparar solo (siempre con tu OK para integrar).", default: true },
      numero: { type: "string", description: "WhatsApp para avisos (defecto: el jefe)." },
    },
    required: ["proyecto"],
  },
  riesgo: "ejecucion",
  inicio: "ciclo",
  pasos: [
    { id: "ciclo", tipo: "repetir", hasta: () => false, maxVeces: 1000000, cuerpo: ["vigilar", "hay_arreglo", "aprobar", "commit", "integrar", "instalar", "reiniciar", "cerrar", "limpiar"], cadaSegundos: (c) => Number(c.cada_segundos) || 300 },
    { id: "fin", tipo: "fin", resultado: (c) => ({ proyecto: c.proyecto, ciclos: c.__iteraciones?.ciclo }) },
    // ── cuerpo ──
    { id: "vigilar", tipo: "skill", skill: "vigilar_ciclo", args: (c) => ({
        proyecto: c.proyecto, numero_aviso: jefe(c), max_reinicios: c.max_reinicios ?? 3, auto_reparar: c.auto_reparar !== false,
        reinicios_previos: c.vig?.reinicios || 0, nivel_previo: c.vig?.nivel || "sano", huella_previa: c.vig?.huella || "", reparacion_pendiente: !!c.vig?.necesita_aprobacion,
      }), guardarEn: "vig", siFalla: "continuar" },
    { id: "hay_arreglo", tipo: "condicion", si: (c) => !!c.vig?.necesita_aprobacion && !!c.vig?.sandbox_id, entonces: "aprobar", sino: "ciclo" },
    { id: "aprobar", tipo: "aprobacion", mensaje: (c) => c.vig.mensaje || `¿Integro el arreglo de ${c.proyecto} (sandbox ${c.vig.sandbox_id}) y reinicio?` },
    { id: "commit", tipo: "tool", tool: "codigo_commit", args: (c) => ({ sandbox_id: c.vig.sandbox_id, mensaje: `Reparación automática (vigilancia): ${String(c.vig.informe || "").slice(0, 60)}` }), preaprobado: true, siFalla: "continuar" },
    { id: "integrar", tipo: "tool", tool: "codigo_integrar", args: (c) => ({ sandbox_id: c.vig.sandbox_id }), preaprobado: true, guardarEn: "integrado", siFalla: "continuar" },
    { id: "instalar", tipo: "tool", tool: "proyecto_instalar", args: (c) => ({ proyecto: c.proyecto }), siFalla: "continuar" },
    { id: "reiniciar", tipo: "tool", tool: "runtime_reiniciar", args: (c) => ({ proyecto: c.proyecto }), siFalla: "continuar", guardarEn: "reinicio" },
    { id: "cerrar", tipo: "tool", tool: "codigo_cerrar_sandbox", args: (c) => ({ sandbox_id: c.vig.sandbox_id, borrar_rama: true }), siFalla: "continuar" },
    { id: "limpiar", tipo: "tool", tool: "sistema_eco", args: (c) => ({ texto: `arreglo integrado en ${c.proyecto}` }), guardarEn: "vig" },   // resetea el estado de vigilancia
  ],
  reporte: (c) => `⏹ Vigilancia de ${c.proyecto} detenida.`,
};

export const flujosVigilar: DefFlujo[] = [vigilarProyecto];