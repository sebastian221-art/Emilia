// ARCHIVO: src/registro/registro.ts
// ─────────────────────────────────────────────────────────────────────────────
//  REGISTRO
//  Único lugar donde viven las capacidades cargadas desde código.
//  - registrarX(def): valida y guarda. Nombre repetido = error al arrancar
//    (mejor fallar temprano que tener dos tools con el mismo nombre).
//  - validarArgs(esquema, args): valida argumentos ANTES de ejecutar.
//  - serializar(): versión sin funciones para la UI y la base.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  DefTool, DefSkill, DefFlujo, EsquemaJson,
  ToolSerializada, SkillSerializada, FlujoSerializado,
} from "./tipos.js";

const RE_NOMBRE = /^[a-z][a-z0-9_]{2,63}$/;

const tools = new Map<string, DefTool>();
const skills = new Map<string, DefSkill>();
const flujos = new Map<string, DefFlujo>();

function validarNombre(nombre: string, modulo: string, que: string) {
  if (!RE_NOMBRE.test(nombre)) {
    throw new Error(`${que} "${nombre}": el nombre debe ser snake_case, solo minúsculas/dígitos/_ y empezar con letra (3-64 chars).`);
  }
  if (!nombre.startsWith(modulo + "_")) {
    throw new Error(`${que} "${nombre}": debe empezar con su módulo "${modulo}_" (ej. ${modulo}_${nombre}).`);
  }
}

function validarEsquema(esq: EsquemaJson, que: string) {
  if (!esq || esq.type !== "object") throw new Error(`${que}: 'parametros' debe ser un schema con type "object".`);
  if (!esq.properties) esq.properties = {};
  for (const r of esq.required || []) {
    if (!esq.properties[r]) throw new Error(`${que}: 'required' menciona "${r}" pero no está en 'properties'.`);
  }
}

// ─── Alta ────────────────────────────────────────────────────────────────────
export function registrarTool(def: DefTool) {
  validarNombre(def.nombre, def.modulo, "Tool");
  validarEsquema(def.parametros, `Tool "${def.nombre}"`);
  if (tools.has(def.nombre)) throw new Error(`Tool "${def.nombre}" registrada dos veces.`);
  if (typeof def.ejecutar !== "function") throw new Error(`Tool "${def.nombre}" no tiene 'ejecutar'.`);
  tools.set(def.nombre, def);
}

export function registrarSkill(def: DefSkill) {
  validarNombre(def.nombre, def.modulo, "Skill");
  validarEsquema(def.parametros, `Skill "${def.nombre}"`);
  if (skills.has(def.nombre)) throw new Error(`Skill "${def.nombre}" registrada dos veces.`);
  if (!def.ejecutar && !def.procedimiento) throw new Error(`Skill "${def.nombre}" necesita 'ejecutar' (código) o 'procedimiento' (guiada).`);
  skills.set(def.nombre, def);
}

export function registrarFlujo(def: DefFlujo) {
  validarNombre(def.nombre, def.modulo, "Flujo");
  validarEsquema(def.parametros, `Flujo "${def.nombre}"`);
  if (flujos.has(def.nombre)) throw new Error(`Flujo "${def.nombre}" registrado dos veces.`);
  const ids = new Set(def.pasos.map((p) => p.id));
  if (ids.size !== def.pasos.length) throw new Error(`Flujo "${def.nombre}": hay ids de paso repetidos.`);
  if (!ids.has(def.inicio)) throw new Error(`Flujo "${def.nombre}": 'inicio' apunta a un paso que no existe.`);
  flujos.set(def.nombre, def);
}

/**
 * Verifica que todo lo referenciado exista: skills → tools, flujos → tools/skills/flujos.
 * Se llama una vez, después de cargar todos los módulos.
 */
export function verificarReferencias() {
  const errores: string[] = [];
  for (const s of skills.values()) {
    for (const t of s.tools) if (!tools.has(t)) errores.push(`Skill "${s.nombre}" permite la tool "${t}" que no existe.`);
  }
  for (const f of flujos.values()) {
    for (const p of f.pasos) {
      if (p.tipo === "tool" && !tools.has(p.tool)) errores.push(`Flujo "${f.nombre}" paso "${p.id}": tool "${p.tool}" no existe.`);
      if (p.tipo === "skill" && !skills.has(p.skill)) errores.push(`Flujo "${f.nombre}" paso "${p.id}": skill "${p.skill}" no existe.`);
      if (p.tipo === "subflujo" && !flujos.has(p.flujo)) errores.push(`Flujo "${f.nombre}" paso "${p.id}": subflujo "${p.flujo}" no existe.`);
    }
  }
  if (errores.length) throw new Error("Referencias rotas en el registro:\n - " + errores.join("\n - "));
}

// ─── Consulta ────────────────────────────────────────────────────────────────
export const registro = {
  tool: (nombre: string) => tools.get(nombre),
  skill: (nombre: string) => skills.get(nombre),
  flujo: (nombre: string) => flujos.get(nombre),
  tools: () => [...tools.values()],
  skills: () => [...skills.values()],
  flujos: () => [...flujos.values()],
  tieneTool: (n: string) => tools.has(n),
  tieneSkill: (n: string) => skills.has(n),
  tieneFlujo: (n: string) => flujos.has(n),
  /** Solo para tests: vacía todo. */
  _limpiar() { tools.clear(); skills.clear(); flujos.clear(); },
};

// ─── Validación de argumentos ────────────────────────────────────────────────
/**
 * Validador mínimo de JSON Schema (sin dependencias). Cubre lo que usamos:
 * type, required, enum, min/max, minLength/maxLength, items, properties
 * anidadas. Devuelve la lista de errores en español para que el modelo pueda
 * corregirse solo.
 */
export function validarArgs(esq: EsquemaJson, valor: unknown, ruta = "args"): { ok: boolean; errores: string[]; valor: any; ignorados: string[] } {
  const errores: string[] = [];
  const out = validar(esq, valor, ruta, errores);
  const declarados = new Set(Object.keys(esq.properties || {}));
  const ignorados = valor && typeof valor === "object" && !Array.isArray(valor) ? Object.keys(valor as object).filter((k) => k && !declarados.has(k)) : [];
  return { ok: errores.length === 0, errores, valor: out, ignorados };
}

function validar(esq: EsquemaJson, v: unknown, ruta: string, errores: string[]): any {
  if (v === undefined || v === null) {
    if (esq.default !== undefined) return esq.default;
    return v;
  }
  switch (esq.type) {
    case "object": {
      if (typeof v !== "object" || Array.isArray(v)) { errores.push(`${ruta}: debe ser un objeto.`); return v; }
      const obj = v as Record<string, unknown>;
      const salida: Record<string, unknown> = {};
      const props = esq.properties || {};
      for (const r of esq.required || []) {
        if (obj[r] === undefined || obj[r] === null || obj[r] === "") errores.push(`${ruta}.${r}: es obligatorio.`);
      }
      for (const [k, sub] of Object.entries(props)) {
        if (obj[k] !== undefined) salida[k] = validar(sub, obj[k], `${ruta}.${k}`, errores);
        else if (sub.default !== undefined) salida[k] = sub.default;
      }
      // Campos no declarados: se ignoran (no rompen), pero se avisa en la traza si hace falta.
      return salida;
    }
    case "string": {
      // Los modelos a veces mandan números como strings o viceversa: toleramos y convertimos.
      if (typeof v === "number" || typeof v === "boolean") v = String(v);
      if (typeof v !== "string") { errores.push(`${ruta}: debe ser texto.`); return v; }
      if (esq.enum && !esq.enum.includes(v)) errores.push(`${ruta}: debe ser uno de [${esq.enum.join(", ")}].`);
      if (esq.minLength !== undefined && v.length < esq.minLength) errores.push(`${ruta}: mínimo ${esq.minLength} caracteres.`);
      if (esq.maxLength !== undefined && v.length > esq.maxLength) errores.push(`${ruta}: máximo ${esq.maxLength} caracteres.`);
      return v;
    }
    case "number":
    case "integer": {
      const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
      if (typeof n !== "number" || Number.isNaN(n)) { errores.push(`${ruta}: debe ser un número.`); return v; }
      if (esq.type === "integer" && !Number.isInteger(n)) errores.push(`${ruta}: debe ser un entero.`);
      if (esq.minimum !== undefined && n < esq.minimum) errores.push(`${ruta}: mínimo ${esq.minimum}.`);
      if (esq.maximum !== undefined && n > esq.maximum) errores.push(`${ruta}: máximo ${esq.maximum}.`);
      if (esq.enum && !esq.enum.includes(n)) errores.push(`${ruta}: debe ser uno de [${esq.enum.join(", ")}].`);
      return n;
    }
    case "boolean": {
      if (v === "true") return true;
      if (v === "false") return false;
      if (typeof v !== "boolean") errores.push(`${ruta}: debe ser true o false.`);
      return v;
    }
    case "array": {
      if (!Array.isArray(v)) { errores.push(`${ruta}: debe ser una lista.`); return v; }
      if (!esq.items) return v;
      return v.map((x, i) => validar(esq.items!, x, `${ruta}[${i}]`, errores));
    }
    default:
      return v;
  }
}

// ─── Serialización ───────────────────────────────────────────────────────────
export function serializarTool(t: DefTool): ToolSerializada {
  return {
    nombre: t.nombre, modulo: t.modulo, descripcion: t.descripcion, parametros: t.parametros,
    riesgo: t.riesgo, requiereAprobacion: !!t.requiereAprobacion, timeoutSeg: t.timeoutSeg ?? 30, origen: "codigo",
  };
}
export function serializarSkill(s: DefSkill): SkillSerializada {
  return {
    nombre: s.nombre, modulo: s.modulo, descripcion: s.descripcion, cuandoUsar: s.cuandoUsar || "",
    parametros: s.parametros, riesgo: s.riesgo, requiereAprobacion: !!s.requiereAprobacion,
    tools: s.tools, procedimiento: s.procedimiento || "", tipo: s.ejecutar ? "codigo" : "guiada", origen: "codigo",
  };
}
export function serializarFlujo(f: DefFlujo): FlujoSerializado {
  const pasos = f.pasos.map((p) => {
    const plano: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(p)) plano[k] = typeof v === "function" ? "(código)" : v;
    return plano;
  });
  return {
    nombre: f.nombre, modulo: f.modulo, descripcion: f.descripcion, parametros: f.parametros,
    riesgo: f.riesgo, inicio: f.inicio, pasos, origen: "codigo",
  };
}

export function serializarTodo() {
  return {
    tools: registro.tools().map(serializarTool),
    skills: registro.skills().map(serializarSkill),
    flujos: registro.flujos().map(serializarFlujo),
  };
}