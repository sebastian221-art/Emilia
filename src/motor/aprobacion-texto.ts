// ARCHIVO: src/motor/aprobacion-texto.ts
// Mensajes de aprobación legibles para el jefe (WhatsApp/panel):
// qué se va a hacer en palabras + los datos en líneas, sin JSON crudo.
import { registro } from "../registro/registro.js";

const ETIQUETAS: Record<string, string> = {
  pc_ejecutar: "Ejecutar un comando en tu PC", pc_abrir: "Abrir en tu PC", pc_escribir_archivo: "Escribir un archivo en tu PC",
  codigo_commit: "Hacer commit en el sandbox", codigo_push: "Subir la rama a GitHub", codigo_integrar: "Integrar al repo real",
  codigo_eliminar_proyecto: "Quitar un proyecto del registro", github_crear_repo: "Crear un repositorio en GitHub", github_push: "Subir a GitHub", github_abrir_pr: "Abrir un Pull Request",
  jelcom_disparar_envio: "Disparar el envío en Jelcom", jelcom_reanudar_envio: "Reanudar el envío en Jelcom", jelcom_dividir_envio: "Dividir el envío en Jelcom",
  empresa_crear_agente: "Crear un agente nuevo", empresa_crear_puesto: "Crear un puesto de trabajo", empresa_eliminar_puesto: "Eliminar un puesto",
  sistema_accion_sensible: "Acción sensible de prueba",
};

function etiqueta(nombre: string): string {
  if (ETIQUETAS[nombre]) return ETIQUETAS[nombre];
  const d = registro.tool(nombre)?.descripcion || registro.skill(nombre)?.descripcion || nombre;
  return d.split(/[.:(]/)[0].replace(/\s+Requiere aprobación.*$/i, "").trim().slice(0, 70);
}

function valor(v: unknown): string {
  if (v == null || v === "") return "";
  if (typeof v === "string") return v.length > 160 ? v.slice(0, 157) + "…" : v;
  if (typeof v === "object") return JSON.stringify(v).slice(0, 160);
  return String(v);
}

/** Texto de la pausa para el jefe. */
export function textoAprobacion(nombre: string, args: Record<string, unknown>, extra?: string): string {
  const lineas = Object.entries(args || {}).map(([k, v]) => [k, valor(v)]).filter(([, v]) => v).map(([k, v]) => `• ${k.replace(/_/g, " ")}: ${v}`);
  return [`⏸ *Necesito tu OK*`, etiqueta(nombre), ...lineas, extra || "", `Respondé *ok* para aprobar o *no* para rechazar.`].filter(Boolean).join("\n");
}

/** Detalle corto para la tabla de aprobaciones (panel). */
export function detalleAprobacion(nombre: string, args: Record<string, unknown>): string {
  const partes = Object.entries(args || {}).map(([k, v]) => [k, valor(v)]).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`);
  return `${etiqueta(nombre)}${partes.length ? " — " + partes.join(" · ") : ""}`;
}