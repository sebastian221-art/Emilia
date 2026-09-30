// ARCHIVO: src/motor/grabadora.ts
// ─────────────────────────────────────────────────────────────────────────────
//  GRABADORA DE DEMOSTRACIONES — "enséñale en vez de explicarle".
//  Mientras graba, un proceso de PowerShell registra cada clic (con el NOMBRE
//  del control bajo el cursor por accesibilidad y la ventana) y cada tecla,
//  a un archivo. Al detener, se convierte en una receta reproducible con las
//  primitivas del operador (clic_elemento, escribir, tecla, enfocar).
// ─────────────────────────────────────────────────────────────────────────────
import { spawn, type ChildProcess } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { exigirPc } from "./pc.js";
import { guardarReceta } from "./recetas.js";

const DIR = path.resolve(process.env.DATA_DIR || "data", "grabaciones");
let proceso: ChildProcess | null = null, archivoActual: string | null = null, inicio = 0;

const SCRIPT = (archivo: string) => `
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; using System.Text; public static class G { [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int k); [DllImport("user32.dll")] public static extern bool GetCursorPos(out System.Drawing.Point p); [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n); [DllImport("user32.dll")] public static extern int ToUnicode(uint vk, uint sc, byte[] ks, StringBuilder b, int n, uint f); [DllImport("user32.dll")] public static extern bool GetKeyboardState(byte[] ks); [DllImport("user32.dll")] public static extern uint MapVirtualKey(uint c, uint t); }' -ReferencedAssemblies System.Drawing -ErrorAction SilentlyContinue
$out = '${archivo.replace(/'/g, "''")}'
function Titulo { $sb = New-Object System.Text.StringBuilder 256; [G]::GetWindowText([G]::GetForegroundWindow(), $sb, 256) | Out-Null; $sb.ToString() }
$prev = @{}; $mouseDown = $false
$especiales = @{ 13='enter'; 9='tab'; 27='esc'; 8='backspace'; 46='delete'; 38='arriba'; 40='abajo'; 37='izquierda'; 39='derecha'; 112='f1'; 113='f2'; 116='f5'; 36='home'; 35='end' }
while ($true) {
  Start-Sleep -Milliseconds 15
  $lb = [G]::GetAsyncKeyState(0x01) -band 0x8000
  if ($lb -and -not $mouseDown) {
    $mouseDown = $true
    $pt = New-Object System.Drawing.Point; [G]::GetCursorPos([ref]$pt) | Out-Null
    $nombre = ''; $tipo = ''
    try { $el = [System.Windows.Automation.AutomationElement]::FromPoint([System.Windows.Point]::new($pt.X, $pt.Y)); $nombre = $el.Current.Name; $tipo = $el.Current.ControlType.ProgrammaticName -replace 'ControlType\\.','' } catch {}
    Add-Content -Path $out -Value ("{0}|clic|{1}|{2}|{3}|{4}|{5}" -f (Get-Date -Format o), $pt.X, $pt.Y, $tipo, $nombre, (Titulo)) -Encoding UTF8
  } elseif (-not $lb) { $mouseDown = $false }
  $ctrl = ([G]::GetAsyncKeyState(0x11) -band 0x8000) -ne 0; $alt = ([G]::GetAsyncKeyState(0x12) -band 0x8000) -ne 0; $shift = ([G]::GetAsyncKeyState(0x10) -band 0x8000) -ne 0
  foreach ($vk in 8..222) {
    if ($vk -in 16,17,18,160,161,162,163,164,165,91,92,1,2,4) { continue }
    $down = ([G]::GetAsyncKeyState($vk) -band 0x8000) -ne 0
    if ($down -and -not $prev[$vk]) {
      $nombre = $null
      if ($especiales.ContainsKey($vk)) { $nombre = $especiales[$vk] }
      elseif ($ctrl -or $alt) { $nombre = [char]$vk; $nombre = ([string]$nombre).ToLower() }
      else { $ks = New-Object byte[] 256; [G]::GetKeyboardState($ks) | Out-Null; $sb = New-Object System.Text.StringBuilder 8; $sc = [G]::MapVirtualKey($vk, 0); $n = [G]::ToUnicode($vk, $sc, $ks, $sb, 8, 0); if ($n -gt 0) { Add-Content -Path $out -Value ("{0}|texto|{1}|{2}" -f (Get-Date -Format o), $sb.ToString(), (Titulo)) -Encoding UTF8; $prev[$vk] = $true; continue } }
      if ($nombre) { $combo = @(); if ($ctrl) { $combo += 'ctrl' }; if ($alt) { $combo += 'alt' }; if ($shift -and ($ctrl -or $alt)) { $combo += 'shift' }; $combo += $nombre; Add-Content -Path $out -Value ("{0}|tecla|{1}|{2}" -f (Get-Date -Format o), ($combo -join '+'), (Titulo)) -Encoding UTF8 }
    }
    $prev[$vk] = $down
  }
}`;

export async function iniciarGrabacion(): Promise<{ ok: boolean; error?: string }> {
  exigirPc();
  if (proceso) return { ok: false, error: "Ya hay una grabación en curso." };
  await fs.mkdir(DIR, { recursive: true });
  archivoActual = path.join(DIR, `demo_${Date.now()}.log`);
  await fs.writeFile(archivoActual, "");
  const script = SCRIPT(archivoActual);
  const codificado = Buffer.from(script, "utf16le").toString("base64");
  proceso = spawn("powershell", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", codificado], { stdio: "ignore", windowsHide: true });
  inicio = Date.now();
  proceso.on("exit", () => { proceso = null; });
  return { ok: true };
}

export async function detenerGrabacion(nombreReceta: string, agenteId?: string | null): Promise<{ ok: boolean; receta?: string; pasos?: number; error?: string }> {
  if (!proceso || !archivoActual) return { ok: false, error: "No hay grabación en curso." };
  try { proceso.kill(); } catch { /* ya salió */ }
  proceso = null;
  await new Promise((r) => setTimeout(r, 300));
  const texto = await fs.readFile(archivoActual, "utf-8").catch(() => "");
  const eventos = texto.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => l.split("|"));
  // Compactar: texto consecutivo en la misma ventana → un solo escribir(); ventana cambia → enfocar().
  const pasos: string[] = []; let ventana = ""; let buffer = "";
  const vaciar = () => { if (buffer) { pasos.push(`escribir("${buffer.replace(/"/g, '\\"')}")`); buffer = ""; } };
  for (const ev of eventos) {
    const tipo = ev[1]; const vent = ev[ev.length - 1] || "";
    if (vent && vent !== ventana) { vaciar(); ventana = vent; pasos.push(`enfocar("${vent.replace(/"/g, '\\"').slice(0, 50)}")`); }
    if (tipo === "texto") buffer += ev[2];
    else if (tipo === "tecla") { vaciar(); pasos.push(`tecla("${ev[2]}")`); }
    else if (tipo === "clic") { vaciar(); const nombre = ev[5], t = ev[4]; pasos.push(nombre ? `clic_elemento("${nombre.replace(/"/g, '\\"')}"${t ? `, "${t}"` : ""})` : `clic(${ev[2]}, ${ev[3]})`); }
  }
  vaciar();
  const receta = `Grabado por el jefe (${Math.round((Date.now() - inicio) / 1000)}s, ${eventos.length} eventos). Secuencia:\n${pasos.map((p, i) => `${i + 1}. ${p}`).join("\n")}`;
  await guardarReceta(agenteId, nombreReceta, receta);
  return { ok: true, receta, pasos: pasos.length };
}

export const grabando = () => !!proceso;