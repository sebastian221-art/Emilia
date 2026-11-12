// ARCHIVO: src/motor/railway-ops.ts
// ─────────────────────────────────────────────────────────────────────────────
//  RAILWAY para Iris: ver todos los servicios con su último despliegue y
//  dominio, logs, reiniciar y volver a la versión anterior (con OK del jefe).
// ─────────────────────────────────────────────────────────────────────────────
import { railway, logsDespliegue } from "./publicar.js";

export interface ServicioRailway {
  proyecto: string; proyecto_id: string; servicio: string; servicio_id: string; entorno: string; entorno_id: string;
  dominio: string | null; ultimo: { id: string; status: string; createdAt: string; commit: string } | null;
}

export async function listarServicios(): Promise<ServicioRailway[]> {
  const d = await railway<any>(`query{projects{edges{node{id name environments{edges{node{id name}}} services{edges{node{id name serviceInstances{edges{node{environmentId domains{serviceDomains{domain} customDomains{domain}} latestDeployment{id status createdAt meta}}}}}}}}}}}`);
  const out: ServicioRailway[] = [];
  for (const pe of d.projects?.edges || []) {
    const p = pe.node, envs = new Map((p.environments?.edges || []).map((e: any) => [e.node.id, e.node.name]));
    for (const se of p.services?.edges || []) {
      for (const ie of se.node.serviceInstances?.edges || []) {
        const i = ie.node, dom = i.domains?.customDomains?.[0]?.domain || i.domains?.serviceDomains?.[0]?.domain || null;
        const ld = i.latestDeployment;
        out.push({ proyecto: p.name, proyecto_id: p.id, servicio: se.node.name, servicio_id: se.node.id, entorno: String(envs.get(i.environmentId) || "?"), entorno_id: i.environmentId, dominio: dom,
          ultimo: ld ? { id: ld.id, status: ld.status, createdAt: ld.createdAt, commit: String(ld.meta?.commitMessage || "").split("\n")[0].slice(0, 80) } : null });
      }
    }
  }
  return out;
}

/** Busca un servicio por nombre (servicio o "proyecto/servicio"); prefiere el entorno production. */
export async function buscarServicio(nombre: string): Promise<ServicioRailway | undefined> {
  const n = nombre.toLowerCase().trim();
  const xs = await listarServicios();
  const cand = xs.filter((s) => s.servicio.toLowerCase() === n || `${s.proyecto}/${s.servicio}`.toLowerCase() === n || s.proyecto.toLowerCase() === n || (s.dominio || "").toLowerCase().includes(n))
    .concat(xs.filter((s) => s.servicio.toLowerCase().includes(n) || s.proyecto.toLowerCase().includes(n)));
  return cand.find((s) => s.entorno === "production") || cand[0];
}

export async function deploymentsDe(s: ServicioRailway, n = 6) {
  const d = await railway<any>(`query($input:DeploymentListInput!){deployments(input:$input,first:${n}){edges{node{id status createdAt meta}}}}`, { input: { serviceId: s.servicio_id, environmentId: s.entorno_id } });
  return (d.deployments?.edges || []).map((e: any) => ({ id: e.node.id, status: e.node.status, createdAt: e.node.createdAt, commit: String(e.node.meta?.commitMessage || "").split("\n")[0].slice(0, 80) }));
}
export const logsServicio = async (s: ServicioRailway, n = 60) => s.ultimo ? logsDespliegue(s.ultimo.id, n) : "";
export async function reiniciarServicio(s: ServicioRailway) {
  if (!s.ultimo) throw new Error("No tiene despliegues.");
  await railway(`mutation($id:String!){deploymentRestart(id:$id)}`, { id: s.ultimo.id });
}
/** Vuelve al despliegue bueno anterior al actual. */
export async function rollbackServicio(s: ServicioRailway): Promise<{ id: string; createdAt: string; commit: string }> {
  const deps = await deploymentsDe(s, 10);
  const anterior = deps.slice(1).find((x: any) => ["SUCCESS", "REMOVED"].includes(x.status));
  if (!anterior) throw new Error("No encuentro una versión anterior que haya funcionado.");
  await railway(`mutation($id:String!){deploymentRollback(id:$id)}`, { id: anterior.id });
  return anterior;
}
