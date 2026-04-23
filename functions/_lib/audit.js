import { newId } from './auth.js';

export async function writeAudit(env, data) {
  try {
    const id = newId();
    const now = new Date().toISOString();

    await env.DB.prepare(`
      INSERT INTO audit_log (
        id,
        actor,
        action,
        detail,
        entity_type,
        entity_id,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id,
      data.actor || '',
      data.action || '',
      data.detail || '',
      data.entity_type || '',
      data.entity_id || '',
      now
    ).run();

    console.log('AUDIT OK:', {
      id,
      actor: data.actor || '',
      action: data.action || '',
      detail: data.detail || ''
    });
  } catch (e) {
    console.error('AUDIT ERROR:', e);
  }
}
export async function writeConflict(db, data) {
  await db.prepare(`
    INSERT INTO conflictos (
      id,
      codigo,
      motivo,
      estado_local,
      estado_servidor,
      created_at
    ) VALUES (?, ?, ?, ?, ?, datetime('now'))
  `).bind(
    crypto.randomUUID(),
    data.codigo || '',
    data.motivo || '',
    data.estado_local || '',
    data.estado_servidor || ''
  ).run();
}