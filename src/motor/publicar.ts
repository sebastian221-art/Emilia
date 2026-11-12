// ARCHIVO: src/motor/publicar.ts
// ─────────────────────────────────────────────────────────────────────────────
//  PUBLICAR: de una carpeta del laboratorio a un repo en GitHub y una URL en Railway
//   1. Crea el repo (privado por defecto) con GITHUB_TOKEN, o reusa el que ya existe.
//   2. Sube la carpeta (.gitignore con node_modules y .env; los secretos nunca entran).
//   3. Railway (RAILWAY_TOKEN, token de cuenta): proyecto + servicio conectado al
//      repo + dominio público. Las siguientes subidas despliegan solas.
//   4. Espera el despliegue y comprueba que la URL responde. Si falla, trae logs.
//  Los tokens se quedan en Emilia: Claude Code nunca los ve.
// ─────────────────────────────────────────────────────────────────────────────
import { promises as fs } from "node:fs";
import path from "node:path";
import { db } from "../db/cliente.js";
import { git, authGit, commitSandbox } from "./sandbox.js";

const GH = "https://api.github.com";
const RW = "https://backboard.railway.com/graphql/v2";
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface Despliegue {
  id: string; nombre: string; carpeta: string; repo: string | null; rama: string;
  railway_proyecto: string | null; railway_servicio: string | null; railway_entorno: string | null;
  url: string | null; estado: string | null; creado_en: string; actualizado_en: string;
}

export const slugRepo = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "proyecto";

// ── GitHub ──────────────────────────────────────────────────────────────────
async function github(ruta: string, metodo = "GET", cuerpo?: unknown): Promise<{ status: number; datos: any }> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("Falta GITHUB_TOKEN en el .env de Emilia (token con permiso de crear repos y hacer push).");
  const r = await fetch(`${GH}${ruta}`, {
    method: metodo,
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "Emilia", ...(cuerpo ? { "Content-Type": "application/json" } : {}) },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  return { status: r.status, datos: await r.json().catch(() => ({})) };
}

/** Crea el repo en la cuenta del token o devuelve el existente con ese nombre. */
export async function asegurarRepo(nombre: string, privado: boolean, descripcion = ""): Promise<{ repo: string; url: string; nuevo: boolean }> {
  const yo = await github("/user");
  if (yo.status !== 200) throw new Error(`GitHub no aceptó el token (${yo.status}): ${yo.datos?.message || ""}`);
  const owner = yo.datos.login as string;
  const ya = await github(`/repos/${owner}/${nombre}`);
  if (ya.status === 200) return { repo: ya.datos.full_name, url: ya.datos.html_url, nuevo: false };
  const r = await github("/user/repos", "POST", { name: nombre, private: privado, description: descripcion.slice(0, 300), auto_init: false });
  if (r.status !== 201) throw new Error(`No pude crear el repo ${owner}/${nombre} (${r.status}): ${r.datos?.message || ""} ${JSON.stringify(r.datos?.errors || "")}`);
  return { repo: r.datos.full_name, url: r.datos.html_url, nuevo: true };
}

const IGNORAR = ["node_modules/", ".env", ".env.*", "!.env.example", ".DS_Store", "*.log", ".claude/", "capturas/"];

/** Commit de todo lo de la carpeta (sin secretos) y push a la rama indicada del repo. */
export async function subirCarpeta(carpeta: string, repo: string, rama: string, mensaje: string): Promise<{ commit: string; cambios: boolean }> {
  try { await fs.access(path.join(carpeta, ".git")); } catch {
    const i = await git(carpeta, `init -b ${rama}`);
    if (i.codigo !== 0) throw new Error(`git init falló: ${i.stderr}`);
  }
  const gi = path.join(carpeta, ".gitignore");
  const actual = await fs.readFile(gi, "utf-8").catch(() => "");
  const faltan = IGNORAR.filter((l) => !actual.split(/\r?\n/).includes(l));
  if (faltan.length) await fs.writeFile(gi, `${actual}${actual && !actual.endsWith("\n") ? "\n" : ""}${faltan.join("\n")}\n`);
  if (!(await git(carpeta, "config user.email")).stdout.trim()) {
    await git(carpeta, `config user.email "sage@emilia.local"`); await git(carpeta, `config user.name "Sage (Emilia)"`);
  }
  const c = await commitSandbox(carpeta, mensaje);
  const sinCambios = /nothing to commit|nada para hacer commit|no changes added/i.test(c.stdout + c.stderr);
  if (c.codigo !== 0 && !sinCambios) throw new Error(`El commit falló: ${(c.stderr || c.stdout).slice(-400)}`);
  const remoto = `https://github.com/${repo}.git`;
  if ((await git(carpeta, "remote get-url origin")).codigo === 0) await git(carpeta, `remote set-url origin ${remoto}`);
  else await git(carpeta, `remote add origin ${remoto}`);
  const p = await git(carpeta, `${await authGit(carpeta)} push -u origin HEAD:refs/heads/${rama}`, 300);
  if (p.codigo !== 0) throw new Error(`El push falló: ${(p.stderr || p.stdout).slice(-500)}`);
  const commit = (await git(carpeta, "rev-parse --short HEAD")).stdout.trim();
  return { commit, cambios: !sinCambios };
}

// ── Railway ─────────────────────────────────────────────────────────────────
async function railway<T = any>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const token = process.env.RAILWAY_TOKEN;
  if (!token) throw new Error("Falta RAILWAY_TOKEN en el .env de Emilia (token de CUENTA: railway.com/account/tokens).");
  const r = await fetch(RW, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(30_000),
  });
  const d: any = await r.json().catch(() => ({}));
  if (!r.ok || d.errors?.length) throw new Error(`Railway: ${(d.errors || []).map((e: any) => e.message).join("; ") || `HTTP ${r.status}`}`);
  return d.data as T;
}

async function crearEnRailway(nombre: string, repo: string, rama: string, variables?: Record<string, string>) {
  const p = await railway(`mutation($name:String){projectCreate(input:{name:$name}){id environments{edges{node{id name}}}}}`, { name: nombre });
  const envs = p.projectCreate.environments.edges.map((e: any) => e.node);
  const entorno = (envs.find((e: any) => e.name === "production") || envs[0])?.id;
  if (!entorno) throw new Error("Railway creó el proyecto pero sin entorno.");
  let servicio: string;
  try {
    const s = await railway(`mutation($projectId:String!,$environmentId:String,$name:String,$source:ServiceSourceInput,$branch:String,$variables:EnvironmentVariables){serviceCreate(input:{projectId:$projectId,environmentId:$environmentId,name:$name,source:$source,branch:$branch,variables:$variables}){id}}`,
      { projectId: p.projectCreate.id, environmentId: entorno, name: nombre, source: { repo }, branch: rama, variables: variables && Object.keys(variables).length ? variables : undefined });
    servicio = s.serviceCreate.id;
  } catch (e: any) {
    throw new Error(`${e.message}. Si dice que no encuentra el repo: en railway.com → Account → Integrations → GitHub, dale acceso a Railway a todos tus repos (o a ${repo}).`);
  }
  const d = await railway(`mutation($environmentId:String!,$serviceId:String!){serviceDomainCreate(input:{environmentId:$environmentId,serviceId:$serviceId}){domain}}`, { environmentId: entorno, serviceId: servicio });
  return { proyecto: p.projectCreate.id as string, servicio, entorno: entorno as string, url: `https://${d.serviceDomainCreate.domain}` };
}

const FINALES = new Set(["SUCCESS", "FAILED", "CRASHED", "REMOVED", "SKIPPED", "SLEEPING"]);

async function ultimoDespliegue(servicio: string, entorno: string): Promise<{ id: string; status: string; createdAt: string } | null> {
  const d = await railway(`query($input:DeploymentListInput!){deployments(input:$input,first:1){edges{node{id status createdAt}}}}`, { input: { serviceId: servicio, environmentId: entorno } });
  return d.deployments.edges[0]?.node || null;
}

export async function logsDespliegue(deploymentId: string, lineas = 60): Promise<string> {
  const q = (campo: string) => railway(`query($id:String!,$n:Int){${campo}(deploymentId:$id,limit:$n){message severity}}`, { id: deploymentId, n: lineas }).then((d: any) => d[campo] as any[]).catch(() => []);
  const [build, run] = await Promise.all([q("buildLogs"), q("deploymentLogs")]);
  const fmt = (xs: any[]) => xs.map((l) => l.message).join("\n").slice(-3000);
  return [build.length ? `── build ──\n${fmt(build)}` : "", run.length ? `── ejecución ──\n${fmt(run)}` : ""].filter(Boolean).join("\n");
}

/** Espera a que el despliegue más nuevo (posterior a `desde`) termine. */
async function esperarDespliegue(servicio: string, entorno: string, desde: number, maxSeg: number, alAvanzar?: (estado: string) => void) {
  const fin = Date.now() + maxSeg * 1000;
  let ultimo = "", visto: { id: string; status: string } | null = null;
  while (Date.now() < fin) {
    const d = await ultimoDespliegue(servicio, entorno).catch(() => null);
    if (d && new Date(d.createdAt).getTime() >= desde - 30_000) {
      visto = d;
      if (d.status !== ultimo) { ultimo = d.status; alAvanzar?.(d.status); }
      if (FINALES.has(d.status)) return { ...d, terminado: true };
    }
    await esperar(10_000);
  }
  return visto ? { ...visto, terminado: false } : null;
}

async function responde(url: string): Promise<{ ok: boolean; status: number | null; ms: number }> {
  const t = Date.now();
  for (let i = 0; i < 6; i++) {
    try {
      const r = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(15_000) });
      if (r.status < 500) return { ok: r.status < 400, status: r.status, ms: Date.now() - t };
    } catch { /* aún arrancando */ }
    await esperar(5_000);
  }
  return { ok: false, status: null, ms: Date.now() - t };
}

export async function obtenerDespliegue(nombreOCarpeta: string): Promise<Despliegue | undefined> {
  const r = await db.query<Despliegue>(`SELECT * FROM despliegues WHERE nombre = $1 OR carpeta = $1 OR repo = $1 LIMIT 1`, [nombreOCarpeta]);
  return r.rows[0];
}
export async function listarDespliegues(): Promise<Despliegue[]> {
  return (await db.query<Despliegue>(`SELECT * FROM despliegues ORDER BY actualizado_en DESC LIMIT 50`)).rows;
}

export interface ResultadoPublicar {
  nombre: string; repo: string; repo_url: string; commit: string; nuevo: boolean;
  url?: string; estado?: string; responde?: { ok: boolean; status: number | null }; logs?: string; en_progreso?: boolean;
}

/** Todo el camino: repo, push, Railway, espera y verificación. */
export async function publicarCarpeta(op: {
  carpeta: string; nombre?: string; privado?: boolean; desplegar?: boolean; variables?: Record<string, string>;
  mensaje?: string; descripcion?: string; esperaSeg?: number; alAvanzar?: (texto: string) => void;
}): Promise<ResultadoPublicar> {
  const carpeta = path.resolve(op.carpeta);
  const previo = await obtenerDespliegue(carpeta);
  const nombre = previo?.nombre || slugRepo(op.nombre || path.basename(carpeta).replace(/^\d{8}-\d{4}-/, ""));
  const rama = previo?.rama || "main";
  const gh = previo?.repo ? { repo: previo.repo, url: `https://github.com/${previo.repo}`, nuevo: false } : await asegurarRepo(nombre, op.privado !== false, op.descripcion);
  const desde = Date.now();
  const subida = await subirCarpeta(carpeta, gh.repo, rama, op.mensaje || (previo ? "Actualización de Sage" : "Primera versión (Sage)"));
  op.alAvanzar?.(`📦 Subido a GitHub: ${gh.repo} (${subida.commit})`);
  await db.query(
    `INSERT INTO despliegues (nombre, carpeta, repo, rama) VALUES ($1,$2,$3,$4)
     ON CONFLICT (nombre) DO UPDATE SET carpeta = EXCLUDED.carpeta, repo = EXCLUDED.repo, actualizado_en = now()`,
    [nombre, carpeta, gh.repo, rama]);
  const res: ResultadoPublicar = { nombre, repo: gh.repo, repo_url: gh.url, commit: subida.commit, nuevo: gh.nuevo };
  if (op.desplegar === false) return res;

  let rw = previo?.railway_servicio ? { proyecto: previo.railway_proyecto!, servicio: previo.railway_servicio, entorno: previo.railway_entorno!, url: previo.url! } : null;
  if (!rw) {
    rw = await crearEnRailway(nombre, gh.repo, rama, op.variables);
    await db.query(`UPDATE despliegues SET railway_proyecto=$2, railway_servicio=$3, railway_entorno=$4, url=$5, actualizado_en=now() WHERE nombre=$1`, [nombre, rw.proyecto, rw.servicio, rw.entorno, rw.url]);
    op.alAvanzar?.(`🚂 Proyecto creado en Railway, construyendo…`);
  } else if (op.variables && Object.keys(op.variables).length) {
    await railway(`mutation($projectId:String!,$serviceId:String!,$environmentId:String!,$variables:EnvironmentVariables!){variableCollectionUpsert(input:{projectId:$projectId,serviceId:$serviceId,environmentId:$environmentId,variables:$variables})}`,
      { projectId: rw.proyecto, serviceId: rw.servicio, environmentId: rw.entorno, variables: op.variables });
  }
  res.url = rw.url;
  if (previo?.railway_servicio && !subida.cambios) {
    // Sin commit nuevo no hay despliegue automático: lo pido a mano.
    await railway(`mutation($environmentId:String!,$serviceId:String!){serviceInstanceDeployV2(environmentId:$environmentId,serviceId:$serviceId)}`, { environmentId: rw.entorno, serviceId: rw.servicio });
  }
  const d = await esperarDespliegue(rw.servicio, rw.entorno, desde, op.esperaSeg ?? 600, (e) => op.alAvanzar?.(`🚂 Railway: ${e}`));
  res.estado = d?.status || "SIN_DESPLIEGUE";
  res.en_progreso = !!d && !d.terminado;
  await db.query(`UPDATE despliegues SET estado=$2, actualizado_en=now() WHERE nombre=$1`, [nombre, res.estado]);
  if (d?.status === "SUCCESS") res.responde = await responde(rw.url);
  else if (d && d.terminado) res.logs = await logsDespliegue(d.id);
  return res;
}

/** Estado actual de algo ya publicado: último despliegue, si la URL responde y logs si falló. */
export async function estadoPublicado(nombre: string) {
  const p = await obtenerDespliegue(nombre);
  if (!p) throw new Error(`No hay nada publicado con el nombre "${nombre}".`);
  if (!p.railway_servicio) return { ...p, despliegue: null };
  const d = await ultimoDespliegue(p.railway_servicio, p.railway_entorno!);
  if (d) await db.query(`UPDATE despliegues SET estado=$2, actualizado_en=now() WHERE id=$1`, [p.id, d.status]);
  const r = d?.status === "SUCCESS" && p.url ? await responde(p.url) : undefined;
  const logs = d && d.status !== "SUCCESS" && FINALES.has(d.status) ? await logsDespliegue(d.id) : undefined;
  return { ...p, estado: d?.status || p.estado, despliegue: d, responde: r, logs };
}
