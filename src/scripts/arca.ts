// ARCHIVO: src/scripts/arca.ts
// ─────────────────────────────────────────────────────────────────────────────
//  npm run arca — Arca en la terminal: el tutorial de instalación que funciona
//  ANTES de que exista Emilia (sin base, sin servidor). Te dice la misión, el
//  siguiente paso, te pide cada llave (oculta), la prueba de verdad y la guarda
//  en el .env. Las llaves nunca pasan por un modelo ni por WhatsApp.
// ─────────────────────────────────────────────────────────────────────────────
import dotenv from "dotenv";
import readline from "node:readline";
import { spawnSync } from "node:child_process";
import { asegurarEnv, escribirVariable, variablesDe, RUTA_ENV } from "../arca/env.js";

const esWin = process.platform === "win32";
const C = { r: "\x1b[0m", b: "\x1b[1m", g: "\x1b[32m", y: "\x1b[33m", c: "\x1b[36m", d: "\x1b[2m", m: "\x1b[35m" };
const sinMarkdown = (t: string) => t.replace(/\*([^*]+)\*/g, `${C.b}$1${C.r}`);

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
let oculto = false;
const escribir = (rl as any)._writeToOutput;
(rl as any)._writeToOutput = (s: string) => { if (oculto && !/[\r\n]/.test(s) && !s.includes("›")) escribir.call(rl, "•".repeat(s.length)); else escribir.call(rl, s); };
let cerrado = false;
rl.on("close", () => { cerrado = true; });
const preguntar = (q: string, secreto = false) => new Promise<string>((res) => { if (cerrado) return res("q"); oculto = secreto; rl.question(q, (r) => { oculto = false; res(r.trim()); }); });

function npm(args: string[]) { const r = spawnSync(esWin ? "npm.cmd" : "npm", args, { stdio: "inherit", shell: esWin }); return r.status === 0; }

async function main() {
  // npm run arca -- probar  → directo a la prueba final (también cuando todo ya está instalado)
  if (process.argv.includes("probar")) {
    dotenv.config({ path: RUTA_ENV(), override: true });
    const { probarTodo } = await import("../arca/pruebas.js");
    const env = (await preguntar("¿Te mando un WhatsApp real de prueba? (s/n) › ")).toLowerCase().startsWith("s");
    const inf = await probarTodo({ enviarWhatsapp: env, avance: (x) => console.log(`${C.d}${x}${C.r}`) });
    console.log("\n" + sinMarkdown(inf.texto) + "\n");
    rl.close(); process.exit(0);
  }
  console.log(`\n${C.m}${C.b}  ⚙  ARCA${C.r} ${C.d}— tu técnica. Te guío para dejar a Emilia instalada, probada y cuidándose sola.${C.r}\n`);
  if (asegurarEnv()) console.log(`${C.g}Creé tu .env a partir de .env.example (${RUTA_ENV()}).${C.r}\n`);
  const saltados = new Set<string>();
  for (;;) {
    dotenv.config({ path: RUTA_ENV(), override: true });
    console.log(`${C.d}Revisando todo de verdad…${C.r}`);
    const { revisar, celebrar } = await import("../arca/estado.js");
    const { armarTutorial, textoTutorial, listo } = await import("../arca/tutorial.js");
    const r = await revisar();
    const fiesta = celebrar(r.nuevas); if (fiesta) console.log(`\n${C.y}${fiesta}${C.r}`);
    // El siguiente paso, saltando lo que dijiste «después».
    const t = armarTutorial(r.chequeos.filter((c) => !saltados.has(c.id) || listo(c)).concat(r.chequeos.filter((c) => saltados.has(c.id) && !listo(c)).map((c) => ({ ...c, estado: "omitido" as const, detalle: "Solo en Windows (saltado por ahora)" }))), { pruebasHechas: r.tutorial.pruebasHechas });
    console.log("\n" + sinMarkdown(textoTutorial(t, { detalle: true })).replace(/Cuando lo tengas, dime «listo»[^\n]*/, "").replace(/dime «Arca, instala (\w+)»/, "elige [i]"));
    const s = t.siguiente;
    if (!t.actual) { console.log(`\n${C.g}Para dejarla corriendo siempre: npm run inicio:instalar${C.r}\n`); break; }
    // Las que faltan; si están todas pero el chequeo falla, se piden de nuevo (puede ser una llave mala o de ejemplo).
    const delChequeo = s ? variablesDe(s.id) : [];
    const faltan = delChequeo.filter((v) => !process.env[v.nombre]?.trim());
    const vars = faltan.length ? faltan : s && s.estado !== "ok" ? delChequeo.filter((v) => !/CORREO_2|ANY_/.test(v.nombre)) : [];
    const ops = [
      vars.length ? `${C.b}[Enter]${C.r} poner ${vars.map((v) => v.nombre).join(", ")}` : `${C.b}[Enter]${C.r} revisar de nuevo`,
      s?.instalable ? `${C.b}[i]${C.r} instalar ${s.instalable}` : "",
      s?.id === "migraciones" || s?.id === "pgvector" ? `${C.b}[m]${C.r} crear/migrar la base` : "",
      s ? `${C.b}[s]${C.r} saltar esto por ahora` : "",
      t.actual.mision.id === "pruebas" ? `${C.b}[p]${C.r} la prueba final` : "",
      `${C.b}[q]${C.r} salir`,
    ].filter(Boolean);
    const op = (await preguntar(`\n${ops.join("  ")}\n› `)).toLowerCase();
    if (op === "q") break;
    if (op === "s" && s) { saltados.add(s.id); continue; }
    if (op === "i" && s?.instalable) {
      if ((await preguntar(`¿Instalo ${s.instalable} en tu PC? (s/n) › `)).toLowerCase().startsWith("s")) {
        const { instalar } = await import("../arca/mantenimiento.js");
        console.log(`${C.d}Instalando… (puede tardar)${C.r}`); const x = await instalar(s.instalable); console.log(x.ok ? `${C.g}${x.detalle}${C.r}` : `${C.y}${x.detalle}${C.r}`);
      }
      continue;
    }
    if (op === "m") { npm(["run", "crear-base"]); npm(["run", "migrate"]); continue; }
    if (op === "p") {
      const { probarTodo } = await import("../arca/pruebas.js");
      const env = (await preguntar("¿Te mando un WhatsApp real de prueba? (s/n) › ")).toLowerCase().startsWith("s");
      const inf = await probarTodo({ enviarWhatsapp: env, avance: (x) => console.log(`${C.d}${x}${C.r}`) });
      console.log("\n" + sinMarkdown(inf.texto)); await preguntar("\n[Enter] seguir › "); continue;
    }
    // Pedir las llaves que faltan, probarlas y guardarlas.
    for (const v of vars) {
      let valor = await preguntar(`${C.c}${v.pregunta}${C.r}${v.secreto ? " (no se ve al escribir)" : ""}\n› `, v.secreto);
      if (!valor && v.generar) { valor = v.generar(); console.log(`Generé: ${valor}  ${C.d}(úsalo igual en Meta)${C.r}`); }
      if (!valor) { console.log(`${C.d}Saltado.${C.r}`); continue; }
      try {
        escribirVariable(v.nombre, valor); console.log(`${C.g}Guardado ${v.nombre}.${C.r}`);
        if (v.nombre === "DATABASE_URL") {   // la conexión a la base se arma al arrancar: vuelvo a abrir Arca
          console.log(`${C.d}Me reinicio para conectarme a la base…${C.r}`); rl.close();
          const r = spawnSync(process.execPath, [...process.execArgv, ...process.argv.slice(1)], { stdio: "inherit" }); process.exit(r.status ?? 0);
        }
      }
      catch (e: any) { console.log(`${C.y}${e?.message || e}${C.r}`); }
    }
  }
  rl.close();
  const { db } = await import("../db/cliente.js").catch(() => ({ db: null as any }));
  await db?.end?.().catch(() => {});
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
