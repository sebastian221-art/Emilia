// ARCHIVO: src/tools/vigilancia.ts
// ─────────────────────────────────────────────────────────────────────────────
//  TOOLS DE VIGILANCIA (Iris): qué se vigila, cómo va, incidentes, informe de
//  disponibilidad, Railway (servicios, logs, reiniciar y volver atrás con OK) y
//  copias de seguridad.
// ─────────────────────────────────────────────────────────────────────────────
import type { DefTool } from "../registro/tipos.js";
import { query } from "../db/cliente.js";
import { revisarMonitor, disponibilidad, hacerCopia, duracion, DIR_COPIAS, type Monitor } from "../motor/vigilancia.js";
import { listarServicios, buscarServicio, logsServicio, reiniciarServicio, rollbackServicio, deploymentsDe } from "../motor/railway-ops.js";

const MODULO = "vigilancia";
const ICONO: Record<string, string> = { ok: "🟢", lento: "🟡", aviso: "🟠", caido: "🔴", desconocido: "⚪" };
const hace = (iso: string | null) => (iso ? duracion(Date.now() - new Date(iso).getTime()) : "—");

export const vigilanciaAgregar: DefTool = {
  nombre: "vigilancia_agregar", modulo: MODULO,
  descripcion: "Empieza a vigilar algo: una página o API por URL (que responda, que no esté lenta, SSL), un proyecto de este PC (proceso; si cae lo reinicia y si no levanta lo pasa a Sage) o un servicio de Railway (despliegues; si uno falla te ofrece volver a la versión anterior). Avisa una vez cuando cae y una cuando vuelve.",
  parametros: {
    type: "object",
    properties: {
      nombre: { type: "string", minLength: 2, description: "Cómo llamarlo (ej. 'Jelcom API', 'Chatbot Any')." },
      tipo: { type: "string", enum: ["url", "proceso", "railway"] },
      url: { type: "string", description: "Para url: dirección completa (mejor un endpoint de salud)." },
      esperado: { type: "string", description: "Para url: texto que debe aparecer en la respuesta (opcional)." },
      proyecto: { type: "string", description: "Para proceso: proyecto registrado." },
      servicio: { type: "string", description: "Para railway: nombre del servicio o del proyecto en Railway." },
      cada_min: { type: "integer", default: 5, minimum: 1, maximum: 1440 },
      latencia_max_ms: { type: "integer", description: "Para url: a partir de cuánto es 'lento' (si no, lo aprende solo)." },
      critico: { type: "boolean", description: "Sus caídas suenan aunque sea hora de silencio." },
    },
    required: ["nombre", "tipo"],
  },
  riesgo: "escritura", requiereAprobacion: false, timeoutSeg: 90,
  async ejecutar(a) {
    const config: any = {};
    const extra: string[] = [];
    if (a.tipo === "url") { if (!/^https?:\/\//i.test(a.url || "")) return { ok: false, error: "Falta la URL completa (https://…)." }; Object.assign(config, { url: a.url, esperado: a.esperado || undefined, latencia_max_ms: a.latencia_max_ms || undefined }); }
    if (a.tipo === "proceso") { if (!a.proyecto) return { ok: false, error: "¿Qué proyecto? (codigo_listar_proyectos)" }; config.proyecto = a.proyecto; }
    if (a.tipo === "railway") {
      if (!process.env.RAILWAY_TOKEN) return { ok: false, error: "Falta RAILWAY_TOKEN en el .env." };
      const s = await buscarServicio(a.servicio || a.nombre);
      if (!s) return { ok: false, error: `No encuentro "${a.servicio || a.nombre}" en Railway (railway_servicios para ver los que hay).` };
      Object.assign(config, { servicio_id: s.servicio_id, entorno_id: s.entorno_id, servicio: s.servicio, proyecto: s.proyecto, dominio: s.dominio });
      if (s.dominio) {   // de paso, su web
        await query(`INSERT INTO monitores (nombre, tipo, config, cada_seg, fallos_para_alertar, critico) VALUES ($1,'url',$2,$3,2,$4) ON CONFLICT (nombre) DO NOTHING`, [`${a.nombre} (web)`, JSON.stringify({ url: `https://${s.dominio}` }), (a.cada_min || 5) * 60, !!a.critico]);
        extra.push(`También vigilo su web https://${s.dominio}.`);
      }
    }
    const [m] = await query<Monitor>(`INSERT INTO monitores (nombre, tipo, config, cada_seg, fallos_para_alertar, critico) VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (nombre) DO UPDATE SET tipo = EXCLUDED.tipo, config = EXCLUDED.config, cada_seg = EXCLUDED.cada_seg, critico = EXCLUDED.critico, activo = true RETURNING *`,
      [a.nombre, a.tipo, JSON.stringify(config), (a.cada_min || 5) * 60, a.tipo === "railway" ? 1 : 2, !!a.critico]);
    const r = await revisarMonitor(m);
    return { ok: true, datos: m, resumen: `👁 Vigilo *${a.nombre}* cada ${a.cada_min || 5} min. Ahora: ${ICONO[r.estado]} ${r.detalle}${extra.length ? `\n${extra.join(" ")}` : ""}` };
  },
};

export const vigilanciaQuitar: DefTool = {
  nombre: "vigilancia_quitar", modulo: MODULO,
  descripcion: "Deja de vigilar algo (o lo pausa).",
  parametros: { type: "object", properties: { nombre: { type: "string" } }, required: ["nombre"] },
  riesgo: "escritura", requiereAprobacion: false, timeoutSeg: 20,
  async ejecutar(a) {
    const xs = await query(`UPDATE monitores SET activo = false WHERE nombre ILIKE $1 || '%' RETURNING nombre`, [a.nombre]);
    return xs.length ? { ok: true, resumen: `Dejé de vigilar: ${xs.map((x: any) => x.nombre).join(", ")}.` } : { ok: false, error: "No encuentro eso entre lo vigilado." };
  },
};

export const vigilanciaEstado: DefTool = {
  nombre: "vigilancia_estado", modulo: MODULO,
  descripcion: "Cómo está todo lo que vigila Iris (verde/amarillo/rojo, desde cuándo, último dato). Con nombre: el detalle y sus últimas revisiones. Para '¿cómo está todo?', '¿está arriba Jelcom?'.",
  parametros: { type: "object", properties: { nombre: { type: "string" }, revisar_ya: { type: "boolean", description: "Revisarlo ahora mismo en vez de usar la última revisión." } } },
  riesgo: "lectura", requiereAprobacion: false, timeoutSeg: 120,
  async ejecutar(a) {
    if (a.nombre) {
      const [m] = await query<Monitor>(`SELECT * FROM monitores WHERE nombre ILIKE $1 || '%' ORDER BY activo DESC LIMIT 1`, [a.nombre]);
      if (!m) return { ok: false, error: "No vigilo nada con ese nombre." };
      if (a.revisar_ya) await revisarMonitor(m);
      const [x] = await query<Monitor>(`SELECT * FROM monitores WHERE id = $1`, [m.id]);
      const ch = await query(`SELECT t, estado, latencia_ms, detalle FROM monitor_chequeos WHERE monitor_id = $1 ORDER BY t DESC LIMIT 8`, [m.id]);
      return { ok: true, datos: { monitor: x, chequeos: ch }, resumen: `${ICONO[x.estado]} *${x.nombre}* (${x.tipo}) — ${x.estado} desde hace ${hace(x.desde)}\n${x.ultimo_detalle || ""}\nÚltimas revisiones:\n${ch.map((c: any) => `${ICONO[c.estado]} ${new Date(c.t).toLocaleTimeString("es-CO", { timeZone: "America/Bogota", hour: "2-digit", minute: "2-digit" })} ${c.latencia_ms != null ? `${c.latencia_ms} ms · ` : ""}${String(c.detalle).slice(0, 100)}`).join("\n")}` };
    }
    const xs = await query<Monitor>(`SELECT * FROM monitores WHERE activo ORDER BY (estado = 'ok'), sistema, nombre`);
    const malos = xs.filter((x) => x.estado !== "ok" && x.estado !== "desconocido");
    return { ok: true, datos: xs, resumen: `${malos.length ? `⚠️ ${malos.length} con problemas` : "✅ Todo en orden"} (${xs.length} vigilados)\n${xs.map((x) => `${ICONO[x.estado]} ${x.nombre} — ${String(x.ultimo_detalle || "sin revisar").slice(0, 110)}`).join("\n")}` };
  },
};

export const vigilanciaIncidentes: DefTool = {
  nombre: "vigilancia_incidentes", modulo: MODULO,
  descripcion: "Caídas e incidentes de los últimos días: cuándo, cuánto duraron, qué se vio y qué se hizo.",
  parametros: { type: "object", properties: { dias: { type: "integer", default: 7, minimum: 1, maximum: 90 } } },
  riesgo: "lectura", requiereAprobacion: false, timeoutSeg: 20,
  async ejecutar(a) {
    const xs = await query<any>(`SELECT * FROM incidentes WHERE inicio > now() - make_interval(days => $1) ORDER BY inicio DESC LIMIT 30`, [a.dias || 7]);
    return { ok: true, datos: xs, resumen: xs.length ? xs.map((i) => `${i.fin ? "✅" : "🔴"} ${new Date(i.inicio).toLocaleString("es-CO", { timeZone: "America/Bogota", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} · *${i.titulo}* · ${i.fin ? duracion(new Date(i.fin).getTime() - new Date(i.inicio).getTime()) : `sigue (${hace(i.inicio)})`}\n  ${String(i.detalles?.[0]?.detalle || "").slice(0, 150)}${i.acciones?.length ? `\n  Hecho: ${i.acciones.map((x: any) => x.accion).join(" ").slice(0, 200)}` : ""}`).join("\n") : `Sin incidentes en ${a.dias || 7} días. 👌` };
  },
};

export const vigilanciaInforme: DefTool = {
  nombre: "vigilancia_informe", modulo: MODULO,
  descripcion: "Informe de disponibilidad: % del tiempo arriba, tiempos de respuesta (mediana y p95), caídas y minutos caído de cada cosa vigilada en los últimos N días.",
  parametros: { type: "object", properties: { dias: { type: "integer", default: 7, minimum: 1, maximum: 35 } } },
  riesgo: "lectura", requiereAprobacion: false, timeoutSeg: 30,
  async ejecutar(a) {
    const xs = await disponibilidad(a.dias || 7);
    return { ok: true, datos: xs, resumen: `📊 Disponibilidad (${a.dias || 7} días)\n${xs.map((x) => `${ICONO[x.estado] || "⚪"} ${x.nombre}: ${x.pct ?? "—"} %${x.p50 ? ` · ${Math.round(x.p50)} ms (p95 ${Math.round(x.p95 || 0)})` : ""}${x.caidas ? ` · ${x.caidas} incidente(s), ${x.caido_min} min caído` : ""}`).join("\n")}` };
  },
};

export const railwayServicios: DefTool = {
  nombre: "railway_servicios", modulo: MODULO,
  descripcion: "Todos tus servicios en Railway con su último despliegue (estado, cuándo, commit) y su dominio.",
  parametros: { type: "object", properties: {} },
  riesgo: "lectura", requiereAprobacion: false, timeoutSeg: 60,
  async ejecutar() {
    if (!process.env.RAILWAY_TOKEN) return { ok: false, error: "Falta RAILWAY_TOKEN en el .env (token de cuenta)." };
    const xs = await listarServicios();
    const ic = (st?: string) => (st === "SUCCESS" ? "🟢" : st === "FAILED" || st === "CRASHED" ? "🔴" : st === "SLEEPING" ? "💤" : "🟡");
    return { ok: true, datos: xs, resumen: xs.length ? xs.map((s) => `${ic(s.ultimo?.status)} *${s.proyecto}/${s.servicio}* (${s.entorno}) — ${s.ultimo ? `${s.ultimo.status.toLowerCase()} hace ${hace(s.ultimo.createdAt)}${s.ultimo.commit ? ` · "${s.ultimo.commit}"` : ""}` : "sin despliegues"}${s.dominio ? `\n   https://${s.dominio}` : ""}`).join("\n") : "No hay servicios en Railway." };
  },
};

export const railwayLogs: DefTool = {
  nombre: "railway_logs", modulo: MODULO,
  descripcion: "Logs del último despliegue de un servicio de Railway (construcción y ejecución) y sus últimos despliegues.",
  parametros: { type: "object", properties: { servicio: { type: "string" }, lineas: { type: "integer", default: 60, minimum: 10, maximum: 300 } }, required: ["servicio"] },
  riesgo: "lectura", requiereAprobacion: false, timeoutSeg: 60,
  async ejecutar(a) {
    const s = await buscarServicio(a.servicio);
    if (!s) return { ok: false, error: "No encuentro ese servicio en Railway." };
    const [logs, deps] = await Promise.all([logsServicio(s, a.lineas || 60), deploymentsDe(s, 5)]);
    return { ok: true, datos: { servicio: s, despliegues: deps }, resumen: `*${s.proyecto}/${s.servicio}*\nDespliegues:\n${deps.map((d: any) => `• ${d.status.toLowerCase()} hace ${hace(d.createdAt)}${d.commit ? ` · "${d.commit}"` : ""}`).join("\n")}\n\nLogs:\n${logs.slice(-3500) || "(sin logs)"}` };
  },
};

export const railwayReiniciar: DefTool = {
  nombre: "railway_reiniciar", modulo: MODULO,
  descripcion: "Reinicia el servicio de Railway (mismo código, contenedor nuevo). Pide OK.",
  parametros: { type: "object", properties: { servicio: { type: "string" } }, required: ["servicio"] },
  riesgo: "sistema", requiereAprobacion: true, timeoutSeg: 60,
  async ejecutar(a) {
    const s = await buscarServicio(a.servicio);
    if (!s) return { ok: false, error: "No encuentro ese servicio en Railway." };
    await reiniciarServicio(s);
    return { ok: true, resumen: `🔁 Reiniciando ${s.proyecto}/${s.servicio}. En un minuto debería estar arriba.` };
  },
};

export const railwayRollback: DefTool = {
  nombre: "railway_rollback", modulo: MODULO,
  descripcion: "Vuelve un servicio de Railway a su versión anterior que funcionaba (cuando un despliegue nuevo lo rompió). Pide OK. El arreglo de fondo lo hace Sage después.",
  parametros: { type: "object", properties: { servicio: { type: "string" } }, required: ["servicio"] },
  riesgo: "sistema", requiereAprobacion: true, timeoutSeg: 60,
  async ejecutar(a) {
    const s = await buscarServicio(a.servicio);
    if (!s) return { ok: false, error: "No encuentro ese servicio en Railway." };
    const ant = await rollbackServicio(s);
    return { ok: true, resumen: `↩️ ${s.proyecto}/${s.servicio} vuelve a la versión de hace ${hace(ant.createdAt)}${ant.commit ? ` ("${ant.commit}")` : ""}.` };
  },
};

export const copiaAhora: DefTool = {
  nombre: "copia_ahora", modulo: MODULO,
  descripcion: "Hace YA una copia de seguridad de la base de Emilia (además de la diaria automática) y la verifica.",
  parametros: { type: "object", properties: {} },
  riesgo: "escritura", requiereAprobacion: false, timeoutSeg: 900,
  async ejecutar() {
    const r = await hacerCopia();
    return r.ok ? { ok: true, datos: r, resumen: `💾 Copia lista y verificada: ${r.detalle}\n📁 ${r.archivo}` } : { ok: false, error: `La copia falló: ${r.detalle}\n(carpeta: ${DIR_COPIAS()})` };
  },
};

export const toolsVigilancia = [vigilanciaAgregar, vigilanciaQuitar, vigilanciaEstado, vigilanciaIncidentes, vigilanciaInforme, railwayServicios, railwayLogs, railwayReiniciar, railwayRollback, copiaAhora];
