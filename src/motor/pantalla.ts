// ARCHIVO: src/motor/pantalla.ts
// ─────────────────────────────────────────────────────────────────────────────
//  CONTROLADOR DE PANTALLA para el uso del computador con Claude.
//  Interfaz común (Controlador) + implementación Windows que habla con UN
//  proceso de PowerShell persistente (scripts/pc/trabajador.ps1 +
//  EmiliaPantalla.cs). Coordenadas SIEMPRE en píxeles físicos.
//  Las pruebas usan un controlador simulado con la misma interfaz.
// ─────────────────────────────────────────────────────────────────────────────
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { exigirPc, abrir as abrirObjetivo } from "./pc.js";
import { enfocarVentana } from "./pc-control.js";

/** elevado: la ventana corre como administrador (1), no (0) o no se pudo saber (-1, casi siempre "sí"). */
export interface Ventana { proceso: string; pid: number; titulo: string; elevado?: number }
export interface Inspeccion { frente: Ventana; enPunto?: Ventana; cursor: { x: number; y: number }; ultimo: { x: number; y: number }; yoElevado?: boolean }
export type Boton = "izquierdo" | "derecho" | "medio";

export interface Controlador {
  iniciar(): Promise<{ ancho: number; alto: number }>;
  /** Captura (todo o una región física) a PNG, escalada para caber en max. */
  capturar(ruta: string, op: { region?: { x: number; y: number; ancho: number; alto: number }; maxAncho: number; maxAlto: number; agrandar?: boolean }): Promise<{ anchoOrig: number; altoOrig: number; ancho: number; alto: number }>;
  inspeccionar(punto?: { x: number; y: number }): Promise<Inspeccion>;
  mover(x: number, y: number): Promise<void>;
  clic(x: number | null, y: number | null, boton: Boton, veces: number, mods: string): Promise<void>;
  botonIzquierdo(abajo: boolean): Promise<void>;
  arrastrar(x1: number, y1: number, x2: number, y2: number, mods: string): Promise<void>;
  scroll(x: number | null, y: number | null, direccion: string, cantidad: number, mods: string): Promise<void>;
  teclas(combo: string, repetir: number): Promise<void>;
  mantenerTecla(combo: string, segundos: number): Promise<void>;
  /** "teclear" = tecla por tecla (terminales, remotos); "pegar" = portapapeles (apps normales, texto largo). */
  escribir(texto: string, modo: "teclear" | "pegar"): Promise<void>;
  /** Escribe usuario o clave de una credencial de Windows sin que el secreto salga de PowerShell. */
  credencial(nombre: string, campo: "usuario" | "clave", enter: boolean): Promise<void>;
  existeCredencial(nombre: string): Promise<boolean>;
  despierto(activo: boolean): Promise<void>;
  enfocar(objetivo: { proceso?: string; titulo?: string }): Promise<{ ok: boolean; ventana?: Ventana; error?: string }>;
  abrir(objetivo: string): Promise<void>;
  cerrar(): Promise<void>;
}

const RAIZ = process.cwd();
const ascii = (s: string) => s.replace(/[\u007f-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);

function ventana(linea: string | undefined): Ventana {
  const [, proceso = "", pid = "0", elevado = "0", ...t] = (linea || "").split("\t");
  return { proceso: proceso.toLowerCase(), pid: Number(pid) || 0, elevado: Number(elevado) || 0, titulo: t.join(" ") };
}

/** Implementación Windows: un trabajador de PowerShell por sesión. */
export class ControladorWindows implements Controlador {
  private hijo: ChildProcessWithoutNullStreams | null = null;
  private pendientes = new Map<number, { ok: (v: any) => void; mal: (e: Error) => void; t: NodeJS.Timeout }>();
  private sec = 0;
  private listo: Promise<string> | null = null;

  constructor(private op: { powershell?: string; referencias?: string } = {}) {}

  private arrancar(): Promise<string> {
    if (this.listo) return this.listo;
    this.listo = new Promise<string>((resolver, rechazar) => {
      const exe = this.op.powershell || (process.platform === "win32" ? "powershell" : "pwsh");
      const args = ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", path.join(RAIZ, "scripts", "pc", "trabajador.ps1"), "-Fuente", path.join(RAIZ, "scripts", "pc", "EmiliaPantalla.cs")];
      if (this.op.referencias) args.push("-Referencias", this.op.referencias);
      const h = spawn(exe, args, { windowsHide: true });
      this.hijo = h;
      const rl = readline.createInterface({ input: h.stdout });
      let inicial = true;
      const plazo = setTimeout(() => { rechazar(new Error("El control de pantalla no arrancó en 60 s.")); this.matar(); }, 60_000);
      rl.on("line", (l) => {
        const linea = l.replace(/^﻿/, "").trim();
        if (!linea.startsWith("{")) return;
        let m: any; try { m = JSON.parse(linea); } catch { return; }
        if (inicial && m.id === 0) {
          inicial = false; clearTimeout(plazo);
          return m.ok ? resolver(String(m.r)) : rechazar(new Error(m.error));
        }
        const p = this.pendientes.get(m.id);
        if (!p) return;
        clearTimeout(p.t); this.pendientes.delete(m.id);
        m.ok ? p.ok(m.r) : p.mal(new Error(String(m.error)));
      });
      let errores = "";
      h.stderr.on("data", (d) => { errores = (errores + d.toString()).slice(-2000); });
      h.on("exit", (c) => {
        clearTimeout(plazo);
        const e = new Error(`El control de pantalla se cerró (código ${c}). ${errores.trim().slice(-500)}`);
        for (const p of this.pendientes.values()) { clearTimeout(p.t); p.mal(e); }
        this.pendientes.clear(); this.hijo = null; this.listo = null;
        if (inicial) rechazar(e);
      });
      h.on("error", (e) => { clearTimeout(plazo); rechazar(new Error(`No pude lanzar PowerShell: ${e.message}`)); });
    });
    return this.listo;
  }

  private matar() { try { this.hijo?.kill(); } catch { /* ya murió */ } this.hijo = null; this.listo = null; }

  async orden(op: string, args: Record<string, unknown> = {}, timeoutSeg = 30): Promise<any> {
    await this.arrancar();
    const id = ++this.sec;
    return new Promise((ok, mal) => {
      const t = setTimeout(() => { this.pendientes.delete(id); mal(new Error(`"${op}" no respondió en ${timeoutSeg} s; reinicio el control de pantalla.`)); this.matar(); }, timeoutSeg * 1000);
      this.pendientes.set(id, { ok, mal, t });
      this.hijo!.stdin.write(ascii(JSON.stringify({ id, op, ...args })) + "\n");
    });
  }

  async iniciar() {
    if (process.platform === "win32") exigirPc();
    const r = await this.arrancar();
    const [, ancho, alto] = r.match(/(\d+) (\d+)/) || [];
    return { ancho: Number(ancho) || 1920, alto: Number(alto) || 1080 };
  }
  async capturar(ruta: string, op: { region?: { x: number; y: number; ancho: number; alto: number }; maxAncho: number; maxAlto: number; agrandar?: boolean }) {
    const g = op.region || { x: 0, y: 0, ancho: 0, alto: 0 };
    const r = String(await this.orden("capturar", { ruta, x: Math.round(g.x), y: Math.round(g.y), ancho: Math.round(g.ancho), alto: Math.round(g.alto), max_ancho: op.maxAncho, max_alto: op.maxAlto, agrandar: !!op.agrandar }, 30));
    const [anchoOrig, altoOrig, ancho, alto] = r.split(" ").map(Number);
    return { anchoOrig, altoOrig, ancho, alto };
  }
  async inspeccionar(punto?: { x: number; y: number }): Promise<Inspeccion> {
    const r = String(await this.orden("inspeccionar", { x: Math.round(punto?.x ?? -1), y: Math.round(punto?.y ?? -1), con_punto: !!punto }));
    const lineas = r.split("\n");
    const cur = (lineas.find((l) => l.startsWith("CURSOR")) || "").split("\t").map(Number);
    return {
      frente: ventana(lineas.find((l) => l.startsWith("FRENTE"))),
      enPunto: punto ? ventana(lineas.find((l) => l.startsWith("PUNTO"))) : undefined,
      cursor: { x: cur[1] || 0, y: cur[2] || 0 }, ultimo: { x: cur[3] ?? -1, y: cur[4] ?? -1 },
      yoElevado: (lineas.find((l) => l.startsWith("YO")) || "").split("\t")[1] === "1",
    };
  }
  async mover(x: number, y: number) { await this.orden("mover", { x: Math.round(x), y: Math.round(y) }); }
  async clic(x: number | null, y: number | null, boton: Boton, veces: number, mods: string) { await this.orden("clic", { x: x === null ? -1 : Math.round(x), y: y === null ? -1 : Math.round(y), boton, veces, mods }); }
  async botonIzquierdo(abajo: boolean) { await this.orden("boton", { abajo }); }
  async arrastrar(x1: number, y1: number, x2: number, y2: number, mods: string) { await this.orden("arrastrar", { x1: Math.round(x1), y1: Math.round(y1), x2: Math.round(x2), y2: Math.round(y2), mods }); }
  async scroll(x: number | null, y: number | null, direccion: string, cantidad: number, mods: string) { await this.orden("scroll", { x: x === null ? -1 : Math.round(x), y: y === null ? -1 : Math.round(y), direccion, cantidad, mods }); }
  async teclas(combo: string, repetir: number) { await this.orden("teclas", { combo, repetir }); }
  async mantenerTecla(combo: string, segundos: number) { await this.orden("mantener", { combo, segundos }, Math.ceil(segundos) + 15); }
  async escribir(texto: string, modo: "teclear" | "pegar") {
    if (modo === "pegar") await this.orden("pegar", { texto }, 60);
    else await this.orden("teclear", { texto, pausa_ms: 12 }, Math.ceil(texto.length * 0.06) + 20);
  }
  async credencial(nombre: string, campo: "usuario" | "clave", enter: boolean) { await this.orden("credencial", { nombre, campo, enter, pausa_ms: 12 }, 60); }
  async existeCredencial(nombre: string) { return !!(await this.orden("existe_cred", { nombre })); }
  async despierto(activo: boolean) { await this.orden("despierto", { activo }).catch(() => {}); }
  async enfocar(objetivo: { proceso?: string; titulo?: string }) {
    const r = await enfocarVentana(objetivo);
    return { ok: r.ok, ventana: r.ventana ? { proceso: r.ventana.proceso, pid: r.ventana.pid, titulo: r.ventana.titulo } : undefined, error: r.error };
  }
  async abrir(objetivo: string) { const r = await abrirObjetivo(objetivo); if (r.codigo !== 0) throw new Error((r.stderr || r.stdout || "no se pudo abrir").slice(-300)); }
  async cerrar() {
    if (!this.hijo) return;
    await this.despierto(false);
    try { this.hijo.stdin.end(); } catch { /* cerrado */ }
    setTimeout(() => this.matar(), 2000).unref();
  }
}

/** Borra sesiones viejas (capturas pueden tener datos sensibles): PC_SESIONES_DIAS, por defecto 30. */
export async function limpiarSesionesViejas(dir: string) {
  const dias = Number(process.env.PC_SESIONES_DIAS) || 30;
  const limite = Date.now() - dias * 86400_000;
  for (const d of await fs.readdir(dir).catch(() => [] as string[])) {
    const ruta = path.join(dir, d);
    const st = await fs.stat(ruta).catch(() => null);
    if (st?.isDirectory() && st.mtimeMs < limite) await fs.rm(ruta, { recursive: true, force: true }).catch(() => {});
  }
}
