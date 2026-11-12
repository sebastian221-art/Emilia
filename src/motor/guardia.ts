// ARCHIVO: src/motor/guardia.ts
// ─────────────────────────────────────────────────────────────────────────────
//  GUARDIA DE CÓDIGO — qué revisa Sage en cada ronda (sin tocar tu código real)
//   • Rama base: si entró un commit nuevo a GitHub, lo verifica en una copia
//     propia (<sandboxes>/<proyecto>/_guardia): build, lint y tests.
//   • Proceso local: caído, no responde, lento; ráfagas de errores en los logs.
//   • Producción: la URL responde (5xx o caída = grave).
//   • Dependencias: npm audit una vez al día.
//   • Lo publicado por Sage en Railway: despliegue fallido o URL caída.
//  Cada hallazgo tiene una huella: se registra una vez, cuenta repeticiones y se
//  marca resuelto solo cuando una revisión del mismo tipo ya no lo ve.
// ─────────────────────────────────────────────────────────────────────────────
import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { query } from "../db/cliente.js";
import type { Proyecto } from "../dominio/proyectos.js";
import { git, ejecutarComando, escribirEnvPrueba, ramaBaseReal, SANDBOX_DIR } from "./sandbox.js";
import { estadoProceso, saludProceso, leerLogs } from "./runtime.js";

export type Severidad = "grave" | "leve";
export interface Hallazgo { origen: string; severidad: Severidad; titulo: string; detalle: string; huella: string }
export interface Revision { revisados: string[]; hallazgos: Hallazgo[]; notas: string[] }
export interface ConfigGuardia {
  proyecto_id: string; activo: boolean; url_produccion: string | null; auto_reparar: boolean;
  ultimo_commit: string | null; lock_hash: string | null; ultima_auditoria: string | null; ultima_ronda: string | null;
}
export interface FilaHallazgo {
  id: string; objetivo: string; tipo_objetivo: "proyecto" | "publicado"; origen: string; severidad: Severidad; titulo: string; detalle: string;
  huella: string; estado: string; sandbox_id: string | null; informe: string | null; intentos: number; veces: number;
  primero_en: string; ultimo_en: string; resuelto_en: string | null;
}

/** Huella estable: quita números, fechas, rutas temporales y hashes para que el mismo error dé lo mismo. */
export function huella(origen: string, texto: string): string {
  const norm = texto.toLowerCase()
    .replace(/\b[0-9a-f]{7,40}\b/g, "#").replace(/\d+(\.\d+)?\s*(ms|s|m)\b/g, "T").replace(/\d+/g, "N")
    .replace(/[a-z]:\\[^\s:]+|\/(tmp|var|home|users)\/[^\s:]+/g, "RUTA").replace(/\s+/g, " ").trim();
  return crypto.createHash("sha1").update(`${origen}|${norm}`).digest("hex").slice(0, 16);
}

/** Las líneas que dicen QUÉ falló (para el detalle y la huella). */
function lineasDeFallo(salida: string, max = 12): string[] {
  const ls = salida.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const malas = ls.filter((l) => /(fail|error|✘|✗|×|not ok|assert|expected|cannot|undefined is not|TypeError|ReferenceError|SyntaxError|TS\d{4})/i.test(l) && !/^\s*(at |node:internal)/.test(l));
  return (malas.length ? malas : ls.slice(-max)).slice(0, max);
}

const cola = (s: string, n = 1800) => (s.length > n ? `…${s.slice(-n)}` : s);

export async function configGuardia(proyectoId: string): Promise<ConfigGuardia | undefined> {
  return (await query<ConfigGuardia>(`SELECT * FROM guardia_proyectos WHERE proyecto_id = $1`, [proyectoId]))[0];
}

// ── Rama base: build, lint y tests de lo último en GitHub ─────────────────────
async function copiaGuardia(p: Proyecto, ref: string): Promise<string> {
  const ruta = path.join(SANDBOX_DIR, p.nombre, "_guardia");
  const existe = await fs.access(path.join(ruta, ".git")).then(() => true, () => false);
  if (!existe) {
    await git(p.ruta, "worktree prune");
    await fs.mkdir(path.dirname(ruta), { recursive: true });
    const r = await git(p.ruta, `worktree add --detach "${ruta}" ${ref}`, 180);
    if (r.codigo !== 0) throw new Error(`No pude crear la copia de guardia: ${(r.stderr || r.stdout).trim()}`);
  } else {
    const r = await git(ruta, `checkout --detach -f ${ref}`, 120);
    if (r.codigo !== 0) throw new Error(`No pude actualizar la copia de guardia: ${(r.stderr || r.stdout).trim()}`);
    await git(ruta, "clean -fd"); // sin -x: conserva node_modules y el .env de prueba
  }
  await escribirEnvPrueba(p, ruta);
  return ruta;
}

async function hashDependencias(ruta: string): Promise<string> {
  const h = crypto.createHash("sha1");
  for (const f of ["package.json", "package-lock.json", "pnpm-lock.yaml", "yarn.lock", "requirements.txt"]) {
    try { h.update(f).update(await fs.readFile(path.join(ruta, f))); } catch { /* no existe */ }
  }
  return h.digest("hex").slice(0, 16);
}

export async function revisarBase(p: Proyecto, cfg: ConfigGuardia, forzar = false): Promise<Revision & { commit?: string; lock?: string; copia?: string }> {
  const base = await ramaBaseReal(p);
  const notas: string[] = [];
  const conRemoto = !!(await git(p.ruta, "remote")).stdout.trim();
  if (conRemoto) {
    const f = await git(p.ruta, `fetch -q origin ${base}`, 180);
    if (f.codigo !== 0) notas.push(`No pude traer lo último de GitHub: ${(f.stderr || f.stdout).trim().slice(0, 200)}`);
  }
  const ref = conRemoto && (await git(p.ruta, `rev-parse --verify --quiet origin/${base}`)).codigo === 0 ? `origin/${base}` : base;
  const commit = (await git(p.ruta, `rev-parse ${ref}`)).stdout.trim();
  if (!commit) return { revisados: [], hallazgos: [], notas: [...notas, `No encuentro la rama ${base}.`] };
  if (!forzar && commit === cfg.ultimo_commit) return { revisados: [], hallazgos: [], notas: [...notas, `Sin commits nuevos en ${base} (${commit.slice(0, 7)}).`], commit };

  const copia = await copiaGuardia(p, commit);
  const quien = (await git(copia, `log -1 --format="%h · %an · %s"`)).stdout.trim();
  const hallazgos: Hallazgo[] = [], revisados: string[] = [];
  const lock = await hashDependencias(copia);
  const tieneNode = await fs.access(path.join(copia, "package.json")).then(() => true, () => false);
  const instalar = p.cmd_install || (tieneNode ? "npm install --no-audit --no-fund" : null);
  if (instalar && (lock !== cfg.lock_hash || !(await fs.access(path.join(copia, "node_modules")).then(() => true, () => !tieneNode)))) {
    const i = await ejecutarComando(copia, instalar, 900);
    if (i.codigo !== 0) {
      revisados.push("build");
      hallazgos.push({ origen: "build", severidad: "grave", titulo: `No instalan las dependencias de ${base}`, detalle: `Commit ${quien}\n$ ${instalar}\n${cola(i.stderr || i.stdout)}`, huella: huella("instalar", lineasDeFallo(i.stderr || i.stdout).join("\n")) });
      return { revisados, hallazgos, notas, commit, lock, copia };
    }
  }
  const pasos: [string, string | null, Severidad][] = [["build", p.cmd_build, "grave"], ["lint", p.cmd_lint, "leve"], ["tests", p.cmd_test, "grave"]];
  for (const [origen, cmd, sev] of pasos) {
    if (!cmd) continue;
    revisados.push(origen);
    const r = await ejecutarComando(copia, cmd, 900);
    if (r.codigo !== 0 || r.timeout) {
      const salida = `${r.stdout}\n${r.stderr}`;
      const fallos = r.timeout ? ["se pasó del tiempo (15 min)"] : lineasDeFallo(salida);
      hallazgos.push({
        origen, severidad: sev,
        titulo: origen === "tests" ? `Tests fallando en ${base}` : origen === "build" ? `El build de ${base} está roto` : `Lint con errores en ${base}`,
        detalle: `Commit ${quien}\n$ ${cmd}\n${fallos.join("\n")}\n\n${cola(salida, 1500)}`,
        huella: huella(origen, fallos.join("\n")),
      });
      if (origen === "build") break; // sin build no tiene sentido correr tests
    }
  }
  notas.push(`Verifiqué ${base} en ${commit.slice(0, 7)} (${quien}): ${hallazgos.length ? `${hallazgos.length} problema(s)` : "todo en verde"}.`);
  return { revisados, hallazgos, notas, commit, lock, copia };
}

// ── Proceso local y logs ─────────────────────────────────────────────────────
export async function revisarProceso(p: Proyecto, op: { soloLogs?: boolean } = {}): Promise<Revision> {
  if (!p.cmd_start) return { revisados: [], hallazgos: [], notas: [] };
  const est = await estadoProceso(p);
  const hallazgos: Hallazgo[] = [];
  const revisados = op.soloLogs ? ["logs"] : ["proceso", "salud", "logs"];
  if (op.soloLogs && est.estado !== "corriendo") return { revisados: [], hallazgos: [], notas: [`Proceso: ${est.estado} (la disponibilidad la vigila Iris).`] };
  if (!op.soloLogs && est.estado === "caido") {
    const err = (await leerLogs(p, { ultimas: 30, soloErrores: true })).slice(-8);
    hallazgos.push({ origen: "proceso", severidad: "grave", titulo: `${p.nombre} se cayó`, detalle: `Código de salida ${est.codigo_salida ?? "?"}.\nÚltimos errores:\n${err.join("\n") || "(sin errores en el log)"}`, huella: huella("proceso", `caido ${err.slice(-3).join("\n")}`) });
  }
  if (!op.soloLogs && est.estado === "corriendo" && (p.url_salud || p.puerto)) {
    const s = await saludProceso(p);
    if (!s.ok) hallazgos.push({ origen: "salud", severidad: "grave", titulo: `${p.nombre} está corriendo pero no responde`, detalle: `${s.url}: ${s.error || `HTTP ${s.status}`}`, huella: huella("salud", `no responde ${s.status || ""}`) });
    else if ((s.latencia_ms || 0) > 3000) hallazgos.push({ origen: "salud", severidad: "leve", titulo: `${p.nombre} responde lento`, detalle: `${s.url} tardó ${s.latencia_ms} ms.`, huella: huella("salud", "lento") });
  }
  if (est.estado === "corriendo") {
    const errores = await leerLogs(p, { ultimas: 300, soloErrores: true });
    const grupos = new Map<string, { n: number; ej: string }>();
    for (const l of errores) { const h = huella("logs", l.replace(/^\S+\s+\S+\s+/, "")); const g = grupos.get(h); if (g) g.n++; else grupos.set(h, { n: 1, ej: l }); }
    for (const [h, g] of [...grupos.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 5)) {
      hallazgos.push({ origen: "logs", severidad: g.n >= 30 ? "grave" : "leve", titulo: g.n >= 30 ? `Ráfaga de errores en ${p.nombre} (${g.n} en el log)` : `Error en el log de ${p.nombre}`, detalle: `${g.n} vez/veces en las últimas 300 líneas:\n${g.ej.slice(0, 600)}`, huella: h });
    }
  }
  return { revisados, hallazgos, notas: [`Proceso: ${est.estado}.`] };
}

// ── URL de producción ────────────────────────────────────────────────────────
export async function revisarUrl(url: string, nombre: string): Promise<Revision> {
  let status: number | null = null, error = "", ms = 0;
  for (let i = 0; i < 2; i++) {
    const t = Date.now();
    try { const r = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(20_000) }); status = r.status; ms = Date.now() - t; if (r.status < 500) break; }
    catch (e: any) { error = e?.cause?.code || e?.message || String(e); ms = Date.now() - t; }
    await new Promise((r) => setTimeout(r, 3000));
  }
  const h: Hallazgo[] = [];
  if (status === null || status >= 500) h.push({ origen: "url", severidad: "grave", titulo: `${nombre} en producción no responde`, detalle: `${url} → ${status ? `HTTP ${status}` : error}`, huella: huella("url", `caida ${status ?? "red"}`) });
  else if (status >= 400) h.push({ origen: "url", severidad: "leve", titulo: `${nombre} en producción responde ${status}`, detalle: `${url} → HTTP ${status}`, huella: huella("url", `http ${status}`) });
  else if (ms > 4000) h.push({ origen: "url", severidad: "leve", titulo: `${nombre} en producción va lento`, detalle: `${url} tardó ${ms} ms.`, huella: huella("url", "lento") });
  return { revisados: ["url"], hallazgos: h, notas: [`Producción: ${status ? `HTTP ${status} en ${ms} ms` : `sin respuesta (${error})`}.`] };
}

// ── Dependencias vulnerables (una vez al día) ────────────────────────────────
export async function revisarAuditoria(copia: string): Promise<Revision> {
  if (!(await fs.access(path.join(copia, "package-lock.json")).then(() => true, () => false))) return { revisados: [], hallazgos: [], notas: [] };
  const r = await ejecutarComando(copia, "npm audit --json --omit=dev", 180);
  let v: Record<string, number> = {}, detalle = "";
  try {
    const d = JSON.parse(r.stdout);
    v = d.metadata?.vulnerabilities || {};
    detalle = Object.values<any>(d.vulnerabilities || {}).filter((x) => ["critical", "high"].includes(x.severity)).slice(0, 10)
      .map((x) => `${x.name} (${x.severity})${x.fixAvailable ? " — tiene arreglo" : ""}`).join("\n");
  } catch { return { revisados: [], hallazgos: [], notas: ["npm audit no respondió (¿sin internet?)."] }; }
  const h: Hallazgo[] = [];
  if (v.critical) h.push({ origen: "auditoria", severidad: "grave", titulo: `${v.critical} vulnerabilidad(es) CRÍTICA(S) en dependencias`, detalle, huella: huella("auditoria", `critical ${detalle}`) });
  else if (v.high) h.push({ origen: "auditoria", severidad: "leve", titulo: `${v.high} vulnerabilidad(es) altas en dependencias`, detalle, huella: huella("auditoria", `high ${detalle}`) });
  return { revisados: ["auditoria"], hallazgos: h, notas: [`npm audit: ${v.critical || 0} críticas, ${v.high || 0} altas, ${v.moderate || 0} moderadas.`] };
}

// ── Registro de hallazgos ────────────────────────────────────────────────────
/** Guarda lo encontrado y cierra lo que ya no aparece. Devuelve qué es nuevo (o volvió) y qué se resolvió. */
export async function registrarRevision(objetivo: string, tipo: "proyecto" | "publicado", rev: Revision): Promise<{ nuevos: FilaHallazgo[]; resueltos: FilaHallazgo[] }> {
  const nuevos: FilaHallazgo[] = [];
  for (const h of rev.hallazgos) {
    const [antes] = await query<{ estado: string }>(`SELECT estado FROM guardia_hallazgos WHERE objetivo = $1 AND huella = $2`, [objetivo, h.huella]);
    const reabre = antes && ["resuelto", "entregado"].includes(antes.estado);
    const [f] = await query<FilaHallazgo>(
      `INSERT INTO guardia_hallazgos (objetivo, tipo_objetivo, origen, severidad, titulo, detalle, huella)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (objetivo, huella) DO UPDATE SET
         veces = guardia_hallazgos.veces + 1, ultimo_en = now(), detalle = EXCLUDED.detalle, severidad = EXCLUDED.severidad, titulo = EXCLUDED.titulo
         ${reabre ? ", estado = 'abierto', intentos = 0, resuelto_en = NULL, en_resumen = false, sandbox_id = NULL" : ""}
       RETURNING *`,
      [objetivo, tipo, h.origen, h.severidad, h.titulo, h.detalle, h.huella]);
    if (!antes || reabre) nuevos.push(f); // nuevo, o volvió después de estar resuelto
  }
  const resueltos = rev.revisados.length
    ? await query<FilaHallazgo>(
      `UPDATE guardia_hallazgos SET estado = 'resuelto', resuelto_en = now()
       WHERE objetivo = $1 AND origen = ANY($2::text[]) AND estado IN ('abierto','sin_arreglo','reparando','arreglo_listo') AND NOT (huella = ANY($3::text[]))
       RETURNING *`, [objetivo, rev.revisados, rev.hallazgos.map((h) => h.huella)])
    : [];
  return { nuevos, resueltos };
}

export async function hallazgosAbiertos(objetivo?: string): Promise<FilaHallazgo[]> {
  return query<FilaHallazgo>(
    `SELECT * FROM guardia_hallazgos WHERE estado IN ('abierto','reparando','arreglo_listo','sin_arreglo') ${objetivo ? "AND objetivo = $1" : ""}
     ORDER BY (severidad = 'grave') DESC, ultimo_en DESC LIMIT 100`, objetivo ? [objetivo] : []);
}

export async function marcarHallazgo(id: string, cambios: Partial<Pick<FilaHallazgo, "estado" | "sandbox_id" | "informe">> & { sumarIntento?: boolean }): Promise<void> {
  await query(
    `UPDATE guardia_hallazgos SET estado = COALESCE($2, estado), sandbox_id = COALESCE($3, sandbox_id), informe = COALESCE($4, informe),
       intentos = intentos + $5, resuelto_en = CASE WHEN $2 IN ('resuelto','entregado','ignorado') THEN now() ELSE resuelto_en END
     WHERE id = $1`,
    [id, cambios.estado ?? null, cambios.sandbox_id ?? null, cambios.informe ?? null, cambios.sumarIntento ? 1 : 0]);
}
