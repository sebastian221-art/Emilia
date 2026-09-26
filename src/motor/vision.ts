// ARCHIVO: src/motor/vision.ts
// ─────────────────────────────────────────────────────────────────────────────
//  VISIÓN — entender imágenes con el modelo multimodal de Groq
//  Una imagen se convierte en palabras (descripción o respuesta a una
//  pregunta) y esas palabras entran al motor normal. Sirve para fotos por
//  WhatsApp, pantallazos de errores para el Senior y, después, capturas de
//  pantalla para el control del PC.
//  .env: GROQ_VISION_MODEL (por defecto qwen/qwen3.8-27b)
//  Lecciones de Any (chat_bot_cc): base64 en image_url, tokens suficientes
//  para que no se corte, /no_think + limpiar <think>, fallo con gracia.
// ─────────────────────────────────────────────────────────────────────────────

import Groq from "groq-sdk";

const MODELO_VISION = () => process.env.GROQ_VISION_MODEL || "qwen/qwen3.8-27b";
let cliente: Groq | null = null;
const groq = () => (cliente ||= new Groq({ apiKey: process.env.GROQ_API_KEY }));

export interface OpcionesVision {
  /** Pregunta o instrucción; si se omite, describe la imagen. */
  pregunta?: string;
  /** Contexto extra (ej. el caption que mandó el jefe). */
  contexto?: string;
  /** Pedir la respuesta como JSON (objeto). */
  json?: boolean;
  maxTokens?: number;
}

export interface ResultadoVision { ok: boolean; texto?: string; json?: any; error?: string; modelo: string }

function limpiarPensamiento(t: string): string {
  return t.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/^\s*\/no_think\s*/i, "").trim();
}

/** Analiza 1 a 3 imágenes (buffers) con una pregunta o pidiendo descripción. */
export async function analizarImagenes(imagenes: { contenido: Buffer; mime: string }[], op: OpcionesVision = {}): Promise<ResultadoVision> {
  const modelo = MODELO_VISION();
  if (!process.env.GROQ_API_KEY) return { ok: false, error: "Falta GROQ_API_KEY.", modelo };
  if (!imagenes.length) return { ok: false, error: "No hay imágenes.", modelo };
  if (imagenes.length > 3) imagenes = imagenes.slice(0, 3);

  const instruccion = op.pregunta?.trim()
    || "Describí esta imagen en español, en 2 a 5 líneas, con lo que importa: qué es, texto visible (transcribilo literal si es un error, un código o un dato), números, estado. Sin adornos.";
  const texto = [
    "/no_think",
    instruccion,
    op.contexto ? `Contexto de quien la envía: ${op.contexto}` : "",
    op.json ? "Respondé ÚNICAMENTE con un objeto JSON válido, sin texto alrededor." : "",
  ].filter(Boolean).join("\n");

  const contenido: any[] = [{ type: "text", text: texto }];
  for (const im of imagenes) contenido.push({ type: "image_url", image_url: { url: `data:${im.mime || "image/jpeg"};base64,${im.contenido.toString("base64")}` } });

  try {
    const resp = await groq().chat.completions.create({
      model: modelo,
      messages: [{ role: "user", content: contenido }],
      temperature: 0.2,
      max_completion_tokens: op.maxTokens ?? 900,
      ...(op.json ? { response_format: { type: "json_object" } } : {}),
    } as any);
    const bruto = (resp.choices[0]?.message?.content ?? "").toString();
    const limpio = limpiarPensamiento(bruto);
    if (!limpio) return { ok: false, error: "El modelo de visión no devolvió texto.", modelo };
    if (op.json) {
      try { return { ok: true, texto: limpio, json: JSON.parse(limpio.replace(/```json|```/g, "").trim()), modelo }; }
      catch { return { ok: true, texto: limpio, modelo }; }
    }
    return { ok: true, texto: limpio, modelo };
  } catch (e: any) {
    const msg = e?.error?.message || e?.message || String(e);
    return { ok: false, error: `Visión (${modelo}): ${msg}`, modelo };
  }
}

/** Atajo: una imagen. */
export const analizarImagen = (contenido: Buffer, mime: string, op: OpcionesVision = {}) => analizarImagenes([{ contenido, mime }], op);

export const esImagen = (mime: string | undefined | null) => /^image\/(jpeg|jpg|png|webp|gif)/i.test(mime || "");