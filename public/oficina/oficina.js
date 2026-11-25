// ARCHIVO: public/oficina/oficina.js
// ─────────────────────────────────────────────────────────────────────────────
//  LA OFICINA 3D DE EMILIA
//  Una oficina holográfica de noche. Emilia en el centro (su aura tiene el color
//  de su ánimo); cada agente en su estación, con su color. Se ve en vivo:
//    trabajando → teclea, su monitor brilla y corre texto, un haz de datos va
//                 desde Emilia hasta su puesto
//    esperando tu OK → "!" naranja sobre su cabeza
//    en reunión → camina a la sala de juntas, donde flota la misión
//    error → luz roja; pausado → gris; inactivo → descansa
//  Clic en un agente → su estación de trabajo (derecha).
//  La consola de abajo le habla a Emilia, que reparte.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CSS2DRenderer, CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const api = async (u, op) => { const r = await fetch(u, op); const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`); return d; };
const post = (u, b) => api(u, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b || {}) });
const hora = (t) => new Date(t).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" });
const hace = (t) => { const s = (Date.now() - new Date(t)) / 1000; return s < 60 ? "ahora" : s < 3600 ? `${Math.round(s / 60)} min` : s < 86400 ? `${Math.round(s / 3600)} h` : `${Math.round(s / 86400)} d`; };
const COLOR_ESTADO = { trabajando: "#5ee7ff", esperando: "#fbbf24", reunion: "#a78bfa", inactivo: "#5f7a90", error: "#f87171", pausado: "#3b4756" };
const TXT_ESTADO = { trabajando: "Trabajando", esperando: "Esperando tu OK", reunion: "En sala de juntas", inactivo: "Inactivo", error: "Con error", pausado: "En pausa" };
const REDUCIR = matchMedia("(prefers-reduced-motion: reduce)").matches;

// ═══════════════════ ESCENA ═══════════════════
const cont = $("#escena");
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
cont.appendChild(renderer.domElement);
const etiquetas = new CSS2DRenderer({ element: $("#etiquetas") });
etiquetas.setSize(innerWidth, innerHeight);

const escena = new THREE.Scene();
escena.background = new THREE.Color(0x03060c);
escena.fog = new THREE.FogExp2(0x03060c, 0.022);
const camara = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.1, 300);
const VISTA_BASE = new THREE.Vector3(21, 18, 21);
// En pantallas angostas (celular) la cámara se aleja para que quepa toda la oficina.
const vistaSegunPantalla = () => VISTA_BASE.clone().multiplyScalar(innerWidth / innerHeight < 1 ? Math.min(2.1, 1.05 / (innerWidth / innerHeight)) : 1);
let VISTA = vistaSegunPantalla();
camara.position.copy(VISTA);
const controles = new OrbitControls(camara, renderer.domElement);
controles.target.set(0, 1, 0); controles.enableDamping = true; controles.dampingFactor = 0.07;
controles.minDistance = 8; controles.maxDistance = 70; controles.maxPolarAngle = Math.PI * 0.46; controles.minPolarAngle = 0.25;
controles.autoRotateSpeed = 0.6;

// Postproceso: bloom para el brillo holográfico.
const compositor = new EffectComposer(renderer);
compositor.addPass(new RenderPass(escena, camara));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.85, 0.55, 0.18);
compositor.addPass(bloom);
compositor.addPass(new OutputPass());

// Luces
escena.add(new THREE.HemisphereLight(0x6fb9ff, 0x0a0614, 0.55));
const luna = new THREE.DirectionalLight(0xbfe6ff, 0.9); luna.position.set(14, 26, 10); luna.castShadow = true;
luna.shadow.mapSize.set(2048, 2048); Object.assign(luna.shadow.camera, { left: -26, right: 26, top: 26, bottom: -26, near: 1, far: 70 });
escena.add(luna);
const luzCentro = new THREE.PointLight(0xa78bfa, 18, 22, 1.6); luzCentro.position.set(0, 4.5, 0); escena.add(luzCentro);

// ── Piso holográfico ──
const piso = new THREE.Mesh(new THREE.CircleGeometry(40, 96), new THREE.MeshStandardMaterial({ color: 0x060b14, roughness: 0.55, metalness: 0.35 }));
piso.rotation.x = -Math.PI / 2; piso.receiveShadow = true; escena.add(piso);
const grilla = new THREE.GridHelper(80, 80, 0x1b6f88, 0x0d2b3a); grilla.material.transparent = true; grilla.material.opacity = 0.35; grilla.position.y = 0.01; escena.add(grilla);
function anillo(r, grosor, color, op, y = 0.02) {
  const m = new THREE.Mesh(new THREE.RingGeometry(r, r + grosor, 128), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: op, side: THREE.DoubleSide, depthWrite: false }));
  m.rotation.x = -Math.PI / 2; m.position.y = y; escena.add(m); return m;
}
anillo(6.2, 0.05, 0x5ee7ff, 0.35); anillo(13.6, 0.04, 0x5ee7ff, 0.22); anillo(22, 0.03, 0x5ee7ff, 0.12);
// Estrellas / polvo de datos
{
  const n = 900, pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { const r = 30 + Math.random() * 80, a = Math.random() * Math.PI * 2; pos[i * 3] = Math.cos(a) * r; pos[i * 3 + 1] = 4 + Math.random() * 40; pos[i * 3 + 2] = Math.sin(a) * r; }
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  escena.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0x9fdcff, size: 0.12, transparent: true, opacity: 0.7, depthWrite: false })));
}

// ── Materiales compartidos ──
const matMesa = new THREE.MeshStandardMaterial({ color: 0x0d1626, roughness: 0.35, metalness: 0.6 });
const matOscuro = new THREE.MeshStandardMaterial({ color: 0x0a0f1a, roughness: 0.6, metalness: 0.4 });
const matCuerpo = new THREE.MeshStandardMaterial({ color: 0x1a2436, roughness: 0.45, metalness: 0.3 });
const vidrioMat = new THREE.MeshPhysicalMaterial({ color: 0x5ee7ff, transparent: true, opacity: 0.06, roughness: 0.1, metalness: 0, side: THREE.DoubleSide, depthWrite: false });

function bordes(geo, color, op = 0.9) { return new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color, transparent: true, opacity: op })); }

// ── Avatar estilizado (cuerpo, cabeza con visor del color del agente, brazos que teclean) ──
function crearAvatar(color, escala = 1) {
  const g = new THREE.Group();
  const emis = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.6, roughness: 0.3 });
  const cuerpo = new THREE.Mesh(new THREE.CapsuleGeometry(0.27, 0.55, 6, 16), matCuerpo); cuerpo.position.y = 0.98; cuerpo.castShadow = true; g.add(cuerpo);
  const franja = new THREE.Mesh(new THREE.TorusGeometry(0.275, 0.025, 8, 32), emis); franja.rotation.x = Math.PI / 2; franja.position.y = 1.05; g.add(franja);
  const cabeza = new THREE.Mesh(new THREE.SphereGeometry(0.24, 24, 18), matCuerpo); cabeza.position.y = 1.62; cabeza.castShadow = true; g.add(cabeza);
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.09, 0.12), emis); visor.position.set(0, 1.64, 0.2); g.add(visor);
  const brazoGeo = new THREE.CapsuleGeometry(0.07, 0.42, 4, 8);
  const bi = new THREE.Group(), bd = new THREE.Group();
  for (const [b, x] of [[bi, -0.36], [bd, 0.36]]) { const m = new THREE.Mesh(brazoGeo, matCuerpo); m.position.y = -0.24; m.castShadow = true; b.add(m); b.position.set(x, 1.28, 0); b.rotation.x = -0.9; g.add(b); }
  const piernas = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.5, 0.42), matOscuro); piernas.position.y = 0.45; g.add(piernas);
  g.scale.setScalar(escala);
  return { g, cabeza, visor, bi, bd, emis, cuerpo };
}

// ── Monitor con pantalla viva (canvas) ──
function crearPantalla(color) {
  const c = document.createElement("canvas"); c.width = 512; c.height = 300;
  const ctx = c.getContext("2d");
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  return { c, ctx, tex, color, lineas: [], off: 0 };
}
function pintarPantalla(p, ag, t) {
  const { ctx, c } = p, w = c.width, h = c.height;
  const col = COLOR_ESTADO[ag.estado] || "#5ee7ff";
  ctx.fillStyle = "#020812"; ctx.fillRect(0, 0, w, h);
  const grd = ctx.createLinearGradient(0, 0, 0, h); grd.addColorStop(0, ag.color + "33"); grd.addColorStop(1, "#02081200"); ctx.fillStyle = grd; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = ag.color; ctx.fillRect(0, 0, w, 6);
  ctx.font = "600 30px 'Space Grotesk', sans-serif"; ctx.fillStyle = "#e6f6ff"; ctx.fillText(ag.nombre, 22, 52);
  ctx.font = "500 20px 'JetBrains Mono', monospace"; ctx.fillStyle = col; ctx.fillText(`● ${TXT_ESTADO[ag.estado] || ag.estado}`, 22, 86);
  ctx.fillStyle = "#9fb6c8"; ctx.font = "400 17px 'JetBrains Mono', monospace";
  const txt = (ag.actividad || ag.tarea || "").slice(0, 160);
  envolver(ctx, txt, 22, 122, w - 44, 24, 3);
  if (ag.estado === "trabajando") {
    // "código" corriendo
    ctx.globalAlpha = 0.5; ctx.font = "400 13px 'JetBrains Mono', monospace";
    for (let i = 0; i < 5; i++) { const y = 210 + i * 17; const largo = 60 + ((i * 97 + Math.floor(t * 6)) % 9) * 38; ctx.fillStyle = i % 2 ? ag.color : "#5ee7ff"; ctx.fillRect(22, y - 9, Math.min(largo, w - 44), 3); }
    ctx.globalAlpha = 1;
  } else if (ag.estado === "inactivo" || ag.estado === "pausado") {
    ctx.globalAlpha = 0.25 + 0.15 * Math.sin(t * 1.5); ctx.strokeStyle = ag.color; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(w - 70, h - 60, 26 + 4 * Math.sin(t * 2), 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1;
  }
  ctx.fillStyle = "#5f7a90"; ctx.font = "400 14px 'JetBrains Mono', monospace";
  ctx.fillText(`hoy ${ag.hoy.tareas} tareas · ${ag.hoy.ok} ok`, 22, h - 18);
  p.tex.needsUpdate = true;
}
function envolver(ctx, texto, x, y, ancho, alto, max) {
  const palabras = String(texto).split(/\s+/); let linea = "", n = 0;
  for (const p of palabras) { const prueba = linea ? `${linea} ${p}` : p; if (ctx.measureText(prueba).width > ancho && linea) { ctx.fillText(linea, x, y + n * alto); linea = p; if (++n >= max) return; } else linea = prueba; }
  if (linea && n < max) ctx.fillText(linea, x, y + n * alto);
}

// ── Estación de trabajo ──
function crearEstacion(ag, pos, angulo) {
  const color = new THREE.Color(ag.color);
  const g = new THREE.Group(); g.position.copy(pos); g.rotation.y = angulo; escena.add(g);
  // placa del piso
  const placa = new THREE.Mesh(new THREE.CircleGeometry(2.1, 48), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.08, depthWrite: false }));
  placa.rotation.x = -Math.PI / 2; placa.position.y = 0.025; g.add(placa);
  const borde = new THREE.Mesh(new THREE.RingGeometry(2.05, 2.12, 64), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }));
  borde.rotation.x = -Math.PI / 2; borde.position.y = 0.03; g.add(borde);
  // escritorio
  const tapaGeo = new THREE.BoxGeometry(2.4, 0.08, 1.1);
  const tapa = new THREE.Mesh(tapaGeo, matMesa); tapa.position.set(0, 0.78, 0); tapa.castShadow = true; tapa.receiveShadow = true; g.add(tapa);
  const filo = bordes(tapaGeo, color, 0.9); filo.position.copy(tapa.position); g.add(filo);
  for (const x of [-1.1, 1.1]) { const pata = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.76, 0.9), matOscuro); pata.position.set(x, 0.38, 0); g.add(pata); }
  // monitor (mira hacia el agente, que se sienta del lado de afuera)
  const pantalla = crearPantalla(ag.color);
  const mon = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.9, 0.05), matOscuro); mon.position.set(0, 1.42, -0.2); mon.castShadow = true; g.add(mon);
  const vista = new THREE.Mesh(new THREE.PlaneGeometry(1.42, 0.83), new THREE.MeshBasicMaterial({ map: pantalla.tex, toneMapped: false }));
  vista.position.set(0, 1.42, -0.17); g.add(vista);
  const pie = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.3), matOscuro); pie.position.set(0, 0.97, -0.22); g.add(pie);
  // teclado holográfico
  const tecl = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.26), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35 }));
  tecl.rotation.x = -Math.PI / 2; tecl.position.set(0, 0.83, 0.18); g.add(tecl);
  // silla
  const silla = new THREE.Group();
  const asiento = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.08, 0.58), matOscuro); asiento.position.y = 0.52; silla.add(asiento);
  const respaldo = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.75, 0.07), matOscuro); respaldo.position.set(0, 0.92, 0.27); silla.add(respaldo);
  const col = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.48), matOscuro); col.position.y = 0.26; silla.add(col);
  silla.position.set(0, 0, 0.95); g.add(silla);
  // avatar sentado
  const av = crearAvatar(color);
  av.g.position.set(0, -0.12, 0.88); av.g.rotation.y = Math.PI; g.add(av.g);
  // haz de luz de estado
  const haz = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.32, 5, 24, 1, true), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.0, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
  haz.position.set(0, 4.2, 0.6); g.add(haz);
  const luz = new THREE.PointLight(color, 3, 6, 2); luz.position.set(0, 2, 0.4); g.add(luz);
  // etiqueta
  const div = document.createElement("div");
  div.className = "eti"; div.style.setProperty("--c", ag.color);
  div.innerHTML = `<div class="alerta">!</div><div class="caja"><span class="av">${esc(ag.nombre[0])}</span><span><div class="nom">${esc(ag.nombre)}</div><div class="est"></div></span><span class="dot"></span></div>`;
  div.addEventListener("click", (e) => { e.stopPropagation(); abrirEstacion(ag.id); });
  const eti = new CSS2DObject(div); eti.position.set(0, 2.75, 0.9); g.add(eti);
  // objetos clicables
  for (const o of [tapa, mon, vista, av.cuerpo, av.cabeza]) o.userData.agenteId = ag.id;
  const asientoMundo = new THREE.Vector3(); av.g.getWorldPosition(asientoMundo);
  return { ag, g, av, pantalla, haz, luz, placa, borde, div, eti, casa: av.g.position.clone(), destino: null, enReunion: false, asientoMundo, color };
}

// ── Emilia en el centro ──
function crearEmilia(ag) {
  const g = new THREE.Group(); escena.add(g);
  const tarima = new THREE.Mesh(new THREE.CylinderGeometry(3, 3.25, 0.32, 64), matMesa); tarima.position.y = 0.16; tarima.receiveShadow = true; g.add(tarima);
  const filo = new THREE.Mesh(new THREE.TorusGeometry(3.12, 0.04, 8, 128), new THREE.MeshBasicMaterial({ color: 0xa78bfa })); filo.rotation.x = Math.PI / 2; filo.position.y = 0.33; g.add(filo);
  const av = crearAvatar(new THREE.Color(ag.color || "#a78bfa"), 1.15); av.g.position.set(0, 0.32, 0.6); g.add(av.g);
  // núcleo: orbe holográfico de su ánimo
  const orbe = new THREE.Group(); orbe.position.set(0, 4.3, 0); g.add(orbe);
  const nucleoMat = new THREE.MeshStandardMaterial({ color: 0xa78bfa, emissive: 0xa78bfa, emissiveIntensity: 2.2, transparent: true, opacity: 0.9 });
  const nucleo = new THREE.Mesh(new THREE.IcosahedronGeometry(0.55, 2), nucleoMat); orbe.add(nucleo);
  const malla = new THREE.Mesh(new THREE.IcosahedronGeometry(0.95, 1), new THREE.MeshBasicMaterial({ color: 0x5ee7ff, wireframe: true, transparent: true, opacity: 0.35 })); orbe.add(malla);
  const aros = [];
  for (let i = 0; i < 3; i++) { const a = new THREE.Mesh(new THREE.TorusGeometry(1.35 + i * 0.32, 0.012, 8, 128), new THREE.MeshBasicMaterial({ color: i === 1 ? 0xf9a8d4 : 0x5ee7ff, transparent: true, opacity: 0.6 })); a.rotation.set(Math.random() * 3, Math.random() * 3, 0); orbe.add(a); aros.push(a); }
  const luz = new THREE.PointLight(0xa78bfa, 12, 14, 1.8); luz.position.copy(orbe.position); g.add(luz);
  // pantallas holográficas alrededor
  const panelesHolo = [];
  for (let i = 0; i < 3; i++) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.9), new THREE.MeshBasicMaterial({ color: 0x5ee7ff, transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false }));
    const a = (i / 3) * Math.PI * 2 + 0.6; p.position.set(Math.cos(a) * 2.2, 2.2, Math.sin(a) * 2.2); p.lookAt(0, 2.2, 0); g.add(p); const b = bordes(p.geometry, 0x5ee7ff, 0.5); b.position.copy(p.position); b.rotation.copy(p.rotation); g.add(b);
    panelesHolo.push(p);
  }
  const div = document.createElement("div");
  div.className = "eti eti-emilia"; div.style.setProperty("--c", ag.color || "#a78bfa");
  div.innerHTML = `<div class="alerta">!</div><div class="caja"><span class="av">E</span><span><div class="nom">Emilia</div><div class="est"></div></span><span class="dot"></span></div>`;
  div.addEventListener("click", (e) => { e.stopPropagation(); abrirEstacion(ag.id); });
  const eti = new CSS2DObject(div); eti.position.set(0, 6.2, 0); g.add(eti);
  for (const o of [tarima, av.cuerpo, av.cabeza, nucleo]) o.userData.agenteId = ag.id;
  return { ag, g, av, orbe, nucleo, nucleoMat, aros, luz, filo, div, eti, color: new THREE.Color(ag.color || "#a78bfa") };
}

// ── Sala de juntas ──
const SALA = new THREE.Vector3(0, 0, -17.5);
const sala = (() => {
  const g = new THREE.Group(); g.position.copy(SALA); escena.add(g);
  const pisoS = new THREE.Mesh(new THREE.CircleGeometry(4.6, 64), new THREE.MeshBasicMaterial({ color: 0xa78bfa, transparent: true, opacity: 0.05, depthWrite: false })); pisoS.rotation.x = -Math.PI / 2; pisoS.position.y = 0.03; g.add(pisoS);
  const aro = new THREE.Mesh(new THREE.RingGeometry(4.55, 4.62, 96), new THREE.MeshBasicMaterial({ color: 0xa78bfa, transparent: true, opacity: 0.6, side: THREE.DoubleSide })); aro.rotation.x = -Math.PI / 2; aro.position.y = 0.035; g.add(aro);
  const mesaGeo = new THREE.CylinderGeometry(1.9, 1.9, 0.1, 64); const mesa = new THREE.Mesh(mesaGeo, matMesa); mesa.position.y = 0.8; mesa.castShadow = true; g.add(mesa);
  const filo = new THREE.Mesh(new THREE.TorusGeometry(1.9, 0.025, 8, 96), new THREE.MeshBasicMaterial({ color: 0xa78bfa })); filo.rotation.x = Math.PI / 2; filo.position.y = 0.85; g.add(filo);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.4, 0.78), matOscuro); base.position.y = 0.39; g.add(base);
  const holo = new THREE.Mesh(new THREE.ConeGeometry(1.2, 2.2, 48, 1, true), new THREE.MeshBasicMaterial({ color: 0xa78bfa, transparent: true, opacity: 0.0, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
  holo.position.y = 1.95; holo.rotation.x = Math.PI; g.add(holo);
  // paredes de vidrio (medio cilindro)
  const pared = new THREE.Mesh(new THREE.CylinderGeometry(5.2, 5.2, 3, 64, 1, true, Math.PI * 0.15, Math.PI * 1.7), vidrioMat); pared.position.y = 1.5; g.add(pared);
  const borde = new THREE.Mesh(new THREE.TorusGeometry(5.2, 0.02, 6, 96, Math.PI * 1.7), new THREE.MeshBasicMaterial({ color: 0x5ee7ff, transparent: true, opacity: 0.45 })); borde.rotation.set(Math.PI / 2, 0, Math.PI * 0.15); borde.position.y = 3; g.add(borde);
  const asientos = []; for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; asientos.push(new THREE.Vector3(SALA.x + Math.cos(a) * 2.7, 0, SALA.z + Math.sin(a) * 2.7)); }
  const div = document.createElement("div"); div.className = "eti-mision"; div.style.display = "none";
  const eti = new CSS2DObject(div); eti.position.set(0, 3.9, 0); g.add(eti);
  const rot = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.015, 6, 64), new THREE.MeshBasicMaterial({ color: 0x5ee7ff, transparent: true, opacity: 0.0 })); rot.position.y = 2.4; rot.rotation.x = Math.PI / 2; g.add(rot);
  return { g, holo, div, eti, asientos, rot };
})();
const etiSala = (() => { const d = document.createElement("div"); d.className = "eti"; d.style.setProperty("--c", "#a78bfa"); d.innerHTML = `<div class="caja"><span class="av">◈</span><span><div class="nom">Sala de juntas</div><div class="est">misiones entre agentes</div></span></div>`; const o = new CSS2DObject(d); o.position.set(0, 0.4, 5.4); sala.g.add(o); return d; })();

// ── Haces de datos (Emilia → agente que trabaja en algo suyo) ──
function crearHaz(destino, color) {
  const curva = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 4.2, 0), new THREE.Vector3(destino.x * 0.5, 6.5, destino.z * 0.5), new THREE.Vector3(destino.x, 2.2, destino.z));
  const geo = new THREE.TubeGeometry(curva, 48, 0.03, 6, false);
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false });
  const tubo = new THREE.Mesh(geo, mat); escena.add(tubo);
  const chispas = []; for (let i = 0; i < 4; i++) { const s = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0 })); escena.add(s); chispas.push(s); }
  return { curva, tubo, mat, chispas, activo: false };
}

// ═══════════════════ ESTADO EN VIVO ═══════════════════
const estaciones = new Map();   // id → estación
let emilia = null, ultimoEstado = null, filtro = null, seleccionado = null;
const haces = new Map();

function construir(estado) {
  const otros = estado.agentes.filter((a) => !a.admin);
  const admin = estado.agentes.find((a) => a.admin);
  if (admin && !emilia) emilia = crearEmilia(admin);
  // Anillo de estaciones (dejando libre el lado de la sala de juntas).
  const R = 10.5, ini = -Math.PI / 2 + 0.55, fin = -Math.PI / 2 + Math.PI * 2 - 0.55;
  otros.forEach((ag, i) => {
    if (estaciones.has(ag.id)) return;
    const t = otros.length === 1 ? 0.5 : i / (otros.length - 1);
    const a = ini + (fin - ini) * t + Math.PI;   // la sala queda atrás (z negativo)
    const pos = new THREE.Vector3(Math.cos(a) * R, 0, Math.sin(a) * R);
    const angulo = Math.atan2(pos.x, pos.z);   // el agente queda del lado de afuera, mirando al centro
    const e = crearEstacion(ag, pos, angulo);
    estaciones.set(ag.id, e);
    haces.set(ag.id, crearHaz(pos, new THREE.Color(ag.color)));
  });
}

function aplicar(estado) {
  ultimoEstado = estado;
  construir(estado);
  // Emilia
  if (emilia) {
    const admin = estado.agentes.find((a) => a.admin);
    const animo = estado.alma?.color || admin?.color || "#a78bfa";
    const c = new THREE.Color(animo);
    emilia.nucleoMat.color.copy(c); emilia.nucleoMat.emissive.copy(c); emilia.luz.color.copy(c); emilia.filo.material.color.copy(c);
    luzCentro.color.copy(c);
    document.documentElement.style.setProperty("--animo", animo);
    emilia.div.style.setProperty("--c", animo);
    emilia.div.className = `eti eti-emilia ${admin?.estado || ""}${seleccionado === admin?.id ? " sel" : ""}`;
    emilia.div.querySelector(".est").textContent = admin?.estado === "trabajando" || admin?.estado === "esperando" ? admin.actividad : (estado.alma?.descripcion || "en su punto");
    emilia.div.querySelector(".dot").style.setProperty("--sc", COLOR_ESTADO[admin?.estado] || animo);
    emilia.estado = admin?.estado;
  }
  // Agentes
  const enSala = [];
  for (const ag of estado.agentes) {
    const e = estaciones.get(ag.id); if (!e) continue;
    e.ag = ag;
    const sc = COLOR_ESTADO[ag.estado] || "#5f7a90";
    e.div.className = `eti ${ag.estado}${filtro && ag.estado !== filtro ? " atenuado" : ""}${seleccionado === ag.id ? " sel" : ""}`;
    e.div.querySelector(".est").textContent = ag.estado === "inactivo" ? (ag.hoy.tareas ? `${ag.hoy.tareas} tareas hoy` : (ag.puesto || "disponible")) : ag.actividad;
    e.div.querySelector(".dot").style.setProperty("--sc", sc);
    if (ag.estado === "reunion") enSala.push(e);
    else if (e.enReunion) { e.enReunion = false; e.destino = "casa"; }
    // haz desde Emilia si trabaja en algo delegado
    const h = haces.get(ag.id); if (h) h.activo = ag.estado === "trabajando" && ag.encargos > 0;
  }
  enSala.forEach((e, i) => { if (!e.enReunion) { e.enReunion = true; e.destino = sala.asientos[i % sala.asientos.length]; } });
  // misión en la sala
  const m = estado.misiones.find((x) => x.estado === "en_curso") || estado.misiones[0];
  sala.activa = !!m;
  if (m) {
    sala.div.style.display = "";
    sala.div.innerHTML = `<b>${esc(m.ref)} · MISIÓN ${m.estado === "atascada" ? "TRABADA" : "EN CURSO"}</b><div class="obj">${esc(m.objetivo)}</div><div class="pasos">${m.pasos.map((p) => `<span class="paso ${p.estado}">${p.n}. ${esc(p.agente)}</span>`).join("")}</div>`;
  } else sala.div.style.display = "none";
  pintarHud(estado);
}

// ═══════════════════ HUD ═══════════════════
function pintarHud(e) {
  const r = e.resumen;
  const chips = [["trabajando", r.trabajando], ["esperando", r.esperando], ["reunion", r.reunion], ["inactivo", r.inactivo]].concat(r.error ? [["error", r.error]] : []);
  $("#chips").innerHTML = chips.map(([k, n]) => `<span class="chip${filtro === k ? " on" : ""}" data-k="${k}" style="--sc:${COLOR_ESTADO[k]}"><i></i>${TXT_ESTADO[k]} <b>${n}</b></span>`).join("");
  $("#chips").querySelectorAll(".chip").forEach((c) => c.onclick = () => { filtro = filtro === c.dataset.k ? null : c.dataset.k; aplicar(ultimoEstado); });
  const prov = (e.proveedores || []).map((p) => `<i title="${p.proveedor}${p.cortado ? " (con plan B activo)" : p.fallosRecientes ? ` (${p.fallosRecientes} fallas)` : " ok"}" style="background:${p.cortado ? "#f87171" : p.fallosRecientes ? "#fbbf24" : "#34d399"};box-shadow:0 0 8px ${p.cortado ? "#f87171" : p.fallosRecientes ? "#fbbf24" : "#34d399"}"></i>`).join("");
  $("#metricas").innerHTML = `
    <div class="met"><b>${r.tareasHoy}</b><span>tareas hoy</span></div>
    <div class="met"><b>${r.exitoHoy == null ? "—" : r.exitoHoy + "%"}</b><span>bien</span></div>
    <div class="met"><b>$${Number(r.gastoHoy).toFixed(2)}</b><span>gasto hoy</span></div>
    <div class="met"><div class="prov">${prov}</div><span>modelos</span></div>
    <a class="campana" href="/aprobaciones" title="Aprobaciones">🔔${e.aprobaciones.length ? `<span class="num">${e.aprobaciones.length}</span>` : ""}</a>`;
  // pulso
  const lista = $("#pulsoLista");
  const firma = e.pulso.slice(0, 1).map((p) => p.t + p.texto).join();
  if (lista.dataset.f !== firma) {
    lista.dataset.f = firma;
    lista.innerHTML = e.pulso.slice(0, 14).map((p) => `<div class="ev" style="--c:${p.color || "#5ee7ff"}" title="${esc(p.detalle)}"><i></i><span class="t"><b>${esc(p.agente)}</b> · ${esc(p.texto)}</span><span class="h">${hace(p.t)}</span></div>`).join("") || `<div class="vacio2">Todo quieto por ahora.</div>`;
  }
}

// ═══════════════════ ESTACIÓN DE TRABAJO (panel) ═══════════════════
let estAbierta = null, estTab = "ahora", estDatos = null;
async function abrirEstacion(id, tab) {
  estAbierta = id; seleccionado = id; if (tab) estTab = tab;
  $("#estacion").hidden = false;
  history.replaceState(null, "", `?agente=${id}`);
  enfocar(id);
  await cargarEstacion();
  if (ultimoEstado) aplicar(ultimoEstado);
}
function cerrarEstacion() { estAbierta = null; seleccionado = null; $("#estacion").hidden = true; history.replaceState(null, "", location.pathname); volverVista(); if (ultimoEstado) aplicar(ultimoEstado); }
$("#cerrarEst").onclick = cerrarEstacion;
addEventListener("keydown", (e) => { if (e.key === "Escape" && estAbierta) cerrarEstacion(); });

async function cargarEstacion() {
  if (!estAbierta) return;
  try { estDatos = await api(`/api/oficina/agente/${estAbierta}`); pintarEstacion(); } catch (e) { $("#estCont").innerHTML = `<div class="vacio2">No pude cargar la estación: ${esc(e.message)}</div>`; }
}
function pintarEstacion() {
  const d = estDatos; if (!d) return;
  const a = d.agente, vivo = ultimoEstado?.agentes.find((x) => x.id === a.id);
  const est = vivo?.estado || "inactivo";
  const pestanas = [["ahora", "Ahora"], ["encargos", "Encargos"], ["historial", "Historial"], ["metricas", "Métricas"], ["area", a.admin ? "Su interior" : "Su área"], ["chat", "Hablarle"]];
  const ap = d.aprobaciones.length;
  const chatScroll = $("#estCont .est-cuerpo")?.scrollTop;
  $("#estCont").innerHTML = `
    <div class="est-cab" style="--c:${a.color}"><div class="est-av">${esc(a.nombre[0])}</div><div>
      <h2>${esc(a.nombre)}</h2><div class="sub2">${esc(vivo?.puesto || (a.admin ? "Administradora · compañera" : ""))}</div>
      <span class="pill" style="color:${COLOR_ESTADO[est]}"><i></i>${TXT_ESTADO[est]}${vivo?.actividad && est !== "inactivo" ? ` · ${esc(vivo.actividad.slice(0, 40))}` : ""}</span></div></div>
    <div class="est-tabs">${pestanas.map(([k, t]) => `<button data-t="${k}" class="${estTab === k ? "on" : ""}">${t}${k === "ahora" && ap ? ` <span style="color:var(--h-warn)">●</span>` : ""}</button>`).join("")}</div>
    <div class="est-cuerpo" style="--c:${a.color}">${cuerpoEstacion(d, est)}</div>`;
  $("#estCont").querySelectorAll(".est-tabs button").forEach((b) => b.onclick = () => { estTab = b.dataset.t; pintarEstacion(); });
  $("#estCont").querySelectorAll("[data-ap]").forEach((b) => b.onclick = () => resolverAprobacion(b.dataset.ap, b.dataset.v === "1", b));
  const f = $("#estCont form.chat-in"); if (f) f.onsubmit = (ev) => { ev.preventDefault(); hablarle(a.id, f.querySelector("input")); };
  const cuerpo = $("#estCont .est-cuerpo");
  if (estTab === "chat") cuerpo.scrollTop = cuerpo.scrollHeight; else if (chatScroll) cuerpo.scrollTop = chatScroll;
}
function cuerpoEstacion(d, est) {
  const a = d.agente;
  if (estTab === "ahora") {
    const aps = d.aprobaciones.map((x) => `<div class="tarjeta" style="border-color:rgba(251,191,36,.45)"><div class="t1">✋ ${esc(x.titulo)}</div><div class="t2">${esc(x.detalle || "")}</div><div class="acciones"><button class="h-btn ok" data-ap="${x.id}" data-v="1">Aprobar</button><button class="h-btn no" data-ap="${x.id}" data-v="0">Rechazar</button></div></div>`).join("");
    const pasos = d.ahora.slice(0, 14).map((p) => `<div class="linea"><span class="h">${hora(p.creado_en)}</span><span class="x">${esc(p.frase)}<small>${esc(String(p.detalle).slice(0, 160))}</small></span></div>`).join("");
    return `${aps ? `<div class="bloque"><div class="tit">Esperando tu OK</div>${aps}</div>` : ""}
      <div class="bloque"><div class="tit">Su misión</div><div class="mision-txt">${esc(a.mision)}</div></div>
      <div class="bloque"><div class="tit">Lo último que hizo (6 h)</div>${pasos || `<div class="vacio2">Nada en las últimas horas.</div>`}</div>
      <div class="bloque"><div class="tit">Equipo</div><div class="mision-txt mono" style="font-size:11.5px">${a.tools ?? "?"} herramientas · ${a.skills ?? "?"} skills · modelos: ${esc(a.modelos.planificador || "—")} / ${esc(a.modelos.ejecutor || "—")}</div></div>`;
  }
  if (estTab === "encargos") {
    const ic = { en_curso: "🔄", esperando_jefe: "✋", hecho: "✅", fallido: "❌", cancelado: "🚫", reintentado: "🔁" };
    return d.encargos.length ? d.encargos.map((e) => `<div class="tarjeta"><div class="t1">${ic[e.estado] || ""} E-${e.id.slice(0, 4)} · ${esc(String(e.tarea).split("\n")[0].slice(0, 140))}</div><div class="t2">${esc(e.estado)} · ${hace(e.creado_en)}${e.resultado ? `\n${esc(e.resultado)}` : ""}</div></div>`).join("") : `<div class="vacio2">Nadie le ha delegado nada todavía.</div>`;
  }
  if (estTab === "historial") {
    const ic = { completada: "✅", fallida: "❌", en_curso: "🔄", esperando_aprobacion: "✋" };
    return d.ejecuciones.length ? d.ejecuciones.map((e) => `<div class="tarjeta"><div class="t1">${ic[e.estado] || ""} ${hora(e.inicio)} · ${esc(e.origen)} · ${e.tool_calls ?? 0} herramientas</div>${e.respuesta ? `<div class="t2">${esc(e.respuesta)}</div>` : ""}</div>`).join("") : `<div class="vacio2">Sin ejecuciones todavía.</div>`;
  }
  if (estTab === "metricas") {
    const m = d.metricas, s = d.serie;
    const max = Math.max(1, ...s.map((x) => x.tareas));
    return `${m ? `<div class="kpis"><div class="kpi"><b>${m.tareas}</b><span>tareas 7 d</span></div><div class="kpi"><b>${m.tareas ? Math.round(m.ok / m.tareas * 100) : 0}%</b><span>bien</span></div><div class="kpi"><b>${Math.round((m.tasa_problemas || 0) * 100)}%</b><span>problemas</span></div><div class="kpi"><b>${m.seg ? Math.round(m.seg) + "s" : "—"}</b><span>por tarea</span></div><div class="kpi"><b>${m.correcciones}</b><span>correcciones</span></div><div class="kpi"><b>$${Number(m.costo || 0).toFixed(2)}</b><span>costo 7 d</span></div></div>` : `<div class="vacio2">System todavía no tiene métricas de este agente.</div>`}
      ${s.length ? `<div class="tit">Tareas por día (rojo = con fallas)</div><div class="barras">${s.map((x) => `<div class="${x.fallidas ? "mal" : ""}" title="${x.dia}: ${x.tareas} tareas, ${x.fallidas} fallas" style="height:${Math.max(3, x.tareas / max * 100)}%"></div>`).join("")}</div><div class="barras-ej"><span>${s[0].dia}</span><span>${s[s.length - 1].dia}</span></div>` : ""}`;
  }
  if (estTab === "area") return areaDe(d.extra, a);
  if (estTab === "chat") {
    return `<div class="chat">${d.conversacion.map((m) => `<div class="msj ${m.rol === "usuario" ? "u" : "a"}">${esc(m.contenido)}</div>`).join("") || `<div class="vacio2">Escríbele directo a ${esc(a.nombre)} (por el panel).</div>`}</div>
      <form class="chat-in"><input placeholder="Escríbele a ${esc(a.nombre)}…" /><button class="h-btn">Enviar</button></form>`;
  }
  return "";
}
function areaDe(x, a) {
  if (!x || x.error) return `<div class="vacio2">${esc(x?.error || "Sin datos de su área.")}</div>`;
  if (x.tipo === "emilia") {
    const dims = { animo: "Ánimo", energia: "Energía", cercania: "Cercanía contigo", preocupacion: "Preocupación", enojo: "Enojo", timidez: "Timidez", entusiasmo: "Entusiasmo" };
    return `<div class="bloque"><div class="tit">Cómo se siente</div><div class="mision-txt" style="color:${x.animo.color}">${esc(x.animo.descripcion)}</div>
      ${Object.entries(dims).map(([k, t]) => { const v = x.animo.dims[k]; const pct = k === "animo" ? (v + 1) / 2 : v; return `<div class="dim" style="--c:${x.animo.color}"><span>${t}</span><span class="b"><i style="width:${Math.round(pct * 100)}%"></i></span><span class="v">${v.toFixed(2)}</span></div>`; }).join("")}</div>
      ${x.animo.causas.length ? `<div class="bloque"><div class="tit">Por qué</div>${x.animo.causas.map((c) => `<div class="linea"><span class="h">${hace(c.t)}</span><span class="x">${esc(c.texto)}</span></div>`).join("")}</div>` : ""}
      <div class="bloque"><div class="tit">Lo que busca (su yo v${x.yo.version})</div>${x.yo.metas.map((m) => `<div class="linea"><span class="h">meta</span><span class="x">${esc(m.meta)}${m.progreso ? `<small>${esc(m.progreso)}</small>` : ""}</span></div>`).join("")}</div>
      <div class="bloque"><div class="tit">Se pregunta</div>${x.yo.preguntas.map((p) => `<div class="mision-txt">“${esc(p)}”</div>`).join("")}</div>
      <div class="bloque"><div class="tit">Misiones</div>${x.misiones.map((m) => `<div class="tarjeta"><div class="t1">M-${m.id.slice(0, 4)} · ${esc(m.objetivo)}</div><div class="t2">${esc(m.estado)} · ${(m.pasos || []).map((p) => `${p.n}.${p.agente} ${p.estado}`).join(" · ")}</div></div>`).join("") || `<div class="vacio2">Sin misiones.</div>`}</div>
      <div class="vacio2">Su diario es suyo: no se muestra aquí.</div>`;
  }
  if (x.tipo === "sage") return `<div class="bloque"><div class="tit">Sandboxes abiertos</div>${x.sandboxes.map((s) => `<div class="linea"><span class="h">${hace(s.creado_en)}</span><span class="x">${esc(s.proyecto)} · ${esc(s.rama)}</span></div>`).join("") || `<div class="vacio2">Ninguno.</div>`}</div>
    <div class="bloque"><div class="tit">Guardia de código</div>${x.guardia.map((g) => `<div class="tarjeta"><div class="t1">${g.severidad === "grave" ? "🔴" : "🟡"} ${esc(g.objetivo)}: ${esc(g.titulo)}</div><div class="t2">${esc(g.estado)}</div></div>`).join("") || `<div class="vacio2">Todo limpio.</div>`}</div>
    <div class="bloque"><div class="tit">Sesiones de Claude Code</div>${x.sesiones.map((s) => `<div class="linea"><span class="h">${hace(s.inicio)}</span><span class="x">${esc(String(s.encargo).slice(0, 120))}<small>${esc(s.estado)}</small></span></div>`).join("") || `<div class="vacio2">Ninguna.</div>`}</div>`;
  if (x.tipo === "arca") return `<div class="bloque"><div class="tit">Instalación · ${x.porcentaje}% · nivel «${esc(x.nivel || "")}»</div>${x.misiones.map((m) => `<div class="linea"><span class="h">${m.completa ? "🏆" : m.emoji}</span><span class="x">Misión ${m.n}: ${esc(m.nombre)}${m.total ? `<small>${m.hechos}/${m.total}</small>` : ""}</span></div>`).join("")}</div>
    ${x.siguiente ? `<div class="bloque"><div class="tit">Siguiente paso</div><div class="mision-txt">${esc(x.siguiente.nombre)}: ${esc(x.siguiente.detalle)}</div></div>` : ""}
    <div class="bloque"><div class="tit">Prueba final</div>${x.prueba ? x.prueba.componentes.map((c) => `<div class="linea"><span class="h">${c.nota}/10</span><span class="x">${esc(c.nombre)}</span></div>`).join("") : `<div class="vacio2">Todavía no corre la prueba final.</div>`}</div>
    <div class="bloque"><div class="tit">Lo que hizo en el PC</div>${x.acciones.map((a) => `<div class="linea"><span class="h">${hace(a.creado_en)}</span><span class="x">${a.ok ? "✅" : "❌"} ${esc(a.tipo)} ${esc(a.que)}</span></div>`).join("") || `<div class="vacio2">Nada todavía.</div>`}</div>
    <a class="h-btn" href="/arca" style="text-decoration:none">Abrir el taller</a>`;
  if (x.tipo === "system") return `<div class="bloque"><div class="tit">Salud del equipo</div><pre class="tab">${esc(x.tablero)}</pre></div>
    <div class="bloque"><div class="tit">Señales abiertas</div>${x.senales.map((s) => `<div class="linea"><span class="h">${esc(s.tipo)}</span><span class="x">${esc(s.titulo)}</span></div>`).join("") || `<div class="vacio2">Ninguna: el equipo está sano.</div>`}</div>
    <div class="bloque"><div class="tit">Cambios (adaptación)</div>${x.cambios.map((c) => `<div class="tarjeta"><div class="t1">${esc(c.ref)} · ${esc(c.titulo)}</div><div class="t2">${esc(c.estado)} · nivel ${c.nivel}${c.resultado ? `\n${esc(c.resultado)}` : ""}</div></div>`).join("") || `<div class="vacio2">Sin cambios todavía.</div>`}</div>`;
  if (x.tipo === "lyra") return `<div class="bloque"><div class="tit">Gestiones</div>${x.gestiones.map((g) => `<div class="tarjeta"><div class="t1">${esc(g.ref)} · ${esc(g.objetivo)}</div><div class="t2">${esc(g.estado)} · ${g.turnos} mensajes${g.pregunta_jefe ? `\n❓ ${esc(g.pregunta_jefe)}` : ""}</div></div>`).join("") || `<div class="vacio2">Ninguna.</div>`}</div>
    <div class="bloque"><div class="tit">Respuestas que te propuso</div>${x.propuestas.map((p) => `<div class="linea"><span class="h">${hace(p.creado_en)}</span><span class="x">«${esc(p.borrador)}»</span></div>`).join("") || `<div class="vacio2">Ninguna pendiente.</div>`}</div>
    <div class="bloque"><div class="tit">Agenda de contactos</div><div class="mision-txt">${x.contactos.map((c) => `${c.n} ${c.permiso === "libre" ? "libres" : c.permiso === "bloqueado" ? "bloqueados" : "con OK"}`).join(" · ") || "vacía"}</div></div>`;
  if (x.tipo === "lara") { const c = x.cerebro || {}; return `<div class="bloque"><div class="tit">El cerebro compartido</div><pre class="tab">${esc(JSON.stringify(c, null, 1).slice(0, 2500))}</pre></div><a class="h-btn" href="/biblioteca" style="text-decoration:none;display:inline-block">Abrir el cerebro →</a>`; }
  if (x.tipo === "iris") return `<div class="bloque"><div class="tit">Vigilancia</div>${x.monitores.map((m) => `<div class="linea"><span class="h" style="color:${m.estado === "ok" ? "#34d399" : m.estado === "caido" ? "#f87171" : "#fbbf24"}">${esc(m.estado)}</span><span class="x">${esc(m.nombre)}<small>${esc(m.detalle || "")}</small></span></div>`).join("") || `<div class="vacio2">Sin monitores.</div>`}</div>
    <div class="bloque"><div class="tit">Agenda (próximos 2 días)</div>${x.agenda.map((g) => `<div class="linea"><span class="h">${new Date(g.inicio).toLocaleString("es-CO", { weekday: "short", hour: "2-digit", minute: "2-digit" })}</span><span class="x">${esc(g.titulo)}</span></div>`).join("") || `<div class="vacio2">Nada agendado.</div>`}</div>`;
  if (x.tipo === "soga") return `<div class="bloque"><div class="tit">Radar (lo último)</div>${x.radar.map((r) => `<div class="linea"><span class="h">${esc(r.tema)}</span><span class="x">${r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener" style="color:var(--h-cyan)">${esc(r.titulo)}</a>` : esc(r.titulo)}<small>relevancia ${r.relevancia ?? "?"} · ${hace(r.visto_en)}</small></span></div>`).join("") || `<div class="vacio2">El radar no ha visto nada todavía.</div>`}</div>`;
  return `<div class="vacio2">Su área se ve en sus encargos e historial.</div>`;
}
async function resolverAprobacion(id, aprobada, boton) {
  boton.disabled = true; boton.textContent = aprobada ? "Aprobando…" : "Rechazando…";
  try { await post(`/api/aprobaciones/${id}/resolver`, { aprobada }); } catch (e) { alert(e.message); }
  await refrescar(); await cargarEstacion();
}
async function hablarle(id, input) {
  const txt = input.value.trim(); if (!txt) return;
  input.value = ""; input.disabled = true;
  estDatos.conversacion.push({ rol: "usuario", contenido: txt }, { rol: "agente", contenido: "…" }); pintarEstacion();
  try { await post(`/api/agentes/${id}/chat`, { mensaje: txt }); } catch (e) { alert(e.message); }
  input.disabled = false; await cargarEstacion();
}

// ═══════════════════ CONSOLA DE MANDO ═══════════════════
$("#consola").onsubmit = async (ev) => {
  ev.preventDefault();
  const inp = $("#pedido"), txt = inp.value.trim(); if (!txt) return;
  const admin = ultimoEstado?.agentes.find((a) => a.admin); if (!admin) return;
  inp.value = ""; $("#consola").classList.add("ocupada");
  const comms = $("#comms"); comms.hidden = false;
  comms.innerHTML = `<div class="yo">› ${esc(txt)}</div><span class="quien">EMILIA</span><span class="puntos">pensando</span>`;
  try {
    const r = await post(`/api/agentes/${admin.id}/chat`, { mensaje: txt });
    comms.innerHTML = `<div class="yo">› ${esc(txt)}</div><span class="quien">EMILIA${r.estado === "esperando_aprobacion" ? " · espera tu OK" : ""}</span>${esc(r.respuesta || "(sin respuesta)")}`;
  } catch (e) { comms.innerHTML = `<div class="yo">› ${esc(txt)}</div><span class="quien" style="color:var(--h-bad)">ERROR</span>${esc(e.message)}`; }
  $("#consola").classList.remove("ocupada");
  refrescar();
};
$("#comms").onclick = () => { $("#comms").hidden = true; };

// ═══════════════════ CÁMARA ═══════════════════
let animCam = null;
function irA(pos, mirar, ms = 900) { animCam = { de: camara.position.clone(), a: pos, deT: controles.target.clone(), aT: mirar, t0: performance.now(), ms }; }
function enfocar(id) {
  if (emilia && emilia.ag.id === id) return irA(new THREE.Vector3(7, 8.5, 9), new THREE.Vector3(0, 2.6, 0));
  const e = estaciones.get(id); if (!e) return;
  // Por encima del hombro: afuera, arriba y un poco de lado, mirando el monitor (y dejando espacio al panel de la derecha).
  const p = e.g.position.clone(), dir = p.clone().normalize(), lado = new THREE.Vector3(-dir.z, 0, dir.x);
  irA(p.clone().add(dir.multiplyScalar(5.2)).add(lado.multiplyScalar(-2.6)).add(new THREE.Vector3(0, 4.2, 0)), p.clone().add(new THREE.Vector3(0, 1.3, 0)).add(lado.clone().multiplyScalar(0)));
}
function volverVista() { irA(VISTA.clone(), new THREE.Vector3(0, 1, 0)); }
$("#bVista").onclick = volverVista;
$("#bGiro").onclick = () => { controles.autoRotate = !controles.autoRotate; $("#bGiro").classList.toggle("on", controles.autoRotate); };
$("#bEtiquetas").onclick = () => { $("#etiquetas").classList.toggle("ocultas"); $("#bEtiquetas").classList.toggle("on"); };

// Clic en la escena → agente
const ray = new THREE.Raycaster(), mouse = new THREE.Vector2();
let abajo = null;
renderer.domElement.addEventListener("pointerdown", (e) => { abajo = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener("pointerup", (e) => {
  if (!abajo || Math.hypot(e.clientX - abajo[0], e.clientY - abajo[1]) > 5) return;
  mouse.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(mouse, camara);
  const hit = ray.intersectObjects(escena.children, true).find((h) => h.object.userData.agenteId);
  if (hit) abrirEstacion(hit.object.userData.agenteId);
});
renderer.domElement.addEventListener("pointermove", (e) => {
  mouse.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(mouse, camara);
  const hit = ray.intersectObjects(escena.children, true).find((h) => h.object.userData.agenteId);
  renderer.domElement.style.cursor = hit ? "pointer" : "";
});

addEventListener("resize", () => {
  VISTA = vistaSegunPantalla();
  camara.aspect = innerWidth / innerHeight; camara.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight); compositor.setSize(innerWidth, innerHeight); etiquetas.setSize(innerWidth, innerHeight);
});

// ═══════════════════ ANIMACIÓN ═══════════════════
const reloj = new THREE.Clock();
const tmp = new THREE.Vector3();
let ultimaPintura = 0;
function animar() {
  requestAnimationFrame(animar);
  const dt = Math.min(0.05, reloj.getDelta()), t = reloj.elapsedTime;
  if (animCam) {
    const k = Math.min(1, (performance.now() - animCam.t0) / animCam.ms), s = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    camara.position.lerpVectors(animCam.de, animCam.a, s); controles.target.lerpVectors(animCam.deT, animCam.aT, s);
    if (k >= 1) animCam = null;
  }
  controles.update();
  const pintar = t - ultimaPintura > 0.25; if (pintar) ultimaPintura = t;
  // Emilia
  if (emilia) {
    emilia.orbe.position.y = 4.3 + Math.sin(t * 1.2) * 0.12;
    emilia.nucleo.rotation.y += dt * 0.6; emilia.nucleo.rotation.x += dt * 0.25;
    emilia.aros.forEach((a, i) => { a.rotation.x += dt * (0.3 + i * 0.15); a.rotation.y += dt * (0.2 + i * 0.1); });
    const pulso = 1 + Math.sin(t * 2.2) * 0.06; emilia.nucleo.scale.setScalar(pulso);
    emilia.nucleoMat.emissiveIntensity = 2 + Math.sin(t * 2.2) * 0.5;
    emilia.av.cabeza.rotation.y = Math.sin(t * 0.4) * 0.5;
    const trabaja = emilia.estado === "trabajando";
    emilia.av.bi.rotation.x = trabaja ? -1.1 + Math.sin(t * 14) * 0.15 : -0.3; emilia.av.bd.rotation.x = trabaja ? -1.1 + Math.cos(t * 14) * 0.15 : -0.3;
  }
  // Agentes
  for (const e of estaciones.values()) {
    const ag = e.ag, st = ag.estado;
    const c = new THREE.Color(COLOR_ESTADO[st] || ag.color);
    if (pintar) pintarPantalla(e.pantalla, ag, t);
    // brazos: teclear si trabaja
    const tecleando = st === "trabajando" && !e.enReunion && !e.destino;
    e.av.bi.rotation.x = tecleando ? -0.95 + Math.sin(t * 16 + e.g.position.x) * 0.16 : -0.55;
    e.av.bd.rotation.x = tecleando ? -0.95 + Math.cos(t * 15 + e.g.position.z) * 0.16 : -0.55;
    e.av.cabeza.rotation.x = st === "inactivo" ? -0.25 + Math.sin(t * 0.8) * 0.05 : st === "esperando" ? Math.sin(t * 3) * 0.12 : 0;
    e.av.cabeza.rotation.y = st === "esperando" ? Math.sin(t * 1.6) * 0.4 : 0;
    e.av.emis.emissiveIntensity = st === "pausado" ? 0.2 : st === "error" ? 1 + Math.abs(Math.sin(t * 6)) * 2 : st === "trabajando" ? 1.8 : 1.1;
    if (st === "error") { e.av.emis.emissive.set("#f87171"); } else e.av.emis.emissive.copy(e.color);
    // haz y luz
    const enfocado = seleccionado === ag.id;
    e.haz.material.opacity += ((enfocado ? 0 : st === "trabajando" ? 0.12 : st === "esperando" ? 0.16 : 0) - e.haz.material.opacity) * 0.08;
    e.haz.material.color.copy(c);
    e.luz.color.copy(st === "inactivo" ? e.color : c); e.luz.intensity = st === "pausado" ? 0.3 : st === "inactivo" ? 1.6 : 3 + Math.sin(t * 4) * 0.8;
    e.placa.material.opacity = st === "trabajando" ? 0.12 + Math.sin(t * 3) * 0.04 : 0.06;
    e.borde.material.color.copy(st === "inactivo" ? e.color : c);
    // caminar a la sala de juntas y volver
    if (e.destino) {
      const meta = e.destino === "casa" ? e.casa : e.g.worldToLocal(tmp.copy(e.destino));
      const pos = e.av.g.position, dif = meta.clone().sub(pos); dif.y = 0;
      const dist = dif.length();
      if (dist > 0.08) {
        const paso = Math.min(dist, dt * 3.2); pos.add(dif.normalize().multiplyScalar(paso)); pos.y = 0.0 + Math.abs(Math.sin(t * 9)) * 0.05;
        e.av.g.rotation.y = Math.atan2(dif.x, dif.z);
        e.av.bi.rotation.x = Math.sin(t * 9) * 0.5; e.av.bd.rotation.x = -Math.sin(t * 9) * 0.5;
      } else {
        pos.copy(meta); if (e.destino === "casa") { e.av.g.position.copy(e.casa); e.av.g.rotation.y = Math.PI; } else { const mira = e.g.worldToLocal(tmp.copy(SALA)); e.av.g.rotation.y = Math.atan2(mira.x - pos.x, mira.z - pos.z); }
        e.destino = null;
      }
    }
    const h = haces.get(ag.id);
    if (h) {
      h.mat.opacity += ((h.activo ? 0.35 : 0) - h.mat.opacity) * 0.06;
      h.chispas.forEach((s, i) => { const k = (t * 0.45 + i / h.chispas.length) % 1; s.position.copy(h.curva.getPoint(k)); s.material.opacity = h.mat.opacity * 2.2; s.material.color.copy(e.color); });
    }
  }
  // Sala
  sala.holo.material.opacity += ((sala.activa ? 0.14 + Math.sin(t * 2) * 0.04 : 0) - sala.holo.material.opacity) * 0.05;
  sala.rot.material.opacity = sala.holo.material.opacity * 4; sala.rot.rotation.z += dt * 1.2; sala.rot.position.y = 2.2 + Math.sin(t * 1.5) * 0.4;
  compositor.render();
  etiquetas.render(escena, camara);
}

// ═══════════════════ ARRANQUE ═══════════════════
async function refrescar() {
  try { aplicar(await api("/api/oficina/estado")); } catch (e) { console.warn("oficina:", e.message); }
}
await refrescar();
$("#cargando").classList.add("fuera");
animar();
setInterval(refrescar, 2500);
setInterval(() => { if (estAbierta && estTab !== "chat") cargarEstacion(); }, 5000);
const pedido = new URLSearchParams(location.search).get("agente");
if (pedido) setTimeout(() => abrirEstacion(pedido), 400);
else if (!REDUCIR) { camara.position.set(40, 34, 40); irA(VISTA.clone(), new THREE.Vector3(0, 1, 0), 2200); }
