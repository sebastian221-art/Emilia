// ARCHIVO: src/server.ts
import express from "express";
import type { Request, Response, NextFunction } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";
import "dotenv/config";
import { query } from "./db/cliente.js";
import { instalarBitacora } from "./motor/bitacora.js";
instalarBitacora();

import { rutasCrear } from "./rutas/crear.js";
import { rutasAgentes } from "./rutas/agentes.js";
import { rutasChat } from "./rutas/chat.js";
import { rutasDocumentos } from "./rutas/documentos.js";
import { rutasSkills } from "./rutas/skills.js";
import { rutasTools } from "./rutas/tools.js";
import { rutasRegistro } from "./rutas/registro.js";
import { rutasEsqueleto } from "./rutas/esqueleto.js";
import { verificarWebhook, recibirMensaje } from "./whatsapp/webhook.js";
import { iniciarTunel } from "./whatsapp/tunel.js";
import { rutasRecordatorio } from "./rutas/recordatorio.js";
import { rutasFlujos } from "./rutas/flujos.js";
import { iniciarRegistro } from "./registro/cargar.js";
import { retomarFlujos } from "./motor/flujo.js";
import { recuperarSesionesHuerfanas } from "./motor/claude-code.js";
import { rutasCodigo } from "./rutas/codigo.js";
import { rutasInterno } from "./rutas/interno.js";
import { prepararLaboratorio, tokenInterno, LAB_DIR } from "./motor/laboratorio.js";
import { rutasEmpresa } from "./rutas/empresa.js";
import { rutasEventos } from "./rutas/eventos.js";
import { recibirWebhook } from "./motor/eventos.js";
import { rutasBiblioteca } from "./rutas/biblioteca.js";
import { rutasVoz } from "./rutas/voz.js";
import { rutasOficina } from "./rutas/oficina.js";
import { rutasActividad } from "./rutas/actividad.js";
import { iniciarReloj } from "./motor/eventos.js";
import { limpiarArchivosViejos } from "./dominio/archivos.js";
import { retomarProcesos } from "./motor/runtime.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUB = path.join(__dirname, "..", "public");

const app = express();
app.use(express.json({
  limit: "2mb",
  verify: (req, _res, buf) => { (req as any).rawBody = buf; },
}));
// El esqueleto se genera desde el backend: va ANTES de static para que
// /crear/piezas-1.js salga de src/esqueleto/piezas.ts y no de un archivo.
app.use(rutasInterno);      // solo procesos lanzados por Emilia (token interno): permisos y herramientas de Claude Code
app.use(rutasEsqueleto);
app.get(/\.html$/, (req, res, next) => { const f = path.join(PUB, path.normalize(req.path)); if (f.startsWith(PUB) && existsSync(f)) return enviarHtml(res, f); next(); });
app.use(express.static(PUB, { index: false }));
// three.js para la oficina 3D (local: funciona sin internet).
app.use("/vendor/three", express.static(path.resolve("node_modules/three"), { index: false, maxAge: "7d" }));

// ── Rutas de API ──────────────────────────────────────────────────────────
app.use(rutasCrear);
app.use(rutasAgentes);
app.use(rutasChat);
app.use(rutasDocumentos);
app.use(rutasSkills);
app.use(rutasTools);
app.use(rutasRegistro);
app.use(rutasRecordatorio);
app.use(rutasFlujos);
app.use(rutasCodigo);
app.use(rutasEmpresa);
app.use(rutasEventos);
app.use(rutasBiblioteca);
app.use(rutasVoz);
app.use(rutasActividad);
app.use(rutasOficina);

// ── Webhook de WhatsApp ──
app.get("/webhook/whatsapp", verificarWebhook);
app.post("/webhook/whatsapp", recibirMensaje);

// ── Menú único para TODAS las páginas ─────────────────────────────────────
// La lista vive acá (una sola vez). /comun/menu.js se genera desde esta lista y
// cada HTML que el servidor entrega recibe ese script inyectado: no hay que
// tocar el <nav> de ninguna página para agregar una nueva.
const MENU: { ruta: string; titulo: string; icono: string; abajo?: boolean }[] = [
  { ruta: "/oficina", titulo: "Oficina", icono: "oficina" },
  { ruta: "/aprobaciones", titulo: "Aprobaciones", icono: "ok" },
  { ruta: "/actividad", titulo: "Actividad en vivo", icono: "pulso" },
  { ruta: "/biblioteca", titulo: "Cerebro (Lara)", icono: "cerebro" },
  { ruta: "/codigo", titulo: "Código (Sage)", icono: "codigo" },
  { ruta: "/voz", titulo: "Hablar con Emilia", icono: "voz" },
  { ruta: "/flujos", titulo: "Flujos", icono: "flujo", abajo: true },
  { ruta: "/skills", titulo: "Skills", icono: "skill" },
  { ruta: "/tools", titulo: "Herramientas", icono: "tool" },
];
const ICONOS: Record<string, string> = {
  oficina: '<path d="M3 21h18M5 21V9l7-5 7 5v12M9 21v-5h6v5"/>',
  ok: '<path d="M20 6 9 17l-5-5"/><circle cx="12" cy="12" r="10" opacity=".35"/>',
  pulso: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  cerebro: '<path d="M9 3a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 2 5 3 3 0 0 0 3 3V3zM15 3a3 3 0 0 1 3 3 3 3 0 0 1 2 5 3 3 0 0 1-2 5 3 3 0 0 1-3 3V3z"/>',
  codigo: '<path d="m8 8-5 4 5 4M16 8l5 4-5 4M14 4l-4 16"/>',
  voz: '<path d="M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zM5 11a7 7 0 0 0 14 0M12 18v3"/>',
  flujo: '<circle cx="6" cy="6" r="2"/><circle cx="18" cy="18" r="2"/><circle cx="18" cy="6" r="2"/><path d="M8 6h8M18 8v8M6 8c0 6 4 10 10 10"/>',
  skill: '<path d="m12 3 2.5 5.5L20 9l-4 4 1 6-5-3-5 3 1-6-4-4 5.5-.5z"/>',
  tool: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z"/>',
};
app.get("/comun/menu.js", (_req, res) => {
  const items = MENU.map((m) => ({ ...m, svg: ICONOS[m.icono] || "" }));
  res.type("application/javascript").set("Cache-Control", "no-cache").send(`// Generado por el servidor desde MENU en src/server.ts: el dock lateral de todas las páginas.
(function(){
  var MENU=${JSON.stringify(items)};
  if(!document.querySelector('link[href="/comun/hud.css"]')){ var l=document.createElement("link"); l.rel="stylesheet"; l.href="/comun/hud.css"; document.head.appendChild(l); }
  function pintar(){
    document.body.classList.add("con-dock");
    var aqui=location.pathname.replace(/\\/+$/,"")||"/";
    var d=document.querySelector(".dock"); if(!d){ d=document.createElement("aside"); d.className="dock"; document.body.insertBefore(d, document.body.firstChild); }
    var html='<a href="/oficina" class="logo" title="Emilia">E</a>', abajo=false;
    MENU.forEach(function(m){
      if(m.abajo && !abajo){ html+='<div class="sep abajo"></div>'; abajo=true; }
      var act = aqui===m.ruta || aqui.indexOf(m.ruta+"/")===0;
      html+='<a href="'+m.ruta+'"'+(act?' class="activo"':'')+' data-ruta="'+m.ruta+'"><svg viewBox="0 0 24 24">'+m.svg+'</svg><span class="tip">'+m.titulo+'</span></a>';
    });
    d.innerHTML=html;
    fetch("/api/aprobaciones").then(function(r){return r.json()}).then(function(xs){ var n=(xs||[]).length; if(!n) return; var a=d.querySelector('a[data-ruta="/aprobaciones"]'); if(a){ var b=document.createElement("span"); b.className="num"; b.textContent=n; a.appendChild(b); } }).catch(function(){});
  }
  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",pintar); else pintar();
})();`);
});
/** Entrega un HTML inyectándole el menú compartido. */
function enviarHtml(res: Response, ruta: string) {
  let html = readFileSync(ruta, "utf8");
  if (!html.includes("/comun/menu.js")) {
    const tag = `<script src="/comun/menu.js"></script>`;
    html = html.includes("</head>") ? html.replace("</head>", `${tag}\n</head>`) : tag + html;
  }
  res.type("html").send(html);
}

// ── URLs limpias de las páginas ───────────────────────────────────────────
const PAGINAS = MENU.map((m) => m.ruta.slice(1));
for (const p of PAGINAS) {
  app.get([`/${p}`, `/${p}/`], (_req, res) => {
    const idx = path.join(PUB, p, "index.html");
    if (existsSync(idx)) enviarHtml(res, idx);
    else res.send(`<link rel="stylesheet" href="/comun/estilos.css"><script src="/comun/menu.js"></script><nav></nav><main style="max-width:1100px;margin:0 auto;padding:24px"><h1>Página "${p}"</h1><p class="sub">Todavía no construida — la armamos en su turno según el plan.</p></main>`);
  });
}
app.get("/", (_req, res) => res.redirect("/oficina"));
// Lo viejo (crear agentes por UI, empresa, lista de agentes) ahora vive en la oficina.
for (const viejo of ["/crear", "/empresa", "/agentes"]) app.get([viejo, `${viejo}/`], (_req, res) => res.redirect("/oficina"));

app.get("/agentes/:id", (req, res, next) => {
  if (req.query.clasico !== "1") return res.redirect(`/oficina?agente=${encodeURIComponent(req.params.id)}`);   // la estación de trabajo vive en la oficina
  next();
}, (req, res) => {
  const idx = path.join(PUB, "agentes", "espacio.html");
  if (existsSync(idx)) enviarHtml(res, idx);
  else res.send(`<link rel="stylesheet" href="/comun/estilos.css"><script src="/comun/menu.js"></script><nav></nav><main style="max-width:1100px;margin:0 auto;padding:24px"><h1>Espacio del agente</h1><p class="sub">Agente ${req.params.id}.</p></main>`);
});

// ── Manejo de errores: ningún error tumba el proceso ─────────────────────
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error("── Error en una ruta ──");
  console.error("Mensaje:", err?.message || "(sin mensaje)");
  if (err?.code) console.error("Código:", err.code);
  if (err?.stack) console.error("Stack:", err.stack.split("\n").slice(0, 4).join("\n"));
  console.error("───────────────────────");
  res.status(400).json({ error: String(err?.message ?? err) });
});
process.on("unhandledRejection", (e) => console.error("Promesa sin atrapar:", e));
process.on("uncaughtException", (e) => console.error("Excepción sin atrapar:", e));

const PORT = Number(process.env.PORT ?? 3000);
// El panel solo escucha en esta máquina. Para abrirlo desde otro equipo de tu red,
// PANEL_HOST=0.0.0.0 (nunca lo expongas a internet: no tiene contraseña).
const PANEL_HOST = process.env.PANEL_HOST || "127.0.0.1";

// ── Puerta pública (lo ÚNICO que ngrok publica) ───────────────────────────
// Solo el webhook de WhatsApp y los disparadores webhook (con token/firma).
// Todo lo demás (panel, /api/*) queda fuera de internet.
const PORT_PUBLICO = Number(process.env.PORT_PUBLICO ?? PORT + 1);
const publico = express();
publico.disable("x-powered-by");
publico.use(express.json({ limit: "2mb", verify: (req, _res, buf) => { (req as any).rawBody = buf; } }));
publico.get("/webhook/whatsapp", verificarWebhook);
publico.post("/webhook/whatsapp", recibirMensaje);
publico.post("/api/eventos/:nombre", async (req, res) => {
  try {
    const r = await recibirWebhook(req.params.nombre, req.body, { token: String(req.query.token || req.header("x-emilia-token") || ""), firma: req.header("x-hub-signature-256") || undefined, rawBody: (req as any).rawBody });
    res.status(r.ok ? 200 : 403).json(r);
  } catch (e: any) { console.error("[eventos] webhook:", e?.message || e); res.status(500).json({ ok: false, error: "Error interno" }); }
});
publico.use((_req, res) => res.sendStatus(404));
publico.use((err: any, _req: Request, res: Response, _next: NextFunction) => { console.error("[publico]", err?.message || err); res.sendStatus(400); });

// El registro se carga ANTES de escuchar: si una capacidad está mal definida
// o una referencia está rota, el servidor no arranca y el error dice qué es.
iniciarRegistro()
  .then(() => {
    import("./motor/mcp.js").then((m) => m.iniciarMcp()).catch((e) => console.warn("[mcp]", e?.message || e));   // servidores MCP: sus herramientas se registran solas
    publico.listen(PORT_PUBLICO, "127.0.0.1", () => console.log(`Puerta pública (solo webhooks) en 127.0.0.1:${PORT_PUBLICO}`));
    app.listen(PORT, PANEL_HOST, async () => {
      console.log(`Emilia en http://localhost:${PORT}${PANEL_HOST === "127.0.0.1" ? " (solo esta máquina)" : ` (escuchando en ${PANEL_HOST})`}`);
      tokenInterno(); await prepararLaboratorio().then(() => console.log(`Laboratorio de Sage: ${LAB_DIR}`)).catch((e) => console.warn("[laboratorio]", e?.message || e));
      await recuperarSesionesHuerfanas();
      // Iris: correo en tiempo real, recordatorios de la agenda y avisos guardados durante el silencio.
      import("./motor/iris-reloj.js").then((m) => m.iniciarIris()).catch((e) => console.warn("[iris]", e?.message || e));
      // Cerebro compartido: pasar la memoria vieja (una vez) y completar vectores pendientes.
      import("./motor/cerebro.js").then(async (c) => { const n = await c.migrarMemoriaVieja(); if (n) console.log(`[cerebro] ${n} recuerdo(s) migrados de la memoria vieja.`); await c.revectorizar(500); await c.cifrarPendientes(); const k = await import("./motor/carpetas.js"); const n2 = await k.indexarCapacidades(); if (n2) console.log(`[cerebro] ${n2} capacidad(es) del equipo indexadas.`); const ct = await import("./motor/contactos.js"); await ct.migrarContactosDelCerebro(); }).catch((e) => console.warn("[cerebro]", e?.message || e));
      await retomarFlujos();
      await retomarProcesos();
      iniciarReloj();
      // Aprobaciones de más de 24 h: se rechazan y la tarea que esperaba se cierra (antes quedaba colgada para siempre).
      const podarAprobaciones = async () => {
        try {
          const r = await query<{ agente_ejecucion_id: string | null }>(`UPDATE aprobaciones SET estado='rechazada', resuelto_en=now() WHERE estado='pendiente' AND creado_en < now() - interval '24 hours' RETURNING agente_ejecucion_id`);
          const ids = r.map((x) => x.agente_ejecucion_id).filter(Boolean);
          if (ids.length) await query(`UPDATE ejecuciones SET estado='fallida' WHERE id = ANY($1::uuid[]) AND estado='esperando_aprobacion'`, [ids]);
          if (r.length) console.log(`[aprobaciones] ${r.length} aprobaciones de más de 24 h rechazadas; ${ids.length} tareas cerradas.`);
        } catch (e: any) { console.warn("[aprobaciones] poda:", e?.message || e); }
      };
      podarAprobaciones(); setInterval(podarAprobaciones, 3600 * 1000);
      // Biblioteca: envejecimiento diario (debilita lo que nadie usa, propone refrescar lo muy viejo).
      // El envejecimiento de la biblioteca ahora es parte del sueño de Lara (motor/sueno.ts, cada noche).
      limpiarArchivosViejos().catch((e) => console.warn("[archivos] limpieza:", e?.message || e));
      setInterval(() => limpiarArchivosViejos().catch(() => {}), 24 * 3600 * 1000);
      await iniciarTunel(PORT_PUBLICO);   // ngrok publica SOLO la puerta pública, nunca el panel
    });
  })
  .catch((e) => {
    console.error("✘ El registro no pudo cargarse. Emilia no arranca hasta que se corrija:\n", e?.message || e);
    process.exit(1);
  });