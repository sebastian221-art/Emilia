-- ARCHIVO: src/db/esquema-codigo.sql
-- ─────────────────────────────────────────────────────────────────────────────
--  ESQUEMA DEL SENIOR DEVELOPER (Fase 7.1)
--  proyectos: repos registrados. sandboxes: worktrees aislados por tarea.
--  sesiones_codigo: cada corrida de Claude Code, con su log en vivo.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS proyectos (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre      TEXT NOT NULL UNIQUE,            -- slug: emilia, jelcom_envios
  ruta        TEXT NOT NULL,                   -- ruta absoluta del repo real
  rama_base   TEXT NOT NULL DEFAULT 'main',
  cmd_install TEXT,                            -- ej. npm install
  cmd_test    TEXT,                            -- ej. npm test
  cmd_build   TEXT,                            -- ej. npm run build
  cmd_lint    TEXT,
  notas       TEXT NOT NULL DEFAULT '',        -- lo que el Senior debe saber del proyecto
  creado_en   TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sandboxes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proyecto_id UUID NOT NULL REFERENCES proyectos(id) ON DELETE CASCADE,
  ruta        TEXT NOT NULL,                   -- worktree
  rama        TEXT NOT NULL,
  estado      TEXT NOT NULL DEFAULT 'abierto', -- abierto | cerrado
  proposito   TEXT NOT NULL DEFAULT '',
  creado_en   TIMESTAMPTZ NOT NULL DEFAULT now(),
  cerrado_en  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_sandboxes_proy ON sandboxes(proyecto_id, estado);

CREATE TABLE IF NOT EXISTS sesiones_codigo (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sandbox_id        UUID NOT NULL REFERENCES sandboxes(id) ON DELETE CASCADE,
  proyecto_id       UUID NOT NULL REFERENCES proyectos(id) ON DELETE CASCADE,
  encargo           TEXT NOT NULL,             -- el prompt que se le dio
  estado            TEXT NOT NULL DEFAULT 'en_curso',   -- en_curso | completada | fallida | cancelada
  session_id_claude TEXT,                      -- para --resume
  pid               INTEGER,
  log               JSONB NOT NULL DEFAULT '[]',
  resultado         TEXT,                      -- texto final de Claude Code
  error             TEXT,
  costo_usd         NUMERIC(10,4),
  turnos            INTEGER,
  duracion_ms       INTEGER,
  agente_id         UUID REFERENCES agentes(id) ON DELETE SET NULL,
  conversacion_id   UUID REFERENCES conversaciones(id) ON DELETE SET NULL,
  inicio            TIMESTAMPTZ NOT NULL DEFAULT now(),
  fin               TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_sesiones_sandbox ON sesiones_codigo(sandbox_id, inicio DESC);
CREATE INDEX IF NOT EXISTS idx_sesiones_estado ON sesiones_codigo(estado);