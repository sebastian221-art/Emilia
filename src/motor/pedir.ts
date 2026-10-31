// ARCHIVO: src/motor/pedir.ts
// Pedirle una tarea a un agente por nombre desde el sistema (páginas, cron,
// reflexión nocturna): corre en su conversación de panel, en cola, en segundo plano.
import { query } from "../db/cliente.js";

export async function pedirAAgente(nombre: string, tarea: string, op: { origen?: "panel" | "api" } = {}): Promise<string> {
  const [ag] = await query<any>(`SELECT id, nombre, estado FROM agentes WHERE lower(nombre)=lower($1) LIMIT 1`, [nombre]);
  if (!ag) throw new Error(`No existe el agente ${nombre}. Crealo primero (npx tsx src/scripts/crear-${nombre.toLowerCase()}.ts).`);
  if (ag.estado !== "activo") throw new Error(`${ag.nombre} está ${ag.estado}.`);
  const { obtenerOCrearConversacion, guardarMensajeEn } = await import("../dominio/conversaciones.js");
  const { entregarRespuesta } = await import("./entrega.js");
  const { correrTarea } = await import("./loop.js");
  const { encolar } = await import("./cola.js");
  const conv = await obtenerOCrearConversacion(ag.id, "panel", "panel");
  encolar(conv.id, async () => {
    try { await guardarMensajeEn(conv, "usuario", tarea); const r = await correrTarea(ag.id, tarea, { conversacionId: conv.id, origen: op.origen || "panel" }); await entregarRespuesta(conv, r); return r; }
    catch (e: any) { console.warn(`[pedir] tarea para ${ag.nombre} falló:`, e?.message); return null as any; }
  }).catch(() => {});
  return ag.nombre;
}

/** Reflexión nocturna de System: una vez por día a la hora indicada (hora local del servidor). */
export function programarReflexionNocturna(hora = 3) {
  if ((process.env.SYSTEM_NOCTURNO || "true").toLowerCase() === "false") return;
  let ultimoDia = "";
  setInterval(async () => {
    const ahora = new Date();
    const dia = ahora.toDateString();
    if (ahora.getHours() !== hora || ultimoDia === dia) return;
    ultimoDia = dia;
    try {
      const quien = await pedirAAgente("System", "Reflexión nocturna: ejecutá aprender_reflexionar(dias=1, explorar=true) y mandale al jefe el resumen por WhatsApp (whatsapp_enviar_texto) solo si hay hallazgos o propuestas concretas; si el día fue tranquilo, dejá el informe en esta conversación sin molestarlo.", { origen: "api" });
      console.log(`[nocturno] reflexión pedida a ${quien}`);
    } catch (e: any) { console.log(`[nocturno] sin reflexión: ${e?.message}`); }
  }, 5 * 60 * 1000);
}