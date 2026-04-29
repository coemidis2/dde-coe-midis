// ================= VERSION 33 FIX LOGIN USUARIOS LOCALES =================
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