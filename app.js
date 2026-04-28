// ================= VERSION 28 28/04/2026 - 15:08 HRS · FIX ROLES SIN EVALUADOR =================
const API_BASE = window.location.origin + '/api';
const LS_USERS = 'dee_matriz_usuarios_v17';

let state = {
  session: null,
  nuevoDSTerritorios: []
};

let ubigeoCache = [];
let ubigeoInicializado = false;

// ================= HELPERS =================
const $ = (id) => document.getElementById(id);

function getCookie(name) {
  const v = document.cookie.split('; ').find(x => x.startsWith(name + '='));
  return v ? decodeURIComponent(v.split('=')[1]) : '';
}

function getHeaders() {
  const h = { 'Content-Type': 'application/json' };
  const csrf = getCookie('dee_csrf');
  if (csrf) h['x-csrf-token'] = csrf;
  return h;
}

// ================= API =================
async function api(path, method = 'GET', body = null) {
  try {
    const res = await fetch(API_BASE + path, {
      method,
      headers: getHeaders(),
      credentials: 'include',
      body: body ? JSON.stringify(body) : null
    });

    let data = null;
    try { data = await res.json(); } catch {}

    if (!res.ok) return null;
    return data;
  } catch (e) {
    console.warn('API no disponible:', path, e.message);
    return null;
  }
}

function lsGet(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); }
  catch { return fallback; }
}

function lsSet(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function normalizeRole(role = '') {
  const base = String(role || '').split('|')[0].trim();
  if (['Evaluador', 'Revisor'].includes(base)) return 'Consulta';
  return base || 'Consulta';
}

function programaFromRole(role = '') {
  return String(role || '').split('|')[1] || '';
}

function inferProgramaByEmail(email = '') {
  const e = normalizarTexto(email);
  if (e.includes('CUNAMAS')) return 'CUNA MÁS';
  if (e.includes('JUNTOS')) return 'JUNTOS';
  if (e.includes('PENSION')) return 'PENSIÓN 65';
  if (e.includes('CONTIGO')) return 'CONTIGO';
  if (e.includes('FONCODES')) return 'FONCODES';
  if (e.includes('PAIS')) return 'PAIS';
  if (e.includes('PAE')) return 'PAE';
  return '';
}

function getUserEmail(u = {}) {
  return String(u.email || u.correo || u.user || u.usuario || '').trim().toLowerCase();
}

function getUserPassword(u = {}) {
  return String(u.password || u.clave || u.pass || u.contrasena || u.contraseña || '').trim();
}

function getUserStatus(u = {}) {
  return String(u.estado ?? u.status ?? (u.active === 0 ? 'Inactivo' : 'Activo')).trim().toLowerCase();
}

function isUserActive(u = {}) {
  const st = getUserStatus(u);
  return !(st === 'inactivo' || st === 'inactive' || st === '0' || st === 'false');
}

function sanitizeUserSession(u = {}) {
  const email = getUserEmail(u);
  const rawRole = u.role || u.rol || 'Consulta';
  const role = normalizeRole(rawRole);
  const programa = u.programa || programaFromRole(rawRole) || inferProgramaByEmail(email);

  return {
    ...u,
    name: u.name || u.nombre || u.fullName || email,
    email,
    role,
    programa
  };
}

function loadLocalUsers() {
  const users = lsGet(LS_USERS, []).map(u => {
    const limpio = sanitizeUserSession(u);
    return {
      ...u,
      name: limpio.name,
      email: limpio.email,
      role: limpio.role,
      programa: limpio.programa,
      estado: getUserStatus(u) === 'inactivo' ? 'Inactivo' : 'Activo',
      password: getUserPassword(u)
    };
  }).filter(u => isUserActive(u));

  lsSet(LS_USERS, users);
  return users;
}

function localLogin(email, password) {
  if (email === 'admin@midis.gob.pe' && password === 'AdminMIDIS2026!') {
    return {
      name: 'Administrador MIDIS',
      email,
      role: 'Administrador',
      programa: ''
    };
  }

  const user = loadLocalUsers().find(u =>
    getUserEmail(u) === email &&
    getUserPassword(u) === password &&
    isUserActive(u)
  );

  return user ? sanitizeUserSession(user) : null;
}

function isAdmin() {
  return normalizeRole(state.session?.role || '') === 'Administrador';
}

// ================= SESSION =================
function showLogin() {
  $('loginView')?.classList.remove('d-none');
  $('appView')?.classList.add('d-none');
}

function showApp() {
  $('loginView')?.classList.add('d-none');
  $('appView')?.classList.remove('d-none');
}

// ================= LOGIN =================
async function doLogin() {
  const email = ($('loginUser')?.value || '').trim().toLowerCase();
  const password = $('loginPass')?.value || '';

  if (!email || !password) {
    alert('Ingrese usuario y contraseña');
    return;
  }

  const login = await api('/login', 'POST', { email, password });

  if (login && login.ok) {
    const session = await api('/session');

    if (session && session.user) {
      state.session = sanitizeUserSession(session.user);
      showApp();
      renderSession();
      initUbigeo();
      return;
    }
  }

  const localUser = localLogin(email, password);

  if (!localUser) {
    alert('Credenciales inválidas');
    return;
  }

  state.session = localUser;
  showApp();
  renderSession();
  initUbigeo();
}

// ================= AUTO LOGIN =================
async function autoLogin() {
  const session = await api('/session');

  if (!session || !session.user) return showLogin();

  state.session = sanitizeUserSession(session.user);

  showApp();
  renderSession();
  initUbigeo();
}

// ================= UI =================
function renderSession() {
  if ($('sessionName')) {
    $('sessionName').textContent = state.session?.name || state.session?.email || '';
  }

  if ($('sessionRole')) {
    $('sessionRole').textContent =
      state.session?.role + (state.session?.programa ? ` · ${state.session.programa}` : '');
  }

  const btn = $('btnAdminPanel');
  if (btn) {
    btn.style.display = isAdmin() ? 'inline-block' : 'none';
    btn.disabled = !isAdmin();
    btn.style.pointerEvents = isAdmin() ? 'auto' : 'none';
  }
}

// ================= ADMIN =================
function openAdminPanel() {
  if (!isAdmin()) {
    alert('Acceso permitido solo para Administrador.');
    return;
  }

  const modal = $('modalAdminPanel');

  if (!modal) {
    alert('Modal no existe');
    return;
  }

  if (window.bootstrap) {
    bootstrap.Modal.getOrCreateInstance(modal).show();
  } else {
    modal.style.display = 'block';
    modal.classList.add('show');
  }
}

window.openAdminPanel = openAdminPanel;

// ================= UBIGEO COMPLETO =================
function normalizarTexto(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase();
}

function getUbigeoValue(reg) {
  return reg.ubigeo || reg.UBIGEO || reg.codigo || reg.cod_ubigeo || '';
}

function getLatitud(reg) {
  return reg.latitud ?? reg.lat ?? '';
}

function getLongitud(reg) {
  return reg.longitud ?? reg.lng ?? reg.lon ?? '';
}

function getTerritorioKey(reg) {
  const ubigeo = getUbigeoValue(reg);
  if (ubigeo) return String(ubigeo);

  return [
    normalizarTexto(reg.departamento),
    normalizarTexto(reg.provincia),
    normalizarTexto(reg.distrito)
  ].join('|');
}

function initUbigeo() {
  if (!window.ubigeoData || !Array.isArray(window.ubigeoData)) {
    console.error('ubigeoData NO cargó o no es un arreglo');
    return;
  }

  ubigeoCache = window.ubigeoData;

  cargarDepartamentos();
  renderTerritorioSeleccionado();

  if (ubigeoInicializado) return;
  ubigeoInicializado = true;

  $('selDepartamento')?.addEventListener('change', () => {
    cargarProvincias();
    renderTerritorioSeleccionado();
  });

  $('selProvincia')?.addEventListener('change', () => {
    cargarDistritos();
    renderTerritorioSeleccionado();
  });

  $('buscarDistrito')?.addEventListener('input', filtrarDistritos);

  $('btnAgregarDistritos')?.addEventListener('click', (e) => {
    e.preventDefault();
    agregarDistritosSeleccionados();
  });

  $('btnMarcarTodos')?.addEventListener('click', (e) => {
    e.preventDefault();
    marcarTodosDistritosVisibles();
  });

  $('btnLimpiarChecks')?.addEventListener('click', (e) => {
    e.preventDefault();
    limpiarChecksDistritos();
  });
}

function cargarDepartamentos() {
  const sel = $('selDepartamento');
  if (!sel) return;

  const actual = sel.value;

  sel.innerHTML = '<option value="">Seleccione...</option>';

  const deps = [...new Set(
    ubigeoCache
      .map(x => x.departamento)
      .filter(Boolean)
  )].sort((a, b) => a.localeCompare(b, 'es'));

  deps.forEach(dep => {
    const opt = document.createElement('option');
    opt.value = dep;
    opt.textContent = dep;
    sel.appendChild(opt);
  });

  if (actual && deps.includes(actual)) {
    sel.value = actual;
  }
}

function cargarProvincias() {
  const dep = $('selDepartamento')?.value || '';
  const sel = $('selProvincia');

  if (!sel) return;

  sel.innerHTML = '<option value="">Seleccione...</option>';

  const cont = $('distritosChecklist');
  if (cont) {
    cont.innerHTML = '<div class="text-muted small">Seleccione una provincia.</div>';
  }

  if ($('buscarDistrito')) $('buscarDistrito').value = '';

  if (!dep) {
    if (cont) {
      cont.innerHTML = '<div class="text-muted small">Seleccione primero departamento y provincia.</div>';
    }
    return;
  }

  const provincias = [...new Set(
    ubigeoCache
      .filter(x => normalizarTexto(x.departamento) === normalizarTexto(dep))
      .map(x => x.provincia)
      .filter(Boolean)
  )].sort((a, b) => a.localeCompare(b, 'es'));

  provincias.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p;
    opt.textContent = p;
    sel.appendChild(opt);
  });
}

function cargarDistritos() {
  const dep = $('selDepartamento')?.value || '';
  const prov = $('selProvincia')?.value || '';
  const cont = $('distritosChecklist');

  if (!cont) return;

  cont.innerHTML = '';

  if ($('buscarDistrito')) $('buscarDistrito').value = '';

  if (!dep || !prov) {
    cont.innerHTML = '<div class="text-muted small">Seleccione primero departamento y provincia.</div>';
    return;
  }

  const distritos = ubigeoCache
    .filter(x =>
      normalizarTexto(x.departamento) === normalizarTexto(dep) &&
      normalizarTexto(x.provincia) === normalizarTexto(prov)
    )
    .sort((a, b) => String(a.distrito || '').localeCompare(String(b.distrito || ''), 'es'));

  if (!distritos.length) {
    cont.innerHTML = '<div class="text-muted small">No hay distritos para esta selección.</div>';
    return;
  }

  distritos.forEach(d => {
    const key = getTerritorioKey(d);
    const idSeguro = String(key).replace(/[^a-zA-Z0-9_-]/g, '_');

    const yaAgregado = state.nuevoDSTerritorios.some(t => String(t.clave) === String(key));

    const div = document.createElement('div');
    div.className = 'form-check distrito-item';
    div.innerHTML = `
      <input class="form-check-input chk-distrito"
             type="checkbox"
             id="dist_${idSeguro}"
             value="${escapeHtmlAttr(key)}"
             ${yaAgregado ? 'checked' : ''}>
      <label class="form-check-label" for="dist_${idSeguro}">
        ${escapeHtml(d.distrito || '')}
        ${yaAgregado ? '<span class="text-success small"> — agregado</span>' : ''}
      </label>
    `;

    cont.appendChild(div);
  });
}

function filtrarDistritos() {
  const texto = normalizarTexto($('buscarDistrito')?.value || '');
  const cont = $('distritosChecklist');

  if (!cont) return;

  cont.querySelectorAll('.distrito-item').forEach(div => {
    const visible = normalizarTexto(div.textContent).includes(texto);
    div.style.display = visible ? '' : 'none';
  });
}

function marcarTodosDistritosVisibles() {
  const cont = $('distritosChecklist');
  if (!cont) return;

  cont.querySelectorAll('.distrito-item').forEach(div => {
    if (div.style.display === 'none') return;

    const chk = div.querySelector('input[type="checkbox"]');
    if (chk) chk.checked = true;
  });
}

function limpiarChecksDistritos() {
  const cont = $('distritosChecklist');

  if (cont) {
    cont.querySelectorAll('input[type="checkbox"]').forEach(chk => {
      chk.checked = false;
    });
  }

  if ($('buscarDistrito')) $('buscarDistrito').value = '';
  filtrarDistritos();
}

function agregarDistritosSeleccionados() {
  const cont = $('distritosChecklist');
  if (!cont) return;

  const checks = [...cont.querySelectorAll('.chk-distrito:checked')];

  if (!checks.length) {
    alert('Seleccione al menos un distrito.');
    return;
  }

  let agregados = 0;
  let duplicados = 0;

  checks.forEach(chk => {
    const key = chk.value;

    const data = ubigeoCache.find(x => String(getTerritorioKey(x)) === String(key));
    if (!data) return;

    const existe = state.nuevoDSTerritorios.some(t => String(t.clave) === String(key));

    if (existe) {
      duplicados++;
      return;
    }

    state.nuevoDSTerritorios.push({
      clave: key,
      ubigeo: getUbigeoValue(data),
      departamento: data.departamento || '',
      provincia: data.provincia || '',
      distrito: data.distrito || '',
      latitud: getLatitud(data),
      longitud: getLongitud(data)
    });

    agregados++;
  });

  renderTerritorioSeleccionado();
  cargarDistritos();

  if (agregados > 0) {
    alert(`${agregados} distrito(s) agregado(s).`);
    return;
  }

  if (duplicados > 0) {
    alert('Los distritos seleccionados ya estaban agregados.');
  }
}

function quitarTerritorioSeleccionado(clave) {
  state.nuevoDSTerritorios = state.nuevoDSTerritorios.filter(
    t => String(t.clave) !== String(clave)
  );

  renderTerritorioSeleccionado();
  cargarDistritos();
}

window.quitarTerritorioSeleccionado = quitarTerritorioSeleccionado;

function renderTerritorioSeleccionado() {
  const cont = $('territorioSeleccionado');
  if (!cont) return;

  if (!state.nuevoDSTerritorios.length) {
    cont.innerHTML = '<div class="text-muted small">No hay distritos agregados.</div>';
    return;
  }

  cont.innerHTML = state.nuevoDSTerritorios.map(t => `
    <div class="d-flex justify-content-between align-items-start gap-2 border rounded bg-white px-2 py-2 mb-2">
      <div>
        <div>
          <strong>${escapeHtml(t.departamento)}</strong> /
          ${escapeHtml(t.provincia)} /
          ${escapeHtml(t.distrito)}
        </div>
        <div class="text-muted small">
          Ubigeo: ${escapeHtml(t.ubigeo || '-')}
          ${t.latitud || t.longitud ? ` · Lat/Lon: ${escapeHtml(t.latitud)} / ${escapeHtml(t.longitud)}` : ''}
        </div>
      </div>
      <button type="button"
              class="btn btn-sm btn-outline-danger"
              onclick="quitarTerritorioSeleccionado('${String(t.clave).replace(/'/g, "\\'")}')">
        Quitar
      </button>
    </div>
  `).join('');
}

// ================= UTILIDADES HTML =================
function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeHtmlAttr(value) {
  return escapeHtml(value);
}

// ================= INIT =================
function init() {
  $('btnLogin')?.addEventListener('click', doLogin);

  $('loginPass')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doLogin();
  });

  $('btnLogout')?.addEventListener('click', async () => {
    await api('/logout', 'POST');
    showLogin();
  });

  const btn = $('btnAdminPanel');
  if (btn) {
    btn.addEventListener('click', openAdminPanel);
    btn.onclick = openAdminPanel;
  }

  loadLocalUsers();
  autoLogin();
}

document.addEventListener('DOMContentLoaded', init);