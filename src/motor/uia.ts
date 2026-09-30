// ARCHIVO: src/motor/uia.ts
// ─────────────────────────────────────────────────────────────────────────────
//  UI AUTOMATION (Windows) — el "árbol de accesibilidad" del escritorio.
//  Lista los controles de la ventana activa con nombre, tipo, posición y valor,
//  y permite actuar POR NOMBRE (clic, escribir) sin adivinar píxeles. Es la
//  capa que hace preciso al operador: "clic en el botón Guardar", no en (412,388).
//  Usa System.Windows.Automation desde PowerShell (nada que instalar).
// ─────────────────────────────────────────────────────────────────────────────
import { powershell, exigirPc } from "./pc.js";
import { clic, escribirTexto } from "./pc-control.js";

export interface Elemento { n: number; nombre: string; tipo: string; x: number; y: number; w: number; h: number; habilitado: boolean; valor?: string; auto_id?: string }

const PRELUDIO = `
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class FG { [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); }' -ErrorAction SilentlyContinue
$h = [FG]::GetForegroundWindow()
$root = [System.Windows.Automation.AutomationElement]::FromHandle($h)
$tipos = @('Button','Edit','MenuItem','ListItem','TabItem','ComboBox','CheckBox','RadioButton','Hyperlink','Text','Document','TreeItem','DataItem','SplitButton','Menu','ToolBar','Window','Pane','Group','Custom','Image','Spinner','Slider')
function Walk($el, $depth, [ref]$acc, [ref]$count) {
  if ($depth -gt 14 -or $count.Value -ge 260) { return }
  $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
  $child = $walker.GetFirstChild($el)
  while ($child -ne $null -and $count.Value -lt 260) {
    try {
      $c = $child.Current
      $t = $c.ControlType.ProgrammaticName -replace 'ControlType\\.',''
      $r = $c.BoundingRectangle
      if ($c.Name -or $t -eq 'Edit' -or $t -eq 'Document') {
        if (-not $r.IsEmpty -and $r.Width -gt 0 -and $r.Height -gt 0 -and -not $c.IsOffscreen) {
          $val = $null
          try { $vp = $child.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern); if ($vp) { $val = $vp.Current.Value } } catch {}
          $count.Value++
          $acc.Value += [pscustomobject]@{ n=$count.Value; nombre=[string]$c.Name; tipo=$t; x=[int]$r.X; y=[int]$r.Y; w=[int]$r.Width; h=[int]$r.Height; habilitado=[bool]$c.IsEnabled; valor=$(if($val){[string]$val.Substring(0,[Math]::Min(200,$val.Length))}else{$null}); auto_id=[string]$c.AutomationId }
        }
      }
    } catch {}
    Walk $child ($depth+1) $acc $count
    $child = $walker.GetNextSibling($child)
  }
}`;

/** Controles visibles de la ventana activa. */
export async function elementosVentana(filtro?: string): Promise<{ ventana: string; elementos: Elemento[] }> {
  exigirPc();
  const r = await powershell(`${PRELUDIO}
$acc = @(); $count = 0
Walk $root 0 ([ref]$acc) ([ref]$count)
$o = [pscustomobject]@{ ventana = [string]$root.Current.Name; elementos = $acc }
$o | ConvertTo-Json -Depth 4 -Compress`, 40);
  if (r.codigo !== 0 || !r.stdout.trim()) throw new Error(`No pude leer la ventana activa: ${(r.stderr || r.stdout).slice(-300)}`);
  let data: any; try { data = JSON.parse(r.stdout.trim().split("\n").pop()!); } catch { throw new Error("Respuesta de UI Automation ilegible."); }
  let elementos: Elemento[] = Array.isArray(data.elementos) ? data.elementos : data.elementos ? [data.elementos] : [];
  if (filtro) { const f = filtro.toLowerCase(); elementos = elementos.filter((e) => (e.nombre || "").toLowerCase().includes(f) || (e.tipo || "").toLowerCase().includes(f) || (e.valor || "").toLowerCase().includes(f)); }
  return { ventana: data.ventana || "", elementos };
}

/** Busca un control por nombre (contiene, sin distinguir mayúsculas), opcionalmente por tipo. */
export function buscarElemento(lista: Elemento[], nombre: string, tipo?: string): Elemento | undefined {
  const n = nombre.toLowerCase().trim();
  const cand = lista.filter((e) => (!tipo || e.tipo.toLowerCase() === tipo.toLowerCase()) && e.habilitado);
  return cand.find((e) => e.nombre.toLowerCase() === n) || cand.find((e) => e.nombre.toLowerCase().startsWith(n)) || cand.find((e) => e.nombre.toLowerCase().includes(n)) || cand.find((e) => (e.auto_id || "").toLowerCase() === n);
}

/** Clic en un control por nombre: Invoke si el control lo soporta; si no, clic físico en su centro. */
export async function clicElemento(nombre: string, tipo?: string): Promise<{ ok: boolean; elemento?: Elemento; metodo?: string; error?: string }> {
  const { elementos, ventana } = await elementosVentana();
  const el = buscarElemento(elementos, nombre, tipo);
  if (!el) return { ok: false, error: `No encontré "${nombre}"${tipo ? ` (${tipo})` : ""} en la ventana "${ventana}". Controles: ${elementos.filter((e) => e.nombre).slice(0, 25).map((e) => `${e.tipo}:${e.nombre}`).join(", ")}` };
  // Intento Invoke/Select/Toggle por accesibilidad (más fiable que el mouse).
  const r = await powershell(`${PRELUDIO}
$cond = New-Object System.Windows.Automation.PropertyCondition ([System.Windows.Automation.AutomationElement]::NameProperty), '${el.nombre.replace(/'/g, "''")}'
$el = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $cond)
if ($el -eq $null) { 'NO'; exit 0 }
try { $p = $el.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern); $p.Invoke(); 'INVOKE'; exit 0 } catch {}
try { $p = $el.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern); $p.Select(); 'SELECT'; exit 0 } catch {}
try { $p = $el.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern); $p.Toggle(); 'TOGGLE'; exit 0 } catch {}
try { $p = $el.GetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern); $p.Expand(); 'EXPAND'; exit 0 } catch {}
'NO'`, 20);
  const metodo = r.stdout.trim().split("\n").pop() || "NO";
  if (metodo !== "NO") return { ok: true, elemento: el, metodo };
  await clic(el.x + el.w / 2, el.y + el.h / 2);
  return { ok: true, elemento: el, metodo: "mouse" };
}

/** Escribe en un campo por nombre: SetValue si se puede; si no, foco + tecleo. */
export async function escribirEnElemento(nombre: string, texto: string): Promise<{ ok: boolean; elemento?: Elemento; metodo?: string; error?: string }> {
  const { elementos, ventana } = await elementosVentana();
  const el = buscarElemento(elementos, nombre, "Edit") || buscarElemento(elementos, nombre, "ComboBox") || buscarElemento(elementos, nombre) || (nombre === "*" ? elementos.find((e) => e.tipo === "Edit" || e.tipo === "Document") : undefined);
  if (!el) return { ok: false, error: `No encontré un campo "${nombre}" en "${ventana}". Campos: ${elementos.filter((e) => e.tipo === "Edit" || e.tipo === "ComboBox" || e.tipo === "Document").map((e) => e.nombre || e.auto_id || "(sin nombre)").join(", ") || "ninguno"}` };
  const r = await powershell(`${PRELUDIO}
$cond = New-Object System.Windows.Automation.PropertyCondition ([System.Windows.Automation.AutomationElement]::NameProperty), '${el.nombre.replace(/'/g, "''")}'
$el = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $cond)
if ($el -eq $null) { 'NO'; exit 0 }
try { $p = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern); if (-not $p.Current.IsReadOnly) { $p.SetValue('${texto.replace(/'/g, "''")}'); 'SETVALUE'; exit 0 } } catch {}
try { $el.SetFocus(); 'FOCUS'; exit 0 } catch {}
'NO'`, 20);
  const metodo = r.stdout.trim().split("\n").pop() || "NO";
  if (metodo === "SETVALUE") return { ok: true, elemento: el, metodo };
  if (metodo !== "FOCUS") await clic(el.x + el.w / 2, el.y + el.h / 2);
  await escribirTexto(texto);
  return { ok: true, elemento: el, metodo: metodo === "FOCUS" ? "focus+teclado" : "clic+teclado" };
}

/** Texto visible de la ventana activa (nombres y valores de Text/Edit/Document), para leer resultados. */
export async function textoVentana(): Promise<{ ventana: string; texto: string }> {
  const { ventana, elementos } = await elementosVentana();
  const partes = elementos.filter((e) => ["Text", "Edit", "Document", "DataItem", "ListItem"].includes(e.tipo)).map((e) => e.valor ? `${e.nombre ? e.nombre + ": " : ""}${e.valor}` : e.nombre).filter(Boolean);
  return { ventana, texto: [...new Set(partes)].join("\n").slice(0, 6000) };
}