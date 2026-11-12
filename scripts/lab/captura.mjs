// ARCHIVO: scripts/lab/captura.mjs
// ─────────────────────────────────────────────────────────────────────────────
//  Captura una página web para estudiarla o replicarla (se copia al laboratorio
//  en herramientas/). Uso:
//    node captura.mjs <url> <carpeta-salida> [--solo-escritorio]
//  Deja en la carpeta:
//    escritorio-completa.png, movil-completa.png      la página entera
//    escritorio-scroll-0..4.png                        pantallazos bajando (animaciones al hacer scroll)
//    escritorio-hover-N.png                            botones/links con el mouse encima
//    pagina.html                                       el HTML ya renderizado
//    analisis.json                                     fuentes, colores, animaciones, librerías,
//                                                      estructura de secciones, imágenes, textos
//  Claude Code puede abrir los .png con su herramienta Read y VERLOS.
// ─────────────────────────────────────────────────────────────────────────────
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const [url, salida = "captura", ...flags] = process.argv.slice(2);
if (!url) { console.error("Uso: node captura.mjs <url> <carpeta-salida> [--solo-escritorio]"); process.exit(1); }
mkdirSync(salida, { recursive: true });
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

async function cargar(page) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  await pausa(1500);
}
// Baja toda la página para disparar lazy-load y animaciones de entrada, y vuelve arriba.
async function recorrer(page) {
  await page.evaluate(async () => {
    const paso = Math.max(300, innerHeight * 0.8);
    for (let y = 0; y < document.documentElement.scrollHeight; y += paso) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 250)); }
    scrollTo(0, 0);
  });
  await pausa(800);
}

const navegador = await chromium.launch();
const analisis = { url, fecha: new Date().toISOString() };
try {
  // ── Escritorio ──
  const ctx = await navegador.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await cargar(page);
  const alto = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let i = 0; i <= 4; i++) {
    await page.evaluate((y) => scrollTo(0, y), Math.round(((alto - 900) * i) / 4));
    await pausa(900);
    await page.screenshot({ path: path.join(salida, `escritorio-scroll-${i}.png`) });
  }
  await recorrer(page);
  await page.screenshot({ path: path.join(salida, "escritorio-completa.png"), fullPage: true });
  writeFileSync(path.join(salida, "pagina.html"), await page.content());

  Object.assign(analisis, await page.evaluate(() => {
    const cuenta = (m, k) => m.set(k, (m.get(k) || 0) + 1);
    const top = (m, n) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => ({ valor: k, usos: v }));
    const colores = new Map(), fondos = new Map(), degradados = new Map(), fuentes = new Map(), animaciones = new Map(), transiciones = new Map();
    for (const el of document.querySelectorAll("html, body, body *")) {
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") continue;
      if (el.childElementCount === 0 && el.textContent.trim()) { cuenta(colores, cs.color); cuenta(fuentes, `${cs.fontFamily.split(",")[0].replace(/["']/g, "")} ${cs.fontWeight} ${cs.fontSize}`); }
      if (cs.backgroundColor !== "rgba(0, 0, 0, 0)") cuenta(fondos, cs.backgroundColor);
      if (cs.backgroundImage.includes("gradient")) cuenta(degradados, cs.backgroundImage.slice(0, 200));
      if (cs.animationName && cs.animationName !== "none") cuenta(animaciones, `${cs.animationName} ${cs.animationDuration} ${cs.animationTimingFunction}`);
      if (cs.transitionProperty && cs.transitionProperty !== "all" && cs.transitionDuration !== "0s") cuenta(transiciones, `${cs.transitionProperty} ${cs.transitionDuration}`);
    }
    const keyframes = [], fuentesWeb = new Set();
    for (const hoja of document.styleSheets) {
      let reglas; try { reglas = hoja.cssRules; } catch { continue; }
      for (const r of reglas) {
        if (r.type === CSSRule.KEYFRAMES_RULE) keyframes.push({ nombre: r.name, css: r.cssText.slice(0, 600) });
        if (r.type === CSSRule.FONT_FACE_RULE) fuentesWeb.add(r.style.getPropertyValue("font-family").replace(/["']/g, ""));
      }
    }
    const w = window, librerias = [];
    if (w.gsap) librerias.push("GSAP"); if (w.ScrollTrigger) librerias.push("GSAP ScrollTrigger"); if (w.AOS || document.querySelector("[data-aos]")) librerias.push("AOS");
    if (w.Swiper || document.querySelector(".swiper")) librerias.push("Swiper"); if (w.THREE) librerias.push("Three.js"); if (w.lottie || document.querySelector("lottie-player")) librerias.push("Lottie");
    if (w.Lenis || document.documentElement.classList.contains("lenis")) librerias.push("Lenis (smooth scroll)"); if (w.jQuery) librerias.push("jQuery");
    if (document.querySelector("[data-framer-name], [data-framer-component-type]")) librerias.push("Framer"); if (document.querySelector("#__next")) librerias.push("Next.js");
    if (document.querySelector("[data-reactroot], #root")) librerias.push("React (probable)"); if (document.querySelector("[data-v-app], [data-v-]")) librerias.push("Vue (probable)");
    if (document.querySelector("[class*='wp-']")) librerias.push("WordPress"); if (document.querySelector('[class*="md:"], [class*="lg:"]')) librerias.push("Tailwind (probable)");
    const secciones = [...document.querySelectorAll("header, nav, section, main > div, footer")].slice(0, 30).map((s) => {
      const r = s.getBoundingClientRect();
      return { etiqueta: s.tagName.toLowerCase(), id: s.id || undefined, clase: (s.className?.toString() || "").slice(0, 80) || undefined, alto: Math.round(r.height), titulos: [...s.querySelectorAll("h1,h2,h3")].slice(0, 4).map((h) => h.textContent.trim().slice(0, 100)), botones: [...s.querySelectorAll("button, a[class*='btn'], a[class*='button']")].slice(0, 4).map((b) => b.textContent.trim().slice(0, 40)) };
    });
    return {
      titulo: document.title, descripcion: document.querySelector('meta[name="description"]')?.content,
      colores_texto: top(colores, 10), colores_fondo: top(fondos, 10), degradados: top(degradados, 6), tipografias: top(fuentes, 12), fuentes_web: [...fuentesWeb],
      animaciones_css: top(animaciones, 15), transiciones: top(transiciones, 15), keyframes: keyframes.slice(0, 20), librerias,
      secciones, imagenes: [...document.images].slice(0, 40).map((i) => ({ src: i.currentSrc || i.src, alt: i.alt, ancho: i.naturalWidth, alto: i.naturalHeight })),
      videos: [...document.querySelectorAll("video source, video[src]")].map((v) => v.src).slice(0, 10),
      textos: document.body.innerText.replace(/\n{3,}/g, "\n\n").slice(0, 6000),
    };
  }));

  // Hover de los primeros botones visibles (para copiar los estados).
  const botones = await page.$$("button:visible, a[class*='btn']:visible, a[class*='button']:visible, nav a:visible");
  let n = 0;
  for (const b of botones.slice(0, 4)) {
    try { await b.scrollIntoViewIfNeeded(); await b.hover(); await pausa(500); const caja = await b.boundingBox(); if (!caja) continue;
      await page.screenshot({ path: path.join(salida, `escritorio-hover-${n++}.png`), clip: { x: Math.max(0, caja.x - 40), y: Math.max(0, caja.y - 30), width: caja.width + 80, height: caja.height + 60 } }); } catch { /* no visible */ }
  }
  await ctx.close();

  // ── Móvil ──
  if (!flags.includes("--solo-escritorio")) {
    const m = await navegador.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const pm = await m.newPage();
    await cargar(pm); await recorrer(pm);
    await pm.screenshot({ path: path.join(salida, "movil-completa.png"), fullPage: true });
    await m.close();
  }
} finally {
  await navegador.close();
}
writeFileSync(path.join(salida, "analisis.json"), JSON.stringify(analisis, null, 2));
console.log(`Listo: capturas y analisis.json en ${path.resolve(salida)}`);
