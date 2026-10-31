// ARCHIVO: src/scripts/probar-claude.ts
// Verifica que la API de Claude está activa y que el relevo de cerebros funciona.
//    npx tsx src/scripts/probar-claude.ts
import "dotenv/config";
import { llamarModelo } from "../motor/groq.js";

async function main() {
  const key = process.env.ANTHROPIC_API_KEY;
  console.log(`ANTHROPIC_API_KEY: ${key ? `presente (${key.slice(0, 10)}…)` : "FALTA en .env"}`);
  console.log(`CLAUDE_API_ACTIVA: ${process.env.CLAUDE_API_ACTIVA || "(no definida → activa)"}`);
  console.log(`ANTHROPIC_WORKSPACE_ID: ${process.env.ANTHROPIC_WORKSPACE_ID || "(no definida)"}`);
  if (!key) process.exit(1);
  for (const modelo of ["claude:haiku", "claude:sonnet"]) {
    const t0 = Date.now();
    try {
      const r = await llamarModelo([{ role: "system", content: "Respondé en una sola línea, en español." }, { role: "user", content: `Decime qué modelo sos y saludá a Sebastián.` }], [], { modelo, temperatura: 0.3 });
      console.log(`✅ ${modelo} (${Date.now() - t0} ms): ${r.texto.slice(0, 160)}`);
    } catch (e: any) {
      console.log(`❌ ${modelo}: ${e?.status || ""} ${e?.message?.slice(0, 300)}`);
      if (/401|authentication/i.test(String(e?.message))) console.log("   → la clave no es válida o no es de la API (console.anthropic.com → API keys).");
      if (/404|not_found/i.test(String(e?.message))) console.log("   → ese id de modelo no existe para tu cuenta; cambiá el alias en src/motor/anthropic.ts.");
      if (/credit|billing|402/i.test(String(e?.message))) console.log("   → sin crédito: cargá saldo en console.anthropic.com → Billing.");
      if (/workspace/i.test(String(e?.message))) console.log("   → tu clave es de usuario (sk-ant-usr…), no de workspace. Opción A: en console.anthropic.com → Settings → Workspaces, copiá el ID del workspace (wrkspc_…) y ponelo en .env como ANTHROPIC_WORKSPACE_ID. Opción B: creá una API key dentro del workspace (Settings → API Keys → Create Key, eligiendo el workspace) y usá esa.");
    }
  }
  // Tool call de prueba (el relevo necesita que Claude llame herramientas en formato OpenAI)
  try {
    const r = await llamarModelo([{ role: "user", content: "¿Qué hora es? Usá la herramienta." }], [{ type: "function", function: { name: "sistema_ahora", description: "Hora actual", parameters: { type: "object", properties: {} } } }], { modelo: "claude:haiku" });
    console.log(r.toolCalls.length ? `✅ tool calls OK (${r.toolCalls[0].nombre})` : `⚠️ no llamó la tool: "${r.texto.slice(0, 100)}"`);
  } catch (e: any) { console.log(`❌ tool call: ${e?.message?.slice(0, 200)}`); }
  process.exit(0);
}
main();