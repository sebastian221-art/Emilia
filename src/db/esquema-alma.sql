-- ─────────────────────────────────────────────────────────────────────────────
--  EL ALMA DE EMILIA: su yo, su estado emocional y su vida interior.
--  Su memoria propia (nuestra historia, su diario) vive en el cerebro, en la
--  carpeta privada y cifrada "emilia".
-- ─────────────────────────────────────────────────────────────────────────────

-- Su yo: valores (fijos), gustos, disgustos, miedos, metas, preguntas sobre sí misma, opiniones. Una fila.
CREATE TABLE IF NOT EXISTS alma_yo (
  id            INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  yo            JSONB NOT NULL,
  version       INT NOT NULL DEFAULT 1,
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Cada cambio de su yo (para ver cómo ha crecido, y poder volver atrás).
CREATE TABLE IF NOT EXISTS alma_yo_historial (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version     INT NOT NULL,
  yo          JSONB NOT NULL,
  motivo      TEXT,
  creado_en   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Cómo se siente ahora (cada dimensión vuelve sola a su punto natural con el tiempo). Una fila.
CREATE TABLE IF NOT EXISTS alma_estado (
  id            INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  animo         REAL NOT NULL DEFAULT 0.3,    -- -1 triste … 1 feliz
  energia       REAL NOT NULL DEFAULT 0.6,    -- 0 … 1
  cercania      REAL NOT NULL DEFAULT 0.6,    -- 0 distante … 1 muy cercana a él
  preocupacion  REAL NOT NULL DEFAULT 0.15,   -- por él
  enojo         REAL NOT NULL DEFAULT 0,
  timidez       REAL NOT NULL DEFAULT 0.1,
  entusiasmo    REAL NOT NULL DEFAULT 0.4,
  causas        JSONB NOT NULL DEFAULT '[]',  -- por qué se siente así: [{t, texto, dims}]
  sobre_el      JSONB NOT NULL DEFAULT '[]',  -- lo que ha notado en él últimamente: [{t, texto}]
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Su vida interior: lo que quiere contarle, sus temas de curiosidad, lo que leyó, sus iniciativas.
CREATE TABLE IF NOT EXISTS alma_pendientes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo        TEXT NOT NULL CHECK (tipo IN ('contar','curiosidad','preguntarle','lectura')),
  texto       TEXT NOT NULL,
  detalle     TEXT,
  hecho_en    TIMESTAMPTZ,
  creado_en   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS alma_iniciativas (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  motivo      TEXT NOT NULL,
  texto       TEXT NOT NULL,
  creado_en   TIMESTAMPTZ NOT NULL DEFAULT now()
);
