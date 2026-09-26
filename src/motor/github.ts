// ARCHIVO: src/motor/github.ts
// ─────────────────────────────────────────────────────────────────────────────
//  GITHUB — API REST con token personal (GITHUB_TOKEN en .env)
//  Crear repos, abrir PRs, consultar. El push se hace con git, autenticando
//  la llamada con el token en la cabecera (nunca se guarda en el remoto).
// ─────────────────────────────────────────────────────────────────────────────

import { ejecutarComando, type SalidaComando } from "./sandbox.js";

const API = "https://api.github.com";

function token(): string {
  const t = process.env.GITHUB_TOKEN;
  if (!t) throw new Error("Falta GITHUB_TOKEN en el .env.");
  return t;
}

async function gh<T = any>(metodo: string, ruta: string, body?: unknown): Promise<T> {
  const resp = await fetch(`${API}${ruta}`, {
    method: metodo,
    headers: { Authorization: `Bearer ${token()}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "emilia", ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  const data: any = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(`GitHub ${metodo} ${ruta} → ${resp.status}: ${data?.message || JSON.stringify(data).slice(0, 200)}${data?.errors ? " · " + JSON.stringify(data.errors).slice(0, 300) : ""}`);
  return data as T;
}

export async function usuario(): Promise<{ login: string; name: string | null }> {
  const u = await gh("GET", "/user");
  return { login: u.login, name: u.name };
}

export async function crearRepo(p: { nombre: string; descripcion?: string; privado?: boolean }): Promise<{ html_url: string; clone_url: string; full_name: string; default_branch: string }> {
  const r = await gh("POST", "/user/repos", { name: p.nombre, description: p.descripcion || "", private: p.privado !== false, auto_init: false });
  return { html_url: r.html_url, clone_url: r.clone_url, full_name: r.full_name, default_branch: r.default_branch || "main" };
}

export async function infoRepo(fullName: string) {
  const r = await gh("GET", `/repos/${fullName}`);
  return { full_name: r.full_name, html_url: r.html_url, default_branch: r.default_branch, private: r.private, pushed_at: r.pushed_at, open_issues: r.open_issues_count };
}

export async function abrirPR(p: { fullName: string; head: string; base: string; titulo: string; cuerpo?: string; borrador?: boolean }) {
  const r = await gh("POST", `/repos/${p.fullName}/pulls`, { title: p.titulo, head: p.head, base: p.base, body: p.cuerpo || "", draft: !!p.borrador });
  return { numero: r.number, html_url: r.html_url, estado: r.state };
}

export async function listarPRs(fullName: string, estado: "open" | "closed" | "all" = "open") {
  const l: any[] = await gh("GET", `/repos/${fullName}/pulls?state=${estado}&per_page=20`);
  return l.map((r) => ({ numero: r.number, titulo: r.title, rama: r.head?.ref, base: r.base?.ref, estado: r.state, url: r.html_url, creado: r.created_at, mergeado: !!r.merged_at }));
}

/** Detecta owner/repo del remoto origin de un repo local. */
export async function fullNameDesdeRemoto(cwd: string): Promise<string | null> {
  const r = await ejecutarComando(cwd, "git remote get-url origin", 20);
  const m = r.stdout.trim().match(/github\.com[:/]([^/]+)\/([^/.\s]+)(\.git)?/);
  return m ? `${m[1]}/${m[2]}` : null;
}

/** Push autenticado con el token (cabecera efímera; el remoto queda sin credenciales). */
export async function pushConToken(cwd: string, rama: string, op: { setUpstream?: boolean } = {}): Promise<SalidaComando> {
  const basic = Buffer.from(`x-access-token:${token()}`).toString("base64");
  return ejecutarComando(cwd, `git -c http.extraheader="AUTHORIZATION: basic ${basic}" push ${op.setUpstream ? "-u" : ""} origin "${rama}"`, 240);
}

export async function conectarRemoto(cwd: string, cloneUrl: string): Promise<SalidaComando> {
  const existe = await ejecutarComando(cwd, "git remote get-url origin", 20);
  if (existe.codigo === 0) return ejecutarComando(cwd, `git remote set-url origin "${cloneUrl}"`, 20);
  return ejecutarComando(cwd, `git remote add origin "${cloneUrl}"`, 20);
}