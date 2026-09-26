// ARCHIVO: src/db/migrar.ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "dotenv/config";
import { db } from "./cliente.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Orden de aplicación. Cada archivo es idempotente.
const ARCHIVOS = ["esquema.sql", "esquema-registro.sql", "esquema-motor.sql", "esquema-flujos.sql", "esquema-archivos.sql", "esquema-codigo.sql", "esquema-runtime.sql", "esquema-empresa.sql", "esquema-memoria.sql", "esquema-eventos.sql"];

async function migrar() {
  for (const archivo of ARCHIVOS) {
    const sql = readFileSync(path.join(__dirname, archivo), "utf-8");
    console.log(`Aplicando ${archivo}...`);
    await db.query(sql);
  }
  console.log("Listo — tablas creadas/actualizadas.");
  await db.end();
}

migrar().catch((e) => {
  console.error("Error aplicando la migración:", e);
  process.exit(1);
});