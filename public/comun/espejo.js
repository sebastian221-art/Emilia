// ARCHIVO: public/comun/espejo.js
// ─────────────────────────────────────────────────────────────────────────────
//  Helpers de la UI espejo. Las páginas Tools/Skills/Flujos/Aprobaciones y el
//  espacio del agente leen del registro y de la base; nada se inventa acá.
// ─────────────────────────────────────────────────────────────────────────────

async function api(url, opciones) {
    const r = await fetch(url, opciones);
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
    return data;
  }
  const post = (url, body) => api(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
  const patch = (url, body) => api(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
  const del = (url) => api(url, { method: "DELETE" });
  
  function esc(s) { return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
  
  const COLOR_RIESGO = { lectura: ["rgba(34,197,94,.15)", "#6ee7b7"], escritura: ["var(--e-warn-bg)", "var(--e-warn-tx)"], ejecucion: ["rgba(249,115,22,.15)", "#fdba74"], sistema: ["rgba(214,69,80,.15)", "#ff9090"] };
  function badge(texto, tipo) {
    const estilos = {
      codigo: ["var(--e-accent-bg)", "var(--e-accent)"], ui: ["rgba(180,140,255,.08)", "var(--e-text-muted)"],
      aprobacion: ["rgba(249,115,22,.15)", "#fdba74"], ok: ["rgba(34,197,94,.15)", "#6ee7b7"], error: ["rgba(214,69,80,.15)", "#ff9090"],
      pend: ["var(--e-warn-bg)", "var(--e-warn-tx)"], neutro: ["rgba(180,140,255,.08)", "var(--e-text-sec)"],
    };
    const [bg, tx] = estilos[tipo] || COLOR_RIESGO[tipo] || estilos.neutro;
    return `<span style="font-size:10px;padding:2px 7px;border-radius:6px;background:${bg};color:${tx};margin-left:4px;white-space:nowrap">${esc(texto)}</span>`;
  }
  function badgeEstado(estado) {
    const m = { completada: "ok", completado: "ok", en_curso: "pend", esperando_aprobacion: "aprobacion", esperando: "pend", esperando_subflujo: "pend", fallida: "error", fallido: "error", pendiente: "pend", aprobada: "ok", rechazada: "error" };
    return badge(estado, m[estado] || "neutro");
  }
  
  /** Tabla legible de un JSON Schema de parámetros. */
  function tablaEsquema(esq) {
    const props = Object.entries(esq?.properties || {});
    if (!props.length) return `<p style="font-size:12px;color:var(--e-text-muted)">Sin parámetros.</p>`;
    const req = new Set(esq.required || []);
    return `<table style="width:100%;border-collapse:collapse;font-size:12px">
      ${props.map(([k, p]) => `<tr style="border-bottom:1px solid var(--e-border)">
        <td style="padding:6px 8px 6px 0;font-family:monospace;white-space:nowrap;vertical-align:top">${esc(k)}${req.has(k) ? '<span style="color:#fdba74"> *</span>' : ""}</td>
        <td style="padding:6px 8px;color:var(--e-text-muted);white-space:nowrap;vertical-align:top">${esc(p.type || "")}${p.enum ? ` ∈ [${p.enum.map(esc).join(", ")}]` : ""}</td>
        <td style="padding:6px 0;color:var(--e-text-sec)">${esc(p.description || "")}${p.default !== undefined ? ` <span style="color:var(--e-text-muted)">(def. ${esc(JSON.stringify(p.default))})</span>` : ""}</td>
      </tr>`).join("")}
    </table>`;
  }
  
  /** Formulario generado del schema. Los inputs llevan data-arg=nombre y data-tipo. */
  function formEsquema(esq, prefijo = "arg") {
    const props = Object.entries(esq?.properties || {});
    if (!props.length) return `<p style="font-size:12px;color:var(--e-text-muted)">No requiere argumentos.</p>`;
    const req = new Set(esq.required || []);
    return props.map(([k, p]) => {
      const oc = `data-arg="${esc(k)}" data-tipo="${esc(p.type || "string")}" id="${prefijo}-${esc(k)}"`;
      const lab = `<label>${esc(k)}${req.has(k) ? ' <span style="color:#fdba74">*</span>' : ""} <span style="color:var(--e-text-muted);font-weight:normal">${esc(p.description || "")}</span></label>`;
      if (p.type === "boolean") return `<label style="display:flex;gap:8px;align-items:center;cursor:pointer"><input type="checkbox" ${oc} style="width:auto;margin:0" ${p.default ? "checked" : ""}> ${esc(k)} <span style="color:var(--e-text-muted)">${esc(p.description || "")}</span></label>`;
      if (p.enum) return `${lab}<select ${oc}>${p.enum.map((o) => `<option value="${esc(o)}" ${o === p.default ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>`;
      if (p.type === "number" || p.type === "integer") return `${lab}<input type="number" ${oc} value="${p.default ?? ""}" ${p.minimum !== undefined ? `min="${p.minimum}"` : ""} ${p.maximum !== undefined ? `max="${p.maximum}"` : ""} />`;
      if (p.type === "object" || p.type === "array") return `${lab}<textarea ${oc} rows="2" placeholder='JSON'>${p.default !== undefined ? esc(JSON.stringify(p.default)) : ""}</textarea>`;
      return `${lab}<input type="text" ${oc} value="${p.default !== undefined ? esc(p.default) : ""}" />`;
    }).join("");
  }
  /** Lee los args de un formulario generado con formEsquema. */
  function leerForm(contenedor) {
    const args = {};
    contenedor.querySelectorAll("[data-arg]").forEach((el) => {
      const k = el.dataset.arg, t = el.dataset.tipo;
      if (t === "boolean") { args[k] = el.checked; return; }
      const v = el.value;
      if (v === "" || v == null) return;
      if (t === "number" || t === "integer") args[k] = Number(v);
      else if (t === "object" || t === "array") { try { args[k] = JSON.parse(v); } catch { args[k] = v; } }
      else args[k] = v;
    });
    return args;
  }
  
  /** Bloque de resultado de una tool/skill/flujo. */
  function renderResultado(r) {
    const ok = r.ok !== false && !r.error;
    return `<div style="border:1px solid ${ok ? "rgba(34,197,94,.35)" : "rgba(214,69,80,.4)"};border-radius:10px;padding:12px;margin-top:10px;background:var(--e-surface)">
      <div style="font-size:12px;font-weight:500;margin-bottom:6px">${ok ? "✔ ok" : "✘ error"}${r.duracion_ms !== undefined ? ` <span style="color:var(--e-text-muted);font-weight:normal">· ${r.duracion_ms} ms</span>` : ""}${r.estado ? badgeEstado(r.estado) : ""}</div>
      ${r.resumen ? `<div style="font-size:13px;white-space:pre-wrap;margin-bottom:6px">${esc(r.resumen)}</div>` : ""}
      ${r.error ? `<div style="font-size:13px;color:#ff9090;white-space:pre-wrap;margin-bottom:6px">${esc(r.error)}</div>` : ""}
      ${r.errores ? `<ul style="font-size:12px;color:#ff9090;margin:0 0 6px 16px">${r.errores.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>` : ""}
      ${r.datos !== undefined || r.resultado !== undefined ? `<pre style="font-size:11px;color:var(--e-text-sec);margin:0;white-space:pre-wrap;max-height:220px;overflow:auto">${esc(JSON.stringify(r.datos ?? r.resultado, null, 2))}</pre>` : ""}
    </div>`;
  }
  
  function hora(iso) { return iso ? new Date(iso).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : ""; }
  function fechaHora(iso) { return iso ? new Date(iso).toLocaleString("es-CO", { dateStyle: "short", timeStyle: "short" }) : ""; }
  function agrupar(lista, clave) { const g = {}; for (const x of lista) (g[x[clave] || "otros"] ||= []).push(x); return g; }