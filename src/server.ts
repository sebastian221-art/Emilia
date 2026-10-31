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
import { rutasEmpresa } from "./rutas/empresa.js";
import { rutasEventos } from "./rutas/eventos.js";
import { rutasBiblioteca } from "./rutas/biblioteca.js";
import { programarReflexionNocturna } from "./motor/pedir.js";
import { rutasVoz } from "./rutas/voz.js";
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
app.use(rutasEsqueleto);
app.get(/\.html$/, (req, res, next) => { const f = path.join(PUB, path.normalize(req.path)); if (f.startsWith(PUB) && existsSync(f)) return enviarHtml(res, f); next(); });
app.use(express.static(PUB, { index: false }));

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

// ── Webhook de WhatsApp ──
app.get("/webhook/whatsapp", verificarWebhook);
app.post("/webhook/whatsapp", recibirMensaje);

// ── Menú único para TODAS las páginas ─────────────────────────────────────
// La lista vive acá (una sola vez). /comun/menu.js se genera desde esta lista y
// cada HTML que el servidor entrega recibe ese script inyectado: no hay que
// tocar el <nav> de ninguna página para agregar una nueva.
const MENU: { ruta: string; titulo: string }[] = [
  { ruta: "/crear", titulo: "Crear agente" },
  { ruta: "/agentes", titulo: "Ver agentes" },
  { ruta: "/empresa", titulo: "Empresa" },
  { ruta: "/biblioteca", titulo: "Biblioteca" },
  { ruta: "/voz", titulo: "Voz" },
  { ruta: "/skills", titulo: "Skills" },
  { ruta: "/tools", titulo: "Tools" },
  { ruta: "/flujos", titulo: "Flujos" },
  { ruta: "/codigo", titulo: "Código" },
  { ruta: "/actividad", titulo: "Actividad" },
  { ruta: "/aprobaciones", titulo: "Aprobaciones" },
];
app.get("/comun/menu.js", (_req, res) => {
  res.type("application/javascript").set("Cache-Control", "no-cache").send(`// Generado por el servidor desde MENU en src/server.ts
(function(){
  var MENU=${JSON.stringify(MENU)};
  function pintar(){
    var nav=document.querySelector("nav"); if(!nav){ nav=document.createElement("nav"); document.body.insertBefore(nav, document.body.firstChild); }
    var aqui=location.pathname.replace(/\\/+$/,"")||"/";
    nav.innerHTML='<span class="marca">Emilia</span>'+MENU.map(function(m){
      var act = aqui===m.ruta || aqui.indexOf(m.ruta+"/")===0;
      return '<a href="'+m.ruta+'"'+(act?' class="activo"':'')+'>'+m.titulo+'</a>';
    }).join("");
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
app.get("/", (_req, res) => res.redirect("/crear"));

app.get("/agentes/:id", (req, res) => {
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

// El registro se carga ANTES de escuchar: si una capacidad está mal definida
// o una referencia está rota, el servidor no arranca y el error dice qué es.
iniciarRegistro()
  .then(() => {
    app.listen(PORT, async () => {
      console.log(`Emilia en http://localhost:${PORT}`);
      await recuperarSesionesHuerfanas();
      await retomarFlujos();
      await retomarProcesos();
      iniciarReloj();
      const podarAprobaciones = () => query(`UPDATE aprobaciones SET estado='rechazada', resuelto_en=now() WHERE estado='pendiente' AND creado_en < now() - interval '24 hours'`).then((r: any) => { if (r?.length) console.log(`[aprobaciones] ${r.length} aprobaciones viejas rechazadas.`); }).catch(() => {});
      podarAprobaciones(); setInterval(podarAprobaciones, 3600 * 1000);
      // Biblioteca: envejecimiento diario (debilita lo que nadie usa, propone refrescar lo muy viejo).
      programarReflexionNocturna(Number(process.env.SYSTEM_NOCTURNO_HORA) || 3);   // System reflexiona a las 3:00 sobre el día
      const envejecerBiblioteca = () => import("./motor/biblioteca.js").then((B) => B.envejecer(null)).catch(() => {});
      setInterval(envejecerBiblioteca, 24 * 3600 * 1000);
      limpiarArchivosViejos().catch((e) => console.warn("[archivos] limpieza:", e?.message || e));
      setInterval(() => limpiarArchivosViejos().catch(() => {}), 24 * 3600 * 1000);
      await iniciarTunel(PORT);
    });
  })
  .catch((e) => {
    console.error("✘ El registro no pudo cargarse. Emilia no arranca hasta que se corrija:\n", e?.message || e);
    process.exit(1);
  });