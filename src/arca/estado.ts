// ARCHIVO: src/arca/estado.ts
// Guarda la última revisión y las misiones cumplidas (para el panel, para
// celebrar cuando completas una, y para no revisar todo a cada rato).
import { query } from "../db/cliente.js";
import { diagnosticar, type Chequeo } from "./diagnostico.js";
import { armarTutorial, MISIONES, type Tutorial } from "./tutorial.js";

export async function revisar(op: { mision?: string; ids?: string[] } = {}): Promise<{ tutorial: Tutorial; chequeos: Chequeo[]; nuevas: string[] }> {
  const recientes = await diagnosticar(op);
  let todos = recientes;
  let hayBase = true;
  try {
    for (const c of recientes) await query(`INSERT INTO arca_chequeos (id, mision, nombre, estado, detalle, pasos, instalable, actualizado_en) VALUES ($1,$2,$3,$4,$5,$6,$7,now())
      ON CONFLICT (id) DO UPDATE SET mision=EXCLUDED.mision, nombre=EXCLUDED.nombre, estado=EXCLUDED.estado, detalle=EXCLUDED.detalle, pasos=EXCLUDED.pasos, instalable=EXCLUDED.instalable, actualizado_en=now()`,
      [c.id, c.mision, c.nombre, c.estado, c.detalle, JSON.stringify(c.pasos || []), c.instalable || null]);
    if (op.mision || op.ids) {   // revisión parcial: completar con lo guardado
      const viejos = await query<any>(`SELECT * FROM arca_chequeos`);
      const ids = new Set(recientes.map((c) => c.id));
      todos = [...recientes, ...viejos.filter((v) => !ids.has(v.id)).map((v) => ({ id: v.id, mision: v.mision, nombre: v.nombre, estado: v.estado, detalle: v.detalle, pasos: v.pasos, instalable: v.instalable || undefined }))];
    }
  } catch { hayBase = false; }
  const antes = hayBase ? new Set((await query<{ mision: string }>(`SELECT mision FROM arca_progreso`).catch(() => [] as any[])).map((r) => r.mision)) : new Set<string>();
  const tutorial = armarTutorial(todos, { pruebasHechas: antes.has("pruebas") });
  const nuevas: string[] = [];
  if (hayBase) for (const p of tutorial.misiones) if (p.completa && !antes.has(p.mision.id)) { nuevas.push(p.mision.id); await query(`INSERT INTO arca_progreso (mision) VALUES ($1) ON CONFLICT DO NOTHING`, [p.mision.id]).catch(() => {}); }
  return { tutorial, chequeos: todos, nuevas };
}

/** El tutorial con lo guardado (sin volver a revisar). Si no hay nada, revisa. */
export async function tutorialGuardado(): Promise<Tutorial> {
  const filas = await query<any>(`SELECT * FROM arca_chequeos`).catch(() => [] as any[]);
  if (!filas.length) return (await revisar()).tutorial;
  const hechas = new Set((await query<{ mision: string }>(`SELECT mision FROM arca_progreso`).catch(() => [] as any[])).map((r) => r.mision));
  return armarTutorial(filas.map((v) => ({ id: v.id, mision: v.mision, nombre: v.nombre, estado: v.estado, detalle: v.detalle, pasos: v.pasos, instalable: v.instalable || undefined })), { pruebasHechas: hechas.has("pruebas") });
}

export function celebrar(nuevas: string[]): string {
  return nuevas.map((id) => { const m = MISIONES.find((x) => x.id === id)!; return `🏆 ¡Misión ${m.n} completa: ${m.emoji} ${m.nombre}! +50 XP`; }).join("\n");
}
