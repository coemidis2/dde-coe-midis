// ================= VERSION 17 24/04/2026 - 14:15 HRS =================
const API_BASE = window.location.origin + '/api';

let state = {
  session: null,
  nuevoDSTerritorios: [],
  decretos: [],
  acciones: [],
  reunion: null
};

let ubigeoCache = [];
let ubigeoInicializado = false;

// ================= HELPERS =================
const $ = (id) => document.getElementById(id);

function hoy() {
  return new Date().toISOString().split('T')[0];
}

function diasEntre(f1, f2) {
  return Math.ceil((new Date(f2) - new Date(f1)) / (1000 * 60 * 60 * 24));
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
  cargarListado();
}

async function autoLogin() {
  const session = await api('/session');
  if (!session || !session.user) return showLogin();

  state.session = session.user;

  showApp();
  renderSession();
  initUbigeo();
  cargarListado();
}

// ================= UI =================
function renderSession() {
  $('sessionName').textContent = state.session?.name || '';
  $('sessionRole').textContent = state.session?.role || '';

  $('btnAdminPanel').style.display =
    (state.session?.role === 'Administrador') ? 'inline-block' : 'none';
}

// ================= DECRETOS =================
function calcularVigencia(fin) {
  return new Date(fin) >= new Date() ? 'Vigente' : 'No vigente';
}

function calcularSemaforo(fin) {
  const dias = diasEntre(hoy(), fin);
  if (dias <= 5) return '🔴';
  if (dias <= 15) return '🟠';
  return '🟢';
}

function guardarDS() {
  const numero = $('dsNumero').value;
  const anio = $('dsAnio').value;
  const inicio = $('dsFechaInicio').value;

  const fin = new Date(inicio);
  fin.setDate(fin.getDate() + 60);

  const ds = {
    id: Date.now(),
    numero,
    anio,
    inicio,
    fin: fin.toISOString().split('T')[0],
    vigencia: calcularVigencia(fin),
    semaforo: calcularSemaforo(fin),
    territorios: [...state.nuevoDSTerritorios],
    motivos: $('dsMotivos').value
  };

  state.decretos.push(ds);
  alert('DS guardado correctamente');

  cargarListado();
}

// ================= LISTADO =================
function cargarListado() {
  const tbody = document.querySelector('#tablaDS tbody');
  tbody.innerHTML = '';

  state.decretos.forEach(ds => {
    const tr = document.createElement('tr');

    tr.innerHTML = `
      <td>${ds.numero}</td>
      <td>${ds.anio}</td>
      <td>${ds.inicio}</td>
      <td>${ds.fin}</td>
      <td>${ds.vigencia}</td>
      <td>${ds.semaforo}</td>
      <td>${new Set(ds.territorios.map(x=>x.departamento)).size}</td>
      <td>${new Set(ds.territorios.map(x=>x.provincia)).size}</td>
      <td>${ds.territorios.length}</td>
      <td><button onclick="abrirAcciones(${ds.id})">RDS</button></td>
      <td><button onclick="verDS(${ds.id})">👁</button></td>
    `;

    tbody.appendChild(tr);
  });

  renderDashboard();
}

// ================= ACCIONES =================
function abrirAcciones(id) {
  if (!['Administrador','Evaluador'].includes(state.session.role)) {
    alert('No autorizado');
    return;
  }

  state.reunion = {
    ds_id: id,
    numero: prompt('Número de reunión'),
    fecha: hoy()
  };

  alert('Reunión activada');
}

// ================= DASHBOARD =================
function renderDashboard() {
  const cont = document.querySelector('#tabDashboard .card-body');

  const vigentes = state.decretos.filter(x => x.vigencia === 'Vigente');

  const distritos = new Set();
  const provincias = new Set();
  const departamentos = new Set();

  state.decretos.forEach(ds => {
    ds.territorios.forEach(t => {
      distritos.add(t.distrito);
      provincias.add(t.provincia);
      departamentos.add(t.departamento);
    });
  });

  cont.innerHTML = `
    <h5>Resumen</h5>
    <ul>
      <li>DS Vigentes: ${vigentes.length}</li>
      <li>Departamentos: ${departamentos.size}</li>
      <li>Provincias: ${provincias.size}</li>
      <li>Distritos: ${distritos.size}</li>
    </ul>
  `;
}

// ================= INIT =================
function init() {

  $('btnLogin').addEventListener('click', doLogin);

  $('btnLogout').addEventListener('click', async () => {
    await api('/logout', 'POST');
    showLogin();
  });

  $('btnGuardarDS').addEventListener('click', guardarDS);

  autoLogin();
}

document.addEventListener('DOMContentLoaded', init);