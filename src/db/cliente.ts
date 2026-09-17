import pg from "pg";
import "dotenv/config";

const { Pool } = pg;

export const db = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Sin esto, un error de conexión (Postgres caído) tumba todo el proceso
// en vez de fallar solo la consulta puntual.
db.on("error", (err) => console.error("Error inesperado en Postgres:", err.message));

export async function query<T = any>(texto: string, params: any[] = []): Promise<T[]> {
  const res = await db.query(texto, params);
  return res.rows as T[];
}