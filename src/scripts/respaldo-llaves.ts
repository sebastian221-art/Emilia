// ARCHIVO: src/scripts/respaldo-llaves.ts
//   npm run respaldo:llaves                 → crea el respaldo cifrado (te pide una frase)
//   npm run respaldo:restaurar -- archivo   → lo abre y deja .env.restaurado + la llave
import "dotenv/config";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { cifrarRespaldo, descifrarRespaldo, MARCA } from "../seguridad/respaldo-llaves.js";

function preguntarOculto(texto: string): Promise<string> {
  if (process.env.FRASE_RESPALDO) return Promise.resolve(process.env.FRASE_RESPALDO);   // solo pruebas/automatización
  return new Promise((res) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const escribir = (rl as any)._writeToOutput;
    (rl as any)._writeToOutput = (s: string) => { if (s.includes(texto)) escribir.call(rl, s); else escribir.call(rl, "*"); };
    rl.question(texto, (r) => { rl.close(); process.stdout.write("\n"); res(r); });
  });
}

const modo = process.argv[2] === "restaurar" ? "restaurar" : "crear";
if (modo === "crear") {
  const { obtenerLlave } = await import("../motor/cifrado.js");
  const k = await obtenerLlave();
  const envRuta = path.resolve(".env");
  const env = fs.existsSync(envRuta) ? fs.readFileSync(envRuta, "utf8") : null;
  console.log("\nRespaldo cifrado de la llave del cerebro y del .env.\nElige una frase larga que recuerdes (o guárdala en tu gestor de contraseñas). Sin ella el respaldo no sirve.\n");
  const f1 = await preguntarOculto("Frase: "), f2 = await preguntarOculto("Repítela: ");
  if (f1 !== f2) { console.log("No coinciden. No hice nada."); process.exit(1); }
  const buf = cifrarRespaldo({ creado: new Date().toISOString(), cerebro_llave: k ? k.toString("base64") : null, env, equipo: os.hostname() }, f1);
  const dir = path.resolve(process.env.COPIAS_DIR || path.join(os.homedir(), "EmiliaCopias"));
  fs.mkdirSync(dir, { recursive: true });
  const archivo = path.join(dir, `llaves-${new Date().toISOString().slice(0, 10)}.emilia`);
  fs.writeFileSync(archivo, buf);
  fs.mkdirSync(path.dirname(MARCA()), { recursive: true });
  fs.writeFileSync(MARCA(), JSON.stringify({ t: new Date().toISOString(), archivo }));
  console.log(`\n✅ Respaldo listo: ${archivo}\nCópialo fuera de este PC (OneDrive, una USB). Para recuperarlo: npm run respaldo:restaurar -- "${archivo}"\n`);
} else {
  const archivo = process.argv[3];
  if (!archivo || !fs.existsSync(archivo)) { console.log("Dime el archivo: npm run respaldo:restaurar -- C:\\ruta\\llaves-AAAA-MM-DD.emilia"); process.exit(1); }
  const c = descifrarRespaldo(fs.readFileSync(archivo), await preguntarOculto("Frase del respaldo: "));
  if (c.env) { fs.writeFileSync(path.resolve(".env.restaurado"), c.env); console.log(`✅ Dejé tu .env en .env.restaurado (del ${c.creado.slice(0, 10)}, equipo ${c.equipo}). Revísalo y renómbralo a .env.`); }
  if (c.cerebro_llave) console.log(`✅ Llave del cerebro: si el .env no la trae, agrega esta línea:\nCEREBRO_LLAVE=${c.cerebro_llave}`);
}
process.exit(0);
