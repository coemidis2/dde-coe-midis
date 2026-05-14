import { json, setCookie, serverError, getCookie } from '../_lib/http.js';
import { getSessionCookieName, getCsrfCookieName, revokeSession } from '../_lib/auth.js';
import { writeAudit } from '../_lib/audit.js';

function clearCookie(name, options = {}) {
  const parts = [`${name}=`];
  parts.push('Path=/');
  parts.push('Secure');
  parts.push(`SameSite=${options.sameSite || 'Lax'}`);
  if (options.httpOnly !== false) parts.push('HttpOnly');
  parts.push('Max-Age=0');
  parts.push('Expires=Thu, 01 Jan 1970 00:00:00 GMT');
  return parts.join('; ');
}

export async function onRequestPost(context) {
  try {
    const sessionCookie = getSessionCookieName();
    const csrfCookie = getCsrfCookieName();
    const token = getCookie(context.request, sessionCookie);

    if (token) {
      const session = await context.env.DB
        .prepare('SELECT email FROM sessions WHERE token = ?')
        .bind(token)
        .first();

      await revokeSession(context.env, token);

      if (session?.email) {
        await writeAudit(context.env, {
          actor: session.email,
          action: 'logout',
          detail: 'Cierre de sesión',
          entity_type: 'user',
          entity_id: ''
        });
      }
    }

    const headers = new Headers();
    headers.append('Set-Cookie', clearCookie(sessionCookie, { httpOnly: true, sameSite: 'Lax' }));
    headers.append('Set-Cookie', clearCookie(csrfCookie, { httpOnly: false, sameSite: 'Lax' }));

    return json({ ok: true }, { headers });
  } catch (error) {
    return serverError('logout_failed', String(error?.message || error));
  }
}