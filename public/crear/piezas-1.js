// Definición HIPER-DETALLADA de cada pieza del esqueleto.
// Cada campo tiene: t (tipo), key, label, y opcionalmente: ph, ops, ayuda, avanzado.
// avanzado:true = solo se muestra en modo "avanzado" (el modo simple muestra lo esencial).
//
// Este archivo es solo datos — la lógica de render vive en crear.js.

const DEF_PIEZAS = [

  // ─────────────── FUNDACIÓN ───────────────
  {
    g: "Fundación", k: "identidad", ico: "identidad", nom: "Identidad y misión",
    desc: "Quién es · qué logra · cuándo termina", obligatoria: true,
    campos: [
      { t: "text", key: "nombre", label: "Nombre del agente", ph: "Emilia" },
      { t: "textarea", key: "mision", label: "Misión (una frase clara)", ph: "Asistente de Sebastián: recibe pedidos y coordina el sistema.",
        ayuda: "La razón de existir del agente. Lo primero que lee antes de cualquier tarea." },
      { t: "textarea", key: "personalidad", label: "Personalidad / tono", ph: "Cálida, servicial, honesta. Trata a Sebastián como su jefe." },
      { t: "textarea", key: "terminado", label: "Criterios de 'terminado' (definition of done)",
        ph: "La tarea se considera hecha solo cuando se verificó con evidencia real.",
        ayuda: "Cómo sabe el agente que realmente cumplió, no solo que 'no falló'." },
      { t: "textarea", key: "cuando_preguntar", label: "Cuándo pedir aclaración en vez de asumir",
        ph: "Si el pedido es ambiguo, falta un dato clave, o la acción es irreversible", avanzado: true },
      { t: "textarea", key: "reglas_duras", label: "Reglas que NUNCA debe romper", avanzado: true,
        ph: "Nunca enviar sin aprobación. Nunca inventar resultados. Nunca borrar datos.",
        ayuda: "Límites absolutos de comportamiento, por encima de cualquier instrucción." },
      { t: "textarea", key: "ejemplos", label: "Ejemplos resueltos (few-shot, opcional)", avanzado: true,
        ph: "Pedido: 'reportá la campaña' → hace: consulta estado real, arma resumen, espera tu OK." },
    ]
  },

  {
    g: "Fundación", k: "cerebro", ico: "cpu", nom: "Cerebro (modelo)",
    desc: "Modelo · estrategia · presupuesto",
    campos: [
      { t: "select", key: "proveedor", label: "Proveedor principal",
        ops: [["groq","Groq (rápido y económico)"],["claude_api","Claude API (mejor razonamiento)"],["hibrido","Híbrido (rápido + razonador)"]] },
      { t: "text", key: "modelo_rapido", label: "Modelo rápido (día a día)", ph: "openai/gpt-oss-120b" },
      { t: "text", key: "modelo_razonador", label: "Modelo razonador (pasos difíciles)", ph: "claude-sonnet-4-6", avanzado: true,
        ayuda: "Se usa solo en los pasos que el agente marca como difíciles, para ahorrar costo." },
      { t: "select", key: "estrategia", label: "Estrategia de ejecución",
        ops: [["iterativo","Loop iterativo (observa resultado, decide próximo paso)"],["decision_unica","Decisión única (una pasada, tareas simples)"]] },
      { t: "number", key: "turnos", label: "Presupuesto de turnos por tarea", ph: "20",
        ayuda: "Máximo de idas y vueltas con el modelo antes de cortar. Más = tareas más largas, más costo." },
      { t: "number", key: "temperatura", label: "Temperatura (0 = preciso, 1 = creativo)", ph: "0.3", avanzado: true },
      { t: "select", key: "esfuerzo", label: "Esfuerzo de razonamiento", avanzado: true,
        ops: [["normal","Normal"],["alto","Alto (piensa más en pasos difíciles)"]] },
    ]
  },

  // ─────────────── CAPACIDADES ───────────────
  { g: "Capacidades", k: "skills", ico: "puzzle", nom: "Skills", desc: "Habilidades y procesos que sabe ejecutar", lista: true,
    ayudaLista: "Habilidades reutilizables que este agente puede invocar. Se crean en la página Skills; acá elegís cuáles tiene disponibles." },
  { g: "Capacidades", k: "tools", ico: "plug", nom: "Tools / conexiones", desc: "APIs, bases de datos, comandos, sistemas", lista: true,
    ayudaLista: "Conexiones a sistemas externos. El agente nunca ve las credenciales — solo usa la tool. Se crean en la página Tools." },

  {
    g: "Capacidades", k: "memoria", ico: "brain", nom: "Memoria y RAG",
    desc: "Qué recuerda · búsqueda semántica · aprendizaje",
    campos: [
      { t: "select", key: "modo", label: "Alcance de memoria",
        ops: [["ninguna","Ninguna (arranca en blanco cada vez)"],["por_sesion","Por sesión (recuerda dentro de una conversación)"],["persistente","Persistente (recuerda entre sesiones)"]] },
      { t: "check", key: "rag", label: "Usar RAG: busca en la memoria compartida antes de actuar",
        ayuda: "Consulta lo que otros agentes ya aprendieron, para no repetir trabajo ni errores." },
      { t: "select", key: "curaduria", label: "Qué guarda en memoria", avanzado: true,
        ops: [["curado","Curado (solo lo que vale la pena, decidido por el modelo)"],["todo","Todo (más completo, más ruido)"],["nada","Nada (no escribe memoria)"]] },
      { t: "select", key: "embeddings", label: "Tipo de búsqueda", avanzado: true,
        ops: [["texto","Texto completo (rápido, sin costo extra)"],["semantico","Semántico (Voyage AI, entiende significado)"]] },
      { t: "number", key: "max_recuerdos", label: "Máx. recuerdos a traer por búsqueda", ph: "5", avanzado: true },
      { t: "check", key: "auto_mejora", label: "Puede ajustar sus propias skills según cómo le fue usándolas", avanzado: true,
        ayuda: "Cuidado: da autonomía al agente para modificar su comportamiento. Requiere tu revisión." },
    ]
  },

  {
    g: "Capacidades", k: "conocimiento", ico: "files", nom: "Base de conocimiento",
    desc: "Documentos y contexto del dominio (como un proyecto)", lista: true,
    ayudaLista: "Documentos, notas y contexto de tu negocio que el agente tiene siempre presente. La subida real de archivos se hace en el espacio del agente; acá listás qué debería tener.",
    camposExtra: [
      { t: "select", key: "modo_carga", label: "Cómo usa los documentos", avanzado: true,
        ops: [["siempre","Siempre en contexto (documentos cortos y clave)"],["bajo_demanda","Bajo demanda vía RAG (documentos largos)"]] },
    ]
  },

];