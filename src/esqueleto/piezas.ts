// ARCHIVO: src/esqueleto/piezas.ts
// ─────────────────────────────────────────────────────────────────────────────
//  ESQUELETO DEL AGENTE — definición única
//  Regla de la Fase 3: NO hay campo acá sin código que lo lea. Al lado de cada
//  campo dice quién lo usa. Si querés agregar uno, primero hacé que el motor
//  lo honre, después lo agregás acá. La UI (crear y espacio) se genera de esto.
//
//  Piezas retiradas por no tener motor detrás: descomposicion, autocorreccion,
//  reflexion, subagentes, escalamiento, disparadores, limites. Sus columnas
//  JSONB siguen en la base (no se pierde nada), pero no se muestran ni se
//  leen. Vuelven cuando exista el código que las haga reales.
// ─────────────────────────────────────────────────────────────────────────────

export interface CampoPieza {
  t: "text" | "textarea" | "number" | "check" | "select";
  key: string;
  label: string;
  ph?: string;
  ops?: [string, string][];
  ayuda?: string;
  avanzado?: boolean;
  /** Dónde se usa (documentación viva, se muestra en la UI como ayuda técnica). */
  usa: string;
}

export interface Pieza {
  g: "Fundación" | "Capacidades" | "Inteligencia" | "Gobierno y operación";
  k: string;
  ico: string;
  nom: string;
  desc: string;
  obligatoria?: boolean;
  lista?: boolean;
  ayudaLista?: string;
  campos?: CampoPieza[];
  camposExtra?: CampoPieza[];
}

export const PIEZAS: Pieza[] = [

  // ─────────────── FUNDACIÓN ───────────────
  {
    g: "Fundación", k: "identidad", ico: "identidad", nom: "Identidad y misión",
    desc: "Quién es · qué logra · cuándo termina", obligatoria: true,
    campos: [
      { t: "text", key: "nombre", label: "Nombre del agente", ph: "Emilia", usa: "loop: system prompt" },
      { t: "textarea", key: "mision", label: "Misión (una frase clara)", ph: "Asistente de Sebastián: recibe pedidos y coordina el sistema.",
        ayuda: "La razón de existir del agente. Lo primero que lee antes de cualquier tarea.", usa: "loop: system prompt" },
      { t: "textarea", key: "personalidad", label: "Personalidad / tono", ph: "Cálida, servicial, honesta. Trata a Sebastián como su jefe.", usa: "loop: system prompt" },
      { t: "textarea", key: "terminado", label: "Criterios de 'terminado'", ph: "La tarea se considera hecha solo cuando se verificó con evidencia real.",
        ayuda: "Cómo sabe el agente que realmente cumplió, no solo que 'no falló'.", usa: "loop: system prompt" },
      { t: "textarea", key: "cuando_preguntar", label: "Cuándo pedir aclaración en vez de asumir", avanzado: true,
        ph: "Si el pedido es ambiguo, falta un dato clave, o la acción es irreversible.", usa: "loop: system prompt" },
      { t: "textarea", key: "reglas_duras", label: "Reglas que NUNCA debe romper", avanzado: true,
        ph: "Nunca enviar sin aprobación. Nunca inventar resultados. Nunca borrar datos.", usa: "loop: system prompt" },
      { t: "textarea", key: "ejemplos", label: "Ejemplos resueltos (few-shot)", avanzado: true,
        ph: "Pedido: 'reportá la campaña' → consulta estado real, arma resumen, espera tu OK.", usa: "loop: system prompt" },
    ],
  },
  {
    g: "Fundación", k: "cerebro", ico: "cpu", nom: "Cerebro (modelo)",
    desc: "Modelo · presupuesto · temperatura",
    campos: [
      { t: "text", key: "modelo_rapido", label: "Modelo (Groq)", ph: "openai/gpt-oss-120b", usa: "loop → groq.llamarModelo" },
      { t: "number", key: "turnos", label: "Presupuesto de turnos por tarea", ph: "20",
        ayuda: "Máximo de idas y vueltas con el modelo antes de cortar.", usa: "loop: maxTurnos" },
      { t: "number", key: "temperatura", label: "Temperatura (0 = preciso, 1 = creativo)", ph: "0.3", avanzado: true, usa: "groq.llamarModelo" },
    ],
  },

  // ─────────────── CAPACIDADES ───────────────
  { g: "Capacidades", k: "tools", ico: "plug", nom: "Tools", desc: "Operaciones tipadas contra sistemas", lista: true,
    ayudaLista: "Se definen en código (src/tools/) y se registran solas. Acá elegís cuáles tiene este agente." },
  { g: "Capacidades", k: "skills", ico: "puzzle", nom: "Skills", desc: "Procedimientos que sabe ejecutar", lista: true,
    ayudaLista: "En código (src/skills/) o guiadas desde la página Skills. Acá elegís cuáles tiene." },
  { g: "Capacidades", k: "flujos", ico: "guide", nom: "Flujos", desc: "Orquestaciones deterministas", lista: true,
    ayudaLista: "Se definen en código (src/flujos/). Acá elegís cuáles puede disparar." },
  {
    g: "Capacidades", k: "memoria", ico: "brain", nom: "Memoria",
    desc: "Qué recuerda de cada conversación",
    campos: [
      { t: "select", key: "modo", label: "Memoria conversacional",
        ops: [["persistente", "Persistente: además recuerda hechos durables sobre el jefe entre conversaciones y agentes"], ["por_sesion", "Por conversación (resumen + últimos mensajes)"], ["ninguna", "Ninguna (cada mensaje arranca en blanco)"]],
        usa: "memoria.historialParaModelo + memoria-lp (persistente)" },
      { t: "number", key: "ventana", label: "Mensajes recientes que ve tal cual", ph: "20", avanzado: true,
        ayuda: "Lo anterior a esta ventana se comprime en un resumen automático.", usa: "memoria: ventana" },
    ],
  },
  { g: "Capacidades", k: "conocimiento", ico: "files", nom: "Base de conocimiento", desc: "Documentos siempre en contexto", lista: true,
    ayudaLista: "Los archivos se suben en el espacio del agente (pestaña Documentos). Entran completos al contexto hasta 4k por documento y 16k en total." },

  // ─────────────── INTELIGENCIA ───────────────
  {
    g: "Inteligencia", k: "planeamiento", ico: "guide", nom: "Planeamiento",
    desc: "Arma un plan antes de tocar herramientas",
    campos: [
      { t: "check", key: "activo", label: "Arma un plan explícito (3-6 pasos) antes de ejecutar", usa: "loop: plan previo" },
    ],
  },
  {
    g: "Inteligencia", k: "pensar_voz_alta", ico: "bulb", nom: "Pensar en voz alta",
    desc: "Su razonamiento queda en las trazas",
    campos: [
      { t: "check", key: "visible", label: "Guardar el razonamiento del modelo en las trazas", usa: "loop: traza 'pensamiento'" },
    ],
  },

  // ─────────────── GOBIERNO Y OPERACIÓN ───────────────
  { g: "Gobierno y operación", k: "canales", ico: "broadcast", nom: "Canales", desc: "Por dónde se le habla", lista: true,
    ayudaLista: "Agregá 'whatsapp' para que este agente atienda el webhook de WhatsApp. El chat del panel siempre está." },
  {
    g: "Gobierno y operación", k: "gobierno", ico: "shield", nom: "Gobierno",
    desc: "Aprobaciones y límites duros",
    campos: [
      { t: "check", key: "aprobar_por_whatsapp", label: "El jefe puede aprobar/rechazar respondiendo 'ok'/'no' por WhatsApp", usa: "webhook: aprobaciones" },
      { t: "number", key: "max_tool_calls", label: "Máx. llamadas a herramientas por tarea", ph: "30", avanzado: true, usa: "loop: corta la tarea al llegar" },
    ],
  },
  {
    g: "Gobierno y operación", k: "trazas", ico: "timeline", nom: "Trazas y verificación",
    desc: "Qué se registra y qué se verifica",
    campos: [
      { t: "check", key: "verifica", label: "Marcar en trazas si afirma haber actuado sin usar herramientas", usa: "loop: verificación anti-alucinación" },
    ],
  },
];

/** Claves de piezas que son objeto de configuración (se leen campo a campo). */
export const PIEZAS_OBJETO = PIEZAS.filter((p) => !p.lista).map((p) => p.k);
/** Claves de piezas que son listas ({items, ids?, _extra?}). */
export const PIEZAS_LISTA = PIEZAS.filter((p) => p.lista).map((p) => p.k);
/** Todas las claves válidas. Cualquier otra que llegue del front se ignora. */
export const CLAVES_VALIDAS = new Set(PIEZAS.map((p) => p.k));

/** Valores por defecto de cada pieza objeto (lo que el motor asume si no está). */
export const DEFAULTS: Record<string, Record<string, unknown>> = {
  cerebro: { modelo_rapido: "openai/gpt-oss-120b", turnos: 20, temperatura: 0.3 },
  memoria: { modo: "por_sesion", ventana: 20 },
  planeamiento: { activo: false },
  pensar_voz_alta: { visible: true },
  gobierno: { aprobar_por_whatsapp: true, max_tool_calls: 30 },
  trazas: { verifica: true },
};