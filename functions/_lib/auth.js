import { getCookie, unauthorized, forbidden, setCookie } from './http.js';

const SESSION_COOKIE = 'dee_session';
const CSRF_COOKIE = 'dee_csrf';

function toHex(buffer) {
  return [...new Uint8Array(buffer)]
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function sha256(text) {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return toHex(digest);
}

export function newId() {
  return crypto.randomUUID();
}

export function getSessionCookieName() {
  return SESSION_COOKIE;
}

export function getCsrfCookieName() {
  return CSRF_COOKIE;
}

export function newCsrfToken() {
  return crypto.randomUUID();
}

export async function createSession(env, user, ttlSeconds = 60 * 60 * 12) {
  const token = newId();
  const now = new Date();
  const expires = new Date(now.getTime() + ttlSeconds * 1000).toISOString();

  await env.DB.prepare(`
    INSERT INTO sessions (
      id, token, email, role, name, programa,
      created_at, expires_at, revoked_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
  `).bind(
    newId(),
    token,
    user.email,
    user.role,
    user.name || '',
    user.programa || '',
    now.toISOString(),
    expires
  ).run();

  return { token, expiresAt: expires };
}

export async function revokeSession(env, token) {
  if (!token) return;
  await env.DB.prepare(`
    UPDATE sessions
    SET revoked_at = ?
    WHERE token = ?
  `).bind(new Date().toISOString(), token).run();
}

export async function getSessionFromRequest(context) {
  const token = getCookie(context.request, SESSION_COOKIE);
  if (!token) return null;

  const row = await context.env.DB.prepare(`
    SELECT token, email, role, name, programa, expires_at, revoked_at
    FROM sessions
    WHERE token = ?
  `).bind(token).first();

  if (!row) return null;
  if (row.revoked_at) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;

  const user = await context.env.DB.prepare(`
    SELECT email, role, name, programa, active
    FROM users
    WHERE email = ?
  `).bind(row.email).first();

  if (!user) return null;
  if (Number(user.active) !== 1) return null;

  const normalizedRole = user.role === 'Evaluador' ? 'Revisor' : user.role;

  return {
    token: row.token,
    email: user.email,
    role: normalizedRole,
    name: user.name || row.name || '',
    programa: user.programa || row.programa || '',
    expiresAt: row.expires_at
  };
}

export async function requireSession(context, allowedRoles = []) {
  const session = await getSessionFromRequest(context);

  if (!session) {
    return { ok: false, response: unauthorized('session_invalid') };
  }

  if (allowedRoles.length && !allowedRoles.includes(session.role)) {
    return { ok: false, response: forbidden('role_not_allowed') };
  }

  return { ok: true, session };
}

export function verifyCsrf(request) {
  const method = request.method.toUpperCase();

  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    return true;
  }

  const cookieToken = getCookie(request, CSRF_COOKIE);
  const headerToken = request.headers.get('x-csrf-token') || '';

  return !!cookieToken && !!headerToken && cookieToken === headerToken;
}

export { setCookie };