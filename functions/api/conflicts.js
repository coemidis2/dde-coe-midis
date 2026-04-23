import { json, readJson, serverError, forbidden } from '../_lib/http.js';
import { requireSession, verifyCsrf } from '../_lib/auth.js';
import { writeConflict } from '../_lib/audit.js';

export async function onRequestGet(context) {
  const auth = await requireSession(context, ['Administrador']);
  if (!auth.ok) return auth.response;

  try {
    const { results } = await context.env.DB
      .prepare('SELECT * FROM conflictos ORDER BY fecha DESC LIMIT 1000')
      .all();

    return json({ ok: true, rows: results });
  } catch (error) {
    return serverError('conflicts_fetch_failed', String(error?.message || error));
  }
}

export async function onRequestPost(context) {
  const auth = await requireSession(context, ['Administrador', 'Revisor']);
  if (!auth.ok) return auth.response;

  if (!verifyCsrf(context.request)) {
    return forbidden('invalid_csrf');
  }

  try {
    const body = await readJson(context.request);

    await writeConflict(context.env.DB, {
      entidad: body.entidad || '',
      entidad_id: body.entidad_id || '',
      version_local: Number(body.version_local || 0),
      version_servidor: Number(body.version_servidor || 0),
      usuario: auth.session.email,
      estado: body.estado || 'pendiente'
    });

    return json({ ok: true });
  } catch (error) {
    return serverError('conflict_create_failed', String(error?.message || error));
  }
}

export async function onRequestDelete(context) {
  const auth = await requireSession(context, ['Administrador']);
  if (!auth.ok) return auth.response;

  if (!verifyCsrf(context.request)) {
    return forbidden('invalid_csrf');
  }

  try {
    await context.env.DB.prepare('DELETE FROM conflictos').run();
    return json({ ok: true });
  } catch (error) {
    return serverError('conflicts_clear_failed', String(error?.message || error));
  }
}