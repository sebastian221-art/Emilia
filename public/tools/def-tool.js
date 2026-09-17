// Definición de las secciones de una tool.
const DEF_TOOL = [

    { g: "Esencial", k: "identidad", nom: "Identidad y tipo", campos: [
      { t: "text", key: "nombre", label: "Nombre (sin espacios, ej. api_whatsapp)", ph: "api_whatsapp" },
      { t: "textarea", key: "descripcion", label: "Descripción — a qué sistema se conecta", ph: "Conexión a la API de WhatsApp Cloud (Meta) para enviar mensajes." },
      { t: "select", key: "tipo", label: "Tipo de conexión", ops: [
        ["api_rest","API REST"],["base_datos","Base de datos"],["comando","Comando / script"],
        ["webhook","Webhook entrante"],["mcp","MCP server"],["agente","Otro agente"]] },
    ]},
  
    { g: "Esencial", k: "conexion", nom: "Conexión", campos: [
      { t: "text", key: "endpoint", label: "URL / endpoint (o cadena de conexión)", ph: "https://graph.facebook.com/v21.0/PHONE_ID/messages" },
      { t: "select", key: "metodo", label: "Método principal", avanzado: true, ops: [["POST","POST"],["GET","GET"],["PUT","PUT"],["DELETE","DELETE"]] },
      { t: "text", key: "headers", label: "Headers fijos (opcional, formato clave:valor por línea)", avanzado: true, ph: "Content-Type: application/json" },
      { t: "select", key: "formato", label: "Formato de datos", avanzado: true, ops: [["json","JSON"],["form","Form"],["texto","Texto plano"]] },
    ]},
  
    { g: "Esencial", k: "auth", nom: "Autenticación", campos: [
      { t: "select", key: "tipo", label: "Tipo de autenticación", ops: [
        ["ninguna","Sin auth"],["bearer","Bearer token"],["api_key","API key"],["oauth","OAuth"],["hmac","HMAC"]] },
      { t: "text", key: "credencial_ref", label: "Variable de entorno con la credencial", ph: "WHATSAPP_TOKEN",
        ayuda: "El NOMBRE de la variable del .env, nunca la credencial en claro. El agente nunca la ve." },
      { t: "select", key: "ubicacion", label: "Dónde va la credencial", avanzado: true, ops: [["header","En el header"],["query","En la URL"],["body","En el body"]] },
    ]},
  
    { g: "Esencial", k: "alcance", nom: "Alcance y permisos", campos: [
      { t: "select", key: "alcance", label: "Alcance", ops: [["lectura","Solo lectura"],["escritura","Escritura"],["total","Total"]] },
      { t: "check", key: "aprobacion", label: "Requiere tu aprobación cada vez que se usa", avanzado: true },
      { t: "textarea", key: "operaciones", label: "Operaciones habilitadas (opcional)", avanzado: true, ph: "enviar_mensaje, enviar_plantilla" },
    ]},
  
    { g: "Seguridad", k: "limites", nom: "Límites y seguridad", campos: [
      { t: "number", key: "rate_limit", label: "Máx. llamadas por minuto (0 = sin límite)", ph: "60" },
      { t: "number", key: "timeout", label: "Timeout por llamada (segundos)", ph: "10" },
      { t: "number", key: "reintentos", label: "Reintentos ante fallo de red", ph: "2", avanzado: true },
      { t: "select", key: "ambiente", label: "Ambiente", avanzado: true, ops: [["produccion","Producción"],["pruebas","Pruebas"]] },
    ]},
  
    { g: "Avanzado", k: "datos", nom: "Forma de los datos", campos: [
      { t: "textarea", key: "esquema_entrada", label: "Esquema de entrada (qué parámetros espera)", avanzado: true, ph: "to: string, message: string" },
      { t: "textarea", key: "esquema_salida", label: "Esquema de salida (qué devuelve)", avanzado: true, ph: "message_id: string, status: string" },
      { t: "textarea", key: "ejemplo", label: "Ejemplo de llamada", avanzado: true },
    ]},
  
  ];