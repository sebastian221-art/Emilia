// ARCHIVO: src/motor/navegador.ts
// ─────────────────────────────────────────────────────────────────────────────
//  NAVEGADOR — automatización con Playwright (npm install playwright && npx playwright install chromium)
//  Un navegador persistente por servidor; pestaña actual reutilizable.
//  PC_NAVEGADOR_VISIBLE=true para verlo trabajar. PC_NAVEGADOR_CANAL=msedge|chrome
//  para usar el navegador ya instalado en Windows sin descargar Chromium.
// ─────────────────────────────────────────────────────────────────────────────

import { exigirPc } from "./pc.js";

let navegador: any = null, contexto: any = null, pagina: any = null;

async function pw(): Promise<any> {
  const nombre = "playwright";   // import dinámico por nombre para que compile aunque no esté instalado
  try { return await import(nombre); } catch { throw new Error("Falta Playwright: corré `npm install playwright` y `npx playwright install chromium`."); }
}

export async function paginaActual(): Promise<any> {
  exigirPc();
  if (pagina && !pagina.isClosed()) return pagina;
  const { chromium } = await pw();
  if (!navegador) {
    const headless = (process.env.PC_NAVEGADOR_VISIBLE || "").toLowerCase() !== "true";
    // Orden: canal configurado → Chromium de Playwright → Edge → Chrome (los dos últimos ya vienen en Windows).
    const canales = [process.env.PC_NAVEGADOR_CANAL, undefined, "msedge", "chrome"].filter((c, i, arr) => arr.indexOf(c) === i);
    let ultimoError: any = null;
    for (const canal of canales) {
      try { navegador = await chromium.launch({ headless, ...(canal ? { channel: canal } : {}) }); break; }
      catch (e: any) { ultimoError = e; }
    }
    if (!navegador) throw new Error(`No pude abrir ningún navegador (probé Chromium de Playwright, Edge y Chrome). ${ultimoError?.message?.split("\n")[0] || ""} Instalá uno con \`npx playwright install chromium\` o poné PC_NAVEGADOR_CANAL=msedge.`);
  }
  if (!contexto) contexto = await navegador.newContext({ viewport: { width: 1280, height: 800 }, locale: "es-CO" });
  pagina = await contexto.newPage();
  return pagina;
}

export async function irA(url: string): Promise<{ titulo: string; url: string }> {
  const p = await paginaActual();
  await p.goto(url.startsWith("http") ? url : `https://${url}`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await p.waitForTimeout(800);
  return { titulo: await p.title(), url: p.url() };
}

/** Texto visible y enlaces/campos principales, recortado para el modelo. */
export async function leerPagina(maxChars = 6000): Promise<{ titulo: string; url: string; texto: string; enlaces: { texto: string; href: string }[]; campos: { tipo: string; nombre: string; placeholder: string }[] }> {
  const p = await paginaActual();
  const datos = await p.evaluate(() => {
    const texto = (document.body?.innerText || "").replace(/\n{3,}/g, "\n\n");
    const enlaces = Array.from(document.querySelectorAll("a[href]")).slice(0, 60).map((a: any) => ({ texto: (a.innerText || "").trim().slice(0, 60), href: a.href })).filter((x: any) => x.texto);
    const campos = Array.from(document.querySelectorAll("input, textarea, select, button")).slice(0, 40).map((e: any) => ({ tipo: e.tagName.toLowerCase() + (e.type ? ":" + e.type : ""), nombre: e.name || e.id || "", placeholder: e.placeholder || (e.innerText || "").trim().slice(0, 40) }));
    return { texto, enlaces, campos };
  });
  return { titulo: await p.title(), url: p.url(), texto: datos.texto.slice(0, maxChars), enlaces: datos.enlaces, campos: datos.campos };
}

export async function clic(objetivo: string): Promise<string> {
  const p = await paginaActual();
  // selector CSS, o texto visible
  const esSelector = /^[#.\[]|^[a-z]+[.#\[:]/i.test(objetivo) && !objetivo.includes(" ");
  const loc = esSelector ? p.locator(objetivo).first() : p.getByText(objetivo, { exact: false }).first();
  await loc.click({ timeout: 10000 });
  await p.waitForTimeout(800);
  return `Clic en "${objetivo}". Ahora en ${p.url()}`;
}

export async function escribir(objetivo: string, texto: string, enter = false): Promise<string> {
  const p = await paginaActual();
  const esSelector = /^[#.\[]|^[a-z]+[.#\[:]/i.test(objetivo) && !objetivo.includes(" ");
  const loc = esSelector ? p.locator(objetivo).first() : p.getByPlaceholder(objetivo).or(p.getByLabel(objetivo)).first();
  await loc.fill(texto, { timeout: 10000 });
  if (enter) { await loc.press("Enter"); await p.waitForTimeout(1000); }
  return `Escribí en "${objetivo}"${enter ? " y presioné Enter" : ""}.`;
}

export async function capturaPagina(): Promise<Buffer> {
  const p = await paginaActual();
  return Buffer.from(await p.screenshot({ fullPage: false, type: "png" }));
}

export async function cerrarNavegador() {
  try { await contexto?.close(); await navegador?.close(); } catch { /* nada */ }
  navegador = contexto = pagina = null;
}