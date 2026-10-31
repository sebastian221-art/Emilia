// ARCHIVO: src/flujos/vigilar-url.ts
// ─────────────────────────────────────────────────────────────────────────────
//  FLUJO: vigilar_servicio — vigila un servicio REMOTO (Railway, VPS) por URL.
//  Cada N minutos lo pinga; eso además lo mantiene despierto en planes que
//  duermen la app. Si falla K veces seguidas: te avisa, emite el evento
//  servicio.caido (para que un disparador haga lo que quieras) y, si pediste
//  diagnóstico, le pide al Senior que mire los logs/el código. Cuando vuelve,
//  te avisa que se recuperó. Permanente; se corta con flujo_cancelar.
// ─────────────────────────────────────────────────────────────────────────────
import type { DefFlujo } from "../registro/tipos.js";

const jefe = (c: Record<string, any>) => c.numero || process.env.WHATSAPP_NUMERO_JEFE || "";

export const vigilarServicio: DefFlujo = {
  nombre: "vigilar_servicio",
  modulo: "vigilar",
  descripcion: "Vigila un servicio remoto por URL (tu backend en Railway, por ejemplo) de forma permanente: lo pinga cada N minutos (lo mantiene despierto), te avisa si cae K veces seguidas, emite el evento servicio.caido, y te avisa cuando se recupera. Se detiene con flujo_cancelar.",
  parametros: {
    type: "object",
    properties: {
      nombre: { type: "string", description: "Nombre corto del servicio (ej. jelcom_envios).", minLength: 2 },
      url: { type: "string", description: "URL de salud (ej. https://.../api/health).", minLength: 8 },
      esperado: { type: "string", description: "Texto que debe contener la respuesta (opcional)." },
      cada_min: { type: "integer", description: "Minutos entre pings.", default: 5, minimum: 1, maximum: 120 },
      fallos_para_alertar: { type: "integer", description: "Fallos seguidos antes de avisar.", default: 2, minimum: 1, maximum: 10 },
      numero: { type: "string", description: "WhatsApp al que avisar (por defecto el jefe)." },
    },
    required: ["nombre", "url"],
  },
  riesgo: "lectura",
  inicio: "init",
  pasos: [
    { id: "init", tipo: "condicion", si: (c) => { c.fallos = 0; c.caido = false; c.ultimo_ok = null; return true; }, entonces: "aviso_inicio", sino: "aviso_inicio" },
    { id: "aviso_inicio", tipo: "tool", tool: "whatsapp_enviar_texto", args: (c) => ({ numero: jefe(c), texto: `👁 Vigilo ${c.nombre} (${c.url}) cada ${c.cada_min || 5} min. Te aviso solo si cae o se recupera.` }), siFalla: "continuar" },
    { id: "bucle", tipo: "repetir", hasta: () => false, maxVeces: 1000000, cuerpo: ["ping", "evaluar"], cadaSegundos: (c) => Math.max(60, (Number(c.cada_min) || 5) * 60) },
    { id: "ping", tipo: "tool", tool: "runtime_web_salud", args: (c) => ({ url: c.url, esperado: c.esperado, timeout_seg: 20 }), guardarEn: "salud", siFalla: "continuar" },
    { id: "evaluar", tipo: "condicion", si: (c) => {
        const ok = !!c.__resultados?.ping?.ok;
        if (ok) { c.ultimo_ok = new Date().toISOString(); const estabaCaido = c.caido; c.fallos = 0; c.caido = false; c.__recupero = !!estabaCaido; return !!estabaCaido; }
        c.fallos = (c.fallos || 0) + 1; c.__recupero = false;
        return !c.caido && c.fallos >= (c.fallos_para_alertar || 2);
      }, entonces: "notificar", sino: "bucle" },
    { id: "notificar", tipo: "condicion", si: (c) => !!c.__recupero, entonces: "aviso_recupero", sino: "marcar_caido" },
    { id: "aviso_recupero", tipo: "tool", tool: "whatsapp_enviar_texto", args: (c) => ({ numero: jefe(c), texto: `✅ ${c.nombre} volvió: ${c.salud?.resumen || "responde"}.` }), siFalla: "continuar" },
    { id: "evento_recupero", tipo: "tool", tool: "evento_emitir", args: (c) => ({ nombre: "servicio.recuperado", datos: { servicio: c.nombre, url: c.url } }), siFalla: "continuar" },
    { id: "volver1", tipo: "condicion", si: () => true, entonces: "bucle", sino: "bucle" },
    { id: "marcar_caido", tipo: "condicion", si: (c) => { c.caido = true; return true; }, entonces: "aviso_caida", sino: "aviso_caida" },
    { id: "aviso_caida", tipo: "tool", tool: "whatsapp_enviar_texto", args: (c) => ({ numero: jefe(c), texto: `🔴 ${c.nombre} NO responde (${c.fallos} fallos seguidos): ${c.salud?.resumen || c.salud?.error || "sin respuesta"}. Último OK: ${c.ultimo_ok ? new Date(c.ultimo_ok).toLocaleString("es-CO") : "nunca en esta vigilancia"}. Sigo mirando y te aviso cuando vuelva.` }), siFalla: "continuar" },
    { id: "evento_caida", tipo: "tool", tool: "evento_emitir", args: (c) => ({ nombre: "servicio.caido", datos: { servicio: c.nombre, url: c.url, fallos: c.fallos, error: c.salud?.error } }), siFalla: "continuar" },
    { id: "volver2", tipo: "condicion", si: () => true, entonces: "bucle", sino: "bucle" },
    { id: "fin", tipo: "fin", resultado: (c) => ({ servicio: c.nombre, caido: c.caido, ultimo_ok: c.ultimo_ok }) },
  ],
  reporte: (c, r: any) => `Vigilancia de ${c.nombre} terminada.${r?.caido ? " Estaba caído." : ""}`,
};

export const flujosVigilarUrl: DefFlujo[] = [vigilarServicio];