// ARCHIVO: src/seguridad/auditoria.ts
// Revisión de seguridad en código (no en el modelo): la corre Arca, el panel y
// `npm run seguridad`. Cada chequeo dice ok / atención / grave y qué hacer.
import { query } from "../db/cliente.js";

export type Nivel = "ok" | "atencion" | "grave";
export interface Chequeo { id: string; nombre: string; nivel: Nivel; detalle: string; arreglo?: string }

/** Quién puede escribirle a terceros (todo lo demás le escribe solo al jefe). */
const TERCEROS = new Set(["mensaje_enviar", "mensaje_enviar_lista", "whatsapp_personal_responder", "gestion_iniciar", "gestion_responder"]);
const AGENTES_TERCEROS = new Set(["lyra"]);

export async function auditarSeguridad(): Promise<Chequeo[]> {
  const cs: Chequeo[] = [];
  const env = process.env;
  const add = (c: Chequeo) => cs.push(c);

  // ── Panel ──
  const host = env.PANEL_HOST || "127.0.0.1";
  add(["127.0.0.1", "localhost", "::1"].includes(host)
    ? { id: "panel_host", nombre: "Panel solo en esta máquina", nivel: "ok", detalle: `Escucha en ${host}.` }
    : { id: "panel_host", nombre: "Panel solo en esta máquina", nivel: "grave", detalle: `PANEL_HOST=${host}: el panel (sin contraseña) se ve desde la red.`, arreglo: "Quita PANEL_HOST del .env o ponlo en 127.0.0.1." });

  // ── WhatsApp ──
  if (env.WHATSAPP_SIN_FIRMA === "true") add({ id: "wa_firma", nombre: "Firma de Meta en el webhook", nivel: "grave", detalle: "WHATSAPP_SIN_FIRMA=true: cualquiera que conozca la URL puede hacerse pasar por ti.", arreglo: "Borra WHATSAPP_SIN_FIRMA y pon WHATSAPP_APP_SECRET." });
  else add(env.WHATSAPP_APP_SECRET
    ? { id: "wa_firma", nombre: "Firma de Meta en el webhook", nivel: "ok", detalle: "Cada mensaje entrante se verifica con el App Secret." }
    : { id: "wa_firma", nombre: "Firma de Meta en el webhook", nivel: "atencion", detalle: "Falta WHATSAPP_APP_SECRET: por seguridad se rechaza todo lo que llega.", arreglo: "Copia el App Secret (Meta → tu app → Configuración → Básica) al .env." });
  add(env.WHATSAPP_NUMERO_JEFE
    ? { id: "wa_jefe", nombre: "Tu número de jefe", nivel: "ok", detalle: `Termina en ${String(env.WHATSAPP_NUMERO_JEFE).replace(/\D/g, "").slice(-4)}.` }
    : { id: "wa_jefe", nombre: "Tu número de jefe", nivel: "grave", detalle: "Sin WHATSAPP_NUMERO_JEFE nadie es el jefe: no se puede aprobar nada.", arreglo: "Pon tu número con código de país en WHATSAPP_NUMERO_JEFE." });
  const permitidos = (env.WHATSAPP_NUMEROS_PERMITIDOS || "").split(",").filter((x) => x.trim());
  if (permitidos.length) add({ id: "wa_permitidos", nombre: "Números a los que los agentes escriben solos", nivel: "atencion", detalle: `${permitidos.length} número(s) en WHATSAPP_NUMEROS_PERMITIDOS: los agentes les pueden escribir sin pasar por Lyra.`, arreglo: "Si no es a propósito, vacíalo y deja que Lyra pida OK." });

  // ── Gasto ──
  const { topeGlobal } = await import("./gasto.js");
  const tope = await topeGlobal().catch(() => 10);
  add(tope > 0
    ? { id: "gasto_tope", nombre: "Tope de gasto diario global", nivel: "ok", detalle: `${tope} USD por día.` }
    : { id: "gasto_tope", nombre: "Tope de gasto diario global", nivel: "atencion", detalle: "Sin tope global: un bucle podría gastar sin freno.", arreglo: "Por WhatsApp: «sube el tope a 10»." });

  // ── Cerebro cifrado ──
  add(env.CEREBRO_LLAVE || process.platform === "win32"
    ? { id: "cerebro_llave", nombre: "Memoria personal cifrada", nivel: "ok", detalle: env.CEREBRO_LLAVE ? "Llave en el .env (CEREBRO_LLAVE)." : "Llave protegida por Windows (DPAPI)." }
    : { id: "cerebro_llave", nombre: "Memoria personal cifrada", nivel: "grave", detalle: "No hay llave del cerebro.", arreglo: "npm run cerebro:llave" });

  // ── Herramientas ──
  const { registro } = await import("../registro/registro.js");
  const sinOk = registro.tools().filter((t) => t.riesgo === "sistema" && !t.requiereAprobacion).map((t) => t.nombre);
  add(sinOk.length
    ? { id: "tools_sistema", nombre: "Herramientas de nivel sistema piden OK", nivel: "grave", detalle: `Sin OK: ${sinOk.join(", ")}.`, arreglo: "Marcarlas requiereAprobacion: true." }
    : { id: "tools_sistema", nombre: "Herramientas de nivel sistema piden OK", nivel: "ok", detalle: "Todas piden tu OK." });

  // ── Agentes: quién le escribe a terceros ──
  const ags = await query<{ nombre: string; tools: any }>(`SELECT nombre, tools FROM agentes WHERE estado = 'activo'`).catch(() => [] as any[]);
  const intrusos: string[] = [];
  for (const a of ags) {
    const items: string[] = a.tools?.items || [];
    const malos = items.filter((t) => TERCEROS.has(t));
    if (malos.length && !AGENTES_TERCEROS.has(a.nombre.toLowerCase())) intrusos.push(`${a.nombre} (${malos.join(", ")})`);
  }
  add(intrusos.length
    ? { id: "agentes_terceros", nombre: "Solo Lyra le escribe a terceros", nivel: "grave", detalle: `También pueden: ${intrusos.join("; ")}.`, arreglo: "Quitarles esas herramientas (registro_asignar) o confirmar que es a propósito." }
    : { id: "agentes_terceros", nombre: "Solo Lyra le escribe a terceros", nivel: "ok", detalle: "Los demás solo te escriben a ti." });

  // ── Hospital ──
  const [hosp] = await query<any>(`SELECT * FROM pc_perfiles WHERE nombre = 'hospital_lectura'`).catch(() => [] as any[]);
  if (hosp) {
    const { normalizarPerfil, CANDADOS_HOSPITAL } = await import("../motor/permisos-pc.js");
    const p: any = normalizarPerfil({ ...(hosp.config || hosp), nombre: "hospital_lectura" });
    const flojos = Object.entries(CANDADOS_HOSPITAL).filter(([k, v]) => p[k] !== v).map(([k]) => k);
    add(flojos.length
      ? { id: "hospital", nombre: "Perfil del hospital blindado", nivel: "grave", detalle: `Campos flojos: ${flojos.join(", ")}.` }
      : { id: "hospital", nombre: "Perfil del hospital blindado", nivel: "ok", detalle: "Solo lectura, cada comando con OK, sin capturas por WhatsApp." });
  } else add({ id: "hospital", nombre: "Perfil del hospital blindado", nivel: "ok", detalle: "Usa el perfil por defecto (solo lectura, OK por comando, sin capturas)." });

  // ── MCP: secretos solo por ${VAR} ──
  const mcps = await query<any>(`SELECT nombre, row_to_json(mcp_servidores) AS config FROM mcp_servidores`).catch(() => [] as any[]);
  const { PATRONES } = await import("./secretos.js");
  const crudos = mcps.filter((m) => PATRONES.some((p) => { p.re.lastIndex = 0; return p.re.test(JSON.stringify(m.config || {})); })).map((m) => m.nombre);
  add(crudos.length
    ? { id: "mcp_secretos", nombre: "Servidores MCP sin llaves a la vista", nivel: "grave", detalle: `Con llave escrita: ${crudos.join(", ")}.`, arreglo: "Pasar la llave al .env y usar ${VAR}." }
    : { id: "mcp_secretos", nombre: "Servidores MCP sin llaves a la vista", nivel: "ok", detalle: `${mcps.length} servidor(es), sin llaves escritas.` });

  // ── Eventos recientes ──
  const ev = await query<{ tipo: string; n: number }>(`SELECT tipo, count(*)::int AS n FROM seguridad_eventos WHERE creado_en > now() - interval '7 days' GROUP BY tipo`).catch(() => [] as any[]);
  if (ev.length) add({ id: "eventos", nombre: "Bloqueos de la última semana", nivel: "ok", detalle: ev.map((e) => `${e.tipo}: ${e.n}`).join(" · ") });

  return cs;
}

export function textoAuditoria(cs: Chequeo[]): string {
  const icono = { ok: "✅", atencion: "⚠️", grave: "🛑" } as const;
  const graves = cs.filter((c) => c.nivel === "grave").length, aten = cs.filter((c) => c.nivel === "atencion").length;
  const cab = graves ? `🛑 ${graves} cosa(s) grave(s)${aten ? ` y ${aten} para revisar` : ""}.` : aten ? `⚠️ Todo bien salvo ${aten} cosa(s) para revisar.` : "✅ Seguridad en orden.";
  return [cab, ...cs.map((c) => `${icono[c.nivel]} ${c.nombre}: ${c.detalle}${c.nivel !== "ok" && c.arreglo ? ` → ${c.arreglo}` : ""}`)].join("\n");
}
