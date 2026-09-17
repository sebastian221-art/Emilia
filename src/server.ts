import express from "express";
import type { Request, Response, NextFunction } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import "dotenv/config";

import { rutasCrear } from "./rutas/crear.js";
import { rutasAgentes } from "./rutas/agentes.js";
import { rutasChat } from "./rutas/chat.js";
import { rutasDocumentos } from "./rutas/documentos.js";
import { rutasSkills } from "./rutas/skills.js";
import { rutasTools } from "./rutas/tools.js";
import { verificarWebhook, recibirMensaje } from "./whatsapp/webhook.js";
import { iniciarTunel } from "./whatsapp/tunel.js";
import { rutasRecordatorio } from "./rutas/recordatorio.js";
import { rutasFlujos } from "./rutas/flujos.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUB = path.join(__dirname, "..", "public");

const app = express();
app.use(express.json({
  limit: "2mb",
  verify: (req, _res, buf) => { (req as any).rawBody = buf; },
}));
app.use(express.static(PUB));

// ── Rutas de API (backend real por página) ────────────────────────────────
app.use(rutasCrear);
app.use(rutasAgentes);
app.use(rutasChat);
app.use(rutasDocumentos);
app.use(rutasSkills);
app.use(rutasTools);
app.use(rutasRecordatorio);
app.use(rutasFlujos);

// ── Webhook de WhatsApp ──
app.get("/webhook/whatsapp", verificarWebhook);
app.post("/webhook/whatsapp", recibirMensaje);

// ── URLs limpias de las páginas ───────────────────────────────────────────
const PAGINAS = ["crear", "agentes", "skills", "tools", "flujos", "aprobaciones"];
for (const p of PAGINAS) {
  // Acepta /crear y /crear/ por igual (la barra final ya no rompe).
  app.get([`/${p}`, `/${p}/`], (_req, res) => {
    const idx = path.join(PUB, p, "index.html");
    if (existsSync(idx)) res.sendFile(idx);
    else res.send(`<link rel="stylesheet" href="/comun/estilos.css"><nav style="padding:10px 24px"><a href="/crear">← volver a crear</a></nav><main style="max-width:1100px;margin:0 auto;padding:24px"><h1>Página "${p}"</h1><p class="sub">Todavía no construida — la armamos en su turno según el plan.</p></main>`);
  });
}
app.get("/", (_req, res) => res.redirect("/crear"));

// Espacio interno de un agente: /agentes/{id}. Su pantalla se construye en el
// próximo paso; por ahora, si no existe el archivo, muestra un aviso claro.
app.get("/agentes/:id", (req, res) => {
  const idx = path.join(PUB, "agentes", "espacio.html");
  if (existsSync(idx)) res.sendFile(idx);
  else res.send(`<link rel="stylesheet" href="/comun/estilos.css"><nav style="padding:10px 24px"><a href="/agentes">← volver a agentes</a></nav><main style="max-width:1100px;margin:0 auto;padding:24px"><h1>Espacio del agente</h1><p class="sub">Agente ${req.params.id}. El espacio interno (chat, documentos, esqueleto, trazas) es el próximo paso.</p></main>`);
});

// ── Manejo de errores robusto: ningún error tumba el proceso entero ────────
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  // Log completo para diagnóstico: mensaje + stack + detalle.
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
app.listen(PORT, async () => {
  console.log(`Emilia en http://localhost:${PORT}`);
  await iniciarTunel(PORT);
});