// ARCHIVO: src/arca/tutorial.ts
// ─────────────────────────────────────────────────────────────────────────────
//  ARCA · TUTORIAL — la instalación como un juego: misiones en orden, cada una
//  con sus objetivos (chequeos reales), XP y nivel. Arca siempre te dice cuál
//  es la misión actual y el SIGUIENTE paso concreto.
// ─────────────────────────────────────────────────────────────────────────────
import type { Chequeo } from "./diagnostico.js";

export interface Mision { id: string; n: number; emoji: string; nombre: string; meta: string; chequeos: string[]; opcional?: string[] }

export const MISIONES: Mision[] = [
  { id: "basico", n: 1, emoji: "🧱", nombre: "Los cimientos", meta: "Node, Git, PostgreSQL con pgvector y las tablas de Emilia.", chequeos: ["node", "git", "npm", "env", "postgres", "pgvector", "migraciones"] },
  { id: "cerebro", n: 2, emoji: "🧠", nombre: "El cerebro", meta: "Las llaves de los modelos (Groq y Claude) y la llave de la memoria personal.", chequeos: ["groq", "anthropic", "cerebro_llave"] },
  { id: "whatsapp", n: 3, emoji: "💬", nombre: "La voz (WhatsApp)", meta: "Que Emilia te escriba y te lea: número de Meta, plantillas, túnel y webhook.", chequeos: ["wa_token", "wa_seguridad", "wa_plantillas", "tunel", "webhook"] },
  { id: "manos", n: 4, emoji: "🛠️", nombre: "Las manos", meta: "Lo que los agentes usan en tu PC: Docker, WhatsApp de escritorio, navegador y Claude Code.", chequeos: ["equipo", "docker", "wa_escritorio", "playwright", "claude_code"] },
  { id: "servicios", n: 5, emoji: "🔌", nombre: "Los servicios", meta: "Tus cuentas: Google (calendario), correos, Railway, GitHub y Any.", chequeos: ["google", "correo", "railway", "github", "any"], opcional: ["any"] },
  { id: "autonomia", n: 6, emoji: "🛡️", nombre: "Autónoma", meta: "Que arranque sola, no se duerma y tenga copias fuera del PC.", chequeos: ["arranque", "energia", "pg_dump", "copias"] },
  { id: "pruebas", n: 7, emoji: "🏁", nombre: "La prueba final", meta: "Probar cada parte de verdad y ponerle nota.", chequeos: [] },
];

const NIVELES = ["Recién llegada", "Aprendiz", "Ayudante", "Técnica", "Técnica senior", "Ingeniera", "Maestra del taller"];

export const noAplica = (c?: Chequeo) => !!c && c.estado === "omitido" && /^Solo en Windows/.test(c.detalle);
export const listo = (c?: Chequeo) => !!c && (c.estado === "ok" || noAplica(c));

export interface ProgresoMision { mision: Mision; hechos: number; total: number; completa: boolean; pendientes: Chequeo[] }
export interface Tutorial {
  misiones: ProgresoMision[]; actual: ProgresoMision | null; siguiente: Chequeo | null;
  xp: number; xpMax: number; nivel: string; porcentaje: number; pruebasHechas: boolean;
}

export function armarTutorial(chequeos: Chequeo[], op: { pruebasHechas?: boolean } = {}): Tutorial {
  const por = new Map(chequeos.map((c) => [c.id, c]));
  const misiones = MISIONES.map((m) => {
    const cs = m.chequeos.map((id) => por.get(id)).filter(Boolean) as Chequeo[];
    const req = m.chequeos.filter((id) => !m.opcional?.includes(id));
    const hechos = m.chequeos.filter((id) => listo(por.get(id))).length;
    const completa = m.id === "pruebas" ? !!op.pruebasHechas : req.every((id) => listo(por.get(id)));
    return { mision: m, hechos, total: m.chequeos.length, completa, pendientes: cs.filter((c) => !listo(c)) };
  });
  const actual = misiones.find((p) => !p.completa) || null;
  // El siguiente paso: lo primero que falta en la misión actual (los errores antes que los avisos).
  const orden = { error: 0, falta: 1, aviso: 2, omitido: 3, ok: 4 } as const;
  const siguiente = actual?.pendientes.slice().sort((a, b) => orden[a.estado] - orden[b.estado] || actual.mision.chequeos.indexOf(a.id) - actual.mision.chequeos.indexOf(b.id))[0] || null;
  const totalObj = MISIONES.reduce((s, m) => s + m.chequeos.length, 0);
  const ok = chequeos.filter(listo).length;
  const xp = ok * 10 + misiones.filter((p) => p.completa).length * 50;
  const xpMax = totalObj * 10 + MISIONES.length * 50;
  const porcentaje = Math.round((xp / xpMax) * 100);
  return { misiones, actual, siguiente, xp, xpMax, nivel: NIVELES[Math.min(NIVELES.length - 1, Math.floor((porcentaje / 100) * (NIVELES.length - 1)))], porcentaje, pruebasHechas: !!op.pruebasHechas };
}

const ICONO: Record<string, string> = { ok: "✅", falta: "⬜", error: "❌", aviso: "⚠️", omitido: "➖" };
const barra = (p: number, n = 10) => "▰".repeat(Math.round((p / 100) * n)) + "▱".repeat(n - Math.round((p / 100) * n));

/** Para WhatsApp o la terminal: dónde vas y qué sigue. */
export function textoTutorial(t: Tutorial, op: { detalle?: boolean } = {}): string {
  const l: string[] = [];
  l.push(`*Instalación de Emilia* ${barra(t.porcentaje)} ${t.porcentaje}% · ${t.xp} XP · nivel «${t.nivel}»`);
  for (const p of t.misiones) {
    const marca = p.completa ? "🏆" : p === t.actual ? "▶️" : "🔒";
    l.push(`${marca} ${p.mision.emoji} Misión ${p.mision.n}: ${p.mision.nombre}${p.total ? ` (${p.hechos}/${p.total})` : ""}`);
    if (op.detalle && (p === t.actual)) for (const id of p.mision.chequeos) { const c = p.pendientes.find((x) => x.id === id); if (c) l.push(`   ${ICONO[c.estado]} ${c.nombre}: ${c.detalle}`); }
  }
  if (!t.actual) { l.push("", "🎉 ¡Todo listo! Emilia y su equipo están instalados, probados y calificados."); return l.join("\n"); }
  if (t.actual.mision.id === "pruebas") { l.push("", `*Siguiente:* la prueba final. Dime «Arca, prueba todo» y pruebo cada parte de verdad y le pongo nota.`); return l.join("\n"); }
  const s = t.siguiente;
  if (s) {
    l.push("", `*Misión actual:* ${t.actual.mision.emoji} ${t.actual.mision.nombre} — ${t.actual.mision.meta}`);
    l.push(`*Siguiente paso:* ${ICONO[s.estado]} ${s.nombre} — ${s.detalle}`);
    (s.pasos || []).forEach((p, i) => l.push(`  ${i + 1}. ${p}`));
    if (s.instalable) l.push(`  (Esto lo puedo instalar yo con tu OK: dime «Arca, instala ${s.instalable}».)`);
    l.push("Cuando lo tengas, dime «listo» y lo vuelvo a revisar.");
  }
  return l.join("\n");
}
