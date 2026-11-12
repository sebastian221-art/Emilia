// ARCHIVO: src/rutas/interno.ts
// ─────────────────────────────────────────────────────────────────────────────
//  API INTERNA — solo para los procesos que lanza Emilia (Claude Code: su hook
//  de permisos y su servidor MCP). Exige el token interno (cambia en cada
//  arranque) y el panel solo escucha en 127.0.0.1: nada de esto sale a internet.
//   POST /api/interno/permiso  → ¿Claude Code puede usar esta herramienta?
//   GET  /api/interno/tools    → herramientas de Emilia que ve Claude Code
//   POST /api/interno/tool     → ejecutar una de ellas (con aprobación si aplica)
// ─────────────────────────────────────────────────────────────────────────────
import { Router, type Request, type Response, type NextFunction } from "express";
import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { registro } from "../registro/registro.js";
import { crearContexto, ejecutarTool } from "../motor/ejecutor.js";
import { decidirPermiso, describirAccion, pedirAprobacionYEsperar, type Modo } from "../motor/permisos-codigo.js";
import { tokenInterno, enLaboratorio } from "../motor/laboratorio.js";
import { obtenerSesion, logSesion } from "../dominio/proyectos.js";
import { SANDBOX_DIR } from "../motor/sandbox.js";

export const rutasInterno = Router();

function soloEmilia(req: Request, res: Response, next: NextFunction) {
  const dado = Buffer.from(String(req.header("x-emilia-token") || "")), real = Buffer.from(tokenInterno());
  if (dado.length !== real.length || !crypto.timingSafeEqual(dado, real)) return res.status(401).json({ error: "Token interno inválido." });
  next();
}
rutasInterno.use("/api/interno", soloEmilia);

async function datosSesion(id?: string) {
  if (!id) return { agenteId: null as string | null, conversacionId: null as string | null };
  const s: any = await obtenerSesion(id).catch(() => undefined);
  return { agenteId: s?.agente_id ?? null, conversacionId: s?.conversacion_id ?? null };
}

// ── Permisos ────────────────────────────────────────────────────────────────
rutasInterno.post("/api/interno/permiso", async (req, res) => {
  const { tool = "", input = {}, cwd = "", sesion, modo = "escritura", raices = [] } = req.body || {};
  const d = decidirPermiso({ tool, input, cwd, modo: modo as Modo, raices });
  if (d.decision !== "preguntar") {
    if (d.decision === "negar" && sesion) await logSesion(sesion, "permiso", `⛔ ${describirAccion(tool, input)} — ${d.motivo}`).catch(() => {});
    return res.json({ decision: d.decision === "permitir" ? "allow" : "deny", motivo: d.motivo });
  }
  const s = await datosSesion(sesion);
  if (sesion) await logSesion(sesion, "permiso", `🔐 pide permiso: ${describirAccion(tool, input)} (${d.motivo})`).catch(() => {});
  const r = await pedirAprobacionYEsperar({
    titulo: `Sage quiere ${d.motivo}`,
    detalle: `${describirAccion(tool, input)}\n📁 ${cwd}`,
    agenteId: s.agenteId, conversacionId: s.conversacionId,
  });
  if (sesion) await logSesion(sesion, "permiso", `${r.aprobada ? "✅" : "🛑"} ${r.motivo}`).catch(() => {});
  res.json({ decision: r.aprobada ? "allow" : "deny", motivo: r.aprobada ? "Aprobado por el jefe." : `No aprobado: ${r.motivo}. No lo intentes de otra forma; explícalo en tu informe.` });
});

// ── Herramientas de Emilia para Claude Code ─────────────────────────────────
const PROPIAS = [
  {
    name: "emilia_enviar_archivo",
    description: "Le manda al jefe por WhatsApp un archivo que creaste en el laboratorio (Word, Excel, PowerPoint, PDF, imagen, zip, código…), con un mensaje corto.",
    inputSchema: { type: "object", properties: { ruta: { type: "string", description: "Ruta del archivo (dentro del laboratorio)." }, mensaje: { type: "string", description: "Texto que acompaña el archivo." } }, required: ["ruta"] },
  },
  {
    name: "emilia_avisar",
    description: "Manda un aviso corto al jefe por WhatsApp. Solo para hitos importantes o cuando necesitas una decisión suya.",
    inputSchema: { type: "object", properties: { texto: { type: "string" } }, required: ["texto"] },
  },
];
// De Emilia: lo de solo lectura, más lo de conocimiento y el runtime de proyectos.
const EXTRA = new Set(["biblioteca_aportar", "biblioteca_usar", "conocimiento_guardar", "runtime_reiniciar", "runtime_detener", "runtime_iniciar", "publicar_proyecto"]);
const FUERA = /^(codigo_|pc_|grabacion_|navegador_|registro_|empresa_|sistema_(fallar|esperar|eco|accion_sensible)|flujo_|disparador_|aprender_laboratorio)/;
function expuestas() {
  return registro.tools().filter((t) => !FUERA.test(t.nombre) && (t.riesgo === "lectura" || EXTRA.has(t.nombre)));
}

rutasInterno.get("/api/interno/tools", (_req, res) => {
  res.json({ tools: [...PROPIAS, ...expuestas().map((t) => ({ name: t.nombre, description: `${t.descripcion}${t.requiereAprobacion ? " (pide aprobación al jefe)" : ""}`.slice(0, 1000), inputSchema: t.parametros }))] });
});

function textoAprobacion(nombre: string, a: any): { titulo: string; detalle: string } {
  if (nombre === "publicar_proyecto") return {
    titulo: "Sage quiere publicar un proyecto",
    detalle: [`📁 ${a.carpeta}`, `📦 GitHub: ${a.nombre || path.basename(String(a.carpeta || ""))} (${a.privado === false ? "PÚBLICO" : "privado"})`, a.desplegar === false ? "Solo GitHub, sin desplegar." : "🚂 Y desplegarlo en Railway con link público.", a.variables && Object.keys(a.variables).length ? `🔧 Variables: ${Object.keys(a.variables).join(", ")}` : ""].filter(Boolean).join("\n"),
  };
  return { titulo: `Sage quiere usar ${nombre}`, detalle: JSON.stringify(a).slice(0, 1200) };
}

const MIMES: Record<string, string> = { ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation", ".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".zip": "application/zip", ".csv": "text/csv", ".txt": "text/plain", ".md": "text/markdown", ".html": "text/html", ".json": "application/json" };

rutasInterno.post("/api/interno/tool", async (req, res) => {
  const { nombre = "", args = {}, sesion } = req.body || {};
  const s = await datosSesion(sesion);
  const jefe = process.env.WHATSAPP_NUMERO_JEFE || "";
  try {
    if (nombre === "emilia_avisar") {
      const { enviarTextoWhatsapp } = await import("../whatsapp/enviar.js");
      const r = await enviarTextoWhatsapp(jefe, `🛠 ${String(args.texto || "").slice(0, 1500)}`);
      return res.json(r.ok ? { ok: true, resumen: "Aviso enviado al jefe." } : { ok: false, error: r.error });
    }
    if (nombre === "emilia_enviar_archivo") {
      const ruta = path.resolve(String(args.ruta || ""));
      const sandboxes = path.resolve(SANDBOX_DIR).toLowerCase();
      if (!enLaboratorio(ruta) && !ruta.toLowerCase().startsWith(sandboxes + path.sep)) return res.json({ ok: false, error: "Solo se pueden enviar archivos del laboratorio." });
      const contenido = await fs.readFile(ruta);
      if (contenido.length > 90 * 1024 * 1024) return res.json({ ok: false, error: "El archivo pasa de 90 MB (límite de WhatsApp)." });
      const { guardarArchivo } = await import("../dominio/archivos.js");
      const arch = await guardarArchivo({ nombre: path.basename(ruta), mime: MIMES[path.extname(ruta).toLowerCase()] || "application/octet-stream", contenido, origen: "generado", conversacionId: s.conversacionId, agenteId: s.agenteId });
      const { enviarDocumentoWhatsapp } = await import("../whatsapp/enviar.js");
      const r = await enviarDocumentoWhatsapp(jefe, contenido, arch.nombre, arch.mime, String(args.mensaje || "").slice(0, 1000) || undefined);
      if (sesion) await logSesion(sesion, "archivo", `📎 enviado al jefe: ${path.basename(ruta)}`).catch(() => {});
      return res.json(r.ok ? { ok: true, resumen: `Archivo "${arch.nombre}" enviado al jefe (archivo_id ${arch.id}).` } : { ok: false, error: r.error });
    }
    const t = expuestas().find((x) => x.nombre === nombre);
    if (!t) return res.json({ ok: false, error: `La herramienta ${nombre} no está disponible para Claude Code.` });
    if (t.requiereAprobacion) {
      const ap = await pedirAprobacionYEsperar({ ...textoAprobacion(t.nombre, args), agenteId: s.agenteId, conversacionId: s.conversacionId });
      if (!ap.aprobada) return res.json({ ok: false, error: `No aprobado: ${ap.motivo}.` });
    }
    const ctx = crearContexto(s.agenteId, null, null, s.conversacionId);
    const r = await ejecutarTool(t.nombre, args, ctx);
    res.json(r);
  } catch (e: any) {
    res.json({ ok: false, error: e?.message || String(e) });
  }
});
