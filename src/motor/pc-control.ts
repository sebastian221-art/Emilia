// ARCHIVO: src/motor/pc-control.ts
// ─────────────────────────────────────────────────────────────────────────────
//  CONTROL FÍSICO DEL PC (Windows): mouse, teclado, scroll, tamaño de pantalla.
//  Mouse vía user32 (SetCursorPos + mouse_event). Texto vía portapapeles +
//  Ctrl+V (funciona con tildes y símbolos); teclas/atajos vía SendKeys.
//  Todo exige PC_HABILITADO=true.
// ─────────────────────────────────────────────────────────────────────────────
import { powershell, exigirPc, escribirPortapapeles, leerPortapapeles } from "./pc.js";

const USER32 = `
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices;
public static class U32 {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, UIntPtr e);
  public const uint LD=0x02, LU=0x04, RD=0x08, RU=0x10, MD=0x20, MU=0x40, WHEEL=0x0800;
}
"@ -ErrorAction SilentlyContinue
Add-Type -AssemblyName System.Windows.Forms`;

export async function tamanoPantalla(): Promise<{ ancho: number; alto: number; x: number; y: number }> {
  exigirPc();
  const r = await powershell(`Add-Type -AssemblyName System.Windows.Forms; $b=[System.Windows.Forms.SystemInformation]::VirtualScreen; "$($b.Width) $($b.Height) $($b.X) $($b.Y)"`, 15);
  const [w, h, x, y] = r.stdout.trim().split(/\s+/).map(Number);
  return { ancho: w || 1920, alto: h || 1080, x: x || 0, y: y || 0 };
}

export async function mover(x: number, y: number) {
  await powershell(`${USER32}\n[U32]::SetCursorPos(${Math.round(x)},${Math.round(y)}) | Out-Null`, 15);
}

export async function clic(x: number, y: number, op: { boton?: "izquierdo" | "derecho" | "medio"; doble?: boolean } = {}) {
  const b = op.boton || "izquierdo";
  const [d, u] = b === "derecho" ? ["[U32]::RD", "[U32]::RU"] : b === "medio" ? ["[U32]::MD", "[U32]::MU"] : ["[U32]::LD", "[U32]::LU"];
  const veces = op.doble ? 2 : 1;
  const script = `${USER32}\n[U32]::SetCursorPos(${Math.round(x)},${Math.round(y)}) | Out-Null; Start-Sleep -Milliseconds 80\n` +
    Array.from({ length: veces }, () => `[U32]::mouse_event(${d},0,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 40; [U32]::mouse_event(${u},0,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 90`).join("\n");
  await powershell(script, 20);
}

export async function scroll(x: number, y: number, pasos: number) {
  await powershell(`${USER32}\n[U32]::SetCursorPos(${Math.round(x)},${Math.round(y)}) | Out-Null; [U32]::mouse_event([U32]::WHEEL,0,0,[uint32](${Math.round(pasos * 120)} -band 0xFFFFFFFF),[UIntPtr]::Zero)`, 15);
}

/**
 * Escribe texto tal cual. Vía portapapeles + Ctrl+V SOLO si el portapapeles quedó
 * exactamente con el texto (si no, pegaría lo que hubiera copiado el jefe);
 * si no se pudo, teclea con SendKeys. Restaura el portapapeles al final.
 */
export async function escribirTexto(texto: string) {
  const previo = await leerPortapapeles().catch(() => "");
  let pegado = false;
  try {
    await escribirPortapapeles(texto);
    const ahora = (await leerPortapapeles()).replace(/\r\n/g, "\n").trim();
    if (ahora === texto.replace(/\r\n/g, "\n").trim()) {
      await powershell(`Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait("^v"); Start-Sleep -Milliseconds 150`, 15);
      pegado = true;
    }
  } catch { /* cae a SendKeys */ }
  if (!pegado) {
    const esc = texto.replace(/[+^%~(){}\[\]]/g, (c) => `{${c}}`).replace(/\n/g, "{ENTER}").replace(/'/g, "''");
    await powershell(`Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${esc}'); Start-Sleep -Milliseconds 150`, 30);
  }
  if (previo) escribirPortapapeles(previo).catch(() => {});
}

const TECLAS: Record<string, string> = { enter: "{ENTER}", tab: "{TAB}", esc: "{ESC}", escape: "{ESC}", backspace: "{BACKSPACE}", delete: "{DELETE}", supr: "{DELETE}", up: "{UP}", down: "{DOWN}", left: "{LEFT}", right: "{RIGHT}", arriba: "{UP}", abajo: "{DOWN}", izquierda: "{LEFT}", derecha: "{RIGHT}", home: "{HOME}", end: "{END}", pageup: "{PGUP}", pagedown: "{PGDN}", space: " ", espacio: " ", win: "^{ESC}", f1: "{F1}", f2: "{F2}", f3: "{F3}", f4: "{F4}", f5: "{F5}", f11: "{F11}", f12: "{F12}" };

/** Atajo o tecla: "ctrl+s", "alt+f4", "enter", "ctrl+shift+t", "win". */
export async function tecla(combinacion: string) {
  const partes = combinacion.toLowerCase().split("+").map((p) => p.trim()).filter(Boolean);
  let mod = "", base = "";
  for (const p of partes) {
    if (p === "ctrl" || p === "control") mod += "^"; else if (p === "alt") mod += "%"; else if (p === "shift") mod += "+";
    else base = TECLAS[p] ?? (p.length === 1 ? p.replace(/[+^%~(){}\[\]]/g, (c) => `{${c}}`) : `{${p.toUpperCase()}}`);
  }
  if (!base) { if (partes.includes("win")) base = "^{ESC}"; else throw new Error(`Tecla no reconocida: ${combinacion}`); }
  await powershell(`Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${(mod + base).replace(/'/g, "''")}'); Start-Sleep -Milliseconds 120`, 15);
}

export async function ventanaActiva(): Promise<string> {
  const r = await powershell(`Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; using System.Text; public static class W { [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n); }' -ErrorAction SilentlyContinue; $sb=New-Object System.Text.StringBuilder 256; [W]::GetWindowText([W]::GetForegroundWindow(),$sb,256) | Out-Null; $sb.ToString()`, 15);
  return r.stdout.trim();
}


// ─── Foco ────────────────────────────────────────────────────────────────────
export interface VentanaInfo { titulo: string; proceso: string; pid: number }

/** Título y proceso de la ventana en primer plano. */
export async function ventanaActivaInfo(): Promise<VentanaInfo> {
  const r = await powershell(`Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; using System.Text; public static class W2 { [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n); [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid); }' -ErrorAction SilentlyContinue
$h=[W2]::GetForegroundWindow(); $sb=New-Object System.Text.StringBuilder 512; [W2]::GetWindowText($h,$sb,512) | Out-Null; $pid2=0; [W2]::GetWindowThreadProcessId($h,[ref]$pid2) | Out-Null
$p = Get-Process -Id $pid2 -ErrorAction SilentlyContinue
"$($p.ProcessName)|$pid2|$($sb.ToString())"`, 15);
  const [proceso, pid, ...t] = r.stdout.trim().split("\n").pop()!.split("|");
  return { titulo: t.join("|"), proceso: (proceso || "").toLowerCase(), pid: Number(pid) || 0 };
}

/**
 * Trae al frente la ventana de un proceso (o cuyo título contiene un texto).
 * Windows bloquea que un proceso de fondo robe el foco; el pulso de ALT antes
 * de SetForegroundWindow es el truco documentado para permitirlo.
 */
export async function enfocarVentana(objetivo: { proceso?: string; titulo?: string }): Promise<{ ok: boolean; ventana: VentanaInfo; error?: string }> {
  exigirPc();
  const proc = (objetivo.proceso || "").replace(/\.exe$/i, "");
  const tit = objetivo.titulo || "";
  const r = await powershell(`Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class F { [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h); [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c); [DllImport("user32.dll")] public static extern void keybd_event(byte k, byte s, uint f, UIntPtr e); [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h); }' -ErrorAction SilentlyContinue
$cands = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and ${proc ? `($_.ProcessName -ieq '${proc.replace(/'/g, "''")}' -or $_.ProcessName -ilike '${proc.replace(/'/g, "''")}*')` : "$true"} -and ${tit ? `$_.MainWindowTitle -ilike '*${tit.replace(/'/g, "''")}*'` : "$true"} } | Sort-Object StartTime -Descending
if (-not $cands) { 'NO'; exit 0 }
$h = $cands[0].MainWindowHandle
if ([F]::IsIconic($h)) { [F]::ShowWindow($h, 9) | Out-Null }
[F]::keybd_event(0x12,0,0,[UIntPtr]::Zero); [F]::keybd_event(0x12,0,2,[UIntPtr]::Zero)
[F]::SetForegroundWindow($h) | Out-Null
Start-Sleep -Milliseconds 400
"OK|$($cands[0].ProcessName)|$($cands[0].MainWindowTitle)"`, 20);
  const out = r.stdout.trim().split("\n").pop() || "";
  if (!out.startsWith("OK")) return { ok: false, ventana: await ventanaActivaInfo(), error: `No encontré una ventana de ${proc || tit}.` };
  const v = await ventanaActivaInfo();
  const coincide = (proc && v.proceso.startsWith(proc.toLowerCase())) || (tit && v.titulo.toLowerCase().includes(tit.toLowerCase()));
  return coincide ? { ok: true, ventana: v } : { ok: false, ventana: v, error: `Intenté traer al frente ${proc || tit}, pero la ventana activa sigue siendo "${v.titulo}" (${v.proceso}). ¿El jefe está usando el PC?` };
}