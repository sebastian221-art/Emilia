-- ARCHIVO: src/db/esquema-biblioteca.sql
-- ─────────────────────────────────────────────────────────────────────────────
--  BIBLIOTECA — la red de conocimiento compartida de todos los agentes.
--  Nodos (conceptos con ficha y estado de verdad), conexiones con nombre,
--  evidencia con fuente y fecha, uso (refuerzo), propuestas de la guardiana
--  (Lara) que el jefe aprueba, y vectores para buscar por significado.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS bib_nodos (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            TEXT NOT NULL UNIQUE,              -- vision-por-computador, railway, yolo
  titulo          TEXT NOT NULL,
  tipo            TEXT NOT NULL DEFAULT 'concepto',  -- concepto | herramienta | tecnica | proyecto | leccion | formula | persona | fuente
  resumen         TEXT NOT NULL,                     -- 1-3 líneas: qué es
  ficha           JSONB NOT NULL DEFAULT '{}',       -- {que_es, como_funciona, para_que, cuando_usar, cuando_no, trampas, formula, ejemplos, preguntas_abiertas}
  estado          TEXT NOT NULL DEFAULT 'probable',  -- verificado | probable | dudoso | contradicho | obsoleto
  confianza       REAL NOT NULL DEFAULT 0.6,         -- 0..1, sube con evidencia y uso, baja con fallos y tiempo
  fuerza          REAL NOT NULL DEFAULT 1.0,         -- refuerzo por uso (se debilita con el tiempo)
  etiquetas       TEXT[] NOT NULL DEFAULT '{}',
  aprendido_por   UUID,                              -- agente que lo aportó
  verificado_por  UUID,                              -- Lara
  embedding       REAL[],                            -- vector de búsqueda semántica (384 dims)
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT now(),
  ultimo_uso_en   TIMESTAMPTZ,
  usos            INT NOT NULL DEFAULT 0,
  borrado_en      TIMESTAMPTZ                        -- papelera: el jefe puede restaurar
);
CREATE INDEX IF NOT EXISTS idx_bib_nodos_estado ON bib_nodos(estado) WHERE borrado_en IS NULL;
CREATE INDEX IF NOT EXISTS idx_bib_nodos_tipo ON bib_nodos(tipo) WHERE borrado_en IS NULL;
CREATE INDEX IF NOT EXISTS idx_bib_nodos_etiquetas ON bib_nodos USING GIN(etiquetas);

CREATE TABLE IF NOT EXISTS bib_conexiones (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  origen_id       UUID NOT NULL REFERENCES bib_nodos(id) ON DELETE CASCADE,
  destino_id      UUID NOT NULL REFERENCES bib_nodos(id) ON DELETE CASCADE,
  relacion        TEXT NOT NULL,                     -- usa | es_parte_de | reemplaza_a | compite_con | se_contradice_con | se_aplico_en | depende_de | relacionado_con
  peso            REAL NOT NULL DEFAULT 1.0,
  nota            TEXT,
  creado_por      UUID,
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (origen_id, destino_id, relacion)
);
CREATE INDEX IF NOT EXISTS idx_bib_con_origen ON bib_conexiones(origen_id);
CREATE INDEX IF NOT EXISTS idx_bib_con_destino ON bib_conexiones(destino_id);

CREATE TABLE IF NOT EXISTS bib_evidencias (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nodo_id         UUID NOT NULL REFERENCES bib_nodos(id) ON DELETE CASCADE,
  afirmacion      TEXT NOT NULL,                     -- qué sostiene esta evidencia
  origen          TEXT NOT NULL,                     -- investigacion | codigo | experimento | operacion | jefe | documento
  fuente          TEXT,                              -- URL, ruta, ejecución, sandbox
  resultado       TEXT NOT NULL DEFAULT 'apoya',     -- apoya | contradice | neutral
  detalle         TEXT,
  agente_id       UUID,
  fecha_fuente    DATE,                              -- de cuándo es la información (no cuándo se guardó)
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bib_ev_nodo ON bib_evidencias(nodo_id);

-- Uso de un nodo por un agente en una tarea: refuerzo (funcionó) o debilitamiento (falló).
CREATE TABLE IF NOT EXISTS bib_usos (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nodo_id         UUID NOT NULL REFERENCES bib_nodos(id) ON DELETE CASCADE,
  agente_id       UUID,
  ejecucion_id    UUID,
  resultado       TEXT NOT NULL DEFAULT 'consultado', -- consultado | funciono | fallo
  nota            TEXT,
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Propuestas de la guardiana (fusionar, borrar, marcar dudoso, refrescar): el jefe decide.
CREATE TABLE IF NOT EXISTS bib_propuestas (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo            TEXT NOT NULL,                     -- borrar | fusionar | marcar | refrescar | conectar
  nodo_id         UUID REFERENCES bib_nodos(id) ON DELETE CASCADE,
  nodo2_id        UUID REFERENCES bib_nodos(id) ON DELETE CASCADE,
  motivo          TEXT NOT NULL,
  datos           JSONB NOT NULL DEFAULT '{}',
  estado          TEXT NOT NULL DEFAULT 'pendiente', -- pendiente | aprobada | rechazada
  propuesto_por   UUID,
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT now(),
  resuelto_en     TIMESTAMPTZ
);

-- Bandeja de entrada: lo que los agentes aportan antes de que Lara lo integre.
CREATE TABLE IF NOT EXISTS bib_entradas (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo          TEXT NOT NULL,
  contenido       TEXT NOT NULL,
  origen          TEXT NOT NULL DEFAULT 'agente',    -- agente | jefe | sistema | migracion
  fuentes         JSONB NOT NULL DEFAULT '[]',
  etiquetas       TEXT[] NOT NULL DEFAULT '{}',
  agente_id       UUID,
  estado          TEXT NOT NULL DEFAULT 'pendiente', -- pendiente | integrada | descartada
  nodo_id         UUID REFERENCES bib_nodos(id) ON DELETE SET NULL,
  nota_guardiana  TEXT,
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT now(),
  procesado_en    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_bib_entradas_estado ON bib_entradas(estado, creado_en);