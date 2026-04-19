PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL,
  name TEXT NOT NULL,
  programa TEXT DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  role TEXT NOT NULL,
  name TEXT NOT NULL,
  programa TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  FOREIGN KEY (email) REFERENCES users(email)
);

CREATE TABLE IF NOT EXISTS decretos (
  id TEXT PRIMARY KEY,
  codigo_registro TEXT,
  numero TEXT NOT NULL,
  anio INTEGER NOT NULL,
  peligro TEXT,
  tipo_peligro TEXT,
  fecha_inicio TEXT NOT NULL,
  fecha_fin TEXT NOT NULL,
  vigencia TEXT,
  semaforo TEXT,
  motivos TEXT,
  sectores TEXT NOT NULL DEFAULT '[]',
  territorio TEXT NOT NULL DEFAULT '[]',
  es_prorroga INTEGER NOT NULL DEFAULT 0,
  ds_origen_id TEXT,
  ds_origen_numero TEXT,
  nivel_prorroga INTEGER NOT NULL DEFAULT 0,
  cadena_id TEXT,
  usuario_registro TEXT NOT NULL,
  fecha_registro TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  locked INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS acciones (
  id TEXT PRIMARY KEY,
  ds_id TEXT NOT NULL,
  reunion TEXT,
  fecha_reunion TEXT,
  programa TEXT NOT NULL,
  tipo TEXT,
  codigo TEXT NOT NULL,
  detalle TEXT,
  unidad TEXT,
  meta_programada REAL DEFAULT 0,
  plazo INTEGER DEFAULT 0,
  fecha_inicio TEXT,
  fecha_final TEXT,
  meta_ejecutada REAL DEFAULT 0,
  avance REAL DEFAULT 0,
  descripcion TEXT,
  estado TEXT NOT NULL DEFAULT 'Registrado',
  usuario_registro TEXT NOT NULL,
  fecha_registro TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  locked INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (ds_id) REFERENCES decretos(id)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  detail TEXT,
  entity_type TEXT,
  entity_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS conflict_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo TEXT,
  motivo TEXT NOT NULL,
  fecha_servidor TEXT,
  estado_local_servidor TEXT,
  resolucion_aplicada TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_decretos_numero ON decretos(numero, anio);
CREATE INDEX IF NOT EXISTS idx_decretos_fecha ON decretos(fecha_registro);
CREATE INDEX IF NOT EXISTS idx_acciones_ds ON acciones(ds_id);
CREATE INDEX IF NOT EXISTS idx_acciones_codigo ON acciones(codigo);
CREATE INDEX IF NOT EXISTS idx_acciones_fecha ON acciones(fecha_registro);
CREATE INDEX IF NOT EXISTS idx_audit_actor_fecha ON audit_log(actor, created_at);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
