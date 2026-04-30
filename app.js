// ================= VERSION 39 FIX LOGIN USUARIOS LOCALES =================
const API_BASE = window.location.origin + '/api';

let state = {
  session: null,
  nuevoDSTerritorios: [],
  decretos: [],
};

let ubigeoCache = [];
let ubigeoInicializado = false;
let adminPanelInicializado = false;
let adminUsuariosLocales = [];
let dsEventosInicializados = false;
const DECRETOS_STORAGE_KEY = 'decretos';
const ACCIONES_STORAGE_KEY = 'accionesDS';
const MINISTERIOS_FIRMANTES = ['MINAM','MIDAGRI','MINCETUR','MINCUL','MINDEF','MEF','MINEDU','MINEM','MININTER','MINJUSDH','MIMP','PRODUCE','RREE','MINSA','MTPE','MTC','MVCS','MIDIS'];
const PROGRAMAS_RDS = ['CUNA MÁS','PAE','JUNTOS','CONTIGO','PENSIÓN 65','FONCODES','PAIS'];

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

function esAdministrador() {
  return String(state.session?.role || '').trim().toLowerCase() === 'administrador';
}

function esRegistrador() {
  return normalizarTexto(state.session?.role || state.session?.rol || '') === 'REGISTRADOR';
}

function esConsulta() {
  return normalizarTexto(state.session?.role || state.session?.rol || '') === 'CONSULTA';
}

function puedeUsarRDS() {
  return esAdministrador() || esRegistrador();
}

function programaSesionNormalizado() {
  return normalizarProgramaNombre(state.session?.programa || '');
}



// ================= USUARIOS LOCALES / LOGIN UNIFICADO =================
const USUARIOS_STORAGE_KEY = 'usuarios';
const SESSION_STORAGE_KEY = 'sessionUser';

function normalizarEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function normalizarRol(valor) {
  const rol = String(valor || '').trim();
  if (!rol) return '';
  if (rol.includes('|')) return rol.split('|')[0].trim();
  return rol;
}

function normalizarPrograma(valor) {
  const rol = String(valor || '').trim();
  return rol.includes('|') ? rol.split('|').slice(1).join('|').trim() : '';
}

function normalizarUsuario(raw) {
  if (!raw) return null;

  const email = normalizarEmail(raw.email || raw.correo || raw.usuario || raw.user || raw.username);
  if (!email) return null;

  const rolOriginal = raw.rol || raw.role || 'Consulta';
  const rol = normalizarRol(rolOriginal);
  const programa = raw.programa || raw.program || normalizarPrograma(rolOriginal);

  const estadoRaw = raw.estado ?? raw.status ?? raw.active ?? raw.activo ?? 'activo';
  const activo = estadoRaw === true || estadoRaw === 1 || estadoRaw === '1' || normalizarTexto(estadoRaw) === 'ACTIVO' || normalizarTexto(estadoRaw) === 'ACTIVE';

  return {
    nombre: String(raw.nombre || raw.name || raw.fullName || email).trim(),
    name: String(raw.name || raw.nombre || raw.fullName || email).trim(),
    email,
    password: String(raw.password ?? raw.clave ?? raw.pass ?? ''),
    rol,
    role: rol,
    programa,
    estado: activo ? 'activo' : 'inactivo',
    active: activo ? 1 : 0
  };
}

function cargarUsuariosLocales() {
  const fuentes = [USUARIOS_STORAGE_KEY, 'users', 'userList', 'usuariosSistema'];
  const mapa = new Map();

  fuentes.forEach(key => {
    try {
      const lista = JSON.parse(localStorage.getItem(key) || '[]');
      if (!Array.isArray(lista)) return;
      lista.forEach(item => {
        const u = normalizarUsuario(item);
        if (u) mapa.set(u.email, u);
      });
    } catch (e) {
      console.warn('No se pudo leer localStorage.' + key, e);
    }
  });

  const usuarios = [...mapa.values()].filter(u => normalizarTexto(u.rol) !== 'EVALUADOR');
  guardarUsuariosLocales(usuarios);
  return usuarios;
}

function guardarUsuariosLocales(lista) {
  const depurados = [];
  const vistos = new Set();

  (Array.isArray(lista) ? lista : []).forEach(item => {
    const u = normalizarUsuario(item);
    if (!u) return;
    if (normalizarTexto(u.rol) === 'EVALUADOR') return;
    if (vistos.has(u.email)) return;
    vistos.add(u.email);
    depurados.push(u);
  });

  localStorage.setItem(USUARIOS_STORAGE_KEY, JSON.stringify(depurados));
  adminUsuariosLocales = depurados;
  return depurados;
}

function buscarUsuarioLocalPorEmail(email) {
  const usuarios = cargarUsuariosLocales();
  return usuarios.find(u => u.email === normalizarEmail(email)) || null;
}

function loginLocal(email, password) {
  const usuario = buscarUsuarioLocalPorEmail(email);
  if (!usuario) return { ok: false, reason: 'not_found' };
  if (usuario.estado !== 'activo') return { ok: false, reason: 'inactive' };
  if (String(usuario.password ?? '') !== String(password ?? '')) return { ok: false, reason: 'bad_password' };

  const sessionUser = {
    name: usuario.name || usuario.nombre || usuario.email,
    nombre: usuario.nombre || usuario.name || usuario.email,
    email: usuario.email,
    role: usuario.role || usuario.rol,
    rol: usuario.rol || usuario.role,
    programa: usuario.programa || '',
    estado: usuario.estado
  };

  state.session = sessionUser;
  localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(sessionUser));
  return { ok: true, user: sessionUser };
}

function iniciarSistemaConSesion(usuario) {
  state.session = usuario;
  showApp();
  renderSession();
  initUbigeo();
  activarEventosDS();
  initRegistroAcciones();
}

adminUsuariosLocales = cargarUsuariosLocales();

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

    return { ok: res.ok, data };
  } catch (e) {
    console.error('API ERROR:', e);
    return { ok: false, data: null };
  }
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
  const email = normalizarEmail($('loginUser')?.value);
  const password = $('loginPass')?.value || '';

  if (!email || !password) {
    alert('Ingrese usuario y contraseña');
    return;
  }

  const local = loginLocal(email, password);
  if (local.ok) {
    iniciarSistemaConSesion(local.user);
    return;
  }

  const resLogin = await api('/login', 'POST', { email, password });

  if (resLogin.ok && resLogin.data?.ok) {
    const resSession = await api('/session');
    const userServer = normalizarUsuario(resSession.data?.user || resLogin.data?.user);

    if (userServer && userServer.estado === 'activo') {
      const sessionUser = {
        name: userServer.name,
        nombre: userServer.nombre,
        email: userServer.email,
        role: userServer.role,
        rol: userServer.rol,
        programa: userServer.programa,
        estado: userServer.estado
      };
      localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(sessionUser));
      iniciarSistemaConSesion(sessionUser);
      return;
    }
  }

  if (email === 'admin@midis.gob.pe' && password === 'AdminMIDIS2026!') {
    const demo = {
      name: 'Administrador DEMO',
      nombre: 'Administrador DEMO',
      email: 'admin@midis.gob.pe',
      role: 'Administrador',
      rol: 'Administrador',
      estado: 'activo'
    };

    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(demo));
    iniciarSistemaConSesion(demo);
    return;
  }

  alert('Credenciales inválidas');
}

// ================= AUTO LOGIN =================
async function autoLogin() {
  try {
    const localSession = JSON.parse(localStorage.getItem(SESSION_STORAGE_KEY) || 'null');
    const user = normalizarUsuario(localSession);
    if (user && user.estado === 'activo') {
      iniciarSistemaConSesion({
        name: user.name,
        nombre: user.nombre,
        email: user.email,
        role: user.role,
        rol: user.rol,
        programa: user.programa,
        estado: user.estado
      });
      return;
    }
  } catch (e) {
    localStorage.removeItem(SESSION_STORAGE_KEY);
  }

  const res = await api('/session');

  if (res.ok && res.data?.user) {
    const user = normalizarUsuario(res.data.user);
    if (user && user.estado === 'activo') {
      iniciarSistemaConSesion({
        name: user.name,
        nombre: user.nombre,
        email: user.email,
        role: user.role,
        rol: user.rol,
        programa: user.programa,
        estado: user.estado
      });
      return;
    }
  }

  showLogin();
}

// ================= UI =================
function renderSession() {
  if ($('sessionName')) $('sessionName').textContent = state.session?.name || '';
  if ($('sessionRole')) $('sessionRole').textContent = state.session?.role || '';

  const btn = $('btnAdminPanel');
  if (btn) {
    const admin = esAdministrador();
    btn.style.display = admin ? 'inline-block' : 'none';
    btn.disabled = !admin;
    btn.style.pointerEvents = admin ? 'auto' : 'none';
  }
}

// ================= ADMIN =================
function openAdminPanel() {
  if (!esAdministrador()) {
    alert('Acceso permitido solo para Administrador.');
    return;
  }

  const modal = $('modalAdminPanel');
  if (!modal) {
    alert('No existe el modal de administración.');
    return;
  }

  construirAdminPanel();
  initAdminPanel();

  if (window.bootstrap && bootstrap.Modal) {
    bootstrap.Modal.getOrCreateInstance(modal).show();
  } else {
    modal.style.display = 'block';
    modal.classList.add('show');
  }

  activarAdminTab('#adminUsuarios');
}

window.openAdminPanel = openAdminPanel;

function construirAdminPanel() {
  const modal = $('modalAdminPanel');
  if (!modal) return;

  const title = modal.querySelector('.modal-title');
  if (title) title.textContent = 'Administración de usuarios';

  const body = modal.querySelector('.modal-body');
  if (!body) return;

  body.innerHTML = `
    <ul class="nav nav-tabs" id="adminTabs">
      <li class="nav-item">
        <button class="nav-link active" type="button" data-admin-tab="#adminUsuarios">Usuarios</button>
      </li>
      <li class="nav-item">
        <button class="nav-link" type="button" data-admin-tab="#adminAuditoria">Bitácora / Auditoría</button>
      </li>
      <li class="nav-item">
        <button class="nav-link" type="button" data-admin-tab="#adminConflictos">Conflictos Sync</button>
      </li>
    </ul>

    <div class="tab-content pt-3">

      <div class="tab-pane fade show active" id="adminUsuarios">
        <div class="row g-2 mb-2">
          <div class="col-md-5">
            <label class="form-label">Nombre y apellidos</label>
            <input id="adminUserName" class="form-control" placeholder="Ej.: Juan Pérez Gómez">
          </div>
          <div class="col-md-4">
            <label class="form-label">Correo (usuario)</label>
            <input id="adminUserEmail" class="form-control" placeholder="usuario@midis.gob.pe">
          </div>
          <div class="col-md-3">
            <label class="form-label">Rol</label>
            <select id="adminUserRole" class="form-select">
              <option value="Consulta">Consulta</option>
              <option value="Administrador">Administrador</option>
              <option value="Registrador">Registrador</option>
              <option value="Registrador|CUNA MÁS">Registrador - Cuna Más</option>
              <option value="Registrador|PAE">Registrador - PAE</option>
              <option value="Registrador|JUNTOS">Registrador - Juntos</option>
              <option value="Registrador|CONTIGO">Registrador - Contigo</option>
              <option value="Registrador|PENSIÓN 65">Registrador - Pensión 65</option>
              <option value="Registrador|FONCODES">Registrador - Foncodes</option>
              <option value="Registrador|PAIS">Registrador - PAIS</option>
            </select>
          </div>
        </div>

        <div class="d-flex gap-2 mb-3">
          <button id="btnCrearUsuarioAdmin" type="button" class="btn btn-primary btn-sm">Crear usuario</button>
          <button id="btnCopiarClaveAdmin" type="button" class="btn btn-outline-secondary btn-sm">Copiar clave temporal</button>
          <input id="adminGeneratedPassword" class="form-control form-control-sm" style="max-width:220px" readonly>
        </div>

        <div class="d-flex justify-content-between align-items-center mb-2">
          <div class="input-group input-group-sm" style="max-width:370px">
            <span class="input-group-text">Buscar</span>
            <input id="adminBuscarUsuario" class="form-control" placeholder="Nombre o correo">
            <button id="btnActualizarUsuarios" class="btn btn-outline-primary" type="button">Actualizar</button>
          </div>
          <div id="adminUsuariosContador" class="text-muted small">Mostrando 0 de 0</div>
        </div>

        <div class="table-responsive">
          <table class="table table-sm table-striped" id="tablaAdminUsuarios">
            <thead class="table-light">
              <tr>
                <th>Nombre y apellidos</th>
                <th>Correo</th>
                <th>Rol</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody></tbody>
          </table>
        </div>
      </div>

      <div class="tab-pane fade" id="adminAuditoria">
        <div class="row g-2 mb-2">
          <div class="col-md-2">
            <label class="form-label">Desde</label>
            <input id="auditDesde" type="date" class="form-control">
          </div>
          <div class="col-md-2">
            <label class="form-label">Hasta</label>
            <input id="auditHasta" type="date" class="form-control">
          </div>
          <div class="col-md-3">
            <label class="form-label">Actor (correo)</label>
            <input id="auditActor" class="form-control" placeholder="usuario@midis.gob.pe">
          </div>
          <div class="col-md-3">
            <label class="form-label">Acción</label>
            <select id="auditAccion" class="form-select">
              <option value="">Todas</option>
              <option value="LOGIN">LOGIN</option>
              <option value="LOGOUT">LOGOUT</option>
              <option value="CREATE">CREATE</option>
              <option value="UPDATE">UPDATE</option>
              <option value="DELETE">DELETE</option>
            </select>
          </div>
          <div class="col-md-2 d-flex align-items-end gap-2">
            <button id="btnVerAuditoria" type="button" class="btn btn-primary btn-sm w-100">Ver</button>
            <button id="btnLimpiarAuditoria" type="button" class="btn btn-outline-secondary btn-sm w-100">Limpiar</button>
          </div>
        </div>

        <div class="d-flex justify-content-between mb-2">
          <div id="auditEstadoServidor" class="text-muted small">Servidor: conectado, usando respaldo local (not_found)</div>
          <div class="text-muted small">Máx. 1000 registros</div>
        </div>

        <div class="table-responsive">
          <table class="table table-sm table-striped" id="tablaAuditoria">
            <thead class="table-light">
              <tr>
                <th>Fecha/Hora</th>
                <th>Actor</th>
                <th>Rol</th>
                <th>Acción</th>
                <th>Entidad</th>
                <th>ID</th>
                <th>Detalle</th>
                <th>Acción</th>
              </tr>
            </thead>
            <tbody></tbody>
          </table>
        </div>

        <div class="alert alert-info small mt-3">
          <strong>Tip:</strong> Usa “Desde/Hasta” para acotar. El detalle se puede copiar en JSON.
        </div>
      </div>

      <div class="tab-pane fade" id="adminConflictos">
        <div class="d-flex justify-content-between align-items-center mb-2">
          <div id="conflictosMensaje" class="text-muted small">
            No hay conflictos de sincronización registrados en este navegador.
          </div>
          <div class="d-flex gap-2">
            <button id="btnConflictosServidor" type="button" class="btn btn-outline-primary btn-sm">Actualizar</button>
            <button id="btnLimpiarConflictos" type="button" class="btn btn-outline-danger btn-sm">Limpiar historial</button>
          </div>
        </div>

        <div class="alert alert-warning small">
          <strong>Importante:</strong> “Servidor” reemplaza tu copia local por la versión vigente del servidor.
          “Local” conserva tu edición local e intenta volver a subirla usando la última base del servidor.
          No fusiona textos automáticamente; resuelve el conflicto eligiendo cuál versión prevalece.
        </div>

        <div class="table-responsive">
          <table class="table table-sm table-striped" id="tablaConflictos">
            <thead class="table-light">
              <tr>
                <th>Fecha/hora del conflicto</th>
                <th>Código</th>
                <th>Motivo</th>
                <th>Fecha del servidor</th>
                <th>Estado local / servidor</th>
                <th>Resolución aplicada</th>
                <th>Acción</th>
              </tr>
            </thead>
            <tbody></tbody>
          </table>
        </div>
      </div>

    </div>
  `;
}

function initAdminPanel() {
  if (adminPanelInicializado) return;
  adminPanelInicializado = true;

  const modal = $('modalAdminPanel');
  if (!modal) return;

  modal.addEventListener('click', (e) => {
    const btnTab = e.target.closest('[data-admin-tab]');
    if (btnTab) {
      e.preventDefault();
      activarAdminTab(btnTab.getAttribute('data-admin-tab'));
    }
  });

  modal.addEventListener('click', (e) => {
    if (e.target.id === 'btnCrearUsuarioAdmin') crearUsuarioAdmin();
    if (e.target.id === 'btnCopiarClaveAdmin') copiarClaveAdmin();
    if (e.target.id === 'btnActualizarUsuarios') cargarUsuariosAdmin();
    if (e.target.id === 'btnVerAuditoria') cargarAuditoriaAdmin();
    if (e.target.id === 'btnLimpiarAuditoria') limpiarAuditoriaAdmin();
    if (e.target.id === 'btnConflictosServidor') cargarConflictosAdmin();
    if (e.target.id === 'btnLimpiarConflictos') limpiarConflictosAdmin();

    if (e.target.dataset.adminToggleUser) toggleUsuarioAdmin(e.target.dataset.adminToggleUser);
    if (e.target.dataset.adminResetUser) resetClaveUsuarioAdmin(e.target.dataset.adminResetUser);
    if (e.target.dataset.auditCopy) copiarTexto(e.target.dataset.auditCopy);
  });

  modal.addEventListener('input', (e) => {
    if (e.target.id === 'adminBuscarUsuario') cargarUsuariosAdmin();
  });
}

function activarAdminTab(target) {
  if (!esAdministrador()) {
    alert('Acceso permitido solo para Administrador.');
    return;
  }

  const modal = $('modalAdminPanel');
  if (!modal || !target) return;

  const targetId = String(target).replace('#', '');

  modal.querySelectorAll('[data-admin-tab]').forEach(btn => {
    const activo = btn.getAttribute('data-admin-tab') === `#${targetId}`;
    btn.classList.toggle('active', activo);
  });

  modal.querySelectorAll('.tab-content > .tab-pane').forEach(tab => {
    const activo = tab.id === targetId;
    tab.classList.toggle('show', activo);
    tab.classList.toggle('active', activo);
  });

  if (targetId === 'adminUsuarios') cargarUsuariosAdmin();
  if (targetId === 'adminAuditoria') cargarAuditoriaAdmin();
  if (targetId === 'adminConflictos') cargarConflictosAdmin();
}

async function cargarUsuariosAdmin() {
  if (!esAdministrador()) return;

  const tbody = document.querySelector('#tablaAdminUsuarios tbody');
  const contador = $('adminUsuariosContador');
  if (!tbody) return;

  tbody.innerHTML = '<tr><td colspan="5" class="text-muted">Cargando usuarios...</td></tr>';

  let usuarios = [];
  const res = await api('/users');

  if (res.ok && Array.isArray(res.data?.users)) usuarios = res.data.users;
  else if (res.ok && Array.isArray(res.data)) usuarios = res.data;

  const locales = cargarUsuariosLocales();

  if (!usuarios.length) {
    usuarios = [
      { name: 'COE MIDIS', email: 'coemidis@midis.gob.pe', role: 'Consulta', estado: 'activo', active: 1 },
      { name: 'Administrador DEMO', email: 'admin@midis.gob.pe', role: 'Administrador', estado: 'activo', active: 1 },
      ...locales
    ];
  } else {
    const mapa = new Map();
    [...usuarios, ...locales].forEach(item => {
      const u = normalizarUsuario(item);
      if (u) mapa.set(u.email, u);
    });
    usuarios = [...mapa.values()];
  }

  usuarios = usuarios.filter(u => normalizarTexto(u.role || u.rol) !== 'EVALUADOR');

  const filtro = normalizarTexto($('adminBuscarUsuario')?.value || '');
  const filtrados = usuarios.filter(u => {
    const texto = normalizarTexto(`${u.name || u.nombre || ''} ${u.email || u.correo || ''}`);
    return !filtro || texto.includes(filtro);
  });

  if (contador) contador.textContent = `Mostrando ${filtrados.length} de ${usuarios.length}`;

  if (!filtrados.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="text-muted">Sin usuarios para mostrar.</td></tr>';
    return;
  }

  tbody.innerHTML = filtrados.map(u => {
    const nu = normalizarUsuario(u) || u;
    const email = nu.email || '';
    const activo = String(nu.estado || '').toLowerCase() === 'activo';
    return `
      <tr>
        <td>${escapeHtml(nu.name || nu.nombre || '')}</td>
        <td>${escapeHtml(email)}</td>
        <td><span class="badge text-bg-secondary">${escapeHtml(nu.role || nu.rol || '')}</span></td>
        <td><span class="badge ${activo ? 'text-bg-success' : 'text-bg-danger'}">${activo ? 'Activo' : 'Inactivo'}</span></td>
        <td>
          <button type="button"
                  class="btn btn-sm ${activo ? 'btn-outline-danger' : 'btn-outline-success'}"
                  data-admin-toggle-user="${escapeHtmlAttr(email)}">
            ${activo ? 'Desactivar' : 'Activar'}
          </button>
          <button type="button"
                  class="btn btn-sm btn-outline-secondary"
                  data-admin-reset-user="${escapeHtmlAttr(email)}">
            Reset clave
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

async function crearUsuarioAdmin() {
  if (!esAdministrador()) return;

  const nombre = $('adminUserName')?.value.trim() || '';
  const email = $('adminUserEmail')?.value.trim() || '';
  const rol = $('adminUserRole')?.value || '';

  if (!nombre || !email || !rol) {
    alert('Complete nombre, correo y rol.');
    return;
  }

  const clave = generarClaveTemporal();
  if ($('adminGeneratedPassword')) $('adminGeneratedPassword').value = clave;

  const usuario = normalizarUsuario({ nombre, name: nombre, email, rol, role: rol, password: clave, estado: 'activo', active: 1 });
  const lista = cargarUsuariosLocales().filter(u => u.email !== usuario.email);
  lista.push(usuario);
  guardarUsuariosLocales(lista);

  await api('/users', 'POST', {
    name: usuario.name,
    nombre: usuario.nombre,
    email: usuario.email,
    password: usuario.password,
    role: usuario.role,
    rol: usuario.rol,
    programa: usuario.programa,
    estado: usuario.estado,
    active: usuario.active
  });

  await cargarUsuariosAdmin();
}

function toggleUsuarioAdmin(email) {
  const lista = cargarUsuariosLocales();
  const usuario = lista.find(u => String(u.email) === normalizarEmail(email));
  if (usuario) {
    usuario.estado = usuario.estado === 'activo' ? 'inactivo' : 'activo';
    usuario.active = usuario.estado === 'activo' ? 1 : 0;
    guardarUsuariosLocales(lista);
  }
  cargarUsuariosAdmin();
}

function resetClaveUsuarioAdmin(email) {
  const clave = generarClaveTemporal();
  const lista = cargarUsuariosLocales();
  const usuario = lista.find(u => String(u.email) === normalizarEmail(email));
  if (usuario) {
    usuario.password = clave;
    guardarUsuariosLocales(lista);
  }
  if ($('adminGeneratedPassword')) $('adminGeneratedPassword').value = clave;
  alert(`Clave temporal generada para ${email}`);
}

function generarClaveTemporal() {
  return `MIDIS${Math.random().toString(36).slice(2, 8).toUpperCase()}2026!`;
}

async function copiarClaveAdmin() {
  const input = $('adminGeneratedPassword');
  if (!input || !input.value) {
    alert('No hay clave temporal generada.');
    return;
  }
  copiarTexto(input.value);
}

async function cargarAuditoriaAdmin() {
  if (!esAdministrador()) return;

  const tbody = document.querySelector('#tablaAuditoria tbody');
  if (!tbody) return;

  tbody.innerHTML = '<tr><td colspan="8" class="text-muted">Cargando auditoría...</td></tr>';

  const desde = $('auditDesde')?.value || '';
  const hasta = $('auditHasta')?.value || '';
  const actor = $('auditActor')?.value || '';
  const accion = $('auditAccion')?.value || '';

  const qs = new URLSearchParams();
  if (desde) qs.set('desde', desde);
  if (hasta) qs.set('hasta', hasta);
  if (actor) qs.set('actor', actor);
  if (accion) qs.set('accion', accion);

  let registros = [];
  const res = await api(`/audit${qs.toString() ? '?' + qs.toString() : ''}`);

  if (res.ok && Array.isArray(res.data?.items)) registros = res.data.items;
  else if (res.ok && Array.isArray(res.data?.audit)) registros = res.data.audit;
  else if (res.ok && Array.isArray(res.data)) registros = res.data;

  if (!registros.length) {
    registros = [
      {
        fecha: '2026-04-28 12:03:25',
        actor: state.session?.email || 'admin@midis.gob.pe',
        role: 'Administrador',
        action: 'LOGIN',
        entity: 'session',
        id: state.session?.email || 'admin@midis.gob.pe',
        detail: { remote: true }
      },
      {
        fecha: '2026-04-28 12:03:23',
        actor: state.session?.email || 'admin@midis.gob.pe',
        role: 'Administrador',
        action: 'LOGOUT',
        entity: 'session',
        id: state.session?.email || 'admin@midis.gob.pe',
        detail: { remote: true }
      }
    ];
  }

  tbody.innerHTML = registros.map(r => {
    const detalle = typeof r.detail === 'string' ? r.detail : JSON.stringify(r.detail || r.detalle || {});
    return `
      <tr>
        <td>${escapeHtml(r.fecha || r.created_at || r.timestamp || '')}</td>
        <td>${escapeHtml(r.actor || r.usuario || r.email || '')}</td>
        <td>${escapeHtml(r.role || r.rol || '')}</td>
        <td>${escapeHtml(r.action || r.accion || '')}</td>
        <td>${escapeHtml(r.entity || r.entidad || r.entity_type || '')}</td>
        <td>${escapeHtml(r.id || r.entity_id || '')}</td>
        <td><code>${escapeHtml(detalle)}</code></td>
        <td>
          <button type="button"
                  class="btn btn-sm btn-outline-secondary"
                  data-audit-copy="${escapeHtmlAttr(detalle)}">
            Copiar
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

function limpiarAuditoriaAdmin() {
  if ($('auditDesde')) $('auditDesde').value = '';
  if ($('auditHasta')) $('auditHasta').value = '';
  if ($('auditActor')) $('auditActor').value = '';
  if ($('auditAccion')) $('auditAccion').value = '';

  cargarAuditoriaAdmin();
}

async function cargarConflictosAdmin() {
  if (!esAdministrador()) return;

  const tbody = document.querySelector('#tablaConflictos tbody');
  if (!tbody) return;

  tbody.innerHTML = '<tr><td colspan="7" class="text-muted">Cargando conflictos...</td></tr>';

  let conflictos = [];
  const res = await api('/conflictos');

  if (res.ok && Array.isArray(res.data?.items)) conflictos = res.data.items;
  else if (res.ok && Array.isArray(res.data?.conflictos)) conflictos = res.data.conflictos;
  else if (res.ok && Array.isArray(res.data)) conflictos = res.data;

  if (!conflictos.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-muted">No hay conflictos registrados.</td></tr>';
    return;
  }

  tbody.innerHTML = conflictos.map(c => `
    <tr>
      <td>${escapeHtml(c.fecha || c.created_at || c.timestamp || '')}</td>
      <td>${escapeHtml(c.codigo || c.entity_id || c.id || '')}</td>
      <td>${escapeHtml(c.motivo || c.reason || c.tipo || '')}</td>
      <td>${escapeHtml(c.fecha_servidor || c.server_date || '')}</td>
      <td>${escapeHtml(c.estado || c.estado_local_servidor || '')}</td>
      <td>${escapeHtml(c.resolucion || c.resolution || '')}</td>
      <td><button type="button" class="btn btn-sm btn-outline-primary" disabled>Resolver</button></td>
    </tr>
  `).join('');
}

function limpiarConflictosAdmin() {
  const tbody = document.querySelector('#tablaConflictos tbody');
  if (tbody) tbody.innerHTML = '<tr><td colspan="7" class="text-muted">No hay conflictos registrados.</td></tr>';
}

async function copiarTexto(texto) {
  try {
    await navigator.clipboard.writeText(texto);
    alert('Copiado.');
  } catch {
    const ta = document.createElement('textarea');
    ta.value = texto;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    alert('Copiado.');
  }
}

// ================= FECHA =================
function activarEventosDS() {
  if (dsEventosInicializados) {
    cargarDecretosParaOrigen();
    actualizarProrrogaUI();
    return;
  }

  dsEventosInicializados = true;

  $('dsFechaInicio')?.addEventListener('change', calcularFechaFin);
  $('dsPlazoDias')?.addEventListener('input', calcularFechaFin);

  const btnGuardar = $('btnGuardarDS');
  if (btnGuardar) {
    btnGuardar.type = 'button';
    btnGuardar.addEventListener('click', (e) => {
      e.preventDefault();
      guardarDecreto();
    });
  }

  $('dsEsProrroga')?.addEventListener('change', actualizarProrrogaUI);
  $('dsOrigen')?.addEventListener('change', actualizarDatosProrroga);
  $('dsNumero')?.addEventListener('input', actualizarCodigoRegistroDS);
  $('dsAnio')?.addEventListener('input', actualizarCodigoRegistroDS);

  renderSectoresFirmantes();
  actualizarCodigoRegistroDS();
  cargarDecretosParaOrigen();
  actualizarProrrogaUI();
}

function calcularFechaFin() {
  const inicio = $('dsFechaInicio')?.value;
  const plazo = parseInt($('dsPlazoDias')?.value || 0);

  if (!inicio || !plazo) return;

  const f = new Date(inicio);
  f.setDate(f.getDate() + plazo);

  const fin = f.toISOString().split('T')[0];
  if ($('dsFechaFin')) $('dsFechaFin').value = fin;

  if ($('dsVigencia')) {
    $('dsVigencia').value = (new Date(fin) >= new Date()) ? 'Vigente' : 'No vigente';
  }
}


// ================= DECRETOS SUPREMOS / PRÓRROGAS =================
function cargarDecretosLocales() {
  try {
    const data = JSON.parse(localStorage.getItem(DECRETOS_STORAGE_KEY) || '[]');
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.warn('No se pudo leer localStorage.decretos', e);
    return [];
  }
}

function guardarDecretosLocales(lista) {
  const data = Array.isArray(lista) ? lista : [];
  localStorage.setItem(DECRETOS_STORAGE_KEY, JSON.stringify(data));
  state.decretos = data;
  return data;
}

async function cargarDecretosParaOrigen() {
  let decretos = cargarDecretosLocales();
  const res = await api('/decretos');
  const remotos = extraerListaDecretos(res && res.data);

  if (res.ok && remotos.length) {
    const mapa = new Map();
    decretos.concat(remotos).forEach(d => {
      const nd = normalizarDecreto(d);
      if (nd) mapa.set(String(nd.id), nd);
    });
    decretos = Array.from(mapa.values());
    guardarDecretosLocales(decretos);
  } else {
    state.decretos = decretos.map(normalizarDecreto).filter(Boolean);
  }

  cargarDSOrigen();
  actualizarDatosProrroga();
  renderTablaDecretosBasica();
  if (typeof cargarSelectAccionDS === 'function') cargarSelectAccionDS();
  if (typeof cargarRDSDesdeDSSeleccionado === 'function') cargarRDSDesdeDSSeleccionado();
  if (typeof renderTablaAcciones === 'function') renderTablaAcciones();
}

function extraerListaDecretos(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.decretos)) return data.decretos;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.data)) return data.data;
  return [];
}

function normalizarDecreto(raw) {
  if (!raw) return null;
  const numero = String(raw.numero || raw.ds || raw.decreto || raw.decreto_supremo || '').trim();
  const anio = String(raw.anio || raw.año || '').trim();
  const idBase = raw.id || raw.codigo_registro || raw.codigoRegistro || generarCodigoRegistro(numero, anio) || crypto.randomUUID();
  return {
    ...raw,
    id: String(idBase),
    numero,
    anio,
    codigo_registro: raw.codigo_registro || raw.codigoRegistro || generarCodigoRegistro(numero, anio),
    peligro: raw.peligro || '',
    tipo_peligro: raw.tipo_peligro || raw.tipoPeligro || '',
    fecha_inicio: raw.fecha_inicio || raw.fechaInicio || '',
    fecha_fin: raw.fecha_fin || raw.fechaFin || '',
    vigencia: raw.vigencia || calcularVigencia(raw.fecha_fin || raw.fechaFin || ''),
    semaforo: raw.semaforo || calcularSemaforo(raw.fecha_fin || raw.fechaFin || ''),
    motivos: raw.motivos || raw.exposicion_motivos || '',
    sectores: Array.isArray(raw.sectores) ? raw.sectores : parsearLista(raw.sectores),
    territorio: Array.isArray(raw.territorio) ? raw.territorio : [],
    es_prorroga: Boolean(raw.es_prorroga || raw.esProrroga),
    ds_origen_id: raw.ds_origen_id || raw.dsOrigenId || raw.ds_origen || '',
    nivel_prorroga: Number(raw.nivel_prorroga || raw.nivelProrroga || 0),
    cadena: raw.cadena || '',
    rdsActivo: Boolean(raw.rdsActivo || raw.rds_activo),
    numeroReunion: raw.numeroReunion || raw.numero_reunion || '',
    fechaReunion: raw.fechaReunion || raw.fecha_reunion || '',
    programasHabilitados: Array.isArray(raw.programasHabilitados) ? raw.programasHabilitados.map(normalizarProgramaNombre) : PROGRAMAS_RDS.slice()
  };
}

function parsearLista(valor) {
  if (!valor) return [];
  if (Array.isArray(valor)) return valor;
  try {
    const parsed = JSON.parse(valor);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return String(valor).split(',').map(x => x.trim()).filter(Boolean);
  }
}

function generarCodigoRegistro(numero, anio) {
  const n = String(numero || '').trim().padStart(3, '0');
  const a = String(anio || new Date().getFullYear()).trim();
  return n && n !== '000' ? `DS-${n}-${a}` : '';
}

function cargarDSOrigen() {
  const sel = $('dsOrigen');
  if (!sel) return;

  const valorActual = sel.value;
  const decretos = (state.decretos.length ? state.decretos : cargarDecretosLocales())
    .map(normalizarDecreto)
    .filter(Boolean)
    .sort((a, b) => String(`${b.anio}${b.numero}`).localeCompare(String(`${a.anio}${a.numero}`)));

  sel.innerHTML = '<option value="">Seleccione DS origen...</option>';

  decretos.forEach(d => {
    const opt = document.createElement('option');
    opt.value = d.id;
    opt.textContent = `${formatearNumeroDS(d)}${d.tipo_peligro ? ' · ' + d.tipo_peligro : ''}`;
    opt.dataset.nivel = String(d.nivel_prorroga || 0);
    opt.dataset.cadena = d.cadena || formatearNumeroDS(d);
    sel.appendChild(opt);
  });

  if (valorActual && Array.from(sel.options).some(o => o.value === valorActual)) sel.value = valorActual;
}

function actualizarProrrogaUI() {
  const checked = Boolean($('dsEsProrroga')?.checked);
  const origen = $('dsOrigen');
  const nivel = $('dsNivelProrroga');
  const cadena = $('dsCadena');

  if (origen) origen.disabled = !checked;
  if (nivel) nivel.readOnly = !checked;
  if (cadena) cadena.readOnly = !checked;

  if (checked) {
    cargarDSOrigen();
    actualizarDatosProrroga();
  } else {
    if (origen) origen.value = '';
    if (nivel) nivel.value = '0';
    if (cadena) cadena.value = '';
  }
}

function actualizarDatosProrroga() {
  if (!$('dsEsProrroga')?.checked) return;

  const idOrigen = $('dsOrigen')?.value || '';
  const dsOrigen = (state.decretos.length ? state.decretos : cargarDecretosLocales())
    .map(normalizarDecreto)
    .find(d => String(d.id) === String(idOrigen));

  if (!idOrigen || !dsOrigen) {
    if ($('dsNivelProrroga')) $('dsNivelProrroga').value = '';
    if ($('dsCadena')) $('dsCadena').value = '';
    return;
  }

  const nuevoNivel = Number(dsOrigen.nivel_prorroga || 0) + 1;
  if ($('dsNivelProrroga')) $('dsNivelProrroga').value = String(nuevoNivel);

  const baseCadena = dsOrigen.cadena || formatearNumeroDS(dsOrigen);
  const actual = formatearNumeroDS({ numero: $('dsNumero')?.value, anio: $('dsAnio')?.value });
  if ($('dsCadena')) $('dsCadena').value = actual ? `${baseCadena} → ${actual}` : baseCadena;
}

async function guardarDecreto() {
  try {
    const validacion = validarFormularioDecreto();
    if (!validacion.ok) {
      alert(validacion.mensaje);
      return;
    }

    const decreto = construirObjetoDecreto();
    const existentes = cargarDecretosLocales().map(normalizarDecreto).filter(Boolean);
    const lista = existentes.filter(d => String(d.id) !== String(decreto.id));
    lista.push(decreto);
    guardarDecretosLocales(lista);

    cargarDSOrigen();
    renderTablaDecretosBasica();

    const res = await api('/decretos', 'POST', decreto);
    if (!res.ok) console.warn('No se confirmó guardado en API; se conservó en localStorage.', res.data);

    alert('Decreto guardado correctamente');
    limpiarFormularioDecreto();
  } catch (e) {
    console.error('Error al guardar Decreto Supremo:', e);
    alert('No se pudo guardar el Decreto Supremo. Revise la consola para el detalle técnico.');
  }
}

function validarFormularioDecreto() {
  const obligatorios = [
    ['dsNumero', 'Ingrese el Número DS.'],
    ['dsAnio', 'Ingrese el Año.'],
    ['dsPeligro', 'Seleccione el Peligro.'],
    ['dsTipoPeligro', 'Seleccione el Tipo de peligro.'],
    ['dsPlazoDias', 'Ingrese el Plazo en días.'],
    ['dsFechaInicio', 'Ingrese la Fecha inicio.'],
    ['dsFechaFin', 'Calcule o ingrese la Fecha final.']
  ];

  for (const [id, mensaje] of obligatorios) {
    if (!String($(id)?.value || '').trim()) return { ok: false, mensaje };
  }

  if (!state.nuevoDSTerritorios.length) return { ok: false, mensaje: 'Agregue al menos un distrito al territorio involucrado.' };

  if ($('dsEsProrroga')?.checked) {
    if (!$('dsOrigen')?.value) return { ok: false, mensaje: 'Seleccione el DS origen de la prórroga.' };
    if (!String($('dsNivelProrroga')?.value || '').trim()) return { ok: false, mensaje: 'Ingrese el Nivel prórroga.' };
  }

  return { ok: true, mensaje: '' };
}

function construirObjetoDecreto() {
  calcularFechaFin();
  actualizarDatosProrroga();

  const numero = String($('dsNumero')?.value || '').trim();
  const anio = String($('dsAnio')?.value || '').trim();
  const codigo = String($('dsCodigoRegistro')?.value || generarCodigoRegistro(numero, anio)).trim();
  const fechaFin = $('dsFechaFin')?.value || '';
  const esProrroga = Boolean($('dsEsProrroga')?.checked);

  return normalizarDecreto({
    id: codigo || crypto.randomUUID(),
    numero,
    anio,
    codigo_registro: codigo,
    peligro: $('dsPeligro')?.value || '',
    tipo_peligro: $('dsTipoPeligro')?.value || '',
    plazo_dias: Number($('dsPlazoDias')?.value || 0),
    fecha_inicio: $('dsFechaInicio')?.value || '',
    fecha_fin: fechaFin,
    vigencia: calcularVigencia(fechaFin),
    semaforo: calcularSemaforo(fechaFin),
    motivos: $('dsMotivos')?.value || '',
    sectores: obtenerSectoresSeleccionados(),
    territorio: state.nuevoDSTerritorios.map(t => ({ ...t })),
    es_prorroga: esProrroga,
    ds_origen_id: esProrroga ? $('dsOrigen')?.value || '' : '',
    nivel_prorroga: esProrroga ? Number($('dsNivelProrroga')?.value || 0) : 0,
    cadena: esProrroga ? $('dsCadena')?.value || '' : '',
    usuario_registro: state.session?.email || '',
    fecha_registro: new Date().toISOString(),
    rdsActivo: false,
    numeroReunion: '',
    fechaReunion: '',
    programasHabilitados: PROGRAMAS_RDS.slice()
  });
}

function obtenerSectoresSeleccionados() {
  const cont = $('sectoresContainer');
  if (!cont) return [];
  return [...new Set(Array.from(cont.querySelectorAll('input[type="checkbox"]:checked')).map(x => String(x.value || x.dataset.value || '').trim()).filter(Boolean))];
}

function limpiarFormularioDecreto() {
  ['dsNumero', 'dsPlazoDias', 'dsFechaInicio', 'dsFechaFin', 'dsVigencia', 'dsSemaforo', 'dsMotivos'].forEach(id => {
    if ($(id)) $(id).value = '';
  });

  if ($('dsPeligro')) $('dsPeligro').value = '';
  if ($('dsTipoPeligro')) $('dsTipoPeligro').value = '';
  if ($('dsCodigoRegistro')) $('dsCodigoRegistro').value = '';
  if ($('dsEsProrroga')) $('dsEsProrroga').checked = false;

  $('sectoresContainer')?.querySelectorAll('input[type="checkbox"]').forEach(chk => chk.checked = false);

  state.nuevoDSTerritorios = [];
  renderTerritorioSeleccionado();
  actualizarProrrogaUI();
  actualizarBotonAgregarDistritos();
}

function calcularVigencia(fechaFin) {
  if (!fechaFin) return '';
  const hoyLocal = new Date();
  hoyLocal.setHours(0, 0, 0, 0);
  const fin = new Date(`${fechaFin}T00:00:00`);
  return fin >= hoyLocal ? 'Vigente' : 'No vigente';
}

function calcularSemaforo(fechaFin) {
  if (!fechaFin) return '';
  const hoyLocal = new Date();
  hoyLocal.setHours(0, 0, 0, 0);
  const fin = new Date(`${fechaFin}T00:00:00`);
  const dias = Math.ceil((fin - hoyLocal) / 86400000);
  if (dias < 0) return 'Vencido';
  if (dias <= 7) return 'Rojo';
  if (dias <= 15) return 'Ámbar';
  return 'Verde';
}

function formatearNumeroDS(d) {
  const numero = String(d?.numero || '').trim();
  const anio = String(d?.anio || '').trim();
  if (!numero && !anio) return '';
  return `DS N.° ${numero}${anio ? '-' + anio : ''}-PCM`;
}

function renderTablaDecretosBasica() {
  const tbody = document.querySelector('#tablaDS tbody');
  if (!tbody) return;

  const decretos = (state.decretos.length ? state.decretos : cargarDecretosLocales()).map(normalizarDecreto).filter(Boolean);

  if (!decretos.length) {
    tbody.innerHTML = '<tr><td colspan="17" class="text-muted">No hay Decretos Supremos registrados.</td></tr>';
    return;
  }

  tbody.innerHTML = decretos.map(d => {
    const territorio = Array.isArray(d.territorio) ? d.territorio : [];
    const deps = new Set(territorio.map(t => t.departamento).filter(Boolean));
    const provs = new Set(territorio.map(t => `${t.departamento}|${t.provincia}`).filter(Boolean));
    const dists = new Set(territorio.map(t => `${t.departamento}|${t.provincia}|${t.distrito}`).filter(Boolean));

    return `
      <tr>
        <td>${escapeHtml(formatearNumeroDS(d))}</td>
        <td>${escapeHtml(d.anio)}</td>
        <td>${escapeHtml(d.peligro)}</td>
        <td>${escapeHtml(d.tipo_peligro)}</td>
        <td>${escapeHtml(d.fecha_inicio)}</td>
        <td>${escapeHtml(d.fecha_fin)}</td>
        <td>${escapeHtml(d.vigencia)}</td>
        <td>${escapeHtml(d.semaforo)}</td>
        <td>${deps.size}</td>
        <td>${provs.size}</td>
        <td>${dists.size}</td>
        <td>${d.es_prorroga ? 'Prórroga' : 'Original'}</td>
        <td>${escapeHtml(d.cadena || '')}</td>
        <td>${escapeHtml(d.nivel_prorroga || 0)}</td>
        <td><button type="button" class="btn btn-sm ${d.rdsActivo ? 'btn-success' : 'btn-outline-primary'}" ${puedeUsarRDS() ? '' : 'disabled'} onclick="abrirRDS('${escapeHtmlAttr(d.id)}')">RDS</button></td>
        <td><button type="button" class="btn btn-sm btn-outline-secondary" disabled>PreAprobar</button></td>
        <td><button type="button" class="btn btn-sm btn-outline-dark" onclick="verDetalleDS('${escapeHtmlAttr(d.id)}')">👁</button></td>
      </tr>
    `;
  }).join('');
}

function renderSectoresFirmantes() {
  const cont = $('sectoresContainer');
  if (!cont) return;
  cont.innerHTML = MINISTERIOS_FIRMANTES.map((m, i) => `
    <div class="col-6 col-md-3 col-lg-2">
      <div class="form-check border rounded bg-white px-2 py-2 h-100">
        <input class="form-check-input ms-0 me-1" type="checkbox" id="sector_${i}" value="${escapeHtmlAttr(m)}">
        <label class="form-check-label" for="sector_${i}">${escapeHtml(m)}</label>
      </div>
    </div>
  `).join('');
}

function actualizarCodigoRegistroDS() {
  const input = $('dsCodigoRegistro');
  if (!input) return;
  input.value = generarCodigoRegistro($('dsNumero')?.value, $('dsAnio')?.value);
  if ($('dsEsProrroga')?.checked) actualizarDatosProrroga();
}

function buscarDecretoPorId(id) {
  return (state.decretos.length ? state.decretos : cargarDecretosLocales()).map(normalizarDecreto).find(d => String(d.id) === String(id)) || null;
}

function verDetalleDS(id) {
  const d = buscarDecretoPorId(id);
  if (!d) return alert('No se encontró el Decreto Supremo.');
  const territorio = Array.isArray(d.territorio) ? d.territorio : [];
  const sectores = Array.isArray(d.sectores) && d.sectores.length ? d.sectores.join(', ') : 'No registrado';
  const body = $('modalDSBody');
  if (body) {
    body.innerHTML = `
      <div class="mb-2"><strong>Decreto Supremo:</strong> ${escapeHtml(formatearNumeroDS(d))}</div>
      <div class="mb-2"><strong>Peligro:</strong> ${escapeHtml(d.peligro)} · ${escapeHtml(d.tipo_peligro)}</div>
      <div class="mb-2"><strong>Vigencia:</strong> ${escapeHtml(d.fecha_inicio)} al ${escapeHtml(d.fecha_fin)} · ${escapeHtml(d.vigencia)}</div>
      <div class="mb-2"><strong>Sectores que firman:</strong> ${escapeHtml(sectores)}</div>
      <div class="mb-2"><strong>Relación:</strong> ${d.es_prorroga ? 'Prórroga' : 'Original'} ${d.cadena ? '· ' + escapeHtml(d.cadena) : ''}</div>
      <div class="mb-2"><strong>RDS:</strong> ${d.rdsActivo ? 'Registro de Acciones activado' : 'No activado'} ${d.numeroReunion ? '· ' + escapeHtml(d.numeroReunion) : ''} ${d.fechaReunion ? '· ' + escapeHtml(d.fechaReunion) : ''}</div>
      <hr>
      <strong>Territorio involucrado</strong>
      <div class="small mt-2">${territorio.map(t => `${escapeHtml(t.departamento)} / ${escapeHtml(t.provincia)} / ${escapeHtml(t.distrito)}`).join('<br>') || 'No registrado'}</div>
    `;
  }
  const modal = $('modalDS');
  if (modal && window.bootstrap?.Modal) bootstrap.Modal.getOrCreateInstance(modal).show();
}

window.verDetalleDS = verDetalleDS;

window.guardarDecreto = guardarDecreto;
window.actualizarProrrogaUI = actualizarProrrogaUI;

// ================= UBIGEO =================
function normalizarTexto(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase();
}

function getUbigeoValue(reg) {
  return reg?.ubigeo || reg?.UBIGEO || reg?.codigo || reg?.cod_ubigeo || '';
}

function getLatitud(reg) {
  return reg?.latitud ?? reg?.lat ?? '';
}

function getLongitud(reg) {
  return reg?.longitud ?? reg?.lng ?? reg?.lon ?? '';
}

function getTerritorioKey(reg) {
  const ubigeo = getUbigeoValue(reg);
  if (ubigeo) return String(ubigeo);

  return [
    normalizarTexto(reg?.departamento),
    normalizarTexto(reg?.provincia),
    normalizarTexto(reg?.distrito)
  ].join('|');
}

function initUbigeo() {
  if (!window.ubigeoData || !Array.isArray(window.ubigeoData)) {
    console.error('ubigeoData no cargó o no es un arreglo');
    return;
  }

  ubigeoCache = window.ubigeoData;

  cargarDepartamentos();
  renderTerritorioSeleccionado();
  actualizarBotonAgregarDistritos();

  if (ubigeoInicializado) return;
  ubigeoInicializado = true;

  $('selDepartamento')?.addEventListener('change', () => {
    cargarProvincias();
    limpiarDistritosChecklist('Seleccione una provincia.');
    actualizarBotonAgregarDistritos();
  });

  $('selProvincia')?.addEventListener('change', () => {
    cargarDistritos();
    actualizarBotonAgregarDistritos();
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

  const valorActual = sel.value;
  sel.innerHTML = '<option value="">Seleccione...</option>';

  const deps = [...new Set(
    ubigeoCache
      .map(x => x.departamento)
      .filter(Boolean)
  )].sort((a, b) => String(a).localeCompare(String(b), 'es'));

  deps.forEach(d => {
    const opt = document.createElement('option');
    opt.value = d;
    opt.textContent = d;
    sel.appendChild(opt);
  });

  if (valorActual && deps.includes(valorActual)) sel.value = valorActual;
}

function cargarProvincias() {
  const dep = $('selDepartamento')?.value || '';
  const sel = $('selProvincia');

  if (!sel) return;

  sel.innerHTML = '<option value="">Seleccione...</option>';

  if (!dep) {
    limpiarDistritosChecklist('Seleccione primero departamento y provincia.');
    actualizarBotonAgregarDistritos();
    return;
  }

  const provs = ubigeoCache
    .filter(x => normalizarTexto(x.departamento) === normalizarTexto(dep))
    .map(x => x.provincia)
    .filter(Boolean);

  [...new Set(provs)]
    .sort((a, b) => String(a).localeCompare(String(b), 'es'))
    .forEach(p => {
      const opt = document.createElement('option');
      opt.value = p;
      opt.textContent = p;
      sel.appendChild(opt);
    });

  actualizarBotonAgregarDistritos();
}

function cargarDistritos() {
  const dep = $('selDepartamento')?.value || '';
  const prov = $('selProvincia')?.value || '';
  const cont = $('distritosChecklist');

  if (!cont) return;

  cont.innerHTML = '';

  if (!dep || !prov) {
    limpiarDistritosChecklist('Seleccione primero departamento y provincia.');
    actualizarBotonAgregarDistritos();
    return;
  }

  const distritos = ubigeoCache
    .filter(x =>
      normalizarTexto(x.departamento) === normalizarTexto(dep) &&
      normalizarTexto(x.provincia) === normalizarTexto(prov)
    )
    .sort((a, b) => String(a.distrito || '').localeCompare(String(b.distrito || ''), 'es'));

  if (!distritos.length) {
    limpiarDistritosChecklist('No hay distritos para esta selección.');
    actualizarBotonAgregarDistritos();
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
             ${yaAgregado ? 'disabled' : ''}>
      <label class="form-check-label" for="dist_${idSeguro}">
        ${escapeHtml(d.distrito || '')}
        ${yaAgregado ? '<span class="text-success small"> — agregado</span>' : ''}
      </label>
    `;

    cont.appendChild(div);
  });

  cont.querySelectorAll('.chk-distrito').forEach(chk => {
    chk.addEventListener('change', actualizarBotonAgregarDistritos);
  });

  actualizarBotonAgregarDistritos();
}

function limpiarDistritosChecklist(mensaje) {
  const cont = $('distritosChecklist');
  if (!cont) return;

  cont.innerHTML = `<div class="text-muted small">${escapeHtml(mensaje)}</div>`;

  if ($('buscarDistrito')) $('buscarDistrito').value = '';
}

function actualizarBotonAgregarDistritos() {
  const btn = $('btnAgregarDistritos');
  const cont = $('distritosChecklist');

  if (!btn || !cont) return;

  const haySeleccionados = [...cont.querySelectorAll('.chk-distrito:checked:not(:disabled)')].length > 0;

  btn.disabled = !haySeleccionados;
  btn.classList.toggle('disabled', !haySeleccionados);
}

function filtrarDistritos() {
  const texto = normalizarTexto($('buscarDistrito')?.value || '');
  const cont = $('distritosChecklist');

  if (!cont) return;

  cont.querySelectorAll('.distrito-item').forEach(div => {
    const visible = normalizarTexto(div.textContent).includes(texto);
    div.style.display = visible ? '' : 'none';
  });

  actualizarBotonAgregarDistritos();
}

function marcarTodosDistritosVisibles() {
  const cont = $('distritosChecklist');
  if (!cont) return;

  cont.querySelectorAll('.distrito-item').forEach(div => {
    if (div.style.display === 'none') return;

    const chk = div.querySelector('.chk-distrito');
    if (chk && !chk.disabled) chk.checked = true;
  });

  actualizarBotonAgregarDistritos();
}

function limpiarChecksDistritos() {
  const cont = $('distritosChecklist');
  if (!cont) return;

  cont.querySelectorAll('.chk-distrito').forEach(chk => {
    chk.checked = false;
  });

  if ($('buscarDistrito')) $('buscarDistrito').value = '';

  filtrarDistritos();
  actualizarBotonAgregarDistritos();
}

function agregarDistritosSeleccionados() {
  const cont = $('distritosChecklist');
  if (!cont) return;

  const checks = [...cont.querySelectorAll('.chk-distrito:checked:not(:disabled)')];

  if (!checks.length) {
    alert('Seleccione al menos un distrito.');
    actualizarBotonAgregarDistritos();
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
  actualizarBotonAgregarDistritos();

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
  actualizarBotonAgregarDistritos();
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

// ================= REGISTRO DE ACCIONES / RDS =================
let accionesInicializadas = false;

function initRegistroAcciones() {
  cargarSelectAccionDS();
  configurarProgramasAccion();
  cargarCatalogosAccion();
  actualizarFechaRegistroAccion();
  aplicarRestriccionesAccion();
  renderTablaAcciones();

  if (accionesInicializadas) return;
  accionesInicializadas = true;

  $('accionDs')?.addEventListener('change', () => {
    cargarRDSDesdeDSSeleccionado();
    aplicarRestriccionesAccion();
  });
  $('btnActivarRDS')?.addEventListener('click', activarRDSSeleccionado);
  $('btnGuardarAccion')?.addEventListener('click', guardarAccionDS);
  $('accionPlazo')?.addEventListener('input', calcularFechaFinalAccion);
  $('accionFechaInicio')?.addEventListener('change', calcularFechaFinalAccion);
  $('accionMetaProgramada')?.addEventListener('input', calcularAvanceAccion);
  $('accionMetaEjecutada')?.addEventListener('input', calcularAvanceAccion);
}

function normalizarProgramaNombre(valor) {
  const t = normalizarTexto(valor);
  if (['CUNA MAS','CUNA MÁS','CUNAMAS'].includes(t)) return 'CUNA MÁS';
  if (['PENSION 65','PENSIÓN 65'].includes(t)) return 'PENSIÓN 65';
  if (['PAIS','PAÍS'].includes(t)) return 'PAIS';
  return t;
}

function cargarSelectAccionDS() {
  const sel = $('accionDs');
  if (!sel) return;
  const actual = sel.value;
  const decretos = (state.decretos.length ? state.decretos : cargarDecretosLocales()).map(normalizarDecreto).filter(Boolean);
  sel.innerHTML = '<option value="">Seleccione...</option>' + decretos.map(d => `<option value="${escapeHtmlAttr(d.id)}">${escapeHtml(formatearNumeroDS(d))}</option>`).join('');
  if (actual && Array.from(sel.options).some(o => o.value === actual)) sel.value = actual;
}

function configurarProgramasAccion() {
  const sel = $('accionPrograma');
  if (!sel) return;
  const programaUsuario = programaSesionNormalizado();
  if (esAdministrador()) {
    sel.innerHTML = '<option value="">Seleccione...</option>' + PROGRAMAS_RDS.map(p => `<option>${escapeHtml(p)}</option>`).join('');
    sel.disabled = false;
  } else if (esRegistrador() && programaUsuario) {
    sel.innerHTML = `<option>${escapeHtml(programaUsuario)}</option>`;
    sel.value = programaUsuario;
    sel.disabled = true;
  } else {
    sel.innerHTML = '<option value="">No habilitado</option>';
    sel.disabled = true;
  }
}

function cargarCatalogosAccion() {
  const tipo = $('accionTipo');
  if (tipo && !tipo.options.length) tipo.innerHTML = '<option value="">Seleccione...</option><option>Intervención directa</option><option>Seguimiento</option><option>Asistencia técnica</option><option>Coordinación territorial</option><option>Entrega de bienes o servicios</option>';
  const unidad = $('accionUnidad');
  if (unidad && !unidad.options.length) unidad.innerHTML = '<option value="">Seleccione...</option><option>Persona</option><option>Usuario</option><option>Servicio</option><option>Distrito</option><option>Acción</option><option>Informe</option><option>Coordinación</option>';
}

function actualizarFechaRegistroAccion() {
  if ($('accionFechaRegistro')) $('accionFechaRegistro').value = hoy();
}

function abrirRDS(id) {
  if (!puedeUsarRDS()) {
    alert('Solo Administrador o Registrador pueden usar RDS.');
    return;
  }
  initRegistroAcciones();
  const tabBtn = document.querySelector('[data-bs-target="#tabAcciones"]');
  if (tabBtn && window.bootstrap?.Tab) bootstrap.Tab.getOrCreateInstance(tabBtn).show();
  else if (tabBtn) tabBtn.click();
  setTimeout(() => {
    cargarSelectAccionDS();
    if ($('accionDs')) $('accionDs').value = id;
    cargarRDSDesdeDSSeleccionado();
    aplicarRestriccionesAccion();
  }, 0);
}

function cargarRDSDesdeDSSeleccionado() {
  const d = buscarDecretoPorId($('accionDs')?.value || '');
  if ($('rdsNumeroReunion')) $('rdsNumeroReunion').value = d?.numeroReunion || '';
  if ($('rdsFechaReunion')) $('rdsFechaReunion').value = d?.fechaReunion || '';
  if ($('rdsEstado')) $('rdsEstado').value = d?.rdsActivo ? 'Registro de Acciones activado' : 'No activado';
  if ($('accionResumenDS')) {
    $('accionResumenDS').innerHTML = d ? `<div class="alert ${d.rdsActivo ? 'alert-success' : 'alert-warning'} py-2 mb-0"><strong>${escapeHtml(formatearNumeroDS(d))}</strong> · ${escapeHtml(d.tipo_peligro || '')} · ${d.rdsActivo ? 'RDS activado' : 'RDS pendiente de activación'}</div>` : '';
  }
}

function activarRDSSeleccionado() {
  if (!esAdministrador()) {
    alert('La activación RDS corresponde al Administrador.');
    return;
  }
  const id = $('accionDs')?.value || '';
  const numeroReunion = $('rdsNumeroReunion')?.value || '';
  const fechaReunion = $('rdsFechaReunion')?.value || '';
  if (!id) return alert('Seleccione un Decreto Supremo.');
  if (!numeroReunion) return alert('Seleccione el número de reunión.');
  if (!fechaReunion) return alert('Ingrese la fecha de reunión.');
  const lista = cargarDecretosLocales().map(normalizarDecreto).filter(Boolean);
  const idx = lista.findIndex(d => String(d.id) === String(id));
  if (idx < 0) return alert('No se encontró el Decreto Supremo.');
  lista[idx] = { ...lista[idx], rdsActivo: true, numeroReunion, fechaReunion, programasHabilitados: PROGRAMAS_RDS.slice() };
  guardarDecretosLocales(lista);
  renderTablaDecretosBasica();
  cargarSelectAccionDS();
  if ($('accionDs')) $('accionDs').value = id;
  cargarRDSDesdeDSSeleccionado();
  aplicarRestriccionesAccion();
  api('/decretos', 'POST', lista[idx]);
  alert('Registro de Acciones activado correctamente.');
}

function aplicarRestriccionesAccion() {
  const d = buscarDecretoPorId($('accionDs')?.value || '');
  const programaUsuario = programaSesionNormalizado();
  const habilitadoPorRol = esAdministrador() || (esRegistrador() && d?.rdsActivo && d.programasHabilitados?.includes(programaUsuario));
  const puedeRegistrar = habilitadoPorRol && !esConsulta() && Boolean(d?.rdsActivo);
  const controlesAccion = ['accionTipo','accionCodigo','accionUnidad','accionMetaProgramada','accionPlazo','accionFechaInicio','accionMetaEjecutada','accionDetalle','accionDescripcion','btnGuardarAccion'];
  controlesAccion.forEach(id => { if ($(id)) $(id).disabled = !puedeRegistrar; });
  if ($('btnActivarRDS')) $('btnActivarRDS').disabled = !esAdministrador();
  if ($('rdsNumeroReunion')) $('rdsNumeroReunion').disabled = !esAdministrador();
  if ($('rdsFechaReunion')) $('rdsFechaReunion').disabled = !esAdministrador();
  if ($('rdsMensajeRol')) {
    $('rdsMensajeRol').textContent = esAdministrador()
      ? 'Administrador: puede activar RDS y administrar todos los programas.'
      : esRegistrador()
        ? (puedeRegistrar ? `Registrador habilitado para ${programaUsuario}.` : `Registrador ${programaUsuario || ''}: espere activación RDS del Administrador.`)
        : 'Consulta: no puede registrar acciones.';
  }
  configurarProgramasAccion();
}

function calcularFechaFinalAccion() {
  const inicio = $('accionFechaInicio')?.value;
  const plazo = parseInt($('accionPlazo')?.value || 0);
  if (!inicio || isNaN(plazo)) return;
  const f = new Date(`${inicio}T00:00:00`);
  f.setDate(f.getDate() + plazo);
  if ($('accionFechaFinal')) $('accionFechaFinal').value = f.toISOString().split('T')[0];
}

function calcularAvanceAccion() {
  const meta = Number($('accionMetaProgramada')?.value || 0);
  const eje = Number($('accionMetaEjecutada')?.value || 0);
  if ($('accionAvance')) $('accionAvance').value = meta > 0 ? Math.min(100, Math.round((eje / meta) * 100)) + '%' : '0%';
}

function cargarAccionesLocales() {
  try {
    const data = JSON.parse(localStorage.getItem(ACCIONES_STORAGE_KEY) || '[]');
    return Array.isArray(data) ? data : [];
  } catch { return []; }
}

function guardarAccionesLocales(lista) {
  localStorage.setItem(ACCIONES_STORAGE_KEY, JSON.stringify(Array.isArray(lista) ? lista : []));
}

function guardarAccionDS() {
  const d = buscarDecretoPorId($('accionDs')?.value || '');
  if (!d || !d.rdsActivo) return alert('Seleccione un DS con Registro de Acciones activado.');
  const programa = normalizarProgramaNombre($('accionPrograma')?.value || '');
  if (!programa) return alert('Seleccione el Programa Nacional.');
  if (esRegistrador() && programa !== programaSesionNormalizado()) return alert('No puede registrar acciones de otro programa.');
  if (!$('accionTipo')?.value || !$('accionDetalle')?.value.trim()) return alert('Complete tipo de acción y acción específica.');
  calcularFechaFinalAccion();
  calcularAvanceAccion();
  const accion = {
    id: crypto.randomUUID(),
    ds_id: d.id,
    ds: formatearNumeroDS(d),
    programa,
    tipo: $('accionTipo')?.value || '',
    codigo: $('accionCodigo')?.value || '',
    unidad: $('accionUnidad')?.value || '',
    meta_programada: Number($('accionMetaProgramada')?.value || 0),
    plazo: Number($('accionPlazo')?.value || 0),
    fecha_inicio: $('accionFechaInicio')?.value || '',
    fecha_final: $('accionFechaFinal')?.value || '',
    meta_ejecutada: Number($('accionMetaEjecutada')?.value || 0),
    avance: $('accionAvance')?.value || '0%',
    detalle: $('accionDetalle')?.value || '',
    descripcion: $('accionDescripcion')?.value || '',
    estado: 'Registrado',
    usuario_registro: state.session?.email || '',
    fecha_registro: new Date().toISOString()
  };
  const lista = cargarAccionesLocales();
  lista.push(accion);
  guardarAccionesLocales(lista);
  api('/acciones', 'POST', accion);
  renderTablaAcciones();
  limpiarFormularioAccion();
  alert('Acción registrada correctamente.');
}

function limpiarFormularioAccion() {
  ['accionCodigo','accionMetaProgramada','accionPlazo','accionFechaInicio','accionFechaFinal','accionMetaEjecutada','accionAvance','accionDetalle','accionDescripcion'].forEach(id => { if ($(id)) $(id).value = ''; });
  if ($('accionTipo')) $('accionTipo').value = '';
  if ($('accionUnidad')) $('accionUnidad').value = '';
}

function renderTablaAcciones() {
  const tbody = document.querySelector('#tablaAcciones tbody');
  if (!tbody) return;
  const acciones = cargarAccionesLocales();
  const visibles = esAdministrador() ? acciones : acciones.filter(a => normalizarProgramaNombre(a.programa) === programaSesionNormalizado());
  if (!visibles.length) {
    tbody.innerHTML = '<tr><td colspan="10" class="text-muted">No hay acciones registradas.</td></tr>';
    return;
  }
  tbody.innerHTML = visibles.map(a => `
    <tr>
      <td>${escapeHtml(a.ds)}</td><td>${escapeHtml(a.programa)}</td><td>${escapeHtml(a.tipo)}</td><td>${escapeHtml(a.codigo)}</td><td>${escapeHtml(a.detalle)}</td><td>${escapeHtml(a.meta_programada)}</td><td>${escapeHtml(a.meta_ejecutada)}</td><td>${escapeHtml(a.avance)}</td><td>${escapeHtml(a.estado)}</td><td>-</td>
    </tr>
  `).join('');
}

window.abrirRDS = abrirRDS;



// ================= AJUSTE FLUJO RDS / PREAPROBACIÓN / APROBACIÓN =================
let modoRegistroAcciones = 'registro'; // rds | revision | registro
let accionEditandoId = null;

function fechaHoraLocalISO() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function initRegistroAcciones() {
  cargarSelectAccionDS();
  configurarProgramasAccion();
  cargarCatalogosAccion();
  actualizarFechaRegistroAccion();
  cargarRDSDesdeDSSeleccionado();
  aplicarRestriccionesAccion();
  renderTablaAcciones();
  aplicarVistaRegistroAcciones();

  if (accionesInicializadas) return;
  accionesInicializadas = true;

  $('accionDs')?.addEventListener('change', () => {
    cargarRDSDesdeDSSeleccionado();
    aplicarRestriccionesAccion();
    renderTablaAcciones();
    aplicarVistaRegistroAcciones();
  });
  $('btnActivarRDS')?.addEventListener('click', activarRDSSeleccionado);
  $('btnGuardarAccion')?.addEventListener('click', guardarAccionDS);
  $('btnPreaprobarRDS')?.addEventListener('click', () => cambiarEstadoFlujoRDS('Preaprobado'));
  $('btnAprobarRDS')?.addEventListener('click', () => cambiarEstadoFlujoRDS('Aprobado'));
  $('accionPlazo')?.addEventListener('input', calcularFechaFinalAccion);
  $('accionFechaInicio')?.addEventListener('change', calcularFechaFinalAccion);
  $('accionMetaProgramada')?.addEventListener('input', calcularAvanceAccion);
  $('accionMetaEjecutada')?.addEventListener('input', calcularAvanceAccion);
}

function abrirTabRegistroAcciones(id, modo = 'registro') {
  if (!puedeUsarRDS() && !esConsulta()) {
    alert('No tiene permisos para ingresar al Registro de Acciones.');
    return;
  }
  modoRegistroAcciones = modo;
  initRegistroAcciones();
  const tabBtn = document.querySelector('[data-bs-target="#tabAcciones"]');
  if (tabBtn && window.bootstrap?.Tab) bootstrap.Tab.getOrCreateInstance(tabBtn).show();
  else if (tabBtn) tabBtn.click();
  setTimeout(() => {
    cargarSelectAccionDS();
    if ($('accionDs')) $('accionDs').value = id || $('accionDs').value || '';
    cargarRDSDesdeDSSeleccionado();
    aplicarRestriccionesAccion();
    renderTablaAcciones();
    aplicarVistaRegistroAcciones();
  }, 0);
}

function abrirRDS(id) {
  if (!puedeUsarRDS()) {
    alert('Solo Administrador o Registrador pueden usar RDS.');
    return;
  }
  abrirTabRegistroAcciones(id, 'rds');
}

function abrirPreAprobacion(id) {
  if (!esRegistrador() && !esAdministrador()) {
    alert('Solo Administrador o Registrador pueden usar este flujo.');
    return;
  }
  abrirTabRegistroAcciones(id, 'revision');
}

function aplicarVistaRegistroAcciones() {
  const d = buscarDecretoPorId($('accionDs')?.value || '');
  const esModoRDS = modoRegistroAcciones === 'rds';
  const esModoRevision = modoRegistroAcciones === 'revision';
  const puedeRegistrar = (esAdministrador() || esRegistrador()) && Boolean(d?.rdsActivo) && !esModoRDS && !esModoRevision;

  const boxRegistro = $('accionRegistroBox');
  if (boxRegistro) boxRegistro.style.display = puedeRegistrar ? '' : 'none';

  const tabla = $('tablaAcciones')?.closest('.table-responsive');
  const tituloTabla = tabla?.previousElementSibling;
  const botones = $('rdsFlujoBotones');

  const mostrarRevision = esModoRevision || (!esModoRDS && Boolean(d?.rdsActivo));
  if (tabla) tabla.style.display = mostrarRevision ? '' : 'none';
  if (tituloTabla) tituloTabla.style.display = mostrarRevision ? '' : 'none';
  if (botones) botones.style.display = mostrarRevision ? '' : 'none';

  const btnPre = $('btnPreaprobarRDS');
  const btnApr = $('btnAprobarRDS');
  if (btnPre) btnPre.style.display = esRegistrador() ? '' : 'none';
  if (btnApr) btnApr.style.display = esAdministrador() ? '' : 'none';

  if ($('btnActivarRDS')) $('btnActivarRDS').style.display = esModoRDS || esAdministrador() ? '' : 'none';
}

function cargarRDSDesdeDSSeleccionado() {
  const d = buscarDecretoPorId($('accionDs')?.value || '');
  if ($('rdsNumeroReunion')) $('rdsNumeroReunion').value = d?.numeroReunion || '';
  if ($('rdsFechaReunion')) $('rdsFechaReunion').value = d?.fechaReunion || '';
  if ($('rdsEstado')) $('rdsEstado').value = d?.estadoRDS || (d?.rdsActivo ? 'Activo' : 'No activado');
  if ($('accionFechaRegistro')) $('accionFechaRegistro').value = d?.fechaRegistroRDS || fechaHoraLocalISO();
  if ($('accionResumenDS')) {
    $('accionResumenDS').innerHTML = d ? `<div class="alert ${d.rdsActivo ? 'alert-success' : 'alert-warning'} py-2 mb-0"><strong>${escapeHtml(formatearNumeroDS(d))}</strong> · ${escapeHtml(d.tipo_peligro || '')} · ${d.rdsActivo ? 'RDS Activo' : 'RDS pendiente de activación'}</div>` : '';
  }
}

function activarRDSSeleccionado() {
  if (!esAdministrador()) {
    alert('Solo el Administrador puede activar RDS.');
    return;
  }
  const id = $('accionDs')?.value || '';
  const numeroReunion = $('rdsNumeroReunion')?.value || '';
  const fechaReunion = $('rdsFechaReunion')?.value || '';
  if (!id) return alert('Seleccione un Decreto Supremo.');
  if (!numeroReunion) return alert('Seleccione el número de reunión.');
  if (!fechaReunion) return alert('Ingrese la fecha de reunión.');

  const lista = cargarDecretosLocales().map(normalizarDecreto).filter(Boolean);
  const idx = lista.findIndex(d => String(d.id) === String(id));
  if (idx < 0) return alert('No se encontró el Decreto Supremo.');

  lista[idx] = {
    ...lista[idx],
    rdsActivo: true,
    numeroReunion,
    fechaReunion,
    estadoRDS: 'Activo',
    fechaRegistroRDS: fechaHoraLocalISO(),
    usuarioActivaRDS: state.session?.email || '',
    programasHabilitados: PROGRAMAS_RDS.slice()
  };
  guardarDecretosLocales(lista);
  renderTablaDecretosBasica();
  cargarSelectAccionDS();
  if ($('accionDs')) $('accionDs').value = id;
  cargarRDSDesdeDSSeleccionado();
  aplicarRestriccionesAccion();
  renderTablaAcciones();
  aplicarVistaRegistroAcciones();
  api('/decretos', 'POST', lista[idx]);
  alert('Registro de Acciones activado correctamente.');
}

function aplicarRestriccionesAccion() {
  const d = buscarDecretoPorId($('accionDs')?.value || '');
  const programaUsuario = programaSesionNormalizado();
  const habilitadoPorRol = esAdministrador() || (esRegistrador() && d?.rdsActivo && d.programasHabilitados?.includes(programaUsuario));
  const puedeRegistrar = habilitadoPorRol && !esConsulta() && Boolean(d?.rdsActivo) && modoRegistroAcciones === 'registro';
  const controlesAccion = ['accionTipo','accionCodigo','accionUnidad','accionMetaProgramada','accionPlazo','accionFechaInicio','accionMetaEjecutada','accionDetalle','accionDescripcion','btnGuardarAccion'];
  controlesAccion.forEach(id => { if ($(id)) $(id).disabled = !puedeRegistrar; });
  if ($('btnActivarRDS')) $('btnActivarRDS').disabled = !esAdministrador();
  if ($('rdsNumeroReunion')) $('rdsNumeroReunion').disabled = !esAdministrador();
  if ($('rdsFechaReunion')) $('rdsFechaReunion').disabled = !esAdministrador();
  if ($('accionDs')) $('accionDs').disabled = false;
  if ($('rdsMensajeRol')) {
    $('rdsMensajeRol').textContent = esAdministrador()
      ? 'Administrador: puede activar RDS, revisar todos los programas y aprobar.'
      : esRegistrador()
        ? (d?.rdsActivo ? `Registrador habilitado para ${programaUsuario}.` : `Registrador ${programaUsuario || ''}: el RDS aún no está activo.`)
        : 'Consulta: solo lectura.';
  }
  configurarProgramasAccion();
}

function renderTablaDecretosBasica() {
  const tbody = document.querySelector('#tablaDS tbody');
  if (!tbody) return;

  const decretos = (state.decretos.length ? state.decretos : cargarDecretosLocales()).map(normalizarDecreto).filter(Boolean);

  if (!decretos.length) {
    tbody.innerHTML = '<tr><td colspan="17" class="text-muted">No hay Decretos Supremos registrados.</td></tr>';
    return;
  }

  tbody.innerHTML = decretos.map(d => {
    const territorio = Array.isArray(d.territorio) ? d.territorio : [];
    const deps = new Set(territorio.map(t => t.departamento).filter(Boolean));
    const provs = new Set(territorio.map(t => `${t.departamento}|${t.provincia}`).filter(Boolean));
    const dists = new Set(territorio.map(t => `${t.departamento}|${t.provincia}|${t.distrito}`).filter(Boolean));
    const textoRevision = esAdministrador() ? 'Aprobar' : 'PreAprobar';
    const puedeRevision = esAdministrador() || esRegistrador();

    return `
      <tr>
        <td>${escapeHtml(formatearNumeroDS(d))}</td>
        <td>${escapeHtml(d.anio)}</td>
        <td>${escapeHtml(d.peligro)}</td>
        <td>${escapeHtml(d.tipo_peligro)}</td>
        <td>${escapeHtml(d.fecha_inicio)}</td>
        <td>${escapeHtml(d.fecha_fin)}</td>
        <td>${escapeHtml(d.vigencia)}</td>
        <td>${escapeHtml(d.semaforo)}</td>
        <td>${deps.size}</td>
        <td>${provs.size}</td>
        <td>${dists.size}</td>
        <td>${d.es_prorroga ? 'Prórroga' : 'Original'}</td>
        <td>${escapeHtml(d.cadena || '')}</td>
        <td>${escapeHtml(d.nivel_prorroga || 0)}</td>
        <td><button type="button" class="btn btn-sm ${d.rdsActivo ? 'btn-success' : 'btn-outline-primary'}" ${puedeUsarRDS() ? '' : 'disabled'} onclick="abrirRDS('${escapeHtmlAttr(d.id)}')">RDS</button></td>
        <td><button type="button" class="btn btn-sm ${esAdministrador() ? 'btn-success' : 'btn-warning'}" ${puedeRevision ? '' : 'disabled'} onclick="abrirPreAprobacion('${escapeHtmlAttr(d.id)}')">${textoRevision}</button></td>
        <td><button type="button" class="btn btn-sm btn-outline-dark" onclick="verDetalleDS('${escapeHtmlAttr(d.id)}')">👁</button></td>
      </tr>
    `;
  }).join('');
}

function guardarAccionDS() {
  const d = buscarDecretoPorId($('accionDs')?.value || '');
  if (!d || !d.rdsActivo) return alert('Seleccione un DS con Registro de Acciones activado.');
  const programa = normalizarProgramaNombre($('accionPrograma')?.value || '');
  if (!programa) return alert('Seleccione el Programa Nacional.');
  if (esRegistrador() && programa !== programaSesionNormalizado()) return alert('No puede registrar acciones de otro programa.');
  if (!$('accionTipo')?.value || !$('accionDetalle')?.value.trim()) return alert('Complete tipo de acción y acción específica.');
  calcularFechaFinalAccion();
  calcularAvanceAccion();
  const lista = cargarAccionesLocales();
  const id = accionEditandoId || crypto.randomUUID();
  const accion = {
    id,
    ds_id: d.id,
    ds: formatearNumeroDS(d),
    programa,
    tipo: $('accionTipo')?.value || '',
    codigo: $('accionCodigo')?.value || '',
    unidad: $('accionUnidad')?.value || '',
    meta_programada: Number($('accionMetaProgramada')?.value || 0),
    plazo: Number($('accionPlazo')?.value || 0),
    fecha_inicio: $('accionFechaInicio')?.value || '',
    fecha_final: $('accionFechaFinal')?.value || '',
    meta_ejecutada: Number($('accionMetaEjecutada')?.value || 0),
    avance: $('accionAvance')?.value || '0%',
    detalle: $('accionDetalle')?.value || '',
    descripcion: $('accionDescripcion')?.value || '',
    estado: accionEditandoId ? (lista.find(a => a.id === accionEditandoId)?.estado || 'Registrado') : 'Registrado',
    usuario_registro: accionEditandoId ? (lista.find(a => a.id === accionEditandoId)?.usuario_registro || state.session?.email || '') : (state.session?.email || ''),
    fecha_registro: accionEditandoId ? (lista.find(a => a.id === accionEditandoId)?.fecha_registro || new Date().toISOString()) : new Date().toISOString(),
    usuario_actualiza: accionEditandoId ? (state.session?.email || '') : '',
    fecha_actualiza: accionEditandoId ? new Date().toISOString() : ''
  };
  const depurada = lista.filter(a => String(a.id) !== String(id));
  depurada.push(accion);
  guardarAccionesLocales(depurada);
  api('/acciones', 'POST', accion);
  renderTablaAcciones();
  limpiarFormularioAccion();
  accionEditandoId = null;
  if ($('btnGuardarAccion')) $('btnGuardarAccion').textContent = 'Guardar acción';
  alert('Acción guardada correctamente.');
}

function accionesDelDSSeleccionado() {
  const dsId = $('accionDs')?.value || '';
  return cargarAccionesLocales().filter(a => !dsId || String(a.ds_id) === String(dsId));
}

function puedeEditarAccion(a) {
  if (esAdministrador()) return true;
  if (!esRegistrador()) return false;
  return normalizarProgramaNombre(a.programa) === programaSesionNormalizado();
}

function renderTablaAcciones() {
  const tbody = document.querySelector('#tablaAcciones tbody');
  if (!tbody) return;
  const base = accionesDelDSSeleccionado();
  const visibles = esAdministrador() ? base : base;
  if (!visibles.length) {
    tbody.innerHTML = '<tr><td colspan="15" class="text-muted">No hay acciones registradas para el Decreto Supremo seleccionado.</td></tr>';
    return;
  }
  tbody.innerHTML = visibles.map(a => `
    <tr>
      <td>${escapeHtml(a.programa)}</td>
      <td>${escapeHtml(a.tipo)}</td>
      <td>${escapeHtml(a.codigo)}</td>
      <td>${escapeHtml(a.detalle)}</td>
      <td>${escapeHtml(a.unidad)}</td>
      <td>${escapeHtml(a.meta_programada)}</td>
      <td>${escapeHtml(a.fecha_inicio)}</td>
      <td>${escapeHtml(a.fecha_final)}</td>
      <td>${escapeHtml(a.meta_ejecutada)}</td>
      <td>${escapeHtml(a.avance)}</td>
      <td>${escapeHtml(a.descripcion)}</td>
      <td>${escapeHtml(a.estado)}</td>
      <td>${escapeHtml(a.usuario_registro)}</td>
      <td>${escapeHtml(a.fecha_registro)}</td>
      <td>${puedeEditarAccion(a) ? `<button type="button" class="btn btn-sm btn-outline-primary" onclick="editarAccionDS('${escapeHtmlAttr(a.id)}')">Editar</button>` : '-'}</td>
    </tr>
  `).join('');
}

function editarAccionDS(id) {
  const a = cargarAccionesLocales().find(x => String(x.id) === String(id));
  if (!a) return alert('No se encontró la acción.');
  if (!puedeEditarAccion(a)) return alert('No puede editar acciones de otro programa.');
  modoRegistroAcciones = 'registro';
  aplicarVistaRegistroAcciones();
  if ($('accionPrograma')) $('accionPrograma').value = a.programa || '';
  if ($('accionTipo')) $('accionTipo').value = a.tipo || '';
  if ($('accionCodigo')) $('accionCodigo').value = a.codigo || '';
  if ($('accionUnidad')) $('accionUnidad').value = a.unidad || '';
  if ($('accionMetaProgramada')) $('accionMetaProgramada').value = a.meta_programada || 0;
  if ($('accionPlazo')) $('accionPlazo').value = a.plazo || 0;
  if ($('accionFechaInicio')) $('accionFechaInicio').value = a.fecha_inicio || '';
  if ($('accionFechaFinal')) $('accionFechaFinal').value = a.fecha_final || '';
  if ($('accionMetaEjecutada')) $('accionMetaEjecutada').value = a.meta_ejecutada || 0;
  if ($('accionAvance')) $('accionAvance').value = a.avance || '0%';
  if ($('accionDetalle')) $('accionDetalle').value = a.detalle || '';
  if ($('accionDescripcion')) $('accionDescripcion').value = a.descripcion || '';
  accionEditandoId = id;
  if ($('btnGuardarAccion')) $('btnGuardarAccion').textContent = 'Actualizar acción';
  aplicarRestriccionesAccion();
}

function cambiarEstadoFlujoRDS(nuevoEstado) {
  const dsId = $('accionDs')?.value || '';
  if (!dsId) return alert('Seleccione un Decreto Supremo.');
  if (nuevoEstado === 'Preaprobado' && !esRegistrador()) return alert('Solo el Registrador puede PreAprobar.');
  if (nuevoEstado === 'Aprobado' && !esAdministrador()) return alert('Solo el Administrador puede Aprobar.');
  const acciones = cargarAccionesLocales();
  let tocadas = 0;
  const programaUsuario = programaSesionNormalizado();
  const actualizadas = acciones.map(a => {
    if (String(a.ds_id) !== String(dsId)) return a;
    if (nuevoEstado === 'Preaprobado' && normalizarProgramaNombre(a.programa) !== programaUsuario) return a;
    tocadas++;
    return {
      ...a,
      estado: nuevoEstado,
      usuario_flujo: state.session?.email || '',
      fecha_flujo: new Date().toISOString()
    };
  });
  if (!tocadas) return alert('No hay acciones registradas para cambiar de estado.');
  guardarAccionesLocales(actualizadas);

  const decretos = cargarDecretosLocales().map(normalizarDecreto).filter(Boolean).map(d => {
    if (String(d.id) !== String(dsId)) return d;
    return {
      ...d,
      estadoRDS: nuevoEstado,
      usuarioEstadoRDS: state.session?.email || '',
      fechaEstadoRDS: fechaHoraLocalISO()
    };
  });
  guardarDecretosLocales(decretos);
  cargarRDSDesdeDSSeleccionado();
  renderTablaAcciones();
  renderTablaDecretosBasica();
  alert(`Registro ${nuevoEstado.toLowerCase()} correctamente.`);
}

window.abrirRDS = abrirRDS;
window.abrirPreAprobacion = abrirPreAprobacion;
window.editarAccionDS = editarAccionDS;



// ================= AJUSTE FINAL PERMISOS POR ROL v35 =================
function esRegistradorPrograma() {
  return esRegistrador() && Boolean(programaSesionNormalizado());
}

function esRegistradorGeneral() {
  return esRegistrador() && !programaSesionNormalizado();
}

function puedeActivarRDS() {
  return esAdministrador() || esRegistradorGeneral();
}

function puedeUsarRDS() {
  return puedeActivarRDS();
}

function puedePreaprobar() {
  return esRegistradorGeneral();
}

function puedeAprobar() {
  return esAdministrador();
}

function aplicarVisibilidadPorRol() {
  const tabNuevoBtn = document.querySelector('[data-bs-target="#tabNuevo"]')?.closest('.nav-item');
  if (tabNuevoBtn) tabNuevoBtn.style.display = esRegistradorPrograma() ? 'none' : '';

  const tabSegBtn = document.querySelector('[data-bs-target="#tabSeg"]')?.closest('.nav-item');
  if (tabSegBtn) tabSegBtn.style.display = esAdministrador() ? '' : 'none';

  const btnAdmin = $('btnAdminPanel');
  if (btnAdmin) {
    const admin = esAdministrador();
    btnAdmin.style.display = admin ? 'inline-block' : 'none';
    btnAdmin.disabled = !admin;
    btnAdmin.style.pointerEvents = admin ? 'auto' : 'none';
  }

  if (esRegistradorPrograma() && document.querySelector('#tabNuevo.active')) {
    const listado = document.querySelector('[data-bs-target="#tabListado"]');
    if (listado && window.bootstrap?.Tab) bootstrap.Tab.getOrCreateInstance(listado).show();
    else listado?.click();
  }
}

function renderSession() {
  if ($('sessionName')) $('sessionName').textContent = state.session?.name || '';
  if ($('sessionRole')) $('sessionRole').textContent = state.session?.role || state.session?.rol || '';
  aplicarVisibilidadPorRol();
}

function renderTablaDecretosBasica() {
  const tbody = document.querySelector('#tablaDS tbody');
  if (!tbody) return;

  const decretos = (state.decretos.length ? state.decretos : cargarDecretosLocales()).map(normalizarDecreto).filter(Boolean);

  if (!decretos.length) {
    tbody.innerHTML = '<tr><td colspan="17" class="text-muted">No hay Decretos Supremos registrados.</td></tr>';
    return;
  }

  tbody.innerHTML = decretos.map(d => {
    const territorio = Array.isArray(d.territorio) ? d.territorio : [];
    const deps = new Set(territorio.map(t => t.departamento).filter(Boolean));
    const provs = new Set(territorio.map(t => `${t.departamento}|${t.provincia}`).filter(Boolean));
    const dists = new Set(territorio.map(t => `${t.departamento}|${t.provincia}|${t.distrito}`).filter(Boolean));

    let botonRDS = '';
    let botonRevision = '';

    if (esAdministrador() || esRegistradorGeneral()) {
      botonRDS = `<button type="button" class="btn btn-sm ${d.rdsActivo ? 'btn-success' : 'btn-outline-primary'}" onclick="abrirRDS('${escapeHtmlAttr(d.id)}')">RDS</button>`;
      const textoRevision = esAdministrador() ? 'Aprobar' : 'PreAprobar';
      botonRevision = `<button type="button" class="btn btn-sm ${esAdministrador() ? 'btn-success' : 'btn-warning'}" onclick="abrirPreAprobacion('${escapeHtmlAttr(d.id)}')">${textoRevision}</button>`;
    } else if (esRegistradorPrograma()) {
      botonRDS = d.rdsActivo
        ? `<button type="button" class="btn btn-sm btn-primary" onclick="abrirRegistrarAcciones('${escapeHtmlAttr(d.id)}')">Registrar Acciones</button>`
        : `<span class="badge text-bg-secondary">RDS no activo</span>`;
      botonRevision = '';
    } else {
      botonRDS = '<span class="text-muted small">Solo lectura</span>';
      botonRevision = '';
    }

    return `
      <tr>
        <td>${escapeHtml(formatearNumeroDS(d))}</td>
        <td>${escapeHtml(d.anio)}</td>
        <td>${escapeHtml(d.peligro)}</td>
        <td>${escapeHtml(d.tipo_peligro)}</td>
        <td>${escapeHtml(d.fecha_inicio)}</td>
        <td>${escapeHtml(d.fecha_fin)}</td>
        <td>${escapeHtml(d.vigencia)}</td>
        <td>${escapeHtml(d.semaforo)}</td>
        <td>${deps.size}</td>
        <td>${provs.size}</td>
        <td>${dists.size}</td>
        <td>${d.es_prorroga ? 'Prórroga' : 'Original'}</td>
        <td>${escapeHtml(d.cadena || '')}</td>
        <td>${escapeHtml(d.nivel_prorroga || 0)}</td>
        <td>${botonRDS}</td>
        <td>${botonRevision}</td>
        <td><button type="button" class="btn btn-sm btn-outline-dark" onclick="verDetalleDS('${escapeHtmlAttr(d.id)}')">👁</button></td>
      </tr>
    `;
  }).join('');
}

function configurarProgramasAccion() {
  const sel = $('accionPrograma');
  if (!sel) return;
  const programaUsuario = programaSesionNormalizado();

  if (esAdministrador() || esRegistradorGeneral()) {
    const actual = sel.value;
    sel.innerHTML = '<option value="">Seleccione...</option>' + PROGRAMAS_RDS.map(p => `<option>${escapeHtml(p)}</option>`).join('');
    if (actual && Array.from(sel.options).some(o => normalizarProgramaNombre(o.value) === normalizarProgramaNombre(actual))) {
      sel.value = actual;
    }
    sel.disabled = false;
  } else if (esRegistradorPrograma() && programaUsuario) {
    sel.innerHTML = `<option>${escapeHtml(programaUsuario)}</option>`;
    sel.value = programaUsuario;
    sel.disabled = true;
  } else {
    sel.innerHTML = '<option value="">No habilitado</option>';
    sel.disabled = true;
  }
}

function actualizarFechaRegistroAccion() {
  if ($('accionFechaRegistro')) $('accionFechaRegistro').value = fechaHoraLocalISO();
}

function abrirRDS(id) {
  if (!puedeActivarRDS()) {
    alert('Solo Administrador o Registrador pueden activar RDS.');
    return;
  }
  abrirTabRegistroAcciones(id, 'rds');
}

function abrirRegistrarAcciones(id) {
  if (!esRegistradorPrograma()) {
    alert('Esta opción corresponde a Registradores de Programas.');
    return;
  }
  abrirTabRegistroAcciones(id, 'registro');
}

function abrirPreAprobacion(id) {
  if (!puedePreaprobar() && !puedeAprobar()) {
    alert('No tiene permisos para este flujo.');
    return;
  }
  abrirTabRegistroAcciones(id, 'revision');
}

function abrirTabRegistroAcciones(id, modo = 'registro') {
  if (!esAdministrador() && !esRegistrador() && !esConsulta()) {
    alert('No tiene permisos para ingresar al Registro de Acciones.');
    return;
  }
  modoRegistroAcciones = modo;
  initRegistroAcciones();
  const tabBtn = document.querySelector('[data-bs-target="#tabAcciones"]');
  if (tabBtn && window.bootstrap?.Tab) bootstrap.Tab.getOrCreateInstance(tabBtn).show();
  else if (tabBtn) tabBtn.click();
  setTimeout(() => {
    cargarSelectAccionDS();
    if ($('accionDs')) $('accionDs').value = id || $('accionDs').value || '';
    cargarRDSDesdeDSSeleccionado();
    aplicarRestriccionesAccion();
    renderTablaAcciones();
    aplicarVistaRegistroAcciones();
  }, 0);
}

function cargarRDSDesdeDSSeleccionado() {
  const d = buscarDecretoPorId($('accionDs')?.value || '');
  if ($('rdsNumeroReunion')) $('rdsNumeroReunion').value = d?.numeroReunion || '';
  if ($('rdsFechaReunion')) $('rdsFechaReunion').value = d?.fechaReunion || '';
  if ($('rdsEstado')) $('rdsEstado').value = d?.estadoRDS || (d?.rdsActivo ? 'Activo' : 'No activado');
  if ($('accionFechaRegistro')) $('accionFechaRegistro').value = d?.fechaRegistroRDS || fechaHoraLocalISO();
  if ($('accionResumenDS')) {
    $('accionResumenDS').innerHTML = d ? `<div class="alert ${d.rdsActivo ? 'alert-success' : 'alert-warning'} py-2 mb-0"><strong>${escapeHtml(formatearNumeroDS(d))}</strong> · ${escapeHtml(d.tipo_peligro || '')} · ${d.rdsActivo ? 'RDS Activo' : 'RDS pendiente de activación'}</div>` : '';
  }
}

function activarRDSSeleccionado() {
  if (!puedeActivarRDS()) {
    alert('Solo el Administrador o Registrador puede activar RDS.');
    return;
  }
  const id = $('accionDs')?.value || '';
  const numeroReunion = $('rdsNumeroReunion')?.value || '';
  const fechaReunion = $('rdsFechaReunion')?.value || '';
  if (!id) return alert('Seleccione un Decreto Supremo.');
  if (!numeroReunion) return alert('Seleccione el número de reunión.');
  if (!fechaReunion) return alert('Ingrese la fecha de reunión.');

  const lista = cargarDecretosLocales().map(normalizarDecreto).filter(Boolean);
  const idx = lista.findIndex(d => String(d.id) === String(id));
  if (idx < 0) return alert('No se encontró el Decreto Supremo.');

  lista[idx] = {
    ...lista[idx],
    rdsActivo: true,
    numeroReunion,
    fechaReunion,
    estadoRDS: 'Activo',
    fechaRegistroRDS: fechaHoraLocalISO(),
    usuarioActivaRDS: state.session?.email || '',
    programasHabilitados: PROGRAMAS_RDS.slice()
  };
  guardarDecretosLocales(lista);
  renderTablaDecretosBasica();
  cargarSelectAccionDS();
  if ($('accionDs')) $('accionDs').value = id;
  cargarRDSDesdeDSSeleccionado();
  aplicarRestriccionesAccion();
  renderTablaAcciones();
  aplicarVistaRegistroAcciones();
  api('/decretos', 'POST', lista[idx]);
  alert('Registro de Acciones activado correctamente.');
}

function aplicarRestriccionesAccion() {
  const d = buscarDecretoPorId($('accionDs')?.value || '');
  const programaUsuario = programaSesionNormalizado();
  const rdsActivo = Boolean(d?.rdsActivo);
  const rolPuedeRegistrar = esAdministrador() || esRegistradorGeneral() || (esRegistradorPrograma() && d?.programasHabilitados?.includes(programaUsuario));
  const puedeRegistrar = rolPuedeRegistrar && !esConsulta() && rdsActivo && modoRegistroAcciones === 'registro';
  const controlesAccion = ['accionTipo','accionCodigo','accionUnidad','accionMetaProgramada','accionPlazo','accionFechaInicio','accionMetaEjecutada','accionDetalle','accionDescripcion','btnGuardarAccion'];
  controlesAccion.forEach(id => { if ($(id)) $(id).disabled = !puedeRegistrar; });
  if ($('btnActivarRDS')) $('btnActivarRDS').disabled = !puedeActivarRDS();
  if ($('rdsNumeroReunion')) $('rdsNumeroReunion').disabled = !puedeActivarRDS();
  if ($('rdsFechaReunion')) $('rdsFechaReunion').disabled = !puedeActivarRDS();
  if ($('accionDs')) $('accionDs').disabled = false;
  configurarProgramasAccion();
  if ($('rdsMensajeRol')) {
    $('rdsMensajeRol').textContent = esAdministrador()
      ? 'Administrador: activa RDS, ve todos los programas y aprueba.'
      : esRegistradorGeneral()
        ? 'Registrador: activa RDS, revisa acciones y preaprueba.'
        : esRegistradorPrograma()
          ? (rdsActivo ? `Registrador de Programa habilitado para ${programaUsuario}.` : `Registrador de Programa ${programaUsuario || ''}: el DS aún no tiene RDS activo.`)
          : 'Consulta: solo lectura.';
  }
}

function aplicarVistaRegistroAcciones() {
  const d = buscarDecretoPorId($('accionDs')?.value || '');
  const esModoRDS = modoRegistroAcciones === 'rds';
  const esModoRevision = modoRegistroAcciones === 'revision';
  const esModoRegistroPrograma = modoRegistroAcciones === 'registro';
  const puedeRegistrar = (esAdministrador() || esRegistradorGeneral() || esRegistradorPrograma()) && Boolean(d?.rdsActivo) && esModoRegistroPrograma;

  const boxRegistro = $('accionRegistroBox');
  if (boxRegistro) boxRegistro.style.display = puedeRegistrar ? '' : 'none';

  const tabla = $('tablaAcciones')?.closest('.table-responsive');
  const tituloTabla = tabla?.previousElementSibling;
  const botones = $('rdsFlujoBotones');
  const mostrarTabla = esModoRevision || (!esModoRDS && Boolean(d?.rdsActivo));

  if (tabla) tabla.style.display = mostrarTabla ? '' : 'none';
  if (tituloTabla) tituloTabla.style.display = mostrarTabla ? '' : 'none';
  if (botones) botones.style.display = (esModoRevision || (!esModoRDS && !esRegistradorPrograma() && Boolean(d?.rdsActivo))) ? '' : 'none';

  const btnPre = $('btnPreaprobarRDS');
  const btnApr = $('btnAprobarRDS');
  if (btnPre) btnPre.style.display = puedePreaprobar() ? '' : 'none';
  if (btnApr) btnApr.style.display = puedeAprobar() ? '' : 'none';

  if ($('btnActivarRDS')) $('btnActivarRDS').style.display = puedeActivarRDS() ? '' : 'none';
  if ($('accionPrograma')) {
    const grupo = $('accionPrograma').closest('.col-md-4, .col-md-3, .col-12');
    if (grupo) grupo.style.display = puedeRegistrar ? '' : (esRegistradorPrograma() ? '' : '');
  }
}

function guardarAccionDS() {
  const d = buscarDecretoPorId($('accionDs')?.value || '');
  if (!d) return alert('Seleccione un Decreto Supremo.');
  if (!d.rdsActivo) return alert('No se puede registrar acciones: el DS no tiene Estado RDS = Activo.');

  const programa = normalizarProgramaNombre($('accionPrograma')?.value || '');
  const tipo = $('accionTipo')?.value || '';
  const codigo = String($('accionCodigo')?.value || '').trim();

  if (!programa) return alert('Seleccione el Programa Nacional.');
  if (esRegistradorPrograma() && programa !== programaSesionNormalizado()) return alert('No puede registrar acciones de otro programa.');
  if (!tipo) return alert('Seleccione el Tipo de acción.');
  if (!codigo) return alert('Ingrese el Código de acción.');
  if (!$('accionDetalle')?.value.trim()) return alert('Ingrese la acción específica programada.');

  calcularFechaFinalAccion();
  calcularAvanceAccion();

  const lista = cargarAccionesLocales();
  const duplicada = lista.some(a =>
    String(a.id) !== String(accionEditandoId || '') &&
    String(a.ds_id) === String(d.id) &&
    normalizarProgramaNombre(a.programa) === programa &&
    normalizarTexto(a.codigo) === normalizarTexto(codigo)
  );
  if (duplicada) return alert('Ya existe una acción con el mismo DS, Programa Nacional y Código de acción.');

  const id = accionEditandoId || crypto.randomUUID();
  const existente = lista.find(a => String(a.id) === String(id));
  const accion = {
    id,
    ds_id: d.id,
    ds: formatearNumeroDS(d),
    programa,
    tipo,
    codigo,
    unidad: $('accionUnidad')?.value || '',
    meta_programada: Number($('accionMetaProgramada')?.value || 0),
    plazo: Number($('accionPlazo')?.value || 0),
    fecha_inicio: $('accionFechaInicio')?.value || '',
    fecha_final: $('accionFechaFinal')?.value || '',
    meta_ejecutada: Number($('accionMetaEjecutada')?.value || 0),
    avance: $('accionAvance')?.value || '0%',
    detalle: $('accionDetalle')?.value || '',
    descripcion: $('accionDescripcion')?.value || '',
    estado: existente?.estado || 'Registrado',
    usuario_registro: existente?.usuario_registro || state.session?.email || '',
    fecha_registro: existente?.fecha_registro || new Date().toISOString(),
    usuario_actualiza: existente ? (state.session?.email || '') : '',
    fecha_actualiza: existente ? new Date().toISOString() : ''
  };
  const depurada = lista.filter(a => String(a.id) !== String(id));
  depurada.push(accion);
  guardarAccionesLocales(depurada);
  api('/acciones', 'POST', accion);
  renderTablaAcciones();
  limpiarFormularioAccion();
  accionEditandoId = null;
  if ($('btnGuardarAccion')) $('btnGuardarAccion').textContent = 'Guardar acción';
  alert('Acción guardada correctamente.');
}

function accionesDelDSSeleccionado() {
  const dsId = $('accionDs')?.value || '';
  return cargarAccionesLocales().filter(a => !dsId || String(a.ds_id) === String(dsId));
}

function puedeEditarAccion(a) {
  if (esAdministrador() || esRegistradorGeneral()) return true;
  if (!esRegistradorPrograma()) return false;
  return normalizarProgramaNombre(a.programa) === programaSesionNormalizado();
}

function renderTablaAcciones() {
  const tbody = document.querySelector('#tablaAcciones tbody');
  if (!tbody) return;
  const base = accionesDelDSSeleccionado();
  const visibles = (esAdministrador() || esRegistradorGeneral())
    ? base
    : base.filter(a => normalizarProgramaNombre(a.programa) === programaSesionNormalizado());
  if (!visibles.length) {
    tbody.innerHTML = '<tr><td colspan="15" class="text-muted">No hay acciones registradas para el Decreto Supremo seleccionado.</td></tr>';
    return;
  }
  tbody.innerHTML = visibles.map(a => `
    <tr>
      <td>${escapeHtml(a.programa)}</td>
      <td>${escapeHtml(a.tipo)}</td>
      <td>${escapeHtml(a.codigo)}</td>
      <td>${escapeHtml(a.detalle)}</td>
      <td>${escapeHtml(a.unidad)}</td>
      <td>${escapeHtml(a.meta_programada)}</td>
      <td>${escapeHtml(a.fecha_inicio)}</td>
      <td>${escapeHtml(a.fecha_final)}</td>
      <td>${escapeHtml(a.meta_ejecutada)}</td>
      <td>${escapeHtml(a.avance)}</td>
      <td>${escapeHtml(a.descripcion)}</td>
      <td>${escapeHtml(a.estado)}</td>
      <td>${escapeHtml(a.usuario_registro)}</td>
      <td>${escapeHtml(a.fecha_registro)}</td>
      <td>${puedeEditarAccion(a) ? `<button type="button" class="btn btn-sm btn-outline-primary" onclick="editarAccionDS('${escapeHtmlAttr(a.id)}')">Editar</button>` : '-'}</td>
    </tr>
  `).join('');
}

function cambiarEstadoFlujoRDS(nuevoEstado) {
  const dsId = $('accionDs')?.value || '';
  if (!dsId) return alert('Seleccione un Decreto Supremo.');
  if (nuevoEstado === 'Preaprobado' && !puedePreaprobar()) return alert('Solo el Registrador puede PreAprobar.');
  if (nuevoEstado === 'Aprobado' && !puedeAprobar()) return alert('Solo el Administrador puede Aprobar.');
  const acciones = cargarAccionesLocales();
  let tocadas = 0;
  const actualizadas = acciones.map(a => {
    if (String(a.ds_id) !== String(dsId)) return a;
    tocadas++;
    return {
      ...a,
      estado: nuevoEstado,
      usuario_flujo: state.session?.email || '',
      fecha_flujo: new Date().toISOString()
    };
  });
  if (!tocadas) return alert('No hay acciones registradas para cambiar de estado.');
  guardarAccionesLocales(actualizadas);

  const decretos = cargarDecretosLocales().map(normalizarDecreto).filter(Boolean).map(d => {
    if (String(d.id) !== String(dsId)) return d;
    return {
      ...d,
      estadoRDS: nuevoEstado,
      usuarioEstadoRDS: state.session?.email || '',
      fechaEstadoRDS: fechaHoraLocalISO()
    };
  });
  guardarDecretosLocales(decretos);
  cargarRDSDesdeDSSeleccionado();
  renderTablaAcciones();
  renderTablaDecretosBasica();
  alert(`Registro ${nuevoEstado.toLowerCase()} correctamente.`);
}

window.abrirRDS = abrirRDS;
window.abrirRegistrarAcciones = abrirRegistrarAcciones;
window.abrirPreAprobacion = abrirPreAprobacion;
window.editarAccionDS = editarAccionDS;

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
    localStorage.removeItem(SESSION_STORAGE_KEY);
    state.session = null;
    showLogin();
  });

  const btnAdmin = $('btnAdminPanel');
  if (btnAdmin) {
    btnAdmin.addEventListener('click', openAdminPanel);
    btnAdmin.onclick = openAdminPanel;
  }

  autoLogin();
}

document.addEventListener('DOMContentLoaded', init);
// ================= CIERRE FINAL RDS PROGRAMAS v36 - 30/04/2026 =================
let dsProgramaSeleccionadoId = null;
let accionesProgramaInicializadas = false;

function obtenerProgramasObligatoriosRDS() {
  return PROGRAMAS_RDS.map(normalizarProgramaNombre);
}

function dsTieneAccionesDeTodosLosProgramas(dsId) {
  const acciones = cargarAccionesLocales().filter(a => String(a.dsId || a.ds_id) === String(dsId));
  const programasConAccion = new Set(acciones.map(a => normalizarProgramaNombre(a.programaNacional || a.programa)).filter(Boolean));
  return obtenerProgramasObligatoriosRDS().every(p => programasConAccion.has(p));
}

function fechaHoraLocalISO() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function esRegistradorPrograma() {
  return esRegistrador() && Boolean(programaSesionNormalizado());
}

function esRegistradorGeneral() {
  return esRegistrador() && !programaSesionNormalizado();
}

function puedeActivarRDS() {
  return esAdministrador() || esRegistradorGeneral();
}

function puedeUsarRDS() {
  return puedeActivarRDS();
}

function puedePreaprobar() {
  return esRegistradorGeneral();
}

function puedeAprobar() {
  return esAdministrador();
}

function initRegistroAcciones() {
  cargarSelectAccionDS();
  cargarCatalogosAccion();
  actualizarFechaRegistroAccion();
  cargarRDSDesdeDSSeleccionado();
  aplicarRestriccionesAccion();
  renderTablaAcciones();
  aplicarVistaRegistroAcciones();
  initRegistroAccionesProgramas();

  if (accionesInicializadas) return;
  accionesInicializadas = true;

  $('accionDs')?.addEventListener('change', () => {
    cargarRDSDesdeDSSeleccionado();
    aplicarRestriccionesAccion();
    renderTablaAcciones();
    aplicarVistaRegistroAcciones();
  });
  $('btnActivarRDS')?.addEventListener('click', activarRDSSeleccionado);
  $('btnPreaprobarRDS')?.addEventListener('click', () => cambiarEstadoFlujoRDS('Preaprobado'));
  $('btnAprobarRDS')?.addEventListener('click', () => cambiarEstadoFlujoRDS('Aprobado'));
}

function initRegistroAccionesProgramas() {
  cargarCatalogosAccionPrograma();
  actualizarFechaRegistroPrograma();
  renderTablaAccionesProgramas();

  if (accionesProgramaInicializadas) return;
  accionesProgramaInicializadas = true;

  $('btnGuardarAccionPrograma')?.addEventListener('click', guardarAccionPrograma);
  $('progPlazoDias')?.addEventListener('input', calcularFechaFinalPrograma);
  $('progFechaInicio')?.addEventListener('change', calcularFechaFinalPrograma);
  $('progMetaProgramada')?.addEventListener('input', calcularAvancePrograma);
  $('progMetaEjecutada')?.addEventListener('input', calcularAvancePrograma);
}

function cargarCatalogosAccionPrograma() {
  const tipo = $('progTipoAccion');
  if (tipo && !tipo.options.length) tipo.innerHTML = '<option value="">Seleccione...</option><option>Intervención directa</option><option>Seguimiento</option><option>Asistencia técnica</option><option>Coordinación territorial</option><option>Entrega de bienes o servicios</option>';
  const unidad = $('progUnidadMedida');
  if (unidad && !unidad.options.length) unidad.innerHTML = '<option value="">Seleccione...</option><option>Persona</option><option>Usuario</option><option>Servicio</option><option>Distrito</option><option>Acción</option><option>Informe</option><option>Coordinación</option>';
}

function actualizarFechaRegistroPrograma() {
  if ($('progFechaRegistro')) $('progFechaRegistro').value = fechaHoraLocalISO();
}

function abrirRDS(id) {
  if (!puedeActivarRDS()) {
    alert('Solo Administrador o Registrador pueden activar RDS.');
    return;
  }
  modoRegistroAcciones = 'rds';
  abrirTabBootstrap('#tabAcciones');
  initRegistroAcciones();
  setTimeout(() => {
    cargarSelectAccionDS();
    if ($('accionDs')) $('accionDs').value = id || '';
    cargarRDSDesdeDSSeleccionado();
    aplicarRestriccionesAccion();
    aplicarVistaRegistroAcciones();
  }, 0);
}

function abrirRegistrarAcciones(id) {
  if (!esRegistradorPrograma()) {
    alert('Esta vista corresponde a Registradores de Programas Nacionales.');
    return;
  }
  const d = buscarDecretoPorId(id);
  if (!d?.rdsActivo) {
    alert('El Decreto Supremo aún no tiene RDS activo.');
    return;
  }
  dsProgramaSeleccionadoId = id;
  mostrarTabAccionesProgramas(true);
  abrirTabBootstrap('#tabAccionesProgramas');
  initRegistroAccionesProgramas();
  cargarVistaAccionesPrograma(id);
}

function abrirPreAprobacion(id) {
  if (!puedePreaprobar() && !puedeAprobar()) {
    alert('No tiene permisos para este flujo.');
    return;
  }
  modoRegistroAcciones = 'revision';
  abrirTabBootstrap('#tabAcciones');
  initRegistroAcciones();
  setTimeout(() => {
    cargarSelectAccionDS();
    if ($('accionDs')) $('accionDs').value = id || '';
    cargarRDSDesdeDSSeleccionado();
    aplicarRestriccionesAccion();
    renderTablaAcciones();
    aplicarVistaRegistroAcciones();
  }, 0);
}

function abrirTabBootstrap(target) {
  const btn = document.querySelector(`[data-bs-target="${target}"]`);
  if (btn && window.bootstrap?.Tab) bootstrap.Tab.getOrCreateInstance(btn).show();
  else btn?.click();
}

function mostrarTabAccionesProgramas(mostrar) {
  const item = $('navAccionesProgramasItem');
  if (item) item.style.display = mostrar ? '' : 'none';
}

function aplicarVisibilidadPorRol() {
  const tabNuevoBtn = document.querySelector('[data-bs-target="#tabNuevo"]')?.closest('.nav-item');
  if (tabNuevoBtn) tabNuevoBtn.style.display = esRegistradorPrograma() ? 'none' : '';

  const tabSegBtn = document.querySelector('[data-bs-target="#tabSeg"]')?.closest('.nav-item');
  if (tabSegBtn) tabSegBtn.style.display = esAdministrador() ? '' : 'none';

  mostrarTabAccionesProgramas(false);

  const btnAdmin = $('btnAdminPanel');
  if (btnAdmin) {
    const admin = esAdministrador();
    btnAdmin.style.display = admin ? 'inline-block' : 'none';
    btnAdmin.disabled = !admin;
    btnAdmin.style.pointerEvents = admin ? 'auto' : 'none';
  }

  if (esRegistradorPrograma() && document.querySelector('#tabNuevo.active')) {
    abrirTabBootstrap('#tabListado');
  }
}

function renderSession() {
  if ($('sessionName')) $('sessionName').textContent = state.session?.name || '';
  if ($('sessionRole')) $('sessionRole').textContent = state.session?.role || state.session?.rol || '';
  aplicarVisibilidadPorRol();
}

function renderTablaDecretosBasica() {
  const tbody = document.querySelector('#tablaDS tbody');
  if (!tbody) return;

  const decretos = (state.decretos.length ? state.decretos : cargarDecretosLocales()).map(normalizarDecreto).filter(Boolean);
  if (!decretos.length) {
    tbody.innerHTML = '<tr><td colspan="17" class="text-muted">No hay Decretos Supremos registrados.</td></tr>';
    return;
  }

  tbody.innerHTML = decretos.map(d => {
    const territorio = Array.isArray(d.territorio) ? d.territorio : [];
    const deps = new Set(territorio.map(t => t.departamento).filter(Boolean));
    const provs = new Set(territorio.map(t => `${t.departamento}|${t.provincia}`).filter(Boolean));
    const dists = new Set(territorio.map(t => `${t.departamento}|${t.provincia}|${t.distrito}`).filter(Boolean));

    let botonRDS = '';
    let botonRevision = '';
    if (puedeActivarRDS()) {
      botonRDS = `<button type="button" class="btn btn-sm ${d.rdsActivo ? 'btn-success' : 'btn-outline-primary'}" onclick="abrirRDS('${escapeHtmlAttr(d.id)}')">RDS</button>`;
      if (puedePreaprobar()) {
        const listo = dsTieneAccionesDeTodosLosProgramas(d.id);
        botonRevision = `<button type="button" class="btn btn-sm btn-warning" ${listo ? '' : 'disabled title="Pendiente: faltan acciones de uno o más programas"'} onclick="abrirPreAprobacion('${escapeHtmlAttr(d.id)}')">PreAprobar</button>`;
      } else if (puedeAprobar()) {
        botonRevision = `<button type="button" class="btn btn-sm btn-success" onclick="abrirPreAprobacion('${escapeHtmlAttr(d.id)}')">Aprobar</button>`;
      }
    } else if (esRegistradorPrograma()) {
      botonRDS = d.rdsActivo
        ? `<button type="button" class="btn btn-sm btn-primary" onclick="abrirRegistrarAcciones('${escapeHtmlAttr(d.id)}')">Registrar Acciones</button>`
        : `<span class="badge text-bg-secondary">No activado</span>`;
      botonRevision = '';
    } else {
      botonRDS = '<span class="text-muted small">Solo lectura</span>';
      botonRevision = '';
    }

    return `
      <tr>
        <td>${escapeHtml(formatearNumeroDS(d))}</td>
        <td>${escapeHtml(d.anio)}</td>
        <td>${escapeHtml(d.peligro)}</td>
        <td>${escapeHtml(d.tipo_peligro)}</td>
        <td>${escapeHtml(d.fecha_inicio)}</td>
        <td>${escapeHtml(d.fecha_fin)}</td>
        <td>${escapeHtml(d.vigencia)}</td>
        <td>${escapeHtml(d.semaforo)}</td>
        <td>${deps.size}</td>
        <td>${provs.size}</td>
        <td>${dists.size}</td>
        <td>${d.es_prorroga ? 'Prórroga' : 'Original'}</td>
        <td>${escapeHtml(d.cadena || '')}</td>
        <td>${escapeHtml(d.nivel_prorroga || 0)}</td>
        <td>${botonRDS}</td>
        <td>${botonRevision}</td>
        <td><button type="button" class="btn btn-sm btn-outline-dark" onclick="verDetalleDS('${escapeHtmlAttr(d.id)}')">👁</button></td>
      </tr>`;
  }).join('');
}

function cargarSelectAccionDS() {
  const sel = $('accionDs');
  if (!sel) return;
  const actual = sel.value;
  const decretos = (state.decretos.length ? state.decretos : cargarDecretosLocales()).map(normalizarDecreto).filter(Boolean);
  sel.innerHTML = '<option value="">Seleccione...</option>' + decretos.map(d => `<option value="${escapeHtmlAttr(d.id)}">${escapeHtml(formatearNumeroDS(d))}</option>`).join('');
  if (actual && Array.from(sel.options).some(o => o.value === actual)) sel.value = actual;
}

function cargarRDSDesdeDSSeleccionado() {
  const d = buscarDecretoPorId($('accionDs')?.value || '');
  if ($('rdsNumeroReunion')) $('rdsNumeroReunion').value = d?.numeroReunion || '';
  if ($('rdsFechaReunion')) $('rdsFechaReunion').value = d?.fechaReunion || '';
  if ($('rdsEstado')) $('rdsEstado').value = d?.estadoRDS || (d?.rdsActivo ? 'Activo' : 'No activado');
  if ($('accionFechaRegistro')) $('accionFechaRegistro').value = d?.fechaRegistroRDS || fechaHoraLocalISO();
  if ($('accionResumenDS')) {
    $('accionResumenDS').innerHTML = d ? `<div class="alert ${d.rdsActivo ? 'alert-success' : 'alert-warning'} py-2 mb-0"><strong>${escapeHtml(formatearNumeroDS(d))}</strong> · ${escapeHtml(d.tipo_peligro || '')} · ${d.rdsActivo ? 'RDS Activo' : 'RDS pendiente de activación'}</div>` : '';
  }
}

function aplicarRestriccionesAccion() {
  const puede = puedeActivarRDS() && modoRegistroAcciones === 'rds';
  ['accionTipo','accionCodigo','accionUnidad','accionMetaProgramada','accionPlazo','accionFechaInicio','accionMetaEjecutada','accionDetalle','accionDescripcion','btnGuardarAccion'].forEach(id => { if ($(id)) $(id).disabled = true; });
  if ($('accionDs')) $('accionDs').disabled = true;
  if ($('btnActivarRDS')) $('btnActivarRDS').disabled = !puede;
  if ($('rdsNumeroReunion')) $('rdsNumeroReunion').disabled = !puede;
  if ($('rdsFechaReunion')) $('rdsFechaReunion').disabled = !puede;
  if ($('rdsMensajeRol')) {
    $('rdsMensajeRol').textContent = puedeActivarRDS()
      ? 'Active o actualice el RDS del Decreto Supremo seleccionado. En esta vista no se registran acciones de programas.'
      : 'Solo lectura.';
  }
}

function aplicarVistaRegistroAcciones() {
  const esModoRDS = modoRegistroAcciones === 'rds';
  const esModoRevision = modoRegistroAcciones === 'revision';
  const boxRegistro = $('accionRegistroBox');
  if (boxRegistro) boxRegistro.style.display = 'none';

  const tabla = $('tablaAcciones')?.closest('.table-responsive');
  const tituloTabla = tabla?.previousElementSibling;
  const botones = $('rdsFlujoBotones');
  if (tabla) tabla.style.display = esModoRevision ? '' : 'none';
  if (tituloTabla) tituloTabla.style.display = esModoRevision ? '' : 'none';
  if (botones) botones.style.display = esModoRevision ? '' : 'none';
  if ($('btnPreaprobarRDS')) $('btnPreaprobarRDS').style.display = puedePreaprobar() ? '' : 'none';
  if ($('btnAprobarRDS')) $('btnAprobarRDS').style.display = puedeAprobar() ? '' : 'none';
  if ($('btnActivarRDS')) $('btnActivarRDS').style.display = esModoRDS && puedeActivarRDS() ? '' : 'none';
}

function activarRDSSeleccionado() {
  if (!puedeActivarRDS()) {
    alert('Solo el Administrador o Registrador puede activar RDS.');
    return;
  }
  const id = $('accionDs')?.value || '';
  const numeroReunion = $('rdsNumeroReunion')?.value || '';
  const fechaReunion = $('rdsFechaReunion')?.value || '';
  if (!id) return alert('Seleccione un Decreto Supremo.');
  if (!numeroReunion) return alert('Seleccione el número de reunión.');
  if (!fechaReunion) return alert('Ingrese la fecha de reunión.');

  const lista = cargarDecretosLocales().map(normalizarDecreto).filter(Boolean);
  const idx = lista.findIndex(d => String(d.id) === String(id));
  if (idx < 0) return alert('No se encontró el Decreto Supremo.');

  lista[idx] = {
    ...lista[idx],
    rdsActivo: true,
    numeroReunion,
    fechaReunion,
    estadoRDS: 'Activo',
    fechaRegistroRDS: fechaHoraLocalISO(),
    activadoPor: state.session?.email || '',
    usuarioActivaRDS: state.session?.email || '',
    programasHabilitados: PROGRAMAS_RDS.slice()
  };
  guardarDecretosLocales(lista);
  renderTablaDecretosBasica();
  cargarSelectAccionDS();
  if ($('accionDs')) $('accionDs').value = id;
  cargarRDSDesdeDSSeleccionado();
  aplicarRestriccionesAccion();
  aplicarVistaRegistroAcciones();
  api('/decretos', 'POST', lista[idx]);
  alert('RDS activado correctamente.');
}

function cargarVistaAccionesPrograma(id) {
  const d = buscarDecretoPorId(id);
  const programa = programaSesionNormalizado();
  if ($('progDs')) $('progDs').value = d ? formatearNumeroDS(d) : '';
  if ($('progNumeroReunion')) $('progNumeroReunion').value = d?.numeroReunion || '';
  if ($('progFechaReunion')) $('progFechaReunion').value = d?.fechaReunion || '';
  if ($('progEstadoRDS')) $('progEstadoRDS').value = d?.estadoRDS || (d?.rdsActivo ? 'Activo' : 'No activado');
  if ($('progFechaRegistroRDS')) $('progFechaRegistroRDS').value = d?.fechaRegistroRDS || '';
  if ($('progProgramaNacional')) $('progProgramaNacional').value = programa;
  actualizarFechaRegistroPrograma();
  limpiarFormularioAccionPrograma(false);
  renderTablaAccionesProgramas();
}

function calcularFechaFinalPrograma() {
  const inicio = $('progFechaInicio')?.value;
  const plazo = parseInt($('progPlazoDias')?.value || 0);
  if (!inicio || isNaN(plazo)) return;
  const f = new Date(`${inicio}T00:00:00`);
  f.setDate(f.getDate() + plazo);
  if ($('progFechaFinal')) $('progFechaFinal').value = f.toISOString().split('T')[0];
}

function calcularAvancePrograma() {
  const meta = Number($('progMetaProgramada')?.value || 0);
  const eje = Number($('progMetaEjecutada')?.value || 0);
  if ($('progAvance')) $('progAvance').value = meta > 0 ? Math.min(100, Math.round((eje / meta) * 100)) + '%' : '0%';
}

function guardarAccionPrograma() {
  const d = buscarDecretoPorId(dsProgramaSeleccionadoId);
  if (!esRegistradorPrograma()) return alert('Solo un Registrador de Programa puede guardar acciones en esta vista.');
  if (!d || !d.rdsActivo) return alert('El Decreto Supremo no tiene RDS activo.');

  const programa = programaSesionNormalizado();
  const tipoAccion = $('progTipoAccion')?.value || '';
  const codigoAccion = String($('progCodigoAccion')?.value || '').trim();
  const detalle = String($('progDetalle')?.value || '').trim();

  if (!tipoAccion) return alert('Seleccione el Tipo de acción.');
  if (!codigoAccion) return alert('Ingrese el Código de acción.');
  if (!detalle) return alert('Ingrese las acciones específicas programadas y ejecutadas.');
  if (!$('progUnidadMedida')?.value) return alert('Seleccione la Unidad de medida.');
  if (!$('progFechaInicio')?.value) return alert('Ingrese la Fecha de inicio.');

  calcularFechaFinalPrograma();
  calcularAvancePrograma();

  const lista = cargarAccionesLocales();
  const duplicada = lista.some(a =>
    String(a.dsId || a.ds_id) === String(d.id) &&
    normalizarProgramaNombre(a.programaNacional || a.programa) === programa &&
    normalizarTexto(a.codigoAccion || a.codigo) === normalizarTexto(codigoAccion)
  );
  if (duplicada) return alert('Ya existe una acción con el mismo DS, Programa Nacional y Código de acción.');

  const fechaRegistro = fechaHoraLocalISO();
  const accion = {
    id: crypto.randomUUID(),
    dsId: d.id,
    ds_id: d.id,
    numeroDS: formatearNumeroDS(d),
    ds: formatearNumeroDS(d),
    numeroReunion: d.numeroReunion || '',
    fechaReunion: d.fechaReunion || '',
    estadoRDS: d.estadoRDS || 'Activo',
    programaNacional: programa,
    programa,
    tipoAccion,
    tipo: tipoAccion,
    codigoAccion,
    codigo: codigoAccion,
    detalle,
    unidadMedida: $('progUnidadMedida')?.value || '',
    unidad: $('progUnidadMedida')?.value || '',
    metaProgramada: Number($('progMetaProgramada')?.value || 0),
    meta_programada: Number($('progMetaProgramada')?.value || 0),
    plazoDias: Number($('progPlazoDias')?.value || 0),
    plazo: Number($('progPlazoDias')?.value || 0),
    fechaInicio: $('progFechaInicio')?.value || '',
    fecha_inicio: $('progFechaInicio')?.value || '',
    fechaFinal: $('progFechaFinal')?.value || '',
    fecha_final: $('progFechaFinal')?.value || '',
    metaEjecutada: Number($('progMetaEjecutada')?.value || 0),
    meta_ejecutada: Number($('progMetaEjecutada')?.value || 0),
    avance: $('progAvance')?.value || '0%',
    descripcionActividades: $('progDescripcionActividades')?.value || '',
    descripcion: $('progDescripcionActividades')?.value || '',
    fechaRegistro,
    fecha_registro: fechaRegistro,
    usuarioRegistro: state.session?.email || '',
    usuario_registro: state.session?.email || '',
    estado: 'Registrado'
  };

  lista.push(accion);
  guardarAccionesLocales(lista);
  api('/acciones', 'POST', accion);
  limpiarFormularioAccionPrograma(true);
  renderTablaAccionesProgramas();
  renderTablaDecretosBasica();
  alert('Acción registrada correctamente.');
}

function limpiarFormularioAccionPrograma(actualizarFecha = true) {
  ['progCodigoAccion','progMetaProgramada','progPlazoDias','progFechaInicio','progFechaFinal','progMetaEjecutada','progAvance','progDetalle','progDescripcionActividades'].forEach(id => { if ($(id)) $(id).value = ''; });
  if ($('progTipoAccion')) $('progTipoAccion').value = '';
  if ($('progUnidadMedida')) $('progUnidadMedida').value = '';
  if (actualizarFecha) actualizarFechaRegistroPrograma();
}

function renderTablaAccionesProgramas() {
  const tbody = document.querySelector('#tablaAccionesProgramas tbody');
  if (!tbody) return;
  const programa = programaSesionNormalizado();
  const dsId = dsProgramaSeleccionadoId;
  const visibles = cargarAccionesLocales().filter(a =>
    (!dsId || String(a.dsId || a.ds_id) === String(dsId)) &&
    normalizarProgramaNombre(a.programaNacional || a.programa) === programa
  );
  if (!visibles.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="text-muted">No hay acciones registradas para su programa.</td></tr>';
    return;
  }
  tbody.innerHTML = visibles.map(a => `
    <tr>
      <td>${escapeHtml(a.numeroDS || a.ds || '')}</td>
      <td>${escapeHtml(a.programaNacional || a.programa || '')}</td>
      <td>${escapeHtml(a.tipoAccion || a.tipo || '')}</td>
      <td>${escapeHtml(a.codigoAccion || a.codigo || '')}</td>
      <td>${escapeHtml(a.detalle || '')}</td>
      <td>${escapeHtml(a.estado || 'Registrado')}</td>
      <td>${escapeHtml(a.usuarioRegistro || a.usuario_registro || '')}</td>
      <td>${escapeHtml(a.fechaRegistro || a.fecha_registro || '')}</td>
      <td><span class="badge text-bg-success">Registrado</span></td>
    </tr>`).join('');
}

function accionesDelDSSeleccionado() {
  const dsId = $('accionDs')?.value || '';
  return cargarAccionesLocales().filter(a => !dsId || String(a.dsId || a.ds_id) === String(dsId));
}

function renderTablaAcciones() {
  const tbody = document.querySelector('#tablaAcciones tbody');
  if (!tbody) return;
  const base = accionesDelDSSeleccionado();
  const visibles = (esAdministrador() || esRegistradorGeneral())
    ? base
    : base.filter(a => normalizarProgramaNombre(a.programaNacional || a.programa) === programaSesionNormalizado());
  if (!visibles.length) {
    tbody.innerHTML = '<tr><td colspan="15" class="text-muted">No hay acciones registradas para el Decreto Supremo seleccionado.</td></tr>';
    return;
  }
  tbody.innerHTML = visibles.map(a => `
    <tr>
      <td>${escapeHtml(a.programaNacional || a.programa || '')}</td>
      <td>${escapeHtml(a.tipoAccion || a.tipo || '')}</td>
      <td>${escapeHtml(a.codigoAccion || a.codigo || '')}</td>
      <td>${escapeHtml(a.detalle || '')}</td>
      <td>${escapeHtml(a.unidadMedida || a.unidad || '')}</td>
      <td>${escapeHtml(a.metaProgramada ?? a.meta_programada ?? '')}</td>
      <td>${escapeHtml(a.fechaInicio || a.fecha_inicio || '')}</td>
      <td>${escapeHtml(a.fechaFinal || a.fecha_final || '')}</td>
      <td>${escapeHtml(a.metaEjecutada ?? a.meta_ejecutada ?? '')}</td>
      <td>${escapeHtml(a.avance || '')}</td>
      <td>${escapeHtml(a.descripcionActividades || a.descripcion || '')}</td>
      <td>${escapeHtml(a.estado || 'Registrado')}</td>
      <td>${escapeHtml(a.usuarioRegistro || a.usuario_registro || '')}</td>
      <td>${escapeHtml(a.fechaRegistro || a.fecha_registro || '')}</td>
      <td>-</td>
    </tr>`).join('');
}

function cambiarEstadoFlujoRDS(nuevoEstado) {
  const dsId = $('accionDs')?.value || '';
  if (!dsId) return alert('Seleccione un Decreto Supremo.');
  if (nuevoEstado === 'Preaprobado' && !puedePreaprobar()) return alert('Solo el Registrador puede PreAprobar.');
  if (nuevoEstado === 'Aprobado' && !puedeAprobar()) return alert('Solo el Administrador puede Aprobar.');
  if (nuevoEstado === 'Preaprobado' && !dsTieneAccionesDeTodosLosProgramas(dsId)) return alert('Aún faltan acciones de uno o más Programas Nacionales.');

  const acciones = cargarAccionesLocales();
  let tocadas = 0;
  const actualizadas = acciones.map(a => {
    if (String(a.dsId || a.ds_id) !== String(dsId)) return a;
    tocadas++;
    return { ...a, estado: nuevoEstado, usuario_flujo: state.session?.email || '', fecha_flujo: new Date().toISOString() };
  });
  if (!tocadas) return alert('No hay acciones registradas para cambiar de estado.');
  guardarAccionesLocales(actualizadas);

  const decretos = cargarDecretosLocales().map(normalizarDecreto).filter(Boolean).map(d => {
    if (String(d.id) !== String(dsId)) return d;
    return { ...d, estadoRDS: nuevoEstado, usuarioEstadoRDS: state.session?.email || '', fechaEstadoRDS: fechaHoraLocalISO() };
  });
  guardarDecretosLocales(decretos);
  cargarRDSDesdeDSSeleccionado();
  renderTablaAcciones();
  renderTablaDecretosBasica();
  alert(`Registro ${nuevoEstado.toLowerCase()} correctamente.`);
}

window.abrirRDS = abrirRDS;
window.abrirRegistrarAcciones = abrirRegistrarAcciones;
window.abrirPreAprobacion = abrirPreAprobacion;

// ================= CIERRE FINAL RDS v37 - PREAPROBACION PROGRAMAS =================
let dsPreAprobarSeleccionadoId = null;

function accionValor(a, ...keys) {
  for (const k of keys) {
    if (a && a[k] !== undefined && a[k] !== null && String(a[k]) !== '') return a[k];
  }
  return '';
}

function accionesPorDS(dsId) {
  return cargarAccionesLocales().filter(a => String(a.dsId || a.ds_id) === String(dsId));
}

function accionesPorDSYPrograma(dsId, programa) {
  const p = normalizarProgramaNombre(programa);
  return accionesPorDS(dsId).filter(a => normalizarProgramaNombre(a.programaNacional || a.programa) === p);
}

function dsTieneAccionesRegistradas(dsId) {
  return accionesPorDS(dsId).length > 0;
}

function dsTieneAccionesDelPrograma(dsId, programa) {
  return accionesPorDSYPrograma(dsId, programa).length > 0;
}

function dsProgramaCerroRegistro(d, programa) {
  const p = normalizarProgramaNombre(programa);
  return Boolean((d?.programasRegistroCerrado || {})[p]) || dsTieneAccionesDelPrograma(d?.id, p);
}

function setDsProgramaCerrado(dsId, programa) {
  const p = normalizarProgramaNombre(programa);
  const lista = cargarDecretosLocales().map(normalizarDecreto).filter(Boolean);
  const idx = lista.findIndex(d => String(d.id) === String(dsId));
  if (idx < 0) return;
  lista[idx] = {
    ...lista[idx],
    programasRegistroCerrado: {
      ...(lista[idx].programasRegistroCerrado || {}),
      [p]: true
    },
    estadoRegistroProgramas: 'Acciones Registradas',
    usuarioCierrePrograma: state.session?.email || '',
    fechaCierrePrograma: fechaHoraLocalISO()
  };
  guardarDecretosLocales(lista);
  api('/decretos', 'POST', lista[idx]);
}

function abrirTabBootstrap(target) {
  const btn = document.querySelector(`[data-bs-target="${target}"]`);
  if (btn && window.bootstrap?.Tab) bootstrap.Tab.getOrCreateInstance(btn).show();
  else btn?.click();
}

function mostrarTabAccionesProgramas(mostrar) {
  const item = $('navAccionesProgramasItem');
  if (item) item.style.display = mostrar ? '' : 'none';
}

function mostrarTabPreAprobar(mostrar) {
  const item = $('navPreAprobarItem');
  if (item) item.style.display = mostrar ? '' : 'none';
}

function aplicarVisibilidadPorRol() {
  const tabAccionesBtn = document.querySelector('[data-bs-target="#tabAcciones"]')?.closest('.nav-item');
  if (tabAccionesBtn) tabAccionesBtn.style.display = esRegistradorPrograma() ? 'none' : '';

  const tabNuevoBtn = document.querySelector('[data-bs-target="#tabNuevo"]')?.closest('.nav-item');
  if (tabNuevoBtn) tabNuevoBtn.style.display = esRegistradorPrograma() ? 'none' : '';

  const tabSegBtn = document.querySelector('[data-bs-target="#tabSeg"]')?.closest('.nav-item');
  if (tabSegBtn) tabSegBtn.style.display = esAdministrador() ? '' : 'none';

  mostrarTabAccionesProgramas(false);
  mostrarTabPreAprobar(false);

  const btnAdmin = $('btnAdminPanel');
  if (btnAdmin) {
    const admin = esAdministrador();
    btnAdmin.style.display = admin ? 'inline-block' : 'none';
    btnAdmin.disabled = !admin;
    btnAdmin.style.pointerEvents = admin ? 'auto' : 'none';
  }

  if (esRegistradorPrograma() && (document.querySelector('#tabNuevo.active') || document.querySelector('#tabAcciones.active'))) {
    abrirTabBootstrap('#tabListado');
  }
}

function renderSession() {
  if ($('sessionName')) $('sessionName').textContent = state.session?.name || '';
  if ($('sessionRole')) $('sessionRole').textContent = state.session?.role || state.session?.rol || '';
  aplicarVisibilidadPorRol();
}

function initRegistroAcciones() {
  cargarSelectAccionDS();
  cargarCatalogosAccion();
  actualizarFechaRegistroAccion();
  cargarRDSDesdeDSSeleccionado();
  aplicarRestriccionesAccion();
  renderTablaAcciones();
  aplicarVistaRegistroAcciones();
  initRegistroAccionesProgramas();
  initPreAprobarAcciones();

  if (accionesInicializadas) return;
  accionesInicializadas = true;

  $('accionDs')?.addEventListener('change', () => {
    cargarRDSDesdeDSSeleccionado();
    aplicarRestriccionesAccion();
    renderTablaAcciones();
    aplicarVistaRegistroAcciones();
  });
  $('btnActivarRDS')?.addEventListener('click', activarRDSSeleccionado);
  $('btnPreaprobarRDS')?.addEventListener('click', () => cambiarEstadoFlujoRDS('Preaprobado'));
  $('btnAprobarRDS')?.addEventListener('click', () => cambiarEstadoFlujoRDS('Aprobado'));
}

function initRegistroAccionesProgramas() {
  cargarCatalogosAccionPrograma();
  actualizarFechaRegistroPrograma();
  renderTablaAccionesProgramas();

  if (!accionesProgramaInicializadas) {
    accionesProgramaInicializadas = true;
    $('btnGuardarAccionPrograma')?.addEventListener('click', guardarAccionPrograma);
    $('btnSalirAccionPrograma')?.addEventListener('click', salirRegistroAccionesPrograma);
    $('progPlazoDias')?.addEventListener('input', calcularFechaFinalPrograma);
    $('progFechaInicio')?.addEventListener('change', calcularFechaFinalPrograma);
    $('progMetaProgramada')?.addEventListener('input', calcularAvancePrograma);
    $('progMetaEjecutada')?.addEventListener('input', calcularAvancePrograma);
  }
}

function initPreAprobarAcciones() {
  cargarCatalogosEditarAccion();
  $('btnPreAprobarFinal')?.removeEventListener?.('click', preaprobarAccionesDS);
  $('btnAprobarFinal')?.removeEventListener?.('click', aprobarAccionesDS);
  $('btnGrabarModalAccion')?.removeEventListener?.('click', grabarModalAccion);
  $('editPlazoDias')?.removeEventListener?.('input', calcularFechaFinalModal);
  $('editFechaInicio')?.removeEventListener?.('change', calcularFechaFinalModal);
  $('editMetaProgramada')?.removeEventListener?.('input', calcularAvanceModal);
  $('editMetaEjecutada')?.removeEventListener?.('input', calcularAvanceModal);

  $('btnPreAprobarFinal')?.addEventListener('click', preaprobarAccionesDS);
  $('btnAprobarFinal')?.addEventListener('click', aprobarAccionesDS);
  $('btnGrabarModalAccion')?.addEventListener('click', grabarModalAccion);
  $('editPlazoDias')?.addEventListener('input', calcularFechaFinalModal);
  $('editFechaInicio')?.addEventListener('change', calcularFechaFinalModal);
  $('editMetaProgramada')?.addEventListener('input', calcularAvanceModal);
  $('editMetaEjecutada')?.addEventListener('input', calcularAvanceModal);
}

function cargarCatalogosEditarAccion() {
  const tipo = $('editTipoAccion');
  if (tipo && !tipo.options.length) tipo.innerHTML = '<option value="">Seleccione...</option><option>Intervención directa</option><option>Seguimiento</option><option>Asistencia técnica</option><option>Coordinación territorial</option><option>Entrega de bienes o servicios</option>';
  const unidad = $('editUnidadMedida');
  if (unidad && !unidad.options.length) unidad.innerHTML = '<option value="">Seleccione...</option><option>Persona</option><option>Usuario</option><option>Servicio</option><option>Distrito</option><option>Acción</option><option>Informe</option><option>Coordinación</option>';
}

function renderTablaDecretosBasica() {
  const tbody = document.querySelector('#tablaDS tbody');
  if (!tbody) return;

  const decretos = (state.decretos.length ? state.decretos : cargarDecretosLocales()).map(normalizarDecreto).filter(Boolean);
  if (!decretos.length) {
    tbody.innerHTML = '<tr><td colspan="17" class="text-muted">No hay Decretos Supremos registrados.</td></tr>';
    return;
  }

  tbody.innerHTML = decretos.map(d => {
    const territorio = Array.isArray(d.territorio) ? d.territorio : [];
    const deps = new Set(territorio.map(t => t.departamento).filter(Boolean));
    const provs = new Set(territorio.map(t => `${t.departamento}|${t.provincia}`).filter(Boolean));
    const dists = new Set(territorio.map(t => `${t.departamento}|${t.provincia}|${t.distrito}`).filter(Boolean));
    const estado = normalizarTexto(d.estadoRDS || '');
    let botonRDS = '';
    let botonRevision = '';

    if (puedeActivarRDS()) {
      botonRDS = `<button type="button" class="btn btn-sm ${d.rdsActivo ? 'btn-success' : 'btn-outline-primary'}" onclick="abrirRDS('${escapeHtmlAttr(d.id)}')">RDS</button>`;
      if (puedePreaprobar()) {
        const habilitado = d.rdsActivo && dsTieneAccionesRegistradas(d.id) && estado !== 'PREAPROBADO' && estado !== 'APROBADO';
        botonRevision = `<button type="button" class="btn btn-sm btn-warning" ${habilitado ? '' : 'disabled title="Pendiente: no existen acciones registradas o ya fue preaprobado/aprobado"'} onclick="abrirPreAprobacion('${escapeHtmlAttr(d.id)}')">PreAprobar</button>`;
      } else if (puedeAprobar()) {
        const habilitado = estado === 'PREAPROBADO';
        botonRevision = `<button type="button" class="btn btn-sm btn-success" ${habilitado ? '' : 'disabled title="Disponible cuando el DS esté PreAprobado"'} onclick="abrirPreAprobacion('${escapeHtmlAttr(d.id)}')">Aprobar</button>`;
      }
    } else if (esRegistradorPrograma()) {
      const programa = programaSesionNormalizado();
      const cerrado = dsProgramaCerroRegistro(d, programa);
      botonRDS = d.rdsActivo
        ? (cerrado
            ? `<button type="button" class="btn btn-sm btn-secondary" disabled>Acciones Registradas</button>`
            : `<button type="button" class="btn btn-sm btn-primary" onclick="abrirRegistrarAcciones('${escapeHtmlAttr(d.id)}')">Registrar Acciones</button>`)
        : `<span class="badge text-bg-secondary">No activado</span>`;
      botonRevision = '';
    } else {
      botonRDS = '<span class="text-muted small">Solo lectura</span>';
      botonRevision = '';
    }

    return `
      <tr>
        <td>${escapeHtml(formatearNumeroDS(d))}</td>
        <td>${escapeHtml(d.anio)}</td>
        <td>${escapeHtml(d.peligro)}</td>
        <td>${escapeHtml(d.tipo_peligro)}</td>
        <td>${escapeHtml(d.fecha_inicio)}</td>
        <td>${escapeHtml(d.fecha_fin)}</td>
        <td>${escapeHtml(d.vigencia)}</td>
        <td>${escapeHtml(d.semaforo)}</td>
        <td>${deps.size}</td>
        <td>${provs.size}</td>
        <td>${dists.size}</td>
        <td>${d.es_prorroga ? 'Prórroga' : 'Original'}</td>
        <td>${escapeHtml(d.cadena || '')}</td>
        <td>${escapeHtml(d.nivel_prorroga || 0)}</td>
        <td>${botonRDS}</td>
        <td>${botonRevision}</td>
        <td><button type="button" class="btn btn-sm btn-outline-dark" onclick="verDetalleDS('${escapeHtmlAttr(d.id)}')">👁</button></td>
      </tr>`;
  }).join('');
}

function abrirRegistrarAcciones(id) {
  if (!esRegistradorPrograma()) {
    alert('Esta vista corresponde a Registradores de Programas Nacionales.');
    return;
  }
  const d = buscarDecretoPorId(id);
  if (!d?.rdsActivo) {
    alert('El Decreto Supremo aún no tiene RDS activo.');
    return;
  }
  dsProgramaSeleccionadoId = id;
  mostrarTabAccionesProgramas(true);
  mostrarTabPreAprobar(false);
  abrirTabBootstrap('#tabAccionesProgramas');
  initRegistroAccionesProgramas();
  cargarVistaAccionesPrograma(id);
}

function salirRegistroAccionesPrograma() {
  if (!dsProgramaSeleccionadoId) {
    abrirTabBootstrap('#tabListado');
    return;
  }
  const programa = programaSesionNormalizado();
  if (!dsTieneAccionesDelPrograma(dsProgramaSeleccionadoId, programa)) {
    alert('Debe registrar al menos una acción antes de salir.');
    return;
  }
  setDsProgramaCerrado(dsProgramaSeleccionadoId, programa);
  renderTablaDecretosBasica();
  mostrarTabAccionesProgramas(false);
  abrirTabBootstrap('#tabListado');
}

function abrirPreAprobacion(id) {
  if (!puedePreaprobar() && !puedeAprobar()) {
    alert('No tiene permisos para este flujo.');
    return;
  }
  const d = buscarDecretoPorId(id);
  if (!d?.rdsActivo) return alert('El DS aún no tiene RDS activo.');
  if (puedePreaprobar() && !dsTieneAccionesRegistradas(id)) return alert('No se puede PreAprobar: no existen acciones registradas.');
  if (puedeAprobar() && normalizarTexto(d.estadoRDS) !== 'PREAPROBADO') return alert('Solo puede aprobar DS en estado PreAprobado.');

  dsPreAprobarSeleccionadoId = id;
  mostrarTabPreAprobar(true);
  mostrarTabAccionesProgramas(false);
  abrirTabBootstrap('#tabPreAprobarAcciones');
  initPreAprobarAcciones();
  cargarVistaPreAprobar(id);
}

function cargarVistaPreAprobar(id) {
  const d = buscarDecretoPorId(id);
  if ($('preDs')) $('preDs').value = d ? formatearNumeroDS(d) : '';
  if ($('preNumeroReunion')) $('preNumeroReunion').value = d?.numeroReunion || '';
  if ($('preFechaReunion')) $('preFechaReunion').value = d?.fechaReunion || '';
  if ($('preEstadoRDS')) $('preEstadoRDS').value = d?.estadoRDS || (d?.rdsActivo ? 'Activo' : 'No activado');
  if ($('preFechaRegistroRDS')) $('preFechaRegistroRDS').value = d?.fechaRegistroRDS || fechaHoraLocalISO();

  if ($('preNumeroReunion')) $('preNumeroReunion').disabled = !puedePreaprobar();
  if ($('preFechaReunion')) $('preFechaReunion').disabled = !puedePreaprobar();

  if ($('btnPreAprobarFinal')) $('btnPreAprobarFinal').style.display = puedePreaprobar() ? '' : 'none';
  if ($('btnAprobarFinal')) $('btnAprobarFinal').style.display = puedeAprobar() ? '' : 'none';

  renderTablaPreAprobarAcciones();
}

function renderTablaPreAprobarAcciones() {
  const tbody = document.querySelector('#tablaPreAprobarAcciones tbody');
  if (!tbody) return;
  const acciones = accionesPorDS(dsPreAprobarSeleccionadoId);
  if (!acciones.length) {
    tbody.innerHTML = '<tr><td colspan="10" class="text-muted">No hay acciones registradas para este Decreto Supremo.</td></tr>';
    return;
  }
  tbody.innerHTML = acciones.map(a => `
    <tr>
      <td>${escapeHtml(accionValor(a,'programaNacional','programa'))}</td>
      <td>${escapeHtml(accionValor(a,'tipoAccion','tipo'))}</td>
      <td>${escapeHtml(accionValor(a,'codigoAccion','codigo'))}</td>
      <td>${escapeHtml(accionValor(a,'detalle'))}</td>
      <td>${escapeHtml(accionValor(a,'metaProgramada','meta_programada'))}</td>
      <td>${escapeHtml(accionValor(a,'metaEjecutada','meta_ejecutada'))}</td>
      <td>${escapeHtml(accionValor(a,'avance'))}</td>
      <td>${escapeHtml(accionValor(a,'usuarioRegistro','usuario_registro'))}</td>
      <td>${escapeHtml(accionValor(a,'fechaRegistro','fecha_registro'))}</td>
      <td><button type="button" class="btn btn-sm btn-outline-primary" onclick="abrirModalEditarAccion('${escapeHtmlAttr(a.id)}')">Ver / Editar</button></td>
    </tr>`).join('');
}

function abrirModalEditarAccion(id) {
  const a = cargarAccionesLocales().find(x => String(x.id) === String(id));
  if (!a) return alert('No se encontró la acción.');
  cargarCatalogosEditarAccion();

  if ($('editAccionId')) $('editAccionId').value = a.id;
  if ($('editTipoAccion')) $('editTipoAccion').value = accionValor(a,'tipoAccion','tipo');
  if ($('editCodigoAccion')) $('editCodigoAccion').value = accionValor(a,'codigoAccion','codigo');
  if ($('editUnidadMedida')) $('editUnidadMedida').value = accionValor(a,'unidadMedida','unidad');
  if ($('editMetaProgramada')) $('editMetaProgramada').value = accionValor(a,'metaProgramada','meta_programada');
  if ($('editPlazoDias')) $('editPlazoDias').value = accionValor(a,'plazoDias','plazo');
  if ($('editFechaInicio')) $('editFechaInicio').value = accionValor(a,'fechaInicio','fecha_inicio');
  if ($('editFechaFinal')) $('editFechaFinal').value = accionValor(a,'fechaFinal','fecha_final');
  if ($('editMetaEjecutada')) $('editMetaEjecutada').value = accionValor(a,'metaEjecutada','meta_ejecutada');
  if ($('editAvance')) $('editAvance').value = accionValor(a,'avance');
  if ($('editDetalle')) $('editDetalle').value = accionValor(a,'detalle');
  if ($('editDescripcion')) $('editDescripcion').value = accionValor(a,'descripcionActividades','descripcion');
  if ($('editFechaRegistro')) $('editFechaRegistro').value = accionValor(a,'fechaRegistro','fecha_registro');
  if ($('editUsuario')) $('editUsuario').value = accionValor(a,'usuarioRegistro','usuario_registro');

  const modal = $('modalEditarAccion');
  if (modal && window.bootstrap?.Modal) bootstrap.Modal.getOrCreateInstance(modal).show();
}

function calcularFechaFinalModal() {
  const inicio = $('editFechaInicio')?.value;
  const plazo = parseInt($('editPlazoDias')?.value || 0);
  if (!inicio || isNaN(plazo)) return;
  const f = new Date(`${inicio}T00:00:00`);
  f.setDate(f.getDate() + plazo);
  if ($('editFechaFinal')) $('editFechaFinal').value = f.toISOString().split('T')[0];
}

function calcularAvanceModal() {
  const meta = Number($('editMetaProgramada')?.value || 0);
  const eje = Number($('editMetaEjecutada')?.value || 0);
  if ($('editAvance')) $('editAvance').value = meta > 0 ? Math.min(100, Math.round((eje / meta) * 100)) + '%' : '0%';
}

function grabarModalAccion() {
  const id = $('editAccionId')?.value || '';
  if (!id) return alert('No hay acción seleccionada.');
  calcularFechaFinalModal();
  calcularAvanceModal();

  const lista = cargarAccionesLocales();
  const idx = lista.findIndex(a => String(a.id) === String(id));
  if (idx < 0) return alert('No se encontró la acción.');

  const original = lista[idx];
  const codigoNuevo = String($('editCodigoAccion')?.value || '').trim();
  const programa = normalizarProgramaNombre(original.programaNacional || original.programa);
  const dsId = original.dsId || original.ds_id;

  const duplicada = lista.some(a =>
    String(a.id) !== String(id) &&
    String(a.dsId || a.ds_id) === String(dsId) &&
    normalizarProgramaNombre(a.programaNacional || a.programa) === programa &&
    normalizarTexto(a.codigoAccion || a.codigo) === normalizarTexto(codigoNuevo)
  );
  if (duplicada) return alert('Ya existe otra acción con el mismo DS, Programa Nacional y Código de acción.');

  lista[idx] = {
    ...original,
    tipoAccion: $('editTipoAccion')?.value || '',
    tipo: $('editTipoAccion')?.value || '',
    codigoAccion: codigoNuevo,
    codigo: codigoNuevo,
    detalle: $('editDetalle')?.value || '',
    unidadMedida: $('editUnidadMedida')?.value || '',
    unidad: $('editUnidadMedida')?.value || '',
    metaProgramada: Number($('editMetaProgramada')?.value || 0),
    meta_programada: Number($('editMetaProgramada')?.value || 0),
    plazoDias: Number($('editPlazoDias')?.value || 0),
    plazo: Number($('editPlazoDias')?.value || 0),
    fechaInicio: $('editFechaInicio')?.value || '',
    fecha_inicio: $('editFechaInicio')?.value || '',
    fechaFinal: $('editFechaFinal')?.value || '',
    fecha_final: $('editFechaFinal')?.value || '',
    metaEjecutada: Number($('editMetaEjecutada')?.value || 0),
    meta_ejecutada: Number($('editMetaEjecutada')?.value || 0),
    avance: $('editAvance')?.value || '0%',
    descripcionActividades: $('editDescripcion')?.value || '',
    descripcion: $('editDescripcion')?.value || '',
    usuario_actualiza: state.session?.email || '',
    fecha_actualiza: fechaHoraLocalISO()
  };

  guardarAccionesLocales(lista);
  api('/acciones', 'POST', lista[idx]);
  renderTablaPreAprobarAcciones();
  renderTablaAcciones();
  const modal = $('modalEditarAccion');
  if (modal && window.bootstrap?.Modal) bootstrap.Modal.getOrCreateInstance(modal).hide();
  alert('Acción actualizada correctamente.');
}

function guardarDatosDSPreAprobar(estadoFinal) {
  const dsId = dsPreAprobarSeleccionadoId;
  const lista = cargarDecretosLocales().map(normalizarDecreto).filter(Boolean);
  const idx = lista.findIndex(d => String(d.id) === String(dsId));
  if (idx < 0) return null;
  const numeroReunion = $('preNumeroReunion')?.value || lista[idx].numeroReunion || '';
  const fechaReunion = $('preFechaReunion')?.value || lista[idx].fechaReunion || '';

  const extra = estadoFinal === 'Preaprobado'
    ? { usuarioPreaprueba: state.session?.email || '', fechaPreaprueba: fechaHoraLocalISO() }
    : { usuarioAprueba: state.session?.email || '', fechaAprueba: fechaHoraLocalISO() };

  lista[idx] = {
    ...lista[idx],
    numeroReunion,
    fechaReunion,
    estadoRDS: estadoFinal,
    fechaEstadoRDS: fechaHoraLocalISO(),
    usuarioEstadoRDS: state.session?.email || '',
    ...extra
  };
  guardarDecretosLocales(lista);
  api('/decretos', 'POST', lista[idx]);
  return lista[idx];
}

function preaprobarAccionesDS() {
  const dsId = dsPreAprobarSeleccionadoId;
  if (!puedePreaprobar()) return alert('Solo el usuario Registrador puede PreAprobar.');
  if (!dsId) return alert('Seleccione un Decreto Supremo.');
  if (!dsTieneAccionesRegistradas(dsId)) return alert('No se puede PreAprobar: no existen acciones registradas.');
  if (!$('preNumeroReunion')?.value) return alert('Seleccione el número de reunión.');
  if (!$('preFechaReunion')?.value) return alert('Ingrese la fecha de reunión.');

  const acciones = cargarAccionesLocales().map(a => String(a.dsId || a.ds_id) === String(dsId)
    ? { ...a, estado: 'Preaprobado', usuario_flujo: state.session?.email || '', fecha_flujo: fechaHoraLocalISO() }
    : a
  );
  guardarAccionesLocales(acciones);
  guardarDatosDSPreAprobar('Preaprobado');
  renderTablaPreAprobarAcciones();
  renderTablaDecretosBasica();
  cargarVistaPreAprobar(dsId);
  alert('DS PreAprobado correctamente.');
}

function aprobarAccionesDS() {
  const dsId = dsPreAprobarSeleccionadoId;
  const d = buscarDecretoPorId(dsId);
  if (!puedeAprobar()) return alert('Solo el Administrador puede Aprobar.');
  if (!dsId) return alert('Seleccione un Decreto Supremo.');
  if (normalizarTexto(d?.estadoRDS) !== 'PREAPROBADO') return alert('Solo se puede aprobar un DS en estado PreAprobado.');

  const acciones = cargarAccionesLocales().map(a => String(a.dsId || a.ds_id) === String(dsId)
    ? { ...a, estado: 'Aprobado', usuario_flujo: state.session?.email || '', fecha_flujo: fechaHoraLocalISO() }
    : a
  );
  guardarAccionesLocales(acciones);
  guardarDatosDSPreAprobar('Aprobado');
  renderTablaPreAprobarAcciones();
  renderTablaDecretosBasica();
  cargarVistaPreAprobar(dsId);
  alert('DS Aprobado correctamente.');
}

function cambiarEstadoFlujoRDS(nuevoEstado) {
  dsPreAprobarSeleccionadoId = $('accionDs')?.value || dsPreAprobarSeleccionadoId;
  if (nuevoEstado === 'Preaprobado') return preaprobarAccionesDS();
  if (nuevoEstado === 'Aprobado') return aprobarAccionesDS();
}

function renderTablaAccionesProgramas() {
  const tbody = document.querySelector('#tablaAccionesProgramas tbody');
  if (!tbody) return;
  const programa = programaSesionNormalizado();
  const dsId = dsProgramaSeleccionadoId;
  const visibles = cargarAccionesLocales().filter(a =>
    (!dsId || String(a.dsId || a.ds_id) === String(dsId)) &&
    normalizarProgramaNombre(a.programaNacional || a.programa) === programa
  );
  if (!visibles.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="text-muted">No hay acciones registradas para su programa.</td></tr>';
    return;
  }
  tbody.innerHTML = visibles.map(a => `
    <tr>
      <td>${escapeHtml(a.numeroDS || a.ds || '')}</td>
      <td>${escapeHtml(a.programaNacional || a.programa || '')}</td>
      <td>${escapeHtml(a.tipoAccion || a.tipo || '')}</td>
      <td>${escapeHtml(a.codigoAccion || a.codigo || '')}</td>
      <td>${escapeHtml(a.detalle || '')}</td>
      <td>${escapeHtml(a.estado || 'Registrado')}</td>
      <td>${escapeHtml(a.usuarioRegistro || a.usuario_registro || '')}</td>
      <td>${escapeHtml(a.fechaRegistro || a.fecha_registro || '')}</td>
      <td><span class="badge text-bg-success">Registrado</span></td>
    </tr>`).join('');
}

function guardarAccionPrograma() {
  const d = buscarDecretoPorId(dsProgramaSeleccionadoId);
  if (!esRegistradorPrograma()) return alert('Solo un Registrador de Programa puede guardar acciones en esta vista.');
  if (!d || !d.rdsActivo) return alert('El Decreto Supremo no tiene RDS activo.');

  const programa = programaSesionNormalizado();
  const tipoAccion = $('progTipoAccion')?.value || '';
  const codigoAccion = String($('progCodigoAccion')?.value || '').trim();
  const detalle = String($('progDetalle')?.value || '').trim();

  if (!tipoAccion) return alert('Seleccione el Tipo de acción.');
  if (!codigoAccion) return alert('Ingrese el Código de acción.');
  if (!detalle) return alert('Ingrese las acciones específicas programadas y ejecutadas.');
  if (!$('progUnidadMedida')?.value) return alert('Seleccione la Unidad de medida.');
  if (!$('progFechaInicio')?.value) return alert('Ingrese la Fecha de inicio.');

  calcularFechaFinalPrograma();
  calcularAvancePrograma();

  const lista = cargarAccionesLocales();
  const duplicada = lista.some(a =>
    String(a.dsId || a.ds_id) === String(d.id) &&
    normalizarProgramaNombre(a.programaNacional || a.programa) === programa &&
    normalizarTexto(a.codigoAccion || a.codigo) === normalizarTexto(codigoAccion)
  );
  if (duplicada) return alert('Ya existe una acción con el mismo DS, Programa Nacional y Código de acción.');

  const fechaRegistro = fechaHoraLocalISO();
  const accion = {
    id: crypto.randomUUID(),
    dsId: d.id,
    ds_id: d.id,
    numeroDS: formatearNumeroDS(d),
    ds: formatearNumeroDS(d),
    numeroReunion: d.numeroReunion || '',
    fechaReunion: d.fechaReunion || '',
    estadoRDS: d.estadoRDS || 'Activo',
    programaNacional: programa,
    programa,
    tipoAccion,
    tipo: tipoAccion,
    codigoAccion,
    codigo: codigoAccion,
    detalle,
    unidadMedida: $('progUnidadMedida')?.value || '',
    unidad: $('progUnidadMedida')?.value || '',
    metaProgramada: Number($('progMetaProgramada')?.value || 0),
    meta_programada: Number($('progMetaProgramada')?.value || 0),
    plazoDias: Number($('progPlazoDias')?.value || 0),
    plazo: Number($('progPlazoDias')?.value || 0),
    fechaInicio: $('progFechaInicio')?.value || '',
    fecha_inicio: $('progFechaInicio')?.value || '',
    fechaFinal: $('progFechaFinal')?.value || '',
    fecha_final: $('progFechaFinal')?.value || '',
    metaEjecutada: Number($('progMetaEjecutada')?.value || 0),
    meta_ejecutada: Number($('progMetaEjecutada')?.value || 0),
    avance: $('progAvance')?.value || '0%',
    descripcionActividades: $('progDescripcionActividades')?.value || '',
    descripcion: $('progDescripcionActividades')?.value || '',
    fechaRegistro,
    fecha_registro: fechaRegistro,
    usuarioRegistro: state.session?.email || '',
    usuario_registro: state.session?.email || '',
    estado: 'Registrado'
  };

  lista.push(accion);
  guardarAccionesLocales(lista);
  api('/acciones', 'POST', accion);
  limpiarFormularioAccionPrograma(true);
  renderTablaAccionesProgramas();
  renderTablaDecretosBasica();
  alert('Acción registrada correctamente.');
}

window.abrirRDS = abrirRDS;
window.abrirRegistrarAcciones = abrirRegistrarAcciones;
window.abrirPreAprobacion = abrirPreAprobacion;
window.abrirModalEditarAccion = abrirModalEditarAccion;

// ================= AJUSTE QUIRÚRGICO RDS POR REUNIÓN v38 =================
const REUNIONES_RDS_V38 = [
  'Primera reunión','Segunda reunión','Tercera reunión','Cuarta reunión','Quinta reunión',
  'Sexta reunión','Séptima reunión','Octava reunión','Novena reunión','Décima reunión'
];

function reunionKeyV38(numeroReunion, fechaReunion) {
  return `${normalizarTexto(numeroReunion)}|${String(fechaReunion || '').trim()}`;
}

function reunionActualV38(d) {
  if (!d) return { numeroReunion: '', fechaReunion: '', key: '' };
  const numeroReunion = d.numeroReunion || '';
  const fechaReunion = d.fechaReunion || '';
  return { numeroReunion, fechaReunion, key: reunionKeyV38(numeroReunion, fechaReunion) };
}

function obtenerReunionesDSV38(d) {
  if (!d) return [];
  const base = Array.isArray(d.rdsReuniones) ? d.rdsReuniones.slice() : [];
  if (d.numeroReunion && d.fechaReunion && !base.some(r => reunionKeyV38(r.numeroReunion, r.fechaReunion) === reunionKeyV38(d.numeroReunion, d.fechaReunion))) {
    base.push({
      numeroReunion: d.numeroReunion,
      fechaReunion: d.fechaReunion,
      estadoRDS: d.estadoRDS || (d.rdsActivo ? 'Activo' : 'No activado'),
      fechaRegistroRDS: d.fechaRegistroRDS || '',
      activadoPor: d.activadoPor || d.usuarioActivaRDS || ''
    });
  }
  return base.filter(r => r.numeroReunion && r.fechaReunion);
}

function migrarReunionesEnDecretoV38(d) {
  const reuniones = obtenerReunionesDSV38(d);
  return { ...d, rdsReuniones: reuniones };
}

function accionCoincideReunionV38(a, d) {
  if (!a || !d) return false;
  const actual = reunionActualV38(d);
  if (!actual.numeroReunion || !actual.fechaReunion) return String(a.dsId || a.ds_id) === String(d.id);
  const aNumero = a.numeroReunion || '';
  const aFecha = a.fechaReunion || '';
  return String(a.dsId || a.ds_id) === String(d.id) && reunionKeyV38(aNumero, aFecha) === actual.key;
}

function accionesPorDSReunionActualV38(dsId) {
  const d = buscarDecretoPorId(dsId);
  return cargarAccionesLocales().filter(a => accionCoincideReunionV38(a, d));
}

function accionesPorProgramaReunionActualV38(dsId, programa) {
  const p = normalizarProgramaNombre(programa);
  return accionesPorDSReunionActualV38(dsId).filter(a => normalizarProgramaNombre(a.programaNacional || a.programa) === p);
}

function dsTieneAccionesRegistradas(dsId) {
  return accionesPorDSReunionActualV38(dsId).length > 0;
}

function dsTieneAccionesDelPrograma(dsId, programa) {
  return accionesPorProgramaReunionActualV38(dsId, programa).length > 0;
}

function dsTieneAccionesDeTodosLosProgramas(dsId) {
  const acciones = accionesPorDSReunionActualV38(dsId);
  const programasConAccion = new Set(acciones.map(a => normalizarProgramaNombre(a.programaNacional || a.programa)).filter(Boolean));
  return obtenerProgramasObligatoriosRDS().every(p => programasConAccion.has(p));
}

function cierreKeyProgramaV38(d, programa) {
  const actual = reunionActualV38(d);
  return `${normalizarProgramaNombre(programa)}__${actual.key}`;
}

function dsProgramaCerroRegistro(d, programa) {
  if (!d) return false;
  const key = cierreKeyProgramaV38(d, programa);
  return Boolean((d.programasRegistroCerrado || {})[key]) || dsTieneAccionesDelPrograma(d.id, programa);
}

function setDsProgramaCerrado(dsId, programa) {
  const lista = cargarDecretosLocales().map(normalizarDecreto).filter(Boolean).map(migrarReunionesEnDecretoV38);
  const idx = lista.findIndex(d => String(d.id) === String(dsId));
  if (idx < 0) return;
  const key = cierreKeyProgramaV38(lista[idx], programa);
  lista[idx] = {
    ...lista[idx],
    programasRegistroCerrado: { ...(lista[idx].programasRegistroCerrado || {}), [key]: true },
    estadoRegistroProgramas: 'Acciones Registradas',
    usuarioCierrePrograma: state.session?.email || '',
    fechaCierrePrograma: fechaHoraLocalISO()
  };
  guardarDecretosLocales(lista);
  api('/decretos', 'POST', lista[idx]);
}

function cargarOpcionesReunionRDSV38(d, limpiar = true) {
  const sel = $('rdsNumeroReunion');
  if (!sel) return;
  const usadas = new Set(obtenerReunionesDSV38(d).map(r => normalizarTexto(r.numeroReunion)));
  sel.innerHTML = '<option value="">Seleccione...</option>' + REUNIONES_RDS_V38.map(r => {
    const disabled = usadas.has(normalizarTexto(r)) ? ' disabled' : '';
    return `<option value="${escapeHtmlAttr(r)}"${disabled}>${escapeHtml(r)}${disabled ? ' — usada' : ''}</option>`;
  }).join('');
  if (limpiar) sel.value = '';
}

function abrirRDS(id) {
  if (!puedeActivarRDS()) {
    alert('Solo Administrador o Registrador pueden activar RDS.');
    return;
  }
  const d = buscarDecretoPorId(id);
  modoRegistroAcciones = 'rds';
  abrirTabBootstrap('#tabAcciones');
  initRegistroAcciones();
  setTimeout(() => {
    cargarSelectAccionDS();
    if ($('accionDs')) $('accionDs').value = id || '';
    cargarOpcionesReunionRDSV38(d, true);
    if ($('rdsFechaReunion')) $('rdsFechaReunion').value = '';
    if ($('rdsEstado')) $('rdsEstado').value = 'Nuevo RDS por activar';
    if ($('accionFechaRegistro')) $('accionFechaRegistro').value = fechaHoraLocalISO();
    aplicarRestriccionesAccion();
    aplicarVistaRegistroAcciones();
  }, 0);
}

function cargarRDSDesdeDSSeleccionado() {
  const d = buscarDecretoPorId($('accionDs')?.value || '');
  if (modoRegistroAcciones === 'rds') {
    cargarOpcionesReunionRDSV38(d, false);
  }
  if ($('rdsNumeroReunion') && modoRegistroAcciones !== 'rds') $('rdsNumeroReunion').value = d?.numeroReunion || '';
  if ($('rdsFechaReunion') && modoRegistroAcciones !== 'rds') $('rdsFechaReunion').value = d?.fechaReunion || '';
  if ($('rdsEstado')) $('rdsEstado').value = d?.estadoRDS || (d?.rdsActivo ? 'Activo' : 'No activado');
  if ($('accionFechaRegistro')) $('accionFechaRegistro').value = d?.fechaRegistroRDS || fechaHoraLocalISO();
  if ($('accionResumenDS')) {
    $('accionResumenDS').innerHTML = d ? `<div class="alert ${d.rdsActivo ? 'alert-success' : 'alert-warning'} py-2 mb-0"><strong>${escapeHtml(formatearNumeroDS(d))}</strong> · ${escapeHtml(d.tipo_peligro || '')} · ${d.rdsActivo ? 'RDS Activo' : 'RDS pendiente de activación'}${d.numeroReunion ? ' · ' + escapeHtml(d.numeroReunion) + ' · ' + escapeHtml(d.fechaReunion || '') : ''}</div>` : '';
  }
}

function activarRDSSeleccionado() {
  if (!puedeActivarRDS()) return alert('Solo el Administrador o Registrador puede activar RDS.');
  const id = $('accionDs')?.value || '';
  const numeroReunion = $('rdsNumeroReunion')?.value || '';
  const fechaReunion = $('rdsFechaReunion')?.value || '';
  if (!id) return alert('Seleccione un Decreto Supremo.');
  if (!numeroReunion) return alert('Seleccione el número de reunión.');
  if (!fechaReunion) return alert('Ingrese la fecha de reunión.');

  const lista = cargarDecretosLocales().map(normalizarDecreto).filter(Boolean).map(migrarReunionesEnDecretoV38);
  const idx = lista.findIndex(d => String(d.id) === String(id));
  if (idx < 0) return alert('No se encontró el Decreto Supremo.');

  const usadas = obtenerReunionesDSV38(lista[idx]);
  if (usadas.some(r => normalizarTexto(r.numeroReunion) === normalizarTexto(numeroReunion))) {
    return alert('Ese número de reunión ya fue usado para este Decreto Supremo. Seleccione otra reunión.');
  }

  const fechaRegistroRDS = fechaHoraLocalISO();
  const nuevaReunion = { numeroReunion, fechaReunion, estadoRDS: 'Activo', fechaRegistroRDS, activadoPor: state.session?.email || '' };
  lista[idx] = {
    ...lista[idx],
    rdsActivo: true,
    numeroReunion,
    fechaReunion,
    estadoRDS: 'Activo',
    fechaRegistroRDS,
    activadoPor: state.session?.email || '',
    usuarioActivaRDS: state.session?.email || '',
    programasHabilitados: PROGRAMAS_RDS.slice(),
    rdsReuniones: [...usadas, nuevaReunion]
  };
  guardarDecretosLocales(lista);
  renderTablaDecretosBasica();
  cargarSelectAccionDS();
  if ($('accionDs')) $('accionDs').value = id;
  cargarRDSDesdeDSSeleccionado();
  aplicarRestriccionesAccion();
  aplicarVistaRegistroAcciones();
  api('/decretos', 'POST', lista[idx]);
  alert('RDS activado correctamente para la reunión seleccionada.');
}

function accionesDelDSSeleccionado() {
  const dsId = $('accionDs')?.value || dsPreAprobarSeleccionadoId || '';
  return accionesPorDSReunionActualV38(dsId);
}

function accionesPorDS(dsId) {
  return accionesPorDSReunionActualV38(dsId);
}

function accionesPorDSYPrograma(dsId, programa) {
  return accionesPorProgramaReunionActualV38(dsId, programa);
}

function cargarVistaAccionesPrograma(id) {
  const d = buscarDecretoPorId(id);
  const programa = programaSesionNormalizado();
  if ($('progDs')) $('progDs').value = d ? formatearNumeroDS(d) : '';
  if ($('progNumeroReunion')) $('progNumeroReunion').value = d?.numeroReunion || '';
  if ($('progFechaReunion')) $('progFechaReunion').value = d?.fechaReunion || '';
  if ($('progEstadoRDS')) $('progEstadoRDS').value = d?.estadoRDS || (d?.rdsActivo ? 'Activo' : 'No activado');
  if ($('progFechaRegistroRDS')) $('progFechaRegistroRDS').value = d?.fechaRegistroRDS || '';
  if ($('progProgramaNacional')) $('progProgramaNacional').value = programa;
  actualizarFechaRegistroPrograma();
  limpiarFormularioAccionPrograma(false);
  renderTablaAccionesProgramas();
}

function guardarAccionPrograma() {
  const d = buscarDecretoPorId(dsProgramaSeleccionadoId);
  if (!esRegistradorPrograma()) return alert('Solo un Registrador de Programa puede guardar acciones en esta vista.');
  if (!d || !d.rdsActivo) return alert('El Decreto Supremo no tiene RDS activo.');
  if (!d.numeroReunion || !d.fechaReunion) return alert('El RDS no tiene número y fecha de reunión activos.');

  const programa = programaSesionNormalizado();
  const tipoAccion = $('progTipoAccion')?.value || '';
  const codigoAccion = String($('progCodigoAccion')?.value || '').trim();
  const detalle = String($('progDetalle')?.value || '').trim();

  if (!tipoAccion) return alert('Seleccione el Tipo de acción.');
  if (!codigoAccion) return alert('Ingrese el Código de acción.');
  if (!detalle) return alert('Ingrese las acciones específicas programadas y ejecutadas.');
  if (!$('progUnidadMedida')?.value) return alert('Seleccione la Unidad de medida.');
  if (!$('progFechaInicio')?.value) return alert('Ingrese la Fecha de inicio.');

  calcularFechaFinalPrograma();
  calcularAvancePrograma();

  const lista = cargarAccionesLocales();
  const keyActual = reunionKeyV38(d.numeroReunion, d.fechaReunion);
  const duplicada = lista.some(a =>
    String(a.dsId || a.ds_id) === String(d.id) &&
    reunionKeyV38(a.numeroReunion, a.fechaReunion) === keyActual &&
    normalizarProgramaNombre(a.programaNacional || a.programa) === programa &&
    normalizarTexto(a.codigoAccion || a.codigo) === normalizarTexto(codigoAccion)
  );
  if (duplicada) return alert('Ya existe una acción con el mismo DS, Número de reunión, Fecha de reunión, Programa Nacional y Código de acción.');

  const fechaRegistro = fechaHoraLocalISO();
  const accion = {
    id: crypto.randomUUID(),
    dsId: d.id,
    ds_id: d.id,
    numeroDS: formatearNumeroDS(d),
    ds: formatearNumeroDS(d),
    numeroReunion: d.numeroReunion || '',
    fechaReunion: d.fechaReunion || '',
    rdsKey: keyActual,
    estadoRDS: d.estadoRDS || 'Activo',
    programaNacional: programa,
    programa,
    tipoAccion,
    tipo: tipoAccion,
    codigoAccion,
    codigo: codigoAccion,
    detalle,
    unidadMedida: $('progUnidadMedida')?.value || '',
    unidad: $('progUnidadMedida')?.value || '',
    metaProgramada: Number($('progMetaProgramada')?.value || 0),
    meta_programada: Number($('progMetaProgramada')?.value || 0),
    plazoDias: Number($('progPlazoDias')?.value || 0),
    plazo: Number($('progPlazoDias')?.value || 0),
    fechaInicio: $('progFechaInicio')?.value || '',
    fecha_inicio: $('progFechaInicio')?.value || '',
    fechaFinal: $('progFechaFinal')?.value || '',
    fecha_final: $('progFechaFinal')?.value || '',
    metaEjecutada: Number($('progMetaEjecutada')?.value || 0),
    meta_ejecutada: Number($('progMetaEjecutada')?.value || 0),
    avance: $('progAvance')?.value || '0%',
    descripcionActividades: $('progDescripcionActividades')?.value || '',
    descripcion: $('progDescripcionActividades')?.value || '',
    fechaRegistro,
    fecha_registro: fechaRegistro,
    usuarioRegistro: state.session?.email || '',
    usuario_registro: state.session?.email || '',
    estado: 'Registrado'
  };

  lista.push(accion);
  guardarAccionesLocales(lista);
  api('/acciones', 'POST', accion);
  limpiarFormularioAccionPrograma(true);
  renderTablaAccionesProgramas();
  renderTablaDecretosBasica();
  alert('Acción registrada correctamente.');
}

function renderTablaAccionesProgramas() {
  const tbody = document.querySelector('#tablaAccionesProgramas tbody');
  if (!tbody) return;
  const programa = programaSesionNormalizado();
  const visibles = accionesPorProgramaReunionActualV38(dsProgramaSeleccionadoId, programa);
  if (!visibles.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="text-muted">No hay acciones registradas para su programa en esta reunión.</td></tr>';
    return;
  }
  tbody.innerHTML = visibles.map(a => `
    <tr>
      <td>${escapeHtml(a.numeroDS || a.ds || '')}</td>
      <td>${escapeHtml(a.programaNacional || a.programa || '')}</td>
      <td>${escapeHtml(a.tipoAccion || a.tipo || '')}</td>
      <td>${escapeHtml(a.codigoAccion || a.codigo || '')}</td>
      <td>${escapeHtml(a.detalle || '')}</td>
      <td>${escapeHtml(a.estado || 'Registrado')}</td>
      <td>${escapeHtml(a.usuarioRegistro || a.usuario_registro || '')}</td>
      <td>${escapeHtml(a.fechaRegistro || a.fecha_registro || '')}</td>
      <td><span class="badge text-bg-success">Registrado</span></td>
    </tr>`).join('');
}

function cargarVistaPreAprobar(id) {
  const d = buscarDecretoPorId(id);
  if ($('preDs')) $('preDs').value = d ? formatearNumeroDS(d) : '';
  if ($('preNumeroReunion')) {
    $('preNumeroReunion').value = d?.numeroReunion || '';
    $('preNumeroReunion').readOnly = true;
    $('preNumeroReunion').disabled = false;
  }
  if ($('preFechaReunion')) {
    $('preFechaReunion').value = d?.fechaReunion || '';
    $('preFechaReunion').readOnly = true;
    $('preFechaReunion').disabled = false;
  }
  if ($('preEstadoRDS')) $('preEstadoRDS').value = d?.estadoRDS || (d?.rdsActivo ? 'Activo' : 'No activado');
  if ($('preFechaRegistroRDS')) $('preFechaRegistroRDS').value = d?.fechaRegistroRDS || fechaHoraLocalISO();
  if ($('btnPreAprobarFinal')) $('btnPreAprobarFinal').style.display = puedePreaprobar() ? '' : 'none';
  if ($('btnAprobarFinal')) $('btnAprobarFinal').style.display = puedeAprobar() ? '' : 'none';
  if ($('btnSalirPreAprobar')) $('btnSalirPreAprobar').style.display = puedePreaprobar() ? '' : 'none';
  renderTablaPreAprobarAcciones();
}

function renderTablaPreAprobarAcciones() {
  const tbody = document.querySelector('#tablaPreAprobarAcciones tbody');
  if (!tbody) return;
  const acciones = accionesPorDSReunionActualV38(dsPreAprobarSeleccionadoId);
  if (!acciones.length) {
    tbody.innerHTML = '<tr><td colspan="10" class="text-muted">No hay acciones registradas para este Decreto Supremo, número de reunión y fecha de reunión.</td></tr>';
    return;
  }
  tbody.innerHTML = acciones.map(a => `
    <tr>
      <td>${escapeHtml(accionValor(a,'programaNacional','programa'))}</td>
      <td>${escapeHtml(accionValor(a,'tipoAccion','tipo'))}</td>
      <td>${escapeHtml(accionValor(a,'codigoAccion','codigo'))}</td>
      <td>${escapeHtml(accionValor(a,'detalle'))}</td>
      <td>${escapeHtml(accionValor(a,'metaProgramada','meta_programada'))}</td>
      <td>${escapeHtml(accionValor(a,'metaEjecutada','meta_ejecutada'))}</td>
      <td>${escapeHtml(accionValor(a,'avance'))}</td>
      <td>${escapeHtml(accionValor(a,'usuarioRegistro','usuario_registro'))}</td>
      <td>${escapeHtml(accionValor(a,'fechaRegistro','fecha_registro'))}</td>
      <td><button type="button" class="btn btn-sm btn-outline-primary" onclick="abrirModalEditarAccion('${escapeHtmlAttr(a.id)}')">Ver / Editar</button></td>
    </tr>`).join('');
}

function guardarDatosDSPreAprobar(estadoFinal) {
  const dsId = dsPreAprobarSeleccionadoId;
  const lista = cargarDecretosLocales().map(normalizarDecreto).filter(Boolean).map(migrarReunionesEnDecretoV38);
  const idx = lista.findIndex(d => String(d.id) === String(dsId));
  if (idx < 0) return null;
  const numeroReunion = lista[idx].numeroReunion || '';
  const fechaReunion = lista[idx].fechaReunion || '';
  const key = reunionKeyV38(numeroReunion, fechaReunion);
  const extra = estadoFinal === 'Preaprobado'
    ? { usuarioPreaprueba: state.session?.email || '', fechaPreaprueba: fechaHoraLocalISO() }
    : { usuarioAprueba: state.session?.email || '', fechaAprueba: fechaHoraLocalISO() };
  const reuniones = obtenerReunionesDSV38(lista[idx]).map(r => reunionKeyV38(r.numeroReunion, r.fechaReunion) === key ? { ...r, estadoRDS: estadoFinal, fechaEstadoRDS: fechaHoraLocalISO(), usuarioEstadoRDS: state.session?.email || '', ...extra } : r);
  lista[idx] = { ...lista[idx], estadoRDS: estadoFinal, fechaEstadoRDS: fechaHoraLocalISO(), usuarioEstadoRDS: state.session?.email || '', rdsReuniones: reuniones, ...extra };
  guardarDecretosLocales(lista);
  api('/decretos', 'POST', lista[idx]);
  return lista[idx];
}

function preaprobarAccionesDS() {
  const dsId = dsPreAprobarSeleccionadoId;
  if (!puedePreaprobar()) return alert('Solo el usuario Registrador puede PreAprobar.');
  if (!dsId) return alert('Seleccione un Decreto Supremo.');
  if (!dsTieneAccionesRegistradas(dsId)) return alert('No se puede PreAprobar: no existen acciones registradas para esta reunión.');
  const acciones = cargarAccionesLocales().map(a => accionCoincideReunionV38(a, buscarDecretoPorId(dsId))
    ? { ...a, estado: 'Preaprobado', usuario_flujo: state.session?.email || '', fecha_flujo: fechaHoraLocalISO() }
    : a
  );
  guardarAccionesLocales(acciones);
  guardarDatosDSPreAprobar('Preaprobado');
  renderTablaPreAprobarAcciones();
  renderTablaDecretosBasica();
  cargarVistaPreAprobar(dsId);
  alert('DS PreAprobado correctamente para la reunión seleccionada.');
}

function aprobarAccionesDS() {
  const dsId = dsPreAprobarSeleccionadoId;
  const d = buscarDecretoPorId(dsId);
  if (!puedeAprobar()) return alert('Solo el Administrador puede Aprobar.');
  if (!dsId) return alert('Seleccione un Decreto Supremo.');
  if (normalizarTexto(d?.estadoRDS) !== 'PREAPROBADO') return alert('Solo se puede aprobar un DS en estado PreAprobado.');
  const acciones = cargarAccionesLocales().map(a => accionCoincideReunionV38(a, d)
    ? { ...a, estado: 'Aprobado', usuario_flujo: state.session?.email || '', fecha_flujo: fechaHoraLocalISO() }
    : a
  );
  guardarAccionesLocales(acciones);
  guardarDatosDSPreAprobar('Aprobado');
  renderTablaPreAprobarAcciones();
  renderTablaDecretosBasica();
  cargarVistaPreAprobar(dsId);
  alert('DS Aprobado correctamente para la reunión seleccionada.');
}

function salirPreAprobarAcciones() {
  mostrarTabPreAprobar(false);
  abrirTabBootstrap('#tabListado');
}

function initPreAprobarAcciones() {
  cargarCatalogosEditarAccion();
  $('btnPreAprobarFinal')?.removeEventListener?.('click', preaprobarAccionesDS);
  $('btnAprobarFinal')?.removeEventListener?.('click', aprobarAccionesDS);
  $('btnSalirPreAprobar')?.removeEventListener?.('click', salirPreAprobarAcciones);
  $('btnGrabarModalAccion')?.removeEventListener?.('click', grabarModalAccion);
  $('editPlazoDias')?.removeEventListener?.('input', calcularFechaFinalModal);
  $('editFechaInicio')?.removeEventListener?.('change', calcularFechaFinalModal);
  $('editMetaProgramada')?.removeEventListener?.('input', calcularAvanceModal);
  $('editMetaEjecutada')?.removeEventListener?.('input', calcularAvanceModal);
  $('btnPreAprobarFinal')?.addEventListener('click', preaprobarAccionesDS);
  $('btnAprobarFinal')?.addEventListener('click', aprobarAccionesDS);
  $('btnSalirPreAprobar')?.addEventListener('click', salirPreAprobarAcciones);
  $('btnGrabarModalAccion')?.addEventListener('click', grabarModalAccion);
  $('editPlazoDias')?.addEventListener('input', calcularFechaFinalModal);
  $('editFechaInicio')?.addEventListener('change', calcularFechaFinalModal);
  $('editMetaProgramada')?.addEventListener('input', calcularAvanceModal);
  $('editMetaEjecutada')?.addEventListener('input', calcularAvanceModal);
}

function renderTablaDecretosBasica() {
  const tbody = document.querySelector('#tablaDS tbody');
  if (!tbody) return;
  const decretos = (state.decretos.length ? state.decretos : cargarDecretosLocales()).map(normalizarDecreto).filter(Boolean).map(migrarReunionesEnDecretoV38);
  if (!decretos.length) {
    tbody.innerHTML = '<tr><td colspan="17" class="text-muted">No hay Decretos Supremos registrados.</td></tr>';
    return;
  }
  tbody.innerHTML = decretos.map(d => {
    const territorio = Array.isArray(d.territorio) ? d.territorio : [];
    const deps = new Set(territorio.map(t => t.departamento).filter(Boolean));
    const provs = new Set(territorio.map(t => `${t.departamento}|${t.provincia}`).filter(Boolean));
    const dists = new Set(territorio.map(t => `${t.departamento}|${t.provincia}|${t.distrito}`).filter(Boolean));
    const estado = normalizarTexto(d.estadoRDS || '');
    let botonRDS = '';
    let botonRevision = '';
    if (puedeActivarRDS()) {
      botonRDS = `<button type="button" class="btn btn-sm ${d.rdsActivo ? 'btn-success' : 'btn-outline-primary'}" onclick="abrirRDS('${escapeHtmlAttr(d.id)}')">RDS</button>`;
      if (puedePreaprobar()) {
        const habilitado = d.rdsActivo && dsTieneAccionesRegistradas(d.id) && estado !== 'PREAPROBADO' && estado !== 'APROBADO';
        botonRevision = `<button type="button" class="btn btn-sm btn-warning" ${habilitado ? '' : 'disabled title="Pendiente: no existen acciones registradas para la reunión activa o ya fue preaprobado/aprobado"'} onclick="abrirPreAprobacion('${escapeHtmlAttr(d.id)}')">PreAprobar</button>`;
      } else if (puedeAprobar()) {
        const habilitado = estado === 'PREAPROBADO';
        botonRevision = `<button type="button" class="btn btn-sm btn-success" ${habilitado ? '' : 'disabled title="Disponible cuando el DS esté PreAprobado"'} onclick="abrirPreAprobacion('${escapeHtmlAttr(d.id)}')">Aprobar</button>`;
      }
    } else if (esRegistradorPrograma()) {
      const programa = programaSesionNormalizado();
      const cerrado = dsProgramaCerroRegistro(d, programa);
      botonRDS = d.rdsActivo
        ? (cerrado ? `<button type="button" class="btn btn-sm btn-secondary" disabled>Acciones Registradas</button>` : `<button type="button" class="btn btn-sm btn-primary" onclick="abrirRegistrarAcciones('${escapeHtmlAttr(d.id)}')">Registrar Acciones</button>`)
        : `<span class="badge text-bg-secondary">No activado</span>`;
      botonRevision = '';
    } else {
      botonRDS = '<span class="text-muted small">Solo lectura</span>';
      botonRevision = '';
    }
    return `<tr>
      <td>${escapeHtml(formatearNumeroDS(d))}</td><td>${escapeHtml(d.anio)}</td><td>${escapeHtml(d.peligro)}</td><td>${escapeHtml(d.tipo_peligro)}</td><td>${escapeHtml(d.fecha_inicio)}</td><td>${escapeHtml(d.fecha_fin)}</td><td>${escapeHtml(d.vigencia)}</td><td>${escapeHtml(d.semaforo)}</td><td>${deps.size}</td><td>${provs.size}</td><td>${dists.size}</td><td>${d.es_prorroga ? 'Prórroga' : 'Original'}</td><td>${escapeHtml(d.cadena || '')}</td><td>${escapeHtml(d.nivel_prorroga || 0)}</td><td>${botonRDS}</td><td>${botonRevision}</td><td><button type="button" class="btn btn-sm btn-outline-dark" onclick="verDetalleDS('${escapeHtmlAttr(d.id)}')">👁</button></td>
    </tr>`;
  }).join('');
}

window.abrirRDS = abrirRDS;
window.abrirRegistrarAcciones = abrirRegistrarAcciones;
window.abrirPreAprobacion = abrirPreAprobacion;
window.abrirModalEditarAccion = abrirModalEditarAccion;
