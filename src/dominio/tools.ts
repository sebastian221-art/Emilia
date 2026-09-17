import { query } from "../db/cliente.js";
import { llamarModelo } from "../motor/groq.js";

export async function crearTool(datos: any): Promise<{ id: string }> {
  const nombre = datos.nombre?.trim();
  if (!nombre) throw new Error("La tool necesita un nombre.");
  const [f] = await query<{ id: string }>(
    `INSERT INTO tools (nombre, descripcion, tipo, secciones) VALUES ($1,$2,$3,$4) RETURNING id`,
    [nombre, datos.descripcion || "", datos.tipo || "api_rest", JSON.stringify(datos.secciones || {})]
  );
  return { id: f.id };
}
export async function listarTools() { return query(`SELECT * FROM tools ORDER BY creado_en DESC`); }
export async function obtenerTool(id: string) { const [t] = await query(`SELECT * FROM tools WHERE id=$1`, [id]); return t; }
export async function actualizarTool(id: string, datos: any): Promise<{ id: string }> {
  await query(
    `UPDATE tools SET nombre=$1, descripcion=$2, tipo=$3, secciones=$4, estado_prueba='sin_probar', actualizado_en=now() WHERE id=$5`,
    [datos.nombre, datos.descripcion || "", datos.tipo || "api_rest", JSON.stringify(datos.secciones || {}), id]
  );
  return { id };
}
export async function borrarTool(id: string) { await query(`DELETE FROM tools WHERE id=$1`, [id]); }

/**
 * Exploración profunda del alcance de una tool:
 * 1. Prueba la conexión.
 * 2. Busca un spec OpenAPI/Swagger para descubrir TODOS los endpoints.
 * 3. Le pide a la IA que resuma en lenguaje hablado qué se puede y qué no.
 *
 * Honesto sobre el límite: si no hay OpenAPI, hace un sondeo básico y la IA
 * lo aclara ("esto es lo que encontré, puede haber más").
 */
export async function explorarTool(id: string): Promise<any> {
  const tool = await obtenerTool(id);
  if (!tool) throw new Error("Tool no encontrada");

  const sec = tool.secciones || {};
  const endpoint = sec.conexion?.endpoint;
  let estado = "error", endpoints: string[] = [], specTexto = "", notaSondeo = "";

  // Validaciones claras antes de intentar, para que el error diga QUÉ falta.
  if (tool.tipo !== "api_rest") {
    const cap = { estado: "sin_probar", endpoints: [], resumen: `Esta tool es de tipo '${tool.tipo}'. Por ahora la exploración automática solo funciona con API REST.`, puede: [], no_puede: [], nota: "" };
    await query(`UPDATE tools SET estado_prueba='sin_probar', capacidades=$1 WHERE id=$2`, [JSON.stringify(cap), id]);
    return cap;
  }
  if (!endpoint) {
    const cap = { estado: "error", endpoints: [], resumen: "La tool no tiene un endpoint (URL) configurado. Completá el campo 'URL / endpoint' en la sección Conexión y guardá.", puede: [], no_puede: [], nota: "" };
    await query(`UPDATE tools SET estado_prueba='error', capacidades=$1 WHERE id=$2`, [JSON.stringify(cap), id]);
    return cap;
  }
  // Validar que el endpoint sea una URL válida.
  let origen = "";
  try { origen = new URL(endpoint).origin; }
  catch {
    const cap = { estado: "error", endpoints: [], resumen: `El endpoint "${endpoint}" no es una URL válida. Tiene que empezar con https:// e incluir el dominio completo.`, puede: [], no_puede: [], nota: "" };
    await query(`UPDATE tools SET estado_prueba='error', capacidades=$1 WHERE id=$2`, [JSON.stringify(cap), id]);
    return cap;
  }

  // 1+2: buscar OpenAPI en rutas comunes
  const rutas = ["/openapi.json", "/swagger.json", "/api-docs", "/v1/openapi.json"];
  for (const r of rutas) {
    try {
      const resp = await fetch(origen + r, { signal: AbortSignal.timeout(6000) });
      if (resp.ok) {
        const data = await resp.json().catch(() => null);
        if (data?.paths) { endpoints = Object.keys(data.paths); specTexto = JSON.stringify(data.paths).slice(0, 3000); estado = "ok"; break; }
      }
    } catch { /* sigue */ }
  }

  // Si no hubo spec, sondear el endpoint directo con detalle del resultado.
  if (!endpoints.length) {
    try {
      const resp = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", signal: AbortSignal.timeout(6000) });
      const cuerpo = await resp.text().catch(() => "");
      if (resp.status < 500) {
        estado = "ok";
        notaSondeo = `No hay spec OpenAPI. Probé el endpoint con POST y respondió ${resp.status}. ${resp.status === 401 || resp.status === 403 ? "Ese código sugiere que la conexión funciona pero falta/no sirve la credencial." : "La conexión responde."} El alcance completo no se puede mapear sin documentación.`;
      } else {
        estado = "error";
        notaSondeo = `El endpoint respondió con error ${resp.status}. ${cuerpo.slice(0, 200)}`;
      }
    } catch (e: any) {
      estado = "error";
      const causa = e?.cause?.code || e?.code || e?.name || "";
      notaSondeo = causa === "ENOTFOUND" ? `No se pudo resolver el dominio "${origen}" — revisá que la URL esté bien escrita o tu conexión a internet.`
        : causa === "ABORT_ERR" || e?.name === "TimeoutError" ? "El endpoint no respondió a tiempo (timeout). Puede estar caído o ser muy lento."
        : `No se pudo conectar: ${e?.message || causa || String(e)}`;
    }
  }

  // 3: resumen por IA en lenguaje hablado
  let resumen = "", puede: string[] = [], no_puede: string[] = [];
  try {
    const prompt = `Sos un asistente que explica en español simple qué se puede hacer con una conexión (API/tool).
Tool: "${tool.nombre}" — ${tool.descripcion}
Tipo: ${tool.tipo}. Alcance configurado: ${sec.alcance?.alcance || "lectura"}.
${endpoints.length ? `Endpoints descubiertos: ${endpoints.slice(0, 40).join(", ")}` : "No se descubrieron endpoints (sin OpenAPI)."}
${specTexto ? `Fragmento del spec: ${specTexto}` : ""}
${notaSondeo}

Respondé SOLO JSON: {"resumen":"2-3 frases claras de qué es y qué permite", "puede":["cosa concreta", ...], "no_puede":["cosa concreta", ...]}. Si no hay info suficiente, sé honesto en el resumen.`;
    const r = await llamarModelo([{ role: "user", content: prompt }], []);
    const parsed = JSON.parse(r.texto.replace(/```json|```/g, "").trim());
    resumen = parsed.resumen || "";
    puede = Array.isArray(parsed.puede) ? parsed.puede : [];
    no_puede = Array.isArray(parsed.no_puede) ? parsed.no_puede : [];
  } catch {
    resumen = notaSondeo || "Conexión probada. No se pudo generar un resumen detallado.";
  }

  const capacidades = { estado, endpoints, resumen, puede, no_puede, nota: notaSondeo };
  await query(`UPDATE tools SET estado_prueba=$1, capacidades=$2 WHERE id=$3`, [estado, JSON.stringify(capacidades), id]);
  return capacidades;
}