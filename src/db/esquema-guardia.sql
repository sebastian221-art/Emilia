-- ARCHIVO: src/db/esquema-guardia.sql
-- Guardia de código: qué proyectos vigila Sage y qué ha encontrado.
CREATE TABLE IF NOT EXISTS guardia_proyectos (
  proyecto_id      UUID PRIMARY KEY REFERENCES proyectos(id) ON DELETE CASCADE,
  activo           BOOLEAN NOT NULL DEFAULT true,
  url_produccion   TEXT,                 -- p. ej. la URL de Railway (se revisa que responda)
  auto_reparar     BOOLEAN NOT NULL DEFAULT true,  -- graves: arreglar en sandbox y pedir OK para subir
  ultimo_commit    TEXT,                 -- último commit de la rama base ya verificado
  lock_hash        TEXT,                 -- para reinstalar dependencias solo cuando cambian
  ultima_auditoria TIMESTAMPTZ,
  ultima_ronda     TIMESTAMPTZ,
  creado_en        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS guardia_hallazgos (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  objetivo       TEXT NOT NULL,           -- nombre del proyecto registrado o publicado
  tipo_objetivo  TEXT NOT NULL DEFAULT 'proyecto' CHECK (tipo_objetivo IN ('proyecto','publicado')),
  origen         TEXT NOT NULL,           -- build, tests, lint, proceso, salud, url, logs, auditoria, despliegue
  severidad      TEXT NOT NULL CHECK (severidad IN ('grave','leve')),
  titulo         TEXT NOT NULL,
  detalle        TEXT NOT NULL DEFAULT '',
  huella         TEXT NOT NULL,
  estado         TEXT NOT NULL DEFAULT 'abierto'
                 CHECK (estado IN ('abierto','reparando','arreglo_listo','entregado','resuelto','ignorado','sin_arreglo')),
  sandbox_id     UUID,
  informe        TEXT,
  intentos       INT NOT NULL DEFAULT 0,
  veces          INT NOT NULL DEFAULT 1,
  primero_en     TIMESTAMPTZ NOT NULL DEFAULT now(),
  ultimo_en      TIMESTAMPTZ NOT NULL DEFAULT now(),
  resuelto_en    TIMESTAMPTZ,
  en_resumen     BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (objetivo, huella)
);
CREATE INDEX IF NOT EXISTS idx_guardia_hallazgos_estado ON guardia_hallazgos (estado, severidad);
