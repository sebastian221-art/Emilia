import { query } from "../db/cliente.js";
import { obtenerFlujo } from "../dominio/flujos.js";
import { obtenerAgente, skillsDeAgente } from "../dominio/agentes.js";
import { correrTarea } from "./loop.js";
import { llamarModelo } from "./groq.js";

/**
 * Ejecuta un flujo recorriendo su diagrama: arranca en el nodo "inicio",
 * sigue las conexiones, ejecuta cada nodo según su tipo, y avanza. Si llega
 * a un nodo de aprobación, crea una aprobación pendiente y PAUSA — se retoma
 * cuando el humano aprueba/rechaza (ver reanudarFlujo).
 */
export async function ejecutarFlujo(flujoId: string, agenteId: string | null, contextoInicial: any = {}): Promise<{ ejecucionId: string; estado: string }> {
  const flujo = await obtenerFlujo(flujoId);
  if (!flujo) throw new Error("Flujo no encontrado");

  const [ej] = await query<{ id: string }>(
    `INSERT INTO flujo_ejecuciones (flujo_id, agente_id, contexto) VALUES ($1,$2,$3) RETURNING id`,
    [flujoId, agenteId, JSON.stringify(contextoInicial)]
  );

  const def = flujo.definicion || {};
  const inicio = (def.nodos || []).find((n: any) => n.tipo === "inicio");
  if (!inicio) {
    await finalizar(ej.id, "fallido", "El flujo no tiene un nodo de Inicio.");
    return { ejecucionId: ej.id, estado: "fallido" };
  }

  return avanzar(ej.id, flujo, inicio.id, contextoInicial, agenteId);
}

/** Avanza el flujo desde un nodo dado, siguiendo las conexiones. */
async function avanzar(ejId: string, flujo: any, nodoId: string, contexto: any, agenteId: string | null): Promise<{ ejecucionId: string; estado: string }> {
  const def = flujo.definicion || {};
  const nodos: any[] = def.nodos || [];
  const conexiones: any[] = def.conexiones || [];
  let actual = nodoId;
  let vueltas = 0;
  const MAX = 100; // tope de seguridad contra bucles infinitos

  while (actual && vueltas < MAX) {
    vueltas++;
    const nodo = nodos.find((n) => n.id === actual);
    if (!nodo) break;

    await query(`UPDATE flujo_ejecuciones SET nodo_actual=$1 WHERE id=$2`, [actual, ejId]);
    await log(ejId, `▶ ${nodo.tipo}: ${resumenNodo(nodo)}`);

    // ── Ejecutar según el tipo ──
    let salidaEtiqueta: string | null = null; // para ramas (condición)

    if (nodo.tipo === "fin") {
      await finalizar(ejId, "completado", `Terminó en: ${nodo.config?.resultado || "fin"}`);
      return { ejecucionId: ejId, estado: "completado" };
    }

    if (nodo.tipo === "aprobacion") {
      // Crear aprobación pendiente y PAUSAR el flujo.
      await query(
        `INSERT INTO aprobaciones (ejecucion_id, agente_id, titulo, detalle, nodo_id) VALUES ($1,$2,$3,$4,$5)`,
        [ejId, agenteId, "Aprobación en flujo", nodo.config?.mensaje || "¿Aprobás continuar?", actual]
      );
      await query(`UPDATE flujo_ejecuciones SET estado='esperando_aprobacion', contexto=$1 WHERE id=$2`, [JSON.stringify(contexto), ejId]);
      await log(ejId, `✋ Esperando tu aprobación: ${nodo.config?.mensaje || ""}`);
      return { ejecucionId: ejId, estado: "esperando_aprobacion" };
    }

    if (nodo.tipo === "accion") {
      if (agenteId) {
        const instruccion = `${nodo.config?.instruccion || "Ejecutá este paso."}${nodo.config?.skill ? ` (usá la skill ${nodo.config.skill})` : ""}`;
        const r = await correrTarea(agenteId, instruccion);
        contexto[`resultado_${actual}`] = { ok: r.ok, respuesta: r.respuesta };
        await log(ejId, `⚡ Acción → ${r.ok ? "ok" : "falló"}: ${(r.respuesta || "").slice(0, 100)}`);
      } else {
        await log(ejId, `⚡ Acción (sin agente asignado, se salta la ejecución real).`);
      }
    }

    if (nodo.tipo === "razonar") {
      const r = await llamarModelo([{ role: "user", content: `${nodo.config?.pregunta || "Analizá la situación."}\n\nContexto: ${JSON.stringify(contexto).slice(0, 1000)}` }], []);
      contexto[`razonamiento_${actual}`] = r.texto;
      await log(ejId, `🧠 Razonó: ${r.texto.slice(0, 120)}`);
    }

    if (nodo.tipo === "condicion") {
      // Le preguntamos al modelo si la condición se cumple, con el contexto.
      const r = await llamarModelo([{ role: "user", content: `Condición: "${nodo.config?.condicion}". Según este contexto: ${JSON.stringify(contexto).slice(0, 1000)}, ¿se cumple? Respondé SOLO "si" o "no".` }], []);
      const cumple = /s[ií]/i.test(r.texto.trim().slice(0, 5));
      salidaEtiqueta = cumple ? (nodo.config?.etiqueta_si || "sí") : (nodo.config?.etiqueta_no || "no");
      await log(ejId, `◆ Condición "${nodo.config?.condicion}" → ${cumple ? "SÍ" : "NO"}`);
    }

    if (nodo.tipo === "esperar") {
      const seg = Math.min(Number(nodo.config?.segundos) || 0, 30); // tope 30s para no colgar
      if (seg > 0) { await log(ejId, `⏱ Esperando ${seg}s...`); await new Promise((res) => setTimeout(res, seg * 1000)); }
    }

    if (nodo.tipo === "repetir") {
      await log(ejId, `🔁 Nodo repetir (por ahora avanza una vez — el bucle completo es una mejora futura).`);
    }

    if (nodo.tipo === "subflujo") {
      await log(ejId, `⤴ Sub-flujo/delegar: ${nodo.config?.objetivo || ""} (por ahora registrado, ejecución encadenada es mejora futura).`);
    }

    // ── Buscar el siguiente nodo ──
    let siguientes = conexiones.filter((c) => c.desde === actual);
    // Si es condición, filtrar por la etiqueta del camino elegido.
    if (salidaEtiqueta && siguientes.length > 1) {
      const match = siguientes.find((c) => (c.etiqueta || "").toLowerCase().includes(salidaEtiqueta!.toLowerCase().slice(0, 2)));
      siguientes = match ? [match] : siguientes.slice(0, 1);
    }
    actual = siguientes[0]?.hasta || null;
    await query(`UPDATE flujo_ejecuciones SET contexto=$1 WHERE id=$2`, [JSON.stringify(contexto), ejId]);
  }

  await finalizar(ejId, "completado", "Flujo recorrido.");
  return { ejecucionId: ejId, estado: "completado" };
}

/** Retoma un flujo pausado tras una aprobación. */
export async function reanudarFlujo(ejecucionId: string, aprobado: boolean): Promise<void> {
  const [ej] = await query<any>(`SELECT * FROM flujo_ejecuciones WHERE id=$1`, [ejecucionId]);
  if (!ej || ej.estado !== "esperando_aprobacion") return;
  const flujo = await obtenerFlujo(ej.flujo_id);
  if (!flujo) return;

  const contexto = ej.contexto || {};
  await log(ejecucionId, aprobado ? "✅ Aprobado — continúa." : "❌ Rechazado — se detiene.");

  if (!aprobado) { await finalizar(ejecucionId, "fallido", "Rechazado en la aprobación."); return; }

  await query(`UPDATE flujo_ejecuciones SET estado='en_curso' WHERE id=$1`, [ejecucionId]);
  // Buscar el nodo siguiente al de aprobación (el camino de "aprobado").
  const conexiones = flujo.definicion?.conexiones || [];
  const siguiente = conexiones.find((c: any) => c.desde === ej.nodo_actual);
  if (siguiente) await avanzar(ejecucionId, flujo, siguiente.hasta, contexto, ej.agente_id);
  else await finalizar(ejecucionId, "completado", "No hay más pasos tras la aprobación.");
}

async function log(ejId: string, texto: string) {
  await query(`UPDATE flujo_ejecuciones SET log = log || $1::jsonb WHERE id=$2`,
    [JSON.stringify([{ t: new Date().toISOString(), texto }]), ejId]);
}
async function finalizar(ejId: string, estado: string, nota: string) {
  await log(ejId, `■ ${nota}`);
  await query(`UPDATE flujo_ejecuciones SET estado=$1, fin=now() WHERE id=$2`, [estado, ejId]);
}
function resumenNodo(n: any): string {
  return Object.values(n.config || {}).find((v) => v) as string || n.tipo;
}