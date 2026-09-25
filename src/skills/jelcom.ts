// ARCHIVO: src/skills/jelcom.ts
// ─────────────────────────────────────────────────────────────────────────────
//  SKILLS DE JELCOM ENVÍOS
//  - crear_envio_guiado: guiada (el modelo pregunta lo que falta y arma el envío)
//  - monitorear_envio:   código (una observación: estado + alerta)
//  - diagnosticar_errores: código (clasifica errores, pausa si hace falta, avisa)
//  - reportar_envio:     código (informe Excel + resumen, por WhatsApp)
// ─────────────────────────────────────────────────────────────────────────────

import type { DefSkill } from "../registro/tipos.js";

const MODULO = "jelcom";
const ID = { type: "integer" as const, description: "Id del envío en Jelcom.", minimum: 1 };

// ─── 1. Crear envío guiado ──────────────────────────────────────────────────
export const jelcomCrearEnvioGuiado: DefSkill = {
  nombre: "jelcom_crear_envio_guiado",
  modulo: MODULO,
  descripcion: "Arma un envío completo en Jelcom a partir de un pedido en lenguaje natural: elige o crea la campaña, pide la cuenta, crea el envío y sube la base que mandaron por WhatsApp. NO lo dispara. Devuelve el envio_id listo para el flujo jelcom_campana_por_whatsapp.",
  cuandoUsar: "Cuando el jefe pide 'hazme un envío', 'manda este SMS/WhatsApp a esta base', 'crea una campaña con este archivo'.",
  parametros: {
    type: "object",
    properties: {
      pedido: { type: "string", description: "El pedido tal como lo dijo el jefe (cliente, canal, texto o plantilla, etc.).", minLength: 3 },
      archivo_id: { type: "string", description: "Id del archivo con la base, si ya se conoce (si no, se busca con whatsapp_listar_adjuntos)." },
      campana_id: { type: "integer", description: "Campaña ya elegida (opcional)." },
      cuenta_id: { type: "integer", description: "Cuenta SMS o WhatsApp ya elegida (opcional)." },
    },
    required: ["pedido"],
  },
  riesgo: "escritura",
  requiereAprobacion: false,
  tools: ["jelcom_listar_campanas", "jelcom_crear_campana", "jelcom_listar_cuentas_sms", "jelcom_listar_cuentas_whatsapp", "jelcom_analizar_sms", "jelcom_crear_envio", "jelcom_subir_base", "jelcom_ver_envio", "whatsapp_listar_adjuntos"],
  procedimiento: `1. Entendé el pedido: canal (sms o whatsapp), cliente/campaña, y el contenido (texto del SMS o nombre de plantilla e idioma).
2. Campaña: si te dieron campana_id usala. Si no, listá las campañas y buscá una cuyo nombre coincida con el cliente del pedido. Si no existe, crearla con el nombre del cliente.
3. Cuenta: si te dieron cuenta_id usala. Si no, listá las cuentas del canal. Si hay UNA sola, usala. Si hay varias y el pedido no dice cuál, TERMINÁ con "FALLO: falta elegir cuenta" y listá las opciones con su id para que el jefe elija (no adivines).
4. Si es SMS, analizá el texto con jelcom_analizar_sms y anotá cuántos segmentos ocupa.
5. Base: si te dieron archivo_id usalo. Si no, buscá con whatsapp_listar_adjuntos el adjunto más reciente que parezca una base (xlsx, xls, csv). Si no hay ninguno, TERMINÁ con "FALLO: no encontré la base; pedile al jefe que la mande como archivo".
6. Creá el envío con jelcom_crear_envio (nombre descriptivo: cliente + canal + fecha).
7. Subí la base con jelcom_subir_base y leé válidos/duplicados/inválidos.
8. Verificá con jelcom_ver_envio que el envío quedó con total de válidos > 0.
9. Terminá con "OK:" seguido de: envio_id, nombre, canal, campaña, cuenta usada, válidos/duplicados/inválidos, y segmentos si es SMS. Sin disparar nada.`,
};

// ─── 2. Monitorear (una observación) ────────────────────────────────────────
export const jelcomMonitorearEnvio: DefSkill = {
  nombre: "jelcom_monitorear_envio",
  modulo: MODULO,
  descripcion: "Observa un envío una vez: estado, progreso, tasa de error y si hay alerta (errores por encima del umbral o error de proveedor). Pensada para correr en bucle dentro de un flujo.",
  cuandoUsar: "Cuando el jefe pregunta 'cómo va el envío', o dentro del flujo de monitoreo.",
  parametros: {
    type: "object",
    properties: { envio_id: ID, umbral_error: { type: "number", description: "Tasa de error (%) a partir de la cual se levanta alerta.", default: 20, minimum: 1, maximum: 100 } },
    required: ["envio_id"],
  },
  riesgo: "lectura",
  requiereAprobacion: false,
  tools: ["jelcom_estado_envio"],
  async ejecutar(a, ctx) {
    const r = await ctx.ejecutarTool("jelcom_estado_envio", { envio_id: a.envio_id, ultimos_logs: 10 });
    if (!r.ok) return { ok: false, error: r.error, datos: { alerta: true, motivo: "no_responde", terminado: false } };
    const d = r.datos as any;
    const umbral = Number(a.umbral_error) || 20;
    const muestra = d.procesados >= 20; // no juzgar con 3 mensajes
    const tipos = clasificar(d.errores_recientes || []);
    const grave = tipos.credenciales || tipos.saldo || tipos.plantilla;
    const alerta = d.estado === "error" || (muestra && d.tasa_error >= umbral) || (grave && d.errores > 0);
    const motivo = d.estado === "error" ? "envio_en_error" : grave ? (tipos.credenciales ? "credenciales" : tipos.saldo ? "saldo" : "plantilla") : (muestra && d.tasa_error >= umbral) ? "tasa_error" : null;
    return {
      ok: true,
      datos: { ...d, alerta, motivo, tipos_error: tipos, pausada: d.estado === "pausada" },
      resumen: `#${a.envio_id}: ${d.estado} · ${d.enviados}/${d.total} · ${d.errores} err (${d.tasa_error}%)${alerta ? ` · ⚠ ALERTA ${motivo}` : ""}`,
    };
  },
};

// ─── 3. Diagnosticar y actuar ───────────────────────────────────────────────
export const jelcomDiagnosticarErrores: DefSkill = {
  nombre: "jelcom_diagnosticar_errores",
  modulo: MODULO,
  descripcion: "Analiza los errores de un envío, los clasifica (credenciales, saldo, plantilla, base, red, proveedor), pausa el envío si el problema lo amerita, y le explica al jefe qué pasa y qué propone. No reanuda ni divide por su cuenta.",
  cuandoUsar: "Cuando un envío tiene errores altos o el jefe pregunta 'qué pasó con el envío'.",
  parametros: {
    type: "object",
    properties: {
      envio_id: ID,
      numero_aviso: { type: "string", description: "Número de WhatsApp al que avisar (el jefe). Si se omite, no avisa." },
      pausar_si_grave: { type: "boolean", description: "Pausar automáticamente si el error es de credenciales/saldo/plantilla o la tasa es alta.", default: true },
    },
    required: ["envio_id"],
  },
  riesgo: "escritura",
  requiereAprobacion: false,
  tools: ["jelcom_estado_envio", "jelcom_pausar_envio", "whatsapp_enviar_texto"],
  async ejecutar(a, ctx) {
    const est = await ctx.ejecutarTool("jelcom_estado_envio", { envio_id: a.envio_id, ultimos_logs: 40 });
    if (!est.ok) return { ok: false, error: est.error };
    const d = est.datos as any;
    const tipos = clasificar(d.errores_recientes || []);
    const principal = (Object.entries(tipos) as [string, number][]).filter(([, n]) => n > 0).sort((x, y) => y[1] - x[1])[0]?.[0] || "desconocido";

    const explicacion: Record<string, string> = {
      credenciales: "el proveedor rechaza las credenciales de la cuenta (token/API key vencida o mal configurada)",
      saldo: "la cuenta del proveedor no tiene saldo/créditos suficientes",
      plantilla: "la plantilla de WhatsApp no está aprobada o no coincide con la configurada",
      base: "muchos números de la base son inválidos o no existen en el proveedor",
      red: "hubo fallos de red con el proveedor (Jelcom ya reintenta solo)",
      proveedor: "el proveedor devolvió errores genéricos",
      desconocido: "los errores no tienen un patrón claro",
    };
    const puedoManejar = principal === "red";                       // lo maneja Jelcom con reintentos
    const grave = ["credenciales", "saldo", "plantilla"].includes(principal) || d.tasa_error >= 50;
    let accion = "ninguna";
    if (grave && a.pausar_si_grave !== false && d.estado === "en_curso") {
      const p = await ctx.ejecutarTool("jelcom_pausar_envio", { envio_id: a.envio_id });
      accion = p.ok ? "pausado" : `no pude pausar: ${p.error}`;
    }
    const propuesta = principal === "credenciales" ? "revisá las credenciales de la cuenta en Jelcom → Conexiones y decime si reanudo"
      : principal === "saldo" ? "recargá saldo en el proveedor y decime si reanudo"
      : principal === "plantilla" ? "revisá el nombre/estado de la plantilla en Meta y decime si reanudo"
      : principal === "base" ? "el envío puede seguir; los inválidos quedan marcados en el informe. ¿Sigo o pauso?"
      : principal === "red" ? "sigo observando; si persiste te aviso"
      : "¿querés que pause o que siga?";

    const texto = `⚠ Envío #${a.envio_id} (${d.estado}): ${d.enviados}/${d.total} enviados, ${d.errores} errores (${d.tasa_error}%).\nDiagnóstico: ${explicacion[principal]}.\nAcción: ${accion}.\nPropuesta: ${propuesta}${d.errores_recientes?.length ? `\nÚltimo error: ${String(d.errores_recientes[d.errores_recientes.length - 1]).slice(0, 160)}` : ""}`;
    if (a.numero_aviso && !puedoManejar) await ctx.ejecutarTool("whatsapp_enviar_texto", { numero: a.numero_aviso, texto });
    await ctx.traza("skill", `diagnóstico #${a.envio_id}: ${principal} · acción ${accion}`);
    return {
      ok: true,
      datos: { tipo: principal, tipos, grave, puedo_manejar: puedoManejar, accion, pausado: accion === "pausado", propuesta, estado: d.estado, tasa_error: d.tasa_error },
      resumen: texto,
    };
  },
};

// ─── 4. Reportar ────────────────────────────────────────────────────────────
export const jelcomReportarEnvio: DefSkill = {
  nombre: "jelcom_reportar_envio",
  modulo: MODULO,
  descripcion: "Descarga el informe Excel de un envío (consolidado si fue dividido), lo manda por WhatsApp al jefe y devuelve un resumen corto con los números finales.",
  cuandoUsar: "Al terminar un envío, o cuando el jefe pide 'pásame el informe'.",
  parametros: {
    type: "object",
    properties: { envio_id: ID, numero: { type: "string", description: "Número de WhatsApp destino (el jefe)." }, consolidado: { type: "boolean", description: "true si el envío fue dividido.", default: false } },
    required: ["envio_id", "numero"],
  },
  riesgo: "ejecucion",
  requiereAprobacion: false,
  tools: ["jelcom_ver_envio", "jelcom_estado_envio", "jelcom_descargar_informe", "whatsapp_enviar_documento"],
  async ejecutar(a, ctx) {
    const ver = await ctx.ejecutarTool("jelcom_ver_envio", { envio_id: a.envio_id });
    if (!ver.ok) return { ok: false, error: ver.error };
    const e = ver.datos as any;
    const est = await ctx.ejecutarTool("jelcom_estado_envio", { envio_id: a.envio_id, ultimos_logs: 5 });
    const tasa = est.ok ? (est.datos as any).tasa_error : 0;
    const inf = await ctx.ejecutarTool("jelcom_descargar_informe", { envio_id: a.envio_id, consolidado: !!a.consolidado });
    if (!inf.ok) return { ok: false, error: `No pude descargar el informe: ${inf.error}` };
    const resumen = `📊 ${e.nombre} [${e.canal}] · ${e.estado}\nBase ${e.base} → válidos ${e.validos} · enviados ${e.enviados} · errores ${e.errores} (${tasa}%)`;
    const env = await ctx.ejecutarTool("whatsapp_enviar_documento", { numero: a.numero, archivo_id: (inf.datos as any).archivo_id, caption: resumen });
    if (!env.ok) return { ok: false, error: `Informe descargado pero no pude enviarlo: ${env.error}`, datos: { archivo_id: (inf.datos as any).archivo_id } };
    return { ok: true, datos: { archivo_id: (inf.datos as any).archivo_id, enviados: e.enviados, errores: e.errores, validos: e.validos, tasa_error: tasa }, resumen };
  },
};

// ─── Clasificador de errores de proveedor ───────────────────────────────────
function clasificar(mensajes: string[]) {
  const t = { credenciales: 0, saldo: 0, plantilla: 0, base: 0, red: 0, proveedor: 0 };
  for (const m of mensajes) {
    const s = String(m).toLowerCase();
    if (/401|403|unauthori|api key|apikey|token|credencial|invalid account|auth/.test(s)) t.credenciales++;
    else if (/saldo|credit|balance|insufficient|sin cr[eé]ditos|quota/.test(s)) t.saldo++;
    else if (/template|plantilla/.test(s)) t.plantilla++;
    else if (/inv[aá]lid|not a valid|does not exist|no existe|unknown number|recipient|phone number/.test(s)) t.base++;
    else if (/timeout|econn|network|socket|etimedout|reset|unreachable/.test(s)) t.red++;
    else t.proveedor++;
  }
  return t;
}

export const skillsJelcom: DefSkill[] = [jelcomCrearEnvioGuiado, jelcomMonitorearEnvio, jelcomDiagnosticarErrores, jelcomReportarEnvio];