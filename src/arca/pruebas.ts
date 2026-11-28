// ARCHIVO: src/arca/pruebas.ts
// ─────────────────────────────────────────────────────────────────────────────
//  ARCA · LA PRUEBA FINAL — prueba cada parte DE VERDAD y le pone nota (0-10).
//  · Motor: Groq y Claude responden (y cuánto tardan).
//  · Memoria: guardar y recordar por significado, y el cifrado de lo personal.
//  · WhatsApp: el número, el webhook y (si dices) un mensaje real a ti.
//  · Seguridad y autonomía: la auditoría, el vigía, las copias.
//  · Cada agente: un caso típico en modo simulado (nada sale de verdad): ¿usó
//    la herramienta correcta, respondió, cuánto tardó?
//  Lo que falla queda con «qué hacer». Nada se arregla solo: si es código, Arca
//  te ofrece pasárselo a Sage y tú decides.
// ─────────────────────────────────────────────────────────────────────────────
import { query } from "../db/cliente.js";

export interface Prueba { nombre: string; ok: boolean; detalle: string; ms?: number }
export interface Componente { id: string; nombre: string; nota: number; pruebas: Prueba[]; arreglo?: string }
export interface InformePruebas { nota: number; componentes: Componente[]; texto: string; id?: string }

async function medir(nombre: string, f: () => Promise<string>): Promise<Prueba> {
  const t = Date.now();
  try { const d = await f(); return { nombre, ok: true, detalle: d, ms: Date.now() - t }; }
  catch (e: any) { return { nombre, ok: false, detalle: String(e?.message || e).slice(0, 200), ms: Date.now() - t }; }
}
const nota = (ps: Prueba[]) => (ps.length ? Math.round((ps.filter((p) => p.ok).length / ps.length) * 100) / 10 : 0);

// ── Motor ──
async function motor(): Promise<Componente> {
  const { llamarModelo } = await import("../motor/groq.js");
  const ps: Prueba[] = [];
  ps.push(await medir("Groq responde", async () => {
    const r = await llamarModelo([{ role: "user", content: "Responde solo: OK" }], [], { modelo: process.env.MODELO_POR_DEFECTO || "openai/gpt-oss-120b", temperatura: 0 });
    if (!/ok/i.test(r.texto)) throw new Error(`respondió «${r.texto.slice(0, 40)}»`); return "OK";
  }));
  if (process.env.ANTHROPIC_API_KEY) {
    for (const m of ["claude:haiku", "claude:sonnet"]) ps.push(await medir(`${m.split(":")[1]} responde`, async () => {
      const r = await llamarModelo([{ role: "user", content: "Responde solo: OK" }], [], { modelo: m, temperatura: 0 });
      if (!/ok/i.test(r.texto)) throw new Error(`respondió «${r.texto.slice(0, 40)}»`); return r.uso?.modelo || "OK";
    }));
  } else ps.push({ nombre: "Claude", ok: false, detalle: "Sin ANTHROPIC_API_KEY: Emilia, el alma y Sage van con Groq (más flojo)." });
  ps.push(await medir("Plan B (si un proveedor falla, usa el otro)", async () => {
    if (!process.env.GROQ_API_KEY || !process.env.ANTHROPIC_API_KEY) throw new Error("con una sola llave no hay a quién pasarse si ese proveedor se cae");
    if (process.env.MODELO_RESPALDO_CLAUDE === "no") throw new Error("MODELO_RESPALDO_CLAUDE=no lo desactiva");
    return `Claude → ${process.env.MODELO_RESPALDO_GROQ || "Groq"} · Groq → ${process.env.MODELO_RESPALDO_CLAUDE || "claude:haiku"}`;
  }));
  for (const p of ps) if (p.ok && (p.ms || 0) > 20_000) { p.ok = false; p.detalle = `respondió, pero tardó ${Math.round(p.ms! / 1000)} s`; }
  return { id: "motor", nombre: "Motor (modelos)", nota: nota(ps), pruebas: ps, arreglo: ps.some((p) => !p.ok) ? "Revisa las llaves con «Arca, revisa el cerebro»." : undefined };
}

// ── Memoria ──
async function memoria(): Promise<Componente> {
  const ps: Prueba[] = [];
  const C = await import("../motor/cerebro.js");
  const marca = `arca-${Date.now()}`;
  ps.push(await medir("Guardar y recordar por significado", async () => {
    await C.guardarRecuerdo({ titulo: `Prueba de Arca ${marca}`, contenido: `El taller de Arca tiene una llave inglesa azul número ${marca}.`, espacio: "general", clase: "hecho", etiquetas: ["arca-prueba"] } as any);
    const rs = await C.recordar("¿de qué color es la llave inglesa del taller de Arca?", { espacios: ["general"], max: 5 });
    if (!rs.some((r: any) => String(r.titulo || "").includes(marca))) throw new Error("guardó pero no lo encontró por significado");
    return "lo encontró";
  }));
  ps.push(await medir("pgvector activo", async () => { const [e] = await query<any>(`SELECT extversion FROM pg_extension WHERE extname='vector'`); if (!e) throw new Error("sin pgvector: la memoria busca más lento y peor"); return `v${e.extversion}`; }));
  ps.push(await medir("Cifrado de lo personal", async () => {
    const { obtenerLlave, cifrar, descifrar } = await import("../motor/cifrado.js");
    const k = await obtenerLlave(); if (!k) throw new Error("no hay llave: lo personal queda sin cifrar");
    if (descifrar(cifrar("secreto de prueba", k), k) !== "secreto de prueba") throw new Error("cifra pero no descifra");
    return "AES-256-GCM ok";
  }));
  await query(`UPDATE bib_nodos SET borrado_en = now() WHERE titulo LIKE $1`, [`Prueba de Arca ${marca}%`]).catch(() => {});
  return { id: "memoria", nombre: "Memoria (cerebro)", nota: nota(ps), pruebas: ps };
}

// ── WhatsApp ──
async function whatsapp(enviar: boolean): Promise<Componente> {
  const { CHEQUEOS } = await import("./diagnostico.js");
  const ps: Prueba[] = [];
  for (const id of ["wa_token", "wa_plantillas", "wa_seguridad", "webhook"]) {
    const c = await CHEQUEOS[id]().catch((e: any) => ({ estado: "error", detalle: String(e?.message || e), nombre: id } as any));
    ps.push({ nombre: c.nombre, ok: c.estado === "ok", detalle: c.detalle });
  }
  if (enviar) ps.push(await medir("Mensaje real a ti", async () => {
    const { enviarTextoWhatsapp } = await import("../whatsapp/enviar.js");
    const r: any = await enviarTextoWhatsapp(process.env.WHATSAPP_NUMERO_JEFE || "", "🔧 Prueba de Arca: si te llegó esto, WhatsApp funciona de punta a punta.");
    if (!r.ok) throw new Error(r.error || "no salió"); return "salió";
  }));
  return { id: "whatsapp", nombre: "WhatsApp", nota: nota(ps), pruebas: ps, arreglo: ps.some((p) => !p.ok) ? "«Arca, revisa WhatsApp» te dice el paso exacto." : undefined };
}

// ── Seguridad y autonomía ──
async function seguridad(): Promise<Componente> {
  const { auditarSeguridad } = await import("../seguridad/auditoria.js");
  const cs = await auditarSeguridad();
  const ps: Prueba[] = cs.map((c) => ({ nombre: c.nombre, ok: c.nivel === "ok", detalle: c.detalle + (c.nivel !== "ok" && c.arreglo ? ` → ${c.arreglo}` : "") }));
  const graves = cs.filter((c) => c.nivel === "grave").length;
  return { id: "seguridad", nombre: "Seguridad y autonomía", nota: Math.max(0, nota(ps) - graves * 1.5), pruebas: ps };
}

// ── Agentes ──
const CASOS: Record<string, { pedido: string; espera: RegExp }> = {
  emilia: { pedido: "¿Qué tengo pendiente con el equipo?", espera: /^agente_/ },
  iris: { pedido: "¿Qué tengo en la agenda mañana?", espera: /^agenda_/ },
  lara: { pedido: "¿Qué sabes de mi proyecto Emilia?", espera: /^(memoria_|biblioteca_|cerebro_|carpeta_)/ },
  lyra: { pedido: "¿Quién me ha escrito hoy?", espera: /^(mensaje_recibidos|contacto_|whatsapp_personal_)/ },
  sage: { pedido: "¿Qué proyectos tengo registrados?", espera: /^codigo_listar/ },
  soga: { pedido: "¿A cuánto está el dólar hoy en Colombia?", espera: /^(fuente_trm|web_)/ },
  system: { pedido: "¿Cómo va el equipo esta semana?", espera: /^(adaptar_tablero|aprender_)/ },
  echo: { pedido: "Hola, ¿qué puedes hacer?", espera: /./ },
};

async function agentes(): Promise<Componente[]> {
  // Desde la terminal (npm run arca) el registro de herramientas no está cargado: sin él los agentes no tienen tools.
  const { registro } = await import("../registro/registro.js");
  if (!registro.tools().length) {
    const { iniciarRegistro } = await import("../registro/cargar.js");
    const log = console.log; console.log = () => {};
    try { await iniciarRegistro(); } finally { console.log = log; }
  }
  const { correrTarea } = await import("../motor/loop.js");
  const { obtenerOCrearConversacion } = await import("../dominio/conversaciones.js");
  const ags = await query<{ id: string; nombre: string }>(`SELECT id, nombre FROM agentes WHERE estado = 'activo' AND lower(nombre) <> 'arca' ORDER BY nombre`);
  const out: Componente[] = [];
  for (const a of ags) {
    const caso = CASOS[a.nombre.toLowerCase()] || { pedido: "¿Qué puedes hacer por mí? En una línea.", espera: /./ };
    const conv = await obtenerOCrearConversacion(a.id, "evaluacion", "arca-pruebas");
    await query(`DELETE FROM mensajes WHERE conversacion_id = $1`, [conv.id]).catch(() => {});
    const t = Date.now();
    let r: any, error = "";
    try { r = await correrTarea(a.id, caso.pedido, { conversacionId: conv.id, origen: "evaluacion", simulado: true, contextoCanal: "Esto es una PRUEBA de Arca (la técnica): responde como si fuera el jefe. Las acciones están simuladas." }); }
    catch (e: any) { error = String(e?.message || e); }
    const ms = Date.now() - t;
    const tools = r?.ejecucionId ? (await query<{ detalle: string }>(`SELECT detalle FROM pasos WHERE ejecucion_id = $1 AND tipo = 'tool'`, [r.ejecucionId])).map((p) => p.detalle.split("(")[0].replace(/^\[SIMULADO\]\s*/, "").trim()) : [];
    const ps: Prueba[] = [
      { nombre: "Responde", ok: !!r?.ok && !!String(r?.respuesta || "").trim() && r.estado !== "fallida", detalle: error || (r?.estado === "fallida" ? String(r?.respuesta).slice(0, 120) : `«${String(r?.respuesta || "").replace(/\s+/g, " ").slice(0, 90)}»`) },
      { nombre: "Usa la herramienta correcta", ok: caso.espera.source === "." || tools.some((n) => caso.espera.test(n)), detalle: tools.length ? tools.slice(0, 4).join(", ") : "no usó herramientas" },
      { nombre: "Rápido (menos de 60 s)", ok: ms < 60_000, detalle: `${Math.round(ms / 1000)} s` },
    ];
    // Responder vale más que la velocidad.
    const n = Math.round(((ps[0].ok ? 5 : 0) + (ps[1].ok ? 3.5 : 0) + (ps[2].ok ? 1.5 : 0)) * 10) / 10;
    out.push({ id: `agente:${a.nombre.toLowerCase()}`, nombre: a.nombre, nota: n, pruebas: ps, arreglo: n < 7 ? `Puedo pasarle el caso a System para que lo analice (dime «Arca, pásale ${a.nombre} a System»).` : undefined });
  }
  return out;
}

// ── Panel ──
async function panel(): Promise<Componente> {
  const port = Number(process.env.PORT ?? 3000);
  const ps: Prueba[] = [];
  for (const [n, ruta] of [["La oficina abre", "/oficina"], ["Estado en vivo", "/api/oficina/estado"], ["Salud", "/api/salud"]]) {
    ps.push(await medir(n, async () => { const r = await fetch(`http://127.0.0.1:${port}${ruta}`, { signal: AbortSignal.timeout(15_000) }); if (!r.ok) throw new Error(`respondió ${r.status}`); return `${r.status}`; }));
  }
  return { id: "panel", nombre: "Panel", nota: nota(ps), pruebas: ps };
}

export const COMPONENTES = ["motor", "memoria", "whatsapp", "seguridad", "panel", "agentes"] as const;

export async function probarTodo(op: { componentes?: string[]; enviarWhatsapp?: boolean; avance?: (t: string) => void } = {}): Promise<InformePruebas> {
  const quiero = (c: string) => !op.componentes?.length || op.componentes.includes(c);
  const cs: Componente[] = [];
  const paso = async (id: string, f: () => Promise<Componente | Componente[]>) => {
    if (!quiero(id)) return;
    op.avance?.(`Probando ${id}…`);
    try { const r = await f(); cs.push(...(Array.isArray(r) ? r : [r])); }
    catch (e: any) { cs.push({ id, nombre: id, nota: 0, pruebas: [{ nombre: "Correr la prueba", ok: false, detalle: String(e?.message || e).slice(0, 200) }] }); }
  };
  await paso("motor", motor);
  await paso("memoria", memoria);
  await paso("whatsapp", () => whatsapp(!!op.enviarWhatsapp));
  await paso("seguridad", seguridad);
  await paso("panel", panel);
  await paso("agentes", agentes);
  // Nota global: los agentes cuentan como un solo bloque (su promedio), igual que cada componente.
  const ags = cs.filter((c) => c.id.startsWith("agente:")), otros = cs.filter((c) => !c.id.startsWith("agente:"));
  const bloques = [...otros.map((c) => c.nota), ...(ags.length ? [ags.reduce((s, c) => s + c.nota, 0) / ags.length] : [])];
  const global = bloques.length ? Math.round((bloques.reduce((s, x) => s + x, 0) / bloques.length) * 10) / 10 : 0;
  const texto = textoInforme(global, cs);
  const [f] = await query<{ id: string }>(`INSERT INTO arca_informes (tipo, nota, datos, texto) VALUES ('pruebas', $1, $2, $3) RETURNING id`, [global, JSON.stringify({ componentes: cs }), texto]).catch(() => [] as any);
  if (!op.componentes?.length && f) await query(`INSERT INTO arca_progreso (mision) VALUES ('pruebas') ON CONFLICT (mision) DO NOTHING`).catch(() => {});
  return { nota: global, componentes: cs, texto, id: f?.id };
}

const emojiNota = (n: number) => (n >= 9 ? "🟢" : n >= 7 ? "🟡" : n >= 5 ? "🟠" : "🔴");
export function textoInforme(global: number, cs: Componente[]): string {
  const l = [`*La prueba final* — nota global ${emojiNota(global)} *${global}/10*`, ""];
  for (const c of cs) {
    l.push(`${emojiNota(c.nota)} *${c.nombre}*: ${c.nota}/10`);
    for (const p of c.pruebas.filter((p) => !p.ok)) l.push(`   ❌ ${p.nombre}: ${p.detalle}`);
    if (c.arreglo) l.push(`   → ${c.arreglo}`);
  }
  const malos = cs.filter((c) => c.nota < 7);
  l.push("", malos.length ? `Lo primero que arreglaría: ${malos.sort((a, b) => a.nota - b.nota).slice(0, 3).map((c) => c.nombre).join(", ")}. No toco nada sin tu OK.` : "Todo pasa. 🏁");
  return l.join("\n");
}
