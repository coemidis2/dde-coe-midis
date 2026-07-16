// ================= VERSION 79.21 - FORMULARIOS POR PROGRAMA Y GESTION POR DISTRITO - 2026-07-16 =================
import {
  json,
  readJson,
  badRequest,
  notFound,
  forbidden,
  serverError
} from '../_lib/http.js';

import {
  requireSession,
  verifyCsrf,
  newId
} from '../_lib/auth.js';

import { writeAudit, writeConflict } from '../_lib/audit.js';

function safeJsonObject(value) {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_) {
    return {};
  }
}

function stringifyJsonObject(value) {
  if (!value) return '{}';
  if (typeof value === 'string') {
    try { return JSON.stringify(safeJsonObject(value)); } catch (_) { return '{}'; }
  }
  try { return JSON.stringify(value); } catch (_) { return '{}'; }
}

function normalizeRow(row) {
  const datosPrograma = safeJsonObject(row.datos_programa_json);
  return {
    ...row,
    accionGrupoId: row.accion_grupo_id || '',
    accion_grupo_id: row.accion_grupo_id || '',
    datosPrograma,
    datos_programa: datosPrograma,
    datos_programa_json: row.datos_programa_json || '{}',
    locked: Number(row.locked) === 1,
    deleted: !!row.deleted_at
  };
}


function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase();
}

function localHeaderSession(context) {
  const h = context.request.headers;
  const enabled = h.get('x-dee-local-session') === '1';
  const email = String(h.get('x-dee-user-email') || '').trim().toLowerCase();
  const role = String(h.get('x-dee-user-role') || '').trim();
  const programa = String(h.get('x-dee-user-programa') || '').trim();

  if (!enabled || !email || !role) return null;

  return {
    email,
    role,
    rol: role,
    programa,
    name: email,
    local: true
  };
}

async function requireSessionCompat(context, roles = []) {
  const auth = await requireSession(context, roles);
  if (auth.ok) return { ...auth, local: false };

  const local = localHeaderSession(context);
  if (!local) return auth;

  const roleAllowed = roles.some(r => normalizeText(r) === normalizeText(local.role));
  if (!roleAllowed) return { ok: false, response: forbidden('role_not_allowed') };

  return { ok: true, session: local, local: true };
}

function mustVerifyCsrf(auth, request) {
  return auth?.local ? true : verifyCsrf(request);
}


function valueOf(body, ...keys) {
  for (const key of keys) {
    const value = body?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  return '';
}

function toNumber(value, fallback = 0) {
  if (value === undefined || value === null || value === '') return fallback;
  const cleaned = String(value).replace('%', '').replace(',', '.').trim();
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : fallback;
}

function normalizePrograma(value) {
  return String(value || '').trim().toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace('CUNA MAS', 'CUNA MÁS')
    .replace('PENSION 65', 'PENSIÓN 65');
}


const PREFIJOS_PROGRAMA = Object.freeze({
  'CUNA MÁS': 'CUN',
  'PAE': 'PAE',
  'JUNTOS': 'JUN',
  'CONTIGO': 'CON',
  'PENSIÓN 65': 'PEN',
  'FONCODES': 'FON',
  'PAIS': 'PAI'
});

function tipoCodigo(value) {
  const t = normalizeText(value);
  if (t.includes('REHABILITACION')) return 'ARH';
  if (t.includes('RESPUESTA')) return 'AR';
  if (t.includes('PREPARACION')) return 'AP';
  return '';
}

function prefijoPrograma(value) {
  return PREFIJOS_PROGRAMA[normalizePrograma(value)] || '';
}

async function ensureColumn(env, table, columnSql) {
  try {
    await env.DB.prepare(`ALTER TABLE ${table} ADD COLUMN ${columnSql}`).run();
  } catch (_) {
    // La columna ya existe o la migración no aplica.
  }
}

async function ensureAccionesSchema(env) {
  await ensureColumn(env, 'acciones', 'accion_grupo_id TEXT');
  await ensureColumn(env, 'acciones', `datos_programa_json TEXT DEFAULT '{}'`);
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS accion_correlativos (
      programa TEXT NOT NULL,
      tipo TEXT NOT NULL,
      ultimo_numero INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT,
      PRIMARY KEY (programa, tipo)
    )
  `).run();
  await env.DB.prepare(`
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
    )
  `).run();
  await ensureColumn(env, 'acciones_grupos', `datos_programa_json TEXT DEFAULT '{}'`);
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_acciones_grupo_id ON acciones(accion_grupo_id)`).run();
  await env.DB.prepare(`
    CREATE UNIQUE INDEX IF NOT EXISTS ux_acciones_grupo_territorio
    ON acciones(accion_grupo_id, departamento, provincia, distrito)
    WHERE accion_grupo_id IS NOT NULL AND accion_grupo_id <> '' AND deleted_at IS NULL
  `).run();
}

async function reservarCodigoAccion(context, body, auth) {
  let programa = normalizePrograma(valueOf(body, 'programa', 'programaNacional'));
  const rol = normalizeText(auth.session.role || auth.session.rol || '');
  const programaSesion = normalizePrograma(auth.session.programa || '');

  if (rol === 'REGISTRADOR' && programaSesion) {
    if (programa && programa !== programaSesion) return forbidden('programa_not_allowed');
    programa = programaSesion;
  }

  const dsId = valueOf(body, 'ds_id', 'dsId');
  const numeroReunion = valueOf(body, 'numero_reunion', 'numeroReunion', 'reunion');
  const fechaReunion = valueOf(body, 'fecha_reunion', 'fechaReunion');
  const tipo = valueOf(body, 'tipo', 'tipoAccion', 'tipo_accion');
  if (!dsId || !programa || !tipo) return badRequest('ds_id_programa_tipo_required');

  const pPrograma = prefijoPrograma(programa);
  const pTipo = tipoCodigo(tipo);
  if (!pPrograma) return badRequest('programa_codigo_not_supported');
  if (!pTipo) return badRequest('tipo_codigo_not_supported');

  const validacionDS = await validarDecretoParaEscritura(context.env, dsId);
  if (!validacionDS.ok) return validacionDS.response;

  const now = new Date().toISOString();
  const prefijo = `${pPrograma}${pTipo}`;
  const maxExistente = await context.env.DB.prepare(`
    SELECT COALESCE(MAX(CAST(SUBSTR(codigo, ?) AS INTEGER)), 0) AS maximo
    FROM acciones
    WHERE deleted_at IS NULL
      AND COALESCE(programa, '') = ?
      AND codigo GLOB ?
  `).bind(prefijo.length + 1, programa, `${prefijo}[0-9]*`).first();

  await context.env.DB.prepare(`
    INSERT OR IGNORE INTO accion_correlativos (programa, tipo, ultimo_numero, updated_at)
    VALUES (?, ?, ?, ?)
  `).bind(programa, pTipo, Number(maxExistente?.maximo || 0), now).run();

  let grupoId = '';
  let codigo = '';
  let numero = 0;
  for (let intento = 0; intento < 4; intento++) {
    const correlativo = await context.env.DB.prepare(`
      UPDATE accion_correlativos
      SET ultimo_numero = ultimo_numero + 1, updated_at = ?
      WHERE programa = ? AND tipo = ?
      RETURNING ultimo_numero
    `).bind(now, programa, pTipo).first();
    numero = Number(correlativo?.ultimo_numero || 0);
    if (!numero) return serverError('codigo_correlativo_failed');
    codigo = `${prefijo}${numero}`;
    grupoId = newId();
    try {
      await context.env.DB.prepare(`
        INSERT INTO acciones_grupos (
          id, ds_id, numero_reunion, fecha_reunion, programa, tipo, codigo,
          estado, locked, deleted_at, usuario_registro, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'Registrado', 0, NULL, ?, ?, ?)
      `).bind(
        grupoId, dsId, numeroReunion || '', fechaReunion || '', programa, tipo, codigo,
        auth.session.email || '', now, now
      ).run();
      break;
    } catch (error) {
      if (intento === 3) throw error;
      grupoId = '';
    }
  }

  await writeAudit(context.env, {
    actor: auth.session.email,
    action: 'RESERVAR_CODIGO_ACCION',
    detail: `${programa} | ${tipo} | ${codigo}`,
    entity_type: 'accion_grupo',
    entity_id: grupoId
  });

  return json({
    ok: true,
    accion_grupo_id: grupoId,
    accionGrupoId: grupoId,
    codigo,
    numero,
    programa,
    tipo
  });
}

function normalizeAccionPayload(body, auth) {
  const avanceRaw = valueOf(body, 'avance', 'porcentajeAvance', 'porcentaje_avance');
  const fechaRegistro = valueOf(body, 'fecha_registro', 'fechaRegistro') || new Date().toISOString();

  return {
    id: valueOf(body, 'id') || newId(),
    accion_grupo_id: valueOf(body, 'accion_grupo_id', 'accionGrupoId', 'grupo_id', 'grupoId'),
    ds_id: valueOf(body, 'ds_id', 'dsId'),
    numero_reunion: valueOf(body, 'numero_reunion', 'numeroReunion', 'reunion'),
    fecha_reunion: valueOf(body, 'fecha_reunion', 'fechaReunion'),
    departamento: valueOf(body, 'departamento'),
    provincia: valueOf(body, 'provincia'),
    distrito: valueOf(body, 'distrito'),
    programa: normalizePrograma(valueOf(body, 'programa', 'programaNacional')),
    tipo: valueOf(body, 'tipo', 'tipoAccion', 'tipo_accion'),
    subtipo_rehabilitacion: valueOf(body, 'subtipo_rehabilitacion', 'subtipoRehabilitacion'),
    codigo: valueOf(body, 'codigo', 'codigoAccion', 'codigo_accion'),
    detalle: valueOf(body, 'detalle', 'accion_registrada', 'accionRegistrada'),
    unidad: valueOf(body, 'unidad', 'unidadMedida', 'unidad_medida'),
    meta_programada: toNumber(valueOf(body, 'meta_programada', 'metaProgramada')),
    plazo_dias: toNumber(valueOf(body, 'plazo_dias', 'plazoDias', 'plazo')),
    fecha_inicio: valueOf(body, 'fecha_inicio', 'fechaInicio'),
    fecha_final: valueOf(body, 'fecha_final', 'fechaFinal'),
    meta_ejecutada: toNumber(valueOf(body, 'meta_ejecutada', 'metaEjecutada')),
    avance: avanceRaw === '' ? 0 : toNumber(avanceRaw),
    descripcion: valueOf(body, 'descripcion', 'descripcionActividades', 'observaciones'),
    datos_programa_json: stringifyJsonObject(
      body?.datosPrograma ?? body?.datos_programa ?? body?.datos_programa_json ?? {}
    ),
    estado: valueOf(body, 'estado') || 'Registrado',
    usuario_registro: valueOf(body, 'usuario_registro', 'usuarioRegistro', 'usuario') || auth.session.email || '',
    fecha_registro: fechaRegistro
  };
}

function buildConflictPayload(current, body, sessionEmail) {
  return {
    entidad: 'acciones',
    entidad_id: current.id || body.id || '',
    version_local: Number(body.version || 0),
    version_servidor: Number(current.version || 0),
    usuario: sessionEmail || '',
    estado: 'rechazado'
  };
}


function normalizeEstadoRds(value) {
  return normalizeText(value).replace(/[^A-Z0-9]/g, '');
}

function estadoRdsCerrado(value) {
  const estado = normalizeEstadoRds(value);
  return estado === 'PREAPROBADO' || estado === 'APROBADO';
}

function respuestaFlujoCerrado(estadoRds) {
  const estado = normalizeEstadoRds(estadoRds);
  const error = estado === 'APROBADO' ? 'registro_aprobado' : 'registro_preaprobado';
  return json({ ok: false, error }, { status: 409 });
}

async function validarDecretoParaEscritura(env, dsId) {
  const ds = await env.DB.prepare(`
    SELECT id, numero, rds_activo, estado_rds, locked, deleted_at
    FROM decretos
    WHERE id = ?
    LIMIT 1
  `).bind(dsId).first();

  if (!ds) return { ok: false, response: notFound('decreto_not_found') };
  if (ds.deleted_at) return { ok: false, response: badRequest('decreto_deleted') };
  if (Number(ds.locked) === 1) return { ok: false, response: badRequest('decreto_locked') };
  if (Number(ds.rds_activo) !== 1) return { ok: false, response: badRequest('rds_not_active') };
  if (estadoRdsCerrado(ds.estado_rds)) return { ok: false, response: respuestaFlujoCerrado(ds.estado_rds) };

  return { ok: true, ds };
}

export async function onRequestGet(context) {
  const auth = await requireSessionCompat(context, [
    'Administrador',
    'Revisor',
    'Registrador',
    'Consulta'
  ]);
  if (!auth.ok) return auth.response;

  try {
    await ensureAccionesSchema(context.env);
    const url = new URL(context.request.url);
    const dsId = url.searchParams.get('ds_id') || url.searchParams.get('dsId');
    const numeroReunion = url.searchParams.get('numero_reunion') || url.searchParams.get('numeroReunion');
    const fechaReunion = url.searchParams.get('fecha_reunion') || url.searchParams.get('fechaReunion');
    const programa = url.searchParams.get('programa') || url.searchParams.get('programaNacional');
    const departamento = url.searchParams.get('departamento');
    const provincia = url.searchParams.get('provincia');
    const distrito = url.searchParams.get('distrito');

    let sql = 'SELECT * FROM acciones WHERE deleted_at IS NULL';
    const binds = [];

    if (dsId) {
      sql += ' AND ds_id = ?';
      binds.push(dsId);
    }
    if (numeroReunion) {

      sql += " AND COALESCE(numero_reunion, '') = ?";
      binds.push(numeroReunion);
    }
    if (fechaReunion) {
      sql += " AND COALESCE(fecha_reunion, '') = ?";
      binds.push(fechaReunion);
    }
    if (programa) {
      sql += " AND COALESCE(programa, '') = ?";
      binds.push(normalizePrograma(programa));
    }
    if (departamento) {
      sql += " AND COALESCE(departamento, '') = ?";
      binds.push(departamento);
    }
    if (provincia) {
      sql += " AND COALESCE(provincia, '') = ?";
      binds.push(provincia);
    }
    if (distrito) {
      sql += " AND COALESCE(distrito, '') = ?";
      binds.push(distrito);
    }

    if (auth.session.role === 'Registrador' && auth.session.programa) {
      sql += ' AND programa = ?';
      binds.push(normalizePrograma(auth.session.programa || ''));
    }

    sql += ' ORDER BY fecha_registro DESC';

    const { results } = await context.env.DB.prepare(sql).bind(...binds).all();
    return json({ ok: true, rows: results.map(normalizeRow) });
  } catch (error) {
    return serverError('acciones_fetch_failed', String(error?.message || error));
  }
}

export async function onRequestPost(context) {
  const auth = await requireSessionCompat(context, ['Administrador', 'Revisor', 'Registrador']);
  if (!auth.ok) return auth.response;

  if (!mustVerifyCsrf(auth, context.request)) {
    return forbidden('invalid_csrf');
  }

  try {
    await ensureAccionesSchema(context.env);
    const body = await readJson(context.request);
    const action = normalizeText(body?.action || '');
    if (action === 'RESERVE_CODE' || action === 'RESERVAR_CODIGO') {
      return reservarCodigoAccion(context, body, auth);
    }
    const accion = normalizeAccionPayload(body, auth);

    let grupo = null;
    if (accion.accion_grupo_id) {
      grupo = await context.env.DB.prepare(`
        SELECT id, ds_id, numero_reunion, fecha_reunion, programa, tipo, codigo,
               estado, locked, deleted_at
        FROM acciones_grupos
        WHERE id = ?
        LIMIT 1
      `).bind(accion.accion_grupo_id).first();
      if (!grupo) return notFound('accion_grupo_not_found');
      if (grupo.deleted_at) return badRequest('accion_grupo_deleted');
      if (Number(grupo.locked) === 1) return badRequest('accion_grupo_locked');
      if (estadoRdsCerrado(grupo.estado)) return respuestaFlujoCerrado(grupo.estado);
      accion.ds_id = grupo.ds_id;
      accion.numero_reunion = grupo.numero_reunion || accion.numero_reunion;
      accion.fecha_reunion = grupo.fecha_reunion || accion.fecha_reunion;
      accion.programa = normalizePrograma(grupo.programa);
      accion.tipo = grupo.tipo;
      accion.codigo = grupo.codigo;
    }

    if (!accion.ds_id || !accion.programa || !accion.codigo) {
      return badRequest('ds_id_programa_codigo_required');
    }

    if (auth.session.role === 'Registrador' && auth.session.programa) {
      if (normalizePrograma(auth.session.programa || '') !== accion.programa) {
        return forbidden('programa_not_allowed');
      }
    }

    const validacionDS = await validarDecretoParaEscritura(context.env, accion.ds_id);
    if (!validacionDS.ok) return validacionDS.response;

    const now = new Date().toISOString();

    const existente = accion.accion_grupo_id
      ? await context.env.DB.prepare(`
          SELECT id, version, locked, deleted_at, estado, accion_grupo_id
          FROM acciones
          WHERE deleted_at IS NULL
            AND accion_grupo_id = ?
            AND COALESCE(departamento, '') = ?
            AND COALESCE(provincia, '') = ?
            AND COALESCE(distrito, '') = ?
          LIMIT 1
        `).bind(
          accion.accion_grupo_id,
          accion.departamento || '',
          accion.provincia || '',
          accion.distrito || ''
        ).first()
      : await context.env.DB.prepare(`
          SELECT id, version, locked, deleted_at, estado, accion_grupo_id
          FROM acciones
          WHERE deleted_at IS NULL
            AND ds_id = ?
            AND COALESCE(numero_reunion, '') = ?
            AND COALESCE(programa, '') = ?
            AND COALESCE(departamento, '') = ?
            AND COALESCE(provincia, '') = ?
            AND COALESCE(distrito, '') = ?
            AND COALESCE(tipo, '') = ?
            AND COALESCE(codigo, '') = ?
          LIMIT 1
        `).bind(
          accion.ds_id,
          accion.numero_reunion || '',
          accion.programa || '',
          accion.departamento || '',
          accion.provincia || '',
          accion.distrito || '',
          accion.tipo || '',
          accion.codigo || ''
        ).first();

    if (existente) {
      if (existente.deleted_at) return badRequest('accion_deleted');
      if (Number(existente.locked) === 1) return badRequest('accion_locked');
      if (estadoRdsCerrado(existente.estado)) return respuestaFlujoCerrado(existente.estado);

      const nextVersion = Number(existente.version || 1) + 1;
      await context.env.DB.prepare(`
        UPDATE acciones
        SET accion_grupo_id = ?, numero_reunion = ?, fecha_reunion = ?, departamento = ?, provincia = ?, distrito = ?,
            subtipo_rehabilitacion = ?, programa = ?, tipo = ?, codigo = ?, detalle = ?, unidad = ?,
            meta_programada = ?, plazo_dias = ?, fecha_inicio = ?, fecha_final = ?, meta_ejecutada = ?,
            avance = ?, descripcion = ?, datos_programa_json = ?, estado = ?, usuario_registro = ?, fecha_registro = ?,
            version = ?, updated_at = ?
        WHERE id = ?
      `).bind(
        accion.accion_grupo_id || existente.accion_grupo_id || '',
        accion.numero_reunion,
        accion.fecha_reunion,
        accion.departamento,
        accion.provincia,
        accion.distrito,
        accion.subtipo_rehabilitacion,
        accion.programa,
        accion.tipo,
        accion.codigo,
        accion.detalle,
        accion.unidad,
        accion.meta_programada,
        accion.plazo_dias,
        accion.fecha_inicio,
        accion.fecha_final,
        accion.meta_ejecutada,
        accion.avance,
        accion.descripcion,
        accion.datos_programa_json,
        accion.estado,
        accion.usuario_registro,
        accion.fecha_registro,
        nextVersion,
        now,
        existente.id
      ).run();

      await writeAudit(context.env, {
        actor: auth.session.email,
        action: 'update_accion',
        detail: `${accion.programa} | ${accion.codigo}`,
        entity_type: 'accion',
        entity_id: existente.id
      });

      return json({ ok: true, id: existente.id, version: nextVersion, updated: true, codigo: accion.codigo, accion_grupo_id: accion.accion_grupo_id || existente.accion_grupo_id || '' });
    }

    await context.env.DB.prepare(`
      INSERT INTO acciones (
        id, accion_grupo_id, ds_id, numero_reunion, fecha_reunion, departamento, provincia, distrito,
        subtipo_rehabilitacion, programa, tipo, codigo, detalle, unidad,
        meta_programada, plazo_dias, fecha_inicio, fecha_final, meta_ejecutada,
        avance, descripcion, datos_programa_json, estado, usuario_registro, fecha_registro,
        version, locked, deleted_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, NULL, ?, ?)
    `).bind(
      accion.id,
      accion.accion_grupo_id || '',
      accion.ds_id,
      accion.numero_reunion,
      accion.fecha_reunion,
      accion.departamento,
      accion.provincia,
      accion.distrito,
      accion.subtipo_rehabilitacion,
      accion.programa,
      accion.tipo,
      accion.codigo,
      accion.detalle,
      accion.unidad,
      accion.meta_programada,
      accion.plazo_dias,
      accion.fecha_inicio,
      accion.fecha_final,
      accion.meta_ejecutada,
      accion.avance,
      accion.descripcion,
      accion.datos_programa_json,
      accion.estado,
      accion.usuario_registro,
      accion.fecha_registro,
      now,
      now
    ).run();

    await writeAudit(context.env, {
      actor: auth.session.email,
      action: 'create_accion',
      detail: `${accion.programa} | ${accion.codigo}`,
      entity_type: 'accion',
      entity_id: accion.id
    });

    return json({ ok: true, id: accion.id, version: 1, codigo: accion.codigo, accion_grupo_id: accion.accion_grupo_id || '' });
  } catch (error) {
    return serverError('accion_create_failed', String(error?.message || error));
  }
}

export async function onRequestPut(context) {
  const auth = await requireSessionCompat(context, ['Administrador', 'Revisor', 'Registrador']);
  if (!auth.ok) return auth.response;

  if (!mustVerifyCsrf(auth, context.request)) {
    return forbidden('invalid_csrf');
  }

  try {
    await ensureAccionesSchema(context.env);
    const body = await readJson(context.request);

    if (!body.id || !Number.isInteger(body.version)) {
      return badRequest('id_and_version_required');
    }

    const current = await context.env.DB.prepare(`
      SELECT id, accion_grupo_id, ds_id, codigo, programa, tipo, estado, version, locked, deleted_at
      FROM acciones
      WHERE id = ?
    `).bind(body.id).first();

    if (!current) return notFound('accion_not_found');
    if (current.deleted_at) return badRequest('accion_deleted');
    if (Number(current.locked) === 1) return badRequest('accion_locked');
    if (estadoRdsCerrado(current.estado)) return respuestaFlujoCerrado(current.estado);

    const validacionDS = await validarDecretoParaEscritura(context.env, current.ds_id);
    if (!validacionDS.ok) return validacionDS.response;

    const accion = normalizeAccionPayload({ ...body, id: body.id, ds_id: current.ds_id, accion_grupo_id: current.accion_grupo_id }, auth);
    if (current.accion_grupo_id) {
      const grupo = await context.env.DB.prepare(`
        SELECT id, ds_id, numero_reunion, fecha_reunion, programa, tipo, codigo, estado, locked, deleted_at
        FROM acciones_grupos WHERE id = ? LIMIT 1
      `).bind(current.accion_grupo_id).first();
      if (!grupo) return notFound('accion_grupo_not_found');
      if (grupo.deleted_at) return badRequest('accion_grupo_deleted');
      if (Number(grupo.locked) === 1) return badRequest('accion_grupo_locked');
      if (estadoRdsCerrado(grupo.estado)) return respuestaFlujoCerrado(grupo.estado);
      accion.accion_grupo_id = grupo.id;
      accion.ds_id = grupo.ds_id;
      accion.numero_reunion = grupo.numero_reunion || accion.numero_reunion;
      accion.fecha_reunion = grupo.fecha_reunion || accion.fecha_reunion;
      accion.programa = normalizePrograma(grupo.programa);
      accion.tipo = grupo.tipo;
      accion.codigo = grupo.codigo;
    }

    if (auth.session.role === 'Registrador' && auth.session.programa) {
      if (normalizePrograma(auth.session.programa || '') !== normalizePrograma(current.programa || '')) {
        return forbidden('programa_not_allowed');
      }
      if (normalizePrograma(auth.session.programa || '') !== accion.programa) {
        return forbidden('programa_not_allowed');
      }
    }

    if (Number(current.version) !== Number(body.version)) {
      await writeConflict(
        context.env.DB,
        buildConflictPayload(current, body, auth.session.email)
      );

      return json(
        { ok: false, error: 'version_mismatch', serverVersion: Number(current.version) },
        { status: 409 }
      );
    }

    const nextVersion = Number(current.version) + 1;
    const now = new Date().toISOString();

    await context.env.DB.prepare(`
      UPDATE acciones
      SET accion_grupo_id = ?, numero_reunion = ?, fecha_reunion = ?, departamento = ?, provincia = ?, distrito = ?,
          subtipo_rehabilitacion = ?, programa = ?, tipo = ?, codigo = ?, detalle = ?, unidad = ?,
          meta_programada = ?, plazo_dias = ?, fecha_inicio = ?, fecha_final = ?, meta_ejecutada = ?,
          avance = ?, descripcion = ?, datos_programa_json = ?, estado = ?, version = ?, updated_at = ?
      WHERE id = ?
    `).bind(
      accion.accion_grupo_id || current.accion_grupo_id || '',
      accion.numero_reunion,
      accion.fecha_reunion,
      accion.departamento,
      accion.provincia,
      accion.distrito,
      accion.subtipo_rehabilitacion,
      accion.programa,
      accion.tipo,
      accion.codigo,
      accion.detalle,
      accion.unidad,
      accion.meta_programada,
      accion.plazo_dias,
      accion.fecha_inicio,
      accion.fecha_final,
      accion.meta_ejecutada,
      accion.avance,
      accion.descripcion,
      accion.datos_programa_json,
      accion.estado,
      nextVersion,
      now,
      body.id
    ).run();

    await writeAudit(context.env, {
      actor: auth.session.email,
      action: 'update_accion',
      detail: accion.codigo || body.id,
      entity_type: 'accion',
      entity_id: body.id
    });

    return json({ ok: true, version: nextVersion });
  } catch (error) {
    return serverError('accion_update_failed', String(error?.message || error));
  }
}

export async function onRequestDelete(context) {
  const auth = await requireSessionCompat(context, ['Administrador', 'Registrador']);
  if (!auth.ok) return auth.response;

  if (!mustVerifyCsrf(auth, context.request)) {
    return forbidden('invalid_csrf');
  }

  try {
    await ensureAccionesSchema(context.env);
    const url = new URL(context.request.url);
    const id = url.searchParams.get('id');
    if (!id) return badRequest('id_required');

    const current = await context.env.DB.prepare(`
      SELECT id, accion_grupo_id, ds_id, programa, codigo, estado, version,
             locked, deleted_at, departamento, provincia, distrito
      FROM acciones
      WHERE id = ?
      LIMIT 1
    `).bind(id).first();

    if (!current) return notFound('accion_not_found');
    if (current.deleted_at) return badRequest('accion_deleted');
    if (Number(current.locked) === 1) return badRequest('accion_locked');
    if (estadoRdsCerrado(current.estado)) return respuestaFlujoCerrado(current.estado);

    const rol = normalizeText(auth.session.role || auth.session.rol || '');
    const programaSesion = normalizePrograma(auth.session.programa || '');
    if (rol === 'REGISTRADOR') {
      if (!programaSesion) return forbidden('registrador_programa_required');
      if (programaSesion !== normalizePrograma(current.programa || '')) {
        return forbidden('programa_not_allowed');
      }
    }

    const validacionDS = await validarDecretoParaEscritura(context.env, current.ds_id);
    if (!validacionDS.ok) return validacionDS.response;

    if (current.accion_grupo_id) {
      const grupo = await context.env.DB.prepare(`
        SELECT id, estado, locked, deleted_at
        FROM acciones_grupos
        WHERE id = ?
        LIMIT 1
      `).bind(current.accion_grupo_id).first();
      if (grupo?.deleted_at) return badRequest('accion_grupo_deleted');
      if (Number(grupo?.locked || 0) === 1) return badRequest('accion_grupo_locked');
      if (estadoRdsCerrado(grupo?.estado)) return respuestaFlujoCerrado(grupo.estado);
    }

    const now = new Date().toISOString();
    await context.env.DB.prepare(`
      UPDATE acciones
      SET deleted_at = ?, updated_at = ?, version = COALESCE(version, 1) + 1
      WHERE id = ? AND deleted_at IS NULL
    `).bind(now, now, id).run();

    if (current.accion_grupo_id) {
      const restantes = await context.env.DB.prepare(`
        SELECT COUNT(*) AS total
        FROM acciones
        WHERE accion_grupo_id = ? AND deleted_at IS NULL
      `).bind(current.accion_grupo_id).first();
      if (Number(restantes?.total || 0) === 0) {
        await context.env.DB.prepare(`
          UPDATE acciones_grupos
          SET deleted_at = ?, updated_at = ?
          WHERE id = ? AND deleted_at IS NULL
        `).bind(now, now, current.accion_grupo_id).run();
      }
    }

    await writeAudit(context.env, {
      actor: auth.session.email,
      action: 'DELETE_ACCION_DISTRITO',
      detail: `${current.programa || ''} | ${current.codigo || ''} | ${current.departamento || ''}/${current.provincia || ''}/${current.distrito || ''}`,
      entity_type: 'accion',
      entity_id: id
    });

    return json({ ok: true, id, deleted: true });
  } catch (error) {
    return serverError('accion_delete_failed', String(error?.message || error));
  }
}

export async function onRequestPatch(context) {
  const auth = await requireSessionCompat(context, ['Administrador', 'Revisor']);
  if (!auth.ok) return auth.response;

  if (!mustVerifyCsrf(auth, context.request)) {
    return forbidden('invalid_csrf');
  }

  try {
    await ensureAccionesSchema(context.env);
    const body = await readJson(context.request);
    if (!body.id) return badRequest('id_required');

    const current = await context.env.DB
      .prepare('SELECT id, codigo FROM acciones WHERE id = ?')
      .bind(body.id)
      .first();

    if (!current) return notFound('accion_not_found');

    const locked = body.locked ? 1 : 0;
    const now = new Date().toISOString();

    await context.env.DB
      .prepare('UPDATE acciones SET locked = ?, updated_at = ? WHERE id = ?')
      .bind(locked, now, body.id)
      .run();

    await writeAudit(context.env, {
      actor: auth.session.email,
      action: locked ? 'lock_accion' : 'unlock_accion',
      detail: current.codigo || body.id,
      entity_type: 'accion',
      entity_id: body.id
    });

    return json({ ok: true, locked: !!locked });
  } catch (error) {
    return serverError('accion_patch_failed', String(error?.message || error));
  }
}