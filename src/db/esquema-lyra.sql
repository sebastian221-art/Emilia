-- ─────────────────────────────────────────────────────────────────────────────
--  LYRA — comunicación: agenda de contactos, mensajes salientes con su estado,
--  gestiones (conversaciones con un objetivo) y listas.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS contactos (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre          TEXT NOT NULL,
  apodos          TEXT[] NOT NULL DEFAULT '{}',          -- "mi tío", "Juancho", "el de compras del hospital"
  numero          TEXT UNIQUE,                           -- solo dígitos con indicativo (57300…)
  relacion        TEXT,                                  -- familia, amigo, jefa, cliente, proveedor, equipo…
  permiso         TEXT NOT NULL DEFAULT 'pedir_ok' CHECK (permiso IN ('pedir_ok','libre','bloqueado')),
  tono            TEXT,                                  -- formal | cercano | profesional cercano… (cómo escribirle)
  notas           TEXT,
  persona_slug    TEXT,                                  -- su nodo en el cerebro (lo que Lara sabe de esa persona)
  ultimo_contacto TIMESTAMPTZ,
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_contactos_nombre ON contactos (lower(nombre));

CREATE TABLE IF NOT EXISTS mensajes_salientes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contacto_id   UUID REFERENCES contactos(id) ON DELETE SET NULL,
  numero        TEXT NOT NULL,
  tipo          TEXT NOT NULL DEFAULT 'texto',           -- texto | plantilla | documento | audio
  texto         TEXT,
  wamid         TEXT UNIQUE,                             -- id de WhatsApp (para entregado/leído/falló)
  estado        TEXT NOT NULL DEFAULT 'enviado',         -- enviado | entregado | leido | fallido
  error         TEXT,
  conversacion_id UUID,                                  -- la conversación desde donde se pidió (para avisar respuestas)
  gestion_id    UUID,
  seguimiento_en  TIMESTAMPTZ,                           -- "si no responde en X, recuérdale / avísame"
  seguimiento     TEXT,                                  -- recordarle | avisarme
  seguimiento_hecho BOOLEAN NOT NULL DEFAULT false,
  respondido_en TIMESTAMPTZ,
  creado_en     TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_msal_numero ON mensajes_salientes (numero, creado_en DESC);

-- Lo que le escriben al número de Emilia personas que no son el jefe (para avisarle agrupado y proponer respuesta).
CREATE TABLE IF NOT EXISTS mensajes_terceros (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  numero        TEXT NOT NULL,
  contacto_id   UUID REFERENCES contactos(id) ON DELETE SET NULL,
  texto         TEXT NOT NULL,
  saliente_id   UUID REFERENCES mensajes_salientes(id) ON DELETE SET NULL,   -- si responde a algo que Lyra mandó
  avisado_en    TIMESTAMPTZ,
  creado_en     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mter_pend ON mensajes_terceros (numero, creado_en) WHERE avisado_en IS NULL;

-- Respuesta que Lyra le propuso al jefe: "envíalo" la manda tal cual (él vio el texto exacto y a quién va).
CREATE TABLE IF NOT EXISTS lyra_propuestas (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  numero        TEXT NOT NULL,
  contacto_id   UUID REFERENCES contactos(id) ON DELETE SET NULL,
  borrador      TEXT NOT NULL,
  estado        TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','enviada','ignorada','vencida')),
  creado_en     TIMESTAMPTZ NOT NULL DEFAULT now()
);
