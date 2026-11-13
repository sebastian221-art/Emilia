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
