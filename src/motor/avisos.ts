// ARCHIVO: src/motor/avisos.ts
// ─────────────────────────────────────────────────────────────────────────────
//  AVISOS AL JEFE con horas de silencio, y configuración de Iris.
//   avisarJefe(texto, "critico")  → sale siempre, ya.
//   avisarJefe(texto, "normal")   → sale ya, salvo en horas de silencio: se guarda
//                                    y se entrega junto al terminar el silencio.
//  La configuración (personas importantes, silencio, horarios de resúmenes)
//  vive en iris_config y se cambia por WhatsApp con iris_configurar.
// ─────────────────────────────────────────────────────────────────────────────
import { query } from "../db/cliente.js";

export interface PersonaImportante { nombre: string; correo?: string; dominio?: string; nota?: string }
export interface ConfigIris {
  silencio: { desde: string; hasta: string } | null;         // "22:00" → "07:00", hora de Bogotá
  personas_importantes: PersonaImportante[];
  resumen_manana: string | null;                             // "07:00" o null
  resumen_noche: string | null;                              // "21:00" o null
  correo_avisar_desde: number;                               // importancia mínima para avisar al instante (1..5)
}
const POR_DEFECTO: ConfigIris = { silencio: null, personas_importantes: [], resumen_manana: "07:00", resumen_noche: null, correo_avisar_desde: 4 };

let cache: { cfg: ConfigIris; t: number } | null = null;
export async function configIris(): Promise<ConfigIris> {
  if (cache && Date.now() - cache.t < 30_000) return cache.cfg;
  const filas = await query<{ clave: string; valor: any }>(`SELECT clave, valor FROM iris_config`).catch(() => [] as any[]);
  const cfg: any = { ...POR_DEFECTO };
  for (const f of filas) cfg[f.clave] = f.valor;
  cache = { cfg, t: Date.now() };
  return cfg;
}
export async function guardarConfigIris(cambios: Partial<ConfigIris>): Promise<ConfigIris> {
  for (const [k, v] of Object.entries(cambios)) {
    if (v === undefined) continue;
    await query(`INSERT INTO iris_config (clave, valor) VALUES ($1, $2) ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor, actualizado_en = now()`, [k, JSON.stringify(v)]);
  }
  cache = null;
  return configIris();
}

/** Hora y minutos actuales en Bogotá. */
export function ahoraBogota(fecha = new Date()): { h: number; m: number; dia: number } {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/Bogota", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short" }).formatToParts(fecha);
  const v = (t: string) => p.find((x) => x.type === t)?.value || "0";
  return { h: Number(v("hour")), m: Number(v("minute")), dia: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(v("weekday")) };
}
const minutos = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return (h || 0) * 60 + (m || 0); };

export function enSilencio(cfg: ConfigIris, fecha = new Date()): boolean {
  if (!cfg.silencio?.desde || !cfg.silencio?.hasta) return false;
  const { h, m } = ahoraBogota(fecha), ahora = h * 60 + m, d = minutos(cfg.silencio.desde), a = minutos(cfg.silencio.hasta);
  return d <= a ? ahora >= d && ahora < a : ahora >= d || ahora < a;
}

/**
 * Sale por el "cuaderno" del agente (conversación de delegación colgada de la del
 * jefe con Emilia): queda en la memoria del agente Y de Emilia, así cuando el jefe
 * responde "contéstale que sí", quien lo atienda sabe de qué se habla.
 */
async function enviar(texto: string, agente = "iris"): Promise<boolean> {
  const jefe = process.env.WHATSAPP_NUMERO_JEFE;
  if (!jefe) return false;
  try {
    const { agenteDeWhatsapp } = await import("../whatsapp/agente-canal.js");
    const { obtenerOCrearConversacion } = await import("../dominio/conversaciones.js");
    const { entregarTexto } = await import("./entrega.js");
    const admin = await agenteDeWhatsapp();
    const [ag] = await query<{ id: string }>(`SELECT id FROM agentes WHERE lower(nombre) = lower($1) AND estado = 'activo' LIMIT 1`, [agente]);
    if (admin) {
      const raiz = await obtenerOCrearConversacion(admin.id, "whatsapp", jefe.replace(/\D/g, ""));
      const conv = ag && ag.id !== admin.id ? await obtenerOCrearConversacion(ag.id, "delegacion", raiz.id) : raiz;
      await entregarTexto(conv, texto.slice(0, 3900));
      return true;
    }
  } catch { /* sin agentes: directo */ }
  const { enviarTextoWhatsapp } = await import("../whatsapp/enviar.js");
  const r = await enviarTextoWhatsapp(jefe, texto.slice(0, 3900)).catch((e) => ({ ok: false, error: String(e) }));
  return !!r.ok;
}

/** Aviso al jefe respetando las horas de silencio (lo crítico sale siempre). */
/** agente: quién habla (su cuaderno guarda el contexto para que pueda seguir la conversación). */
export async function avisarJefe(texto: string, nivel: "critico" | "normal" = "normal", origen = "iris", agente = "iris"): Promise<"enviado" | "diferido" | "fallo"> {
  const cfg = await configIris();
  // Una sola voz: lo no urgente de ciertos agentes espera al resumen de Emilia (a las horas configuradas).
  if (nivel !== "critico") {
    const { vaAlResumen } = await import("./administradora.js");
    if (await vaAlResumen(origen, agente).catch(() => false)) {
      await query(`INSERT INTO avisos_diferidos (texto, origen, digesto) VALUES ($1, $2, true)`, [texto, agente || origen]);
      return "diferido";
    }
  }
  if (nivel !== "critico" && enSilencio(cfg)) {
    await query(`INSERT INTO avisos_diferidos (texto, origen) VALUES ($1, $2)`, [texto, origen]);
    return "diferido";
  }
  return (await enviar(texto, agente)) ? "enviado" : "fallo";
}

/** Al terminar el silencio, entrega lo guardado en UN mensaje. Lo llama el reloj cada minuto. */
export async function entregarDiferidos(): Promise<number> {
  const cfg = await configIris();
  if (enSilencio(cfg)) return 0;
  const xs = await query<{ id: string; texto: string; creado_en: string }>(`SELECT id, texto, creado_en FROM avisos_diferidos WHERE enviado_en IS NULL AND NOT digesto ORDER BY creado_en`);
  if (!xs.length) return 0;
  const hora = (iso: string) => new Date(iso).toLocaleTimeString("es-CO", { timeZone: "America/Bogota", hour: "2-digit", minute: "2-digit" });
  const texto = `🌙 *Mientras estabas en silencio* (${xs.length}):\n\n${xs.map((x) => `🕐 ${hora(x.creado_en)} · ${x.texto}`).join("\n\n")}`;
  if (await enviar(texto)) await query(`UPDATE avisos_diferidos SET enviado_en = now() WHERE id = ANY($1::uuid[])`, [xs.map((x) => x.id)]);
  return xs.length;
}
