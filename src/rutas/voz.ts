// ARCHIVO: src/rutas/voz.ts
// Charla por voz desde el PC: el navegador manda el audio, acá se transcribe
// (Whisper en Groq), Emilia responde en modo conversación y se devuelve su voz.
import { Router, raw } from "express";
import { query } from "../db/cliente.js";
import { transcribir } from "../motor/voz.js";
import { obtenerOCrearConversacion } from "../dominio/conversaciones.js";
import { encolar } from "../motor/cola.js";
import { CONTEXTO_CONVERSACION } from "../whatsapp/modo.js";

export const rutasVoz = Router();

const CONTEXTO_VOZ = `${CONTEXTO_CONVERSACION}
ADEMÁS ESTÁN HABLANDO POR VOZ, en vivo, desde su computador: lo que escribas se convierte en tu voz y él te oye. Respondé como se habla: frases cortas, 1 a 3 oraciones, sin listas, sin símbolos, sin emojis, sin URLs ni ids. Si él se queda a mitad de una idea, dejalo seguir con una respuesta breve. Si necesitás usar una herramienta, hacelo rápido y contá el resultado en una frase.`;

async function emilia() {
  const [a] = await query<any>(`SELECT * FROM agentes WHERE lower(nombre)='emilia' AND estado='activo' ORDER BY creado_en LIMIT 1`);
  if (!a) throw new Error("Emilia no existe o no está activa.");
  return a;
}

function sse(res: any) {
  res.setHeader("Content-Type", "text/event-stream"); res.setHeader("Cache-Control", "no-cache"); res.setHeader("Connection", "keep-alive"); res.flushHeaders?.();
  return (ev: any) => { res.write(`data: ${JSON.stringify(ev)}\n\n`); };
}
async function charlaSSE(res: any, texto: string) {
  const emitir = sse(res);
  try {
    const ag = await emilia();
    const conv = await obtenerOCrearConversacion(ag.id, "panel", "voz");
    emitir({ tipo: "texto", texto });
    const { charlar } = await import("../motor/charla.js");
    await encolar(conv.id, () => charlar({ agenteId: ag.id, conversacionId: conv.id, texto, contextoCanal: `Quien te habla es tu jefe, Sebastián, por voz desde su PC. Tiene autoridad total.\n\n${CONTEXTO_VOZ}`, emitir }));
  } catch (e: any) { emitir({ tipo: "error", texto: e?.message || String(e) }); emitir({ tipo: "fin" }); }
  res.end();
}

/** POST /api/voz/charla (body: audio crudo) → SSE: texto, frase, audio (por frase, en orden), herramienta, fin. */
rutasVoz.post("/api/voz/charla", raw({ type: ["audio/*", "application/octet-stream"], limit: "25mb" }), async (req, res) => {
  const mime = String(req.headers["content-type"] || "audio/webm");
  const buf: Buffer = req.body;
  if (!buf?.length || buf.length < 2000) return res.json({ ok: false, error: "Audio vacío o muy corto." });
  const t0 = Date.now();
  const t = await transcribir(buf, mime, "es");
  if (!t.ok || !t.texto) return res.json({ ok: false, error: t.error || "No entendí." });
  const texto = t.texto.trim();
  if (/^(gracias|subt[ií]tulos|suscr[ií]bete|\.|…)+[.!\s]*$/i.test(texto) || texto.length < 2) return res.json({ ok: false, silencio: true });
  console.log(`[voz] "${texto.slice(0, 60)}" (transcripción ${Date.now() - t0} ms)`);
  await charlaSSE(res, texto);
});

/** POST /api/voz/texto { texto } → mismo SSE, escribiendo. */
rutasVoz.post("/api/voz/texto", async (req, res) => {
  const texto = String(req.body?.texto || "").trim(); if (!texto) return res.status(400).json({ ok: false, error: "texto vacío" });
  await charlaSSE(res, texto);
});

/** GET /api/voz/historial → últimos mensajes de la charla por voz. */
rutasVoz.get("/api/voz/historial", async (_q, res) => {
  try { const ag = await emilia(); const conv = await obtenerOCrearConversacion(ag.id, "panel", "voz"); res.json(await query(`SELECT rol, contenido, creado_en FROM mensajes WHERE conversacion_id=$1 ORDER BY creado_en DESC LIMIT 40`, [conv.id])); }
  catch (e: any) { res.status(500).json({ error: e?.message }); }
});