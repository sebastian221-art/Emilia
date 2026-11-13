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
