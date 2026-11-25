-- ─────────────────────────────────────────────────────────────────────────────
--  ARCA — la técnica: diagnóstico, tutorial de instalación, pruebas con nota
--  y mantenimiento del PC (cada acción queda anotada: «qué hiciste»).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS arca_chequeos (
  id              TEXT PRIMARY KEY,
  mision          TEXT NOT NULL,
  nombre          TEXT NOT NULL,
  estado          TEXT NOT NULL,
  detalle         TEXT NOT NULL DEFAULT '',
  pasos           JSONB NOT NULL DEFAULT '[]',
  instalable      TEXT,
  actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS arca_progreso (
  mision         TEXT PRIMARY KEY,
  completada_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS arca_informes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo       TEXT NOT NULL,            -- pruebas | mantenimiento
  nota       NUMERIC,
  datos      JSONB NOT NULL DEFAULT '{}',
  texto      TEXT NOT NULL,
  creado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS arca_acciones (
  id         BIGSERIAL PRIMARY KEY,
  tipo       TEXT NOT NULL,            -- instalar | limpiar | actualizar | llave | revisar
  que        TEXT NOT NULL,
  ok         BOOLEAN NOT NULL,
  detalle    TEXT NOT NULL DEFAULT '',
  creado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_arca_acciones_fecha ON arca_acciones (creado_en DESC);
