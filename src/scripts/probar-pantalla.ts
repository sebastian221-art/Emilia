// ARCHIVO: src/scripts/probar-pantalla.ts
// ─────────────────────────────────────────────────────────────────────────────
//  AUTOPRUEBA del uso del computador en TU PC (Windows). Sin Claude, sin riesgo.
//    npm run pc:probar
//    npm run pc:probar -- --teclado               (abre el Bloc de notas y teclea acentos/@)
//    npm run pc:probar -- --credencial hospital-putty
//    npm run pc:probar -- --app anydesk           (¿corre como administrador?)
//    npm run pc:probar -- --claude                (sesión corta real con Claude: mira y describe, sin clics)
// ─────────────────────────────────────────────────────────────────────────────
import "dotenv/config";
import { promises as fs } from "node:fs";
import path from "node:path";
import { ControladorWindows } from "../motor/pantalla.js";
import { DIR_SESIONES_PC } from "../motor/computer-use.js";

const args = process.argv.slice(2);
const opcion = (n: string) => { const i = args.indexOf(n); return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : true) : undefined; };
let fallas = 0;
const bien = (t: string) => console.log(`✔ ${t}`);
const mal = (t: string, arreglo: string) => { fallas++; console.log(`✘ ${t}\n   → ${arreglo}`); };
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (process.platform !== "win32") { console.log("Esta autoprueba es para el PC con Windows donde corre Emilia."); process.exit(1); }
  if ((process.env.PC_HABILITADO || "").toLowerCase() !== "true") mal("PC_HABILITADO no está en true", "Pon PC_HABILITADO=true en el .env de Emilia.");
  await fs.mkdir(DIR_SESIONES_PC, { recursive: true });
  const c = new ControladorWindows();

  // 1. Arranque: compila EmiliaPantalla.cs con el PowerShell de Windows (C# 5).
  let pantalla = { ancho: 0, alto: 0 };
  const t0 = Date.now();
  try { pantalla = await c.iniciar(); bien(`Control de pantalla listo en ${Date.now() - t0} ms · pantalla principal ${pantalla.ancho}x${pantalla.alto} (píxeles físicos)`); }
  catch (e: any) { mal(`No arrancó el control de pantalla: ${e.message}`, "Copia este error y mándaselo a Sage."); process.exit(1); }

  // 2. Ventana al frente y privilegios.
  const ins = await c.inspeccionar();
  bien(`Ventana al frente: "${ins.frente.titulo}" (${ins.frente.proceso})`);
  console.log(`  Emilia corre ${ins.yoElevado ? "como ADMINISTRADOR" : "normal (sin privilegios)"}.`);

  // 3. Captura completa y escalado para Claude.
  const ruta = path.join(DIR_SESIONES_PC, "autoprueba.png");
  try {
    const cap = await c.capturar(ruta, { maxAncho: Number(process.env.COMPUTER_USE_ANCHO) || 1366, maxAlto: Number(process.env.COMPUTER_USE_ALTO) || 1024 });
    const kb = Math.round((await fs.stat(ruta)).size / 1024);
    if (cap.anchoOrig !== pantalla.ancho || cap.altoOrig !== pantalla.alto) mal(`La captura midió ${cap.anchoOrig}x${cap.altoOrig} y la pantalla ${pantalla.ancho}x${pantalla.alto}`, "Problema de escala de Windows (DPI). Mándale este resultado a Sage.");
    else bien(`Captura: ${cap.anchoOrig}x${cap.altoOrig} → ${cap.ancho}x${cap.alto} para Claude (${kb} KB). Ábrela y mira que se vea TODA la pantalla: ${ruta}`);
  } catch (e: any) { mal(`La captura falló: ${e.message}`, /BLOQUEADA/.test(e.message) ? "Desbloquea el PC y vuelve a probar." : "Mándale este error a Sage."); }

  // 4. Mouse: ¿la posición que mandamos es la que Windows reporta? (si no, la escala está mal)
  const antes = ins.cursor;
  const destino = { x: Math.round(pantalla.ancho / 2), y: Math.round(pantalla.alto / 2) };
  await c.mover(destino.x, destino.y); await dormir(150);
  const tras = (await c.inspeccionar()).cursor;
  await c.mover(antes.x, antes.y);
  if (Math.abs(tras.x - destino.x) <= 2 && Math.abs(tras.y - destino.y) <= 2) bien(`Mouse preciso: mandé (${destino.x}, ${destino.y}) y Windows lo puso en (${tras.x}, ${tras.y}).`);
  else mal(`Mouse desfasado: mandé (${destino.x}, ${destino.y}) y quedó en (${tras.x}, ${tras.y})`, "Escala de Windows (DPI) no coincide. Mándale este resultado a Sage.");

  // 5. Zoom de una región (lo que usa Claude para leer letra pequeña).
  try {
    const z = await c.capturar(path.join(DIR_SESIONES_PC, "autoprueba-zoom.png"), { region: { x: 0, y: 0, ancho: Math.round(pantalla.ancho / 4), alto: Math.round(pantalla.alto / 4) }, maxAncho: 1366, maxAlto: 1024, agrandar: true });
    bien(`Zoom: esquina superior izquierda ${z.anchoOrig}x${z.altoOrig} ampliada a ${z.ancho}x${z.alto}.`);
  } catch (e: any) { mal(`Zoom falló: ${e.message}`, "Mándale este error a Sage."); }

  // 6. Teclado (opcional): acentos, ñ, @ (AltGr en teclado latino) y símbolos.
  if (opcion("--teclado")) {
    const texto = "Prueba Emilia: ñandú á é í ó ú ü ¿? ¡! @ # $ % & / ( ) = { } [ ] < > | \\ ~ ^ € 123";
    await c.abrir("notepad"); await dormir(2500);
    const f = await c.enfocar({ proceso: "notepad" });
    if (!f.ok) mal(`No pude traer el Bloc de notas al frente: ${f.error}`, "Ábrelo a mano y vuelve a probar.");
    else {
      await c.escribir(texto, "teclear"); await c.teclas("Return", 1); await c.escribir("(pegado) " + texto, "pegar");
      console.log(`  Escribí en el Bloc de notas DOS líneas (tecla por tecla y pegando). Revisa que ambas digan exactamente:\n  ${texto}\n  (ciérralo sin guardar cuando termines)`);
    }
  }

  // 7. Credencial (opcional).
  const cred = opcion("--credencial");
  if (typeof cred === "string") {
    if (await c.existeCredencial(cred)) bien(`La credencial "${cred}" existe en el Administrador de credenciales de Windows.`);
    else mal(`No existe la credencial "${cred}"`, `Créala en una terminal: cmdkey /generic:${cred} /user:USUARIO /pass:CLAVE (y autorízala en el perfil con pc_perfil_guardar).`);
  }

  // 8. App remota (opcional): ¿corre como administrador?
  const app = opcion("--app");
  if (typeof app === "string") {
    const f = await c.enfocar({ proceso: app });
    if (!f.ok) mal(`No encontré una ventana de ${app} abierta`, `Abre ${app} y vuelve a probar.`);
    else {
      await dormir(300);
      const i = await c.inspeccionar();
      const elev = i.frente.elevado;
      if (elev && elev !== 0 && !i.yoElevado) mal(`${app} corre como ADMINISTRADOR y Emilia no`, `Windows no deja que Emilia controle ${app} así. Opción A: ejecuta Emilia como administrador (clic derecho → Ejecutar como administrador en la terminal donde la arrancas). Opción B: abre ${app} sin privilegios.`);
      else bien(`${app}: Emilia puede controlarlo (${elev === 0 ? "corre normal" : "ambos como administrador"}).`);
    }
  }

  // 9. Sesión real con Claude (opcional): solo mira y describe.
  if (opcion("--claude")) {
    const { usarComputador } = await import("../motor/computer-use.js");
    console.log("  Sesión real con Claude (mira la pantalla y la describe; no hace clics)…");
    const r = await usarComputador({ objetivo: "Solo observa: toma una captura y dime qué aplicaciones y ventanas ves abiertas y qué hay en la ventana al frente. NO hagas clics ni escribas nada. Termina con terminar.", perfil: "general", maxPasos: 4, controlador: c });
    if (r.estado === "cumplida") bien(`Claude respondió (${r.pasos} pasos, ${r.costoUsd.toFixed(3)} USD): ${r.resumen.slice(0, 300)}`);
    else mal(`La sesión con Claude terminó en "${r.estado}": ${r.resumen.slice(0, 300)}`, "Revisa ANTHROPIC_API_KEY y que el modelo (COMPUTER_USE_MODELO, por defecto claude-sonnet-5-5) tenga uso del computador.");
  } else await c.cerrar();

  console.log(fallas ? `\n${fallas} problema(s). Arregla lo marcado con ✘ y vuelve a correr la prueba.` : "\n✅ Todo listo: Emilia puede ver y manejar este PC.");
  process.exit(fallas ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
