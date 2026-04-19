import { json, readJson, badRequest, notFound, serverError } from '../_lib/http.js';
import { requireSession, newId } from '../_lib/auth.js';
import { writeAudit, writeConflict } from '../_lib/audit.js';

function normalizeRow(row) {
  return {
    ...row,
    sectores: row.sectores ? JSON.parse(row.sectores) : [],
    territorio: row.territorio ? JSON.parse(row.territorio) : [],
    es_prorroga: Number(row.es_prorroga) === 1,
    locked: Number(row.locked) === 1,
    deleted: !!row.deleted_at,
  };
}

export async function onRequestGet(context) {
  const auth = await requireSession(context, ['Administrador', 'Evaluador', 'Registrador', 'Consulta']);
  if (!auth.ok) return auth.response;
  try {
    const url = new URL(context.request.url);
    const includeDeleted = url.searchParams.get('include_deleted') === '1';
    const sql = `
      SELECT *
      FROM decretos
      ${includeDeleted ? '' : 'WHERE deleted_at IS NULL'}
      ORDER BY fecha_registro DESC
    `;
    const { results } = await context.env.DB.prepare(sql).all();
    return json({ ok: true, rows: results.map(normalizeRow) });
  } catch (error) {
    return serverError('decretos_fetch_failed', String(error?.message || error));
  }
}

export async function onRequestPost(context) {
  const auth = await requireSession(context, ['Administrador', 'Evaluador']);
  if (!auth.ok) return auth.response;
  try {
    const body = await readJson(context.request);
    if (!body.numero || !body.anio || !body.fecha_inicio || !body.fecha_fin) {
      return badRequest('numero_anio_fecha_inicio_fecha_fin_required');
    }
    const id = body.id || newId();
    const now = new Date().toISOString();

    await context.env.DB.prepare(`
      INSERT INTO decretos (
        id, codigo_registro, numero, anio, peligro, tipo_peligro,
        fecha_inicio, fecha_fin, vigencia, semaforo, motivos,
        sectores, territorio, es_prorroga, ds_origen_id, ds_origen_numero,
        nivel_prorroga, cadena_id, usuario_registro, fecha_registro,
        version, locked, deleted_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, NULL, ?)
    `).bind(
      id,
      body.codigo_registro || '',
      body.numero,
      body.anio,
      body.peligro || '',
      body.tipo_peligro || '',
      body.fecha_inicio,
      body.fecha_fin,
      body.vigencia || '',
      body.semaforo || '',
      body.motivos || '',
      JSON.stringify(body.sectores || []),
      JSON.stringify(body.territorio || []),
      body.es_prorroga ? 1 : 0,
      body.ds_origen_id || null,
      body.ds_origen_numero || null,
      body.nivel_prorroga || 0,
      body.cadena_id || '',
      auth.session.email,
      now,
      now
    ).run();

    await writeAudit(context.env, { actor: auth.session.email, action: 'create_decreto', detail: body.numero, entity_type: 'decreto', entity_id: id });
    return json({ ok: true, id, version: 1 });
  } catch (error) {
    return serverError('decreto_create_failed', String(error?.message || error));
  }
}

export async function onRequestPut(context) {
  const auth = await requireSession(context, ['Administrador', 'Evaluador']);
  if (!auth.ok) return auth.response;
  try {
    const body = await readJson(context.request);
    if (!body.id || !Number.isInteger(body.version)) return badRequest('id_and_version_required');

    const current = await context.env.DB.prepare('SELECT id, numero, version, locked, deleted_at FROM decretos WHERE id = ?').bind(body.id).first();
    if (!current) return notFound('decreto_not_found');
    if (current.deleted_at) return badRequest('decreto_deleted');
    if (Number(current.locked) === 1) return badRequest('decreto_locked');
    if (Number(current.version) !== Number(body.version)) {
      await writeConflict(context.env, {
        codigo: current.numero || body.id,
        motivo: 'version_mismatch',
        estado_local_servidor: `local=${body.version} / servidor=${current.version}`,
        resolucion_aplicada: 'rechazado'
      });
      return json({ ok: false, error: 'version_mismatch', serverVersion: Number(current.version) }, { status: 409 });
    }

    const nextVersion = Number(current.version) + 1;
    await context.env.DB.prepare(`
      UPDATE decretos
      SET codigo_registro = ?, numero = ?, anio = ?, peligro = ?, tipo_peligro = ?,
          fecha_inicio = ?, fecha_fin = ?, vigencia = ?, semaforo = ?, motivos = ?,
          sectores = ?, territorio = ?, es_prorroga = ?, ds_origen_id = ?, ds_origen_numero = ?,
          nivel_prorroga = ?, cadena_id = ?, version = ?, updated_at = ?
      WHERE id = ?
    `).bind(
      body.codigo_registro || '', body.numero || '', body.anio || '', body.peligro || '', body.tipo_peligro || '',
      body.fecha_inicio || '', body.fecha_fin || '', body.vigencia || '', body.semaforo || '', body.motivos || '',
      JSON.stringify(body.sectores || []), JSON.stringify(body.territorio || []), body.es_prorroga ? 1 : 0,
      body.ds_origen_id || null, body.ds_origen_numero || null, body.nivel_prorroga || 0,
      body.cadena_id || '', nextVersion, new Date().toISOString(), body.id
    ).run();

    await writeAudit(context.env, { actor: auth.session.email, action: 'update_decreto', detail: body.numero || body.id, entity_type: 'decreto', entity_id: body.id });
    return json({ ok: true, version: nextVersion });
  } catch (error) {
    return serverError('decreto_update_failed', String(error?.message || error));
  }
}

export async function onRequestDelete(context) {
  const auth = await requireSession(context, ['Administrador']);
  if (!auth.ok) return auth.response;
  try {
    const url = new URL(context.request.url);
    const id = url.searchParams.get('id');
    if (!id) return badRequest('id_required');
    const current = await context.env.DB.prepare('SELECT id, numero, locked FROM decretos WHERE id = ?').bind(id).first();
    if (!current) return notFound('decreto_not_found');
    if (Number(current.locked) === 1) return badRequest('decreto_locked');
    await context.env.DB.prepare('UPDATE decretos SET deleted_at = ?, updated_at = ? WHERE id = ?').bind(new Date().toISOString(), new Date().toISOString(), id).run();
    await writeAudit(context.env, { actor: auth.session.email, action: 'delete_decreto', detail: current.numero || id, entity_type: 'decreto', entity_id: id });
    return json({ ok: true });
  } catch (error) {
    return serverError('decreto_delete_failed', String(error?.message || error));
  }
}

export async function onRequestPatch(context) {
  const auth = await requireSession(context, ['Administrador']);
  if (!auth.ok) return auth.response;
  try {
    const body = await readJson(context.request);
    if (!body.id) return badRequest('id_required');
    const current = await context.env.DB.prepare('SELECT id, numero, locked FROM decretos WHERE id = ?').bind(body.id).first();
    if (!current) return notFound('decreto_not_found');
    const locked = body.locked ? 1 : 0;
    await context.env.DB.prepare('UPDATE decretos SET locked = ?, updated_at = ? WHERE id = ?').bind(locked, new Date().toISOString(), body.id).run();
    await writeAudit(context.env, { actor: auth.session.email, action: locked ? 'lock_decreto' : 'unlock_decreto', detail: current.numero || body.id, entity_type: 'decreto', entity_id: body.id });
    return json({ ok: true, locked: !!locked });
  } catch (error) {
    return serverError('decreto_patch_failed', String(error?.message || error));
  }
}
