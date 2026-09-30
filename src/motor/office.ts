// ARCHIVO: src/motor/office.ts
// ─────────────────────────────────────────────────────────────────────────────
//  OFFICE POR COM — Excel, Word y Outlook sin tocar la interfaz.
//  Determinista: escribir celdas, leer rangos, crear documentos, mandar correos.
//  Requiere Office instalado en el PC. Todo vía PowerShell (New-Object -ComObject).
// ─────────────────────────────────────────────────────────────────────────────
import { powershell, exigirPc, resolverRuta } from "./pc.js";

const esc = (s: string) => String(s).replace(/'/g, "''");

/** Escribe valores en celdas (crea el libro si no existe). celdas: {"A1":"Hola","B2":42,"C3":"=A1&B2"} */
export async function excelEscribir(ruta: string, celdas: Record<string, string | number>, hoja?: string): Promise<{ ok: boolean; ruta: string; error?: string }> {
  exigirPc();
  const abs = await resolverRuta(ruta);
  const asign = Object.entries(celdas).map(([c, v]) => `$ws.Range('${esc(c)}').Value2 = ${typeof v === "number" ? v : `'${esc(String(v))}'`}`).join("\n");
  const r = await powershell(`
$xl = New-Object -ComObject Excel.Application; $xl.Visible = $false; $xl.DisplayAlerts = $false
try {
  if (Test-Path '${esc(abs)}') { $wb = $xl.Workbooks.Open('${esc(abs)}') } else { $wb = $xl.Workbooks.Add() }
  $ws = $null; ${hoja ? `try { $ws = $wb.Worksheets.Item('${esc(hoja)}') } catch { $ws = $wb.Worksheets.Add(); $ws.Name = '${esc(hoja)}' }` : "$ws = $wb.Worksheets.Item(1)"}
  ${asign}
  if (Test-Path '${esc(abs)}') { $wb.Save() } else { $wb.SaveAs('${esc(abs)}', 51) }
  $wb.Close($true); 'OK'
} catch { "ERROR: $($_.Exception.Message)" } finally { $xl.Quit(); [System.Runtime.Interopservices.Marshal]::ReleaseComObject($xl) | Out-Null }`, 90);
  const out = r.stdout.trim().split("\n").pop() || "";
  return out === "OK" ? { ok: true, ruta: abs } : { ok: false, ruta: abs, error: out || r.stderr.slice(-300) };
}

/** Lee un rango como matriz de texto. */
export async function excelLeer(ruta: string, rango = "A1:F30", hoja?: string): Promise<{ ok: boolean; filas?: string[][]; error?: string }> {
  exigirPc();
  const abs = await resolverRuta(ruta);
  const r = await powershell(`
$xl = New-Object -ComObject Excel.Application; $xl.Visible = $false; $xl.DisplayAlerts = $false
try {
  $wb = $xl.Workbooks.Open('${esc(abs)}', $null, $true)
  $ws = ${hoja ? `$wb.Worksheets.Item('${esc(hoja)}')` : "$wb.Worksheets.Item(1)"}
  $rng = $ws.Range('${esc(rango)}')
  foreach ($row in $rng.Rows) { ($row.Cells | ForEach-Object { [string]$_.Text }) -join [char]9 }
  $wb.Close($false)
} catch { "ERROR: $($_.Exception.Message)" } finally { $xl.Quit(); [System.Runtime.Interopservices.Marshal]::ReleaseComObject($xl) | Out-Null }`, 90);
  if (/^ERROR:/m.test(r.stdout)) return { ok: false, error: r.stdout.match(/^ERROR:.*$/m)![0] };
  const filas = r.stdout.split("\n").map((l) => l.replace(/\r$/, "")).filter((l) => l.trim() !== "").map((l) => l.split("\t"));
  return { ok: true, filas };
}

/** Crea un documento Word con texto (párrafos separados por líneas en blanco). */
export async function wordCrear(ruta: string, texto: string, titulo?: string): Promise<{ ok: boolean; ruta: string; error?: string }> {
  exigirPc();
  const abs = await resolverRuta(ruta);
  const parrafos = texto.split(/\n{2,}|\r?\n/).filter((p) => p.trim());
  const cuerpo = parrafos.map((p) => `$sel.TypeText('${esc(p)}'); $sel.TypeParagraph()`).join("\n");
  const r = await powershell(`
$w = New-Object -ComObject Word.Application; $w.Visible = $false
try {
  $doc = $w.Documents.Add(); $sel = $w.Selection
  ${titulo ? `$sel.Style = 'Título 1'; $sel.TypeText('${esc(titulo)}'); $sel.TypeParagraph(); $sel.Style = 'Normal'` : ""}
  ${cuerpo}
  $doc.SaveAs([ref]'${esc(abs)}', [ref]16); $doc.Close(); 'OK'
} catch { "ERROR: $($_.Exception.Message)" } finally { $w.Quit(); [System.Runtime.Interopservices.Marshal]::ReleaseComObject($w) | Out-Null }`, 90);
  const out = r.stdout.trim().split("\n").pop() || "";
  return out === "OK" ? { ok: true, ruta: abs } : { ok: false, ruta: abs, error: out || r.stderr.slice(-300) };
}

export async function wordLeer(ruta: string): Promise<{ ok: boolean; texto?: string; error?: string }> {
  exigirPc();
  const abs = await resolverRuta(ruta);
  const r = await powershell(`
$w = New-Object -ComObject Word.Application; $w.Visible = $false
try { $doc = $w.Documents.Open('${esc(abs)}', $false, $true); $doc.Content.Text; $doc.Close($false) } catch { "ERROR: $($_.Exception.Message)" } finally { $w.Quit(); [System.Runtime.Interopservices.Marshal]::ReleaseComObject($w) | Out-Null }`, 90);
  if (/^ERROR:/m.test(r.stdout)) return { ok: false, error: r.stdout.match(/^ERROR:.*$/m)![0] };
  return { ok: true, texto: r.stdout.trim().slice(0, 20000) };
}

/** Envía un correo con Outlook de escritorio (cuenta por defecto). */
export async function outlookEnviar(p: { para: string; asunto: string; cuerpo: string; adjuntos?: string[]; cc?: string }): Promise<{ ok: boolean; error?: string }> {
  exigirPc();
  const adj: string[] = []; for (const a of p.adjuntos || []) adj.push(await resolverRuta(a));
  const r = await powershell(`
try {
  $ol = New-Object -ComObject Outlook.Application; $m = $ol.CreateItem(0)
  $m.To = '${esc(p.para)}'; ${p.cc ? `$m.CC = '${esc(p.cc)}';` : ""} $m.Subject = '${esc(p.asunto)}'; $m.Body = '${esc(p.cuerpo)}'
  ${adj.map((a) => `$m.Attachments.Add('${esc(a)}') | Out-Null`).join("\n")}
  $m.Send(); 'OK'
} catch { "ERROR: $($_.Exception.Message)" }`, 60);
  const out = r.stdout.trim().split("\n").pop() || "";
  return out === "OK" ? { ok: true } : { ok: false, error: out || r.stderr.slice(-300) };
}