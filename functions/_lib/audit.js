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
  try {
    const id = newId();
    const now = new Date().toISOString();

    await db.prepare(`
      INSERT INTO conflictos (
        id,
        entidad,
        entidad_id,
        version_local,
        version_servidor,
        usuario,
        fecha,
        estado
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id,
      data.entidad || '',
      data.entidad_id || '',
      Number(data.version_local || 0),
      Number(data.version_servidor || 0),
      data.usuario || '',
      now,
      data.estado || 'pendiente'
    ).run();
  } catch (e) {
    console.error('CONFLICT ERROR:', e);
  }
}