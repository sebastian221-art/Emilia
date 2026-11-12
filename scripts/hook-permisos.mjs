// ARCHIVO: scripts/hook-permisos.mjs
// ─────────────────────────────────────────────────────────────────────────────
//  Hook PreToolUse de Claude Code (lo configura src/motor/laboratorio.ts).
//  Antes de CADA herramienta le pregunta a Emilia si se permite, se niega o
//  hay que preguntarle al jefe por WhatsApp (en ese caso espera la respuesta).
//  Sin dependencias: Node puro. Si Emilia no responde, solo deja leer.
// ─────────────────────────────────────────────────────────────────────────────
const LECTURA = new Set(["Read", "Grep", "Glob", "LS", "NotebookRead", "TodoWrite", "TodoRead", "WebFetch", "WebSearch", "BashOutput"]);

function responder(permitir, motivo) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: permitir ? "allow" : "deny", permissionDecisionReason: motivo },
  }));
  process.exit(0);
}

let entrada = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => (entrada += d));
process.stdin.on("end", async () => {
  let ev = {};
  try { ev = JSON.parse(entrada || "{}"); } catch { /* evento ilegible */ }
  const tool = ev.tool_name || "";
  const url = process.env.EMILIA_URL, token = process.env.EMILIA_TOKEN;
  if (!url || !token) return responder(LECTURA.has(tool), "Emilia no configuró el control de permisos: solo lectura.");
  try {
    const espera = (Number(process.env.PERMISO_ESPERA_SEG) || 900) + 30;
    const r = await fetch(`${url}/api/interno/permiso`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-emilia-token": token },
      body: JSON.stringify({ tool, input: ev.tool_input, cwd: ev.cwd || process.cwd(), sesion: process.env.EMILIA_SESION, modo: process.env.EMILIA_MODO || "escritura", raices: (process.env.EMILIA_RAICES || "").split("|").filter(Boolean) }),
      signal: AbortSignal.timeout(espera * 1000),
    });
    const d = await r.json();
    return responder(d.decision === "allow", d.motivo || "");
  } catch (e) {
    return responder(LECTURA.has(tool), `Emilia no respondió (${e?.message || e}): solo se permite leer.`);
  }
});
