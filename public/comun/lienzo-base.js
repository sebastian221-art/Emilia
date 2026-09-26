// ARCHIVO: public/comun/lienzo-base.js
// Lienzo reutilizable: zoom con rueda, paneo arrastrando el fondo, nodos
// arrastrables con posición guardable, líneas al centro. Lo usan Empresa y
// Aprobaciones (y puede usarlo cualquier página nueva).
function crearLienzo(contId, mundoId, svgId, zoomNivelId, op = {}) {
    const cam = { escala: 1, x: 0, y: 0 };
    const cont = () => document.getElementById(contId);
    const mundo = () => document.getElementById(mundoId);
    const CX = op.centroX ?? 500, CY = op.centroY ?? 350;
    let pan = false, ini = { x: 0, y: 0 }, moviendo = null, off = { x: 0, y: 0 }, movio = false;
    const nodos = op.nodos || [];   // [{id, x, y, w, h}]
    function aplicar() { const m = mundo(); if (m) m.style.transform = `translate(${cam.x}px,${cam.y}px) scale(${cam.escala})`; const z = document.getElementById(zoomNivelId); if (z) z.textContent = Math.round(cam.escala * 100) + "%"; }
    function aMundo(cx, cy) { const r = cont().getBoundingClientRect(); return { x: (cx - r.left - cam.x) / cam.escala, y: (cy - r.top - cam.y) / cam.escala }; }
    function zoomA(n, cx, cy) { n = Math.min(2.5, Math.max(0.3, n)); cam.x = cx - (cx - cam.x) * (n / cam.escala); cam.y = cy - (cy - cam.y) * (n / cam.escala); cam.escala = n; aplicar(); }
    function zoomIn() { const r = cont().getBoundingClientRect(); zoomA(cam.escala * 1.2, r.width / 2, r.height / 2); }
    function zoomOut() { const r = cont().getBoundingClientRect(); zoomA(cam.escala * 0.83, r.width / 2, r.height / 2); }
    function centrar() { const r = cont().getBoundingClientRect(); cam.escala = 1; cam.x = r.width / 2 - CX; cam.y = r.height / 2 - CY; aplicar(); }
    function lineas() {
      const svg = document.getElementById(svgId); if (!svg) return;
      svg.setAttribute("width", 6000); svg.setAttribute("height", 6000); svg.setAttribute("viewBox", "0 0 6000 6000");
      svg.innerHTML = `<defs><filter id="glowL"><feGaussianBlur stdDeviation="2.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>` +
        nodos.map((n) => `<line x1="${n.x + (n.w || 150) / 2}" y1="${n.y + (n.h || 50) / 2}" x2="${(n.padre ? nodos.find((p) => p.id === n.padre) : null)?.x + ((n.padre ? nodos.find((p) => p.id === n.padre) : { w: 0 }).w || 150) / 2 || CX}" y2="${(n.padre ? nodos.find((p) => p.id === n.padre) : null)?.y + ((n.padre ? nodos.find((p) => p.id === n.padre) : { h: 0 }).h || 50) / 2 || CY}" stroke="#b388ff" stroke-width="2" opacity="${n.opacidad ?? 0.85}" filter="url(#glowL)"${n.punteada ? ' stroke-dasharray="5 5"' : ""}/>`).join("");
    }
    function init() {
      const c = cont(); if (!c) return; centrar();
      c.addEventListener("wheel", (e) => { e.preventDefault(); const r = c.getBoundingClientRect(); zoomA(cam.escala * (e.deltaY < 0 ? 1.12 : 0.89), e.clientX - r.left, e.clientY - r.top); }, { passive: false });
      c.addEventListener("mousedown", (e) => { if (e.target.closest(".nodo-l, .zoom-ctrl, button, a, input")) return; pan = true; c.classList.add("paneando"); ini = { x: e.clientX - cam.x, y: e.clientY - cam.y }; });
      window.addEventListener("mousemove", (e) => {
        if (moviendo) { movio = true; const n = nodos.find((x) => x.id === moviendo); const p = aMundo(e.clientX, e.clientY); n.x = Math.max(0, p.x - off.x); n.y = Math.max(0, p.y - off.y); const el = document.getElementById("nl-" + n.id); if (el) { el.style.left = n.x + "px"; el.style.top = n.y + "px"; } lineas(); }
        else if (pan) { cam.x = e.clientX - ini.x; cam.y = e.clientY - ini.y; aplicar(); }
      });
      window.addEventListener("mouseup", () => { if (moviendo && op.alSoltar) op.alSoltar(nodos.find((x) => x.id === moviendo)); moviendo = null; pan = false; c.classList.remove("paneando"); setTimeout(() => (movio = false), 50); });
    }
    function agarrar(e, id) { if (e.target.closest("button, a, input")) return; e.stopPropagation(); const n = nodos.find((x) => x.id === id); const p = aMundo(e.clientX, e.clientY); off = { x: p.x - n.x, y: p.y - n.y }; moviendo = id; movio = false; }
    return { cam, nodos, aplicar, aMundo, zoomIn, zoomOut, centrar, lineas, init, agarrar, seMovio: () => movio, CX, CY };
  }