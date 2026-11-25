// ARCHIVO: src/arca/mantenimiento.ts
// ─────────────────────────────────────────────────────────────────────────────
//  ARCA · MANTENIMIENTO DEL PC — revisa, propone, y actúa SOLO con tu OK.
//  · Instalar: solo lo del catálogo (winget / npm / playwright), nunca algo suelto.
//  · Limpiar: logs viejos, temporales viejos, lo que Docker ya no usa.
//  · Actualizar programas (winget upgrade) que tú elijas.
//  Cada acción queda en arca_acciones con lo que pasó: «Arca, ¿qué hiciste?».
// ─────────────────────────────────────────────────────────────────────────────
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { correr } from "./diagnostico.js";
import { query } from "../db/cliente.js";

const esWin = process.platform === "win32";

export interface Paquete { id: string; nombre: string; como: "winget" | "npm" | "playwright"; ref: string; chequeo: string; nota?: string }
/** Lo único que Arca instala. Para algo nuevo, se agrega aquí (código, con tu OK). */
export const CATALOGO: Paquete[] = [
  { id: "node", nombre: "Node.js LTS", como: "winget", ref: "OpenJS.NodeJS.LTS", chequeo: "node" },
  { id: "git", nombre: "Git", como: "winget", ref: "Git.Git", chequeo: "git" },
  { id: "postgres", nombre: "PostgreSQL 16", como: "winget", ref: "PostgreSQL.PostgreSQL.16", chequeo: "postgres", nota: "El instalador te pide una clave para el usuario postgres: anótala, va en DATABASE_URL." },
  { id: "docker", nombre: "Docker Desktop", como: "winget", ref: "Docker.DockerDesktop", chequeo: "docker", nota: "Pide reiniciar el PC al terminar." },
  { id: "whatsapp", nombre: "WhatsApp de escritorio", como: "winget", ref: "9NKSQGP7F2NH", chequeo: "wa_escritorio", nota: "Viene de la Microsoft Store; después lo vinculas con el QR." },
  { id: "ngrok", nombre: "ngrok", como: "winget", ref: "Ngrok.Ngrok", chequeo: "tunel" },
  { id: "claude_code", nombre: "Claude Code", como: "npm", ref: "@anthropic-ai/claude-code", chequeo: "claude_code", nota: "Después corre «claude» una vez para iniciar sesión." },
  { id: "playwright", nombre: "Navegador de los agentes (Chromium)", como: "playwright", ref: "chromium", chequeo: "playwright" },
  { id: "vscode", nombre: "Visual Studio Code", como: "winget", ref: "Microsoft.VisualStudioCode", chequeo: "" },
  { id: "python", nombre: "Python 3.12", como: "winget", ref: "Python.Python.3.12", chequeo: "" },
];
export const paquete = (id: string) => CATALOGO.find((p) => p.id === id.toLowerCase().trim() || p.nombre.toLowerCase() === id.toLowerCase().trim());

export async function anotar(tipo: string, que: string, ok: boolean, detalle: string) {
  await query(`INSERT INTO arca_acciones (tipo, que, ok, detalle) VALUES ($1,$2,$3,$4)`, [tipo, que, ok, detalle.slice(0, 2000)]).catch(() => {});
}

export async function instalar(id: string): Promise<{ ok: boolean; detalle: string }> {
  const p = paquete(id);
  if (!p) return { ok: false, detalle: `«${id}» no está en mi catálogo. Lo que instalo: ${CATALOGO.map((x) => x.id).join(", ")}.` };
  let r: { codigo: number; salida: string };
  if (p.como === "winget") {
    if (!esWin) return { ok: false, detalle: "winget es de Windows." };
    r = await correr("winget", ["install", "--id", p.ref, "-e", "--silent", "--accept-source-agreements", "--accept-package-agreements", ...(/^\d|^9N/.test(p.ref) ? ["--source", "msstore"] : [])], 1800);
    if (/already installed|ya está instalado|No newer package|No se encontró ninguna versión más reciente/i.test(r.salida)) r.codigo = 0;
  } else if (p.como === "npm") r = await correr(esWin ? "npm.cmd" : "npm", ["install", "-g", p.ref], 900);
  else r = await correr(esWin ? "npx.cmd" : "npx", ["playwright", "install", p.ref], 1200);
  // Verificar de verdad (no basta con que el instalador diga que sí).
  let verif = "";
  if (p.chequeo) {
    const { CHEQUEOS } = await import("./diagnostico.js");
    const c = await CHEQUEOS[p.chequeo]().catch(() => null);
    verif = c ? ` Revisión: ${c.estado === "ok" ? "✅" : "⚠️"} ${c.detalle}` : "";
    if (c && c.estado !== "ok" && r.codigo === 0) verif += " (puede que necesites cerrar y abrir la terminal, o reiniciar).";
  }
  const ok = r.codigo === 0;
  const detalle = ok ? `${p.nombre} instalado.${verif}${p.nota ? ` Ojo: ${p.nota}` : ""}` : `${p.nombre} no se instaló (código ${r.codigo}): ${r.salida.slice(-300)}`;
  await anotar("instalar", p.nombre, ok, detalle);
  return { ok, detalle };
}

function tamano(dir: string, maxArchivos = 20000): number {
  let total = 0, n = 0;
  const pila = [dir];
  while (pila.length && n < maxArchivos) {
    const d = pila.pop()!;
    let es: fs.Dirent[] = []; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of es) { const p = path.join(d, e.name); n++; try { if (e.isDirectory()) pila.push(p); else total += fs.statSync(p).size; } catch {} }
  }
  return total;
}
const gb = (b: number) => (b < 1e9 ? `${Math.round(b / 1e6)} MB` : `${(b / 1e9).toFixed(b > 1e10 ? 0 : 1)} GB`);

export interface ItemMant { id: string; nombre: string; detalle: string; liberable?: number; accion?: string }

export async function revisarMantenimiento(): Promise<ItemMant[]> {
  const items: ItemMant[] = [];
  try { const st: any = await (fs.promises as any).statfs(process.cwd()); const libre = st.bavail * st.bsize, tot = st.blocks * st.bsize; items.push({ id: "disco", nombre: "Disco", detalle: `${gb(libre)} libres de ${gb(tot)} (${Math.round((libre / tot) * 100)}%).${libre < 15e9 ? " ⚠️ Queda poco." : ""}` }); } catch {}
  items.push({ id: "ram", nombre: "Memoria", detalle: `${gb(os.freemem())} libres de ${gb(os.totalmem())}.` });
  const logs = path.resolve(process.env.LOGS_DIR || "logs");
  if (fs.existsSync(logs)) { const t = tamano(logs); items.push({ id: "logs", nombre: "Logs de Emilia", detalle: gb(t), liberable: t > 2e8 ? t * 0.5 : 0, accion: t > 2e8 ? "limpiar logs" : undefined }); }
  const tmp = os.tmpdir(); const tt = tamano(tmp, 30000);
  items.push({ id: "temp", nombre: "Temporales", detalle: gb(tt), liberable: tt > 1e9 ? tt * 0.6 : 0, accion: tt > 1e9 ? "limpiar temp" : undefined });
  const d = await correr("docker", ["system", "df", "--format", "{{.Type}}|{{.Reclaimable}}"], 30);
  if (d.codigo === 0) { const rec = d.salida.split("\n").map((l) => l.split("|")).filter((x) => x[1]); items.push({ id: "docker", nombre: "Docker", detalle: rec.map(([t, r]) => `${t}: ${r} recuperable`).join(" · "), accion: rec.some(([, r]) => /GB/.test(r)) ? "limpiar docker" : undefined }); }
  const lab = path.resolve(process.env.LAB_DIR || path.join(os.homedir(), "EmiliaLab"));
  if (fs.existsSync(lab)) items.push({ id: "lab", nombre: "Laboratorio de Sage", detalle: `${gb(tamano(lab))} (no lo borro: puede tener trabajo; pídele a Sage que cierre sandboxes).` });
  if (esWin) {
    const w = await correr("winget", ["upgrade", "--include-unknown", "--accept-source-agreements"], 90);
    const filas = w.salida.split("\n").filter((l) => /\S+\s+\S+\s+\d[\w.]*\s+\d[\w.]*/.test(l) && !/^Nombre|^Name|^-/.test(l));
    items.push({ id: "programas", nombre: "Programas con actualización", detalle: filas.length ? `${filas.length}: ${filas.slice(0, 6).map((f) => f.trim().split(/\s{2,}/)[0]).join(", ")}${filas.length > 6 ? "…" : ""}` : "Todo al día.", accion: filas.length ? "actualizar programas" : undefined });
  }
  return items;
}

function borrarViejos(dir: string, dias: number): { n: number; bytes: number } {
  let n = 0, bytes = 0; const lim = Date.now() - dias * 86_400_000;
  let es: fs.Dirent[] = []; try { es = fs.readdirSync(dir, { withFileTypes: true }); } catch { return { n, bytes }; }
  for (const e of es) {
    const p = path.join(dir, e.name);
    try {
      const st = fs.statSync(p);
      if (st.mtimeMs > lim) continue;
      if (e.isDirectory()) { const t = tamano(p); fs.rmSync(p, { recursive: true, force: true }); bytes += t; } else { fs.unlinkSync(p); bytes += st.size; }
      n++;
    } catch {}   // en uso o sin permiso: se deja
  }
  return { n, bytes };
}

export async function limpiar(que: string[]): Promise<{ ok: boolean; detalle: string }> {
  const hecho: string[] = []; let total = 0;
  for (const q of que.map((x) => x.toLowerCase())) {
    if (q === "logs") { const r = borrarViejos(path.resolve(process.env.LOGS_DIR || "logs"), 7); total += r.bytes; hecho.push(`logs: ${r.n} archivo(s) de más de 7 días (${gb(r.bytes)})`); }
    else if (q === "temp") { const r = borrarViejos(os.tmpdir(), 7); total += r.bytes; hecho.push(`temporales: ${r.n} cosa(s) de más de 7 días (${gb(r.bytes)})`); }
    else if (q === "docker") { const r = await correr("docker", ["system", "prune", "-f"], 600); const m = r.salida.match(/reclaimed space:\s*(.+)/i); hecho.push(`docker: ${r.codigo === 0 ? `contenedores parados e imágenes sueltas fuera (${m?.[1] || "0B"})` : `falló: ${r.salida.slice(-150)}`}`); }
    else hecho.push(`${q}: no sé limpiar eso (sé: logs, temp, docker)`);
  }
  const detalle = `Limpié → ${hecho.join(" · ")}${total ? `. Liberé ${gb(total)} en archivos.` : ""}`;
  await anotar("limpiar", que.join(", "), true, detalle);
  return { ok: true, detalle };
}

export async function actualizarProgramas(ids: string[]): Promise<{ ok: boolean; detalle: string }> {
  if (!esWin) return { ok: false, detalle: "winget es de Windows." };
  const res: string[] = []; let todoOk = true;
  const lista = ids.length ? ids : ["--all"];
  for (const id of lista) {
    const r = await correr("winget", id === "--all" ? ["upgrade", "--all", "--silent", "--accept-source-agreements", "--accept-package-agreements"] : ["upgrade", "--id", id, "-e", "--silent", "--accept-source-agreements", "--accept-package-agreements"], 3600);
    const ok = r.codigo === 0 || /No (applicable|newer)|ninguna/i.test(r.salida); todoOk &&= ok;
    res.push(`${id === "--all" ? "todo" : id}: ${ok ? "✅" : `❌ ${r.salida.slice(-120)}`}`);
  }
  const detalle = res.join(" · ");
  await anotar("actualizar", lista.join(", "), todoOk, detalle);
  return { ok: todoOk, detalle };
}

export async function queHice(dias = 7): Promise<string> {
  const xs = await query<any>(`SELECT tipo, que, ok, detalle, creado_en FROM arca_acciones WHERE creado_en > now() - make_interval(days => $1) ORDER BY creado_en DESC LIMIT 30`, [dias]).catch(() => [] as any[]);
  if (!xs.length) return `En los últimos ${dias} días no he tocado nada del PC.`;
  return xs.map((x: any) => `${x.ok ? "✅" : "❌"} ${new Date(x.creado_en).toLocaleString("es-CO", { timeZone: "America/Bogota", dateStyle: "short", timeStyle: "short" })} · ${x.tipo} ${x.que}: ${x.detalle}`).join("\n");
}
