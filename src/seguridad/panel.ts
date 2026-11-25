// ARCHIVO: src/seguridad/panel.ts
// Guardia del panel. El panel no tiene contraseña porque solo escucha en
// 127.0.0.1, pero eso solo no basta:
//  · DNS rebinding: una página maliciosa puede hacer que su dominio apunte a
//    127.0.0.1 y leer el panel. Se frena exigiendo que el Host sea local.
//  · CSRF: cualquier página abierta en tu navegador puede mandar un POST a
//    127.0.0.1. Se frena exigiendo el encabezado X-Emilia (un navegador no lo
//    deja poner desde otro origen sin preflight, y no respondemos CORS) y
//    revisando Origin cuando viene.
// /comun/menu.js envuelve fetch para que las páginas del panel lo manden solo.
import type { Request, Response, NextFunction } from "express";

const SEGUROS = new Set(["GET", "HEAD", "OPTIONS"]);
// Rutas que no vienen del navegador: webhooks firmados y procesos con token interno.
const EXENTAS = [/^\/webhook\//, /^\/api\/eventos\//, /^\/api\/interno\//];

export function hostsPermitidos(): string[] {
  const extra = (process.env.PANEL_HOSTS_PERMITIDOS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return ["localhost", "127.0.0.1", "[::1]", "::1", ...extra];
}

export function hostLocal(host: string | undefined): boolean {
  if (!host) return false;
  const h = host.toLowerCase().trim();
  const sinPuerto = h.startsWith("[") ? h.slice(0, h.indexOf("]") + 1) : h.split(":")[0];
  return hostsPermitidos().includes(sinPuerto);
}

export function origenLocal(origen: string | undefined): boolean {
  if (!origen) return true;            // sin Origin (curl, scripts locales): lo decide X-Emilia
  if (origen === "null") return false; // iframes sandbox, file://
  try { return hostLocal(new URL(origen).host); } catch { return false; }
}

export function guardiaPanel(req: Request, res: Response, next: NextFunction) {
  if (EXENTAS.some((r) => r.test(req.path))) return next();
  if (!hostLocal(req.headers.host)) {
    return res.status(421).type("text").send("Host no permitido. El panel de Emilia solo responde en localhost.");
  }
  if (SEGUROS.has(req.method)) return next();
  if (!origenLocal(req.header("origin"))) return res.status(403).json({ error: "Origen no permitido." });
  const sitio = req.header("sec-fetch-site");
  if (sitio && sitio !== "same-origin" && sitio !== "none") return res.status(403).json({ error: "Petición de otro sitio." });
  if (req.header("x-emilia") !== "1") return res.status(403).json({ error: "Falta el encabezado X-Emilia (las páginas del panel lo mandan solas)." });
  next();
}

// Se inyecta al principio de /comun/menu.js (que va en el <head>, antes que los
// scripts de cada página): todo fetch al mismo origen lleva X-Emilia.
export const ENVOLTORIO_FETCH = `(function(){
  if (window.__emiliaFetch) return; window.__emiliaFetch = true;
  var orig = window.fetch.bind(window);
  window.fetch = function(entrada, op){
    try {
      var url = typeof entrada === "string" ? entrada : (entrada && entrada.url) || "";
      var u = new URL(url, location.href);
      if (u.origin === location.origin) {
        op = Object.assign({}, op || {});
        var h = new Headers(op.headers || (entrada instanceof Request ? entrada.headers : undefined));
        h.set("X-Emilia", "1"); op.headers = h;
      }
    } catch (e) {}
    return orig(entrada, op);
  };
})();`;
