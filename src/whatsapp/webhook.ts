import crypto from "node:crypto";
import type { Request, Response } from "express";
import { query } from "../db/cliente.js";
import { correrTarea } from "../motor/loop.js";
import { ejecutarTool } from "../motor/ejecutor.js";
import { guardarMensaje } from "../dominio/chat.js";

/** Verificación GET que Meta hace al configurar el webhook. */
export function verificarWebhook(req: Request, res: Response) {
  const modo = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (modo === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    console.log("[whatsapp] Webhook verificado por Meta ✓");
    res.status(200).send(challenge);
  } else {
    console.warn("[whatsapp] Verificación rechazada (token no coincide)");
    res.sendStatus(403);
  }
}

/** Firma HMAC de Meta. Si no hay APP_SECRET configurado, deja pasar (modo prueba). */
function firmaValida(rawBody: Buffer, header: string | undefined): boolean {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret) return true;
  if (!header?.startsWith("sha256=")) return false;
  const esperado = header.slice(7);
  const calculado = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(calculado), b = Buffer.from(esperado);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Dedup de mensajes (Meta reintenta la entrega).
const vistos = new Map<string, true>();
function esNuevo(id: string | undefined): boolean {
  if (!id) return true;
  if (vistos.has(id)) return false;
  vistos.set(id, true);
  if (vistos.size > 5000) vistos.delete(vistos.keys().next().value!);
  return true;
}

/** Busca el agente que responde WhatsApp: el que tenga la skill de whatsapp, o un administrador activo. */
async function agenteHub(): Promise<any | undefined> {
  // Preferimos un agente activo que tenga asignada una skill de whatsapp.
  const activos = await query<any>(`SELECT * FROM agentes WHERE estado='activo'`);
  for (const a of activos) {
    const ids = a.skills?.ids || [];
    if (ids.length) {
      const skills = await query<any>(`SELECT nombre, secciones FROM skills WHERE id = ANY($1::uuid[])`, [ids]);
      if (skills.some((s) => (s.nombre + JSON.stringify(s.secciones)).toLowerCase().includes("whatsapp"))) return a;
    }
  }
  return activos[0]; // fallback: cualquier agente activo
}

export async function recibirMensaje(req: Request, res: Response) {
  const rawBody: Buffer | undefined = (req as any).rawBody;
  if (rawBody && !firmaValida(rawBody, req.header("X-Hub-Signature-256"))) {
    console.warn("[whatsapp] Firma HMAC inválida — rechazado.");
    return res.sendStatus(401);
  }
  res.sendStatus(200); // Meta espera 200 inmediato

  try {
    const value = req.body?.entry?.[0]?.changes?.[0]?.value;
    const mensaje = value?.messages?.[0];
    if (!mensaje) return; // notificación de estado, no un mensaje

    if (!esNuevo(mensaje.id)) { console.log(`[whatsapp] Duplicado ignorado`); return; }

    const texto = mensaje.text?.body ?? "";
    const numero = mensaje.from;
    console.log(`[whatsapp] Entrante de ${numero}: "${texto}"`);

    const hub = await agenteHub();
    if (!hub) { console.error("[whatsapp] No hay agente activo para responder."); return; }
    if (hub.estado !== "activo") return;

    // Guardar el mensaje entrante en el chat del agente.
    await guardarMensaje(hub.id, "usuario", `[WhatsApp de ${numero}] ${texto}`);

    // El agente procesa y responde USANDO SU SKILL de WhatsApp directamente.
    // Instrucción clara: la respuesta al usuario es SOLO el mensaje que manda
    // por la tool — nada de reportes ni relatos de lo que hizo.
    const instruccion = `Te llegó este mensaje de WhatsApp del número ${numero}: "${texto}".
Respondele de forma natural y directa, en tu personalidad, USANDO tu herramienta de WhatsApp para enviarle el mensaje al número ${numero}.
IMPORTANTE: el mensaje que le envíes es tu respuesta completa. NO agregues reportes, ni resúmenes de lo que hiciste, ni detalles técnicos. Escribile como si fuera una conversación normal.`;

    const resultado = await correrTarea(hub.id, instruccion);

    // Guardar en el chat del panel el mensaje REAL que Emilia envió por
    // WhatsApp (no el "Listo." de cierre). Así el panel refleja la conversación
    // de verdad. Si envió varios, los guardamos todos.
    if (resultado.mensajesEnviados?.length) {
      for (const m of resultado.mensajesEnviados) {
        await guardarMensaje(hub.id, "agente", `[WhatsApp de ${numero}] ${m}`);
      }
    } else {
      await guardarMensaje(hub.id, "agente", resultado.respuesta || "(respondió por WhatsApp)");
    }
    console.log(`[whatsapp] Emilia procesó y respondió vía su skill. ok=${resultado.ok}, tools=${resultado.toolCalls}`);

    // Red de seguridad: si NO usó ninguna tool (no envió nada real), enviamos
    // su texto para que el usuario no quede sin respuesta.
    if (resultado.toolCalls === 0) {
      const [toolWa] = await query<any>(`SELECT * FROM tools WHERE descripcion ILIKE '%whatsapp%' OR nombre ILIKE '%whatsapp%' LIMIT 1`);
      if (toolWa && resultado.respuesta) {
        await ejecutarTool(toolWa, { destino: numero, mensaje: resultado.respuesta });
        console.log(`[whatsapp] Red de seguridad: envié la respuesta porque no usó tool.`);
      }
    }
  } catch (e) {
    console.error("[whatsapp] Error procesando:", e);
  }
}