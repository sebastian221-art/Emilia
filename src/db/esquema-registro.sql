-- ARCHIVO: src/db/esquema-registro.sql
-- ─────────────────────────────────────────────────────────────────────────────
--  ESQUEMA DEL REGISTRO (Fase 1). Se aplica después de esquema.sql.
--  Agrega a tools/skills/flujos lo necesario para reflejar capacidades
--  definidas en código. Idempotente: se puede correr las veces que haga falta.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── tools ──
ALTER TABLE tools ADD COLUMN IF NOT EXISTS origen              TEXT    NOT NULL DEFAULT 'ui';     -- 'codigo' | 'ui'
ALTER TABLE tools ADD COLUMN IF NOT EXISTS modulo              TEXT;
ALTER TABLE tools ADD COLUMN IF NOT EXISTS esquema             JSONB;                             -- JSON Schema de parámetros
ALTER TABLE tools ADD COLUMN IF NOT EXISTS riesgo              TEXT    NOT NULL DEFAULT 'lectura';
ALTER TABLE tools ADD COLUMN IF NOT EXISTS requiere_aprobacion BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE tools ADD COLUMN IF NOT EXISTS activo              BOOLEAN NOT NULL DEFAULT true;
CREATE INDEX IF NOT EXISTS idx_tools_origen ON tools(origen, activo);

-- ── skills ──
ALTER TABLE skills ADD COLUMN IF NOT EXISTS origen              TEXT    NOT NULL DEFAULT 'ui';
ALTER TABLE skills ADD COLUMN IF NOT EXISTS modulo              TEXT;
ALTER TABLE skills ADD COLUMN IF NOT EXISTS esquema             JSONB;
ALTER TABLE skills ADD COLUMN IF NOT EXISTS cuando_usar         TEXT    NOT NULL DEFAULT '';
ALTER TABLE skills ADD COLUMN IF NOT EXISTS tools_permitidas    JSONB   NOT NULL DEFAULT '[]';
ALTER TABLE skills ADD COLUMN IF NOT EXISTS procedimiento       TEXT    NOT NULL DEFAULT '';
ALTER TABLE skills ADD COLUMN IF NOT EXISTS requiere_aprobacion BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE skills ADD COLUMN IF NOT EXISTS activo              BOOLEAN NOT NULL DEFAULT true;
CREATE INDEX IF NOT EXISTS idx_skills_origen ON skills(origen, activo);

-- ── flujos ──
ALTER TABLE flujos ADD COLUMN IF NOT EXISTS origen      TEXT    NOT NULL DEFAULT 'ui';
ALTER TABLE flujos ADD COLUMN IF NOT EXISTS modulo      TEXT;
ALTER TABLE flujos ADD COLUMN IF NOT EXISTS descripcion TEXT    NOT NULL DEFAULT '';
ALTER TABLE flujos ADD COLUMN IF NOT EXISTS activo      BOOLEAN NOT NULL DEFAULT true;
-- El upsert por nombre necesita unicidad. Si ya tenés dos flujos con el mismo
-- nombre creados desde la UI, renombrá uno antes de correr esto.
CREATE UNIQUE INDEX IF NOT EXISTS uq_flujos_nombre ON flujos(nombre);