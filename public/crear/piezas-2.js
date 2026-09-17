// Parte 2 de la definición de piezas: Inteligencia y Gobierno.
// Se concatena con DEF_PIEZAS de piezas-1.js (ver crear.js).

const DEF_PIEZAS_2 = [

  // ─────────────── INTELIGENCIA ───────────────
  {
    g: "Inteligencia", k: "planeamiento", ico: "guide", nom: "Planeamiento + confirmación",
    desc: "Planea → pregunta '¿así?' → ejecuta",
    campos: [
      { t: "check", key: "activo", label: "Arma un plan explícito antes de tocar cualquier herramienta" },
      { t: "select", key: "cuando", label: "Cuándo planear", avanzado: true,
        ops: [["siempre","Siempre"],["tareas_complejas","Solo en tareas complejas"],["nunca","Nunca (va directo)"]] },
      { t: "check", key: "confirmar", label: "Te muestra el plan y espera tu confirmación antes de ejecutar" },
      { t: "select", key: "que_confirma", label: "Qué requiere tu confirmación", avanzado: true,
        ops: [["todo","Todo el plan"],["solo_riesgoso","Solo los pasos irreversibles o costosos"],["nada","Nada (ejecuta el plan solo)"]] },
      { t: "number", key: "max_pasos_plan", label: "Máx. pasos en un plan", ph: "6", avanzado: true },
      { t: "check", key: "replanifica", label: "Puede rehacer el plan si a mitad de camino descubre algo nuevo", avanzado: true },
    ]
  },

  {
    g: "Inteligencia", k: "descomposicion", ico: "hierarchy", nom: "Descomposición de problemas",
    desc: "Parte lo difícil en pasos que el modelo sí resuelve",
    campos: [
      { t: "check", key: "activo", label: "Descompone tareas complejas en sub-pasos simples" },
      { t: "select", key: "cuando", label: "Cuándo descomponer", avanzado: true,
        ops: [["complejas","Solo si la tarea supera el umbral de complejidad"],["siempre","Siempre"],["si_falla","Solo si el primer intento directo falla"]] },
      { t: "number", key: "umbral", label: "Umbral: pasos estimados para considerar 'compleja'", ph: "3", avanzado: true },
      { t: "number", key: "max_subpasos", label: "Máx. sub-pasos en que puede partir", ph: "8", avanzado: true,
        ayuda: "Evita que fragmente el problema infinitamente." },
      { t: "select", key: "estrategia", label: "Cómo parte el problema", avanzado: true,
        ops: [["secuencial","Por etapas secuenciales (una tras otra)"],["subobjetivos","Por sub-objetivos independientes"],["dependencias","Por dependencias (qué necesita antes de qué)"]] },
      { t: "select", key: "quien_resuelve", label: "Quién resuelve cada sub-paso", avanzado: true,
        ops: [["mismo","El mismo agente, uno por uno"],["subagentes","Puede delegar sub-pasos a sub-agentes"],["pregunta","Te pregunta cuál abordar primero"]] },
      { t: "check", key: "mostrar_arbol", label: "Te muestra el árbol de cómo partió el problema", avanzado: true },
    ]
  },

  {
    g: "Inteligencia", k: "autocorreccion", ico: "refresh", nom: "Auto-corrección",
    desc: "Si falla, analiza y prueba distinto",
    campos: [
      { t: "check", key: "activo", label: "Ante un error, analiza por qué falló antes de reintentar" },
      { t: "number", key: "max_reintentos", label: "Máx. reintentos por paso", ph: "3" },
      { t: "select", key: "estrategia", label: "Cómo reintenta", avanzado: true,
        ops: [["distinto","Cambia el enfoque cada vez (no repite igual)"],["igual","Reintenta igual (útil para errores de red)"],["escala","Si sigue fallando, escala al modelo razonador"]] },
      { t: "select", key: "clasifica", label: "Distingue tipos de error", avanzado: true,
        ops: [["si","Sí: no reintenta errores de permisos o fatales, solo los transitorios"],["no","No: reintenta cualquier error igual"]] },
      { t: "check", key: "pide_ayuda", label: "Tras agotar reintentos, te pide ayuda en vez de rendirse en silencio", avanzado: true },
    ]
  },

  {
    g: "Inteligencia", k: "reflexion", ico: "eye", nom: "Reflexión / auto-crítica",
    desc: "'¿De verdad resolví lo pedido?'",
    campos: [
      { t: "check", key: "activo", label: "Antes de dar por terminado, se auto-critica" },
      { t: "select", key: "contra_que", label: "Contra qué verifica", avanzado: true,
        ops: [["evidencia","Evidencia real (resultados de tools, no su propia narración)"],["criterios","Los criterios de 'terminado' de su identidad"],["ambos","Ambos"]] },
      { t: "check", key: "rechaza_inventado", label: "Rechaza automáticamente si afirmó hacer algo sin evidencia de tool real",
        ayuda: "Clave contra la alucinación: si dice 'envié X' pero no hay llamada real registrada, lo marca como fallido." },
      { t: "number", key: "max_ciclos", label: "Máx. ciclos de reflexión + mejora", ph: "2", avanzado: true },
    ]
  },

  {
    g: "Inteligencia", k: "pensar_voz_alta", ico: "bulb", nom: "Pensar en voz alta",
    desc: "Espacio de borrador para razonar",
    campos: [
      { t: "check", key: "activo", label: "Tiene un espacio para razonar sin que cuente como acción" },
      { t: "check", key: "visible", label: "Su razonamiento se muestra en las trazas (para que veas cómo piensa)" },
      { t: "select", key: "profundidad", label: "Cuánto piensa antes de actuar", avanzado: true,
        ops: [["breve","Breve (rápido)"],["normal","Normal"],["extenso","Extenso (mejor en tareas difíciles, más costo)"]] },
    ]
  },

  {
    g: "Inteligencia", k: "subagentes", ico: "share", nom: "Sub-agentes",
    desc: "Delega y paraleliza, con tope",
    campos: [
      { t: "check", key: "permitido", label: "Puede delegar sub-tareas a copias efímeras de sí mismo" },
      { t: "number", key: "profundidad", label: "Profundidad máxima de delegación", ph: "1",
        ayuda: "1 = puede delegar, pero lo delegado no puede volver a delegar. Evita explosión de agentes." },
      { t: "number", key: "max_concurrentes", label: "Máx. sub-agentes en paralelo", ph: "3", avanzado: true },
      { t: "select", key: "hereda", label: "Qué heredan los sub-agentes", avanzado: true,
        ops: [["acotado","Solo las tools necesarias para la sub-tarea"],["todo","Todas las tools del padre"]] },
      { t: "select", key: "ve_padre", label: "Qué ve el agente padre del hijo", avanzado: true,
        ops: [["resumen","Solo el resultado final (contexto limpio)"],["todo","Todo el razonamiento del hijo"]] },
    ]
  },

  {
    g: "Inteligencia", k: "escalamiento", ico: "stairs", nom: "Escalamiento a razonador",
    desc: "Claude Code para pasos hiper-difíciles",
    campos: [
      { t: "check", key: "activo", label: "Puede invocar Claude Code (headless) en pasos que superen su modelo" },
      { t: "text", key: "tools", label: "Tools permitidas en el escalamiento", ph: "Read,Grep,Write,Bash",
        ayuda: "Para análisis: Read,Grep. Para escribir código: agregá Write,Edit,Bash." },
      { t: "number", key: "turnos", label: "Máx. turnos por invocación", ph: "8" },
      { t: "select", key: "cuando", label: "Cuándo escala", avanzado: true,
        ops: [["marca_dificil","Cuando el agente marca un paso como difícil"],["tras_fallar","Solo tras fallar con el modelo normal"],["nunca_auto","Solo si vos lo pedís explícitamente"]] },
      { t: "check", key: "fallback", label: "Si Claude Code falla, sigue con el modelo normal en vez de abortar", avanzado: true },
    ]
  },

  { g: "Inteligencia", k: "flujos", ico: "guide", nom: "Flujos de trabajo",
    desc: "Diagramas de pasos encadenables (se crean en la página Flujos)", lista: true,
    ayudaLista: "Flujos de trabajo reutilizables que este agente puede correr, en orden. Se diseñan en la página Flujos (ej: flujo de código → flujo de reporte → flujo de errores). Acá solo elegís cuáles usa y en qué orden.",
    camposExtra: [
      { t: "select", key: "modo", label: "Cómo usa los flujos", avanzado: true,
        ops: [["encadenados","Encadenados en el orden listado"],["segun_tarea","El agente elige cuál según la tarea"]] },
    ]
  },

  // ─────────────── GOBIERNO Y OPERACIÓN ───────────────
  { g: "Gobierno y operación", k: "gobierno", ico: "shield", nom: "Gobierno y permisos",
    desc: "Permisos por acción · aprobación humana", lista: true,
    ayudaLista: "Acciones que requieren tu aprobación explícita antes de ejecutarse. Cada acción de riesgo (ej. confirmar_envio_masivo) se declara acá.",
    camposExtra: [
      { t: "select", key: "default_riesgo", label: "Qué hace ante una acción no declarada", avanzado: true,
        ops: [["bloquea","Bloquea (fail-closed, más seguro)"],["permite_lectura","Permite solo si es de lectura"]] },
      { t: "check", key: "kill_switch", label: "Kill switch activable (freno de emergencia que corta todo)", avanzado: true },
    ]
  },

  { g: "Gobierno y operación", k: "disparadores", ico: "bolt", nom: "Disparadores",
    desc: "Cuándo actúa: mensaje, webhook, cron", lista: true,
    ayudaLista: "Eventos que hacen actuar al agente: un mensaje entrante, un webhook externo, un horario programado, o un evento de otro agente." },

  { g: "Gobierno y operación", k: "canales", ico: "broadcast", nom: "Canales y salidas",
    desc: "WhatsApp · panel · a quién reporta", lista: true,
    ayudaLista: "Por dónde comunica el agente sus resultados: WhatsApp, el panel, email, o hacia otro agente.",
    camposExtra: [
      { t: "select", key: "reporta_a", label: "A quién reporta", avanzado: true,
        ops: [["suelto","Suelto (te reporta directo a vos)"],["hub","A un agente hub / administrador"]] },
    ]
  },

  {
    g: "Gobierno y operación", k: "limites", ico: "lock", nom: "Límites y seguridad",
    desc: "Costo · timeout · concurrencia · aislamiento",
    campos: [
      { t: "number", key: "costo_dia", label: "Costo máximo por día (USD)", ph: "5" },
      { t: "number", key: "timeout", label: "Timeout por tarea (segundos)", ph: "120" },
      { t: "number", key: "concurrencia", label: "Máx. ejecuciones simultáneas", ph: "5" },
      { t: "number", key: "volumen_op", label: "Máx. volumen por operación (ej. destinatarios)", ph: "", avanzado: true,
        ayuda: "Tope duro independiente del comportamiento del agente. Para acciones masivas." },
      { t: "check", key: "workspace", label: "Trabaja en un workspace aislado (no toca nada real hasta revisar)", avanzado: true },
    ]
  },

  {
    g: "Gobierno y operación", k: "trazas", ico: "timeline", nom: "Trazas y verificación",
    desc: "Registra todo · confirma con evidencia",
    campos: [
      { t: "check", key: "activo", label: "Registra cada paso, decisión y resultado (auditoría completa)" },
      { t: "check", key: "verifica", label: "Verifica el cumplimiento con evidencia real antes de marcar 'completado'" },
      { t: "select", key: "detalle", label: "Nivel de detalle de las trazas", avanzado: true,
        ops: [["completo","Completo (razonamiento + tools + resultados)"],["acciones","Solo acciones y resultados"],["minimo","Mínimo (solo inicio y fin)"]] },
      { t: "check", key: "explica_errores", label: "Explica los errores en lenguaje simple, con qué recomienda hacer", avanzado: true },
    ]
  },

];