// ARCHIVO: src/motor/recetas.ts
// Recetario del operador: cómo se hacen cosas comunes en Windows y en apps
// conocidas, priorizando comandos y teclado. Se complementa con recetas
// aprendidas (documentos del agente con prefijo "recetas/").
import { query } from "../db/cliente.js";

export const RECETAS_BASE = `
GENERALES (Windows):
- Abrir cualquier app: abrir_app(nombre) [comando]. Nombres: notepad, calc, mspaint, explorer, cmd, powershell, wt, chrome, msedge, excel, winword, powerpnt, code, spotify.
- Abrir un archivo o carpeta o URL: abrir_app(ruta o url).
- Guardar en casi cualquier app: guardar_como(ruta completa) → hace Ctrl+S, escribe la ruta en "Nombre de archivo" y Enter. Si el archivo ya existía aparece "¿Reemplazar?": clic_elemento("Sí").
- Cerrar la ventana activa: tecla("alt+f4"). Cerrar sin guardar: alt+f4 y luego clic_elemento("No guardar").
- Seleccionar todo / copiar / pegar / deshacer: ctrl+a / ctrl+c / ctrl+v / ctrl+z. Buscar dentro de una app: ctrl+f.
- Cambiar de ventana: tecla("alt+tab"). Ir al escritorio: tecla("win+d").
- Leer lo que dice la pantalla/resultado: leer_ventana() (accesibilidad) antes que leer_pantalla() (visión).
- Botones y campos: clic_elemento("nombre del botón") / escribir_elemento("nombre del campo", texto). Los nombres son los que ve un lector de pantalla (ej. "Guardar", "Cancelar", "Nombre de archivo", "Sí").

CALCULADORA (calc): acepta TECLADO. Para 2 por 2: abrir_app(calc), esperar(1), escribir("2*2=") y luego leer_ventana(): el resultado aparece como texto tipo "La pantalla muestra 4" o "Display is 4". No hagas clic en los botones.
BLOC DE NOTAS (notepad): abrir_app(notepad), escribir(texto) directamente (el foco ya está en el área de texto), guardar_como(ruta). En Windows 11 puede abrir una pestaña nueva: igual funciona.
EXPLORADOR (explorer): abrir_app(ruta de carpeta) abre esa carpeta. Renombrar: F2. Nueva carpeta: ctrl+shift+n.
NAVEGADOR (chrome/msedge): abrir_app("https://…") abre la URL. Barra de direcciones: ctrl+l, escribir(url), enter. Nueva pestaña: ctrl+t. Cerrar pestaña: ctrl+w. Buscar en la página: ctrl+f. Para leer la página, preferí las tools navegador_* (más precisas) si la tarea es solo de web.
EXCEL: PREFERÍ excel_escribir(ruta, {"A1":"Hola"}) / excel_leer(ruta, "A1:D10"): crea o edita el archivo sin abrir la interfaz y es exacto. Solo si el jefe pide VER Excel abierto: abrir_app(excel) y teclado (ctrl+g para ir a celda).
WORD: PREFERÍ word_crear(ruta, texto, titulo). Solo si pide verlo: abrir_app(winword).
APPS SIN ACCESIBILIDAD (algunas Electron, juegos, canvas): leer_ocr() para ver el texto y clic_texto("Guardar") para actuar; clic_visual solo si el OCR no encuentra el texto.
FOCO: si vas a teclear en una app que ya estaba abierta, primero enfocar(proceso) (ej. enfocar("notepad")). El jefe no debe usar el PC mientras operás.
CONFIGURACIÓN DE WINDOWS: abrir_app("ms-settings:") o secciones: ms-settings:display, ms-settings:network, ms-settings:bluetooth.
`.trim();

/** Recetas aprendidas por el agente (documentos "recetas/..."). */
export async function recetasAprendidas(agenteId: string | null | undefined): Promise<string> {
  if (!agenteId) return "";
  const filas = await query<{ nombre: string; contenido: string }>(`SELECT nombre, contenido FROM documentos WHERE agente_id=$1 AND nombre LIKE 'recetas/%' ORDER BY creado_en DESC LIMIT 20`, [agenteId]).catch(() => []);
  return filas.map((f) => `- ${f.nombre.replace("recetas/", "")}: ${f.contenido.slice(0, 400)}`).join("\n");
}

export async function guardarReceta(agenteId: string | null | undefined, nombre: string, contenido: string) {
  if (!agenteId) return;
  const n = "recetas/" + nombre.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
  const [ex] = await query<{ id: string }>(`SELECT id FROM documentos WHERE agente_id=$1 AND nombre=$2`, [agenteId, n]);
  if (ex) await query(`UPDATE documentos SET contenido=$1, tam_bytes=$2 WHERE id=$3`, [contenido, Buffer.byteLength(contenido), ex.id]);
  else await query(`INSERT INTO documentos (agente_id, nombre, tipo, contenido, tam_bytes) VALUES ($1,$2,'nota',$3,$4)`, [agenteId, n, contenido, Buffer.byteLength(contenido)]);
}