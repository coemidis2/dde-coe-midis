// ================= CONFIG 24/04/2026 ver 14 - 12:26 hrs =================
const API_BASE = window.location.origin + '/api';

let state = {
  session: null
};

let authAlertShown = false;

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
async function api(path, method='GET', body=null, silent=false) {
  try {
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
        logoutClient();
        if (!silent && !authAlertShown) {
          authAlertShown = true;
          alert('Sesión expirada');
        }
        return null;
      }

      if (res.status === 403) {
        alert('Sin permisos');
        return null;
      }

      throw new Error(data?.error || 'api_error');
    }

    return data;

  } catch (e) {
    console.error('API ERROR', e);
    return null;
  }
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

function logoutClient() {
  state.session = null;
  showLogin();
}

// ================= LOGIN =================
async function doLogin() {
  const email = $('loginUser').value.trim();
  const password = $('loginPass').value;

  if (!email || !password) {
    alert('Ingrese credenciales');
    return;
  }

  const login = await api('/login', 'POST', { email, password }, true);

  if (!login || !login.ok) {
    alert('Credenciales inválidas');
    return;
  }

  const session = await api('/session', 'GET', null, true);

  if (!session || !session.user) {
    alert('Error de sesión');
    return;
  }

  state.session = session.user;

  showApp();
  renderSession();
}

// ================= AUTO LOGIN =================
async function autoLogin() {
  const session = await api('/session', 'GET', null, true);

  if (!session || !session.user) {
    showLogin();
    return;
  }

  state.session = session.user;
  showApp();
  renderSession();
}

// ================= UI =================
function renderSession() {
  $('sessionName').textContent = state.session.name || '';
  $('sessionRole').textContent = state.session.role || '';

  applyRoles();
}

// ================= ROLES =================
function applyRoles() {
  const role = state.session.role;

  if (role === 'Administrador') {
    $('btnAdminPanel').style.display = 'inline-block';
  } else {
    $('btnAdminPanel').style.display = 'none';
  }
}

// ================= ADMIN PANEL =================
function openAdminPanel() {

  if (state.session.role !== 'Administrador') {
    alert('Solo administrador');
    return;
  }

  const modal = $('modalAdminPanel');

  if (!modal) {
    alert('Modal no encontrado');
    return;
  }

  // Bootstrap OK
  if (window.bootstrap) {
    bootstrap.Modal.getOrCreateInstance(modal).show();
    return;
  }

  // FALLBACK DURO (nunca falla)
  modal.style.display = 'block';
  modal.classList.add('show');
}

// ================= INIT =================
function init() {

  // Login
  $('btnLogin')?.addEventListener('click', doLogin);

  $('loginPass')?.addEventListener('keypress', e => {
    if (e.key === 'Enter') doLogin();
  });

  // Logout
  $('btnLogout')?.addEventListener('click', async () => {
    await api('/logout', 'POST', {}, true);
    logoutClient();
  });

  // Admin botón (doble seguridad)
  const btn = $('btnAdminPanel');

  if (btn) {
    btn.addEventListener('click', openAdminPanel);

    // respaldo anti-bugs
    setTimeout(() => {
      btn.onclick = openAdminPanel;
    }, 500);
  }

  // respaldo global
  document.addEventListener('click', (e) => {
    if (e.target && e.target.id === 'btnAdminPanel') {
      openAdminPanel();
    }
  });

  autoLogin();
}

document.addEventListener('DOMContentLoaded', init);