import { json, readJson, badRequest, unauthorized, serverError } from '../_lib/http.js';
import { createSession, getSessionCookieName, setCookie } from '../_lib/auth.js';

export async function onRequestPost(context) {
  try {
    const { email, password } = await readJson(context.request);
    if (!email || !password) return badRequest('email_and_password_required');

    const normalizedEmail = String(email).trim().toLowerCase();

    // BYPASS TEMPORAL PARA PRUEBA
    if (normalizedEmail === 'admin@midis.gob.pe' && password === 'AdminMIDIS2026!') {
      const user = {
        email: 'admin@midis.gob.pe',
        role: 'Administrador',
        name: 'Administrador MIDIS',
        programa: '',
        active: 1
      };

      const session = await createSession(context.env, user);

      return json(
        {
          ok: true,
          user,
          expiresAt: session.expiresAt
        },
        {
          headers: {
            'Set-Cookie': setCookie(getSessionCookieName(), session.token, { maxAge: 60 * 60 * 12 })
          }
        }
      );
    }

    return unauthorized('invalid_credentials');
  } catch (error) {
    return serverError('login_failed', String(error?.message || error));
  }
}