-- ─────────────────────────────────────────────────────────────────────────────
--  SOGA — buscador e investigadora
-- ─────────────────────────────────────────────────────────────────────────────
-- Caché de búsquedas y lecturas (dura según qué tan fresco tiene que ser el dato).
CREATE TABLE IF NOT EXISTS web_cache (
  clave     text PRIMARY KEY,
  datos     jsonb NOT NULL,
  vence     timestamptz NOT NULL,
  creado_en timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS web_cache_vence ON web_cache (vence);
-- Uso por día y motor (para el tope diario de la búsqueda de Claude y el informe de costos).
CREATE TABLE IF NOT EXISTS web_uso (
  dia      date NOT NULL,
  motor    text NOT NULL,
  n        integer NOT NULL DEFAULT 0,
  fallos   integer NOT NULL DEFAULT 0,
  costo    numeric(10,4) NOT NULL DEFAULT 0,
  PRIMARY KEY (dia, motor)
);
-- Texto extraído de los archivos (PDF, Word, Excel…) para poder buscar dentro de ellos.
ALTER TABLE archivos ADD COLUMN IF NOT EXISTS texto TEXT;
ALTER TABLE archivos ADD COLUMN IF NOT EXISTS indexado_en TIMESTAMPTZ;
-- Historial de investigaciones de Soga (qué se preguntó, qué se respondió, con qué fuentes y certeza).
CREATE TABLE IF NOT EXISTS soga_investigaciones (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pregunta    TEXT NOT NULL,
  respuesta   TEXT NOT NULL,
  profundidad TEXT,
  fuentes     JSONB NOT NULL DEFAULT '[]',   -- [{url, titulo, fecha}]
  certeza     TEXT,                         -- alta | media | baja
  agente_id   UUID,
  archivo_id  UUID,                         -- informe en PDF, si se hizo
  costo_usd   NUMERIC(10,4),
  creado_en   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS soga_investigaciones_fecha ON soga_investigaciones (creado_en DESC);
-- ── Radar: la curiosidad de Emilia ──────────────────────────────────────────
-- Qué vigila Soga en el mundo (temas, repos, modelos, contratos, proyectos).
CREATE TABLE IF NOT EXISTS radar_temas (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre     TEXT NOT NULL UNIQUE,
  tipo       TEXT NOT NULL CHECK (tipo IN ('tema','repos','versiones','modelos','secop','proyectos')),
  config     JSONB NOT NULL DEFAULT '{}',  -- {consultas:[…]} | {repos:[…]} | {textos:[…], departamento} | {modelos:[…]}
  frecuencia TEXT NOT NULL DEFAULT 'diario' CHECK (frecuencia IN ('diario','semanal')),
  activo     BOOLEAN NOT NULL DEFAULT true,
  ultimo     TIMESTAMPTZ,
  creado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Lo que ya se vio (para no repetir) con su relevancia y qué se hizo.
CREATE TABLE IF NOT EXISTS radar_vistos (
  clave      TEXT PRIMARY KEY,             -- url, id de modelo, repo@tag, proceso SECOP…
  tema       TEXT,
  titulo     TEXT,
  url        TEXT,
  resumen    TEXT,
  fecha      TEXT,
  datos      JSONB NOT NULL DEFAULT '{}',  -- p. ej. precio de un modelo (para notar cambios)
  relevancia INT,                          -- 0..10 según el perfil del jefe
  porque     TEXT,
  destino    TEXT,                         -- avisado | resumen | biblioteca | descartado | pendiente
  visto_en   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS radar_vistos_fecha ON radar_vistos (visto_en DESC);
-- Herramientas de GitHub que Soga encontró y auditó (y qué pasó con ellas).
CREATE TABLE IF NOT EXISTS herramientas_evaluadas (
  repo         TEXT PRIMARY KEY,
  url          TEXT,
  necesidad    TEXT,
  veredicto    TEXT NOT NULL,          -- recomendable | con_cuidado | no_recomendable
  puntaje      INT,                    -- 0..100
  hallazgos    JSONB NOT NULL DEFAULT '[]',
  resumen      TEXT,
  integracion  TEXT,
  estado       TEXT NOT NULL DEFAULT 'evaluada',  -- evaluada | probando | probada | integrada | descartada
  evaluado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);
