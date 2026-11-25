-- ─────────────────────────────────────────────────────────────────────────────
--  SEGURIDAD
--  · ejecuciones.contaminada: la ejecución leyó contenido externo (correo, web,
--    tercero…); desde ahí toda acción hacia afuera pide OK.
--  · gasto_global: lo que se gastó en modelos por día (tope GASTO_DIARIO_MAX).
--  · ritmo_terceros: mensajes de terceros por número (límite anti-spam).
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE ejecuciones ADD COLUMN IF NOT EXISTS contaminada TEXT;

CREATE TABLE IF NOT EXISTS seguridad_eventos (
  id         BIGSERIAL PRIMARY KEY,
  tipo       TEXT NOT NULL,            -- csrf | host | ritmo | contaminacion | gasto | secreto
  detalle    TEXT NOT NULL,
  creado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_seguridad_eventos_fecha ON seguridad_eventos (creado_en DESC);

-- La misión nace contaminada si la creó una tarea que había leído contenido externo.
ALTER TABLE misiones ADD COLUMN IF NOT EXISTS contaminada TEXT;
