import { json, setCookie, serverError, getCookie } from '../_lib/http.js';
import { getSessionCookieName, getCsrfCookieName, revokeSession } from '../_lib/auth.js';
import { writeAudit } from '../_lib/audit.js';

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
    headers.append('Set-Cookie', setCookie(sessionCookie, '', { maxAge: 0 }));
    headers.append('Set-Cookie', setCookie(csrfCookie, '', { maxAge: 0, httpOnly: false }));

    return json({ ok: true }, { headers });
  } catch (error) {
    return serverError('logout_failed', String(error?.message || error));
  }
}