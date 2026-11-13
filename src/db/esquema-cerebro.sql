-- ─────────────────────────────────────────────────────────────────────────────
--  CEREBRO COMPARTIDO — la biblioteca se vuelve la memoria de todo el equipo.
--  Cada recuerdo es un nodo de bib_nodos con:
--    espacio: 'general' | 'personal' | 'proyecto:<slug>'  (carpetas)
--    clase:   conocimiento | hecho | episodio | procedimiento | persona |
--             perfil | leccion | capacidad | resumen
--  Búsqueda: por significado (pgvector si está; si no, vectores en arreglo)
--  + por palabras (tsvector) + activación de vecinos en la red.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE bib_nodos ADD COLUMN IF NOT EXISTS espacio      TEXT NOT NULL DEFAULT 'general';
ALTER TABLE bib_nodos ADD COLUMN IF NOT EXISTS clase        TEXT NOT NULL DEFAULT 'conocimiento';
ALTER TABLE bib_nodos ADD COLUMN IF NOT EXISTS importancia  REAL NOT NULL DEFAULT 0.5;   -- 0..1: qué tan clave es
ALTER TABLE bib_nodos ADD COLUMN IF NOT EXISTS ocurrio_en   TIMESTAMPTZ;                 -- episodios: cuándo pasó
ALTER TABLE bib_nodos ADD COLUMN IF NOT EXISTS vigente_hasta TIMESTAMPTZ;                -- hechos que caducan
ALTER TABLE bib_nodos ADD COLUMN IF NOT EXISTS origen_ref   TEXT;                        -- conversacion:<id>, correo:<id>, incidente:<id>…
ALTER TABLE bib_nodos ADD COLUMN IF NOT EXISTS emb_version  TEXT;                        -- con qué modelo se hizo el vector
ALTER TABLE bib_nodos ADD COLUMN IF NOT EXISTS privado      BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE bib_nodos ADD COLUMN IF NOT EXISTS cifrado      BYTEA;                       -- contenido personal cifrado (AES-256-GCM)
ALTER TABLE bib_nodos ADD COLUMN IF NOT EXISTS busqueda     TSVECTOR;
CREATE INDEX IF NOT EXISTS idx_bib_nodos_espacio ON bib_nodos (espacio, clase) WHERE borrado_en IS NULL;
CREATE INDEX IF NOT EXISTS idx_bib_nodos_busqueda ON bib_nodos USING GIN (busqueda);

-- Texto de búsqueda sin tildes (sin depender de la extensión unaccent).
CREATE OR REPLACE FUNCTION cerebro_norm(t TEXT) RETURNS TEXT LANGUAGE sql IMMUTABLE AS
$$ SELECT translate(lower(coalesce(t, '')), 'áéíóúüàèìòùâêîôûäëïöñ', 'aeiouuaeiouaeiouaeioñ') $$;
CREATE OR REPLACE FUNCTION cerebro_busqueda() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.busqueda := setweight(to_tsvector('simple', cerebro_norm(NEW.titulo)), 'A')
               || setweight(to_tsvector('simple', cerebro_norm(array_to_string(NEW.etiquetas, ' '))), 'B')
               || setweight(to_tsvector('simple', cerebro_norm(CASE WHEN NEW.privado THEN '' ELSE NEW.resumen END)), 'C');
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_cerebro_busqueda ON bib_nodos;
CREATE TRIGGER trg_cerebro_busqueda BEFORE INSERT OR UPDATE OF titulo, resumen, etiquetas, privado ON bib_nodos FOR EACH ROW EXECUTE FUNCTION cerebro_busqueda();
UPDATE bib_nodos SET titulo = titulo WHERE busqueda IS NULL;

-- pgvector: búsqueda por significado en milisegundos aunque haya millones de recuerdos.
-- Si la extensión no está instalada, el cerebro funciona igual con el arreglo `embedding`.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS vector;
  ALTER TABLE bib_nodos ADD COLUMN IF NOT EXISTS vec vector(384);
  CREATE INDEX IF NOT EXISTS idx_bib_nodos_vec ON bib_nodos USING hnsw (vec vector_cosine_ops);
EXCEPTION WHEN others THEN
  RAISE NOTICE 'pgvector no está instalado: el cerebro usa la búsqueda de respaldo (más lenta con mucho contenido).';
END $$;

-- Carpetas (espacios) con su resumen: el agente lee primero el resumen y baja al detalle si lo necesita.
CREATE TABLE IF NOT EXISTS bib_espacios (
  slug           TEXT PRIMARY KEY,               -- general | personal | proyecto:jelcom_envios
  nombre         TEXT NOT NULL,
  tipo           TEXT NOT NULL DEFAULT 'proyecto' CHECK (tipo IN ('general','personal','proyecto')),
  descripcion    TEXT,
  resumen        TEXT,                           -- lo esencial de la carpeta (lo mantiene Lara)
  proyecto       TEXT,                           -- nombre del proyecto registrado (codigo_*), si aplica
  resumen_en     TIMESTAMPTZ,
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO bib_espacios (slug, nombre, tipo, descripcion) VALUES
  ('general', 'General', 'general', 'Lo que sirve a todo el equipo: tecnologías, herramientas, lecciones, cómo trabaja el jefe.'),
  ('personal', 'Personal de Sebastián', 'personal', 'Su vida, relaciones, metas, problemas, logros y cosas a mejorar. Privado: solo para quien lo atiende a él.')
ON CONFLICT (slug) DO NOTHING;
