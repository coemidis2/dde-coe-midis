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

import { writeAudit } from '../_lib/audit.js';

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase();
}

function valueOf(body, ...keys) {
  for (const key of keys) {
    const value = body?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  return '';
}

function toInt(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function bool01(value) {
  return value === true || value === 1 || value === '1' || normalizeText(value) === 'TRUE' || normalizeText(value) === 'SI' ? 1 : 0;
}

function safeJsonParse(value, fallback) {
  if (!value) return fallback;
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function normalizeRow(row) {
  return {
    ...row,
    sectores: safeJsonParse(row.sectores, []),
    territorio: safeJsonParse(row.territorio, []),
    programasHabilitados: safeJsonParse(row.programas_habilitados, []),
    programas_habilitados: safeJsonParse(row.programas_habilitados, []),
    es_prorroga: Number(row.es_prorroga) === 1,
    esProrroga: Number(row.es_prorroga) === 1,
    rdsActivo: Number(row.rds_activo || 0) === 1,
    rds_activo: Number(row.rds_activo || 0) === 1,
    numeroReunion: row.numero_reunion || '',
    fechaReunion: row.fecha_reunion || '',
    estadoRDS: row.estado_rds || '',
    fechaRegistroRDS: row.fecha_registro_rds || '',
    activadoPor: row.activado_por || '',
    locked: Number(row.locked) === 1,
    deleted: !!row.deleted_at
  };
}

function normalizePayload(body, sessionEmail = '') {
  const numero = String(valueOf(body, 'numero', 'ds', 'decreto', 'decreto_supremo')).trim();
  const anio = String(valueOf(body, 'anio', 'año')).trim();
  const codigo = String(valueOf(body, 'codigo_registro', 'codigoRegistro')).trim() || (numero ? `DS-${String(numero).padStart(3, '0')}-${anio || new Date().getFullYear()}` : '');
  const territorio = Array.isArray(body.territorio) ? body.territorio : safeJsonParse(body.territorio, []);
  const sectores = Array.isArray(body.sectores) ? body.sectores : safeJsonParse(body.sectores, []);
  const programas = Array.isArray(body.programasHabilitados) ? body.programasHabilitados : (Array.isArray(body.programas_habilitados) ? body.programas_habilitados : safeJsonParse(body.programas_habilitados, []));

  return {
    id: String(valueOf(body, 'id') || codigo || newId()),
    codigo_registro: codigo,
    numero,
    anio,
    peligro: String(valueOf(body, 'peligro')).trim(),
    tipo_peligro: String(valueOf(body, 'tipo_peligro', 'tipoPeligro')).trim(),
    plazo_dias: toInt(valueOf(body, 'plazo_dias', 'plazoDias', 'plazo'), 0),
    fecha_inicio: String(valueOf(body, 'fecha_inicio', 'fechaInicio')).trim(),
    fecha_fin: String(valueOf(body, 'fecha_fin', 'fechaFin')).trim(),
    vigencia: String(valueOf(body, 'vigencia')).trim(),
    semaforo: String(valueOf(body, 'semaforo')).trim(),
    motivos: String(valueOf(body, 'motivos', 'exposicion_motivos')).trim(),
    sectores,
    territorio,
    es_prorroga: bool01(valueOf(body, 'es_prorroga', 'esProrroga')),
    ds_origen_id: String(valueOf(body, 'ds_origen_id', 'dsOrigenId', 'ds_origen')).trim(),
    nivel_prorroga: toInt(valueOf(body, 'nivel_prorroga', 'nivelProrroga'), 0),
    cadena: String(valueOf(body, 'cadena')).trim(),
    usuario_registro: String(valueOf(body, 'usuario_registro', 'usuarioRegistro') || sessionEmail || '').trim(),
    fecha_registro: String(valueOf(body, 'fecha_registro', 'fechaRegistro') || new Date().toISOString()).trim(),
    estado: String(valueOf(body, 'estado') || 'activo').trim(),
    rds_activo: bool01(valueOf(body, 'rds_activo', 'rdsActivo')),
    numero_reunion: String(valueOf(body, 'numero_reunion', 'numeroReunion')).trim(),
    fecha_reunion: String(valueOf(body, 'fecha_reunion', 'fechaReunion')).trim(),
    estado_rds: String(valueOf(body, 'estado_rds', 'estadoRDS')).trim(),
    fecha_registro_rds: String(valueOf(body, 'fecha_registro_rds', 'fechaRegistroRDS')).trim(),
    activado_por: String(valueOf(body, 'activado_por', 'activadoPor', 'usuarioActivaRDS') || '').trim(),
    programas_habilitados: programas
  };
}

async function ensureColumn(env, columnSql) {
  try {
    await env.DB.prepare(`ALTER TABLE decretos ADD COLUMN ${columnSql}`).run();
  } catch (_) {
    // La columna ya existe o la migración no aplica. Se ignora para no romper producción.
  }
}

async function ensureSchema(env) {
  await ensureColumn(env, 'plazo_dias INTEGER DEFAULT 0');
  await ensureColumn(env, 'ds_origen_id TEXT');
  await ensureColumn(env, 'nivel_prorroga INTEGER DEFAULT 0');
  await ensureColumn(env, 'cadena TEXT');
  await ensureColumn(env, 'rds_activo INTEGER DEFAULT 0');
  await ensureColumn(env, 'numero_reunion TEXT');
  await ensureColumn(env, 'fecha_reunion TEXT');
  await ensureColumn(env, 'estado_rds TEXT');
  await ensureColumn(env, 'fecha_registro_rds TEXT');
  await ensureColumn(env, 'activado_por TEXT');
  await ensureColumn(env, 'programas_habilitados TEXT');
  await ensureColumn(env, 'created_at TEXT');
  await ensureColumn(env, 'fecha_registro TEXT');
  await ensureColumn(env, 'estado TEXT DEFAULT \'activo\'');
  await ensureColumn(env, 'version INTEGER DEFAULT 1');
  await ensureColumn(env, 'locked INTEGER DEFAULT 0');
  await ensureColumn(env, 'deleted_at TEXT');
  await ensureColumn(env, 'updated_at TEXT');
}

function localHeaderSession(context) {
  const h = context.request.headers;
  const enabled = h.get('x-dee-local-session') === '1';
  const email = String(h.get('x-dee-user-email') || '').trim().toLowerCase();
  const role = String(h.get('x-dee-user-role') || '').trim();
  const programa = String(h.get('x-dee-user-programa') || '').trim();
  if (!enabled || !email || !role) return null;
  return { email, role, rol: role, programa, name: email, local: true };
}

async function requireSessionCompat(context, roles = []) {
  const auth = await requireSession(context, roles);
  if (auth.ok) return { ...auth, local: false };
  const local = localHeaderSession(context);
  if (!local) return auth;
  const roleAllowed = !roles.length || roles.some(r => normalizeText(r) === normalizeText(local.role));
  if (!roleAllowed) return { ok: false, response: forbidden('role_not_allowed') };
  return { ok: true, session: local, local: true };
}

function mustVerifyCsrf(auth, request) {
  return auth?.local ? true : verifyCsrf(request);
}

export async function onRequestGet(context) {
  const auth = await requireSessionCompat(context, ['Administrador', 'Revisor', 'Registrador', 'Consulta']);
  if (!auth.ok) return auth.response;

  try {
    await ensureSchema(context.env);
    const url = new URL(context.request.url);
    const includeDeleted = url.searchParams.get('include_deleted') === '1';

    const sql = `
      SELECT *
      FROM decretos
      ${includeDeleted ? '' : 'WHERE deleted_at IS NULL'}
      ORDER BY COALESCE(fecha_registro, created_at, updated_at) DESC
    `;

    const { results } = await context.env.DB.prepare(sql).all();
    return json({ ok: true, decretos: results.map(normalizeRow), rows: results.map(normalizeRow) });
  } catch (error) {
    return serverError('decretos_fetch_failed', String(error?.message || error));
  }
}

export async function onRequestPost(context) {
  const auth = await requireSessionCompat(context, ['Administrador', 'Revisor', 'Registrador']);
  if (!auth.ok) return auth.response;
  if (!mustVerifyCsrf(auth, context.request)) return forbidden('invalid_csrf');

  try {
    await ensureSchema(context.env);
    const body = await readJson(context.request);
    const d = normalizePayload(body, auth.session.email);

    if (!d.numero || !d.anio || !d.fecha_inicio || !d.fecha_fin) {
      return badRequest('numero_anio_fecha_inicio_fecha_fin_required');
    }

    const now = new Date().toISOString();
    const existing = await context.env.DB.prepare(`
      SELECT id, version, locked, deleted_at
      FROM decretos
      WHERE id = ? OR codigo_registro = ?
      LIMIT 1
    `).bind(d.id, d.codigo_registro).first();

    if (existing && Number(existing.locked) === 1) return badRequest('decreto_locked');

    if (existing) {
      const nextVersion = Number(existing.version || 1) + 1;
      await context.env.DB.prepare(`
        UPDATE decretos
        SET codigo_registro = ?, numero = ?, anio = ?, peligro = ?, tipo_peligro = ?, plazo_dias = ?,
            fecha_inicio = ?, fecha_fin = ?, vigencia = ?, semaforo = ?, motivos = ?, sectores = ?, territorio = ?,
            es_prorroga = ?, ds_origen_id = ?, nivel_prorroga = ?, cadena = ?, usuario_registro = ?, fecha_registro = ?,
            estado = ?, rds_activo = ?, numero_reunion = ?, fecha_reunion = ?, estado_rds = ?, fecha_registro_rds = ?,
            activado_por = ?, programas_habilitados = ?, deleted_at = NULL, version = ?, updated_at = ?
        WHERE id = ?
      `).bind(
        d.codigo_registro, d.numero, d.anio, d.peligro, d.tipo_peligro, d.plazo_dias,
        d.fecha_inicio, d.fecha_fin, d.vigencia, d.semaforo, d.motivos,
        JSON.stringify(d.sectores || []), JSON.stringify(d.territorio || []),
        d.es_prorroga, d.ds_origen_id, d.nivel_prorroga, d.cadena, d.usuario_registro, d.fecha_registro,
        d.estado, d.rds_activo, d.numero_reunion, d.fecha_reunion, d.estado_rds, d.fecha_registro_rds,
        d.activado_por, JSON.stringify(d.programas_habilitados || []), nextVersion, now, existing.id
      ).run();

      await writeAudit(context.env, { actor: auth.session.email, action: 'update_decreto', detail: d.numero, entity_type: 'decreto', entity_id: existing.id });
      return json({ ok: true, id: existing.id, version: nextVersion, updated: true });
    }

    await context.env.DB.prepare(`
      INSERT INTO decretos (
        id, codigo_registro, numero, anio, peligro, tipo_peligro, plazo_dias, fecha_inicio, fecha_fin,
        vigencia, semaforo, motivos, sectores, territorio, es_prorroga, ds_origen_id, nivel_prorroga, cadena,
        usuario_registro, fecha_registro, estado, rds_activo, numero_reunion, fecha_reunion, estado_rds,
        fecha_registro_rds, activado_por, programas_habilitados, version, locked, deleted_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, NULL, ?, ?)
    `).bind(
      d.id, d.codigo_registro, d.numero, d.anio, d.peligro, d.tipo_peligro, d.plazo_dias,
      d.fecha_inicio, d.fecha_fin, d.vigencia, d.semaforo, d.motivos,
      JSON.stringify(d.sectores || []), JSON.stringify(d.territorio || []),
      d.es_prorroga, d.ds_origen_id, d.nivel_prorroga, d.cadena,
      d.usuario_registro, d.fecha_registro, d.estado, d.rds_activo, d.numero_reunion, d.fecha_reunion, d.estado_rds,
      d.fecha_registro_rds, d.activado_por, JSON.stringify(d.programas_habilitados || []), now, now
    ).run();

    await writeAudit(context.env, { actor: auth.session.email, action: 'create_decreto', detail: d.numero, entity_type: 'decreto', entity_id: d.id });
    return json({ ok: true, id: d.id, version: 1 });
  } catch (error) {
    return serverError('decreto_create_failed', String(error?.message || error));
  }
}

export async function onRequestPut(context) {
  return onRequestPost(context);
}

export async function onRequestDelete(context) {
  const auth = await requireSessionCompat(context, ['Administrador']);
  if (!auth.ok) return auth.response;
  if (!mustVerifyCsrf(auth, context.request)) return forbidden('invalid_csrf');

  try {
    await ensureSchema(context.env);
    const url = new URL(context.request.url);
    const id = url.searchParams.get('id');
    if (!id) return badRequest('id_required');

    const current = await context.env.DB.prepare('SELECT id, numero, locked FROM decretos WHERE id = ?').bind(id).first();
    if (!current) return notFound('decreto_not_found');
    if (Number(current.locked) === 1) return badRequest('decreto_locked');

    const now = new Date().toISOString();
    await context.env.DB.prepare('UPDATE decretos SET deleted_at = ?, updated_at = ? WHERE id = ?').bind(now, now, id).run();
    try {
      await context.env.DB.prepare('UPDATE acciones SET deleted_at = ?, updated_at = ? WHERE ds_id = ?').bind(now, now, id).run();
    } catch (_) {}

    await writeAudit(context.env, { actor: auth.session.email, action: 'delete_decreto', detail: current.numero || id, entity_type: 'decreto', entity_id: id });
    return json({ ok: true });
  } catch (error) {
    return serverError('decreto_delete_failed', String(error?.message || error));
  }
}

export async function onRequestPatch(context) {
  const auth = await requireSessionCompat(context, ['Administrador', 'Registrador']);
  if (!auth.ok) return auth.response;
  if (!mustVerifyCsrf(auth, context.request)) return forbidden('invalid_csrf');

  try {
    await ensureSchema(context.env);
    const body = await readJson(context.request);
    if (!body.id) return badRequest('id_required');

    const current = await context.env.DB.prepare('SELECT id, numero FROM decretos WHERE id = ?').bind(body.id).first();
    if (!current) return notFound('decreto_not_found');

    const now = new Date().toISOString();

    if (body.action === 'rds' || body.rdsActivo !== undefined || body.rds_activo !== undefined) {
      const d = normalizePayload({ ...body, id: body.id }, auth.session.email);
      await context.env.DB.prepare(`
        UPDATE decretos
        SET rds_activo = ?, numero_reunion = ?, fecha_reunion = ?, estado_rds = ?, fecha_registro_rds = ?,
            activado_por = ?, programas_habilitados = ?, updated_at = ?
        WHERE id = ?
      `).bind(
        d.rds_activo, d.numero_reunion, d.fecha_reunion, d.estado_rds || (d.rds_activo ? 'Activo' : ''),
        d.fecha_registro_rds || now, d.activado_por || auth.session.email,
        JSON.stringify(d.programas_habilitados || []), now, body.id
      ).run();
      return json({ ok: true });
    }

    const locked = body.locked ? 1 : 0;
    await context.env.DB.prepare('UPDATE decretos SET locked = ?, updated_at = ? WHERE id = ?').bind(locked, now, body.id).run();
    await writeAudit(context.env, { actor: auth.session.email, action: locked ? 'lock_decreto' : 'unlock_decreto', detail: current.numero || body.id, entity_type: 'decreto', entity_id: body.id });
    return json({ ok: true, locked: !!locked });
  } catch (error) {
    return serverError('decreto_patch_failed', String(error?.message || error));
  }
}
