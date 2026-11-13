// ARCHIVO: src/motor/laboratorio-system.ts
// ─────────────────────────────────────────────────────────────────────────────
//  EL LABORATORIO DE SYSTEM (su puesto de trabajo)
//  Dos pistas:
//   • CONTENEDOR (Docker): código, algoritmos, herramientas y librerías nuevas.
//     Cada prueba corre en su carpeta, en un contenedor sin red (salvo que pida
//     red para instalar), sin root, con memoria/CPU/procesos limitados. Nada
//     de lo que pase ahí toca tu PC ni tus proyectos.
//   • GEMELO: una copia de un agente con un cambio (otro modelo, otro ejemplo,
//     otra regla) responde los MISMOS casos reales que el agente actual, y un
//     juez los compara. Así System sabe con números si el cambio sirve antes
//     de proponerlo. (El gemelo responde sin herramientas: mide criterio y
//     forma; lo que dependa de herramientas se mide después en producción.)
//  Todo queda registrado en sys_laboratorio.
//  .env: LAB_MODO=docker (por defecto) | local (solo pruebas), LAB_IMAGEN=emilia-lab
// ─────────────────────────────────────────────────────────────────────────────
import { query } from "../db/cliente.js";
import { promises as fs } from "node:fs";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const ejec = promisify(execFile);
const LAB_BASE = () => path.resolve(process.env.LABORATORIO_DIR || path.join("data", "laboratorio"));
const IMAGEN = () => process.env.LAB_IMAGEN || "emilia-lab";
const MODO = () => (process.env.LAB_MODO || "docker").toLowerCase();

let dockerListo: Promise<void> | null = null;
/** Verifica Docker y construye la imagen del laboratorio la primera vez. */
export function asegurarDocker(): Promise<void> {
  if (!dockerListo) dockerListo = (async () => {
    try { await ejec("docker", ["version", "--format", "{{.Server.Version}}"], { timeout: 20_000, windowsHide: true }); }
    catch { dockerListo = null; throw new Error("Docker no está disponible: instala Docker Desktop (y ábrelo) para que System tenga su laboratorio. Mientras tanto no corro código."); }
    try { await ejec("docker", ["image", "inspect", IMAGEN()], { timeout: 20_000, windowsHide: true }); }
    catch {
      const ctx = path.resolve("scripts", "system", "laboratorio");
      console.log(`[laboratorio] construyendo la imagen ${IMAGEN()} (solo la primera vez)…`);
      await ejec("docker", ["build", "-t", IMAGEN(), ctx], { timeout: 15 * 60_000, windowsHide: true, maxBuffer: 32 * 1024 * 1024 }).catch((e) => { dockerListo = null; throw new Error(`No pude construir la imagen del laboratorio: ${String(e?.stderr || e?.message || e).slice(-600)}`); });
    }
  })();
  return dockerListo;
}

export interface ResultadoLab { id: string; dir: string; archivos: string[]; comando: string; codigo: number; timeout: boolean; ms: number; stdout: string; stderr: string; aislado: "docker" | "local" }

/** Corre archivos + comando en el laboratorio. Una sola llamada. */
export async function correrEnLaboratorio(p: { archivos: Record<string, string>; comando: string; timeoutSeg?: number; nombre?: string; red?: boolean; memoriaMb?: number }): Promise<ResultadoLab> {
  const modo = MODO() === "local" ? "local" : "docker";
  if (modo === "local" && (/\b(rm\s+-rf?\s+[\/~]|shutdown|curl|wget)\b/i.test(p.comando) || /[a-z][a-z0-9+.-]*:\/\//i.test(p.comando))) throw new Error("Modo local: nada de borrar fuera ni llamar URLs.");
  const id = `${new Date().toISOString().slice(0, 10)}-${(p.nombre || "exp").replace(/[^a-z0-9_-]/gi, "").slice(0, 30) || "exp"}-${Math.random().toString(36).slice(2, 7)}`;
  const dir = path.join(LAB_BASE(), id);
  await fs.mkdir(dir, { recursive: true });
  const escritos: string[] = [];
  for (const [nombre, contenido] of Object.entries(p.archivos || {})) {
    const abs = path.resolve(dir, nombre);
    if (!abs.startsWith(dir + path.sep) && abs !== dir) throw new Error(`Ruta fuera del laboratorio: ${nombre}`);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, String(contenido ?? ""), "utf-8");
    escritos.push(nombre);
  }
  const timeout = Math.max(5, Math.min(900, p.timeoutSeg || 120)) * 1000;
  let args: string[], cmd: string, nombreCont = "";
  if (modo === "docker") {
    await asegurarDocker();
    nombreCont = `emilia-lab-${id}`.toLowerCase().slice(0, 60);
    cmd = "docker";
    args = ["run", "--rm", "--name", nombreCont, "--network", p.red ? "bridge" : "none",
      "--memory", `${Math.max(256, Math.min(4096, p.memoriaMb || 1024))}m`, "--cpus", "1.5", "--pids-limit", "256",
      "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "-v", `${dir}:/lab`, "-w", "/lab", IMAGEN(), "sh", "-lc", p.comando];
  } else { cmd = process.platform === "win32" ? "cmd" : "sh"; args = process.platform === "win32" ? ["/c", p.comando] : ["-c", p.comando]; }
  const t0 = Date.now();
  const r = await new Promise<{ codigo: number; stdout: string; stderr: string; timeout: boolean }>((res) => {
    const ch = spawn(cmd, args, { cwd: dir, env: { ...process.env, NO_COLOR: "1", CI: "1" }, windowsHide: true });
    let out = "", err = "", vencido = false;
    ch.stdout.on("data", (d) => { out += d; if (out.length > 4_000_000) out = out.slice(-2_000_000); });
    ch.stderr.on("data", (d) => { err += d; if (err.length > 2_000_000) err = err.slice(-1_000_000); });
    const t = setTimeout(() => { vencido = true; if (nombreCont) execFile("docker", ["kill", nombreCont], () => {}); ch.kill("SIGKILL"); }, timeout);
    ch.on("close", (code) => { clearTimeout(t); res({ codigo: code ?? 1, stdout: out, stderr: err, timeout: vencido }); });
    ch.on("error", (e) => { clearTimeout(t); res({ codigo: 1, stdout: out, stderr: String(e?.message || e), timeout: false }); });
  });
  const ms = Date.now() - t0;
  const res: ResultadoLab = { id, dir, archivos: escritos, comando: p.comando, codigo: r.codigo, timeout: r.timeout, ms, stdout: r.stdout.slice(-8000), stderr: r.stderr.slice(-4000), aislado: modo };
  await query(`INSERT INTO sys_laboratorio (tipo, titulo, detalle, resultado) VALUES ('contenedor', $1, $2, $3)`, [p.nombre || p.comando.slice(0, 80), JSON.stringify({ comando: p.comando, archivos: escritos, red: !!p.red }), JSON.stringify({ codigo: res.codigo, ms, timeout: res.timeout, salida: res.stdout.slice(-1500) })]).catch(() => {});
  return res;
}

// ── Gemelos ──
export interface ResultadoGemelo { agente: string; casos: number; actual: { puntaje: number; seg: number; modelo: string }; gemelo: { puntaje: number; seg: number; modelo: string }; diferencia: number; detalle: { entrada: string; actual: number; gemelo: number; motivo: string }[]; veredicto: "mejor" | "igual" | "peor"; nota: string; labId?: string }

const leer = (o: any, r: string) => r.split(".").reduce((x, k) => (x == null ? undefined : x[k]), o);
function poner(o: any, r: string, v: any) { const ks = r.split("."); let x = o; for (const k of ks.slice(0, -1)) { if (x[k] == null || typeof x[k] !== "object") x[k] = {}; x = x[k]; } x[ks[ks.length - 1]] = v; }

/**
 * El gemelo: copia del agente con `cambios` aplicados (p. ej. { "cerebro.ejecutor": "openai/gpt-oss-20b" } o { "identidad.ejemplos": "…" }),
 * contra los mismos casos reales. Devuelve puntajes, tiempos y el veredicto.
 */
export async function probarGemelo(p: { agente: string; cambios: Record<string, any>; casos?: { entrada: string; referencia?: string; esperado?: string }[]; dias?: number; max?: number; criterio?: string; juez?: string; cambioId?: string | null }): Promise<ResultadoGemelo> {
  const [ag] = await query<any>(`SELECT * FROM agentes WHERE lower(nombre) = lower($1) LIMIT 1`, [p.agente]);
  if (!ag) throw new Error(`No existe el agente ${p.agente}.`);
  const A = await import("./aprendizaje.js");
  const casos = (p.casos?.length ? p.casos : await A.casosReales({ agente: ag.nombre, dias: p.dias || 21, limite: p.max || 8 })).slice(0, p.max || 8);
  if (casos.length < 3) throw new Error(`Hay muy pocos casos reales de ${ag.nombre} (${casos.length}) para comparar con números. Pásame casos o espera a que tenga más uso.`);
  const gem = structuredClone(ag);
  for (const [r, v] of Object.entries(p.cambios || {})) poner(gem, r, r === "identidad.ejemplos" && typeof v === "string" && !String(v).startsWith(leer(ag, r) || "") ? `${leer(ag, r) || ""}\n${v}` : v);
  const { herramientasDeAgente } = await import("./herramientas.js");
  const { armarSistema } = await import("./loop.js");
  const { invocables } = await herramientasDeAgente(ag.id);
  const lab = "LABORATORIO: responde el mensaje como lo harías normalmente, pero sin llamar herramientas (aquí no hay). Si necesitarías una herramienta, di brevemente qué harías y responde con la información que tengas.";
  const sAct = await armarSistema(ag, invocables, undefined, lab), sGem = await armarSistema(gem, invocables, undefined, lab);
  const mAct = leer(ag, "cerebro.ejecutor") || undefined, mGem = leer(gem, "cerebro.ejecutor") || undefined;
  const criterio = p.criterio || "responde lo que la persona necesita, correcto, claro y en el tono del agente, sin inventar datos";
  const t0 = Date.now(); const rA = await A.probarPrompt({ instrucciones: sAct, casos, modelo: mAct, juez: p.juez, criterio }); const segA = (Date.now() - t0) / 1000 / casos.length;
  const t1 = Date.now(); const rG = await A.probarPrompt({ instrucciones: sGem, casos, modelo: mGem, juez: p.juez, criterio }); const segG = (Date.now() - t1) / 1000 / casos.length;
  const diferencia = rG.promedio - rA.promedio;
  const veredicto = diferencia >= 3 ? "mejor" : diferencia <= -3 ? "peor" : "igual";
  const res: ResultadoGemelo = {
    agente: ag.nombre, casos: casos.length, diferencia, veredicto,
    actual: { puntaje: rA.promedio, seg: segA, modelo: mAct || "por defecto" }, gemelo: { puntaje: rG.promedio, seg: segG, modelo: mGem || "por defecto" },
    detalle: casos.map((c, i) => ({ entrada: c.entrada.slice(0, 100), actual: rA.resultados[i]?.puntaje ?? 0, gemelo: rG.resultados[i]?.puntaje ?? 0, motivo: rG.resultados[i]?.motivo || "" })),
    nota: "El gemelo responde sin herramientas: mide criterio y forma con casos reales; el efecto completo se mide en producción durante 7 días.",
  };
  const [l] = await query<{ id: string }>(`INSERT INTO sys_laboratorio (tipo, titulo, agente, detalle, resultado, cambio_id) VALUES ('gemelo', $1, $2, $3, $4, $5) RETURNING id`,
    [`Gemelo de ${ag.nombre}: ${Object.keys(p.cambios).join(", ")}`, ag.nombre, JSON.stringify({ cambios: p.cambios, casos: casos.length }), JSON.stringify(res), p.cambioId ?? null]);
  res.labId = l.id;
  return res;
}
export const textoGemelo = (r: ResultadoGemelo) => `🧪 Gemelo de ${r.agente} (${r.casos} casos reales): actual ${r.actual.puntaje.toFixed(1)} (${r.actual.modelo}, ${r.actual.seg.toFixed(1)} s/caso) vs. gemelo ${r.gemelo.puntaje.toFixed(1)} (${r.gemelo.modelo}, ${r.gemelo.seg.toFixed(1)} s/caso) → ${r.veredicto === "mejor" ? "MEJOR" : r.veredicto === "peor" ? "PEOR" : "IGUAL"} (${r.diferencia >= 0 ? "+" : ""}${r.diferencia.toFixed(1)}).`;
