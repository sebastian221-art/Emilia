// ARCHIVO: src/scripts/escanear-secretos.ts
// npm run secretos — busca llaves en el repo (archivos que git sigue + historial
// reciente) y en los logs. No imprime ninguna llave completa.
import "dotenv/config";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { escanearTexto, type Hallazgo } from "../seguridad/secretos.js";

const raiz = process.cwd();
const hallazgos: Hallazgo[] = [];
const sh = (c: string) => { try { return execSync(c, { cwd: raiz, encoding: "utf8", maxBuffer: 64 << 20, stdio: ["ignore", "pipe", "ignore"] }); } catch { return ""; } };

// 1. Archivos seguidos por git (y que .env NO esté entre ellos).
const seguidos = sh("git ls-files").split("\n").filter(Boolean);
for (const f of seguidos) {
  if (/(^|\/)\.env$/.test(f)) hallazgos.push({ archivo: f, linea: 0, tipo: ".env dentro del repo", muestra: "" });
  if (/\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|woff2?|ttf|mp[34]|wav|ogg|lock)$/i.test(f) || f.startsWith("node_modules/")) continue;
  const p = path.join(raiz, f);
  try { const st = fs.statSync(p); if (st.size > 2_000_000) continue; hallazgos.push(...escanearTexto(f, fs.readFileSync(p, "utf8"))); } catch {}
}
// 2. Lo que se agregó en los últimos 200 commits (una llave borrada sigue en el historial).
const diff = sh("git log -p -n 200 --no-color --diff-filter=AM -- . ':!package-lock.json'");
for (const h of escanearTexto("(historial git)", diff.split("\n").filter((l) => l.startsWith("+")).join("\n"))) hallazgos.push({ ...h, linea: 0 });
// 3. .gitignore tiene que tapar .env y los datos.
const gi = fs.existsSync(path.join(raiz, ".gitignore")) ? fs.readFileSync(path.join(raiz, ".gitignore"), "utf8") : "";
for (const debe of [".env", "node_modules"]) if (!gi.split("\n").some((l) => l.trim().replace(/^\//, "").startsWith(debe.replace(/\/$/, "")))) hallazgos.push({ archivo: ".gitignore", linea: 0, tipo: `no ignora ${debe}`, muestra: "" });
// 4. Logs.
for (const dir of ["logs", "datos/logs"]) {
  const d = path.join(raiz, dir);
  if (!fs.existsSync(d)) continue;
  for (const f of fs.readdirSync(d)) { try { hallazgos.push(...escanearTexto(path.join(dir, f), fs.readFileSync(path.join(d, f), "utf8"))); } catch {} }
}

if (!hallazgos.length) { console.log("✅ Sin llaves a la vista: repo, historial reciente, .gitignore y logs limpios."); process.exit(0); }
console.log(`⚠️ ${hallazgos.length} hallazgo(s):`);
for (const h of hallazgos.slice(0, 100)) console.log(`  - ${h.archivo}${h.linea ? `:${h.linea}` : ""} · ${h.tipo}${h.muestra ? ` (${h.muestra})` : ""}`);
console.log("\nSi alguna es real: cámbiala en su proveedor (rotarla), sácala del archivo y usa ${VAR} desde el .env.");
process.exit(1);
