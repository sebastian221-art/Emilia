// ARCHIVO: src/seguridad/ritmo.ts
// Límite de ritmo para lo que entra de terceros por WhatsApp. Si alguien (o un
// bot) te manda una ráfaga, no gastamos modelo, transcripciones ni descargas en
// cada mensaje: se guarda lo justo y se te avisa una sola vez.
//  .env: TERCEROS_POR_NUMERO_10MIN (20), TERCEROS_POR_NUMERO_DIA (150),
//        TERCEROS_TOTAL_HORA (300)
import { query } from "../db/cliente.js";

const ventanas = new Map<string, number[]>();   // clave → marcas de tiempo
const avisados = new Map<string, number>();     // número → cuándo se avisó

function contar(clave: string, ventanaMs: number, ahora: number): number {
  const xs = (ventanas.get(clave) || []).filter((t) => ahora - t < ventanaMs);
  ventanas.set(clave, xs);
  return xs.length;
}

export interface VeredictoRitmo { ok: boolean; motivo?: string; avisar?: boolean }

export function ritmoTercero(numero: string, ahora = Date.now()): VeredictoRitmo {
  const L10 = Number(process.env.TERCEROS_POR_NUMERO_10MIN) || 20;
  const LDIA = Number(process.env.TERCEROS_POR_NUMERO_DIA) || 150;
  const LTOT = Number(process.env.TERCEROS_TOTAL_HORA) || 300;
  const k10 = `n10:${numero}`, kdia = `ndia:${numero}`, ktot = "total";
  const c10 = contar(k10, 10 * 60_000, ahora), cdia = contar(kdia, 86_400_000, ahora), ctot = contar(ktot, 3_600_000, ahora);
  let motivo: string | undefined;
  if (c10 >= L10) motivo = `más de ${L10} mensajes en 10 minutos`;
  else if (cdia >= LDIA) motivo = `más de ${LDIA} mensajes hoy`;
  else if (ctot >= LTOT) motivo = `más de ${LTOT} mensajes de terceros en una hora (todos juntos)`;
  if (motivo) {
    const ult = avisados.get(numero) || 0;
    const avisar = ahora - ult > 3_600_000;
    if (avisar) {
      avisados.set(numero, ahora);
      query(`INSERT INTO seguridad_eventos (tipo, detalle) VALUES ('ritmo', $1)`, [`${mascara(numero)}: ${motivo}`]).catch(() => {});
    }
    return { ok: false, motivo, avisar };
  }
  for (const k of [k10, kdia, ktot]) ventanas.get(k)!.push(ahora);
  return { ok: true };
}

export function _reiniciarRitmo() { ventanas.clear(); avisados.clear(); }

/** Para logs: un número de tercero se muestra solo con los últimos 4 dígitos. */
export function mascara(numero: string): string {
  const d = String(numero || "").replace(/\D/g, "");
  return d.length <= 4 ? "****" : `…${d.slice(-4)}`;
}
