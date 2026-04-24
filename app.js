// ================= VERSION 15 24/04/2026 - 12:44 HRS =================
const API_BASE = window.location.origin + '/api';

let state = {
  session: null
};

let ubigeoCache = [];

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
async function api(path, method='GET', body=null) {
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

  const login = await api('/login','POST',{email,password});
  if (!login || !login.ok) return alert('Credenciales inválidas');

  const session = await api('/session');
  if (!session || !session.user) return alert('Error sesión');

  state.session = session.user;

  showApp();
  renderSession();
  initUbigeo();
}

// ================= AUTO LOGIN =================
async function autoLogin() {
  const session = await api('/session');
  if (!session || !session.user) return showLogin();

  state.session = session.user;

  showApp();
  renderSession();
  initUbigeo();
}

// ================= UI =================
function renderSession() {
  $('sessionName').textContent = state.session.name || '';
  $('sessionRole').textContent = state.session.role || '';

  // 🔴 FORZAR botón administrador
  const btn = $('btnAdminPanel');
  if (btn) {
    btn.style.display = (state.session.role === 'Administrador') ? 'inline-block' : 'none';
  }
}

// ================= ADMIN =================
function openAdminPanel() {
  const modal = $('modalAdminPanel');

  if (!modal) {
    alert('Modal no existe');
    return;
  }

  if (window.bootstrap) {
    bootstrap.Modal.getOrCreateInstance(modal).show();
  } else {
    modal.style.display = 'block';
  }
}

// ================= UBIGEO =================
function initUbigeo() {

  if (!window.ubigeoData) {
    console.error('ubigeoData NO cargó');
    return;
  }

  ubigeoCache = window.ubigeoData;

  cargarDepartamentos();

  $('selDepartamento')?.addEventListener('change', cargarProvincias);
  $('selProvincia')?.addEventListener('change', cargarDistritos);
}

function cargarDepartamentos() {
  const sel = $('selDepartamento');
  if (!sel) return;

  sel.innerHTML = '<option value="">Seleccione...</option>';

  const deps = [...new Set(ubigeoCache.map(x => x.departamento))];

  deps.forEach(dep => {
    const opt = document.createElement('option');
    opt.value = dep;
    opt.textContent = dep;
    sel.appendChild(opt);
  });
}

function cargarProvincias() {
  const dep = $('selDepartamento').value;
  const sel = $('selProvincia');

  sel.innerHTML = '<option value="">Seleccione...</option>';

  const provincias = [...new Set(
    ubigeoCache
      .filter(x => x.departamento === dep)
      .map(x => x.provincia)
  )];

  provincias.forEach(p => {
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

  ubigeoCache
    .filter(x => x.departamento === dep && x.provincia === prov)
    .forEach(d => {
      const div = document.createElement('div');
      div.innerHTML = `
        <input type="checkbox"> ${d.distrito}
      `;
      cont.appendChild(div);
    });
}

// ================= INIT =================
function init() {

  $('btnLogin')?.addEventListener('click', doLogin);

  $('btnLogout')?.addEventListener('click', async () => {
    await api('/logout','POST');
    showLogin();
  });

  // 🔴 BOTÓN ADMIN CORREGIDO
  const btn = $('btnAdminPanel');
  if (btn) {
    btn.addEventListener('click', openAdminPanel);
    btn.onclick = openAdminPanel; // doble seguridad
  }

  autoLogin();
}

document.addEventListener('DOMContentLoaded', init);