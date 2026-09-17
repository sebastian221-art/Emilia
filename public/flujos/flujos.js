// Estado del flujo en edición
let nodos = [];      // {id, tipo, x, y, config:{}}
let conexiones = []; // {desde, hasta, etiqueta}
let flujoId = null;
let nodoSel = null;
let contadorId = 1;

// ── Estado de zoom + paneo ──
const cam = { escala: 1, x: 0, y: 0 };
const Z_MIN = 0.3, Z_MAX = 2.5;
const lienzoCont = document.getElementById("lienzoCont");
const mundo = document.getElementById("mundo");

function aplicarCamara() {
  if (mundo) mundo.style.transform = `translate(${cam.x}px, ${cam.y}px) scale(${cam.escala})`;
  const n = document.getElementById("zoomNivel");
  if (n) n.textContent = Math.round(cam.escala * 100) + "%";
}
// Convierte coordenadas de pantalla a coordenadas del mundo (dentro del lienzo).
function aMundo(clientX, clientY) {
  const r = lienzoCont.getBoundingClientRect();
  return { x: (clientX - r.left - cam.x) / cam.escala, y: (clientY - r.top - cam.y) / cam.escala };
}
function zoomA(nueva, cx, cy) {
  nueva = Math.min(Z_MAX, Math.max(Z_MIN, nueva));
  cam.x = cx - (cx - cam.x) * (nueva / cam.escala);
  cam.y = cy - (cy - cam.y) * (nueva / cam.escala);
  cam.escala = nueva;
  aplicarCamara();
}
// Zoom con rueda hacia el cursor.
lienzoCont.addEventListener("wheel", (e) => {
  e.preventDefault();
  const r = lienzoCont.getBoundingClientRect();
  zoomA(cam.escala * (e.deltaY < 0 ? 1.12 : 0.89), e.clientX - r.left, e.clientY - r.top);
}, { passive: false });
function zoomIn() { const r = lienzoCont.getBoundingClientRect(); zoomA(cam.escala * 1.2, r.width/2, r.height/2); }
function zoomOut() { const r = lienzoCont.getBoundingClientRect(); zoomA(cam.escala * 0.83, r.width/2, r.height/2); }
function centrar() { cam.escala = 1; cam.x = 0; cam.y = 0; aplicarCamara(); }

// ── Paleta ──
function renderPaleta() {
  const cont = document.getElementById("paleta");
  cont.innerHTML = "<h4>Nodos</h4>" + Object.entries(TIPOS_NODO).map(([k, t]) =>
    `<div class="pal-nodo" draggable="true" ondragstart="arrastreInicio(event,'${k}')">
      <span class="pal-ic" style="background:${t.bg};color:${t.color}">${t.ico}</span> ${t.nom}
    </div>`).join("");
}
function arrastreInicio(e, tipo) { e.dataTransfer.setData("tipo", tipo); }

// ── Soltar en el lienzo (con zoom) ──
lienzoCont.addEventListener("dragover", e => e.preventDefault());
lienzoCont.addEventListener("drop", e => {
  e.preventDefault();
  const tipo = e.dataTransfer.getData("tipo");
  if (!tipo) return;
  const p = aMundo(e.clientX, e.clientY);
  agregarNodo(tipo, p.x - 65, p.y - 20);
});

function agregarNodo(tipo, x, y) {
  const id = "n" + (contadorId++);
  nodos.push({ id, tipo, x: Math.max(0, x), y: Math.max(0, y), config: {} });
  document.getElementById("hint").style.display = "none";
  render();
}

// ── Render de nodos y conexiones ──
function render() {
  const lienzo = document.getElementById("lienzo");
  lienzo.innerHTML = nodos.map(n => {
    const t = TIPOS_NODO[n.tipo];
    const resumen = Object.values(n.config).find(v => v) || "sin configurar";
    return `<div class="nodo-fl ${nodoSel===n.id?'sel':''}" id="${n.id}" style="left:${n.x}px;top:${n.y}px"
      onmousedown="empezarMover(event,'${n.id}')" ondblclick="configurarNodo('${n.id}')">
      <div class="titulo"><span class="nodo-ic" style="background:${t.bg};color:${t.color}">${t.ico}</span>${t.nom}</div>
      <div class="sub">${String(resumen).slice(0,28)}</div>
      ${n.tipo!=='inicio'?`<div class="punto-con punto-in"></div>`:''}
      ${n.tipo!=='fin'?`<div class="punto-con punto-out" onmousedown="empezarConexion(event,'${n.id}')"></div>`:''}
    </div>`;
  }).join("");
  renderConexiones();
}

function renderConexiones() {
  const svg = document.getElementById("svgCon");
  // El SVG vive dentro del mundo transformado: lienzo grande fijo, sin recortes.
  svg.setAttribute("width", 6000); svg.setAttribute("height", 6000); svg.setAttribute("viewBox", "0 0 6000 6000");
  let paths = "";
  for (const c of conexiones) {
    const d = nodos.find(n=>n.id===c.desde), h = nodos.find(n=>n.id===c.hasta);
    if (!d || !h) continue;
    const x1 = d.x+65, y1 = d.y+55, x2 = h.x+65, y2 = h.y;
    const mid = (y1+y2)/2;
    paths += `<path d="M${x1},${y1} C${x1},${mid} ${x2},${mid} ${x2},${y2}" stroke="#c4a0ff" stroke-width="2.5" fill="none" marker-end="url(#flecha)" filter="url(#glowF)"/>`;
    if (c.etiqueta) paths += `<text x="${(x1+x2)/2}" y="${mid}" fill="#c4b5fd" font-size="10" text-anchor="middle">${c.etiqueta}</text>`;
  }
  svg.innerHTML = `<defs><filter id="glowF"><feGaussianBlur stdDeviation="2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter><marker id="flecha" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L10,5 L0,10" fill="#c4a0ff"/></marker></defs>${paths}`;
}

// ── Mover nodos / panear fondo (coordinado) ──
let moviendo = null, offset = {x:0,y:0};
let paneando = false, panIni = {x:0,y:0};

function empezarMover(e, id) {
  if (e.target.classList.contains("punto-con")) return;
  e.stopPropagation(); // que no dispare el paneo del fondo
  nodoSel = id;
  const n = nodos.find(x=>x.id===id);
  const p = aMundo(e.clientX, e.clientY);
  offset = { x: p.x - n.x, y: p.y - n.y };
  moviendo = id;
  render();
}

// Paneo: mousedown en el FONDO del lienzo (no en un nodo).
lienzoCont.addEventListener("mousedown", (e) => {
  // Si clickeó un nodo, un punto, o un control, no paneamos.
  if (e.target.closest(".nodo-fl, .punto-con, .zoom-ctrl, button")) return;
  paneando = true;
  lienzoCont.classList.add("paneando");
  panIni = { x: e.clientX - cam.x, y: e.clientY - cam.y };
});

document.addEventListener("mousemove", e => {
  if (moviendo) {
    const n = nodos.find(x=>x.id===moviendo);
    const p = aMundo(e.clientX, e.clientY);
    n.x = Math.max(0, p.x - offset.x);
    n.y = Math.max(0, p.y - offset.y);
    render();
  } else if (paneando) {
    cam.x = e.clientX - panIni.x;
    cam.y = e.clientY - panIni.y;
    aplicarCamara();
  }
  if (conectando) dibujarConexionTemporal(e);
});
document.addEventListener("mouseup", e => {
  moviendo = null;
  paneando = false;
  lienzoCont.classList.remove("paneando");
  if (conectando) terminarConexion(e);
});

// ── Conectar nodos ──
let conectando = null;
function empezarConexion(e, id) { e.stopPropagation(); conectando = id; }
function dibujarConexionTemporal(e) {
  const d = nodos.find(n=>n.id===conectando);
  if (!d) return;
  const svg = document.getElementById("svgCon");
  renderConexiones();
  const p = aMundo(e.clientX, e.clientY);
  svg.innerHTML += `<path d="M${d.x+65},${d.y+55} L${p.x},${p.y}" stroke="#c4a0ff" stroke-width="2.5" stroke-dasharray="5" fill="none" opacity="0.8"/>`;
}
function terminarConexion(e) {
  const p = aMundo(e.clientX, e.clientY);
  const x = p.x, y = p.y;
  const destino = nodos.find(n => x>=n.x && x<=n.x+140 && y>=n.y && y<=n.y+60 && n.id!==conectando);
  if (destino) {
    const desde = nodos.find(n=>n.id===conectando);
    let etiqueta = "";
    if (desde.tipo === "condicion") {
      etiqueta = prompt("¿Este camino es el SÍ o el NO?", desde.config.etiqueta_si || "sí") || "";
    }
    conexiones.push({ desde: conectando, hasta: destino.id, etiqueta });
  }
  conectando = null;
  render();
}

// ── Configurar un nodo (modal) ──
function configurarNodo(id) {
  const n = nodos.find(x=>x.id===id);
  const t = TIPOS_NODO[n.tipo];
  const campos = t.campos.map(c => {
    const val = n.config[c.key] ?? "";
    if (c.t === "textarea") return `<label>${c.label}</label><textarea data-k="${c.key}" rows="2" placeholder="${c.ph||''}">${val}</textarea>`;
    if (c.t === "select") return `<label>${c.label}</label><select data-k="${c.key}">${c.ops.map(o=>`<option value="${o[0]}" ${val===o[0]?'selected':''}>${o[1]}</option>`).join("")}</select>`;
    return `<label>${c.label}</label><input data-k="${c.key}" type="${c.t}" value="${val}" placeholder="${c.ph||''}" />`;
  }).join("");
  document.getElementById("modal-nodo").innerHTML = `
    <div style="background:var(--e-surface);border-radius:14px;padding:20px;max-width:440px;width:90%;max-height:80vh;overflow-y:auto">
      <h3 style="margin:0 0 3px">${t.ico} ${t.nom}</h3>
      <p class="sub">Configurá qué hace este paso.</p>
      <div style="margin-top:10px">${campos}</div>
      <div style="display:flex;gap:8px;margin-top:16px;justify-content:space-between">
        <button onclick="borrarNodo('${id}')" style="color:#a83232">Borrar nodo</button>
        <div style="display:flex;gap:8px">
          <button onclick="cerrarModalNodo()">Cancelar</button>
          <button class="primario" onclick="guardarConfigNodo('${id}')">Guardar</button>
        </div>
      </div>
    </div>`;
  document.getElementById("modal-nodo").style.display = "flex";
}
function guardarConfigNodo(id) {
  const n = nodos.find(x=>x.id===id);
  document.querySelectorAll("#modal-nodo [data-k]").forEach(el => n.config[el.dataset.k] = el.value);
  cerrarModalNodo(); render();
}
function borrarNodo(id) {
  nodos = nodos.filter(n=>n.id!==id);
  conexiones = conexiones.filter(c=>c.desde!==id && c.hasta!==id);
  cerrarModalNodo(); render();
}
function cerrarModalNodo() { document.getElementById("modal-nodo").style.display = "none"; }

// ── Guardar / cargar flujos ──
async function guardarFlujo() {
  const nombre = document.getElementById("nombreFlujo").value.trim();
  if (!nombre) { alert("Ponele un nombre al flujo."); return; }
  const cuerpo = { nombre, nodos, conexiones };
  const url = flujoId ? `/api/flujos/${flujoId}` : "/api/flujos";
  const r = await (await fetch(url, { method: flujoId?"PATCH":"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify(cuerpo) })).json();
  if (r.id) flujoId = r.id;
  await cargarLista();
  alert("Flujo guardado.");
}
async function cargarFlujo(id) {
  if (!id) { nodos=[]; conexiones=[]; flujoId=null; document.getElementById("nombreFlujo").value=""; render(); return; }
  const f = await (await fetch(`/api/flujos/${id}`)).json();
  flujoId = f.id;
  document.getElementById("nombreFlujo").value = f.nombre;
  nodos = f.definicion?.nodos || [];
  conexiones = f.definicion?.conexiones || [];
  contadorId = nodos.length + 1;
  document.getElementById("hint").style.display = nodos.length ? "none" : "block";
  render();
}
async function cargarLista() {
  const flujos = await (await fetch("/api/flujos")).json();
  const sel = document.getElementById("selectorFlujo");
  sel.innerHTML = `<option value="">— Nuevo flujo —</option>` + flujos.map(f=>`<option value="${f.id}" ${f.id===flujoId?'selected':''}>${f.nombre}</option>`).join("");
}
async function ejecutarFlujo() {
  if (!flujoId) { alert("Guardá el flujo primero."); return; }
  const agentes = await (await fetch("/api/agentes")).json();
  const activo = agentes.find(a => a.estado === "activo");
  const r = await (await fetch(`/api/flujos/${flujoId}/ejecutar`, {
    method: "POST", headers: {"Content-Type":"application/json"},
    body: JSON.stringify({ agenteId: activo?.id || null })
  })).json();
  if (r.estado === "esperando_aprobacion") alert("El flujo quedó esperando tu aprobación. Andá a Aprobaciones.");
  else alert(`Flujo ejecutado. Estado: ${r.estado}.`);
}

renderPaleta();
cargarLista();
render();
aplicarCamara();