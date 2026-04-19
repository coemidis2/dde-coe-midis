import { json, setCookie, serverError } from '../_lib/http.js';
import { getCookie } from '../_lib/http.js';
import { getSessionCookieName } from '../_lib/auth.js';
import { writeAudit } from '../_lib/audit.js';

export async function onRequestPost(context) {
  try {
    const cookieName = getSessionCookieName();
    const token = getCookie(context.request, cookieName);
    if (token) {
      const session = await context.env.DB.prepare('SELECT email FROM sessions WHERE token = ?').bind(token).first();
      await context.env.DB.prepare('UPDATE sessions SET revoked_at = ? WHERE token = ?').bind(new Date().toISOString(), token).run();
      if (session?.email) {
        await writeAudit(context.env, { actor: session.email, action: 'logout', detail: 'Cierre de sesión' });
      }
    }
    return json({ ok: true }, {
      headers: {
        'Set-Cookie': setCookie(cookieName, '', { maxAge: 0 })
      }
    });
  } catch (error) {
    return serverError('logout_failed', String(error?.message || error));
  }
}
