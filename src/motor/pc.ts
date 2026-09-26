// ARCHIVO: src/motor/pc.ts
// ─────────────────────────────────────────────────────────────────────────────
//  PC — control estructurado de la máquina donde corre Emilia (Windows)
//  PowerShell con timeout, captura de pantalla, abrir apps/URLs, portapapeles,
//  info del sistema. Todo detrás de PC_HABILITADO=true en el .env.
// ─────────────────────────────────────────────────────────────────────────────

import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { ejecutarComando, type SalidaComando } from "./sandbox.js";

export const pcHabilitado = () => (process.env.PC_HABILITADO || "").toLowerCase() === "true";
export const esWindows = process.platform === "win32";

export function exigirPc() { if (!pcHabilitado()) throw new Error("El control del PC está apagado. Poné PC_HABILITADO=true en el .env y reiniciá Emilia."); }

/** Ejecuta PowerShell (Windows) o sh (otros) con timeout. */
export async function powershell(script: string, timeoutSeg = 60, cwd = os.homedir()): Promise<SalidaComando> {
  exigirPc();
  if (esWindows) {
    const conUtf8 = `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; $OutputEncoding = [System.Text.Encoding]::UTF8\n${script}`;
    const codificado = Buffer.from(conUtf8, "utf16le").toString("base64");
    return ejecutarComando(cwd, `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${codificado}`, timeoutSeg);
  }
  return ejecutarComando(cwd, script, timeoutSeg);
}

/**
 * Resuelve carpetas conocidas del usuario (Descargas, Escritorio, Documentos, Imágenes)
 * preguntándole a Windows: en equipos con OneDrive o carpetas redirigidas, "Descargas"
 * NO es C:\\Users\\X\\Downloads. Acepta nombres en español e inglés.
 */
const conocidas = new Map<string, string>();
export async function carpetaConocida(nombre: string): Promise<string | null> {
  const clave = nombre.toLowerCase().replace(/[^a-záéíóú]/g, "");
  const mapa: Record<string, { guid?: string; shell: string; ingles: string }> = {
    descargas: { guid: "{374DE290-123F-4565-9164-39C4925E467B}", shell: "Downloads", ingles: "Downloads" }, downloads: { guid: "{374DE290-123F-4565-9164-39C4925E467B}", shell: "Downloads", ingles: "Downloads" },
    escritorio: { shell: "Desktop", ingles: "Desktop" }, desktop: { shell: "Desktop", ingles: "Desktop" },
    documentos: { shell: "Personal", ingles: "Documents" }, documents: { shell: "Personal", ingles: "Documents" },
    imagenes: { shell: "My Pictures", ingles: "Pictures" }, imágenes: { shell: "My Pictures", ingles: "Pictures" }, pictures: { shell: "My Pictures", ingles: "Pictures" },
    videos: { shell: "My Video", ingles: "Videos" }, musica: { shell: "My Music", ingles: "Music" }, música: { shell: "My Music", ingles: "Music" },
  };
  const def = mapa[clave]; if (!def) return null;
  if (conocidas.has(clave)) return conocidas.get(clave)!;
  let ruta: string | null = null;
  if (esWindows) {
    const r = await powershell(`$k='HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders'; $v=(Get-ItemProperty -Path $k).'${def.guid || def.shell}'; if($v){[Environment]::ExpandEnvironmentVariables($v)}`, 15).catch(() => null);
    const t = r?.stdout?.trim(); if (t) ruta = t;
  }
  if (!ruta) ruta = path.join(os.homedir(), def.ingles);
  try { await fs.access(ruta); } catch { ruta = path.join(os.homedir(), def.ingles); }
  conocidas.set(clave, ruta);
  return ruta;
}

/** Normaliza una ruta escrita por el usuario/modelo: ~, nombres de carpetas conocidas en español, etc. */
export async function resolverRuta(entrada: string): Promise<string> {
  let r = (entrada || "~").trim().replace(/^~(?=$|[\\/])/, os.homedir());
  const m = r.match(/^(?:~[\\/])?(descargas|downloads|escritorio|desktop|documentos|documents|im[aá]genes|pictures|videos|m[uú]sica)(?=$|[\\/])(.*)$/i);
  if (m) { const base = await carpetaConocida(m[1]); if (base) r = base + m[2]; }
  return path.resolve(r);
}

const DIR_CAPTURAS = path.resolve(process.env.DATA_DIR || "data", "capturas");

/** Captura de pantalla completa → PNG en disco. */
export async function capturarPantalla(): Promise<{ ruta: string; contenido: Buffer }> {
  exigirPc();
  await fs.mkdir(DIR_CAPTURAS, { recursive: true });
  const ruta = path.join(DIR_CAPTURAS, `captura_${Date.now()}.png`);
  if (esWindows) {
    const r = await powershell(`
Add-Type -AssemblyName System.Windows.Forms,System.Drawing
$b = [System.Windows.Forms.Screen]::AllScreens | ForEach-Object { $_.Bounds } | Measure-Object -Property Width -Sum
$bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
$bmp = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
$bmp.Save('${ruta.replace(/'/g, "''")}', [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()`, 30);
    if (r.codigo !== 0) throw new Error(`No pude capturar la pantalla: ${(r.stderr || r.stdout).slice(-300)}`);
  } else {
    const r = await ejecutarComando(os.homedir(), `import -window root "${ruta}" || scrot "${ruta}"`, 30);
    if (r.codigo !== 0) throw new Error(`No pude capturar la pantalla (falta 'import' o 'scrot').`);
  }
  return { ruta, contenido: await fs.readFile(ruta) };
}

/** Abre una app, archivo o URL con el programa por defecto. */
export async function abrir(objetivo: string): Promise<SalidaComando> {
  exigirPc();
  if (esWindows) return powershell(`Start-Process -FilePath '${objetivo.replace(/'/g, "''")}'`, 20);
  return ejecutarComando(os.homedir(), `xdg-open "${objetivo}"`, 20);
}

export async function leerPortapapeles(): Promise<string> {
  exigirPc();
  const r = esWindows ? await powershell("Get-Clipboard -Raw", 10) : await ejecutarComando(os.homedir(), "xclip -o -selection clipboard", 10);
  return r.stdout;
}
export async function escribirPortapapeles(texto: string): Promise<void> {
  exigirPc();
  if (esWindows) { await powershell(`Set-Clipboard -Value @'\n${texto}\n'@`, 10); return; }
  await ejecutarComando(os.homedir(), `printf %s "${texto.replace(/"/g, '\\"')}" | xclip -selection clipboard`, 10);
}

export async function infoSistema() {
  const cpus = os.cpus();
  const carga = os.loadavg();
  const total = os.totalmem(), libre = os.freemem();
  let discos = "";
  try {
    const r = esWindows ? await powershell("Get-PSDrive -PSProvider FileSystem | Select-Object Name,@{n='UsadoGB';e={[math]::Round($_.Used/1GB,1)}},@{n='LibreGB';e={[math]::Round($_.Free/1GB,1)}} | Format-Table -HideTableHeaders | Out-String", 15) : await ejecutarComando(os.homedir(), "df -h --output=target,used,avail | tail -n +2", 10);
    discos = r.stdout.trim();
  } catch { /* opcional */ }
  return { host: os.hostname(), so: `${os.type()} ${os.release()}`, usuario: os.userInfo().username, cpu: cpus[0]?.model, nucleos: cpus.length, carga_1m: carga[0], memoria_total_gb: +(total / 1073741824).toFixed(1), memoria_libre_gb: +(libre / 1073741824).toFixed(1), uptime_h: +(os.uptime() / 3600).toFixed(1), discos };
}

/** Comandos que nunca se ejecutan aunque haya aprobación. */
export function comandoProhibido(cmd: string): string | null {
  const c = cmd.toLowerCase();
  if (/format-volume|format\s+[a-z]:|diskpart|clear-disk|remove-partition|bcdedit|reg\s+delete\s+hklm|remove-item\s+.*(-recurse).*(c:\\\\?\s|c:\\\\windows|c:\\\\users\\\\?[^\\]*\s*$)|rm\s+-rf\s+[\/~]\s*$|shutdown|restart-computer|stop-computer|net\s+user\s+.*\/add|disable-computerrestore|vssadmin\s+delete/.test(c)) return "Ese comando está prohibido de forma permanente (destructivo o de sistema).";
  return null;
}