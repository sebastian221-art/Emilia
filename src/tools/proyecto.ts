// ARCHIVO: src/tools/proyecto.ts
// ─────────────────────────────────────────────────────────────────────────────
//  TOOLS DE CICLO DE VIDA — crear proyectos y GitHub
// ─────────────────────────────────────────────────────────────────────────────

import type { DefTool } from "../registro/tipos.js";
import { crearProyectoDesdeCero } from "../motor/scaffold.js";
import { obtenerProyecto, obtenerSandbox } from "../dominio/proyectos.js";
import { usuario, crearRepo, abrirPR, listarPRs, infoRepo, fullNameDesdeRemoto, pushConToken, conectarRemoto } from "../motor/github.js";
import { ejecutarComando } from "../motor/sandbox.js";

const MODULO_P = "proyecto", MODULO_G = "github";
const PROY = { type: "string" as const, description: "Nombre del proyecto registrado.", minLength: 2 };

async function proy(nombre: string) { const p = await obtenerProyecto(nombre); if (!p) throw new Error(`Proyecto "${nombre}" no registrado.`); return p; }

export const proyectoCrear: DefTool = {
  nombre: "proyecto_crear", modulo: MODULO_P,
  descripcion: "Crea un proyecto NUEVO desde cero: carpeta, archivos base (plantilla), git init con primer commit, instala dependencias y lo registra (con cmd_start, puerto y salud listos). Después se le implementan funcionalidades con senior_implementar.",
  parametros: {
    type: "object",
    properties: {
      nombre: { type: "string", description: "snake_case, ej. api_clientes.", minLength: 2 },
      descripcion: { type: "string", description: "Qué es / para qué es." },
      plantilla: { type: "string", enum: ["node_ts_express", "node_ts_basico", "vacio"], description: "Base inicial.", default: "node_ts_express" },
      puerto: { type: "integer", description: "Puerto para la plantilla express (defecto 4100).", minimum: 1024, maximum: 65535 },
      reusar_carpeta: { type: "boolean", description: "Si la carpeta ya existe (intento anterior), reutilizarla.", default: false },
      ruta: { type: "string", description: "Carpeta destino exacta si el jefe la pidió (ej. C:\\Users\\Sebas\\proyectos\\mi_api). Si se omite, PROYECTOS_DIR/nombre." },
    },
    required: ["nombre"],
  },
  riesgo: "escritura", requiereAprobacion: false, timeoutSeg: 900,
  async ejecutar(a) {
    const r = await crearProyectoDesdeCero({ nombre: a.nombre, descripcion: a.descripcion, plantilla: a.plantilla, puerto: a.puerto, reusarCarpeta: !!a.reusar_carpeta, ruta: a.ruta });
    return { ok: true, datos: { proyecto: r.proyecto.nombre, ruta: r.ruta, archivos: r.archivos, cmd_start: r.proyecto.cmd_start, puerto: r.proyecto.puerto, url_salud: r.proyecto.url_salud }, resumen: `Proyecto ${r.proyecto.nombre} creado en ${r.ruta} (${r.archivos.length} archivos, plantilla ${a.plantilla || "node_ts_express"}). Ya está registrado${r.proyecto.cmd_start ? ` con start "${r.proyecto.cmd_start}" en puerto ${r.proyecto.puerto}` : ""}.` };
  },
};

export const proyectoInstalar: DefTool = {
  nombre: "proyecto_instalar", modulo: MODULO_P,
  descripcion: "Instala/actualiza las dependencias del proyecto REAL (cmd_install o npm install). No necesita sandbox. Usalo antes de arrancar un proyecto recién integrado o clonado.",
  parametros: { type: "object", properties: { proyecto: PROY }, required: ["proyecto"] },
  riesgo: "escritura", requiereAprobacion: false, timeoutSeg: 900,
  async ejecutar(a) {
    const p = await proy(a.proyecto);
    const cmd = p.cmd_install || "npm install --no-audit --no-fund";
    const r = await ejecutarComando(p.ruta, cmd, 800);
    return r.codigo === 0 ? { ok: true, resumen: `Dependencias de ${p.nombre} instaladas (${Math.round(r.duracion_ms / 1000)}s).\n${r.stdout.slice(-300)}` } : { ok: false, error: `${cmd} falló: ${(r.stderr || r.stdout).slice(-600)}` };
  },
};

export const githubCrearRepo: DefTool = {
  nombre: "github_crear_repo", modulo: MODULO_G,
  descripcion: "Crea el repositorio en GitHub para un proyecto registrado (privado por defecto), lo conecta como origin y sube la rama base. Requiere aprobación.",
  parametros: { type: "object", properties: { proyecto: PROY, privado: { type: "boolean", default: true }, descripcion: { type: "string" } }, required: ["proyecto"] },
  riesgo: "ejecucion", requiereAprobacion: true, timeoutSeg: 300,
  async ejecutar(a) {
    const p = await proy(a.proyecto);
    const ya = await fullNameDesdeRemoto(p.ruta);
    if (ya) return { ok: false, error: `El proyecto ya tiene remoto en GitHub: ${ya}. Usá github_push.` };
    const u = await usuario();
    const repo = await crearRepo({ nombre: p.nombre, descripcion: a.descripcion || p.notas.split("\n")[0], privado: a.privado !== false });
    const c = await conectarRemoto(p.ruta, repo.clone_url);
    if (c.codigo !== 0) return { ok: false, error: `Repo creado (${repo.html_url}) pero no pude conectar origin: ${c.stderr}` };
    const push = await pushConToken(p.ruta, p.rama_base, { setUpstream: true });
    if (push.codigo !== 0) return { ok: false, error: `Repo creado (${repo.html_url}) pero el push falló: ${(push.stderr || push.stdout).slice(-600)}` };
    return { ok: true, datos: { url: repo.html_url, full_name: repo.full_name, usuario: u.login }, resumen: `Repo ${repo.full_name} creado (${a.privado !== false ? "privado" : "público"}) y rama ${p.rama_base} subida: ${repo.html_url}` };
  },
};

export const githubPush: DefTool = {
  nombre: "github_push", modulo: MODULO_G,
  descripcion: "Sube a GitHub la rama base del repo real de un proyecto, o la rama de un sandbox si pasás sandbox_id. Requiere aprobación.",
  parametros: { type: "object", properties: { proyecto: PROY, sandbox_id: { type: "string", description: "Subir la rama de este sandbox en vez de la base." } }, required: ["proyecto"] },
  riesgo: "ejecucion", requiereAprobacion: true, timeoutSeg: 300,
  async ejecutar(a) {
    const p = await proy(a.proyecto);
    let cwd = p.ruta, rama = p.rama_base;
    if (a.sandbox_id) { const sb = await obtenerSandbox(a.sandbox_id); if (!sb) return { ok: false, error: "Sandbox no encontrado." }; cwd = sb.ruta; rama = sb.rama; }
    if (!(await fullNameDesdeRemoto(p.ruta))) return { ok: false, error: "El proyecto no tiene remoto. Usá github_crear_repo primero." };
    const r = await pushConToken(cwd, rama, { setUpstream: true });
    return r.codigo === 0 ? { ok: true, resumen: `Rama ${rama} subida.\n${(r.stderr || r.stdout).slice(-400)}` } : { ok: false, error: (r.stderr || r.stdout).slice(-800) };
  },
};

export const githubAbrirPr: DefTool = {
  nombre: "github_abrir_pr", modulo: MODULO_G,
  descripcion: "Abre un Pull Request en GitHub desde la rama de un sandbox hacia la rama base del proyecto (sube la rama si hace falta). Requiere aprobación.",
  parametros: { type: "object", properties: { sandbox_id: { type: "string", minLength: 8 }, titulo: { type: "string", minLength: 5 }, descripcion: { type: "string", description: "Qué cambia, cómo se verificó." }, borrador: { type: "boolean", default: false } }, required: ["sandbox_id", "titulo"] },
  riesgo: "ejecucion", requiereAprobacion: true, timeoutSeg: 300,
  async ejecutar(a) {
    const sb = await obtenerSandbox(a.sandbox_id);
    if (!sb) return { ok: false, error: "Sandbox no encontrado." };
    const fullName = await fullNameDesdeRemoto(sb.proyecto.ruta);
    if (!fullName) return { ok: false, error: "El proyecto no tiene remoto en GitHub (github_crear_repo)." };
    const st = await ejecutarComando(sb.ruta, "git status --porcelain", 20);
    if (st.stdout.trim()) return { ok: false, error: "El sandbox tiene cambios sin commit. Hacé codigo_commit primero." };
    const push = await pushConToken(sb.ruta, sb.rama, { setUpstream: true });
    if (push.codigo !== 0) return { ok: false, error: `Push falló: ${(push.stderr || push.stdout).slice(-600)}` };
    const pr = await abrirPR({ fullName, head: sb.rama, base: sb.proyecto.rama_base, titulo: a.titulo, cuerpo: a.descripcion, borrador: !!a.borrador });
    return { ok: true, datos: pr, resumen: `PR #${pr.numero} abierto: ${pr.html_url}` };
  },
};

export const githubEstado: DefTool = {
  nombre: "github_estado", modulo: MODULO_G,
  descripcion: "Estado del proyecto en GitHub: remoto, rama por defecto, último push, PRs abiertos, y si el repo local va adelante/atrás del remoto.",
  parametros: { type: "object", properties: { proyecto: PROY }, required: ["proyecto"] },
  riesgo: "lectura", requiereAprobacion: false, timeoutSeg: 60,
  async ejecutar(a) {
    const p = await proy(a.proyecto);
    const fullName = await fullNameDesdeRemoto(p.ruta);
    if (!fullName) return { ok: true, datos: { remoto: null }, resumen: `${p.nombre} no tiene remoto en GitHub todavía.` };
    const [info, prs] = await Promise.all([infoRepo(fullName), listarPRs(fullName)]);
    await ejecutarComando(p.ruta, "git fetch origin --quiet", 60);
    const ab = await ejecutarComando(p.ruta, `git rev-list --left-right --count ${p.rama_base}...origin/${p.rama_base}`, 20);
    const [adelante, atras] = ab.stdout.trim().split(/\s+/).map(Number);
    return { ok: true, datos: { ...info, prs, adelante, atras }, resumen: `${info.full_name} (${info.private ? "privado" : "público"}) · último push ${info.pushed_at}\nlocal ${adelante || 0} commit(s) adelante, ${atras || 0} atrás\nPRs abiertos: ${prs.length ? prs.map((x) => `#${x.numero} ${x.titulo} (${x.rama})`).join("; ") : "ninguno"}` };
  },
};

export const toolsProyecto: DefTool[] = [proyectoCrear, proyectoInstalar, githubCrearRepo, githubPush, githubAbrirPr, githubEstado];