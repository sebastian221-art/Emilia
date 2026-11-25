import pg from "pg";
import "dotenv/config";

const { Pool } = pg;

export const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: Number(process.env.PG_TIMEOUT_MS || 10_000),   // si la base no está, fallar rápido en vez de colgarse
});

// Sin esto, un error de conexión (Postgres caído) tumba todo el proceso
// en vez de fallar solo la consulta puntual.
db.on("error", (err) => console.error("Error inesperado en Postgres:", err.message));

export async function query<T = any>(texto: string, params: any[] = []): Promise<T[]> {
  const res = await db.query(texto, params);
  return res.rows as T[];
}