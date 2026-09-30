// ARCHIVO: src/flujos/jelcom.ts
// ─────────────────────────────────────────────────────────────────────────────
//  FLUJO: jelcom_envio_completo — de la base al informe, sin volver a pedir nada
//  Sebastián manda la base y dice qué quiere. El flujo:
//   1. valida la base con las reglas reales de Jelcom (no crea nada si no sirve)
//   2. crea el envío (SMS / WhatsApp / correo) y sube la base
//   3. te muestra el resumen y pide UNA aprobación para disparar
//   4. dispara y observa con el ritmo que elijas, avisándote el avance
//   5. si la tasa de error se dispara: diagnostica, pausa si es grave y te avisa
//   6. al terminar: informe Excel + resumen, sin que lo pidas
//  Sobrevive reinicios (las esperas se persisten). Se corta con flujo_cancelar.
// ─────────────────────────────────────────────────────────────────────────────

import type { DefFlujo } from "../registro/tipos.js";

const MODULO = "jelcom";
const jefe = (c: Record<string, any>) => c.numero || process.env.WHATSAPP_NUMERO_JEFE || "";
const pct = (c: Record<string, any>) => { const o = c.obs || {}; const t = Number(o.total) || 0; return t ? Math.round((Number(o.enviados) || 0) * 100 / t) : 0; };

export const jelcomEnvioCompleto: DefFlujo = {
  nombre: "jelcom_envio_completo",
  modulo: MODULO,
  descripcion: "Hace un envío de Jelcom de punta a punta: valida la base, crea el envío (sms, whatsapp o correo), lo sube, te pide UNA aprobación, dispara, te va contando el avance cada N minutos, diagnostica y pausa si hay muchos errores, y al terminar te manda el informe Excel con el resumen. Si ya existe el envío, pasá envio_id y se salta la creación.",
  parametros: {
    type: "object",
    properties: {
      canal: { type: "string", enum: ["sms", "whatsapp", "correo"], description: "Canal del envío." },
      archivo_id: { type: "string", description: "Base de contactos (CSV/Excel) que mandó el jefe." },
      campana_id: { type: "integer", description: "Campaña de Jelcom.", minimum: 1 },
      cuenta_id: { type: "integer", description: "Cuenta del canal (SMS o WhatsApp).", minimum: 1 },
      texto: { type: "string", description: "Texto del SMS o del correo." },
      plantilla: { type: "string", description: "Nombre de la plantilla (canal whatsapp)." },
      idioma: { type: "string", description: "Idioma de la plantilla (whatsapp).", default: "es" },
      asunto: { type: "string", description: "Asunto (canal correo)." },
      nombre: { type: "string", description: "Nombre del envío (opcional)." },
      envio_id: { type: "integer", description: "Si el envío ya existe, su id (se salta crear y subir).", minimum: 1 },
      avisar_cada_min: { type: "integer", description: "Cada cuántos minutos contarte el avance.", default: 5, minimum: 1, maximum: 120 },
      umbral_error: { type: "number", description: "Tasa de error (%) que dispara el diagnóstico.", default: 20, minimum: 1, maximum: 100 },
      numero: { type: "string", description: "WhatsApp al que reportar (por defecto el jefe)." },
      consolidado: { type: "boolean", description: "true si el envío fue dividido (informe consolidado).", default: false },
    },
    required: ["canal"],
  },
  riesgo: "ejecucion",
  inicio: "hay_envio",
  pasos: [
    // ── 1. ¿Ya existe el envío o hay que crearlo? ──
    { id: "hay_envio", tipo: "condicion", si: (c) => !!c.envio_id, entonces: "ver", sino: "buscar_base" },

    // ── 2. Base: buscarla si no la dieron, e inspeccionarla ──
    { id: "buscar_base", tipo: "condicion", si: (c) => !!c.archivo_id, entonces: "inspeccionar", sino: "listar_archivos" },
    { id: "listar_archivos", tipo: "tool", tool: "archivo_listar", args: { solo_bases: true, limite: 5 }, guardarEn: "archivos" },
    { id: "tomar_base", tipo: "condicion", si: (c) => { const a = (c.archivos || [])[0]; if (a) c.archivo_id = a.archivo_id; return !!a; }, entonces: "inspeccionar", sino: "fin_sin_base" },
    { id: "inspeccionar", tipo: "tool", tool: "jelcom_inspeccionar_base", args: (c) => ({ archivo_id: c.archivo_id }), guardarEn: "base" },
    { id: "base_ok", tipo: "condicion", si: (c) => Number(c.base?.telefonos_plausibles) > 0, entonces: "crear", sino: "fin_base_mala" },

    // ── 3. Crear el envío y subir la base ──
    { id: "crear", tipo: "tool", tool: "jelcom_crear_envio", args: (c) => ({
        campana_id: c.campana_id, canal: c.canal, cuenta_sms_id: c.canal === "sms" ? c.cuenta_id : undefined, cuenta_wa_id: c.canal === "whatsapp" ? c.cuenta_id : undefined,
        cuerpo: c.texto, plantilla: c.plantilla, idioma: c.idioma || "es", asunto: c.asunto,
        nombre: c.nombre || `${c.canal.toUpperCase()} ${new Date().toISOString().slice(0, 16).replace("T", " ")}`,
      }), guardarEn: "creado" },
    { id: "tomar_id", tipo: "condicion", si: (c) => { const id = c.creado?.envio_id ?? c.creado?.id; if (id) c.envio_id = id; return !!id; }, entonces: "subir", sino: "fin_no_creado" },
    { id: "subir", tipo: "tool", tool: "jelcom_subir_base", args: (c) => ({ envio_id: c.envio_id, archivo_id: c.archivo_id }), guardarEn: "carga" },

    // ── 4. Resumen y UNA aprobación ──
    { id: "ver", tipo: "tool", tool: "jelcom_ver_envio", args: (c) => ({ envio_id: c.envio_id }), guardarEn: "envio" },
    { id: "tiene_validos", tipo: "condicion", si: (c) => Number(c.envio?.validos ?? c.carga?.validos) > 0, entonces: "ya_corre", sino: "fin_sin_validos" },
    { id: "ya_corre", tipo: "condicion", si: (c) => ["en_curso", "pausada", "finalizada"].includes(String(c.envio?.estado)), entonces: "monitor", sino: "aprobar" },
    { id: "aprobar", tipo: "aprobacion", mensaje: (c) => `📨 *Envío listo para disparar*\n• #${c.envio_id} ${c.envio?.nombre || ""}\n• Canal: ${String(c.canal).toUpperCase()}${c.cuenta_id ? ` (cuenta ${c.cuenta_id})` : ""}\n• Contactos válidos: ${c.envio?.validos ?? c.carga?.validos}${c.carga?.duplicados ? ` · duplicados ${c.carga.duplicados}` : ""}${c.carga?.invalidos ? ` · inválidos ${c.carga.invalidos}` : ""}\n• ${c.canal === "whatsapp" ? `Plantilla: ${c.plantilla}` : c.canal === "correo" ? `Asunto: ${c.asunto || "—"}` : `Texto: "${String(c.texto || "").slice(0, 120)}"`}\n\n¿Lo disparo? Te voy contando el avance cada ${c.avisar_cada_min || 5} min y al terminar te mando el informe.` },
    { id: "disparar", tipo: "tool", tool: "jelcom_disparar_envio", args: (c) => ({ envio_id: c.envio_id }), preaprobado: true, guardarEn: "disparo" },
    { id: "avisar_inicio", tipo: "tool", tool: "whatsapp_enviar_texto", args: (c) => ({ numero: jefe(c), texto: `🚀 Envío #${c.envio_id} disparado (${c.envio?.validos ?? "?"} contactos). Te cuento cada ${c.avisar_cada_min || 5} min.` }), siFalla: "continuar" },

    // ── 5. Monitoreo con avisos ──
    { id: "monitor", tipo: "repetir", hasta: (c) => !!c.obs?.terminado || !!c.detenido, maxVeces: 2000, cuerpo: ["observar", "avisar_avance", "evaluar", "diagnosticar", "decidir"], cadaSegundos: (c) => Math.max(30, (Number(c.avisar_cada_min) || 5) * 60) },
    { id: "observar", tipo: "skill", skill: "jelcom_monitorear_envio", args: (c) => ({ envio_id: c.envio_id, umbral_error: c.umbral_error ?? 20 }), guardarEn: "obs", siFalla: "continuar" },
    { id: "avisar_avance", tipo: "tool", tool: "whatsapp_enviar_texto", args: (c) => ({ numero: jefe(c), texto: `📊 #${c.envio_id}: ${c.obs?.enviados ?? 0}/${c.obs?.total ?? 0} (${pct(c)}%) · ${c.obs?.errores ?? 0} errores${c.obs?.terminado ? " · terminado" : ""}` }), siFalla: "continuar" },
    { id: "evaluar", tipo: "condicion", si: (c) => !!c.obs?.alerta && !c.obs?.terminado, entonces: "diagnosticar", sino: "monitor" },
    { id: "diagnosticar", tipo: "skill", skill: "jelcom_diagnosticar_errores", args: (c) => ({ envio_id: c.envio_id, numero_aviso: jefe(c), pausar_si_grave: true }), guardarEn: "diag", siFalla: "continuar" },
    { id: "decidir", tipo: "condicion", si: (c) => !!c.diag?.pausado || c.obs?.estado === "pausada", entonces: "marcar_detenido", sino: "monitor" },
    { id: "marcar_detenido", tipo: "tool", tool: "sistema_eco", args: (c) => ({ texto: `envío #${c.envio_id} detenido para revisión` }), guardarEn: "detenido" },

    // ── 6. Cierre: informe solo ──
    { id: "termino_bien", tipo: "condicion", si: (c) => c.obs?.estado === "finalizada", entonces: "reporte", sino: "fin_detenido" },
    { id: "reporte", tipo: "skill", skill: "jelcom_reportar_envio", args: (c) => ({ envio_id: c.envio_id, numero: jefe(c), consolidado: !!c.consolidado }), guardarEn: "reporte", siFalla: "continuar" },
    { id: "fin", tipo: "fin", resultado: (c) => ({ envio_id: c.envio_id, canal: c.canal, estado: c.obs?.estado, enviados: c.obs?.enviados, errores: c.obs?.errores, total: c.obs?.total, tasa_error: c.obs?.tasa_error, reporte: c.reporte }) },

    // ── Finales de fallo, cada uno con su explicación ──
    { id: "fin_sin_base", tipo: "fin", fallo: true, resultado: () => ({ error: "No encontré la base. Mandámela como archivo (CSV o Excel) y lo hago." }) },
    { id: "fin_base_mala", tipo: "fin", fallo: true, resultado: (c) => ({ error: `La base no sirve para Jelcom.`, detalle: c.base }) },
    { id: "fin_no_creado", tipo: "fin", fallo: true, resultado: (c) => ({ error: `No pude crear el envío en Jelcom.`, detalle: c.creado }) },
    { id: "fin_sin_validos", tipo: "fin", fallo: true, resultado: (c) => ({ error: `El envío #${c.envio_id} quedó con 0 contactos válidos.`, detalle: c.carga }) },
    { id: "fin_detenido", tipo: "fin", resultado: (c) => ({ envio_id: c.envio_id, estado: c.obs?.estado, detenido: true, diagnostico: c.diag, enviados: c.obs?.enviados, errores: c.obs?.errores, total: c.obs?.total }) },
  ],
  reporte: (c, r: any) => {
    if (r?.error) return `❌ ${r.error}${r.detalle?.problemas ? `\n${r.detalle.problemas.join(" ")}` : ""}${r.detalle?.encabezados ? `\nLa base tiene: ${r.detalle.encabezados.join(", ")}. Jelcom necesita una columna telefono/celular/movil con números de 10 dígitos que empiecen en 3.` : ""}`;
    if (r?.detenido) return `⏸ Envío #${c.envio_id} quedó ${r.estado} tras ${r.enviados ?? "?"}/${r.total ?? "?"} enviados y ${r.errores ?? "?"} errores. Cuando lo resuelvas decime "reanudá el envío ${c.envio_id}" y sigo observándolo.`;
    return `✅ Envío #${c.envio_id} terminado: ${r?.enviados ?? "?"}/${r?.total ?? "?"} enviados, ${r?.errores ?? 0} errores (${r?.tasa_error ?? 0}%). El informe te llegó arriba.`;
  },
};

export const flujosJelcom: DefFlujo[] = [jelcomEnvioCompleto];