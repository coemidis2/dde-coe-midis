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
  const auth = await requireSession(context, [
    'Administrador',
    'Revisor',
    'Registrador',
    'Consulta'
  ]);
  if (!auth.ok) return auth.response;

  try {
    const url = new URL(context.request.url);
    const dsId = url.searchParams.get('ds_id');

    let sql = 'SELECT * FROM acciones WHERE deleted_at IS NULL';
    const binds = [];

    if (dsId) {
      sql += ' AND ds_id = ?';
      binds.push(dsId);
    }

    if (auth.session.role === 'Registrador') {
      sql += ' AND programa = ?';
      binds.push(auth.session.programa || '');
    }

    sql += ' ORDER BY fecha_registro DESC';

    const { results } = await context.env.DB.prepare(sql).bind(...binds).all();
    return json({ ok: true, rows: results.map(normalizeRow) });
  } catch (error) {
    return serverError('acciones_fetch_failed', String(error?.message || error));
  }
}

export async function onRequestPost(context) {
  const auth = await requireSession(context, ['Administrador', 'Revisor', 'Registrador']);
  if (!auth.ok) return auth.response;

  if (!verifyCsrf(context.request)) {
    return forbidden('invalid_csrf');
  }

  try {
    const body = await readJson(context.request);

    if (!body.ds_id || !body.programa || !body.codigo) {
      return badRequest('ds_id_programa_codigo_required');
    }

    if (auth.session.role === 'Registrador') {
      if ((auth.session.programa || '') !== (body.programa || '')) {
        return forbidden('programa_not_allowed');
      }
    }

    const ds = await context.env.DB
      .prepare('SELECT id, numero, locked FROM decretos WHERE id = ? AND deleted_at IS NULL')
      .bind(body.ds_id)
      .first();

    if (!ds) return badRequest('decreto_not_available');
    if (Number(ds.locked) === 1) return badRequest('decreto_locked');

    const id = body.id || newId();
    const now = new Date().toISOString();

    await context.env.DB.prepare(`
      INSERT INTO acciones (
        id, ds_id, reunion, fecha_reunion, programa, tipo, codigo,
        detalle, unidad, meta_programada, plazo, fecha_inicio, fecha_final,
        meta_ejecutada, avance, descripcion, estado, usuario_registro,
        fecha_registro, version, locked, deleted_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, NULL, ?)
    `).bind(
      id,
      body.ds_id,
      body.reunion || '',
      body.fecha_reunion || '',
      body.programa || '',
      body.tipo || '',
      body.codigo || '',
      body.detalle || '',
      body.unidad || '',
      Number(body.meta_programada || 0),
      Number(body.plazo || 0),
      body.fecha_inicio || '',
      body.fecha_final || '',
      Number(body.meta_ejecutada || 0),
      Number(body.avance || 0),
      body.descripcion || '',
      body.estado || 'Registrado',
      auth.session.email,
      now,
      now
    ).run();

    await writeAudit(context.env, {
      actor: auth.session.email,
      action: 'create_accion',
      detail: `${body.programa} | ${body.codigo}`,
      entity_type: 'accion',
      entity_id: id
    });

    return json({ ok: true, id, version: 1 });
  } catch (error) {
    return serverError('accion_create_failed', String(error?.message || error));
  }
}

export async function onRequestPut(context) {
  const auth = await requireSession(context, ['Administrador', 'Revisor', 'Registrador']);
  if (!auth.ok) return auth.response;

  if (!verifyCsrf(context.request)) {
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

    if (auth.session.role === 'Registrador') {
      if ((auth.session.programa || '') !== (current.programa || '')) {
        return forbidden('programa_not_allowed');
      }
      if ((auth.session.programa || '') !== (body.programa || current.programa || '')) {
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
      SET reunion = ?, fecha_reunion = ?, programa = ?, tipo = ?, codigo = ?, detalle = ?, unidad = ?,
          meta_programada = ?, plazo = ?, fecha_inicio = ?, fecha_final = ?, meta_ejecutada = ?,
          avance = ?, descripcion = ?, estado = ?, version = ?, updated_at = ?
      WHERE id = ?
    `).bind(
      body.reunion || '',
      body.fecha_reunion || '',
      body.programa || '',
      body.tipo || '',
      body.codigo || '',
      body.detalle || '',
      body.unidad || '',
      Number(body.meta_programada || 0),
      Number(body.plazo || 0),
      body.fecha_inicio || '',
      body.fecha_final || '',
      Number(body.meta_ejecutada || 0),
      Number(body.avance || 0),
      body.descripcion || '',
      body.estado || 'Registrado',
      nextVersion,
      now,
      body.id
    ).run();

    await writeAudit(context.env, {
      actor: auth.session.email,
      action: 'update_accion',
      detail: body.codigo || body.id,
      entity_type: 'accion',
      entity_id: body.id
    });

    return json({ ok: true, version: nextVersion });
  } catch (error) {
    return serverError('accion_update_failed', String(error?.message || error));
  }
}

export async function onRequestDelete(context) {
  const auth = await requireSession(context, ['Administrador']);
  if (!auth.ok) return auth.response;

  if (!verifyCsrf(context.request)) {
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
  const auth = await requireSession(context, ['Administrador', 'Revisor']);
  if (!auth.ok) return auth.response;

  if (!verifyCsrf(context.request)) {
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