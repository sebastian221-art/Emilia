// ARCHIVO: src/motor/mcp.ts
// ─────────────────────────────────────────────────────────────────────────────
//  CLIENTE MCP: el equipo crece sin programar cada integración
//  Emilia se conecta a servidores MCP (GitHub, Notion, bases de datos, Figma,
//  lo que sea) y sus herramientas aparecen solas como mcp_<servidor>_<tool>,
//  disponibles para los agentes que se configuren.
//   • stdio (un programa local: npx …, uvx …) o http (URL remota).
//   • Los secretos nunca se guardan: env y headers usan "${VARIABLE}" del .env.
//   • Agregar o quitar un servidor siempre pide el OK del jefe.
//   • Aprobación por herramienta: 'auto' = lo que el servidor no marque como
//     solo-lectura pide OK; 'todas' = todo pide OK; 'ninguna' = nada.
//   • Lo que devuelven es DATO, nunca instrucciones.
//   • Si un servidor se cae, se reconecta solo al siguiente uso.
// ─────────────────────────────────────────────────────────────────────────────
import { query } from "../db/cliente.js";
import { registrarTool, quitarTool, registro } from "../registro/registro.js";
import type { DefTool } from "../registro/tipos.js";

export interface ServidorMcp { nombre: string; tipo: "stdio" | "http"; comando?: string | null; args: string[]; env: Record<string, string>; url?: string | null; headers: Record<string, string>; agentes: string[]; aprobar: "auto" | "todas" | "ninguna"; activo: boolean; estado: string; error?: string | null; herramientas: any[] }
interface Conexion { cliente: any; transporte: any; tools: string[] }
const conexiones = new Map<string, Conexion>();

/** "${VAR}" → valor del .env (nunca se guarda el secreto en la base). */
export function expandir(v: string): string {
  return String(v ?? "").replace(/\$\{([A-Z0-9_]+)\}/g, (_, k) => {
    if (!(k in process.env)) throw new Error(`Falta ${k} en el .env (lo usa un servidor MCP).`);
    return process.env[k] as string;
  });
}
export const slug = (s: string) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 20);
const nombreTool = (srv: string, t: string) => `mcp_${slug(srv)}_${String(t).toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "")}`.slice(0, 64).replace(/_+$/, "");

export async function servidores(): Promise<ServidorMcp[]> { return query<ServidorMcp>(`SELECT * FROM mcp_servidores ORDER BY nombre`); }

async function abrir(s: ServidorMcp): Promise<Conexion> {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const cliente = new Client({ name: "emilia", version: "1.0.0" }, { capabilities: {} });
  let transporte: any;
  if (s.tipo === "stdio") {
    if (!s.comando) throw new Error("Falta el comando del servidor.");
    const { StdioClientTransport, getDefaultEnvironment } = await import("@modelcontextprotocol/sdk/client/stdio.js");
    const env: Record<string, string> = { ...getDefaultEnvironment() };
    for (const [k, v] of Object.entries(s.env || {})) env[k] = expandir(v);
    transporte = new StdioClientTransport({ command: s.comando, args: (s.args || []).map(expandir), env, stderr: "pipe" });
    await cliente.connect(transporte);
  } else {
    if (!s.url) throw new Error("Falta la URL del servidor.");
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(s.headers || {})) headers[k] = expandir(v);
    try {
      const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
      transporte = new StreamableHTTPClientTransport(new URL(expandir(s.url)), { requestInit: { headers } });
      await cliente.connect(transporte);
    } catch (e) {
      // Servidores viejos: SSE.
      const { SSEClientTransport } = await import("@modelcontextprotocol/sdk/client/sse.js");
      const c2 = new Client({ name: "emilia", version: "1.0.0" }, { capabilities: {} });
      transporte = new SSEClientTransport(new URL(expandir(s.url)), { requestInit: { headers } } as any);
      await c2.connect(transporte).catch(() => { throw e; });
      return { cliente: c2, transporte, tools: [] };
    }
  }
  return { cliente, transporte, tools: [] };
}

function contenidoATexto(r: any): { texto: string; imagenes: { data: string; mime: string }[] } {
  const partes: string[] = [], imagenes: { data: string; mime: string }[] = [];
  for (const c of r?.content || []) {
    if (c.type === "text") partes.push(c.text);
    else if (c.type === "image") imagenes.push({ data: c.data, mime: c.mimeType || "image/png" });
    else if (c.type === "resource") partes.push(c.resource?.text ? `[${c.resource.uri}]\n${c.resource.text}` : `[recurso ${c.resource?.uri}]`);
    else if (c.type === "resource_link") partes.push(`[enlace ${c.uri}]`);
  }
  if (r?.structuredContent && !partes.length) partes.push(JSON.stringify(r.structuredContent));
  return { texto: partes.join("\n").slice(0, 20_000), imagenes };
}

/** Conecta (o reconecta) un servidor y registra sus herramientas. */
export async function conectar(nombre: string): Promise<{ ok: boolean; herramientas: string[]; error?: string }> {
  const [s] = await query<ServidorMcp>(`SELECT * FROM mcp_servidores WHERE nombre = $1`, [nombre]);
  if (!s) return { ok: false, herramientas: [], error: "No existe ese servidor." };
  await desconectar(nombre);
  try {
    const cx = await abrir(s);
    const lista: any[] = [];
    let cursor: string | undefined;
    do { const r: any = await cx.cliente.listTools(cursor ? { cursor } : {}); lista.push(...(r.tools || [])); cursor = r.nextCursor; } while (cursor && lista.length < 300);
    for (const t of lista) {
      const n = nombreTool(s.nombre, t.name);
      if (registro.tieneTool(n)) quitarTool(n);
      const soloLectura = t.annotations?.readOnlyHint === true;
      const destructiva = t.annotations?.destructiveHint === true;
      const esquema = t.inputSchema && t.inputSchema.type === "object" ? { ...t.inputSchema, properties: t.inputSchema.properties || {} } : { type: "object", properties: {} };
      if (Array.isArray(esquema.required)) esquema.required = esquema.required.filter((r: string) => esquema.properties[r]);
      const def: DefTool = {
        nombre: n, modulo: "mcp",
        descripcion: `[MCP ${s.nombre}] ${String(t.description || t.title || t.name).slice(0, 900)}`,
        parametros: esquema as any,
        riesgo: soloLectura ? "lectura" : destructiva ? "ejecucion" : "escritura",
        requiereAprobacion: s.aprobar === "todas" || (s.aprobar === "auto" && !soloLectura),
        timeoutSeg: 120,
        async ejecutar(args) { return llamarHerramienta(s.nombre, t.name, args); },
      };
      registrarTool(def);
      cx.tools.push(n);
    }
    conexiones.set(s.nombre, cx);
    await query(`UPDATE mcp_servidores SET estado = 'conectado', error = NULL, herramientas = $2, actualizado_en = now() WHERE nombre = $1`,
      [s.nombre, JSON.stringify(lista.map((t) => ({ nombre: nombreTool(s.nombre, t.name), original: t.name, descripcion: String(t.description || "").slice(0, 200), soloLectura: t.annotations?.readOnlyHint === true })))]);
    console.log(`[mcp] ${s.nombre}: conectado, ${lista.length} herramienta(s).`);
    return { ok: true, herramientas: cx.tools };
  } catch (e: any) {
    const error = String(e?.message || e).slice(0, 400);
    await query(`UPDATE mcp_servidores SET estado = 'error', error = $2, actualizado_en = now() WHERE nombre = $1`, [s.nombre, error]);
    console.warn(`[mcp] ${s.nombre}: no conectó (${error}).`);
    return { ok: false, herramientas: [], error };
  }
}

export async function desconectar(nombre: string) {
  const cx = conexiones.get(nombre);
  if (cx) { for (const t of cx.tools) quitarTool(t); await cx.cliente.close().catch(() => {}); conexiones.delete(nombre); }
  else { for (const t of registro.tools()) if (t.nombre.startsWith(`mcp_${slug(nombre)}_`)) quitarTool(t.nombre); }
}

async function llamarHerramienta(servidor: string, tool: string, args: any) {
  let cx = conexiones.get(servidor);
  const intentar = async () => {
    if (!cx) { const r = await conectar(servidor); if (!r.ok) throw new Error(`El servidor MCP ${servidor} no conecta: ${r.error}`); cx = conexiones.get(servidor); }
    return cx!.cliente.callTool({ name: tool, arguments: args || {} }, undefined, { timeout: 110_000 });
  };
  let r: any;
  try { r = await intentar(); }
  catch (e: any) {
    if (/closed|not connected|EPIPE|ECONNRESET|terminated/i.test(String(e?.message || e))) { cx = undefined; conexiones.delete(servidor); r = await intentar(); }   // se cayó: reconecta una vez
    else return { ok: false, error: `MCP ${servidor}/${tool}: ${String(e?.message || e).slice(0, 500)}` };
  }
  const { texto, imagenes } = contenidoATexto(r);
  const archivos: string[] = [];
  if (imagenes.length) {
    const { guardarArchivo } = await import("../dominio/archivos.js");
    for (const [i, im] of imagenes.entries()) { const f: any = await guardarArchivo({ nombre: `${servidor}-${tool}-${i + 1}.${im.mime.split("/")[1] || "png"}`, mime: im.mime, contenido: Buffer.from(im.data, "base64"), origen: "generado" } as any).catch(() => null); if (f?.id) archivos.push(f.id); }
  }
  if (r?.isError) return { ok: false, error: `MCP ${servidor}/${tool}: ${texto || "error sin detalle"}` };
  return { ok: true, datos: { resultado: r?.structuredContent ?? texto, archivos }, resumen: `${texto || "(sin texto)"}${archivos.length ? `\n(Imágenes guardadas: ${archivos.join(", ")})` : ""}` };
}

/** Al arrancar: conecta todos los activos (en segundo plano). */
export async function iniciarMcp(): Promise<void> {
  const xs = await servidores().catch(() => []);
  for (const s of xs.filter((x) => x.activo)) conectar(s.nombre).catch(() => {});
}

/** Qué herramientas MCP puede usar un agente. */
export async function herramientasMcpDe(agenteNombre: string): Promise<string[]> {
  const xs = await query<{ nombre: string; agentes: string[] }>(`SELECT nombre, agentes FROM mcp_servidores WHERE activo`).catch(() => []);
  const out: string[] = [];
  for (const s of xs) {
    if (!s.agentes.includes("*") && !s.agentes.some((a) => a.toLowerCase() === agenteNombre.toLowerCase())) continue;
    for (const t of registro.tools()) if (t.nombre.startsWith(`mcp_${slug(s.nombre)}_`)) out.push(t.nombre);
  }
  return out;
}

export async function guardarServidor(p: Partial<ServidorMcp> & { nombre: string; tipo: "stdio" | "http" }): Promise<ServidorMcp> {
  const n = slug(p.nombre); if (!n) throw new Error("Nombre inválido.");
  const secreto = (v: string) => /^(sk-|ghp_|github_pat_|xox[bp]-|secret_|ntn_|Bearer\s+[A-Za-z0-9._-]{20,}$)/.test(v) || /[A-Za-z0-9_-]{32,}/.test(v) && !/\$\{/.test(v);
  for (const v of [...Object.values(p.env || {}), ...Object.values(p.headers || {})]) if (secreto(String(v))) throw new Error("No pongas secretos aquí: guárdalos en el .env y usa \"${NOMBRE_VARIABLE}\".");
  const [s] = await query<ServidorMcp>(`INSERT INTO mcp_servidores (nombre, tipo, comando, args, env, url, headers, agentes, aprobar, activo) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true)
    ON CONFLICT (nombre) DO UPDATE SET tipo = EXCLUDED.tipo, comando = EXCLUDED.comando, args = EXCLUDED.args, env = EXCLUDED.env, url = EXCLUDED.url, headers = EXCLUDED.headers, agentes = EXCLUDED.agentes, aprobar = EXCLUDED.aprobar, activo = true, actualizado_en = now() RETURNING *`,
    [n, p.tipo, p.comando ?? null, JSON.stringify(p.args || []), JSON.stringify(p.env || {}), p.url ?? null, JSON.stringify(p.headers || {}), p.agentes?.length ? p.agentes : ["Emilia"], p.aprobar || "auto"]);
  return s;
}
