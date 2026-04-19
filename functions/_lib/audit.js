export async function writeAudit(env, { actor = 'sistema', action, detail = '', entity_type = '', entity_id = '' }) {
  await env.DB.prepare(`
    INSERT INTO audit_log (actor, action, detail, entity_type, entity_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(actor, action, detail, entity_type, entity_id, new Date().toISOString()).run();
}

export async function writeConflict(env, conflict) {
  await env.DB.prepare(`
    INSERT INTO conflict_log (codigo, motivo, fecha_servidor, estado_local_servidor, resolucion_aplicada, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(
    conflict.codigo || '',
    conflict.motivo || 'unknown_conflict',
    conflict.fecha_servidor || new Date().toISOString(),
    conflict.estado_local_servidor || '',
    conflict.resolucion_aplicada || 'pendiente',
    new Date().toISOString()
  ).run();
}
