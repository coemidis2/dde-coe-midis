// ================= VERSION 19 24/04/2026 - 15:47 HRS =================
const API_BASE = window.location.origin + '/api';

let state = {
  session: null,
  nuevoDSTerritorios: [],
  decretos: [],
};

let ubigeoCache = [];
let ubigeoInicializado = false;

// ================= HELPERS =================
const $ = (id) => document.getElementById(id);

function hoy() {
  return new Date().toISOString().split('T')[0];
}

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
  const res = await fetch(API_BASE + path, {
    method,
    headers: getHeaders(),
    credentials: 'include',
    body: body ? JSON.stringify(body) : null
  });

  let data = null;
  try { data = await res.json(); } catch {}

  if (!res.ok) {
    if (res.status === 401) {
      showLogin();
      return null;
    }
    alert(data?.error || 'Error API');
    return null;
  }

  return data;
}

// ================= SESSION =================
function showLogin() {
  $('loginView').classList.remove('d-none');
  $('appView').classList.add('d-none');
}

function showApp() {
  $('loginView').classList.add('d-none');
  $('appView').classList.remove('d-none');
}

// ================= LOGIN =================
async function doLogin() {
  const email = $('loginUser').value.trim();
  const password = $('loginPass').value;

  const login = await api('/login', 'POST', { email, password });
  if (!login || !login.ok) return alert('Credenciales inválidas');

  const session = await api('/session');
  state.session = session.user;

  showApp();
  renderSession();
  initUbigeo();
  activarEventosDS();
}

async function autoLogin() {
  const session = await api('/session');
  if (!session || !session.user) return showLogin();

  state.session = session.user;

  showApp();
  renderSession();
  initUbigeo();
  activarEventosDS();
}

// ================= UI =================
function renderSession() {
  if ($('sessionName')) $('sessionName').textContent = state.session?.name || '';
  if ($('sessionRole')) $('sessionRole').textContent = state.session?.role || '';

  const btn = $('btnAdminPanel');
  if (btn) {
    const esAdmin = String(state.session?.role || '').toLowerCase() === 'administrador';
    btn.style.display = esAdmin ? 'inline-block' : 'none';
    btn.disabled = !esAdmin;
    btn.classList.remove('disabled');
    btn.removeAttribute('aria-disabled');
    btn.style.pointerEvents = esAdmin ? 'auto' : 'none';
  }
}

// ================= ADMIN =================
function openAdminPanel() {
  const modal = $('modalAdminPanel');
  if (!modal) {
    alert('No se encontró el panel de Administración en el index.');
    return;
  }

  if (window.bootstrap && bootstrap.Modal) {
    bootstrap.Modal.getOrCreateInstance(modal).show();
    return;
  }

  modal.style.display = 'block';
  modal.classList.add('show');
  modal.removeAttribute('aria-hidden');
  document.body.classList.add('modal-open');
}

window.openAdminPanel = openAdminPanel;

// ================= FECHA AUTOMÁTICA =================
function activarEventosDS() {

  $('dsFechaInicio')?.addEventListener('change', calcularFechaFin);
  $('dsPlazoDias')?.addEventListener('input', calcularFechaFin);
}

function calcularFechaFin() {
  const inicio = $('dsFechaInicio').value;
  const plazo = parseInt($('dsPlazoDias').value || 0);

  if (!inicio || !plazo) return;

  const f = new Date(inicio);
  f.setDate(f.getDate() + plazo);

  const fin = f.toISOString().split('T')[0];
  $('dsFechaFin').value = fin;

  $('dsVigencia').value = (new Date(fin) >= new Date()) ? 'Vigente' : 'No vigente';
}

// ================= UBIGEO =================
function normalizar(v) {
  return String(v || '').toUpperCase();
}

function initUbigeo() {
  if (!window.ubigeoData) {
    console.error('ubigeoData no cargó');
    return;
  }

  ubigeoCache = window.ubigeoData;

  cargarDepartamentos();

  if (ubigeoInicializado) return;
  ubigeoInicializado = true;

  $('selDepartamento').addEventListener('change', cargarProvincias);
  $('selProvincia').addEventListener('change', cargarDistritos);
}

function cargarDepartamentos() {
  const sel = $('selDepartamento');
  sel.innerHTML = '<option value="">Seleccione...</option>';

  const deps = [...new Set(ubigeoCache.map(x => x.departamento))];

  deps.forEach(d => {
    const opt = document.createElement('option');
    opt.value = d;
    opt.textContent = d;
    sel.appendChild(opt);
  });
}

function cargarProvincias() {
  const dep = $('selDepartamento').value;
  const sel = $('selProvincia');

  sel.innerHTML = '<option value="">Seleccione...</option>';

  const provs = ubigeoCache
    .filter(x => normalizar(x.departamento) === normalizar(dep))
    .map(x => x.provincia);

  [...new Set(provs)].forEach(p => {
    const opt = document.createElement('option');
    opt.value = p;
    opt.textContent = p;
    sel.appendChild(opt);
  });
}

function cargarDistritos() {
  const dep = $('selDepartamento').value;
  const prov = $('selProvincia').value;

  const cont = $('distritosChecklist');
  cont.innerHTML = '';

  const distritos = ubigeoCache.filter(x =>
    normalizar(x.departamento) === normalizar(dep) &&
    normalizar(x.provincia) === normalizar(prov)
  );

  distritos.forEach(d => {
    const div = document.createElement('div');
    div.innerHTML = `
      <label>
        <input type="checkbox" value="${d.distrito}">
        ${d.distrito}
      </label>
    `;
    cont.appendChild(div);
  });
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

  const btnAdmin = $('btnAdminPanel');
  if (btnAdmin) {
    btnAdmin.disabled = false;
    btnAdmin.classList.remove('disabled');
    btnAdmin.removeAttribute('aria-disabled');
    btnAdmin.style.pointerEvents = 'auto';
    btnAdmin.addEventListener('click', openAdminPanel);
    btnAdmin.onclick = openAdminPanel;
  }

  autoLogin();
}

document.addEventListener('DOMContentLoaded', init);