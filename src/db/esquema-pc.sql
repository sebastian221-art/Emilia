-- ARCHIVO: src/db/esquema-pc.sql
-- Uso del computador con Claude: perfiles (qué puede tocar) y sesiones (qué hizo).
CREATE TABLE IF NOT EXISTS pc_perfiles (
  nombre          TEXT PRIMARY KEY,
  config          JSONB NOT NULL,
  actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pc_sesiones (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  perfil          TEXT NOT NULL,
  objetivo        TEXT NOT NULL,
  estado          TEXT NOT NULL DEFAULT 'corriendo',
  modelo          TEXT,
  pasos           INT NOT NULL DEFAULT 0,
  comandos        JSONB NOT NULL DEFAULT '[]',   -- comandos de terminal ejecutados (texto + aprobación)
  costo_usd       NUMERIC(10,4) NOT NULL DEFAULT 0,
  carpeta         TEXT,                          -- capturas y bitácora (en el PC, se borran a los PC_SESIONES_DIAS)
  resumen         TEXT,
  pregunta        TEXT,
  agente_id       UUID,
  conversacion_id UUID,
  inicio          TIMESTAMPTZ NOT NULL DEFAULT now(),
  fin             TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_pc_sesiones_inicio ON pc_sesiones (inicio DESC);
