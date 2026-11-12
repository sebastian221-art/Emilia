// ARCHIVO: src/motor/laboratorio.ts
// ─────────────────────────────────────────────────────────────────────────────
//  EL LABORATORIO DE SAGE
//  Su propio entorno en el PC (LAB_DIR, por defecto ~/EmiliaLab):
//    experimentos/   pruebas libres, prototipos, scripts, documentos generados
//    sandboxes/      copias aisladas (git worktree) de tus proyectos por tarea
//    config/         ajustes de Claude Code: hook de permisos y herramientas de Emilia
//    herramientas/   docx, exceljs, pptxgenjs, playwright + captura.mjs y comparar.mjs
//                    (se instala una vez: npm run lab:preparar)
//    CLAUDE.md       lo que Claude Code sabe del laboratorio (se regenera en cada arranque;
//                    tus notas van en NOTAS.md, que CLAUDE.md importa)
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
export const DIR_HERRAMIENTAS = path.join(LAB_DIR, "herramientas");
const REPO_EMILIA = process.cwd();

/** Token que solo conocen Emilia y los procesos que ella lanza (hook y MCP). Cambia en cada arranque. */
export function tokenInterno(): string {
  if (!process.env.EMILIA_TOKEN_INTERNO) process.env.EMILIA_TOKEN_INTERNO = crypto.randomBytes(24).toString("hex");
  return process.env.EMILIA_TOKEN_INTERNO;
}
export const urlInterna = () => `http://127.0.0.1:${Number(process.env.PORT ?? 3000)}`;

export const rutasConfig = () => ({ settings: path.join(DIR_CONFIG, "claude-settings.json"), mcp: path.join(DIR_CONFIG, "mcp.json") });

const H = DIR_HERRAMIENTAS.replace(/\\/g, "/");
const GUIA = () => `# Laboratorio de Sage (Emilia)

Trabajas para Sebastián desde Emilia, su sistema de agentes. Este es tu laboratorio: puedes crear, probar, romper y repetir.
Él te habla por WhatsApp; tú le respondes con tu informe final y con las herramientas de Emilia.

## Reglas
- Trabajas SIEMPRE dentro de tu carpeta (un experimento o un sandbox). Fuera de ella, escribir pide permiso al jefe por WhatsApp.
- No tienes las credenciales de Emilia y no debes buscarlas. El \`.env\` de los sandboxes es de PRUEBA (\`.env.sandbox\` del proyecto o \`${path.join(LAB_DIR, ".env.lab")}\`). Si falta una credencial, dilo en el informe.
- Push, despliegues, ssh, publicar paquetes o tocar producción: el sistema le pregunta al jefe y espera su "ok". No intentes rodearlo.
- Verifica con evidencia (build, tests, ejecutar, capturas). Nunca digas que algo funciona sin haberlo corrido.
- El PC es Windows: la terminal puede ser cmd o PowerShell. Para crear archivos usa tus herramientas de edición, no echo ni heredocs.

## Herramientas de Emilia (MCP "emilia")
- \`emilia_enviar_archivo\` → le manda al jefe por WhatsApp un archivo tuyo (Word, Excel, PowerPoint, PDF, imagen, zip…).
- \`emilia_avisar\` → aviso corto al jefe (hitos o decisiones).
- \`publicar_proyecto\` → sube una carpeta del laboratorio a GitHub (repo privado) y la despliega en Railway con link público; espera y comprueba la URL. Pide el OK del jefe. Si ya estaba publicada, sube la nueva versión.
- \`publicar_estado\` / \`publicar_listar\` → estado y logs de lo publicado.
- \`biblioteca_consultar\` / \`biblioteca_aportar\` → conocimiento compartido del equipo. Consulta antes de investigar; aporta lo que sirva después.
- Además, las herramientas de lectura del resto de Emilia (proyectos, logs, Jelcom…).

## Kit del laboratorio (${H})
Librerías ya instaladas ahí. Desde un script en tu carpeta, cárgalas así (ESM):
\`\`\`js
import { createRequire } from "node:module";
const requireLab = createRequire("${H}/");
const ExcelJS = requireLab("exceljs");     // Excel con formato, fórmulas, gráficos simples
const docx = requireLab("docx");           // Word
const PptxGenJS = requireLab("pptxgenjs"); // PowerPoint
const { PDFDocument } = requireLab("pdf-lib");
const { chromium } = requireLab("playwright"); // navegador: capturas, PDF desde HTML, probar páginas
\`\`\`
- PDF bonito: arma HTML+CSS y expórtalo con playwright (\`page.pdf()\`).
- Documentos profesionales: títulos, tablas con formato, colores sobrios, sin relleno. Ábrelos o renderízalos para revisarlos antes de mandarlos.
- Si algo del kit falta, instálalo en tu experimento con \`npm i\`. Para proyectos que se van a publicar, las dependencias van en SU package.json (no uses el kit dentro del proyecto).

## Ver y replicar una página
1. \`node "${H}/captura.mjs" <url> ./referencia\` → capturas de escritorio y móvil, pantallazos al bajar (animaciones), hovers, \`pagina.html\` y \`analisis.json\` (colores, tipografías, animaciones, keyframes, librerías, secciones, textos).
2. MIRA las capturas con Read (son imágenes) y lee \`analisis.json\`. Describe el diseño antes de codificar.
3. Construye la réplica con los cambios que pidió el jefe. Animaciones: copia el efecto (CSS/keyframes, IntersectionObserver, o la misma librería si es libre). Textos e imágenes propios o del jefe; no copies logos ni marcas de otros.
4. Levántala local, captúrala igual (\`captura.mjs http://localhost:PUERTO ./replica\`) y compara: \`node "${H}/comparar.mjs" referencia/escritorio-completa.png replica/escritorio-completa.png\`. Mira también las capturas lado a lado. Itera hasta que se vea igual (salvo los cambios pedidos).
5. Para publicarla: proyecto que Railway sepa correr (package.json con "start" que escuche en process.env.PORT, o un sitio estático servido con un server mínimo). Luego \`publicar_proyecto\`.

## Informe final (siempre)
Qué hiciste, archivos creados o cambiados, cómo lo verificaste (comandos y resultado), qué queda pendiente y qué recomiendas. Corto y concreto.

## Notas del jefe
@NOTAS.md
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
  await fs.writeFile(path.join(LAB_DIR, "CLAUDE.md"), GUIA());
  const notas = path.join(LAB_DIR, "NOTAS.md");
  try { await fs.access(notas); } catch { await fs.writeFile(notas, "# Notas para Sage\n\n(Escribe aquí lo que quieras que Sage tenga siempre en cuenta en el laboratorio.)\n"); }
  // Kit: copia los scripts del repo (siempre la última versión). Las librerías se instalan con npm run lab:preparar.
  await fs.mkdir(DIR_HERRAMIENTAS, { recursive: true });
  for (const f of ["captura.mjs", "comparar.mjs", "package.json"]) await fs.copyFile(path.join(REPO_EMILIA, "scripts", "lab", f), path.join(DIR_HERRAMIENTAS, f)).catch(() => {});
  try { await fs.access(path.join(DIR_HERRAMIENTAS, "node_modules", "playwright")); }
  catch { console.warn(`[laboratorio] Falta instalar el kit (Office, capturas): corre "npm run lab:preparar" una vez.`); }
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
