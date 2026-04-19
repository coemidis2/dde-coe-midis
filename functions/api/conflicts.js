import { json, readJson, serverError } from '../_lib/http.js';
import { requireSession } from '../_lib/auth.js';
import { writeConflict } from '../_lib/audit.js';

export async function onRequestGet(context) {
  const auth = await requireSession(context, ['Administrador']);
  if (!auth.ok) return auth.response;
  try {
    const { results } = await context.env.DB.prepare('SELECT * FROM conflict_log ORDER BY created_at DESC LIMIT 1000').all();
    return json({ ok: true, rows: results });
  } catch (error) {
    return serverError('conflicts_fetch_failed', String(error?.message || error));
  }
}

export async function onRequestPost(context) {
  const auth = await requireSession(context, ['Administrador', 'Evaluador']);
  if (!auth.ok) return auth.response;
  try {
    const body = await readJson(context.request);
    await writeConflict(context.env, body || {});
    return json({ ok: true });
  } catch (error) {
    return serverError('conflict_create_failed', String(error?.message || error));
  }
}
