import { json, serverError } from '../_lib/http.js';

export async function onRequestGet(context) {
  try {
    const pong = await context.env.DB.prepare('SELECT 1 AS ok').first();
    return json({ ok: true, at: new Date().toISOString(), db: pong?.ok === 1 });
  } catch (error) {
    return serverError('health_failed', String(error?.message || error));
  }
}
