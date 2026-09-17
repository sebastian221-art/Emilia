const ICO = { identidad:"◈", io:"⇄", procedimiento:"→", recursos:"⚙", riesgo:"⬟", errores:"↻", verificacion:"◉", complejidad:"⑃" };
const OBLIGATORIAS = ["identidad", "procedimiento", "riesgo"];
const CENTRAL_X = 500, CENTRAL_Y = 350;

let estado = {}, conectadas = [], skillId = null, skills = [], cfgActiva = null, modoAvz = false;

function estadoVacio() {
  const e = {};
  for (const s of DEF_SKILL) { e[s.k] = {}; s.campos.forEach(c => e[s.k][c.key] = valorInicial(c)); }
  return e;
}
function valorInicial(c) {
  if (c.t === "check") return false;
  if (c.t === "select") return c.ops[0][0];
  if (c.t === "number") return c.ph ? Number(c.ph) : null;
  return "";
}

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
function centrar(){ const r=cont.getBoundingClientRect(); cam.escala=1; cam.x=r.width/2-(CENTRAL_X+95); cam.y=r.height/2-(CENTRAL_Y+40); aplicarCamara(); }

let paneando=false, panIni={x:0,y:0};
cont.addEventListener("mousedown", (e)=>{
  if (e.target.closest(".sec-nodo, .central, .zoom-ctrl, button, input")) return;
  paneando = true; cont.classList.add("paneando");
  panIni = { x: e.clientX - cam.x, y: e.clientY - cam.y };
});

// ── Paleta ──
function renderPaleta() {
  document.getElementById("paleta").innerHTML = DEF_SKILL.map(s => {
    const usada = conectadas.find(c=>c.k===s.k);
    return `<div class="pal-pieza ${usada?"usada":""}" draggable="${!usada}" ondragstart="arrastreInicio(event,'${s.k}')">
      <span class="pal-ic">${ICO[s.k]||"◈"}</span> ${s.nom}</div>`;
  }).join("");
}
function arrastreInicio(e,k){ e.dataTransfer.setData("k",k); }

cont.addEventListener("dragover", e=>e.preventDefault());
cont.addEventListener("drop", e=>{
  e.preventDefault();
  const k = e.dataTransfer.getData("k");
  if (!k || conectadas.find(c=>c.k===k)) return;
  const p = aMundo(e.clientX, e.clientY);
  conectar(k, p.x-75, p.y-25);
  abrirCfg(k);
});
function conectar(k, x, y) {
  conectadas.push({ k, x: Math.max(0,x||60), y: Math.max(0,y||60) });
  document.querySelector(".hint").style.display = "none";
  renderSecciones(); renderPaleta();
}

function renderSecciones() {
  document.getElementById("secConectadas").innerHTML = conectadas.map(c => {
    const s = DEF_SKILL.find(x=>x.k===c.k);
    const oblig = OBLIGATORIAS.includes(c.k);
    return `<div class="sec-nodo ${oblig?"oblig":""}" id="sc-${c.k}" style="left:${c.x}px;top:${c.y}px"
        onmousedown="empezarMover(event,'${c.k}')" onclick="if(!_movio)abrirCfg('${c.k}')">
      ${oblig?"":`<span class="sn-x" onclick="event.stopPropagation();quitar('${c.k}')">✕</span>`}
      <div class="sn-nom"><span style="color:var(--e-accent)">${ICO[c.k]||"◈"}</span> ${s.nom}</div>
      <div class="sn-sub">${resumen(c.k)}</div>
    </div>`;
  }).join("");
  renderLineas();
}
function resumen(k) {
  const vals = Object.values(estado[k]||{}).filter(x=>x!==""&&x!=null&&x!==false);
  return vals.length ? "configurado" : "sin configurar";
}
function renderLineas() {
  const svg = document.getElementById("svgCon");
  svg.setAttribute("width", 6000); svg.setAttribute("height", 6000); svg.setAttribute("viewBox", "0 0 6000 6000");
  const defs = `<defs><filter id="glow"><feGaussianBlur stdDeviation="2.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>`;
  svg.innerHTML = defs + conectadas.map(c=>`<line x1="${c.x+75}" y1="${c.y+25}" x2="${CENTRAL_X}" y2="${CENTRAL_Y}" stroke="#b388ff" stroke-width="2" opacity="0.85" filter="url(#glow)"/>`).join("");
}

let moviendo=null, offMov={x:0,y:0}, _movio=false;
function empezarMover(e,k){ if(e.target.classList.contains("sn-x"))return; e.stopPropagation(); const c=conectadas.find(x=>x.k===k); const p=aMundo(e.clientX,e.clientY); offMov={x:p.x-c.x,y:p.y-c.y}; moviendo=k; _movio=false; }
document.addEventListener("mousemove", e=>{
  if(moviendo){
    _movio=true;
    const c=conectadas.find(x=>x.k===moviendo); const p=aMundo(e.clientX,e.clientY);
    c.x=Math.max(0,p.x-offMov.x); c.y=Math.max(0,p.y-offMov.y);
    const el=document.getElementById("sc-"+moviendo); if(el){el.style.left=c.x+"px";el.style.top=c.y+"px";}
    renderLineas();
  } else if(paneando){
    cam.x=e.clientX-panIni.x; cam.y=e.clientY-panIni.y; aplicarCamara();
  }
});
document.addEventListener("mouseup", ()=>{ moviendo=null; paneando=false; cont.classList.remove("paneando"); setTimeout(()=>_movio=false,50); });
function quitar(k){ conectadas=conectadas.filter(c=>c.k!==k); renderSecciones(); renderPaleta(); }

function abrirCfg(k){ cfgActiva=DEF_SKILL.find(s=>s.k===k); modoAvz=false; renderCfg(); }
function campoHTML(sk,c,val){
  const oc=`data-key="${c.key}" data-tipo="${c.t}"`;
  const ayuda=c.ayuda?`<p style="font-size:11px;color:var(--e-text-muted);margin:2px 0 0">${c.ayuda}</p>`:"";
  if(c.t==="check")return `<label style="display:flex;gap:8px;margin-top:10px;cursor:pointer"><input type="checkbox" ${oc} style="width:auto;margin:2px 0 0" ${val?"checked":""}><span style="font-size:13px">${c.label}</span></label>${ayuda}`;
  if(c.t==="textarea")return `<label>${c.label}</label><textarea ${oc} rows="2" placeholder="${c.ph||""}">${val||""}</textarea>${ayuda}`;
  if(c.t==="select")return `<label>${c.label}</label><select ${oc}>${c.ops.map(o=>`<option value="${o[0]}" ${val===o[0]?"selected":""}>${o[1]}</option>`).join("")}</select>${ayuda}`;
  return `<label>${c.label}</label><input ${oc} type="${c.t}" placeholder="${c.ph||""}" value="${val??""}" />${ayuda}`;
}
function renderCfg(){
  const s=cfgActiva;
  const simples=s.campos.filter(c=>!c.avanzado), avz=s.campos.filter(c=>c.avanzado);
  let cuerpo=simples.map(c=>campoHTML(s.k,c,estado[s.k][c.key])).join("");
  if(avz.length) cuerpo+= modoAvz ? avz.map(c=>campoHTML(s.k,c,estado[s.k][c.key])).join("") : `<p style="font-size:12px;color:var(--e-text-muted);margin-top:10px">+ ${avz.length} avanzada(s)</p>`;
  document.getElementById("modal-cfg").innerHTML=`
    <div style="background:var(--e-surface);border-radius:14px;padding:20px;max-width:440px;width:90%;max-height:80vh;overflow-y:auto">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <h3 style="margin:0">${ICO[s.k]||"◈"} ${s.nom}</h3>
        <label style="font-size:11px;color:var(--e-text-sec);display:flex;gap:5px;cursor:pointer"><input type="checkbox" style="width:auto" ${modoAvz?"checked":""} onchange="modoAvz=this.checked;renderCfg()"> avanzado</label>
      </div>
      <div style="margin-top:10px">${cuerpo}</div>
      <div style="display:flex;gap:8px;margin-top:16px;justify-content:flex-end"><button onclick="cerrarCfg()">Listo</button></div>
    </div>`;
  document.getElementById("modal-cfg").style.display="flex";
}
function guardarCampos(){ if(!cfgActiva)return; document.querySelectorAll("#modal-cfg [data-key]").forEach(el=>{ const k=el.dataset.key,t=el.dataset.tipo; estado[cfgActiva.k][k]=t==="check"?el.checked:t==="number"?(Number(el.value)||null):el.value; }); if(cfgActiva.k==="identidad")document.getElementById("nombreSkill").value=estado.identidad.nombre||""; }
function cerrarCfg(){ guardarCampos(); document.getElementById("modal-cfg").style.display="none"; renderSecciones(); }

function nuevaSkill(){ estado=estadoVacio(); conectadas=OBLIGATORIAS.map((k,i)=>({k,x:CENTRAL_X-260,y:CENTRAL_Y-90+i*100})); skillId=null; document.getElementById("nombreSkill").value=""; document.querySelector(".hint").style.display="none"; renderSecciones(); renderPaleta(); renderBiblio(); centrar(); }

async function guardarSkill(){
  guardarCampos();
  const nombre=estado.identidad.nombre?.trim();
  if(!nombre){ alert("La skill necesita un nombre."); return; }
  const cuerpo={ nombre, descripcion:estado.identidad.descripcion||"", nivel_riesgo:estado.riesgo.nivel||"lectura", secciones:estado };
  const url=skillId?`/api/skills/${skillId}`:"/api/skills";
  const r=await(await fetch(url,{method:skillId?"PATCH":"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(cuerpo)})).json();
  if(r.id)skillId=r.id;
  await cargar(); alert("Skill guardada.");
}
function editarSkill(id){
  const s=skills.find(x=>x.id===id);
  estado=estadoVacio(); skillId=s.id;
  for(const sec of DEF_SKILL) if(s.secciones?.[sec.k]) estado[sec.k]={...estado[sec.k],...s.secciones[sec.k]};
  const conDatos = DEF_SKILL.filter(sec => OBLIGATORIAS.includes(sec.k) || Object.values(estado[sec.k]||{}).some(v=>v!==""&&v!=null&&v!==false));
  conectadas = conDatos.map((sec,i)=>({k:sec.k, x:CENTRAL_X-260+(i%2)*80, y:CENTRAL_Y-120+Math.floor(i/2)*95}));
  document.getElementById("nombreSkill").value=estado.identidad.nombre||"";
  document.querySelector(".hint").style.display="none";
  renderSecciones(); renderPaleta(); renderBiblio(); centrar();
}
function renderBiblio(){
  document.getElementById("biblio").innerHTML = skills.length
    ? skills.map(s=>`<div class="sk-item ${skillId===s.id?"activo":""}" onclick="editarSkill('${s.id}')">${s.nombre}<div style="font-size:10px;color:var(--e-text-muted)">${s.nivel_riesgo}</div></div>`).join("")
    : `<p style="font-size:11px;color:var(--e-text-muted)">Vacía.</p>`;
}
async function cargar(){ skills=await(await fetch("/api/skills")).json(); renderBiblio(); }

nuevaSkill();
cargar();