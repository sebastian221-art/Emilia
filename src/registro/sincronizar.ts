// ARCHIVO: src/registro/sincronizar.ts
// ─────────────────────────────────────────────────────────────────────────────
//  SINCRONIZACIÓN REGISTRO → BASE
//  Al arrancar: cada tool/skill/flujo del registro se upsertea en su tabla con
//  origen='codigo'. Lo que estaba con origen='codigo' y ya no está en el
//  registro se marca activo=false (no se borra: los agentes pueden tenerlo
//  asignado y las trazas viejas lo referencian).
//  Las filas con origen='ui' (creadas desde las páginas) no se tocan.
//  El id de cada fila se mantiene estable (upsert por nombre), así las
//  asignaciones a agentes por id siguen valiendo.
// ─────────────────────────────────────────────────────────────────────────────

import { query } from "../db/cliente.js";
import { registro, serializarTool, serializarSkill, serializarFlujo } from "./registro.js";

export async function sincronizarRegistro(): Promise<{ tools: number; skills: number; flujos: number }> {
  // ── Tools ──
  const tools = registro.tools().map(serializarTool);
  for (const t of tools) {
    await query(
      `INSERT INTO tools (nombre, descripcion, tipo, origen, modulo, esquema, riesgo, requiere_aprobacion, activo, estado_prueba, secciones)
       VALUES ($1,$2,'codigo','codigo',$3,$4,$5,$6,true,'ok','{}')
       ON CONFLICT (nombre) DO UPDATE SET
         descripcion=EXCLUDED.descripcion, tipo='codigo', origen='codigo', modulo=EXCLUDED.modulo,
         esquema=EXCLUDED.esquema, riesgo=EXCLUDED.riesgo, requiere_aprobacion=EXCLUDED.requiere_aprobacion,
         activo=true, estado_prueba='ok', actualizado_en=now()`,
      [t.nombre, t.descripcion, t.modulo, JSON.stringify(t.parametros), t.riesgo, t.requiereAprobacion]
    );
  }
  await query(`UPDATE tools SET activo=false, actualizado_en=now() WHERE origen='codigo' AND activo=true AND NOT (nombre = ANY($1::text[]))`,
    [tools.map((t) => t.nombre)]);

  // ── Skills ──
  const skills = registro.skills().map(serializarSkill);
  for (const s of skills) {
    await query(
      `INSERT INTO skills (nombre, descripcion, nivel_riesgo, origen, modulo, esquema, cuando_usar, tools_permitidas, procedimiento, requiere_aprobacion, activo, secciones)
       VALUES ($1,$2,$3,'codigo',$4,$5,$6,$7,$8,$9,true,'{}')
       ON CONFLICT (nombre) DO UPDATE SET
         descripcion=EXCLUDED.descripcion, nivel_riesgo=EXCLUDED.nivel_riesgo, origen='codigo', modulo=EXCLUDED.modulo,
         esquema=EXCLUDED.esquema, cuando_usar=EXCLUDED.cuando_usar, tools_permitidas=EXCLUDED.tools_permitidas,
         procedimiento=EXCLUDED.procedimiento, requiere_aprobacion=EXCLUDED.requiere_aprobacion,
         activo=true, actualizado_en=now()`,
      [s.nombre, s.descripcion, s.riesgo, s.modulo, JSON.stringify(s.parametros), s.cuandoUsar,
       JSON.stringify(s.tools), s.procedimiento, s.requiereAprobacion]
    );
  }
  await query(`UPDATE skills SET activo=false, actualizado_en=now() WHERE origen='codigo' AND activo=true AND NOT (nombre = ANY($1::text[]))`,
    [skills.map((s) => s.nombre)]);

  // ── Flujos ──
  const flujos = registro.flujos().map(serializarFlujo);
  for (const f of flujos) {
    const definicion = { inicio: f.inicio, pasos: f.pasos, parametros: f.parametros, riesgo: f.riesgo };
    await query(
      `INSERT INTO flujos (nombre, descripcion, definicion, origen, modulo, activo)
       VALUES ($1,$2,$3,'codigo',$4,true)
       ON CONFLICT (nombre) DO UPDATE SET
         descripcion=EXCLUDED.descripcion, definicion=EXCLUDED.definicion, origen='codigo',
         modulo=EXCLUDED.modulo, activo=true, actualizado_en=now()`,
      [f.nombre, f.descripcion, JSON.stringify(definicion), f.modulo]
    );
  }
  await query(`UPDATE flujos SET activo=false, actualizado_en=now() WHERE origen='codigo' AND activo=true AND NOT (nombre = ANY($1::text[]))`,
    [flujos.map((f) => f.nombre)]);

  return { tools: tools.length, skills: skills.length, flujos: flujos.length };
}