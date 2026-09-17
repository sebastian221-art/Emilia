import { query } from "../db/cliente.js";

/**
 * Ejecuta una skill: resuelve su tool y hace la llamada real.
 * El agente solo pasa datos simples (ej. {destino, mensaje}); el ejecutor
 * se encarga de traducirlos al formato exacto que cada sistema espera.
 */
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

  // ── Adaptador: detecta el sistema y arma el body correcto ──
  const { body, headersExtra } = adaptarPayload(tool, endpoint, payload);

  const headers: Record<string, string> = { "Content-Type": "application/json", ...headersExtra };
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
  }

  try {
    const resp = await fetch(endpoint, {
      method: sec.conexion?.metodo || "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout((Number(sec.limites?.timeout) || 15) * 1000),
    });
    const data = await resp.json().catch(() => ({ status: resp.status }));
    return { ok: resp.ok, status: resp.status, respuesta: data };
  } catch (e) {
    return { error: `Falló la llamada a la tool: ${String(e)}` };
  }
}

/**
 * Traduce los datos simples del agente al formato exacto de cada sistema.
 * Detecta WhatsApp por el dominio; para el resto, pasa el payload tal cual.
 * Acá se agregan más adaptadores en el futuro, todo sin que el usuario
 * escriba código — solo elige el tipo de tool.
 */
function adaptarPayload(tool: any, endpoint: string, payload: Record<string, unknown>): { body: any; headersExtra: Record<string, string> } {
  const esWhatsApp = endpoint.includes("graph.facebook.com") || (tool.descripcion || "").toLowerCase().includes("whatsapp");

  if (esWhatsApp) {
    // El agente pasa: destino/numero/to + mensaje/texto/message.
    const to = String(payload.destino ?? payload.numero ?? payload.number ?? payload.to ?? payload.telefono ?? payload.phone ?? "").replace(/\D/g, "");
    const texto = String(payload.mensaje ?? payload.texto ?? payload.message ?? payload.contenido ?? payload.entrada ?? payload.body ?? "");
    const esPlantilla = payload.plantilla || payload.template;

    if (esPlantilla) {
      // Envío de plantilla (para reabrir ventana de 24h o escribir primero).
      // Si hay una variable (el texto del recordatorio), la incluimos en {{1}}.
      const variable = String(payload.variable ?? payload.recordatorio ?? texto ?? "");
      const componentes = variable
        ? [{ type: "body", parameters: [{ type: "text", text: variable }] }]
        : [];
      return {
        body: {
          messaging_product: "whatsapp",
          to,
          type: "template",
          template: {
            name: String(esPlantilla),
            language: { code: String(payload.idioma || "es") },
            ...(componentes.length ? { components: componentes } : {}),
          },
        },
        headersExtra: {},
      };
    }
    // Mensaje de texto normal.
    return {
      body: { messaging_product: "whatsapp", to, type: "text", text: { body: texto } },
      headersExtra: {},
    };
  }

  // Genérico: el payload va tal cual.
  return { body: payload, headersExtra: {} };
}