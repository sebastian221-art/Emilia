// ARCHIVO: src/tools/pc.ts
// ─────────────────────────────────────────────────────────────────────────────
//  TOOLS DE PC — control estructurado del computador (nivel 1)
//  Lectura sin aprobación; ejecutar comandos, escribir archivos y abrir
//  programas requieren aprobación. Todo exige PC_HABILITADO=true.
// ─────────────────────────────────────────────────────────────────────────────

import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import type { DefTool } from "../registro/tipos.js";
import { powershell, capturarPantalla, abrir, leerPortapapeles, escribirPortapapeles, infoSistema, comandoProhibido, exigirPc, resolverRuta } from "../motor/pc.js";
import { analizarImagen } from "../motor/vision.js";
import { guardarArchivo } from "../dominio/archivos.js";

const MODULO = "pc";
const casa = (r: string) => resolverRuta(r);

export const pcInfo: DefTool = {
  nombre: "pc_info", modulo: MODULO,
  descripcion: "Información del computador: sistema, CPU, memoria, discos, uptime.",
  parametros: { type: "object", properties: {}, required: [] }, riesgo: "lectura", requiereAprobacion: false,
  async ejecutar() { exigirPc(); const i = await infoSistema(); return { ok: true, datos: i, resumen: `${i.host} · ${i.so} · ${i.cpu} (${i.nucleos} núcleos) · RAM ${i.memoria_libre_gb}/${i.memoria_total_gb} GB libres · uptime ${i.uptime_h} h\n${i.discos}` }; },
};

export const pcListar: DefTool = {
  nombre: "pc_listar", modulo: MODULO,
  descripcion: "Lista el contenido de una carpeta del PC (nombre, tipo, tamaño, fecha). Acepta '~', 'descargas', 'escritorio', 'documentos', 'imagenes' (resuelve la ubicación real aunque esté en OneDrive) o rutas absolutas.",
  parametros: { type: "object", properties: { ruta: { type: "string", default: "~" }, patron: { type: "string", description: "Filtro por nombre (contiene)." }, orden: { type: "string", enum: ["fecha", "nombre"], description: "fecha = más recientes primero (defecto).", default: "fecha" }, max: { type: "integer", default: 40, minimum: 5, maximum: 300 } }, required: [] },
  riesgo: "lectura", requiereAprobacion: false,
  async ejecutar(a) {
    exigirPc();
    const ruta = await casa(a.ruta || "~");
    try { await fs.access(ruta); } catch { return { ok: false, error: `La carpeta ${ruta} no existe.` }; }
    const ents = await fs.readdir(ruta, { withFileTypes: true });
    const filas = [];
    for (const e of ents) { if (a.patron && !e.name.toLowerCase().includes(String(a.patron).toLowerCase())) continue; try { const st = await fs.stat(path.join(ruta, e.name)); filas.push({ nombre: e.name, tipo: e.isDirectory() ? "carpeta" : "archivo", kb: Math.round(st.size / 1024), modificado: st.mtime.toISOString() }); } catch { /* sin acceso */ } }
    if ((a.orden || "fecha") === "fecha") filas.sort((x, y) => y.modificado.localeCompare(x.modificado));
    else filas.sort((x, y) => (x.tipo === y.tipo ? x.nombre.localeCompare(y.nombre) : x.tipo === "carpeta" ? -1 : 1));
    const max = a.max || 40;
    return { ok: true, datos: { ruta, total: filas.length, mostrando: Math.min(max, filas.length), orden: a.orden || "fecha", items: filas.slice(0, max) }, resumen: `${ruta} — ${filas.length} elementos, mostrando ${Math.min(max, filas.length)} (${(a.orden || "fecha") === "fecha" ? "más recientes primero" : "por nombre"}):\n` + filas.slice(0, max).map((f) => `${f.tipo === "carpeta" ? "📁" : "📄"} ${f.nombre}${f.tipo === "archivo" ? ` (${f.kb} KB)` : ""} · ${f.modificado.slice(0, 16).replace("T", " ")}`).join("\n") + (filas.length > max ? `\n… y ${filas.length - max} más (pedí con patron o max mayor).` : "") };
  },
};

export const pcBuscar: DefTool = {
  nombre: "pc_buscar_archivos", modulo: MODULO,
  descripcion: "Busca archivos por nombre (comodines *) dentro de una carpeta, recursivo. Ej. patron '*.xlsx' en ruta 'descargas'. Acepta nombres de carpetas en español.",
  parametros: { type: "object", properties: { patron: { type: "string", minLength: 1 }, ruta: { type: "string", default: "~" }, max: { type: "integer", default: 40, minimum: 1, maximum: 200 } }, required: ["patron"] },
  riesgo: "lectura", requiereAprobacion: false, timeoutSeg: 120,
  async ejecutar(a) {
    const ruta = await casa(a.ruta || "~");
    try { await fs.access(ruta); } catch { return { ok: false, error: `La carpeta ${ruta} no existe. Probá con otra ruta (ej. 'descargas', 'escritorio', 'C:\\...').` }; }
    const r = await powershell(`Get-ChildItem -Path '${ruta.replace(/'/g, "''")}' -Filter '${String(a.patron).replace(/'/g, "''")}' -Recurse -File -ErrorAction SilentlyContinue | Select-Object -First ${a.max || 40} | ForEach-Object { $_.FullName + ' | ' + [math]::Round($_.Length/1KB) + ' KB | ' + $_.LastWriteTime.ToString('s') }`, 100);
    const lineas = r.stdout.split("\n").map((l) => l.trim()).filter(Boolean);
    return { ok: true, datos: { carpeta: ruta, resultados: lineas }, resumen: lineas.length ? `En ${ruta}:\n${lineas.join("\n")}` : `Sin resultados para ${a.patron} en ${ruta} (existe, pero no hay coincidencias).` };
  },
};

export const pcLeerArchivo: DefTool = {
  nombre: "pc_leer_archivo", modulo: MODULO,
  descripcion: "Lee un archivo de texto del PC (hasta 20k caracteres). Para imágenes usá pc_ver_imagen; para binarios, pc_adjuntar.",
  parametros: { type: "object", properties: { ruta: { type: "string", minLength: 1 }, desde_linea: { type: "integer", minimum: 1 }, lineas: { type: "integer", default: 300, minimum: 1, maximum: 2000 } }, required: ["ruta"] },
  riesgo: "lectura", requiereAprobacion: false,
  async ejecutar(a) {
    exigirPc();
    const texto = await fs.readFile(await casa(a.ruta), "utf-8");
    const ls = texto.split("\n"); const d = Math.max(1, a.desde_linea || 1); const trozo = ls.slice(d - 1, d - 1 + (a.lineas || 300)).join("\n").slice(0, 20000);
    return { ok: true, datos: { ruta: a.ruta, total_lineas: ls.length, contenido: trozo }, resumen: trozo.slice(0, 4000) };
  },
};

export const pcAdjuntar: DefTool = {
  nombre: "pc_adjuntar", modulo: MODULO,
  descripcion: "Toma un archivo del PC y lo registra como archivo de Emilia (devuelve archivo_id) para mandarlo por WhatsApp, subirlo a Jelcom o analizarlo.",
  parametros: { type: "object", properties: { ruta: { type: "string", minLength: 1 } }, required: ["ruta"] },
  riesgo: "lectura", requiereAprobacion: false,
  async ejecutar(a, ctx) {
    exigirPc();
    const ruta = await casa(a.ruta); const contenido = await fs.readFile(ruta);
    const ext = path.extname(ruta).toLowerCase();
    const mime = ext === ".png" ? "image/png" : ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : ext === ".pdf" ? "application/pdf" : ext === ".xlsx" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : ext === ".csv" ? "text/csv" : "application/octet-stream";
    const arch = await guardarArchivo({ nombre: path.basename(ruta), mime, contenido, origen: "panel", conversacionId: ctx.conversacionId ?? null, agenteId: ctx.agenteId });
    return { ok: true, datos: { archivo_id: arch.id, nombre: arch.nombre, kb: Math.round(arch.tam_bytes / 1024) }, resumen: `Archivo "${arch.nombre}" adjuntado (archivo_id ${arch.id}).` };
  },
};

export const pcVerPantalla: DefTool = {
  nombre: "pc_ver_pantalla", modulo: MODULO,
  descripcion: "Captura la pantalla del PC y la describe con visión (o responde una pregunta sobre lo que se ve). Devuelve también el archivo_id de la captura.",
  parametros: { type: "object", properties: { pregunta: { type: "string", description: "Qué mirar en particular (opcional)." } }, required: [] },
  riesgo: "lectura", requiereAprobacion: false, timeoutSeg: 90,
  async ejecutar(a, ctx) {
    const c = await capturarPantalla();
    const arch = await guardarArchivo({ nombre: path.basename(c.ruta), mime: "image/png", contenido: c.contenido, origen: "generado", conversacionId: ctx.conversacionId ?? null, agenteId: ctx.agenteId });
    const v = await analizarImagen(c.contenido, "image/png", { pregunta: a.pregunta || "Describí qué hay en esta pantalla: qué programa/ventana está activa, qué texto importante se ve, y si hay errores o diálogos. En español, concreto." });
    return { ok: v.ok, datos: { archivo_id: arch.id, descripcion: v.texto }, resumen: v.ok ? `${v.texto}\n(captura: archivo_id ${arch.id})` : undefined, error: v.ok ? undefined : v.error };
  },
};

export const pcVerImagen: DefTool = {
  nombre: "pc_ver_imagen", modulo: MODULO,
  descripcion: "Mira una imagen que está en el PC (ruta) y la describe o responde una pregunta.",
  parametros: { type: "object", properties: { ruta: { type: "string", minLength: 1 }, pregunta: { type: "string" } }, required: ["ruta"] },
  riesgo: "lectura", requiereAprobacion: false, timeoutSeg: 90,
  async ejecutar(a) {
    exigirPc();
    const ruta = await casa(a.ruta); const ext = path.extname(ruta).toLowerCase();
    const v = await analizarImagen(await fs.readFile(ruta), ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg", { pregunta: a.pregunta });
    return v.ok ? { ok: true, datos: { texto: v.texto }, resumen: v.texto } : { ok: false, error: v.error };
  },
};

export const pcPortapapeles: DefTool = {
  nombre: "pc_portapapeles", modulo: MODULO,
  descripcion: "Lee el portapapeles del PC o pone un texto en él.",
  parametros: { type: "object", properties: { accion: { type: "string", enum: ["leer", "escribir"], default: "leer" }, texto: { type: "string" } }, required: [] },
  riesgo: "lectura", requiereAprobacion: false,
  async ejecutar(a) {
    if (a.accion === "escribir") { await escribirPortapapeles(String(a.texto || "")); return { ok: true, resumen: "Texto copiado al portapapeles." }; }
    const t = await leerPortapapeles(); return { ok: true, datos: { texto: t }, resumen: t.slice(0, 2000) || "(portapapeles vacío)" };
  },
};

export const pcAbrir: DefTool = {
  nombre: "pc_abrir", modulo: MODULO,
  descripcion: "Abre en el PC un programa (por nombre amigable: calculadora, bloc de notas, chrome, excel… o ejecutable), un archivo o una URL. Requiere aprobación.",
  parametros: { type: "object", properties: { objetivo: { type: "string", minLength: 1 } }, required: ["objetivo"] },
  riesgo: "ejecucion", requiereAprobacion: true, timeoutSeg: 30,
  async ejecutar(a) { const conocido = app(a.objetivo); const objetivo = conocido ? conocido.abrir : a.objetivo; const r = await abrir(objetivo); return r.codigo === 0 ? { ok: true, resumen: `Abierto: ${a.objetivo}` } : { ok: false, error: (r.stderr || r.stdout).slice(-400) }; },
};

export const pcEscribirArchivo: DefTool = {
  nombre: "pc_escribir_archivo", modulo: MODULO,
  descripcion: "Crea o sobreescribe un archivo de texto en el PC. Requiere aprobación.",
  parametros: { type: "object", properties: { ruta: { type: "string", minLength: 1 }, contenido: { type: "string" }, agregar: { type: "boolean", description: "true = agregar al final en vez de sobreescribir.", default: false } }, required: ["ruta", "contenido"] },
  riesgo: "escritura", requiereAprobacion: true,
  async ejecutar(a) {
    exigirPc();
    const ruta = await casa(a.ruta); await fs.mkdir(path.dirname(ruta), { recursive: true });
    if (a.agregar) await fs.appendFile(ruta, a.contenido); else await fs.writeFile(ruta, a.contenido);
    return { ok: true, resumen: `${a.agregar ? "Agregado a" : "Escrito"} ${ruta} (${Buffer.byteLength(a.contenido)} bytes).` };
  },
};

export const pcEjecutar: DefTool = {
  nombre: "pc_ejecutar", modulo: MODULO,
  descripcion: "Ejecuta un comando de PowerShell en el PC (mover/copiar archivos, instalar cosas, scripts, procesos). Requiere aprobación. Hay comandos prohibidos de forma permanente (formatear, apagar, borrar el sistema).",
  parametros: { type: "object", properties: { comando: { type: "string", minLength: 1 }, timeout_seg: { type: "integer", default: 60, minimum: 5, maximum: 900 }, carpeta: { type: "string", description: "Directorio de trabajo (opcional)." } }, required: ["comando"] },
  riesgo: "sistema", requiereAprobacion: true, timeoutSeg: 950,
  async ejecutar(a) {
    const p = comandoProhibido(a.comando); if (p) return { ok: false, error: p };
    const r = await powershell(a.comando, a.timeout_seg || 60, a.carpeta ? await casa(a.carpeta) : undefined);
    return { ok: r.codigo === 0 && !r.timeout, datos: { codigo: r.codigo, stdout: r.stdout.slice(-6000), stderr: r.stderr.slice(-3000), timeout: r.timeout }, resumen: `$ ${a.comando} → código ${r.codigo}${r.timeout ? " (timeout)" : ""}\n${(r.stdout || r.stderr).slice(-2000)}`, error: r.codigo === 0 && !r.timeout ? undefined : (r.stderr || r.stdout).slice(-800) };
  },
};

const APPS: Record<string, { proceso: string[]; abrir: string }> = {
  calculadora: { proceso: ["CalculatorApp", "Calculator", "calc"], abrir: "calc" }, calc: { proceso: ["CalculatorApp", "Calculator", "calc"], abrir: "calc" },
  "bloc de notas": { proceso: ["Notepad", "notepad"], abrir: "notepad" }, notepad: { proceso: ["Notepad", "notepad"], abrir: "notepad" },
  chrome: { proceso: ["chrome"], abrir: "chrome" }, edge: { proceso: ["msedge"], abrir: "msedge" }, firefox: { proceso: ["firefox"], abrir: "firefox" },
  excel: { proceso: ["EXCEL"], abrir: "excel" }, word: { proceso: ["WINWORD"], abrir: "winword" }, powerpoint: { proceso: ["POWERPNT"], abrir: "powerpnt" },
  explorador: { proceso: ["explorer"], abrir: "explorer" }, "explorador de archivos": { proceso: ["explorer"], abrir: "explorer" },
  vscode: { proceso: ["Code"], abrir: "code" }, "visual studio code": { proceso: ["Code"], abrir: "code" }, code: { proceso: ["Code"], abrir: "code" },
  spotify: { proceso: ["Spotify"], abrir: "spotify:" }, whatsapp: { proceso: ["WhatsApp"], abrir: "whatsapp:" }, terminal: { proceso: ["WindowsTerminal"], abrir: "wt" }, powershell: { proceso: ["powershell"], abrir: "powershell" }, paint: { proceso: ["mspaint"], abrir: "mspaint" },
};
function app(nombre: string) { const k = nombre.trim().toLowerCase(); return APPS[k] || null; }

export const pcVentanas: DefTool = {
  nombre: "pc_ventanas", modulo: MODULO,
  descripcion: "Lista los programas con ventana abierta en el PC (nombre del proceso y título de la ventana). Usalo para saber qué está abierto o el nombre real de un programa antes de cerrarlo.",
  parametros: { type: "object", properties: {}, required: [] }, riesgo: "lectura", requiereAprobacion: false, timeoutSeg: 30,
  async ejecutar() {
    const r = await powershell(`Get-Process | Where-Object { $_.MainWindowTitle } | ForEach-Object { $_.ProcessName + ' | pid ' + $_.Id + ' | ' + $_.MainWindowTitle }`, 20);
    const l = r.stdout.trim().split("\n").filter(Boolean);
    return { ok: true, datos: { ventanas: l }, resumen: l.length ? l.join("\n") : "No hay ventanas abiertas (o no son visibles)." };
  },
};

export const pcCerrarApp: DefTool = {
  nombre: "pc_cerrar_app", modulo: MODULO,
  descripcion: "Cierra un programa por su nombre amigable (calculadora, bloc de notas, chrome, edge, excel, word, spotify…) o por el nombre de proceso que muestra pc_ventanas. Cierre suave (como la X de la ventana); si no cierra, lo dice para que decidas forzarlo.",
  parametros: { type: "object", properties: { programa: { type: "string", minLength: 2 } }, required: ["programa"] },
  riesgo: "ejecucion", requiereAprobacion: false, timeoutSeg: 30,
  async ejecutar(a) {
    const conocido = app(a.programa);
    const nombres = conocido ? conocido.proceso : [String(a.programa).replace(/\.exe$/i, "")];
    const r = await powershell(`$n=@(${nombres.map((x) => `'${x}'`).join(",")}); $p=Get-Process | Where-Object { $n -contains $_.ProcessName }; if(-not $p){ 'NO_ENCONTRADO'; exit 0 }; $c=0; foreach($x in $p){ if($x.MainWindowHandle -ne 0){ $null=$x.CloseMainWindow(); $c++ } }; Start-Sleep -Milliseconds 1500; $q=Get-Process | Where-Object { $n -contains $_.ProcessName }; if($q){ 'SIGUE:' + ($q | ForEach-Object { $_.ProcessName + ':' + $_.Id }) -join ',' } else { 'CERRADO:' + $c }`, 20);
    const out = r.stdout.trim();
    if (out.startsWith("NO_ENCONTRADO")) return { ok: false, error: `No encontré "${a.programa}" abierto. Mirá pc_ventanas para ver los nombres reales.` };
    if (out.startsWith("SIGUE")) return { ok: false, error: `Le pedí cerrar a "${a.programa}" pero sigue abierto (${out.slice(6)}). Puede tener algo sin guardar. Si querés forzarlo: pc_ejecutar con "Stop-Process -Name ${nombres[0]} -Force" (pide aprobación).` };
    return { ok: true, resumen: `${a.programa} cerrado.` };
  },
};

export const pcProcesos: DefTool = {
  nombre: "pc_procesos", modulo: MODULO,
  descripcion: "Lista los procesos que más CPU o memoria usan en el PC.",
  parametros: { type: "object", properties: { por: { type: "string", enum: ["cpu", "memoria"], default: "memoria" }, max: { type: "integer", default: 15, minimum: 3, maximum: 60 } }, required: [] },
  riesgo: "lectura", requiereAprobacion: false, timeoutSeg: 30,
  async ejecutar(a) {
    const r = await powershell(`Get-Process | Sort-Object ${a.por === "cpu" ? "CPU" : "WorkingSet64"} -Descending | Select-Object -First ${a.max || 15} | ForEach-Object { $_.ProcessName + ' | pid ' + $_.Id + ' | ' + [math]::Round($_.WorkingSet64/1MB) + ' MB | cpu ' + [math]::Round($_.CPU,1) }`, 20);
    return { ok: true, datos: { lineas: r.stdout.trim().split("\n") }, resumen: r.stdout.trim() || r.stderr };
  },
};

export const toolsPc: DefTool[] = [pcInfo, pcListar, pcBuscar, pcLeerArchivo, pcAdjuntar, pcVerPantalla, pcVerImagen, pcPortapapeles, pcProcesos, pcVentanas, pcCerrarApp, pcAbrir, pcEscribirArchivo, pcEjecutar];