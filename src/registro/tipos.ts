// ARCHIVO: src/registro/tipos.ts
// ─────────────────────────────────────────────────────────────────────────────
//  CONTRATO DEL REGISTRO
//  Todo lo que Emilia "sabe hacer" se define en código con este contrato.
//  Al arrancar, el registro carga los módulos, valida, y sincroniza a la base
//  para que la UI lo refleje. La UI no puede inventar capacidades: solo
//  mostrar, asignar a agentes y ejecutar lo que está acá.
// ─────────────────────────────────────────────────────────────────────────────

import type { ChatCompletionMessageParam, ChatCompletionTool } from "groq-sdk/resources/chat/completions";
import type { RespuestaModelo } from "../motor/groq.js";

/** Nivel de riesgo de una capacidad. Determina permisos y avisos en la UI. */
export type NivelRiesgo = "lectura" | "escritura" | "ejecucion" | "sistema";

/**
 * Subconjunto de JSON Schema que usamos para parámetros. Es lo que se le
 * manda al modelo como definición de función Y lo que se valida antes de
 * ejecutar. Una sola fuente de verdad para ambas cosas.
 */
export interface EsquemaJson {
  type?: "object" | "string" | "number" | "integer" | "boolean" | "array";
  description?: string;
  properties?: Record<string, EsquemaJson>;
  required?: string[];
  items?: EsquemaJson;
  enum?: (string | number)[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  default?: unknown;
}

/** Resultado uniforme de cualquier tool o skill. */
export interface ResultadoTool {
  ok: boolean;
  /** Datos estructurados para el modelo o para el siguiente paso. */
  datos?: unknown;
  /** Una frase en lenguaje natural con lo que pasó (para trazas y para el modelo). */
  resumen?: string;
  /** Mensaje de error si ok=false. */
  error?: string;
}

/**
 * Lo que una tool/skill recibe para poder actuar "dentro" de una ejecución:
 * escribir trazas, invocar otras tools (en skills), llamar al modelo.
 * Si se ejecuta fuera de una ejecución (ej. botón "Probar" en la UI),
 * agenteId y ejecucionId vienen en null.
 */
export interface ContextoEjecucion {
  agenteId: string | null;
  ejecucionId: string | null;
  /** Conversación desde la que se disparó (para que un flujo reporte ahí al terminar). */
  conversacionId?: string | null;
  /** Escribe un paso en la traza de la ejecución (si hay ejecución). */
  traza(tipo: string, detalle: string): Promise<void>;
  /** Ejecuta otra tool registrada. En skills, restringido a `tools` permitidas. */
  ejecutarTool(nombre: string, args: Record<string, unknown>): Promise<ResultadoTool>;
  /** Una llamada al modelo (sin tools por defecto). */
  modelo(mensajes: ChatCompletionMessageParam[], tools?: ChatCompletionTool[]): Promise<RespuestaModelo>;
}

/** Función de ejecución de una tool o skill en código. */
export type FnEjecutar = (args: Record<string, any>, ctx: ContextoEjecucion) => Promise<ResultadoTool>;

// ─── TOOL ────────────────────────────────────────────────────────────────────
/** Una operación atómica y tipada contra un sistema. No decide nada: hace. */
export interface DefTool {
  /** Único, snake_case, empieza con el módulo: `jelcom_listar_envios`. */
  nombre: string;
  /** Agrupación en la UI y en el código: `sistema`, `whatsapp`, `jelcom`. */
  modulo: string;
  /** Qué hace, en una o dos frases. Es lo que lee el modelo. */
  descripcion: string;
  /** Schema de los argumentos. Se valida antes de ejecutar. */
  parametros: EsquemaJson;
  riesgo: NivelRiesgo;
  /** Si true, el motor pausa y pide OK humano antes de ejecutarla. */
  requiereAprobacion: boolean;
  /** Tiempo máximo de ejecución. Por defecto 30s. */
  timeoutSeg?: number;
  ejecutar: FnEjecutar;
}

// ─── SKILL ───────────────────────────────────────────────────────────────────
/**
 * Un procedimiento: qué tools usa y cómo. Puede ser:
 *  - en código: trae `ejecutar` y orquesta tools con lógica propia.
 *  - guiada: trae `procedimiento` en lenguaje natural; el modelo la ejecuta
 *    usando solo las `tools` permitidas. (El motor guiado llega en Fase 3.)
 */
export interface DefSkill {
  nombre: string;
  modulo: string;
  descripcion: string;
  /** Señales que la disparan. Ayuda al modelo a elegirla. */
  cuandoUsar?: string;
  parametros: EsquemaJson;
  riesgo: NivelRiesgo;
  requiereAprobacion: boolean;
  /** Tools que tiene permitido invocar. Cualquier otra se rechaza. */
  tools: string[];
  /** Pasos en lenguaje natural (skill guiada). */
  procedimiento?: string;
  /** Lógica propia (skill en código). */
  ejecutar?: FnEjecutar;
  /** Tiempo máximo de la skill (por defecto 5 min). Las que corren Claude Code necesitan más. */
  timeoutSeg?: number;
}

// ─── FLUJO ───────────────────────────────────────────────────────────────────
/**
 * Orquestación determinista. El código decide el orden; el modelo solo trabaja
 * dentro de un paso `skill`. Semántica (motor/flujo.ts):
 *  - Los pasos se ejecutan en el orden del array, salvo saltos de `condicion`,
 *    `repetir` y `fin`. `inicio` marca el primero.
 *  - Los pasos que forman el `cuerpo` de un `repetir` NUNCA se entran en
 *    orden lineal: solo los ejecuta ese repetir. Conviene listarlos al final.
 *  - `repetir`: si `hasta(ctx)` es true o se alcanzó `maxVeces`, sigue con el
 *    paso posterior; si no, corre el cuerpo, espera `cadaSegundos`, incrementa
 *    y vuelve a evaluar. En el ctx: `__iter` (iteración actual, desde 0) y
 *    `__iteraciones[idRepetir]`.
 *  - Una `tool` con requiereAprobacion pausa el flujo sola (no hace falta un
 *    paso `aprobacion` antes). `aprobacion` explícita sirve para preguntar
 *    antes de un tramo entero.
 *  - `esperar` persiste y sobrevive reinicios. `subflujo` corre otro flujo y
 *    guarda su resultado en `guardarEn`.
 *  - Si una tool/skill devuelve ok=false: `siFalla: "continuar"` guarda el
 *    error y sigue; por defecto el flujo falla.
 * Todo lo que reciba `ctx` es el contexto acumulado: args + lo guardado con
 * `guardarEn` (se guarda `datos` del resultado; el resultado completo queda en
 * `__resultados[idPaso]`).
 */
type Args = Record<string, unknown> | ((ctx: Record<string, any>) => Record<string, unknown>);

export type PasoFlujo =
  | { id: string; tipo: "tool"; tool: string; args: Args; guardarEn?: string; siFalla?: "fallar" | "continuar"; /** true = un paso `aprobacion` anterior ya cubrió esta acción; no vuelve a pedir OK. */ preaprobado?: boolean }
  | { id: string; tipo: "skill"; skill: string; args: Args; guardarEn?: string; siFalla?: "fallar" | "continuar" }
  | { id: string; tipo: "condicion"; si: (ctx: Record<string, any>) => boolean; entonces: string; sino: string }
  | { id: string; tipo: "aprobacion"; mensaje: string | ((ctx: Record<string, any>) => string) }
  | { id: string; tipo: "esperar"; segundos: number | ((ctx: Record<string, any>) => number) }
  | { id: string; tipo: "repetir"; hasta: (ctx: Record<string, any>) => boolean; maxVeces: number; cuerpo: string[]; cadaSegundos?: number | ((ctx: Record<string, any>) => number) }
  | { id: string; tipo: "subflujo"; flujo: string; args: Args; guardarEn?: string }
  | { id: string; tipo: "fin"; resultado?: (ctx: Record<string, any>) => unknown; fallo?: boolean };

export interface DefFlujo {
  nombre: string;
  modulo: string;
  descripcion: string;
  parametros: EsquemaJson;
  riesgo: NivelRiesgo;
  /** Primer paso a ejecutar. */
  inicio: string;
  pasos: PasoFlujo[];
  /** Texto que se le manda a la conversación al terminar (si se disparó desde una). */
  reporte?: (ctx: Record<string, any>, resultado: unknown) => string;
}

// ─── Serialización para la UI/DB (sin funciones) ─────────────────────────────
export interface ToolSerializada {
  nombre: string; modulo: string; descripcion: string; parametros: EsquemaJson;
  riesgo: NivelRiesgo; requiereAprobacion: boolean; timeoutSeg: number; origen: "codigo";
}
export interface SkillSerializada {
  nombre: string; modulo: string; descripcion: string; cuandoUsar: string; parametros: EsquemaJson;
  riesgo: NivelRiesgo; requiereAprobacion: boolean; tools: string[]; procedimiento: string;
  tipo: "codigo" | "guiada"; origen: "codigo";
}
export interface FlujoSerializado {
  nombre: string; modulo: string; descripcion: string; parametros: EsquemaJson; riesgo: NivelRiesgo;
  inicio: string;
  /** Pasos sin funciones: las lambdas se representan como "(código)". */
  pasos: Array<Record<string, unknown>>;
  origen: "codigo";
}