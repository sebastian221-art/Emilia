// ARCHIVO: src/scripts/probar-codigo.ts
// Prueba de la Fase 7.1 con Claude Code real, usando ESTE repo como proyecto:
//   npx tsx src/scripts/probar-codigo.ts
// Registra el proyecto 'emilia' (cwd), abre un sandbox, le pide a Claude Code
// una tarea trivial, verifica el diff y cierra el sandbox (conserva la rama).

import "dotenv/config";
import { iniciarRegistro } from "../registro/cargar.js";
import { ejecutarTool, crearContexto } from "../motor/ejecutor.js";
import { db } from "../db/cliente.js";

function ok(cond: boolean, msg: string) { console.log(`${cond ? "✔" : "✘"} ${msg}`); if (!cond) process.exitCode = 1; }

async function main() {
  await iniciarRegistro();
  const ctx = crearContexto(null, null);

  const reg = await ejecutarTool("codigo_registrar_proyecto", { nombre: "emilia", ruta: process.cwd(), rama_base: "main", cmd_build: "npx tsc --noEmit -p ." }, ctx);
  ok(reg.ok, `registrar proyecto: ${reg.resumen || reg.error}`);

  const sb = await ejecutarTool("codigo_abrir_sandbox", { proyecto: "emilia", proposito: "prueba fase 7" }, ctx);
  ok(sb.ok, `abrir sandbox: ${sb.resumen || sb.error}`);
  if (!sb.ok) { await db.end(); return; }
  const sandbox_id = (sb.datos as any).sandbox_id;

  console.log("\nLanzando Claude Code (tarea trivial)…");
  const cc = await ejecutarTool("codigo_ejecutar_claude", {
    sandbox_id,
    encargo: "Creá un archivo llamado HOLA_SENIOR.md en la raíz del proyecto con una sola línea: 'Hola desde el Senior Developer'. No toques nada más. Cuando termines, decí en una línea qué hiciste.",
    contexto: "Sos un ingeniero senior trabajando en un sandbox aislado. Hacé exactamente lo pedido, sin extras.",
    max_turnos: 10, esperar: true, timeout_seg: 300,
  }, ctx);
  ok(cc.ok, `claude code: ${(cc.resumen || cc.error || "").slice(0, 300)}`);

  const d = await ejecutarTool("codigo_diff", { sandbox_id }, ctx);
  ok(d.ok && ((d.datos as any).archivos || []).some((a: string) => a.includes("HOLA_SENIOR.md")), `el diff muestra HOLA_SENIOR.md (archivos: ${((d.datos as any)?.archivos || []).join(", ")})`);

  const est = await ejecutarTool("codigo_git_estado", { sandbox_id }, ctx);
  ok(est.ok, `git estado: rama ${(est.datos as any)?.rama}`);

  const cierre = await ejecutarTool("codigo_cerrar_sandbox", { sandbox_id, borrar_rama: true }, ctx);
  ok(cierre.ok, `cerrar sandbox: ${cierre.resumen || cierre.error}`);

  await db.end();
  console.log(process.exitCode ? "\nHubo fallos." : "\nFase 7.1 OK.");
}
main().catch((e) => { console.error(e); process.exit(1); });