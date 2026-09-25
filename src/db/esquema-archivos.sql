-- ARCHIVO: src/db/esquema-archivos.sql
-- Archivos que entran (adjuntos de WhatsApp) o se generan (informes). El
-- contenido va a disco en DATA_DIR/archivos; acá la metadata. Los agentes los
-- referencian por archivo_id.
CREATE TABLE IF NOT EXISTS archivos (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversacion_id UUID REFERENCES conversaciones(id) ON DELETE SET NULL,
  agente_id       UUID REFERENCES agentes(id) ON DELETE SET NULL,
  nombre          TEXT NOT NULL,
  mime            TEXT NOT NULL DEFAULT 'application/octet-stream',
  tam_bytes       INTEGER NOT NULL DEFAULT 0,
  ruta            TEXT NOT NULL,                 -- ruta absoluta en disco
  origen          TEXT NOT NULL DEFAULT 'whatsapp',   -- whatsapp | generado | panel
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_archivos_conv ON archivos(conversacion_id, creado_en DESC);