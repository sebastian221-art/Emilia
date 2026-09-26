-- ARCHIVO: src/db/esquema-eventos.sql
-- Disparadores (Fase 12.2): cosas que pasan → acciones que arrancan solas.
CREATE TABLE IF NOT EXISTS disparadores (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre         TEXT NOT NULL UNIQUE,                 -- slug
  descripcion    TEXT NOT NULL DEFAULT '',
  tipo           TEXT NOT NULL,                        -- webhook | cron | evento
  config         JSONB NOT NULL DEFAULT '{}',          -- webhook:{token?,secreto?} cron:{expresion|cada_minutos} evento:{patron}
  accion         JSONB NOT NULL,                       -- {tipo:'flujo'|'skill'|'agente', nombre, args?, instruccion?}
  agente_id      UUID REFERENCES agentes(id) ON DELETE SET NULL,
  estado         TEXT NOT NULL DEFAULT 'activo',       -- activo | pausado
  ultimo_disparo TIMESTAMPTZ,
  veces          INTEGER NOT NULL DEFAULT 0,
  ultimo_resultado TEXT,
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS eventos (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre    TEXT NOT NULL,
  datos     JSONB NOT NULL DEFAULT '{}',
  origen    TEXT NOT NULL DEFAULT 'sistema',           -- sistema | webhook | manual | cron
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_eventos_nombre ON eventos(nombre, creado_en DESC);