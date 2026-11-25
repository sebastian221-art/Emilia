// ARCHIVO: src/seguridad/secretos.ts
// Que ninguna llave termine en un log, en una traza del panel o en el repo.
//  · redactar(texto): tapa los valores reales de las variables secretas del .env
//    y cualquier cosa con forma de llave conocida.
//  · instalarRedaccionLogs(): envuelve console.* al arrancar.
//  · escanear(archivos): para el escáner (npm run secretos) y para Arca.

/** Formas conocidas de llaves (aunque no estén en el .env). */
export const PATRONES: { nombre: string; re: RegExp }[] = [
  { nombre: "Anthropic", re: /sk-ant-[A-Za-z0-9_-]{20,}/g },
  { nombre: "Groq", re: /gsk_[A-Za-z0-9]{20,}/g },
  { nombre: "OpenAI", re: /sk-(?:proj-)?[A-Za-z0-9]{32,}/g },
  { nombre: "GitHub", re: /(?:ghp|gho|ghs|ghu|ghr)_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}/g },
  { nombre: "Meta/WhatsApp", re: /EAA[A-Za-z0-9]{60,}/g },
  { nombre: "Google OAuth", re: /ya29\.[A-Za-z0-9_-]{30,}|1\/\/0[A-Za-z0-9_-]{30,}|GOCSPX-[A-Za-z0-9_-]{20,}/g },
  { nombre: "AWS", re: /AKIA[0-9A-Z]{16}/g },
  { nombre: "ngrok", re: /\b2[A-Za-z0-9]{24,}_[A-Za-z0-9]{20,}\b/g },
  { nombre: "Llave privada", re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
  { nombre: "URL con contraseña", re: /\b(?:postgres(?:ql)?|mysql|redis|mongodb(?:\+srv)?):\/\/[^:\s/]+:[^@\s]{3,}@/g },
];

const NOMBRE_SECRETO = /(KEY|TOKEN|SECRET|PASSWORD|PASS|LLAVE|CLAVE|CREDENCIAL|AUTH)/i;

let valores: string[] | null = null;
function valoresSecretos(): string[] {
  if (valores) return valores;
  valores = Object.entries(process.env)
    .filter(([k, v]) => NOMBRE_SECRETO.test(k) && typeof v === "string" && v.length >= 8 && !/^(true|false|\d+)$/i.test(v))
    .map(([, v]) => v as string)
    .sort((a, b) => b.length - a.length);
  return valores;
}
export function _olvidarValores() { valores = null; }

export function redactar(texto: string): string {
  if (!texto) return texto;
  let t = texto;
  for (const v of valoresSecretos()) if (t.includes(v)) t = t.split(v).join("«secreto»");
  for (const p of PATRONES) t = t.replace(p.re, (m) => (p.nombre === "URL con contraseña" ? m.replace(/:[^:@/]+@$/, ":«secreto»@") : "«secreto»"));
  return t;
}

let instalada = false;
export function instalarRedaccionLogs() {
  if (instalada) return; instalada = true;
  for (const m of ["log", "info", "warn", "error", "debug"] as const) {
    const orig = console[m].bind(console);
    console[m] = (...args: any[]) => orig(...args.map((a) => (typeof a === "string" ? redactar(a) : a instanceof Error ? Object.assign(a, { message: redactar(a.message) }) : a)));
  }
}

export interface Hallazgo { archivo: string; linea: number; tipo: string; muestra: string }

/** Busca llaves en archivos de texto. `contenido` permite escanear sin disco (pruebas). */
export function escanearTexto(archivo: string, contenido: string): Hallazgo[] {
  const hs: Hallazgo[] = [];
  const lineas = contenido.split("\n");
  lineas.forEach((l, i) => {
    for (const p of PATRONES) {
      p.re.lastIndex = 0;
      const m = p.re.exec(l);
      if (m && !/«secreto»|\$\{[A-Z_]+\}|ejemplo|EXAMPLE|xxxx|:(tu_?clave|password|contrase[nñ]a|clave|postgres|cambiame)@/i.test(m[0])) hs.push({ archivo, linea: i + 1, tipo: p.nombre, muestra: m[0].slice(0, 6) + "…" });
    }
    for (const v of valoresSecretos()) if (v.length >= 12 && l.includes(v)) hs.push({ archivo, linea: i + 1, tipo: "valor real del .env", muestra: v.slice(0, 4) + "…" });
  });
  return hs;
}
