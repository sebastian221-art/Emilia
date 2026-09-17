import pg from "pg";
import "dotenv/config";

/**
 * Crea la base "emilia" si todavía no existe, conectándose primero a la
 * base "postgres" (que siempre existe). Así no hace falta abrir pgAdmin
 * ni crear nada a mano — el sistema se prepara solo.
 *
 * Aprovecha que tu Postgres local está en modo trust (sin contraseña para
 * conexiones locales), así que la conexión es directa.
 */
const NOMBRE_BASE = process.env.EMILIA_DB_NAME || "emilia";

// Conexión a la base "postgres" del sistema (no a emilia todavía).
const urlSistema = (process.env.DATABASE_URL || "postgres://postgres@localhost:5432/emilia")
  .replace(/\/[^/]+$/, "/postgres");

async function crearBaseSiNoExiste() {
  const cliente = new pg.Client({ connectionString: urlSistema });
  await cliente.connect();

  const existe = await cliente.query(`SELECT 1 FROM pg_database WHERE datname = $1`, [NOMBRE_BASE]);
  if (existe.rowCount === 0) {
    await cliente.query(`CREATE DATABASE ${NOMBRE_BASE}`);
    console.log(`Base "${NOMBRE_BASE}" creada.`);
  } else {
    console.log(`Base "${NOMBRE_BASE}" ya existe.`);
  }
  await cliente.end();
}

crearBaseSiNoExiste().catch((e) => {
  console.error("No se pudo crear la base:", e.message);
  console.error("Verificá que Postgres esté corriendo y que DATABASE_URL en el .env apunte al puerto correcto.");
  process.exit(1);
});