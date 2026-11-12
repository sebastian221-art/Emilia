-- ARCHIVO: src/db/esquema-iris.sql
-- Iris: correo, avisos con horas de silencio, configuración.

-- Configuración de Iris (personas importantes, horarios, etc.), editable por WhatsApp.
CREATE TABLE IF NOT EXISTS iris_config (
  clave          TEXT PRIMARY KEY,
  valor          JSONB NOT NULL,
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Avisos al jefe que esperan a que terminen las horas de silencio.
CREATE TABLE IF NOT EXISTS avisos_diferidos (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  texto      TEXT NOT NULL,
  origen     TEXT NOT NULL DEFAULT 'iris',
  creado_en  TIMESTAMPTZ NOT NULL DEFAULT now(),
  enviado_en TIMESTAMPTZ
);

-- Estado de cada cuenta de correo (hasta qué mensaje se procesó).
CREATE TABLE IF NOT EXISTS correo_cuentas (
  cuenta       TEXT PRIMARY KEY,            -- nombre corto: personal, empresa
  usuario      TEXT NOT NULL,
  carpeta      TEXT NOT NULL DEFAULT 'INBOX',
  uidvalidity  TEXT,
  ultimo_uid   BIGINT NOT NULL DEFAULT 0,
  ultimo_uid_enviados BIGINT NOT NULL DEFAULT 0,
  estado       TEXT NOT NULL DEFAULT 'desconectada',
  error        TEXT,
  conectada_en TIMESTAMPTZ,
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Cada correo que Iris vio (recibido o enviado por el jefe), ya desmenuzado.
CREATE TABLE IF NOT EXISTS correos (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cuenta        TEXT NOT NULL,
  direccion     TEXT NOT NULL DEFAULT 'recibido' CHECK (direccion IN ('recibido','enviado')),
  uid           BIGINT,
  message_id    TEXT,
  in_reply_to   TEXT,
  referencias   TEXT,
  de_nombre     TEXT,
  de_correo     TEXT,
  para          TEXT,
  cc            TEXT,
  asunto        TEXT,
  fecha         TIMESTAMPTZ,
  texto         TEXT,                        -- cuerpo en texto (recortado)
  adjuntos      JSONB NOT NULL DEFAULT '[]', -- [{nombre, mime, bytes, archivo_id, resumen}]
  quien         TEXT,                        -- quién es, en palabras
  categoria     TEXT,                        -- urgente, responder, accion, informativo, promocion, seguridad, spam
  importancia   INT,                         -- 1..5
  resumen       TEXT,
  acciones      JSONB NOT NULL DEFAULT '[]', -- [{que, fecha_limite}]
  fechas        JSONB NOT NULL DEFAULT '[]', -- [{titulo, inicio, fin, lugar}] para la agenda
  compromisos   JSONB NOT NULL DEFAULT '[]', -- lo que el jefe prometió (en enviados)
  requiere_respuesta BOOLEAN NOT NULL DEFAULT false,
  espera_respuesta   BOOLEAN NOT NULL DEFAULT false,  -- enviado por el jefe que pide respuesta
  respuesta_sugerida TEXT,
  alerta_seguridad   TEXT,
  estado        TEXT NOT NULL DEFAULT 'nuevo',  -- nuevo, avisado, en_resumen, respondido, archivado, contestaron
  avisado_en    TIMESTAMPTZ,
  creado_en     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (cuenta, direccion, uid)
);
CREATE INDEX IF NOT EXISTS idx_correos_fecha ON correos (fecha DESC);
CREATE INDEX IF NOT EXISTS idx_correos_msgid ON correos (message_id);

-- Borradores que Iris redacta; se envían solo con OK del jefe.
CREATE TABLE IF NOT EXISTS correo_borradores (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cuenta      TEXT NOT NULL,
  responde_a  UUID REFERENCES correos(id) ON DELETE SET NULL,
  para        TEXT NOT NULL,
  cc          TEXT,
  asunto      TEXT NOT NULL,
  cuerpo      TEXT NOT NULL,
  estado      TEXT NOT NULL DEFAULT 'borrador',  -- borrador, enviado, descartado
  enviado_en  TIMESTAMPTZ,
  creado_en   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Agenda de Iris: citas, tareas, compromisos y recordatorios (se refleja en Google Calendar si está conectado).
CREATE TABLE IF NOT EXISTS agenda (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo         TEXT NOT NULL,
  inicio         TIMESTAMPTZ,
  fin            TIMESTAMPTZ,
  todo_el_dia    BOOLEAN NOT NULL DEFAULT false,
  lugar          TEXT,
  notas          TEXT,
  tipo           TEXT NOT NULL DEFAULT 'cita' CHECK (tipo IN ('cita','tarea','compromiso','recordatorio','vencimiento')),
  origen         TEXT NOT NULL DEFAULT 'jefe',          -- jefe, correo, iris
  correo_id      UUID REFERENCES correos(id) ON DELETE SET NULL,
  estado         TEXT NOT NULL DEFAULT 'confirmado' CHECK (estado IN ('propuesto','confirmado','hecho','cancelado')),
  recordatorios  JSONB NOT NULL DEFAULT '[1440, 60]',   -- minutos antes
  avisados       JSONB NOT NULL DEFAULT '[]',
  google_id      TEXT,
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_agenda_inicio ON agenda (inicio);
