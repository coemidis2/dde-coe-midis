import { json, serverError } from '../_lib/http.js';
import { sha256, newId } from '../_lib/auth.js';
import { writeAudit } from '../_lib/audit.js';

const seedUsers = [
  { email:'admin@midis.gob.pe', password:'AdminMIDIS2026!', role:'Administrador', name:'Administrador MIDIS', programa:'' },
  { email:'evaluador@midis.gob.pe', password:'Evaluador2026!', role:'Evaluador', name:'Evaluador MIDIS', programa:'' },
  { email:'registrador@midis.gob.pe', password:'Registrador2026!', role:'Registrador', name:'Registrador MIDIS', programa:'' },
  { email:'consulta@midis.gob.pe', password:'Consulta2026!', role:'Consulta', name:'Consulta MIDIS', programa:'' },
  { email:'registrador@cunamas.gob.pe', password:'CunaMas2026!', role:'Registrador', name:'Registrador Cuna Más', programa:'CUNA MÁS' },
  { email:'registrador@pae.gob.pe', password:'PAE2026!', role:'Registrador', name:'Registrador PAE', programa:'PAE' },
  { email:'registrador@juntos.gob.pe', password:'Juntos2026!', role:'Registrador', name:'Registrador Juntos', programa:'JUNTOS' },
  { email:'registrador@contigo.gob.pe', password:'Contigo2026!', role:'Registrador', name:'Registrador Contigo', programa:'CONTIGO' },
  { email:'registrador@pension65.gob.pe', password:'Pension652026!', role:'Registrador', name:'Registrador Pensión 65', programa:'PENSIÓN 65' },
  { email:'registrador@foncodes.gob.pe', password:'Foncodes2026!', role:'Registrador', name:'Registrador Foncodes', programa:'FONCODES' },
  { email:'registrador@pais.gob.pe', password:'Pais2026!', role:'Registrador', name:'Registrador PAIS', programa:'PAIS' }
];

export async function onRequestPost(context) {
  try {
    for (const user of seedUsers) {
      const exists = await context.env.DB.prepare('SELECT email FROM users WHERE email = ?').bind(user.email).first();
      if (exists) continue;
      const passwordHash = await sha256(user.password);
      await context.env.DB.prepare(`
        INSERT INTO users (id, email, password_hash, role, name, programa, active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
      `).bind(newId(), user.email, passwordHash, user.role, user.name, user.programa, new Date().toISOString(), new Date().toISOString()).run();
    }

    await writeAudit(context.env, { actor: 'bootstrap', action: 'seed_users', detail: 'Usuarios base creados/confirmados' });
    return json({ ok: true, message: 'Usuarios base listos.' });
  } catch (error) {
    return serverError('bootstrap_failed', String(error?.message || error));
  }
}
