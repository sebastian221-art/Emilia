-- ARCHIVO: src/db/esquema-motor.sql
-- ─────────────────────────────────────────────────────────────────────────────
--  ESQUEMA DEL MOTOR (Fase 2). Se aplica después de esquema-registro.sql.
--  Conversaciones por canal+contacto, ejecuciones pausables/reanudables,
--  aprobaciones de tools, dedup persistente de WhatsApp. Idempotente.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Conversaciones: una por (agente, canal, contacto) ──
CREATE TABLE IF NOT EXISTS conversaciones (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agente_id         UUID NOT NULL REFERENCES agentes(id) ON DELETE CASCADE,
  canal             TEXT NOT NULL,                 -- 'panel' | 'whatsapp'
  contacto          TEXT NOT NULL,                 -- 'panel' o el número (solo dígitos)
  titulo            TEXT NOT NULL DEFAULT '',
  resumen           TEXT NOT NULL DEFAULT '',      -- memoria comprimida de lo viejo
  resumen_hasta     TIMESTAMPTZ,                   -- los mensajes anteriores a esto ya están en el resumen
  ultimo_mensaje_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  creado_en         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (agente_id, canal, contacto)
);
CREATE INDEX IF NOT EXISTS idx_conv_agente ON conversaciones(agente_id, ultimo_mensaje_en DESC);

-- ── mensajes: ahora cuelgan de una conversación ──
ALTER TABLE mensajes ADD COLUMN IF NOT EXISTS conversacion_id UUID REFERENCES conversaciones(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_mensajes_conv ON mensajes(conversacion_id, creado_en);

-- Backfill: los mensajes viejos del panel van a la conversación 'panel' del
-- agente; los marcados "[WhatsApp de N]" van a la conversación de ese número.
INSERT INTO conversaciones (agente_id, canal, contacto, titulo)
  SELECT DISTINCT agente_id, 'panel', 'panel', 'Chat del panel'
  FROM mensajes WHERE conversacion_id IS NULL AND contenido !~ '^\[WhatsApp de '
ON CONFLICT DO NOTHING;
INSERT INTO conversaciones (agente_id, canal, contacto, titulo)
  SELECT DISTINCT agente_id, 'whatsapp', substring(contenido from '^\[WhatsApp de (\d+)\]'),
         'WhatsApp ' || substring(contenido from '^\[WhatsApp de (\d+)\]')
  FROM mensajes WHERE conversacion_id IS NULL AND contenido ~ '^\[WhatsApp de \d+\]'
ON CONFLICT DO NOTHING;
UPDATE mensajes m SET conversacion_id = c.id
FROM conversaciones c
WHERE m.conversacion_id IS NULL AND c.agente_id = m.agente_id AND (
  (m.contenido ~ '^\[WhatsApp de \d+\]' AND c.canal = 'whatsapp' AND c.contacto = substring(m.contenido from '^\[WhatsApp de (\d+)\]'))
  OR (m.contenido !~ '^\[WhatsApp de ' AND c.canal = 'panel')
);

-- ── ejecuciones: pausables y reanudables ──
ALTER TABLE ejecuciones ADD COLUMN IF NOT EXISTS conversacion_id   UUID REFERENCES conversaciones(id) ON DELETE SET NULL;
ALTER TABLE ejecuciones ADD COLUMN IF NOT EXISTS origen            TEXT NOT NULL DEFAULT 'panel';   -- panel | whatsapp | flujo | api
ALTER TABLE ejecuciones ADD COLUMN IF NOT EXISTS mensajes          JSONB;                            -- el hilo completo con el modelo (para reanudar)
ALTER TABLE ejecuciones ADD COLUMN IF NOT EXISTS pendientes        JSONB NOT NULL DEFAULT '[]';      -- tool calls del turno actual sin procesar
ALTER TABLE ejecuciones ADD COLUMN IF NOT EXISTS mensajes_enviados JSONB NOT NULL DEFAULT '[]';
ALTER TABLE ejecuciones ADD COLUMN IF NOT EXISTS respuesta         TEXT;
ALTER TABLE ejecuciones DROP CONSTRAINT IF EXISTS ejecuciones_estado_check;
ALTER TABLE ejecuciones ADD CONSTRAINT ejecuciones_estado_check
  CHECK (estado IN ('en_curso','esperando_aprobacion','completada','fallida'));
CREATE INDEX IF NOT EXISTS idx_ejecuciones_estado ON ejecuciones(estado);

-- ── aprobaciones: ahora también de tools (no solo de flujos) ──
ALTER TABLE aprobaciones ADD COLUMN IF NOT EXISTS tipo                TEXT NOT NULL DEFAULT 'flujo';  -- 'flujo' | 'tool'
ALTER TABLE aprobaciones ADD COLUMN IF NOT EXISTS agente_ejecucion_id UUID REFERENCES ejecuciones(id) ON DELETE CASCADE;
ALTER TABLE aprobaciones ADD COLUMN IF NOT EXISTS conversacion_id     UUID REFERENCES conversaciones(id) ON DELETE SET NULL;
ALTER TABLE aprobaciones ADD COLUMN IF NOT EXISTS tool                TEXT;
ALTER TABLE aprobaciones ADD COLUMN IF NOT EXISTS args                JSONB;
CREATE INDEX IF NOT EXISTS idx_aprob_conv ON aprobaciones(conversacion_id, estado);

-- ── WhatsApp: dedup persistente (Meta reintenta entregas, y el proceso se reinicia) ──
CREATE TABLE IF NOT EXISTS whatsapp_vistos (
  wa_id     TEXT PRIMARY KEY,
  visto_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);