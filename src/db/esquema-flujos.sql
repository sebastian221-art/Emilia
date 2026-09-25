-- ARCHIVO: src/db/esquema-flujos.sql
-- ─────────────────────────────────────────────────────────────────────────────
--  ESQUEMA DEL MOTOR DE FLUJOS (Fase 4). Se aplica después de esquema-motor.sql.
--  flujo_ejecuciones pasa a soportar: esperas persistidas, sub-flujos con
--  retorno al padre, argumentos, resultado, y entrega a una conversación.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE flujo_ejecuciones ADD COLUMN IF NOT EXISTS nombre_flujo    TEXT;
ALTER TABLE flujo_ejecuciones ADD COLUMN IF NOT EXISTS args            JSONB NOT NULL DEFAULT '{}';
ALTER TABLE flujo_ejecuciones ADD COLUMN IF NOT EXISTS resultado       JSONB;
ALTER TABLE flujo_ejecuciones ADD COLUMN IF NOT EXISTS despertar_en    TIMESTAMPTZ;           -- para pasos 'esperar' persistidos
ALTER TABLE flujo_ejecuciones ADD COLUMN IF NOT EXISTS padre_id        UUID REFERENCES flujo_ejecuciones(id) ON DELETE SET NULL;
ALTER TABLE flujo_ejecuciones ADD COLUMN IF NOT EXISTS paso_padre      TEXT;                  -- id del paso 'subflujo' en el padre
ALTER TABLE flujo_ejecuciones ADD COLUMN IF NOT EXISTS conversacion_id UUID REFERENCES conversaciones(id) ON DELETE SET NULL;
ALTER TABLE flujo_ejecuciones ADD COLUMN IF NOT EXISTS origen          TEXT NOT NULL DEFAULT 'api';   -- api | agente | panel | subflujo
ALTER TABLE flujo_ejecuciones ADD COLUMN IF NOT EXISTS error           TEXT;

ALTER TABLE flujo_ejecuciones DROP CONSTRAINT IF EXISTS flujo_ejecuciones_estado_check;
ALTER TABLE flujo_ejecuciones ADD CONSTRAINT flujo_ejecuciones_estado_check
  CHECK (estado IN ('en_curso','esperando_aprobacion','esperando','esperando_subflujo','completado','fallido'));

CREATE INDEX IF NOT EXISTS idx_flujoej_despertar ON flujo_ejecuciones(estado, despertar_en);
CREATE INDEX IF NOT EXISTS idx_flujoej_padre ON flujo_ejecuciones(padre_id);