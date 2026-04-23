import {
  json,
  forbidden,
  serverError
} from '../_lib/http.js';

import {
  requireSession,
  verifyCsrf
} from '../_lib/auth.js';

export async function onRequestGet(context) {
  const auth = await requireSession(context, ['Administrador']);
  if (!auth.ok) return auth.response;

  try {
    const url = new URL(context.request.url);
    const actor = url.searchParams.get('actor');
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');

    let sql = 'SELECT * FROM audit_log WHERE 1=1';
    const binds = [];

    if (actor) {
      sql += ' AND actor = ?';
      binds.push(actor);
    }

    if (from) {
      sql += ' AND created_at >= ?';
      binds.push(from);
    }

    if (to) {
      sql += ' AND created_at <= ?';
      binds.push(to);
    }

    sql += ' ORDER BY created_at DESC LIMIT 1000';

    const { results } = await context.env.DB.prepare(sql).bind(...binds).all();
    return json({ ok: true, rows: results });
  } catch (error) {
    return serverError('audit_fetch_failed', String(error?.message || error));
  }
}

export async function onRequestDelete(context) {
  const auth = await requireSession(context, ['Administrador']);
  if (!auth.ok) return auth.response;

  if (!verifyCsrf(context.request)) {
    return forbidden('invalid_csrf');
  }

  try {
    await context.env.DB.prepare('DELETE FROM audit_log').run();
    return json({ ok: true });
  } catch (error) {
    return serverError('audit_clear_failed', String(error?.message || error));
  }
}