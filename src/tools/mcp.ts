// ARCHIVO: src/tools/mcp.ts
// ─────────────────────────────────────────────────────────────────────────────
//  SERVIDORES MCP: ver, agregar (con OK), quitar (con OK) y reconectar.
//  Las herramientas de cada servidor aparecen solas como mcp_<servidor>_<tool>.
// ─────────────────────────────────────────────────────────────────────────────
import type { DefTool } from "../registro/tipos.js";
import * as M from "../motor/mcp.js";

const MODULO = "mcp";

export const mcpServidores: DefTool = {
  nombre: "mcp_servidores", modulo: MODULO,
  descripcion: "Los servidores MCP conectados (GitHub, Notion, bases de datos…), su estado, a qué agentes se les dio y sus herramientas (mcp_<servidor>_<tool>).",
  parametros: { type: "object", properties: { servidor: { type: "string" } } },
  riesgo: "lectura", requiereAprobacion: false, timeoutSeg: 15,
  async ejecutar(a) {
    const xs = (await M.servidores()).filter((s) => !a.servidor || s.nombre === M.slug(a.servidor));
    if (!xs.length) return { ok: true, datos: [], resumen: "No hay servidores MCP. Para agregar uno: mcp_agregar (con su comando o URL)." };
    const ic: Record<string, string> = { conectado: "🟢", error: "🔴", desconectado: "⚪" };
    return { ok: true, datos: xs, resumen: xs.map((s) => `${ic[s.estado] || "⚪"} *${s.nombre}* (${s.tipo}${s.tipo === "stdio" ? `: ${s.comando} ${s.args.join(" ")}` : `: ${s.url}`}) · para ${s.agentes.join(", ")} · aprobación ${s.aprobar}${s.error ? `\n   error: ${s.error}` : ""}\n   ${s.herramientas.length} herramienta(s)${a.servidor ? `:\n${s.herramientas.map((t: any) => `   - ${t.nombre}${t.soloLectura ? " (lectura)" : ""}: ${t.descripcion}`).join("\n")}` : ""}`).join("\n") };
  },
};

const vista = (a: Record<string, any>) => [`⏸ *¿Conecto este servidor MCP?*`, `Nombre: *${M.slug(a.nombre)}*`,
  a.tipo === "stdio" ? `Programa en tu PC: \`${a.comando} ${(a.args || []).join(" ")}\`` : `URL: ${a.url}`,
  Object.keys(a.env || {}).length ? `Variables: ${Object.entries(a.env).map(([k, v]) => `${k}=${v}`).join(", ")}` : "",
  `Lo podrán usar: ${(a.agentes || ["Emilia"]).join(", ")} · aprobación: ${a.aprobar || "auto"} (${(a.aprobar || "auto") === "auto" ? "lo que no sea solo-lectura te pide OK" : a.aprobar === "todas" ? "todo te pide OK" : "nada pide OK"})`,
  a.motivo ? `Para qué: ${a.motivo}` : "",
  a.tipo === "stdio" ? "⚠️ Es un programa que corre en tu PC: conéctalo solo si es de una fuente confiable (Soga puede auditarlo antes)." : "",
  `Responde *ok* para conectarlo o *no*.`].filter(Boolean).join("\n");

export const mcpAgregar: DefTool = {
  nombre: "mcp_agregar", modulo: MODULO,
  descripcion: "Conecta un servidor MCP nuevo (pide el OK del jefe). stdio: comando + args (ej. npx -y @modelcontextprotocol/server-github); http: url. Los secretos van en el .env y aquí se referencian como \"${VARIABLE}\" en env o headers. agentes: quién lo puede usar ('*' = todos). aprobar: auto (por defecto), todas, ninguna.",
  parametros: { type: "object", properties: {
    nombre: { type: "string", minLength: 2 }, tipo: { type: "string", enum: ["stdio", "http"] },
    comando: { type: "string" }, args: { type: "array", items: { type: "string" } }, env: { type: "object" },
    url: { type: "string" }, headers: { type: "object" },
    agentes: { type: "array", items: { type: "string" } }, aprobar: { type: "string", enum: ["auto", "todas", "ninguna"] }, motivo: { type: "string" },
  }, required: ["nombre", "tipo"] },
  riesgo: "ejecucion", requiereAprobacion: true, timeoutSeg: 120,
  async vistaAprobacion(a) { return vista(a); },
  async ejecutar(a) {
    try {
      const s = await M.guardarServidor({ nombre: a.nombre, tipo: a.tipo, comando: a.comando, args: a.args, env: a.env, url: a.url, headers: a.headers, agentes: a.agentes, aprobar: a.aprobar });
      const r = await M.conectar(s.nombre);
      return r.ok ? { ok: true, datos: r, resumen: `🟢 ${s.nombre} conectado: ${r.herramientas.length} herramienta(s) para ${s.agentes.join(", ")}.\n${r.herramientas.slice(0, 25).join(", ")}` } : { ok: false, error: `Quedó guardado pero no conecta: ${r.error}` };
    } catch (e: any) { return { ok: false, error: e?.message || String(e) }; }
  },
};

export const mcpQuitar: DefTool = {
  nombre: "mcp_quitar", modulo: MODULO,
  descripcion: "Desconecta y desactiva un servidor MCP (sus herramientas desaparecen). Pide el OK del jefe.",
  parametros: { type: "object", properties: { nombre: { type: "string", minLength: 2 } }, required: ["nombre"] },
  riesgo: "escritura", requiereAprobacion: true, timeoutSeg: 30,
  async ejecutar(a) {
    const { query } = await import("../db/cliente.js");
    const n = M.slug(a.nombre); await M.desconectar(n);
    const r = await query(`UPDATE mcp_servidores SET activo = false, estado = 'desconectado', actualizado_en = now() WHERE nombre = $1 RETURNING nombre`, [n]);
    return r.length ? { ok: true, resumen: `⚪ ${n} desconectado.` } : { ok: false, error: "No existe ese servidor." };
  },
};

export const mcpRecargar: DefTool = {
  nombre: "mcp_recargar", modulo: MODULO,
  descripcion: "Reconecta un servidor MCP (o todos) y vuelve a leer sus herramientas.",
  parametros: { type: "object", properties: { nombre: { type: "string" } } },
  riesgo: "lectura", requiereAprobacion: false, timeoutSeg: 120,
  async ejecutar(a) {
    const xs = a.nombre ? [M.slug(a.nombre)] : (await M.servidores()).filter((s) => s.activo).map((s) => s.nombre);
    const out: string[] = [];
    for (const n of xs) { const r = await M.conectar(n); out.push(r.ok ? `🟢 ${n}: ${r.herramientas.length} herramienta(s)` : `🔴 ${n}: ${r.error}`); }
    return { ok: true, resumen: out.join("\n") || "No hay servidores." };
  },
};

export const toolsMcp: DefTool[] = [mcpServidores, mcpAgregar, mcpQuitar, mcpRecargar];
