// ARCHIVO: src/motor/voz.ts
// ─────────────────────────────────────────────────────────────────────────────
//  VOZ — oír y hablar
//  Oír: Whisper en Groq (whisper-large-v3-turbo), español, rápido.
//  Hablar: proveedor configurable.
//    - edge (por defecto, gratis): voces neurales de Microsoft. Requiere
//      `npm install msedge-tts`. Voz por defecto es-CO-SalomeNeural.
//    - elevenlabs: la voz que elijas o clones. Requiere ELEVENLABS_API_KEY y
//      ELEVENLABS_VOICE_ID.
//  .env: VOZ_PROVEEDOR=edge|elevenlabs, VOZ_EDGE_VOZ, VOZ_EDGE_VELOCIDAD,
//        ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID, ELEVENLABS_MODELO
// ─────────────────────────────────────────────────────────────────────────────

import Groq from "groq-sdk";

let cliente: Groq | null = null;
const groq = () => (cliente ||= new Groq({ apiKey: process.env.GROQ_API_KEY }));

// ─── Oír ─────────────────────────────────────────────────────────────────────
export async function transcribir(contenido: Buffer, mime: string, idioma = "es"): Promise<{ ok: boolean; texto?: string; error?: string }> {
  if (!process.env.GROQ_API_KEY) return { ok: false, error: "Falta GROQ_API_KEY." };
  try {
    const ext = mime.includes("ogg") ? "ogg" : mime.includes("mp4") || mime.includes("m4a") ? "m4a" : mime.includes("wav") ? "wav" : "mp3";
    const archivo = new File([new Uint8Array(contenido)], `audio.${ext}`, { type: mime });
    const r = await groq().audio.transcriptions.create({
      file: archivo as any,
      model: process.env.GROQ_STT_MODEL || "whisper-large-v3-turbo",
      language: idioma,
      response_format: "json",
      temperature: 0,
    });
    const texto = (r as any).text?.trim();
    return texto ? { ok: true, texto } : { ok: false, error: "No se entendió el audio (vacío)." };
  } catch (e: any) {
    return { ok: false, error: `Transcripción: ${e?.error?.message || e?.message || String(e)}` };
  }
}

// ─── Hablar ──────────────────────────────────────────────────────────────────
export interface Audio { contenido: Buffer; mime: string; nombre: string }

export async function sintetizar(texto: string): Promise<{ ok: boolean; audio?: Audio; error?: string; proveedor: string }> {
  const proveedor = (process.env.VOZ_PROVEEDOR || "edge").toLowerCase();
  const limpio = prepararTexto(texto);
  if (!limpio) return { ok: false, error: "Nada que decir.", proveedor };
  try {
    if (proveedor === "elevenlabs") return { ok: true, audio: await elevenlabs(limpio), proveedor };
    return { ok: true, audio: await edge(limpio), proveedor };
  } catch (e: any) {
    return { ok: false, error: `Voz (${proveedor}): ${e?.message || String(e)}`, proveedor };
  }
}

/** Quita lo que no se dice: markdown, emojis, ids largos, URLs. Recorta a un largo razonable de audio. */
export function prepararTexto(t: string): string {
  return (t || "")
    .replace(/```[\s\S]*?```/g, " código omitido ")
    .replace(/[*_~`#>]+/g, "")
    .replace(/https?:\/\/\S+/g, " enlace ")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, " identificador ")
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1500);
}

async function edge(texto: string): Promise<Audio> {
  let mod: any;
  try { mod = await import("msedge-tts"); } catch { throw new Error("Falta el paquete msedge-tts: corré `npm install msedge-tts` (o usá VOZ_PROVEEDOR=elevenlabs)."); }
  const { MsEdgeTTS, OUTPUT_FORMAT } = mod;
  const tts = new MsEdgeTTS();
  const voz = process.env.VOZ_EDGE_VOZ || "es-CO-SalomeNeural";
  await tts.setMetadata(voz, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
  const velocidad = process.env.VOZ_EDGE_VELOCIDAD;   // ej. "+10%"
  const salida = tts.toStream(texto, velocidad ? { rate: velocidad } : undefined);
  const stream = salida.audioStream ?? salida;
  const trozos: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    stream.on("data", (d: Buffer) => trozos.push(Buffer.from(d)));
    stream.on("end", () => resolve());
    stream.on("error", (e: any) => reject(e));
  });
  const contenido = Buffer.concat(trozos);
  if (!contenido.length) throw new Error("Edge TTS no devolvió audio.");
  return { contenido, mime: "audio/mpeg", nombre: "respuesta.mp3" };
}

async function elevenlabs(texto: string): Promise<Audio> {
  const key = process.env.ELEVENLABS_API_KEY, voz = process.env.ELEVENLABS_VOICE_ID;
  if (!key || !voz) throw new Error("Faltan ELEVENLABS_API_KEY o ELEVENLABS_VOICE_ID.");
  const resp = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voz}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({ text: texto, model_id: process.env.ELEVENLABS_MODELO || "eleven_multilingual_v2", voice_settings: { stability: 0.5, similarity_boost: 0.8 } }),
    signal: AbortSignal.timeout(60000),
  });
  if (!resp.ok) throw new Error(`ElevenLabs HTTP ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  return { contenido: Buffer.from(await resp.arrayBuffer()), mime: "audio/mpeg", nombre: "respuesta.mp3" };
}