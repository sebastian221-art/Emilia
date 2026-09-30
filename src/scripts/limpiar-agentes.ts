// ARCHIVO: src/scripts/limpiar-agentes.ts
// Borra agentes (y sus puestos, conversaciones, ejecuciones) para empezar
// limpio. Por defecto conserva a Emilia. Pide confirmación con --si.
//   npx tsx src/scripts/limpiar-agentes.ts            → muestra qué borraría
//   npx tsx src/scripts/limpiar-agentes.ts --si       → borra todos menos Emilia
//   npx tsx src/scripts/limpiar-agentes.ts --si --conservar "Emilia,Echo"
import "dotenv/config";
import { db, query } from "../db/cliente.js";
import { cancelarFlujo, flujosActivos } from "../motor/flujo.js";

async function main() {
  const args = process.argv.slice(2);
  const confirmar = args.includes("--si");
  const i = args.indexOf("--conservar");
  const conservar = (i >= 0 && args[i + 1] ? args[i + 1] : "Emilia").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const todos = await query<{ id: string; nombre: string }>(`SELECT id, nombre FROM agentes ORDER BY creado_en`);
  const aBorrar = todos.filter((a) => !conservar.includes(a.nombre.toLowerCase()));
  if (!aBorrar.length) { console.log(`Nada que borrar. Agentes: ${todos.map((a) => a.nombre).join(", ")}`); await db.end(); return; }
  console.log(`Conservo: ${todos.filter((a) => conservar.includes(a.nombre.toLowerCase())).map((a) => a.nombre).join(", ") || "(ninguno)"}`);
  console.log(`Voy a borrar: ${aBorrar.map((a) => a.nombre).join(", ")}`);
  if (!confirmar) { console.log("\nNada se borró. Repetí con --si para hacerlo de verdad."); await db.end(); return; }

  const ids = aBorrar.map((a) => a.id);
  for (const f of await flujosActivos()) { const [d] = await query<{ agente_id: string }>(`SELECT agente_id FROM flujo_ejecuciones WHERE id=$1`, [f.id]); if (d && ids.includes(d.agente_id)) await cancelarFlujo(f.id, "Agente eliminado.").catch(() => {}); }
  await query(`DELETE FROM puestos WHERE agente_id = ANY($1::uuid[])`, [ids]);
  await query(`DELETE FROM aprobaciones WHERE agente_id = ANY($1::uuid[])`, [ids]).catch(() => {});
  await query(`DELETE FROM canal_dueno WHERE agente_id = ANY($1::uuid[])`, [ids]).catch(() => {});
  await query(`DELETE FROM agentes WHERE id = ANY($1::uuid[])`, [ids]);
  console.log(`\n✔ Borrados ${ids.length} agente(s). Quedan: ${(await query<{ nombre: string }>(`SELECT nombre FROM agentes ORDER BY creado_en`)).map((a) => a.nombre).join(", ")}`);
  await db.end();
}
main().catch((e) => { console.error(e); process.exit(1); });