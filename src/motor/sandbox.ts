// ARCHIVO: src/motor/sandbox.ts
// ─────────────────────────────────────────────────────────────────────────────
//  SANDBOX
//  Un worktree de git aislado por tarea: rama propia, copia real del código,
//  su propio node_modules. Ahí el Senior escribe, ejecuta, rompe y prueba sin
//  tocar el repo real. Al repo real solo llega un merge que el jefe aprueba.
//  .env: SANDBOX_DIR (por defecto <laboratorio>/sandboxes)
//  El .env del sandbox NUNCA es el real: sale de `.env.sandbox` del proyecto
//  (si existe) o de `.env.lab` del laboratorio (variables de prueba).
// ─────────────────────────────────────────────────────────────────────────────

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Proyecto } from "../dominio/proyectos.js";
import { LAB_DIR } from "./laboratorio.js";

export const SANDBOX_DIR = path.resolve(process.env.SANDBOX_DIR || path.join(LAB_DIR, "sandboxes"));

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

export async function git(cwd: string, args: string, timeoutSeg = 60): Promise<SalidaComando> {
  return ejecutarComando(cwd, `git ${args}`, timeoutSeg);
}

export function slug(texto: string): string {
  return texto.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "tarea";
}

/** Crea el worktree en una rama nueva desde rama_base. Devuelve ruta y rama. */
export async function crearWorktree(proyecto: Proyecto, proposito: string): Promise<{ ruta: string; rama: string; instalacion?: string; env?: string }> {
  const rama = `senior/${slug(proposito)}-${Date.now().toString(36)}`;
  const ruta = path.join(SANDBOX_DIR, proyecto.nombre, rama.replace("senior/", ""));
  await fs.mkdir(path.dirname(ruta), { recursive: true });

  const base = await ramaBaseReal(proyecto);
  const r = await git(proyecto.ruta, `worktree add -b "${rama}" "${ruta}" ${base}`, 120);
  if (r.codigo !== 0) throw new Error(`No se pudo crear el worktree: ${(r.stderr || r.stdout).trim()}`);

  // .env de PRUEBA: .env.sandbox del proyecto o .env.lab del laboratorio. Nunca el real
  // (antes se copiaba: un red team o una prueba de carga habría pegado contra producción).
  let env = "", origenEnv = "ninguno";
  try { env = await fs.readFile(path.join(proyecto.ruta, ".env.sandbox"), "utf-8"); origenEnv = ".env.sandbox del proyecto"; } catch { /* opcional */ }
  if (!env) { try { env = await fs.readFile(path.join(LAB_DIR, ".env.lab"), "utf-8"); origenEnv = ".env.lab del laboratorio"; } catch { /* opcional */ } }
  await fs.writeFile(path.join(ruta, ".env"), `# .env de PRUEBA del sandbox (origen: ${origenEnv}). No contiene credenciales reales.\n${env}\n`);
  // Que git nunca lo vea, aunque el proyecto no tenga .gitignore (exclude local, no se sube).
  const comun = (await git(ruta, "rev-parse --git-common-dir")).stdout.trim();
  if (comun) {
    const excl = path.join(path.resolve(ruta, comun), "info", "exclude");
    const actual = await fs.readFile(excl, "utf-8").catch(() => "");
    if (!/^\.env$/m.test(actual)) { await fs.mkdir(path.dirname(excl), { recursive: true }); await fs.appendFile(excl, `${actual && !actual.endsWith("\n") ? "\n" : ""}# Emilia: .env de prueba de los sandboxes\n.env\n`); }
  }

  // Dependencias.
  let instalacion: string | undefined;
  const cmdInstall = proyecto.cmd_install || (await existe(path.join(ruta, "package.json")) ? "npm install --no-audit --no-fund" : null);
  if (cmdInstall) {
    const i = await ejecutarComando(ruta, cmdInstall, 600);
    instalacion = i.codigo === 0 ? `dependencias instaladas (${Math.round(i.duracion_ms / 1000)}s)` : `instalación falló: ${(i.stderr || i.stdout).slice(-500)}`;
  }
  return { ruta, rama, instalacion, env: origenEnv };
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

/** Archivos que nunca se suben aunque el proyecto no los ignore (.env, llaves…). Las plantillas (.env.example) sí. */
export const SECRETO = /(^|\/)(\.env(\.(?!example$|sample$|template$|lab$)[^/]+)?|[^/]+\.(pem|key|p12|pfx)|id_(rsa|ed25519|ecdsa)[^/]*|credentials\.json)$/i;

/** Cambios pendientes de commit en el sandbox, sin contar archivos de secretos que nunca se suben. */
export async function pendientesSandbox(ruta: string): Promise<string[]> {
  const st = (await git(ruta, "status --porcelain")).stdout.split("\n").filter((l) => l.trim());
  return st.filter((l) => !(l.startsWith("??") && SECRETO.test(l.slice(3).trim().replace(/^"|"$/g, ""))));
}

export async function commitSandbox(ruta: string, mensaje: string): Promise<SalidaComando> {
  await git(ruta, "add -A");
  const fuera = (await git(ruta, "diff --cached --name-only")).stdout.split("\n").map((x) => x.trim()).filter((x) => x && SECRETO.test(x));
  if (fuera.length) await git(ruta, `reset -q -- ${fuera.map((f) => `"${f}"`).join(" ")}`);
  const r = await git(ruta, `commit -m "${mensaje.replace(/"/g, "'").slice(0, 200)}"`);
  if (fuera.length) r.stdout = `${r.stdout}\n(No incluí en el commit archivos de secretos: ${fuera.join(", ")})`;
  return r;
}
/** Opciones de git para autenticar con GITHUB_TOKEN por cabecera (el token nunca queda en la URL ni en los logs de git). */
export async function authGit(ruta: string): Promise<string> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return "";
  const url = (await git(ruta, "remote get-url origin")).stdout.trim();
  if (!/^https:\/\/github\.com\//i.test(url)) return "";
  const b64 = Buffer.from(`x-access-token:${token}`).toString("base64");
  return `-c http.https://github.com/.extraheader="AUTHORIZATION: basic ${b64}"`;
}
const tieneRemoto = async (ruta: string) => !!(await git(ruta, "remote")).stdout.trim();

export async function pushSandbox(ruta: string, rama: string): Promise<SalidaComando> {
  return git(ruta, `${await authGit(ruta)} push -u origin "${rama}"`, 180);
}

/**
 * Pone el sandbox al día con lo último de GitHub (fetch + rebase sobre origin/<base>)
 * para que la entrega no pise cambios que otro subió mientras Sage trabajaba.
 * Si hay conflictos, deshace el rebase y lo dice.
 */
export async function actualizarSandbox(ruta: string, base: string): Promise<{ ok: boolean; mensaje: string; nuevos: number }> {
  if (!(await tieneRemoto(ruta))) return { ok: true, mensaje: "El proyecto no tiene remoto: nada que traer.", nuevos: 0 };
  const f = await git(ruta, `${await authGit(ruta)} fetch origin ${base}`, 180);
  if (f.codigo !== 0) return { ok: false, mensaje: `No pude traer origin/${base}: ${(f.stderr || f.stdout).slice(-300)}`, nuevos: 0 };
  const nuevos = Number((await git(ruta, `rev-list --count HEAD..origin/${base}`)).stdout.trim()) || 0;
  if (!nuevos) return { ok: true, mensaje: `Ya estaba al día con origin/${base}.`, nuevos: 0 };
  const r = await git(ruta, `rebase origin/${base}`, 180);
  if (r.codigo !== 0) {
    await git(ruta, "rebase --abort");
    return { ok: false, mensaje: `Hay CONFLICTOS con ${nuevos} commit(s) nuevos de origin/${base} que tocan lo mismo. Dejé el sandbox como estaba. Hay que resolverlos (puedo pedirle a Claude Code que lo haga).\n${(r.stdout + r.stderr).slice(-500)}`, nuevos };
  }
  return { ok: true, mensaje: `Actualizado sobre ${nuevos} commit(s) nuevos de origin/${base}.`, nuevos };
}

/**
 * Entrega: sube la rama del sandbox DIRECTO a la rama base en GitHub (sin tocar
 * tu carpeta de trabajo) y después, si tu copia local está limpia y en esa rama,
 * la pone al día (fast-forward). Sin remoto: merge local, solo si tu copia está
 * limpia y ya en la rama base.
 */
export async function entregarSandbox(proyecto: Proyecto, ruta: string, rama: string): Promise<SalidaComando> {
  const base = await ramaBaseReal(proyecto);
  const ok = (stdout: string): SalidaComando => ({ codigo: 0, stdout, stderr: "", duracion_ms: 0, timeout: false });
  const mal = (stderr: string): SalidaComando => ({ codigo: 1, stdout: "", stderr, duracion_ms: 0, timeout: false });
  if (await tieneRemoto(ruta)) {
    const p = await git(ruta, `${await authGit(ruta)} push origin HEAD:refs/heads/${base}`, 180);
    if (p.codigo !== 0) {
      const txt = (p.stderr || p.stdout);
      return mal(/rejected|non-fast-forward|fetch first/i.test(txt) ? `GitHub rechazó el push: alguien subió cambios a ${base} recién. Hay que actualizar el sandbox (codigo_actualizar_sandbox) y volver a entregar.\n${txt.slice(-300)}` : `El push falló: ${txt.slice(-500)}`);
    }
    const actual = (await git(proyecto.ruta, "rev-parse --abbrev-ref HEAD")).stdout.trim();
    const sucio = (await git(proyecto.ruta, "status --porcelain --untracked-files=no")).stdout.trim();
    let local = "";
    if (actual === base && !sucio) {
      const pull = await git(proyecto.ruta, `${await authGit(proyecto.ruta)} pull --ff-only origin ${base}`, 180);
      local = pull.codigo === 0 ? `Tu copia local (${proyecto.ruta}) quedó al día.` : `Tu copia local no se pudo actualizar sola (${(pull.stderr || pull.stdout).slice(-200)}); haz git pull.`;
    } else local = `Tu copia local no la toqué (${sucio ? "tiene cambios sin commit" : `está en la rama ${actual}`}); cuando puedas haz git pull en ${base}.`;
    return ok(`✔ Subido a origin/${base}. ${local}`);
  }
  const st = await git(proyecto.ruta, "status --porcelain --untracked-files=no");
  if (st.stdout.trim()) return mal(`El repo (${proyecto.ruta}) tiene cambios sin commit; no lo toco. Haz commit o descártalos y vuelvo a entregar.`);
  const actual = (await git(proyecto.ruta, "rev-parse --abbrev-ref HEAD")).stdout.trim();
  if (actual !== base) return mal(`Tu repo está en la rama ${actual}, no en ${base}; no lo cambio de rama por ti. Pásalo a ${base} y vuelvo a entregar.`);
  const m = await git(proyecto.ruta, `merge --ff-only "${rama}"`, 120);
  return m.codigo === 0 ? ok(`✔ Integrado en ${base} (proyecto sin remoto).`) : mal(`No se pudo integrar: ${(m.stderr || m.stdout).slice(-400)}`);
}
/**
 * Rama base REAL del repo: la configurada si existe; si no, la rama actual
 * (main vs master es el error más común). Corrige el registro del proyecto.
 */
export async function ramaBaseReal(proyecto: Proyecto): Promise<string> {
  const existe = (await git(proyecto.ruta, `rev-parse --verify --quiet refs/heads/${proyecto.rama_base}`)).codigo === 0;
  if (existe) return proyecto.rama_base;
  const actual = (await git(proyecto.ruta, "rev-parse --abbrev-ref HEAD")).stdout.trim() || "master";
  const { query } = await import("../db/cliente.js");
  await query(`UPDATE proyectos SET rama_base=$1, actualizado_en=now() WHERE id=$2`, [actual, proyecto.id]).catch(() => {});
  console.warn(`[sandbox] El proyecto ${proyecto.nombre} tenía rama_base "${proyecto.rama_base}" que no existe; corregido a "${actual}".`);
  proyecto.rama_base = actual;
  return actual;
}

async function existe(p: string) { try { await fs.access(p); return true; } catch { return false; } }