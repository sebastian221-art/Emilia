# Quita el arranque automático de Emilia (no borra nada más).
Stop-ScheduledTask -TaskName "Emilia" -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName "Emilia" -Confirm:$false -ErrorAction SilentlyContinue
Write-Host "Listo: Emilia ya no arranca sola. Para usarla: npm run vigia"
