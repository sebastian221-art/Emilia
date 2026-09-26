// ARCHIVO: src/motor/sandbox.ts
// ─────────────────────────────────────────────────────────────────────────────
//  SANDBOX
//  Un worktree de git aislado por tarea: rama propia, copia real del código,
//  su propio node_modules. Ahí el Senior escribe, ejecuta, rompe y prueba sin
//  tocar el repo real. Al repo real solo llega un merge que el jefe aprueba.
//  .env: SANDBOX_DIR (por defecto ~/EmiliaSandbox)
//  Si el repo tiene un archivo `.env.sandbox`, sus variables se superponen al
//  .env copiado (para apuntar a una base de datos de prueba, otros puertos, etc.).
// ─────────────────────────────────────────────────────────────────────────────

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import type { Proyecto } from "../dominio/proyectos.js";

export const SANDBOX_DIR = path.resolve(process.env.SANDBOX_DIR || path.join(os.homedir(), "EmiliaSandbox"));

export interface SalidaComando { codigo: number | null; stdout: string; stderr: string; duracion_ms: number; timeout: boolean }

/** Ejecuta un comando de shell en un directorio con timeout. Devuelve todo. */
export function ejecutarComando(cwd: string, comando: string, timeoutSeg = 120, env: Record<string, string> = {}): Promise<SalidaComando> {
  return new Promise((resolve) => {
    const t0 = Date.now();
    let stdout = "", stderr = "", timeout = false;
    const hijo = spawn(comando, { cwd, shell: true, env: { ...process.env, ...env, CI: "1", FORCE_COLOR: "0" }, windowsHide: true });
    const timer = setTimeout(() => { timeout = true; matar(hijo.pid); }, timeoutSeg * 1000);
    hijo.stdout.on("data", (d) => { stdout += d.toString(); if (stdout.length > 200000) stdout = stdout.slice(-200000); });
    hijo.stderr.on("data", (d) => { stderr += d.toString(); if (stderr.length > 100000) stderr = stderr.slice(-100000); });
    hijo.on("close", (codigo) => { clearTimeout(timer); resolve({ codigo, stdout, stderr, duracion_ms: Date.now() - t0, timeout }); });
    hijo.on("error", (e) => { clearTimeout(timer); resolve({ codigo: -1, stdout, stderr: stderr + String(e), duracion_ms: Date.now() - t0, timeout }); });
  });
}

export function matar(pid?: number) {
  if (!pid) return;
  try {
    if (process.platform === "win32") spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true });
    else process.kill(-pid, "SIGKILL");
  } catch { try { process.kill(pid, "SIGKILL"); } catch { /* ya murió */ } }
}

async function git(cwd: string, args: string, timeoutSeg = 60): Promise<SalidaComando> {
  return ejecutarComando(cwd, `git ${args}`, timeoutSeg);
}

export function slug(texto: string): string {
  return texto.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "tarea";
}

/** Crea el worktree en una rama nueva desde rama_base. Devuelve ruta y rama. */
export async function crearWorktree(proyecto: Proyecto, proposito: string): Promise<{ ruta: string; rama: string; instalacion?: string }> {
  const rama = `senior/${slug(proposito)}-${Date.now().toString(36)}`;
  const ruta = path.join(SANDBOX_DIR, proyecto.nombre, rama.replace("senior/", ""));
  await fs.mkdir(path.dirname(ruta), { recursive: true });

  // Asegurar que rama_base exista localmente (o usar HEAD si no).
  const base = (await git(proyecto.ruta, `rev-parse --verify --quiet ${proyecto.rama_base}`)).codigo === 0 ? proyecto.rama_base : "HEAD";
  const r = await git(proyecto.ruta, `worktree add -b "${rama}" "${ruta}" ${base}`, 120);
  if (r.codigo !== 0) throw new Error(`No se pudo crear el worktree: ${(r.stderr || r.stdout).trim()}`);

  // .env del repo real + .env.sandbox (override) → .env del sandbox.
  let env = "";
  try { env = await fs.readFile(path.join(proyecto.ruta, ".env"), "utf-8"); } catch { /* sin .env */ }
  let override = "";
  try { override = await fs.readFile(path.join(proyecto.ruta, ".env.sandbox"), "utf-8"); } catch { /* opcional */ }
  if (env || override) await fs.writeFile(path.join(ruta, ".env"), `${env}\n# ── override sandbox ──\n${override}\n`);

  // Dependencias.
  let instalacion: string | undefined;
  const cmdInstall = proyecto.cmd_install || (await existe(path.join(ruta, "package.json")) ? "npm install --no-audit --no-fund" : null);
  if (cmdInstall) {
    const i = await ejecutarComando(ruta, cmdInstall, 600);
    instalacion = i.codigo === 0 ? `dependencias instaladas (${Math.round(i.duracion_ms / 1000)}s)` : `instalación falló: ${(i.stderr || i.stdout).slice(-500)}`;
  }
  return { ruta, rama, instalacion };
}

export async function borrarWorktree(proyecto: Proyecto, ruta: string, rama: string, borrarRama: boolean): Promise<void> {
  await git(proyecto.ruta, `worktree remove --force "${ruta}"`, 120);
  await git(proyecto.ruta, `worktree prune`);
  if (borrarRama) await git(proyecto.ruta, `branch -D "${rama}"`);
}

/** Diff del sandbox contra la rama base: cambios sin commit + commits de la rama. */
export async function diffSandbox(ruta: string, ramaBase: string, maxChars = 12000): Promise<{ resumen: string; diff: string; archivos: string[]; truncado: boolean }> {
  const base = (await git(ruta, `rev-parse --verify --quiet ${ramaBase}`)).codigo === 0 ? ramaBase : "HEAD";
  const stat = await git(ruta, `diff --stat ${base}`);
  const nombres = await git(ruta, `diff --name-only ${base}`);
  const sinTrack = await git(ruta, `ls-files --others --exclude-standard`);
  const diff = await git(ruta, `diff ${base}`);
  const archivos = [...nombres.stdout.split("\n"), ...sinTrack.stdout.split("\n")].map((s) => s.trim()).filter(Boolean);
  const texto = diff.stdout + (sinTrack.stdout.trim() ? `\n\n[Archivos nuevos sin seguimiento]\n${sinTrack.stdout}` : "");
  return { resumen: stat.stdout.trim() || "(sin cambios)", diff: texto.slice(0, maxChars), archivos, truncado: texto.length > maxChars };
}

export async function estadoGit(ruta: string): Promise<{ rama: string; estado: string; ultimos_commits: string }> {
  const rama = (await git(ruta, "rev-parse --abbrev-ref HEAD")).stdout.trim();
  const estado = (await git(ruta, "status --short")).stdout.trim();
  const log = (await git(ruta, "log --oneline -8")).stdout.trim();
  return { rama, estado: estado || "(limpio)", ultimos_commits: log };
}

export async function commitSandbox(ruta: string, mensaje: string): Promise<SalidaComando> {
  await git(ruta, "add -A");
  return git(ruta, `commit -m "${mensaje.replace(/"/g, "'").slice(0, 200)}"`);
}
export async function pushSandbox(ruta: string, rama: string): Promise<SalidaComando> {
  return git(ruta, `push -u origin "${rama}"`, 180);
}
/** Integra la rama del sandbox en la rama base del repo REAL (merge --no-ff). El repo real debe estar limpio. */
export async function integrarEnBase(proyecto: Proyecto, rama: string): Promise<SalidaComando> {
  const st = await git(proyecto.ruta, "status --porcelain");
  if (st.stdout.trim()) return { codigo: 1, stdout: "", stderr: `El repo real (${proyecto.ruta}) tiene cambios sin commit; hacé commit o descartalos a mano antes de integrar. Archivos:\n${st.stdout.trim().slice(0, 1200)}`, duracion_ms: 0, timeout: false };
  const co = await git(proyecto.ruta, `checkout ${proyecto.rama_base}`);
  if (co.codigo !== 0) return co;
  return git(proyecto.ruta, `merge --no-ff "${rama}" -m "Integra ${rama} (Senior Developer)"`, 120);
}

async function existe(p: string) { try { await fs.access(p); return true; } catch { return false; } }