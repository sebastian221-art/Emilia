-- ─────────────────────────────────────────────────────────────────────────────
--  SYSTEM: aprendizaje, adaptación y evolución del equipo.
-- ─────────────────────────────────────────────────────────────────────────────

-- Tablero de salud: una fila por agente y día (hora de Bogotá).
CREATE TABLE IF NOT EXISTS sys_metricas (
  dia            DATE NOT NULL,
  agente         TEXT NOT NULL,
  tareas         INT NOT NULL DEFAULT 0,
  ok             INT NOT NULL DEFAULT 0,
  fallidas       INT NOT NULL DEFAULT 0,
  correcciones   INT NOT NULL DEFAULT 0,      -- "no, así no" del jefe
  rechazos       INT NOT NULL DEFAULT 0,      -- aprobaciones que el jefe rechazó
  errores        INT NOT NULL DEFAULT 0,      -- pasos de error
  seg_prom       NUMERIC,                     -- duración promedio de una tarea
  seg_p90        NUMERIC,
  tools_prom     NUMERIC,
  costo_usd      NUMERIC NOT NULL DEFAULT 0,
  calculado_en   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (dia, agente)
);

-- Señales: lo que los sensores detectan (lento, flojo, caro, error repetido, desactualizado, repetitivo, evolución).
CREATE TABLE IF NOT EXISTS sys_senales (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo        TEXT NOT NULL CHECK (tipo IN ('lento','flojo','caro','error','desactualizado','repetitivo','evolucion','correccion')),
  agente      TEXT,
  titulo      TEXT NOT NULL,
  detalle     TEXT,
  evidencia   JSONB NOT NULL DEFAULT '{}',
  huella      TEXT NOT NULL UNIQUE,                 -- no repetir la misma señal
  prioridad   INT NOT NULL DEFAULT 5,               -- 1 = lo más urgente
  estado      TEXT NOT NULL DEFAULT 'nueva' CHECK (estado IN ('nueva','investigando','con_cambio','resuelta','descartada')),
  cambio_id   UUID,
  creado_en   TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sys_senales_estado ON sys_senales (estado, prioridad, creado_en);

-- Cambios: la adaptación. Nivel 1 se aplica solo (reversible), 2 con el OK del jefe, 3 con su OK + Sage (código/herramientas).
CREATE TABLE IF NOT EXISTS sys_cambios (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nivel         INT NOT NULL CHECK (nivel IN (1,2,3)),
  tipo          TEXT NOT NULL,                      -- modelo | ejemplo | config | regla | identidad | herramienta | codigo
  agente        TEXT,
  ruta          TEXT,                               -- en la config del agente: cerebro.ejecutor, identidad.ejemplos…
  titulo        TEXT NOT NULL,
  motivo        TEXT NOT NULL,
  evidencia     TEXT,                               -- laboratorio, números
  antes         JSONB,
  despues       JSONB,
  estado        TEXT NOT NULL DEFAULT 'propuesto' CHECK (estado IN ('propuesto','aplicado','confirmado','revertido','rechazado','fallido','en_sage')),
  linea_base    JSONB,
  resultado     JSONB,
  senal_id      UUID,
  aplicado_en   TIMESTAMPTZ,
  medir_hasta   TIMESTAMPTZ,
  decidido_en   TIMESTAMPTZ,
  creado_en     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sys_cambios_estado ON sys_cambios (estado, medir_hasta);

-- Pruebas del laboratorio (gemelos y contenedores): qué se probó y qué salió.
CREATE TABLE IF NOT EXISTS sys_laboratorio (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo        TEXT NOT NULL,                        -- gemelo | contenedor
  titulo      TEXT NOT NULL,
  agente      TEXT,
  detalle     JSONB NOT NULL DEFAULT '{}',
  resultado   JSONB,
  cambio_id   UUID,
  creado_en   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Modo profesor: lo que el jefe está aprendiendo, sus puntos débiles y cuándo repasar.
CREATE TABLE IF NOT EXISTS sys_estudio (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tema           TEXT NOT NULL UNIQUE,
  nivel          TEXT,
  dominado       TEXT[] NOT NULL DEFAULT '{}',
  debiles        TEXT[] NOT NULL DEFAULT '{}',
  sesiones       INT NOT NULL DEFAULT 0,
  aciertos       INT NOT NULL DEFAULT 0,
  preguntas      INT NOT NULL DEFAULT 0,
  intervalo_dias NUMERIC NOT NULL DEFAULT 1,
  proximo_repaso DATE,
  ultima_vez     TIMESTAMPTZ,
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT now()
);
