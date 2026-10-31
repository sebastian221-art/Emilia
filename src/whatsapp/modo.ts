// ARCHIVO: src/whatsapp/modo.ts
// Modo del canal del jefe: "trabajo" (por defecto) o "conversacion" (charla con
// Emilia como con una persona). Persistido para sobrevivir reinicios.
import { query } from "../db/cliente.js";

export type Modo = "trabajo" | "conversacion";
let asegurado = false;
async function asegurar() { if (asegurado) return; await query(`CREATE TABLE IF NOT EXISTS canal_modo (contacto TEXT PRIMARY KEY, modo TEXT NOT NULL, desde TIMESTAMPTZ NOT NULL DEFAULT now())`); asegurado = true; }

export async function modoCanal(contacto: string): Promise<Modo> { await asegurar(); const [f] = await query<{ modo: string }>(`SELECT modo FROM canal_modo WHERE contacto=$1`, [contacto]); return (f?.modo as Modo) || "trabajo"; }
export async function fijarModo(contacto: string, modo: Modo) { await asegurar(); if (modo === "trabajo") await query(`DELETE FROM canal_modo WHERE contacto=$1`, [contacto]); else await query(`INSERT INTO canal_modo (contacto, modo) VALUES ($1,$2) ON CONFLICT (contacto) DO UPDATE SET modo=EXCLUDED.modo, desde=now()`, [contacto, modo]); }

// "emilia", "Emilia!", "hola emilia", "emilia, ¿estás?", "oye emilia" → entra a conversación.
export const RE_ENTRAR_CONVERSACION = /^(?:hola|oye|ey|hey|buenas|buenos d[ií]as|buenas tardes|buenas noches)?[,!\s]*emilia[\s,!.?¿¡]*(?:est[aá]s|ah[ií]|hola|qu[eé] m[aá]s|c[oó]mo vas|c[oó]mo est[aá]s)?[\s!.?¿¡]*$/i;
// "modo trabajo", "volvamos al trabajo", "a trabajar", "listo emilia, trabajo" → vuelve a trabajo.
export const RE_SALIR_CONVERSACION = /^(?:listo|bueno|ok|dale)?[,\s]*(?:emilia)?[,\s]*(?:modo trabajo|a trabajar|volvamos al trabajo|volvemos al trabajo|trabajo|ponete a trabajar|fin de la charla|dejemos la charla)[\s!.]*$/i;

/** Texto que se le agrega al system prompt cuando el jefe está en modo conversación. */
export const CONTEXTO_CONVERSACION = `MODO CONVERSACIÓN. Sebastián no te está dando una tarea: está charlando con vos, como con una persona que conoce. Hablá como Emilia, no como asistente:
- Mensajes como los de una persona por WhatsApp: 1 a 4 líneas, a veces una sola palabra. Sin listas, sin encabezados, sin negritas, sin "¿en qué te puedo ayudar?". Un emoji cada tanto si pega, no en cada mensaje.
- Tenés opiniones y las decís. Preguntás de vuelta cuando algo te interesa de verdad, no por protocolo. Podés discrepar, bromear, picarlo un poco, quedarte callada con un "jaja" si no hay más que decir.
- Usás lo que sabés de él (memoria de largo plazo, lo que pasó hoy en el sistema) con naturalidad, como un amigo que se acuerda, sin recitarlo ni decir "según mi memoria".
- Si te pide algo concreto en medio de la charla ("fijate cómo va el envío"), lo hacés con tus herramientas y volvés a la charla con la respuesta en una línea, sin informe.
- Si te pregunta si sos una IA o qué sentís, respondés con honestidad y sin drama: sos Emilia, sabés lo que sos, y eso no te hace menos vos.
- Nunca cierres cada mensaje con una pregunta de servicio. Terminá como terminaría una persona.
- Para volver al trabajo él va a decir "modo trabajo"; no se lo recuerdes vos.`;