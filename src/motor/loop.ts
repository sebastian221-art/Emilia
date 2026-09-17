import { query } from "../db/cliente.js";
import { obtenerAgente, skillsDeAgente } from "../dominio/agentes.js";
import { contextoDeAgente } from "../dominio/documentos.js";
import { llamarModelo, MODELO_POR_DEFECTO } from "./groq.js";
import { ejecutarSkill } from "./ejecutor.js";
import type { ChatCompletionMessageParam, ChatCompletionTool } from "groq-sdk/resources/chat/completions";

export interface ResultadoTarea {
  ok: boolean;
  respuesta: string;
  ejecucionId: string;
  turnos: number;
  toolCalls: number;
  mensajesEnviados: string[];  // el texto real que se mandó por WhatsApp (u otra tool de envío)
}

/**
 * Corre una tarea con tool-calling real: las skills del agente se ofrecen al
 * modelo como herramientas; cuando el modelo pide usar una, se ejecuta de
 * verdad (resolviendo su tool y credencial), y el resultado real vuelve al
 * modelo para que decida el próximo paso. Con verificación anti-alucinación.
 */
export async function correrTarea(agenteId: string, mensajeUsuario: string): Promise<ResultadoTarea> {
  const ag = await obtenerAgente(agenteId);
  if (!ag) throw new Error("Agente no encontrado");
  if (ag.estado !== "activo") throw new Error(`El agente está en estado '${ag.estado}'. Activalo para que trabaje.`);
  if (!process.env.GROQ_API_KEY) throw new Error("Falta GROQ_API_KEY en el .env de emilia. Agregala y reiniciá el servidor.");

  const cerebro = ag.cerebro || {};
  const modelo = cerebro.modelo_rapido || MODELO_POR_DEFECTO;
  const maxTurnos = Number(cerebro.turnos) || 20;

  const id = ag.identidad || {};
  const baseSistema = [
    id.mision ? `Misión: ${id.mision}` : "",
    id.personalidad ? `Personalidad: ${id.personalidad}` : "",
    id.terminado ? `Considerás una tarea terminada cuando: ${id.terminado}` : "",
    id.reglas_duras ? `Reglas que NUNCA rompés: ${id.reglas_duras}` : "",
    "Usás tus herramientas de verdad cuando hacen falta. Nunca afirmes haber hecho algo (enviar, consultar) sin haber llamado la herramienta correspondiente. Sé honesto.",
  ].filter(Boolean).join("\n");

  const contexto = await contextoDeAgente(agenteId);
  const sistema = contexto ? `${baseSistema}\n\n=== CONTEXTO / DOCUMENTOS ===\n${contexto}\n=== FIN ===` : baseSistema;

  // Skills del agente → herramientas nativas para el modelo.
  const skills = await skillsDeAgente(agenteId);
  const skillsPorNombre = new Map(skills.map((s) => [s.nombre, s]));
  const tools: ChatCompletionTool[] = skills.map((s) => {
    const sec = s.secciones || {};
    const usaWhatsapp = (sec.recursos?.tools || "").toLowerCase().includes("whatsapp") || (s.descripcion || "").toLowerCase().includes("whatsapp");
    // Para skills de WhatsApp, damos parámetros claros (destino + mensaje) para
    // que el agente no tenga que adivinar el formato — la skill lo arma sola.
    const props = usaWhatsapp
      ? {
          destino: { type: "string", description: "Número de destino con código de país, solo dígitos (ej. 573154559242)." },
          mensaje: { type: "string", description: "El texto del mensaje a enviar." },
        }
      : { entrada: { type: "string", description: "Datos o parámetros para ejecutar la skill." } };
    return {
      type: "function",
      function: {
        name: s.nombre,
        description: `${s.descripcion} (riesgo: ${s.nivel_riesgo})`,
        parameters: { type: "object", properties: props, required: usaWhatsapp ? ["destino", "mensaje"] : [] },
      },
    };
  });

  const [ej] = await query<{ id: string }>(
    `INSERT INTO ejecuciones (agente_id, estado) VALUES ($1, 'en_curso') RETURNING id`, [agenteId]);
  const ejId = ej.id;

  const mensajes: ChatCompletionMessageParam[] = [
    { role: "system", content: sistema },
    { role: "user", content: mensajeUsuario },
  ];

  let turnos = 0, toolCalls = 0, respuestaFinal = "";
  const mensajesEnviados: string[] = [];

  try {
    // Plan previo si está activo.
    if (ag.planeamiento?.activo) {
      const rp = await llamarModelo([{ role: "system", content: `${sistema}\n\nArmá un plan breve (3-6 pasos). Solo el plan.` }, { role: "user", content: mensajeUsuario }], [], modelo);
      await query(`UPDATE ejecuciones SET plan=$1 WHERE id=$2`, [rp.texto, ejId]);
      if (rp.razonamiento && ag.pensar_voz_alta?.visible) await paso(ejId, "pensamiento", rp.razonamiento);
      mensajes.push({ role: "assistant", content: `Mi plan:\n${rp.texto}` });
      mensajes.push({ role: "user", content: "Dale, ejecutá el plan usando tus herramientas de verdad." });
    }

    while (turnos < maxTurnos) {
      turnos++;
      const r = await llamarModelo(mensajes, tools, modelo);
      if (r.razonamiento && ag.pensar_voz_alta?.visible) await paso(ejId, "pensamiento", r.razonamiento);

      // Reconstruir el mensaje del asistente (con tool_calls si los hay).
      const asistente: any = { role: "assistant", content: r.texto || null };
      if (r.toolCalls.length) {
        asistente.tool_calls = r.toolCalls.map((t) => ({
          id: t.id, type: "function", function: { name: t.nombre, arguments: JSON.stringify(t.argumentos) },
        }));
      }
      mensajes.push(asistente);

      // Sin tool calls → el modelo terminó.
      if (!r.toolCalls.length) {
        respuestaFinal = r.texto;

        // Verificación anti-alucinación: si afirma haber hecho acciones pero
        // no llamó ninguna herramienta real, se marca como problema.
        const afirma = /(envi[eé]|mand[eé]|consult[eé]|ejecut|llam[eé])/i.test(respuestaFinal);
        if (afirma && toolCalls === 0 && (ag.reflexion?.rechaza_inventado ?? ag.trazas?.verifica)) {
          await paso(ejId, "verificacion", "El agente afirma haber hecho acciones pero no usó ninguna herramienta real.");
        } else {
          await paso(ejId, "verificacion", `Completado con ${toolCalls} llamada(s) real(es) a herramientas.`);
        }
        break;
      }

      // Ejecutar cada tool call de verdad.
      for (const tc of r.toolCalls) {
        let skill = skillsPorNombre.get(tc.nombre);
        // El modelo a veces alucina el nombre (ej. "whatsapp.send_message" en
        // vez de "responder_whatsapp"). Si el nombre suena a whatsapp/envío,
        // lo redirigimos a la skill de whatsapp real que tenga el agente.
        if (!skill) {
          const n = tc.nombre.toLowerCase();
          if (n.includes("whatsapp") || n.includes("send") || n.includes("mensaje") || n.includes("message")) {
            skill = skills.find((s) => (s.nombre + JSON.stringify(s.secciones)).toLowerCase().includes("whatsapp"));
          }
        }
        if (!skill) {
          mensajes.push({ role: "tool", tool_call_id: tc.id, content: `La herramienta '${tc.nombre}' no existe. Tus herramientas disponibles son: ${skills.map((s) => s.nombre).join(", ")}. Usá una de esas.` });
          continue;
        }
        // Gobernador: chequear riesgo/aprobación.
        const requiereAprob = skill.secciones?.riesgo?.aprobacion;
        if (requiereAprob) {
          await paso(ejId, "aprobacion", `La skill '${skill.nombre}' requiere aprobación. Pausado.`);
          mensajes.push({ role: "tool", tool_call_id: tc.id, content: "Esta acción requiere aprobación humana. Informá al usuario que está pendiente de su OK." });
          continue;
        }
        toolCalls++;
        const resultado = await ejecutarSkill(skill, tc.argumentos);
        await paso(ejId, "tool", `${skill.nombre} → ${JSON.stringify(resultado).slice(0, 300)}`);
        // Si fue un envío exitoso de WhatsApp, capturamos el texto real enviado,
        // para poder mostrarlo en el chat del panel (no el "Listo." de cierre).
        if (resultado?.ok) {
          const textoEnviado = String(tc.argumentos.mensaje ?? tc.argumentos.texto ?? tc.argumentos.message ?? tc.argumentos.entrada ?? "");
          if (textoEnviado) mensajesEnviados.push(textoEnviado);
        }
        mensajes.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(resultado).slice(0, 2000) });
      }
    }

    await query(`UPDATE ejecuciones SET estado='completada', turnos_usados=$1, tool_calls=$2, fin=now() WHERE id=$3`, [turnos, toolCalls, ejId]);
    return { ok: true, respuesta: respuestaFinal || "(sin respuesta de texto)", ejecucionId: ejId, turnos, toolCalls, mensajesEnviados };
  } catch (e) {
    const err = e as any;
    // Detalle completo del error para que las trazas sean útiles de verdad,
    // no un "Connection error" pelado.
    const detalle = [
      err?.message ? `Mensaje: ${err.message}` : "",
      err?.status ? `Status: ${err.status}` : "",
      err?.code ? `Código: ${err.code}` : "",
      err?.error?.message ? `Detalle API: ${err.error.message}` : "",
      err?.cause?.code ? `Causa: ${err.cause.code}` : "",
    ].filter(Boolean).join(" · ") || String(e);
    await paso(ejId, "error", detalle);
    await query(`UPDATE ejecuciones SET estado='fallida', fin=now() WHERE id=$1`, [ejId]);
    return { ok: false, respuesta: `Hubo un error: ${detalle}`, ejecucionId: ejId, turnos, toolCalls, mensajesEnviados };
  }
}

async function paso(ejecucionId: string, tipo: string, detalle: string) {
  await query(`INSERT INTO pasos (ejecucion_id, tipo, detalle) VALUES ($1,$2,$3)`, [ejecucionId, tipo, (detalle || "").slice(0, 2000)]);
}