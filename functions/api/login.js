import { json, readJson, badRequest, unauthorized, serverError, setCookie } from '../_lib/http.js';
import { sha256, createSession, getSessionCookieName } from '../_lib/auth.js';
import { writeAudit } from '../_lib/audit.js';

export async function onRequestPost(context) {
  try {
    const { email, password } = await readJson(context.request);
    if (!email || !password) return badRequest('email_and_password_required');

    const passwordHash = await sha256(password);
    const user = await context.env.DB.prepare(`
      SELECT email, role, name, programa, active
      FROM users
      WHERE email = ? AND password_hash = ?
    `).bind(String(email).trim().toLowerCase(), passwordHash).first();

    if (!user || Number(user.active) !== 1) {
      return unauthorized('invalid_credentials');
    }

    const session = await createSession(context.env, user);
    await writeAudit(context.env, { actor: user.email, action: 'login', detail: 'Inicio de sesión' });

    return json({
      ok: true,
      user: {
        email: user.email,
        role: user.role,
        name: user.name,
        programa: user.programa || ''
      },
      expiresAt: session.expiresAt
    }, {
      headers: {
        'Set-Cookie': setCookie(getSessionCookieName(), session.token, { maxAge: 60 * 60 * 12 })
      }
    });
  } catch (error) {
    return serverError('login_failed', String(error?.message || error));
  }
}
