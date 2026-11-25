// ARCHIVO: src/seguridad/gasto.ts
// Tope de gasto GLOBAL por día (todos los agentes, Groq + Claude + Claude Code).
// Es la red de seguridad por si algo entra en bucle: los topes por agente
// siguen existiendo encima de este.
//  · GASTO_DIARIO_MAX en el .env (USD, defecto 10; 0 = sin tope). Se puede
//    cambiar por WhatsApp: "sube el tope a 15" (queda en iris_config).
//  · Al 80 % te aviso una vez. Al 100 % se frenan las llamadas a modelos hasta
//    medianoche, salvo lo que tú escribes directamente (prioridad "jefe"),
//    que tiene un margen extra del 20 % para que puedas decidir qué hacer.
import { query } from "../db/cliente.js";

let cache: { t: number; total: number; dia: string } | null = null;
const avisos = new Set<string>();   // "dia:80" / "dia:100"

const hoy = () => new Date().toISOString().slice(0, 10);

export async function topeGlobal(): Promise<number> {
  const { configIris } = await import("../motor/avisos.js");
  const c: any = await configIris().catch(() => ({}));
  const v = c.gasto_diario_max ?? process.env.GASTO_DIARIO_MAX ?? 10;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 10;
}

export async function gastoHoy(fresco = false): Promise<number> {
  if (!fresco && cache && cache.dia === hoy() && Date.now() - cache.t < 60_000) return cache.total;
  const { gasto } = await import("../motor/presupuesto.js");
  const g = await gasto(null, "hoy").catch(() => null);
  const total = g?.total_usd ?? (cache?.total || 0);
  cache = { t: Date.now(), total, dia: hoy() };
  return total;
}

/** Suma lo recién gastado al caché (para no esperar al próximo refresco). */
export function sumarGasto(usd: number) { if (cache && cache.dia === hoy() && usd > 0) cache.total += usd; }

export class TopeGlobalAlcanzado extends Error {
  constructor(public gastado: number, public tope: number) { super(`Tope de gasto diario alcanzado: ${gastado.toFixed(2)} de ${tope} USD. Para seguir hoy: "sube el tope a N" por WhatsApp.`); this.name = "TopeGlobalAlcanzado"; }
}

/** Lanza TopeGlobalAlcanzado si ya no se puede gastar. prioridad "jefe" tiene 20 % de margen. */
export async function verificarTopeGlobal(prioridad: "normal" | "jefe" = "normal"): Promise<void> {
  if ((globalThis as any).__sinTopeGlobal) return;
  const tope = await topeGlobal();
  if (!tope) return;
  const gastado = await gastoHoy();
  const dia = hoy();
  if (gastado >= tope * 0.8 && !avisos.has(`${dia}:80`)) {
    avisos.add(`${dia}:80`);
    avisar(`💸 Hoy ya van ${gastado.toFixed(2)} USD de ${tope} USD (80 % del tope diario). Si es normal, ignora esto; si no, algo puede estar en bucle y lo reviso.`, "normal");
  }
  const limite = prioridad === "jefe" ? tope * 1.2 : tope;
  if (gastado >= limite) {
    if (!avisos.has(`${dia}:100`)) {
      avisos.add(`${dia}:100`);
      query(`INSERT INTO seguridad_eventos (tipo, detalle) VALUES ('gasto', $1)`, [`tope ${tope} alcanzado (${gastado.toFixed(2)})`]).catch(() => {});
      avisar(`🛑 Llegamos al tope de gasto de hoy (${gastado.toFixed(2)} de ${tope} USD). Paré el trabajo de fondo hasta medianoche. Lo que tú me escribas lo sigo atendiendo un poco más. Si quieres seguir normal: "sube el tope a ${Math.ceil(tope * 1.5)}".`, "critico");
    }
    throw new TopeGlobalAlcanzado(gastado, tope);
  }
}

function avisar(texto: string, nivel: "normal" | "critico") {
  import("../motor/avisos.js").then(({ avisarJefe }) => avisarJefe(texto, nivel, "seguridad")).catch(() => {});
}

/** Atajo del jefe por WhatsApp: "sube el tope a 15", "tope de gasto 20", "quita el tope". */
export async function atajoTope(texto: string): Promise<string | null> {
  const t = texto.trim().toLowerCase();
  const m = t.match(/^(?:sube|subir|pon|poner|baja|bajar|cambia|cambiar)?\s*(?:el\s+)?tope(?:\s+de\s+gasto)?(?:\s+diario)?\s*(?:a|en|=)?\s*(\d+(?:[.,]\d+)?)\s*(?:usd|d[oó]lares)?\.?$/);
  const quitar = /^(?:quita|quitar|elimina)\s+(?:el\s+)?tope(?:\s+de\s+gasto)?\.?$/.test(t);
  if (!m && !quitar) return null;
  const valor = quitar ? 0 : Number(m![1].replace(",", "."));
  const { guardarConfigIris } = await import("../motor/avisos.js");
  await guardarConfigIris({ gasto_diario_max: valor } as any);
  avisos.delete(`${hoy()}:100`); avisos.delete(`${hoy()}:80`);
  const g = await gastoHoy(true);
  return valor ? `Listo, el tope diario quedó en ${valor} USD (hoy van ${g.toFixed(2)}).` : `Listo, quité el tope global de gasto (hoy van ${g.toFixed(2)} USD). Los topes por agente siguen.`;
}

export function _reiniciarGasto() { cache = null; avisos.clear(); }
