const PIEZAS = [...DEF_PIEZAS, ...DEF_PIEZAS_2];
const ICONOS = {
  identidad:"◈", cpu:"⬡", puzzle:"◇", plug:"⚙", brain:"❋", files:"▤",
  guide:"→", hierarchy:"⑃", refresh:"↻", eye:"◉", bulb:"✧", share:"⤳",
  stairs:"⤒", shield:"⬟", bolt:"⚡", broadcast:"📡", lock:"🔒", timeline:"⏱",
};

const estado = {};
for (const p of PIEZAS) {
  if (p.lista) estado[p.k] = { items: [], _extra: {} };
  else { estado[p.k] = {}; p.campos.forEach(c => estado[p.k][c.key] = valorInicial(c)); }
}
function valorInicial(c) {
  if (c.t === "check") return c.key==="activo"||c.key==="permitido" ? false : false;
  if (c.t === "select") return c.ops[0][0];
  if (c.t === "number") return c.ph ? Number(c.ph) : null;
  return "";
}
["planeamiento","descomposicion","autocorreccion","reflexion","pensar_voz_alta","trazas"].forEach(k=>{ if(estado[k]&&"activo"in estado[k]) estado[k].activo=true; });
if (estado.planeamiento) estado.planeamiento.confirmar = true;
if (estado.reflexion) estado.reflexion.rechaza_inventado = true;
if (estado.trazas) estado.trazas.verifica = true;

let conectadas = [];
let cfgActiva = null, modoAvz = false;
// Posición fija del nodo central en coordenadas del mundo.
const CENTRAL_X = 500, CENTRAL_Y = 350;

const cont = document.getElementById("lienzoCont");
const mundo = document.getElementById("mundo");

// ── Zoom + paneo ──
const cam = { escala: 1, x: 0, y: 0 };
const Z_MIN = 0.3, Z_MAX = 2.5;
function aplicarCamara() {
  if (mundo) mundo.style.transform = `translate(${cam.x}px, ${cam.y}px) scale(${cam.escala})`;
  const n = document.getElementById("zoomNivel"); if (n) n.textContent = Math.round(cam.escala*100)+"%";
}
function aMundo(clientX, clientY) {
  const r = cont.getBoundingClientRect();
  return { x: (clientX - r.left - cam.x) / cam.escala, y: (clientY - r.top - cam.y) / cam.escala };
}
function zoomA(nueva, cx, cy) {
  nueva = Math.min(Z_MAX, Math.max(Z_MIN, nueva));
  cam.x = cx - (cx - cam.x) * (nueva / cam.escala);
  cam.y = cy - (cy - cam.y) * (nueva / cam.escala);
  cam.escala = nueva; aplicarCamara();
}
cont.addEventListener("wheel", (e)=>{ e.preventDefault(); const r=cont.getBoundingClientRect(); zoomA(cam.escala*(e.deltaY<0?1.12:0.89), e.clientX-r.left, e.clientY-r.top); }, {passive:false});
function zoomIn(){ const r=cont.getBoundingClientRect(); zoomA(cam.escala*1.2, r.width/2, r.height/2); }
function zoomOut(){ const r=cont.getBoundingClientRect(); zoomA(cam.escala*0.83, r.width/2, r.height/2); }
function centrar(){
  // Poner el nodo central (500,350) en el medio del contenedor visible.
  const r = cont.getBoundingClientRect();
  cam.escala = 1;
  cam.x = r.width/2 - (CENTRAL_X + 90);
  cam.y = r.height/2 - (CENTRAL_Y + 40);
  aplicarCamara();
}

let paneando=false, panIni={x:0,y:0};
cont.addEventListener("mousedown", (e)=>{
  if (e.target.closest(".pieza-nodo, .central, .agente-central, .zoom-ctrl, button, input")) return;
  paneando = true; cont.classList.add("paneando");
  panIni = { x: e.clientX - cam.x, y: e.clientY - cam.y };
});

// ── Paleta ──
function renderPaleta() {
  let html = "", grupo = "";
  for (const p of PIEZAS) {
    if (p.g !== grupo) { html += `<h4>${p.g}</h4>`; grupo = p.g; }
    const usada = conectadas.find(c=>c.k===p.k) || p.k==="identidad";
    html += `<div class="pal-pieza ${usada?"usada":""}" draggable="${!usada}" ondragstart="arrastreInicio(event,'${p.k}')">
      <span class="pal-ic">${ICONOS[p.ico]||"◈"}</span> ${p.nom}</div>`;
  }
  document.getElementById("paleta").innerHTML = html;
}
function arrastreInicio(e, k) { e.dataTransfer.setData("k", k); }

cont.addEventListener("dragover", e => e.preventDefault());
cont.addEventListener("drop", e => {
  e.preventDefault();
  const k = e.dataTransfer.getData("k");
  if (!k || conectadas.find(c=>c.k===k) || k==="identidad") return;
  const p = aMundo(e.clientX, e.clientY);
  conectadas.push({ k, x: Math.max(0,p.x-75), y: Math.max(0,p.y-25) });
  document.querySelector(".hint").style.display = "none";
  renderPiezas(); renderPaleta();
  abrirCfg(k);
});

function renderPiezas() {
  const cent = document.getElementById("piezasConectadas");
  cent.innerHTML = conectadas.map(c => {
    const p = PIEZAS.find(x=>x.k===c.k);
    const resumen = resumenPieza(c.k);
    return `<div class="pieza-nodo" id="pz-${c.k}" style="left:${c.x}px;top:${c.y}px"
        onmousedown="empezarMover(event,'${c.k}')" onclick="if(!_movio)abrirCfg('${c.k}')">
      ${c.k==="identidad"?"":`<span class="pn-x" onclick="event.stopPropagation();quitar('${c.k}')">✕</span>`}
      <div class="pn-nom"><span style="color:var(--e-accent)">${ICONOS[p.ico]||"◈"}</span> ${p.nom}</div>
      <div class="pn-sub">${resumen}</div>
    </div>`;
  }).join("");
  renderLineas();
}
function resumenPieza(k) {
  const v = estado[k];
  if (v?.items) return v.items.length ? v.items.join(", ").slice(0,22) : "sin configurar";
  if (v && "activo" in v) return v.activo ? "activado" : "desactivado";
  const vals = Object.values(v||{}).filter(x=>x!==""&&x!=null);
  return vals.length ? "configurado" : "sin configurar";
}
function renderLineas() {
  const svg = document.getElementById("svgCon");
  svg.setAttribute("width", 6000); svg.setAttribute("height", 6000); svg.setAttribute("viewBox", "0 0 6000 6000");
  // El nodo central está fijo en coordenadas del mundo (CENTRAL_X, CENTRAL_Y).
  const defs = `<defs><filter id="glow"><feGaussianBlur stdDeviation="2.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>`;
  svg.innerHTML = defs + conectadas.map(c => `<line x1="${c.x+75}" y1="${c.y+25}" x2="${CENTRAL_X}" y2="${CENTRAL_Y}" stroke="#b388ff" stroke-width="2" opacity="0.85" filter="url(#glow)"/>`).join("");
}

let moviendo=null, offMov={x:0,y:0}, _movio=false;
function empezarMover(e, k) {
  if (e.target.classList.contains("pn-x")) return;
  e.stopPropagation();
  const c = conectadas.find(x=>x.k===k);
  const p = aMundo(e.clientX, e.clientY);
  offMov = { x: p.x-c.x, y: p.y-c.y };
  moviendo = k; _movio = false;
}
document.addEventListener("mousemove", e => {
  if (moviendo) {
    _movio = true;
    const c = conectadas.find(x=>x.k===moviendo);
    const p = aMundo(e.clientX, e.clientY);
    c.x = Math.max(0, p.x-offMov.x); c.y = Math.max(0, p.y-offMov.y);
    const el = document.getElementById("pz-"+moviendo);
    if (el){ el.style.left=c.x+"px"; el.style.top=c.y+"px"; }
    renderLineas();
  } else if (paneando) {
    cam.x = e.clientX - panIni.x; cam.y = e.clientY - panIni.y; aplicarCamara();
  }
});
document.addEventListener("mouseup", ()=>{ moviendo=null; paneando=false; cont.classList.remove("paneando"); setTimeout(()=>_movio=false,50); });

function quitar(k) { if (k==="identidad") return; conectadas = conectadas.filter(c=>c.k!==k); renderPiezas(); renderPaleta(); }

function abrirCfg(k) { cfgActiva = PIEZAS.find(p=>p.k===k); modoAvz = false; renderCfg(); }
function campoHTML(pieza, c, val) {
  const oc = `data-key="${c.key}" data-tipo="${c.t}"`;
  const ayuda = c.ayuda ? `<p style="font-size:11px;color:var(--e-text-muted);margin:2px 0 0">${c.ayuda}</p>` : "";
  if (c.t==="check") return `<label style="display:flex;align-items:flex-start;gap:8px;margin-top:10px;cursor:pointer"><input type="checkbox" ${oc} style="width:auto;margin:2px 0 0" ${val?"checked":""}><span style="font-size:13px">${c.label}</span></label>${ayuda}`;
  if (c.t==="textarea") return `<label>${c.label}</label><textarea ${oc} rows="2" placeholder="${c.ph||""}">${val||""}</textarea>${ayuda}`;
  if (c.t==="select") return `<label>${c.label}</label><select ${oc}>${c.ops.map(o=>`<option value="${o[0]}" ${val===o[0]?"selected":""}>${o[1]}</option>`).join("")}</select>${ayuda}`;
  return `<label>${c.label}</label><input ${oc} type="${c.t}" placeholder="${c.ph||""}" value="${val??""}" />${ayuda}`;
}
function renderCfg() {
  const p = cfgActiva;
  let cuerpo = "";
  if (p.lista) {
    const items = estado[p.k].items;
    cuerpo = `<p class="sub">${p.ayudaLista||""}</p>
      ${items.map((it,i)=>`<div style="display:flex;justify-content:space-between;padding:6px 9px;background:var(--e-bg2);border-radius:8px;margin-bottom:5px"><span style="font-size:13px">${it}</span><button onclick="quitarItem('${p.k}',${i})" style="font-size:11px;padding:2px 8px">quitar</button></div>`).join("")||'<p style="font-size:12px;color:var(--e-text-muted)">Nada todavía.</p>'}
      <div style="display:flex;gap:6px;margin-top:8px"><input id="nuevoItem" placeholder="agregar…" /><button onclick="agregarItem('${p.k}')">+</button></div>`;
  } else {
    const simples = p.campos.filter(c=>!c.avanzado), avz = p.campos.filter(c=>c.avanzado);
    cuerpo = simples.map(c=>campoHTML(p.k,c,estado[p.k][c.key])).join("");
    if (avz.length) cuerpo += modoAvz ? avz.map(c=>campoHTML(p.k,c,estado[p.k][c.key])).join("") : `<p style="font-size:12px;color:var(--e-text-muted);margin-top:10px">+ ${avz.length} avanzada(s)</p>`;
  }
  document.getElementById("modal-cfg").innerHTML = `
    <div style="background:var(--e-surface);border-radius:14px;padding:20px;max-width:440px;width:90%;max-height:80vh;overflow-y:auto">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px">
        <h3 style="margin:0">${ICONOS[p.ico]||"◈"} ${p.nom}</h3>
        <label style="font-size:11px;color:var(--e-text-sec);display:flex;gap:5px;cursor:pointer"><input type="checkbox" style="width:auto" ${modoAvz?"checked":""} onchange="modoAvz=this.checked;renderCfg()"> avanzado</label>
      </div>
      <p class="sub">${p.desc}</p>
      <div style="margin-top:10px">${cuerpo}</div>
      <div style="display:flex;gap:8px;margin-top:16px;justify-content:flex-end"><button onclick="cerrarCfg()">Listo</button></div>
    </div>`;
  document.getElementById("modal-cfg").style.display = "flex";
}
function guardarCamposVisibles() {
  if (!cfgActiva || cfgActiva.lista) return;
  document.querySelectorAll("#modal-cfg [data-key]").forEach(el=>{
    const k=el.dataset.key, t=el.dataset.tipo;
    estado[cfgActiva.k][k] = t==="check"?el.checked : t==="number"?(Number(el.value)||null) : el.value;
  });
}
function cerrarCfg() { guardarCamposVisibles(); document.getElementById("modal-cfg").style.display="none"; renderPiezas(); }
function agregarItem(k){ guardarCamposVisibles(); const i=document.getElementById("nuevoItem"); if(i.value.trim()){estado[k].items.push(i.value.trim());renderCfg();} }
function quitarItem(k,idx){ estado[k].items.splice(idx,1); renderCfg(); }

async function crearAgente() {
  if (!estado.identidad.nombre?.trim()) { alert("El agente necesita un nombre (arriba, en el centro)."); return; }
  try {
    const r = await (await fetch("/api/agentes",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(estado)})).json();
    if (r.id) window.location.href = `/agentes?nuevo=${r.id}`;
    else alert("Se creó pero sin id de vuelta.");
  } catch(e) { alert("Error: "+e.message); }
}

// Identidad arranca ya puesta en el lienzo (obligatoria, no se puede quitar).
conectadas.push({ k: "identidad", x: CENTRAL_X - 270, y: CENTRAL_Y - 30 });
renderPaleta();
renderPiezas();
centrar();