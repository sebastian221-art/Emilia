// ARCHIVO: src/registro/probar.ts
// Prueba rápida de la Fase 1 sin servidor ni modelo:
//   npx tsx src/registro/probar.ts
// Verifica: carga del registro, sincronización a la base, validación de
// argumentos, ejecución de tools, permisos de skills y timeout.

import "dotenv/config";
import { iniciarRegistro } from "./cargar.js";
import { registro, validarArgs } from "./registro.js";
import { ejecutarTool, ejecutarSkill, crearContexto } from "../motor/ejecutor.js";
import { db } from "../db/cliente.js";

function ok(cond: boolean, msg: string) { console.log(`${cond ? "✔" : "✘"} ${msg}`); if (!cond) process.exitCode = 1; }

async function main() {
  await iniciarRegistro();
  const ctx = crearContexto(null, null);

  console.log("\n── Validación de argumentos ──");
  const v1 = validarArgs(registro.tool("sistema_eco")!.parametros, {});
  ok(!v1.ok && v1.errores[0].includes("obligatorio"), "falta 'texto' → error claro");
  const v2 = validarArgs(registro.tool("sistema_esperar")!.parametros, { segundos: "3" });
  ok(v2.ok && v2.valor.segundos === 3, "'3' como string se convierte a número 3");
  const v3 = validarArgs(registro.tool("sistema_esperar")!.parametros, { segundos: 999 });
  ok(!v3.ok, "999 segundos → rechazado por máximo");
  const v4 = validarArgs(registro.tool("sistema_fallar")!.parametros, {});
  ok(v4.ok && v4.valor.modo === "error", "defaults se aplican (modo='error')");

  console.log("\n── Ejecución de tools ──");
  const eco = await ejecutarTool("sistema_eco", { texto: "hola" }, ctx);
  ok(eco.ok && (eco.datos as any).texto === "hola", "sistema_eco devuelve el texto");
  const ahora = await ejecutarTool("sistema_ahora", {}, ctx);
  ok(ahora.ok && !!(ahora.datos as any).iso, "sistema_ahora devuelve fecha");
  const fallo = await ejecutarTool("sistema_fallar", { modo: "excepcion", mensaje: "boom" }, ctx);
  ok(!fallo.ok && fallo.error!.includes("boom"), "excepción se captura como {ok:false}");
  const nada = await ejecutarTool("no_existe", {}, ctx);
  ok(!nada.ok && nada.error!.includes("no existe"), "tool inexistente → error con lista de disponibles");
  const malos = await ejecutarTool("sistema_eco", { texto: 123 }, ctx);
  ok(malos.ok, "número se tolera como texto");

  console.log("\n── Skills ──");
  const diag = await ejecutarSkill("sistema_diagnostico", { incluir_espera: false }, ctx);
  ok(diag.ok, "sistema_diagnostico corre y usa sus tools");
  console.log("   " + (diag.resumen || "").replace(/\n/g, "\n   "));

  // Permisos: una skill NO puede invocar tools fuera de su lista.
  const ctxRestringido = crearContexto(null, null, ["sistema_eco"]);
  const prohibida = await ctxRestringido.ejecutarTool("sistema_ahora", {});
  ok(!prohibida.ok && prohibida.error!.includes("permiso"), "skill restringida no puede llamar tools fuera de su lista");

  console.log("\n── Base sincronizada ──");
  const filas = await db.query(`SELECT nombre, origen, riesgo, requiere_aprobacion, activo FROM tools WHERE origen='codigo' ORDER BY nombre`);
  ok(filas.rows.length === registro.tools().length, `tools en base con origen=codigo: ${filas.rows.length}`);
  for (const f of filas.rows) console.log(`   ${f.nombre} · ${f.riesgo} · aprobación=${f.requiere_aprobacion}`);

  await db.end();
  console.log(process.exitCode ? "\nHubo fallos." : "\nFase 1 OK.");
}

main().catch((e) => { console.error(e); process.exit(1); });