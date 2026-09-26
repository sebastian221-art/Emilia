// ARCHIVO: src/registro/cargar.ts
// ─────────────────────────────────────────────────────────────────────────────
//  ARRANQUE Y RECARGA DEL REGISTRO
//  Lee el manifiesto (modulos.ts), importa cada archivo por ruta (con
//  cache-bust para poder recargar en caliente), registra, verifica
//  referencias y sincroniza a la base. Si algo está mal definido, el
//  servidor NO arranca (y una recarga falla sin tocar el registro vigente).
// ─────────────────────────────────────────────────────────────────────────────

import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { registro, verificarReferencias, registrarTool, registrarSkill, registrarFlujo } from "./registro.js";
import { sincronizarRegistro } from "./sincronizar.js";
import type { DefTool, DefSkill, DefFlujo } from "./tipos.js";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function cargarModulos(cacheBust: boolean): Promise<{ tools: DefTool[]; skills: DefSkill[]; flujos: DefFlujo[]; errores: string[] }> {
  // El manifiesto también se recarga, para que una entrada nueva cuente.
  const manifiestoUrl = pathToFileURL(path.join(SRC, "registro/modulos.ts")).href + (cacheBust ? `?v=${Date.now()}` : "");
  const { MODULOS } = await import(manifiestoUrl) as typeof import("./modulos.js");
  const tools: DefTool[] = [], skills: DefSkill[] = [], flujos: DefFlujo[] = [], errores: string[] = [];
  for (const m of MODULOS) {
    try {
      const url = pathToFileURL(path.join(SRC, m.ruta)).href + (cacheBust ? `?v=${Date.now()}` : "");
      const mod: any = await import(url);
      const lista = mod[m.exporta];
      if (!Array.isArray(lista)) { errores.push(`${m.ruta}: no exporta el array "${m.exporta}"`); continue; }
      if (m.tipo === "tools") tools.push(...lista); else if (m.tipo === "skills") skills.push(...lista); else flujos.push(...lista);
    } catch (e: any) { errores.push(`${m.ruta}: ${e?.message || e}`); }
  }
  return { tools, skills, flujos, errores };
}

function registrarTodo(c: { tools: DefTool[]; skills: DefSkill[]; flujos: DefFlujo[] }) {
  registro._limpiar();
  for (const t of c.tools) registrarTool(t);
  for (const s of c.skills) registrarSkill(s);
  for (const f of c.flujos) registrarFlujo(f);
  verificarReferencias();
}

export async function iniciarRegistro() {
  const c = await cargarModulos(false);
  if (c.errores.length) throw new Error("Módulos con error:\n - " + c.errores.join("\n - "));
  registrarTodo(c);
  const n = await sincronizarRegistro();
  console.log(`[registro] ${n.tools} tools · ${n.skills} skills · ${n.flujos} flujos cargados desde código.`);
  for (const t of registro.tools()) console.log(`   ⚙ ${t.nombre} (${t.riesgo}${t.requiereAprobacion ? ", requiere aprobación" : ""})`);
  for (const s of registro.skills()) console.log(`   ◇ ${s.nombre} → [${s.tools.join(", ")}]`);
  for (const f of registro.flujos()) console.log(`   → ${f.nombre} (${f.pasos.length} pasos)`);
}

/**
 * Recarga en caliente: re-importa todos los módulos (con cache-bust). Si algo
 * falla, el registro vigente queda intacto y se devuelve el error.
 */
export async function recargarRegistro(): Promise<{ ok: boolean; tools: number; skills: number; flujos: number; nuevos: string[]; error?: string }> {
  const antes = new Set([...registro.tools().map((t) => "tool:" + t.nombre), ...registro.skills().map((s) => "skill:" + s.nombre), ...registro.flujos().map((f) => "flujo:" + f.nombre)]);
  const c = await cargarModulos(true);
  if (c.errores.length) return { ok: false, tools: registro.tools().length, skills: registro.skills().length, flujos: registro.flujos().length, nuevos: [], error: c.errores.join(" | ") };
  // Registrar en un ensayo: si falla la validación, restaurar lo anterior.
  const respaldo = { tools: registro.tools(), skills: registro.skills(), flujos: registro.flujos() };
  try { registrarTodo(c); }
  catch (e: any) { registrarTodo(respaldo); return { ok: false, tools: respaldo.tools.length, skills: respaldo.skills.length, flujos: respaldo.flujos.length, nuevos: [], error: e?.message || String(e) }; }
  const n = await sincronizarRegistro();
  const despues = [...registro.tools().map((t) => "tool:" + t.nombre), ...registro.skills().map((s) => "skill:" + s.nombre), ...registro.flujos().map((f) => "flujo:" + f.nombre)];
  const nuevos = despues.filter((x) => !antes.has(x));
  console.log(`[registro] recargado: ${n.tools} tools · ${n.skills} skills · ${n.flujos} flujos${nuevos.length ? " · nuevos: " + nuevos.join(", ") : ""}`);
  return { ok: true, ...n, nuevos };
}