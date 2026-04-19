import { json, readJson, badRequest, notFound, serverError } from '../_lib/http.js';
import { requireSession, sha256, newId } from '../_lib/auth.js';
import { writeAudit } from '../_lib/audit.js';

export async function onRequestGet(context) {
  const auth = await requireSession(context, ['Administrador']);
  if (!auth.ok) return auth.response;
  try {
    const { results } = await context.env.DB.prepare(`
      SELECT id, email, role, name, programa, active, created_at, updated_at
      FROM users
      ORDER BY role, name
    `).all();
    return json({ ok: true, rows: results });
  } catch (error) {
    return serverError('users_fetch_failed', String(error?.message || error));
  }
}

export async function onRequestPost(context) {
  const auth = await requireSession(context, ['Administrador']);
  if (!auth.ok) return auth.response;
  try {
    const body = await readJson(context.request);
    if (!body.email || !body.password || !body.role || !body.name) {
      return badRequest('name_email_role_password_required');
    }
    const email = String(body.email).trim().toLowerCase();
    const exists = await context.env.DB.prepare('SELECT email FROM users WHERE email = ?').bind(email).first();
    if (exists) return badRequest('email_already_exists');

    const passwordHash = await sha256(body.password);
    await context.env.DB.prepare(`
      INSERT INTO users (id, email, password_hash, role, name, programa, active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      newId(), email, passwordHash, body.role, body.name, body.programa || '', body.active === false ? 0 : 1,
      new Date().toISOString(), new Date().toISOString()
    ).run();

    await writeAudit(context.env, { actor: auth.session.email, action: 'create_user', detail: email, entity_type: 'user', entity_id: email });
    return json({ ok: true });
  } catch (error) {
    return serverError('user_create_failed', String(error?.message || error));
  }
}

export async function onRequestPut(context) {
  const auth = await requireSession(context, ['Administrador']);
  if (!auth.ok) return auth.response;
  try {
    const body = await readJson(context.request);
    if (!body.email) return badRequest('email_required');
    const email = String(body.email).trim().toLowerCase();
    const user = await context.env.DB.prepare('SELECT email FROM users WHERE email = ?').bind(email).first();
    if (!user) return notFound('user_not_found');

    let passwordHashSql = '';
    let passwordHashBind = [];
    if (body.password) {
      passwordHashSql = ', password_hash = ?';
      passwordHashBind = [await sha256(body.password)];
    }

    const binds = [body.role || 'Consulta', body.name || '', body.programa || '', body.active === false ? 0 : 1, new Date().toISOString(), ...passwordHashBind, email];
    await context.env.DB.prepare(`
      UPDATE users
      SET role = ?, name = ?, programa = ?, active = ?, updated_at = ?${passwordHashSql}
      WHERE email = ?
    `).bind(...binds).run();

    await writeAudit(context.env, { actor: auth.session.email, action: 'update_user', detail: email, entity_type: 'user', entity_id: email });
    return json({ ok: true });
  } catch (error) {
    return serverError('user_update_failed', String(error?.message || error));
  }
}
