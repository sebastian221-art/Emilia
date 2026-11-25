// ARCHIVO: src/tools/arca.ts
// Las herramientas de Arca (la técnica). Revisar y probar son libres; instalar,
// limpiar y actualizar piden tu OK y muestran exactamente qué va a hacer.
import type { DefTool } from "../registro/tipos.js";

const MODULO = "arca";

export const arcaRevisar: DefTool = {
  nombre: "arca_revisar", modulo: MODULO, timeoutSeg: 120, riesgo: "lectura", requiereAprobacion: false,
  descripcion: "Revisa DE VERDAD la instalación (programas, base, llaves con llamadas reales, WhatsApp, túnel, Docker, copias…) y devuelve el tutorial: misión actual, progreso y el siguiente paso concreto. Úsala ante «revisa», «listo», «qué falta», «cómo vamos con la instalación». mision opcional para revisar solo una (basico, cerebro, whatsapp, manos, servicios, autonomia).",
  parametros: { type: "object", properties: { mision: { type: "string", enum: ["basico", "cerebro", "whatsapp", "manos", "servicios", "autonomia"] }, detalle: { type: "boolean", description: "Lista cada objetivo de la misión actual." } } },
  async ejecutar(a) {
    const { revisar, celebrar } = await import("../arca/estado.js");
    const { textoTutorial } = await import("../arca/tutorial.js");
    const r = await revisar({ mision: a.mision });
    const fiesta = celebrar(r.nuevas);
    return { ok: true, datos: { porcentaje: r.tutorial.porcentaje, actual: r.tutorial.actual?.mision.id || null, siguiente: r.tutorial.siguiente?.id || null }, resumen: `${fiesta ? fiesta + "\n\n" : ""}${textoTutorial(r.tutorial, { detalle: a.detalle !== false })}` };
  },
};

export const arcaProbar: DefTool = {
  nombre: "arca_probar", modulo: MODULO, timeoutSeg: 1500, riesgo: "ejecucion", requiereAprobacion: false,
  descripcion: "La prueba final: prueba cada parte de verdad (motor, memoria, WhatsApp, seguridad, panel y cada agente en modo simulado) y le pone nota 0-10. componentes opcional para probar solo algunos. whatsapp=true manda un mensaje real de prueba al jefe. Tarda unos minutos.",
  parametros: { type: "object", properties: { componentes: { type: "array", items: { type: "string", enum: ["motor", "memoria", "whatsapp", "seguridad", "panel", "agentes"] } }, whatsapp: { type: "boolean" } } },
  async ejecutar(a) {
    const { probarTodo } = await import("../arca/pruebas.js");
    const r = await probarTodo({ componentes: a.componentes, enviarWhatsapp: !!a.whatsapp });
    return { ok: true, datos: { nota: r.nota, informe: r.id, componentes: r.componentes.map((c) => ({ id: c.id, nota: c.nota })) }, resumen: r.texto };
  },
};

export const arcaMantenimiento: DefTool = {
  nombre: "arca_mantenimiento", modulo: MODULO, timeoutSeg: 180, riesgo: "lectura", requiereAprobacion: false,
  descripcion: "Revisa el PC: disco, memoria, logs, temporales, Docker, laboratorio y programas con actualización. Dice qué se puede limpiar o actualizar (no toca nada).",
  parametros: { type: "object", properties: {} },
  async ejecutar() {
    const { revisarMantenimiento } = await import("../arca/mantenimiento.js");
    const xs = await revisarMantenimiento();
    const acc = xs.filter((x) => x.accion).map((x) => x.accion);
    return { ok: true, datos: xs, resumen: `${xs.map((x) => `• ${x.nombre}: ${x.detalle}`).join("\n")}${acc.length ? `\n\nPuedo hacer: ${acc.join(", ")} (con tu OK).` : "\n\nNada que hacer: el PC está en orden."}` };
  },
};

export const arcaInstalar: DefTool = {
  nombre: "arca_instalar", modulo: MODULO, timeoutSeg: 1900, riesgo: "sistema", requiereAprobacion: true,
  descripcion: "Instala un programa del catálogo de Arca (winget/npm/playwright) y verifica que quedó: node, git, postgres, docker, whatsapp, ngrok, claude_code, playwright, vscode, python. Nada fuera del catálogo.",
  parametros: { type: "object", properties: { programa: { type: "string", description: "id del catálogo" } }, required: ["programa"] },
  async vistaAprobacion(a) { const { paquete } = await import("../arca/mantenimiento.js"); const p = paquete(String(a.programa)); return p ? `🔧 *Arca quiere instalar ${p.nombre}* (${p.como}: ${p.ref}) en tu PC.${p.nota ? `\nOjo: ${p.nota}` : ""}\n¿Le doy? (sí / no)` : `Arca pidió instalar «${a.programa}», que no está en su catálogo (va a fallar). ¿Sí / no?`; },
  async ejecutar(a) { const { instalar } = await import("../arca/mantenimiento.js"); const r = await instalar(String(a.programa)); return r.ok ? { ok: true, resumen: r.detalle } : { ok: false, error: r.detalle }; },
};

export const arcaLimpiar: DefTool = {
  nombre: "arca_limpiar", modulo: MODULO, timeoutSeg: 600, riesgo: "escritura", requiereAprobacion: true,
  descripcion: "Limpia el PC: logs (más de 7 días), temp (temporales de más de 7 días), docker (contenedores parados e imágenes sueltas; no toca volúmenes).",
  parametros: { type: "object", properties: { que: { type: "array", items: { type: "string", enum: ["logs", "temp", "docker"] } } }, required: ["que"] },
  async vistaAprobacion(a) { return `🧹 *Arca quiere limpiar*: ${(a.que as string[]).join(", ")}.\n(logs y temporales de más de 7 días; en Docker solo lo que no se usa, nunca volúmenes.) ¿Sí / no?`; },
  async ejecutar(a) { const { limpiar } = await import("../arca/mantenimiento.js"); const r = await limpiar(a.que); return { ok: r.ok, resumen: r.detalle }; },
};

export const arcaActualizarProgramas: DefTool = {
  nombre: "arca_actualizar_programas", modulo: MODULO, timeoutSeg: 3700, riesgo: "sistema", requiereAprobacion: true,
  descripcion: "Actualiza programas del PC con winget. ids vacío = todos los que tengan actualización.",
  parametros: { type: "object", properties: { ids: { type: "array", items: { type: "string" } } } },
  async vistaAprobacion(a) { const ids = (a.ids as string[]) || []; return `⬆️ *Arca quiere actualizar* ${ids.length ? ids.join(", ") : "TODOS los programas con actualización"} (winget). Algunos pueden pedir reiniciar. ¿Sí / no?`; },
  async ejecutar(a) { const { actualizarProgramas } = await import("../arca/mantenimiento.js"); const r = await actualizarProgramas(a.ids || []); return { ok: r.ok, resumen: r.detalle }; },
};

export const arcaQueHice: DefTool = {
  nombre: "arca_que_hice", modulo: MODULO, riesgo: "lectura", requiereAprobacion: false,
  descripcion: "Lo que Arca hizo en el PC (instalaciones, limpiezas, actualizaciones) y la última prueba final. Para «qué hiciste», «qué instalaste».",
  parametros: { type: "object", properties: { dias: { type: "integer", minimum: 1, maximum: 90 } } },
  async ejecutar(a) {
    const { queHice } = await import("../arca/mantenimiento.js");
    const { query } = await import("../db/cliente.js");
    const [inf] = await query<any>(`SELECT nota, creado_en FROM arca_informes WHERE tipo='pruebas' ORDER BY creado_en DESC LIMIT 1`).catch(() => [] as any[]);
    return { ok: true, resumen: `${await queHice(a.dias || 7)}${inf ? `\n\nÚltima prueba final: ${inf.nota}/10 (${new Date(inf.creado_en).toLocaleDateString("es-CO")}).` : ""}` };
  },
};

export const arcaPasarASystem: DefTool = {
  nombre: "arca_pasar_a_system", modulo: MODULO, riesgo: "escritura", requiereAprobacion: false,
  descripcion: "Le deja a System una señal con lo que falló en la última prueba de un agente (para que lo analice en su laboratorio). No cambia nada: System propone y el jefe decide.",
  parametros: { type: "object", properties: { agente: { type: "string" } }, required: ["agente"] },
  async ejecutar(a) {
    const { query } = await import("../db/cliente.js");
    const [inf] = await query<any>(`SELECT datos FROM arca_informes WHERE tipo='pruebas' ORDER BY creado_en DESC LIMIT 1`);
    const c = (inf?.datos?.componentes || []).find((x: any) => x.id === `agente:${String(a.agente).toLowerCase()}`);
    if (!c) return { ok: false, error: `No tengo una prueba reciente de ${a.agente}. Corre arca_probar primero.` };
    const fallas = c.pruebas.filter((p: any) => !p.ok).map((p: any) => `${p.nombre}: ${p.detalle}`).join(" · ");
    await query(`INSERT INTO sys_senales (tipo, agente, titulo, detalle, evidencia, huella, prioridad) VALUES ('flojo', $1, $2, $3, $4, $5, 2) ON CONFLICT (huella) DO NOTHING`,
      [c.nombre, `Arca: ${c.nombre} sacó ${c.nota}/10 en la prueba final`, fallas, JSON.stringify(c), `arca:${c.nombre}:${new Date().toISOString().slice(0, 10)}`]);
    return { ok: true, resumen: `Listo: System tiene la señal de ${c.nombre} (${c.nota}/10: ${fallas || "sin detalle"}). Él lo analiza y te propone; nada cambia sin tu OK.` };
  },
};

export const toolsArca: DefTool[] = [arcaRevisar, arcaProbar, arcaMantenimiento, arcaInstalar, arcaLimpiar, arcaActualizarProgramas, arcaQueHice, arcaPasarASystem];
