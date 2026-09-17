-- Esquema de Emilia. Ejecutar con: npm run migrate
-- Filosofía: columnas propias para lo que se consulta/filtra seguido
-- (nombre, tipo, estado); las piezas complejas van en JSONB para poder
-- crecer sin migrar la base cada vez que agregamos un campo.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS agentes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre        TEXT NOT NULL,
  tipo          TEXT NOT NULL DEFAULT 'trabajo',   -- trabajo | administrador | companero
  estado        TEXT NOT NULL DEFAULT 'en_pruebas' CHECK (estado IN ('activo','pausado','en_pruebas')),

  -- Cada pieza compleja del esqueleto = un JSONB. Flexible y a prueba de futuro.
  identidad     JSONB NOT NULL DEFAULT '{}',
  cerebro       JSONB NOT NULL DEFAULT '{}',
  memoria       JSONB NOT NULL DEFAULT '{}',
  planeamiento  JSONB NOT NULL DEFAULT '{}',
  descomposicion JSONB NOT NULL DEFAULT '{}',
  autocorreccion JSONB NOT NULL DEFAULT '{}',
  reflexion     JSONB NOT NULL DEFAULT '{}',
  pensar_voz_alta JSONB NOT NULL DEFAULT '{}',
  subagentes    JSONB NOT NULL DEFAULT '{}',
  escalamiento  JSONB NOT NULL DEFAULT '{}',
  limites       JSONB NOT NULL DEFAULT '{}',
  trazas        JSONB NOT NULL DEFAULT '{}',

  -- Las listas (skills, tools, flujos, etc.) se guardan como arrays JSON
  -- con los nombres/ids que el agente tiene asignados.
  skills        JSONB NOT NULL DEFAULT '[]',
  tools         JSONB NOT NULL DEFAULT '[]',
  conocimiento  JSONB NOT NULL DEFAULT '[]',
  flujos        JSONB NOT NULL DEFAULT '[]',
  gobierno      JSONB NOT NULL DEFAULT '{}',      -- acciones + config extra
  disparadores  JSONB NOT NULL DEFAULT '[]',
  canales       JSONB NOT NULL DEFAULT '[]',

  creado_en     TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agentes_estado ON agentes(estado);
CREATE INDEX IF NOT EXISTS idx_agentes_tipo ON agentes(tipo);

-- Posición en el lienzo de "Ver agentes".
DO $$ BEGIN
  ALTER TABLE agentes ADD COLUMN IF NOT EXISTS pos_x INTEGER;
  ALTER TABLE agentes ADD COLUMN IF NOT EXISTS pos_y INTEGER;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- Mensajes del chat con cada agente (el historial de su conversación).
CREATE TABLE IF NOT EXISTS mensajes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agente_id   UUID NOT NULL REFERENCES agentes(id) ON DELETE CASCADE,
  rol         TEXT NOT NULL CHECK (rol IN ('usuario','agente','pensamiento','sistema')),
  contenido   TEXT NOT NULL,
  creado_en   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mensajes_agente ON mensajes(agente_id, creado_en);

-- Ejecuciones: cada vez que el agente corre una tarea.
CREATE TABLE IF NOT EXISTS ejecuciones (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agente_id     UUID NOT NULL REFERENCES agentes(id) ON DELETE CASCADE,
  estado        TEXT NOT NULL DEFAULT 'en_curso' CHECK (estado IN ('en_curso','completada','fallida')),
  plan          TEXT,
  turnos_usados INTEGER NOT NULL DEFAULT 0,
  tool_calls    INTEGER NOT NULL DEFAULT 0,
  inicio        TIMESTAMPTZ NOT NULL DEFAULT now(),
  fin           TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_ejecuciones_agente ON ejecuciones(agente_id, inicio DESC);

-- Pasos de una ejecución (razonamiento, tool calls, verificación).
CREATE TABLE IF NOT EXISTS pasos (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ejecucion_id  UUID NOT NULL REFERENCES ejecuciones(id) ON DELETE CASCADE,
  tipo          TEXT NOT NULL,   -- pensamiento | tool | verificacion | plan | error
  detalle       TEXT,
  creado_en     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pasos_ejecucion ON pasos(ejecucion_id, creado_en);

-- Documentos / base de conocimiento de cada agente (estilo proyecto de Claude).
-- Guardamos el contenido de texto directo en la base para poder inyectarlo
-- como contexto. Para archivos binarios grandes se guardaría la ruta, pero
-- para notas/txt/md (el caso principal) el texto en la base es lo más simple.
CREATE TABLE IF NOT EXISTS documentos (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agente_id   UUID NOT NULL REFERENCES agentes(id) ON DELETE CASCADE,
  nombre      TEXT NOT NULL,
  tipo        TEXT,                    -- md, txt, csv, etc.
  contenido   TEXT NOT NULL DEFAULT '',
  tam_bytes   INTEGER NOT NULL DEFAULT 0,
  creado_en   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_documentos_agente ON documentos(agente_id, creado_en);

-- Biblioteca de skills reutilizables. La config detallada (8 secciones) va
-- en JSONB, igual que las piezas del agente — flexible y a prueba de futuro.
CREATE TABLE IF NOT EXISTS skills (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre        TEXT NOT NULL UNIQUE,
  descripcion   TEXT NOT NULL DEFAULT '',
  nivel_riesgo  TEXT NOT NULL DEFAULT 'lectura',
  secciones     JSONB NOT NULL DEFAULT '{}',
  creado_en     TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Biblioteca de tools (conexiones a sistemas). Config detallada en JSONB.
CREATE TABLE IF NOT EXISTS tools (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre        TEXT NOT NULL UNIQUE,
  descripcion   TEXT NOT NULL DEFAULT '',
  tipo          TEXT NOT NULL DEFAULT 'api_rest',
  estado_prueba TEXT NOT NULL DEFAULT 'sin_probar',
  secciones     JSONB NOT NULL DEFAULT '{}',
  capacidades   JSONB,
  creado_en     TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Flujos de trabajo: el diagrama (nodos + conexiones) va en JSONB.
CREATE TABLE IF NOT EXISTS flujos (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre        TEXT NOT NULL,
  definicion    JSONB NOT NULL DEFAULT '{}',
  creado_en     TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Cada vez que se corre un flujo.
CREATE TABLE IF NOT EXISTS flujo_ejecuciones (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flujo_id      UUID NOT NULL REFERENCES flujos(id) ON DELETE CASCADE,
  agente_id     UUID REFERENCES agentes(id) ON DELETE SET NULL,
  estado        TEXT NOT NULL DEFAULT 'en_curso' CHECK (estado IN ('en_curso','esperando_aprobacion','completado','fallido')),
  nodo_actual   TEXT,
  contexto      JSONB NOT NULL DEFAULT '{}',
  log           JSONB NOT NULL DEFAULT '[]',
  inicio        TIMESTAMPTZ NOT NULL DEFAULT now(),
  fin           TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_flujoej_estado ON flujo_ejecuciones(estado);

-- Aprobaciones pendientes (de flujos o de skills que las requieren).
CREATE TABLE IF NOT EXISTS aprobaciones (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ejecucion_id  UUID REFERENCES flujo_ejecuciones(id) ON DELETE CASCADE,
  agente_id     UUID REFERENCES agentes(id) ON DELETE SET NULL,
  titulo        TEXT NOT NULL,
  detalle       TEXT,
  estado        TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','aprobada','rechazada')),
  nodo_id       TEXT,
  creado_en     TIMESTAMPTZ NOT NULL DEFAULT now(),
  resuelto_en   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_aprob_estado ON aprobaciones(estado, creado_en);