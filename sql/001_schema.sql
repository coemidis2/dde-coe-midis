PRAGMA foreign_keys = ON;

-- =========================
-- USERS
-- =========================
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL,
  name TEXT NOT NULL,
  programa TEXT DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  force_password_change INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_login_at TEXT
);

-- =========================
-- SESSIONS
-- =========================
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

-- =========================
-- DECRETOS
-- =========================
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
  estado TEXT NOT NULL DEFAULT 'activo',
  version INTEGER NOT NULL DEFAULT 1,
  locked INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT,
  updated_at TEXT NOT NULL
);

-- =========================
-- ACCIONES
-- =========================
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

-- =========================
-- AUDIT LOG
-- =========================
CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  detail TEXT,
  entity_type TEXT,
  entity_id TEXT,
  created_at TEXT NOT NULL
);

-- =========================
-- CONFLICTOS
-- =========================
CREATE TABLE IF NOT EXISTS conflictos (
  id TEXT PRIMARY KEY,
  entidad TEXT,
  entidad_id TEXT,
  version_local INTEGER DEFAULT 0,
  version_servidor INTEGER DEFAULT 0,
  usuario TEXT,
  fecha TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'pendiente'
);

-- =========================
-- LOGIN ATTEMPTS
-- =========================
CREATE TABLE IF NOT EXISTS login_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ip TEXT NOT NULL,
  email TEXT,
  created_at TEXT NOT NULL
);

-- =========================
-- INDICES
-- =========================
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
CREATE INDEX IF NOT EXISTS idx_sessions_email ON sessions(email);

CREATE INDEX IF NOT EXISTS idx_decretos_numero_anio ON decretos(numero, anio);
CREATE INDEX IF NOT EXISTS idx_decretos_fecha_registro ON decretos(fecha_registro);
CREATE INDEX IF NOT EXISTS idx_decretos_deleted_at ON decretos(deleted_at);

CREATE INDEX IF NOT EXISTS idx_acciones_ds ON acciones(ds_id);
CREATE INDEX IF NOT EXISTS idx_acciones_codigo ON acciones(codigo);
CREATE INDEX IF NOT EXISTS idx_acciones_fecha_registro ON acciones(fecha_registro);
CREATE INDEX IF NOT EXISTS idx_acciones_deleted_at ON acciones(deleted_at);

CREATE INDEX IF NOT EXISTS idx_audit_actor_fecha ON audit_log(actor, created_at);
CREATE INDEX IF NOT EXISTS idx_conflictos_fecha ON conflictos(fecha);
CREATE INDEX IF NOT EXISTS idx_conflictos_entidad_id ON conflictos(entidad, entidad_id);
CREATE INDEX IF NOT EXISTS idx_login_attempts_ip_created_at ON login_attempts(ip, created_at);