// ARCHIVO: src/registro/cargar.ts
// ─────────────────────────────────────────────────────────────────────────────
//  ARRANQUE DEL REGISTRO
//  Acá se listan explícitamente los módulos que aportan capacidades.
//  Cuando se cree el módulo de WhatsApp o de Jelcom, se agrega una línea acá
//  y listo: queda registrado, validado, sincronizado y visible en la UI.
// ─────────────────────────────────────────────────────────────────────────────

import { registro, verificarReferencias } from "./registro.js";
import { sincronizarRegistro } from "./sincronizar.js";

// Tools en código
import { toolsSistema } from "../tools/sistema.js";
import { toolsWhatsapp } from "../tools/whatsapp.js";
import { toolsJelcom } from "../tools/jelcom.js";
import { toolsCodigo } from "../tools/codigo.js";
import { toolsAgentes } from "../tools/agentes.js";
import { toolsObservar } from "../tools/observar.js";
import { toolsConocimiento } from "../tools/conocimiento.js";
// Skills en código
import { skillsSistema } from "../skills/sistema.js";
import { skillsJelcom } from "../skills/jelcom.js";
import { skillsSenior } from "../skills/senior.js";
// Flujos en código
import { flujosSistema } from "../flujos/sistema.js";
import { flujosJelcom } from "../flujos/jelcom.js";
import { flujosSenior } from "../flujos/senior.js";

import { registrarTool, registrarSkill, registrarFlujo } from "./registro.js";

export async function iniciarRegistro() {
  // 1. Alta de todo lo que existe en código. Si algo está mal definido, el
  //    servidor NO arranca: es preferible a que arranque con una tool rota.
  for (const t of [...toolsSistema, ...toolsWhatsapp, ...toolsJelcom, ...toolsCodigo, ...toolsAgentes, ...toolsObservar, ...toolsConocimiento]) registrarTool(t);
  for (const s of [...skillsSistema, ...skillsJelcom, ...skillsSenior]) registrarSkill(s);
  for (const f of [...flujosSistema, ...flujosJelcom, ...flujosSenior]) registrarFlujo(f);

  // 2. Nada puede apuntar a algo que no existe.
  verificarReferencias();

  // 3. Espejo en la base para la UI y para las asignaciones a agentes.
  const n = await sincronizarRegistro();
  console.log(`[registro] ${n.tools} tools · ${n.skills} skills · ${n.flujos} flujos cargados desde código.`);
  for (const t of registro.tools()) console.log(`   ⚙ ${t.nombre} (${t.riesgo}${t.requiereAprobacion ? ", requiere aprobación" : ""})`);
  for (const s of registro.skills()) console.log(`   ◇ ${s.nombre} → [${s.tools.join(", ")}]`);
  for (const f of registro.flujos()) console.log(`   → ${f.nombre} (${f.pasos.length} pasos)`);
}