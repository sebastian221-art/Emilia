# Autonomía: Emilia se cuida sola

| Qué | Cómo | Comando |
|---|---|---|
| Arranca con Windows | Tarea programada «Emilia» al iniciar sesión, con tu usuario (necesita tu escritorio) y sin ventana | `npm run inicio:instalar` (quitar: `npm run inicio:quitar`) |
| Se levanta si se cae | El vigía la relanza con espera creciente. Si se cae 5 veces en 15 min, para 10 min y te avisa | `npm run vigia` (lo hace la tarea) |
| Se destraba si se cuelga | `/api/salud` cada minuto. A los 3 fallos seguidos, la reinicia | — |
| Base caída | No reinicia en bucle: te avisa (máx. 1 vez por hora) | — |
| Logs | `logs/emilia-AAAA-MM-DD.log`, 14 días, con las llaves tapadas | — |
| Copia de la base | Diaria, verificada y rotada (vigilancia «Copias de seguridad», 03:00) | `COPIAS_DIR` → pon una carpeta de OneDrive |
| Respaldo de llaves | Llave del cerebro + `.env`, cifrados con una frase tuya | `npm run respaldo:llaves` / `npm run respaldo:restaurar -- archivo` |
| Actualizaciones | Solo con tu OK: cada día a las 04:30 revisa GitHub y te avisa. Escribes «actualiza emilia» y ella baja, instala, migra y arranca. Si la versión nueva no queda sana, vuelve sola a la anterior | WhatsApp |

Los avisos del vigía salen directo a Meta (con la plantilla `recordatorio_emilia`), así que llegan aunque el servidor esté caído.
El estado del vigía (reinicios, versión, última actualización) queda en `data/vigia.json`.
