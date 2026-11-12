// ARCHIVO: src/scripts/conectar-google.ts
// ─────────────────────────────────────────────────────────────────────────────
//  Conecta Google Calendar (una vez):  npm run google:conectar
//  Necesita GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET (ID de cliente OAuth tipo
//  "App de escritorio") en el .env. Abre el enlace, aceptas, y el permiso queda
//  guardado en la base de Emilia. Solo eventos del calendario.
// ─────────────────────────────────────────────────────────────────────────────
import "dotenv/config";
import http from "node:http";
import crypto from "node:crypto";
import { exec } from "node:child_process";
import { query, db } from "../db/cliente.js";
import { ALCANCE_CALENDARIO } from "../motor/google.js";

const id = process.env.GOOGLE_CLIENT_ID, secreto = process.env.GOOGLE_CLIENT_SECRET;
if (!id || !secreto) { console.log("Falta GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET en el .env. Pasos: console.cloud.google.com → habilitar Google Calendar API → Pantalla de consentimiento (Externo, publicar en producción) → Credenciales → ID de cliente OAuth → App de escritorio."); process.exit(1); }
const estado = crypto.randomBytes(16).toString("hex");
const verificador = crypto.randomBytes(48).toString("base64url");
const reto = crypto.createHash("sha256").update(verificador).digest("base64url");

const servidor = http.createServer(async (req, res) => {
  const u = new URL(req.url || "/", "http://127.0.0.1");
  if (u.pathname !== "/") { res.end(); return; }
  if (u.searchParams.get("state") !== estado) { res.end("Estado inválido."); return; }
  const code = u.searchParams.get("code");
  if (!code) { res.end(`Google respondió: ${u.searchParams.get("error")}`); return; }
  const puerto = (servidor.address() as any).port;
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code, client_id: id, client_secret: secreto, redirect_uri: `http://127.0.0.1:${puerto}`, grant_type: "authorization_code", code_verifier: verificador }) });
  const d: any = await r.json();
  if (!d.refresh_token) { res.end(`No llegó el permiso permanente (${d.error || "sin refresh_token"}). Quita el acceso de la app en myaccount.google.com/permissions y vuelve a intentarlo.`); console.log(d); return; }
  let correo: string | undefined;
  try { const cal: any = await (await fetch("https://www.googleapis.com/calendar/v3/calendars/primary", { headers: { Authorization: `Bearer ${d.access_token}` } })).json(); correo = cal.id; } catch { /* opcional */ }
  await query(`INSERT INTO iris_config (clave, valor) VALUES ('google', $1) ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor, actualizado_en = now()`, [JSON.stringify({ refresh_token: d.refresh_token, correo, calendario: "primary" })]);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end("<h2>✅ Google Calendar conectado a Iris. Ya puedes cerrar esta pestaña.</h2>");
  console.log(`✅ Conectado${correo ? ` (${correo})` : ""}. Iris ya puede escribir en tu calendario.`);
  servidor.close(); await db.end(); process.exit(0);
});
servidor.listen(0, "127.0.0.1", () => {
  const puerto = (servidor.address() as any).port;
  const url = `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({ client_id: id, redirect_uri: `http://127.0.0.1:${puerto}`, response_type: "code", scope: ALCANCE_CALENDARIO, access_type: "offline", prompt: "consent", state: estado, code_challenge: reto, code_challenge_method: "S256" })}`;
  console.log(`Abre este enlace y acepta (si no se abre solo):\n\n${url}\n`);
  exec(process.platform === "win32" ? `start "" "${url}"` : `xdg-open "${url}"`, () => {});
});
