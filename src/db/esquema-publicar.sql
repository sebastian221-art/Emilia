-- ARCHIVO: src/db/esquema-publicar.sql
-- Proyectos que Sage creó, subió a GitHub y desplegó en Railway.
CREATE TABLE IF NOT EXISTS despliegues (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre          TEXT NOT NULL UNIQUE,
  carpeta         TEXT NOT NULL,
  repo            TEXT,            -- owner/nombre en GitHub
  rama            TEXT NOT NULL DEFAULT 'main',
  railway_proyecto TEXT,
  railway_servicio TEXT,
  railway_entorno  TEXT,
  url             TEXT,
  estado          TEXT,            -- último estado del despliegue (SUCCESS, FAILED, BUILDING…)
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);
