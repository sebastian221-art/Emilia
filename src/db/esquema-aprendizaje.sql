-- ARCHIVO: src/db/esquema-aprendizaje.sql
-- ─────────────────────────────────────────────────────────────────────────────
--  APRENDIZAJE (System) — experimentos tipo "pista": hipótesis, variantes con
--  puntaje, generaciones; y la cola de curiosidad: preguntas que el sistema se
--  hace solo y va explorando.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS exp_experimentos (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo          TEXT NOT NULL,
  hipotesis       TEXT NOT NULL,                     -- qué se cree que mejora qué
  metrica         TEXT NOT NULL,                     -- cómo se mide (número; más alto = mejor)
  dominio         TEXT NOT NULL DEFAULT 'general',   -- prompt | regla | codigo | busqueda | flujo | general
  estado          TEXT NOT NULL DEFAULT 'abierto',   -- abierto | cerrado | abandonado
  conclusion      TEXT,
  mejor_variante  UUID,
  nodo_slug       TEXT,                              -- nodo de la biblioteca al que alimenta
  agente_id       UUID,
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT now(),
  cerrado_en      TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS exp_variantes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  experimento_id  UUID NOT NULL REFERENCES exp_experimentos(id) ON DELETE CASCADE,
  nombre          TEXT NOT NULL,
  descripcion     TEXT,
  config          JSONB NOT NULL DEFAULT '{}',       -- lo que cambia (el prompt, la regla, el parámetro…)
  generacion      INT NOT NULL DEFAULT 1,
  padres          UUID[] NOT NULL DEFAULT '{}',      -- de qué variantes se cruzó
  puntaje         REAL,                              -- NULL = no corrida todavía
  detalle         TEXT,                              -- qué pasó al correrla
  corridas        INT NOT NULL DEFAULT 0,
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_exp_var_exp ON exp_variantes(experimento_id);

-- Curiosidad: preguntas abiertas que el sistema se hace y explora cuando tiene tiempo.
CREATE TABLE IF NOT EXISTS curiosidad (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pregunta        TEXT NOT NULL,
  origen          TEXT NOT NULL DEFAULT 'system',    -- system | biblioteca | fallo | jefe | nocturno
  prioridad       INT NOT NULL DEFAULT 5,            -- 1 (urgente) .. 9 (algún día)
  estado          TEXT NOT NULL DEFAULT 'pendiente', -- pendiente | explorando | explorada | descartada
  nodo_slug       TEXT,
  hallazgo        TEXT,
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT now(),
  explorada_en    TIMESTAMPTZ,
  UNIQUE (pregunta)
);
CREATE INDEX IF NOT EXISTS idx_curiosidad_estado ON curiosidad(estado, prioridad);

ALTER TABLE exp_experimentos ADD COLUMN IF NOT EXISTS casos JSONB NOT NULL DEFAULT '[]';   -- los MISMOS casos para todas las variantes