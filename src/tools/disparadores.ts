// ARCHIVO: src/tools/disparadores.ts
import { randomBytes } from "node:crypto";
import type { DefTool } from "../registro/tipos.js";
import { registro } from "../registro/registro.js";
import { listarDisparadores, obtenerDisparador, crearDisparador, cambiarEstadoDisparador, borrarDisparador, eventosRecientes } from "../dominio/disparadores.js";
import { emitir } from "../motor/eventos.js";
import { query } from "../db/cliente.js";

const MODULO = "disparador";
const EVENTOS_SISTEMA = ["proyecto.caido (proyecto)", "flujo.completado / flujo.fallido (flujo, ejecucion_id, error)", "aprobacion.pendiente (tool, agente)", "webhook.<nombre> (lo que mande el remitente)", "cron.<nombre> (hora)"];

export const disparadorCrear: DefTool = {
  nombre: "disparador_crear", modulo: MODULO,
  descripcion: `Crea una automatización: cuando pasa algo (evento del sistema, webhook externo o un horario), arranca un flujo, una skill o le da una orden a un agente. Requiere aprobación. Eventos del sistema: ${EVENTOS_SISTEMA.join("; ")}. En args/instruccion podés usar {{datos.campo}}, {{evento}}, {{fecha}}.`,
  parametros: {
    type: "object",
    properties: {
      nombre: { type: "string", description: "snake_case.", minLength: 2 },
      descripcion: { type: "string" },
      tipo: { type: "string", enum: ["evento", "cron", "webhook"] },
      patron: { type: "string", description: "Para tipo evento: nombre o patrón con * (ej. 'proyecto.caido', 'webhook.*', 'flujo.fallido')." },
      cada_minutos: { type: "integer", description: "Para tipo cron: cada N minutos.", minimum: 1 },
      expresion_cron: { type: "string", description: "Para tipo cron: expresión de 5 campos (min hora dia mes diasemana), ej. '0 8 * * 1-5' = 8:00 de lunes a viernes, hora Colombia." },
      accion_tipo: { type: "string", enum: ["flujo", "skill", "agente"] },
      accion_nombre: { type: "string", description: "Nombre del flujo/skill, o del agente si accion_tipo=agente.", minLength: 2 },
      accion_args: { type: "object", description: "Argumentos del flujo/skill (con plantillas)." },
      accion_instruccion: { type: "string", description: "Para accion_tipo=agente: la orden en lenguaje natural (con plantillas)." },
    },
    required: ["nombre", "tipo", "accion_tipo", "accion_nombre"],
  },
  riesgo: "sistema", requiereAprobacion: true,
  async ejecutar(a) {
    const config: Record<string, any> = {};
    if (a.tipo === "evento") { if (!a.patron) return { ok: false, error: "Tipo evento necesita 'patron'." }; config.patron = a.patron; }
    if (a.tipo === "cron") { if (!a.cada_minutos && !a.expresion_cron) return { ok: false, error: "Tipo cron necesita 'cada_minutos' o 'expresion_cron'." }; if (a.cada_minutos) config.cada_minutos = a.cada_minutos; if (a.expresion_cron) config.expresion = a.expresion_cron; }
    if (a.tipo === "webhook") config.token = randomBytes(12).toString("hex");
    let agenteId: string | null = null;
    if (a.accion_tipo === "agente") {
      const [ag] = await query<any>(`SELECT id FROM agentes WHERE lower(nombre)=lower($1)`, [a.accion_nombre]);
      if (!ag) return { ok: false, error: `Agente ${a.accion_nombre} no existe.` }; agenteId = ag.id;
      if (!a.accion_instruccion) return { ok: false, error: "Para accion_tipo=agente pasá 'accion_instruccion'." };
    } else if (a.accion_tipo === "flujo" && !registro.flujo(a.accion_nombre)) return { ok: false, error: `Flujo ${a.accion_nombre} no registrado.` };
    else if (a.accion_tipo === "skill" && !registro.skill(a.accion_nombre)) return { ok: false, error: `Skill ${a.accion_nombre} no registrada.` };
    const d = await crearDisparador({ nombre: a.nombre, descripcion: a.descripcion || "", tipo: a.tipo, config, accion: { tipo: a.accion_tipo, nombre: a.accion_nombre, args: a.accion_args, instruccion: a.accion_instruccion }, agente_id: agenteId } as any);
    const extra = a.tipo === "webhook" ? ` URL: POST ${process.env.URL_PUBLICA || "http://localhost:3000"}/api/eventos/${d.nombre}?token=${config.token} (o firmá con X-Hub-Signature-256 si configurás 'secreto').` : "";
    return { ok: true, datos: { ...d, url_webhook: a.tipo === "webhook" ? `/api/eventos/${d.nombre}?token=${config.token}` : undefined }, resumen: `Disparador ${d.nombre} (${d.tipo}) creado → ${a.accion_tipo} ${a.accion_nombre}.${extra}` };
  },
};

export const disparadorListar: DefTool = {
  nombre: "disparador_listar", modulo: MODULO,
  descripcion: "Lista los disparadores (automatizaciones) con su tipo, condición, acción, estado y último disparo.",
  parametros: { type: "object", properties: {}, required: [] }, riesgo: "lectura", requiereAprobacion: false,
  async ejecutar() {
    const l = await listarDisparadores();
    return { ok: true, datos: l, resumen: l.length ? l.map((d) => `${d.estado === "activo" ? "🟢" : "⚪"} ${d.nombre} [${d.tipo}: ${d.config.patron || d.config.expresion || (d.config.cada_minutos ? "cada " + d.config.cada_minutos + " min" : "webhook")}] → ${d.accion.tipo} ${d.accion.nombre} · ${d.veces} veces${d.ultimo_resultado ? " · último: " + d.ultimo_resultado.slice(0, 60) : ""}`).join("\n") : "No hay disparadores." };
  },
};

export const disparadorEstado: DefTool = {
  nombre: "disparador_estado", modulo: MODULO,
  descripcion: "Pausa, reactiva o elimina un disparador.",
  parametros: { type: "object", properties: { nombre: { type: "string", minLength: 2 }, accion: { type: "string", enum: ["pausar", "activar", "eliminar"] } }, required: ["nombre", "accion"] },
  riesgo: "escritura", requiereAprobacion: false,
  async ejecutar(a) {
    const d = await obtenerDisparador(a.nombre); if (!d) return { ok: false, error: "No existe." };
    if (a.accion === "eliminar") { await borrarDisparador(d.id); return { ok: true, resumen: `Disparador ${d.nombre} eliminado.` }; }
    await cambiarEstadoDisparador(d.id, a.accion === "pausar" ? "pausado" : "activo");
    return { ok: true, resumen: `Disparador ${d.nombre} ${a.accion === "pausar" ? "pausado" : "activo"}.` };
  },
};

export const eventoEmitir: DefTool = {
  nombre: "evento_emitir", modulo: "evento",
  descripcion: "Emite un evento manualmente (para probar disparadores o encadenar acciones). Devuelve cuántos disparadores reaccionaron.",
  parametros: { type: "object", properties: { nombre: { type: "string", minLength: 2 }, datos: { type: "object" } }, required: ["nombre"] },
  riesgo: "ejecucion", requiereAprobacion: false,
  async ejecutar(a) { const n = await emitir(a.nombre, a.datos || {}, "manual"); return { ok: true, datos: { disparados: n }, resumen: `Evento ${a.nombre} emitido; ${n} disparador(es) reaccionaron.` }; },
};

export const eventosVer: DefTool = {
  nombre: "evento_recientes", modulo: "evento",
  descripcion: "Últimos eventos ocurridos en el sistema (nombre, datos, origen, hora).",
  parametros: { type: "object", properties: { limite: { type: "integer", default: 20, minimum: 1, maximum: 100 } }, required: [] },
  riesgo: "lectura", requiereAprobacion: false,
  async ejecutar(a) { const l = await eventosRecientes(a.limite || 20); return { ok: true, datos: l, resumen: l.length ? l.map((e: any) => `${new Date(e.creado_en).toLocaleTimeString("es-CO")} ${e.nombre} (${e.origen}) ${JSON.stringify(e.datos).slice(0, 80)}`).join("\n") : "Sin eventos." }; },
};

export const toolsDisparadores: DefTool[] = [disparadorCrear, disparadorListar, disparadorEstado, eventoEmitir, eventosVer];