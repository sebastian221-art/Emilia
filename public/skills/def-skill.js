// Definición de las secciones de una skill suprema.
// Mismo formato que las piezas del agente: t (tipo), key, label, ph, ops, ayuda, avanzado.

const DEF_SKILL = [

    { g: "Esencial", k: "identidad", nom: "Identidad y activación", campos: [
      { t: "text", key: "nombre", label: "Nombre (sin espacios, ej. redactar_reporte)", ph: "redactar_reporte" },
      { t: "textarea", key: "descripcion", label: "Descripción — qué hace", ph: "Redacta un informe claro a partir del resultado de una tarea." },
      { t: "textarea", key: "cuando_usar", label: "Cuándo usarla (señales que la disparan)", ph: "Cuando el usuario pide un reporte, resumen o informe de algo hecho." },
      { t: "textarea", key: "cuando_no", label: "Cuándo NO usarla", avanzado: true, ph: "No usar para responder preguntas simples o charlar." },
      { t: "textarea", key: "ejemplos", label: "Ejemplos de uso", avanzado: true, ph: "'armá el reporte de la campaña' → genera informe con resultados reales." },
      { t: "text", key: "tags", label: "Tags / categoría", avanzado: true, ph: "reportes, comunicación" },
    ]},
  
    { g: "Esencial", k: "io", nom: "Entradas y salidas", campos: [
      { t: "textarea", key: "entradas", label: "Qué datos necesita para arrancar", ph: "El resultado de la tarea a reportar, el destinatario." },
      { t: "textarea", key: "salida", label: "Qué devuelve al terminar", ph: "Un informe en texto, listo para enviar." },
      { t: "select", key: "si_falta", label: "Si le falta un dato", ops: [["pregunta","Lo pide (no asume)"],["asume","Asume un valor razonable"],["falla","Falla y avisa"]] },
      { t: "check", key: "valida", label: "Valida las entradas antes de ejecutar", avanzado: true },
    ]},
  
    { g: "Esencial", k: "procedimiento", nom: "Procedimiento (el cómo)", campos: [
      { t: "textarea", key: "pasos", label: "Los pasos, en lenguaje natural", ph: "1. Revisar el resultado real. 2. Extraer lo importante. 3. Redactar claro. 4. Devolver." },
      { t: "select", key: "modo", label: "Modo de ejecución", ops: [["libre","Libre (el agente decide el orden)"],["guiado","Guiado (sigue los pasos exactos)"]] },
      { t: "textarea", key: "condicionales", label: "Pasos condicionales (si pasa X, hacé Y)", avanzado: true, ph: "Si hubo errores en la tarea, incluir una sección de qué falló." },
      { t: "textarea", key: "puede_parar", label: "Dónde puede parar y preguntar", avanzado: true, ph: "Antes de dar por final el reporte, mostrarlo para aprobación." },
    ]},
  
    { g: "Esencial", k: "recursos", nom: "Tools y recursos", campos: [
      { t: "text", key: "tools", label: "Tools que usa (nombres, separados por coma)", ph: "api_sistema_envios", ayuda: "Se enlazan con la página Tools cuando exista." },
      { t: "check", key: "usa_documentos", label: "Necesita los documentos/contexto del agente a mano" },
      { t: "check", key: "llama_skills", label: "Puede llamar a otras skills", avanzado: true },
    ]},
  
    { g: "Esencial", k: "riesgo", nom: "Riesgo y permisos", campos: [
      { t: "select", key: "nivel", label: "Nivel de riesgo", ops: [["lectura","Lectura (solo consulta)"],["escritura","Escritura (modifica datos)"],["ejecucion","Ejecución (acción real, ej. enviar)"],["sistema","Sistema (lo más sensible)"]] },
      { t: "check", key: "aprobacion", label: "Requiere tu aprobación antes de ejecutarse" },
      { t: "check", key: "irreversible", label: "Es una acción irreversible (marcar con cuidado)", avanzado: true },
      { t: "text", key: "limite_alcance", label: "Límite de alcance (ej. máx. registros que toca)", avanzado: true },
    ]},
  
    { g: "Robustez", k: "errores", nom: "Manejo de errores", campos: [
      { t: "number", key: "reintentos", label: "Reintentos ante fallo", ph: "2" },
      { t: "select", key: "estrategia", label: "Cómo reintenta", avanzado: true, ops: [["distinto","Cambia el enfoque"],["igual","Igual (para errores de red)"]] },
      { t: "textarea", key: "plan_b", label: "Plan B / camino alternativo", avanzado: true, ph: "Si la API falla, guardar el reporte localmente y avisar." },
      { t: "select", key: "si_falla_todo", label: "Si agota los reintentos", ops: [["escala","Pide ayuda a un humano"],["aborta","Aborta y reporta"]] },
    ]},
  
    { g: "Robustez", k: "verificacion", nom: "Verificación de éxito", campos: [
      { t: "textarea", key: "criterio", label: "Cómo sabe que se cumplió de verdad", ph: "El reporte contiene los datos reales de la tarea, no inventados." },
      { t: "check", key: "contra_evidencia", label: "Verifica contra evidencia real (no solo que no falló)" },
    ]},
  
    { g: "Robustez", k: "complejidad", nom: "Complejidad y ejecución", campos: [
      { t: "number", key: "presupuesto", label: "Presupuesto de pasos propio", ph: "10", avanzado: true },
      { t: "check", key: "descompone", label: "Puede descomponerse en sub-tareas", avanzado: true },
      { t: "check", key: "delega", label: "Puede delegar partes a sub-agentes", avanzado: true },
      { t: "check", key: "escala_razonador", label: "Escala al modelo razonador en pasos difíciles", avanzado: true },
    ]},
  
  ];