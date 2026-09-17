import { query } from "../db/cliente.js";

export async function aprobacionesPendientes() {
  return query(`SELECT * FROM aprobaciones WHERE estado='pendiente' ORDER BY creado_en ASC`);
}

export async function resolverAprobacion(id: string, aprobada: boolean): Promise<{ ejecucion_id: string | null }> {
  const [ap] = await query<any>(
    `UPDATE aprobaciones SET estado=$1, resuelto_en=now() WHERE id=$2 RETURNING ejecucion_id`,
    [aprobada ? "aprobada" : "rechazada", id]
  );
  return { ejecucion_id: ap?.ejecucion_id ?? null };
}