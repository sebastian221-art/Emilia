// ARCHIVO: src/flujos/probar.ts
// Prueba del motor de flujos sin servidor ni modelo:
//   npx tsx src/flujos/probar.ts
// Corre sistema_prueba_completa, aprueba las dos pausas (aprobación explícita
// y tool sensible) y verifica que termine completado con las iteraciones justas.

import "dotenv/config";
import { iniciarRegistro } from "../registro/cargar.js";
import { iniciarFlujo, reanudarFlujo } from "../motor/flujo.js";
import { db, query } from "../db/cliente.js";

function ok(cond: boolean, msg: string) { console.log(`${cond ? "✔" : "✘"} ${msg}`); if (!cond) process.exitCode = 1; }
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  await iniciarRegistro();

  console.log("\n── Sub-flujo solo ──");
  const h = await iniciarFlujo("sistema_hora", {});
  ok(h.estado === "completado" && !!(h.resultado as any)?.iso, `sistema_hora completado: ${(h.resultado as any)?.legible}`);

  console.log("\n── Flujo completo ──");
  let r = await iniciarFlujo("sistema_prueba_completa", { veces: 3, espera: 1 });
  await dormir(300); // el sub-flujo continúa al padre de forma asíncrona
  let [ej] = await query<any>(`SELECT * FROM flujo_ejecuciones WHERE id=$1`, [r.ejecucionId]);
  ok(ej.estado === "esperando_aprobacion" && ej.nodo_actual === "aprobar", `pausó en 'aprobar' (estado=${ej.estado}, nodo=${ej.nodo_actual})`);
  ok(!!ej.contexto?.hora?.iso, "el sub-flujo devolvió la hora al padre");

  let [ap] = await query<any>(`SELECT * FROM aprobaciones WHERE ejecucion_id=$1 AND estado='pendiente'`, [r.ejecucionId]);
  ok(!!ap && ap.tipo === "flujo", "hay una aprobación pendiente tipo flujo");
  await query(`UPDATE aprobaciones SET estado='aprobada', resuelto_en=now() WHERE id=$1`, [ap.id]);
  r = await reanudarFlujo(r.ejecucionId, true);

  [ej] = await query<any>(`SELECT * FROM flujo_ejecuciones WHERE id=$1`, [r.ejecucionId]);
  ok(ej.estado === "esperando_aprobacion" && ej.nodo_actual === "sensible", `pausó solo en la tool sensible (nodo=${ej.nodo_actual})`);
  ok(ej.contexto?.__iteraciones?.bucle === 3, `repetir hizo 3 iteraciones (hizo ${ej.contexto?.__iteraciones?.bucle})`);
  ok(ej.contexto?.ultima?.texto === "iteración 3", `última iteración correcta ("${ej.contexto?.ultima?.texto}")`);

  [ap] = await query<any>(`SELECT * FROM aprobaciones WHERE ejecucion_id=$1 AND estado='pendiente'`, [r.ejecucionId]);
  await query(`UPDATE aprobaciones SET estado='aprobada', resuelto_en=now() WHERE id=$1`, [ap.id]);
  r = await reanudarFlujo(r.ejecucionId, true);
  ok(r.estado === "completado", `completado (estado=${r.estado}${r.error ? ", error=" + r.error : ""})`);
  ok((r.resultado as any)?.cierre?.ejecutada === "cierre del flujo de prueba", "la tool sensible se ejecutó tras aprobar");

  console.log("\n── Rechazo ──");
  let r2 = await iniciarFlujo("sistema_prueba_completa", { veces: 1, espera: 0 });
  await dormir(300);
  const [ap2] = await query<any>(`SELECT * FROM aprobaciones WHERE ejecucion_id=$1 AND estado='pendiente'`, [r2.ejecucionId]);
  await query(`UPDATE aprobaciones SET estado='rechazada', resuelto_en=now() WHERE id=$1`, [ap2.id]);
  r2 = await reanudarFlujo(r2.ejecucionId, false);
  ok(r2.estado === "fallido" && /Rechazado/.test(r2.error || ""), "rechazar detiene el flujo como fallido");

  const [log] = await query<any>(`SELECT log FROM flujo_ejecuciones WHERE id=$1`, [r.ejecucionId]);
  console.log("\n── Log del flujo completo ──");
  for (const l of log.log) console.log("  " + l.texto);

  await db.end();
  console.log(process.exitCode ? "\nHubo fallos." : "\nFase 4 OK.");
}
main().catch((e) => { console.error(e); process.exit(1); });