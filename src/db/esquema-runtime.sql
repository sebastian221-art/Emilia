-- ARCHIVO: src/db/esquema-runtime.sql
-- Runtime de proyectos (Fase 9.1): cómo se arranca cada proyecto y el estado
-- del proceso. Los logs van a archivo (DATA_DIR/logs/<proyecto>.log).
ALTER TABLE proyectos ADD COLUMN IF NOT EXISTS cmd_start   TEXT;                       -- ej. npm run dev
ALTER TABLE proyectos ADD COLUMN IF NOT EXISTS puerto      INTEGER;                    -- se inyecta como PORT
ALTER TABLE proyectos ADD COLUMN IF NOT EXISTS url_salud   TEXT;                       -- ej. http://localhost:4000/api/salud
ALTER TABLE proyectos ADD COLUMN IF NOT EXISTS env_extra   JSONB NOT NULL DEFAULT '{}';
ALTER TABLE proyectos ADD COLUMN IF NOT EXISTS autoarranque BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS procesos (
  proyecto_id   UUID PRIMARY KEY REFERENCES proyectos(id) ON DELETE CASCADE,
  pid           INTEGER,
  estado        TEXT NOT NULL DEFAULT 'detenido',   -- corriendo | detenido | caido
  ruta_trabajo  TEXT,                               -- repo real o sandbox
  comando       TEXT,
  ruta_log      TEXT,
  inicio        TIMESTAMPTZ,
  fin           TIMESTAMPTZ,
  codigo_salida INTEGER,
  reinicios     INTEGER NOT NULL DEFAULT 0,
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);