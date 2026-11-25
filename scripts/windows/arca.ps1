# ARRANQUE DE ARCA — lo único que corres a mano. Deja lo mínimo para que Arca
# pueda hablar (Node y los paquetes) y le pasa el control: desde ahí ella te
# guía con el tutorial (misiones, llaves, instalaciones, pruebas).
#   Clic derecho → «Ejecutar con PowerShell», o:
#   powershell -ExecutionPolicy Bypass -File scripts\windows\arca.ps1
$ErrorActionPreference = "Stop"
$raiz = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
Set-Location $raiz
Write-Host ""
Write-Host "  ARCA — preparando lo mínimo para empezar…" -ForegroundColor Magenta

function Tiene($cmd) { return [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }
function Refrescar-Path { $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User") }

if (-not (Tiene "winget")) { Write-Host "Falta winget (App Installer). Instálalo desde la Microsoft Store y vuelve a correr esto." -ForegroundColor Red; exit 1 }

$nodeOk = $false
if (Tiene "node") { $v = (node -v).TrimStart("v").Split(".")[0]; $nodeOk = [int]$v -ge 20 }
if (-not $nodeOk) {
  $r = Read-Host "Necesito Node.js 20 o más nuevo. ¿Lo instalo? (s/n)"
  if ($r -notmatch "^[sS]") { exit 1 }
  winget install --id OpenJS.NodeJS.LTS -e --silent --accept-source-agreements --accept-package-agreements
  Refrescar-Path
  if (-not (Tiene "node")) { Write-Host "Node quedó instalado: cierra esta ventana, abre otra y vuelve a correr arca.ps1." -ForegroundColor Yellow; exit 0 }
}
if (-not (Tiene "git")) {
  $r = Read-Host "Git no está (lo uso para las actualizaciones). ¿Lo instalo? (s/n)"
  if ($r -match "^[sS]") { winget install --id Git.Git -e --silent --accept-source-agreements --accept-package-agreements; Refrescar-Path }
}
if (-not (Test-Path (Join-Path $raiz "node_modules\tsx"))) {
  Write-Host "Instalando los paquetes de Emilia (unos minutos la primera vez)…" -ForegroundColor Cyan
  npm ci --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { Write-Host "npm ci falló. Copia el error y pásaselo a Arca o a Sage." -ForegroundColor Red; exit 1 }
}
npm run arca
