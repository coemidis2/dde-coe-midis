import { json, unauthorized, serverError } from '../_lib/http.js';
import { getSessionFromRequest } from '../_lib/auth.js';

export async function onRequestGet(context) {
  try {
    const session = await getSessionFromRequest(context);
    if (!session) return unauthorized();
    return json({ ok: true, user: session });
  } catch (error) {
    return serverError('session_failed', String(error?.message || error));
  }
}
