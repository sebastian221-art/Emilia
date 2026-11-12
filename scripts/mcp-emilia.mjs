// ARCHIVO: scripts/mcp-emilia.mjs
// ─────────────────────────────────────────────────────────────────────────────
//  Servidor MCP "emilia" para Claude Code (stdio, JSON-RPC 2.0, Node puro).
//  Le da a Claude Code las herramientas de Emilia: mandarle archivos al jefe por
//  WhatsApp, avisos, la biblioteca y las tools de lectura del resto del sistema.
//  Cada llamada va a Emilia (/api/interno/tool), que aplica sus aprobaciones.
// ─────────────────────────────────────────────────────────────────────────────
import readline from "node:readline";

const URL_EMILIA = process.env.EMILIA_URL, TOKEN = process.env.EMILIA_TOKEN;

async function emilia(ruta, cuerpo) {
  const r = await fetch(`${URL_EMILIA}${ruta}`, {
    method: cuerpo ? "POST" : "GET",
    headers: { "Content-Type": "application/json", "x-emilia-token": TOKEN || "" },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    signal: AbortSignal.timeout(((Number(process.env.PERMISO_ESPERA_SEG) || 900) + 1500) * 1000),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
  return d;
}

const enviar = (msg) => process.stdout.write(JSON.stringify(msg) + "\n");
const ok = (id, result) => enviar({ jsonrpc: "2.0", id, result });
const mal = (id, code, message) => enviar({ jsonrpc: "2.0", id, error: { code, message } });

async function atender(m) {
  const { id, method, params = {} } = m;
  if (method === "initialize") return ok(id, { protocolVersion: params.protocolVersion || "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "emilia", version: "1.0.0" } });
  if (method === "ping") return ok(id, {});
  if (method === "tools/list") {
    try { const d = await emilia("/api/interno/tools"); return ok(id, { tools: d.tools }); }
    catch (e) { return ok(id, { tools: [] }); }
  }
  if (method === "tools/call") {
    try {
      const d = await emilia("/api/interno/tool", { nombre: params.name, args: params.arguments || {}, sesion: process.env.EMILIA_SESION });
      const texto = d.ok ? (d.resumen || JSON.stringify(d.datos ?? "listo").slice(0, 20000)) : `Error: ${d.error}`;
      return ok(id, { content: [{ type: "text", text: texto }], isError: !d.ok });
    } catch (e) { return ok(id, { content: [{ type: "text", text: `Error: ${e?.message || e}` }], isError: true }); }
  }
  if (id !== undefined && id !== null) return mal(id, -32601, `Método no soportado: ${method}`);
}

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (linea) => {
  if (!linea.trim()) return;
  let m; try { m = JSON.parse(linea); } catch { return; }
  atender(m).catch((e) => m.id != null && mal(m.id, -32603, String(e?.message || e)));
});
