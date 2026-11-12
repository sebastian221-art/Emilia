-- ARCHIVO: src/db/esquema-jelcom.sql
-- ─────────────────────────────────────────────────────────────────────────────
--  PERFILES DE CLIENTE (Echo): lo que usó cada campaña de Jelcom la última vez
--  por canal (cuenta, plantilla, idioma, imagen, asunto, voz…). Echo lo usa para
--  no volver a preguntar lo mismo; siempre lo muestra en la ficha antes del OK.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS jelcom_perfiles (
  campana_id   INTEGER NOT NULL,
  canal        TEXT NOT NULL,
  campana      TEXT NOT NULL DEFAULT '',
  datos        JSONB NOT NULL DEFAULT '{}',
  usos         INTEGER NOT NULL DEFAULT 1,
  actualizado  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (campana_id, canal)
);
