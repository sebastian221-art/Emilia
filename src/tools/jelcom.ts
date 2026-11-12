// ARCHIVO: src/tools/jelcom.ts
// ─────────────────────────────────────────────────────────────────────────────
//  TOOLS DE JELCOM ENVÍOS — API externa (/api/external/..., x-api-key)
//  Echo maneja la plataforma entera con esto: los 4 canales (SMS, WhatsApp,
//  correo, bot de voz), plantillas de Meta, voces, validación real de bases,
//  envíos divididos como UNO solo (familia), costo estimado y real, envío de
//  prueba, informes consolidados y de campaña, y perfiles por cliente.
//
//  Reglas de seguridad de esta capa:
//   - Nada que cree o divida se reintenta a ciegas: si hay timeout, se revisa
//     en Jelcom si ya quedó hecho antes de devolver error (no hay duplicados).
//   - Antes de la primera llamada se "despierta" la app (Railway la duerme).
//   - Disparar, reanudar, dividir, eliminar y crear plantillas piden OK.
//  .env: JELCOM_URL, JELCOM_API_KEY, (opcional) JELCOM_CORREO_PRUEBA,
//        JELCOM_DESTINOS_PRUEBA (números/correos extra permitidos para pruebas)
// ─────────────────────────────────────────────────────────────────────────────

import type { DefTool, ResultadoTool } from "../registro/tipos.js";
import { leerArchivo, guardarArchivo } from "../dominio/archivos.js";
import { query } from "../db/cliente.js";

const MODULO = "jelcom";
const ID = { type: "integer" as const, description: "Id numérico del envío en Jelcom.", minimum: 1 };
const CANALES = ["sms", "whatsapp", "correo", "voz"] as const;

function cfg() {
  const url = (process.env.JELCOM_URL || "https://backendjelcomenvios-production.up.railway.app").replace(/\/+$/, "");
  const key = process.env.JELCOM_API_KEY;
  if (!key) throw new Error("Falta JELCOM_API_KEY en el .env (se genera en Jelcom Envíos → API externa).");
  return { raiz: url, base: `${url}/api/external`, key };
}

// ─── Utilidades de presentación (todo lo que ve el jefe sale con este formato) ─
export const num = (n: unknown) => Number(n || 0).toLocaleString("es-CO");
export function plata(valor: number | null | undefined, moneda = "COP"): string {
  if (valor == null) return "sin tarifa";
  return moneda === "COP" ? `$${Math.round(valor).toLocaleString("es-CO")}` : `${valor.toLocaleString("es-CO", { maximumFractionDigits: 2 })} ${moneda}`;
}
export const pct = (a: number, b: number) => (b ? Math.round((a * 1000) / b) / 10 : 0);
const ESTADOS: Record<string, string> = { borrador: "borrador", lista: "lista para disparar", en_curso: "enviando", pausada: "pausada", finalizada: "terminada", error: "con error" };
export const estadoLegible = (e: string) => ESTADOS[e] || e;

// ─── Conexión con Jelcom ─────────────────────────────────────────────────────
let ultimoContacto = 0;
/** Railway duerme la app: antes de operar se le pega a /api/health hasta que responda (máx ~70 s). */
async function despertar(): Promise<string | null> {
  if (Date.now() - ultimoContacto < 5 * 60_000) return null;
  let c; try { c = cfg(); } catch (e: any) { return e.message; }
  for (let i = 0; i < 6; i++) {
    try {
      const r = await fetch(`${c.raiz}/api/health`, { signal: AbortSignal.timeout(12_000) });
      if (r.ok) { ultimoContacto = Date.now(); return null; }
    } catch { /* sigue intentando */ }
    await new Promise((r) => setTimeout(r, 2000 + i * 1000));
  }
  return "Jelcom Envíos no responde (probablemente la app en Railway está caída o reiniciando). Intenta en unos minutos.";
}

type Opciones = { form?: FormData; binario?: boolean; timeoutSeg?: number; idempotente?: boolean };
type Resp = ResultadoTool & { status?: number };

async function llamarUnaVez(metodo: string, ruta: string, body?: unknown, op: Opciones = {}): Promise<Resp> {
  let c; try { c = cfg(); } catch (e: any) { return { ok: false, error: e.message }; }
  try {
    const headers: Record<string, string> = { "x-api-key": c.key };
    let cuerpo: any;
    if (op.form) cuerpo = op.form;
    else if (body !== undefined) { headers["Content-Type"] = "application/json"; cuerpo = JSON.stringify(body); }
    const resp = await fetch(`${c.base}${ruta}`, { method: metodo, headers, body: cuerpo, signal: AbortSignal.timeout((op.timeoutSeg || 40) * 1000) });
    ultimoContacto = Date.now();
    if (op.binario) {
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

const esTransitorio = (r: Resp) => !r.ok && ((r.status && [502, 503, 504].includes(r.status)) || /timeout|ECONNRESET|ECONNREFUSED|fetch failed|failed to respond|aborted/i.test(r.error || ""));

/**
 * Llamada con reintentos SOLO si es idempotente (lecturas, pausar, subir base,
 * disparar: el motor de Jelcom ignora un segundo disparo mientras corre).
 * Crear y dividir NO se reintentan aquí: cada tool revisa si ya quedó hecho.
 */
async function llamar(metodo: string, ruta: string, body?: unknown, op: Opciones = {}): Promise<Resp> {
  const dormida = await despertar();
  if (dormida) return { ok: false, error: dormida };
  const idempotente = op.idempotente ?? metodo === "GET";
  const max = idempotente ? 3 : 1;
  let r: Resp = { ok: false, error: "sin intentos" };
  for (let i = 1; i <= max; i++) {
    r = await llamarUnaVez(metodo, ruta, body, op);
    if (!esTransitorio(r) || i === max) break;
    await new Promise((res) => setTimeout(res, 3000 * i));
  }
  if (r.status === 404 && /^\/(envios\/\d+\/(familia|costo|prueba)|envios\/validar-base|whatsapp|voces|conexiones|tarifas)/.test(ruta)) {
    r.error = `${r.error} — esta función necesita la versión nueva del backend de Jelcom (despliega jelcom-envios actualizado).`;
    (r as any).noDisponible = true;
  }
  return r;
}

// ─── Familia (envío dividido = UN envío) ─────────────────────────────────────
export interface Familia {
  raiz: any; partes: any[]; ids: number[]; dividido: boolean; estado: string;
  totales: { base: number; validos: number; duplicados: number; invalidos: number; enviados: number; errores: number; pendientes: number; procesados: number };
  errores_recientes: string[]; logs: { envio_id: number; ts: string; nivel: string; mensaje: string }[];
}
/** Familia del envío; si el backend es viejo, la arma con /envios/:id + /logs. */
export async function familia(envioId: number): Promise<{ ok: boolean; f?: Familia; error?: string }> {
  const r = await llamar("GET", `/envios/${envioId}/familia`);
  if (r.ok) return { ok: true, f: r.datos as Familia };
  if (!(r as any).noDisponible) return { ok: false, error: r.status === 404 ? `El envío #${envioId} no existe en Jelcom.` : r.error };
  const v = await llamar("GET", `/envios/${envioId}`);
  if (!v.ok) return { ok: false, error: v.status === 404 ? `El envío #${envioId} no existe en Jelcom.` : v.error };
  const lg = await llamar("GET", `/envios/${envioId}/logs`);
  const e = v.datos as any; const logs = ((lg.datos as any)?.logs || []) as any[];
  const procesados = (e.total_enviados || 0) + (e.total_errores || 0);
  return { ok: true, f: { raiz: e, partes: [], ids: [e.id], dividido: false, estado: e.estado,
    totales: { base: e.total_base || 0, validos: e.total_validos || 0, duplicados: e.total_dup || 0, invalidos: e.total_invalid || 0, enviados: e.total_enviados || 0, errores: e.total_errores || 0, pendientes: Math.max(0, (e.total_validos || 0) - procesados), procesados },
    errores_recientes: logs.filter((l) => l.nivel === "error").slice(-8).map((l) => l.mensaje), logs: logs.slice(-40) } };
}

// ─── Validación de bases (mismas reglas que depurar.js de Jelcom) ────────────
const EMAIL_RE = /^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/;
const PAL_TEL = ["telefono", "celular", "movil", "phone", "numero", "num_tel", "cel", "tel"];
const PAL_CORREO = ["correo", "email", "e-mail", "mail"];
const normTxt = (t: unknown) => String(t ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
const normTel = (x: unknown) => { const d = String(x ?? "").replace(/\D/g, ""); return d.length === 10 && d.startsWith("3") ? "57" + d : null; };

/** Copia local de depurar.js (para cuando el backend todavía no tiene /validar-base). */
async function validarLocal(contenido: Buffer, nombre: string, canal: string) {
  const nombreMod = "xlsx"; const XLSX: any = await import(nombreMod);
  const wb = XLSX.read(contenido, { type: "buffer" });
  const matriz: any[][] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "" });
  const pal = canal === "correo" ? PAL_CORREO : PAL_TEL;
  const enc = (matriz[0] || []).map((h) => String(h));
  const idx = enc.findIndex((h) => pal.some((p) => normTxt(h).includes(p)));
  const celdas: unknown[] = [];
  if (idx >= 0) for (let f = 1; f < matriz.length; f++) { const c = matriz[f][idx]; if (String(c ?? "").trim()) celdas.push(c); }
  else for (const fila of matriz) { const c = fila.find((x) => x !== "" && x != null); if (String(c ?? "").trim()) celdas.push(c); }
  const vistos = new Set<string>(); const validos: string[] = []; const invalidos: string[] = []; let dup = 0;
  for (const c of celdas) {
    const partes = canal === "correo" ? String(c).trim().split(/[,;\s]+/).filter(Boolean) : [c];
    for (const p of partes) {
      const v = canal === "correo" ? (EMAIL_RE.test(String(p).toLowerCase()) ? String(p).toLowerCase() : null) : normTel(p);
      if (!v) { invalidos.push(String(p)); continue; }
      if (vistos.has(v)) { dup++; continue; }
      vistos.add(v); validos.push(v);
    }
  }
  return { canal, archivo: nombre, total_base: celdas.length, validos: validos.length, duplicados: dup, invalidos: invalidos.length, columna: idx >= 0 ? enc[idx] : null, modo_lectura: idx >= 0 ? "encabezado" : "primera_celda", encabezados: enc.slice(0, 15), muestra_validos: validos.slice(0, 5), muestra_invalidos: invalidos.slice(0, 8), validado_en: "local" };
}

export async function validarBase(archivoId: string, canal: string): Promise<ResultadoTool> {
  let arch; try { arch = await leerArchivo(archivoId); } catch (e: any) { return { ok: false, error: `No encuentro el archivo ${archivoId}: ${e?.message || e}` }; }
  const { meta, contenido } = arch;
  const fd = new FormData();
  fd.append("archivo", new Blob([new Uint8Array(contenido)], { type: meta.mime }), meta.nombre);
  fd.append("canal", canal);
  let r = await llamar("POST", "/envios/validar-base", undefined, { form: fd, timeoutSeg: 120, idempotente: true });
  let d: any;
  if (r.ok) d = { ...(r.datos as any), validado_en: "jelcom" };
  else if ((r as any).noDisponible) { try { d = await validarLocal(contenido, meta.nombre, canal); } catch (e: any) { return { ok: false, error: `No pude leer la base: ${e?.message || e}` }; } }
  else return { ok: false, error: r.error };
  const tipo = canal === "correo" ? "correos" : "celulares";
  const como = d.columna ? `columna "${d.columna}"` : `primera celda de cada fila (ninguna columna se llama ${canal === "correo" ? "correo/email" : "telefono/celular/movil"})`;
  const problemas: string[] = [];
  if (!d.validos) problemas.push(canal === "correo" ? "Ningún correo válido." : "Ningún celular válido: deben quedar en 10 dígitos que empiecen en 3 (Jelcom les pone el 57).");
  else if (d.invalidos > d.validos * 0.2) problemas.push(`${num(d.invalidos)} de ${num(d.total_base)} se descartan por inválidos (ej: ${d.muestra_invalidos.slice(0, 3).join(", ")}).`);
  return {
    ok: true, datos: { ...d, archivo_id: archivoId, apta: d.validos > 0, problemas },
    resumen: `Base "${meta.nombre}" (${canal}): ${num(d.total_base)} filas → ${num(d.validos)} ${tipo} válidos · ${num(d.duplicados)} duplicados · ${num(d.invalidos)} inválidos${d.lista_negra ? ` · ${num(d.lista_negra)} en lista negra` : ""}. Leída por ${como}.${problemas.length ? "\n⚠ " + problemas.join(" ") : ""}`,
  };
}

// ─── Destinos de prueba permitidos (nunca a terceros) ────────────────────────
function destinosPrueba(): { tel: string[]; correo: string[] } {
  const extra = (process.env.JELCOM_DESTINOS_PRUEBA || "").split(",").map((x) => x.trim()).filter(Boolean);
  const tel = [process.env.WHATSAPP_NUMERO_JEFE || "", ...extra.filter((x) => !x.includes("@"))].map((x) => x.replace(/\D/g, "")).filter(Boolean);
  const correo = [process.env.JELCOM_CORREO_PRUEBA || "", ...extra.filter((x) => x.includes("@"))].map((x) => x.toLowerCase()).filter(Boolean);
  return { tel, correo };
}
const ultimos10 = (n: string) => n.replace(/\D/g, "").slice(-10);

// ═════════════════════════════════════════════════════════════════════════════
//  CONSULTAS
// ═════════════════════════════════════════════════════════════════════════════
export const jelcomEstadoSistema: DefTool = {
  nombre: "jelcom_estado_sistema", modulo: MODULO,
  descripcion: "Chequeo general de Jelcom Envíos: si la app responde, estado y saldo de cada proveedor (Háblame, LabsMobile, Brevo, Meta, Twilio, ElevenLabs), cuentas disponibles y tarifas configuradas. Usalo antes de un envío importante o si algo falla.",
  parametros: { type: "object", properties: { probar: { type: "boolean", description: "true = probar cada proveedor ahora (consulta saldo real; tarda más).", default: false } }, required: [] },
  riesgo: "lectura", requiereAprobacion: false, timeoutSeg: 180,
  async ejecutar(a) {
    const dormida = await despertar();
    if (dormida) return { ok: false, error: dormida };
    const lineas: string[] = ["✅ Jelcom responde."];
    if (a.probar) for (const p of ["hablame", "brevo", "meta", "twilio", "elevenlabs"]) await llamar("POST", `/conexiones/${p}/probar`, {}, { idempotente: true, timeoutSeg: 30 });
    const [con, sms, wa, tar] = await Promise.all([llamar("GET", "/conexiones"), llamar("GET", "/cuentas-sms"), llamar("GET", "/cuentas"), llamar("GET", "/tarifas")]);
    const conexiones = con.ok ? (con.datos as any[]) : [];
    for (const c of conexiones) lineas.push(`${c.estado === "ok" ? "🟢" : c.estado === "error" ? "🔴" : "⚪"} ${c.proveedor}${c.saldo ? ` · saldo ${c.saldo}` : ""}${c.estado === "error" && c.detalle ? ` · ${String(c.detalle).slice(0, 80)}` : ""}`);
    if (!con.ok) lineas.push(`(sin estado de proveedores: ${con.error})`);
    const tarifas = tar.ok ? (tar.datos as any).tarifas : null;
    return { ok: true, datos: { conexiones, cuentas_sms: sms.datos, cuentas_whatsapp: wa.datos, tarifas },
      resumen: `${lineas.join("\n")}\nCuentas SMS: ${Array.isArray(sms.datos) ? sms.datos.length : "?"} · WhatsApp: ${Array.isArray(wa.datos) ? wa.datos.length : "?"}\nTarifas: ${tarifas ? Object.entries(tarifas).map(([k, v]) => `${k.replace("tarifa_", "")}=${v}`).join(", ") : tar.error}` };
  },
};

export const jelcomListarCampanas: DefTool = {
  nombre: "jelcom_listar_campanas", modulo: MODULO,
  descripcion: "Lista las campañas (clientes) de Jelcom con su id, cuántos envíos tienen y su cuenta de WhatsApp por defecto.",
  parametros: { type: "object", properties: { buscar: { type: "string", description: "Filtrar por parte del nombre (opcional)." } }, required: [] },
  riesgo: "lectura", requiereAprobacion: false, timeoutSeg: 100,
  async ejecutar(a) {
    const r = await llamar("GET", "/campanas");
    if (!r.ok) return r;
    let lista = (r.datos as any[]).map((c) => ({ id: c.id, nombre: c.nombre, envios: c.num_envios, cuenta_wa_id: c.cuenta_wa_id }));
    if (a.buscar) { const q = normTxt(a.buscar); lista = lista.filter((c) => normTxt(c.nombre).includes(q)); }
    return { ok: true, datos: lista, resumen: lista.length ? lista.map((c) => `#${c.id} ${c.nombre} (${c.envios ?? 0} envíos)`).join("\n") : "No hay campañas con ese nombre." };
  },
};

export const jelcomCrearCampana: DefTool = {
  nombre: "jelcom_crear_campana", modulo: MODULO,
  descripcion: "Crea una campaña (cliente) nueva. Si ya existe una con ese nombre, devuelve la existente en vez de duplicarla.",
  parametros: { type: "object", properties: { nombre: { type: "string", description: "Nombre del cliente/campaña.", minLength: 2 }, cuenta_wa_id: { type: "integer", description: "Cuenta de WhatsApp por defecto (opcional)." } }, required: ["nombre"] },
  riesgo: "escritura", requiereAprobacion: false, timeoutSeg: 100,
  async ejecutar(a) {
    const buscar = async () => { const l = await llamar("GET", "/campanas"); return l.ok ? (l.datos as any[]).find((c) => normTxt(c.nombre) === normTxt(a.nombre)) : undefined; };
    const ya = await buscar();
    if (ya) return { ok: true, datos: { id: ya.id, existia: true }, resumen: `La campaña "${ya.nombre}" ya existía (#${ya.id}); uso esa.` };
    const r = await llamar("POST", "/campanas", { nombre: a.nombre, cuenta_wa_id: a.cuenta_wa_id });
    if (r.ok) return { ok: true, datos: { id: (r.datos as any)?.id }, resumen: `Campaña "${a.nombre}" creada (#${(r.datos as any)?.id}).` };
    const tras = esTransitorio(r) ? await buscar() : undefined;   // ¿se creó aunque la respuesta se perdió?
    return tras ? { ok: true, datos: { id: tras.id }, resumen: `Campaña "${a.nombre}" creada (#${tras.id}).` } : r;
  },
};

export const jelcomCampanaCuentaWhatsapp: DefTool = {
  nombre: "jelcom_campana_cuenta_whatsapp", modulo: MODULO,
  descripcion: "Fija la cuenta de WhatsApp por defecto de una campaña (cliente).",
  parametros: { type: "object", properties: { campana_id: { type: "integer", minimum: 1 }, cuenta_wa_id: { type: "integer", minimum: 1 } }, required: ["campana_id", "cuenta_wa_id"] },
  riesgo: "escritura", requiereAprobacion: false, timeoutSeg: 60,
  async ejecutar(a) {
    const r = await llamar("PUT", `/campanas/${a.campana_id}/cuenta`, { cuenta_wa_id: a.cuenta_wa_id }, { idempotente: true });
    return r.ok ? { ok: true, resumen: `Campaña #${a.campana_id} usa por defecto la cuenta WhatsApp #${a.cuenta_wa_id}.` } : r;
  },
};

export const jelcomListarCuentasSms: DefTool = {
  nombre: "jelcom_listar_cuentas_sms", modulo: MODULO,
  descripcion: "Lista las cuentas de SMS (id, nombre, proveedor, remitente).",
  parametros: { type: "object", properties: {}, required: [] }, riesgo: "lectura", requiereAprobacion: false, timeoutSeg: 100,
  async ejecutar() {
    const r = await llamar("GET", "/cuentas-sms");
    if (!r.ok) return r;
    const lista = (Array.isArray(r.datos) ? r.datos : []).map((c: any) => ({ id: c.id, nombre: c.nombre, proveedor: c.proveedor, remitente: c.remitente }));
    return { ok: true, datos: lista, resumen: lista.length ? lista.map((c: any) => `#${c.id} ${c.nombre} (${c.proveedor}${c.remitente ? `, remitente ${c.remitente}` : ""})`).join("\n") : "No hay cuentas SMS." };
  },
};

export const jelcomListarCuentasWhatsapp: DefTool = {
  nombre: "jelcom_listar_cuentas_whatsapp", modulo: MODULO,
  descripcion: "Lista las cuentas de WhatsApp Business (id, nombre, número).",
  parametros: { type: "object", properties: {}, required: [] }, riesgo: "lectura", requiereAprobacion: false, timeoutSeg: 100,
  async ejecutar() {
    const r = await llamar("GET", "/cuentas");
    if (!r.ok) return r;
    const lista = (Array.isArray(r.datos) ? r.datos : []).map((c: any) => ({ id: c.id, nombre: c.nombre, numero: c.telefono || c.numero || "" }));
    return { ok: true, datos: lista, resumen: lista.length ? lista.map((c: any) => `#${c.id} ${c.nombre}${c.numero ? ` (${c.numero})` : ""}`).join("\n") : "No hay cuentas de WhatsApp." };
  },
};

export const jelcomListarPlantillas: DefTool = {
  nombre: "jelcom_listar_plantillas", modulo: MODULO,
  descripcion: "Plantillas de WhatsApp REALES de una cuenta en Meta: nombre, estado (APPROVED/PENDING/REJECTED), idioma, categoría, si la cabecera pide imagen y cuántas variables tiene. Necesario para armar un envío de WhatsApp sin errores.",
  parametros: { type: "object", properties: { cuenta_wa_id: { type: "integer", minimum: 1 }, solo_aprobadas: { type: "boolean", default: true }, buscar: { type: "string", description: "Parte del nombre (opcional)." } }, required: ["cuenta_wa_id"] },
  riesgo: "lectura", requiereAprobacion: false, timeoutSeg: 60,
  async ejecutar(a) {
    const r = await llamar("GET", `/whatsapp/plantillas-meta?cuenta_wa_id=${a.cuenta_wa_id}`);
    if (!r.ok) return r;
    let l = r.datos as any[];
    if (a.solo_aprobadas !== false) l = l.filter((p) => p.estado === "APPROVED");
    if (a.buscar) { const q = normTxt(a.buscar); l = l.filter((p) => normTxt(p.nombre).includes(q)); }
    return { ok: true, datos: l, resumen: l.length ? l.map((p) => `• ${p.nombre} [${p.idioma}] ${p.categoria}${p.cabecera === "image" ? " · pide imagen" : ""}${p.variables_cuerpo ? ` · ${p.variables_cuerpo} variable(s)` : ""}${p.estado !== "APPROVED" ? ` · ${p.estado}` : ""}`).join("\n") : "No hay plantillas con ese filtro." };
  },
};

export const jelcomCrearPlantilla: DefTool = {
  nombre: "jelcom_crear_plantilla", modulo: MODULO,
  descripcion: "Crea una plantilla de WhatsApp y la manda a revisión de Meta (Jelcom sondea su estado solo). Nombre en minúsculas con guiones bajos. Sin variables {{1}}: Jelcom envía las plantillas sin parámetros.",
  parametros: {
    type: "object",
    properties: {
      cuenta_wa_id: { type: "integer", minimum: 1 },
      nombre: { type: "string", minLength: 3, maxLength: 60, description: "Minúsculas, números y guion bajo. Ej: promo_noviembre_cajasan" },
      cuerpo: { type: "string", minLength: 5, maxLength: 1024 },
      categoria: { type: "string", enum: ["MARKETING", "UTILITY"], default: "MARKETING" },
      idioma: { type: "string", default: "es" },
      con_imagen: { type: "boolean", description: "true = cabecera con imagen (cada envío deberá llevar imagen_url).", default: false },
      imagen_ejemplo: { type: "string", description: "URL pública de una imagen de ejemplo (obligatoria si con_imagen)." },
    },
    required: ["cuenta_wa_id", "nombre", "cuerpo"],
  },
  riesgo: "escritura", requiereAprobacion: true, timeoutSeg: 60,
  async ejecutar(a) {
    if (!/^[a-z0-9_]{3,60}$/.test(a.nombre)) return { ok: false, error: `Nombre inválido para Meta: solo minúsculas, números y guion bajo (ej: promo_noviembre). Prueba "${String(a.nombre).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")}".` };
    if (/\{\{\s*\d+\s*\}\}/.test(a.cuerpo)) return { ok: false, error: "El cuerpo tiene variables {{n}}: Jelcom no las llena y Meta rechazaría los envíos. Escríbelo sin variables." };
    if (a.con_imagen && !a.imagen_ejemplo) return { ok: false, error: "Con imagen de cabecera, Meta pide una imagen de ejemplo (imagen_ejemplo)." };
    const r = await llamar("POST", "/whatsapp/plantillas", { cuenta_wa_id: a.cuenta_wa_id, nombre: a.nombre, cuerpo: a.cuerpo, categoria: a.categoria || "MARKETING", idioma: a.idioma || "es", tipo_cabecera: a.con_imagen ? "imagen" : "ninguna", imagen_ejemplo: a.imagen_ejemplo });
    return r.ok ? { ok: true, datos: r.datos, resumen: `Plantilla "${a.nombre}" enviada a Meta (estado PENDIENTE). Jelcom revisa cada minuto si la aprueban.` } : r;
  },
};

export const jelcomListarVoces: DefTool = {
  nombre: "jelcom_listar_voces", modulo: MODULO,
  descripcion: "Voces de ElevenLabs guardadas en Jelcom para el bot de voz (id, nombre, voice_id).",
  parametros: { type: "object", properties: {}, required: [] }, riesgo: "lectura", requiereAprobacion: false, timeoutSeg: 60,
  async ejecutar() {
    const r = await llamar("GET", "/voces");
    if (!r.ok) return r;
    const l = (r.datos as any[]).map((v) => ({ id: v.id, nombre: v.nombre, voice_id: v.voice_id, descripcion: v.descripcion }));
    return { ok: true, datos: l, resumen: l.length ? l.map((v) => `#${v.id} ${v.nombre} (voice_id ${v.voice_id})${v.descripcion ? ` — ${v.descripcion}` : ""}`).join("\n") : "No hay voces guardadas." };
  },
};

export const jelcomValidarBase: DefTool = {
  nombre: "jelcom_validar_base", modulo: MODULO,
  descripcion: "Valida una base (CSV/Excel) con las reglas EXACTAS de Jelcom sin crear nada: cuántos válidos, duplicados e inválidos, qué columna se usa y ejemplos de lo que se descarta. Celulares: 10 dígitos que empiecen en 3. Correos: formato válido (corrige gmial.com, hotmal.com…).",
  parametros: { type: "object", properties: { archivo_id: { type: "string", minLength: 8 }, canal: { type: "string", enum: [...CANALES], default: "sms" } }, required: ["archivo_id"] },
  riesgo: "lectura", requiereAprobacion: false, timeoutSeg: 150,
  async ejecutar(a) { return validarBase(a.archivo_id, a.canal || "sms"); },
};

export const jelcomListarEnvios: DefTool = {
  nombre: "jelcom_listar_envios", modulo: MODULO,
  descripcion: "Lista envíos con estado y contadores. Filtros: campaña, estados (borrador, lista, en_curso, pausada, finalizada, error), rango de fechas. Un envío dividido aparece una sola vez con todo sumado.",
  parametros: {
    type: "object",
    properties: {
      campana_id: { type: "integer" }, estados: { type: "string", description: "Ej: 'en_curso,pausada'." },
      desde: { type: "string", description: "AAAA-MM-DD" }, hasta: { type: "string", description: "AAAA-MM-DD" },
      limite: { type: "integer", default: 15, minimum: 1, maximum: 100 },
    }, required: [],
  },
  riesgo: "lectura", requiereAprobacion: false, timeoutSeg: 100,
  async ejecutar(a) {
    const q = new URLSearchParams();
    for (const k of ["campana_id", "estados", "desde", "hasta"]) if (a[k]) q.set(k, String(a[k]));
    const r = await llamar("GET", `/envios${q.toString() ? "?" + q : ""}`);
    if (!r.ok) return r;
    const todos = r.datos as any[];
    const partesDe = new Map<number, any[]>();
    for (const e of todos) if (e.padre_id) partesDe.set(e.padre_id, [...(partesDe.get(e.padre_id) || []), e]);
    const raices = todos.filter((e) => !e.padre_id).slice(0, a.limite || 15);
    const lista = raices.map((e) => {
      const p = partesDe.get(e.id) || [];
      const env = [e, ...p].reduce((s, x) => s + (x.total_enviados || 0), 0), err = [e, ...p].reduce((s, x) => s + (x.total_errores || 0), 0);
      return { id: e.id, nombre: e.nombre, canal: e.canal, estado: e.estado, campana: e.campana_nombre, validos: e.total_validos, enviados: env, errores: err, partes: p.map((x) => x.id), creado_en: e.creado_en };
    });
    return { ok: true, datos: lista, resumen: lista.length ? lista.map((e) => `#${e.id} ${e.nombre} [${e.canal}] ${estadoLegible(e.estado)} · ${num(e.enviados)}/${num(e.validos)}${e.errores ? ` · ${num(e.errores)} err` : ""}${e.partes.length ? ` · dividido en ${e.partes.length}` : ""}`).join("\n") : "No hay envíos con ese filtro." };
  },
};

export const jelcomVerEnvio: DefTool = {
  nombre: "jelcom_ver_envio", modulo: MODULO,
  descripcion: "Detalle de un envío: canal, estado, campaña, cuenta, contenido (texto/plantilla/asunto/audio) y contadores. Si fue dividido, muestra el total de todas sus partes.",
  parametros: { type: "object", properties: { envio_id: ID }, required: ["envio_id"] }, riesgo: "lectura", requiereAprobacion: false, timeoutSeg: 100,
  async ejecutar(a) {
    const fr = await familia(a.envio_id);
    if (!fr.ok) return { ok: false, error: fr.error };
    const f = fr.f!; const e = f.raiz; const t = f.totales;
    const contenido = e.canal === "sms" ? `Texto: "${e.cuerpo}"` : e.canal === "whatsapp" ? `Plantilla: ${e.plantilla} [${e.idioma}]${e.imagen_url ? " · con imagen" : ""}` : e.canal === "correo" ? `Asunto: "${e.asunto}"${e.imagen_url ? " · con imagen" : ""}${e.enlace ? " · con enlace" : ""}` : `Voz: ${e.modo_audio === "texto" ? `texto a voz (${e.voz_id || "voz por defecto"})` : "audio pregrabado"}`;
    const datos = { envio_id: e.id, id: e.id, nombre: e.nombre, canal: e.canal, estado: f.estado, campana_id: e.campana_id, cuenta_sms_id: e.cuenta_sms_id, cuenta_wa_id: e.cuenta_wa_id, cuerpo: e.cuerpo, plantilla: e.plantilla, idioma: e.idioma, asunto: e.asunto, imagen_url: e.imagen_url, enlace: e.enlace, ...t, dividido: f.dividido, partes: f.partes.map((p) => ({ id: p.id, estado: p.estado, enviados: p.total_enviados, errores: p.total_errores, validos: p.total_validos })) };
    return { ok: true, datos, resumen: `#${e.id} "${e.nombre}" [${e.canal}] ${estadoLegible(f.estado)}\n${contenido}\nBase ${num(t.base)} → válidos ${num(t.validos)} · enviados ${num(t.enviados)} · errores ${num(t.errores)} · pendientes ${num(t.pendientes)}${f.dividido ? `\nDividido en ${f.partes.length} partes (#${f.partes.map((p) => p.id).join(", #")})` : ""}` };
  },
};

export const jelcomEstadoEnvio: DefTool = {
  nombre: "jelcom_estado_envio", modulo: MODULO,
  descripcion: "Estado EN VIVO de un envío (sumando todas sus partes si fue dividido): progreso, tasa de error, pendientes y los últimos errores del proveedor.",
  parametros: { type: "object", properties: { envio_id: ID }, required: ["envio_id"] },
  riesgo: "lectura", requiereAprobacion: false, timeoutSeg: 100,
  async ejecutar(a) {
    const fr = await familia(a.envio_id);
    if (!fr.ok) return { ok: false, error: fr.error };
    const f = fr.f!; const t = f.totales;
    const tasa = pct(t.errores, t.procesados);
    const terminado = ["finalizada", "error"].includes(f.estado) && t.pendientes === 0;
    const datos = { envio_id: f.raiz.id, estado: f.estado, total: t.validos, enviados: t.enviados, errores: t.errores, procesados: t.procesados, pendientes: t.pendientes, avance: pct(t.procesados, t.validos), tasa_error: tasa, terminado, dividido: f.dividido, partes: f.partes.map((p) => ({ id: p.id, estado: p.estado })), errores_recientes: f.errores_recientes, logs: f.logs.slice(-10) };
    return { ok: true, datos, resumen: `#${f.raiz.id} ${estadoLegible(f.estado)} · ${num(t.procesados)}/${num(t.validos)} (${datos.avance}%) · ${num(t.enviados)} enviados · ${num(t.errores)} errores (${tasa}%)${f.dividido ? ` · ${f.partes.length} partes` : ""}${f.errores_recientes.length ? `\nÚltimo error: ${String(f.errores_recientes.at(-1)).replace(/^[^\p{L}\p{N}]+/u, "")}` : ""}` };
  },
};

export const jelcomAnalizarSms: DefTool = {
  nombre: "jelcom_analizar_sms", modulo: MODULO,
  descripcion: "Cuántos caracteres y segmentos ocupa un SMS (cada segmento se cobra). Tildes, ñ y emojis pasan el SMS a UCS-2 (70 caracteres por segmento en vez de 160).",
  parametros: { type: "object", properties: { texto: { type: "string", minLength: 1 } }, required: ["texto"] },
  riesgo: "lectura", requiereAprobacion: false, timeoutSeg: 60,
  async ejecutar(a) {
    const r = await llamar("POST", "/envios/analizar-sms", { texto: a.texto }, { idempotente: true });
    if (!r.ok) return r;
    const d = r.datos as any;
    return { ok: true, datos: d, resumen: `${d.caracteres} caracteres · ${d.segmentos} segmento(s) · ${d.codificacion}` };
  },
};

export const jelcomCostoEnvio: DefTool = {
  nombre: "jelcom_costo_envio", modulo: MODULO,
  descripcion: "Cuánto cuesta un envío: estimado (todos los válidos) y real (lo que ya salió), con la tarifa usada. Suma todas las partes si fue dividido. Si falta una tarifa lo dice (nunca inventa precios).",
  parametros: { type: "object", properties: { envio_id: ID }, required: ["envio_id"] },
  riesgo: "lectura", requiereAprobacion: false, timeoutSeg: 60,
  async ejecutar(a) {
    const r = await llamar("GET", `/envios/${a.envio_id}/costo`);
    if (!r.ok) return r;
    const c = r.datos as any;
    const falta = c.faltan?.length ? ` · falta tarifa: ${c.faltan[0]}` : "";
    return { ok: true, datos: c, resumen: `Costo #${a.envio_id} (${c.unidad}): estimado ${plata(c.costo.estimado, c.moneda)} (${num(c.unidades.estimadas)} u.) · real ${plata(c.costo.real, c.moneda)} (${num(c.unidades.reales)} u.)${c.tarifa != null ? ` · tarifa ${plata(c.tarifa, c.moneda)}` : ""}${falta}` };
  },
};

export const jelcomTarifas: DefTool = {
  nombre: "jelcom_tarifas", modulo: MODULO,
  descripcion: "Ver o fijar las tarifas con las que se calcula el costo de los envíos. Claves: tarifa_sms (por segmento), tarifa_sms_hablame / _labsmobile / _brevo, tarifa_whatsapp, tarifa_whatsapp_marketing / _utility / _authentication, tarifa_correo, tarifa_voz_minuto, moneda. Solo fija valores que el jefe dijo.",
  parametros: { type: "object", properties: { accion: { type: "string", enum: ["ver", "fijar"], default: "ver" }, valores: { type: "object", description: "Para 'fijar': { tarifa_sms: 18, moneda: 'COP', ... }" } }, required: [] },
  riesgo: "escritura", requiereAprobacion: false, timeoutSeg: 60,
  async ejecutar(a) {
    const r = a.accion === "fijar" ? await llamar("PUT", "/tarifas", a.valores || {}, { idempotente: true }) : await llamar("GET", "/tarifas");
    if (!r.ok) return r;
    const t = (r.datos as any).tarifas || {};
    return { ok: true, datos: t, resumen: Object.keys(t).length > 1 ? `Tarifas (${t.moneda}): ${Object.entries(t).filter(([k]) => k !== "moneda").map(([k, v]) => `${k.replace("tarifa_", "")} ${plata(v as number, t.moneda)}`).join(" · ")}` : "No hay tarifas configuradas todavía." };
  },
};

// ═════════════════════════════════════════════════════════════════════════════
//  ESCRITURA
// ═════════════════════════════════════════════════════════════════════════════
export const jelcomCrearEnvio: DefTool = {
  nombre: "jelcom_crear_envio", modulo: MODULO,
  descripcion: "Crea un envío en borrador (después: subir base, probar, disparar). Requisitos por canal → SMS: cuerpo + cuenta_sms_id. WhatsApp: plantilla + idioma + cuenta_wa_id (+ imagen_url si la plantilla pide imagen). Correo: asunto + cuerpo (+ imagen_url, enlace opcionales). Voz: modo_audio 'texto' (texto_voz + voz_id) o 'pregrabado' (audio_url), tecla_captura opcional. Prefiere el flujo jelcom_envio_completo, que valida todo antes.",
  parametros: {
    type: "object",
    properties: {
      campana_id: { type: "integer", minimum: 1 }, nombre: { type: "string", minLength: 2 },
      canal: { type: "string", enum: [...CANALES] },
      cuerpo: { type: "string", description: "Texto del SMS o del correo." },
      cuenta_sms_id: { type: "integer" }, cuenta_wa_id: { type: "integer" },
      plantilla: { type: "string" }, idioma: { type: "string" },
      imagen_url: { type: "string", description: "Imagen de cabecera (WhatsApp) o imagen del correo." },
      asunto: { type: "string" }, enlace: { type: "string", description: "Enlace del correo (la imagen queda clicable)." },
      modo_audio: { type: "string", enum: ["texto", "pregrabado"] }, texto_voz: { type: "string" }, voz_id: { type: "string", description: "voice_id de ElevenLabs." },
      audio_url: { type: "string" }, tecla_captura: { type: "string", description: "Qué significa marcar una tecla (ej: '1 = confirmo asistencia')." },
    },
    required: ["campana_id", "nombre", "canal"],
  },
  riesgo: "escritura", requiereAprobacion: false, timeoutSeg: 100,
  async ejecutar(a) {
    const falta = (c: boolean, m: string) => (c ? m : "");
    const err = a.canal === "sms" ? falta(!a.cuerpo || !a.cuenta_sms_id, "Para SMS necesito 'cuerpo' y 'cuenta_sms_id'.")
      : a.canal === "whatsapp" ? falta(!a.plantilla || !a.cuenta_wa_id, "Para WhatsApp necesito 'plantilla' y 'cuenta_wa_id'.")
      : a.canal === "correo" ? falta(!a.asunto || !a.cuerpo, "Para correo necesito 'asunto' y 'cuerpo'.")
      : falta(!(a.modo_audio === "pregrabado" ? a.audio_url : a.texto_voz || a.cuerpo), "Para voz necesito 'texto_voz' (modo texto) o 'audio_url' (modo pregrabado).");
    if (err) return { ok: false, error: err };
    const cuerpo = {
      campana_id: a.campana_id, nombre: a.nombre, canal: a.canal, cuerpo: a.cuerpo, cuenta_sms_id: a.canal === "sms" ? a.cuenta_sms_id : undefined,
      cuenta_wa_id: a.canal === "whatsapp" ? a.cuenta_wa_id : undefined, plantilla: a.plantilla, idioma: a.canal === "whatsapp" ? a.idioma || "es" : undefined,
      imagen_url: a.imagen_url, asunto: a.asunto, enlace: a.enlace,
      modo_audio: a.canal === "voz" ? a.modo_audio || "texto" : undefined, texto_voz: a.texto_voz, voz_id: a.voz_id, audio_url: a.audio_url, tecla_captura: a.tecla_captura,
      creado_por: "Echo (Emilia)",
    };
    const r = await llamar("POST", "/envios", cuerpo);
    let id = r.ok ? (r.datos as any).id : undefined;
    if (!r.ok && esTransitorio(r)) {
      // La respuesta se perdió: ¿lo creó igual? Se busca por nombre exacto entre los de hoy.
      const hoy = new Date().toISOString().slice(0, 10);
      const l = await llamar("GET", `/envios?desde=${hoy}`);
      id = l.ok ? (l.datos as any[]).find((e) => e.nombre === a.nombre && e.canal === a.canal)?.id : undefined;
      if (!id) return { ok: false, error: `${r.error}. Revisé y NO quedó creado; se puede reintentar.` };
    } else if (!r.ok) return r;
    return { ok: true, datos: { envio_id: id }, resumen: `Envío "${a.nombre}" creado (#${id}, borrador sin base).` };
  },
};

export const jelcomSubirBase: DefTool = {
  nombre: "jelcom_subir_base", modulo: MODULO,
  descripcion: "Sube la base de contactos al envío y Jelcom la depura (reemplaza la anterior si había). Devuelve válidos, duplicados e inválidos.",
  parametros: { type: "object", properties: { envio_id: ID, archivo_id: { type: "string", minLength: 8 } }, required: ["envio_id", "archivo_id"] },
  riesgo: "escritura", requiereAprobacion: false, timeoutSeg: 200,
  async ejecutar(a) {
    let arch; try { arch = await leerArchivo(a.archivo_id); } catch (e: any) { return { ok: false, error: `No encuentro el archivo ${a.archivo_id}.` }; }
    const fd = new FormData();
    fd.append("archivo", new Blob([new Uint8Array(arch.contenido)], { type: arch.meta.mime }), arch.meta.nombre);
    const r = await llamar("POST", `/envios/${a.envio_id}/base`, undefined, { form: fd, timeoutSeg: 180, idempotente: true });   // reemplaza la base: repetir es seguro
    if (!r.ok) return r;
    const d = r.datos as any;
    if (!d.validos) return { ok: false, error: `Jelcom no encontró contactos válidos en "${arch.meta.nombre}" (${num(d.invalidos)} inválidos, ${num(d.duplicados)} duplicados).`, datos: d };
    return { ok: true, datos: d, resumen: `Base cargada en #${a.envio_id}: ${num(d.validos)} válidos · ${num(d.duplicados)} duplicados · ${num(d.invalidos)} inválidos${d.lista_negra ? ` · ${num(d.lista_negra)} en lista negra` : ""} (de ${num(d.total_base)}).` };
  },
};

export const jelcomEnviarPrueba: DefTool = {
  nombre: "jelcom_enviar_prueba", modulo: MODULO,
  descripcion: "Manda UN mensaje de prueba con la configuración real del envío (mismo texto, plantilla, imagen, asunto o audio) al jefe, para ver cómo llega antes del masivo. No toca la base ni los contadores. Solo a destinos de prueba autorizados (el WhatsApp del jefe, JELCOM_CORREO_PRUEBA o JELCOM_DESTINOS_PRUEBA).",
  parametros: { type: "object", properties: { envio_id: ID, destino: { type: "string", description: "Opcional: otro destino de prueba autorizado. Por defecto el del jefe." } }, required: ["envio_id"] },
  riesgo: "ejecucion", requiereAprobacion: false, timeoutSeg: 120,
  async ejecutar(a) {
    const v = await llamar("GET", `/envios/${a.envio_id}`);
    if (!v.ok) return v;
    const canal = (v.datos as any).canal;
    const ok = destinosPrueba();
    let destino = a.destino ? String(a.destino).trim() : canal === "correo" ? ok.correo[0] : ok.tel[0];
    if (!destino) return { ok: false, error: canal === "correo" ? "No hay correo de prueba: agrega JELCOM_CORREO_PRUEBA al .env de Emilia." : "No hay número de prueba: falta WHATSAPP_NUMERO_JEFE en el .env." };
    const autorizado = canal === "correo" ? ok.correo.includes(destino.toLowerCase()) : ok.tel.some((t) => ultimos10(t) === ultimos10(destino));
    if (!autorizado) return { ok: false, error: `${destino} no es un destino de prueba autorizado. Pruebas solo al jefe o a JELCOM_DESTINOS_PRUEBA.` };
    const r = await llamar("POST", `/envios/${a.envio_id}/prueba`, { destino });
    if (!r.ok) return { ok: false, error: `La prueba falló: ${r.error}`, datos: { fallo_prueba: true } };
    return { ok: true, datos: r.datos, resumen: `🧪 Prueba enviada a ${canal === "correo" ? destino : "tu " + (canal === "voz" ? "celular (te va a llamar)" : canal === "whatsapp" ? "WhatsApp" : "celular")}.` };
  },
};

export const jelcomDispararEnvio: DefTool = {
  nombre: "jelcom_disparar_envio", modulo: MODULO,
  descripcion: "DISPARA el envío: empieza a mandar mensajes reales a toda la base. Irreversible. Requiere aprobación del jefe.",
  parametros: { type: "object", properties: { envio_id: ID }, required: ["envio_id"] },
  riesgo: "ejecucion", requiereAprobacion: true, timeoutSeg: 120,
  async ejecutar(a) {
    const r = await llamar("POST", `/envios/${a.envio_id}/enviar`, undefined, { idempotente: true, timeoutSeg: 90 });   // el motor ignora un 2º disparo mientras corre
    return r.ok ? { ok: true, datos: r.datos, resumen: `Envío #${a.envio_id} disparado.` } : r;
  },
};

export const jelcomReanudarEnvio: DefTool = {
  nombre: "jelcom_reanudar_envio", modulo: MODULO,
  descripcion: "Reanuda un envío pausado con sus contactos pendientes (si fue dividido, reanuda todas las partes pausadas). Requiere aprobación.",
  parametros: { type: "object", properties: { envio_id: ID }, required: ["envio_id"] },
  riesgo: "ejecucion", requiereAprobacion: true, timeoutSeg: 180,
  async ejecutar(a) {
    const fr = await familia(a.envio_id);
    if (!fr.ok) return { ok: false, error: fr.error };
    const f = fr.f!;
    const objetivos = [f.raiz, ...f.partes].filter((e) => e.estado === "pausada" || (e.estado === "error" && !f.dividido));
    if (!objetivos.length) return { ok: false, error: `El envío #${f.raiz.id} no tiene partes pausadas (está ${estadoLegible(f.estado)}).` };
    const res = [];
    for (const e of objetivos) res.push({ id: e.id, r: await llamar("POST", `/envios/${e.id}/enviar`, undefined, { idempotente: true }) });
    const fallos = res.filter((x) => !x.r.ok);
    return fallos.length ? { ok: false, error: `No pude reanudar ${fallos.map((x) => `#${x.id} (${x.r.error})`).join(", ")}` } : { ok: true, resumen: `Reanudado: #${objetivos.map((e) => e.id).join(", #")}.` };
  },
};

export const jelcomPausarEnvio: DefTool = {
  nombre: "jelcom_pausar_envio", modulo: MODULO,
  descripcion: "Pausa un envío en curso (si fue dividido, pausa todas las partes que estén enviando). Se reanuda después.",
  parametros: { type: "object", properties: { envio_id: ID }, required: ["envio_id"] },
  riesgo: "escritura", requiereAprobacion: false, timeoutSeg: 120,
  async ejecutar(a) {
    const fr = await familia(a.envio_id);
    if (!fr.ok) return { ok: false, error: fr.error };
    const f = fr.f!;
    const corriendo = [f.raiz, ...f.partes].filter((e) => e.estado === "en_curso");
    if (!corriendo.length) return { ok: true, datos: { pausados: [] }, resumen: `El envío #${f.raiz.id} no estaba enviando (está ${estadoLegible(f.estado)}).` };
    for (const e of corriendo) await llamar("POST", `/envios/${e.id}/pausar`, undefined, { idempotente: true });
    return { ok: true, datos: { pausados: corriendo.map((e) => e.id) }, resumen: `Pausado: #${corriendo.map((e) => e.id).join(", #")}.` };
  },
};

export const jelcomDividirEnvio: DefTool = {
  nombre: "jelcom_dividir_envio", modulo: MODULO,
  descripcion: "Divide los contactos pendientes en N partes que salen en paralelo (más rápido). No aplica a correo (el proveedor bloquearía el dominio). Sirve antes de disparar o con el envío corriendo. Sigue siendo UN envío: el estado, el costo y el informe consolidado suman todo. Requiere aprobación.",
  parametros: { type: "object", properties: { envio_id: ID, cantidad: { type: "integer", minimum: 2, maximum: 10, default: 2 } }, required: ["envio_id"] },
  riesgo: "ejecucion", requiereAprobacion: true, timeoutSeg: 150,
  async ejecutar(a) {
    const antes = await familia(a.envio_id);
    const r = await llamar("POST", `/envios/${a.envio_id}/dividir`, { cantidad: a.cantidad || 2 }, { timeoutSeg: 120 });
    if (!r.ok && esTransitorio(r) && antes.ok) {
      const despues = await familia(a.envio_id);   // ¿alcanzó a dividir?
      if (despues.ok && despues.f!.partes.length > antes.f!.partes.length) return { ok: true, datos: { ids: despues.f!.partes.map((p) => p.id) }, resumen: `Envío #${a.envio_id} dividido en ${despues.f!.partes.length} partes.` };
      return { ok: false, error: `${r.error}. Revisé y no quedó dividido.` };
    }
    if (!r.ok) return r;
    const ids = (r.datos as any)?.ids || [];
    return { ok: true, datos: { ids }, resumen: `Envío #${a.envio_id} dividido en ${ids.length} partes que ya están saliendo (#${ids.join(", #")}).` };
  },
};

export const jelcomEliminarEnvio: DefTool = {
  nombre: "jelcom_eliminar_envio", modulo: MODULO,
  descripcion: "Elimina un envío que nunca salió (borrador o lista). Jelcom no deja borrar envíos que ya mandaron mensajes. Requiere aprobación.",
  parametros: { type: "object", properties: { envio_id: ID }, required: ["envio_id"] },
  riesgo: "escritura", requiereAprobacion: true, timeoutSeg: 60,
  async ejecutar(a) {
    const r = await llamar("DELETE", `/envios/${a.envio_id}`, undefined, { idempotente: true });
    return r.ok ? { ok: true, resumen: `Envío #${a.envio_id} eliminado.` } : { ok: false, error: `Jelcom no lo eliminó: ${r.error}` };
  },
};

// ─── Informes ────────────────────────────────────────────────────────────────
export const jelcomDescargarInforme: DefTool = {
  nombre: "jelcom_descargar_informe", modulo: MODULO,
  descripcion: "Descarga el informe Excel de un envío. Si el envío fue dividido, SIEMPRE descarga el consolidado (UN solo Excel con todas las partes). Devuelve archivo_id.",
  parametros: { type: "object", properties: { envio_id: ID }, required: ["envio_id"] },
  riesgo: "lectura", requiereAprobacion: false, timeoutSeg: 150,
  async ejecutar(a, ctx) {
    const fr = await familia(a.envio_id);
    const raiz = fr.ok ? fr.f!.raiz.id : a.envio_id;
    const dividido = fr.ok ? fr.f!.dividido : false;
    const r = await llamar("GET", `/envios/${raiz}/${dividido ? "informe-consolidado" : "informe"}`, undefined, { binario: true, timeoutSeg: 120 });
    if (!r.ok) return r;
    const d = r.datos as any;
    const arch = await guardarArchivo({ nombre: d.nombre, mime: d.mime || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", contenido: d.buffer, origen: "generado", conversacionId: ctx.conversacionId ?? null, agenteId: ctx.agenteId });
    return { ok: true, datos: { archivo_id: arch.id, nombre: arch.nombre, consolidado: dividido, envio_id: raiz }, resumen: `Informe ${dividido ? "consolidado " : ""}"${arch.nombre}" listo (archivo_id ${arch.id}).` };
  },
};

export const jelcomInformeCampana: DefTool = {
  nombre: "jelcom_informe_campana", modulo: MODULO,
  descripcion: "Informe Excel consolidado de TODA una campaña (cliente) en un rango de fechas: 'el informe de octubre de Cajasan'. Devuelve archivo_id.",
  parametros: { type: "object", properties: { campana_id: { type: "integer", minimum: 1 }, desde: { type: "string", description: "AAAA-MM-DD" }, hasta: { type: "string", description: "AAAA-MM-DD" } }, required: ["campana_id"] },
  riesgo: "lectura", requiereAprobacion: false, timeoutSeg: 180,
  async ejecutar(a, ctx) {
    const q = new URLSearchParams(); if (a.desde) q.set("desde", a.desde); if (a.hasta) q.set("hasta", a.hasta);
    const r = await llamar("GET", `/campanas/${a.campana_id}/consolidado${q.toString() ? "?" + q : ""}`, undefined, { binario: true, timeoutSeg: 160 });
    if (!r.ok) return r;
    const d = r.datos as any;
    const arch = await guardarArchivo({ nombre: d.nombre, mime: d.mime, contenido: d.buffer, origen: "generado", conversacionId: ctx.conversacionId ?? null, agenteId: ctx.agenteId });
    return { ok: true, datos: { archivo_id: arch.id, nombre: arch.nombre }, resumen: `Informe de la campaña #${a.campana_id}${a.desde || a.hasta ? ` (${a.desde || "inicio"} a ${a.hasta || "hoy"})` : ""} listo (archivo_id ${arch.id}).` };
  },
};

// ─── Perfiles de cliente (memoria de Echo) ───────────────────────────────────
export async function leerPerfil(campanaId: number, canal: string): Promise<any | null> {
  const [p] = await query<any>(`SELECT * FROM jelcom_perfiles WHERE campana_id=$1 AND canal=$2`, [campanaId, canal]).catch(() => [] as any[]);
  return p || null;
}
export async function guardarPerfil(campanaId: number, canal: string, campana: string, datos: Record<string, unknown>) {
  const limpio = Object.fromEntries(Object.entries(datos).filter(([, v]) => v !== undefined && v !== null && v !== ""));
  await query(`INSERT INTO jelcom_perfiles (campana_id, canal, campana, datos) VALUES ($1,$2,$3,$4)
               ON CONFLICT (campana_id, canal) DO UPDATE SET datos = jelcom_perfiles.datos || EXCLUDED.datos, campana = EXCLUDED.campana, usos = jelcom_perfiles.usos + 1, actualizado = now()`,
    [campanaId, canal, campana || "", JSON.stringify(limpio)]);
}

export const jelcomPerfilCliente: DefTool = {
  nombre: "jelcom_perfil_cliente", modulo: MODULO,
  descripcion: "Lo que Echo recuerda de cada cliente (campaña) por canal: cuenta, plantilla, idioma, imagen, asunto, voz… usado la última vez. 'ver' (una campaña o todas) u 'olvidar'. Se guarda solo al terminar un envío.",
  parametros: { type: "object", properties: { accion: { type: "string", enum: ["ver", "olvidar"], default: "ver" }, campana_id: { type: "integer" }, canal: { type: "string", enum: [...CANALES] } }, required: [] },
  riesgo: "lectura", requiereAprobacion: false, timeoutSeg: 30,
  async ejecutar(a) {
    if (a.accion === "olvidar") {
      if (!a.campana_id) return { ok: false, error: "Dime qué campaña olvidar." };
      await query(`DELETE FROM jelcom_perfiles WHERE campana_id=$1 ${a.canal ? "AND canal=$2" : ""}`, a.canal ? [a.campana_id, a.canal] : [a.campana_id]);
      return { ok: true, resumen: `Olvidé lo guardado de la campaña #${a.campana_id}${a.canal ? ` (${a.canal})` : ""}.` };
    }
    const filas = await query<any>(`SELECT * FROM jelcom_perfiles ${a.campana_id ? "WHERE campana_id=$1" : ""} ORDER BY actualizado DESC LIMIT 30`, a.campana_id ? [a.campana_id] : []);
    return { ok: true, datos: filas, resumen: filas.length ? filas.map((p) => `#${p.campana_id} ${p.campana} [${p.canal}] · ${Object.entries(p.datos).map(([k, v]) => `${k}=${String(v).slice(0, 40)}`).join(", ")} · ${p.usos} uso(s)`).join("\n") : "Todavía no tengo perfiles guardados." };
  },
};

export const toolsJelcom: DefTool[] = [
  jelcomEstadoSistema, jelcomListarCampanas, jelcomCrearCampana, jelcomCampanaCuentaWhatsapp,
  jelcomListarCuentasSms, jelcomListarCuentasWhatsapp, jelcomListarPlantillas, jelcomCrearPlantilla, jelcomListarVoces,
  jelcomValidarBase, jelcomListarEnvios, jelcomVerEnvio, jelcomEstadoEnvio, jelcomAnalizarSms, jelcomCostoEnvio, jelcomTarifas,
  jelcomCrearEnvio, jelcomSubirBase, jelcomEnviarPrueba, jelcomDispararEnvio, jelcomReanudarEnvio, jelcomPausarEnvio, jelcomDividirEnvio, jelcomEliminarEnvio,
  jelcomDescargarInforme, jelcomInformeCampana, jelcomPerfilCliente,
];

/** Para skills: llamada directa a la API (mismas reglas de despertar/reintentos). */
export { llamar as llamarJelcom, despertar as despertarJelcom };
