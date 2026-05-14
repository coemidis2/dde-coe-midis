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

function normalizeRow(row) {
  return {
    ...row,
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

function normalizeAccionPayload(body, auth) {
  const avanceRaw = valueOf(body, 'avance', 'porcentajeAvance', 'porcentaje_avance');
  const fechaRegistro = valueOf(body, 'fecha_registro', 'fechaRegistro') || new Date().toISOString();

  return {
    id: valueOf(body, 'id') || newId(),
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

export async function onRequestGet(context) {
  const auth = await requireSessionCompat(context, [
    'Administrador',
    'Revisor',
    'Registrador',
    'Consulta'
  ]);
  if (!auth.ok) return auth.response;

  try {
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
      sql += ' AND COALESCE(numero_reunion, '') = ?';
      binds.push(numeroReunion);
    }
    if (fechaReunion) {
      sql += ' AND COALESCE(fecha_reunion, '') = ?';
      binds.push(fechaReunion);
    }
    if (programa) {
      sql += ' AND COALESCE(programa, '') = ?';
      binds.push(normalizePrograma(programa));
    }
    if (departamento) {
      sql += ' AND COALESCE(departamento, '') = ?';
      binds.push(departamento);
    }
    if (provincia) {
      sql += ' AND COALESCE(provincia, '') = ?';
      binds.push(provincia);
    }
    if (distrito) {
      sql += ' AND COALESCE(distrito, '') = ?';
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
    const body = await readJson(context.request);
    const accion = normalizeAccionPayload(body, auth);

    if (!accion.ds_id || !accion.programa || !accion.codigo) {
      return badRequest('ds_id_programa_codigo_required');
    }

    if (auth.session.role === 'Registrador' && auth.session.programa) {
      if (normalizePrograma(auth.session.programa || '') !== accion.programa) {
        return forbidden('programa_not_allowed');
      }
    }

    const ds = await context.env.DB
      .prepare('SELECT id, numero, locked FROM decretos WHERE id = ? AND deleted_at IS NULL')
      .bind(accion.ds_id)
      .first();

    // Compatibilidad con DS creados/activados en localStorage: si el Decreto Supremo
    // aún no fue confirmado en D1, no bloqueamos el guardado de la acción.
    if (ds && Number(ds.locked) === 1) return badRequest('decreto_locked');

    const now = new Date().toISOString();

    const existente = await context.env.DB.prepare(`
      SELECT id, version
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
      const nextVersion = Number(existente.version || 1) + 1;
      await context.env.DB.prepare(`
        UPDATE acciones
        SET numero_reunion = ?, fecha_reunion = ?, departamento = ?, provincia = ?, distrito = ?,
            subtipo_rehabilitacion = ?, programa = ?, tipo = ?, codigo = ?, detalle = ?, unidad = ?,
            meta_programada = ?, plazo_dias = ?, fecha_inicio = ?, fecha_final = ?, meta_ejecutada = ?,
            avance = ?, descripcion = ?, estado = ?, usuario_registro = ?, fecha_registro = ?,
            version = ?, updated_at = ?
        WHERE id = ?
      `).bind(
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

      return json({ ok: true, id: existente.id, version: nextVersion, updated: true });
    }

    await context.env.DB.prepare(`
      INSERT INTO acciones (
        id, ds_id, numero_reunion, fecha_reunion, departamento, provincia, distrito,
        subtipo_rehabilitacion, programa, tipo, codigo, detalle, unidad,
        meta_programada, plazo_dias, fecha_inicio, fecha_final, meta_ejecutada,
        avance, descripcion, estado, usuario_registro, fecha_registro,
        version, locked, deleted_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, NULL, ?, ?)
    `).bind(
      accion.id,
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

    return json({ ok: true, id: accion.id, version: 1 });
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
    const body = await readJson(context.request);

    if (!body.id || !Number.isInteger(body.version)) {
      return badRequest('id_and_version_required');
    }

    const current = await context.env.DB.prepare(`
      SELECT id, codigo, programa, version, locked, deleted_at
      FROM acciones
      WHERE id = ?
    `).bind(body.id).first();

    if (!current) return notFound('accion_not_found');
    if (current.deleted_at) return badRequest('accion_deleted');
    if (Number(current.locked) === 1) return badRequest('accion_locked');

    const accion = normalizeAccionPayload({ ...body, id: body.id }, auth);

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
      SET numero_reunion = ?, fecha_reunion = ?, departamento = ?, provincia = ?, distrito = ?,
          subtipo_rehabilitacion = ?, programa = ?, tipo = ?, codigo = ?, detalle = ?, unidad = ?,
          meta_programada = ?, plazo_dias = ?, fecha_inicio = ?, fecha_final = ?, meta_ejecutada = ?,
          avance = ?, descripcion = ?, estado = ?, version = ?, updated_at = ?
      WHERE id = ?
    `).bind(
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
  const auth = await requireSessionCompat(context, ['Administrador']);
  if (!auth.ok) return auth.response;

  if (!mustVerifyCsrf(auth, context.request)) {
    return forbidden('invalid_csrf');
  }

  try {
    const url = new URL(context.request.url);
    const id = url.searchParams.get('id');
    if (!id) return badRequest('id_required');

    const current = await context.env.DB
      .prepare('SELECT id, codigo, locked FROM acciones WHERE id = ?')
      .bind(id)
      .first();

    if (!current) return notFound('accion_not_found');
    if (Number(current.locked) === 1) return badRequest('accion_locked');

    const now = new Date().toISOString();

    await context.env.DB
      .prepare('UPDATE acciones SET deleted_at = ?, updated_at = ? WHERE id = ?')
      .bind(now, now, id)
      .run();

    await writeAudit(context.env, {
      actor: auth.session.email,
      action: 'delete_accion',
      detail: current.codigo || id,
      entity_type: 'accion',
      entity_id: id
    });

    return json({ ok: true });
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