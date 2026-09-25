// ARCHIVO: src/motor/flujo.ts
// ─────────────────────────────────────────────────────────────────────────────
//  MOTOR DE FLUJOS (Fase 4) — reemplaza al motor viejo de diagramas.
//  Ejecuta un DefFlujo del registro con estado persistido por paso:
//   - pausa por aprobación (paso 'aprobacion' o tool que la requiere) y retoma
//   - esperas persistidas que sobreviven reinicios
//   - repetir con contador en el contexto
//   - sub-flujos con retorno al padre
//   - al terminar, reporta a la conversación que lo disparó (si hay)
//  Todo el estado vive en flujo_ejecuciones: contexto, nodo_actual, log.
// ─────────────────────────────────────────────────────────────────────────────

import { query } from "../db/cliente.js";
import { registro, validarArgs } from "../registro/registro.js";
import type { DefFlujo, PasoFlujo } from "../registro/tipos.js";
import { ejecutarTool, ejecutarSkill, crearContexto } from "./ejecutor.js";
import { entregarTexto } from "./entrega.js";
import { obtenerFlujo } from "../dominio/flujos.js";

export interface OpcionesFlujo {
  agenteId?: string | null;
  conversacionId?: string | null;
  origen?: "api" | "agente" | "panel" | "subflujo";
  padreId?: string | null;
  pasoPadre?: string | null;
}

export interface EstadoFlujo {
  ejecucionId: string;
  estado: string;
  resultado?: unknown;
  error?: string;
  mensaje?: string;
}

interface Fila {
  id: string; flujo_id: string; nombre_flujo: string; agente_id: string | null; conversacion_id: string | null;
  estado: string; nodo_actual: string | null; contexto: Record<string, any>; args: Record<string, any>;
  padre_id: string | null; paso_padre: string | null; despertar_en: string | null;
}

const ESPERA_INLINE_SEG = 10;   // esperas cortas se hacen en proceso; largas se persisten
const temporizadores = new Map<string, NodeJS.Timeout>();

// ─── Arranque ────────────────────────────────────────────────────────────────
/** Inicia un flujo por nombre del registro (o por id de la tabla flujos). */
export async function iniciarFlujo(nombreOId: string, args: Record<string, unknown> = {}, op: OpcionesFlujo = {}): Promise<EstadoFlujo> {
  const { def, filaFlujo } = await resolverDef(nombreOId);
  const val = validarArgs(def.parametros, args);
  if (!val.ok) throw new Error(`Argumentos inválidos para el flujo ${def.nombre}: ${val.errores.join(" ")}`);

  const contexto = { ...val.valor, __resultados: {}, __iteraciones: {}, __aprobados: {} };
  const [ej] = await query<{ id: string }>(
    `INSERT INTO flujo_ejecuciones (flujo_id, nombre_flujo, agente_id, conversacion_id, origen, args, contexto, nodo_actual, padre_id, paso_padre)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [filaFlujo.id, def.nombre, op.agenteId ?? null, op.conversacionId ?? null, op.origen || "api",
     JSON.stringify(val.valor), JSON.stringify(contexto), def.inicio, op.padreId ?? null, op.pasoPadre ?? null]);
  await log(ej.id, `▶ Flujo ${def.nombre} iniciado con ${JSON.stringify(val.valor)}`);
  return avanzar(ej.id);
}

/** Retoma tras una aprobación (paso 'aprobacion' o tool con aprobación). */
export async function reanudarFlujo(ejecucionId: string, aprobado: boolean): Promise<EstadoFlujo> {
  const fila = await cargar(ejecucionId);
  if (fila.estado !== "esperando_aprobacion") return { ejecucionId, estado: fila.estado, mensaje: "No estaba esperando aprobación." };
  const def = registro.flujo(fila.nombre_flujo);
  if (!def) return finalizar(fila, "fallido", undefined, `El flujo ${fila.nombre_flujo} ya no está en el registro.`);

  const paso = def.pasos.find((p) => p.id === fila.nodo_actual)!;
  if (!aprobado) {
    await log(ejecucionId, `❌ Rechazado en ${paso.id}. El flujo se detiene.`);
    return finalizar(fila, "fallido", undefined, `Rechazado por el humano en el paso ${paso.id}.`);
  }
  await log(ejecucionId, `✅ Aprobado en ${paso.id}.`);
  fila.contexto.__aprobados[paso.id] = true;
  // Si era un paso 'aprobacion', seguimos con el siguiente; si era una tool, se re-entra y ahora ejecuta.
  const siguiente = paso.tipo === "aprobacion" ? siguienteLineal(def, paso.id) : paso.id;
  await query(`UPDATE flujo_ejecuciones SET estado='en_curso', nodo_actual=$1, contexto=$2 WHERE id=$3`, [siguiente, JSON.stringify(fila.contexto), ejecucionId]);
  return avanzar(ejecucionId);
}

/** Al arrancar el servidor: retoma esperas vencidas, programa las futuras, y reanuda lo que quedó en curso. */
export async function retomarFlujos(): Promise<void> {
  const filas = await query<Fila>(`SELECT * FROM flujo_ejecuciones WHERE estado IN ('en_curso','esperando')`);
  for (const f of filas) {
    if (f.estado === "esperando" && f.despertar_en && new Date(f.despertar_en) > new Date()) { programarDespertar(f.id, new Date(f.despertar_en)); continue; }
    await log(f.id, "🔄 El servidor se reinició; retomando este flujo.");
    avanzar(f.id).catch((e) => console.error(`[flujos] Error retomando ${f.id}:`, e?.message || e));
  }
  if (filas.length) console.log(`[flujos] ${filas.length} flujo(s) retomado(s) tras el reinicio.`);
}

// ─── Núcleo ──────────────────────────────────────────────────────────────────
async function avanzar(ejecucionId: string): Promise<EstadoFlujo> {
  const fila = await cargar(ejecucionId);
  const def = registro.flujo(fila.nombre_flujo);
  if (!def) return finalizar(fila, "fallido", undefined, `El flujo ${fila.nombre_flujo} no está en el registro.`);
  const ctx = fila.contexto;
  const ctxEj = crearContexto(fila.agente_id, null, null);
  ctxEj.conversacionId = fila.conversacion_id;

  let actual: string | null = fila.nodo_actual;
  let vueltas = 0;
  const MAX_VUELTAS = 2000;

  try {
    while (actual && vueltas++ < MAX_VUELTAS) {
      const paso = def.pasos.find((p) => p.id === actual);
      if (!paso) return finalizar(fila, "fallido", undefined, `Paso "${actual}" no existe en ${def.nombre}.`);
      await query(`UPDATE flujo_ejecuciones SET nodo_actual=$1, estado='en_curso', contexto=$2 WHERE id=$3`, [actual, JSON.stringify(ctx), fila.id]);

      switch (paso.tipo) {
        case "tool": {
          const defTool = registro.tool(paso.tool);
          if (defTool?.requiereAprobacion && !ctx.__aprobados[paso.id]) {
            const args = resolverArgs(paso.args, ctx);
            return pausarPorAprobacion(fila, paso.id, `Ejecutar ${paso.tool} con ${JSON.stringify(args)}`);
          }
          const args = resolverArgs(paso.args, ctx);
          const r = await ejecutarTool(paso.tool, args, ctxEj);
          ctx.__resultados[paso.id] = r;
          if (paso.guardarEn) ctx[paso.guardarEn] = r.datos;
          await log(fila.id, `${r.ok ? "⚙" : "✘"} ${paso.id}: ${paso.tool} → ${(r.resumen || r.error || "").slice(0, 160)}`);
          if (!r.ok && paso.siFalla !== "continuar") return finalizar(fila, "fallido", undefined, `${paso.id} (${paso.tool}) falló: ${r.error}`, ctx);
          actual = siguienteLineal(def, paso.id);
          break;
        }
        case "skill": {
          const args = resolverArgs(paso.args, ctx);
          const r = await ejecutarSkill(paso.skill, args, ctxEj);
          ctx.__resultados[paso.id] = r;
          if (paso.guardarEn) ctx[paso.guardarEn] = r.datos ?? r.resumen;
          await log(fila.id, `${r.ok ? "◇" : "✘"} ${paso.id}: ${paso.skill} → ${(r.resumen || r.error || "").slice(0, 160)}`);
          if (!r.ok && paso.siFalla !== "continuar") return finalizar(fila, "fallido", undefined, `${paso.id} (${paso.skill}) falló: ${r.error}`, ctx);
          actual = siguienteLineal(def, paso.id);
          break;
        }
        case "condicion": {
          const ok = !!seguro(() => paso.si(ctx), false);
          const destino = ok ? paso.entonces : paso.sino;
          await log(fila.id, `◆ ${paso.id}: ${ok ? "SÍ" : "NO"} → ${destino}`);
          if (ctx.__retorno && destino === ctx.__retorno.repetir) {
            // Volver al repetir desde adentro del cuerpo = fin de iteración: aplica la espera.
            const pausa = await esperarIteracion(fila, ctx, def);
            if (pausa) return pausa;
          }
          actual = destino;
          break;
        }
        case "aprobacion": {
          if (ctx.__aprobados[paso.id]) { actual = siguienteLineal(def, paso.id); break; }
          const msg = typeof paso.mensaje === "function" ? seguro(() => (paso.mensaje as any)(ctx), "¿Aprobás continuar?") : paso.mensaje;
          return pausarPorAprobacion(fila, paso.id, msg);
        }
        case "esperar": {
          const seg = Math.max(0, Number(typeof paso.segundos === "function" ? seguro(() => (paso.segundos as any)(ctx), 0) : paso.segundos) || 0);
          const siguiente = siguienteLineal(def, paso.id);
          if (seg <= ESPERA_INLINE_SEG) {
            if (seg > 0) { await log(fila.id, `⏱ ${paso.id}: esperando ${seg}s`); await dormir(seg * 1000); }
            actual = siguiente; break;
          }
          const hasta = new Date(Date.now() + seg * 1000);
          await query(`UPDATE flujo_ejecuciones SET estado='esperando', despertar_en=$1, nodo_actual=$2, contexto=$3 WHERE id=$4`, [hasta.toISOString(), siguiente, JSON.stringify(ctx), fila.id]);
          await log(fila.id, `⏱ ${paso.id}: esperando ${seg}s (persistido, despierta ${hasta.toLocaleTimeString("es-CO")})`);
          programarDespertar(fila.id, hasta);
          return { ejecucionId: fila.id, estado: "esperando" };
        }
        case "repetir": {
          const n = ctx.__iteraciones[paso.id] ?? 0;
          ctx.__iter = n;
          const listo = n >= paso.maxVeces || !!seguro(() => paso.hasta(ctx), true);
          if (listo) {
            await log(fila.id, `🔁 ${paso.id}: terminado tras ${n} iteración(es)`);
            delete ctx.__retorno;
            actual = siguienteLineal(def, paso.id);
            break;
          }
          await log(fila.id, `🔁 ${paso.id}: iteración ${n + 1}/${paso.maxVeces}`);
          // Al terminar el último paso del cuerpo, se vuelve acá (ver siguienteLineal).
          ctx.__retorno = { repetir: paso.id, ultimo: paso.cuerpo[paso.cuerpo.length - 1] };
          ctx.__iteraciones[paso.id] = n + 1;
          actual = paso.cuerpo[0];
          break;
        }
        case "subflujo": {
          const args = resolverArgs(paso.args, ctx);
          await query(`UPDATE flujo_ejecuciones SET estado='esperando_subflujo', contexto=$1 WHERE id=$2`, [JSON.stringify(ctx), fila.id]);
          await log(fila.id, `⤵ ${paso.id}: sub-flujo ${paso.flujo}`);
          const hijo = await iniciarFlujo(paso.flujo, args, { agenteId: fila.agente_id, conversacionId: null, origen: "subflujo", padreId: fila.id, pasoPadre: paso.id });
          if (hijo.estado === "completado" || hijo.estado === "fallido") {
            // Terminó de corrido: el hijo ya llamó a continuarPadre. Cortamos acá.
            return { ejecucionId: fila.id, estado: "en_curso", mensaje: "continuado por sub-flujo" };
          }
          return { ejecucionId: fila.id, estado: "esperando_subflujo" };
        }
        case "fin": {
          const resultado = paso.resultado ? seguro(() => paso.resultado!(ctx), undefined) : undefined;
          return finalizar(fila, paso.fallo ? "fallido" : "completado", resultado, undefined, ctx);
        }
      }

      // ¿Terminó el cuerpo de un repetir? Espera y vuelve al repetir.
      if (ctx.__retorno && paso.id === ctx.__retorno.ultimo && paso.tipo !== "repetir" && actual === null) {
        const pausa = await esperarIteracion(fila, ctx, def);
        if (pausa) return pausa;
        actual = ctx.__retorno.repetir;
      }
    }
    return finalizar(fila, "fallido", undefined, "El flujo superó el máximo de pasos (posible bucle infinito).", ctx);
  } catch (e: any) {
    return finalizar(fila, "fallido", undefined, `Excepción en ${actual}: ${e?.message || String(e)}`, ctx);
  }
}

/** Espera `cadaSegundos` del repetir activo. Devuelve un estado si la espera se persistió (hay que salir). */
async function esperarIteracion(fila: Fila, ctx: Record<string, any>, def: DefFlujo): Promise<EstadoFlujo | null> {
  const rep = def.pasos.find((p) => p.id === ctx.__retorno?.repetir) as Extract<PasoFlujo, { tipo: "repetir" }> | undefined;
  const espera = rep?.cadaSegundos || 0;
  if (espera <= 0) return null;
  if (espera <= ESPERA_INLINE_SEG) { await dormir(espera * 1000); return null; }
  const hasta = new Date(Date.now() + espera * 1000);
  await query(`UPDATE flujo_ejecuciones SET estado='esperando', despertar_en=$1, nodo_actual=$2, contexto=$3 WHERE id=$4`, [hasta.toISOString(), rep!.id, JSON.stringify(ctx), fila.id]);
  await log(fila.id, `⏱ ${rep!.id}: próxima observación en ${espera}s`);
  programarDespertar(fila.id, hasta);
  return { ejecucionId: fila.id, estado: "esperando" };
}

// ─── Pausas y cierre ─────────────────────────────────────────────────────────
async function pausarPorAprobacion(fila: Fila, pasoId: string, detalle: string): Promise<EstadoFlujo> {
  await query(
    `INSERT INTO aprobaciones (tipo, ejecucion_id, agente_id, conversacion_id, titulo, detalle, nodo_id)
     VALUES ('flujo',$1,$2,$3,$4,$5,$6)`,
    [fila.id, fila.agente_id, fila.conversacion_id, `Flujo ${fila.nombre_flujo}`, detalle, pasoId]);
  await query(`UPDATE flujo_ejecuciones SET estado='esperando_aprobacion', nodo_actual=$1, contexto=$2 WHERE id=$3`, [pasoId, JSON.stringify(fila.contexto), fila.id]);
  await log(fila.id, `✋ ${pasoId}: esperando aprobación — ${detalle}`);
  if (fila.conversacion_id) await entregarTexto(fila.conversacion_id, `⏸ Flujo *${fila.nombre_flujo}*: ${detalle}\nRespondé "ok" para aprobar o "no" para detenerlo.`);
  return { ejecucionId: fila.id, estado: "esperando_aprobacion", mensaje: detalle };
}

async function finalizar(fila: Fila, estado: "completado" | "fallido", resultado?: unknown, error?: string, ctx?: Record<string, any>): Promise<EstadoFlujo> {
  await log(fila.id, estado === "completado" ? `■ Completado.` : `■ Falló: ${error}`);
  await query(`UPDATE flujo_ejecuciones SET estado=$1, resultado=$2, error=$3, contexto=$4, fin=now() WHERE id=$5`,
    [estado, JSON.stringify(resultado ?? null), error ?? null, JSON.stringify(ctx ?? fila.contexto), fila.id]);

  // Reporte a la conversación que lo disparó.
  if (fila.conversacion_id) {
    const def = registro.flujo(fila.nombre_flujo);
    const texto = estado === "completado"
      ? (def?.reporte ? seguro(() => def.reporte!(ctx ?? fila.contexto, resultado), "") : "") || `✅ Flujo *${fila.nombre_flujo}* completado.${resultado !== undefined ? `\n${JSON.stringify(resultado).slice(0, 800)}` : ""}`
      : `❌ Flujo *${fila.nombre_flujo}* falló: ${error}`;
    await entregarTexto(fila.conversacion_id, texto);
  }
  // Retorno al padre si era sub-flujo.
  if (fila.padre_id && fila.paso_padre) await continuarPadre(fila.padre_id, fila.paso_padre, estado, resultado, error);
  return { ejecucionId: fila.id, estado, resultado, error };
}

async function continuarPadre(padreId: string, pasoPadre: string, estadoHijo: string, resultado: unknown, error?: string) {
  const padre = await cargar(padreId);
  const def = registro.flujo(padre.nombre_flujo);
  if (!def) return;
  const paso = def.pasos.find((p) => p.id === pasoPadre) as Extract<PasoFlujo, { tipo: "subflujo" }> | undefined;
  if (!paso) return;
  padre.contexto.__resultados[paso.id] = { ok: estadoHijo === "completado", datos: resultado, error };
  if (paso.guardarEn) padre.contexto[paso.guardarEn] = resultado;
  await log(padreId, `⤴ ${paso.id}: sub-flujo ${estadoHijo}${error ? ` (${error})` : ""}`);
  if (estadoHijo !== "completado") { await finalizar(padre, "fallido", undefined, `El sub-flujo ${paso.flujo} falló: ${error}`, padre.contexto); return; }
  await query(`UPDATE flujo_ejecuciones SET estado='en_curso', nodo_actual=$1, contexto=$2 WHERE id=$3`, [siguienteLineal(def, paso.id), JSON.stringify(padre.contexto), padreId]);
  avanzar(padreId).catch((e) => console.error(`[flujos] Error continuando padre ${padreId}:`, e?.message || e));
}

function programarDespertar(ejecucionId: string, hasta: Date) {
  const ms = Math.max(0, hasta.getTime() - Date.now());
  const previo = temporizadores.get(ejecucionId);
  if (previo) clearTimeout(previo);
  temporizadores.set(ejecucionId, setTimeout(async () => {
    temporizadores.delete(ejecucionId);
    const f = await cargar(ejecucionId).catch(() => null);
    if (!f || f.estado !== "esperando") return;
    await query(`UPDATE flujo_ejecuciones SET estado='en_curso', despertar_en=NULL WHERE id=$1`, [ejecucionId]);
    avanzar(ejecucionId).catch((e) => console.error(`[flujos] Error al despertar ${ejecucionId}:`, e?.message || e));
  }, ms));
}

// ─── Utilidades ──────────────────────────────────────────────────────────────
async function resolverDef(nombreOId: string): Promise<{ def: DefFlujo; filaFlujo: any }> {
  let def = registro.flujo(nombreOId);
  let filaFlujo: any;
  if (def) {
    [filaFlujo] = await query(`SELECT id FROM flujos WHERE nombre=$1`, [def.nombre]);
  } else {
    filaFlujo = await obtenerFlujo(nombreOId);
    if (!filaFlujo) throw new Error(`Flujo "${nombreOId}" no existe.`);
    if (filaFlujo.origen !== "codigo") throw new Error(`El flujo "${filaFlujo.nombre}" fue creado desde la UI. Los flujos se definen en código (src/flujos/).`);
    def = registro.flujo(filaFlujo.nombre);
    if (!def) throw new Error(`El flujo "${filaFlujo.nombre}" no está cargado en el registro.`);
  }
  if (!filaFlujo) throw new Error(`El flujo ${def.nombre} no está sincronizado en la base (reiniciá el servidor).`);
  return { def, filaFlujo };
}

async function cargar(id: string): Promise<Fila> {
  const [f] = await query<Fila>(`SELECT * FROM flujo_ejecuciones WHERE id=$1`, [id]);
  if (!f) throw new Error("Ejecución de flujo no encontrada");
  f.contexto = f.contexto || {};
  f.contexto.__resultados ||= {}; f.contexto.__iteraciones ||= {}; f.contexto.__aprobados ||= {};
  return f;
}

/**
 * El paso siguiente. Dentro de un cuerpo de repetir: el siguiente del cuerpo
 * (null al final, y el motor vuelve al repetir). Fuera: el siguiente del
 * array saltando los que pertenecen a algún cuerpo.
 */
function siguienteLineal(def: DefFlujo, pasoId: string): string | null {
  for (const p of def.pasos) {
    if (p.tipo !== "repetir") continue;
    const k = p.cuerpo.indexOf(pasoId);
    if (k >= 0) return k < p.cuerpo.length - 1 ? p.cuerpo[k + 1] : null;
  }
  const enCuerpo = new Set(def.pasos.flatMap((p) => (p.tipo === "repetir" ? p.cuerpo : [])));
  const i = def.pasos.findIndex((p) => p.id === pasoId);
  for (let j = i + 1; j < def.pasos.length; j++) {
    if (!enCuerpo.has(def.pasos[j].id)) return def.pasos[j].id;
  }
  return null;
}

function resolverArgs(args: any, ctx: Record<string, any>): Record<string, unknown> {
  return typeof args === "function" ? (seguro(() => args(ctx), {}) as Record<string, unknown>) : { ...(args || {}) };
}
function seguro<T>(fn: () => T, porDefecto: T): T { try { return fn(); } catch { return porDefecto; } }
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function log(ejId: string, texto: string) {
  await query(`UPDATE flujo_ejecuciones SET log = log || $1::jsonb WHERE id=$2`, [JSON.stringify([{ t: new Date().toISOString(), texto }]), ejId]);
}

/** Compatibilidad con rutas viejas. */
export const ejecutarFlujo = (flujoId: string, agenteId: string | null, contexto: any = {}) =>
  iniciarFlujo(flujoId, contexto, { agenteId, origen: "panel" });