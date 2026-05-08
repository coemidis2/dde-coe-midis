// ================= VERSION 53 FIX LOGIN USUARIOS LOCALES =================
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

// ================= CIERRE FINAL v39 - DASHBOARD EJECUTIVO Y CONTROL PREAPROBAR =================
(function cierreFinalDashboardEjecutivoV39(){
  const DASH_COLORS = ['#0d6efd','#198754','#dc3545','#fd7e14','#6f42c1','#20c997','#0dcaf0','#6610f2','#d63384','#ffc107','#6c757d','#2f5597','#70ad47','#c00000','#7030a0'];
  let mapaDashboardDEE = null;
  let capaDashboardDEE = null;

  function inyectarEstilosDashboardDEE() {
    if (document.getElementById('dashboardDEEStyles')) return;
    const style = document.createElement('style');
    style.id = 'dashboardDEEStyles';
    style.textContent = `
      .dee-kpi-card{background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:16px;box-shadow:0 3px 12px rgba(15,23,42,.06);height:100%}
      .dee-kpi-number{font-size:2.15rem;font-weight:800;line-height:1;color:#1F4E79}
      .dee-kpi-label{font-size:.86rem;color:#475569;margin-top:8px;font-weight:600}
      .dee-kpi-note{font-size:.74rem;color:#64748b;margin-top:4px}
      .dee-badge-rojo{background:#dc3545;color:#fff}
      .dee-badge-ambar{background:#ffc107;color:#111}
      .dee-badge-verde{background:#198754;color:#fff}
      .dee-dashboard-empty{color:#64748b;font-size:.88rem;padding:10px}
    `;
    document.head.appendChild(style);
  }

  function fechaLocalCero(valor) {
    if (!valor) return null;
    const s = String(valor).slice(0, 10);
    const d = new Date(`${s}T00:00:00`);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function hoyLocalCeroDEE() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function esDSVigenteDEE(d) {
    const hoy = hoyLocalCeroDEE();
    const inicio = fechaLocalCero(d?.fecha_inicio || d?.fechaInicio);
    const fin = fechaLocalCero(d?.fecha_fin || d?.fechaFin);
    if (!fin) return false;
    if (inicio && hoy < inicio) return false;
    return hoy <= fin;
  }

  function diasRestantesDEE(d) {
    const fin = fechaLocalCero(d?.fecha_fin || d?.fechaFin);
    if (!fin) return 0;
    return Math.max(0, Math.ceil((fin - hoyLocalCeroDEE()) / 86400000));
  }

  function avanceTiempoDEE(d) {
    const inicio = fechaLocalCero(d?.fecha_inicio || d?.fechaInicio);
    const fin = fechaLocalCero(d?.fecha_fin || d?.fechaFin);
    const hoy = hoyLocalCeroDEE();
    if (!inicio || !fin || fin <= inicio) return 0;
    const total = fin - inicio;
    const usado = Math.min(Math.max(hoy - inicio, 0), total);
    return Math.round((usado / total) * 100);
  }

  function semaforoEjecutivoDEE(d) {
    const inicio = fechaLocalCero(d?.fecha_inicio || d?.fechaInicio);
    const fin = fechaLocalCero(d?.fecha_fin || d?.fechaFin);
    const hoy = hoyLocalCeroDEE();
    if (!inicio || !fin || fin <= inicio) return { texto: 'Rojo', clase: 'dee-badge-rojo', orden: 1 };
    const restante = Math.max(fin - hoy, 0);
    const total = fin - inicio;
    const pctRestante = (restante / total) * 100;
    if (pctRestante < 20) return { texto: 'Rojo', clase: 'dee-badge-rojo', orden: 1 };
    if (pctRestante <= 50) return { texto: 'Ámbar', clase: 'dee-badge-ambar', orden: 2 };
    return { texto: 'Verde', clase: 'dee-badge-verde', orden: 3 };
  }

  function territorioDSDEE(d) {
    return Array.isArray(d?.territorio) ? d.territorio : [];
  }

  function keyDepartamentoDEE(t) {
    return normalizarTexto(t?.departamento || '');
  }

  function keyProvinciaDEE(t) {
    return `${normalizarTexto(t?.departamento || '')}|${normalizarTexto(t?.provincia || '')}`;
  }

  function keyDistritoDEE(t) {
    const ub = getUbigeoValue(t);
    if (ub) return String(ub);
    return `${normalizarTexto(t?.departamento || '')}|${normalizarTexto(t?.provincia || '')}|${normalizarTexto(t?.distrito || '')}`;
  }

  function latLngTerritorioDEE(t) {
    const lat = Number(String(getLatitud(t)).replace(',', '.'));
    const lng = Number(String(getLongitud(t)).replace(',', '.'));
    if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return [lat, lng];
    return null;
  }

  function construirDatosDashboardDEE() {
    const decretos = (state.decretos?.length ? state.decretos : cargarDecretosLocales())
      .map(normalizarDecreto)
      .filter(Boolean);
    const vigentes = decretos.filter(esDSVigenteDEE);
    const departamentos = new Set();
    const provincias = new Set();
    const distritos = new Map();
    const departamentosConteo = new Map();

    vigentes.forEach((d, i) => {
      territorioDSDEE(d).forEach(t => {
        const depKey = keyDepartamentoDEE(t);
        const provKey = keyProvinciaDEE(t);
        const distKey = keyDistritoDEE(t);
        if (!depKey || !provKey || !distKey) return;
        departamentos.add(depKey);
        provincias.add(provKey);
        departamentosConteo.set(depKey, (departamentosConteo.get(depKey) || 0) + 1);
        if (!distritos.has(distKey)) {
          distritos.set(distKey, {
            key: distKey,
            departamento: t.departamento || '',
            provincia: t.provincia || '',
            distrito: t.distrito || '',
            latlng: latLngTerritorioDEE(t),
            decretos: [],
            fechasInicio: [],
            fechasFin: []
          });
        }
        const item = distritos.get(distKey);
        item.decretos.push({ id: d.id, nombre: formatearNumeroDS(d), color: DASH_COLORS[i % DASH_COLORS.length] });
        if (d.fecha_inicio) item.fechasInicio.push(String(d.fecha_inicio).slice(0,10));
        if (d.fecha_fin) item.fechasFin.push(String(d.fecha_fin).slice(0,10));
      });
    });

    return { decretos, vigentes, departamentos, provincias, distritos, departamentosConteo };
  }

  function renderKPIsDEE(datos) {
    const cont = $('dashboardMetricas');
    if (!cont) return;
    const repetidos = [...datos.distritos.values()].filter(x => new Set(x.decretos.map(d => d.id)).size > 1).length;
    const cards = [
      ['Declaratorias vigentes', datos.vigentes.length, 'Solo DS con fecha actual dentro del rango'],
      ['Departamentos declarados', datos.departamentos.size, 'Sin duplicados'],
      ['Provincias declaradas', datos.provincias.size, 'Sin duplicados'],
      ['Distritos declarados', datos.distritos.size, 'Sin duplicados'],
      ['Distritos en más de una declaratoria', repetidos, 'Duplicidad entre DS vigentes']
    ];
    cont.innerHTML = cards.map(([label, value, note]) => `
      <div class="col-12 col-md-6">
        <div class="dee-kpi-card">
          <div class="dee-kpi-number">${escapeHtml(value)}</div>
          <div class="dee-kpi-label">${escapeHtml(label)}</div>
          <div class="dee-kpi-note">${escapeHtml(note)}</div>
        </div>
      </div>`).join('');
  }

  function renderMapaDEE(datos) {
    const el = $('mapaDS');
    if (!el || !window.L) return;
    if (!mapaDashboardDEE) {
      mapaDashboardDEE = L.map(el, { scrollWheelZoom: true }).setView([-9.19, -75.02], 5);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 18,
        attribution: '&copy; OpenStreetMap'
      }).addTo(mapaDashboardDEE);
      capaDashboardDEE = L.layerGroup().addTo(mapaDashboardDEE);
    }
    capaDashboardDEE.clearLayers();
    const bounds = [];
    [...datos.distritos.values()].forEach(item => {
      if (!item.latlng) return;
      const dsUnicos = [...new Map(item.decretos.map(d => [d.id, d])).values()];
      const repetido = dsUnicos.length > 1;
      const color = repetido ? '#111827' : (dsUnicos[0]?.color || '#0d6efd');
      const marker = L.circleMarker(item.latlng, {
        radius: repetido ? 7 : 5,
        color: repetido ? '#000000' : color,
        weight: repetido ? 3 : 1,
        fillColor: color,
        fillOpacity: repetido ? 0.95 : 0.75
      });
      marker.bindTooltip(`
        <strong>${escapeHtml(item.distrito)}</strong><br>
        Provincia: ${escapeHtml(item.provincia)}<br>
        Departamento: ${escapeHtml(item.departamento)}<br>
        DS: ${escapeHtml(dsUnicos.map(d => d.nombre).join(', '))}
      `, { sticky: true });
      marker.addTo(capaDashboardDEE);
      bounds.push(item.latlng);
    });
    if (bounds.length) mapaDashboardDEE.fitBounds(bounds, { padding: [20, 20] });
    setTimeout(() => mapaDashboardDEE?.invalidateSize(), 150);
  }

  function renderResumenDSDEE(datos) {
    const tbody = document.querySelector('#tablaResumenDS tbody');
    if (!tbody) return;
    const filas = datos.vigentes.map(d => {
      const territorio = territorioDSDEE(d);
      const deps = new Set(territorio.map(keyDepartamentoDEE).filter(Boolean));
      const provs = new Set(territorio.map(keyProvinciaDEE).filter(Boolean));
      const dists = new Set(territorio.map(keyDistritoDEE).filter(Boolean));
      const sem = semaforoEjecutivoDEE(d);
      return { d, deps, provs, dists, sem };
    }).sort((a,b) => a.sem.orden - b.sem.orden || diasRestantesDEE(a.d) - diasRestantesDEE(b.d));
    tbody.innerHTML = filas.length ? filas.map(x => `
      <tr>
        <td>${escapeHtml(formatearNumeroDS(x.d))}</td>
        <td>${escapeHtml(x.d.fecha_inicio || '')}</td>
        <td>${escapeHtml(x.d.fecha_fin || '')}</td>
        <td>${diasRestantesDEE(x.d)}</td>
        <td>${avanceTiempoDEE(x.d)}%</td>
        <td><span class="badge ${x.sem.clase}">${x.sem.texto}</span></td>
        <td>${x.deps.size}</td>
        <td>${x.provs.size}</td>
        <td>${x.dists.size}</td>
      </tr>`).join('') : '<tr><td colspan="9" class="dee-dashboard-empty">No hay declaratorias vigentes registradas.</td></tr>';
  }

  function renderDepartamentosDEE(datos) {
    const tbody = document.querySelector('#tablaDeptos tbody');
    if (!tbody) return;
    const filas = [...datos.departamentosConteo.entries()]
      .map(([key, count]) => ({ departamento: key, count }))
      .sort((a,b) => b.count - a.count || a.departamento.localeCompare(b.departamento, 'es'));
    tbody.innerHTML = filas.length ? filas.map(f => `
      <tr><td>${escapeHtml(f.departamento)}</td><td>${f.count}</td><td><span class="badge text-bg-success">Vigente</span></td></tr>
    `).join('') : '<tr><td colspan="3" class="dee-dashboard-empty">No hay departamentos vigentes registrados.</td></tr>';
  }

  function renderRepetidosDEE(datos) {
    const tbody = document.querySelector('#tablaRepetidos tbody');
    if (!tbody) return;
    const filas = [...datos.distritos.values()]
      .map(item => ({ ...item, veces: new Set(item.decretos.map(d => d.id)).size }))
      .filter(item => item.veces > 1)
      .sort((a,b) => b.veces - a.veces || String(a.departamento).localeCompare(String(b.departamento), 'es'));
    tbody.innerHTML = filas.length ? filas.map(f => `
      <tr>
        <td>${escapeHtml(f.departamento)}</td>
        <td>${escapeHtml(f.provincia)}</td>
        <td>${escapeHtml(f.distrito)}</td>
        <td>${f.veces}</td>
        <td>${escapeHtml(f.fechasInicio.sort()[0] || '')}</td>
        <td>${escapeHtml(f.fechasFin.sort().slice(-1)[0] || '')}</td>
      </tr>`).join('') : '<tr><td colspan="6" class="dee-dashboard-empty">No hay distritos repetidos en declaratorias vigentes.</td></tr>';
  }

  function renderDashboardEjecutivoDEE() {
    try {
      inyectarEstilosDashboardDEE();
      const datos = construirDatosDashboardDEE();
      renderKPIsDEE(datos);
      renderResumenDSDEE(datos);
      renderDepartamentosDEE(datos);
      renderRepetidosDEE(datos);
      renderMapaDEE(datos);
    } catch (e) {
      console.error('Error renderizando Dashboard Ejecutivo:', e);
    }
  }

  function removerPreAprobarLegacyDEE() {
    const btn = $('btnPreaprobarRDS');
    if (btn) btn.remove();
  }

  const apiOriginalDEE = typeof api === 'function' ? api : null;
  if (apiOriginalDEE && !window.__apiControlPreAprobarV39) {
    window.__apiControlPreAprobarV39 = true;
    window.api = async function(path, method = 'GET', body = null) {
      const p = String(path || '').toLowerCase();
      const b = JSON.stringify(body || {}).toLowerCase();
      const intentaPreaprobarLegacy = p.includes('preaprobar') || b.includes('preaprobado') || b.includes('preaprobar');
      if (intentaPreaprobarLegacy && (esAdministrador() || esRegistrador()) && !p.includes('decretos') && !p.includes('acciones')) {
        return { ok: false, data: { ok: false, error: 'forbidden_by_role' } };
      }
      return apiOriginalDEE(path, method, body);
    };
  }

  const aplicarVistaOriginalDEE = typeof aplicarVistaRegistroAcciones === 'function' ? aplicarVistaRegistroAcciones : null;
  if (aplicarVistaOriginalDEE && !window.__vistaRegistroControlPreV39) {
    window.__vistaRegistroControlPreV39 = true;
    window.aplicarVistaRegistroAcciones = function() {
      const r = aplicarVistaOriginalDEE.apply(this, arguments);
      removerPreAprobarLegacyDEE();
      const btnApr = $('btnAprobarRDS');
      if (btnApr) btnApr.style.display = esAdministrador() ? '' : 'none';
      return r;
    };
  }

  const cambiarEstadoOriginalDEE = typeof cambiarEstadoFlujoRDS === 'function' ? cambiarEstadoFlujoRDS : null;
  if (cambiarEstadoOriginalDEE && !window.__estadoControlPreV39) {
    window.__estadoControlPreV39 = true;
    window.cambiarEstadoFlujoRDS = function(nuevoEstado) {
      if (normalizarTexto(nuevoEstado) === 'PREAPROBADO') {
        return alert('La acción PreAprobar no se ejecuta desde la pestaña Registro de Acciones. Use la pestaña PreAprobar Acciones cuando corresponda.');
      }
      return cambiarEstadoOriginalDEE.apply(this, arguments);
    };
  }

  const renderTablaOriginalDEE = typeof renderTablaDecretosBasica === 'function' ? renderTablaDecretosBasica : null;
  if (renderTablaOriginalDEE && !window.__renderDSDashboardV39) {
    window.__renderDSDashboardV39 = true;
    window.renderTablaDecretosBasica = function() {
      const r = renderTablaOriginalDEE.apply(this, arguments);
      removerPreAprobarLegacyDEE();
      renderDashboardEjecutivoDEE();
      return r;
    };
  }

  document.addEventListener('DOMContentLoaded', () => {
    removerPreAprobarLegacyDEE();
    $('btnActualizarDashboard')?.addEventListener('click', renderDashboardEjecutivoDEE);
    document.querySelector('[data-bs-target="#tabDashboard"]')?.addEventListener('shown.bs.tab', renderDashboardEjecutivoDEE);
    document.querySelector('[data-bs-target="#tabDashboard"]')?.addEventListener('click', () => setTimeout(renderDashboardEjecutivoDEE, 150));
    setTimeout(renderDashboardEjecutivoDEE, 800);
  });

  window.renderDashboardEjecutivoDEE = renderDashboardEjecutivoDEE;
})();

// ================= CIERRE FINAL TIPO DE ACCIÓN v40 - 05/05/2026 =================
(function(){
  const TIPO_PREPARACION = 'Acciones de Preparación (Solo DEE por Peligro Inminente)';
  const TIPO_RESPUESTA = 'Acciones de Respuesta';
  const TIPO_REHABILITACION = 'Acciones de Rehabilitación';
  const TIPOS_ACCION_OFICIALES = [TIPO_PREPARACION, TIPO_RESPUESTA, TIPO_REHABILITACION];
  const SUBTIPOS_REHABILITACION_OFICIALES = [
    'RESTABLECIMIENTO DE SERVICIOS PÚBLICOS BÁSICOS E INFRAESTRUCTURA',
    'NORMALIZACIÓN PROGRESIVA DE LOS MEDIOS DE VIDA'
  ];

  function setSelectOptionsDEE(sel, opciones, placeholder = 'Seleccione...') {
    if (!sel) return;
    const actual = sel.value;
    sel.innerHTML = `<option value="">${placeholder}</option>` + opciones.map(v => `<option value="${escapeHtmlAttr(v)}">${escapeHtml(v)}</option>`).join('');
    if (opciones.includes(actual)) sel.value = actual;
  }

  function inyectarSubtipoSiFaltaDEE(tipoId, boxId, selectId, claseCol = 'col-md-4') {
    if ($(selectId)) return;
    const tipo = $(tipoId);
    if (!tipo) return;
    const tipoBox = tipo.closest('.col-md-3, .col-md-4, .col-12') || tipo.parentElement;
    if (!tipoBox || !tipoBox.parentElement) return;
    const div = document.createElement('div');
    div.className = claseCol;
    div.id = boxId;
    div.style.display = 'none';
    div.innerHTML = `<label class="form-label">Subtipo de Rehabilitación</label><select id="${selectId}" class="form-select"></select>`;
    tipoBox.insertAdjacentElement('afterend', div);
  }

  function asegurarCamposSubtipoDEE() {
    inyectarSubtipoSiFaltaDEE('accionTipo', 'accionSubtipoRehabBox', 'accionSubtipoRehabilitacion', 'col-md-4');
    inyectarSubtipoSiFaltaDEE('progTipoAccion', 'progSubtipoRehabBox', 'progSubtipoRehabilitacion', 'col-md-4');
    inyectarSubtipoSiFaltaDEE('editTipoAccion', 'editSubtipoRehabBox', 'editSubtipoRehabilitacion', 'col-md-5');
  }

  function cargarCatalogoTiposDEE() {
    asegurarCamposSubtipoDEE();
    setSelectOptionsDEE($('accionTipo'), TIPOS_ACCION_OFICIALES);
    setSelectOptionsDEE($('progTipoAccion'), TIPOS_ACCION_OFICIALES);
    setSelectOptionsDEE($('editTipoAccion'), TIPOS_ACCION_OFICIALES);
    setSelectOptionsDEE($('accionSubtipoRehabilitacion'), SUBTIPOS_REHABILITACION_OFICIALES);
    setSelectOptionsDEE($('progSubtipoRehabilitacion'), SUBTIPOS_REHABILITACION_OFICIALES);
    setSelectOptionsDEE($('editSubtipoRehabilitacion'), SUBTIPOS_REHABILITACION_OFICIALES);
    actualizarVisibilidadSubtipoDEE('accion');
    actualizarVisibilidadSubtipoDEE('prog');
    actualizarVisibilidadSubtipoDEE('edit');
  }

  function normalTipoDEE(valor) { return String(valor || '').trim(); }
  function esTipoRehabilitacionDEE(valor) { return normalTipoDEE(valor) === TIPO_REHABILITACION; }
  function esTipoPreparacionDEE(valor) { return normalTipoDEE(valor) === TIPO_PREPARACION; }

  function actualizarVisibilidadSubtipoDEE(prefix) {
    const tipo = $(prefix + 'TipoAccion') || (prefix === 'accion' ? $('accionTipo') : prefix === 'prog' ? $('progTipoAccion') : $('editTipoAccion'));
    const box = $(prefix + 'SubtipoRehabBox');
    const sel = $(prefix + 'SubtipoRehabilitacion');
    const visible = esTipoRehabilitacionDEE(tipo?.value || '');
    if (box) box.style.display = visible ? '' : 'none';
    if (sel) {
      sel.disabled = !visible;
      if (!visible) sel.value = '';
    }
  }

  function dsEsPeligroInminenteDEE(d) {
    const texto = normalizarTexto(`${d?.peligro || ''} ${d?.tipo_peligro || ''} ${d?.tipoPeligro || ''}`);
    return texto.includes('PELIGRO INMINENTE');
  }

  function dsActualFormularioAccionDEE() {
    return buscarDecretoPorId($('accionDs')?.value || '') || buscarDecretoPorId(dsProgramaSeleccionadoId || '') || buscarDecretoPorId(dsPreAprobarSeleccionadoId || '');
  }

  function validarTipoAccionDEE({ tipo, subtipo, decreto }) {
    tipo = normalTipoDEE(tipo);
    subtipo = String(subtipo || '').trim();
    if (!TIPOS_ACCION_OFICIALES.includes(tipo)) {
      return { ok:false, msg:'Seleccione un Tipo de Acción válido del catálogo oficial.' };
    }
    if (esTipoPreparacionDEE(tipo) && !dsEsPeligroInminenteDEE(decreto)) {
      return { ok:false, msg:'Las Acciones de Preparación solo pueden registrarse para DEE por Peligro Inminente.' };
    }
    if (esTipoRehabilitacionDEE(tipo)) {
      if (!subtipo) return { ok:false, msg:'Seleccione el Subtipo de Rehabilitación.' };
      if (!SUBTIPOS_REHABILITACION_OFICIALES.includes(subtipo)) {
        return { ok:false, msg:'Seleccione un Subtipo de Rehabilitación válido del catálogo oficial.' };
      }
    }
    if (!esTipoRehabilitacionDEE(tipo) && subtipo) {
      return { ok:false, msg:'El Subtipo de Rehabilitación solo corresponde a Acciones de Rehabilitación.' };
    }
    return { ok:true };
  }

  function validarBodyAccionBackendDEE(body) {
    const tipo = body?.tipoAccion || body?.tipo || body?.tipo_accion || '';
    const subtipo = body?.subtipoRehabilitacion || body?.subtipo_rehabilitacion || '';
    const dsId = body?.dsId || body?.ds_id || dsProgramaSeleccionadoId || dsPreAprobarSeleccionadoId || $('accionDs')?.value || '';
    const decreto = buscarDecretoPorId(dsId);
    return validarTipoAccionDEE({ tipo, subtipo, decreto });
  }

  function marcarPreparacionNoPermitidaDEE(selectId, ds) {
    const sel = $(selectId);
    if (!sel) return;
    const opt = Array.from(sel.options).find(o => o.value === TIPO_PREPARACION);
    if (opt) opt.disabled = !!ds && !dsEsPeligroInminenteDEE(ds);
    if (sel.value === TIPO_PREPARACION && opt?.disabled) {
      sel.value = '';
      alert('Este DS no corresponde a Peligro Inminente. No se puede seleccionar Acciones de Preparación.');
    }
  }

  function refrescarReglasTipoPorDSDEE() {
    cargarCatalogoTiposDEE();
    marcarPreparacionNoPermitidaDEE('accionTipo', buscarDecretoPorId($('accionDs')?.value || ''));
    marcarPreparacionNoPermitidaDEE('progTipoAccion', buscarDecretoPorId(dsProgramaSeleccionadoId || ''));
    marcarPreparacionNoPermitidaDEE('editTipoAccion', buscarDecretoPorId(dsPreAprobarSeleccionadoId || dsProgramaSeleccionadoId || $('accionDs')?.value || ''));
  }

  function attachEventosTipoDEE() {
    if (window.__tipoAccionEventosV40) return;
    window.__tipoAccionEventosV40 = true;
    document.addEventListener('change', (e) => {
      if (e.target?.id === 'accionTipo') { marcarPreparacionNoPermitidaDEE('accionTipo', buscarDecretoPorId($('accionDs')?.value || '')); actualizarVisibilidadSubtipoDEE('accion'); }
      if (e.target?.id === 'progTipoAccion') { marcarPreparacionNoPermitidaDEE('progTipoAccion', buscarDecretoPorId(dsProgramaSeleccionadoId || '')); actualizarVisibilidadSubtipoDEE('prog'); }
      if (e.target?.id === 'editTipoAccion') { marcarPreparacionNoPermitidaDEE('editTipoAccion', buscarDecretoPorId(dsPreAprobarSeleccionadoId || dsProgramaSeleccionadoId || $('accionDs')?.value || '')); actualizarVisibilidadSubtipoDEE('edit'); }
      if (e.target?.id === 'accionDs') setTimeout(refrescarReglasTipoPorDSDEE, 0);
    });
  }

  const cargarCatalogosAccionOriginalV40 = typeof cargarCatalogosAccion === 'function' ? cargarCatalogosAccion : null;
  cargarCatalogosAccion = function() {
    if (cargarCatalogosAccionOriginalV40) cargarCatalogosAccionOriginalV40.apply(this, arguments);
    cargarCatalogoTiposDEE();
  };

  const cargarCatalogosAccionProgramaOriginalV40 = typeof cargarCatalogosAccionPrograma === 'function' ? cargarCatalogosAccionPrograma : null;
  cargarCatalogosAccionPrograma = function() {
    if (cargarCatalogosAccionProgramaOriginalV40) cargarCatalogosAccionProgramaOriginalV40.apply(this, arguments);
    cargarCatalogoTiposDEE();
  };

  const cargarCatalogosEditarAccionOriginalV40 = typeof cargarCatalogosEditarAccion === 'function' ? cargarCatalogosEditarAccion : null;
  cargarCatalogosEditarAccion = function() {
    if (cargarCatalogosEditarAccionOriginalV40) cargarCatalogosEditarAccionOriginalV40.apply(this, arguments);
    cargarCatalogoTiposDEE();
  };

  const limpiarFormularioAccionOriginalV40 = typeof limpiarFormularioAccion === 'function' ? limpiarFormularioAccion : null;
  limpiarFormularioAccion = function() {
    if (limpiarFormularioAccionOriginalV40) limpiarFormularioAccionOriginalV40.apply(this, arguments);
    if ($('accionSubtipoRehabilitacion')) $('accionSubtipoRehabilitacion').value = '';
    actualizarVisibilidadSubtipoDEE('accion');
  };

  const limpiarFormularioAccionProgramaOriginalV40 = typeof limpiarFormularioAccionPrograma === 'function' ? limpiarFormularioAccionPrograma : null;
  limpiarFormularioAccionPrograma = function() {
    if (limpiarFormularioAccionProgramaOriginalV40) limpiarFormularioAccionProgramaOriginalV40.apply(this, arguments);
    if ($('progSubtipoRehabilitacion')) $('progSubtipoRehabilitacion').value = '';
    actualizarVisibilidadSubtipoDEE('prog');
  };

  const abrirModalEditarAccionOriginalV40 = typeof abrirModalEditarAccion === 'function' ? abrirModalEditarAccion : null;
  abrirModalEditarAccion = function(id) {
    const r = abrirModalEditarAccionOriginalV40 ? abrirModalEditarAccionOriginalV40.apply(this, arguments) : undefined;
    const a = cargarAccionesLocales().find(x => String(x.id) === String(id));
    cargarCatalogoTiposDEE();
    if ($('editTipoAccion')) $('editTipoAccion').value = accionValor(a,'tipoAccion','tipo') || '';
    if ($('editSubtipoRehabilitacion')) $('editSubtipoRehabilitacion').value = accionValor(a,'subtipoRehabilitacion','subtipo_rehabilitacion') || '';
    actualizarVisibilidadSubtipoDEE('edit');
    return r;
  };
  window.abrirModalEditarAccion = abrirModalEditarAccion;

  const guardarAccionDSOriginalV40 = typeof guardarAccionDS === 'function' ? guardarAccionDS : null;
  guardarAccionDS = function() {
    const decreto = buscarDecretoPorId($('accionDs')?.value || '');
    const tipo = $('accionTipo')?.value || '';
    const subtipo = $('accionSubtipoRehabilitacion')?.value || '';
    const v = validarTipoAccionDEE({ tipo, subtipo, decreto });
    if (!v.ok) return alert(v.msg);
    const before = cargarAccionesLocales().map(a => a.id).join('|');
    const r = guardarAccionDSOriginalV40 ? guardarAccionDSOriginalV40.apply(this, arguments) : undefined;
    const lista = cargarAccionesLocales();
    const after = lista.map(a => a.id).join('|');
    if (after !== before) {
      const ultimo = lista[lista.length - 1];
      if (ultimo && String(ultimo.ds_id || ultimo.dsId) === String(decreto?.id || '')) {
        ultimo.tipo = tipo; ultimo.tipoAccion = tipo;
        ultimo.subtipoRehabilitacion = esTipoRehabilitacionDEE(tipo) ? subtipo : '';
        ultimo.subtipo_rehabilitacion = ultimo.subtipoRehabilitacion;
        guardarAccionesLocales(lista);
        api('/acciones', 'POST', ultimo);
      }
    }
    return r;
  };

  const guardarAccionProgramaOriginalV40 = typeof guardarAccionPrograma === 'function' ? guardarAccionPrograma : null;
  guardarAccionPrograma = function() {
    const decreto = buscarDecretoPorId(dsProgramaSeleccionadoId || '');
    const tipo = $('progTipoAccion')?.value || '';
    const subtipo = $('progSubtipoRehabilitacion')?.value || '';
    const v = validarTipoAccionDEE({ tipo, subtipo, decreto });
    if (!v.ok) return alert(v.msg);
    const before = cargarAccionesLocales().map(a => a.id).join('|');
    const r = guardarAccionProgramaOriginalV40 ? guardarAccionProgramaOriginalV40.apply(this, arguments) : undefined;
    const lista = cargarAccionesLocales();
    const after = lista.map(a => a.id).join('|');
    if (after !== before) {
      const ultimo = lista[lista.length - 1];
      if (ultimo && String(ultimo.dsId || ultimo.ds_id) === String(decreto?.id || '')) {
        ultimo.tipo = tipo; ultimo.tipoAccion = tipo;
        ultimo.subtipoRehabilitacion = esTipoRehabilitacionDEE(tipo) ? subtipo : '';
        ultimo.subtipo_rehabilitacion = ultimo.subtipoRehabilitacion;
        guardarAccionesLocales(lista);
        api('/acciones', 'POST', ultimo);
      }
    }
    return r;
  };

  const grabarModalAccionOriginalV40 = typeof grabarModalAccion === 'function' ? grabarModalAccion : null;
  grabarModalAccion = function() {
    const id = $('editAccionId')?.value || '';
    const original = cargarAccionesLocales().find(a => String(a.id) === String(id));
    const decreto = buscarDecretoPorId(original?.dsId || original?.ds_id || dsPreAprobarSeleccionadoId || '');
    const tipo = $('editTipoAccion')?.value || '';
    const subtipo = $('editSubtipoRehabilitacion')?.value || '';
    const v = validarTipoAccionDEE({ tipo, subtipo, decreto });
    if (!v.ok) return alert(v.msg);
    const r = grabarModalAccionOriginalV40 ? grabarModalAccionOriginalV40.apply(this, arguments) : undefined;
    const lista = cargarAccionesLocales();
    const idx = lista.findIndex(a => String(a.id) === String(id));
    if (idx >= 0) {
      lista[idx].tipo = tipo; lista[idx].tipoAccion = tipo;
      lista[idx].subtipoRehabilitacion = esTipoRehabilitacionDEE(tipo) ? subtipo : '';
      lista[idx].subtipo_rehabilitacion = lista[idx].subtipoRehabilitacion;
      guardarAccionesLocales(lista);
      api('/acciones', 'POST', lista[idx]);
      if (typeof renderTablaPreAprobarAcciones === 'function') renderTablaPreAprobarAcciones();
      if (typeof renderTablaAcciones === 'function') renderTablaAcciones();
    }
    return r;
  };

  const apiOriginalTipoV40 = typeof api === 'function' ? api : null;
  if (apiOriginalTipoV40 && !window.__apiCatalogoTipoAccionV40) {
    window.__apiCatalogoTipoAccionV40 = true;
    api = async function(path, method = 'GET', body = null) {
      const p = String(path || '').toLowerCase();
      const m = String(method || 'GET').toUpperCase();
      if (p.includes('/acciones') && ['POST','PUT','PATCH'].includes(m)) {
        const v = validarBodyAccionBackendDEE(body || {});
        if (!v.ok) {
          alert(v.msg);
          return { ok:false, data:{ ok:false, error:'catalogo_tipo_accion_invalido', message:v.msg } };
        }
      }
      return apiOriginalTipoV40(path, method, body);
    };
    window.api = api;
  }

  const initRegistroAccionesOriginalV40 = typeof initRegistroAcciones === 'function' ? initRegistroAcciones : null;
  initRegistroAcciones = function() {
    const r = initRegistroAccionesOriginalV40 ? initRegistroAccionesOriginalV40.apply(this, arguments) : undefined;
    attachEventosTipoDEE();
    refrescarReglasTipoPorDSDEE();
    return r;
  };

  document.addEventListener('DOMContentLoaded', () => {
    attachEventosTipoDEE();
    setTimeout(refrescarReglasTipoPorDSDEE, 300);
  });

  window.TIPOS_ACCION_OFICIALES = TIPOS_ACCION_OFICIALES.slice();
  window.SUBTIPOS_REHABILITACION_OFICIALES = SUBTIPOS_REHABILITACION_OFICIALES.slice();
})();


// ================= CIERRE FINAL EXPORTAR DS v41 - 05/05/2026 =================
(function(){
  const TEMPLATE_EXCEL_DS = 'Libro1.xlsx';
  const MODELO_HOJA_DS = 'D.S. NRO 003';

  function numeroDSLimpio(d) {
    const numero = String(d?.numero || '').trim().padStart(3, '0');
    const anio = String(d?.anio || new Date().getFullYear()).trim();
    return `${numero}-${anio}-PCM`;
  }

  function nombreArchivoDS(d, ext) {
    return `DS_NRO_${numeroDSLimpio(d).replace(/[^0-9A-Za-zÁÉÍÓÚÑáéíóúñ-]/g, '_')}.${ext}`;
  }

  function territoriosDecreto(d) {
    return Array.isArray(d?.territorio) ? d.territorio : [];
  }

  function resumenTerritorialDS(d) {
    const territorio = territoriosDecreto(d);
    const departamentos = [...new Set(territorio.map(t => t.departamento).filter(Boolean))];
    const provincias = [...new Set(territorio.map(t => `${t.departamento || ''}|${t.provincia || ''}`).filter(x => x.split('|')[1]))].map(x => x.split('|')[1]);
    const distritos = [...new Set(territorio.map(t => `${t.departamento || ''}|${t.provincia || ''}|${t.distrito || ''}`).filter(x => x.split('|')[2]))].map(x => x.split('|')[2]);
    return { departamentos, provincias, distritos };
  }

  function excelDateLocal(value) {
    if (!value) return '';
    const d = new Date(`${value}T00:00:00`);
    return isNaN(d.getTime()) ? value : d;
  }

  function textoFechaPeru(value) {
    if (!value) return '';
    const d = new Date(`${String(value).slice(0,10)}T00:00:00`);
    if (isNaN(d.getTime())) return value;
    return d.toLocaleDateString('es-PE', { day:'2-digit', month:'2-digit', year:'numeric' });
  }

  function fechaReporteCorta() {
    const d = new Date();
    return d.toLocaleDateString('es-PE', { day:'2-digit', month:'2-digit', year:'2-digit' });
  }

  function descargarBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function clonarEstiloExcel(obj) {
    if (!obj) return obj;
    try { return JSON.parse(JSON.stringify(obj)); } catch { return obj; }
  }

  function copiarEstiloFila(ws, filaOrigen, filaDestino) {
    const src = ws.getRow(filaOrigen);
    const dst = ws.getRow(filaDestino);
    dst.height = src.height;
    for (let c = 1; c <= 11; c++) {
      const sc = src.getCell(c);
      const dc = dst.getCell(c);
      dc.style = clonarEstiloExcel(sc.style || {});
      if (sc.numFmt) dc.numFmt = sc.numFmt;
      dc.alignment = clonarEstiloExcel(sc.alignment || dc.alignment || {});
      dc.border = clonarEstiloExcel(sc.border || dc.border || {});
      dc.fill = clonarEstiloExcel(sc.fill || dc.fill || {});
      dc.font = clonarEstiloExcel(sc.font || dc.font || {});
    }
  }

  function setValorSeguro(ws, celda, valor) {
    const cell = ws.getCell(celda);
    cell.value = valor ?? '';
  }

  function construirFilasMatrizDS(d) {
    const territorio = territoriosDecreto(d);
    const filas = [];
    if (!territorio.length) {
      filas.push({
        organo: 'MIDIS', codigo: d.codigo_registro || `DS-${numeroDSLimpio(d)}`,
        detalle: `${d.tipo_peligro || d.peligro || ''}`,
        unidad: 'REGISTRO', meta: '', plazo: d.plazo_dias || '', inicio: d.fecha_inicio || '', fin: d.fecha_fin || '', ejecutada: '', avance: '', comentario: d.vigencia || ''
      });
      return filas;
    }
    territorio.forEach((t, i) => {
      filas.push({
        organo: 'MIDIS',
        codigo: `T-${String(i + 1).padStart(3, '0')}`,
        detalle: `${d.tipo_peligro || d.peligro || ''} · ${t.departamento || ''} / ${t.provincia || ''} / ${t.distrito || ''}`,
        unidad: 'DISTRITO',
        meta: 1,
        plazo: d.plazo_dias || '',
        inicio: d.fecha_inicio || '',
        fin: d.fecha_fin || '',
        ejecutada: '',
        avance: '',
        comentario: `Vigencia: ${d.vigencia || ''}${t.ubigeo ? ' · Ubigeo: ' + t.ubigeo : ''}`
      });
    });
    return filas;
  }

  async function cargarWorkbookDesdePlantilla() {
    if (!window.ExcelJS) throw new Error('No se cargó ExcelJS. Revise conexión a internet o CDN.');
    const wb = new ExcelJS.Workbook();
    try {
      const res = await fetch(TEMPLATE_EXCEL_DS, { cache: 'no-store' });
      if (!res.ok) throw new Error('Plantilla no disponible');
      const buffer = await res.arrayBuffer();
      await wb.xlsx.load(buffer);
    } catch (err) {
      const ws = wb.addWorksheet(MODELO_HOJA_DS);
      ws.columns = [
        { width: 18 }, { width: 15 }, { width: 55 }, { width: 16 }, { width: 14 }, { width: 12 }, { width: 16 }, { width: 16 }, { width: 14 }, { width: 12 }, { width: 42 }
      ];
      ws.mergeCells('A3:K3'); ws.mergeCells('A4:K4'); ws.mergeCells('A5:K5'); ws.mergeCells('A6:K6'); ws.mergeCells('A7:K7'); ws.mergeCells('A9:K9');
      ws.getCell('A3').value = 'MATRIZ EJECUTIVA DE SEGUIMIENTO DE LAS ACCIONES EN LA DECLARATORIA DE ESTADO DE EMERGENCIA';
      ws.getCell('A5').value = 'SECTOR/: MINISTERIO DE DESARROLLO E INCLUSIÓN SOCIAL';
      ws.getRow(11).values = ['ORGANO ADSCRITO O UNIDAD DEL SECTOR QUE EJECUTA LA ACCIÓN','CÓDIGO DE LA ACCION','ACCIONES ESPECÍFICAS PROGRAMADAS Y EJECUTADAS POR EL SECTOR RELACIONADAS CON LA EXPOSICIÓN DE MOTIVOS','UNIDAD DE MEDIDA','META PROGRAMADA','PLAZO (dias)','F. INICIO DE LA ACCION','F. FIN DE LA ACCION','META EJECUTADA','% AVANCE','COMENTARIOS Y/O DESCRIPCIÓN'];
      ws.getRow(11).font = { bold:true, color:{argb:'FFFFFFFF'} };
      ws.getRow(11).fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FF1F4E79'} };
    }
    return wb;
  }

  async function exportarDSExcel(id) {
    const d = buscarDecretoPorId(id);
    if (!d) return alert('No se encontró el Decreto Supremo seleccionado.');
    try {
      const wb = await cargarWorkbookDesdePlantilla();
      const ws = wb.getWorksheet(MODELO_HOJA_DS) || wb.worksheets[0];
      ws.name = MODELO_HOJA_DS;
      ws.pageSetup = { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 1, horizontalCentered: true };
      ws.pageMargins = { left: 0.25, right: 0.25, top: 0.35, bottom: 0.35, header: 0.15, footer: 0.15 };

      const res = resumenTerritorialDS(d);
      setValorSeguro(ws, 'A4', `D.S. N°${numeroDSLimpio(d)}:`);
      setValorSeguro(ws, 'A5', 'SECTOR/: MINISTERIO DE DESARROLLO E INCLUSIÓN SOCIAL');
      setValorSeguro(ws, 'A6', `FECHA DE REPORTE: ${fechaReporteCorta()}`);
      setValorSeguro(ws, 'A7', `VIGENCIA DE LA DEE: ${textoFechaPeru(d.fecha_inicio)} AL ${textoFechaPeru(d.fecha_fin)}`);
      setValorSeguro(ws, 'A9', `ACCIONES A REALIZAR POR EL SECTOR//GORE SEGÚN LA EXPOSICIÓN DE MOTIVOS:\n${d.motivos || ''}\n\nPeligro/evento: ${d.tipo_peligro || d.peligro || ''}\nDepartamentos: ${res.departamentos.join(', ')}\nProvincias: ${res.provincias.join(', ')}\nDistritos: ${res.distritos.join(', ')}\nEstado de vigencia: ${d.vigencia || ''}`);
      ws.getCell('A9').alignment = { ...(ws.getCell('A9').alignment || {}), wrapText: true, vertical: 'top' };

      const filas = construirFilasMatrizDS(d);
      const start = 14;
      for (let r = start; r <= Math.max(60, start + filas.length + 10); r++) {
        for (let c = 1; c <= 11; c++) ws.getRow(r).getCell(c).value = null;
      }
      filas.forEach((f, i) => {
        const row = start + i;
        copiarEstiloFila(ws, 14, row);
        ws.getCell(`A${row}`).value = f.organo;
        ws.getCell(`B${row}`).value = f.codigo;
        ws.getCell(`C${row}`).value = f.detalle;
        ws.getCell(`D${row}`).value = f.unidad;
        ws.getCell(`E${row}`).value = f.meta;
        ws.getCell(`F${row}`).value = f.plazo;
        ws.getCell(`G${row}`).value = excelDateLocal(f.inicio);
        ws.getCell(`H${row}`).value = excelDateLocal(f.fin);
        ws.getCell(`I${row}`).value = f.ejecutada;
        ws.getCell(`J${row}`).value = f.avance;
        ws.getCell(`K${row}`).value = f.comentario;
        ['C','K'].forEach(col => ws.getCell(`${col}${row}`).alignment = { ...(ws.getCell(`${col}${row}`).alignment || {}), wrapText: true, vertical:'top' });
        ['G','H'].forEach(col => { ws.getCell(`${col}${row}`).numFmt = 'dd/mm/yyyy'; });
      });
      ws.views = [{ state: 'frozen', ySplit: 12 }];
      const buf = await wb.xlsx.writeBuffer();
      descargarBlob(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), nombreArchivoDS(d, 'xlsx'));
    } catch (err) {
      console.error('Error exportando Excel DS:', err);
      alert('No se pudo exportar el Excel. Verifique que Libro1.xlsx esté en la misma carpeta que index.html.');
    }
  }

  function colorSemaforoPDF(semaforo) {
    const s = normalizarTexto(semaforo);
    if (s.includes('ROJO')) return [192, 0, 0];
    if (s.includes('AMBAR') || s.includes('ÁMBAR')) return [191, 143, 0];
    if (s.includes('VERDE')) return [0, 128, 0];
    return [80, 80, 80];
  }

  function exportarDSPDF(id) {
    const d = buscarDecretoPorId(id);
    if (!d) return alert('No se encontró el Decreto Supremo seleccionado.');
    if (!window.jspdf?.jsPDF) return alert('No se cargó jsPDF. Revise conexión a internet o CDN.');
    try {
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      const res = resumenTerritorialDS(d);
      const filas = construirFilasMatrizDS(d);
      const azul = [31, 78, 121];

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      doc.setTextColor(...azul);
      doc.text('MATRIZ EJECUTIVA DE SEGUIMIENTO DE LAS ACCIONES EN LA DECLARATORIA DE ESTADO DE EMERGENCIA', 148.5, 14, { align: 'center' });
      doc.setFontSize(11);
      doc.text(`D.S. N°${numeroDSLimpio(d)}:`, 148.5, 22, { align: 'center' });
      doc.setFontSize(9);
      doc.setTextColor(0,0,0);
      doc.text('SECTOR/: MINISTERIO DE DESARROLLO E INCLUSIÓN SOCIAL', 148.5, 29, { align: 'center' });
      doc.text(`FECHA DE REPORTE: ${fechaReporteCorta()}`, 148.5, 35, { align: 'center' });
      doc.text(`VIGENCIA DE LA DEE: ${textoFechaPeru(d.fecha_inicio)} AL ${textoFechaPeru(d.fecha_fin)}`, 148.5, 41, { align: 'center' });

      doc.setFont('helvetica', 'bold');
      doc.text('Resumen del Decreto Supremo seleccionado', 12, 50);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      const resumen = [
        ['Peligro / evento', d.tipo_peligro || d.peligro || ''],
        ['Estado de vigencia', d.vigencia || ''],
        ['Departamentos', res.departamentos.join(', ')],
        ['Provincias', res.provincias.join(', ')],
        ['Distritos', res.distritos.join(', ')],
        ['Exposición de motivos', d.motivos || '']
      ];
      doc.autoTable({
        startY: 54,
        body: resumen,
        theme: 'grid',
        styles: { fontSize: 7, cellPadding: 1.2, valign: 'top', lineColor: [120,120,120], lineWidth: 0.1 },
        columnStyles: { 0: { fontStyle:'bold', fillColor:[221,235,247], cellWidth: 38 }, 1: { cellWidth: 235 } },
        margin: { left: 12, right: 12 }
      });

      const y = doc.lastAutoTable.finalY + 5;
      doc.autoTable({
        startY: y,
        head: [[
          'Órgano / unidad', 'Código', 'Acciones específicas / información territorial', 'Unidad', 'Meta prog.', 'Plazo', 'F. inicio', 'F. fin', 'Meta ejec.', '% avance', 'Comentarios'
        ]],
        body: filas.map(f => [f.organo, f.codigo, f.detalle, f.unidad, f.meta, f.plazo, textoFechaPeru(f.inicio), textoFechaPeru(f.fin), f.ejecutada, f.avance, f.comentario]),
        theme: 'grid',
        headStyles: { fillColor: azul, textColor: [255,255,255], halign: 'center', valign: 'middle', fontSize: 6.5 },
        styles: { fontSize: 6.3, cellPadding: 1, overflow: 'linebreak', valign: 'top', lineColor: [80,80,80], lineWidth: 0.1 },
        columnStyles: { 0:{cellWidth:24}, 1:{cellWidth:18}, 2:{cellWidth:74}, 3:{cellWidth:20}, 4:{cellWidth:14, halign:'center'}, 5:{cellWidth:14, halign:'center'}, 6:{cellWidth:18}, 7:{cellWidth:18}, 8:{cellWidth:16}, 9:{cellWidth:14}, 10:{cellWidth:41} },
        margin: { left: 8, right: 8 },
        didDrawPage: () => {
          doc.setFontSize(7);
          doc.setTextColor(100);
          doc.text(`Exportado desde DEE MIDIS · ${fechaHoraLocalISO()}`, 8, 204);
        }
      });
      doc.save(nombreArchivoDS(d, 'pdf'));
    } catch (err) {
      console.error('Error exportando PDF DS:', err);
      alert('No se pudo exportar el PDF.');
    }
  }

  const renderTablaDecretosBasicaOriginalExportV41 = typeof renderTablaDecretosBasica === 'function' ? renderTablaDecretosBasica : null;
  renderTablaDecretosBasica = function() {
    const tbody = document.querySelector('#tablaDS tbody');
    if (!tbody) return renderTablaDecretosBasicaOriginalExportV41?.apply(this, arguments);

    const decretos = (state.decretos.length ? state.decretos : cargarDecretosLocales()).map(normalizarDecreto).filter(Boolean);
    if (!decretos.length) {
      tbody.innerHTML = '<tr><td colspan="18" class="text-muted">No hay Decretos Supremos registrados.</td></tr>';
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
          const habilitado = d.rdsActivo && typeof dsTieneAccionesRegistradas === 'function' && dsTieneAccionesRegistradas(d.id) && estado !== 'PREAPROBADO' && estado !== 'APROBADO';
          botonRevision = `<button type="button" class="btn btn-sm btn-warning" ${habilitado ? '' : 'disabled title="Pendiente: no existen acciones registradas o ya fue preaprobado/aprobado"'} onclick="abrirPreAprobacion('${escapeHtmlAttr(d.id)}')">PreAprobar</button>`;
        } else if (puedeAprobar()) {
          const habilitado = estado === 'PREAPROBADO';
          botonRevision = `<button type="button" class="btn btn-sm btn-success" ${habilitado ? '' : 'disabled title="Disponible cuando el DS esté PreAprobado"'} onclick="abrirPreAprobacion('${escapeHtmlAttr(d.id)}')">Aprobar</button>`;
        }
      } else if (esRegistradorPrograma()) {
        const programa = programaSesionNormalizado();
        const cerrado = typeof dsProgramaCerroRegistro === 'function' ? dsProgramaCerroRegistro(d, programa) : false;
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

      const exportar = `<div class="d-flex flex-wrap gap-1"><button type="button" class="btn btn-sm btn-outline-success" onclick="exportarDSExcel('${escapeHtmlAttr(d.id)}')">Excel</button><button type="button" class="btn btn-sm btn-outline-danger" onclick="exportarDSPDF('${escapeHtmlAttr(d.id)}')">PDF</button></div>`;

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
          <td>${exportar}</td>
        </tr>`;
    }).join('');
  };

  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
      const head = document.querySelector('#tablaDS thead tr');
      if (head && ![...head.children].some(th => normalizarTexto(th.textContent) === 'EXPORTAR')) {
        const th = document.createElement('th'); th.textContent = 'Exportar'; head.appendChild(th);
      }
      if (typeof renderTablaDecretosBasica === 'function') renderTablaDecretosBasica();
    }, 500);
  });

  window.exportarDSExcel = exportarDSExcel;
  window.exportarDSPDF = exportarDSPDF;
})();


// ================= CIERRE FINAL EXPORTAR DS v42 - MAPEO POR TIPO DE ACCION =================
(function(){
  const TEMPLATE_EXCEL_DS_V42 = 'DS.xlsx';
  const MODELO_HOJA_DS_V42 = 'D.S. NRO';
  const TIPO_PREPARACION_V42 = 'Acciones de Preparación (Solo DEE por Peligro Inminente)';
  const TIPO_RESPUESTA_V42 = 'Acciones de Respuesta';
  const TIPO_REHABILITACION_V42 = 'Acciones de Rehabilitación';
  const SUBTIPO_RESTABLECIMIENTO_V42 = 'RESTABLECIMIENTO DE SERVICIOS PÚBLICOS BÁSICOS E INFRAESTRUCTURA';
  const SUBTIPO_MEDIOS_V42 = 'NORMALIZACIÓN PROGRESIVA DE LOS MEDIOS DE VIDA';

  function ntextoV42(v){
    return typeof normalizarTexto === 'function'
      ? normalizarTexto(v)
      : String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase();
  }

  function numeroDSLimpioV42(d) {
    const numero = String(d?.numero || '').trim().padStart(3, '0');
    const anio = String(d?.anio || new Date().getFullYear()).trim();
    return `${numero}-${anio}-PCM`;
  }

  function nombreBaseDSV42(d) {
    return `DS_${numeroDSLimpioV42(d)}`.replace(/[\\/:*?"<>|\[\]]/g, '_').slice(0, 31);
  }

  function nombreArchivoDSV42(d, ext) {
    return `${nombreBaseDSV42(d)}.${ext}`;
  }

  function textoFechaPeruV42(value) {
    if (!value) return '';
    const s = String(value);
    const base = s.includes('T') ? s.slice(0, 10) : s.slice(0, 10);
    const d = new Date(`${base}T00:00:00`);
    if (isNaN(d.getTime())) return value;
    return d.toLocaleDateString('es-PE', { day:'2-digit', month:'2-digit', year:'numeric' });
  }

  function fechaReporteCortaV42() {
    return new Date().toLocaleDateString('es-PE', { day:'2-digit', month:'2-digit', year:'2-digit' });
  }

  function excelDateLocalV42(value) {
    if (!value) return '';
    const s = String(value).slice(0, 10);
    const d = new Date(`${s}T00:00:00`);
    return isNaN(d.getTime()) ? value : d;
  }

  function descargarBlobV42(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function territoriosDecretoV42(d) {
    return Array.isArray(d?.territorio) ? d.territorio : [];
  }

  function resumenTerritorialDSV42(d) {
    const territorio = territoriosDecretoV42(d);
    const departamentos = [...new Set(territorio.map(t => t.departamento).filter(Boolean))];
    const provincias = [...new Set(territorio.map(t => `${t.departamento || ''}|${t.provincia || ''}`).filter(x => x.split('|')[1]))].map(x => x.split('|')[1]);
    const distritos = [...new Set(territorio.map(t => `${t.departamento || ''}|${t.provincia || ''}|${t.distrito || ''}`).filter(x => x.split('|')[2]))].map(x => x.split('|')[2]);
    return { departamentos, provincias, distritos };
  }

  function accionValorV42(a, ...keys) {
    for (const k of keys) {
      const val = a?.[k];
      if (val !== undefined && val !== null && String(val) !== '') return val;
    }
    return '';
  }

  function tipoAccionV42(a) {
    return String(accionValorV42(a, 'tipoAccion', 'tipo', 'tipo_accion') || '').trim();
  }

  function subtipoAccionV42(a) {
    return String(accionValorV42(a, 'subtipoRehabilitacion', 'subtipo_rehabilitacion', 'subtipo') || '').trim();
  }

  function clasificarAccionV42(a) {
    const t = ntextoV42(tipoAccionV42(a));
    if (t === ntextoV42(TIPO_PREPARACION_V42)) return 'preparacion';
    if (t === ntextoV42(TIPO_RESPUESTA_V42)) return 'respuesta';
    if (t === ntextoV42(TIPO_REHABILITACION_V42)) {
      const st = ntextoV42(subtipoAccionV42(a));
      if (st.includes('MEDIOS DE VIDA') || st === ntextoV42(SUBTIPO_MEDIOS_V42)) return 'rehabMedios';
      return 'rehabRestablecimiento';
    }
    return '';
  }

  function accionesDelDSParaExportarV42(d) {
    const lista = (typeof cargarAccionesLocales === 'function') ? cargarAccionesLocales() : [];
    const id = String(d?.id || '');
    const dsTexto = typeof formatearNumeroDS === 'function' ? formatearNumeroDS(d) : '';
    const vistos = new Set();
    return lista.filter(a => {
      const aid = String(a?.dsId || a?.ds_id || '');
      const ads = String(a?.numeroDS || a?.ds || '');
      const coincide = (aid && aid === id) || (ads && dsTexto && ads === dsTexto);
      if (!coincide) return false;
      const clave = [aid || id, ntextoV42(accionValorV42(a,'programaNacional','programa')), ntextoV42(accionValorV42(a,'codigoAccion','codigo')), ntextoV42(tipoAccionV42(a))].join('|');
      if (vistos.has(clave)) return false;
      vistos.add(clave);
      return true;
    });
  }

  function normalizarAvanceV42(a) {
    const meta = Number(accionValorV42(a, 'metaProgramada', 'meta_programada') || 0);
    const eje = Number(accionValorV42(a, 'metaEjecutada', 'meta_ejecutada') || 0);
    const avance = String(accionValorV42(a, 'avance', 'porcentajeAvance') || '').trim();
    if (avance) return avance;
    if (meta > 0) return `${Math.min(100, Math.round((eje / meta) * 100))}%`;
    return '';
  }

  function filaDesdeAccionV42(a, d) {
    return {
      organo: accionValorV42(a, 'programaNacional', 'programa'),
      codigo: accionValorV42(a, 'codigoAccion', 'codigo'),
      detalle: accionValorV42(a, 'detalle', 'accionDetalle'),
      unidad: accionValorV42(a, 'unidadMedida', 'unidad'),
      meta: accionValorV42(a, 'metaProgramada', 'meta_programada'),
      plazo: accionValorV42(a, 'plazoDias', 'plazo'),
      inicio: accionValorV42(a, 'fechaInicio', 'fecha_inicio'),
      fin: accionValorV42(a, 'fechaFinal', 'fecha_final'),
      ejecutada: accionValorV42(a, 'metaEjecutada', 'meta_ejecutada'),
      avance: normalizarAvanceV42(a),
      comentario: accionValorV42(a, 'descripcionActividades', 'descripcion'),
      motivos: d?.motivos || d?.exposicion_motivos || ''
    };
  }

  function validarFilaFechasV42(f) {
    if (!f.inicio || !f.fin) return true;
    const ini = new Date(`${String(f.inicio).slice(0,10)}T00:00:00`);
    const fin = new Date(`${String(f.fin).slice(0,10)}T00:00:00`);
    if (isNaN(ini.getTime()) || isNaN(fin.getTime())) return true;
    return ini <= fin;
  }

  function clonarV42(obj) {
    if (!obj) return obj;
    try { return JSON.parse(JSON.stringify(obj)); } catch { return obj; }
  }

  function copiarEstiloFilaV42(ws, filaOrigen, filaDestino) {
    const src = ws.getRow(filaOrigen);
    const dst = ws.getRow(filaDestino);
    dst.height = src.height;
    for (let c = 1; c <= 11; c++) {
      const sc = src.getCell(c);
      const dc = dst.getCell(c);
      dc.style = clonarV42(sc.style || {});
      if (sc.numFmt) dc.numFmt = sc.numFmt;
      dc.alignment = clonarV42(sc.alignment || dc.alignment || {});
      dc.border = clonarV42(sc.border || dc.border || {});
      dc.fill = clonarV42(sc.fill || dc.fill || {});
      dc.font = clonarV42(sc.font || dc.font || {});
    }
  }

  function limpiarFilaDatosV42(ws, row) {
    for (let c = 1; c <= 11; c++) ws.getRow(row).getCell(c).value = null;
  }

  function setValorSeguroV42(ws, celda, valor) {
    const cell = ws.getCell(celda);
    cell.value = valor ?? '';
  }

  function escribirFilaAccionV42(ws, row, f) {
    copiarEstiloFilaV42(ws, row, row);
    ws.getCell(`A${row}`).value = f.organo || '';
    ws.getCell(`B${row}`).value = f.codigo || '';
    ws.getCell(`C${row}`).value = f.detalle || '';
    ws.getCell(`D${row}`).value = f.unidad || '';
    ws.getCell(`E${row}`).value = f.meta === undefined || f.meta === null ? '' : f.meta;
    ws.getCell(`F${row}`).value = f.plazo === undefined || f.plazo === null ? '' : f.plazo;
    ws.getCell(`G${row}`).value = excelDateLocalV42(f.inicio);
    ws.getCell(`H${row}`).value = excelDateLocalV42(f.fin);
    ws.getCell(`I${row}`).value = f.ejecutada === undefined || f.ejecutada === null ? '' : f.ejecutada;
    ws.getCell(`J${row}`).value = f.avance || '';
    ws.getCell(`K${row}`).value = f.comentario || '';
    ['C','K'].forEach(col => ws.getCell(`${col}${row}`).alignment = { ...(ws.getCell(`${col}${row}`).alignment || {}), wrapText: true, vertical:'top' });
    ['G','H'].forEach(col => { ws.getCell(`${col}${row}`).numFmt = 'dd/mm/yyyy'; });
  }

  function buscarFilaPorTextoV42(ws, texto) {
    const objetivo = ntextoV42(texto);
    for (let r = 1; r <= Math.max(200, ws.rowCount || 0); r++) {
      for (let c = 1; c <= 11; c++) {
        const v = ws.getRow(r).getCell(c).value;
        const s = typeof v === 'object' && v?.richText ? v.richText.map(x => x.text).join('') : String(v || '');
        if (ntextoV42(s).includes(objetivo)) return r;
      }
    }
    return 0;
  }

  function insertarFilasSiFaltanV42(ws, start, capacity, needed, styleRow) {
    if (needed <= capacity) return;
    const faltan = needed - capacity;
    ws.spliceRows(start + capacity, 0, ...Array.from({ length: faltan }, () => []));
    for (let i = 0; i < faltan; i++) copiarEstiloFilaV42(ws, styleRow, start + capacity + i);
  }

  function escribirSeccionV42(ws, start, capacity, filas, styleRow) {
    insertarFilasSiFaltanV42(ws, start, capacity, filas.length, styleRow);
    const total = Math.max(capacity, filas.length);
    for (let i = 0; i < total; i++) {
      const row = start + i;
      copiarEstiloFilaV42(ws, styleRow, row);
      limpiarFilaDatosV42(ws, row);
      if (filas[i]) escribirFilaAccionV42(ws, row, filas[i]);
    }
  }

  async function cargarWorkbookDesdePlantillaV42() {
    if (!window.ExcelJS) throw new Error('No se cargó ExcelJS. Revise conexión a internet o CDN.');
    const wb = new ExcelJS.Workbook();
    const res = await fetch(TEMPLATE_EXCEL_DS_V42, { cache: 'no-store' });
    if (!res.ok) throw new Error('Plantilla DS.xlsx no disponible');
    const buffer = await res.arrayBuffer();
    await wb.xlsx.load(buffer);
    return wb;
  }

  function prepararHojaV42(wb, d) {
    const ws = wb.getWorksheet(MODELO_HOJA_DS_V42) || wb.worksheets[0];
    ws.name = nombreBaseDSV42(d);
    ws.pageSetup = { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 1, horizontalCentered: true };
    ws.pageMargins = { left: 0.25, right: 0.25, top: 0.35, bottom: 0.35, header: 0.15, footer: 0.15 };
    return ws;
  }

  function llenarCabeceraV42(ws, d) {
    const res = resumenTerritorialDSV42(d);
    setValorSeguroV42(ws, 'A4', `D.S. N°${numeroDSLimpioV42(d)}:`);
    setValorSeguroV42(ws, 'A5', 'SECTOR/: MINISTERIO DE DESARROLLO E INCLUSIÓN SOCIAL');
    setValorSeguroV42(ws, 'A6', `FECHA DE REPORTE: ${fechaReporteCortaV42()}`);
    setValorSeguroV42(ws, 'A7', `VIGENCIA DE LA DEE: ${textoFechaPeruV42(d.fecha_inicio)} AL ${textoFechaPeruV42(d.fecha_fin)}`);
    setValorSeguroV42(ws, 'A9', `ACCIONES A REALIZAR POR EL SECTOR SEGÚN LA EXPOSICIÓN DE MOTIVOS\n${d.motivos || d.exposicion_motivos || ''}\n\nPeligro/evento: ${d.tipo_peligro || d.peligro || ''}\nDepartamentos: ${res.departamentos.join(', ')}\nProvincias: ${res.provincias.join(', ')}\nDistritos: ${res.distritos.join(', ')}\nEstado de vigencia: ${d.vigencia || ''}`);
    ws.getCell('A9').alignment = { ...(ws.getCell('A9').alignment || {}), wrapText: true, vertical: 'top' };
  }

  function agruparFilasAccionesV42(d) {
    const grupos = { preparacion: [], respuesta: [], rehabRestablecimiento: [], rehabMedios: [] };
    const advertencias = [];
    accionesDelDSParaExportarV42(d).forEach(a => {
      const grupo = clasificarAccionV42(a);
      if (!grupo) return;
      const fila = filaDesdeAccionV42(a, d);
      if (!validarFilaFechasV42(fila)) advertencias.push(`La acción ${fila.codigo || ''} tiene F. inicio mayor que F. final.`);
      grupos[grupo].push(fila);
    });
    return { grupos, advertencias };
  }

  function escribirAccionesPorTipoV42(ws, d) {
    const prepHeader = buscarFilaPorTextoV42(ws, 'ACCIONES DE PREPARACIÓN') || 13;
    const respHeader = buscarFilaPorTextoV42(ws, 'ACCIONES DE RESPUESTA') || 20;
    const rehabHeader = buscarFilaPorTextoV42(ws, 'ACCIONES DE REHABILITACIÓN') || 23;
    const restHeader = buscarFilaPorTextoV42(ws, 'RESTABLECIMIENTO DE SERVICIOS') || 24;
    const mediosHeader = buscarFilaPorTextoV42(ws, 'NORMALIZACIÓN PROGRESIVA') || 26;

    const { grupos, advertencias } = agruparFilasAccionesV42(d);
    const prepStart = prepHeader + 1;
    const prepCapacity = Math.max(1, respHeader - prepStart);
    escribirSeccionV42(ws, prepStart, prepCapacity, grupos.preparacion, prepStart);

    const respHeader2 = buscarFilaPorTextoV42(ws, 'ACCIONES DE RESPUESTA') || respHeader;
    const rehabHeader2 = buscarFilaPorTextoV42(ws, 'ACCIONES DE REHABILITACIÓN') || rehabHeader;
    const respStart = respHeader2 + 1;
    const respCapacity = Math.max(1, rehabHeader2 - respStart);
    escribirSeccionV42(ws, respStart, respCapacity, grupos.respuesta, respStart);

    const restHeader2 = buscarFilaPorTextoV42(ws, 'RESTABLECIMIENTO DE SERVICIOS') || restHeader;
    const mediosHeader2 = buscarFilaPorTextoV42(ws, 'NORMALIZACIÓN PROGRESIVA') || mediosHeader;
    const restStart = restHeader2 + 1;
    const restCapacity = Math.max(1, mediosHeader2 - restStart);
    escribirSeccionV42(ws, restStart, restCapacity, grupos.rehabRestablecimiento, restStart);

    const mediosHeader3 = buscarFilaPorTextoV42(ws, 'NORMALIZACIÓN PROGRESIVA') || mediosHeader2;
    const mediosStart = mediosHeader3 + 1;
    const mediosCapacity = Math.max(1, (ws.rowCount || mediosStart) - mediosStart + 1);
    escribirSeccionV42(ws, mediosStart, mediosCapacity, grupos.rehabMedios, mediosStart);

    if (advertencias.length) console.warn('Advertencias de exportación DS:', advertencias);
  }

  async function exportarDSExcel(id) {
    const d = buscarDecretoPorId(id);
    if (!d) return alert('No se encontró el Decreto Supremo seleccionado.');
    try {
      const wb = await cargarWorkbookDesdePlantillaV42();
      const ws = prepararHojaV42(wb, d);
      llenarCabeceraV42(ws, d);
      escribirAccionesPorTipoV42(ws, d);
      ws.views = [{ state: 'frozen', ySplit: 12 }];
      const buf = await wb.xlsx.writeBuffer();
      descargarBlobV42(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), nombreArchivoDSV42(d, 'xlsx'));
    } catch (err) {
      console.error('Error exportando Excel DS v42:', err);
      alert('No se pudo exportar el Excel. Verifique que DS.xlsx esté en la misma carpeta que index.html.');
    }
  }

  function exportarDSPDF(id) {
    const d = buscarDecretoPorId(id);
    if (!d) return alert('No se encontró el Decreto Supremo seleccionado.');
    if (!window.jspdf?.jsPDF) return alert('No se cargó jsPDF. Revise conexión a internet o CDN.');
    try {
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      const azul = [31, 78, 121];
      const res = resumenTerritorialDSV42(d);
      const { grupos } = agruparFilasAccionesV42(d);
      const bodyFor = filas => filas.map(f => [f.organo, f.codigo, f.detalle, f.unidad, f.meta, f.plazo, textoFechaPeruV42(f.inicio), textoFechaPeruV42(f.fin), f.ejecutada, f.avance, f.comentario]);

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      doc.setTextColor(...azul);
      doc.text('MATRIZ EJECUTIVA DE SEGUIMIENTO DE LAS ACCIONES EN LA DECLARATORIA DE ESTADO DE EMERGENCIA', 148.5, 14, { align: 'center' });
      doc.setFontSize(11);
      doc.text(`D.S. N°${numeroDSLimpioV42(d)}:`, 148.5, 22, { align: 'center' });
      doc.setFontSize(9);
      doc.setTextColor(0,0,0);
      doc.text('SECTOR/: MINISTERIO DE DESARROLLO E INCLUSIÓN SOCIAL', 148.5, 29, { align: 'center' });
      doc.text(`FECHA DE REPORTE: ${fechaReporteCortaV42()}`, 148.5, 35, { align: 'center' });
      doc.text(`VIGENCIA DE LA DEE: ${textoFechaPeruV42(d.fecha_inicio)} AL ${textoFechaPeruV42(d.fecha_fin)}`, 148.5, 41, { align: 'center' });

      doc.autoTable({
        startY: 48,
        body: [
          ['ACCIONES A REALIZAR POR EL SECTOR SEGÚN LA EXPOSICIÓN DE MOTIVOS', d.motivos || ''],
          ['Peligro / evento', d.tipo_peligro || d.peligro || ''],
          ['Departamentos', res.departamentos.join(', ')],
          ['Provincias', res.provincias.join(', ')],
          ['Distritos', res.distritos.join(', ')]
        ],
        theme: 'grid',
        styles: { fontSize: 7, cellPadding: 1.1, valign: 'top', overflow: 'linebreak' },
        columnStyles: { 0: { fontStyle: 'bold', fillColor: [221,235,247], cellWidth: 76 }, 1: { cellWidth: 198 } },
        margin: { left: 11, right: 11 }
      });

      let y = doc.lastAutoTable.finalY + 4;
      const secciones = [
        ['ACCIONES DE PREPARACIÓN (para el caso de DEE por Peligro Inminente)', grupos.preparacion],
        ['ACCIONES DE RESPUESTA', grupos.respuesta],
        ['ACCIONES DE REHABILITACIÓN - I). RESTABLECIMIENTO DE SERVICIOS PÚBLICOS BÁSICOS E INFRAESTRUCTURA', grupos.rehabRestablecimiento],
        ['ACCIONES DE REHABILITACIÓN - II). NORMALIZACIÓN PROGRESIVA DE LOS MEDIOS DE VIDA', grupos.rehabMedios]
      ];
      const head = [['Órgano / unidad', 'Código', 'Acciones específicas', 'Unidad', 'Meta prog.', 'Plazo', 'F. inicio', 'F. fin', 'Meta ejec.', '% avance', 'Comentarios']];
      secciones.forEach(([titulo, filas]) => {
        if (y > 178) { doc.addPage(); y = 12; }
        doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(...azul); doc.text(titulo, 11, y); y += 2;
        doc.autoTable({
          startY: y,
          head,
          body: bodyFor(filas),
          theme: 'grid',
          headStyles: { fillColor: azul, textColor: [255,255,255], halign: 'center', valign: 'middle', fontSize: 6 },
          styles: { fontSize: 5.8, cellPadding: 0.8, overflow: 'linebreak', valign: 'top', lineColor: [90,90,90], lineWidth: 0.1 },
          columnStyles: { 0:{cellWidth:25}, 1:{cellWidth:17}, 2:{cellWidth:74}, 3:{cellWidth:18}, 4:{cellWidth:14, halign:'center'}, 5:{cellWidth:12, halign:'center'}, 6:{cellWidth:17}, 7:{cellWidth:17}, 8:{cellWidth:15}, 9:{cellWidth:13}, 10:{cellWidth:43} },
          margin: { left: 8, right: 8 },
          didDrawPage: () => {
            doc.setFontSize(7); doc.setTextColor(100);
            doc.text(`Exportado desde DEE MIDIS · ${fechaHoraLocalISO()}`, 8, 204);
          }
        });
        y = doc.lastAutoTable.finalY + 5;
      });
      doc.save(nombreArchivoDSV42(d, 'pdf'));
    } catch (err) {
      console.error('Error exportando PDF DS v42:', err);
      alert('No se pudo exportar el PDF.');
    }
  }

  function botonesExportarV42(d) {
    return `<div class="d-flex flex-wrap gap-1"><button type="button" class="btn btn-sm btn-outline-success" onclick="exportarDSExcel('${escapeHtmlAttr(d.id)}')">Excel</button><button type="button" class="btn btn-sm btn-outline-danger" onclick="exportarDSPDF('${escapeHtmlAttr(d.id)}')">PDF</button></div>`;
  }

  const renderTablaBaseAnteriorV42 = typeof renderTablaDecretosBasica === 'function' ? renderTablaDecretosBasica : null;
  renderTablaDecretosBasica = function() {
    const tbody = document.querySelector('#tablaDS tbody');
    if (!tbody) return renderTablaBaseAnteriorV42?.apply(this, arguments);
    const decretos = (state.decretos.length ? state.decretos : cargarDecretosLocales()).map(normalizarDecreto).filter(Boolean);
    if (!decretos.length) {
      tbody.innerHTML = '<tr><td colspan="18" class="text-muted">No hay Decretos Supremos registrados.</td></tr>';
      return;
    }
    tbody.innerHTML = decretos.map(d => {
      const territorio = Array.isArray(d.territorio) ? d.territorio : [];
      const deps = new Set(territorio.map(t => t.departamento).filter(Boolean));
      const provs = new Set(territorio.map(t => `${t.departamento}|${t.provincia}`).filter(Boolean));
      const dists = new Set(territorio.map(t => `${t.departamento}|${t.provincia}|${t.distrito}`).filter(Boolean));
      const estado = ntextoV42(d.estadoRDS || '');
      let botonRDS = '';
      let botonRevision = '';
      if (puedeActivarRDS()) {
        botonRDS = `<button type="button" class="btn btn-sm ${d.rdsActivo ? 'btn-success' : 'btn-outline-primary'}" onclick="abrirRDS('${escapeHtmlAttr(d.id)}')">RDS</button>`;
        if (puedePreaprobar()) {
          const habilitado = d.rdsActivo && typeof dsTieneAccionesRegistradas === 'function' && dsTieneAccionesRegistradas(d.id) && estado !== 'PREAPROBADO' && estado !== 'APROBADO';
          botonRevision = `<button type="button" class="btn btn-sm btn-warning" ${habilitado ? '' : 'disabled title="Pendiente: no existen acciones registradas o ya fue preaprobado/aprobado"'} onclick="abrirPreAprobacion('${escapeHtmlAttr(d.id)}')">PreAprobar</button>`;
        } else if (puedeAprobar()) {
          const habilitado = estado === 'PREAPROBADO';
          botonRevision = `<button type="button" class="btn btn-sm btn-success" ${habilitado ? '' : 'disabled title="Disponible cuando el DS esté PreAprobado"'} onclick="abrirPreAprobacion('${escapeHtmlAttr(d.id)}')">Aprobar</button>`;
        }
      } else if (esRegistradorPrograma()) {
        const programa = programaSesionNormalizado();
        const cerrado = typeof dsProgramaCerroRegistro === 'function' ? dsProgramaCerroRegistro(d, programa) : false;
        botonRDS = d.rdsActivo
          ? (cerrado ? `<button type="button" class="btn btn-sm btn-secondary" disabled>Acciones Registradas</button>` : `<button type="button" class="btn btn-sm btn-primary" onclick="abrirRegistrarAcciones('${escapeHtmlAttr(d.id)}')">Registrar Acciones</button>`)
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
          <td>${botonesExportarV42(d)}</td>
        </tr>`;
    }).join('');
  };

  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
      const head = document.querySelector('#tablaDS thead tr');
      if (head && ![...head.children].some(th => ntextoV42(th.textContent) === 'EXPORTAR')) {
        const th = document.createElement('th'); th.textContent = 'Exportar'; head.appendChild(th);
      }
      if (typeof renderTablaDecretosBasica === 'function') renderTablaDecretosBasica();
    }, 600);
  });

  window.exportarDSExcel = exportarDSExcel;
  window.exportarDSPDF = exportarDSPDF;
})();

// ================= CIERRE FINAL v43 - EXPORTACIÓN Y OJITO SIN BLOQUE FIJO =================
(function(){
  const VERSION_CIERRE = 'v43-export-ojito-fix';
  const AZUL = '1F4E79';
  const TIPOS = {
    PREPARACION: 'Acciones de Preparación (Solo DEE por Peligro Inminente)',
    RESPUESTA: 'Acciones de Respuesta',
    REHABILITACION: 'Acciones de Rehabilitación'
  };

  function ntext(v){
    return String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toUpperCase();
  }

  function limpiarNumeroDS(valor){
    let s = String(valor || '').trim();
    if (!s) return '';
    s = s.replace(/^D\.?\s*S\.?\s*N?[°º.]?\s*/i, '');
    s = s.replace(/^DS\s*N?[°º.]?\s*/i, '');
    s = s.replace(/^N?[°º.]?\s*/i, '');
    s = s.replace(/\s+/g, '');
    s = s.replace(/^-+|-+$/g, '');
    // Corrige casos como 024-2026-PCM-2026-PCM o 024-2026-PCM-PCM.
    let m = s.match(/(\d{1,4})[-_\s]*(20\d{2})[-_\s]*PCM/i);
    if (m) return `${m[1].padStart(3,'0')}-${m[2]}-PCM`;
    m = s.match(/(\d{1,4})[-_\s]*(20\d{2})/i);
    if (m) return `${m[1].padStart(3,'0')}-${m[2]}-PCM`;
    m = s.match(/(\d{1,4})/);
    return m ? m[1].padStart(3,'0') : s;
  }

  function numeroDSLimpioFinal(d){
    const raw = d?.numero || d?.ds || d?.decreto || d?.decreto_supremo || '';
    let limpio = limpiarNumeroDS(raw);
    if (/^\d{3}$/.test(limpio)) {
      const anio = String(d?.anio || d?.año || new Date().getFullYear()).match(/20\d{2}/)?.[0] || String(new Date().getFullYear());
      limpio = `${limpio}-${anio}-PCM`;
    }
    return limpio;
  }

  function formatearNumeroDSFinal(d){
    const limpio = numeroDSLimpioFinal(d);
    return limpio ? `D.S. N°${limpio}` : '';
  }

  // Reemplazo global quirúrgico: evita repetir 2026-PCM en todo el sistema.
  window.formatearNumeroDS = formatearNumeroDSFinal;
  try { formatearNumeroDS = formatearNumeroDSFinal; } catch(e) {}

  function nombreArchivoFinal(d, ext){
    return `DS_${numeroDSLimpioFinal(d).replace(/[^0-9A-Za-zÁÉÍÓÚÑáéíóúñ-]/g,'_')}.${ext}`;
  }

  function formatoFecha(v){
    if (!v) return '';
    const s = String(v).slice(0,10);
    const d = new Date(`${s}T00:00:00`);
    return isNaN(d.getTime()) ? String(v) : d.toLocaleDateString('es-PE', { day:'2-digit', month:'2-digit', year:'numeric' });
  }

  function fechaHora(){
    if (typeof fechaHoraLocalISO === 'function') return fechaHoraLocalISO();
    const d = new Date();
    const p = n => String(n).padStart(2,'0');
    return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }

  function descargarBlob(blob, filename){
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function territorios(d){ return Array.isArray(d?.territorio) ? d.territorio : []; }

  function resumenTerritorio(d){
    const t = territorios(d);
    const departamentos = [...new Set(t.map(x => x.departamento).filter(Boolean))];
    const provincias = [...new Set(t.map(x => `${x.departamento || ''}|${x.provincia || ''}`).filter(x => x.split('|')[1]))].map(x => x.split('|')[1]);
    const distritos = [...new Set(t.map(x => `${x.departamento || ''}|${x.provincia || ''}|${x.distrito || ''}`).filter(x => x.split('|')[2]))].map(x => x.split('|')[2]);
    return { departamentos, provincias, distritos };
  }

  function accionValorFinal(a, ...keys){
    for (const k of keys) {
      const v = a?.[k];
      if (v !== undefined && v !== null && String(v) !== '') return v;
    }
    return '';
  }

  function accionesDSFinal(d){
    const dsId = String(d?.id || '');
    const dsTexto = formatearNumeroDSFinal(d);
    let lista = [];
    try { lista = typeof cargarAccionesLocales === 'function' ? cargarAccionesLocales() : JSON.parse(localStorage.getItem('accionesDS') || '[]'); } catch { lista = []; }
    return (Array.isArray(lista) ? lista : []).filter(a =>
      String(a.dsId || a.ds_id || '') === dsId ||
      String(a.numeroDS || a.ds || '') === dsTexto
    );
  }

  function filaAccionFinal(a, d){
    const metaProg = Number(accionValorFinal(a,'metaProgramada','meta_programada') || 0);
    const metaEjec = Number(accionValorFinal(a,'metaEjecutada','meta_ejecutada') || 0);
    let avance = String(accionValorFinal(a,'avance') || '');
    if (!avance && metaProg > 0) avance = `${Math.min(100, Math.round((metaEjec/metaProg)*100))}%`;
    return {
      reunion: accionValorFinal(a,'numeroReunion','numero_reunion') || d?.numeroReunion || '',
      fechaReunion: accionValorFinal(a,'fechaReunion','fecha_reunion') || d?.fechaReunion || '',
      programa: accionValorFinal(a,'programaNacional','programa'),
      tipo: accionValorFinal(a,'tipoAccion','tipo'),
      subtipo: accionValorFinal(a,'subtipoRehabilitacion','subtipo_rehabilitacion'),
      codigo: accionValorFinal(a,'codigoAccion','codigo'),
      detalle: accionValorFinal(a,'detalle','accion','acciones'),
      unidad: accionValorFinal(a,'unidadMedida','unidad'),
      metaProgramada: accionValorFinal(a,'metaProgramada','meta_programada'),
      plazo: accionValorFinal(a,'plazoDias','plazo'),
      inicio: accionValorFinal(a,'fechaInicio','fecha_inicio'),
      fin: accionValorFinal(a,'fechaFinal','fecha_final'),
      metaEjecutada: accionValorFinal(a,'metaEjecutada','meta_ejecutada'),
      avance,
      descripcion: accionValorFinal(a,'descripcionActividades','descripcion'),
      usuario: accionValorFinal(a,'usuarioRegistro','usuario_registro'),
      fechaRegistro: accionValorFinal(a,'fechaRegistro','fecha_registro'),
      estado: accionValorFinal(a,'estado') || 'Registrado'
    };
  }

  function clasificarTipo(tipo){
    const t = ntext(tipo);
    if (t.includes('PREPARACION')) return 'preparacion';
    if (t.includes('RESPUESTA')) return 'respuesta';
    if (t.includes('REHABILITACION')) return 'rehabilitacion';
    return 'otros';
  }

  function datosReporteFinal(d){
    const res = resumenTerritorio(d);
    const acciones = accionesDSFinal(d).map(a => filaAccionFinal(a, d));
    const secciones = [
      { key:'preparacion', titulo:'ACCIONES DE PREPARACIÓN (para el caso de DEE por Peligro Inminente)', filas:[] },
      { key:'respuesta', titulo:'ACCIONES DE RESPUESTA', filas:[] },
      { key:'rehabilitacion', titulo:'ACCIONES DE REHABILITACIÓN', filas:[] },
      { key:'otros', titulo:'ACCIONES SIN CLASIFICACIÓN', filas:[] }
    ];
    acciones.forEach(f => {
      const sec = secciones.find(s => s.key === clasificarTipo(f.tipo)) || secciones[3];
      sec.filas.push(f);
    });
    return {
      titulo: formatearNumeroDSFinal(d),
      numero: numeroDSLimpioFinal(d),
      fechaReporte: formatoFecha(new Date().toISOString()),
      vigencia: `${formatoFecha(d.fecha_inicio)} al ${formatoFecha(d.fecha_fin)}`,
      tipo: d.peligro || '',
      peligroEvento: d.tipo_peligro || '',
      estadoVigencia: d.vigencia || '',
      semaforo: d.semaforo || '',
      departamentos: res.departamentos.join(', '),
      provincias: res.provincias.join(', '),
      distritos: res.distritos.join(', '),
      motivos: d.motivos || '',
      sectores: Array.isArray(d.sectores) ? d.sectores.join(', ') : '',
      relacion: d.es_prorroga ? 'Prórroga' : 'Original',
      cadena: d.cadena || '',
      nivelProrroga: d.nivel_prorroga || 0,
      rds: d.rdsActivo ? 'Activo' : 'No activado',
      numeroReunion: d.numeroReunion || '',
      fechaReunion: d.fechaReunion || '',
      secciones
    };
  }

  function aplicarEstiloTituloExcel(cell){
    cell.font = { bold:true, size:12, color:{ argb:`FF${AZUL}` } };
    cell.alignment = { horizontal:'center', vertical:'middle', wrapText:true };
  }

  function aplicarHeaderExcel(row){
    row.eachCell(cell => {
      cell.font = { bold:true, color:{ argb:'FFFFFFFF' }, size:9 };
      cell.fill = { type:'pattern', pattern:'solid', fgColor:{ argb:`FF${AZUL}` } };
      cell.alignment = { horizontal:'center', vertical:'middle', wrapText:true };
      cell.border = { top:{style:'thin'}, left:{style:'thin'}, bottom:{style:'thin'}, right:{style:'thin'} };
    });
  }

  function aplicarCeldaExcel(cell){
    cell.alignment = { vertical:'top', wrapText:true };
    cell.border = { top:{style:'thin'}, left:{style:'thin'}, bottom:{style:'thin'}, right:{style:'thin'} };
  }

  async function exportarDSExcelFinal(id){
    const d = typeof buscarDecretoPorId === 'function' ? buscarDecretoPorId(id) : null;
    if (!d) return alert('No se encontró el Decreto Supremo seleccionado.');
    if (!window.ExcelJS) return alert('No se cargó ExcelJS. Revise conexión a internet o CDN.');
    const info = datosReporteFinal(d);
    const wb = new ExcelJS.Workbook();
    wb.creator = 'DEE MIDIS';
    wb.created = new Date();
    const ws = wb.addWorksheet(`DS_${info.numero}`.replace(/[\\/*?:\[\]]/g,'_').slice(0,31));
    ws.pageSetup = { paperSize:9, orientation:'landscape', fitToPage:true, fitToWidth:1, fitToHeight:0, horizontalCentered:true };
    ws.pageMargins = { left:0.25, right:0.25, top:0.35, bottom:0.35, header:0.15, footer:0.15 };
    ws.columns = [
      {width:22},{width:18},{width:24},{width:18},{width:18},{width:58},{width:16},{width:14},{width:12},{width:16},{width:16},{width:14},{width:12},{width:42}
    ];
    let r = 1;
    ws.mergeCells(`A${r}:N${r}`); ws.getCell(`A${r}`).value = 'MATRIZ EJECUTIVA DE SEGUIMIENTO DE ACCIONES EN LA DECLARATORIA DE ESTADO DE EMERGENCIA'; aplicarEstiloTituloExcel(ws.getCell(`A${r}`)); r++;
    ws.mergeCells(`A${r}:N${r}`); ws.getCell(`A${r}`).value = info.titulo; aplicarEstiloTituloExcel(ws.getCell(`A${r}`)); r++;
    ws.mergeCells(`A${r}:N${r}`); ws.getCell(`A${r}`).value = 'SECTOR: MINISTERIO DE DESARROLLO E INCLUSIÓN SOCIAL'; aplicarEstiloTituloExcel(ws.getCell(`A${r}`)); r++;
    ws.mergeCells(`A${r}:N${r}`); ws.getCell(`A${r}`).value = `FECHA DE REPORTE: ${info.fechaReporte}`; aplicarEstiloTituloExcel(ws.getCell(`A${r}`)); r++;
    ws.mergeCells(`A${r}:N${r}`); ws.getCell(`A${r}`).value = `VIGENCIA DE LA DEE: ${info.vigencia}`; aplicarEstiloTituloExcel(ws.getCell(`A${r}`)); r += 2;

    const generales = [
      ['Número de Decreto Supremo', info.titulo],
      ['Tipo', info.tipo],
      ['Peligro o evento', info.peligroEvento],
      ['Fecha inicio', formatoFecha(d.fecha_inicio)],
      ['Fecha final', formatoFecha(d.fecha_fin)],
      ['Estado de vigencia', info.estadoVigencia],
      ['Semáforo', info.semaforo],
      ['Departamentos', info.departamentos],
      ['Provincias', info.provincias],
      ['Distritos', info.distritos],
      ['Relación', info.relacion],
      ['Cadena', info.cadena],
      ['Prórrogas', info.nivelProrroga],
      ['RDS', `${info.rds}${info.numeroReunion ? ' · ' + info.numeroReunion : ''}${info.fechaReunion ? ' · ' + formatoFecha(info.fechaReunion) : ''}`]
    ];
    ws.mergeCells(`A${r}:N${r}`); ws.getCell(`A${r}`).value = 'INFORMACIÓN GENERAL DEL DECRETO SUPREMO'; aplicarHeaderExcel(ws.getRow(r)); r++;
    generales.forEach(([k,v]) => {
      ws.mergeCells(`B${r}:N${r}`);
      ws.getCell(`A${r}`).value = k; ws.getCell(`B${r}`).value = v || '';
      aplicarCeldaExcel(ws.getCell(`A${r}`)); aplicarCeldaExcel(ws.getCell(`B${r}`));
      ws.getCell(`A${r}`).font = { bold:true };
      r++;
    });
    ws.mergeCells(`B${r}:N${r}`); ws.getCell(`A${r}`).value = 'ACCIONES A REALIZAR POR EL SECTOR SEGÚN LA EXPOSICIÓN DE MOTIVOS'; ws.getCell(`B${r}`).value = info.motivos || ''; aplicarCeldaExcel(ws.getCell(`A${r}`)); aplicarCeldaExcel(ws.getCell(`B${r}`)); ws.getCell(`A${r}`).font = { bold:true }; ws.getRow(r).height = 42; r += 2;

    const headers = ['Número de reunión','Fecha reunión','Programa Nacional','Tipo de acción','Código de acción','Acciones específicas programadas y ejecutadas','Unidad de medida','Meta programada','Plazo (días)','F. inicio','F. final','Meta ejecutada','% Avance','Comentarios / descripción'];
    info.secciones.filter(s => s.key !== 'otros' || s.filas.length).forEach(sec => {
      ws.mergeCells(`A${r}:N${r}`); ws.getCell(`A${r}`).value = sec.titulo; aplicarHeaderExcel(ws.getRow(r)); r++;
      ws.getRow(r).values = headers; aplicarHeaderExcel(ws.getRow(r)); r++;
      if (!sec.filas.length) {
        ws.mergeCells(`A${r}:N${r}`); ws.getCell(`A${r}`).value = 'Sin acciones registradas.'; aplicarCeldaExcel(ws.getCell(`A${r}`)); r++;
      } else {
        sec.filas.forEach(f => {
          ws.getRow(r).values = [f.reunion, formatoFecha(f.fechaReunion), f.programa, f.tipo, f.codigo, f.detalle, f.unidad, f.metaProgramada, f.plazo, formatoFecha(f.inicio), formatoFecha(f.fin), f.metaEjecutada, f.avance, f.descripcion];
          ws.getRow(r).eachCell(aplicarCeldaExcel); r++;
        });
      }
      r++;
    });
    const buf = await wb.xlsx.writeBuffer();
    descargarBlob(new Blob([buf], { type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), nombreArchivoFinal(d, 'xlsx'));
  }

  function exportarDSPDFFinal(id){
    const d = typeof buscarDecretoPorId === 'function' ? buscarDecretoPorId(id) : null;
    if (!d) return alert('No se encontró el Decreto Supremo seleccionado.');
    if (!window.jspdf?.jsPDF) return alert('No se cargó jsPDF. Revise conexión a internet o CDN.');
    const info = datosReporteFinal(d);
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation:'landscape', unit:'mm', format:'a4' });
    const azul = [31,78,121];
    doc.setFont('helvetica','bold'); doc.setTextColor(...azul); doc.setFontSize(12);
    doc.text('MATRIZ EJECUTIVA DE SEGUIMIENTO DE ACCIONES EN LA DECLARATORIA DE ESTADO DE EMERGENCIA', 148.5, 12, { align:'center' });
    doc.setFontSize(11); doc.text(info.tituloConReunion || info.titulo, 148.5, 19, { align:'center' });
    doc.setFontSize(9); doc.setTextColor(0,0,0);
    doc.text('SECTOR: MINISTERIO DE DESARROLLO E INCLUSIÓN SOCIAL', 148.5, 25, { align:'center' });
    doc.text(`FECHA DE REPORTE: ${info.fechaReporte}`, 148.5, 31, { align:'center' });
    doc.text(`VIGENCIA DE LA DEE: ${info.vigencia}`, 148.5, 37, { align:'center' });

    const generales = [
      ['Número de Decreto Supremo', info.titulo], ['Tipo', info.tipo], ['Peligro o evento', info.peligroEvento],
      ['Fecha inicio', formatoFecha(d.fecha_inicio)], ['Fecha final', formatoFecha(d.fecha_fin)], ['Estado de vigencia', info.estadoVigencia],
      ['Semáforo', info.semaforo], ['Departamentos', info.departamentos], ['Provincias', info.provincias], ['Distritos', info.distritos],
      ['Relación', info.relacion], ['Cadena', info.cadena], ['Prórrogas', String(info.nivelProrroga || '')], ['RDS', `${info.rds}${info.numeroReunion ? ' · ' + info.numeroReunion : ''}${info.fechaReunion ? ' · ' + formatoFecha(info.fechaReunion) : ''}`],
      ['Acciones a realizar según exposición de motivos', info.motivos || '']
    ];
    doc.autoTable({
      startY: 43,
      body: generales,
      theme:'grid',
      styles:{ fontSize:6.5, cellPadding:1, overflow:'linebreak', valign:'top' },
      columnStyles:{ 0:{ fontStyle:'bold', fillColor:[221,235,247], cellWidth:58 }, 1:{ cellWidth:214 } },
      margin:{ left:11, right:11 }
    });
    let y = doc.lastAutoTable.finalY + 4;
    const head = [['N° reunión','Fecha reunión','Programa','Tipo','Código','Acciones específicas','Unidad','Meta prog.','Plazo','F. inicio','F. fin','Meta ejec.','% avance','Comentarios']];
    info.secciones.filter(s => s.key !== 'otros' || s.filas.length).forEach(sec => {
      if (y > 175) { doc.addPage(); y = 12; }
      doc.setFont('helvetica','bold'); doc.setFontSize(8); doc.setTextColor(...azul); doc.text(sec.titulo, 8, y); y += 2;
      const body = sec.filas.length ? sec.filas.map(f => [f.reunion, formatoFecha(f.fechaReunion), f.programa, f.tipo, f.codigo, f.detalle, f.unidad, f.metaProgramada, f.plazo, formatoFecha(f.inicio), formatoFecha(f.fin), f.metaEjecutada, f.avance, f.descripcion]) : [['Sin acciones registradas.','','','','','','','','','','','','','']];
      doc.autoTable({
        startY: y,
        head,
        body,
        theme:'grid',
        headStyles:{ fillColor:azul, textColor:[255,255,255], halign:'center', valign:'middle', fontSize:5.3 },
        styles:{ fontSize:5.1, cellPadding:0.55, overflow:'linebreak', valign:'top', lineColor:[90,90,90], lineWidth:0.1 },
        columnStyles:{ 0:{cellWidth:17},1:{cellWidth:16},2:{cellWidth:21},3:{cellWidth:24},4:{cellWidth:16},5:{cellWidth:50},6:{cellWidth:14},7:{cellWidth:12},8:{cellWidth:10},9:{cellWidth:14},10:{cellWidth:14},11:{cellWidth:12},12:{cellWidth:10},13:{cellWidth:38} },
        margin:{ left:6, right:6 },
        didDrawPage: () => { doc.setFontSize(6); doc.setTextColor(100); doc.text(`Exportado desde DEE MIDIS · ${fechaHora()}`, 8, 204); }
      });
      y = doc.lastAutoTable.finalY + 5;
    });
    doc.save(nombreArchivoFinal(d, 'pdf'));
  }

  function accionesAgrupadasPorReunionHTML(d){
    const acciones = accionesDSFinal(d).map(a => filaAccionFinal(a, d));
    if (!acciones.length) return '<div class="alert alert-secondary py-2 mb-0">No hay acciones registradas por Programas Nacionales para este Decreto Supremo.</div>';
    const grupos = new Map();
    acciones.forEach(a => {
      const key = `${a.reunion || 'Sin reunión'}|${a.fechaReunion || ''}`;
      if (!grupos.has(key)) grupos.set(key, []);
      grupos.get(key).push(a);
    });
    let html = '';
    grupos.forEach((items, key) => {
      const [reunion, fecha] = key.split('|');
      html += `<div class="border rounded p-2 mb-2 bg-light"><strong>${escapeHtml(reunion)}</strong>${fecha ? ' · ' + escapeHtml(formatoFecha(fecha)) : ''}</div>`;
      html += `<div class="table-responsive mb-3"><table class="table table-sm table-striped"><thead class="table-light"><tr><th>Programa Nacional</th><th>Tipo de acción</th><th>Código</th><th>Acción registrada</th><th>Meta prog.</th><th>Meta ejec.</th><th>Avance</th><th>Observaciones</th><th>Usuario</th><th>Fecha registro</th></tr></thead><tbody>`;
      html += items.map(a => `<tr><td>${escapeHtml(a.programa)}</td><td>${escapeHtml(a.tipo)}</td><td>${escapeHtml(a.codigo)}</td><td>${escapeHtml(a.detalle)}</td><td>${escapeHtml(a.metaProgramada)}</td><td>${escapeHtml(a.metaEjecutada)}</td><td>${escapeHtml(a.avance)}</td><td>${escapeHtml(a.descripcion)}</td><td>${escapeHtml(a.usuario)}</td><td>${escapeHtml(a.fechaRegistro)}</td></tr>`).join('');
      html += '</tbody></table></div>';
    });
    return html;
  }

  function verDetalleDSFinal(id){
    const d = typeof buscarDecretoPorId === 'function' ? buscarDecretoPorId(id) : null;
    if (!d) return alert('No se encontró el Decreto Supremo.');
    const info = datosReporteFinal(d);
    const territorio = territorios(d);
    const body = $('modalDSBody');
    if (body) {
      body.innerHTML = `
        <div class="mb-2"><strong>Número de Decreto Supremo:</strong> ${escapeHtml(info.titulo)}</div>
        <div class="mb-2"><strong>Fecha:</strong> ${escapeHtml(formatoFecha(d.fecha_registro || d.created_at || d.fecha_inicio || ''))}</div>
        <div class="mb-2"><strong>Tipo:</strong> ${escapeHtml(info.tipo || '-')}</div>
        <div class="mb-2"><strong>Peligro o evento:</strong> ${escapeHtml(info.peligroEvento || '-')}</div>
        <div class="mb-2"><strong>Vigencia:</strong> ${escapeHtml(info.vigencia)} · ${escapeHtml(info.estadoVigencia || '')} · ${escapeHtml(info.semaforo || '')}</div>
        <div class="mb-2"><strong>Sectores que firman:</strong> ${escapeHtml(info.sectores || 'No registrado')}</div>
        <div class="mb-2"><strong>Relación:</strong> ${escapeHtml(info.relacion)}${info.cadena ? ' · ' + escapeHtml(info.cadena) : ''}</div>
        <div class="mb-2"><strong>RDS:</strong> ${escapeHtml(info.rds)}${info.numeroReunion ? ' · ' + escapeHtml(info.numeroReunion) : ''}${info.fechaReunion ? ' · ' + escapeHtml(formatoFecha(info.fechaReunion)) : ''}</div>
        <div class="mb-2"><strong>Exposición de motivos:</strong><br><div class="border rounded p-2 bg-light small">${escapeHtml(info.motivos || 'No registrado')}</div></div>
        <hr>
        <strong>Territorio involucrado</strong>
        <div class="small mt-2 mb-3">${territorio.length ? territorio.map(t => `${escapeHtml(t.departamento)} / ${escapeHtml(t.provincia)} / ${escapeHtml(t.distrito)}${t.ubigeo ? ' · Ubigeo: ' + escapeHtml(t.ubigeo) : ''}`).join('<br>') : 'No registrado'}</div>
        <hr>
        <h6 class="text-primary">Acciones registradas por Programas Nacionales</h6>
        ${accionesAgrupadasPorReunionHTML(d)}
      `;
    }
    const modal = $('modalDS');
    if (modal && window.bootstrap?.Modal) bootstrap.Modal.getOrCreateInstance(modal).show();
  }

  function botonesExportarFinal(d){
    return `<div class="d-flex flex-wrap gap-1"><button type="button" class="btn btn-sm btn-outline-success" onclick="exportarDSExcel('${escapeHtmlAttr(d.id)}')">Excel</button><button type="button" class="btn btn-sm btn-outline-danger" onclick="exportarDSPDF('${escapeHtmlAttr(d.id)}')">PDF</button></div>`;
  }

  const renderAnterior = typeof renderTablaDecretosBasica === 'function' ? renderTablaDecretosBasica : null;
  function renderTablaDecretosBasicaFinal(){
    const tbody = document.querySelector('#tablaDS tbody');
    if (!tbody) return renderAnterior?.apply(this, arguments);
    const decretos = (state.decretos.length ? state.decretos : cargarDecretosLocales()).map(normalizarDecreto).filter(Boolean);
    if (!decretos.length) { tbody.innerHTML = '<tr><td colspan="18" class="text-muted">No hay Decretos Supremos registrados.</td></tr>'; return; }
    tbody.innerHTML = decretos.map(d => {
      const terr = territorios(d);
      const deps = new Set(terr.map(t => t.departamento).filter(Boolean));
      const provs = new Set(terr.map(t => `${t.departamento}|${t.provincia}`).filter(Boolean));
      const dists = new Set(terr.map(t => `${t.departamento}|${t.provincia}|${t.distrito}`).filter(Boolean));
      const estado = ntext(d.estadoRDS || '');
      let botonRDS = '', botonRevision = '';
      if (puedeActivarRDS()) {
        botonRDS = `<button type="button" class="btn btn-sm ${d.rdsActivo ? 'btn-success' : 'btn-outline-primary'}" onclick="abrirRDS('${escapeHtmlAttr(d.id)}')">RDS</button>`;
        if (puedePreaprobar()) {
          const habilitado = d.rdsActivo && typeof dsTieneAccionesRegistradas === 'function' && dsTieneAccionesRegistradas(d.id) && estado !== 'PREAPROBADO' && estado !== 'APROBADO';
          botonRevision = `<button type="button" class="btn btn-sm btn-warning" ${habilitado ? '' : 'disabled title="Pendiente: no existen acciones registradas o ya fue preaprobado/aprobado"'} onclick="abrirPreAprobacion('${escapeHtmlAttr(d.id)}')">PreAprobar</button>`;
        } else if (puedeAprobar()) {
          const habilitado = estado === 'PREAPROBADO';
          botonRevision = `<button type="button" class="btn btn-sm btn-success" ${habilitado ? '' : 'disabled title="Disponible cuando el DS esté PreAprobado"'} onclick="abrirPreAprobacion('${escapeHtmlAttr(d.id)}')">Aprobar</button>`;
        }
      } else if (esRegistradorPrograma()) {
        const programa = programaSesionNormalizado();
        const cerrado = typeof dsProgramaCerroRegistro === 'function' ? dsProgramaCerroRegistro(d, programa) : false;
        botonRDS = d.rdsActivo ? (cerrado ? `<button type="button" class="btn btn-sm btn-secondary" disabled>Acciones Registradas</button>` : `<button type="button" class="btn btn-sm btn-primary" onclick="abrirRegistrarAcciones('${escapeHtmlAttr(d.id)}')">Registrar Acciones</button>`) : `<span class="badge text-bg-secondary">No activado</span>`;
      } else botonRDS = '<span class="text-muted small">Solo lectura</span>';
      return `<tr>
        <td>${escapeHtml(formatearNumeroDSFinal(d))}</td><td>${escapeHtml(d.anio)}</td><td>${escapeHtml(d.peligro)}</td><td>${escapeHtml(d.tipo_peligro)}</td><td>${escapeHtml(d.fecha_inicio)}</td><td>${escapeHtml(d.fecha_fin)}</td><td>${escapeHtml(d.vigencia)}</td><td>${escapeHtml(d.semaforo)}</td><td>${deps.size}</td><td>${provs.size}</td><td>${dists.size}</td><td>${d.es_prorroga ? 'Prórroga' : 'Original'}</td><td>${escapeHtml(d.cadena || '')}</td><td>${escapeHtml(d.nivel_prorroga || 0)}</td><td>${botonRDS}</td><td>${botonRevision}</td><td><button type="button" class="btn btn-sm btn-outline-dark" onclick="verDetalleDS('${escapeHtmlAttr(d.id)}')">👁</button></td><td>${botonesExportarFinal(d)}</td>
      </tr>`;
    }).join('');
  }

  window.exportarDSExcel = exportarDSExcelFinal;
  window.exportarDSPDF = exportarDSPDFFinal;
  window.verDetalleDS = verDetalleDSFinal;
  try { exportarDSExcel = exportarDSExcelFinal; exportarDSPDF = exportarDSPDFFinal; verDetalleDS = verDetalleDSFinal; renderTablaDecretosBasica = renderTablaDecretosBasicaFinal; } catch(e) {}

  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
      const head = document.querySelector('#tablaDS thead tr');
      if (head && ![...head.children].some(th => ntext(th.textContent) === 'EXPORTAR')) {
        const th = document.createElement('th'); th.textContent = 'Exportar'; head.appendChild(th);
      }
      if (typeof renderTablaDecretosBasica === 'function') renderTablaDecretosBasica();
      console.info('DEE MIDIS cierre aplicado:', VERSION_CIERRE);
    }, 700);
  });
})();

// ================= CIERRE FINAL v44 - EXPORTACIÓN POR REUNIÓN =================
(function(){
  const VERSION_CIERRE = 'v44-exportacion-previa-por-reunion';
  let exportacionPendienteV44 = { dsId: '', tipo: '' };

  function q(id){ return document.getElementById(id); }
  function txt(v){ return String(v ?? ''); }
  function norm(v){
    return txt(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toUpperCase();
  }
  function esc(v){
    return txt(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
  }
  function escAttr(v){ return esc(v); }
  function getAcciones(){
    try {
      if (typeof cargarAccionesLocales === 'function') return cargarAccionesLocales();
      const data = JSON.parse(localStorage.getItem('accionesDS') || '[]');
      return Array.isArray(data) ? data : [];
    } catch { return []; }
  }
  function getDecreto(id){
    try { if (typeof buscarDecretoPorId === 'function') return buscarDecretoPorId(id); } catch {}
    try {
      const decretos = JSON.parse(localStorage.getItem('decretos') || '[]');
      return (Array.isArray(decretos) ? decretos : []).find(d => String(d.id) === String(id)) || null;
    } catch { return null; }
  }
  function valor(a, ...keys){
    for (const k of keys) {
      const v = a?.[k];
      if (v !== undefined && v !== null && txt(v).trim() !== '') return v;
    }
    return '';
  }
  function fechaSimple(v){
    const s = txt(v).trim();
    if (!s) return '';
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0,10);
    return s;
  }
  function fechaMostrar(v){
    const s = fechaSimple(v);
    if (!s) return '';
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : s;
  }
  function fechaHora(){
    const d = new Date();
    const p = n => String(n).padStart(2,'0');
    return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }
  function reunionKey(numero, fecha){
    return `${norm(numero)}|${fechaSimple(fecha)}`;
  }
  function numeroDSLimpio(d){
    let n = txt(d?.numero || d?.ds || d?.decreto || d?.decreto_supremo || '').trim();
    n = n.replace(/^D\.?\s*S\.?\s*N[°.º]?\s*/i, '').trim();
    n = n.replace(/^DS\s*N[°.º]?\s*/i, '').trim();
    n = n.replace(/^-+/, '').trim();
    const m = n.match(/(\d{1,4})\s*-\s*(\d{4})\s*-\s*PCM/i);
    if (m) return `${m[1].padStart(3,'0')}-${m[2]}-PCM`;
    const anio = txt(d?.anio || d?.año || '').trim();
    n = n.replace(/-?\d{4}-PCM$/i, '').replace(/-?PCM$/i, '').trim();
    n = n.padStart(3,'0');
    return anio ? `${n}-${anio}-PCM` : n;
  }
  function tituloDS(d){ return `D.S. N°${numeroDSLimpio(d)}`; }
  function nombreArchivo(d, ext, reunion){
    const base = `DS_${numeroDSLimpio(d)}`.replace(/[^a-zA-Z0-9._-]/g,'_');
    const reu = norm(reunion?.numeroReunion || '').replace(/\s+/g,'_').replace(/[^A-Z0-9_]/g,'');
    return `${base}${reu ? '_' + reu : ''}.${ext}`;
  }
  function territorios(d){
    const arr = Array.isArray(d?.territorio) ? d.territorio : [];
    return arr.map(t => ({
      departamento: valor(t,'departamento','Departamento'),
      provincia: valor(t,'provincia','Provincia'),
      distrito: valor(t,'distrito','Distrito'),
      ubigeo: valor(t,'ubigeo','UBIGEO')
    }));
  }
  function resumenTerritorio(d){
    const terr = territorios(d);
    return {
      departamentos: [...new Set(terr.map(t => t.departamento).filter(Boolean))],
      provincias: [...new Set(terr.map(t => `${t.departamento}|${t.provincia}`).filter(x => !x.endsWith('|')))].map(x => x.split('|')[1]),
      distritos: [...new Set(terr.map(t => `${t.departamento}|${t.provincia}|${t.distrito}`).filter(x => !x.endsWith('|')))].map(x => x.split('|')[2])
    };
  }
  function accionesDelDS(d){
    const id = txt(d?.id);
    const dsTxt = tituloDS(d);
    const dsAlt = typeof formatearNumeroDS === 'function' ? formatearNumeroDS(d) : dsTxt;
    return getAcciones().filter(a =>
      txt(valor(a,'dsId','ds_id')) === id ||
      txt(valor(a,'numeroDS','ds')) === dsTxt ||
      txt(valor(a,'numeroDS','ds')) === dsAlt
    );
  }
  function reunionesDelDS(d){
    const mapa = new Map();
    const agregar = (numero, fecha, fuente) => {
      numero = txt(numero).trim(); fecha = fechaSimple(fecha);
      if (!numero || !fecha) return;
      const key = reunionKey(numero, fecha);
      if (!mapa.has(key)) mapa.set(key, { key, numeroReunion: numero, fechaReunion: fecha, fuente });
    };
    if (Array.isArray(d?.rdsReuniones)) d.rdsReuniones.forEach(r => agregar(r.numeroReunion || r.numero_reunion, r.fechaReunion || r.fecha_reunion, 'RDS'));
    agregar(d?.numeroReunion || d?.numero_reunion, d?.fechaReunion || d?.fecha_reunion, 'RDS');
    accionesDelDS(d).forEach(a => agregar(valor(a,'numeroReunion','numero_reunion'), valor(a,'fechaReunion','fecha_reunion'), 'Acción'));
    return [...mapa.values()].sort((a,b) => {
      const ia = (window.REUNIONES_RDS_V38 || []).indexOf(a.numeroReunion);
      const ib = (window.REUNIONES_RDS_V38 || []).indexOf(b.numeroReunion);
      if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
      return a.numeroReunion.localeCompare(b.numeroReunion, 'es') || a.fechaReunion.localeCompare(b.fechaReunion);
    });
  }
  function accionesDeReunion(d, reunion){
    const key = reunionKey(reunion.numeroReunion, reunion.fechaReunion);
    return accionesDelDS(d).filter(a => reunionKey(valor(a,'numeroReunion','numero_reunion'), valor(a,'fechaReunion','fecha_reunion')) === key);
  }
  function filaAccion(a){
    const metaProg = Number(valor(a,'metaProgramada','meta_programada') || 0);
    const metaEjec = Number(valor(a,'metaEjecutada','meta_ejecutada') || 0);
    let avance = txt(valor(a,'avance'));
    if (!avance && metaProg > 0) avance = `${Math.min(100, Math.round((metaEjec/metaProg)*100))}%`;
    return {
      programa: valor(a,'programaNacional','programa'),
      tipo: valor(a,'tipoAccion','tipo'),
      codigo: valor(a,'codigoAccion','codigo'),
      detalle: valor(a,'detalle','accion','acciones'),
      unidad: valor(a,'unidadMedida','unidad'),
      metaProgramada: valor(a,'metaProgramada','meta_programada'),
      plazo: valor(a,'plazoDias','plazo'),
      inicio: valor(a,'fechaInicio','fecha_inicio'),
      fin: valor(a,'fechaFinal','fecha_final'),
      metaEjecutada: valor(a,'metaEjecutada','meta_ejecutada'),
      avance,
      descripcion: valor(a,'descripcionActividades','descripcion'),
      usuario: valor(a,'usuarioRegistro','usuario_registro'),
      fechaRegistro: valor(a,'fechaRegistro','fecha_registro')
    };
  }
  function clasificarTipo(tipo){
    const t = norm(tipo);
    if (t.includes('PREPARACION')) return 'preparacion';
    if (t.includes('RESPUESTA')) return 'respuesta';
    if (t.includes('REHABILITACION')) return 'rehabilitacion';
    return 'otros';
  }
  function datosReporte(d, reunion){
    const res = resumenTerritorio(d);
    const acciones = accionesDeReunion(d, reunion).map(filaAccion);
    const secciones = [
      { key:'preparacion', titulo:'ACCIONES DE PREPARACIÓN (para el caso de DEE por Peligro Inminente)', filas:[] },
      { key:'respuesta', titulo:'ACCIONES DE RESPUESTA', filas:[] },
      { key:'rehabilitacion', titulo:'ACCIONES DE REHABILITACIÓN', filas:[] },
      { key:'otros', titulo:'ACCIONES SIN CLASIFICACIÓN', filas:[] }
    ];
    acciones.forEach(f => (secciones.find(s => s.key === clasificarTipo(f.tipo)) || secciones[3]).filas.push(f));
    const numeroReunionTitulo = txt(reunion?.numeroReunion || '');
    const tituloBaseDS = tituloDS(d);
    return {
      titulo: tituloBaseDS,
      tituloConReunion: numeroReunionTitulo ? `${numeroReunionTitulo} - ${tituloBaseDS}` : tituloBaseDS,
      numeroReunion: numeroReunionTitulo,
      fechaReunion: reunion?.fechaReunion || '',
      fechaReporte: fechaMostrar(new Date().toISOString()),
      vigencia: `${fechaMostrar(d?.fecha_inicio)} al ${fechaMostrar(d?.fecha_fin)}`,
      tipo: d?.peligro || '',
      peligroEvento: d?.tipo_peligro || '',
      estadoVigencia: d?.vigencia || '',
      semaforo: d?.semaforo || '',
      departamentos: res.departamentos.join(', '),
      provincias: res.provincias.join(', '),
      distritos: res.distritos.join(', '),
      motivos: d?.motivos || d?.exposicion_motivos || '',
      relacion: d?.es_prorroga ? 'Prórroga' : 'Original',
      cadena: d?.cadena || '',
      nivelProrroga: d?.nivel_prorroga || 0,
      rds: d?.rdsActivo ? 'Activo' : 'No activado',
      reunion,
      secciones,
      totalAcciones: acciones.length
    };
  }
  function crearModal(){
    if (q('modalExportarReunionDS')) return;
    const div = document.createElement('div');
    div.className = 'modal fade';
    div.id = 'modalExportarReunionDS';
    div.tabIndex = -1;
    div.setAttribute('aria-hidden','true');
    div.innerHTML = `
      <div class="modal-dialog modal-md modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">Seleccionar reunión para exportar</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Cerrar"></button>
          </div>
          <div class="modal-body">
            <div id="exportReunionInfo" class="alert alert-info py-2 small mb-3"></div>
            <label class="form-label">Número de reunión</label>
            <select id="exportReunionSelect" class="form-select"></select>
            <div class="form-text">Solo se muestran reuniones registradas para el Decreto Supremo seleccionado.</div>
          </div>
          <div class="modal-footer">
            <button id="btnGenerarExportReunion" type="button" class="btn btn-primary">Generar</button>
            <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Cancelar</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(div);
    q('btnGenerarExportReunion')?.addEventListener('click', confirmarExportacionReunion);
  }
  function abrirModalExportacion(id, tipo){
    const d = getDecreto(id);
    if (!d) return alert('Seleccione un Decreto Supremo válido para exportar.');
    const reuniones = reunionesDelDS(d);
    if (!reuniones.length) return alert('El Decreto Supremo seleccionado no tiene reuniones registradas para exportar.');
    crearModal();
    exportacionPendienteV44 = { dsId: String(id), tipo };
    const sel = q('exportReunionSelect');
    const info = q('exportReunionInfo');
    if (info) info.innerHTML = `<strong>${esc(tituloDS(d))}</strong><br>Tiene ${reuniones.length} reunión${reuniones.length === 1 ? '' : 'es'} registrada${reuniones.length === 1 ? '' : 's'}. Seleccione la reunión que desea visualizar/exportar.`;
    if (sel) {
      sel.innerHTML = reuniones.map(r => `<option value="${escAttr(r.key)}">${esc(r.numeroReunion)} · ${esc(fechaMostrar(r.fechaReunion))}</option>`).join('');
      sel.dataset.reuniones = JSON.stringify(reuniones);
    }
    const btn = q('btnGenerarExportReunion');
    if (btn) btn.textContent = tipo === 'excel' ? 'Generar Excel' : 'Generar PDF';
    const modal = q('modalExportarReunionDS');
    if (modal && window.bootstrap?.Modal) bootstrap.Modal.getOrCreateInstance(modal).show();
  }
  async function confirmarExportacionReunion(){
    const d = getDecreto(exportacionPendienteV44.dsId);
    const sel = q('exportReunionSelect');
    if (!d || !sel) return;
    let reuniones = [];
    try { reuniones = JSON.parse(sel.dataset.reuniones || '[]'); } catch {}
    const reunion = reuniones.find(r => r.key === sel.value);
    if (!reunion) return alert('Seleccione una reunión registrada válida.');
    const acciones = accionesDeReunion(d, reunion);
    if (!acciones.length) return alert('La reunión seleccionada no tiene acciones registradas para exportar.');
    const modal = q('modalExportarReunionDS');
    if (modal && window.bootstrap?.Modal) bootstrap.Modal.getOrCreateInstance(modal).hide();
    if (exportacionPendienteV44.tipo === 'excel') await generarExcelReunion(d, reunion);
    else generarPDFReunion(d, reunion);
  }
  function descargarBlob(blob, filename){
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function estiloTituloExcel(cell){
    cell.font = { bold:true, size:12, color:{ argb:'FF1F4E79' } };
    cell.alignment = { horizontal:'center', vertical:'middle', wrapText:true };
  }
  function estiloHeaderExcel(row){
    row.eachCell(cell => {
      cell.font = { bold:true, color:{ argb:'FFFFFFFF' }, size:9 };
      cell.fill = { type:'pattern', pattern:'solid', fgColor:{ argb:'FF1F4E79' } };
      cell.alignment = { horizontal:'center', vertical:'middle', wrapText:true };
      cell.border = { top:{style:'thin'}, left:{style:'thin'}, bottom:{style:'thin'}, right:{style:'thin'} };
    });
  }
  function estiloCeldaExcel(cell){
    cell.alignment = { vertical:'top', wrapText:true };
    cell.border = { top:{style:'thin'}, left:{style:'thin'}, bottom:{style:'thin'}, right:{style:'thin'} };
  }
  async function generarExcelReunion(d, reunion){
    if (!window.ExcelJS) return alert('No se cargó ExcelJS. Revise conexión a internet o CDN.');
    const info = datosReporte(d, reunion);
    const wb = new ExcelJS.Workbook();
    wb.creator = 'DEE MIDIS'; wb.created = new Date();
    const ws = wb.addWorksheet(`DS_${numeroDSLimpio(d)}`.replace(/[\\/*?:\[\]]/g,'_').slice(0,31));
    ws.pageSetup = { paperSize:9, orientation:'landscape', fitToPage:true, fitToWidth:1, fitToHeight:0, horizontalCentered:true };
    ws.pageMargins = { left:0.25, right:0.25, top:0.35, bottom:0.35, header:0.15, footer:0.15 };
    ws.columns = [{width:22},{width:18},{width:24},{width:18},{width:18},{width:58},{width:16},{width:14},{width:12},{width:16},{width:16},{width:14},{width:12},{width:42}];
    let r = 1;
    [['MATRIZ EJECUTIVA DE SEGUIMIENTO DE ACCIONES EN LA DECLARATORIA DE ESTADO DE EMERGENCIA'],[info.titulo],[`REUNIÓN: ${reunion.numeroReunion} · ${fechaMostrar(reunion.fechaReunion)}`],['SECTOR: MINISTERIO DE DESARROLLO E INCLUSIÓN SOCIAL'],[`FECHA DE REPORTE: ${info.fechaReporte}`],[`VIGENCIA DE LA DEE: ${info.vigencia}`]].forEach(v => { ws.mergeCells(`A${r}:N${r}`); ws.getCell(`A${r}`).value = v[0]; estiloTituloExcel(ws.getCell(`A${r}`)); r++; });
    r++;
    const generales = [
      ['Número de Decreto Supremo', info.titulo], ['Número de reunión', reunion.numeroReunion], ['Fecha de reunión', fechaMostrar(reunion.fechaReunion)],
      ['Tipo', info.tipo], ['Peligro o evento', info.peligroEvento], ['Fecha inicio', fechaMostrar(d.fecha_inicio)], ['Fecha final', fechaMostrar(d.fecha_fin)],
      ['Estado de vigencia', info.estadoVigencia], ['Semáforo', info.semaforo], ['Departamentos', info.departamentos], ['Provincias', info.provincias], ['Distritos', info.distritos],
      ['Relación', info.relacion], ['Cadena', info.cadena], ['Prórrogas', info.nivelProrroga], ['RDS', info.rds]
    ];
    ws.mergeCells(`A${r}:N${r}`); ws.getCell(`A${r}`).value = 'INFORMACIÓN GENERAL DEL DECRETO SUPREMO'; estiloHeaderExcel(ws.getRow(r)); r++;
    generales.forEach(([k,v]) => { ws.mergeCells(`B${r}:N${r}`); ws.getCell(`A${r}`).value = k; ws.getCell(`B${r}`).value = v || ''; estiloCeldaExcel(ws.getCell(`A${r}`)); estiloCeldaExcel(ws.getCell(`B${r}`)); ws.getCell(`A${r}`).font = { bold:true }; r++; });
    ws.mergeCells(`B${r}:N${r}`); ws.getCell(`A${r}`).value = 'ACCIONES A REALIZAR POR EL SECTOR SEGÚN LA EXPOSICIÓN DE MOTIVOS'; ws.getCell(`B${r}`).value = info.motivos || ''; estiloCeldaExcel(ws.getCell(`A${r}`)); estiloCeldaExcel(ws.getCell(`B${r}`)); ws.getCell(`A${r}`).font = { bold:true }; ws.getRow(r).height = 42; r += 2;
    const headers = ['Número de reunión','Fecha reunión','Programa Nacional','Tipo de acción','Código de acción','Acciones específicas programadas y ejecutadas','Unidad de medida','Meta programada','Plazo (días)','F. inicio','F. final','Meta ejecutada','% Avance','Comentarios / descripción'];
    info.secciones.filter(s => s.key !== 'otros' || s.filas.length).forEach(sec => {
      ws.mergeCells(`A${r}:N${r}`); ws.getCell(`A${r}`).value = sec.titulo; estiloHeaderExcel(ws.getRow(r)); r++;
      ws.getRow(r).values = headers; estiloHeaderExcel(ws.getRow(r)); r++;
      if (!sec.filas.length) { ws.mergeCells(`A${r}:N${r}`); ws.getCell(`A${r}`).value = 'Sin acciones registradas para esta sección.'; estiloCeldaExcel(ws.getCell(`A${r}`)); r++; }
      else sec.filas.forEach(f => { ws.getRow(r).values = [reunion.numeroReunion, fechaMostrar(reunion.fechaReunion), f.programa, f.tipo, f.codigo, f.detalle, f.unidad, f.metaProgramada, f.plazo, fechaMostrar(f.inicio), fechaMostrar(f.fin), f.metaEjecutada, f.avance, f.descripcion]; ws.getRow(r).eachCell(estiloCeldaExcel); r++; });
      r++;
    });
    const buf = await wb.xlsx.writeBuffer();
    descargarBlob(new Blob([buf], { type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), nombreArchivo(d,'xlsx',reunion));
  }
  function generarPDFReunion(d, reunion){
    if (!window.jspdf?.jsPDF) return alert('No se cargó jsPDF. Revise conexión a internet o CDN.');
    const info = datosReporte(d, reunion);
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation:'landscape', unit:'mm', format:'a4' });
    const azul = [31,78,121];
    doc.setFont('helvetica','bold'); doc.setTextColor(...azul); doc.setFontSize(12);
    doc.text('MATRIZ EJECUTIVA DE SEGUIMIENTO DE ACCIONES EN LA DECLARATORIA DE ESTADO DE EMERGENCIA', 148.5, 12, { align:'center' });
    doc.setFontSize(11); doc.text(info.tituloConReunion || info.titulo, 148.5, 19, { align:'center' });
    doc.setFontSize(9); doc.text(`REUNIÓN: ${reunion.numeroReunion} · ${fechaMostrar(reunion.fechaReunion)}`, 148.5, 25, { align:'center' });
    doc.setTextColor(0,0,0); doc.text('SECTOR: MINISTERIO DE DESARROLLO E INCLUSIÓN SOCIAL', 148.5, 31, { align:'center' });
    doc.text(`FECHA DE REPORTE: ${info.fechaReporte}`, 148.5, 37, { align:'center' });
    doc.text(`VIGENCIA DE LA DEE: ${info.vigencia}`, 148.5, 43, { align:'center' });
    const generales = [
      ['Número de Decreto Supremo', info.titulo], ['Número de reunión', reunion.numeroReunion], ['Fecha de reunión', fechaMostrar(reunion.fechaReunion)], ['Tipo', info.tipo], ['Peligro o evento', info.peligroEvento],
      ['Fecha inicio', fechaMostrar(d.fecha_inicio)], ['Fecha final', fechaMostrar(d.fecha_fin)], ['Estado de vigencia', info.estadoVigencia], ['Semáforo', info.semaforo],
      ['Departamentos', info.departamentos], ['Provincias', info.provincias], ['Distritos', info.distritos], ['Relación', info.relacion], ['Cadena', info.cadena], ['Prórrogas', txt(info.nivelProrroga || '')], ['RDS', info.rds],
      ['Acciones a realizar según exposición de motivos', info.motivos || '']
    ];
    doc.autoTable({ startY:49, body:generales, theme:'grid', styles:{ fontSize:6.5, cellPadding:1, overflow:'linebreak', valign:'top' }, columnStyles:{ 0:{ fontStyle:'bold', fillColor:[221,235,247], cellWidth:58 }, 1:{ cellWidth:214 } }, margin:{ left:11, right:11 } });
    let y = doc.lastAutoTable.finalY + 4;
    const head = [['N° reunión','Fecha reunión','Programa','Tipo','Código','Acciones específicas','Unidad','Meta prog.','Plazo','F. inicio','F. fin','Meta ejec.','% avance','Comentarios']];
    info.secciones.filter(s => s.key !== 'otros' || s.filas.length).forEach(sec => {
      if (y > 175) { doc.addPage(); y = 12; }
      doc.setFont('helvetica','bold'); doc.setFontSize(8); doc.setTextColor(...azul); doc.text(sec.titulo, 8, y); y += 2;
      const body = sec.filas.length ? sec.filas.map(f => [reunion.numeroReunion, fechaMostrar(reunion.fechaReunion), f.programa, f.tipo, f.codigo, f.detalle, f.unidad, f.metaProgramada, f.plazo, fechaMostrar(f.inicio), fechaMostrar(f.fin), f.metaEjecutada, f.avance, f.descripcion]) : [['Sin acciones registradas para esta sección.','','','','','','','','','','','','','']];
      doc.autoTable({ startY:y, head, body, theme:'grid', headStyles:{ fillColor:azul, textColor:[255,255,255], halign:'center', valign:'middle', fontSize:5.3 }, styles:{ fontSize:5.1, cellPadding:0.55, overflow:'linebreak', valign:'top', lineColor:[90,90,90], lineWidth:0.1 }, columnStyles:{ 0:{cellWidth:17},1:{cellWidth:16},2:{cellWidth:21},3:{cellWidth:24},4:{cellWidth:16},5:{cellWidth:50},6:{cellWidth:14},7:{cellWidth:12},8:{cellWidth:10},9:{cellWidth:14},10:{cellWidth:14},11:{cellWidth:12},12:{cellWidth:10},13:{cellWidth:38} }, margin:{ left:6, right:6 }, didDrawPage: () => { doc.setFontSize(6); doc.setTextColor(100); doc.text(`Exportado desde DEE MIDIS · ${fechaHora()}`, 8, 204); } });
      y = doc.lastAutoTable.finalY + 5;
    });
    doc.save(nombreArchivo(d,'pdf',reunion));
  }

  const exportExcelAnterior = window.exportarDSExcel;
  const exportPDFAnterior = window.exportarDSPDF;
  window.exportarDSExcel = function(id){ return abrirModalExportacion(id, 'excel'); };
  window.exportarDSPDF = function(id){ return abrirModalExportacion(id, 'pdf'); };
  try { exportarDSExcel = window.exportarDSExcel; exportarDSPDF = window.exportarDSPDF; } catch {}

  document.addEventListener('click', function(e){
    const excelBtn = e.target.closest('#btnExportListadoExcel');
    const pdfBtn = e.target.closest('#btnPrintListado');
    if (!excelBtn && !pdfBtn) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    const dsId = q('exportDs')?.value || q('accionDs')?.value || '';
    if (!dsId) return alert('Seleccione un Decreto Supremo para exportar.');
    abrirModalExportacion(dsId, excelBtn ? 'excel' : 'pdf');
  }, true);

  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
      crearModal();
      console.info('DEE MIDIS cierre aplicado:', VERSION_CIERRE);
    }, 300);
  });
})();

// ================= CIERRE FINAL v45.1 - EXPORTACIÓN SIN CAMPOS INTERNOS =================
(function(){
  const VERSION_CIERRE = 'v46-exportacion-tipo-accion-clasificada';
  const $id = (id) => document.getElementById(id);
  const esc = (v) => (typeof escapeHtml === 'function' ? escapeHtml(v) : String(v ?? ''));
  const escAttr = (v) => (typeof escapeHtmlAttr === 'function' ? escapeHtmlAttr(v) : esc(v));
  const norm = (v) => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toUpperCase();
  const txt = (v) => String(v ?? '').trim();
  let exportacionLimpiaPendiente = { dsId:'', tipo:'' };

  function fechaHoraLocal(){
    const d = new Date();
    const p = n => String(n).padStart(2,'0');
    return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }
  function fechaMostrar(v){
    if (!v) return '';
    const s = String(v);
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
      const [y,m,d] = s.slice(0,10).split('-');
      return `${d}/${m}/${y}`;
    }
    return s;
  }
  function valor(obj, ...keys){
    for (const k of keys) {
      const v = obj?.[k];
      if (v !== undefined && v !== null && String(v).trim() !== '') return v;
    }
    return '';
  }
  function getDecretos(){
    try {
      const base = typeof cargarDecretosLocales === 'function' ? cargarDecretosLocales() : JSON.parse(localStorage.getItem('decretos') || '[]');
      return (Array.isArray(base) ? base : []).map(d => typeof normalizarDecreto === 'function' ? normalizarDecreto(d) : d).filter(Boolean);
    } catch { return []; }
  }
  function getDecreto(id){
    return getDecretos().find(d => String(d.id) === String(id)) || null;
  }
  function getAcciones(){
    try { return typeof cargarAccionesLocales === 'function' ? cargarAccionesLocales() : JSON.parse(localStorage.getItem('accionesDS') || '[]'); }
    catch { return []; }
  }
  function tituloDS(d){
    let s = typeof formatearNumeroDS === 'function' ? formatearNumeroDS(d) : `DS N.° ${d?.numero || ''}-${d?.anio || ''}-PCM`;
    s = s.replace(/-PCM-\d{4}-PCM\b/gi, '-PCM');
    s = s.replace(/-(\d{4})-PCM-\1-PCM\b/gi, '-$1-PCM');
    return s.replace(/^DS\s*N\.°/i, 'D.S. N°').trim();
  }
  function numeroDSLimpio(d){
    return tituloDS(d).replace(/^D\.S\.\s*N°\s*/i,'').replace(/[^0-9A-Za-zÁÉÍÓÚÜÑáéíóúüñ-]+/g,'_');
  }
  function nombreArchivo(d, ext){
    return `DS_${numeroDSLimpio(d)}.${ext}`;
  }
  function reunionKey(numero, fecha){
    return `${norm(numero)}|${String(fecha || '').slice(0,10)}`;
  }
  function accionesDelDS(d){
    return getAcciones().filter(a => String(valor(a,'dsId','ds_id')) === String(d?.id));
  }
  function reunionesDelDS(d){
    const mapa = new Map();
    const agregar = (numero, fecha) => {
      numero = txt(numero); fecha = String(fecha || '').slice(0,10);
      if (!numero || !fecha) return;
      const key = reunionKey(numero, fecha);
      if (!mapa.has(key)) mapa.set(key, { key, numeroReunion: numero, fechaReunion: fecha });
    };
    if (Array.isArray(d?.rdsReuniones)) d.rdsReuniones.forEach(r => agregar(valor(r,'numeroReunion','numero_reunion'), valor(r,'fechaReunion','fecha_reunion')));
    agregar(valor(d,'numeroReunion','numero_reunion'), valor(d,'fechaReunion','fecha_reunion'));
    accionesDelDS(d).forEach(a => agregar(valor(a,'numeroReunion','numero_reunion'), valor(a,'fechaReunion','fecha_reunion')));
    return [...mapa.values()];
  }
  function accionesDeReunion(d, reunion){
    const k = reunionKey(reunion.numeroReunion, reunion.fechaReunion);
    return accionesDelDS(d).filter(a => reunionKey(valor(a,'numeroReunion','numero_reunion'), valor(a,'fechaReunion','fecha_reunion')) === k);
  }
  function clasificarTipo(tipo){
    const t = norm(tipo);
    if (t.includes('PREPARACION') || t.includes('PREVENCION')) return 'preparacion';
    if (t.includes('RESPUESTA') || t.includes('ATENCION')) return 'respuesta';
    if (t.includes('REHABILITACION') || t.includes('RESTABLECIMIENTO') || t.includes('NORMALIZACION')) return 'rehabilitacion';
    return '';
  }
  function filaAccion(a){
    const metaProg = Number(valor(a,'metaProgramada','meta_programada') || 0);
    const metaEjec = Number(valor(a,'metaEjecutada','meta_ejecutada') || 0);
    let avance = txt(valor(a,'avance'));
    if (!avance && metaProg > 0) avance = `${Math.min(100, Math.round((metaEjec/metaProg)*100))}%`;
    return {
      programa: valor(a,'programaNacional','programa'),
      tipo: valor(a,'tipoAccion','tipo'),
      codigo: valor(a,'codigoAccion','codigo'),
      detalle: valor(a,'detalle','accion','acciones'),
      unidad: valor(a,'unidadMedida','unidad'),
      metaProgramada: valor(a,'metaProgramada','meta_programada'),
      plazo: valor(a,'plazoDias','plazo'),
      inicio: valor(a,'fechaInicio','fecha_inicio'),
      fin: valor(a,'fechaFinal','fecha_final'),
      metaEjecutada: valor(a,'metaEjecutada','meta_ejecutada'),
      avance,
      descripcion: valor(a,'descripcionActividades','descripcion')
    };
  }
  function datosReporteLimpio(d, reunion){
    const acciones = accionesDeReunion(d, reunion).map(filaAccion);
    const secciones = [
      { key:'preparacion', titulo:'ACCIONES DE PREPARACIÓN (Solo DEE por peligro inminente)', filas:[] },
      { key:'respuesta', titulo:'ACCIONES DE RESPUESTA', filas:[] },
      { key:'rehabilitacion', titulo:'ACCIONES DE REHABILITACIÓN', filas:[] }
    ];
    acciones.forEach(f => {
      const key = clasificarTipo(f.tipo);
      const sec = secciones.find(s => s.key === key);
      if (sec) sec.filas.push(f);
    });
    const numeroReunionTitulo = txt(reunion?.numeroReunion || '');
    const tituloBaseDS = tituloDS(d);
    return {
      titulo: tituloBaseDS,
      tituloConReunion: numeroReunionTitulo ? `${numeroReunionTitulo} - ${tituloBaseDS}` : tituloBaseDS,
      numeroReunion: numeroReunionTitulo,
      fechaReunion: reunion?.fechaReunion || '',
      fechaReporte: fechaMostrar(new Date().toISOString()),
      tipo: d?.peligro || '',
      peligroEvento: d?.tipo_peligro || '',
      motivos: d?.motivos || d?.exposicion_motivos || '',
      secciones: secciones.filter(s => s.filas.length > 0),
      totalAcciones: secciones.reduce((total, s) => total + s.filas.length, 0)
    };
  }
  function crearModalExportacionLimpia(){
    if ($id('modalExportarReunionDSLimpio')) return;
    const div = document.createElement('div');
    div.className = 'modal fade';
    div.id = 'modalExportarReunionDSLimpio';
    div.tabIndex = -1;
    div.innerHTML = `
      <div class="modal-dialog modal-md modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">Seleccionar reunión para exportar</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Cerrar"></button>
          </div>
          <div class="modal-body">
            <div id="exportReunionInfoLimpio" class="alert alert-info py-2 small mb-3"></div>
            <label class="form-label">Número de reunión</label>
            <select id="exportReunionSelectLimpio" class="form-select"></select>
          </div>
          <div class="modal-footer">
            <button id="btnGenerarExportReunionLimpio" type="button" class="btn btn-primary">Generar</button>
            <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Cancelar</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(div);
    $id('btnGenerarExportReunionLimpio')?.addEventListener('click', confirmarExportacionLimpia);
  }
  function abrirModalExportacionLimpia(id, tipo){
    const d = getDecreto(id);
    if (!d) return alert('Seleccione un Decreto Supremo válido para exportar.');
    const reuniones = reunionesDelDS(d);
    if (!reuniones.length) return alert('El Decreto Supremo seleccionado no tiene reuniones registradas para exportar.');
    crearModalExportacionLimpia();
    exportacionLimpiaPendiente = { dsId:String(id), tipo };
    const info = $id('exportReunionInfoLimpio');
    const sel = $id('exportReunionSelectLimpio');
    if (info) info.innerHTML = `<strong>${esc(tituloDS(d))}</strong><br>Tiene ${reuniones.length} reunión${reuniones.length === 1 ? '' : 'es'} registrada${reuniones.length === 1 ? '' : 's'}. Seleccione la reunión que desea visualizar/exportar.`;
    if (sel) {
      sel.innerHTML = reuniones.map(r => `<option value="${escAttr(r.key)}">${esc(r.numeroReunion)} · ${esc(fechaMostrar(r.fechaReunion))}</option>`).join('');
      sel.dataset.reuniones = JSON.stringify(reuniones);
    }
    const btn = $id('btnGenerarExportReunionLimpio');
    if (btn) btn.textContent = tipo === 'excel' ? 'Generar Excel' : 'Generar PDF';
    const modal = $id('modalExportarReunionDSLimpio');
    if (modal && window.bootstrap?.Modal) bootstrap.Modal.getOrCreateInstance(modal).show();
  }
  async function confirmarExportacionLimpia(){
    const d = getDecreto(exportacionLimpiaPendiente.dsId);
    const sel = $id('exportReunionSelectLimpio');
    if (!d || !sel) return;
    let reuniones = [];
    try { reuniones = JSON.parse(sel.dataset.reuniones || '[]'); } catch {}
    const reunion = reuniones.find(r => r.key === sel.value);
    if (!reunion) return alert('Seleccione una reunión registrada válida.');
    const acciones = accionesDeReunion(d, reunion);
    if (!acciones.length) return alert('La reunión seleccionada no tiene acciones registradas para exportar.');
    const modal = $id('modalExportarReunionDSLimpio');
    if (modal && window.bootstrap?.Modal) bootstrap.Modal.getOrCreateInstance(modal).hide();
    if (exportacionLimpiaPendiente.tipo === 'excel') await generarExcelLimpio(d, reunion);
    else generarPDFLimpio(d, reunion);
  }
  function descargarBlob(blob, filename){
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function estiloTituloExcel(cell){
    cell.font = { bold:true, size:12, color:{ argb:'FF1F4E79' } };
    cell.alignment = { horizontal:'center', vertical:'middle', wrapText:true };
  }
  function estiloHeaderExcel(row){
    row.eachCell(cell => {
      cell.font = { bold:true, color:{ argb:'FFFFFFFF' }, size:9 };
      cell.fill = { type:'pattern', pattern:'solid', fgColor:{ argb:'FF1F4E79' } };
      cell.alignment = { horizontal:'center', vertical:'middle', wrapText:true };
      cell.border = { top:{style:'thin'}, left:{style:'thin'}, bottom:{style:'thin'}, right:{style:'thin'} };
    });
  }
  function estiloCeldaExcel(cell){
    cell.alignment = { vertical:'top', wrapText:true };
    cell.border = { top:{style:'thin'}, left:{style:'thin'}, bottom:{style:'thin'}, right:{style:'thin'} };
  }
  async function generarExcelLimpio(d, reunion){
    if (!window.ExcelJS) return alert('No se cargó ExcelJS.');
    const info = datosReporteLimpio(d, reunion);
    if (!info.totalAcciones) return alert('No hay acciones registradas para exportar.');
    const wb = new ExcelJS.Workbook();
    wb.creator = 'DEE MIDIS'; wb.created = new Date();
    const ws = wb.addWorksheet(`DS_${numeroDSLimpio(d)}`.replace(/[\\/*?:\[\]]/g,'_').slice(0,31));
    ws.pageSetup = { paperSize:9, orientation:'landscape', fitToPage:true, fitToWidth:1, fitToHeight:0, horizontalCentered:true };
    ws.pageMargins = { left:0.25, right:0.25, top:0.35, bottom:0.35, header:0.15, footer:0.15 };
    ws.columns = [{width:24},{width:24},{width:18},{width:58},{width:16},{width:14},{width:12},{width:16},{width:16},{width:14},{width:12},{width:42}];
    let r = 1;
    [
      'MATRIZ EJECUTIVA DE SEGUIMIENTO DE ACCIONES EN LA DECLARATORIA DE ESTADO DE EMERGENCIA',
      info.tituloConReunion || info.titulo,
      'SECTOR: MINISTERIO DE DESARROLLO E INCLUSIÓN SOCIAL',
      `FECHA DE REPORTE: ${info.fechaReporte}`
    ].forEach(v => { ws.mergeCells(`A${r}:L${r}`); ws.getCell(`A${r}`).value = v; estiloTituloExcel(ws.getCell(`A${r}`)); r++; });
    r++;
    const generales = [
      ['Número de Decreto Supremo', info.titulo],
      ['Tipo', info.tipo],
      ['Peligro o evento', info.peligroEvento]
    ].filter(row => txt(row[1]));
    if (generales.length) {
      ws.mergeCells(`A${r}:L${r}`); ws.getCell(`A${r}`).value = 'INFORMACIÓN GENERAL DEL DECRETO SUPREMO'; estiloHeaderExcel(ws.getRow(r)); r++;
      generales.forEach(([k,v]) => { ws.mergeCells(`B${r}:L${r}`); ws.getCell(`A${r}`).value = k; ws.getCell(`B${r}`).value = v; estiloCeldaExcel(ws.getCell(`A${r}`)); estiloCeldaExcel(ws.getCell(`B${r}`)); ws.getCell(`A${r}`).font = { bold:true }; r++; });
      r++;
    }
    if (txt(info.motivos)) {
      ws.mergeCells(`B${r}:L${r}`); ws.getCell(`A${r}`).value = 'ACCIONES A REALIZAR POR EL SECTOR SEGÚN LA EXPOSICIÓN DE MOTIVOS'; ws.getCell(`B${r}`).value = info.motivos; estiloCeldaExcel(ws.getCell(`A${r}`)); estiloCeldaExcel(ws.getCell(`B${r}`)); ws.getCell(`A${r}`).font = { bold:true }; ws.getRow(r).height = 42; r += 2;
    }
    const headers = ['Programa Nacional','Tipo de acción','Código de acción','Acciones específicas programadas y ejecutadas','Unidad de medida','Meta programada','Plazo (días)','F. inicio','F. final','Meta ejecutada','% Avance','Comentarios / descripción'];
    info.secciones.forEach(sec => {
      ws.mergeCells(`A${r}:L${r}`); ws.getCell(`A${r}`).value = sec.titulo; estiloHeaderExcel(ws.getRow(r)); r++;
      ws.getRow(r).values = headers; estiloHeaderExcel(ws.getRow(r)); r++;
      sec.filas.forEach(f => { ws.getRow(r).values = [f.programa, f.tipo, f.codigo, f.detalle, f.unidad, f.metaProgramada, f.plazo, fechaMostrar(f.inicio), fechaMostrar(f.fin), f.metaEjecutada, f.avance, f.descripcion]; ws.getRow(r).eachCell(estiloCeldaExcel); r++; });
      r++;
    });
    const buf = await wb.xlsx.writeBuffer();
    descargarBlob(new Blob([buf], { type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), nombreArchivo(d,'xlsx'));
  }
  function generarPDFLimpio(d, reunion){
    if (!window.jspdf?.jsPDF) return alert('No se cargó jsPDF.');
    const info = datosReporteLimpio(d, reunion);
    if (!info.totalAcciones) return alert('No hay acciones registradas para exportar.');
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation:'landscape', unit:'mm', format:'a4' });
    const azul = [31,78,121];
    doc.setFont('helvetica','bold'); doc.setTextColor(...azul); doc.setFontSize(12);
    doc.text('MATRIZ EJECUTIVA DE SEGUIMIENTO DE ACCIONES EN LA DECLARATORIA DE ESTADO DE EMERGENCIA', 148.5, 12, { align:'center' });
    doc.setFontSize(11); doc.text(info.tituloConReunion || info.titulo, 148.5, 19, { align:'center' });
    doc.setTextColor(0,0,0); doc.setFontSize(9);
    doc.text('SECTOR: MINISTERIO DE DESARROLLO E INCLUSIÓN SOCIAL', 148.5, 26, { align:'center' });
    doc.text(`FECHA DE REPORTE: ${info.fechaReporte}`, 148.5, 32, { align:'center' });
    const generales = [
      ['Número de Decreto Supremo', info.titulo],
      ['Tipo', info.tipo],
      ['Peligro o evento', info.peligroEvento]
    ].filter(row => txt(row[1]));
    let y = 38;
    if (generales.length) {
      doc.autoTable({ startY:y, body:generales, theme:'grid', styles:{ fontSize:7, cellPadding:1, overflow:'linebreak', valign:'top' }, columnStyles:{ 0:{ fontStyle:'bold', fillColor:[221,235,247], cellWidth:58 }, 1:{ cellWidth:214 } }, margin:{ left:11, right:11 } });
      y = doc.lastAutoTable.finalY + 4;
    }
    if (txt(info.motivos)) {
      doc.autoTable({ startY:y, body:[['Acciones a realizar según exposición de motivos', info.motivos]], theme:'grid', styles:{ fontSize:6.5, cellPadding:1, overflow:'linebreak', valign:'top' }, columnStyles:{ 0:{ fontStyle:'bold', fillColor:[221,235,247], cellWidth:58 }, 1:{ cellWidth:214 } }, margin:{ left:11, right:11 } });
      y = doc.lastAutoTable.finalY + 4;
    }
    const head = [['Programa','Tipo','Código','Acciones específicas','Unidad','Meta prog.','Plazo','F. inicio','F. fin','Meta ejec.','% avance','Comentarios']];
    info.secciones.forEach(sec => {
      if (y > 175) { doc.addPage(); y = 12; }
      doc.setFont('helvetica','bold'); doc.setFontSize(8); doc.setTextColor(...azul); doc.text(sec.titulo, 8, y); y += 2;
      const body = sec.filas.map(f => [f.programa, f.tipo, f.codigo, f.detalle, f.unidad, f.metaProgramada, f.plazo, fechaMostrar(f.inicio), fechaMostrar(f.fin), f.metaEjecutada, f.avance, f.descripcion]);
      doc.autoTable({ startY:y, head, body, theme:'grid', headStyles:{ fillColor:azul, textColor:[255,255,255], halign:'center', valign:'middle', fontSize:5.6 }, styles:{ fontSize:5.3, cellPadding:0.6, overflow:'linebreak', valign:'top', lineColor:[90,90,90], lineWidth:0.1 }, columnStyles:{ 0:{cellWidth:25},1:{cellWidth:28},2:{cellWidth:18},3:{cellWidth:62},4:{cellWidth:16},5:{cellWidth:13},6:{cellWidth:11},7:{cellWidth:16},8:{cellWidth:16},9:{cellWidth:13},10:{cellWidth:12},11:{cellWidth:45} }, margin:{ left:6, right:6 }, didDrawPage: () => { doc.setFontSize(6); doc.setTextColor(100); doc.text(`Exportado desde DEE MIDIS · ${fechaHoraLocal()}`, 8, 204); } });
      y = doc.lastAutoTable.finalY + 5;
    });
    doc.save(nombreArchivo(d,'pdf'));
  }

  window.exportarDSExcel = function(id){ return abrirModalExportacionLimpia(id, 'excel'); };
  window.exportarDSPDF = function(id){ return abrirModalExportacionLimpia(id, 'pdf'); };
  try { exportarDSExcel = window.exportarDSExcel; exportarDSPDF = window.exportarDSPDF; } catch {}

  document.addEventListener('click', function(e){
    const excelBtn = e.target.closest('#btnExportListadoExcel');
    const pdfBtn = e.target.closest('#btnPrintListado');
    const rowExcel = e.target.closest('[data-export-excel-ds], .btnExportDSExcel, .btn-export-ds-excel');
    const rowPdf = e.target.closest('[data-export-pdf-ds], .btnExportDSPDF, .btn-export-ds-pdf');
    if (!excelBtn && !pdfBtn && !rowExcel && !rowPdf) return;
    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
    const dsId = rowExcel?.dataset?.exportExcelDs || rowPdf?.dataset?.exportPdfDs || rowExcel?.dataset?.dsId || rowPdf?.dataset?.dsId || $id('exportDs')?.value || $id('accionDs')?.value || '';
    if (!dsId) return alert('Seleccione un Decreto Supremo para exportar.');
    abrirModalExportacionLimpia(dsId, (excelBtn || rowExcel) ? 'excel' : 'pdf');
  }, true);

  document.addEventListener('DOMContentLoaded', () => setTimeout(() => {
    crearModalExportacionLimpia();
    console.info('DEE MIDIS cierre aplicado:', VERSION_CIERRE);
  }, 300));
})();


// ================= CIERRE FINAL LOGIN EJECUTIVO v48 =================
(function () {
  function initLoginVisualHelpers() {
    const pass = document.getElementById('loginPass');
    const toggle = document.getElementById('btnToggleLoginPassword');
    if (!pass || !toggle || toggle.dataset.bound === '1') return;

    toggle.dataset.bound = '1';
    toggle.addEventListener('click', function () {
      const mostrar = pass.type === 'password';
      pass.type = mostrar ? 'text' : 'password';
      toggle.textContent = mostrar ? 'Ocultar' : 'Mostrar';
      toggle.setAttribute('aria-label', mostrar ? 'Ocultar contraseña' : 'Mostrar contraseña');
      pass.focus();
    });
  }

  document.addEventListener('DOMContentLoaded', initLoginVisualHelpers);
  setTimeout(initLoginVisualHelpers, 300);
})();
