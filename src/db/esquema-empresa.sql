-- ARCHIVO: src/db/esquema-empresa.sql
-- La empresa (Fase 10): puestos de trabajo. Un puesto = agente encargado +
-- (opcional) proyecto o campaña + responsabilidades + flujos permanentes.
CREATE TABLE IF NOT EXISTS puestos (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre            TEXT NOT NULL UNIQUE,                 -- slug: cajasan, soporte_emilia
  titulo            TEXT NOT NULL,                        -- "Encargado de envíos Cajasan"
  descripcion       TEXT NOT NULL DEFAULT '',
  agente_id         UUID REFERENCES agentes(id) ON DELETE SET NULL,      -- quien lo ocupa
  reporta_a         UUID REFERENCES agentes(id) ON DELETE SET NULL,      -- su jefe directo (la administradora)
  proyecto_id       UUID REFERENCES proyectos(id) ON DELETE SET NULL,
  campana_jelcom_id INTEGER,                              -- si el puesto opera una campaña de Jelcom
  responsabilidades TEXT NOT NULL DEFAULT '',
  flujos            JSONB NOT NULL DEFAULT '[]',          -- [{flujo, args, ejecucion_id, estado}]
  estado            TEXT NOT NULL DEFAULT 'activo',       -- activo | pausado
  creado_en         TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en    TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE agentes ADD COLUMN IF NOT EXISTS es_administrador BOOLEAN NOT NULL DEFAULT false;