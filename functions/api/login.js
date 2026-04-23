import {
  json,
  readJson,
  badRequest,
  unauthorized,
  serverError,
  setCookie,
  tooManyRequests
} from '../_lib/http.js';

import {
  createSession,
  getSessionCookieName,
  getCsrfCookieName,
  newCsrfToken,
  sha256
} from '../_lib/auth.js';

import { writeAudit } from '../_lib/audit.js';

function getClientIp(request) {
  return request.headers.get('CF-Connecting-IP') || 'unknown';
}

export async function onRequestPost(context) {
  try {
    const ip = getClientIp(context.request);
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();

    const row = await context.env.DB.prepare(`
      SELECT COUNT(*) AS total
      FROM login_attempts
      WHERE ip = ? AND created_at >= ?
    `).bind(ip, tenMinAgo).first();

    if (Number(row?.total || 0) >= 5) {
      return tooManyRequests('too_many_login_attempts');
    }

    const { email, password } = await readJson(context.request);
    if (!email || !password) return badRequest('email_and_password_required');

    const normalizedEmail = String(email).trim().toLowerCase();

    const user = await context.env.DB.prepare(`
      SELECT
        id,
        email,
        password_hash,
        role,
        name,
        programa,
        active
      FROM users
      WHERE email = ?
    `).bind(normalizedEmail).first();

    if (!user || Number(user.active) !== 1) {
      await context.env.DB.prepare(`
        INSERT INTO login_attempts (ip, email, created_at)
        VALUES (?, ?, ?)
      `).bind(ip, normalizedEmail, new Date().toISOString()).run();

      return unauthorized('invalid_credentials');
    }

    const passwordHash = await sha256(password);

    if (passwordHash !== user.password_hash) {
      await context.env.DB.prepare(`
        INSERT INTO login_attempts (ip, email, created_at)
        VALUES (?, ?, ?)
      `).bind(ip, normalizedEmail, new Date().toISOString()).run();

      return unauthorized('invalid_credentials');
    }

    const sessionUser = {
      email: user.email,
      role: user.role === 'Evaluador' ? 'Revisor' : user.role,
      name: user.name || '',
      programa: user.programa || ''
    };

    const session = await createSession(context.env, sessionUser);
    const csrfToken = newCsrfToken();
    const now = new Date().toISOString();

    await context.env.DB.prepare(`
      UPDATE users
      SET last_login_at = ?, updated_at = ?
      WHERE email = ?
    `).bind(now, now, user.email).run();

    await writeAudit(context.env, {
      actor: user.email,
      action: 'login',
      detail: 'Inicio de sesión',
      entity_type: 'user',
      entity_id: String(user.id || '')
    });

    const headers = new Headers();
    headers.append(
      'Set-Cookie',
      setCookie(getSessionCookieName(), session.token, { maxAge: 60 * 60 * 12 })
    );
    headers.append(
      'Set-Cookie',
      setCookie(getCsrfCookieName(), csrfToken, {
        maxAge: 60 * 60 * 12,
        httpOnly: false
      })
    );

    return json(
      {
        ok: true,
        user: sessionUser,
        expiresAt: session.expiresAt
      },
      { headers }
    );
  } catch (error) {
    return serverError('login_failed', String(error?.message || error));
  }
}