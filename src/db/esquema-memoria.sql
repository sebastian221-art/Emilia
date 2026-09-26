-- ARCHIVO: src/db/esquema-memoria.sql
-- Memoria de largo plazo (Fase 12.1): hechos durables sobre el jefe y su mundo,
-- compartidos entre agentes y conversaciones. Se extraen solos y se pueden
-- editar/borrar por chat.
CREATE TABLE IF NOT EXISTS memoria_largo_plazo (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sujeto          TEXT NOT NULL DEFAULT 'jefe',      -- jefe | sistema | <nombre de otra persona/proyecto>
  clave           TEXT NOT NULL,                     -- slug corto: vive_en, prefiere_respuestas_cortas, proyecto_jelcom
  contenido       TEXT NOT NULL,                     -- el hecho, en una frase
  categoria       TEXT NOT NULL DEFAULT 'general',   -- personal | preferencia | trabajo | proyecto | persona | decision | general
  confianza       REAL NOT NULL DEFAULT 0.8,
  fuente          TEXT,                              -- 'dicho' (el jefe lo dijo) | 'inferido' | 'manual'
  conversacion_id UUID,
  agente_id       UUID,
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (sujeto, clave)
);
CREATE INDEX IF NOT EXISTS idx_mlp_sujeto ON memoria_largo_plazo(sujeto, actualizado_en DESC);

-- Cursor de extracción por conversación (para no re-leer lo mismo).
ALTER TABLE conversaciones ADD COLUMN IF NOT EXISTS memoria_extraida_hasta TIMESTAMPTZ;