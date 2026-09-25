// ARCHIVO: src/tools/jelcom.ts
// ─────────────────────────────────────────────────────────────────────────────
//  TOOLS DE JELCOM ENVÍOS — API externa (/api/external/..., x-api-key)
//  Cada operación de la plataforma es una función tipada. Nada se deduce del
//  texto: el modelo elige la operación y pasa los argumentos del schema.
//  .env: JELCOM_URL, JELCOM_API_KEY
// ─────────────────────────────────────────────────────────────────────────────

import type { DefTool, ResultadoTool } from "../registro/tipos.js";
import { leerArchivo, guardarArchivo } from "../dominio/archivos.js";

const MODULO = "jelcom";
const ID = { type: "integer" as const, description: "Id numérico del envío en Jelcom.", minimum: 1 };

function cfg() {
  const url = (process.env.JELCOM_URL || "https://backendjelcomenvios-production.up.railway.app").replace(/\/+$/, "");
  const key = process.env.JELCOM_API_KEY;
  if (!key) throw new Error("Falta JELCOM_API_KEY en el .env (se genera en Jelcom Envíos → API externa).");
  return { base: `${url}/api/external`, key };
}

async function llamar(metodo: string, ruta: string, body?: unknown, opciones: { form?: FormData; binario?: boolean; timeoutSeg?: number } = {}): Promise<ResultadoTool & { status?: number }> {
  let c; try { c = cfg(); } catch (e: any) { return { ok: false, error: e.message }; }
  try {
    const headers: Record<string, string> = { "x-api-key": c.key };
    let cuerpo: any;
    if (opciones.form) cuerpo = opciones.form;
    else if (body !== undefined) { headers["Content-Type"] = "application/json"; cuerpo = JSON.stringify(body); }
    const resp = await fetch(`${c.base}${ruta}`, { method: metodo, headers, body: cuerpo, signal: AbortSignal.timeout((opciones.timeoutSeg || 30) * 1000) });
    if (opciones.binario) {
      if (!resp.ok) { const t = await resp.text().catch(() => ""); return { ok: false, status: resp.status, error: `HTTP ${resp.status} ${t.slice(0, 200)}` }; }
      const buf = Buffer.from(await resp.arrayBuffer());
      const cd = resp.headers.get("content-disposition") || "";
      const nombre = cd.match(/filename="?([^";]+)"?/)?.[1] || "informe.xlsx";
      return { ok: true, status: resp.status, datos: { buffer: buf, nombre, mime: resp.headers.get("content-type") || "application/octet-stream" } };
    }
    const data: any = await resp.json().catch(() => ({}));
    if (!resp.ok) return { ok: false, status: resp.status, error: data?.error || `HTTP ${resp.status}`, datos: data };
    return { ok: true, status: resp.status, datos: data };
  } catch (e: any) {
    return { ok: false, error: `No se pudo hablar con Jelcom Envíos: ${e?.message || String(e)}` };
  }
}

// ─── Consultas ───────────────────────────────────────────────────────────────
export const jelcomListarCampanas: DefTool = {
  nombre: "jelcom_listar_campanas", modulo: MODULO,
  descripcion: "Lista las campañas (clientes/proyectos) de Jelcom Envíos con su id, nombre y cuántos envíos tienen.",
  parametros: { type: "object", properties: {}, required: [] }, riesgo: "lectura", requiereAprobacion: false,
  async ejecutar() {
    const r = await llamar("GET", "/campanas");
    if (!r.ok) return r;
    const lista = (r.datos as any[]).map((c) => ({ id: c.id, nombre: c.nombre, envios: c.num_envios, cuenta_wa_id: c.cuenta_wa_id }));
    return { ok: true, datos: lista, resumen: lista.length ? `${lista.length} campaña(s): ${lista.map((c) => `#${c.id} ${c.nombre}`).join(", ")}` : "No hay campañas." };
  },
};

export const jelcomCrearCampana: DefTool = {
  nombre: "jelcom_crear_campana", modulo: MODULO,
  descripcion: "Crea una campaña (cliente/proyecto) nueva en Jelcom Envíos.",
  parametros: { type: "object", properties: { nombre: { type: "string", description: "Nombre de la campaña/cliente.", minLength: 2 }, cuenta_wa_id: { type: "integer", description: "Cuenta de WhatsApp por defecto (opcional)." } }, required: ["nombre"] },
  riesgo: "escritura", requiereAprobacion: false,
  async ejecutar(a) {
    const r = await llamar("POST", "/campanas", { nombre: a.nombre, cuenta_wa_id: a.cuenta_wa_id });
    return r.ok ? { ok: true, datos: r.datos, resumen: `Campaña "${a.nombre}" creada con id ${(r.datos as any)?.id}.` } : r;
  },
};

export const jelcomListarCuentasWhatsapp: DefTool = {
  nombre: "jelcom_listar_cuentas_whatsapp", modulo: MODULO,
  descripcion: "Lista las cuentas de WhatsApp Business configuradas en Jelcom (id, nombre, número). Necesaria para envíos por WhatsApp.",
  parametros: { type: "object", properties: {}, required: [] }, riesgo: "lectura", requiereAprobacion: false,
  async ejecutar() {
    const r = await llamar("GET", "/cuentas");
    if (!r.ok) return r;
    const lista = (Array.isArray(r.datos) ? r.datos : []).map((c: any) => ({ id: c.id, nombre: c.nombre, numero: c.numero || c.display_phone || c.telefono || "" }));
    return { ok: true, datos: lista, resumen: lista.length ? `Cuentas WhatsApp: ${lista.map((c: any) => `#${c.id} ${c.nombre}`).join(", ")}` : "No hay cuentas de WhatsApp." };
  },
};

export const jelcomListarCuentasSms: DefTool = {
  nombre: "jelcom_listar_cuentas_sms", modulo: MODULO,
  descripcion: "Lista las cuentas de SMS configuradas en Jelcom (id, nombre, proveedor). Necesaria para envíos por SMS.",
  parametros: { type: "object", properties: {}, required: [] }, riesgo: "lectura", requiereAprobacion: false,
  async ejecutar() {
    const r = await llamar("GET", "/cuentas-sms");
    if (!r.ok) return r;
    const lista = (Array.isArray(r.datos) ? r.datos : []).map((c: any) => ({ id: c.id, nombre: c.nombre, proveedor: c.proveedor, remitente: c.remitente }));
    return { ok: true, datos: lista, resumen: lista.length ? `Cuentas SMS: ${lista.map((c: any) => `#${c.id} ${c.nombre} (${c.proveedor})`).join(", ")}` : "No hay cuentas SMS." };
  },
};

export const jelcomListarEnvios: DefTool = {
  nombre: "jelcom_listar_envios", modulo: MODULO,
  descripcion: "Lista envíos con su estado y contadores. Filtrable por campaña, estados (borrador, lista, en_curso, pausada, finalizada, error) y fecha.",
  parametros: {
    type: "object",
    properties: {
      campana_id: { type: "integer", description: "Filtrar por campaña." },
      estados: { type: "string", description: "Estados separados por coma, ej. 'en_curso,pausada'." },
      desde: { type: "string", description: "Fecha AAAA-MM-DD." },
      limite: { type: "integer", description: "Máximo a devolver (los más recientes).", default: 15, minimum: 1, maximum: 100 },
    }, required: [],
  },
  riesgo: "lectura", requiereAprobacion: false,
  async ejecutar(a) {
    const q = new URLSearchParams();
    if (a.campana_id) q.set("campana_id", String(a.campana_id));
    if (a.estados) q.set("estados", a.estados);
    if (a.desde) q.set("desde", a.desde);
    const r = await llamar("GET", `/envios${q.toString() ? "?" + q : ""}`);
    if (!r.ok) return r;
    const lista = (r.datos as any[]).slice(0, a.limite || 15).map(resumirEnvio);
    return { ok: true, datos: lista, resumen: lista.length ? lista.map((e) => `#${e.id} ${e.nombre} [${e.canal}] ${e.estado} ${e.enviados}/${e.validos} (err ${e.errores})`).join("\n") : "No hay envíos con ese filtro." };
  },
};

export const jelcomVerEnvio: DefTool = {
  nombre: "jelcom_ver_envio", modulo: MODULO,
  descripcion: "Detalle de un envío: canal, estado, campaña, cuenta, cuerpo/plantilla y contadores (base, válidos, enviados, errores).",
  parametros: { type: "object", properties: { envio_id: ID }, required: ["envio_id"] }, riesgo: "lectura", requiereAprobacion: false,
  async ejecutar(a) {
    const r = await llamar("GET", `/envios/${a.envio_id}`);
    if (!r.ok) return r;
    if (!(r.datos as any)?.id) return { ok: false, error: `El envío #${a.envio_id} no existe en Jelcom.` };
    const e = resumirEnvio(r.datos);
    return { ok: true, datos: { ...e, cuerpo: (r.datos as any).cuerpo, plantilla: (r.datos as any).plantilla, idioma: (r.datos as any).idioma }, resumen: `Envío #${e.id} "${e.nombre}" [${e.canal}] estado ${e.estado}: base ${e.base}, válidos ${e.validos}, enviados ${e.enviados}, errores ${e.errores}.` };
  },
};

export const jelcomEstadoEnvio: DefTool = {
  nombre: "jelcom_estado_envio", modulo: MODULO,
  descripcion: "Estado en vivo de un envío: contadores actuales, tasa de error y los últimos logs (progreso, errores del proveedor). Es lo que se usa para monitorear.",
  parametros: { type: "object", properties: { envio_id: ID, ultimos_logs: { type: "integer", description: "Cuántas líneas de log devolver.", default: 15, minimum: 1, maximum: 100 } }, required: ["envio_id"] },
  riesgo: "lectura", requiereAprobacion: false,
  async ejecutar(a) {
    const r = await llamar("GET", `/envios/${a.envio_id}/logs`);
    if (!r.ok) return r;
    const d = r.datos as any;
    if (!d?.envio || !d.envio.estado) return { ok: false, error: `El envío #${a.envio_id} no existe en Jelcom.` };
    const env = d.envio;
    const total = Number(env.total_validos) || 0, enviados = Number(env.total_enviados) || 0, errores = Number(env.total_errores) || 0;
    const procesados = enviados + errores;
    const tasa = procesados ? Math.round((errores / procesados) * 1000) / 10 : 0;
    const logs = (d.logs as any[]).slice(-(a.ultimos_logs || 15)).map((l) => ({ nivel: l.nivel, mensaje: l.mensaje, ts: l.ts }));
    const erroresRecientes = (d.logs as any[]).filter((l) => l.nivel === "error").slice(-8).map((l) => l.mensaje);
    const terminado = ["finalizada", "error"].includes(env.estado);
    return {
      ok: true,
      datos: { estado: env.estado, total, enviados, errores, procesados, pendientes: Math.max(0, total - procesados), tasa_error: tasa, terminado, logs, errores_recientes: erroresRecientes },
      resumen: `Envío #${a.envio_id}: ${env.estado} · ${enviados}/${total} enviados · ${errores} errores (${tasa}%)${erroresRecientes.length ? ` · último error: ${erroresRecientes[erroresRecientes.length - 1]}` : ""}`,
    };
  },
};

export const jelcomAnalizarSms: DefTool = {
  nombre: "jelcom_analizar_sms", modulo: MODULO,
  descripcion: "Analiza un texto de SMS: cuántos caracteres y segmentos ocupa (cada segmento cuesta). Usalo antes de crear un envío SMS para avisar si el texto es largo.",
  parametros: { type: "object", properties: { texto: { type: "string", description: "Texto del SMS.", minLength: 1 } }, required: ["texto"] },
  riesgo: "lectura", requiereAprobacion: false,
  async ejecutar(a) {
    const r = await llamar("POST", "/envios/analizar-sms", { texto: a.texto });
    return r.ok ? { ok: true, datos: r.datos, resumen: `SMS: ${JSON.stringify(r.datos)}` } : r;
  },
};

// ─── Escritura ───────────────────────────────────────────────────────────────
export const jelcomCrearEnvio: DefTool = {
  nombre: "jelcom_crear_envio", modulo: MODULO,
  descripcion: "Crea un envío (queda en borrador; después se sube la base y se dispara). SMS: requiere cuerpo y cuenta_sms_id. WhatsApp: requiere plantilla, idioma y cuenta_wa_id.",
  parametros: {
    type: "object",
    properties: {
      campana_id: { type: "integer", description: "Campaña/cliente al que pertenece.", minimum: 1 },
      nombre: { type: "string", description: "Nombre descriptivo del envío.", minLength: 2 },
      canal: { type: "string", enum: ["sms", "whatsapp"], description: "Canal del envío." },
      cuerpo: { type: "string", description: "Texto del SMS (solo canal sms)." },
      cuenta_sms_id: { type: "integer", description: "Cuenta SMS (solo canal sms)." },
      cuenta_wa_id: { type: "integer", description: "Cuenta WhatsApp (solo canal whatsapp)." },
      plantilla: { type: "string", description: "Nombre de la plantilla aprobada (solo whatsapp)." },
      idioma: { type: "string", description: "Idioma de la plantilla (solo whatsapp).", default: "es" },
      imagen_url: { type: "string", description: "URL de imagen de cabecera (opcional, whatsapp)." },
    },
    required: ["campana_id", "nombre", "canal"],
  },
  riesgo: "escritura", requiereAprobacion: false,
  async ejecutar(a) {
    if (a.canal === "sms" && (!a.cuerpo || !a.cuenta_sms_id)) return { ok: false, error: "Para SMS necesito 'cuerpo' y 'cuenta_sms_id'." };
    if (a.canal === "whatsapp" && (!a.plantilla || !a.cuenta_wa_id)) return { ok: false, error: "Para WhatsApp necesito 'plantilla' y 'cuenta_wa_id'." };
    const r = await llamar("POST", "/envios", {
      campana_id: a.campana_id, nombre: a.nombre, canal: a.canal, cuerpo: a.cuerpo, cuenta_sms_id: a.cuenta_sms_id,
      cuenta_wa_id: a.cuenta_wa_id, plantilla: a.plantilla, idioma: a.idioma || "es", imagen_url: a.imagen_url, creado_por: "Emilia",
    });
    return r.ok ? { ok: true, datos: { envio_id: (r.datos as any).id }, resumen: `Envío "${a.nombre}" creado con id ${(r.datos as any).id} (borrador, sin base todavía).` } : r;
  },
};

export const jelcomSubirBase: DefTool = {
  nombre: "jelcom_subir_base", modulo: MODULO,
  descripcion: "Sube la base de contactos (Excel/CSV) a un envío y la depura. Devuelve válidos, duplicados e inválidos. El archivo se identifica por archivo_id (el adjunto que mandaron por WhatsApp).",
  parametros: { type: "object", properties: { envio_id: ID, archivo_id: { type: "string", description: "Id del archivo con la base.", minLength: 8 } }, required: ["envio_id", "archivo_id"] },
  riesgo: "escritura", requiereAprobacion: false, timeoutSeg: 180,
  async ejecutar(a) {
    const { meta, contenido } = await leerArchivo(a.archivo_id);
    const fd = new FormData();
    fd.append("archivo", new Blob([new Uint8Array(contenido)], { type: meta.mime }), meta.nombre);
    const r = await llamar("POST", `/envios/${a.envio_id}/base`, undefined, { form: fd, timeoutSeg: 180 });
    if (!r.ok) return r;
    const d = r.datos as any;
    return { ok: true, datos: d, resumen: `Base cargada al envío #${a.envio_id}: ${d.validos} válidos, ${d.duplicados} duplicados, ${d.invalidos} inválidos (de ${d.total_base}).` };
  },
};

export const jelcomDispararEnvio: DefTool = {
  nombre: "jelcom_disparar_envio", modulo: MODULO,
  descripcion: "DISPARA el envío: empieza a mandar mensajes reales a toda la base. Irreversible. Requiere aprobación del jefe.",
  parametros: { type: "object", properties: { envio_id: ID }, required: ["envio_id"] },
  riesgo: "ejecucion", requiereAprobacion: true,
  async ejecutar(a) {
    const r = await llamar("POST", `/envios/${a.envio_id}/enviar`);
    return r.ok ? { ok: true, datos: r.datos, resumen: `Envío #${a.envio_id} disparado.` } : r;
  },
};

export const jelcomReanudarEnvio: DefTool = {
  nombre: "jelcom_reanudar_envio", modulo: MODULO,
  descripcion: "Reanuda un envío pausado (sigue con los contactos pendientes). Requiere aprobación.",
  parametros: { type: "object", properties: { envio_id: ID }, required: ["envio_id"] },
  riesgo: "ejecucion", requiereAprobacion: true,
  async ejecutar(a) {
    const r = await llamar("POST", `/envios/${a.envio_id}/enviar`);
    return r.ok ? { ok: true, datos: r.datos, resumen: `Envío #${a.envio_id} reanudado.` } : r;
  },
};

export const jelcomPausarEnvio: DefTool = {
  nombre: "jelcom_pausar_envio", modulo: MODULO,
  descripcion: "Pausa un envío en curso (se puede reanudar después). Usalo si hay una tasa de errores alta o un problema del proveedor.",
  parametros: { type: "object", properties: { envio_id: ID }, required: ["envio_id"] },
  riesgo: "escritura", requiereAprobacion: false,
  async ejecutar(a) {
    const r = await llamar("POST", `/envios/${a.envio_id}/pausar`);
    if (!r.ok) return r;
    const pauso = (r.datos as any)?.ok;
    return { ok: true, datos: r.datos, resumen: pauso ? `Envío #${a.envio_id} pausado.` : `El envío #${a.envio_id} no estaba corriendo (nada que pausar).` };
  },
};

export const jelcomDividirEnvio: DefTool = {
  nombre: "jelcom_dividir_envio", modulo: MODULO,
  descripcion: "Divide los contactos pendientes de un envío en N sub-envíos y los lanza en paralelo (acelera envíos grandes). Requiere aprobación.",
  parametros: { type: "object", properties: { envio_id: ID, cantidad: { type: "integer", description: "En cuántas partes dividir.", minimum: 2, maximum: 10, default: 2 } }, required: ["envio_id"] },
  riesgo: "ejecucion", requiereAprobacion: true, timeoutSeg: 120,
  async ejecutar(a) {
    const r = await llamar("POST", `/envios/${a.envio_id}/dividir`, { cantidad: a.cantidad || 2 }, { timeoutSeg: 120 });
    return r.ok ? { ok: true, datos: r.datos, resumen: `Envío #${a.envio_id} dividido en ${((r.datos as any)?.ids || []).length} partes: ${((r.datos as any)?.ids || []).join(", ")}.` } : r;
  },
};

export const jelcomDescargarInforme: DefTool = {
  nombre: "jelcom_descargar_informe", modulo: MODULO,
  descripcion: "Descarga el informe Excel de un envío (o el consolidado con sus sub-envíos) y lo guarda como archivo. Devuelve archivo_id para mandarlo por WhatsApp.",
  parametros: { type: "object", properties: { envio_id: ID, consolidado: { type: "boolean", description: "true si el envío fue dividido (suma las partes).", default: false } }, required: ["envio_id"] },
  riesgo: "lectura", requiereAprobacion: false, timeoutSeg: 120,
  async ejecutar(a, ctx) {
    const r = await llamar("GET", `/envios/${a.envio_id}/${a.consolidado ? "informe-consolidado" : "informe"}`, undefined, { binario: true, timeoutSeg: 120 });
    if (!r.ok) return r;
    const d = r.datos as any;
    const arch = await guardarArchivo({ nombre: d.nombre, mime: d.mime || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", contenido: d.buffer, origen: "generado", conversacionId: ctx.conversacionId ?? null, agenteId: ctx.agenteId });
    return { ok: true, datos: { archivo_id: arch.id, nombre: arch.nombre, kb: Math.round(arch.tam_bytes / 1024) }, resumen: `Informe "${arch.nombre}" descargado (archivo_id ${arch.id}).` };
  },
};

function resumirEnvio(e: any) {
  return {
    id: e.id, nombre: e.nombre, canal: e.canal, estado: e.estado, campana_id: e.campana_id, campana: e.campana_nombre,
    cuenta_sms_id: e.cuenta_sms_id, cuenta_wa_id: e.cuenta_wa_id, padre_id: e.padre_id,
    base: e.total_base || 0, validos: e.total_validos || 0, enviados: e.total_enviados || 0, errores: e.total_errores || 0,
    creado_en: e.creado_en, enviado_en: e.enviado_en,
  };
}

export const toolsJelcom: DefTool[] = [
  jelcomListarCampanas, jelcomCrearCampana, jelcomListarCuentasWhatsapp, jelcomListarCuentasSms,
  jelcomListarEnvios, jelcomVerEnvio, jelcomEstadoEnvio, jelcomAnalizarSms,
  jelcomCrearEnvio, jelcomSubirBase, jelcomDispararEnvio, jelcomReanudarEnvio, jelcomPausarEnvio, jelcomDividirEnvio, jelcomDescargarInforme,
];