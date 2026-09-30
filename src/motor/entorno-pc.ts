// ARCHIVO: src/motor/entorno-pc.ts
// Hechos del entorno para el operador: quién es el usuario, rutas reales,
// pantalla, ventanas abiertas. Evita rutas y nombres inventados.
import os from "node:os";
import { carpetaConocida, powershell } from "./pc.js";
import { tamanoPantalla } from "./pc-control.js";

export async function hechosEntorno(): Promise<string> {
  const [esc, des, doc, pant] = await Promise.all([carpetaConocida("escritorio"), carpetaConocida("descargas"), carpetaConocida("documentos"), tamanoPantalla().catch(() => null)]);
  let ventanas = "";
  try { const r = await powershell(`Get-Process | Where-Object { $_.MainWindowTitle } | Select-Object -First 15 | ForEach-Object { $_.ProcessName + ': ' + $_.MainWindowTitle }`, 15); ventanas = r.stdout.trim().split("\n").filter(Boolean).slice(0, 15).join("; "); } catch { /* opcional */ }
  return [
    `Usuario de Windows: ${os.userInfo().username} (carpeta ${os.homedir()})`,
    `Escritorio: ${esc} · Descargas: ${des} · Documentos: ${doc}`,
    pant ? `Pantalla principal: ${pant.ancho}x${pant.alto}` : "",
    ventanas ? `Ventanas abiertas: ${ventanas}` : "Ventanas abiertas: ninguna visible",
    `Idioma del sistema: español (los diálogos dicen "Guardar como", "Nombre de archivo", "Abrir", etc.)`,
  ].filter(Boolean).join("\n");
}