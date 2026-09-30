// ARCHIVO: src/motor/operador-v2.ts
// ─────────────────────────────────────────────────────────────────────────────
//  OPERADOR v2 — planifica con texto, ejecuta por capas, verifica, aprende.
//  Capas: comando (apps, PowerShell, Office por COM) → teclado → elemento por
//  nombre (UI Automation) / OCR con coordenadas → visión (último recurso).
//  Reglas duras: nunca teclear si la ventana objetivo no está al frente;
//  verificación con la accesibilidad como fuente de verdad; diff de estado
//  tras cada paso; re-planificación con el error; cancelación del jefe;
//  receta guardada al terminar bien.
// ─────────────────────────────────────────────────────────────────────────────
import { createHash } from "node:crypto";
import { llamarModelo } from "./groq.js";
import { abrir, capturarPantalla } from "./pc.js";
import { tecla, escribirTexto, clic, ventanaActiva, scroll, enfocarVentana, ventanaActivaInfo } from "./pc-control.js";
import { elementosVentana, clicElemento, escribirEnElemento, textoVentana } from "./uia.js";
import { ocrPantalla, clicTexto } from "./ocr.js";
import { excelEscribir, excelLeer, wordCrear } from "./office.js";
import { analizarImagen } from "./vision.js";
import { hechosEntorno } from "./entorno-pc.js";
import { RECETAS_BASE, recetasAprendidas, guardarReceta } from "./recetas.js";
import { cancelada } from "./cancelacion.js";
import { guardarArchivo } from "../dominio/archivos.js";

type Capa = "comando" | "teclado" | "elemento" | "vision" | "control";
interface Paso { id: number; capa: Capa; accion: string; args: Record<string, any>; motivo?: string }
interface Obs { ventana: string; texto?: string; resultado?: string; error?: string }
export interface BitacoraV2 { n: number; accion: string; args: string; capa: Capa; resultado: string; error?: string }
export interface ResultadoV2 { ok: boolean; estado: "cumplida" | "fallida" | "necesita_jefe" | "cancelada" | "tiempo"; resumen: string; pregunta?: string; bitacora: BitacoraV2[]; captura_id?: string; lecturas: string[] }

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

const PROCESO_DE: Record<string, string> = { calc: "calculatorapp", calculadora: "calculatorapp", notepad: "notepad", "bloc de notas": "notepad", mspaint: "mspaint", paint: "mspaint", explorer: "explorer", cmd: "cmd", powershell: "powershell", wt: "windowsterminal", chrome: "chrome", msedge: "msedge", edge: "msedge", excel: "excel", winword: "winword", word: "winword", powerpnt: "powerpnt", code: "code", spotify: "spotify", outlook: "outlook" };

const PRIMITIVAS = `PRIMITIVAS (elegí la capa MÁS determinista que sirva):
[comando]  abrir_app(nombre_o_ruta_o_url) [abre Y trae al frente] · ejecutar(powershell) · excel_escribir(ruta, celdas:{"A1":"x"}, hoja?) · excel_leer(ruta, rango, hoja?) · word_crear(ruta, texto, titulo?)
[teclado]  enfocar(proceso_o_titulo) [trae una ventana al frente; OBLIGATORIO antes de teclear en una app que ya estaba abierta] · tecla(combo: "enter","ctrl+s","alt+f4"…) · escribir(texto) · guardar_como(ruta_completa)
[elemento] leer_ventana() [texto por accesibilidad] · listar_elementos(filtro?) · clic_elemento(nombre, tipo?) · escribir_elemento(nombre_campo, texto) · leer_ocr() [texto en pantalla por OCR] · clic_texto(texto_visible) [clic donde se lee ese texto]
[vision]   leer_pantalla(pregunta) · clic_visual(descripcion) [último recurso] · verificar(criterio) [criterio POSITIVO y comprobable: "la Calculadora muestra 4", "existe C:\\\\...\\\\x.txt"]
[control]  esperar(segundos) · preguntar(pregunta) · terminar(resumen)
REGLAS: Excel/Word por COM (excel_escribir/word_crear) siempre que se pueda. Clics: clic_elemento → clic_texto → clic_visual. No uses clics para abrir programas. Mínimos pasos.`;

export async function operarV2(tarea: string, op: { agenteId?: string | null; conversacionId?: string | null; onPaso?: (b: BitacoraV2) => Promise<void>; maxMinutos?: number } = {}): Promise<ResultadoV2> {
  const inicio = Date.now(); const limite = (op.maxMinutos ?? 6) * 60000;
  const bit: BitacoraV2[] = []; const lecturas: string[] = [];
  let capturaId: string | undefined;
  const entorno = await hechosEntorno().catch(() => "");
  const aprendidas = await recetasAprendidas(op.agenteId);

  // ── Planificador (texto) ──
  const planificar = async (historial: string, error?: string): Promise<Paso[] | { preguntar: string } | { fallar: string }> => {
    const prompt = `Sos el planificador de un operador de Windows. Armá el plan para cumplir la TAREA usando SOLO las primitivas, con la capa más determinista posible.
${PRIMITIVAS}

ENTORNO:\n${entorno}\n\nRECETARIO:\n${RECETAS_BASE}${aprendidas ? "\n\nRECETAS APRENDIDAS:\n" + aprendidas : ""}

TAREA: ${tarea}
${historial ? `PASOS YA EJECUTADOS Y SUS RESULTADOS:\n${historial}` : ""}${error ? `\nÚLTIMO PROBLEMA: ${error}\nRe-planificá desde aquí sin repetir lo que falló (cambiá de capa o de estrategia).` : ""}

Respondé SOLO JSON con el plan RESTANTE (máx 12 pasos), terminando con verificar y terminar:
{"pasos":[{"id":1,"capa":"comando","accion":"abrir_app","args":{"nombre":"notepad"},"motivo":"…"},…,{"id":N,"capa":"vision","accion":"verificar","args":{"criterio":"…"}},{"id":N+1,"capa":"control","accion":"terminar","args":{"resumen":"…"}}]}
O si necesitás al jefe: {"preguntar":"…"}. O si es imposible: {"fallar":"motivo"}.`;
    const r = await llamarModelo([{ role: "user", content: prompt }], [], { temperatura: 0.1 });
    try { const p = JSON.parse(r.texto.replace(/```json|```/g, "").trim()); if (p.preguntar) return { preguntar: p.preguntar }; if (p.fallar) return { fallar: p.fallar }; return Array.isArray(p.pasos) ? p.pasos : []; } catch { return { fallar: `El planificador devolvió algo ilegible: ${r.texto.slice(0, 200)}` }; }
  };

  // ── Foco: la app en la que debemos estar ──
  let objetivo: { proceso?: string; titulo?: string } | null = null;
  const asegurarFoco = async (): Promise<string | null> => {
    if (!objetivo) return null;
    const v = await ventanaActivaInfo();
    const ok = (objetivo.proceso && v.proceso.startsWith(objetivo.proceso)) || (objetivo.titulo && v.titulo.toLowerCase().includes(objetivo.titulo.toLowerCase()));
    if (ok) return null;
    const f = await enfocarVentana(objetivo);
    return f.ok ? null : `La ventana activa es "${f.ventana.titulo}" (${f.ventana.proceso}) y no la esperada (${objetivo.proceso || objetivo.titulo}). No tecleo ahí. ${f.error || ""} (El jefe no debe usar el PC mientras opero.)`;
  };
  const huellaEstado = async () => { try { const t = await textoVentana(); const v = await ventanaActivaInfo(); return `${v.proceso}|${v.titulo}|${createHash("sha1").update(t.texto).digest("hex").slice(0, 8)}`; } catch { return ""; } };
  const capturar = async () => { const c = await capturarPantalla({ rejilla: true, maxAncho: 1280 }); const a = await guardarArchivo({ nombre: `op_${Date.now()}.png`, mime: "image/png", contenido: c.contenido, origen: "generado", conversacionId: op.conversacionId ?? null, agenteId: op.agenteId ?? null }).catch(() => null); capturaId = a?.id; return c; };

  // ── Ejecutor ──
  const ejecutar = async (p: Paso): Promise<Obs> => {
    const a = p.args || {};
    const v = await ventanaActiva().catch(() => "");
    const requiereFoco = ["tecla", "escribir", "guardar_como", "leer_ventana", "listar_elementos", "clic_elemento", "escribir_elemento", "clic_texto", "leer_ocr", "clic_visual", "leer_pantalla"];
    if (requiereFoco.includes(p.accion)) { const e = await asegurarFoco(); if (e) return { ventana: v, error: e }; }
    switch (p.accion) {
      case "abrir_app": {
        const nombre = String(a.nombre || a.ruta || a.url || ""); const r = await abrir(nombre);
        if (r.codigo !== 0) return { ventana: v, error: (r.stderr || r.stdout).slice(-200) };
        await dormir(2500);
        const clave = nombre.toLowerCase().replace(/\.exe$/, "");
        const proc = PROCESO_DE[clave] || (/^(https?:|ms-settings:|[a-z]:\\)/i.test(nombre) ? undefined : clave);
        objetivo = proc ? { proceso: proc } : null;
        if (!objetivo) return { ventana: await ventanaActiva().catch(() => ""), resultado: "abierto" };
        const f = await enfocarVentana(objetivo);
        return f.ok ? { ventana: f.ventana.titulo, resultado: `abierto y al frente (${f.ventana.proceso})` } : { ventana: f.ventana.titulo, error: `Abrí ${nombre} pero no logré traerla al frente: ${f.error}` };
      }
      case "enfocar": {
        const t = String(a.proceso || a.titulo || a.ventana || "");
        objetivo = PROCESO_DE[t.toLowerCase()] ? { proceso: PROCESO_DE[t.toLowerCase()] } : /^[a-z0-9_.-]+$/i.test(t) ? { proceso: t.toLowerCase() } : { titulo: t };
        const f = await enfocarVentana(objetivo);
        if (!f.ok) { objetivo = null; return { ventana: f.ventana.titulo, error: f.error }; }
        return { ventana: f.ventana.titulo, resultado: `al frente: ${f.ventana.proceso}` };
      }
      case "ejecutar": { const { powershell, comandoProhibido } = await import("./pc.js"); const pr = comandoProhibido(String(a.comando || "")); if (pr) return { ventana: v, error: pr }; const r = await powershell(String(a.comando || ""), 60); return { ventana: v, resultado: (r.stdout || r.stderr).slice(-500), error: r.codigo === 0 ? undefined : `código ${r.codigo}` }; }
      case "excel_escribir": { const r = await excelEscribir(String(a.ruta), a.celdas || {}, a.hoja); return r.ok ? { ventana: v, resultado: `Excel escrito: ${r.ruta}` } : { ventana: v, error: r.error }; }
      case "excel_leer": { const r = await excelLeer(String(a.ruta), a.rango || "A1:F30", a.hoja); if (!r.ok) return { ventana: v, error: r.error }; const txt = (r.filas || []).map((f) => f.join(" | ")).join("\n").slice(0, 1500); lecturas.push(txt); return { ventana: v, texto: txt, resultado: "leído" }; }
      case "word_crear": { const r = await wordCrear(String(a.ruta), String(a.texto || ""), a.titulo); return r.ok ? { ventana: v, resultado: `Word creado: ${r.ruta}` } : { ventana: v, error: r.error }; }
      case "tecla": await tecla(String(a.combo || a.teclas || a.tecla || "")); await dormir(/win|enter|alt\+f4/i.test(String(a.combo || a.teclas || "")) ? 1500 : 500); return { ventana: await ventanaActiva().catch(() => ""), resultado: "ok" };
      case "escribir": await escribirTexto(String(a.texto ?? "")); await dormir(400); return { ventana: v, resultado: "ok" };
      case "guardar_como": {
        const ruta = String(a.ruta || a.ruta_completa || "");
        if (!/^[a-zA-Z]:\\/.test(ruta)) return { ventana: v, error: "guardar_como necesita una ruta absoluta (C:\\...)" };
        await tecla("ctrl+s"); await dormir(1500);
        const campo = await escribirEnElemento("Nombre de archivo", ruta).catch(() => ({ ok: false } as any));
        if (!campo.ok) { const c2 = await escribirEnElemento("File name", ruta).catch(() => ({ ok: false } as any)); if (!c2.ok) { await tecla("ctrl+a"); await escribirTexto(ruta); } }
        await dormir(300); await tecla("enter"); await dormir(1500);
        const dlg = await elementosVentana().catch(() => null);
        if (dlg && dlg.elementos.some((e) => /reemplazar|replace|ya existe/i.test(e.nombre))) { await clicElemento("Sí").catch(async () => { await clicElemento("Yes").catch(() => {}); }); await dormir(800); }
        return { ventana: await ventanaActiva().catch(() => ""), resultado: `guardado en ${ruta}` };
      }
      case "leer_ventana": { const t = await textoVentana(); lecturas.push(t.texto); return { ventana: t.ventana, texto: t.texto.slice(0, 1500), resultado: "leído" }; }
      case "listar_elementos": { const l = await elementosVentana(a.filtro); const txt = l.elementos.filter((e) => e.nombre).slice(0, 60).map((e) => `${e.tipo}:${e.nombre}${e.valor ? "=" + e.valor.slice(0, 30) : ""}`).join(" · "); return { ventana: l.ventana, texto: txt, resultado: `${l.elementos.length} controles` }; }
      case "clic_elemento": { const r = await clicElemento(String(a.nombre || ""), a.tipo); if (!r.ok) return { ventana: v, error: r.error }; await dormir(800); return { ventana: await ventanaActiva().catch(() => ""), resultado: `clic en "${r.elemento?.nombre}" (${r.metodo})` }; }
      case "escribir_elemento": { const r = await escribirEnElemento(String(a.nombre || a.campo || "*"), String(a.texto ?? "")); if (!r.ok) return { ventana: v, error: r.error }; return { ventana: v, resultado: `escrito en "${r.elemento?.nombre}" (${r.metodo})` }; }
      case "leer_ocr": { const o = await ocrPantalla(); const txt = o.lineas.join("\n").slice(0, 2000); lecturas.push(txt); return { ventana: v, texto: txt, resultado: `${o.palabras.length} palabras` }; }
      case "clic_texto": { const r = await clicTexto(String(a.texto || ""), Number(a.ocurrencia) || 1); if (!r.ok) return { ventana: v, error: `${r.error} Textos visibles: ${(r.vistos || []).slice(0, 15).join(" · ")}` }; await dormir(800); return { ventana: await ventanaActiva().catch(() => ""), resultado: `clic en el texto "${r.caja?.texto}"` }; }
      case "leer_pantalla": { const c = await capturar(); const r = await analizarImagen(c.contenido, "image/png", { pregunta: String(a.pregunta || "Describí qué se ve.") }); lecturas.push(r.texto || ""); return { ventana: v, texto: r.texto, resultado: "visto", error: r.ok ? undefined : r.error }; }
      case "clic_visual": {
        const c = await capturar();
        const r = await analizarImagen(c.contenido, "image/png", { pregunta: `Localizá este elemento en la pantalla: "${a.descripcion || a.elemento}". Rejilla magenta cada 100 px numerada. Respondé SOLO JSON {"x":int,"y":int,"encontrado":true|false} con el CENTRO del elemento en píxeles de la imagen (${c.ancho}x${c.alto}).`, json: true, maxTokens: 120 });
        const j: any = r.json || {}; if (!j.encontrado || j.x == null) return { ventana: v, error: `no encontré visualmente "${a.descripcion || a.elemento}"` };
        await clic(Math.round(j.x * c.escala) + c.origenX, Math.round(j.y * c.escala) + c.origenY); await dormir(800);
        return { ventana: await ventanaActiva().catch(() => ""), resultado: `clic visual en (${j.x},${j.y})` };
      }
      case "verificar": {
        const crit = String(a.criterio || "");
        const mArchivo = crit.match(/existe (?:el archivo )?([a-zA-Z]:\\[^\s"']+)/i);
        if (mArchivo) { const { promises: fsp } = await import("node:fs"); try { const st = await fsp.stat(mArchivo[1]); return { ventana: v, resultado: `verificado: existe ${mArchivo[1]} (${st.size} bytes)` }; } catch { return { ventana: v, error: `verificación negativa: no existe ${mArchivo[1]}` }; } }
        if (objetivo) { const e = await asegurarFoco(); if (e) return { ventana: v, error: `verificación negativa: ${e}` }; }
        const vi = await ventanaActivaInfo();
        const acc = await textoVentana().catch(() => ({ ventana: v, texto: "" }));
        const esperado = crit.match(/muestra\s+"?([^"]+?)"?\s*$/i)?.[1];
        if (esperado && acc.texto.toLowerCase().includes(esperado.toLowerCase())) return { ventana: vi.titulo, resultado: `verificado por accesibilidad: "${esperado}" en ${vi.titulo}` };
        const c = await capturar();
        const r = await analizarImagen(c.contenido, "image/png", { pregunta: `Criterio: "${crit}". Ventana activa: "${vi.titulo}" (${vi.proceso}). Texto accesible de esa ventana (fuente de verdad; si contradice lo que creés ver, respondé false): "${acc.texto.slice(0, 800)}". ¿Se cumple? Respondé SOLO JSON {"cumple":true|false,"motivo":"…"}`, json: true, maxTokens: 150 });
        const j: any = r.json || {}; return { ventana: vi.titulo, resultado: j.cumple ? `verificado: ${j.motivo}` : undefined, error: j.cumple ? undefined : `verificación negativa: ${j.motivo || r.texto}` };
      }
      case "scroll": await scroll(Number(a.x) || 640, Number(a.y) || 400, a.direccion === "abajo" ? -(a.cantidad || 3) : (a.cantidad || 3)); return { ventana: v, resultado: "ok" };
      case "esperar": await dormir(Math.min(Number(a.segundos) || 2, 20) * 1000); return { ventana: v, resultado: "ok" };
      default: return { ventana: v, error: `primitiva desconocida: ${p.accion}` };
    }
  };

  // ── Bucle plan → ejecutar → re-planificar ──
  let plan = await planificar("");
  let replanes = 0, n = 0;
  while (true) {
    if ("preguntar" in plan) return { ok: false, estado: "necesita_jefe", resumen: plan.preguntar, pregunta: plan.preguntar, bitacora: bit, captura_id: capturaId, lecturas };
    if ("fallar" in plan) return { ok: false, estado: "fallida", resumen: plan.fallar, bitacora: bit, captura_id: capturaId, lecturas };
    let fallo: string | undefined;
    for (const p of plan) {
      if (cancelada(op.conversacionId)) return { ok: false, estado: "cancelada", resumen: "Detenido por el jefe.", bitacora: bit, captura_id: capturaId, lecturas };
      if (Date.now() - inicio > limite) return { ok: false, estado: "tiempo", resumen: `Se agotó el tiempo (${op.maxMinutos ?? 6} min).`, bitacora: bit, captura_id: capturaId, lecturas };
      n++;
      if (p.accion === "terminar") {
        const b: BitacoraV2 = { n, accion: "terminar", args: "", capa: "control", resultado: String(p.args?.resumen || "") }; bit.push(b); await op.onPaso?.(b);
        await guardarReceta(op.agenteId, tarea, `Tarea: ${tarea}\nPasos que funcionaron:\n${bit.filter((x) => !x.error && x.accion !== "terminar").map((x) => `${x.accion}(${x.args})`).join(" → ")}`).catch(() => {});
        return { ok: true, estado: "cumplida", resumen: String(p.args?.resumen || "Tarea cumplida."), bitacora: bit, captura_id: capturaId, lecturas };
      }
      if (p.accion === "preguntar") return { ok: false, estado: "necesita_jefe", resumen: String(p.args?.pregunta || ""), pregunta: String(p.args?.pregunta || "¿Cómo sigo?"), bitacora: bit, captura_id: capturaId, lecturas };
      const antes = await huellaEstado();
      let obs: Obs;
      try { obs = await ejecutar(p); } catch (e: any) { obs = { ventana: "", error: e?.message || String(e) }; }
      const despues = await huellaEstado();
      const sinCambio = antes && despues && antes === despues && !["leer_ventana", "listar_elementos", "leer_ocr", "leer_pantalla", "verificar", "esperar", "excel_leer"].includes(p.accion);
      const b: BitacoraV2 = { n, accion: p.accion, args: JSON.stringify(p.args || {}).slice(0, 120), capa: p.capa, resultado: `${obs.resultado || ""}${obs.texto ? " · " + obs.texto.slice(0, 160) : ""} [${obs.ventana}]${sinCambio ? " (la pantalla NO cambió)" : ""}`, error: obs.error };
      bit.push(b); await op.onPaso?.(b);
      if (obs.error) { fallo = `${p.accion}(${b.args}) → ${obs.error}`; break; }
    }
    if (!fallo) fallo = "El plan terminó sin un paso 'terminar' verificado.";
    replanes++;
    if (replanes > 3) return { ok: false, estado: "fallida", resumen: `Después de ${replanes} planes no pude cumplirla. Último problema: ${fallo}`, bitacora: bit, captura_id: capturaId, lecturas };
    const historial = bit.map((x) => `${x.n}. [${x.capa}] ${x.accion}(${x.args}) → ${x.error ? "ERROR: " + x.error : x.resultado}`).join("\n");
    plan = await planificar(historial, fallo);
  }
}