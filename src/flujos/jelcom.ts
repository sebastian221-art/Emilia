// ARCHIVO: src/flujos/jelcom.ts
// ─────────────────────────────────────────────────────────────────────────────
//  FLUJO: campaña por WhatsApp
//  El envío ya existe con base cargada (lo arma la skill jelcom_crear_envio_guiado).
//  Este flujo: verifica → dispara (pide aprobación solo) → observa cada 60 s →
//  si hay alerta diagnostica (pausa si es grave y avisa al jefe) → al terminar
//  manda el informe Excel + resumen al jefe.
// ─────────────────────────────────────────────────────────────────────────────

import type { DefFlujo } from "../registro/tipos.js";

const MODULO = "jelcom";
const jefe = (ctx: Record<string, any>) => ctx.numero || process.env.WHATSAPP_NUMERO_JEFE || "";

export const jelcomCampanaPorWhatsapp: DefFlujo = {
  nombre: "jelcom_campana_por_whatsapp",
  modulo: MODULO,
  descripcion: "Dispara un envío ya preparado (pide tu aprobación), lo observa cada minuto, pausa y diagnostica si hay errores, y al terminar te manda el informe Excel por WhatsApp con un resumen. Si el envío ya está corriendo, pasá ya_disparado=true para solo monitorearlo.",
  parametros: {
    type: "object",
    properties: {
      envio_id: { type: "integer", description: "Id del envío en Jelcom (creado y con base cargada).", minimum: 1 },
      numero: { type: "string", description: "WhatsApp al que reportar (el jefe). Si se omite, el número del jefe configurado." },
      ya_disparado: { type: "boolean", description: "true si el envío ya está en curso/pausado y solo hay que monitorear.", default: false },
      umbral_error: { type: "number", description: "Tasa de error (%) que dispara diagnóstico.", default: 20, minimum: 1, maximum: 100 },
      consolidado: { type: "boolean", description: "true si el envío fue dividido (informe consolidado).", default: false },
    },
    required: ["envio_id"],
  },
  riesgo: "ejecucion",
  inicio: "ver",
  pasos: [
    { id: "ver",          tipo: "tool", tool: "jelcom_ver_envio", args: (c) => ({ envio_id: c.envio_id }), guardarEn: "envio" },
    { id: "tiene_base",   tipo: "condicion", si: (c) => Number(c.envio?.validos) > 0, entonces: "ya_corre", sino: "fin_sin_base" },
    { id: "ya_corre",     tipo: "condicion", si: (c) => !!c.ya_disparado || ["en_curso", "pausada", "finalizada"].includes(c.envio?.estado), entonces: "monitor", sino: "disparar" },
    { id: "disparar",     tipo: "tool", tool: "jelcom_disparar_envio", args: (c) => ({ envio_id: c.envio_id }) },   // requiereAprobacion → pausa sola
    { id: "monitor",      tipo: "repetir", hasta: (c) => !!c.obs?.terminado || !!c.detenido, maxVeces: 360, cuerpo: ["observar", "evaluar", "diagnosticar", "decidir"], cadaSegundos: 60 },
    { id: "termino_bien", tipo: "condicion", si: (c) => c.obs?.estado === "finalizada", entonces: "reporte", sino: "fin_detenido" },
    { id: "reporte",      tipo: "skill", skill: "jelcom_reportar_envio", args: (c) => ({ envio_id: c.envio_id, numero: jefe(c), consolidado: !!c.consolidado }), guardarEn: "reporte", siFalla: "continuar" },
    { id: "fin",          tipo: "fin", resultado: (c) => ({ envio_id: c.envio_id, estado: c.obs?.estado, enviados: c.obs?.enviados, errores: c.obs?.errores, total: c.obs?.total, tasa_error: c.obs?.tasa_error, reporte: c.reporte }) },
    { id: "fin_sin_base", tipo: "fin", fallo: true, resultado: (c) => ({ error: `El envío #${c.envio_id} no tiene base cargada.` }) },
    { id: "fin_detenido", tipo: "fin", resultado: (c) => ({ envio_id: c.envio_id, estado: c.obs?.estado, detenido: true, diagnostico: c.diag, enviados: c.obs?.enviados, errores: c.obs?.errores, total: c.obs?.total }) },
    // ── cuerpo del monitor ──
    { id: "observar",     tipo: "skill", skill: "jelcom_monitorear_envio", args: (c) => ({ envio_id: c.envio_id, umbral_error: c.umbral_error ?? 20 }), guardarEn: "obs", siFalla: "continuar" },
    { id: "evaluar",      tipo: "condicion", si: (c) => !!c.obs?.alerta && !c.obs?.terminado, entonces: "diagnosticar", sino: "monitor" },
    { id: "diagnosticar", tipo: "skill", skill: "jelcom_diagnosticar_errores", args: (c) => ({ envio_id: c.envio_id, numero_aviso: jefe(c), pausar_si_grave: true }), guardarEn: "diag", siFalla: "continuar" },
    { id: "decidir",      tipo: "condicion", si: (c) => !!c.diag?.pausado || c.obs?.estado === "pausada", entonces: "marcar_detenido", sino: "monitor" },
    { id: "marcar_detenido", tipo: "tool", tool: "sistema_eco", args: (c) => ({ texto: `envío #${c.envio_id} detenido para revisión` }), guardarEn: "detenido" },
  ],
  reporte: (c, r: any) => r?.detenido
    ? `⏸ Envío #${c.envio_id} quedó ${r.estado} tras ${r.enviados ?? "?"}/${r.total ?? "?"} enviados y ${r.errores ?? "?"} errores. Cuando lo resuelvas decime "reanudá el envío ${c.envio_id}" y sigo observándolo.`
    : `✅ Envío #${c.envio_id} terminado: ${r?.enviados ?? "?"}/${r?.total ?? "?"} enviados, ${r?.errores ?? 0} errores (${r?.tasa_error ?? 0}%). Te mandé el informe Excel arriba.`,
};

export const flujosJelcom: DefFlujo[] = [jelcomCampanaPorWhatsapp];