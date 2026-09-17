// Tipos de nodo de un flujo de trabajo. Cada uno tiene su color, ícono,
// y los campos que se configuran al hacer doble clic.
const TIPOS_NODO = {
    inicio: {
      nom: "Inicio", ico: "▶", color: "#6ee7b7", bg: "#16352a",
      campos: [
        { t: "select", key: "disparador", label: "Cómo arranca", ops: [["manual","Manual (vos lo lanzás)"],["mensaje","Al recibir un mensaje"],["cron","Programado (horario)"],["webhook","Webhook externo"]] },
        { t: "text", key: "cron", label: "Horario (si es programado, formato cron)", ph: "0 9 * * 1 = lunes 9am" },
      ],
    },
    accion: {
      nom: "Acción", ico: "⚡", color: "#c4b5fd", bg: "#2a2154",
      campos: [
        { t: "text", key: "skill", label: "Skill a usar (nombre)", ph: "responder_whatsapp" },
        { t: "textarea", key: "instruccion", label: "Qué hacer exactamente", ph: "Mandar el resumen de la campaña al número del cliente." },
      ],
    },
    razonar: {
      nom: "Razonar", ico: "🧠", color: "#c4b5fd", bg: "#2a2154",
      campos: [
        { t: "textarea", key: "pregunta", label: "Qué tiene que analizar/decidir", ph: "Revisar si el mensaje tiene errores antes de enviar." },
      ],
    },
    condicion: {
      nom: "Condición", ico: "◆", color: "#fbbf24", bg: "#3a2a12",
      campos: [
        { t: "textarea", key: "condicion", label: "La condición (si esto es verdad...)", ph: "Si el envío fue exitoso" },
        { t: "text", key: "etiqueta_si", label: "Etiqueta del camino SÍ", ph: "sí / éxito" },
        { t: "text", key: "etiqueta_no", label: "Etiqueta del camino NO", ph: "no / falló" },
      ],
    },
    aprobacion: {
      nom: "Aprobación", ico: "✋", color: "#f9a8d4", bg: "#3a1528",
      campos: [
        { t: "textarea", key: "mensaje", label: "Qué te pregunta", ph: "¿Confirmás el envío masivo a 4.850 números?" },
      ],
    },
    esperar: {
      nom: "Esperar", ico: "⏱", color: "#c4b5fd", bg: "#2a2154",
      campos: [
        { t: "select", key: "tipo", label: "Tipo de espera", ops: [["tiempo","Un tiempo fijo"],["evento","Hasta que pase algo"]] },
        { t: "number", key: "segundos", label: "Segundos (si es tiempo fijo)", ph: "30" },
      ],
    },
    repetir: {
      nom: "Repetir", ico: "🔁", color: "#fbbf24", bg: "#3a2a12",
      campos: [
        { t: "textarea", key: "condicion", label: "Repetir mientras / por cada", ph: "Reintentar hasta que el envío funcione (máx 3 veces)" },
        { t: "number", key: "max", label: "Máximo de repeticiones", ph: "3" },
      ],
    },
    subflujo: {
      nom: "Sub-flujo / Delegar", ico: "⤴", color: "#c4b5fd", bg: "#2a2154",
      campos: [
        { t: "select", key: "tipo", label: "Qué hace", ops: [["subflujo","Llama a otro flujo"],["delegar","Delega a otro agente"]] },
        { t: "text", key: "objetivo", label: "Flujo o objetivo a delegar", ph: "flujo_generar_reporte" },
      ],
    },
    fin: {
      nom: "Fin", ico: "■", color: "#b0a8d4", bg: "#1f1840",
      campos: [
        { t: "text", key: "resultado", label: "Cómo terminó (etiqueta)", ph: "completado / con error" },
      ],
    },
  };