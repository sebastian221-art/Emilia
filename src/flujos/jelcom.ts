// ARCHIVO: src/flujos/jelcom.ts
// ─────────────────────────────────────────────────────────────────────────────
//  FLUJO: jelcom_envio_completo — de la base al informe, siempre igual
//   1. PREPARA: valida todo antes de crear (cuenta, plantilla real en Meta,
//      imagen, idioma, voz, base con las reglas de Jelcom, segmentos, costo).
//      Si falta algo, lo pide con opciones y NO crea nada.
//   2. Crea el envío y sube la base.
//   3. PRUEBA: te manda un mensaje igual al real (por defecto sí).
//   4. Ficha completa (archivo, cliente, cuenta, contenido, válidos, costo,
//      prueba, hora) y UNA aprobación.
//   5. Si está programado, espera la hora (sobrevive reinicios).
//   6. Dispara (o lo divide en N partes en paralelo si lo pediste).
//   7. Vigila cada minuto. Avisa en 25/50/75 % con tiempo restante, y si pasa
//      mucho sin novedades. Si los errores se disparan: diagnostica y pausa.
//   8. Al terminar: UN informe (consolidado si se dividió) + resumen con costo,
//      y recuerda lo usado con este cliente para la próxima.
//  Se corta con flujo_cancelar.
// ─────────────────────────────────────────────────────────────────────────────

import type { DefFlujo } from "../registro/tipos.js";
import { textoFicha, segundosHasta, horaLegible } from "../skills/jelcom.js";
import { num } from "../tools/jelcom.js";

const MODULO = "jelcom";
const jefe = (c: Record<string, any>) => c.numero || process.env.WHATSAPP_NUMERO_JEFE || "";
const minutos = (seg: number) => (seg < 90 ? "1 min" : seg < 3600 ? `${Math.round(seg / 60)} min` : `${Math.floor(seg / 3600)} h ${Math.round((seg % 3600) / 60)} min`);
const programado = (c: Record<string, any>) => { const s = segundosHasta(c.programar_para); return s > 0 ? Math.min(s, 20 * 86400) : 0; };

/** Decide si toca avisar: hitos 25/50/75 % o mucho tiempo sin novedades. Calcula el tiempo restante con el ritmo real. */
function decidirAviso(c: Record<string, any>): boolean {
  const o = c.obs || {}; const ahora = Date.now();
  let eta = "";
  if (c.__previo && o.procesados > c.__previo.procesados && o.pendientes > 0) {
    const ritmo = (o.procesados - c.__previo.procesados) / ((ahora - c.__previo.t) / 1000);
    if (ritmo > 0) eta = ` · faltan ≈${minutos(o.pendientes / ritmo)}`;
  }
  c.__previo = { procesados: o.procesados || 0, t: ahora };
  c.aviso_texto = null;
  if (o.terminado || !o.total) return false;
  const avance = Number(o.avance) || 0;
  const hito = [25, 50, 75].filter((m) => avance >= m && (c.__hito || 0) < m).pop();
  const silencio = ahora - (c.__ultimo_aviso || c.inicio_ms || ahora) > (Number(c.avisar_cada_min) || 30) * 60_000;
  if (!hito && !silencio) return false;
  c.__hito = Math.max(c.__hito || 0, hito || 0); c.__ultimo_aviso = ahora;
  c.aviso_texto = `📊 #${c.envio_id} · ${String(avance).replace(".", ",")}% · ${num(o.procesados)}/${num(o.total)} · ${num(o.errores)} errores${eta}${o.estado === "pausada" ? " · ⏸ pausado" : ""}`;
  return true;
}

export const jelcomEnvioCompleto: DefFlujo = {
  nombre: "jelcom_envio_completo",
  modulo: MODULO,
  descripcion: "Envío de Jelcom de punta a punta por cualquier canal (sms, whatsapp, correo, voz): valida todo antes de crear (si falta algo lo pide con opciones), crea, sube la base, te manda una prueba, muestra la ficha con costo y pide UNA aprobación, dispara (o divide en partes, o espera la hora programada), avisa el avance en 25/50/75 %, diagnostica errores y al terminar manda UN informe con el resumen y el costo. Con envio_id existente, retoma ese envío.",
  parametros: {
    type: "object",
    properties: {
      canal: { type: "string", enum: ["sms", "whatsapp", "correo", "voz"] },
      archivo_id: { type: "string", description: "Base (CSV/Excel) que mandó el jefe. Nunca adivinarla." },
      campana_id: { type: "integer", minimum: 1 }, campana: { type: "string", description: "Nombre del cliente si no sabes el id." },
      cuenta_id: { type: "integer", minimum: 1, description: "Cuenta SMS o WhatsApp." },
      texto: { type: "string", description: "Texto del SMS o del correo (o lo que dice la llamada)." },
      plantilla: { type: "string" }, idioma: { type: "string" }, imagen_url: { type: "string" },
      asunto: { type: "string" }, enlace: { type: "string" },
      modo_audio: { type: "string", enum: ["texto", "pregrabado"] }, texto_voz: { type: "string" }, voz_id: { type: "string" }, audio_url: { type: "string" }, tecla_captura: { type: "string" },
      nombre: { type: "string" },
      envio_id: { type: "integer", minimum: 1, description: "Retomar un envío existente (se salta preparar y crear)." },
      prueba: { type: "boolean", default: true, description: "Mandar una prueba al jefe antes de pedir el OK." },
      programar_para: { type: "string", description: "Fecha y hora de salida, hora Colombia: 'AAAA-MM-DD HH:mm'." },
      dividir_en: { type: "integer", minimum: 2, maximum: 10, description: "Salir en N partes en paralelo." },
      avisar_cada_min: { type: "integer", default: 30, minimum: 5, maximum: 240, description: "Si no hay hitos, avisar igual cada N minutos." },
      umbral_error: { type: "number", default: 20, minimum: 1, maximum: 100 },
      numero: { type: "string", description: "WhatsApp al que reportar (por defecto el jefe)." },
    },
    required: [],
  },
  riesgo: "ejecucion",
  inicio: "hay_envio",
  pasos: [
    { id: "hay_envio", tipo: "condicion", si: (c) => !!c.envio_id, entonces: "ver_existente", sino: "preparar" },

    // ── 1. Preparar: todo validado antes de crear ──
    { id: "preparar", tipo: "skill", skill: "jelcom_preparar_envio", args: (c) => ({
        canal: c.canal, archivo_id: c.archivo_id, campana_id: c.campana_id, campana: c.campana, cuenta_id: c.cuenta_id, texto: c.texto, plantilla: c.plantilla, idioma: c.idioma,
        imagen_url: c.imagen_url, asunto: c.asunto, enlace: c.enlace, modo_audio: c.modo_audio, texto_voz: c.texto_voz, voz_id: c.voz_id, audio_url: c.audio_url, tecla_captura: c.tecla_captura, nombre: c.nombre, dividir_en: c.dividir_en,
      }), guardarEn: "prep" },
    { id: "listo", tipo: "condicion", si: (c) => !!c.prep?.listo, entonces: "crear", sino: "fin_falta" },

    // ── 2. Crear y subir ──
    { id: "crear", tipo: "tool", tool: "jelcom_crear_envio", args: (c) => ({ ...c.prep.envio }), guardarEn: "creado" },
    { id: "tomar_id", tipo: "condicion", si: (c) => { const id = c.creado?.envio_id; if (id) c.envio_id = id; return !!id; }, entonces: "subir", sino: "fin_no_creado" },
    { id: "subir", tipo: "tool", tool: "jelcom_subir_base", args: (c) => ({ envio_id: c.envio_id, archivo_id: c.prep.archivo_id }), guardarEn: "carga" },
    { id: "con_prueba", tipo: "condicion", si: (c) => c.prueba !== false, entonces: "probar", sino: "costo" },

    // Envío ya existente: si está corriendo se vigila; si no, sigue al OK.
    { id: "ver_existente", tipo: "tool", tool: "jelcom_ver_envio", args: (c) => ({ envio_id: c.envio_id }), guardarEn: "envio" },
    { id: "ya_corre", tipo: "condicion", si: (c) => ["en_curso", "pausada", "finalizada"].includes(String(c.envio?.estado)), entonces: "marcar_inicio", sino: "armar_ficha_existente" },
    { id: "armar_ficha_existente", tipo: "condicion", si: (c) => {
        const e = c.envio || {};
        c.prep = { ficha: { nombre: e.nombre, campana: `campaña`, campana_id: e.campana_id, canal: e.canal, texto: e.cuerpo, segmentos: 1, plantilla: e.plantilla, idioma: e.idioma, asunto: e.asunto, imagen_url: e.imagen_url, enlace: e.enlace, base: { archivo: "ya cargada", validos: e.validos, duplicados: e.duplicados, invalidos: e.invalidos } }, sugerencias: [], avisos: [] };
        return Number(e.validos) > 0;
      }, entonces: "con_prueba", sino: "fin_sin_validos" },

    // ── 3. Prueba y costo ──
    { id: "probar", tipo: "tool", tool: "jelcom_enviar_prueba", args: (c) => ({ envio_id: c.envio_id }), guardarEn: "prueba_r", siFalla: "continuar" },
    { id: "costo", tipo: "tool", tool: "jelcom_costo_envio", args: (c) => ({ envio_id: c.envio_id }), guardarEn: "costo", siFalla: "continuar" },

    // ── 4. UNA aprobación con la ficha completa ──
    { id: "aprobar", tipo: "aprobacion", textoFinal: true, mensaje: (c) => {
        const prueba = c.prueba === false ? undefined : c.__resultados?.probar ? { ok: !!c.__resultados.probar.ok, error: c.__resultados.probar.error } : undefined;
        const ficha = textoFicha({ ...c.prep, ficha: { ...c.prep.ficha, base: c.carga ? { ...c.prep.ficha.base, validos: c.carga.validos, duplicados: c.carga.duplicados, invalidos: c.carga.invalidos, lista_negra: c.carga.lista_negra ?? c.prep.ficha.base?.lista_negra } : c.prep.ficha.base } }, { prueba, costoReal: c.costo, programado: programado(c), dividir_en: c.dividir_en });
        const accion = programado(c) ? "¿Lo dejo programado?" : c.dividir_en > 1 ? `¿Lo disparo en ${c.dividir_en} partes?` : "¿Lo disparo?";
        return `✋ *Envío #${c.envio_id} listo*\n${ficha}\n\n${accion} Responde *ok* o *no*.`;
      } },

    // ── 5. Programado ──
    { id: "es_programado", tipo: "condicion", si: (c) => programado(c) > 60, entonces: "avisar_programado", sino: "como_sale" },
    { id: "avisar_programado", tipo: "tool", tool: "whatsapp_enviar_texto", args: (c) => ({ numero: jefe(c), texto: `⏰ Listo: el envío #${c.envio_id} sale ${horaLegible(programado(c))}. Si quieres cancelarlo, dime "cancela el envío ${c.envio_id}".` }), siFalla: "continuar" },
    { id: "esperar_hora", tipo: "esperar", segundos: (c) => programado(c) },

    // ── 6. Disparar o dividir ──
    { id: "como_sale", tipo: "condicion", si: (c) => Number(c.dividir_en) > 1, entonces: "dividir", sino: "disparar" },
    { id: "dividir", tipo: "tool", tool: "jelcom_dividir_envio", args: (c) => ({ envio_id: c.envio_id, cantidad: c.dividir_en }), preaprobado: true, guardarEn: "division" },
    { id: "tras_dividir", tipo: "condicion", si: () => true, entonces: "avisar_inicio", sino: "avisar_inicio" },
    { id: "disparar", tipo: "tool", tool: "jelcom_disparar_envio", args: (c) => ({ envio_id: c.envio_id }), preaprobado: true, guardarEn: "disparo" },
    { id: "avisar_inicio", tipo: "tool", tool: "whatsapp_enviar_texto", args: (c) => { c.inicio_ms = Date.now(); return { numero: jefe(c), texto: `🚀 Envío #${c.envio_id} saliendo${c.division?.ids?.length ? ` en ${c.division.ids.length} partes` : ""}: ${num(c.carga?.validos ?? c.envio?.validos)} contactos. Te aviso al 25, 50 y 75 % y te mando el informe al terminar.` }; }, siFalla: "continuar" },
    { id: "marcar_inicio", tipo: "condicion", si: (c) => { c.inicio_ms = c.inicio_ms || Date.now(); return true; }, entonces: "monitor", sino: "monitor" },

    // ── 7. Vigilancia ──
    { id: "monitor", tipo: "repetir", hasta: (c) => !!c.obs?.terminado || !!c.detenido, maxVeces: 6000, cuerpo: ["observar", "hito", "avisar_avance", "evaluar", "diagnosticar", "decidir"], cadaSegundos: 60 },

    // ── 8. Cierre ──
    { id: "termino_bien", tipo: "condicion", si: (c) => c.obs?.estado === "finalizada", entonces: "reporte", sino: "fin_detenido" },
    { id: "reporte", tipo: "skill", skill: "jelcom_reportar_envio", args: (c) => ({ envio_id: c.envio_id, numero: jefe(c), inicio_ms: c.inicio_ms, perfil: c.prep?.perfil }), guardarEn: "reporte", siFalla: "continuar" },
    { id: "fin", tipo: "fin", resultado: (c) => ({ envio_id: c.envio_id, estado: c.obs?.estado, enviados: c.obs?.enviados, errores: c.obs?.errores, total: c.obs?.total, reporte: c.reporte }) },

    // Cuerpo del monitor (solo lo corre el repetir)
    { id: "observar", tipo: "skill", skill: "jelcom_monitorear_envio", args: (c) => ({ envio_id: c.envio_id, umbral_error: c.umbral_error ?? 20 }), guardarEn: "obs", siFalla: "continuar" },
    { id: "hito", tipo: "condicion", si: (c) => decidirAviso(c), entonces: "avisar_avance", sino: "evaluar" },
    { id: "avisar_avance", tipo: "tool", tool: "whatsapp_enviar_texto", args: (c) => ({ numero: jefe(c), texto: c.aviso_texto }), siFalla: "continuar" },
    { id: "evaluar", tipo: "condicion", si: (c) => !!c.obs?.alerta && !c.obs?.terminado && c.__diag_motivo !== c.obs?.motivo, entonces: "diagnosticar", sino: "decidir" },
    { id: "diagnosticar", tipo: "skill", skill: "jelcom_diagnosticar_errores", args: (c) => { c.__diag_motivo = c.obs?.motivo; return { envio_id: c.envio_id, numero_aviso: jefe(c), pausar_si_grave: true }; }, guardarEn: "diag", siFalla: "continuar" },
    // Se deja de vigilar si el diagnóstico lo pausó, o si alguien lo pausó a mano y sigue así 3 vueltas seguidas.
    // Si ya terminó (o se detuvo) sale YA al cierre, sin esperar otra vuelta de 60 s.
    { id: "decidir", tipo: "condicion", si: (c) => {
        c.__pausas = c.obs?.estado === "pausada" ? (c.__pausas || 0) + 1 : 0;
        if (c.diag?.pausado || c.__pausas >= 3) c.detenido = true;
        if (c.obs?.terminado || c.detenido) { delete c.__retorno; return false; }
        return true;
      }, entonces: "monitor", sino: "termino_bien" },

    // ── Finales con explicación ──
    { id: "fin_falta", tipo: "fin", fallo: true, resultado: (c) => ({ falta: true, texto: c.__resultados?.preparar?.resumen || c.__resultados?.preparar?.error }) },
    { id: "fin_no_creado", tipo: "fin", fallo: true, resultado: (c) => ({ error: `Jelcom no creó el envío: ${c.__resultados?.crear?.error || "sin detalle"}` }) },
    { id: "fin_sin_validos", tipo: "fin", fallo: true, resultado: (c) => ({ error: `El envío #${c.envio_id} no tiene contactos válidos: sube una base primero.` }) },
    { id: "fin_detenido", tipo: "fin", resultado: (c) => ({ detenido: true, envio_id: c.envio_id, estado: c.obs?.estado, enviados: c.obs?.enviados, errores: c.obs?.errores, total: c.obs?.total }) },
  ],
  reporte: (c, r: any) => {
    if (r?.falta) return r.texto || "Me falta información para armar el envío.";
    if (r?.error) return `❌ ${r.error}`;
    if (r?.detenido) return `⏸ Envío #${c.envio_id} quedó pausado en ${num(r.enviados)}/${num(r.total)} con ${num(r.errores)} errores. Cuando lo resuelvas dime "reanuda el envío ${c.envio_id}" y lo sigo vigilando hasta el informe.`;
    if (c.reporte?.informe_enviado) return `Listo ✅ Envío #${c.envio_id} cerrado. El informe va arriba.`;
    return `${c.reporte?.resumen || `✅ Envío #${c.envio_id} terminado: ${num(r?.enviados)}/${num(r?.total)}.`}${c.reporte?.error_informe ? `\n⚠ ${c.reporte.error_informe}. Pídeme "el informe del envío ${c.envio_id}" y lo reintento.` : ""}`;
  },
};

export const flujosJelcom: DefFlujo[] = [jelcomEnvioCompleto];
