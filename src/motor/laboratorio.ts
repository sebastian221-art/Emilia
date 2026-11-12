// ARCHIVO: src/motor/laboratorio.ts
// ─────────────────────────────────────────────────────────────────────────────
//  EL LABORATORIO DE SAGE
//  Su propio entorno en el PC (LAB_DIR, por defecto ~/EmiliaLab):
//    experimentos/   pruebas libres, prototipos, scripts, documentos generados
//    sandboxes/      copias aisladas (git worktree) de tus proyectos por tarea
//    config/         ajustes de Claude Code: hook de permisos y herramientas de Emilia
//    CLAUDE.md       lo que Claude Code sabe del laboratorio (lo lee solo en cada sesión)
//    .env.lab        variables de PRUEBA para el laboratorio (nunca las reales)
//  Todo lo que corre aquí pasa por el hook de permisos (motor/permisos-codigo.ts)
//  y tiene las herramientas de Emilia por MCP (scripts/mcp-emilia.mjs).
// ─────────────────────────────────────────────────────────────────────────────
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

export const LAB_DIR = path.resolve(process.env.LAB_DIR || path.join(os.homedir(), "EmiliaLab"));
export const DIR_EXPERIMENTOS = path.join(LAB_DIR, "experimentos");
export const DIR_CONFIG = path.join(LAB_DIR, "config");
const REPO_EMILIA = process.cwd();

/** Token que solo conocen Emilia y los procesos que ella lanza (hook y MCP). Cambia en cada arranque. */
export function tokenInterno(): string {
  if (!process.env.EMILIA_TOKEN_INTERNO) process.env.EMILIA_TOKEN_INTERNO = crypto.randomBytes(24).toString("hex");
  return process.env.EMILIA_TOKEN_INTERNO;
}
export const urlInterna = () => `http://127.0.0.1:${Number(process.env.PORT ?? 3000)}`;

export const rutasConfig = () => ({ settings: path.join(DIR_CONFIG, "claude-settings.json"), mcp: path.join(DIR_CONFIG, "mcp.json") });

const GUIA = `# Laboratorio de Sage (Emilia)

Estás trabajando para Sebastián desde Emilia, su sistema de agentes. Este es tu laboratorio: puedes crear, probar, romper y repetir.

## Reglas
- Trabajas SIEMPRE dentro de tu carpeta (un experimento o un sandbox). Fuera de ella, escribir pide permiso al jefe por WhatsApp.
- Nunca uses credenciales reales. El \`.env\` de los sandboxes viene de \`.env.sandbox\` del proyecto o de \`${path.join(LAB_DIR, ".env.lab")}\`. Si te falta una credencial, dilo en tu informe; no la busques.
- Push, despliegues (Railway), ssh, publicar paquetes o tocar producción: se le pregunta al jefe solo (el sistema te frena y espera su "ok"). No intentes rodearlo.
- Verifica con evidencia (build, tests, ejecutar el programa). Nunca digas que algo funciona sin haberlo corrido.
- El PC es Windows: la terminal puede ser cmd o PowerShell. Para crear archivos usa tus herramientas de edición, no echo ni heredocs.

## Herramientas de Emilia (MCP "emilia")
- \`emilia_enviar_archivo\` → le manda al jefe por WhatsApp un archivo que creaste (Word, Excel, PowerPoint, PDF, imagen, zip, código).
- \`emilia_avisar\` → un aviso corto al jefe (solo para hitos importantes o si necesitas una decisión).
- \`biblioteca_consultar\` / \`biblioteca_aportar\` → la memoria de conocimiento compartida del equipo. Consulta antes de investigar; aporta lo que aprendas que sirva después.
- Además, las herramientas de lectura del resto de Emilia (estado de proyectos, logs, Jelcom, etc.).

## Documentos
- Word: python-docx o la librería docx de npm. Excel: openpyxl o exceljs. PowerPoint: python-pptx o pptxgenjs. PDF: reportlab o generar HTML y exportar.
- Si falta una librería, instálala en el experimento (\`pip install --user ...\` o \`npm i ...\`).
- Los documentos deben verse profesionales: títulos, tablas con formato, sin texto de relleno.

## Informe final (siempre)
Termina con: qué hiciste, archivos que creaste o cambiaste, cómo lo verificaste (comandos y resultado), qué queda pendiente y qué recomiendas. Corto y concreto.
`;

/** Crea las carpetas y escribe la configuración de Claude Code. Idempotente; se llama al arrancar. */
export async function prepararLaboratorio(): Promise<void> {
  for (const d of [LAB_DIR, DIR_EXPERIMENTOS, DIR_CONFIG, path.join(LAB_DIR, "sandboxes")]) await fs.mkdir(d, { recursive: true });
  const r = rutasConfig();
  const nodo = process.execPath.includes(" ") ? `"${process.execPath}"` : process.execPath;
  const settings = {
    hooks: {
      PreToolUse: [{ matcher: "*", hooks: [{ type: "command", command: `${nodo} "${path.join(REPO_EMILIA, "scripts", "hook-permisos.mjs")}"`, timeout: (Number(process.env.PERMISO_ESPERA_SEG) || 900) + 60 }] }],
    },
  };
  await fs.writeFile(r.settings, JSON.stringify(settings, null, 2));
  const mcp = { mcpServers: { emilia: { command: process.execPath, args: [path.join(REPO_EMILIA, "scripts", "mcp-emilia.mjs")], env: { EMILIA_URL: urlInterna(), EMILIA_TOKEN: tokenInterno() } } } };
  await fs.writeFile(r.mcp, JSON.stringify(mcp, null, 2));
  const guia = path.join(LAB_DIR, "CLAUDE.md");
  try { await fs.access(guia); } catch { await fs.writeFile(guia, GUIA); }
  const envLab = path.join(LAB_DIR, ".env.lab");
  try { await fs.access(envLab); } catch { await fs.writeFile(envLab, "# Variables de PRUEBA para el laboratorio y los sandboxes (nunca las reales).\n# Ej.: DATABASE_URL=postgresql://localhost:5432/emilia_pruebas\n"); }
}

/** Carpeta nueva para un experimento libre. */
export async function nuevoExperimento(proposito: string): Promise<string> {
  const slug = proposito.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "experimento";
  const fecha = new Date(Date.now() - 5 * 3600_000).toISOString().slice(0, 16).replace(/[-:T]/g, "").replace(/^(\d{8})(\d{4})$/, "$1-$2");
  const dir = path.join(DIR_EXPERIMENTOS, `${fecha}-${slug}`);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

/** ¿La ruta está dentro del laboratorio? */
export function enLaboratorio(p: string): boolean {
  const a = path.resolve(p).toLowerCase(), b = LAB_DIR.toLowerCase();
  return a === b || a.startsWith(b + path.sep);
}
