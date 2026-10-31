// ARCHIVO: src/motor/charla.ts
// ─────────────────────────────────────────────────────────────────────────────
//  CHARLA RÁPIDA — el camino corto para conversar por voz con fluidez.
//  Sin herramientas, en streaming: cada frase que el modelo termina se sintetiza
//  y se manda enseguida, mientras sigue escribiendo la siguiente. Si para
//  responder hace falta una herramienta (datos reales), el modelo contesta
//  "[[HERRAMIENTA]]" y se cae al camino completo (correrTarea), más lento.
// ─────────────────────────────────────────────────────────────────────────────
import { query } from "../db/cliente.js";
import { armarSistema, correrTarea } from "./loop.js";
import { herramientasDeAgente } from "./herramientas.js";
import { historialParaModelo } from "./memoria.js";
import { llamarModelo } from "./groq.js";
import { registrarConsumo } from "./presupuesto.js";
import { obtenerConversacion, guardarMensajeEn } from "../dominio/conversaciones.js";
import { sintetizar, prepararTexto } from "./voz.js";

const MARCA = "[[HERRAMIENTA]]";
const REGLA_RAPIDA = `RESPUESTA RÁPIDA SIN HERRAMIENTAS: en este turno NO tenés herramientas. Si para contestar bien necesitás datos reales del sistema (estado de un envío, logs, archivos, mandar algo, agendar, recordar algo que no está en tu memoria), respondé EXACTAMENTE ${MARCA} y nada más: el sistema te vuelve a llamar con herramientas. Si es charla, opinión, recuerdo o algo que ya sabés, respondé directo.`;

export interface EventoCharla { tipo: "parcial" | "frase" | "audio" | "herramienta" | "fin" | "error"; texto?: string; audio?: string; mime?: string; indice?: number; ms?: number }

function partirFrases(buffer: string): { frases: string[]; resto: string } {
  // corta en . ! ? … seguidos de espacio/fin, o en coma si la frase ya es larga
  const frases: string[] = []; let resto = buffer;
  while (true) {
    const m = resto.match(/^([\s\S]*?[.!?…]+["»)]?)(\s+|$)/);
    if (m && m[1].trim().length >= 2) { frases.push(m[1].trim()); resto = resto.slice(m[0].length); continue; }
    if (resto.length > 160) { const c = resto.lastIndexOf(", ", 160); if (c > 40) { frases.push(resto.slice(0, c + 1).trim()); resto = resto.slice(c + 2); continue; } }
    break;
  }
  return { frases, resto };
}

/** Charla por voz: streaming de frases con audio. Devuelve el texto completo. */
export async function charlar(p: { agenteId: string; conversacionId: string; texto: string; contextoCanal: string; emitir: (e: EventoCharla) => void; conVoz?: boolean }): Promise<string> {
  const t0 = Date.now();
  const [ag] = await query<any>(`SELECT * FROM agentes WHERE id=$1`, [p.agenteId]);
  const conv = await obtenerConversacion(p.conversacionId);
  const { invocables } = await herramientasDeAgente(p.agenteId);
  const sistema = `${await armarSistema(ag, invocables, conv ?? undefined, p.contextoCanal, p.texto)}\n\n${REGLA_RAPIDA}`;
  const mensajes: any[] = [{ role: "system", content: sistema }];
  if (conv) mensajes.push(...await historialParaModelo(conv, ag.memoria));
  mensajes.push({ role: "user", content: p.texto });
  await guardarMensajeEn(conv!, "usuario", p.texto);

  // ── Pipeline de voz: frases → audio en orden, sin esperar a que termine el texto ──
  let indice = 0; let cola: Promise<void> = Promise.resolve(); let buffer = ""; let completo = "";
  const sintetizarFrase = (frase: string) => {
    const i = indice++;
    p.emitir({ tipo: "frase", texto: frase, indice: i });
    if (p.conVoz === false) return;
    cola = cola.then(async () => {
      const limpio = prepararTexto(frase); if (!limpio) return;
      const t = Date.now(); const v = await sintetizar(limpio);
      if (v.ok && v.audio) p.emitir({ tipo: "audio", audio: v.audio.contenido.toString("base64"), mime: v.audio.mime, indice: i, ms: Date.now() - t });
      else p.emitir({ tipo: "error", texto: v.error, indice: i });
    }).catch((e) => p.emitir({ tipo: "error", texto: String(e?.message || e) }));
  };
  const onDelta = (d: string) => {
    completo += d; buffer += d;
    if (completo.trim().startsWith("[[")) return;   // puede ser la marca: no cortar frases todavía
    const { frases, resto } = partirFrases(buffer);
    for (const f of frases) sintetizarFrase(f);
    buffer = resto;
  };

  const modelo = ag.cerebro?.planificador || ag.cerebro?.ejecutor || "openai/gpt-oss-120b";
  const claudeActiva = /^(claude|anthropic):/i.test(modelo) && !!process.env.ANTHROPIC_API_KEY && (process.env.CLAUDE_API_ACTIVA || "true").toLowerCase() !== "false";
  let texto = "";
  try {
    if (claudeActiva) {
      const { streamClaude } = await import("./anthropic.js");
      const r = await streamClaude(mensajes, { modelo, onDelta });
      texto = r.texto; registrarConsumo({ agenteId: p.agenteId, proveedor: "anthropic", modelo: r.uso.modelo, tokensIn: r.uso.entrada, tokensOut: r.uso.salida, cacheLectura: r.uso.cacheLectura, cacheEscritura: r.uso.cacheEscritura }).catch(() => {});
    } else {
      const r = await llamarModelo(mensajes, [], { modelo, temperatura: 0.7 });
      texto = r.texto; onDelta(r.texto);
    }
  } catch (e: any) { p.emitir({ tipo: "error", texto: e?.message || String(e) }); throw e; }

  // ── ¿Pidió herramientas? → camino completo ──
  if (texto.replace(/\s/g, "").includes(MARCA.replace(/\s/g, ""))) {
    p.emitir({ tipo: "herramienta", texto: "Dame un segundo, lo miro." });
    if (p.conVoz !== false) sintetizarFrase("Dame un segundo, lo miro.");
    const r = await correrTarea(p.agenteId, p.texto, { conversacionId: p.conversacionId, origen: "panel", conversacion: true, contextoCanal: p.contextoCanal });
    texto = (r.respuesta || "").trim();
    const { frases, resto } = partirFrases(texto + " ");
    for (const f of frases) sintetizarFrase(f);
    if (resto.trim()) sintetizarFrase(resto.trim());
    await guardarMensajeEn(conv!, "agente", texto);
  } else {
    const resto = buffer.trim(); if (resto && !resto.startsWith("[[")) sintetizarFrase(resto);
    await guardarMensajeEn(conv!, "agente", texto);
    await query(`INSERT INTO ejecuciones (agente_id, estado, conversacion_id, origen, respuesta, turnos_usados, tool_calls, fin) VALUES ($1,'completada',$2,'panel',$3,1,0,now())`, [p.agenteId, p.conversacionId, texto]).catch(() => {});
  }
  await cola;
  p.emitir({ tipo: "fin", texto, ms: Date.now() - t0 });
  return texto;
}