// ARCHIVO: src/server.ts
import express from "express";
import type { Request, Response, NextFunction } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import "dotenv/config";
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
app.use(express.static(PUB));

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

// ── Webhook de WhatsApp ──
app.get("/webhook/whatsapp", verificarWebhook);
app.post("/webhook/whatsapp", recibirMensaje);

// ── URLs limpias de las páginas ───────────────────────────────────────────
const PAGINAS = ["crear", "agentes", "skills", "tools", "flujos", "aprobaciones", "codigo"];
for (const p of PAGINAS) {
  app.get([`/${p}`, `/${p}/`], (_req, res) => {
    const idx = path.join(PUB, p, "index.html");
    if (existsSync(idx)) res.sendFile(idx);
    else res.send(`<link rel="stylesheet" href="/comun/estilos.css"><nav style="padding:10px 24px"><a href="/crear">← volver a crear</a></nav><main style="max-width:1100px;margin:0 auto;padding:24px"><h1>Página "${p}"</h1><p class="sub">Todavía no construida — la armamos en su turno según el plan.</p></main>`);
  });
}
app.get("/", (_req, res) => res.redirect("/crear"));

app.get("/agentes/:id", (req, res) => {
  const idx = path.join(PUB, "agentes", "espacio.html");
  if (existsSync(idx)) res.sendFile(idx);
  else res.send(`<link rel="stylesheet" href="/comun/estilos.css"><nav style="padding:10px 24px"><a href="/agentes">← volver a agentes</a></nav><main style="max-width:1100px;margin:0 auto;padding:24px"><h1>Espacio del agente</h1><p class="sub">Agente ${req.params.id}.</p></main>`);
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
      await iniciarTunel(PORT);
    });
  })
  .catch((e) => {
    console.error("✘ El registro no pudo cargarse. Emilia no arranca hasta que se corrija:\n", e?.message || e);
    process.exit(1);
  });