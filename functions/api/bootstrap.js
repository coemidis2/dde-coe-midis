import { json, serverError } from '../_lib/http.js';
import { sha256 } from '../_lib/auth.js';
import { writeAudit } from '../_lib/audit.js';

const seedUsers = [
  { email: 'admin@midis.gob.pe', password: 'AdminMIDIS2026!', role: 'Administrador', name: 'Administrador MIDIS', programa: '' },
  { email: 'revisor@midis.gob.pe', password: 'Revisor2026!', role: 'Revisor', name: 'Revisor MIDIS', programa: '' },
  { email: 'consulta@midis.gob.pe', password: 'Consulta2026!', role: 'Consulta', name: 'Consulta MIDIS', programa: '' },
  { email: 'registrador@cunamas.gob.pe', password: 'CunaMas2026!', role: 'Registrador', name: 'Registrador Cuna Más', programa: 'CUNA MÁS' },
  { email: 'registrador@pae.gob.pe', password: 'PAE2026!', role: 'Registrador', name: 'Registrador PAE', programa: 'PAE' },
  { email: 'registrador@juntos.gob.pe', password: 'Juntos2026!', role: 'Registrador', name: 'Registrador Juntos', programa: 'JUNTOS' },
  { email: 'registrador@contigo.gob.pe', password: 'Contigo2026!', role: 'Registrador', name: 'Registrador Contigo', programa: 'CONTIGO' },
  { email: 'registrador@pension65.gob.pe', password: 'Pension652026!', role: 'Registrador', name: 'Registrador Pensión 65', programa: 'PENSIÓN 65' },
  { email: 'registrador@foncodes.gob.pe', password: 'Foncodes2026!', role: 'Registrador', name: 'Registrador Foncodes', programa: 'FONCODES' },
  { email: 'registrador@pais.gob.pe', password: 'Pais2026!', role: 'Registrador', name: 'Registrador PAIS', programa: 'PAIS' }
];

export async function onRequestPost(context) {
  try {
    const now = new Date().toISOString();

    for (const user of seedUsers) {
      const exists = await context.env.DB
        .prepare('SELECT id FROM users WHERE email = ?')
        .bind(user.email)
        .first();

      if (exists) continue;

      const passwordHash = await sha256(user.password);

      await context.env.DB.prepare(`
        INSERT INTO users (
          name,
          email,
          role,
          programa,
          password_hash,
          active,
          force_password_change,
          created_at,
          updated_at,
          last_login_at
        ) VALUES (?, ?, ?, ?, ?, 1, 0, ?, ?, NULL)
      `).bind(
        user.name,
        user.email,
        user.role,
        user.programa,
        passwordHash,
        now,
        now
      ).run();
    }

    await writeAudit(context.env, {
      actor: 'bootstrap',
      action: 'seed_users',
      detail: 'Usuarios base creados/confirmados',
      entity_type: 'system',
      entity_id: ''
    });

    return json({ ok: true, message: 'Usuarios base listos.' });
  } catch (error) {
    return serverError('bootstrap_failed', String(error?.message || error));
  }
}