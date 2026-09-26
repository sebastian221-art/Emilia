// ARCHIVO: src/motor/eventos.ts
// ─────────────────────────────────────────────────────────────────────────────
//  EVENTOS Y DISPARADORES
//  emitir(nombre, datos): cualquier parte del sistema (runtime, flujos,
//  webhooks, cron, manual) publica un evento. Los disparadores tipo 'evento'
//  cuyo patrón coincide arrancan su acción. Los tipo 'cron' corren por reloj.
//  Los tipo 'webhook' se disparan desde POST /api/eventos/:nombre.
//  Acción = flujo (iniciarFlujo) | skill | agente (orden en lenguaje natural).
//  Plantillas en args/instrucción: {{datos.campo}}, {{evento}}, {{fecha}}.
// ─────────────────────────────────────────────────────────────────────────────

import { registro } from "../registro/registro.js";
import { listarDisparadores, marcarDisparo, registrarEvento, type Disparador } from "../dominio/disparadores.js";
import { iniciarFlujo } from "./flujo.js";
import { ejecutarSkill, crearContexto } from "./ejecutor.js";
import { correrTarea } from "./loop.js";
import { entregarRespuesta, entregarTexto } from "./entrega.js";
import { obtenerOCrearConversacion } from "../dominio/conversaciones.js";
import { administradora } from "../dominio/empresa.js";
import { encolar } from "./cola.js";

// ─── Plantillas ──────────────────────────────────────────────────────────────
function plantilla(v: unknown, ctx: Record<string, any>): unknown {
  if (typeof v === "string") return v.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, ruta) => { const val = ruta.split(".").reduce((o: any, k: string) => (o == null ? undefined : o[k]), ctx); return val == null ? "" : typeof val === "object" ? JSON.stringify(val) : String(val); });
  if (Array.isArray(v)) return v.map((x) => plantilla(x, ctx));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plantilla(x, ctx)]));
  return v;
}

function coincide(patron: string, nombre: string): boolean {
  if (patron === nombre || patron === "*") return true;
  const re = new RegExp("^" + patron.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$");
  return re.test(nombre);
}

/** Conversación del jefe con la administradora (a donde llegan los reportes de acciones disparadas). */
async function convJefe(): Promise<string | null> {
  const admin = await administradora(); const jefe = (process.env.WHATSAPP_NUMERO_JEFE || "").replace(/\D/g, "");
  if (!admin || !jefe) return null;
  return (await obtenerOCrearConversacion(admin.id, "whatsapp", jefe)).id;
}

// ─── Ejecutar la acción de un disparador ─────────────────────────────────────
export async function ejecutarDisparador(d: Disparador, evento: { nombre: string; datos: any; origen: string }): Promise<string> {
  const ctx = { evento: evento.nombre, datos: evento.datos || {}, fecha: new Date().toISOString(), origen: evento.origen };
  const args = (plantilla(d.accion.args || {}, ctx) as Record<string, unknown>) || {};
  const padre = await convJefe();
  const admin = await administradora();
  const agenteId = d.agente_id || admin?.id || null;
  let resultado = "";
  try {
    if (d.accion.tipo === "flujo") {
      if (!registro.flujo(d.accion.nombre)) throw new Error(`flujo ${d.accion.nombre} no registrado`);
      const conv = agenteId && padre ? await obtenerOCrearConversacion(agenteId, "delegacion", padre) : null;
      const r = await iniciarFlujo(d.accion.nombre, args, { agenteId, conversacionId: conv?.id ?? null, origen: "agente" });
      resultado = `flujo ${d.accion.nombre} → ${r.estado}`;
    } else if (d.accion.tipo === "skill") {
      const r = await ejecutarSkill(d.accion.nombre, args, crearContexto(agenteId, null, null, padre));
      resultado = `skill ${d.accion.nombre} → ${r.ok ? "ok" : "error: " + r.error}`;
      if (padre && r.resumen) await entregarTexto(padre, `⚡ ${d.nombre}: ${r.resumen.slice(0, 1500)}`);
    } else {
      if (!agenteId) throw new Error("no hay agente para la orden");
      const instruccion = String(plantilla(d.accion.instruccion || d.accion.nombre, ctx));
      const conv = padre ? await obtenerOCrearConversacion(agenteId, "delegacion", padre) : await obtenerOCrearConversacion(agenteId, "panel", "panel");
      const r = await encolar(conv.id, async () => {
        const r = await correrTarea(agenteId!, `[Evento ${evento.nombre}] ${instruccion}`, { conversacionId: conv.id, origen: "api", contextoCanal: `Esta orden la disparó automáticamente el evento "${evento.nombre}" (datos: ${JSON.stringify(evento.datos || {}).slice(0, 800)}). Lo que respondas le llega al jefe por WhatsApp firmado con tu nombre.` });
        await entregarRespuesta(conv, r); return r;
      });
      resultado = `agente → ${r.estado}`;
    }
  } catch (e: any) { resultado = `ERROR: ${e?.message || e}`; console.error(`[disparadores] ${d.nombre}: ${resultado}`); }
  await marcarDisparo(d.id, resultado);
  console.log(`[disparadores] ${d.nombre} (${evento.nombre}) → ${resultado}`);
  return resultado;
}

// ─── Bus ─────────────────────────────────────────────────────────────────────
export async function emitir(nombre: string, datos: unknown = {}, origen = "sistema"): Promise<number> {
  await registrarEvento(nombre, datos, origen);
  const ds = (await listarDisparadores()).filter((d) => d.estado === "activo" && d.tipo === "evento" && coincide(String(d.config?.patron || ""), nombre));
  for (const d of ds) ejecutarDisparador(d, { nombre, datos, origen }).catch(() => {});
  return ds.length;
}

/** Webhook entrante: valida token/secreto del disparador y lo ejecuta. */
export async function recibirWebhook(nombre: string, body: unknown, op: { token?: string; firma?: string; rawBody?: Buffer }): Promise<{ ok: boolean; error?: string; disparados: number }> {
  const ds = (await listarDisparadores()).filter((d) => d.estado === "activo" && d.tipo === "webhook" && d.nombre === nombre);
  if (!ds.length) return { ok: false, error: "No hay un disparador webhook con ese nombre.", disparados: 0 };
  let n = 0;
  for (const d of ds) {
    const cfg = d.config || {};
    if (cfg.secreto) {
      const { createHmac, timingSafeEqual } = await import("node:crypto");
      const esperado = "sha256=" + createHmac("sha256", cfg.secreto).update(op.rawBody || Buffer.from(JSON.stringify(body))).digest("hex");
      const a = Buffer.from(esperado), b = Buffer.from(op.firma || "");
      if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, error: "Firma inválida.", disparados: 0 };
    } else if (cfg.token && cfg.token !== op.token) return { ok: false, error: "Token inválido.", disparados: 0 };
    await registrarEvento(`webhook.${nombre}`, body, "webhook");
    ejecutarDisparador(d, { nombre: `webhook.${nombre}`, datos: body, origen: "webhook" }).catch(() => {});
    n++;
  }
  return { ok: true, disparados: n };
}

// ─── Cron ────────────────────────────────────────────────────────────────────
function campoCron(spec: string, valor: number, min: number, max: number): boolean {
  return spec.split(",").some((parte) => {
    const m = parte.match(/^(\*|\d+)(?:-(\d+))?(?:\/(\d+))?$/); if (!m) return false;
    const paso = m[3] ? Number(m[3]) : 1;
    let ini = m[1] === "*" ? min : Number(m[1]); let fin = m[2] ? Number(m[2]) : m[1] === "*" ? max : ini;
    if (m[1] !== "*" && !m[2] && m[3]) fin = max;
    return valor >= ini && valor <= fin && (valor - ini) % paso === 0;
  });
}
export function cronCoincide(expresion: string, fecha = new Date()): boolean {
  const p = expresion.trim().split(/\s+/); if (p.length !== 5) return false;
  const d = new Date(fecha.toLocaleString("en-US", { timeZone: process.env.TZ_EMILIA || "America/Bogota" }));
  return campoCron(p[0], d.getMinutes(), 0, 59) && campoCron(p[1], d.getHours(), 0, 23) && campoCron(p[2], d.getDate(), 1, 31) && campoCron(p[3], d.getMonth() + 1, 1, 12) && campoCron(p[4], d.getDay(), 0, 6);
}

let reloj: NodeJS.Timeout | null = null;
export function iniciarReloj() {
  if (reloj) return;
  const tick = async () => {
    try {
      const ahora = new Date();
      for (const d of (await listarDisparadores()).filter((x) => x.estado === "activo" && x.tipo === "cron")) {
        const cfg = d.config || {};
        let toca = false;
        if (cfg.cada_minutos) { const ult = d.ultimo_disparo ? new Date(d.ultimo_disparo).getTime() : 0; toca = ahora.getTime() - ult >= Number(cfg.cada_minutos) * 60000 - 5000; }
        else if (cfg.expresion) { toca = cronCoincide(String(cfg.expresion), ahora) && !(d.ultimo_disparo && ahora.getTime() - new Date(d.ultimo_disparo).getTime() < 60000); }
        if (toca) { await registrarEvento(`cron.${d.nombre}`, { hora: ahora.toISOString() }, "cron"); ejecutarDisparador(d, { nombre: `cron.${d.nombre}`, datos: { hora: ahora.toISOString() }, origen: "cron" }).catch(() => {}); }
      }
    } catch (e: any) { console.warn("[cron]", e?.message || e); }
  };
  reloj = setInterval(tick, 60000);
  setTimeout(tick, 5000);
  console.log("[disparadores] reloj de cron activo (cada minuto).");
}