// ARCHIVO: src/skills/guardia.ts
// ─────────────────────────────────────────────────────────────────────────────
//  GUARDIA DE CÓDIGO (Sage) — "si no estoy, revisa cada tanto"
//   guardia_ronda    cada N minutos (disparador cron): revisa todo, anota lo leve,
//                    y lo GRAVE lo arregla de inmediato en un sandbox (tu código
//                    real no se toca), te escribe cómo falló y cómo quedó, y te
//                    pide el OK para subirlo (flujo entregar_cambios).
//   guardia_resumen  una vez al día: lo leve acumulado, lo resuelto y lo pendiente.
//  Regla del jefe: correcciones a proyectos reales solo con su OK → la ronda
//  repara en sandbox y PREGUNTA; nunca sube sola.
// ─────────────────────────────────────────────────────────────────────────────
import { promises as fs } from "node:fs";
import path from "node:path";
import type { DefSkill, ContextoEjecucion } from "../registro/tipos.js";
import { query } from "../db/cliente.js";
import { ejecutarSkill } from "../motor/ejecutor.js";
import { iniciarFlujo } from "../motor/flujo.js";
import { listarProyectos, type Proyecto } from "../dominio/proyectos.js";
import { reiniciarProceso, saludProceso, estadoProceso } from "../motor/runtime.js";
import { SANDBOX_DIR } from "../motor/sandbox.js";
import { listarDespliegues, estadoPublicado } from "../motor/publicar.js";
import { conversacionDelJefe } from "../motor/permisos-codigo.js";
import {
  revisarBase, revisarProceso, revisarAuditoria, registrarRevision, marcarHallazgo, hallazgosAbiertos, huella,
  type ConfigGuardia, type FilaHallazgo, type Hallazgo, type Revision,
} from "../motor/guardia.js";

const MODULO = "guardia";
const MAX_INTENTOS = 2;

async function avisar(texto: string) {
  const jefe = process.env.WHATSAPP_NUMERO_JEFE;
  if (!jefe) return;
  const { enviarTextoWhatsapp } = await import("../whatsapp/enviar.js");
  await enviarTextoWhatsapp(jefe, texto.slice(0, 3800)).catch(() => {});
}

const PARA_JEFE = `

Al final de tu informe agrega una sección que empiece EXACTAMENTE con "PARA SEBASTIÁN:" escrita para leer en WhatsApp, en lenguaje simple y corto:
- Qué estaba fallando y desde cuándo/qué commit (si aplica).
- La causa raíz.
- Qué cambiaste.
- Cómo lo comprobaste: qué fallaba antes y qué pasa ahora (comandos y resultado).
- Qué mejoró y si queda algún riesgo o algo que deba revisar él.`;

function textoParaJefe(informe: string): string {
  const i = informe.search(/PARA SEBASTI[ÁA]N:?/i);
  return (i >= 0 ? informe.slice(i).replace(/^PARA SEBASTI[ÁA]N:?\s*/i, "") : informe).trim().slice(0, 2500);
}

const unir = (...rs: Revision[]): Revision => ({ revisados: rs.flatMap((r) => r.revisados), hallazgos: rs.flatMap((r) => r.hallazgos), notas: rs.flatMap((r) => r.notas) });

let enCurso = false;

export const guardiaRonda: DefSkill = {
  nombre: "guardia_ronda", modulo: MODULO,
  descripcion: "Una ronda de la guardia de código: revisa los proyectos vigilados (commits nuevos en GitHub con build/lint/tests, proceso local, logs, URL de producción, vulnerabilidades una vez al día) y lo publicado en Railway. Lo leve lo anota para el resumen diario; lo GRAVE lo avisa de inmediato, lo arregla en un sandbox, le escribe al jefe cómo falló y cómo quedó, y le pide el OK para subirlo.",
  cuandoUsar: "Lo corre solo el disparador cada N minutos. A mano: 'revisa cómo están mis proyectos', 'pasa la guardia ahora', 'revisa jelcom'.",
  parametros: {
    type: "object",
    properties: {
      proyecto: { type: "string", description: "Revisar solo este (opcional)." },
      forzar: { type: "boolean", default: false, description: "Verificar la rama base aunque no haya commits nuevos." },
      reparar: { type: "boolean", default: true, description: "Arreglar lo grave en sandbox (false = solo revisar y avisar)." },
    },
  },
  riesgo: "escritura", requiereAprobacion: false, timeoutSeg: 7200,
  tools: [],
  async ejecutar(a, ctx) {
    if (enCurso) return { ok: true, resumen: "Ya hay una ronda de guardia en curso; esta se salta." };
    enCurso = true;
    try { return await ronda(a, ctx); } finally { enCurso = false; }
  },
};

async function ronda(a: any, ctx: ContextoEjecucion) {
  const lineas: string[] = [], graves: FilaHallazgo[] = [], resueltosGraves: FilaHallazgo[] = [];
  const filtro = (n: string) => !a.proyecto || n.toLowerCase() === String(a.proyecto).toLowerCase();

  // 1. Proyectos registrados con guardia activa.
  const cfgs = await query<ConfigGuardia & { nombre: string }>(`SELECT g.*, p.nombre FROM guardia_proyectos g JOIN proyectos p ON p.id = g.proyecto_id WHERE g.activo`);
  const proyectos = new Map((await listarProyectos()).map((p) => [p.id, p]));
  for (const cfg of cfgs.filter((c) => filtro(c.nombre))) {
    const p = proyectos.get(cfg.proyecto_id);
    if (!p) continue;
    const partes: Revision[] = [];
    let base: Awaited<ReturnType<typeof revisarBase>> | undefined;
    try { base = await revisarBase(p, cfg, !!a.forzar); partes.push(base); }
    catch (e: any) { partes.push({ revisados: [], hallazgos: [], notas: [`No pude verificar la rama base: ${e.message}`] }); }
    // Caídas y URL de producción las vigila Iris (y escala a Sage); aquí: código y errores en los logs.
    partes.push(await revisarProceso(p, { soloLogs: true }).catch((e) => ({ revisados: [], hallazgos: [], notas: [`Proceso: ${e.message}`] })));
    const copia = base?.copia || path.join(SANDBOX_DIR, p.nombre, "_guardia");
    const tocaAuditoria = !cfg.ultima_auditoria || Date.now() - new Date(cfg.ultima_auditoria).getTime() > 23 * 3600_000;
    let auditado = false;
    if (tocaAuditoria && await fs.access(path.join(copia, "node_modules")).then(() => true, () => false)) { partes.push(await revisarAuditoria(copia)); auditado = true; }
    const rev = unir(...partes);
    const r = await registrarRevision(p.nombre, "proyecto", rev);
    await query(
      `UPDATE guardia_proyectos SET ultima_ronda = now(), ultimo_commit = COALESCE($2, ultimo_commit), lock_hash = COALESCE($3, lock_hash),
         ultima_auditoria = CASE WHEN $4 THEN now() ELSE ultima_auditoria END WHERE proyecto_id = $1`,
      [p.id, base?.commit ?? null, base?.lock ?? null, auditado]);
    graves.push(...r.nuevos.filter((h) => h.severidad === "grave"));
    resueltosGraves.push(...r.resueltos.filter((h) => h.severidad === "grave"));
    lineas.push(`• ${p.nombre}: ${rev.hallazgos.length ? `${rev.hallazgos.filter((h) => h.severidad === "grave").length} grave(s), ${rev.hallazgos.filter((h) => h.severidad === "leve").length} leve(s)` : "sano"}${r.resueltos.length ? `, ${r.resueltos.length} resuelto(s)` : ""}. ${rev.notas.join(" ")}`);
  }

  // 2. Lo que Sage publicó en Railway.
  for (const d of (await listarDespliegues()).filter((x) => x.railway_servicio && filtro(x.nombre))) {
    const h: Hallazgo[] = [];
    let nota = "";
    try {
      const e: any = await estadoPublicado(d.nombre);
      nota = `Railway: ${e.estado}${e.responde ? `, URL ${e.responde.ok ? "ok" : "caída"}` : ""}.`;
      if (["FAILED", "CRASHED"].includes(e.estado)) h.push({ origen: "despliegue", severidad: "grave", titulo: `El despliegue de ${d.nombre} falló (${e.estado})`, detalle: `${d.url}\n${String(e.logs || "").slice(-1800)}`, huella: huella("despliegue", `${e.estado} ${String(e.logs || "").slice(-300)}`) });
      else if (e.responde && !e.responde.ok) h.push({ origen: "url", severidad: "grave", titulo: `${d.nombre} está desplegado pero no responde`, detalle: `${d.url} → ${e.responde.status ?? "sin respuesta"}`, huella: huella("url", `caida ${e.responde.status ?? "red"}`) });
    } catch (e: any) { nota = `No pude consultar Railway: ${e.message}`; }
    const r = await registrarRevision(d.nombre, "publicado", { revisados: nota.startsWith("No pude") ? [] : ["despliegue", "url"], hallazgos: h, notas: [nota] });
    graves.push(...r.nuevos.filter((x) => x.severidad === "grave"));
    resueltosGraves.push(...r.resueltos.filter((x) => x.severidad === "grave"));
    lineas.push(`• ${d.nombre} (publicado): ${h.length ? h.map((x) => x.titulo).join("; ") : "sano"}. ${nota}`);
  }

  // 3. Avisos inmediatos.
  for (const h of resueltosGraves) await avisar(`✅ *Guardia:* ya está bien → ${h.titulo}${h.estado === "resuelto" && h.sandbox_id ? " (el arreglo funcionó)" : ""}.`);
  for (const h of graves) await avisar(`🚨 *Guardia: problema grave en ${h.objetivo}*\n${h.titulo}\n${h.detalle.split("\n").slice(0, 6).join("\n").slice(0, 700)}${a.reparar === false ? "" : "\n\nLo estoy corrigiendo en un sandbox (tu código real no se toca). Te aviso apenas quede."}`);

  // 4. Reparar lo grave (en sandbox; subir solo con tu OK).
  if (a.reparar !== false) {
    const pendientes = (await hallazgosAbiertos()).filter((h) => h.severidad === "grave" && h.estado === "abierto" && h.intentos < MAX_INTENTOS && filtro(h.objetivo));
    const cfgPorNombre = new Map(cfgs.map((c) => [c.nombre, c]));
    const porObjetivo = new Map<string, FilaHallazgo[]>();
    for (const h of pendientes) porObjetivo.set(h.objetivo, [...(porObjetivo.get(h.objetivo) || []), h]);
    let hechas = 0;
    for (const [objetivo, hs] of porObjetivo) {
      if (hechas >= (Number(process.env.GUARDIA_MAX_REPARACIONES) || 2)) break;
      const cfg = cfgPorNombre.get(objetivo);
      if (hs[0].tipo_objetivo === "proyecto" && cfg && !cfg.auto_reparar) continue;
      hechas++;
      lineas.push(await reparar(objetivo, hs, ctx, cfg ? proyectos.get(cfg.proyecto_id) : undefined));
    }
  }
  const resumen = `🛡 Ronda de guardia (${new Date().toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" })}):\n${lineas.join("\n") || "Nada que vigilar todavía (guardia_configurar)."}`;
  await ctx.traza("skill", resumen.slice(0, 1500)).catch(() => {});
  return { ok: true, datos: { graves_nuevos: graves.length, resueltos: resueltosGraves.length }, resumen };
}

/** Arregla los graves de un objetivo en una sola pasada (proyecto: sandbox + pedir OK; publicado: corrige y republica). */
async function reparar(objetivo: string, hs: FilaHallazgo[], ctx: ContextoEjecucion, p?: Proyecto): Promise<string> {
  for (const h of hs) await marcarHallazgo(h.id, { estado: "reparando", sumarIntento: true });
  const sintoma = `[Guardia] Problemas graves detectados en ${objetivo}:\n\n${hs.map((h, i) => `${i + 1}. ${h.titulo}\n${h.detalle.slice(0, 1800)}`).join("\n\n")}`;

  // Proceso caído o sin responder: primero un reinicio (lo más rápido); si vuelve, listo.
  if (p && hs.every((h) => h.origen === "proceso" || h.origen === "salud")) {
    try {
      await reiniciarProceso(p);
      await new Promise((r) => setTimeout(r, 8000));
      const est = await estadoProceso(p), s = await saludProceso(p);
      if (est.estado === "corriendo" && (s.ok || (!p.url_salud && !p.puerto))) {
        for (const h of hs) await marcarHallazgo(h.id, { estado: "abierto", informe: "Reiniciado; volvió a responder." });
        await avisar(`♻ *Guardia:* ${objetivo} estaba caído; lo reinicié y volvió a responder. Si se vuelve a caer, investigo la causa.`);
        return `  ↳ ${objetivo}: reiniciado, volvió.`;
      }
    } catch { /* sigue a reparación */ }
  }

  const r = hs[0].tipo_objetivo === "publicado"
    ? await ejecutarSkill("senior_laboratorio", {
        carpeta: (await query<{ carpeta: string }>(`SELECT carpeta FROM despliegues WHERE nombre = $1`, [objetivo]))[0]?.carpeta,
        objetivo: `${sintoma}\n\nEste proyecto ya está publicado en Railway y está fallando. Encuentra la causa raíz con los logs, corrígelo aquí, pruébalo en local y vuelve a publicarlo con publicar_proyecto (el jefe aprueba por WhatsApp). Confirma que la URL responde.${PARA_JEFE}`,
        enviar_archivos: false,
      }, ctx)
    : await ejecutarSkill("senior_reparar", { proyecto: objetivo, sintoma: `${sintoma}${PARA_JEFE}`, max_iteraciones: 3 }, ctx);

  const d: any = r.datos || {};
  const informe = String(d.informe || r.resumen || "");
  if (r.ok && (d.sandbox_id || hs[0].tipo_objetivo === "publicado")) {
    for (const h of hs) await marcarHallazgo(h.id, { estado: "arreglo_listo", sandbox_id: d.sandbox_id, informe });
    const texto = textoParaJefe(informe);
    if (hs[0].tipo_objetivo === "publicado") {
      await avisar(`🔧 *Guardia: corregí ${objetivo}*\n\n${texto}`);
      return `  ↳ ${objetivo}: corregido y republicado.`;
    }
    await avisar(`🔧 *Guardia: arreglé ${objetivo}* (en sandbox ${String(d.sandbox_id).slice(0, 8)}, todavía NO está subido)\n\n${texto}\n\nAhora te pido el OK para subirlo 👇`);
    const conv = await conversacionDelJefe(ctx.conversacionId).catch(() => null);
    await iniciarFlujo("entregar_cambios", { sandbox_id: d.sandbox_id }, { agenteId: ctx.agenteId ?? null, conversacionId: conv, origen: "agente" })
      .catch((e) => avisar(`⚠ No pude iniciar la entrega del sandbox ${String(d.sandbox_id).slice(0, 8)}: ${e.message}. Dime "entrega el sandbox ${String(d.sandbox_id).slice(0, 8)}".`));
    return `  ↳ ${objetivo}: arreglo listo en sandbox ${String(d.sandbox_id).slice(0, 8)}, esperando tu OK.`;
  }
  const quedan = hs.some((h) => h.intentos + 1 < MAX_INTENTOS);
  for (const h of hs) await marcarHallazgo(h.id, { estado: quedan ? "abierto" : "sin_arreglo", sandbox_id: d.sandbox_id, informe: informe || r.error });
  await avisar(`❌ *Guardia:* no logré un arreglo verificado para ${objetivo}${quedan ? " (lo vuelvo a intentar en la próxima ronda)" : ""}.\n${String(r.error || textoParaJefe(informe)).slice(0, 1200)}${d.sandbox_id ? `\nLo que avancé quedó en el sandbox ${String(d.sandbox_id).slice(0, 8)}.` : ""}`);
  return `  ↳ ${objetivo}: sin arreglo verificado.`;
}

export const guardiaResumen: DefSkill = {
  nombre: "guardia_resumen", modulo: MODULO,
  descripcion: "Resumen diario de la guardia por WhatsApp: fallas leves nuevas (anotadas sin interrumpir), lo grave que sigue pendiente o esperando su OK, y lo que se resolvió en las últimas 24 h.",
  cuandoUsar: "Lo corre solo el disparador diario. A mano: '¿qué ha encontrado la guardia?', 'dame el resumen de fallas'.",
  parametros: { type: "object", properties: { siempre: { type: "boolean", default: false, description: "Mandarlo aunque no haya nada nuevo." } } },
  riesgo: "lectura", requiereAprobacion: false, timeoutSeg: 60,
  tools: [],
  async ejecutar(a) {
    const leves = await query<FilaHallazgo>(`SELECT * FROM guardia_hallazgos WHERE severidad = 'leve' AND estado = 'abierto' ORDER BY objetivo, ultimo_en DESC`);
    const nuevasLeves = leves.filter((h: any) => !h.en_resumen);
    const graves = await query<FilaHallazgo>(`SELECT * FROM guardia_hallazgos WHERE severidad = 'grave' AND estado IN ('abierto','reparando','arreglo_listo','sin_arreglo') ORDER BY ultimo_en DESC`);
    const resueltos = await query<FilaHallazgo>(`SELECT * FROM guardia_hallazgos WHERE estado IN ('resuelto','entregado') AND resuelto_en > now() - interval '24 hours' ORDER BY resuelto_en DESC`);
    if (!a.siempre && !nuevasLeves.length && !graves.length && !resueltos.length) return { ok: true, resumen: "Guardia: nada nuevo hoy, no mando resumen." };
    const ESTADO: Record<string, string> = { abierto: "pendiente", reparando: "reparando", arreglo_listo: "arreglo esperando tu OK", sin_arreglo: "sin arreglo, necesita tu ojo" };
    const por = (xs: FilaHallazgo[]) => { const m = new Map<string, FilaHallazgo[]>(); for (const x of xs) m.set(x.objetivo, [...(m.get(x.objetivo) || []), x]); return m; };
    const partes = [`🛡 *Resumen de la guardia*`];
    if (graves.length) partes.push(`\n🚨 *Grave pendiente*\n${graves.map((h) => `• ${h.objetivo}: ${h.titulo} — ${ESTADO[h.estado] || h.estado}`).join("\n")}`);
    if (leves.length) partes.push(`\n📝 *Leves anotadas* (${nuevasLeves.length} nuevas)\n${[...por(leves)].map(([o, xs]) => `${o}:\n${xs.slice(0, 6).map((h) => `  • ${h.titulo}${h.veces > 1 ? ` (×${h.veces})` : ""}${(h as any).en_resumen ? "" : " 🆕"}`).join("\n")}${xs.length > 6 ? `\n  • y ${xs.length - 6} más` : ""}`).join("\n")}`);
    if (resueltos.length) partes.push(`\n✅ *Resuelto (24 h)*\n${resueltos.slice(0, 10).map((h) => `• ${h.objetivo}: ${h.titulo}`).join("\n")}`);
    if (!graves.length && !leves.length) partes.push(`\nTodo sano. 👌`);
    if (leves.length) partes.push(`\nSi quieres que corrija las leves de un proyecto, dime "arregla las leves de <proyecto>".`);
    await avisar(partes.join("\n"));
    if (nuevasLeves.length) await query(`UPDATE guardia_hallazgos SET en_resumen = true WHERE id = ANY($1::uuid[])`, [nuevasLeves.map((h) => h.id)]);
    return { ok: true, resumen: partes.join("\n") };
  },
};

export const guardiaArreglarLeves: DefSkill = {
  nombre: "guardia_arreglar_leves", modulo: MODULO,
  descripcion: "Corrige en un sandbox las fallas leves anotadas por la guardia para un proyecto (todas juntas), verifica y pide el OK para subirlo. Solo cuando el jefe lo pide.",
  cuandoUsar: "'arregla las leves de X', 'corrige lo que anotó la guardia en X'.",
  parametros: { type: "object", properties: { proyecto: { type: "string", minLength: 2 } }, required: ["proyecto"] },
  riesgo: "escritura", requiereAprobacion: false, timeoutSeg: 5400,
  tools: [],
  async ejecutar(a, ctx) {
    const hs = (await hallazgosAbiertos(a.proyecto)).filter((h) => h.severidad === "leve" && h.estado === "abierto");
    if (!hs.length) return { ok: true, resumen: `No hay fallas leves abiertas en ${a.proyecto}.` };
    const p = (await listarProyectos()).find((x) => x.nombre === a.proyecto);
    if (!p) return { ok: false, error: `${a.proyecto} no es un proyecto registrado (las leves de lo publicado se corrigen con senior_laboratorio).` };
    return { ok: true, resumen: await reparar(a.proyecto, hs, ctx, p) };
  },
};

/**
 * Iris escala aquí cuando algo se cae y no levanta con reinicios: queda como hallazgo
 * grave y Sage lo repara en sandbox, te manda el texto de cómo falló y te pide OK.
 */
export async function escalarASage(proyecto: string, titulo: string, detalle: string): Promise<void> {
  const { crearContexto } = await import("../motor/ejecutor.js");
  const [ag] = await query<{ id: string }>(`SELECT id FROM agentes WHERE lower(nombre) = 'sage' AND estado = 'activo' LIMIT 1`).catch(() => [] as any[]);
  const ctx = crearContexto(ag?.id ?? null, null);
  const r = await registrarRevision(proyecto, "proyecto", { revisados: [], hallazgos: [{ origen: "proceso", severidad: "grave", titulo, detalle, huella: huella("escalado", `${titulo} ${detalle.slice(0, 200)}`) }], notas: [] });
  const h = r.nuevos[0] || (await hallazgosAbiertos(proyecto)).find((x) => x.titulo === titulo && x.estado === "abierto");
  if (!h) return;
  const p = (await listarProyectos()).find((x) => x.nombre === proyecto);
  if (p) await reparar(proyecto, [h], ctx, p);
}

export const skillsGuardia: DefSkill[] = [guardiaRonda, guardiaResumen, guardiaArreglarLeves];
