// ARCHIVO: src/motor/operador-pc.ts
// ─────────────────────────────────────────────────────────────────────────────
//  OPERADOR DE PC (computer use visual)
//  Bucle: capturar (monitor principal, reducida, con rejilla) → el modelo de
//  visión decide UNA acción en JSON → ejecutarla en coordenadas reales →
//  esperar → volver a mirar. Detecta bucles (misma acción sin cambio en
//  pantalla), verifica el "terminar" con una segunda mirada independiente, y
//  se detiene si el jefe pide parar.
// ─────────────────────────────────────────────────────────────────────────────
import { createHash } from "node:crypto";
import { capturarPantalla } from "./pc.js";
import { analizarImagen } from "./vision.js";
import { clic, scroll, escribirTexto, tecla, mover, ventanaActiva } from "./pc-control.js";
import { guardarArchivo } from "../dominio/archivos.js";
import { cancelada } from "./cancelacion.js";

export interface PasoOperador { n: number; accion: string; detalle: string; motivo: string; ventana: string; captura_id?: string; error?: string }
export interface ResultadoOperador { ok: boolean; estado: "cumplida" | "necesita_jefe" | "fallida" | "sin_pasos" | "cancelada"; resumen: string; pregunta?: string; pasos: PasoOperador[]; ultima_captura_id?: string }

interface Accion { accion: "clic" | "doble_clic" | "clic_derecho" | "escribir" | "tecla" | "scroll" | "mover" | "esperar" | "terminar" | "preguntar" | "fallar"; x?: number; y?: number; texto?: string; teclas?: string; direccion?: "arriba" | "abajo"; cantidad?: number; segundos?: number; motivo?: string; resumen?: string; pregunta?: string }

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));
const huella = (b: Buffer) => createHash("sha1").update(b).digest("hex").slice(0, 10);

export async function operarPc(tarea: string, op: { maxPasos?: number; permitirTexto?: boolean; onPaso?: (p: PasoOperador) => Promise<void>; contexto?: { conversacionId?: string | null; agenteId?: string | null } } = {}): Promise<ResultadoOperador> {
  const maxPasos = Math.min(op.maxPasos ?? 25, 60);
  const pasos: PasoOperador[] = [];
  let ultimaCaptura: string | undefined;
  let huellaPrevia = "", repeticiones = 0, ultimaFirma = "", advertencia = "";

  for (let n = 1; n <= maxPasos; n++) {
    if (cancelada(op.contexto?.conversacionId)) return { ok: false, estado: "cancelada", resumen: "Detenido por el jefe.", pasos, ultima_captura_id: ultimaCaptura };

    const cap = await capturarPantalla({ rejilla: true, maxAncho: 1280 });
    const arch = await guardarArchivo({ nombre: `operador_${Date.now()}.png`, mime: "image/png", contenido: cap.contenido, origen: "generado", conversacionId: op.contexto?.conversacionId ?? null, agenteId: op.contexto?.agenteId ?? null }).catch(() => null);
    ultimaCaptura = arch?.id;
    const ventana = await ventanaActiva().catch(() => "");
    const h = huella(cap.contenido);
    const sinCambio = h === huellaPrevia; huellaPrevia = h;

    const sistema = `Sos un OPERADOR de computadora Windows. Ves una captura del monitor principal de ${cap.ancho}x${cap.alto} píxeles con una REJILLA magenta cada 100 px numerada (usala para leer coordenadas exactas). Decidís UNA acción por vez. Respondé SOLO JSON:
{"accion":"clic|doble_clic|clic_derecho|escribir|tecla|scroll|mover|esperar|terminar|preguntar|fallar","x":int,"y":int,"texto":"...","teclas":"ctrl+s","direccion":"arriba|abajo","cantidad":3,"segundos":2,"motivo":"por qué","resumen":"solo en terminar: qué se ve que prueba que está hecho","pregunta":"solo en preguntar"}
Reglas:
- Coordenadas en píxeles de ESTA imagen (0..${cap.ancho}, 0..${cap.alto}), al CENTRO del elemento; leé la rejilla.
- Para ABRIR un programa: tecla "win", esperar 1s, escribir su nombre, tecla "enter". No busques el botón Inicio con clics.
- Para guardar: "ctrl+s"; en el diálogo, escribir la ruta completa en el campo de nombre y "enter".
- "escribir" teclea donde está el foco: hacé clic en el campo antes.
- Si la pantalla NO cambió tras tu acción anterior, esa acción no sirve: probá OTRA (tecla, otro elemento, otra ruta).
- "terminar" SOLO cuando la pantalla muestra el resultado cumplido; describilo en "resumen". Si pide contraseña/pago/borrar algo fuera de la tarea: "preguntar". Si no avanzás: "fallar".`;
    const historial = pasos.slice(-6).map((p) => `${p.n}. ${p.accion} ${p.detalle}${p.error ? " (ERROR: " + p.error + ")" : ""}`).join("\n") || "(ninguno)";
    const pregunta = `${sistema}\n\nTAREA: ${tarea}\nVentana activa: "${ventana}"\nPasos hechos:\n${historial}${sinCambio && pasos.length ? "\n⚠ La pantalla NO cambió desde el paso anterior." : ""}${advertencia ? "\n⚠ " + advertencia : ""}\nPaso ${n} de ${maxPasos}. ¿Siguiente acción?`;
    advertencia = "";

    const v = await analizarImagen(cap.contenido, "image/png", { pregunta, json: true, maxTokens: 500 });
    let a: Accion | null = v.ok && v.json ? (v.json as Accion) : null;
    if (!a) { try { a = JSON.parse((v.texto || "").replace(/```json|```/g, "").trim()); } catch { a = null; } }
    if (!a?.accion) { pasos.push({ n, accion: "?", detalle: "", motivo: "", ventana, captura_id: ultimaCaptura, error: `visión ilegible: ${(v.texto || v.error || "").slice(0, 120)}` }); if (pasos.slice(-3).length === 3 && pasos.slice(-3).every((p) => p.error)) return { ok: false, estado: "fallida", resumen: "La visión no devolvió acciones válidas tres veces seguidas.", pasos, ultima_captura_id: ultimaCaptura }; continue; }

    // Detección de bucle: misma acción, mismo lugar, pantalla igual.
    const firma = `${a.accion}|${a.x ?? ""}|${a.y ?? ""}|${a.texto ?? ""}|${a.teclas ?? ""}`;
    if (firma === ultimaFirma && sinCambio) { repeticiones++; } else repeticiones = 0;
    ultimaFirma = firma;
    if (repeticiones >= 1 && a.accion !== "terminar" && a.accion !== "esperar") {
      if (repeticiones >= 3) return { ok: false, estado: "fallida", resumen: `Repetí la misma acción (${a.accion} ${firma.split("|")[1] ? `(${a.x},${a.y})` : ""}) sin que la pantalla cambiara. No encuentro cómo avanzar.`, pasos, ultima_captura_id: ultimaCaptura };
      advertencia = `Ya intentaste ${a.accion} ahí ${repeticiones + 1} veces y no pasó nada. Cambiá de estrategia (usá teclado: win/escribir/enter, o ctrl+s, etc.).`;
      pasos.push({ n, accion: a.accion, detalle: "(repetida, no ejecutada)", motivo: a.motivo || "", ventana, captura_id: ultimaCaptura, error: "acción repetida sin efecto" });
      await op.onPaso?.(pasos[pasos.length - 1]);
      continue;
    }

    // Verificación independiente antes de aceptar "terminar".
    if (a.accion === "terminar") {
      const chk = await analizarImagen(cap.contenido, "image/png", { pregunta: `Tarea: "${tarea}". Un operador afirma que ya está cumplida y que la pantalla lo muestra así: "${a.resumen || a.motivo || ""}". Mirando SOLO la pantalla, ¿es cierto? Respondé JSON: {"cumplida": true|false, "motivo": "qué se ve"}`, json: true, maxTokens: 200 });
      const ok = !!(chk.json as any)?.cumplida;
      if (!ok) { advertencia = `Un revisor miró la pantalla y NO ve la tarea cumplida: ${(chk.json as any)?.motivo || chk.texto || ""}. Seguí trabajando.`; pasos.push({ n, accion: "terminar", detalle: "(rechazado por verificación)", motivo: a.resumen || "", ventana, captura_id: ultimaCaptura, error: "verificación negativa" }); await op.onPaso?.(pasos[pasos.length - 1]); continue; }
      pasos.push({ n, accion: "terminar", detalle: "", motivo: a.resumen || a.motivo || "", ventana, captura_id: ultimaCaptura }); await op.onPaso?.(pasos[pasos.length - 1]);
      return { ok: true, estado: "cumplida", resumen: a.resumen || a.motivo || "Tarea cumplida.", pasos, ultima_captura_id: ultimaCaptura };
    }

    const paso: PasoOperador = { n, accion: a.accion, detalle: "", motivo: a.motivo || "", ventana, captura_id: ultimaCaptura };
    const real = (x: number, y: number) => ({ x: Math.round(x * cap.escala) + cap.origenX, y: Math.round(y * cap.escala) + cap.origenY });
    try {
      switch (a.accion) {
        case "clic": case "doble_clic": case "clic_derecho": {
          const x = Number(a.x), y = Number(a.y);
          if (!(x >= 0 && y >= 0 && x <= cap.ancho && y <= cap.alto)) throw new Error(`coordenadas fuera de la imagen (${x},${y})`);
          const p = real(x, y); await clic(p.x, p.y, { boton: a.accion === "clic_derecho" ? "derecho" : "izquierdo", doble: a.accion === "doble_clic" });
          paso.detalle = `(${x},${y})`; break;
        }
        case "mover": { const p = real(Number(a.x), Number(a.y)); await mover(p.x, p.y); paso.detalle = `(${a.x},${a.y})`; break; }
        case "escribir": { if (op.permitirTexto === false) throw new Error("escribir texto no está permitido en esta tarea"); const t = String(a.texto || ""); if (!t) throw new Error("texto vacío"); await escribirTexto(t); paso.detalle = `"${t.slice(0, 60)}"`; break; }
        case "tecla": await tecla(String(a.teclas || "")); paso.detalle = String(a.teclas || ""); break;
        case "scroll": { const c = Number(a.cantidad) || 3; const p = real(Number(a.x) || cap.ancho / 2, Number(a.y) || cap.alto / 2); await scroll(p.x, p.y, a.direccion === "abajo" ? -c : c); paso.detalle = `${a.direccion || "arriba"} x${c}`; break; }
        case "esperar": await dormir(Math.min(Number(a.segundos) || 2, 15) * 1000); paso.detalle = `${a.segundos || 2}s`; break;
        case "preguntar": pasos.push(paso); await op.onPaso?.(paso); return { ok: false, estado: "necesita_jefe", resumen: a.motivo || "", pregunta: a.pregunta || a.motivo || "¿Cómo sigo?", pasos, ultima_captura_id: ultimaCaptura };
        case "fallar": pasos.push(paso); await op.onPaso?.(paso); return { ok: false, estado: "fallida", resumen: a.motivo || "No pude completar la tarea.", pasos, ultima_captura_id: ultimaCaptura };
        default: throw new Error(`acción desconocida ${a.accion}`);
      }
    } catch (e: any) { paso.error = e?.message || String(e); }
    pasos.push(paso);
    await op.onPaso?.(paso);
    await dormir(a.accion === "tecla" && /win|enter/i.test(String(a.teclas)) ? 1800 : 900);
  }
  return { ok: false, estado: "sin_pasos", resumen: `Se agotaron los ${maxPasos} pasos sin terminar.`, pasos, ultima_captura_id: ultimaCaptura };
}