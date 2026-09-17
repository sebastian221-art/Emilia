// ═══ Zoom + paneo compartido para los lienzos (estilo Railway) ═══
// Uso: crearZoomPaneo(contenedorEl, mundoEl, onCambio)
//   - contenedorEl: el .lienzo-cont (área visible)
//   - mundoEl: la capa interna que se transforma (donde van nodos + svg)
//   - onCambio: callback opcional cuando cambia el zoom/paneo (para redibujar líneas)
// Devuelve un objeto con { estado, aCoordenadasMundo(clientX,clientY), reset() }.

function crearZoomPaneo(contenedorEl, mundoEl, onCambio) {
    const estado = { escala: 1, x: 0, y: 0 };
    const MIN = 0.3, MAX = 2.5;
  
    function aplicar() {
      mundoEl.style.transform = `translate(${estado.x}px, ${estado.y}px) scale(${estado.escala})`;
      if (onCambio) onCambio(estado);
    }
  
    // ── Zoom con la rueda (hacia el cursor) ──
    contenedorEl.addEventListener("wheel", (e) => {
      e.preventDefault();
      const rect = contenedorEl.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.12 : 0.89;
      const nueva = Math.min(MAX, Math.max(MIN, estado.escala * factor));
      // zoom hacia el punto del cursor
      estado.x = mx - (mx - estado.x) * (nueva / estado.escala);
      estado.y = my - (my - estado.y) * (nueva / estado.escala);
      estado.escala = nueva;
      aplicar();
    }, { passive: false });
  
    // ── Paneo arrastrando el fondo (no un nodo) ──
    let paneando = false, ini = { x: 0, y: 0 };
    contenedorEl.addEventListener("mousedown", (e) => {
      // Solo panear si se clickeó el fondo/mundo, no un nodo arrastrable.
      if (e.target.closest(".nodo-fl, .pieza-nodo, .sec-nodo, .pieza-esq, .ag-nodo, .central, .agente-central, .central-esq, .zoom-ctrl, button, input")) return;
      paneando = true;
      contenedorEl.classList.add("paneando");
      ini = { x: e.clientX - estado.x, y: e.clientY - estado.y };
    });
    window.addEventListener("mousemove", (e) => {
      if (!paneando) return;
      estado.x = e.clientX - ini.x;
      estado.y = e.clientY - ini.y;
      aplicar();
    });
    window.addEventListener("mouseup", () => { paneando = false; contenedorEl.classList.remove("paneando"); });
  
    // Convierte coordenadas de pantalla a coordenadas del mundo (para soltar nodos donde apunta el cursor).
    function aCoordenadasMundo(clientX, clientY) {
      const rect = contenedorEl.getBoundingClientRect();
      return {
        x: (clientX - rect.left - estado.x) / estado.escala,
        y: (clientY - rect.top - estado.y) / estado.escala,
      };
    }
    function setZoom(nueva) {
      const rect = contenedorEl.getBoundingClientRect();
      const cx = rect.width/2, cy = rect.height/2;
      nueva = Math.min(MAX, Math.max(MIN, nueva));
      estado.x = cx - (cx - estado.x) * (nueva / estado.escala);
      estado.y = cy - (cy - estado.y) * (nueva / estado.escala);
      estado.escala = nueva; aplicar();
    }
    function reset() { estado.escala = 1; estado.x = 0; estado.y = 0; aplicar(); }
  
    aplicar();
    return { estado, aCoordenadasMundo, setZoom, reset,
      zoomIn: () => setZoom(estado.escala * 1.2),
      zoomOut: () => setZoom(estado.escala * 0.83) };
  }