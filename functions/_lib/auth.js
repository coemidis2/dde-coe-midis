import { getCookie, unauthorized, forbidden } from './http.js';

const SESSION_COOKIE = 'dee_session';

function toHex(buffer) {
  return [...new Uint8Array(buffer)].map(b => b.toString(16).padStart(2, '0')).join('');
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

export async function createSession(env, user, ttlSeconds = 60 * 60 * 12) {
  const token = newId();
  const now = new Date();
  const expires = new Date(now.getTime() + ttlSeconds * 1000).toISOString();

  await env.DB.prepare(`
    INSERT INTO sessions (id, token, email, role, name, programa, created_at, expires_at, revoked_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
  `).bind(
    newId(), token, user.email, user.role, user.name || '', user.programa || '', now.toISOString(), expires
  ).run();

  return { token, expiresAt: expires };
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

  return {
    token: row.token,
    email: row.email,
    role: row.role,
    name: row.name,
    programa: row.programa,
    expiresAt: row.expires_at,
  };
}

export async function requireSession(context, allowedRoles = []) {
  const session = await getSessionFromRequest(context);
  if (!session) return { ok: false, response: unauthorized() };
  if (allowedRoles.length && !allowedRoles.includes(session.role)) {
    return { ok: false, response: forbidden('role_not_allowed') };
  }
  return { ok: true, session };
}
