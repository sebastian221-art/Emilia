import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "dotenv/config";
import { db } from "./cliente.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function migrar() {
  const sql = readFileSync(path.join(__dirname, "esquema.sql"), "utf-8");
  console.log("Aplicando esquema a la base de datos...");
  await db.query(sql);
  console.log("Listo — tablas creadas/actualizadas.");
  await db.end();
}

migrar().catch((e) => {
  console.error("Error aplicando la migración:", e);
  process.exit(1);
});