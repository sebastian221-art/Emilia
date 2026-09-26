// ARCHIVO: src/motor/scaffold.ts
// ─────────────────────────────────────────────────────────────────────────────
//  SCAFFOLD — crear un proyecto desde cero
//  Carpeta + archivos base según plantilla + git init + primer commit +
//  registro como proyecto (con cmd_start, puerto y salud ya configurados).
//  .env: PROYECTOS_DIR (por defecto la carpeta padre de Emilia)
// ─────────────────────────────────────────────────────────────────────────────

import { promises as fs } from "node:fs";
import path from "node:path";
import { ejecutarComando } from "./sandbox.js";
import { registrarProyecto, obtenerProyecto, type Proyecto } from "../dominio/proyectos.js";

export const PROYECTOS_DIR = path.resolve(process.env.PROYECTOS_DIR || path.join(process.cwd(), ".."));
export type Plantilla = "node_ts_express" | "node_ts_basico" | "vacio";

export async function crearProyectoDesdeCero(p: { nombre: string; descripcion?: string; plantilla?: Plantilla; puerto?: number; reusarCarpeta?: boolean; ruta?: string }): Promise<{ proyecto: Proyecto; ruta: string; archivos: string[] }> {
  if (!/^[a-z][a-z0-9_]{1,40}$/.test(p.nombre)) throw new Error("El nombre debe ser snake_case en minúsculas (ej. mi_api).");
  if (await obtenerProyecto(p.nombre)) throw new Error(`Ya existe un proyecto registrado como "${p.nombre}".`);
  const ruta = p.ruta ? path.resolve(p.ruta) : path.join(PROYECTOS_DIR, p.nombre);
  let existia = false;
  try { await fs.access(ruta); existia = true; } catch { /* no existe: bien */ }
  if (existia) {
    const contenido = await fs.readdir(ruta);
    if (contenido.length && !p.reusarCarpeta) throw new Error(`La carpeta ${ruta} ya existe y tiene archivos. Si es un intento anterior fallido o querés reutilizarla, repetí con reusar_carpeta=true (se sobreescriben los archivos base, el resto se conserva).`);
  } else {
    await fs.mkdir(ruta, { recursive: true });
  }

  try {
    const plantilla = p.plantilla || "node_ts_express";
    const puerto = p.puerto || 4100;
    const archivos = plantilla === "vacio" ? await vacio(ruta, p) : plantilla === "node_ts_basico" ? await nodeBasico(ruta, p) : await nodeExpress(ruta, p, puerto);

    const tieneGit = await existe(path.join(ruta, ".git"));
    if (!tieneGit) {
      const g1 = await ejecutarComando(ruta, "git init -b main", 30);
      if (g1.codigo !== 0) { const g2 = await ejecutarComando(ruta, "git init", 30); if (g2.codigo !== 0) throw new Error(`git init falló: ${(g2.stderr || g2.stdout).slice(-300)}`); await ejecutarComando(ruta, "git checkout -b main", 30); }
    }
    await ejecutarComando(ruta, "git add -A", 30);
    const c = await ejecutarComando(ruta, `git commit -m "Proyecto ${p.nombre} creado por Emilia"`, 60);
    if (c.codigo !== 0 && !/nothing to commit/i.test(c.stdout + c.stderr)) throw new Error(`git commit falló: ${(c.stderr || c.stdout).slice(-300)}. ¿Tenés configurados git user.name y user.email?`);

  const esNode = plantilla !== "vacio";
  const proyecto = await registrarProyecto({
    nombre: p.nombre, ruta, rama_base: "main",
    cmd_install: esNode ? "npm install --no-audit --no-fund" : undefined,
    cmd_build: esNode ? "npx tsc --noEmit -p ." : undefined,
    cmd_test: esNode ? "npm test" : undefined,
    cmd_start: plantilla === "node_ts_express" ? "npm run dev" : undefined,
    puerto: plantilla === "node_ts_express" ? puerto : undefined,
    url_salud: plantilla === "node_ts_express" ? `http://localhost:${puerto}/api/salud` : undefined,
    notas: `${p.descripcion || ""}\nCreado por Emilia con plantilla ${plantilla}.`.trim(),
  } as any);
    if (esNode) {
      const i = await ejecutarComando(ruta, "npm install --no-audit --no-fund", 600);
      if (i.codigo !== 0) console.warn(`[scaffold] npm install en ${p.nombre} terminó con ${i.codigo}: ${(i.stderr || i.stdout).slice(-300)}`);
    }
    return { proyecto, ruta, archivos };
  } catch (e) {
    // Falló a mitad: no dejar carpeta huérfana si la creamos nosotros.
    if (!existia) await fs.rm(ruta, { recursive: true, force: true }).catch(() => {});
    throw e;
  }
}

async function existe(p: string) { try { await fs.access(p); return true; } catch { return false; } }

async function escribir(ruta: string, archivos: Record<string, string>): Promise<string[]> {
  for (const [rel, contenido] of Object.entries(archivos)) {
    const abs = path.join(ruta, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, contenido);
  }
  return Object.keys(archivos);
}

const gitignore = `node_modules/\ndist/\n.env\ndata/\n*.log\n`;
const tsconfig = JSON.stringify({ compilerOptions: { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, esModuleInterop: true, skipLibCheck: true, noEmit: true }, include: ["src"] }, null, 2);

async function vacio(ruta: string, p: { nombre: string; descripcion?: string }) {
  return escribir(ruta, { "README.md": `# ${p.nombre}\n\n${p.descripcion || ""}\n`, ".gitignore": gitignore });
}

async function nodeBasico(ruta: string, p: { nombre: string; descripcion?: string }) {
  return escribir(ruta, {
    "package.json": JSON.stringify({ name: p.nombre, version: "0.1.0", type: "module", scripts: { dev: "tsx watch src/index.ts", start: "tsx src/index.ts", test: "node --test", build: "tsc --noEmit -p ." }, dependencies: {}, devDependencies: { tsx: "^4.19.0", typescript: "^5.6.0", "@types/node": "^22.0.0" } }, null, 2),
    "tsconfig.json": tsconfig, ".gitignore": gitignore,
    "README.md": `# ${p.nombre}\n\n${p.descripcion || ""}\n\n\`\`\`\nnpm install\nnpm run dev\n\`\`\`\n`,
    "src/index.ts": `console.log("${p.nombre} listo");\n`,
  });
}

async function nodeExpress(ruta: string, p: { nombre: string; descripcion?: string }, puerto: number) {
  return escribir(ruta, {
    "package.json": JSON.stringify({ name: p.nombre, version: "0.1.0", type: "module", scripts: { dev: "tsx watch src/server.ts", start: "tsx src/server.ts", test: "node --test", build: "tsc --noEmit -p ." }, dependencies: { express: "^4.19.2", dotenv: "^16.4.5" }, devDependencies: { tsx: "^4.19.0", typescript: "^5.6.0", "@types/node": "^22.0.0", "@types/express": "^4.17.21" } }, null, 2),
    "tsconfig.json": tsconfig, ".gitignore": gitignore,
    ".env.example": `PORT=${puerto}\n`,
    "README.md": `# ${p.nombre}\n\n${p.descripcion || ""}\n\n\`\`\`\nnpm install\nnpm run dev   # http://localhost:${puerto}/api/salud\n\`\`\`\n`,
    "src/server.ts": `import express from "express";
import "dotenv/config";
import { readFileSync } from "node:fs";

const app = express();
app.use(express.json());
const version = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf-8")).version;

app.get("/api/salud", (_req, res) => res.json({ ok: true, version, uptime_s: Math.round(process.uptime()) }));

const PORT = Number(process.env.PORT ?? ${puerto});
app.listen(PORT, () => console.log(\`${p.nombre} en http://localhost:\${PORT}\`));
`,
  });
}