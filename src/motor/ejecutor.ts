import { query } from "../db/cliente.js";

export async function ejecutarSkill(skill: any, argumentos: Record<string, unknown>): Promise<any> {
  const sec = skill.secciones || {};
  const nombresTools = (sec.recursos?.tools || "").split(",").map((s: string) => s.trim()).filter(Boolean);
  if (!nombresTools.length) {
    return { ejecutada: true, tipo: "procedimiento", nota: "Skill de procedimiento — sin tool externa." };
  }
  const [tool] = await query<any>(`SELECT * FROM tools WHERE nombre = $1 LIMIT 1`, [nombresTools[0]]);
  if (!tool) return { error: `La skill declara la tool "${nombresTools[0]}" pero no existe en la biblioteca.` };
  return ejecutarTool(tool, argumentos);
}

export async function ejecutarTool(tool: any, payload: Record<string, unknown>): Promise<any> {
  const sec = tool.secciones || {};
  const endpoint = sec.conexion?.endpoint;
  if (tool.tipo !== "api_rest" || !endpoint) {
    return { error: `Ejecución de tools tipo '${tool.tipo}' o sin endpoint todavía no soportada.` };
  }
  const { url, metodo, body } = adaptar(tool, endpoint, payload);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const authTipo = sec.auth?.tipo || "ninguna";
  const credRef = sec.auth?.credencial_ref;
  if (authTipo === "bearer" && credRef) {
    const token = process.env[credRef];
    if (token) headers["Authorization"] = `Bearer ${token}`;
    else return { error: `La tool usa la credencial "${credRef}" pero no está en el .env.` };
  }
  if (authTipo === "api_key" && credRef) {
    const key = process.env[credRef];
    if (key) headers["x-api-key"] = key;
    else return { error: `La tool usa la credencial "${credRef}" pero no está en el .env.` };
  }
  try {
    const resp = await fetch(url, {
      method: metodo, headers,
      body: metodo === "GET" ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout((Number(sec.limites?.timeout) || 20) * 1000),
    });
    const data = await resp.json().catch(() => ({ status: resp.status }));
    return { ok: resp.ok, status: resp.status, respuesta: data };
  } catch (e) {
    return { error: `Falló la llamada a la tool: ${String(e)}` };
  }
}

function adaptar(tool: any, endpoint: string, payload: Record<string, unknown>): { url: string; metodo: string; body: any } {
  const desc = (tool.descripcion || "").toLowerCase();
  const metodoBase = tool.secciones?.conexion?.metodo || "POST";

  // ── WhatsApp (Meta) ──
  if (endpoint.includes("graph.facebook.com")) {
    const to = String(payload.destino ?? payload.numero ?? payload.number ?? payload.to ?? payload.telefono ?? payload.phone ?? "").replace(/\D/g, "");
    const texto = String(payload.mensaje ?? payload.texto ?? payload.message ?? payload.contenido ?? payload.entrada ?? payload.body ?? "");
    const esPlantilla = payload.plantilla || payload.template;
    if (esPlantilla) {
      const variable = String(payload.variable ?? payload.recordatorio ?? texto ?? "");
      const componentes = variable ? [{ type: "body", parameters: [{ type: "text", text: variable }] }] : [];
      return { url: endpoint, metodo: "POST", body: {
        messaging_product: "whatsapp", to, type: "template",
        template: { name: String(esPlantilla), language: { code: String(payload.idioma || "es") }, ...(componentes.length ? { components: componentes } : {}) },
      }};
    }
    return { url: endpoint, metodo: "POST", body: { messaging_product: "whatsapp", to, type: "text", text: { body: texto } } };
  }

  // ── Jelcom Envíos (API externa) ──
  const esJelcom = endpoint.includes("jelcom") || desc.includes("jelcom");
  if (esJelcom) {
    let base = endpoint;
    try { base = new URL(endpoint).origin; } catch {}

    // La acción puede venir explícita, o hay que DEDUCIRLA del texto del agente.
    let accion = String(payload.accion ?? payload.action ?? "").toLowerCase().trim();
    const texto = String(payload.entrada ?? payload.mensaje ?? payload.texto ?? payload.query ?? payload.consulta ?? "").toLowerCase();
    if (!accion) {
      if (/env[ií]o/.test(texto) && /list|ver|consult|traer|mostrar/.test(texto)) accion = "listar_envios";
      else if (/estado|log|progres/.test(texto)) accion = "estado_envio";
      else if (/campa|client/.test(texto)) accion = "listar_campanas";
      else accion = "listar_campanas"; // por defecto, la consulta más segura
    }
    const envioId = payload.envio_id ?? payload.id ?? payload.envioId;

    switch (accion) {
      case "crear_campana":
        return { url: `${base}/api/external/campanas`, metodo: "POST", body: {
          nombre: payload.nombre, color: payload.color, cuenta_wa_id: payload.cuenta_wa_id } };
      case "listar_campanas":
        return { url: `${base}/api/external/campanas`, metodo: "GET", body: {} };
      case "crear_envio":
        return { url: `${base}/api/external/envios`, metodo: "POST", body: {
          campana_id: payload.campana_id, cuenta_wa_id: payload.cuenta_wa_id, cuenta_sms_id: payload.cuenta_sms_id,
          nombre: payload.nombre, canal: payload.canal, cuerpo: payload.cuerpo, asunto: payload.asunto,
          plantilla: payload.plantilla, idioma: payload.idioma, enlace: payload.enlace } };
      case "listar_envios":
        return { url: `${base}/api/external/envios`, metodo: "GET", body: {} };
      case "estado_envio":
        return { url: `${base}/api/external/envios/${envioId}/logs`, metodo: "GET", body: {} };
      case "disparar_envio":
        return { url: `${base}/api/external/envios/${envioId}/enviar`, metodo: "POST", body: {} };
      case "pausar_envio":
        return { url: `${base}/api/external/envios/${envioId}/pausar`, metodo: "POST", body: {} };
      default:
        return { url: `${base}/api/external/campanas`, metodo: "GET", body: {} };
    }
  }

  // ── Genérico ──
  return { url: endpoint, metodo: metodoBase, body: payload };
}