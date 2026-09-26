// ARCHIVO: src/tools/empresa.ts
// ─────────────────────────────────────────────────────────────────────────────
//  TOOLS DE EMPRESA — la administradora crea agentes y puestos por chat
//  Un puesto tiene un agente encargado, opcionalmente un proyecto o una
//  campaña de Jelcom, responsabilidades y flujos permanentes (vigilancia,
//  auditoría, campañas). Lo que el agente del puesto reporte llega por la
//  cadena hasta el jefe (WhatsApp). Crear agentes y puestos requiere aprobación.
// ─────────────────────────────────────────────────────────────────────────────

import type { DefTool } from "../registro/tipos.js";
import { query } from "../db/cliente.js";
import { registro } from "../registro/registro.js";
import { crearAgente, actualizarAgente, asignarTools, asignarSkills, asignarFlujos } from "../dominio/agentes.js";
import { obtenerProyecto } from "../dominio/proyectos.js";
import { listarPuestos, obtenerPuesto, crearPuesto, actualizarPuesto, borrarPuesto, administradora } from "../dominio/empresa.js";
import { obtenerOCrearConversacion } from "../dominio/conversaciones.js";
import { iniciarFlujo, cancelarFlujo, flujosActivos } from "../motor/flujo.js";

const MODULO = "empresa";

/** Paquetes de capacidades para armar agentes rápido. */
const PAQUETES: Record<string, { tools: (n: string) => boolean; skills: (n: string) => boolean; flujos: (n: string) => boolean }> = {
  jelcom:     { tools: (n) => n.startsWith("jelcom_") || n.startsWith("whatsapp_") || n === "sistema_ahora", skills: (n) => n.startsWith("jelcom_"), flujos: (n) => n.startsWith("jelcom_") },
  codigo:     { tools: (n) => n.startsWith("codigo_") || n.startsWith("runtime_") || n.startsWith("proyecto_") || n.startsWith("github_") || n.startsWith("conocimiento_") || n.startsWith("observar_") || n === "whatsapp_enviar_texto", skills: (n) => n.startsWith("senior_"), flujos: (n) => n.startsWith("senior_") || n.startsWith("proyecto_") },
  vigilancia: { tools: (n) => n.startsWith("runtime_") || n.startsWith("codigo_") || n.startsWith("proyecto_instalar") || n.startsWith("flujo_") || n === "whatsapp_enviar_texto", skills: (n) => n.startsWith("vigilar_") || n === "senior_reparar", flujos: (n) => n.startsWith("vigilar_") },
  vision_voz: { tools: (n) => n.startsWith("vision_") || n.startsWith("voz_"), skills: () => false, flujos: () => false },
  pc:         { tools: (n) => n.startsWith("pc_") || n.startsWith("navegador_"), skills: () => false, flujos: () => false },
  memoria:    { tools: (n) => n.startsWith("memoria_"), skills: () => false, flujos: () => false },
  automatizacion: { tools: (n) => n.startsWith("disparador_") || n.startsWith("evento_"), skills: () => false, flujos: () => false },
  automejora: { tools: (n) => n.startsWith("registro_"), skills: (n) => n === "senior_crear_capacidad", flujos: (n) => n.startsWith("capacidad_") },
  todo:       { tools: (n) => !n.startsWith("sistema_") || n === "sistema_ahora", skills: (n) => !n.startsWith("sistema_"), flujos: (n) => !n.startsWith("sistema_") },
};

async function idsDe(tabla: string, nombres: string[]) {
  if (!nombres.length) return [];
  return (await query<{ id: string }>(`SELECT id FROM ${tabla} WHERE nombre = ANY($1::text[]) AND activo = true`, [nombres])).map((r) => r.id);
}
async function agentePorNombre(n: string) { const [a] = await query<any>(`SELECT * FROM agentes WHERE lower(nombre)=lower($1) OR id::text=$1 LIMIT 1`, [n]); return a; }

export const empresaCrearAgente: DefTool = {
  nombre: "empresa_crear_agente", modulo: MODULO,
  descripcion: "Crea un agente nuevo (trabajador) con identidad propia y paquetes de capacidades: jelcom, codigo, vigilancia, vision_voz, pc, todo. Requiere aprobación. Después se le asigna un puesto con empresa_crear_puesto.",
  parametros: {
    type: "object",
    properties: {
      nombre: { type: "string", description: "Nombre del agente (ej. Ram).", minLength: 2 },
      mision: { type: "string", description: "Para qué existe, concreto.", minLength: 10 },
      personalidad: { type: "string", description: "Cómo es y cómo habla (marcado, con carácter)." },
      paquetes: { type: "array", items: { type: "string", enum: ["jelcom", "codigo", "vigilancia", "vision_voz", "pc", "memoria", "automatizacion", "automejora", "todo"] }, description: "Capacidades que recibe." },
      reglas_duras: { type: "string" },
      tipo: { type: "string", enum: ["trabajo", "administrador", "companero"], default: "trabajo" },
      modelo: { type: "string", description: "Modelo Groq (opcional)." },
    },
    required: ["nombre", "mision", "paquetes"],
  },
  riesgo: "sistema", requiereAprobacion: true, timeoutSeg: 60,
  async ejecutar(a) {
    if (await agentePorNombre(a.nombre)) return { ok: false, error: `Ya existe un agente llamado ${a.nombre}.` };
    const paquetes: string[] = (a.paquetes || []).filter((p: string) => PAQUETES[p]);
    const tools = registro.tools().map((t) => t.nombre).filter((n) => paquetes.some((p) => PAQUETES[p].tools(n)));
    const skills = registro.skills().map((s) => s.nombre).filter((n) => paquetes.some((p) => PAQUETES[p].skills(n)));
    const flujos = registro.flujos().map((f) => f.nombre).filter((n) => paquetes.some((p) => PAQUETES[p].flujos(n)));
    const { id } = await crearAgente({
      identidad: { nombre: a.nombre, mision: a.mision, personalidad: a.personalidad || "", reglas_duras: a.reglas_duras || "Nunca inventar resultados. Verificar con herramientas. Acciones sensibles solo con aprobación (el sistema la pide).", terminado: "Cuando verificaste con datos reales y reportaste el resultado concreto." },
      tipo: a.tipo || "trabajo",
      cerebro: { modelo_rapido: a.modelo || "openai/gpt-oss-120b", turnos: 25, temperatura: 0.3 },
      memoria: { modo: "por_sesion", ventana: 24 }, planeamiento: { activo: false }, pensar_voz_alta: { visible: true },
      gobierno: { aprobar_por_whatsapp: true, max_tool_calls: 40 }, trazas: { verifica: true },
      canales: { items: ["panel"] }, conocimiento: { items: [] },
    });
    await actualizarAgente(id, { estado: "activo" });
    await asignarTools(id, await idsDe("tools", tools)); await asignarSkills(id, await idsDe("skills", skills)); await asignarFlujos(id, await idsDe("flujos", flujos));
    return { ok: true, datos: { agente_id: id, nombre: a.nombre, tools: tools.length, skills: skills.length, flujos: flujos.length }, resumen: `Agente ${a.nombre} creado y activo con ${tools.length} tools, ${skills.length} skills y ${flujos.length} flujos (paquetes: ${paquetes.join(", ")}).` };
  },
};

export const empresaCrearPuesto: DefTool = {
  nombre: "empresa_crear_puesto", modulo: MODULO,
  descripcion: "Crea (o actualiza) un puesto de trabajo y le asigna un agente encargado, un proyecto y/o una campaña de Jelcom, y sus responsabilidades. Requiere aprobación. Los flujos permanentes se agregan con empresa_programar.",
  parametros: {
    type: "object",
    properties: {
      nombre: { type: "string", description: "slug (ej. cajasan).", minLength: 2 },
      titulo: { type: "string", description: "Título del puesto.", minLength: 3 },
      agente: { type: "string", description: "Nombre del agente que lo ocupa.", minLength: 2 },
      descripcion: { type: "string" },
      responsabilidades: { type: "string", description: "Qué debe hacer y vigilar, en lenguaje natural." },
      proyecto: { type: "string", description: "Proyecto registrado (opcional)." },
      campana_jelcom_id: { type: "integer", description: "Campaña de Jelcom que opera (opcional)." },
      reporta_a: { type: "string", description: "Agente al que reporta (por defecto la administradora)." },
    },
    required: ["nombre", "titulo", "agente"],
  },
  riesgo: "sistema", requiereAprobacion: true, timeoutSeg: 60,
  async ejecutar(a, ctx) {
    const ag = await agentePorNombre(a.agente);
    if (!ag) return { ok: false, error: `No existe el agente ${a.agente}. Crealo con empresa_crear_agente.` };
    const admin = a.reporta_a ? await agentePorNombre(a.reporta_a) : await administradora();
    const proy = a.proyecto ? await obtenerProyecto(a.proyecto) : undefined;
    if (a.proyecto && !proy) return { ok: false, error: `Proyecto ${a.proyecto} no registrado.` };
    const p = await crearPuesto({ nombre: a.nombre, titulo: a.titulo, descripcion: a.descripcion, agente_id: ag.id, reporta_a: admin?.id ?? null, proyecto_id: proy?.id ?? null, campana_jelcom_id: a.campana_jelcom_id, responsabilidades: a.responsabilidades });
    // Las responsabilidades pasan a la identidad del agente para que las tenga siempre presentes.
    const idn = { ...(ag.identidad || {}) };
    idn.mision = `${idn.mision || ""}\nPuesto: ${a.titulo}${proy ? ` (proyecto ${proy.nombre})` : ""}${a.campana_jelcom_id ? ` (campaña Jelcom #${a.campana_jelcom_id})` : ""}. Responsabilidades: ${a.responsabilidades || a.descripcion || ""}. Reportás a ${admin?.nombre || "la administradora"}, y a través de ella a Sebastián.`.trim();
    await actualizarAgente(ag.id, { identidad: idn });
    await ctx.traza("tool", `puesto ${p.nombre} → ${ag.nombre}`);
    return { ok: true, datos: { puesto_id: p.id, nombre: p.nombre, agente: ag.nombre, reporta_a: admin?.nombre }, resumen: `Puesto ${p.titulo} (${p.nombre}) creado. Encargado: ${ag.nombre}; reporta a ${admin?.nombre || "—"}.${proy ? ` Proyecto: ${proy.nombre}.` : ""}${a.campana_jelcom_id ? ` Campaña Jelcom #${a.campana_jelcom_id}.` : ""}` };
  },
};

export const empresaProgramar: DefTool = {
  nombre: "empresa_programar", modulo: MODULO,
  descripcion: "Le asigna a un puesto un flujo PERMANENTE (vigilar_proyecto, senior_auditoria_periodica, jelcom_campana_por_whatsapp, etc.) que corre bajo su agente. Lo que el flujo reporte llega al jefe por WhatsApp con el nombre del puesto.",
  parametros: { type: "object", properties: { puesto: { type: "string", minLength: 2 }, flujo: { type: "string", description: "Nombre del flujo registrado.", minLength: 3 }, args: { type: "object", description: "Argumentos del flujo." } }, required: ["puesto", "flujo"] },
  riesgo: "ejecucion", requiereAprobacion: false, timeoutSeg: 120,
  async ejecutar(a) {
    const p = await obtenerPuesto(a.puesto);
    if (!p) return { ok: false, error: `Puesto ${a.puesto} no existe.` };
    if (!p.agente_id) return { ok: false, error: "El puesto no tiene agente asignado." };
    if (!registro.flujo(a.flujo)) return { ok: false, error: `Flujo ${a.flujo} no registrado.` };
    // El puesto reporta al canal del jefe con la administradora (cadena: puesto → admin → jefe).
    const admin = await administradora();
    const jefe = (process.env.WHATSAPP_NUMERO_JEFE || "").replace(/\D/g, "");
    let convPadre: string | null = null;
    if (admin && jefe) convPadre = (await obtenerOCrearConversacion(admin.id, "whatsapp", jefe)).id;
    const convPuesto = convPadre ? await obtenerOCrearConversacion(p.agente_id, "delegacion", convPadre) : null;
    const args = { ...(a.args || {}) };
    if (p.proyecto && !("proyecto" in args)) (args as any).proyecto = p.proyecto;
    const r = await iniciarFlujo(a.flujo, args, { agenteId: p.agente_id, conversacionId: convPuesto?.id ?? null, origen: "agente" });
    const flujos = [...(p.flujos || []), { flujo: a.flujo, args, ejecucion_id: r.ejecucionId, estado: r.estado }];
    await actualizarPuesto(p.id, { flujos });
    return { ok: true, datos: { ejecucion_id: r.ejecucionId, estado: r.estado }, resumen: `Flujo ${a.flujo} programado en el puesto ${p.nombre} (ejecución ${r.ejecucionId.slice(0, 8)}…, estado ${r.estado}).` };
  },
};

export const empresaOrganigrama: DefTool = {
  nombre: "empresa_organigrama", modulo: MODULO,
  descripcion: "Muestra la empresa: administradora, agentes, puestos (encargado, proyecto/campaña, responsabilidades), y qué flujos permanentes tiene cada uno y en qué estado.",
  parametros: { type: "object", properties: {}, required: [] }, riesgo: "lectura", requiereAprobacion: false,
  async ejecutar() {
    const admin = await administradora();
    const puestos = await listarPuestos();
    const activos = await flujosActivos();
    const agentes = await query<any>(`SELECT id, nombre, tipo, estado, es_administrador FROM agentes ORDER BY creado_en`);
    const datos = {
      administradora: admin?.nombre || null,
      agentes: agentes.map((x) => ({ nombre: x.nombre, tipo: x.tipo, estado: x.estado, puesto: puestos.find((p) => p.agente_id === x.id)?.nombre || null })),
      puestos: puestos.map((p) => ({ nombre: p.nombre, titulo: p.titulo, estado: p.estado, agente: p.agente, proyecto: p.proyecto, campana_jelcom_id: p.campana_jelcom_id, responsabilidades: p.responsabilidades, flujos: (p.flujos || []).map((f) => ({ ...f, activo: activos.some((x) => x.id === f.ejecucion_id) })) })),
    };
    const lineas = [`Administradora: ${datos.administradora || "—"}`, ...datos.puestos.map((p) => `• ${p.titulo} (${p.nombre}) → ${p.agente || "sin agente"}${p.proyecto ? ` · proyecto ${p.proyecto}` : ""}${p.campana_jelcom_id ? ` · campaña #${p.campana_jelcom_id}` : ""} · ${p.estado}\n   flujos: ${p.flujos.length ? p.flujos.map((f) => `${f.flujo}${f.activo ? " (activo)" : " (detenido)"}`).join(", ") : "ninguno"}`)];
    if (!datos.puestos.length) lineas.push("Sin puestos todavía.");
    return { ok: true, datos, resumen: lineas.join("\n") };
  },
};

export const empresaPausarPuesto: DefTool = {
  nombre: "empresa_pausar_puesto", modulo: MODULO,
  descripcion: "Pausa un puesto: cancela sus flujos permanentes (se pueden reprogramar después).",
  parametros: { type: "object", properties: { puesto: { type: "string", minLength: 2 } }, required: ["puesto"] },
  riesgo: "escritura", requiereAprobacion: false,
  async ejecutar(a) {
    const p = await obtenerPuesto(a.puesto);
    if (!p) return { ok: false, error: `Puesto ${a.puesto} no existe.` };
    let n = 0;
    for (const f of p.flujos || []) { try { await cancelarFlujo(f.ejecucion_id, `Puesto ${p.nombre} pausado.`); n++; } catch { /* ya terminado */ } }
    await actualizarPuesto(p.id, { estado: "pausado", flujos: (p.flujos || []).map((f) => ({ ...f, estado: "cancelado" })) });
    return { ok: true, resumen: `Puesto ${p.nombre} pausado; ${n} flujo(s) detenido(s).` };
  },
};

export const empresaEliminarPuesto: DefTool = {
  nombre: "empresa_eliminar_puesto", modulo: MODULO,
  descripcion: "Elimina un puesto (cancela sus flujos; el agente sigue existiendo). Requiere aprobación.",
  parametros: { type: "object", properties: { puesto: { type: "string", minLength: 2 } }, required: ["puesto"] },
  riesgo: "sistema", requiereAprobacion: true,
  async ejecutar(a) {
    const p = await obtenerPuesto(a.puesto);
    if (!p) return { ok: false, error: `Puesto ${a.puesto} no existe.` };
    for (const f of p.flujos || []) { try { await cancelarFlujo(f.ejecucion_id, "Puesto eliminado."); } catch { /* nada */ } }
    await borrarPuesto(p.id);
    return { ok: true, resumen: `Puesto ${p.nombre} eliminado.` };
  },
};

export const toolsEmpresa: DefTool[] = [empresaCrearAgente, empresaCrearPuesto, empresaProgramar, empresaOrganigrama, empresaPausarPuesto, empresaEliminarPuesto];