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
  sha256,
  newId
} from '../_lib/auth.js';

import { writeAudit } from '../_lib/audit.js';

function normalizeUser(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    programa: row.programa || '',
    active: Number(row.active) === 1,
    force_password_change: Number(row.force_password_change) === 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
    last_login_at: row.last_login_at || null
  };
}

function normalizeRoleInput(role, programa) {
  const rawRole = String(role || '').trim();
  const rawPrograma = String(programa || '').trim();

  if (!rawRole) return { role: '', programa: '' };

  if (rawRole.startsWith('Registrador|')) {
    const parts = rawRole.split('|');
    return {
      role: 'Registrador',
      programa: (parts[1] || '').trim()
    };
  }

  if (rawRole === 'Registrador') {
    return {
      role: 'Registrador',
      programa: rawPrograma
    };
  }

  return {
    role: rawRole === 'Evaluador' ? 'Revisor' : rawRole,
    programa: ''
  };
}

function isValidRole(role) {
  return ['Administrador', 'Revisor', 'Registrador', 'Consulta'].includes(role);
}

function generateTemporaryPassword(length = 10) {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const nums = '23456789';
  const symbols = '@#$%';
  const all = upper + lower + nums + symbols;

  let password = '';
  password += upper[Math.floor(Math.random() * upper.length)];
  password += lower[Math.floor(Math.random() * lower.length)];
  password += nums[Math.floor(Math.random() * nums.length)];
  password += symbols[Math.floor(Math.random() * symbols.length)];

  for (let i = 4; i < length; i++) {
    password += all[Math.floor(Math.random() * all.length)];
  }

  return password.split('').sort(() => Math.random() - 0.5).join('');
}

export async function onRequestGet(context) {
  const auth = await requireSession(context, ['Administrador']);
  if (!auth.ok) return auth.response;

  try {
    const { results } = await context.env.DB.prepare(`
      SELECT
        id,
        name,
        email,
        role,
        programa,
        active,
        force_password_change,
        created_at,
        updated_at,
        last_login_at
      FROM users
      ORDER BY created_at DESC
    `).all();

    return json({
      ok: true,
      users: results.map(normalizeUser)
    });
  } catch (error) {
    return serverError('users_fetch_failed', String(error?.message || error));
  }
}

export async function onRequestPost(context) {
  const auth = await requireSession(context, ['Administrador']);
  if (!auth.ok) return auth.response;

  if (!verifyCsrf(context.request)) {
    return forbidden('invalid_csrf');
  }

  try {
    const body = await readJson(context.request);

    const name = String(body.name || '').trim();
    const email = String(body.email || '').trim().toLowerCase();

    if (!name || !email || !body.role) {
      return badRequest('name_email_role_required');
    }

    const normalized = normalizeRoleInput(body.role, body.programa);
    const role = normalized.role;
    const programa = normalized.programa;

    if (!isValidRole(role)) {
      return badRequest('invalid_role');
    }

    if (role === 'Registrador' && !programa) {
      return badRequest('programa_required_for_registrador');
    }

    const existing = await context.env.DB
      .prepare('SELECT id FROM users WHERE email = ?')
      .bind(email)
      .first();

    if (existing) {
      return badRequest('email_already_exists');
    }

    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await sha256(temporaryPassword);
    const now = new Date().toISOString();
    const id = newId();

    await context.env.DB.prepare(`
      INSERT INTO users (
        id,
        name,
        email,
        role,
        programa,
        password_hash,
        active,
        force_password_change,
        created_at,
        updated_at,
        last_login_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id,
      name,
      email,
      role,
      programa,
      passwordHash,
      1,
      1,
      now,
      now,
      null
    ).run();

    await writeAudit(context.env, {
      actor: auth.session.email,
      action: 'create_user',
      detail: email,
      entity_type: 'user',
      entity_id: id
    });

    return json({
      ok: true,
      id,
      temporaryPassword
    });
  } catch (error) {
    return serverError('user_create_failed', String(error?.message || error));
  }
}

export async function onRequestPatch(context) {
  const auth = await requireSession(context, ['Administrador']);
  if (!auth.ok) return auth.response;

  if (!verifyCsrf(context.request)) {
    return forbidden('invalid_csrf');
  }

  try {
    const body = await readJson(context.request);
    const action = String(body.action || '').trim();
    const id = body.id;

    if (id === undefined || id === null || id === '') {
      return badRequest('id_required');
    }

    const current = await context.env.DB.prepare(`
      SELECT id, name, email, role, programa, active
      FROM users
      WHERE id = ?
    `).bind(id).first();

    if (!current) {
      return notFound('user_not_found');
    }

    const now = new Date().toISOString();

    if (action === 'status') {
      const active = body.active ? 1 : 0;

      await context.env.DB.prepare(`
        UPDATE users
        SET active = ?, updated_at = ?
        WHERE id = ?
      `).bind(active, now, id).run();

      if (!active) {
        await context.env.DB.prepare(`
          UPDATE sessions
          SET revoked_at = ?
          WHERE email = ? AND revoked_at IS NULL
        `).bind(now, current.email).run();
      }

      await writeAudit(context.env, {
        actor: auth.session.email,
        action: active ? 'activate_user' : 'deactivate_user',
        detail: current.email,
        entity_type: 'user',
        entity_id: String(id)
      });

      return json({
        ok: true,
        active: !!active
      });
    }

    if (action === 'reset_password') {
      const temporaryPassword = generateTemporaryPassword();
      const passwordHash = await sha256(temporaryPassword);

      await context.env.DB.prepare(`
        UPDATE users
        SET password_hash = ?, force_password_change = 1, updated_at = ?
        WHERE id = ?
      `).bind(passwordHash, now, id).run();

      await context.env.DB.prepare(`
        UPDATE sessions
        SET revoked_at = ?
        WHERE email = ? AND revoked_at IS NULL
      `).bind(now, current.email).run();

      await writeAudit(context.env, {
        actor: auth.session.email,
        action: 'reset_password',
        detail: current.email,
        entity_type: 'user',
        entity_id: String(id)
      });

      return json({
        ok: true,
        temporaryPassword
      });
    }

    return badRequest('invalid_action');
  } catch (error) {
    return serverError('user_patch_failed', String(error?.message || error));
  }
}