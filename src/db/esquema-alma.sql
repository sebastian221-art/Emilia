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

-- ── Emilia administradora ──
-- Encargos: todo lo que delega, con su estado y resultado.
CREATE TABLE IF NOT EXISTS encargos (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agente          TEXT NOT NULL,
  tarea           TEXT NOT NULL,
  conv_padre      UUID,
  conv_delegacion UUID,
  ejecucion_id    UUID,
  mision_id       UUID,
  paso            INT,
  estado          TEXT NOT NULL DEFAULT 'en_curso' CHECK (estado IN ('en_curso','esperando_jefe','hecho','fallido','cancelado','reintentado')),
  resultado       TEXT,
  intentos        INT NOT NULL DEFAULT 0,
  avisado_demora  BOOLEAN NOT NULL DEFAULT false,
  terminado_en    TIMESTAMPTZ,
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_encargos_estado ON encargos (estado, creado_en DESC);
CREATE INDEX IF NOT EXISTS idx_encargos_mision ON encargos (mision_id);
-- Misiones: un pedido grande, varios agentes, pasos con dependencias, una respuesta final.
CREATE TABLE IF NOT EXISTS misiones (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  objetivo       TEXT NOT NULL,
  pasos          JSONB NOT NULL,
  estado         TEXT NOT NULL DEFAULT 'en_curso' CHECK (estado IN ('en_curso','hecha','atascada','cancelada')),
  conv_padre     UUID,
  final          TEXT,
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Una sola voz: los avisos no urgentes esperan al resumen.
ALTER TABLE avisos_diferidos ADD COLUMN IF NOT EXISTS digesto BOOLEAN NOT NULL DEFAULT false;
-- Reparto: cuando el jefe corrige a quién iba un pedido, se aprende.
CREATE TABLE IF NOT EXISTS reparto_correcciones (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  texto      TEXT NOT NULL,
  agente     TEXT NOT NULL,
  antes      TEXT,
  creado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);
