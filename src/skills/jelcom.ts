// ARCHIVO: src/skills/jelcom.ts
// ─────────────────────────────────────────────────────────────────────────────
//  SKILLS DE JELCOM ENVÍOS (todas en código: deterministas, mismo resultado
//  siempre, nada de improvisar el formato).
//  - preparar_envio:      valida TODO antes de crear (cuenta, plantilla en Meta,
//                         imagen, idioma, voz, base real, segmentos, costo) y
//                         devuelve la ficha lista o exactamente lo que falta.
//  - monitorear_envio:    una observación (sumando partes si está dividido).
//  - diagnosticar_errores: clasifica, pausa si es grave, avisa con propuesta.
//  - reportar_envio:      UN informe (consolidado si fue dividido) + resumen
//                         con costo, y guarda el perfil del cliente.
// ─────────────────────────────────────────────────────────────────────────────

import type { DefSkill } from "../registro/tipos.js";
import { llamarJelcom, validarBase, familia, leerPerfil, guardarPerfil, num, plata, pct, estadoLegible } from "../tools/jelcom.js";

const MODULO = "jelcom";
const ID = { type: "integer" as const, description: "Id del envío en Jelcom.", minimum: 1 };
const CANAL_TXT: Record<string, string> = { sms: "SMS", whatsapp: "WhatsApp", correo: "Correo", voz: "Bot de voz" };
const plural = (n: number, uno: string, varios = `${uno}s`) => `${num(n)} ${Number(n) === 1 ? uno : varios}`;

// ─── SMS: segmentos (copia de depurar.analizarSMS de Jelcom) ─────────────────
const GSM = new Set("@£$¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà\n\r".split(""));
const GSM_EXT = new Set("^{}\\[~]|€".split(""));
export function segmentosSms(texto: string) {
  const chars = [...texto];
  const esGSM = chars.every((c) => GSM.has(c) || GSM_EXT.has(c));
  const largo = esGSM ? chars.length + chars.filter((c) => GSM_EXT.has(c)).length : chars.length;
  const segmentos = esGSM ? (largo <= 160 ? 1 : Math.ceil(largo / 153)) : (chars.length <= 70 ? 1 : Math.ceil(chars.length / 67));
  return { codificacion: esGSM ? "GSM-7" : "UCS-2", caracteres: chars.length, segmentos };
}
/** Versión GSM del texto: quita tildes que GSM no tiene (é, ñ, ü sí están) y emojis. */
export function versionGsm(texto: string) {
  const mapa: Record<string, string> = { á: "a", í: "i", ó: "o", ú: "u", Á: "A", Í: "I", Ó: "O", Ú: "U", É: "E", â: "a", ê: "e", ô: "o", "“": '"', "”": '"', "‘": "'", "’": "'", "–": "-", "—": "-", "…": "..." };
  return [...texto].map((c) => mapa[c] ?? c).filter((c) => GSM.has(c) || GSM_EXT.has(c) || /\s/.test(c)).join("").replace(/ {2,}/g, " ").trim();
}

// ─── Programación (hora de Colombia) ─────────────────────────────────────────
export function segundosHasta(cuando?: string): number {
  if (!cuando) return 0;
  const s = String(cuando).trim().replace(" ", "T");
  const t = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s.length <= 16 ? s + ":00" : s}-05:00`);
  return Number.isFinite(t) ? Math.max(0, Math.round((t - Date.now()) / 1000)) : -1;
}
export const horaLegible = (segDesdeAhora: number) => new Date(Date.now() + segDesdeAhora * 1000).toLocaleString("es-CO", { timeZone: "America/Bogota", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

async function imagenAccesible(url: string): Promise<string | null> {
  if (!/^https:\/\//i.test(url)) return "la imagen debe ser un enlace https público";
  try {
    let r = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(10_000) });
    if (!r.ok || !r.headers.get("content-type")) r = await fetch(url, { method: "GET", headers: { Range: "bytes=0-1024" }, signal: AbortSignal.timeout(10_000) });
    if (!r.ok && r.status !== 206) return `la imagen no abre (HTTP ${r.status})`;
    const tipo = r.headers.get("content-type") || "";
    if (!/^image\/(jpeg|jpg|png)/i.test(tipo)) return `el enlace no es una imagen JPG/PNG (es ${tipo || "desconocido"}); Meta solo acepta JPG o PNG`;
    const tam = Number(r.headers.get("content-length") || 0);
    if (r.status === 200 && tam > 5 * 1024 * 1024) return `la imagen pesa ${(tam / 1048576).toFixed(1)} MB; Meta acepta hasta 5 MB`;
    return null;
  } catch (e: any) { return `no pude abrir la imagen (${e?.message || e})`; }
}

// ─── 1. Preparar envío ───────────────────────────────────────────────────────
type Faltante = { campo: string; pregunta: string; opciones?: string[] };

export const jelcomPrepararEnvio: DefSkill = {
  nombre: "jelcom_preparar_envio",
  modulo: MODULO,
  descripcion: "Revisa un pedido de envío COMPLETO antes de crear nada: campaña, cuenta, contenido según el canal (SMS: segmentos y versión más barata; WhatsApp: plantilla aprobada en Meta, idioma, imagen de cabecera; correo: asunto, imagen, enlace; voz: voz o audio), la base con las reglas reales de Jelcom y el costo estimado. Completa lo que falte con el perfil del cliente. Devuelve la ficha lista, o la lista exacta de lo que falta con opciones.",
  cuandoUsar: "Siempre antes de crear un envío (el flujo jelcom_envio_completo la usa). También para responder '¿qué me falta para mandar esto?'.",
  parametros: {
    type: "object",
    properties: {
      canal: { type: "string", enum: ["sms", "whatsapp", "correo", "voz"] },
      archivo_id: { type: "string" }, campana_id: { type: "integer" }, campana: { type: "string", description: "Nombre del cliente si no se sabe el id." },
      cuenta_id: { type: "integer" }, texto: { type: "string" }, plantilla: { type: "string" }, idioma: { type: "string" }, imagen_url: { type: "string" },
      asunto: { type: "string" }, enlace: { type: "string" }, modo_audio: { type: "string", enum: ["texto", "pregrabado"] }, texto_voz: { type: "string" },
      voz_id: { type: "string" }, audio_url: { type: "string" }, tecla_captura: { type: "string" }, nombre: { type: "string" },
      usar_perfil: { type: "boolean", default: true },
      dividir_en: { type: "integer", description: "Si piden dividirlo (para avisar si el canal no lo permite)." },
    },
    required: ["canal"],
  },
  riesgo: "lectura",
  requiereAprobacion: false,
  tools: [],
  async ejecutar(a) {
    const faltantes: Faltante[] = []; const problemas: string[] = []; const avisos: string[] = []; const sugerencias: string[] = []; const delPerfil: string[] = [];
    const canal = a.canal as string;
    const p: Record<string, any> = { ...a };

    // Campaña
    const camps = await llamarJelcom("GET", "/campanas");
    if (!camps.ok) return { ok: false, error: camps.error };
    const lista = camps.datos as any[];
    let campana = p.campana_id ? lista.find((c) => c.id === p.campana_id) : undefined;
    if (!campana && p.campana) {
      const q = String(p.campana).toLowerCase();
      const coinciden = lista.filter((c) => String(c.nombre).toLowerCase().includes(q));
      if (coinciden.length === 1) campana = coinciden[0];
      else faltantes.push({ campo: "campana_id", pregunta: coinciden.length ? `Hay varias campañas que coinciden con "${p.campana}", ¿cuál?` : `No existe la campaña "${p.campana}". ¿La creo o es otra?`, opciones: (coinciden.length ? coinciden : lista.slice(0, 10)).map((c) => `#${c.id} ${c.nombre}`) });
    }
    if (!campana && !p.campana) faltantes.push({ campo: "campana_id", pregunta: "¿Para qué cliente (campaña) es?", opciones: lista.slice(0, 12).map((c) => `#${c.id} ${c.nombre}`) });
    if (p.campana_id && !campana) problemas.push(`La campaña #${p.campana_id} no existe.`);

    // Perfil del cliente: completa lo que no vino (y queda anotado para mostrarlo)
    if (campana && a.usar_perfil !== false) {
      const perfil = await leerPerfil(campana.id, canal);
      for (const [k, v] of Object.entries(perfil?.datos || {})) if (p[k] == null || p[k] === "") { p[k] = v; delPerfil.push(k); }
    }

    const ficha: Record<string, any> = { canal, campana_id: campana?.id, campana: campana?.nombre };
    const envio: Record<string, any> = { campana_id: campana?.id, canal };
    let unidadesPorContacto = 1;

    // ── Contenido según canal ──
    if (canal === "sms") {
      const cs = await llamarJelcom("GET", "/cuentas-sms");
      const cuentas = cs.ok ? (cs.datos as any[]) : [];
      let cuenta = p.cuenta_id ? cuentas.find((c) => c.id === p.cuenta_id) : cuentas.length === 1 ? cuentas[0] : undefined;
      if (!cuenta) faltantes.push({ campo: "cuenta_id", pregunta: p.cuenta_id ? `La cuenta SMS #${p.cuenta_id} no existe. ¿Cuál uso?` : "¿Con qué cuenta SMS lo mando?", opciones: cuentas.map((c) => `#${c.id} ${c.nombre} (${c.proveedor})`) });
      if (!p.texto) faltantes.push({ campo: "texto", pregunta: "¿Qué texto lleva el SMS?" });
      if (cuenta) { ficha.cuenta = `${cuenta.nombre} (${cuenta.proveedor}${cuenta.remitente ? `, remitente ${cuenta.remitente}` : ""})`; envio.cuenta_sms_id = cuenta.id; ficha.proveedor = cuenta.proveedor; }
      if (p.texto) {
        const s = segmentosSms(p.texto); ficha.texto = p.texto; ficha.segmentos = s.segmentos; ficha.codificacion = s.codificacion; envio.cuerpo = p.texto; unidadesPorContacto = s.segmentos;
        if (s.codificacion === "UCS-2") {
          const alt = versionGsm(p.texto); const sa = segmentosSms(alt);
          if (sa.codificacion === "GSM-7" && sa.segmentos < s.segmentos) sugerencias.push(`Las tildes/emojis lo vuelven ${s.segmentos} segmentos. Sin ellas queda en ${sa.segmentos} (más barato): "${alt}"`);
          else avisos.push(`Usa caracteres especiales (UCS-2): máximo 70 caracteres por segmento.`);
        }
        if (s.segmentos >= 3) avisos.push(`El SMS ocupa ${s.segmentos} segmentos: se cobra ${s.segmentos} veces por contacto.`);
        if (/https?:\/\//i.test(p.texto)) avisos.push("Lleva un enlace: algunos operadores filtran SMS con links acortados.");
      }
    } else if (canal === "whatsapp") {
      const cw = await llamarJelcom("GET", "/cuentas");
      const cuentas = cw.ok ? (cw.datos as any[]) : [];
      const id = p.cuenta_id || campana?.cuenta_wa_id;
      if (!p.cuenta_id && campana?.cuenta_wa_id) delPerfil.push("cuenta (la de la campaña)");
      const cuenta = id ? cuentas.find((c) => c.id === id) : cuentas.length === 1 ? cuentas[0] : undefined;
      if (!cuenta) faltantes.push({ campo: "cuenta_id", pregunta: "¿Con qué cuenta de WhatsApp lo mando?", opciones: cuentas.map((c) => `#${c.id} ${c.nombre}${c.telefono ? ` (${c.telefono})` : ""}`) });
      else { ficha.cuenta = `${cuenta.nombre}${cuenta.telefono ? ` (${cuenta.telefono})` : ""}`; envio.cuenta_wa_id = cuenta.id; }
      let plantillas: any[] | null = null;
      if (cuenta) { const pl = await llamarJelcom("GET", `/whatsapp/plantillas-meta?cuenta_wa_id=${cuenta.id}`); if (pl.ok) plantillas = pl.datos as any[]; else avisos.push(`No pude revisar las plantillas en Meta (${pl.error}); confirma que el nombre, idioma e imagen estén bien.`); }
      const aprobadas = (plantillas || []).filter((t) => t.estado === "APPROVED");
      if (!p.plantilla) faltantes.push({ campo: "plantilla", pregunta: "¿Qué plantilla uso?", opciones: aprobadas.slice(0, 15).map((t) => `${t.nombre} [${t.idioma}]${t.cabecera === "image" ? " · con imagen" : ""}`) });
      else {
        ficha.plantilla = p.plantilla; envio.plantilla = p.plantilla;
        if (plantillas) {
          const delNombre = plantillas.filter((t) => t.nombre === p.plantilla);
          if (!delNombre.length) {
            const parecidas = aprobadas.filter((t) => t.nombre.includes(String(p.plantilla).toLowerCase().slice(0, 5)));
            faltantes.push({ campo: "plantilla", pregunta: `La plantilla "${p.plantilla}" no existe en esa cuenta. ¿Cuál es?`, opciones: (parecidas.length ? parecidas : aprobadas).slice(0, 12).map((t) => `${t.nombre} [${t.idioma}]`) });
          } else {
            const idiomaPedido = p.idioma;
            const t = (idiomaPedido && delNombre.find((x) => x.idioma === idiomaPedido)) || (delNombre.length === 1 ? delNombre[0] : delNombre.find((x) => x.estado === "APPROVED"));
            if (idiomaPedido && !delNombre.some((x) => x.idioma === idiomaPedido)) problemas.push(`La plantilla "${p.plantilla}" no existe en idioma "${idiomaPedido}"; existe en: ${delNombre.map((x) => x.idioma).join(", ")}.`);
            if (t) {
              envio.idioma = t.idioma; ficha.idioma = t.idioma; ficha.categoria = t.categoria; ficha.texto_plantilla = t.cuerpo;
              if (t.estado !== "APPROVED") problemas.push(`La plantilla "${t.nombre}" está ${t.estado}${t.motivo ? ` (${t.motivo})` : ""}: Meta no deja enviarla hasta que esté APPROVED.`);
              if (t.variables_cuerpo > 0) problemas.push(`La plantilla "${t.nombre}" tiene ${t.variables_cuerpo} variable(s) {{n}} y Jelcom las manda sin parámetros: Meta rechazaría cada mensaje. Usa una plantilla sin variables.`);
              if (t.cabecera === "image" && !p.imagen_url) faltantes.push({ campo: "imagen_url", pregunta: `La plantilla "${t.nombre}" lleva imagen de cabecera: mándame la imagen (enlace https JPG/PNG).` });
              if (["video", "document"].includes(t.cabecera)) problemas.push(`La plantilla "${t.nombre}" pide ${t.cabecera} de cabecera y Jelcom solo envía imagen.`);
              if (t.cabecera !== "image" && p.imagen_url) problemas.push(`La plantilla "${t.nombre}" NO tiene cabecera de imagen: si mando la imagen, Meta rechaza el mensaje. La quito o usamos otra plantilla.`);
            }
          }
        } else { envio.idioma = p.idioma || "es"; ficha.idioma = envio.idioma; }
      }
      if (p.imagen_url && !problemas.some((x) => x.includes("NO tiene cabecera"))) {
        const e = await imagenAccesible(p.imagen_url);
        if (e) problemas.push(`Imagen: ${e}.`); else { envio.imagen_url = p.imagen_url; ficha.imagen_url = p.imagen_url; }
      }
    } else if (canal === "correo") {
      if (!p.asunto) faltantes.push({ campo: "asunto", pregunta: "¿Qué asunto lleva el correo?" });
      if (!p.texto) faltantes.push({ campo: "texto", pregunta: "¿Qué texto lleva el correo? (los párrafos se separan con una línea en blanco)" });
      if (p.asunto) { envio.asunto = p.asunto; ficha.asunto = p.asunto; if (p.asunto.length > 80) avisos.push("El asunto es largo (>80): en el celular se corta."); }
      if (p.texto) { envio.cuerpo = p.texto; ficha.texto = p.texto; }
      if (p.imagen_url) { const e = await imagenAccesible(p.imagen_url); if (e) problemas.push(`Imagen: ${e}.`); else { envio.imagen_url = p.imagen_url; ficha.imagen_url = p.imagen_url; } }
      if (p.enlace) { if (!/^https?:\/\/\S+\.\S+/.test(p.enlace)) problemas.push(`El enlace "${p.enlace}" no es una URL válida.`); else { envio.enlace = p.enlace; ficha.enlace = p.enlace; if (!p.imagen_url) avisos.push("El enlace solo es clicable sobre la imagen: sin imagen, el correo no lo muestra."); } }
      const con = await llamarJelcom("GET", "/conexiones");
      const brevo = con.ok ? (con.datos as any[]).find((c) => c.proveedor === "brevo") : null;
      if (brevo?.estado === "error") problemas.push(`Brevo (correo) está con error: ${brevo.detalle || "revisa la API key"}.`);
    } else if (canal === "voz") {
      const modo = p.modo_audio || (p.audio_url ? "pregrabado" : "texto");
      envio.modo_audio = modo; ficha.modo_audio = modo;
      if (modo === "pregrabado") {
        if (!p.audio_url) faltantes.push({ campo: "audio_url", pregunta: "Mándame el enlace del audio pregrabado (mp3 público)." });
        else { envio.audio_url = p.audio_url; ficha.audio_url = p.audio_url; }
      } else {
        const texto = p.texto_voz || p.texto;
        if (!texto) faltantes.push({ campo: "texto_voz", pregunta: "¿Qué dice la llamada? (lo convierto en voz)" });
        else { envio.texto_voz = texto; ficha.texto_voz = texto; if (texto.length > 600) avisos.push("El mensaje de voz es largo (>600 caracteres ≈ más de 40 s): la gente cuelga."); }
        const vs = await llamarJelcom("GET", "/voces");
        const voces = vs.ok ? (vs.datos as any[]) : [];
        const voz = p.voz_id ? voces.find((v) => v.voice_id === p.voz_id || String(v.id) === String(p.voz_id) || String(v.nombre).toLowerCase() === String(p.voz_id).toLowerCase()) : voces.length === 1 ? voces[0] : undefined;
        if (voz) { envio.voz_id = voz.voice_id; ficha.voz = voz.nombre; }
        else if (voces.length) faltantes.push({ campo: "voz_id", pregunta: "¿Con qué voz?", opciones: voces.map((v) => `${v.nombre}${v.descripcion ? ` — ${v.descripcion}` : ""}`) });
        else if (!vs.ok) avisos.push(`No pude ver las voces guardadas (${vs.error}); se usará la voz por defecto de Jelcom.`);
      }
      if (p.tecla_captura) { envio.tecla_captura = p.tecla_captura; ficha.tecla_captura = p.tecla_captura; }
      const con = await llamarJelcom("GET", "/conexiones");
      for (const prov of ["twilio", ...(modo === "texto" ? ["elevenlabs"] : [])]) {
        const c = con.ok ? (con.datos as any[]).find((x) => x.proveedor === prov) : null;
        if (c?.estado === "error") problemas.push(`${prov} está con error: ${c.detalle || "revisa credenciales"}.`);
      }
      avisos.push("Las llamadas salen de Twilio y su resultado (contestó, tecla, duración) llega después de colgar.");
    }

    // ── Base ──
    let base: any = null;
    if (!p.archivo_id) faltantes.push({ campo: "archivo_id", pregunta: `Mándame la base (${canal === "correo" ? "columna de correos" : "columna de celulares"}) como archivo Excel o CSV.` });
    else {
      const vb = await validarBase(p.archivo_id, canal === "voz" ? "sms" : canal);
      if (!vb.ok) problemas.push(vb.error || "No pude leer la base.");
      else { base = vb.datos; ficha.base = { archivo: base.archivo, total: base.total_base, validos: base.validos, duplicados: base.duplicados, invalidos: base.invalidos, lista_negra: base.lista_negra || 0, columna: base.columna }; if (!base.validos) problemas.push(...(base.problemas || ["La base no tiene contactos válidos."])); else if (base.problemas?.length) avisos.push(...base.problemas); }
    }

    // ── Costo estimado ──
    const tar = await llamarJelcom("GET", "/tarifas");
    const t = tar.ok ? (tar.datos as any).tarifas || {} : {};
    const moneda = t.moneda || "COP";
    const clave = canal === "sms" ? [`tarifa_sms_${ficha.proveedor || "hablame"}`, "tarifa_sms"] : canal === "whatsapp" ? [`tarifa_whatsapp_${ficha.categoria || "marketing"}`, "tarifa_whatsapp"] : canal === "correo" ? ["tarifa_correo"] : ["tarifa_voz_minuto"];
    const tarifa = clave.map((k) => t[k]).find((v) => v != null);
    if (base?.validos) {
      const unidades = base.validos * unidadesPorContacto;
      ficha.costo = { unidades, tarifa: tarifa ?? null, estimado: tarifa != null ? Math.round(unidades * tarifa) : null, moneda, falta: tarifa == null ? clave[0] : null, unidad: canal === "sms" ? "segmento" : canal === "voz" ? "minuto (si todos contestan)" : canal === "correo" ? "correo" : "mensaje" };
      if (base.validos >= 3000 && canal !== "correo") sugerencias.push(`Son ${num(base.validos)} contactos: puedo dividirlo en ${Math.min(10, Math.ceil(base.validos / 2500))} partes para que salga más rápido (sigue siendo un solo envío y un solo informe).`);
    }

    const ahoraCo = new Date(Date.now() - 5 * 3600_000).toISOString().slice(0, 16).replace("T", " ");   // hora Colombia, AAAA-MM-DD HH:mm
    envio.nombre = p.nombre || `${campana?.nombre || "Envío"} ${CANAL_TXT[canal]} ${ahoraCo}`;
    ficha.nombre = envio.nombre;
    if (canal === "correo" && Number(a.dividir_en) > 1) problemas.push("Los correos no se dividen: en paralelo el proveedor bloquea el dominio. Sale normal, a 1 por segundo.");
    const listo = !faltantes.length && !problemas.length;
    const perfil = campana ? { campana_id: campana.id, canal, campana: campana.nombre, datos: { cuenta_id: envio.cuenta_sms_id || envio.cuenta_wa_id, plantilla: envio.plantilla, idioma: envio.idioma, imagen_url: envio.imagen_url, asunto: envio.asunto, enlace: envio.enlace, voz_id: envio.voz_id, modo_audio: envio.modo_audio } } : null;
    const datos = { listo, ficha, envio, archivo_id: p.archivo_id, faltantes, problemas, avisos, sugerencias, del_perfil: delPerfil, perfil };
    return { ok: true, datos, resumen: listo ? textoFicha(datos) : textoFaltantes(datos) };
  },
};

/** La ficha que ve el jefe antes de aprobar. Siempre el mismo orden y formato. */
export function textoFicha(d: any, extra: { prueba?: any; costoReal?: any; programado?: number; dividir_en?: number } = {}): string {
  const f = d.ficha; const L: string[] = [];
  L.push(`📋 *${f.nombre}*`);
  L.push(`👤 Cliente: ${f.campana} (#${f.campana_id})`);
  L.push(`📡 Canal: ${CANAL_TXT[f.canal]}${f.cuenta ? ` · ${f.cuenta}` : ""}`);
  if (f.canal === "sms") L.push(`💬 Texto (${plural(f.segmentos, "segmento")}, ${f.texto.length} caracteres):\n"${f.texto}"`);
  if (f.canal === "whatsapp") { L.push(`🧩 Plantilla: ${f.plantilla} [${f.idioma}]${f.categoria ? ` · ${f.categoria}` : ""}`); if (f.texto_plantilla) L.push(`💬 "${String(f.texto_plantilla).slice(0, 300)}"`); if (f.imagen_url) L.push(`🖼 Imagen: ${f.imagen_url}`); }
  if (f.canal === "correo") { L.push(`✉ Asunto: ${f.asunto}`); L.push(`💬 "${String(f.texto).slice(0, 300)}${f.texto.length > 300 ? "…" : ""}"`); if (f.imagen_url) L.push(`🖼 Imagen: ${f.imagen_url}`); if (f.enlace) L.push(`🔗 Enlace: ${f.enlace}`); }
  if (f.canal === "voz") { L.push(f.modo_audio === "pregrabado" ? `🔊 Audio: ${f.audio_url}` : `🗣 Dice${f.voz ? ` (voz ${f.voz})` : ""}: "${String(f.texto_voz).slice(0, 300)}"`); if (f.tecla_captura) L.push(`🔢 Tecla: ${f.tecla_captura}`); }
  if (f.base) L.push(`📂 Base "${f.base.archivo}": ${plural(f.base.validos, "válido")} · ${plural(f.base.duplicados, "duplicado")} · ${plural(f.base.invalidos, "inválido")}${f.base.lista_negra ? ` · ${num(f.base.lista_negra)} en lista negra (no se les envía)` : ""}`);
  const c = extra.costoReal?.costo?.estimado != null ? { estimado: extra.costoReal.costo.estimado, moneda: extra.costoReal.moneda, unidades: extra.costoReal.unidades.estimadas, tarifa: extra.costoReal.tarifa, unidad: f.costo?.unidad } : f.costo;
  if (c) L.push(c.estimado != null ? `💰 Costo estimado: ${plata(c.estimado, c.moneda)} (${num(c.unidades)} ${c.unidad}${c.unidades === 1 ? "" : "s"} × ${plata(c.tarifa, c.moneda)})` : `💰 Costo: sin tarifa de ${f.canal} (dime cuánto te cobran por ${c.unidad} y lo calculo siempre)`);
  if (extra.prueba) L.push(extra.prueba.ok ? `🧪 Prueba: ya te llegó, revísala` : `🧪 Prueba: falló (${String(extra.prueba.error || "").slice(0, 120)})`);
  if (extra.programado && extra.programado > 60) L.push(`⏰ Sale: ${horaLegible(extra.programado)}`);
  if (extra.dividir_en && extra.dividir_en > 1) L.push(`⚡ Sale dividido en ${extra.dividir_en} partes en paralelo`);
  if (d.del_perfil?.length) L.push(`🧠 Tomé de la última vez con este cliente: ${d.del_perfil.join(", ")}`);
  for (const s of d.sugerencias || []) L.push(`💡 ${s}`);
  for (const a of d.avisos || []) L.push(`⚠ ${a}`);
  return L.join("\n");
}

export function textoFaltantes(d: any): string {
  const L: string[] = [];
  if (d.problemas.length) { L.push("⛔ *No lo puedo armar así:*"); d.problemas.forEach((p: string) => L.push(`• ${p}`)); }
  if (d.faltantes.length) {
    L.push(d.problemas.length ? "\n*Y me falta:*" : "*Para armar el envío me falta:*");
    d.faltantes.forEach((f: Faltante, i: number) => L.push(`${i + 1}. ${f.pregunta}${f.opciones?.length ? `\n   ${f.opciones.slice(0, 10).join("\n   ")}` : ""}`));
  }
  for (const s of d.sugerencias || []) L.push(`💡 ${s}`);
  return L.join("\n");
}

// ─── 2. Monitorear (una observación) ─────────────────────────────────────────
export const jelcomMonitorearEnvio: DefSkill = {
  nombre: "jelcom_monitorear_envio",
  modulo: MODULO,
  descripcion: "Observa un envío una vez (sumando todas sus partes si fue dividido): estado, avance, tasa de error y si hay alerta (errores sobre el umbral o un error grave de proveedor).",
  cuandoUsar: "Cuando el jefe pregunta 'cómo va el envío', o dentro del flujo de monitoreo.",
  parametros: { type: "object", properties: { envio_id: ID, umbral_error: { type: "number", default: 20, minimum: 1, maximum: 100 } }, required: ["envio_id"] },
  riesgo: "lectura",
  requiereAprobacion: false,
  tools: ["jelcom_estado_envio"],
  async ejecutar(a, ctx) {
    const r = await ctx.ejecutarTool("jelcom_estado_envio", { envio_id: a.envio_id });
    if (!r.ok) return { ok: false, error: r.error, datos: { alerta: false, motivo: "no_responde", terminado: false } };
    const d = r.datos as any;
    const umbral = Number(a.umbral_error) || 20;
    const muestra = d.procesados >= 20;
    const tipos = clasificar(d.errores_recientes || []);
    const grave = tipos.credenciales || tipos.saldo || tipos.plantilla;
    const alerta = d.estado === "error" || (muestra && d.tasa_error >= umbral) || (grave > 0 && d.errores > 0);
    const motivo = d.estado === "error" ? "envio_en_error" : grave ? (tipos.credenciales ? "credenciales" : tipos.saldo ? "saldo" : "plantilla") : muestra && d.tasa_error >= umbral ? "tasa_error" : null;
    return { ok: true, datos: { ...d, alerta, motivo, tipos_error: tipos }, resumen: `${r.resumen}${alerta ? `\n⚠ ALERTA: ${motivo}` : ""}` };
  },
};

// ─── 3. Diagnosticar y actuar ────────────────────────────────────────────────
export const jelcomDiagnosticarErrores: DefSkill = {
  nombre: "jelcom_diagnosticar_errores",
  modulo: MODULO,
  descripcion: "Analiza los errores de un envío (todas sus partes), los clasifica (credenciales, saldo, plantilla, base, red, proveedor), pausa si es grave y le explica al jefe qué pasa y qué propone. No reanuda por su cuenta.",
  cuandoUsar: "Cuando un envío tiene errores altos o el jefe pregunta 'qué pasó con el envío'.",
  parametros: { type: "object", properties: { envio_id: ID, numero_aviso: { type: "string" }, pausar_si_grave: { type: "boolean", default: true } }, required: ["envio_id"] },
  riesgo: "escritura",
  requiereAprobacion: false,
  tools: ["jelcom_estado_envio", "jelcom_pausar_envio", "whatsapp_enviar_texto"],
  async ejecutar(a, ctx) {
    const est = await ctx.ejecutarTool("jelcom_estado_envio", { envio_id: a.envio_id });
    if (!est.ok) return { ok: false, error: est.error };
    const d = est.datos as any;
    const tipos = clasificar(d.errores_recientes || []);
    const principal = causaPrincipal(d.errores_recientes || []);
    const grave = ["credenciales", "saldo", "plantilla"].includes(principal) || d.tasa_error >= 50;
    let accion = "ninguna";
    if (grave && a.pausar_si_grave !== false && d.estado === "en_curso") {
      const p = await ctx.ejecutarTool("jelcom_pausar_envio", { envio_id: a.envio_id });
      accion = p.ok ? "lo pausé" : `no pude pausarlo (${p.error})`;
    }
    const propuesta: Record<string, string> = {
      credenciales: "revisa la cuenta en Jelcom → Cuentas y dime \"reanuda el envío " + a.envio_id + "\"",
      saldo: "recarga saldo y dime \"reanuda el envío " + a.envio_id + "\"",
      plantilla: "revisa la plantilla en Meta; si quieres, armo el envío con otra",
      base: "puede seguir: los que fallen quedan marcados en el informe",
      red: "sigo vigilando; si persiste te aviso",
      proveedor: "¿lo pauso o sigue?",
      desconocido: "¿lo pauso o sigue?",
    };
    const ultimo = d.errores_recientes?.length ? `\nÚltimo error: ${sinIcono(d.errores_recientes.at(-1)).slice(0, 160)}` : "";
    const texto = `⚠ *Envío #${a.envio_id}*: ${num(d.errores)} errores de ${num(d.procesados)} (${String(d.tasa_error).replace(".", ",")}%)\nCausa: ${explicacion[principal]}.${accion !== "ninguna" ? `\nAcción: ${accion}.` : ""}\n👉 ${propuesta[principal]}${ultimo}`;
    if (a.numero_aviso && principal !== "red") await ctx.ejecutarTool("whatsapp_enviar_texto", { numero: a.numero_aviso, texto });
    await ctx.traza("skill", `diagnóstico #${a.envio_id}: ${principal} · ${accion}`);
    return { ok: true, datos: { tipo: principal, tipos, grave, accion, pausado: accion === "lo pausé", estado: d.estado, tasa_error: d.tasa_error }, resumen: texto };
  },
};

// ─── 4. Reportar ─────────────────────────────────────────────────────────────
export const jelcomReportarEnvio: DefSkill = {
  nombre: "jelcom_reportar_envio",
  modulo: MODULO,
  descripcion: "Cierra un envío: descarga UN informe Excel (el consolidado si fue dividido), lo manda por WhatsApp con el resumen final (enviados, errores, descartados, costo real, duración) y guarda el perfil del cliente para la próxima.",
  cuandoUsar: "Al terminar un envío, o cuando el jefe pide 'pásame el informe del envío N'.",
  parametros: {
    type: "object",
    properties: { envio_id: ID, numero: { type: "string", description: "WhatsApp del jefe." }, inicio_ms: { type: "number", description: "Cuándo se disparó (para la duración)." }, perfil: { type: "object", description: "Perfil del cliente a guardar (lo pasa el flujo)." } },
    required: ["envio_id", "numero"],
  },
  riesgo: "ejecucion",
  requiereAprobacion: false,
  tools: ["jelcom_ver_envio", "jelcom_costo_envio", "jelcom_descargar_informe", "whatsapp_enviar_documento"],
  async ejecutar(a, ctx) {
    const fr = await familia(a.envio_id);
    if (!fr.ok) return { ok: false, error: fr.error };
    const f = fr.f!; const e = f.raiz; const t = f.totales;
    if (!e.campana_nombre) { const cs = await llamarJelcom("GET", "/campanas"); e.campana_nombre = cs.ok ? (cs.datos as any[]).find((x) => x.id === e.campana_id)?.nombre : undefined; }
    const costo = await ctx.ejecutarTool("jelcom_costo_envio", { envio_id: e.id });
    const c = costo.ok ? (costo.datos as any) : null;
    const dur = a.inicio_ms ? Math.max(1, Math.round((Date.now() - Number(a.inicio_ms)) / 60000)) : null;
    const descartados = t.duplicados + t.invalidos;
    const tituloEstado = f.estado === "finalizada" ? "terminado" : estadoLegible(f.estado);
    const L = [
      `${f.estado === "finalizada" ? "✅" : "📊"} *Envío #${e.id} ${tituloEstado}* — ${e.campana_nombre || `campaña #${e.campana_id}`} · ${CANAL_TXT[e.canal] || e.canal}`,
      `📤 ${num(t.enviados)} ${e.canal === "voz" ? "llamadas hechas" : "enviados"} de ${num(t.validos)} (${String(pct(t.enviados, t.validos)).replace(".", ",")}%)`,
      `❌ ${plural(t.errores, "error", "errores")}${descartados ? ` · ${num(descartados)} descartados en la base (${plural(t.duplicados, "duplicado")}, ${plural(t.invalidos, "inválido")})` : ""}`,
    ];
    if (e.canal === "voz" && (t as any).por_estado) { const pe = (t as any).por_estado; L.push(`📞 Contestaron ${num(pe.contestada || 0)} · no contestaron ${num(pe.no_contestada || 0)}`); }
    if (t.errores > 0 && f.errores_recientes?.length) L.push(`🔎 Causa principal de los errores: ${explicacion[causaPrincipal(f.errores_recientes)]}`);
    if (c) L.push(c.costo.real != null ? `💰 Costo: ${plata(c.costo.real, c.moneda)} (${num(c.unidades.reales)} ${unidadEn(c.unidad, c.unidades.reales)})` : `💰 Costo: sin tarifa (dime cuánto te cobran por ${unidadEn(c.unidad, 1)} y lo calculo)`);
    if (dur) L.push(`⏱ Duró ${dur < 60 ? `${dur} min` : `${Math.floor(dur / 60)} h ${dur % 60} min`}`);
    if (f.dividido) L.push(`🧩 Salió en ${f.partes.length} partes; el informe las junta todas`);
    const resumen = L.join("\n");

    const inf = await ctx.ejecutarTool("jelcom_descargar_informe", { envio_id: e.id });
    let enviado = false; let error: string | undefined;
    if (inf.ok) {
      const env = await ctx.ejecutarTool("whatsapp_enviar_documento", { numero: a.numero, archivo_id: (inf.datos as any).archivo_id, caption: resumen });
      enviado = env.ok; if (!env.ok) error = `no pude mandarte el Excel: ${env.error}`;
    } else error = `no pude descargar el informe: ${inf.error}`;
    if (a.perfil?.campana_id && f.estado === "finalizada") await guardarPerfil(a.perfil.campana_id, a.perfil.canal, a.perfil.campana, a.perfil.datos || {}).catch(() => {});
    return { ok: true, datos: { archivo_id: inf.ok ? (inf.datos as any).archivo_id : null, informe_enviado: enviado, error_informe: error, enviados: t.enviados, errores: t.errores, validos: t.validos, costo: c?.costo?.real ?? null, resumen }, resumen: enviado ? resumen : `${resumen}\n⚠ ${error}` };
  },
};

// ─── Clasificador de errores de proveedor ────────────────────────────────────
const explicacion: Record<string, string> = {
  credenciales: "el proveedor rechaza las credenciales de la cuenta (token o API key vencida o mal puesta)",
  saldo: "la cuenta del proveedor se quedó sin saldo",
  plantilla: "Meta rechaza la plantilla (no aprobada, idioma distinto o la imagen no coincide)",
  base: "muchos números/correos de la base no existen para el proveedor",
  red: "fallos de red con el proveedor (Jelcom reintenta solo)",
  proveedor: "el proveedor devolvió errores genéricos",
  desconocido: "los errores no tienen un patrón claro",
};
const causaPrincipal = (errores: string[]) => (Object.entries(clasificar(errores)) as [string, number][]).filter(([, n]) => n > 0).sort((x, y) => y[1] - x[1])[0]?.[0] || "desconocido";
/** Quita el emoji/ícono con que Jelcom arranca sus líneas de log. */
const sinIcono = (t: string) => String(t).replace(/^[^\p{L}\p{N}]+/u, "").trim();
/** "mensaje WhatsApp (marketing)" → "mensajes WhatsApp" (plural de la primera palabra, sin el paréntesis). */
const unidadEn = (unidad: string, n: number) => { const u = String(unidad).split(" (")[0]; return Number(n) === 1 ? u : u.replace(/^(\S+?)(s?)(\s|$)/, (_m, a, _s, b) => `${a}s${b}`); };


function clasificar(mensajes: string[]) {
  const t = { credenciales: 0, saldo: 0, plantilla: 0, base: 0, red: 0, proveedor: 0 };
  for (const m of mensajes) {
    const s = String(m).toLowerCase();
    if (/401|403|unauthori|api key|apikey|token|credencial|invalid account|auth|sin credenciales/.test(s)) t.credenciales++;
    else if (/saldo|credit|balance|insufficient|sin cr[eé]ditos|quota|funds/.test(s)) t.saldo++;
    else if (/template|plantilla|132\d{3}|parameter/.test(s)) t.plantilla++;
    else if (/inv[aá]lid|not a valid|does not exist|no existe|unknown number|recipient|phone number|131026|undeliverable/.test(s)) t.base++;
    else if (/timeout|econn|network|socket|etimedout|reset|unreachable/.test(s)) t.red++;
    else t.proveedor++;
  }
  return t;
}

export const skillsJelcom: DefSkill[] = [jelcomPrepararEnvio, jelcomMonitorearEnvio, jelcomDiagnosticarErrores, jelcomReportarEnvio];
