-- DEE MIDIS v79.21
-- Campos específicos por Programa Nacional y gestión por distrito.

ALTER TABLE acciones ADD COLUMN datos_programa_json TEXT DEFAULT '{}';
ALTER TABLE acciones_grupos ADD COLUMN datos_programa_json TEXT DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_acciones_programa_ds_reunion
ON acciones(ds_id, numero_reunion, programa)
WHERE deleted_at IS NULL;
