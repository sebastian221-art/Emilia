# Arca — la técnica

**Empezar desde cero (Windows):** clic derecho en `scripts\windows\arca.ps1` → «Ejecutar con PowerShell». El script instala Node si hace falta y los paquetes, y después Arca te guía en la terminal.

| Dónde | Qué |
|---|---|
| Terminal: `npm run arca` | El tutorial antes de que Emilia exista. Te pide cada llave sin mostrarla, la prueba de verdad y la guarda en el `.env` |
| Panel: `/arca` (Taller) | Misiones, XP, siguiente paso, formulario local de llaves, botones de instalar, prueba final y mantenimiento |
| WhatsApp: «hablar con Arca» | «qué falta», «listo», «instala docker», «prueba todo», «mantenimiento», «qué hiciste» |

**Misiones:**
1. 🧱 Los cimientos
2. 🧠 El cerebro
3. 💬 La voz (WhatsApp)
4. 🛠️ Las manos
5. 🔌 Los servicios
6. 🛡️ Autónoma
7. 🏁 La prueba final

**Reglas:**
- Cada ✅ sale de una prueba real: programa, conexión o llamada a la API.
- Las llaves nunca van por chat ni pasan por un modelo.
- Solo instala lo de su catálogo, y siempre con tu OK.
- No arregla código: lo pasa a System o a Sage y tú decides.
- Todo lo que hace queda en `arca_acciones`.

Para crear el agente: `npx tsx src/scripts/crear-arca.ts`.
