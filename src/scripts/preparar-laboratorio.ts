// ARCHIVO: src/scripts/preparar-laboratorio.ts
// ─────────────────────────────────────────────────────────────────────────────
//  Instala el kit del laboratorio de Sage (una vez, o para actualizarlo):
//  librerías de Word/Excel/PowerPoint/PDF y el navegador para capturar páginas.
//    npm run lab:preparar
// ─────────────────────────────────────────────────────────────────────────────
import { execSync } from "node:child_process";
import { prepararLaboratorio, DIR_HERRAMIENTAS } from "../motor/laboratorio.js";

await prepararLaboratorio();
const correr = (cmd: string) => { console.log(`\n$ ${cmd}`); execSync(cmd, { cwd: DIR_HERRAMIENTAS, stdio: "inherit" }); };
correr("npm install --no-audit --no-fund");
correr("npx playwright install chromium");
console.log(`\n✅ Kit listo en ${DIR_HERRAMIENTAS}. Sage ya puede hacer documentos de Office, capturar páginas y compararlas.`);
