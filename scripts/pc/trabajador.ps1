# ARCHIVO: scripts/pc/trabajador.ps1
# ─────────────────────────────────────────────────────────────────────────────
#  Trabajador de pantalla: UN proceso de PowerShell que vive mientras dura la
#  sesión de uso del computador. Lee órdenes JSON (una por línea) por stdin y
#  responde JSON (una por línea) por stdout. Así cada clic o tecla es casi
#  instantáneo (no se abre un PowerShell por acción).
#  Entrada y salida en ASCII puro (los acentos viajan como \uXXXX) para no
#  depender de la página de códigos de la consola.
# ─────────────────────────────────────────────────────────────────────────────
param([string]$Fuente, [string]$Referencias = "System.Drawing,System.Windows.Forms")
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false) } catch { }

function Escapar([string]$s) {
  return [regex]::Replace($s, '[^\x00-\x7F]', { param($m) '\u{0:x4}' -f [int][char]$m.Value })
}
function Responder($obj) {
  $json = $obj | ConvertTo-Json -Compress -Depth 6
  [Console]::Out.WriteLine((Escapar $json))
  [Console]::Out.Flush()
}

try {
  $codigo = [System.IO.File]::ReadAllText($Fuente, [System.Text.Encoding]::UTF8)
  Add-Type -TypeDefinition $codigo -ReferencedAssemblies ($Referencias -split ",") -Language CSharp
  $pantalla = [EmiliaPantalla]::Iniciar()
  Responder @{ id = 0; ok = $true; r = "LISTO $pantalla" }
} catch {
  Responder @{ id = 0; ok = $false; error = "No pude iniciar el control de pantalla: $($_.Exception.Message)" }
  exit 1
}

while ($true) {
  $linea = [Console]::In.ReadLine()
  if ($null -eq $linea) { break }
  if ($linea.Trim() -eq '') { continue }
  $id = 0
  try {
    $o = $linea | ConvertFrom-Json
    $id = $o.id
    switch ($o.op) {
      'pantalla'     { $r = [EmiliaPantalla]::Pantalla() }
      'capturar'     { $r = [EmiliaPantalla]::Capturar([string]$o.ruta, [int]$o.x, [int]$o.y, [int]$o.ancho, [int]$o.alto, [int]$o.max_ancho, [int]$o.max_alto, [bool]$o.agrandar) }
      'inspeccionar' { $r = [EmiliaPantalla]::Inspeccionar([int]$o.x, [int]$o.y, [bool]$o.con_punto) }
      'mover'        { $r = [EmiliaPantalla]::Mover([int]$o.x, [int]$o.y) }
      'clic'         { $r = [EmiliaPantalla]::Clic([int]$o.x, [int]$o.y, [string]$o.boton, [int]$o.veces, [string]$o.mods) }
      'boton'        { $r = [EmiliaPantalla]::BotonIzquierdo([bool]$o.abajo) }
      'arrastrar'    { $r = [EmiliaPantalla]::Arrastrar([int]$o.x1, [int]$o.y1, [int]$o.x2, [int]$o.y2, [string]$o.mods) }
      'scroll'       { $r = [EmiliaPantalla]::Scroll([int]$o.x, [int]$o.y, [string]$o.direccion, [int]$o.cantidad, [string]$o.mods) }
      'teclas'       { $r = [EmiliaPantalla]::Teclas([string]$o.combo, [int]$o.repetir) }
      'mantener'     { $r = [EmiliaPantalla]::MantenerTecla([string]$o.combo, [double]$o.segundos) }
      'teclear'      { $r = [EmiliaPantalla]::Teclear([string]$o.texto, [int]$o.pausa_ms) }
      'pegar'        {
        # Texto largo en apps normales: por portapapeles (exacto y rápido), restaurando lo que había.
        Add-Type -AssemblyName System.Windows.Forms
        $previo = $null
        try { if ([System.Windows.Forms.Clipboard]::ContainsText()) { $previo = [System.Windows.Forms.Clipboard]::GetText() } } catch { }
        [System.Windows.Forms.Clipboard]::SetText([string]$o.texto)
        Start-Sleep -Milliseconds 80
        if ([System.Windows.Forms.Clipboard]::GetText() -ne [string]$o.texto) { $r = [EmiliaPantalla]::Teclear([string]$o.texto, 8) }
        else { $r = [EmiliaPantalla]::Teclas('ctrl+v', 1); Start-Sleep -Milliseconds 150 }
        if ($null -ne $previo) { try { [System.Windows.Forms.Clipboard]::SetText($previo) } catch { } } else { try { [System.Windows.Forms.Clipboard]::Clear() } catch { } }
      }
      'credencial'   { $r = [EmiliaPantalla]::EscribirCredencial([string]$o.nombre, [string]$o.campo, [bool]$o.enter, [int]$o.pausa_ms) }
      'existe_cred'  { $r = [EmiliaPantalla]::ExisteCredencial([string]$o.nombre) }
      'despierto'    { $r = [EmiliaPantalla]::Despierto([bool]$o.activo) }
      'eco'          { $r = [string]$o.texto }
      default        { throw "Operación desconocida: $($o.op)" }
    }
    Responder @{ id = $id; ok = $true; r = $r }
  } catch {
    $ex = $_.Exception
    while ($ex.InnerException) { $ex = $ex.InnerException }
    Responder @{ id = $id; ok = $false; error = $ex.Message }
  }
}
