// ARCHIVO: src/motor/permisos-codigo.ts
// ─────────────────────────────────────────────────────────────────────────────
//  PERMISOS DE CLAUDE CODE — qué puede hacer solo, qué está prohibido y qué
//  le pregunta al jefe por WhatsApp.
//  Claude Code corre con un hook PreToolUse (scripts/hook-permisos.mjs) que,
//  antes de CADA herramienta, le pregunta a Emilia (/api/interno/permiso).
//  Esta es la única fuente de verdad de la política:
//   - permitir: leer, buscar, editar dentro de su carpeta de trabajo, correr
//     tests/build/scripts locales, las herramientas de Emilia (mcp__emilia__*,
//     que piden su propia aprobación si hace falta).
//   - negar: borrar fuera de su carpeta, leer secretos reales, formatear, etc.
//   - preguntar: push, despliegues, publicar paquetes, ssh, tocar bases que
//     no son locales, escribir fuera de su carpeta. Llega como aprobación por
//     WhatsApp ("ok"/"no") y Claude espera la respuesta.
// ─────────────────────────────────────────────────────────────────────────────
import path from "node:path";
import { query } from "../db/cliente.js";

export type Decision = { decision: "permitir" | "negar" | "preguntar"; motivo: string };
export type Modo = "escritura" | "lectura" | "experimento";

const SOLO_LECTURA = new Set(["Read", "Grep", "Glob", "LS", "NotebookRead", "TodoWrite", "TodoRead", "WebFetch", "WebSearch", "Task", "Agent", "BashOutput", "KillShell", "KillBash", "ExitPlanMode", "ListMcpResourcesTool", "ReadMcpResourceTool", "Skill"]);
const ESCRITURA = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);

const SECRETO = /(^|[\\/])(\.env(\.local|\.production|\.prod)?|id_rsa|id_ed25519|\.ssh|credentials(\.json)?|\.npmrc|\.git-credentials|secrets?\.(json|ya?ml))$/i;
const SECRETO_PERMITIDO = /\.env\.(sandbox|example|lab|test|sample)$/i;

// Comandos que nunca: daño irreversible al sistema.
const PROHIBIDO = [
  /\brm\s+-[a-z]*r[a-z]*f?\s+(\/|~|\$HOME|[a-z]:\\|\.\.)(\s|$|\/)/i, /\brmdir\s+\/s\s+\/q\s+[a-z]:\\?$/i, /\bdel\s+\/[sfq].*[a-z]:\\(\s|$)/i,
  /\bformat\s+[a-z]:/i, /\b(shutdown|reboot|poweroff)\b/i, /\breg\s+(add|delete)\b/i, /\bdiskpart\b/i, /\bmkfs\b/i, /\bdd\s+if=.*of=\/dev/i,
  /:\(\)\s*\{\s*:\|:&\s*\};:/, /\bnet\s+user\b/i, /\bSet-ExecutionPolicy\b/i, /\bcipher\s+\/w/i, /\bvssadmin\s+delete/i,
];
// Comandos con efecto afuera del laboratorio: los decide el jefe.
const PREGUNTAR = [
  [/\bgit\s+push\b/i, "subir código a GitHub"], [/\bgit\s+(reset\s+--hard|clean\s+-[a-z]*f)\b.*\b(origin|main|master)\b/i, "reescribir la rama principal"],
  [/\brailway\s+(up|deploy|redeploy|run|variables\s+set|delete|down)\b/i, "desplegar o cambiar Railway"], [/\b(vercel|netlify|fly|heroku)\b.*\b(deploy|--prod)\b/i, "desplegar"],
  [/\bnpm\s+publish\b|\byarn\s+publish\b|\bpnpm\s+publish\b/i, "publicar un paquete"], [/\bdocker\s+push\b/i, "publicar una imagen"],
  [/\b(ssh|scp|sftp|plink|putty)\b/i, "conectarse a otro servidor"], [/\bgh\s+(repo\s+(create|delete)|release|pr\s+merge)\b/i, "cambiar GitHub"],
  [/\b(drop\s+(table|database)|truncate\s+table)\b/i, "borrar datos en una base"],
  [/\b(curl|wget|Invoke-WebRequest|iwr|Invoke-RestMethod|irm)\b.*(\s-X\s*(POST|PUT|PATCH|DELETE)|\s--data|\s-d\s|\s--request\s+(POST|PUT|PATCH|DELETE)|\s-Method\s+(Post|Put|Patch|Delete))/i, "enviar datos a un servicio externo"],
] as const;

function hostsProduccion(): string[] {
  const h: string[] = ["graph.facebook.com"];
  for (const v of [process.env.JELCOM_URL, process.env.URL_PRODUCCION, ...(process.env.HOSTS_PRODUCCION || "").split(",")]) {
    try { if (v) h.push(new URL(v.includes("://") ? v : `https://${v}`).host); } catch { /* ignorar */ }
  }
  if (!process.env.JELCOM_URL) h.push("backendjelcomenvios-production.up.railway.app");
  return [...new Set(h.filter(Boolean))];
}

const norm = (p: string) => path.resolve(p).replace(/\\/g, "/").toLowerCase();
const dentroDe = (p: string, base: string) => { const a = norm(p), b = norm(base); return a === b || a.startsWith(b.endsWith("/") ? b : b + "/"); };

export function decidirPermiso(p: { tool: string; input: any; cwd: string; modo: Modo; raices?: string[] }): Decision {
  const { tool, input = {} } = p;
  const raices = [p.cwd, ...(p.raices || [])].filter(Boolean);
  if (tool.startsWith("mcp__emilia__")) return { decision: "permitir", motivo: "herramienta de Emilia (aplica su propia aprobación)" };
  if (tool.startsWith("mcp__")) return { decision: "permitir", motivo: "herramienta MCP" };

  if (tool === "Read" || tool === "NotebookRead") {
    const f = String(input.file_path || input.notebook_path || "");
    if (SECRETO.test(f) && !SECRETO_PERMITIDO.test(f) && !raices.some((r) => dentroDe(f, r))) return { decision: "negar", motivo: `${path.basename(f)} es un archivo de secretos fuera del laboratorio` };
    return { decision: "permitir", motivo: "lectura" };
  }
  if (SOLO_LECTURA.has(tool)) return { decision: "permitir", motivo: "lectura" };

  if (ESCRITURA.has(tool)) {
    if (p.modo === "lectura") return { decision: "negar", motivo: "esta tarea es de solo lectura" };
    const f = String(input.file_path || input.notebook_path || "");
    if (!f) return { decision: "permitir", motivo: "escritura" };
    if (raices.some((r) => dentroDe(f, r))) return { decision: "permitir", motivo: "escritura dentro de su carpeta" };
    return { decision: "preguntar", motivo: `escribir FUERA del laboratorio: ${f}` };
  }

  if (tool === "Bash" || tool === "PowerShell") {
    const cmd = String(input.command || "");
    if (PROHIBIDO.some((r) => r.test(cmd))) return { decision: "negar", motivo: "comando destructivo para el sistema" };
    if (/\b(cat|type|more|less|Get-Content|gc|head|tail|findstr|grep)\b[^|]*(^|[\s"'\\/])\.env(\s|"|'|$)/i.test(cmd) && !raices.some((r) => cmd.toLowerCase().includes(norm(r)))) return { decision: "negar", motivo: "leer el .env real (secretos)" };
    if (p.modo === "lectura") {
      const lectura = /^\s*(git\s+(status|diff|log|show|blame|branch|ls-files|grep|rev-parse|remote\s+-v)|ls|dir|tree|pwd|cd|echo|cat|type|head|tail|wc|find|rg|grep|findstr|node\s+(-v|--version)|npm\s+(ls|view|--version)|npx\s+tsc\s+--noEmit|python3?\s+--version|Get-ChildItem|Get-Content)\b/i;
      return cmd.split(/&&|\|\||;|\|/).every((c) => !c.trim() || lectura.test(c)) ? { decision: "permitir", motivo: "comando de lectura" } : { decision: "negar", motivo: "esta tarea es de solo lectura" };
    }
    for (const [re, que] of PREGUNTAR) if (re.test(cmd)) return { decision: "preguntar", motivo: que };
    const prod = hostsProduccion().find((h) => cmd.includes(h));
    if (prod) return { decision: "preguntar", motivo: `tocar producción (${prod})` };
    return { decision: "permitir", motivo: "comando local" };
  }
  // Herramientas nuevas que no conocemos: mejor preguntar.
  return { decision: "preguntar", motivo: `herramienta ${tool}` };
}

/** Texto corto y legible de lo que Claude quiere hacer (para la aprobación). */
export function describirAccion(tool: string, input: any): string {
  if (input?.command) return `$ ${String(input.command).slice(0, 700)}`;
  if (input?.file_path) return `${tool} ${input.file_path}`;
  return `${tool} ${JSON.stringify(input || {}).slice(0, 500)}`;
}

/** Conversación de WhatsApp del jefe con un agente (para colgar ahí la aprobación). */
export async function conversacionDelJefe(preferida?: string | null): Promise<string | null> {
  if (preferida) return preferida;
  const jefe = (process.env.WHATSAPP_NUMERO_JEFE || "").replace(/\D/g, "");
  if (!jefe) return null;
  const [c] = await query<{ id: string }>(`SELECT c.id FROM conversaciones c WHERE c.canal='whatsapp' AND right(regexp_replace(c.contacto,'\\D','','g'),10)=$1 ORDER BY c.ultimo_mensaje_en DESC LIMIT 1`, [jefe.slice(-10)]).catch(() => [] as any[]);
  return c?.id || null;
}

/**
 * Aprobación "externa" (de algo que corre fuera del loop, como Claude Code):
 * crea la aprobación, le escribe al jefe y ESPERA su "ok"/"no" (o vence).
 */
export async function pedirAprobacionYEsperar(p: { titulo: string; detalle: string; agenteId?: string | null; conversacionId?: string | null; esperaSeg?: number }): Promise<{ aprobada: boolean; motivo: string }> {
  const conv = await conversacionDelJefe(p.conversacionId);
  const [ap] = await query<{ id: string }>(
    `INSERT INTO aprobaciones (tipo, agente_id, conversacion_id, titulo, detalle) VALUES ('externa',$1,$2,$3,$4) RETURNING id`,
    [p.agenteId ?? null, conv, p.titulo.slice(0, 200), p.detalle.slice(0, 3500)]);
  const texto = `🔐 *${p.titulo}*\n${p.detalle.slice(0, 1500)}\n\nResponde *ok* o *no*.`;
  try {
    if (conv) { const { entregarTexto } = await import("./entrega.js"); await entregarTexto(conv, texto); }
    else if (process.env.WHATSAPP_NUMERO_JEFE) { const { enviarTextoWhatsapp } = await import("../whatsapp/enviar.js"); await enviarTextoWhatsapp(process.env.WHATSAPP_NUMERO_JEFE, texto); }
  } catch (e: any) { console.warn("[permisos] no pude avisar al jefe:", e?.message || e); }
  const limite = Date.now() + (p.esperaSeg ?? (Number(process.env.PERMISO_ESPERA_SEG) || 900)) * 1000;
  while (Date.now() < limite) {
    const [f] = await query<{ estado: string }>(`SELECT estado FROM aprobaciones WHERE id=$1`, [ap.id]);
    if (f?.estado === "aprobada") return { aprobada: true, motivo: "el jefe aprobó" };
    if (f?.estado === "rechazada") return { aprobada: false, motivo: "el jefe dijo que no" };
    await new Promise((r) => setTimeout(r, 2000));
  }
  await query(`UPDATE aprobaciones SET estado='rechazada', resuelto_en=now() WHERE id=$1 AND estado='pendiente'`, [ap.id]);
  return { aprobada: false, motivo: "el jefe no respondió a tiempo" };
}
