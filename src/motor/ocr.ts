// ARCHIVO: src/motor/ocr.ts
// ─────────────────────────────────────────────────────────────────────────────
//  OCR NATIVO DE WINDOWS (Windows.Media.Ocr) — texto en pantalla CON CAJAS.
//  Sin modelo de visión: cada palabra viene con su posición en píxeles. Permite
//  "clic donde dice Guardar" con precisión de píxel en apps sin accesibilidad,
//  y leer resultados/errores sin alucinar. Gratis, local, ~1 s.
// ─────────────────────────────────────────────────────────────────────────────
import { powershell, capturarPantalla, exigirPc } from "./pc.js";
import { clic } from "./pc-control.js";

export interface PalabraOcr { texto: string; x: number; y: number; w: number; h: number; linea: number }

const SCRIPT = (ruta: string) => `
[Windows.Media.Ocr.OcrEngine,Windows.Foundation,ContentType=WindowsRuntime] | Out-Null
[Windows.Storage.StorageFile,Windows.Storage,ContentType=WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.BitmapDecoder,Windows.Graphics,ContentType=WindowsRuntime] | Out-Null
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]
function Await($t, $rt) { $m = $asTaskGeneric.MakeGenericMethod($rt); $n = $m.Invoke($null, @($t)); $n.Wait(-1) | Out-Null; $n.Result }
$file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync('${ruta.replace(/'/g, "''")}')) ([Windows.Storage.StorageFile])
$stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
$decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
$bmp = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if (-not $engine) { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage([Windows.Globalization.Language]::new('es')) }
if (-not $engine) { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage([Windows.Globalization.Language]::new('en')) }
$res = Await ($engine.RecognizeAsync($bmp)) ([Windows.Media.Ocr.OcrResult])
$i = 0
foreach ($line in $res.Lines) { foreach ($w in $line.Words) { $b = $w.BoundingRect; "$i|$([int]$b.X)|$([int]$b.Y)|$([int]$b.Width)|$([int]$b.Height)|$($w.Text)" }; $i++ }`;

/** OCR de la pantalla principal (resolución completa, sin rejilla). */
export async function ocrPantalla(): Promise<{ palabras: PalabraOcr[]; lineas: string[]; captura: string }> {
  exigirPc();
  const cap = await capturarPantalla({ maxAncho: 100000, rejilla: false });
  const r = await powershell(SCRIPT(cap.ruta), 40);
  if (r.codigo !== 0) throw new Error(`OCR falló: ${(r.stderr || r.stdout).slice(-300)}`);
  const palabras: PalabraOcr[] = [];
  for (const l of r.stdout.split("\n")) {
    const m = l.trim().match(/^(\d+)\|(\d+)\|(\d+)\|(\d+)\|(\d+)\|(.*)$/); if (!m) continue;
    palabras.push({ linea: +m[1], x: +m[2] * cap.escala + cap.origenX, y: +m[3] * cap.escala + cap.origenY, w: +m[4] * cap.escala, h: +m[5] * cap.escala, texto: m[6] });
  }
  const porLinea = new Map<number, string[]>();
  for (const p of palabras) (porLinea.get(p.linea) || porLinea.set(p.linea, []).get(p.linea)!).push(p.texto);
  return { palabras, lineas: [...porLinea.values()].map((ws) => ws.join(" ")), captura: cap.ruta };
}

const norm = (t: string) => t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

/** Busca un texto (una o varias palabras consecutivas en la misma línea). Devuelve la caja que las cubre. */
export function buscarTexto(palabras: PalabraOcr[], texto: string, ocurrencia = 1): { x: number; y: number; w: number; h: number; texto: string } | null {
  const objetivo = norm(texto).split(" ").filter(Boolean); if (!objetivo.length) return null;
  const porLinea = new Map<number, PalabraOcr[]>();
  for (const p of palabras) (porLinea.get(p.linea) || porLinea.set(p.linea, []).get(p.linea)!).push(p);
  const hallazgos: { x: number; y: number; w: number; h: number; texto: string; exacto: boolean }[] = [];
  for (const ws of porLinea.values()) {
    for (let i = 0; i + objetivo.length <= ws.length; i++) {
      const trozo = ws.slice(i, i + objetivo.length);
      const ok = trozo.every((w, k) => norm(w.texto) === objetivo[k]) || (objetivo.length === 1 && norm(trozo[0].texto).includes(objetivo[0]));
      if (!ok) continue;
      const x = Math.min(...trozo.map((w) => w.x)), y = Math.min(...trozo.map((w) => w.y));
      const x2 = Math.max(...trozo.map((w) => w.x + w.w)), y2 = Math.max(...trozo.map((w) => w.y + w.h));
      hallazgos.push({ x, y, w: x2 - x, h: y2 - y, texto: trozo.map((w) => w.texto).join(" "), exacto: trozo.every((w, k) => norm(w.texto) === objetivo[k]) });
    }
  }
  hallazgos.sort((a, b) => Number(b.exacto) - Number(a.exacto) || a.y - b.y || a.x - b.x);
  return hallazgos[ocurrencia - 1] || null;
}

/** Clic en el centro del texto que se ve en pantalla. */
export async function clicTexto(texto: string, ocurrencia = 1): Promise<{ ok: boolean; caja?: { x: number; y: number; w: number; h: number; texto: string }; error?: string; vistos?: string[] }> {
  const { palabras, lineas } = await ocrPantalla();
  const caja = buscarTexto(palabras, texto, ocurrencia);
  if (!caja) return { ok: false, error: `No veo "${texto}" en pantalla.`, vistos: lineas.slice(0, 40) };
  await clic(caja.x + caja.w / 2, caja.y + caja.h / 2);
  return { ok: true, caja };
}