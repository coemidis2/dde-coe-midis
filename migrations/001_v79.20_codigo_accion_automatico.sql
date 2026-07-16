-- DEE MIDIS v79.20 - Código de Acción automático
-- El Worker acciones.js ejecuta estas sentencias de manera idempotente.
-- Este archivo se incluye para control y ejecución manual opcional en D1.

ALTER TABLE acciones ADD COLUMN accion_grupo_id TEXT;

CREATE TABLE IF NOT EXISTS accion_correlativos (
  programa TEXT NOT NULL,
  tipo TEXT NOT NULL,
  ultimo_numero INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT,
  PRIMARY KEY (programa, tipo)
);

CREATE TABLE IF NOT EXISTS acciones_grupos (
  id TEXT PRIMARY KEY,
  ds_id TEXT NOT NULL,
  numero_reunion TEXT,
  fecha_reunion TEXT,
  programa TEXT NOT NULL,
  tipo TEXT NOT NULL,
  codigo TEXT NOT NULL UNIQUE,
  estado TEXT NOT NULL DEFAULT 'Registrado',
  locked INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT,
  usuario_registro TEXT,
  created_at TEXT,
  updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_acciones_grupo_id
ON acciones(accion_grupo_id);

CREATE UNIQUE INDEX IF NOT EXISTS ux_acciones_grupo_territorio
ON acciones(accion_grupo_id, departamento, provincia, distrito)
WHERE accion_grupo_id IS NOT NULL
  AND accion_grupo_id <> ''
  AND deleted_at IS NULL;
