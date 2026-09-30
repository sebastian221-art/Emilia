-- ARCHIVO: src/db/esquema-evaluacion.sql
-- Consumo (tokens/costo por llamada) y evaluaciones de agentes (Fase 12.4).
CREATE TABLE IF NOT EXISTS consumo (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agente_id     UUID REFERENCES agentes(id) ON DELETE SET NULL,
  ejecucion_id  UUID,
  proveedor     TEXT NOT NULL,                 -- groq | claude_code | groq_vision | groq_stt
  modelo        TEXT,
  tokens_in     INTEGER NOT NULL DEFAULT 0,
  tokens_out    INTEGER NOT NULL DEFAULT 0,
  costo_usd     NUMERIC(10,6) NOT NULL DEFAULT 0,
  creado_en     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_consumo_agente_fecha ON consumo(agente_id, creado_en DESC);

CREATE TABLE IF NOT EXISTS evaluaciones (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre      TEXT NOT NULL UNIQUE,
  agente_id   UUID REFERENCES agentes(id) ON DELETE CASCADE,
  descripcion TEXT NOT NULL DEFAULT '',
  casos       JSONB NOT NULL DEFAULT '[]',     -- [{mensaje, esperado, tools_esperadas?, notas?}]
  creado_en   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS evaluacion_corridas (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  evaluacion_id UUID NOT NULL REFERENCES evaluaciones(id) ON DELETE CASCADE,
  puntaje       REAL,
  resultados    JSONB NOT NULL DEFAULT '[]',   -- [{caso, respuesta, tools_usadas, puntaje, juicio}]
  costo_usd     NUMERIC(10,6),
  inicio        TIMESTAMPTZ NOT NULL DEFAULT now(),
  fin           TIMESTAMPTZ
);