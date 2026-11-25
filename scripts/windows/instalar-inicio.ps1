# Emilia arranca sola al iniciar sesión en Windows (tarea programada "Emilia").
# Corre el vigía (src/vigia.ts), que levanta el servidor y lo revive si se cae.
# Si el vigía mismo muere, Windows lo vuelve a lanzar cada minuto.
#   powershell -ExecutionPolicy Bypass -File scripts\windows\instalar-inicio.ps1
# Va con TU usuario (no como servicio del sistema) porque Emilia necesita tu
# escritorio: WhatsApp de escritorio, la pantalla y la llave protegida con DPAPI.
$ErrorActionPreference = "Stop"
$raiz = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { Write-Host "No encuentro Node. Instálalo primero (Arca te guía)." -ForegroundColor Red; exit 1 }
if (-not (Test-Path (Join-Path $raiz ".env"))) { Write-Host "Falta el .env en $raiz. Termina la instalación con Arca antes." -ForegroundColor Red; exit 1 }

# Lanzador oculto: sin ventana negra al iniciar sesión.
$vbs = Join-Path $raiz "scripts\windows\emilia-oculta.vbs"
@"
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = "$raiz"
sh.Run """$node"" --import tsx src/vigia.ts", 0, True
"@ | Set-Content -Path $vbs -Encoding ASCII

$accion = New-ScheduledTaskAction -Execute "wscript.exe" -Argument "`"$vbs`"" -WorkingDirectory $raiz
$disparador = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$config = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
  -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName "Emilia" -Action $accion -Trigger $disparador -Settings $config -Principal $principal `
  -Description "Emilia y su equipo: arranca el vigía al iniciar sesión y lo revive si se cae." -Force | Out-Null
Write-Host "Listo: Emilia arranca sola cuando inicias sesión." -ForegroundColor Green
$r = Read-Host "¿La arranco ahora? (s/n)"
if ($r -match "^[sS]") { Start-ScheduledTask -TaskName "Emilia"; Write-Host "Arrancando. Panel: http://127.0.0.1:3000 (dale un par de minutos)." }
