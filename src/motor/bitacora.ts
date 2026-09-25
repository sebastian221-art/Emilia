// ARCHIVO: src/motor/bitacora.ts
// ─────────────────────────────────────────────────────────────────────────────
//  BITÁCORA — captura la consola del servidor en un buffer circular para que
//  los agentes puedan leer "qué está pasando" en Emilia sin acceso a la
//  terminal. Se instala una vez al arrancar (instalarBitacora()).
// ─────────────────────────────────────────────────────────────────────────────

const MAX = 800;
const lineas: { t: string; nivel: "log" | "warn" | "error"; texto: string }[] = [];
let instalada = false;

function push(nivel: "log" | "warn" | "error", args: unknown[]) {
  const texto = args.map((a) => (typeof a === "string" ? a : a instanceof Error ? `${a.message}` : JSON.stringify(a))).join(" ");
  lineas.push({ t: new Date().toISOString(), nivel, texto: texto.slice(0, 1500) });
  if (lineas.length > MAX) lineas.splice(0, lineas.length - MAX);
}

export function instalarBitacora() {
  if (instalada) return; instalada = true;
  const o = { log: console.log, warn: console.warn, error: console.error };
  console.log = (...a) => { push("log", a); o.log(...a); };
  console.warn = (...a) => { push("warn", a); o.warn(...a); };
  console.error = (...a) => { push("error", a); o.error(...a); };
}

export function leerBitacora(op: { ultimas?: number; nivel?: "log" | "warn" | "error"; filtro?: string } = {}) {
  let l = lineas;
  if (op.nivel) l = l.filter((x) => x.nivel === op.nivel || (op.nivel === "warn" && x.nivel === "error"));
  if (op.filtro) { const f = op.filtro.toLowerCase(); l = l.filter((x) => x.texto.toLowerCase().includes(f)); }
  return l.slice(-(op.ultimas || 60));
}