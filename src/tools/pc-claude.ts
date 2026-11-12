// ARCHIVO: src/tools/pc-claude.ts
// ─────────────────────────────────────────────────────────────────────────────
//  TOOLS DEL USO DEL COMPUTADOR CON CLAUDE: perfiles, sesiones y botón de parar.
//  (La acción en sí es pc_operar, en tools/pc-operar.ts.)
// ─────────────────────────────────────────────────────────────────────────────
import { promises as fs } from "node:fs";
import path from "node:path";
import type { DefTool } from "../registro/tipos.js";
import { query } from "../db/cliente.js";
import { listarPerfiles, guardarPerfil, detenerSesionPc, sesionesPcActivas } from "../motor/computer-use.js";

const MODULO = "pc";

const describir = (p: any) => `• *${p.nombre}*: ${p.descripcion}\n  apps: ${p.apps.join(", ")} · comandos: ${p.comandos}${p.aprobar_comandos ? " (cada uno con OK)" : ""} · capturas por WhatsApp: ${p.enviar_capturas ? "sí" : "no"}${p.datos_sensibles ? " · datos sensibles" : ""}${p.credenciales.length ? ` · credenciales: ${p.credenciales.join(", ")}` : ""} · máx ${p.max_minutos} min / ${p.max_pasos} pasos / ${p.presupuesto_usd} USD`;

export const pcPerfiles: DefTool = {
  nombre: "pc_perfiles", modulo: MODULO,
  descripcion: "Lista los perfiles de seguridad del uso del computador (qué apps se pueden tocar, cómo se tratan los comandos, si se mandan capturas, credenciales autorizadas, límites).",
  parametros: { type: "object", properties: {} },
  riesgo: "lectura", requiereAprobacion: false, timeoutSeg: 20,
  async ejecutar() { const ps = await listarPerfiles(); return { ok: true, datos: ps, resumen: ps.map(describir).join("\n") }; },
};

export const pcPerfilGuardar: DefTool = {
  nombre: "pc_perfil_guardar", modulo: MODULO,
  descripcion: "Crea o ajusta un perfil del uso del computador. Solo cambia los campos que pases. Ej.: autorizar la credencial 'hospital-putty' en hospital_lectura, agregar 'winscp' a las apps, cambiar notas (IP del servidor, pasos para entrar).",
  parametros: {
    type: "object",
    properties: {
      nombre: { type: "string", minLength: 2 },
      descripcion: { type: "string" },
      apps: { type: "array", items: { type: "string" }, description: "Procesos permitidos (sin .exe) o ['*']." },
      apps_bloqueadas: { type: "array", items: { type: "string" } },
      comandos: { type: "string", enum: ["riesgo", "aprobar_todos", "solo_lectura"] },
      aprobar_comandos: { type: "boolean" },
      aprobar_texto_remoto: { type: "boolean" },
      enviar_capturas: { type: "boolean" },
      datos_sensibles: { type: "boolean" },
      credenciales: { type: "array", items: { type: "string" }, description: "Nombres de credenciales del Administrador de credenciales de Windows que se pueden escribir." },
      aprobar_inicio: { type: "boolean" },
      max_pasos: { type: "integer", minimum: 5, maximum: 400 },
      max_minutos: { type: "integer", minimum: 1, maximum: 240 },
      presupuesto_usd: { type: "number", minimum: 0.1, maximum: 50 },
      modelo: { type: "string", description: "claude:sonnet (defecto), claude:opus o claude:haiku." },
      notas: { type: "string", description: "Lo que el operador debe saber siempre en este perfil." },
    },
    required: ["nombre"],
  },
  riesgo: "sistema", requiereAprobacion: true, timeoutSeg: 20,
  async ejecutar(a) { const p = await guardarPerfil(a as any); return { ok: true, datos: p, resumen: `Perfil guardado:\n${describir(p)}` }; },
};

export const pcSesiones: DefTool = {
  nombre: "pc_sesiones", modulo: MODULO,
  descripcion: "Sesiones recientes del uso del computador (qué se pidió, cómo terminó, comandos, costo) y las que están corriendo. Con id, muestra la bitácora de esa sesión.",
  parametros: { type: "object", properties: { id: { type: "string", description: "Primeros caracteres del id para ver su bitácora." } } },
  riesgo: "lectura", requiereAprobacion: false, timeoutSeg: 20,
  async ejecutar(a) {
    if (a.id) {
      const [s] = await query(`SELECT * FROM pc_sesiones WHERE id::text LIKE $1 || '%' ORDER BY inicio DESC LIMIT 1`, [String(a.id)]);
      if (!s) return { ok: false, error: "No encuentro esa sesión." };
      const bit = await fs.readFile(path.join(s.carpeta || "", "bitacora.jsonl"), "utf-8").catch(() => "");
      const pasos = bit.split("\n").filter(Boolean).slice(-40).map((l) => { try { const p = JSON.parse(l); return `${p.n}. ${p.accion} ${p.input.slice(0, 100)} → ${p.ok ? "✔" : "✘"} ${p.resultado.slice(0, 100)}`; } catch { return ""; } }).join("\n");
      return { ok: true, datos: s, resumen: `${s.objetivo}\n${s.estado} · ${s.pasos} pasos · ${Number(s.costo_usd).toFixed(2)} USD · perfil ${s.perfil}\n${s.resumen || ""}${s.pregunta ? `\nPregunta: ${s.pregunta}` : ""}\n\nComandos: ${(s.comandos || []).map((c: any) => c.comando).join("; ") || "(ninguno)"}\n\nBitácora:\n${pasos || "(vacía)"}\n\n📁 ${s.carpeta}` };
    }
    const act = sesionesPcActivas();
    const xs = await query(`SELECT id, perfil, objetivo, estado, pasos, costo_usd, inicio FROM pc_sesiones ORDER BY inicio DESC LIMIT 15`);
    return { ok: true, datos: { activas: act, recientes: xs }, resumen: `${act.length ? `Corriendo ahora:\n${act.map((x) => `• ${x.id.slice(0, 8)} (${x.perfil}) ${x.objetivo.slice(0, 80)}`).join("\n")}\n\n` : ""}Recientes:\n${xs.map((x: any) => `• [${x.id.slice(0, 8)}] ${x.estado} · ${x.perfil} · ${x.objetivo.slice(0, 70)} · ${x.pasos} pasos · ${Number(x.costo_usd).toFixed(2)} USD`).join("\n") || "(ninguna)"}` };
  },
};

export const pcDetener: DefTool = {
  nombre: "pc_detener", modulo: MODULO,
  descripcion: "Detiene YA la sesión de uso del computador en curso (o una por id). Antes de la siguiente acción se para.",
  parametros: { type: "object", properties: { id: { type: "string", description: "Opcional: primeros caracteres del id; sin id detiene todas." } } },
  riesgo: "escritura", requiereAprobacion: false, timeoutSeg: 10,
  async ejecutar(a) { const n = detenerSesionPc(a.id); return { ok: true, resumen: n ? `🛑 Detengo ${n} sesión(es) antes de su siguiente acción.` : "No hay sesiones de uso del PC corriendo." }; },
};

export const toolsPcClaude = [pcPerfiles, pcPerfilGuardar, pcSesiones, pcDetener];
