// ARCHIVO: src/arca/env.ts
// Escribir llaves en el .env sin pasar nunca por un modelo: lo usan la terminal
// de Arca (npm run arca) y el formulario local del panel (/arca).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const RUTA_ENV = () => path.resolve(process.env.ENV_ARCHIVO || ".env");

/** Las únicas variables que Arca puede escribir (con cómo se piden y se prueban). */
export interface Variable { nombre: string; pregunta: string; secreto: boolean; chequeo: string; generar?: () => string; validar?: (v: string) => string | null }
const digitos = (v: string) => (/^\d{8,15}$/.test(v.replace(/\D/g, "")) ? null : "Solo dígitos con código de país (57…).");
export const VARIABLES: Variable[] = [
  { nombre: "DATABASE_URL", pregunta: "URL de la base (postgresql://postgres:CLAVE@localhost:5432/emilia)", secreto: true, chequeo: "postgres", validar: (v) => (/^postgres(ql)?:\/\//.test(v) ? null : "Tiene que empezar con postgresql://") },
  { nombre: "GROQ_API_KEY", pregunta: "Llave de Groq (gsk_…)", secreto: true, chequeo: "groq", validar: (v) => (/^gsk_/.test(v) ? null : "Las de Groq empiezan con gsk_") },
  { nombre: "ANTHROPIC_API_KEY", pregunta: "Llave de Claude (sk-ant-…)", secreto: true, chequeo: "anthropic", validar: (v) => (/^sk-ant-/.test(v) ? null : "Las de Anthropic empiezan con sk-ant-") },
  { nombre: "WHATSAPP_TOKEN", pregunta: "Token permanente de WhatsApp (EAA…)", secreto: true, chequeo: "wa_token" },
  { nombre: "WHATSAPP_PHONE_ID", pregunta: "Identificador del número de teléfono (solo dígitos)", secreto: false, chequeo: "wa_token", validar: (v) => (/^\d{6,}$/.test(v) ? null : "Son solo dígitos") },
  { nombre: "WHATSAPP_WABA_ID", pregunta: "Identificador de la cuenta de WhatsApp Business", secreto: false, chequeo: "wa_plantillas", validar: (v) => (/^\d{6,}$/.test(v) ? null : "Son solo dígitos") },
  { nombre: "WHATSAPP_APP_SECRET", pregunta: "App Secret de tu app de Meta", secreto: true, chequeo: "wa_seguridad" },
  { nombre: "WHATSAPP_VERIFY_TOKEN", pregunta: "Verify token (Enter = te genero uno)", secreto: false, chequeo: "wa_seguridad", generar: () => `emilia-${crypto.randomBytes(9).toString("base64url")}` },
  { nombre: "WHATSAPP_NUMERO_JEFE", pregunta: "Tu número de WhatsApp (57…)", secreto: false, chequeo: "wa_seguridad", validar: digitos },
  { nombre: "WHATSAPP_PLANTILLA_IDIOMA", pregunta: "Idioma con el que Meta aprobó tus plantillas (es, en, es_MX…)", secreto: false, chequeo: "wa_plantillas", validar: (v) => (/^[a-z]{2}(_[A-Z]{2})?$/.test(v) ? null : "Ej: es, en, es_MX") },
  { nombre: "NGROK_AUTHTOKEN", pregunta: "Authtoken de ngrok", secreto: true, chequeo: "tunel" },
  { nombre: "NGROK_DOMAIN", pregunta: "Tu dominio fijo de ngrok (algo.ngrok-free.app)", secreto: false, chequeo: "tunel", validar: (v) => (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(v) ? null : "Solo el dominio, sin https://") },
  { nombre: "GOOGLE_CLIENT_ID", pregunta: "ID de cliente OAuth de Google", secreto: false, chequeo: "google" },
  { nombre: "GOOGLE_CLIENT_SECRET", pregunta: "Secreto del cliente OAuth de Google", secreto: true, chequeo: "google" },
  { nombre: "CORREO_1_USUARIO", pregunta: "Correo personal (Gmail)", secreto: false, chequeo: "correo" },
  { nombre: "CORREO_1_CLAVE", pregunta: "Contraseña de aplicación de ese correo", secreto: true, chequeo: "correo" },
  { nombre: "CORREO_2_USUARIO", pregunta: "Correo de la empresa (Enter si no)", secreto: false, chequeo: "correo" },
  { nombre: "CORREO_2_CLAVE", pregunta: "Contraseña de aplicación del correo de la empresa", secreto: true, chequeo: "correo" },
  { nombre: "RAILWAY_TOKEN", pregunta: "Token de cuenta de Railway", secreto: true, chequeo: "railway" },
  { nombre: "GITHUB_TOKEN", pregunta: "Token de GitHub (github_pat_…)", secreto: true, chequeo: "github" },
  { nombre: "ANY_URL", pregunta: "URL del panel de Any", secreto: false, chequeo: "any" },
  { nombre: "ANY_USUARIO", pregunta: "Usuario de Any", secreto: false, chequeo: "any" },
  { nombre: "ANY_CLAVE", pregunta: "Clave de Any", secreto: true, chequeo: "any" },
  { nombre: "PG_BIN", pregunta: "Carpeta bin de PostgreSQL (C:\\Program Files\\PostgreSQL\\16\\bin)", secreto: false, chequeo: "pg_dump" },
  { nombre: "COPIAS_DIR", pregunta: "Carpeta para las copias (ideal: dentro de OneDrive)", secreto: false, chequeo: "copias" },
];
export const variable = (n: string) => VARIABLES.find((v) => v.nombre === n);
export const variablesDe = (chequeo: string) => VARIABLES.filter((v) => v.chequeo === chequeo);

function comillas(v: string) { return /[\s#"'\\]/.test(v) ? `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"` : v; }

/** Pone (o cambia) una variable en el .env, conservando el resto del archivo. */
export function escribirVariable(nombre: string, valor: string): void {
  const def = variable(nombre);
  if (!def) throw new Error(`Arca no escribe ${nombre} (solo las variables de la instalación).`);
  const v = valor.trim();
  if (/[\r\n]/.test(v)) throw new Error("El valor no puede tener saltos de línea.");
  const err = def.validar?.(v); if (err) throw new Error(err);
  const ruta = RUTA_ENV();
  if (!fs.existsSync(ruta)) { const ej = path.resolve(".env.example"); fs.writeFileSync(ruta, fs.existsSync(ej) ? fs.readFileSync(ej, "utf8") : ""); }
  const lineas = fs.readFileSync(ruta, "utf8").split(/\r?\n/);
  const re = new RegExp(`^\\s*#?\\s*${nombre}\\s*=`);
  const i = lineas.findIndex((l) => re.test(l) && !/^\s*#.*#/.test(l));
  const nueva = `${nombre}=${comillas(v)}`;
  if (i >= 0) lineas[i] = nueva; else lineas.push(nueva);
  fs.writeFileSync(ruta, lineas.join(process.platform === "win32" ? "\r\n" : "\n"));
  process.env[nombre] = v;
}

/** Copia .env.example a .env si no existe. */
export function asegurarEnv(): boolean {
  const ruta = RUTA_ENV();
  if (fs.existsSync(ruta)) return false;
  const ej = path.resolve(".env.example");
  fs.writeFileSync(ruta, fs.existsSync(ej) ? fs.readFileSync(ej, "utf8") : "");
  return true;
}
