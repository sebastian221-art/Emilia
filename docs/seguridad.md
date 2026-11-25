# Seguridad de Emilia

`npm run seguridad` revisa todo y dice qué arreglar. `npm run secretos` busca llaves en el repo, el historial y los logs.

| Capa | Qué frena | Dónde |
|---|---|---|
| Panel solo local | Que alguien de la red lo vea | `PANEL_HOST` (127.0.0.1) |
| Host local | DNS rebinding (una web que apunta su dominio a 127.0.0.1) | `src/seguridad/panel.ts` → 421 |
| X-Emilia + Origin + Sec-Fetch-Site | CSRF (una web que manda POST a tu panel) | `src/seguridad/panel.ts` → 403; `/comun/menu.js` pone el encabezado solo |
| Firma HMAC de Meta | Que alguien se haga pasar por ti en el webhook | `WHATSAPP_APP_SECRET` |
| Ritmo de terceros | Ráfagas o bots que gastan modelo | `src/seguridad/ritmo.ts` (20 / 10 min, 150 / día por número) |
| Contenido externo = dato | Prompt injection en correos, webs, archivos, MCP, terceros | `src/seguridad/contaminacion.ts` |
| Contaminación | Que un correo o una web hagan actuar a un agente | Tras leer algo de afuera, toda acción hacia afuera pide OK, también en delegaciones y misiones |
| Tope global de gasto | Bucles caros | `GASTO_DIARIO_MAX` (10 USD); lo tuyo tiene 20 % de margen |
| Redacción de secretos | Llaves en logs y trazas | `src/seguridad/secretos.ts` |
| Candados del hospital | Que alguien afloje el perfil | `CANDADOS_HOSPITAL` en `permisos-pc.ts` |
| Solo Lyra escribe a terceros | Que otro agente le escriba a alguien | Lo revisa la auditoría |

Bloqueos y avisos quedan en la tabla `seguridad_eventos`.
