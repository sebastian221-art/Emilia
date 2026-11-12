// ARCHIVO: src/motor/google.ts
// ─────────────────────────────────────────────────────────────────────────────
//  GOOGLE CALENDAR (Iris escribe tu agenda ahí). Conexión OAuth una sola vez:
//    1. En console.cloud.google.com: proyecto → habilitar "Google Calendar API" →
//       Pantalla de consentimiento (Externo, en PRODUCCIÓN para que no venza a los
//       7 días; agrega tu correo) → Credenciales → ID de cliente OAuth tipo
//       "App de escritorio". Copia el ID y el secreto al .env:
//       GOOGLE_CLIENT_ID=…  GOOGLE_CLIENT_SECRET=…
//    2. npm run google:conectar  → abre el enlace, aceptas, y queda guardado.
//  Solo pide permiso de eventos del calendario (calendar.events), nada más.
// ─────────────────────────────────────────────────────────────────────────────
import { query } from "../db/cliente.js";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API = "https://www.googleapis.com/calendar/v3";
export const ALCANCE_CALENDARIO = "https://www.googleapis.com/auth/calendar.events";

interface CuentaGoogle { refresh_token: string; correo?: string; calendario?: string }
let acceso: { token: string; vence: number } | null = null;

export async function cuentaGoogle(): Promise<CuentaGoogle | null> {
  const [f] = await query<{ valor: any }>(`SELECT valor FROM iris_config WHERE clave = 'google'`).catch(() => [] as any[]);
  return f?.valor?.refresh_token ? f.valor : null;
}
export const googleConfigurado = () => !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

async function tokenAcceso(): Promise<string | null> {
  if (acceso && Date.now() < acceso.vence - 60_000) return acceso.token;
  const cuenta = await cuentaGoogle();
  if (!cuenta || !googleConfigurado()) return null;
  const r = await fetch(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!, refresh_token: cuenta.refresh_token, grant_type: "refresh_token" }), signal: AbortSignal.timeout(20_000) });
  const d: any = await r.json().catch(() => ({}));
  if (!r.ok || !d.access_token) throw new Error(`Google no renovó el acceso (${d.error || r.status}${d.error === "invalid_grant" ? ": vuelve a conectar con npm run google:conectar" : ""}).`);
  acceso = { token: d.access_token, vence: Date.now() + (Number(d.expires_in) || 3600) * 1000 };
  return acceso.token;
}

async function calendario<T = any>(metodo: string, ruta: string, cuerpo?: unknown): Promise<T> {
  const token = await tokenAcceso();
  if (!token) throw new Error("Google Calendar no está conectado.");
  const r = await fetch(`${API}${ruta}`, { method: metodo, headers: { Authorization: `Bearer ${token}`, ...(cuerpo ? { "Content-Type": "application/json" } : {}) }, body: cuerpo ? JSON.stringify(cuerpo) : undefined, signal: AbortSignal.timeout(20_000) });
  if (r.status === 204 || r.status === 410) return {} as T;
  const d: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Google Calendar: ${d.error?.message || r.status}`);
  return d;
}

export interface EventoAgenda { titulo: string; inicio: string | null; fin: string | null; todo_el_dia: boolean; lugar: string | null; notas: string | null; tipo: string; google_id: string | null }

function aEvento(e: EventoAgenda) {
  const ini = new Date(e.inicio!), fin = e.fin ? new Date(e.fin) : new Date(ini.getTime() + (e.tipo === "cita" ? 60 : 30) * 60_000);
  const dia = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
  return {
    summary: `${e.tipo === "compromiso" ? "🤝 " : e.tipo === "vencimiento" ? "⏳ " : e.tipo === "tarea" ? "✅ " : ""}${e.titulo}`,
    location: e.lugar || undefined, description: `${e.notas || ""}\n\n(Agendado por Iris)`.trim(),
    ...(e.todo_el_dia ? { start: { date: dia(ini) }, end: { date: dia(new Date(ini.getTime() + 86400_000)) } } : { start: { dateTime: ini.toISOString(), timeZone: "America/Bogota" }, end: { dateTime: fin.toISOString(), timeZone: "America/Bogota" } }),
    reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 30 }] },
  };
}

/** Crea o actualiza el evento en Google Calendar. Devuelve el id de Google, o null si no está conectado. */
export async function sincronizarEvento(e: EventoAgenda): Promise<string | null> {
  if (!e.inicio || !(await cuentaGoogle()) || !googleConfigurado()) return null;
  const cal = encodeURIComponent((await cuentaGoogle())?.calendario || "primary");
  if (e.google_id) { await calendario("PATCH", `/calendars/${cal}/events/${encodeURIComponent(e.google_id)}`, aEvento(e)); return e.google_id; }
  const r = await calendario<{ id: string }>("POST", `/calendars/${cal}/events`, aEvento(e));
  return r.id;
}
export async function borrarEvento(googleId: string): Promise<void> {
  if (!(await cuentaGoogle()) || !googleConfigurado()) return;
  const cal = encodeURIComponent((await cuentaGoogle())?.calendario || "primary");
  await calendario("DELETE", `/calendars/${cal}/events/${encodeURIComponent(googleId)}`);
}
/** Eventos de Google en un rango (para el resumen del día: lo que el jefe agendó por su cuenta). */
export async function eventosGoogle(desde: Date, hasta: Date): Promise<{ titulo: string; inicio: string; lugar?: string; id: string }[]> {
  if (!(await cuentaGoogle()) || !googleConfigurado()) return [];
  const cal = encodeURIComponent((await cuentaGoogle())?.calendario || "primary");
  const d = await calendario<any>("GET", `/calendars/${cal}/events?singleEvents=true&orderBy=startTime&timeMin=${encodeURIComponent(desde.toISOString())}&timeMax=${encodeURIComponent(hasta.toISOString())}&maxResults=50`);
  return (d.items || []).map((x: any) => ({ id: x.id, titulo: x.summary || "(sin título)", inicio: x.start?.dateTime || x.start?.date, lugar: x.location }));
}
