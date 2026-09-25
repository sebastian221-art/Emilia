// ARCHIVO: src/db/limpiar.ts
// Vacía TODOS los datos (agentes, conversaciones, mensajes, ejecuciones, trazas,
// aprobaciones, documentos, tools/skills/flujos de la UI, dedup de WhatsApp).
// El esquema queda intacto. Lo definido en código se vuelve a registrar solo
// al arrancar el servidor.
//   npx tsx src/db/limpiar.ts --si

import "dotenv/config";
import { db } from "./cliente.js";

async function limpiar() {
  if (!process.argv.includes("--si")) {
    console.log("Esto borra TODOS los datos de Emilia (no el esquema). Para confirmar:\n  npx tsx src/db/limpiar.ts --si");
    process.exit(0);
  }
  await db.query(`
    TRUNCATE TABLE
      pasos, ejecuciones, aprobaciones, flujo_ejecuciones,
      mensajes, conversaciones, documentos,
      whatsapp_vistos,
      agentes,
      tools, skills, flujos
    RESTART IDENTITY CASCADE;
  `);
  console.log("Base vacía. Arrancá el servidor (npm run dev): el registro vuelve a cargar lo de código.");
  await db.end();
}

limpiar().catch((e) => { console.error("Error limpiando:", e); process.exit(1); });