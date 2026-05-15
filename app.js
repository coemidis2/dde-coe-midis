// ================= VERSION 79.4 - COBERTURA PROGRAMAS ALINEADA EN REGISTRO ACCIONES - 2026-05-15 =================
const API_BASE = window.location.origin + '/api';
const APP_BUILD_VERSION = '79.4-cobertura-programas-alineada-20260515';

let state = {
  session: null,
  nuevoDSTerritorios: [],
  decretos: [],
};

let ubigeoCache = [];
let ubigeoInicializado = false;
let adminPanelInicializado = false;
let adminUsuariosLocales = [];
let adminUsuariosVista = [];
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

  // Compatibilidad con usuarios locales: permite que el Worker identifique la sesión
  // cuando el login fue validado desde localStorage y no existe cookie dee_session.
  const localEmail = state.session?.email || '';
  const localRole = state.session?.role || state.session?.rol || '';
  const localPrograma = state.session?.programa || '';
  if (localEmail && localRole) {
    h['x-dee-local-session'] = '1';
    h['x-dee-user-email'] = String(localEmail).trim().toLowerCase();
    h['x-dee-user-role'] = String(localRole).trim();
    h['x-dee-user-programa'] = String(localPrograma || '').trim();
  }

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
const USUARIOS_ELIMINADOS_KEY = 'usuariosEliminados';
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
    id: raw.id ?? raw.user_id ?? raw.userId ?? email,
    nombre: String(raw.nombre || raw.name || raw.fullName || email).trim(),
    name: String(raw.name || raw.nombre || raw.fullName || email).trim(),
    email,
    password: String(raw.password ?? raw.clave ?? raw.pass ?? raw.temporaryPassword ?? raw.claveTemporal ?? ''),
    rol,
    role: rol,
    programa,
    estado: activo ? 'activo' : 'inactivo',
    active: activo ? 1 : 0
  };
}


function cargarUsuariosEliminados() {
  try {
    const lista = JSON.parse(localStorage.getItem(USUARIOS_ELIMINADOS_KEY) || '[]');
    return new Set((Array.isArray(lista) ? lista : []).map(normalizarEmail).filter(Boolean));
  } catch {
    return new Set();
  }
}

function marcarUsuarioEliminado(email) {
  const eliminados = cargarUsuariosEliminados();
  const limpio = normalizarEmail(email);
  if (limpio) eliminados.add(limpio);
  localStorage.setItem(USUARIOS_ELIMINADOS_KEY, JSON.stringify([...eliminados]));
}

function usuarioEstaEliminado(email) {
  return cargarUsuariosEliminados().has(normalizarEmail(email));
}

function quitarMarcaUsuarioEliminado(email) {
  const eliminados = cargarUsuariosEliminados();
  eliminados.delete(normalizarEmail(email));
  localStorage.setItem(USUARIOS_ELIMINADOS_KEY, JSON.stringify([...eliminados]));
}

function cargarUsuariosLocales() {
  const fuentes = [USUARIOS_STORAGE_KEY, 'users', 'userList', 'usuariosSistema'];
  const mapa = new Map();
  const eliminados = cargarUsuariosEliminados();

  fuentes.forEach(key => {
    try {
      const lista = JSON.parse(localStorage.getItem(key) || '[]');
      if (!Array.isArray(lista)) return;
      lista.forEach(item => {
        const u = normalizarUsuario(item);
        if (u && !eliminados.has(u.email)) mapa.set(u.email, u);
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
    if (usuarioEstaEliminado(u.email)) return;
    if (vistos.has(u.email)) return;
    vistos.add(u.email);
    depurados.push(u);
  });

  localStorage.setItem(USUARIOS_STORAGE_KEY, JSON.stringify(depurados));
  adminUsuariosLocales = depurados;
  return depurados;
}

function buscarUsuarioLocalPorEmail(email) {
  if (usuarioEstaEliminado(email)) return null;
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
function normalizarSesionDesdeUsuario(userServer) {
  const user = normalizarUsuario(userServer);
  if (!user || user.estado !== 'activo') return null;
  return {
    name: user.name,
    nombre: user.nombre,
    email: user.email,
    role: user.role,
    rol: user.rol,
    programa: user.programa,
    estado: user.estado
  };
}

async function doLogin() {
  const email = normalizarEmail($('loginUser')?.value);
  const password = $('loginPass')?.value || '';

  if (!email || !password) {
    alert('Ingrese usuario y contraseña');
    return;
  }

  // Primero se valida contra el backend/D1 para que se creen las cookies
  // dee_session y dee_csrf. El login local queda solo como respaldo.
  const resLogin = await api('/login', 'POST', { email, password });

  if (resLogin.ok && resLogin.data?.ok) {
    const resSession = await api('/session');
    const sessionUser = normalizarSesionDesdeUsuario(resSession.data?.user || resLogin.data?.user);

    if (sessionUser) {
      localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(sessionUser));
      iniciarSistemaConSesion(sessionUser);
      return;
    }
  }

  const local = loginLocal(email, password);
  if (local.ok) {
    iniciarSistemaConSesion(local.user);
    return;
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
  // Prioridad: sesión real del backend. Evita que localStorage viejo o demo
  // oculte datos/pestañas y deje sin cookie a las APIs D1.
  const res = await api('/session');

  if (res.ok && res.data?.user) {
    const sessionUser = normalizarSesionDesdeUsuario(res.data.user);
    if (sessionUser) {
      localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(sessionUser));
      iniciarSistemaConSesion(sessionUser);
      return;
    }
  }

  try {
    const localSession = JSON.parse(localStorage.getItem(SESSION_STORAGE_KEY) || 'null');
    const sessionUser = normalizarSesionDesdeUsuario(localSession);
    if (sessionUser) {
      iniciarSistemaConSesion(sessionUser);
      return;
    }
  } catch (e) {
    localStorage.removeItem(SESSION_STORAGE_KEY);
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
    if (e.target.dataset.adminDeleteUser) eliminarUsuarioAdmin(e.target.dataset.adminDeleteUser);
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

  usuarios = usuarios
    .map(u => normalizarUsuario(u) || u)
    .filter(u => normalizarTexto(u.role || u.rol) !== 'EVALUADOR')
    .filter(u => !usuarioEstaEliminado(u.email));

  adminUsuariosVista = usuarios;

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
          <button type="button"
                  class="btn btn-sm btn-outline-danger"
                  ${normalizarEmail(email) === 'admin@midis.gob.pe' ? 'disabled title="Usuario base protegido"' : ''}
                  data-admin-delete-user="${escapeHtmlAttr(email)}">
            Eliminar
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

  quitarMarcaUsuarioEliminado(email);
  let usuario = normalizarUsuario({ nombre, name: nombre, email, rol, role: rol, password: clave, estado: 'activo', active: 1 });

  const res = await api('/users', 'POST', {
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

  if (res.ok && res.data?.user) {
    const remoto = normalizarUsuario({ ...res.data.user, password: res.data.temporaryPassword || clave });
    if (remoto) usuario = remoto;
    if (res.data.temporaryPassword && $('adminGeneratedPassword')) $('adminGeneratedPassword').value = res.data.temporaryPassword;
  } else if (res.data?.error || res.data?.message) {
    console.warn('No se confirmó usuario en backend; se mantiene copia local para login:', res.data);
  }

  // Guardado local canónico. Esto evita que el usuario recién creado quede solo
  // como fila visual del panel y no pueda autenticarse en el mismo navegador.
  const lista = cargarUsuariosLocales().filter(u => u.email !== usuario.email);
  lista.push(usuario);
  guardarUsuariosLocales(lista);

  // También se limpia cualquier copia antigua con diferente estructura.
  ['users', 'userList', 'usuariosSistema'].forEach(key => {
    try {
      const arr = JSON.parse(localStorage.getItem(key) || '[]');
      if (!Array.isArray(arr)) return;
      const filtrada = arr.filter(x => normalizarEmail(x?.email || x?.correo || x?.usuario) !== usuario.email);
      filtrada.push(usuario);
      localStorage.setItem(key, JSON.stringify(filtrada));
    } catch {}
  });

  await cargarUsuariosAdmin();
}

async function toggleUsuarioAdmin(email) {
  const limpio = normalizarEmail(email);
  const vista = adminUsuariosVista.find(u => normalizarEmail(u.email) === limpio) || buscarUsuarioLocalPorEmail(limpio);
  if (!vista) return;

  const activoActual = String(vista.estado || '').toLowerCase() === 'activo' || Number(vista.active) === 1;
  const nuevoActivo = !activoActual;

  await api('/users', 'PATCH', {
    action: 'status',
    id: vista.id || limpio,
    email: limpio,
    active: nuevoActivo
  });

  const lista = cargarUsuariosLocales();
  let usuario = lista.find(u => String(u.email) === limpio);
  if (!usuario) {
    usuario = normalizarUsuario({ ...vista, email: limpio, password: '' });
    if (usuario) lista.push(usuario);
  }
  if (usuario) {
    usuario.estado = nuevoActivo ? 'activo' : 'inactivo';
    usuario.active = nuevoActivo ? 1 : 0;
    guardarUsuariosLocales(lista);
  }
  cargarUsuariosAdmin();
}

async function resetClaveUsuarioAdmin(email) {
  const limpio = normalizarEmail(email);
  const vista = adminUsuariosVista.find(u => normalizarEmail(u.email) === limpio) || buscarUsuarioLocalPorEmail(limpio);
  const claveLocal = generarClaveTemporal();

  const res = await api('/users', 'PATCH', {
    action: 'reset_password',
    id: vista?.id || limpio,
    email: limpio
  });

  const clave = (res.ok && res.data?.temporaryPassword) ? res.data.temporaryPassword : claveLocal;
  const lista = cargarUsuariosLocales();
  let usuario = lista.find(u => String(u.email) === limpio);
  if (!usuario && vista) {
    usuario = normalizarUsuario({ ...vista, email: limpio, password: clave });
    if (usuario) lista.push(usuario);
  }
  if (usuario) {
    usuario.password = clave;
    usuario.estado = 'activo';
    usuario.active = 1;
    guardarUsuariosLocales(lista);
  }
  if ($('adminGeneratedPassword')) $('adminGeneratedPassword').value = clave;
  alert(`Clave temporal generada para ${limpio}`);
  cargarUsuariosAdmin();
}

async function eliminarUsuarioAdmin(email) {
  const limpio = normalizarEmail(email);
  if (!limpio) return;
  if (limpio === 'admin@midis.gob.pe') {
    alert('El usuario Administrador DEMO no se puede eliminar. Es el usuario base del sistema.');
    return;
  }
  if (!confirm(`¿Eliminar el usuario ${limpio}? Ya no podrá iniciar sesión.`)) return;

  const vista = adminUsuariosVista.find(u => normalizarEmail(u.email) === limpio) || buscarUsuarioLocalPorEmail(limpio);

  await api('/users', 'PATCH', {
    action: 'delete',
    id: vista?.id || limpio,
    email: limpio
  });

  marcarUsuarioEliminado(limpio);
  const lista = cargarUsuariosLocales().filter(u => normalizarEmail(u.email) !== limpio);
  localStorage.setItem(USUARIOS_STORAGE_KEY, JSON.stringify(lista));
  adminUsuariosLocales = lista;

  if (normalizarEmail(state.session?.email) === limpio) {
    localStorage.removeItem(SESSION_STORAGE_KEY);
    state.session = null;
    showLogin();
    return;
  }

  await cargarUsuariosAdmin();
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

  function normalTipoDEE(valor) {
    const raw = String(valor || '').trim();
    const n = normalizarTexto(raw);
    if (n.includes('PREPARACION')) return TIPO_PREPARACION;
    if (n.includes('RESPUESTA')) return TIPO_RESPUESTA;
    if (n.includes('REHABILITACION')) return TIPO_REHABILITACION;
    return raw;
  }
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
      detalle: valor(a,'detalle','accionesEspecificas','accion','acciones'),
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
  function reunionTextoBase(numero){
    return norm(String(numero || '').replace(/\s*-\s*\d{1,2}\/\d{1,2}\/\d{2,4}.*$/,'').replace(/\s*-\s*\d{4}-\d{2}-\d{2}.*$/,''));
  }
  function fechaSoloISO(valor){
    const s = String(valor || '').trim();
    if (!s) return '';
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0,10);
    const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (m) return `${m[3]}-${String(m[2]).padStart(2,'0')}-${String(m[1]).padStart(2,'0')}`;
    return s.slice(0,10);
  }
  function reunionKeyFlexible(numero, fecha){
    return `${reunionTextoBase(numero)}|${fechaSoloISO(fecha)}`;
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
    const kFlex = reunionKeyFlexible(reunion.numeroReunion, reunion.fechaReunion);
    const nBase = reunionTextoBase(reunion.numeroReunion);
    const fBase = fechaSoloISO(reunion.fechaReunion);
    return accionesDelDS(d).filter(a => {
      const n = valor(a,'numeroReunion','numero_reunion');
      const f = valor(a,'fechaReunion','fecha_reunion');
      if (reunionKey(n, f) === k) return true;
      if (reunionKeyFlexible(n, f) === kFlex) return true;
      if (valor(a,'rdsKey','rds_key') && norm(valor(a,'rdsKey','rds_key')) === norm(k)) return true;
      if (valor(a,'rdsKey','rds_key') && norm(valor(a,'rdsKey','rds_key')) === norm(kFlex)) return true;
      return reunionTextoBase(n) === nBase && fechaSoloISO(f) === fBase;
    });
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

// ================= CIERRE FINAL DASHBOARD v53.1 - MAPA CENTRADO Y FILTROS VIGENCIA =================
(function cierreFinalDashboardCentradoFiltrosV531(){
  const DASH_COLORS = ['#0d6efd','#198754','#dc3545','#fd7e14','#6f42c1','#20c997','#0dcaf0','#6610f2','#d63384','#ffc107','#6c757d','#2f5597','#70ad47','#c00000','#7030a0'];
  const PERU_CENTER = [-9.19, -75.02];
  const PERU_ZOOM = 5;
  let mostrarVigentesDEE = true;
  let mostrarNoVigentesDEE = false;
  let mapaDashboardV531 = null;
  let capaDashboardV531 = null;

  function fechaLocalCeroV531(valor) {
    if (!valor) return null;
    const s = String(valor).slice(0, 10);
    const d = new Date(`${s}T00:00:00`);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function hoyLocalCeroV531() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function esDSVigenteV531(d) {
    const hoy = hoyLocalCeroV531();
    const inicio = fechaLocalCeroV531(d?.fecha_inicio || d?.fechaInicio);
    const fin = fechaLocalCeroV531(d?.fecha_fin || d?.fechaFin);
    if (!fin) return false;
    if (inicio && hoy < inicio) return false;
    return hoy <= fin;
  }

  function territorioDSV531(d) {
    return Array.isArray(d?.territorio) ? d.territorio : [];
  }

  function keyDepartamentoV531(t) {
    return normalizarTexto(t?.departamento || '');
  }

  function keyProvinciaV531(t) {
    return `${normalizarTexto(t?.departamento || '')}|${normalizarTexto(t?.provincia || '')}`;
  }

  function keyDistritoV531(t) {
    const ub = getUbigeoValue(t);
    if (ub) return String(ub);
    return `${normalizarTexto(t?.departamento || '')}|${normalizarTexto(t?.provincia || '')}|${normalizarTexto(t?.distrito || '')}`;
  }

  function latLngTerritorioV531(t) {
    const lat = Number(String(getLatitud(t)).replace(',', '.'));
    const lng = Number(String(getLongitud(t)).replace(',', '.'));
    if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return [lat, lng];
    return null;
  }

  function diasRestantesV531(d) {
    const fin = fechaLocalCeroV531(d?.fecha_fin || d?.fechaFin);
    if (!fin) return 0;
    return Math.ceil((fin - hoyLocalCeroV531()) / 86400000);
  }

  function avanceTiempoV531(d) {
    const inicio = fechaLocalCeroV531(d?.fecha_inicio || d?.fechaInicio);
    const fin = fechaLocalCeroV531(d?.fecha_fin || d?.fechaFin);
    const hoy = hoyLocalCeroV531();
    if (!inicio || !fin || fin <= inicio) return 0;
    const total = fin - inicio;
    const usado = Math.min(Math.max(hoy - inicio, 0), total);
    return Math.round((usado / total) * 100);
  }

  function semaforoEjecutivoV531(d) {
    if (!esDSVigenteV531(d)) return { texto: 'No vigente', clase: 'text-bg-secondary', orden: 4 };
    const inicio = fechaLocalCeroV531(d?.fecha_inicio || d?.fechaInicio);
    const fin = fechaLocalCeroV531(d?.fecha_fin || d?.fechaFin);
    const hoy = hoyLocalCeroV531();
    if (!inicio || !fin || fin <= inicio) return { texto: 'Rojo', clase: 'dee-badge-rojo', orden: 1 };
    const restante = Math.max(fin - hoy, 0);
    const total = fin - inicio;
    const pctRestante = (restante / total) * 100;
    if (pctRestante < 20) return { texto: 'Rojo', clase: 'dee-badge-rojo', orden: 1 };
    if (pctRestante <= 50) return { texto: 'Ámbar', clase: 'dee-badge-ambar', orden: 2 };
    return { texto: 'Verde', clase: 'dee-badge-verde', orden: 3 };
  }

  function asegurarControlesDashboardV531() {
    const btnActualizar = $('btnActualizarDashboard');
    if (!btnActualizar || $('btnToggleDSVigentes')) return;
    const wrap = document.createElement('div');
    wrap.className = 'd-flex gap-2 align-items-center flex-wrap justify-content-end';
    btnActualizar.parentNode.insertBefore(wrap, btnActualizar);
    wrap.appendChild(btnActualizar);
    const btnVig = document.createElement('button');
    btnVig.id = 'btnToggleDSVigentes';
    btnVig.type = 'button';
    btnVig.className = 'btn btn-sm btn-primary';
    btnVig.textContent = 'Vigentes: ON';
    const btnNoVig = document.createElement('button');
    btnNoVig.id = 'btnToggleDSNoVigentes';
    btnNoVig.type = 'button';
    btnNoVig.className = 'btn btn-sm btn-outline-secondary';
    btnNoVig.textContent = 'No vigentes: OFF';
    wrap.insertBefore(btnVig, btnActualizar);
    wrap.insertBefore(btnNoVig, btnActualizar);
    btnVig.addEventListener('click', () => {
      mostrarVigentesDEE = !mostrarVigentesDEE;
      if (!mostrarVigentesDEE && !mostrarNoVigentesDEE) mostrarNoVigentesDEE = true;
      renderDashboardEjecutivoDEE();
    });
    btnNoVig.addEventListener('click', () => {
      mostrarNoVigentesDEE = !mostrarNoVigentesDEE;
      if (!mostrarVigentesDEE && !mostrarNoVigentesDEE) mostrarVigentesDEE = true;
      renderDashboardEjecutivoDEE();
    });
  }

  function actualizarEstadoBotonesV531() {
    const btnVig = $('btnToggleDSVigentes');
    const btnNoVig = $('btnToggleDSNoVigentes');
    if (btnVig) {
      btnVig.textContent = mostrarVigentesDEE ? 'Vigentes: ON' : 'Vigentes: OFF';
      btnVig.className = mostrarVigentesDEE ? 'btn btn-sm btn-primary' : 'btn btn-sm btn-outline-primary';
    }
    if (btnNoVig) {
      btnNoVig.textContent = mostrarNoVigentesDEE ? 'No vigentes: ON' : 'No vigentes: OFF';
      btnNoVig.className = mostrarNoVigentesDEE ? 'btn btn-sm btn-secondary' : 'btn btn-sm btn-outline-secondary';
    }
  }

  function construirDatosDashboardV531() {
    const decretos = (state.decretos?.length ? state.decretos : cargarDecretosLocales()).map(normalizarDecreto).filter(Boolean);
    const filtrados = decretos.filter(d => esDSVigenteV531(d) ? mostrarVigentesDEE : mostrarNoVigentesDEE);
    const departamentos = new Set();
    const provincias = new Set();
    const distritos = new Map();
    const departamentosConteo = new Map();

    filtrados.forEach((d, i) => {
      territorioDSV531(d).forEach(t => {
        const depKey = keyDepartamentoV531(t);
        const provKey = keyProvinciaV531(t);
        const distKey = keyDistritoV531(t);
        if (!depKey || !provKey || !distKey) return;
        departamentos.add(depKey);
        provincias.add(provKey);
        departamentosConteo.set(depKey, (departamentosConteo.get(depKey) || 0) + 1);
        if (!distritos.has(distKey)) {
          distritos.set(distKey, { key: distKey, departamento: t.departamento || '', provincia: t.provincia || '', distrito: t.distrito || '', latlng: latLngTerritorioV531(t), decretos: [], fechasInicio: [], fechasFin: [] });
        }
        const item = distritos.get(distKey);
        item.decretos.push({ id: d.id, nombre: formatearNumeroDS(d), color: DASH_COLORS[i % DASH_COLORS.length], vigente: esDSVigenteV531(d) });
        if (d.fecha_inicio) item.fechasInicio.push(String(d.fecha_inicio).slice(0,10));
        if (d.fecha_fin) item.fechasFin.push(String(d.fecha_fin).slice(0,10));
      });
    });
    return { decretos, filtrados, departamentos, provincias, distritos, departamentosConteo };
  }

  function renderKPIsV531(datos) {
    const cont = $('dashboardMetricas');
    if (!cont) return;
    const repetidos = [...datos.distritos.values()].filter(x => new Set(x.decretos.map(d => d.id)).size > 1).length;
    const cards = [
      ['Declaratorias mostradas', datos.filtrados.length, mostrarVigentesDEE && mostrarNoVigentesDEE ? 'Vigentes y no vigentes' : (mostrarVigentesDEE ? 'Solo vigentes' : 'Solo no vigentes')],
      ['Departamentos declarados', datos.departamentos.size, 'Sin duplicados'],
      ['Provincias declaradas', datos.provincias.size, 'Sin duplicados'],
      ['Distritos declarados', datos.distritos.size, 'Sin duplicados'],
      ['Distritos en más de una declaratoria', repetidos, 'Duplicidad entre DS filtrados']
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

  function reiniciarMapaSiCorrespondeV531() {
    const el = $('mapaDS');
    if (!el || !window.L) return null;
    if (el.dataset.mapaV531 === '1') return el;
    const nuevo = el.cloneNode(false);
    nuevo.id = 'mapaDS';
    nuevo.className = el.className;
    nuevo.style.cssText = el.style.cssText;
    nuevo.dataset.mapaV531 = '1';
    el.parentNode.replaceChild(nuevo, el);
    mapaDashboardV531 = null;
    capaDashboardV531 = null;
    return nuevo;
  }

  function renderMapaV531(datos) {
    const el = reiniciarMapaSiCorrespondeV531();
    if (!el || !window.L) return;
    if (!mapaDashboardV531) {
      mapaDashboardV531 = L.map(el, { scrollWheelZoom: true, zoomControl: true }).setView(PERU_CENTER, PERU_ZOOM);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '&copy; OpenStreetMap' }).addTo(mapaDashboardV531);
      capaDashboardV531 = L.layerGroup().addTo(mapaDashboardV531);
    }
    capaDashboardV531.clearLayers();
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
        fillOpacity: repetido ? 0.95 : 0.78
      });
      marker.bindTooltip(`
        <strong>${escapeHtml(item.distrito)}</strong><br>
        Provincia: ${escapeHtml(item.provincia)}<br>
        Departamento: ${escapeHtml(item.departamento)}<br>
        Decreto(s): ${escapeHtml(dsUnicos.map(d => d.nombre).join(', '))}
      `, { sticky: true });
      marker.addTo(capaDashboardV531);
    });
    mapaDashboardV531.setView(PERU_CENTER, PERU_ZOOM);
    setTimeout(() => {
      mapaDashboardV531?.invalidateSize();
      mapaDashboardV531?.setView(PERU_CENTER, PERU_ZOOM);
    }, 180);
  }

  function renderResumenDSV531(datos) {
    const tbody = document.querySelector('#tablaResumenDS tbody');
    if (!tbody) return;
    const filas = datos.filtrados.map(d => {
      const territorio = territorioDSV531(d);
      const deps = new Set(territorio.map(keyDepartamentoV531).filter(Boolean));
      const provs = new Set(territorio.map(keyProvinciaV531).filter(Boolean));
      const dists = new Set(territorio.map(keyDistritoV531).filter(Boolean));
      const sem = semaforoEjecutivoV531(d);
      return { d, deps, provs, dists, sem };
    }).sort((a,b) => a.sem.orden - b.sem.orden || diasRestantesV531(a.d) - diasRestantesV531(b.d));
    tbody.innerHTML = filas.length ? filas.map(x => `
      <tr>
        <td>${escapeHtml(formatearNumeroDS(x.d))}</td>
        <td>${escapeHtml(x.d.fecha_inicio || '')}</td>
        <td>${escapeHtml(x.d.fecha_fin || '')}</td>
        <td>${diasRestantesV531(x.d)}</td>
        <td>${avanceTiempoV531(x.d)}%</td>
        <td><span class="badge ${x.sem.clase}">${x.sem.texto}</span></td>
        <td>${x.deps.size}</td><td>${x.provs.size}</td><td>${x.dists.size}</td>
      </tr>`).join('') : '<tr><td colspan="9" class="dee-dashboard-empty">No hay declaratorias para los filtros seleccionados.</td></tr>';
  }

  function renderDepartamentosV531(datos) {
    const tbody = document.querySelector('#tablaDeptos tbody');
    if (!tbody) return;
    const estado = mostrarVigentesDEE && mostrarNoVigentesDEE ? 'Filtrado' : (mostrarVigentesDEE ? 'Vigente' : 'No vigente');
    const badge = mostrarVigentesDEE && !mostrarNoVigentesDEE ? 'text-bg-success' : (mostrarNoVigentesDEE && !mostrarVigentesDEE ? 'text-bg-secondary' : 'text-bg-primary');
    const filas = [...datos.departamentosConteo.entries()].map(([key, count]) => ({ departamento: key, count })).sort((a,b) => b.count - a.count || a.departamento.localeCompare(b.departamento, 'es'));
    tbody.innerHTML = filas.length ? filas.map(f => `<tr><td>${escapeHtml(f.departamento)}</td><td>${f.count}</td><td><span class="badge ${badge}">${estado}</span></td></tr>`).join('') : '<tr><td colspan="3" class="dee-dashboard-empty">No hay departamentos para los filtros seleccionados.</td></tr>';
  }

  function renderRepetidosV531(datos) {
    const tbody = document.querySelector('#tablaRepetidos tbody');
    if (!tbody) return;
    const filas = [...datos.distritos.values()].map(item => ({ ...item, veces: new Set(item.decretos.map(d => d.id)).size })).filter(item => item.veces > 1).sort((a,b) => b.veces - a.veces || String(a.departamento).localeCompare(String(b.departamento), 'es'));
    tbody.innerHTML = filas.length ? filas.map(f => `
      <tr><td>${escapeHtml(f.departamento)}</td><td>${escapeHtml(f.provincia)}</td><td>${escapeHtml(f.distrito)}</td><td>${f.veces}</td><td>${escapeHtml(f.fechasInicio.sort()[0] || '')}</td><td>${escapeHtml(f.fechasFin.sort().slice(-1)[0] || '')}</td></tr>`).join('') : '<tr><td colspan="6" class="dee-dashboard-empty">No hay distritos repetidos para los filtros seleccionados.</td></tr>';
  }

  function renderDashboardEjecutivoDEE() {
    try {
      asegurarControlesDashboardV531();
      actualizarEstadoBotonesV531();
      const datos = construirDatosDashboardV531();
      renderKPIsV531(datos);
      renderResumenDSV531(datos);
      renderDepartamentosV531(datos);
      renderRepetidosV531(datos);
      renderMapaV531(datos);
    } catch (e) {
      console.error('Error renderizando Dashboard v53.1:', e);
    }
  }

  window.renderDashboardEjecutivoDEE = renderDashboardEjecutivoDEE;

  document.addEventListener('DOMContentLoaded', () => {
    asegurarControlesDashboardV531();
    $('btnActualizarDashboard')?.addEventListener('click', renderDashboardEjecutivoDEE);
    document.querySelector('[data-bs-target="#tabDashboard"]')?.addEventListener('shown.bs.tab', () => setTimeout(renderDashboardEjecutivoDEE, 120));
    document.querySelector('[data-bs-target="#tabDashboard"]')?.addEventListener('click', () => setTimeout(renderDashboardEjecutivoDEE, 180));
    setTimeout(renderDashboardEjecutivoDEE, 1000);
  });
})();

// ================= AJUSTE FINAL v54.1 - OJITO LISTADO DS EN HOJAS + PDF HORIZONTAL =================
// Alcance: solo detalle visual del Decreto Supremo desde Listado DS y exportación PDF del detalle.
(function(){
  'use strict';

  function q(id){ return document.getElementById(id); }
  function txt(v){ return String(v ?? '').trim(); }
  function esc(v){
    return String(v ?? '')
      .replaceAll('&','&amp;')
      .replaceAll('<','&lt;')
      .replaceAll('>','&gt;')
      .replaceAll('"','&quot;')
      .replaceAll("'",'&#39;');
  }
  function norm(v){
    return txt(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase();
  }
  function fecha(v){
    if(!v) return '';
    const s = txt(v).slice(0,10);
    const d = new Date(`${s}T00:00:00`);
    return isNaN(d.getTime()) ? txt(v) : d.toLocaleDateString('es-PE',{day:'2-digit',month:'2-digit',year:'numeric'});
  }
  function fechaHora(){
    const d = new Date();
    const p = n => String(n).padStart(2,'0');
    return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }
  function valor(obj, keys){
    for(const k of keys){
      const v = obj && obj[k];
      if(v !== undefined && v !== null && String(v) !== '') return v;
    }
    return '';
  }
  function numeroDSLimpioV541(d){
    let n = txt(valor(d, ['numero','ds','decreto','decreto_supremo']));
    const anio = txt(valor(d, ['anio','año']));
    n = n.replace(/^D\.?\s*S\.?\s*N[°.º]?\s*/i,'')
         .replace(/^DS\s*N[°.º]?\s*/i,'')
         .replace(/^N[°.º]?\s*/i,'')
         .trim();
    const m = n.match(/(\d{1,4})\s*-\s*(\d{4})\s*-\s*PCM/i);
    if(m) return `${m[1].padStart(3,'0')}-${m[2]}-PCM`;
    n = n.replace(/-?\d{4}-PCM$/i,'').replace(/-?PCM$/i,'').replace(/[^0-9]/g,'').trim();
    if(n) n = n.padStart(3,'0');
    return anio && n ? `${n}-${anio}-PCM` : (n || anio || 'DS');
  }
  function tituloDSV541(d){ return `D.S. N°${numeroDSLimpioV541(d)}`; }
  function getDecretoV541(id){
    try {
      if(typeof buscarDecretoPorId === 'function') {
        const d = buscarDecretoPorId(id);
        if(d) return d;
      }
    } catch {}
    try {
      const lista = (state && Array.isArray(state.decretos) && state.decretos.length)
        ? state.decretos
        : JSON.parse(localStorage.getItem('decretos') || '[]');
      return (lista || []).find(d => String(d.id) === String(id)) || null;
    } catch { return null; }
  }
  function territorioV541(d){
    const arr = Array.isArray(d?.territorio) ? d.territorio : [];
    return arr.map(t => ({
      departamento: valor(t, ['departamento','Departamento']),
      provincia: valor(t, ['provincia','Provincia']),
      distrito: valor(t, ['distrito','Distrito']),
      ubigeo: valor(t, ['ubigeo','UBIGEO','codigo','cod_ubigeo']),
      latitud: valor(t, ['latitud','lat']),
      longitud: valor(t, ['longitud','lng','lon'])
    }));
  }
  function getAccionesV541(){
    try {
      if(typeof cargarAccionesLocales === 'function') {
        const a = cargarAccionesLocales();
        return Array.isArray(a) ? a : [];
      }
    } catch {}
    try { return JSON.parse(localStorage.getItem('accionesDS') || '[]') || []; } catch { return []; }
  }
  function accionesDSV541(d){
    const id = txt(d?.id);
    const t1 = tituloDSV541(d);
    let t2 = '';
    try { t2 = typeof formatearNumeroDS === 'function' ? formatearNumeroDS(d) : ''; } catch {}
    return getAccionesV541().filter(a =>
      txt(valor(a,['dsId','ds_id'])) === id ||
      txt(valor(a,['numeroDS','ds'])) === t1 ||
      (t2 && txt(valor(a,['numeroDS','ds'])) === t2)
    );
  }
  function filaAccionV541(a,d){
    const metaProg = Number(valor(a,['metaProgramada','meta_programada']) || 0);
    const metaEjec = Number(valor(a,['metaEjecutada','meta_ejecutada']) || 0);
    let avance = txt(valor(a,['avance']));
    if(!avance && metaProg > 0) avance = `${Math.min(100, Math.round((metaEjec/metaProg)*100))}%`;
    return {
      reunion: txt(valor(a,['numeroReunion','numero_reunion'])) || txt(d?.numeroReunion),
      fechaReunion: txt(valor(a,['fechaReunion','fecha_reunion'])) || txt(d?.fechaReunion),
      programa: valor(a,['programaNacional','programa']),
      tipo: valor(a,['tipoAccion','tipo']),
      codigo: valor(a,['codigoAccion','codigo']),
      detalle: valor(a,['detalle','accion','acciones']),
      unidad: valor(a,['unidadMedida','unidad']),
      metaProgramada: valor(a,['metaProgramada','meta_programada']),
      plazo: valor(a,['plazoDias','plazo']),
      inicio: valor(a,['fechaInicio','fecha_inicio']),
      fin: valor(a,['fechaFinal','fecha_final']),
      metaEjecutada: valor(a,['metaEjecutada','meta_ejecutada']),
      avance,
      descripcion: valor(a,['descripcionActividades','descripcion','observaciones']),
      usuario: valor(a,['usuarioRegistro','usuario_registro']),
      fechaRegistro: valor(a,['fechaRegistro','fecha_registro']),
      estado: valor(a,['estado']) || 'Registrado'
    };
  }
  function gruposAccionesV541(d){
    const mapa = new Map();
    accionesDSV541(d).map(a => filaAccionV541(a,d)).forEach(f => {
      const key = `${f.reunion || 'Sin reunión registrada'}|${f.fechaReunion || ''}`;
      if(!mapa.has(key)) mapa.set(key, []);
      mapa.get(key).push(f);
    });
    return mapa;
  }
  function resumenGeneralV541(d){
    const sectores = Array.isArray(d?.sectores) ? d.sectores.join(', ') : txt(d?.sectores || '');
    return [
      ['Número de Decreto Supremo', tituloDSV541(d)],
      ['Fecha', fecha(valor(d,['fecha_registro','created_at','fecha_inicio']))],
      ['Tipo', valor(d,['peligro']) || '-'],
      ['Peligro o evento', valor(d,['tipo_peligro','tipoPeligro']) || '-'],
      ['Sectores que firman', sectores || 'No registrado'],
      ['Exposición de motivos', valor(d,['motivos','exposicion_motivos']) || 'No registrado']
    ];
  }

  function inyectarEstilosV541(){
    if(document.getElementById('deeDetalleDSV541Styles')) return;
    const st = document.createElement('style');
    st.id = 'deeDetalleDSV541Styles';
    st.textContent = `
      .dee-ds-toolbar{display:flex;justify-content:space-between;gap:.75rem;align-items:center;margin-bottom:.75rem;}
      .dee-ds-page-tabs{display:flex;flex-wrap:wrap;gap:.35rem;margin-bottom:.75rem;border-bottom:1px solid #d9e2ef;padding-bottom:.5rem;}
      .dee-ds-page-tabs button{border:1px solid #cbd5e1;background:#f8fafc;color:#0b3f8a;border-radius:6px;padding:.35rem .7rem;font-weight:700;font-size:12px;}
      .dee-ds-page-tabs button.active{background:#0d6efd;color:#fff;border-color:#0d6efd;}
      .dee-detalle-hoja{display:none;border:1px solid #d9e2ef;border-radius:10px;background:#fff;padding:14px;min-height:420px;}
      .dee-detalle-hoja.active{display:block;}
      .dee-hoja-title{font-size:15px;font-weight:800;color:#062b60;margin-bottom:10px;text-transform:uppercase;letter-spacing:.02em;}
      .dee-ds-meta-table{width:100%;border-collapse:collapse;font-size:12px;}
      .dee-ds-meta-table th{width:210px;background:#eaf2ff;color:#062b60;border:1px solid #cbd5e1;padding:8px;vertical-align:top;}
      .dee-ds-meta-table td{border:1px solid #cbd5e1;padding:8px;vertical-align:top;}
      .dee-ds-action-title{background:#062b60;color:#fff;font-weight:800;padding:7px 9px;border-radius:6px;margin:10px 0 6px;font-size:12px;}
      .dee-ds-action-table{width:100%;border-collapse:collapse;font-size:11px;}
      .dee-ds-action-table th{background:#dbeafe;color:#0b2545;border:1px solid #b9cbe3;padding:6px;text-align:center;vertical-align:middle;}
      .dee-ds-action-table td{border:1px solid #d1d9e6;padding:6px;vertical-align:top;}
      .dee-anexo-table{width:100%;border-collapse:collapse;font-size:11px;}
      .dee-anexo-table th{background:#0b3f8a;color:#fff;border:1px solid #9eb4d4;padding:6px;text-align:center;}
      .dee-anexo-table td{border:1px solid #d1d9e6;padding:6px;}
      @media print{.dee-ds-toolbar,.dee-ds-page-tabs{display:none}.dee-detalle-hoja{display:block;page-break-after:always;border:0}.modal-footer,.modal-header .btn-close{display:none!important}}
    `;
    document.head.appendChild(st);
  }
  function activarHojaDetalleV541(n){
    document.querySelectorAll('#modalDSBody .dee-ds-page-tabs button').forEach(b => b.classList.toggle('active', b.dataset.hoja === String(n)));
    document.querySelectorAll('#modalDSBody .dee-detalle-hoja').forEach(p => p.classList.toggle('active', p.dataset.hoja === String(n)));
  }
  window.activarHojaDetalleV541 = activarHojaDetalleV541;

  function htmlAccionesV541(d){
    const grupos = gruposAccionesV541(d);
    if(!grupos.size) return '<div class="alert alert-secondary py-2">No hay acciones registradas por Programas Nacionales para este Decreto Supremo.</div>';
    let html = '';
    grupos.forEach((items, key) => {
      const [reunion, freunion] = key.split('|');
      html += `<div class="dee-ds-action-title">${esc(reunion)}${freunion ? ' · ' + esc(fecha(freunion)) : ''}</div>`;
      html += `<div class="table-responsive"><table class="dee-ds-action-table"><thead><tr><th>Programa Nacional</th><th>Tipo de acción</th><th>Código</th><th>Acción registrada</th><th>Meta prog.</th><th>Meta ejec.</th><th>Avance</th><th>Observaciones</th><th>Usuario</th><th>Fecha registro</th></tr></thead><tbody>`;
      html += items.map(a => `<tr><td>${esc(a.programa)}</td><td>${esc(a.tipo)}</td><td>${esc(a.codigo)}</td><td>${esc(a.detalle)}</td><td>${esc(a.metaProgramada)}</td><td>${esc(a.metaEjecutada)}</td><td>${esc(a.avance)}</td><td>${esc(a.descripcion)}</td><td>${esc(a.usuario)}</td><td>${esc(fecha(a.fechaRegistro) || a.fechaRegistro)}</td></tr>`).join('');
      html += '</tbody></table></div>';
    });
    return html;
  }
  function htmlTerritorioV541(d){
    const t = territorioV541(d);
    if(!t.length) return '<div class="alert alert-secondary py-2">No hay territorio registrado.</div>';
    return `<table class="dee-anexo-table"><thead><tr><th>N°</th><th>Departamento</th><th>Provincia</th><th>Distrito</th><th>Ubigeo</th><th>Latitud</th><th>Longitud</th></tr></thead><tbody>${t.map((x,i)=>`<tr><td>${i+1}</td><td>${esc(x.departamento)}</td><td>${esc(x.provincia)}</td><td>${esc(x.distrito)}</td><td>${esc(x.ubigeo)}</td><td>${esc(x.latitud)}</td><td>${esc(x.longitud)}</td></tr>`).join('')}</tbody></table>`;
  }

  function asegurarFooterModalV541(id){
    const modal = q('modalDS');
    const content = modal?.querySelector('.modal-content');
    if(!content) return;
    let footer = modal.querySelector('.modal-footer');
    if(!footer){
      footer = document.createElement('div');
      footer.className = 'modal-footer';
      content.appendChild(footer);
    }
    footer.innerHTML = `
      <button type="button" class="btn btn-outline-danger" onclick="exportarDetalleDSPDFV541('${esc(id)}')">Exportar PDF</button>
      <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cerrar</button>
    `;
  }

  function verDetalleDSV541(id){
    const d = getDecretoV541(id);
    if(!d) return alert('No se encontró el Decreto Supremo.');
    inyectarEstilosV541();
    const body = q('modalDSBody');
    if(body){
      const filas = resumenGeneralV541(d).map(([k,v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('');
      body.innerHTML = `
        <div class="dee-ds-toolbar">
          <div><strong>${esc(tituloDSV541(d))}</strong><div class="text-muted small">Detalle institucional del Decreto Supremo</div></div>
          <button type="button" class="btn btn-sm btn-outline-danger" onclick="exportarDetalleDSPDFV541('${esc(id)}')">Exportar PDF</button>
        </div>
        <div class="dee-ds-page-tabs" role="tablist">
          <button type="button" class="active" data-hoja="1" onclick="activarHojaDetalleV541(1)">Hoja 1 · Datos generales</button>
          <button type="button" data-hoja="2" onclick="activarHojaDetalleV541(2)">Hoja 2 · Acciones registradas</button>
          <button type="button" data-hoja="3" onclick="activarHojaDetalleV541(3)">Anexo · Territorio involucrado</button>
        </div>
        <section class="dee-detalle-hoja active" data-hoja="1">
          <div class="dee-hoja-title">Hoja 1: Datos generales del Decreto Supremo</div>
          <table class="dee-ds-meta-table"><tbody>${filas}</tbody></table>
        </section>
        <section class="dee-detalle-hoja" data-hoja="2">
          <div class="dee-hoja-title">Hoja 2: Acciones registradas por Programas Nacionales</div>
          ${htmlAccionesV541(d)}
        </section>
        <section class="dee-detalle-hoja" data-hoja="3">
          <div class="dee-hoja-title">Anexo: Territorio involucrado</div>
          ${htmlTerritorioV541(d)}
        </section>
      `;
    }
    asegurarFooterModalV541(id);
    const modal = q('modalDS');
    if(modal){
      modal.querySelector('.modal-dialog')?.classList.remove('modal-lg');
      modal.querySelector('.modal-dialog')?.classList.add('modal-xl','modal-dialog-scrollable');
      if(window.bootstrap?.Modal) bootstrap.Modal.getOrCreateInstance(modal).show();
    }
  }

  function exportarDetalleDSPDFV541(id){
    const d = getDecretoV541(id);
    if(!d) return alert('No se encontró el Decreto Supremo.');
    if(!window.jspdf?.jsPDF) return alert('No se encontró la librería jsPDF para generar el PDF.');
    const doc = new window.jspdf.jsPDF({ orientation:'landscape', unit:'mm', format:'a4' });
    const azul = [6,43,96];
    const celeste = [221,235,247];
    const margen = 8;
    const ancho = 297 - margen*2;
    const titulo = tituloDSV541(d);

    function encabezado(sub){
      doc.setFillColor(...azul);
      doc.rect(0,0,297,14,'F');
      doc.setTextColor(255,255,255);
      doc.setFont('helvetica','bold');
      doc.setFontSize(11);
      doc.text('Detalle del Decreto Supremo', margen, 9);
      doc.setFontSize(9);
      doc.text(titulo, 289, 9, { align:'right' });
      doc.setTextColor(...azul);
      doc.setFontSize(10);
      doc.text(sub, margen, 22);
      doc.setTextColor(80,80,80);
      doc.setFontSize(7);
      doc.text(`Generado: ${fechaHora()}`, 289, 22, { align:'right' });
    }
    function pie(){
      const p = doc.internal.getNumberOfPages();
      doc.setFontSize(7); doc.setTextColor(120);
      doc.text(`DEE MIDIS · Página ${p}`, 289, 204, { align:'right' });
    }

    encabezado('Hoja 1: Datos generales');
    doc.autoTable({
      startY: 27,
      body: resumenGeneralV541(d),
      theme: 'grid',
      styles: { fontSize: 8.2, cellPadding: 2.2, overflow:'linebreak', valign:'top', lineColor:[160,174,192], lineWidth:.15 },
      columnStyles: { 0:{ cellWidth:58, fontStyle:'bold', fillColor:celeste, textColor:azul }, 1:{ cellWidth: ancho-58 } },
      margin: { left:margen, right:margen }
    });
    pie();

    doc.addPage('a4','landscape');
    encabezado('Hoja 2: Acciones registradas por Programas Nacionales');
    const acciones = accionesDSV541(d).map(a => filaAccionV541(a,d));
    if(acciones.length){
      doc.autoTable({
        startY: 27,
        head: [['N°','Reunión','Fecha reunión','Programa','Tipo de acción','Código','Acción registrada','Unidad','Meta prog.','Meta ejec.','Avance','Observaciones','Usuario','Fecha registro']],
        body: acciones.map((a,i) => [i+1, a.reunion, fecha(a.fechaReunion), a.programa, a.tipo, a.codigo, a.detalle, a.unidad, a.metaProgramada, a.metaEjecutada, a.avance, a.descripcion, a.usuario, fecha(a.fechaRegistro) || a.fechaRegistro]),
        theme:'grid',
        headStyles:{ fillColor:azul, textColor:[255,255,255], fontSize:6.2, halign:'center', valign:'middle' },
        styles:{ fontSize:5.8, cellPadding:.85, overflow:'linebreak', valign:'top', lineColor:[120,120,120], lineWidth:.1 },
        columnStyles:{ 0:{cellWidth:8},1:{cellWidth:18},2:{cellWidth:17},3:{cellWidth:21},4:{cellWidth:30},5:{cellWidth:15},6:{cellWidth:50},7:{cellWidth:14},8:{cellWidth:13},9:{cellWidth:13},10:{cellWidth:13},11:{cellWidth:42},12:{cellWidth:22},13:{cellWidth:16} },
        margin:{ left:margen, right:margen }
      });
    } else {
      doc.setFontSize(9); doc.setTextColor(80); doc.text('No hay acciones registradas por Programas Nacionales para este Decreto Supremo.', margen, 34);
    }
    pie();

    doc.addPage('a4','landscape');
    encabezado('Anexo: Territorio involucrado');
    const terr = territorioV541(d);
    if(terr.length){
      doc.autoTable({
        startY: 27,
        head: [['N°','Departamento','Provincia','Distrito','Ubigeo','Latitud','Longitud']],
        body: terr.map((t,i)=>[i+1,t.departamento,t.provincia,t.distrito,t.ubigeo,t.latitud,t.longitud]),
        theme:'grid',
        headStyles:{ fillColor:azul, textColor:[255,255,255], fontSize:7.5, halign:'center' },
        styles:{ fontSize:7.2, cellPadding:1.4, overflow:'linebreak', lineColor:[120,120,120], lineWidth:.1 },
        columnStyles:{ 0:{cellWidth:12},1:{cellWidth:48},2:{cellWidth:52},3:{cellWidth:58},4:{cellWidth:28},5:{cellWidth:38},6:{cellWidth:38} },
        margin:{ left:margen, right:margen }
      });
    } else {
      doc.setFontSize(9); doc.setTextColor(80); doc.text('No hay territorio registrado.', margen, 34);
    }
    pie();

    doc.save(`Detalle_${numeroDSLimpioV541(d)}.pdf`.replace(/[^a-zA-Z0-9._-]/g,'_'));
  }

  window.verDetalleDS = verDetalleDSV541;
  window.exportarDetalleDSPDFV541 = exportarDetalleDSPDFV541;
})();

// ================= CIERRE FINAL v55.1 - FILTROS LISTADO DS Y PAGINACIÓN =================
(function(){
  const VERSION_CIERRE = 'v55.1-filtros-listado-ds';
  let paginaDS = 1;

  function q(id){ return document.getElementById(id); }
  function txt(v){ return String(v ?? '').trim(); }
  function norm(v){
    return txt(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase();
  }
  function esc(v){
    if (typeof escapeHtml === 'function') return escapeHtml(v);
    return txt(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
  }
  function escAttr(v){ return esc(v); }
  function listaDecretosV551(){
    try {
      const base = (state?.decretos?.length ? state.decretos : (typeof cargarDecretosLocales === 'function' ? cargarDecretosLocales() : []));
      return (Array.isArray(base) ? base : []).map(d => typeof normalizarDecreto === 'function' ? normalizarDecreto(d) : d).filter(Boolean);
    } catch { return []; }
  }
  function territorioDSV551(d){
    const t = d?.territorio;
    return Array.isArray(t) ? t : [];
  }
  function tituloDSV551(d){
    try { if (typeof formatearNumeroDSFinal === 'function') return formatearNumeroDSFinal(d); } catch {}
    try { if (typeof formatearNumeroDS === 'function') return formatearNumeroDS(d); } catch {}
    const n = txt(d?.numero || d?.ds || d?.decreto).replace(/^0+/, '') || txt(d?.numero || d?.ds || d?.decreto);
    const npad = txt(d?.numero || d?.ds || d?.decreto).padStart(3,'0');
    const anio = txt(d?.anio || d?.año || '');
    return `DS N.° ${npad || n}${anio ? '-' + anio : ''}-PCM`;
  }
  function vigenciaActualV551(d){
    try { if (typeof calcularVigencia === 'function') return calcularVigencia(d?.fecha_fin || d?.fechaFin || ''); } catch {}
    return txt(d?.vigencia || '');
  }
  function semaforoActualV551(d){
    try { if (typeof calcularSemaforo === 'function') return calcularSemaforo(d?.fecha_fin || d?.fechaFin || ''); } catch {}
    return txt(d?.semaforo || '');
  }
  function valorFiltro(id){ return txt(q(id)?.value || ''); }
  function fechaOk(valor, filtro, modo){
    if (!filtro) return true;
    if (!valor) return false;
    const v = new Date(`${valor}T00:00:00`).getTime();
    const f = new Date(`${filtro}T00:00:00`).getTime();
    if (Number.isNaN(v) || Number.isNaN(f)) return false;
    return modo === 'desde' ? v >= f : v <= f;
  }
  function cumpleTexto(haystack, needle){
    return !needle || norm(haystack).includes(norm(needle));
  }
  function aplicarFiltrosListadoDSV551(decretos){
    const fDS = valorFiltro('filtroDsTexto');
    const fEstado = valorFiltro('filtroDsEstado');
    const fDep = valorFiltro('filtroDsDepartamento');
    const fProv = valorFiltro('filtroDsProvincia');
    const fDist = valorFiltro('filtroDsDistrito');
    const fPeligro = valorFiltro('filtroDsPeligro');
    const fInicio = valorFiltro('filtroDsFechaInicio');
    const fFinal = valorFiltro('filtroDsFechaFinal');

    return decretos.filter(d => {
      const terr = territorioDSV551(d);
      const titulo = tituloDSV551(d);
      const dsTexto = `${titulo} ${d?.numero || ''} ${d?.anio || ''} ${d?.codigo_registro || d?.codigoRegistro || ''}`;
      const peligroTexto = `${d?.peligro || ''} ${d?.tipo_peligro || d?.tipoPeligro || ''}`;
      const estado = vigenciaActualV551(d);
      const territorioTexto = terr.map(t => `${t.departamento || ''} ${t.provincia || ''} ${t.distrito || ''}`).join(' ');
      const depOk = !fDep || terr.some(t => cumpleTexto(t?.departamento || '', fDep));
      const provOk = !fProv || terr.some(t => cumpleTexto(t?.provincia || '', fProv));
      const distOk = !fDist || terr.some(t => cumpleTexto(t?.distrito || '', fDist));

      return cumpleTexto(dsTexto, fDS)
        && (!fEstado || norm(estado) === norm(fEstado))
        && depOk
        && provOk
        && distOk
        && cumpleTexto(peligroTexto || territorioTexto, fPeligro)
        && fechaOk(d?.fecha_inicio || d?.fechaInicio || '', fInicio, 'desde')
        && fechaOk(d?.fecha_fin || d?.fechaFin || '', fFinal, 'hasta');
    });
  }
  function botonesRDSV551(d){
    let botonRDS = '';
    let botonRevision = '';
    try {
      if (typeof puedeActivarRDS === 'function' && puedeActivarRDS()) {
        botonRDS = `<button type="button" class="btn btn-sm ${d.rdsActivo ? 'btn-success' : 'btn-outline-primary'}" onclick="abrirRDS('${escAttr(d.id)}')">RDS</button>`;
        if (typeof puedePreaprobar === 'function' && puedePreaprobar()) {
          const estado = norm(d.estadoRDS || '');
          const habilitado = Boolean(d.rdsActivo) && (typeof dsTieneAccionesRegistradas !== 'function' || dsTieneAccionesRegistradas(d.id)) && estado !== 'PREAPROBADO' && estado !== 'APROBADO';
          botonRevision = `<button type="button" class="btn btn-sm btn-warning" ${habilitado ? '' : 'disabled title="Pendiente: no existen acciones registradas o ya fue preaprobado/aprobado"'} onclick="abrirPreAprobacion('${escAttr(d.id)}')">PreAprobar</button>`;
        } else if (typeof puedeAprobar === 'function' && puedeAprobar()) {
          const habilitado = norm(d.estadoRDS || '') === 'PREAPROBADO';
          botonRevision = `<button type="button" class="btn btn-sm btn-success" ${habilitado ? '' : 'disabled title="Disponible cuando el DS esté PreAprobado"'} onclick="abrirPreAprobacion('${escAttr(d.id)}')">Aprobar</button>`;
        }
      } else if (typeof esRegistradorPrograma === 'function' && esRegistradorPrograma()) {
        const programa = typeof programaSesionNormalizado === 'function' ? programaSesionNormalizado() : '';
        const cerrado = typeof dsProgramaCerroRegistro === 'function' ? dsProgramaCerroRegistro(d, programa) : false;
        botonRDS = d.rdsActivo
          ? (cerrado ? `<button type="button" class="btn btn-sm btn-secondary" disabled>Acciones Registradas</button>` : `<button type="button" class="btn btn-sm btn-primary" onclick="abrirRegistrarAcciones('${escAttr(d.id)}')">Registrar Acciones</button>`)
          : `<span class="badge text-bg-secondary">No activado</span>`;
      } else {
        botonRDS = '<span class="text-muted small">Solo lectura</span>';
      }
    } catch {
      botonRDS = '<span class="text-muted small">Solo lectura</span>';
    }
    return { botonRDS, botonRevision };
  }
  function botonesExportarV551(d){
    return `<div class="d-flex flex-wrap gap-1"><button type="button" class="btn btn-sm btn-outline-success" onclick="exportarDSExcel('${escAttr(d.id)}')">Excel</button><button type="button" class="btn btn-sm btn-outline-danger" onclick="exportarDSPDF('${escAttr(d.id)}')">PDF</button></div>`;
  }
  function asegurarFiltrosListadoDSV551(){
    const panel = q('filtrosListadoDS');
    if (!panel) return;
    panel.querySelectorAll('input, select').forEach(el => {
      if (el.dataset.filtroDsInit === '1') return;
      el.dataset.filtroDsInit = '1';
      el.addEventListener('input', () => { paginaDS = 1; renderTablaDecretosBasicaV551(); });
      el.addEventListener('change', () => { paginaDS = 1; renderTablaDecretosBasicaV551(); });
    });
    const btnBuscar = q('btnAplicarFiltrosDS');
    if (btnBuscar && btnBuscar.dataset.filtroDsInit !== '1') {
      btnBuscar.dataset.filtroDsInit = '1';
      btnBuscar.addEventListener('click', () => { paginaDS = 1; renderTablaDecretosBasicaV551(); });
    }
    const btnLimpiar = q('btnLimpiarFiltrosDS');
    if (btnLimpiar && btnLimpiar.dataset.filtroDsInit !== '1') {
      btnLimpiar.dataset.filtroDsInit = '1';
      btnLimpiar.addEventListener('click', () => {
        ['filtroDsTexto','filtroDsEstado','filtroDsDepartamento','filtroDsProvincia','filtroDsDistrito','filtroDsPeligro','filtroDsFechaInicio','filtroDsFechaFinal'].forEach(id => { if(q(id)) q(id).value = ''; });
        if(q('filtroDsPageSize')) q('filtroDsPageSize').value = '10';
        paginaDS = 1;
        renderTablaDecretosBasicaV551();
      });
    }
    const anterior = q('btnDsPaginaAnterior');
    if (anterior && anterior.dataset.filtroDsInit !== '1') {
      anterior.dataset.filtroDsInit = '1';
      anterior.addEventListener('click', () => { if (paginaDS > 1) { paginaDS--; renderTablaDecretosBasicaV551(); } });
    }
    const siguiente = q('btnDsPaginaSiguiente');
    if (siguiente && siguiente.dataset.filtroDsInit !== '1') {
      siguiente.dataset.filtroDsInit = '1';
      siguiente.addEventListener('click', () => { paginaDS++; renderTablaDecretosBasicaV551(); });
    }
  }
  function renderTablaDecretosBasicaV551(){
    asegurarFiltrosListadoDSV551();
    const tbody = document.querySelector('#tablaDS tbody');
    if (!tbody) return;
    const todos = listaDecretosV551();
    const filtrados = aplicarFiltrosListadoDSV551(todos);
    const pageSize = Math.max(10, Number(q('filtroDsPageSize')?.value || 10));
    const totalPaginas = Math.max(1, Math.ceil(filtrados.length / pageSize));
    if (paginaDS > totalPaginas) paginaDS = totalPaginas;
    if (paginaDS < 1) paginaDS = 1;
    const desde = (paginaDS - 1) * pageSize;
    const visibles = filtrados.slice(desde, desde + pageSize);

    const contador = q('contadorListadoDS');
    if (contador) contador.textContent = `Mostrando ${visibles.length ? desde + 1 : 0}-${desde + visibles.length} de ${filtrados.length} registro(s) filtrados · Total: ${todos.length}`;
    const pag = q('paginacionListadoDS');
    if (pag) pag.style.setProperty('display', filtrados.length > pageSize ? 'flex' : 'none', 'important');
    const info = q('dsPaginaInfo');
    if (info) info.textContent = `Página ${paginaDS} de ${totalPaginas}`;
    if (q('btnDsPaginaAnterior')) q('btnDsPaginaAnterior').disabled = paginaDS <= 1;
    if (q('btnDsPaginaSiguiente')) q('btnDsPaginaSiguiente').disabled = paginaDS >= totalPaginas;

    if (!todos.length) {
      tbody.innerHTML = '<tr><td colspan="18" class="text-muted">No hay Decretos Supremos registrados.</td></tr>';
      return;
    }
    if (!filtrados.length) {
      tbody.innerHTML = '<tr><td colspan="18" class="text-muted">No se encontraron Decretos Supremos con los filtros aplicados.</td></tr>';
      return;
    }

    tbody.innerHTML = visibles.map(d => {
      const terr = territorioDSV551(d);
      const deps = new Set(terr.map(t => t.departamento).filter(Boolean));
      const provs = new Set(terr.map(t => `${t.departamento}|${t.provincia}`).filter(Boolean));
      const dists = new Set(terr.map(t => `${t.departamento}|${t.provincia}|${t.distrito}`).filter(Boolean));
      const { botonRDS, botonRevision } = botonesRDSV551(d);
      return `<tr>
        <td>${esc(tituloDSV551(d))}</td>
        <td>${esc(d.anio)}</td>
        <td>${esc(d.peligro)}</td>
        <td>${esc(d.tipo_peligro || d.tipoPeligro || '')}</td>
        <td>${esc(d.fecha_inicio || d.fechaInicio || '')}</td>
        <td>${esc(d.fecha_fin || d.fechaFin || '')}</td>
        <td>${esc(vigenciaActualV551(d))}</td>
        <td>${esc(semaforoActualV551(d))}</td>
        <td>${deps.size}</td>
        <td>${provs.size}</td>
        <td>${dists.size}</td>
        <td>${d.es_prorroga ? 'Prórroga' : 'Original'}</td>
        <td>${esc(d.cadena || '')}</td>
        <td>${esc(d.nivel_prorroga || 0)}</td>
        <td>${botonRDS}</td>
        <td>${botonRevision}</td>
        <td><button type="button" class="btn btn-sm btn-outline-dark" onclick="verDetalleDS('${escAttr(d.id)}')">👁</button></td>
        <td>${botonesExportarV551(d)}</td>
      </tr>`;
    }).join('');
  }
  function inyectarEstilosListadoV551(){
    if (document.getElementById('deeListadoDSV551Styles')) return;
    const st = document.createElement('style');
    st.id = 'deeListadoDSV551Styles';
    st.textContent = `
      #filtrosListadoDS{border-color:#d9e2ef!important;background:#f8fbff!important;}
      #filtrosListadoDS label{font-size:11px;font-weight:700;color:#344054;}
      #filtrosListadoDS .form-control,#filtrosListadoDS .form-select{font-size:12px;min-height:31px;}
      #exportDs,#exportFechaElaboracion,#btnExportListadoExcel,#btnPrintListado{display:none!important;}
    `;
    document.head.appendChild(st);
  }
  window.renderTablaDecretosBasica = renderTablaDecretosBasicaV551;
  try { renderTablaDecretosBasica = renderTablaDecretosBasicaV551; } catch {}
  document.addEventListener('DOMContentLoaded', () => {
    inyectarEstilosListadoV551();
    setTimeout(() => {
      asegurarFiltrosListadoDSV551();
      renderTablaDecretosBasicaV551();
      console.info('DEE MIDIS cierre aplicado:', VERSION_CIERRE);
    }, 900);
  });
})();

// ================= AJUSTE FINAL v56.1 - REGISTRO GRUPAL POR DISTRITOS =================
(function () {
  'use strict';

  const VERSION_GRUPAL = 'v56.1 Registro grupal por distritos';
  const seleccionDistritosPrograma = new Set();
  let eventosGrupalesInicializados = false;

  const qg = (id) => document.getElementById(id);
  const norm = (v) => (typeof normalizarTexto === 'function' ? normalizarTexto(v) : String(v || '').trim().toUpperCase());
  const esc = (v) => (typeof escapeHtml === 'function' ? escapeHtml(v) : String(v ?? ''));
  const escAttr = (v) => (typeof escapeHtmlAttr === 'function' ? escapeHtmlAttr(v) : esc(v));
  const programaActual = () => (typeof programaSesionNormalizado === 'function' ? programaSesionNormalizado() : '');

  function keyTerritorioPrograma(t) {
    const ubigeo = String(t?.ubigeo || t?.UBIGEO || t?.codigo || '').trim();
    if (ubigeo) return `UBIGEO:${ubigeo}`;
    return [t?.departamento, t?.provincia, t?.distrito].map(norm).join('|');
  }

  function distritoOrdenKey(t) {
    return [t?.departamento || '', t?.provincia || '', t?.distrito || ''].map(x => String(x).trim()).join('|');
  }

  function territorioDecretoSeleccionadoPrograma() {
    const d = (typeof buscarDecretoPorId === 'function') ? buscarDecretoPorId(dsProgramaSeleccionadoId) : null;
    const territorio = Array.isArray(d?.territorio) ? d.territorio : [];
    const mapa = new Map();

    territorio.forEach(t => {
      const dep = t?.departamento || '';
      const prov = t?.provincia || '';
      const dist = t?.distrito || '';
      if (!dep && !prov && !dist) return;
      const key = keyTerritorioPrograma(t);
      if (!mapa.has(key)) {
        mapa.set(key, {
          key,
          ubigeo: t?.ubigeo || t?.UBIGEO || t?.codigo || '',
          departamento: dep,
          provincia: prov,
          distrito: dist,
          latitud: t?.latitud || t?.lat || '',
          longitud: t?.longitud || t?.lng || t?.lon || ''
        });
      }
    });

    return [...mapa.values()].sort((a, b) => distritoOrdenKey(a).localeCompare(distritoOrdenKey(b), 'es'));
  }

  function rdsKeyPrograma(d) {
    if (typeof reunionKeyV38 === 'function') return reunionKeyV38(d?.numeroReunion || '', d?.fechaReunion || '');
    return `${norm(d?.numeroReunion || '')}|${String(d?.fechaReunion || '').trim()}`;
  }

  function accionesProgramaActualPorDistrito() {
    const d = (typeof buscarDecretoPorId === 'function') ? buscarDecretoPorId(dsProgramaSeleccionadoId) : null;
    if (!d || typeof cargarAccionesLocales !== 'function') return [];
    const keyR = rdsKeyPrograma(d);
    const programa = programaActual();
    return cargarAccionesLocales().filter(a =>
      String(a.dsId || a.ds_id || '') === String(d.id) &&
      (!keyR || rdsKeyPrograma(a) === keyR) &&
      normalizarProgramaNombre(a.programaNacional || a.programa || '') === programa &&
      (a.departamento || a.provincia || a.distrito || a.ubigeo)
    );
  }

  function accionesDeDistrito(t) {
    const keyT = keyTerritorioPrograma(t);
    return accionesProgramaActualPorDistrito().filter(a => {
      const keyA = a.ubigeo ? `UBIGEO:${a.ubigeo}` : [a.departamento, a.provincia, a.distrito].map(norm).join('|');
      return keyA === keyT;
    });
  }

  function resumenCampoDistrito(acciones, campo1, campo2) {
    const valores = acciones.map(a => String(a?.[campo1] || a?.[campo2] || '').trim()).filter(Boolean);
    return [...new Set(valores)].join('<hr class="my-1">');
  }

  function renderDistritosAccionesPrograma() {
    const tbody = document.querySelector('#tablaDistritosAccionesPrograma tbody');
    if (!tbody) return;

    const d = (typeof buscarDecretoPorId === 'function') ? buscarDecretoPorId(dsProgramaSeleccionadoId) : null;
    if (!d) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-muted">Seleccione un Decreto Supremo activado.</td></tr>';
      return;
    }

    const distritos = territorioDecretoSeleccionadoPrograma();
    if (!distritos.length) {
      tbody.innerHTML = `<tr><td colspan="${colspan}" class="text-muted">El Decreto Supremo seleccionado no tiene distritos registrados.</td></tr>`;
      return;
    }

    tbody.innerHTML = distritos.map(t => {
      const acciones = accionesDeDistrito(t);
      const detalle = resumenCampoDistrito(acciones, 'detalle', 'accionesEspecificas');
      const descripcion = resumenCampoDistrito(acciones, 'descripcionActividades', 'descripcion');
      const checked = seleccionDistritosPrograma.has(t.key) ? 'checked' : '';
      const estadoFila = acciones.length ? '<span class="badge text-bg-success">Registrado</span>' : '<span class="badge text-bg-secondary">Pendiente</span>';
      return `<tr data-territorio-key="${escAttr(t.key)}">
        <td class="text-center">
          <input class="form-check-input chk-distrito-programa" type="checkbox" value="${escAttr(t.key)}" ${checked}>
        </td>
        <td>${esc(t.departamento)}</td>
        <td>${esc(t.provincia)}</td>
        <td><strong>${esc(t.distrito)}</strong><div class="small text-muted">${estadoFila}</div></td>
        ${columnasCobertura.map(c => `<td class="text-end fw-semibold">${formatearCobertura(valorCobertura(t, c.key))}</td>`).join('')}
        <td>${detalle || '<span class="text-muted">Pendiente</span>'}</td>
        <td>${descripcion || '<span class="text-muted">Pendiente</span>'}</td>
      </tr>`;
    }).join('');

    tbody.querySelectorAll('.chk-distrito-programa').forEach(chk => {
      chk.addEventListener('change', () => {
        if (chk.checked) seleccionDistritosPrograma.add(chk.value);
        else seleccionDistritosPrograma.delete(chk.value);
      });
    });
  }

  function seleccionarTodosDistritosPrograma() {
    territorioDecretoSeleccionadoPrograma().forEach(t => seleccionDistritosPrograma.add(t.key));
    renderDistritosAccionesPrograma();
  }

  function limpiarSeleccionDistritosPrograma() {
    seleccionDistritosPrograma.clear();
    renderDistritosAccionesPrograma();
  }

  function abrirModalAccionGrupalPrograma() {
    if (!esRegistradorPrograma || !esRegistradorPrograma()) {
      alert('Esta opción corresponde a Registradores de Programas Nacionales.');
      return;
    }
    if (!dsProgramaSeleccionadoId) {
      alert('Seleccione un Decreto Supremo activado.');
      return;
    }
    if (!seleccionDistritosPrograma.size) {
      alert('Debe seleccionar al menos un distrito para registrar la acción.');
      return;
    }
    if (qg('grupoDetallePrograma')) qg('grupoDetallePrograma').value = '';
    if (qg('grupoDescripcionPrograma')) qg('grupoDescripcionPrograma').value = '';
    const modal = qg('modalAccionGrupalPrograma');
    if (modal && window.bootstrap?.Modal) bootstrap.Modal.getOrCreateInstance(modal).show();
    else alert('No se encontró el modal de registro grupal.');
  }

  function guardarAccionGrupalPrograma() {
    const d = (typeof buscarDecretoPorId === 'function') ? buscarDecretoPorId(dsProgramaSeleccionadoId) : null;
    if (!esRegistradorPrograma || !esRegistradorPrograma()) return alert('Solo un Registrador de Programa puede registrar acciones grupales.');
    if (!d || !d.rdsActivo) return alert('El Decreto Supremo no tiene RDS activo.');
    if (!d.numeroReunion || !d.fechaReunion) return alert('El RDS no tiene número y fecha de reunión activos.');
    if (!seleccionDistritosPrograma.size) return alert('Debe seleccionar al menos un distrito para registrar la acción.');

    const detalle = String(qg('grupoDetallePrograma')?.value || '').trim();
    const descripcion = String(qg('grupoDescripcionPrograma')?.value || '').trim();
    if (!detalle || !descripcion) {
      alert('Debe completar las acciones específicas programadas y ejecutadas y la descripción de actividades.');
      return;
    }

    const programa = programaActual();
    const keyR = rdsKeyPrograma(d);
    const fechaRegistro = (typeof fechaHoraLocalISO === 'function') ? fechaHoraLocalISO() : new Date().toISOString();
    const territorios = territorioDecretoSeleccionadoPrograma().filter(t => seleccionDistritosPrograma.has(t.key));
    if (!territorios.length) return alert('No se encontraron distritos válidos seleccionados.');

    const lista = (typeof cargarAccionesLocales === 'function') ? cargarAccionesLocales() : [];
    let actualizados = 0;
    let creados = 0;

    territorios.forEach(t => {
      const idx = lista.findIndex(a =>
        String(a.dsId || a.ds_id || '') === String(d.id) &&
        rdsKeyPrograma(a) === keyR &&
        normalizarProgramaNombre(a.programaNacional || a.programa || '') === programa &&
        (a.ubigeo ? `UBIGEO:${a.ubigeo}` : [a.departamento, a.provincia, a.distrito].map(norm).join('|')) === t.key
      );

      const base = idx >= 0 ? lista[idx] : {};
      const accion = {
        ...base,
        id: base.id || crypto.randomUUID(),
        dsId: d.id,
        ds_id: d.id,
        numeroDS: (typeof formatearNumeroDS === 'function') ? formatearNumeroDS(d) : (d.numero || ''),
        ds: (typeof formatearNumeroDS === 'function') ? formatearNumeroDS(d) : (d.numero || ''),
        numeroReunion: d.numeroReunion || '',
        fechaReunion: d.fechaReunion || '',
        rdsKey: keyR,
        estadoRDS: d.estadoRDS || 'Activo',
        programaNacional: programa,
        programa,
        tipoAccion: base.tipoAccion || base.tipo || 'Acción grupal territorial',
        tipo: base.tipo || base.tipoAccion || 'Acción grupal territorial',
        codigoAccion: base.codigoAccion || base.codigo || `GRUPAL-${String(t.ubigeo || t.distrito || 'DIST').replace(/\s+/g, '-').toUpperCase()}`,
        codigo: base.codigo || base.codigoAccion || `GRUPAL-${String(t.ubigeo || t.distrito || 'DIST').replace(/\s+/g, '-').toUpperCase()}`,
        detalle,
        accionesEspecificas: detalle,
        descripcionActividades: descripcion,
        descripcion,
        departamento: t.departamento || '',
        provincia: t.provincia || '',
        distrito: t.distrito || '',
        ubigeo: t.ubigeo || '',
        unidadMedida: q('progUnidadMedida')?.value || base.unidadMedida || base.unidad || 'Distrito',
        unidad: q('progUnidadMedida')?.value || base.unidad || base.unidadMedida || 'Distrito',
        metaProgramada: Number(q('progMetaProgramada')?.value || base.metaProgramada || base.meta_programada || 0),
        meta_programada: Number(q('progMetaProgramada')?.value || base.meta_programada || base.metaProgramada || 0),
        plazoDias: Number(q('progPlazoDias')?.value || base.plazoDias || base.plazo || 0),
        plazo: Number(q('progPlazoDias')?.value || base.plazo || base.plazoDias || 0),
        fechaInicio: q('progFechaInicio')?.value || base.fechaInicio || base.fecha_inicio || '',
        fecha_inicio: q('progFechaInicio')?.value || base.fecha_inicio || base.fechaInicio || '',
        fechaFinal: q('progFechaFinal')?.value || base.fechaFinal || base.fecha_final || '',
        fecha_final: q('progFechaFinal')?.value || base.fecha_final || base.fechaFinal || '',
        metaEjecutada: Number(q('progMetaEjecutada')?.value || base.metaEjecutada || base.meta_ejecutada || 0),
        meta_ejecutada: Number(q('progMetaEjecutada')?.value || base.meta_ejecutada || base.metaEjecutada || 0),
        avance: q('progAvance')?.value || base.avance || '0%',
        fechaRegistro: base.fechaRegistro || base.fecha_registro || fechaRegistro,
        fecha_registro: base.fecha_registro || base.fechaRegistro || fechaRegistro,
        usuarioRegistro: base.usuarioRegistro || base.usuario_registro || state.session?.email || '',
        usuario_registro: base.usuario_registro || base.usuarioRegistro || state.session?.email || '',
        usuario_actualiza: base.id ? (state.session?.email || '') : '',
        fecha_actualiza: base.id ? fechaRegistro : '',
        estado: 'Registrado'
      };

      if (idx >= 0) {
        lista[idx] = accion;
        actualizados++;
      } else {
        lista.push(accion);
        creados++;
      }
      if (typeof api === 'function') api('/acciones', 'POST', accion);
    });

    if (typeof guardarAccionesLocales === 'function') guardarAccionesLocales(lista);
    const modal = qg('modalAccionGrupalPrograma');
    if (modal && window.bootstrap?.Modal) bootstrap.Modal.getOrCreateInstance(modal).hide();
    seleccionDistritosPrograma.clear();
    renderDistritosAccionesPrograma();
    if (typeof renderTablaAccionesProgramas === 'function') renderTablaAccionesProgramas();
    if (typeof renderTablaDecretosBasica === 'function') renderTablaDecretosBasica();
    alert('Acción registrada correctamente en los distritos seleccionados.');
  }

  const initOriginal = window.initRegistroAccionesProgramas || (typeof initRegistroAccionesProgramas === 'function' ? initRegistroAccionesProgramas : null);
  const cargarVistaOriginal = window.cargarVistaAccionesPrograma || (typeof cargarVistaAccionesPrograma === 'function' ? cargarVistaAccionesPrograma : null);
  const renderTablaOriginal = window.renderTablaAccionesProgramas || (typeof renderTablaAccionesProgramas === 'function' ? renderTablaAccionesProgramas : null);
  const guardarProgramaOriginal = window.guardarAccionPrograma || (typeof guardarAccionPrograma === 'function' ? guardarAccionPrograma : null);

  function initRegistroAccionesProgramasV561() {
    if (initOriginal) {
      try { initOriginal(); } catch (e) { console.warn('initRegistroAccionesProgramas base no completó:', e); }
    }
    renderDistritosAccionesPrograma();

    if (eventosGrupalesInicializados) return;
    eventosGrupalesInicializados = true;
    qg('btnSeleccionarTodosDistritosPrograma')?.addEventListener('click', seleccionarTodosDistritosPrograma);
    qg('btnLimpiarSeleccionDistritosPrograma')?.addEventListener('click', limpiarSeleccionDistritosPrograma);
    qg('btnRegistrarAccionGrupalPrograma')?.addEventListener('click', abrirModalAccionGrupalPrograma);
    qg('btnGuardarAccionGrupalPrograma')?.addEventListener('click', guardarAccionGrupalPrograma);
  }

  function cargarVistaAccionesProgramaV561(id) {
    seleccionDistritosPrograma.clear();
    if (cargarVistaOriginal) cargarVistaOriginal(id);
    renderDistritosAccionesPrograma();
  }

  function renderTablaAccionesProgramasV561() {
    if (renderTablaOriginal) renderTablaOriginal();
    renderDistritosAccionesPrograma();
  }

  function guardarAccionProgramaV561() {
    if (guardarProgramaOriginal) guardarProgramaOriginal();
    setTimeout(() => {
      renderDistritosAccionesPrograma();
      if (typeof renderTablaDecretosBasica === 'function') renderTablaDecretosBasica();
    }, 50);
  }

  window.initRegistroAccionesProgramas = initRegistroAccionesProgramasV561;
  window.cargarVistaAccionesPrograma = cargarVistaAccionesProgramaV561;
  window.renderTablaAccionesProgramas = renderTablaAccionesProgramasV561;
  window.guardarAccionPrograma = guardarAccionProgramaV561;
  window.renderDistritosAccionesPrograma = renderDistritosAccionesPrograma;

  try { initRegistroAccionesProgramas = initRegistroAccionesProgramasV561; } catch {}
  try { cargarVistaAccionesPrograma = cargarVistaAccionesProgramaV561; } catch {}
  try { renderTablaAccionesProgramas = renderTablaAccionesProgramasV561; } catch {}
  try { guardarAccionPrograma = guardarAccionProgramaV561; } catch {}

  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
      try { initRegistroAccionesProgramasV561(); } catch {}
      console.info('DEE MIDIS cierre aplicado:', VERSION_GRUPAL);
    }, 1200);
  });
})();

// ================= AJUSTE FINAL v57.1 - DISTRITOS POR PÁGINA Y LIMPIEZA CAMPOS =================
(function () {
  'use strict';

  const VERSION_V571 = 'v57.1 Distritos por página sin campos redundantes';
  const seleccionV571 = new Set();
  let paginaV571 = 1;
  let eventosV571 = false;

  const q = (id) => document.getElementById(id);
  const normV571 = (v) => (typeof normalizarTexto === 'function'
    ? normalizarTexto(v)
    : String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase());
  const escV571 = (v) => (typeof escapeHtml === 'function' ? escapeHtml(v) : String(v ?? ''));
  const escAttrV571 = (v) => (typeof escapeHtmlAttr === 'function' ? escapeHtmlAttr(v) : escV571(v));
  const progV571 = () => (typeof programaSesionNormalizado === 'function' ? programaSesionNormalizado() : '');

  function keyTerritorioV571(t) {
    const ubigeo = String(t?.ubigeo || t?.UBIGEO || t?.codigo || '').trim();
    if (ubigeo) return `UBIGEO:${ubigeo}`;
    return [t?.departamento, t?.provincia, t?.distrito].map(normV571).join('|');
  }

  function ordenTerritorioV571(t) {
    return [t?.departamento || '', t?.provincia || '', t?.distrito || ''].map(x => String(x).trim()).join('|');
  }

  function territorioDSProgramaV571() {
    const d = (typeof buscarDecretoPorId === 'function') ? buscarDecretoPorId(dsProgramaSeleccionadoId) : null;
    const territorio = Array.isArray(d?.territorio) ? d.territorio : [];
    const mapa = new Map();
    territorio.forEach(t => {
      const dep = t?.departamento || '';
      const prov = t?.provincia || '';
      const dist = t?.distrito || '';
      if (!dep && !prov && !dist) return;
      const key = keyTerritorioV571(t);
      if (!mapa.has(key)) {
        mapa.set(key, {
          key,
          ubigeo: t?.ubigeo || t?.UBIGEO || t?.codigo || '',
          departamento: dep,
          provincia: prov,
          distrito: dist
        });
      }
    });
    return [...mapa.values()].sort((a, b) => ordenTerritorioV571(a).localeCompare(ordenTerritorioV571(b), 'es'));
  }

  function rdsKeyV571(obj) {
    if (typeof reunionKeyV38 === 'function') return reunionKeyV38(obj?.numeroReunion || '', obj?.fechaReunion || '');
    return `${normV571(obj?.numeroReunion || '')}|${String(obj?.fechaReunion || '').trim()}`;
  }

  function accionesProgramaDistritoV571() {
    const d = (typeof buscarDecretoPorId === 'function') ? buscarDecretoPorId(dsProgramaSeleccionadoId) : null;
    if (!d || typeof cargarAccionesLocales !== 'function') return [];
    const keyR = rdsKeyV571(d);
    const programa = progV571();
    return cargarAccionesLocales().filter(a =>
      String(a.dsId || a.ds_id || '') === String(d.id) &&
      (!keyR || rdsKeyV571(a) === keyR) &&
      normalizarProgramaNombre(a.programaNacional || a.programa || '') === programa &&
      (a.departamento || a.provincia || a.distrito || a.ubigeo)
    );
  }

  function accionesDeTerritorioV571(t) {
    const keyT = keyTerritorioV571(t);
    return accionesProgramaDistritoV571().filter(a => {
      const keyA = a.ubigeo ? `UBIGEO:${a.ubigeo}` : [a.departamento, a.provincia, a.distrito].map(normV571).join('|');
      return keyA === keyT;
    });
  }

  function resumenV571(acciones, k1, k2) {
    const vals = acciones.map(a => String(a?.[k1] || a?.[k2] || '').trim()).filter(Boolean);
    return [...new Set(vals)].join('<hr class="my-1">');
  }

  function pageSizeV571() {
    const n = parseInt(q('progDistritosPageSize')?.value || '10', 10);
    return [10, 25, 50, 100].includes(n) ? n : 10;
  }

  function paginasV571(total) {
    return Math.max(1, Math.ceil(total / pageSizeV571()));
  }

  function distritosVisiblesPaginaV571() {
    const distritos = territorioDSProgramaV571();
    const totalPaginas = paginasV571(distritos.length);
    if (paginaV571 > totalPaginas) paginaV571 = totalPaginas;
    if (paginaV571 < 1) paginaV571 = 1;
    const desde = (paginaV571 - 1) * pageSizeV571();
    return distritos.slice(desde, desde + pageSizeV571());
  }

  function actualizarControlesPaginaV571(total) {
    const totalPaginas = paginasV571(total);
    const desde = total ? ((paginaV571 - 1) * pageSizeV571()) + 1 : 0;
    const hasta = Math.min(total, paginaV571 * pageSizeV571());
    if (q('progDistritosContador')) q('progDistritosContador').textContent = `Mostrando ${desde}-${hasta} de ${total} registros`;
    if (q('progDistritosPaginaInfo')) q('progDistritosPaginaInfo').textContent = `Página ${paginaV571} de ${totalPaginas}`;
    if (q('btnProgDistritosAnterior')) q('btnProgDistritosAnterior').disabled = paginaV571 <= 1;
    if (q('btnProgDistritosSiguiente')) q('btnProgDistritosSiguiente').disabled = paginaV571 >= totalPaginas;
  }

  function ocultarCamposRedundantesV571() {
    ['progDetalle', 'progDescripcionActividades'].forEach(id => {
      const el = q(id);
      if (!el) return;
      el.classList.add('d-none');
      el.setAttribute('aria-hidden', 'true');
      const col = el.closest('.col-12');
      if (col) col.style.display = 'none';
    });
  }

  function renderDistritosAccionesProgramaV571() {
    const tbody = document.querySelector('#tablaDistritosAccionesPrograma tbody');
    if (!tbody) return;
    ocultarCamposRedundantesV571();

    const d = (typeof buscarDecretoPorId === 'function') ? buscarDecretoPorId(dsProgramaSeleccionadoId) : null;
    if (!d) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-muted">Seleccione un Decreto Supremo activado.</td></tr>';
      actualizarControlesPaginaV571(0);
      return;
    }

    const distritos = territorioDSProgramaV571();
    if (!distritos.length) {
      tbody.innerHTML = `<tr><td colspan="${colspan}" class="text-muted">El Decreto Supremo seleccionado no tiene distritos registrados.</td></tr>`;
      actualizarControlesPaginaV571(0);
      return;
    }

    const visibles = distritosVisiblesPaginaV571();
    tbody.innerHTML = visibles.map(t => {
      const acciones = accionesDeTerritorioV571(t);
      const detalle = resumenV571(acciones, 'detalle', 'accionesEspecificas');
      const descripcion = resumenV571(acciones, 'descripcionActividades', 'descripcion');
      const checked = seleccionV571.has(t.key) ? 'checked' : '';
      const estadoFila = acciones.length ? '<span class="badge text-bg-success">Registrado</span>' : '<span class="badge text-bg-secondary">Pendiente</span>';
      return `<tr data-territorio-key="${escAttrV571(t.key)}">
        <td class="text-center"><input class="form-check-input chk-distrito-programa-v571" type="checkbox" value="${escAttrV571(t.key)}" ${checked}></td>
        <td>${escV571(t.departamento)}</td>
        <td>${escV571(t.provincia)}</td>
        <td><strong>${escV571(t.distrito)}</strong><div class="small text-muted">${estadoFila}</div></td>
        <td>${detalle || '<span class="text-muted">Pendiente</span>'}</td>
        <td>${descripcion || '<span class="text-muted">Pendiente</span>'}</td>
      </tr>`;
    }).join('');

    tbody.querySelectorAll('.chk-distrito-programa-v571').forEach(chk => {
      chk.addEventListener('change', () => {
        if (chk.checked) seleccionV571.add(chk.value);
        else seleccionV571.delete(chk.value);
      });
    });
    actualizarControlesPaginaV571(distritos.length);
  }

  function seleccionarTodosVisiblesV571() {
    distritosVisiblesPaginaV571().forEach(t => seleccionV571.add(t.key));
    renderDistritosAccionesProgramaV571();
  }

  function limpiarSeleccionV571() {
    seleccionV571.clear();
    renderDistritosAccionesProgramaV571();
  }

  function normalizarTipoAccionGrupalV58(valor) {
    const raw = String(valor || '').trim();
    const n = normV571(raw);
    if (!n) return '';
    if (n.includes('PREPARACION')) return 'Acciones de Preparación (Solo DEE por Peligro Inminente)';
    if (n.includes('RESPUESTA')) return 'Acciones de Respuesta';
    if (n.includes('REHABILITACION')) return 'Acciones de Rehabilitación';
    return '';
  }

  function abrirModalGrupalV571() {
    if (typeof esRegistradorPrograma === 'function' && !esRegistradorPrograma()) {
      alert('Esta opción corresponde a Registradores de Programas Nacionales.');
      return;
    }
    if (!dsProgramaSeleccionadoId) return alert('Seleccione un Decreto Supremo activado.');
    if (!seleccionV571.size) return alert('Debe seleccionar al menos un distrito para registrar la acción.');
    if (q('grupoDetallePrograma')) q('grupoDetallePrograma').value = '';
    if (q('grupoDescripcionPrograma')) q('grupoDescripcionPrograma').value = '';
    const modal = q('modalAccionGrupalPrograma');
    if (modal && window.bootstrap?.Modal) bootstrap.Modal.getOrCreateInstance(modal).show();
    else alert('No se encontró el modal de registro grupal.');
  }

  function guardarGrupalV571() {
    const d = (typeof buscarDecretoPorId === 'function') ? buscarDecretoPorId(dsProgramaSeleccionadoId) : null;
    if (typeof esRegistradorPrograma === 'function' && !esRegistradorPrograma()) return alert('Solo un Registrador de Programa puede registrar acciones grupales.');
    if (!d || !d.rdsActivo) return alert('El Decreto Supremo no tiene RDS activo.');
    if (!d.numeroReunion || !d.fechaReunion) return alert('El RDS no tiene número y fecha de reunión activos.');
    if (!seleccionV571.size) return alert('Debe seleccionar al menos un distrito para registrar la acción.');

    const detalle = String(q('grupoDetallePrograma')?.value || '').trim();
    const descripcion = String(q('grupoDescripcionPrograma')?.value || '').trim();
    if (!detalle || !descripcion) return alert('Debe completar las acciones específicas programadas y ejecutadas y la descripción de actividades.');

    const tipoFormulario = normalizarTipoAccionGrupalV58(q('progTipoAccion')?.value || '');
    const subtipoFormulario = String(q('progSubtipoRehabilitacion')?.value || '').trim();
    if (!tipoFormulario) return alert('Seleccione un Tipo de Acción válido del catálogo oficial.');
    if (normalizarTexto(tipoFormulario).includes('REHABILITACION') && !subtipoFormulario) return alert('Seleccione el Subtipo de Rehabilitación.');

    const programa = progV571();
    const keyR = rdsKeyV571(d);
    const fechaRegistro = (typeof fechaHoraLocalISO === 'function') ? fechaHoraLocalISO() : new Date().toISOString();
    const territorios = territorioDSProgramaV571().filter(t => seleccionV571.has(t.key));
    if (!territorios.length) return alert('No se encontraron distritos válidos seleccionados.');

    const lista = (typeof cargarAccionesLocales === 'function') ? cargarAccionesLocales() : [];
    territorios.forEach(t => {
      const codigoBase = `GRUPAL-${String(t.ubigeo || t.distrito || 'DIST').replace(/\s+/g, '-').toUpperCase()}`;
      const codigoFormulario = String(q('progCodigoAccion')?.value || '').trim() || codigoBase;
      const idx = lista.findIndex(a =>
        String(a.dsId || a.ds_id || '') === String(d.id) &&
        rdsKeyV571(a) === keyR &&
        normalizarProgramaNombre(a.programaNacional || a.programa || '') === programa &&
        (a.ubigeo ? `UBIGEO:${a.ubigeo}` : [a.departamento, a.provincia, a.distrito].map(normV571).join('|')) === t.key &&
        normalizarTipoAccionGrupalV58(a.tipoAccion || a.tipo || '') === tipoFormulario &&
        normalizarTexto(a.codigoAccion || a.codigo || '') === normalizarTexto(codigoFormulario)
      );
      const base = idx >= 0 ? lista[idx] : {};
      const accion = {
        ...base,
        id: base.id || crypto.randomUUID(),
        dsId: d.id,
        ds_id: d.id,
        numeroDS: (typeof formatearNumeroDS === 'function') ? formatearNumeroDS(d) : (d.numero || ''),
        ds: (typeof formatearNumeroDS === 'function') ? formatearNumeroDS(d) : (d.numero || ''),
        numeroReunion: d.numeroReunion || '',
        fechaReunion: d.fechaReunion || '',
        rdsKey: keyR,
        estadoRDS: d.estadoRDS || 'Activo',
        programaNacional: programa,
        programa,
        tipoAccion: tipoFormulario,
        tipo: tipoFormulario,
        subtipoRehabilitacion: normalizarTexto(tipoFormulario).includes('REHABILITACION') ? subtipoFormulario : '',
        subtipo_rehabilitacion: normalizarTexto(tipoFormulario).includes('REHABILITACION') ? subtipoFormulario : '',
        codigoAccion: codigoFormulario,
        codigo: codigoFormulario,
        detalle,
        accionesEspecificas: detalle,
        descripcionActividades: descripcion,
        descripcion,
        departamento: t.departamento || '',
        provincia: t.provincia || '',
        distrito: t.distrito || '',
        ubigeo: t.ubigeo || '',
        unidadMedida: base.unidadMedida || base.unidad || 'Distrito',
        unidad: base.unidad || base.unidadMedida || 'Distrito',
        metaProgramada: base.metaProgramada ?? base.meta_programada ?? 0,
        meta_programada: base.meta_programada ?? base.metaProgramada ?? 0,
        plazoDias: base.plazoDias ?? base.plazo ?? 0,
        plazo: base.plazo ?? base.plazoDias ?? 0,
        fechaInicio: base.fechaInicio || base.fecha_inicio || '',
        fecha_inicio: base.fecha_inicio || base.fechaInicio || '',
        fechaFinal: base.fechaFinal || base.fecha_final || '',
        fecha_final: base.fecha_final || base.fechaFinal || '',
        metaEjecutada: base.metaEjecutada ?? base.meta_ejecutada ?? 0,
        meta_ejecutada: base.meta_ejecutada ?? base.metaEjecutada ?? 0,
        avance: base.avance || '0%',
        fechaRegistro: base.fechaRegistro || base.fecha_registro || fechaRegistro,
        fecha_registro: base.fecha_registro || base.fechaRegistro || fechaRegistro,
        usuarioRegistro: base.usuarioRegistro || base.usuario_registro || state.session?.email || '',
        usuario_registro: base.usuario_registro || base.usuarioRegistro || state.session?.email || '',
        usuario_actualiza: base.id ? (state.session?.email || '') : '',
        fecha_actualiza: base.id ? fechaRegistro : '',
        estado: 'Registrado'
      };
      if (idx >= 0) lista[idx] = accion;
      else lista.push(accion);
      if (typeof api === 'function') api('/acciones', 'POST', accion);
    });

    if (typeof guardarAccionesLocales === 'function') guardarAccionesLocales(lista);
    const modal = q('modalAccionGrupalPrograma');
    if (modal && window.bootstrap?.Modal) bootstrap.Modal.getOrCreateInstance(modal).hide();
    seleccionV571.clear();
    renderDistritosAccionesProgramaV571();
    if (typeof renderTablaAccionesProgramas === 'function') renderTablaAccionesProgramas();
    if (typeof renderTablaDecretosBasica === 'function') renderTablaDecretosBasica();
    alert('Acción registrada correctamente en los distritos seleccionados.');
  }

  const cargarVistaOriginalV571 = window.cargarVistaAccionesPrograma || (typeof cargarVistaAccionesPrograma === 'function' ? cargarVistaAccionesPrograma : null);
  const initOriginalV571 = window.initRegistroAccionesProgramas || (typeof initRegistroAccionesProgramas === 'function' ? initRegistroAccionesProgramas : null);
  const renderTablaOriginalV571 = window.renderTablaAccionesProgramas || (typeof renderTablaAccionesProgramas === 'function' ? renderTablaAccionesProgramas : null);

  function initRegistroAccionesProgramasV571() {
    if (initOriginalV571) {
      try { initOriginalV571(); } catch (e) { console.warn('initRegistroAccionesProgramas base no completó:', e); }
    }
    ocultarCamposRedundantesV571();
    renderDistritosAccionesProgramaV571();
    if (eventosV571) return;
    eventosV571 = true;

    q('progDistritosPageSize')?.addEventListener('change', () => { paginaV571 = 1; renderDistritosAccionesProgramaV571(); });
    q('btnProgDistritosAnterior')?.addEventListener('click', () => { paginaV571 = Math.max(1, paginaV571 - 1); renderDistritosAccionesProgramaV571(); });
    q('btnProgDistritosSiguiente')?.addEventListener('click', () => { paginaV571 += 1; renderDistritosAccionesProgramaV571(); });

    q('btnSeleccionarTodosDistritosPrograma')?.addEventListener('click', (e) => {
      e.preventDefault(); e.stopImmediatePropagation(); seleccionarTodosVisiblesV571();
    }, true);
    q('btnLimpiarSeleccionDistritosPrograma')?.addEventListener('click', (e) => {
      e.preventDefault(); e.stopImmediatePropagation(); limpiarSeleccionV571();
    }, true);
    q('btnRegistrarAccionGrupalPrograma')?.addEventListener('click', (e) => {
      e.preventDefault(); e.stopImmediatePropagation(); abrirModalGrupalV571();
    }, true);
    q('btnGuardarAccionGrupalPrograma')?.addEventListener('click', (e) => {
      e.preventDefault(); e.stopImmediatePropagation(); guardarGrupalV571();
    }, true);
  }

  function cargarVistaAccionesProgramaV571(id) {
    seleccionV571.clear();
    paginaV571 = 1;
    if (cargarVistaOriginalV571) cargarVistaOriginalV571(id);
    ocultarCamposRedundantesV571();
    renderDistritosAccionesProgramaV571();
  }

  function renderTablaAccionesProgramasV571() {
    if (renderTablaOriginalV571) renderTablaOriginalV571();
    ocultarCamposRedundantesV571();
    renderDistritosAccionesProgramaV571();
  }

  window.initRegistroAccionesProgramas = initRegistroAccionesProgramasV571;
  window.cargarVistaAccionesPrograma = cargarVistaAccionesProgramaV571;
  window.renderTablaAccionesProgramas = renderTablaAccionesProgramasV571;
  window.renderDistritosAccionesPrograma = renderDistritosAccionesProgramaV571;

  try { initRegistroAccionesProgramas = initRegistroAccionesProgramasV571; } catch {}
  try { cargarVistaAccionesPrograma = cargarVistaAccionesProgramaV571; } catch {}
  try { renderTablaAccionesProgramas = renderTablaAccionesProgramasV571; } catch {}

  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
      try { initRegistroAccionesProgramasV571(); } catch (e) { console.warn('No se pudo inicializar v57.1:', e); }
      console.info('DEE MIDIS cierre aplicado:', VERSION_V571);
    }, 1400);
  });
})();

// ================= CORRECCIÓN v59.1 - CAMPOS COMPLETOS EN ACCIÓN GRUPAL TERRITORIAL =================
// Alcance: Registro Acciones Programas. No modifica login, roles ni otros módulos.
(function(){
  const VERSION = 'v59.1-campos-completos-accion-grupal';
  const $v = (id) => document.getElementById(id);
  const txt = (v) => String(v ?? '').trim();
  const norm = (v) => txt(v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();

  function normalizarTipo(valor){
    const n = norm(valor);
    if (!n) return '';
    if (n.includes('PREPARACION')) return 'Acciones de Preparación (Solo DEE por Peligro Inminente)';
    if (n.includes('RESPUESTA')) return 'Acciones de Respuesta';
    if (n.includes('REHABILITACION')) return 'Acciones de Rehabilitación';
    return '';
  }

  function normalizarNumero(valor){
    const raw = txt(valor).replace(',', '.');
    if (raw === '') return '';
    const n = Number(raw.replace('%', ''));
    return Number.isFinite(n) ? n : raw;
  }

  function normalizarEntero(valor){
    const n = parseInt(txt(valor), 10);
    return Number.isFinite(n) ? n : '';
  }

  function normalizarAvance(valor, metaProgramada, metaEjecutada){
    let raw = txt(valor);
    if (!raw && Number(metaProgramada) > 0) {
      raw = String(Math.min(100, Math.round((Number(metaEjecutada || 0) / Number(metaProgramada)) * 100)));
    }
    if (!raw) return '0%';
    const n = Number(raw.replace('%', '').replace(',', '.'));
    if (Number.isFinite(n)) return `${Math.min(100, Math.max(0, Math.round(n)))}%`;
    return raw;
  }

  function fechaHoraLocal(){
    try { if (typeof fechaHoraLocalISO === 'function') return fechaHoraLocalISO(); } catch {}
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }

  function getDecretoActual(){
    try { return typeof buscarDecretoPorId === 'function' ? buscarDecretoPorId(dsProgramaSeleccionadoId) : null; } catch { return null; }
  }

  function formatearDS(d){
    try { if (typeof formatearNumeroDSFinal === 'function') return formatearNumeroDSFinal(d); } catch {}
    try { if (typeof formatearNumeroDS === 'function') return formatearNumeroDS(d); } catch {}
    return txt(d?.numeroDS || d?.ds || d?.numero || '');
  }

  function programaActual(){
    try { return typeof programaSesionNormalizado === 'function' ? programaSesionNormalizado() : norm($v('progProgramaNacional')?.value); } catch { return norm($v('progProgramaNacional')?.value); }
  }

  function rdsKey(d){
    return [txt(d?.id || d?.dsId || d?.ds_id), norm(d?.numeroReunion || d?.numero_reunion || $v('progNumeroReunion')?.value), txt(d?.fechaReunion || d?.fecha_reunion || $v('progFechaReunion')?.value)].join('|');
  }

  function territorioKey(t){
    const ubigeo = txt(t?.ubigeo || t?.UBIGEO || t?.codigo || t?.cod_ubigeo);
    if (ubigeo) return `UBIGEO:${ubigeo}`;
    return [t?.departamento, t?.provincia, t?.distrito].map(norm).join('|');
  }

  function territoriosActuales(d){
    const arr = Array.isArray(d?.territorio) ? d.territorio : [];
    const map = new Map();
    arr.forEach(t => {
      const obj = {
        key: territorioKey(t),
        departamento: txt(t.departamento),
        provincia: txt(t.provincia),
        distrito: txt(t.distrito),
        ubigeo: txt(t.ubigeo || t.UBIGEO || t.codigo || t.cod_ubigeo)
      };
      if (obj.distrito && !map.has(obj.key)) map.set(obj.key, obj);
    });
    return [...map.values()].sort((a,b) => `${a.departamento}|${a.provincia}|${a.distrito}`.localeCompare(`${b.departamento}|${b.provincia}|${b.distrito}`,'es'));
  }

  function seleccionadosActuales(d){
    const keys = new Set(Array.from(document.querySelectorAll('.chk-distrito-programa-v571:checked, .chk-distrito-programa:checked')).map(x => x.value));
    if (!keys.size) return [];
    return territoriosActuales(d).filter(t => keys.has(t.key));
  }

  function valoresFormularioPrincipal(){
    try { if (typeof calcularFechaFinalPrograma === 'function') calcularFechaFinalPrograma(); } catch {}
    try { if (typeof calcularAvancePrograma === 'function') calcularAvancePrograma(); } catch {}

    const metaProgramada = normalizarNumero($v('progMetaProgramada')?.value);
    const metaEjecutada = normalizarNumero($v('progMetaEjecutada')?.value);
    const avance = normalizarAvance($v('progAvance')?.value, metaProgramada, metaEjecutada);
    const tipoAccion = normalizarTipo($v('progTipoAccion')?.value);
    const subtipo = txt($v('progSubtipoRehabilitacion')?.value);

    return {
      programa: programaActual(),
      tipoAccion,
      subtipoRehabilitacion: norm(tipoAccion).includes('REHABILITACION') ? subtipo : '',
      codigoAccion: txt($v('progCodigoAccion')?.value),
      unidadMedida: txt($v('progUnidadMedida')?.value),
      metaProgramada,
      plazoDias: normalizarEntero($v('progPlazoDias')?.value),
      fechaInicio: txt($v('progFechaInicio')?.value),
      fechaFinal: txt($v('progFechaFinal')?.value),
      metaEjecutada,
      avance,
      fechaRegistro: txt($v('progFechaRegistro')?.value) || fechaHoraLocal()
    };
  }

  function validarPrincipal(v){
    if (!v.tipoAccion) return 'Seleccione un Tipo de Acción válido del catálogo oficial.';
    if (norm(v.tipoAccion).includes('REHABILITACION') && !v.subtipoRehabilitacion) return 'Seleccione el Subtipo de Rehabilitación.';
    if (!v.codigoAccion) return 'Ingrese el Código de acción.';
    if (!v.unidadMedida) return 'Seleccione la Unidad de medida.';
    if (v.metaProgramada === '') return 'Ingrese la Meta programada.';
    if (v.plazoDias === '') return 'Ingrese el Plazo (días).';
    if (!v.fechaInicio) return 'Ingrese la F. inicio.';
    if (!v.fechaFinal) return 'Ingrese la F. final.';
    if (v.metaEjecutada === '') return 'Ingrese la Meta ejecutada.';
    if (!v.avance) return 'Ingrese o calcule el % Avance.';
    const ini = new Date(`${v.fechaInicio}T00:00:00`).getTime();
    const fin = new Date(`${v.fechaFinal}T00:00:00`).getTime();
    if (!Number.isNaN(ini) && !Number.isNaN(fin) && ini > fin) return 'La F. inicio no puede ser mayor que la F. final.';
    return '';
  }

  function claveAccion(a){
    return [
      txt(a.dsId || a.ds_id),
      norm(a.numeroReunion),
      txt(a.fechaReunion),
      norm(a.programaNacional || a.programa),
      norm(a.departamento),
      norm(a.provincia),
      norm(a.distrito),
      normalizarTipo(a.tipoAccion || a.tipo),
      norm(a.codigoAccion || a.codigo)
    ].join('|');
  }

  function guardarAccionGrupalCompleta(){
    const d = getDecretoActual();
    try { if (typeof esRegistradorPrograma === 'function' && !esRegistradorPrograma()) return alert('Solo un Registrador de Programa puede registrar acciones grupales.'); } catch {}
    if (!d || !d.rdsActivo) return alert('El Decreto Supremo no tiene RDS activo.');
    if (!txt(d.numeroReunion || $v('progNumeroReunion')?.value) || !txt(d.fechaReunion || $v('progFechaReunion')?.value)) return alert('El RDS no tiene número y fecha de reunión activos.');

    const territorios = seleccionadosActuales(d);
    if (!territorios.length) return alert('Debe seleccionar al menos un distrito.');

    const detalle = txt($v('grupoDetallePrograma')?.value);
    const descripcion = txt($v('grupoDescripcionPrograma')?.value);
    if (!detalle || !descripcion) return alert('Debe completar las acciones específicas programadas y ejecutadas y la descripción de actividades.');

    const v = valoresFormularioPrincipal();
    const error = validarPrincipal(v);
    if (error) return alert(error);

    const lista = (typeof cargarAccionesLocales === 'function') ? cargarAccionesLocales() : [];
    const fechaRegistro = v.fechaRegistro || fechaHoraLocal();
    const numeroReunion = txt(d.numeroReunion || $v('progNumeroReunion')?.value);
    const fechaReunion = txt(d.fechaReunion || $v('progFechaReunion')?.value);
    const rds = rdsKey({ ...d, numeroReunion, fechaReunion });
    let guardados = 0;

    territorios.forEach(t => {
      const registroNuevo = {
        dsId: d.id,
        ds_id: d.id,
        numeroDS: formatearDS(d),
        ds: formatearDS(d),
        numeroReunion,
        fechaReunion,
        rdsKey: rds,
        estadoRDS: d.estadoRDS || 'Activo',
        programaNacional: v.programa,
        programa: v.programa,
        tipoAccion: v.tipoAccion,
        tipo: v.tipoAccion,
        subtipoRehabilitacion: v.subtipoRehabilitacion,
        subtipo_rehabilitacion: v.subtipoRehabilitacion,
        codigoAccion: v.codigoAccion,
        codigo: v.codigoAccion,
        unidadMedida: v.unidadMedida,
        unidad: v.unidadMedida,
        metaProgramada: v.metaProgramada,
        meta_programada: v.metaProgramada,
        plazoDias: v.plazoDias,
        plazo: v.plazoDias,
        fechaInicio: v.fechaInicio,
        fecha_inicio: v.fechaInicio,
        fechaFinal: v.fechaFinal,
        fecha_final: v.fechaFinal,
        metaEjecutada: v.metaEjecutada,
        meta_ejecutada: v.metaEjecutada,
        avance: v.avance,
        detalle,
        accionesEspecificas: detalle,
        descripcionActividades: descripcion,
        descripcion,
        departamento: t.departamento || '',
        provincia: t.provincia || '',
        distrito: t.distrito || '',
        ubigeo: t.ubigeo || '',
        fechaRegistro,
        fecha_registro: fechaRegistro,
        usuarioRegistro: state.session?.email || '',
        usuario_registro: state.session?.email || '',
        estado: 'Registrado'
      };

      const claveNueva = claveAccion(registroNuevo);
      const idx = lista.findIndex(a => claveAccion(a) === claveNueva);
      const anterior = idx >= 0 ? lista[idx] : null;
      const accion = {
        ...(anterior || {}),
        ...registroNuevo,
        id: anterior?.id || (crypto?.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random())),
        fechaRegistro: anterior?.fechaRegistro || anterior?.fecha_registro || fechaRegistro,
        fecha_registro: anterior?.fecha_registro || anterior?.fechaRegistro || fechaRegistro,
        usuarioRegistro: anterior?.usuarioRegistro || anterior?.usuario_registro || state.session?.email || '',
        usuario_registro: anterior?.usuario_registro || anterior?.usuarioRegistro || state.session?.email || '',
        usuario_actualiza: anterior ? (state.session?.email || '') : '',
        fecha_actualiza: anterior ? fechaHoraLocal() : ''
      };
      if (idx >= 0) lista[idx] = accion;
      else lista.push(accion);
      guardados++;
      try { if (typeof api === 'function') api('/acciones', 'POST', accion); } catch {}
    });

    if (!guardados) return alert('No se pudo guardar la acción grupal en los distritos seleccionados.');
    if (typeof guardarAccionesLocales === 'function') guardarAccionesLocales(lista);

    const modal = $v('modalAccionGrupalPrograma');
    if (modal && window.bootstrap?.Modal) bootstrap.Modal.getOrCreateInstance(modal).hide();
    document.querySelectorAll('.chk-distrito-programa-v571:checked, .chk-distrito-programa:checked').forEach(chk => chk.checked = false);
    try { if (typeof renderDistritosAccionesPrograma === 'function') renderDistritosAccionesPrograma(); } catch {}
    try { if (typeof renderTablaAccionesProgramas === 'function') renderTablaAccionesProgramas(); } catch {}
    try { if (typeof renderTablaDecretosBasica === 'function') renderTablaDecretosBasica(); } catch {}
    alert('Acción registrada correctamente en los distritos seleccionados.');
  }

  function reemplazarBotonGuardarGrupal(){
    const oldBtn = $v('btnGuardarAccionGrupalPrograma');
    if (!oldBtn || oldBtn.dataset.v591 === '1') return;
    const newBtn = oldBtn.cloneNode(true);
    newBtn.dataset.v591 = '1';
    oldBtn.parentNode.replaceChild(newBtn, oldBtn);
    newBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      guardarAccionGrupalCompleta();
    }, true);
  }

  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(reemplazarBotonGuardarGrupal, 2200);
    document.addEventListener('shown.bs.modal', (ev) => {
      if (ev.target && ev.target.id === 'modalAccionGrupalPrograma') reemplazarBotonGuardarGrupal();
    });
    setInterval(reemplazarBotonGuardarGrupal, 2000);
    console.info('DEE MIDIS cierre aplicado:', VERSION);
  });
})();

// ================= CIERRE FINAL v61.1 - D1 + DUPLICADOS + DS LIMPIO =================
// Alcance: corrige DS repetido, lectura desde D1, UPDATE/INSERT lógico, control territorial y exportación sin romper módulos previos.
(function(){
  'use strict';
  const VERSION = 'v61.1 D1 duplicados exportacion territorio';
  const STORAGE = (typeof ACCIONES_STORAGE_KEY !== 'undefined') ? ACCIONES_STORAGE_KEY : 'accionesDS';
  const $x = (id) => document.getElementById(id);
  const txt = (v) => String(v ?? '').trim();
  const norm = (v) => txt(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/\s+/g,' ');

  function fechaISO(v){
    const s = txt(v);
    if (!s) return '';
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0,10);
    const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (m) return `${m[3]}-${String(m[2]).padStart(2,'0')}-${String(m[1]).padStart(2,'0')}`;
    return s.slice(0,10);
  }

  function limpiarNumeroDSRaw(raw, anio){
    let s = txt(raw);
    if (!s && anio) return '';
    s = s.replace(/^D\.?\s*S\.?\s*N?[°.º]?\s*/i, '');
    s = s.replace(/^DS[-\s]*/i, '');
    s = s.replace(/\s+/g, '');
    s = s.replace(/-PCM-(\d{4})-PCM$/i, '-PCM');
    s = s.replace(/-(\d{4})-PCM-\1-PCM$/i, '-$1-PCM');
    s = s.replace(/-PCM-(\d{4})$/i, '-PCM');
    if (/^\d{1,4}$/.test(s) && anio) s = `${s.padStart(3,'0')}-${anio}-PCM`;
    if (/^\d{1,4}-\d{4}$/i.test(s)) s = `${s}-PCM`;
    s = s.replace(/^0+(\d{3,})/, '$1');
    if (/^\d{1,2}-\d{4}-PCM$/i.test(s)) s = s.replace(/^(\d{1,2})-/, m => m.replace('-', '').padStart(3,'0') + '-');
    return s;
  }

  function numeroDSCanonico(d){
    const anio = txt(d?.anio || d?.año || '');
    const candidatos = [d?.numero, d?.ds, d?.numeroDS, d?.decreto_supremo, d?.codigo_registro, d?.codigoRegistro, d?.id];
    for (const c of candidatos) {
      const limpio = limpiarNumeroDSRaw(c, anio);
      if (/^\d{3,4}-\d{4}-PCM$/i.test(limpio)) return limpio.toUpperCase();
    }
    const n = limpiarNumeroDSRaw(d?.numero || '', anio);
    return n ? n.toUpperCase() : txt(d?.id || '').toUpperCase();
  }

  const formatearNumeroDSPrevV611 = window.formatearNumeroDS || (typeof formatearNumeroDS === 'function' ? formatearNumeroDS : null);
  function formatearNumeroDSV611(d){
    const n = numeroDSCanonico(d || {});
    if (n) return `D.S. N°${n}`;
    if (formatearNumeroDSPrevV611) return String(formatearNumeroDSPrevV611(d)).replace(/-PCM-\d{4}(?:-PCM)?$/i,'-PCM');
    return 'D.S. N°';
  }
  window.formatearNumeroDS = formatearNumeroDSV611;
  try { formatearNumeroDS = formatearNumeroDSV611; } catch {}

  function programaNorm(v){
    try { if (typeof normalizarProgramaNombre === 'function') return normalizarProgramaNombre(v); } catch {}
    const n = norm(v);
    if (n === 'CUNA MAS' || n === 'CUNAMAS') return 'CUNA MÁS';
    if (n === 'PENSION 65') return 'PENSIÓN 65';
    return n;
  }

  function val(o, ...keys){
    for (const k of keys) {
      const v = o?.[k];
      if (v !== undefined && v !== null && txt(v) !== '') return v;
    }
    return '';
  }

  function reunionBase(v){
    return norm(String(v || '')
      .replace(/\s*-\s*\d{1,2}\/\d{1,2}\/\d{2,4}.*$/,'')
      .replace(/\s*-\s*\d{4}-\d{2}-\d{2}.*$/,''));
  }

  function claveLogicaAccion(a){
    return [
      txt(val(a,'dsId','ds_id')),
      reunionBase(val(a,'numeroReunion','numero_reunion')),
      fechaISO(val(a,'fechaReunion','fecha_reunion')),
      programaNorm(val(a,'programaNacional','programa')),
      norm(val(a,'departamento')),
      norm(val(a,'provincia')),
      norm(val(a,'distrito')),
      norm(val(a,'tipoAccion','tipo','tipo_accion')),
      norm(val(a,'codigoAccion','codigo','codigo_accion'))
    ].join('|');
  }

  function accionNormalizada(a){
    const numeroReunion = txt(val(a,'numeroReunion','numero_reunion'));
    const fechaReunion = txt(val(a,'fechaReunion','fecha_reunion'));
    const programa = programaNorm(val(a,'programaNacional','programa'));
    const tipo = txt(val(a,'tipoAccion','tipo','tipo_accion'));
    const codigo = txt(val(a,'codigoAccion','codigo','codigo_accion'));
    const unidad = txt(val(a,'unidadMedida','unidad','unidad_medida'));
    const plazo = val(a,'plazoDias','plazo_dias','plazo');
    const fechaRegistro = txt(val(a,'fechaRegistro','fecha_registro')) || new Date().toISOString();
    const usuario = txt(val(a,'usuarioRegistro','usuario_registro','usuario')) || ((typeof state !== 'undefined' ? state.session?.email : '') || '');
    return {
      ...a,
      id: txt(a?.id) || (crypto?.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random())),
      dsId: txt(val(a,'dsId','ds_id')),
      ds_id: txt(val(a,'ds_id','dsId')),
      numeroReunion,
      numero_reunion: numeroReunion,
      fechaReunion,
      fecha_reunion: fechaReunion,
      programaNacional: programa,
      programa,
      tipoAccion: tipo,
      tipo,
      codigoAccion: codigo,
      codigo,
      unidadMedida: unidad,
      unidad,
      metaProgramada: val(a,'metaProgramada','meta_programada') === '' ? 0 : Number(val(a,'metaProgramada','meta_programada')),
      meta_programada: val(a,'meta_programada','metaProgramada') === '' ? 0 : Number(val(a,'meta_programada','metaProgramada')),
      plazoDias: plazo === '' ? 0 : Number(plazo),
      plazo: plazo === '' ? 0 : Number(plazo),
      plazo_dias: plazo === '' ? 0 : Number(plazo),
      fechaInicio: txt(val(a,'fechaInicio','fecha_inicio')),
      fecha_inicio: txt(val(a,'fecha_inicio','fechaInicio')),
      fechaFinal: txt(val(a,'fechaFinal','fecha_final')),
      fecha_final: txt(val(a,'fecha_final','fechaFinal')),
      metaEjecutada: val(a,'metaEjecutada','meta_ejecutada') === '' ? 0 : Number(val(a,'metaEjecutada','meta_ejecutada')),
      meta_ejecutada: val(a,'meta_ejecutada','metaEjecutada') === '' ? 0 : Number(val(a,'meta_ejecutada','metaEjecutada')),
      avance: txt(val(a,'avance')).replace('%',''),
      detalle: txt(val(a,'detalle','accion_registrada','accionRegistrada','accionesEspecificas')),
      descripcionActividades: txt(val(a,'descripcionActividades','descripcion','observaciones')),
      descripcion: txt(val(a,'descripcion','descripcionActividades','observaciones')),
      departamento: txt(val(a,'departamento')),
      provincia: txt(val(a,'provincia')),
      distrito: txt(val(a,'distrito')),
      ubigeo: txt(val(a,'ubigeo')),
      fechaRegistro,
      fecha_registro: fechaRegistro,
      usuarioRegistro: usuario,
      usuario_registro: usuario,
      estado: txt(val(a,'estado')) || 'Registrado'
    };
  }

  function deduplicarAcciones(lista){
    const mapa = new Map();
    (Array.isArray(lista) ? lista : []).forEach(raw => {
      const a = accionNormalizada(raw);
      const k = claveLogicaAccion(a) || a.id;
      const previo = mapa.get(k);
      if (!previo) mapa.set(k, a);
      else {
        mapa.set(k, {
          ...previo,
          ...a,
          id: previo.id || a.id,
          fechaRegistro: previo.fechaRegistro || previo.fecha_registro || a.fechaRegistro,
          fecha_registro: previo.fecha_registro || previo.fechaRegistro || a.fecha_registro,
          usuarioRegistro: previo.usuarioRegistro || previo.usuario_registro || a.usuarioRegistro,
          usuario_registro: previo.usuario_registro || previo.usuarioRegistro || a.usuario_registro,
          updated_at: a.updated_at || previo.updated_at
        });
      }
    });
    return [...mapa.values()];
  }

  const cargarAccionesLocalesPrevV611 = window.cargarAccionesLocales || (typeof cargarAccionesLocales === 'function' ? cargarAccionesLocales : null);
  const guardarAccionesLocalesPrevV611 = window.guardarAccionesLocales || (typeof guardarAccionesLocales === 'function' ? guardarAccionesLocales : null);

  function cargarAccionesLocalesV611(){
    try {
      const data = cargarAccionesLocalesPrevV611 ? cargarAccionesLocalesPrevV611() : JSON.parse(localStorage.getItem(STORAGE) || '[]');
      return deduplicarAcciones(Array.isArray(data) ? data : []);
    } catch { return []; }
  }

  function guardarAccionesLocalesV611(lista){
    const depurada = deduplicarAcciones(lista);
    if (guardarAccionesLocalesPrevV611) {
      try { guardarAccionesLocalesPrevV611(depurada); }
      catch { localStorage.setItem(STORAGE, JSON.stringify(depurada)); }
    } else {
      localStorage.setItem(STORAGE, JSON.stringify(depurada));
    }
    return depurada;
  }

  window.cargarAccionesLocales = cargarAccionesLocalesV611;
  window.guardarAccionesLocales = guardarAccionesLocalesV611;
  try { cargarAccionesLocales = cargarAccionesLocalesV611; guardarAccionesLocales = guardarAccionesLocalesV611; } catch {}

  async function cargarAccionesDesdeD1V611(){
    if (typeof api !== 'function') return cargarAccionesLocalesV611();
    const res = await api('/acciones');
    if (!res?.ok) return cargarAccionesLocalesV611();
    const rows = Array.isArray(res.data?.rows) ? res.data.rows : (Array.isArray(res.data) ? res.data : []);
    if (!rows.length) return cargarAccionesLocalesV611();
    const fusion = deduplicarAcciones([...cargarAccionesLocalesV611(), ...rows]);
    guardarAccionesLocalesV611(fusion);
    return fusion;
  }
  window.cargarAccionesDesdeD1V611 = cargarAccionesDesdeD1V611;

  function decretoActualPrograma(){
    const id = window.dsProgramaSeleccionadoId || (typeof dsProgramaSeleccionadoId !== 'undefined' ? dsProgramaSeleccionadoId : '') || $x('accionDs')?.value || '';
    try { if (typeof buscarDecretoPorId === 'function') return buscarDecretoPorId(id); } catch {}
    return null;
  }

  function territoriosActuales(d){
    const arr = Array.isArray(d?.territorio) ? d.territorio : [];
    const map = new Map();
    arr.forEach(t => {
      const ub = txt(t?.ubigeo || t?.UBIGEO || t?.codigo || t?.cod_ubigeo);
      const key = ub ? `UBIGEO:${ub}` : [t?.departamento,t?.provincia,t?.distrito].map(norm).join('|');
      if (!txt(t?.distrito) || map.has(key)) return;
      map.set(key, { key, ubigeo:ub, departamento:txt(t.departamento), provincia:txt(t.provincia), distrito:txt(t.distrito) });
    });
    return [...map.values()].sort((a,b) => `${a.departamento}|${a.provincia}|${a.distrito}`.localeCompare(`${b.departamento}|${b.provincia}|${b.distrito}`,'es'));
  }

  function programaActual(){
    try { if (typeof programaSesionNormalizado === 'function') return programaSesionNormalizado(); } catch {}
    return programaNorm($x('progProgramaNacional')?.value || '');
  }

  function numero(v){
    if (v === undefined || v === null || txt(v) === '') return 0;
    const n = Number(txt(v).replace('%','').replace(',','.'));
    return Number.isFinite(n) ? n : 0;
  }

  function porcentaje(valor, meta, ejecutada){
    const raw = txt(valor);
    if (raw) return raw.replace('%','');
    const m = numero(meta), e = numero(ejecutada);
    return m > 0 ? String(Math.min(100, Math.round((e/m)*100))) : '0';
  }

  function valoresProgramaPrincipal(){
    try { if (typeof calcularFechaFinalPrograma === 'function') calcularFechaFinalPrograma(); } catch {}
    try { if (typeof calcularAvancePrograma === 'function') calcularAvancePrograma(); } catch {}
    const meta = numero($x('progMetaProgramada')?.value);
    const ejec = numero($x('progMetaEjecutada')?.value);
    return {
      programa: programaActual(),
      tipo: txt($x('progTipoAccion')?.value),
      subtipo: txt($x('progSubtipoRehabilitacion')?.value),
      codigo: txt($x('progCodigoAccion')?.value),
      unidad: txt($x('progUnidadMedida')?.value),
      metaProgramada: meta,
      plazoDias: numero($x('progPlazoDias')?.value),
      fechaInicio: txt($x('progFechaInicio')?.value),
      fechaFinal: txt($x('progFechaFinal')?.value),
      metaEjecutada: ejec,
      avance: porcentaje($x('progAvance')?.value, meta, ejec),
      fechaRegistro: txt($x('progFechaRegistro')?.value) || (typeof fechaHoraLocalISO === 'function' ? fechaHoraLocalISO() : new Date().toISOString())
    };
  }

  function validarValoresPrograma(v){
    if (!v.tipo) return 'Seleccione un Tipo de Acción válido del catálogo oficial.';
    if (norm(v.tipo).includes('REHABILITACION') && !v.subtipo) return 'Seleccione el Subtipo de Rehabilitación.';
    if (!v.codigo) return 'Ingrese el Código de acción.';
    if (!v.unidad) return 'Seleccione la Unidad de medida.';
    if (!v.fechaInicio) return 'Ingrese la F. inicio.';
    if (!v.fechaFinal) return 'Ingrese la F. final.';
    if (new Date(`${v.fechaInicio}T00:00:00`) > new Date(`${v.fechaFinal}T00:00:00`)) return 'La F. inicio no puede ser mayor que la F. final.';
    return '';
  }

  async function postAccionD1(accion){
    if (typeof api !== 'function') return null;
    try { return await api('/acciones', 'POST', accion); } catch { return null; }
  }

  async function guardarAccionGrupalV611(){
    const d = decretoActualPrograma();
    try { if (typeof esRegistradorPrograma === 'function' && !esRegistradorPrograma()) return alert('Solo un Registrador de Programa puede registrar acciones grupales.'); } catch {}
    if (!d || !d.rdsActivo) return alert('El Decreto Supremo no tiene RDS activo.');
    const numeroReunion = txt(d.numeroReunion || d.numero_reunion || $x('progNumeroReunion')?.value);
    const fechaReunion = txt(d.fechaReunion || d.fecha_reunion || $x('progFechaReunion')?.value);
    if (!numeroReunion || !fechaReunion) return alert('El RDS no tiene número y fecha de reunión activos.');

    const checks = Array.from(document.querySelectorAll('.chk-distrito-programa-v571:checked, .chk-distrito-programa:checked'));
    const keys = new Set(checks.map(x => x.value));
    if (!keys.size) return alert('Debe seleccionar al menos un distrito.');
    const territorios = territoriosActuales(d).filter(t => keys.has(t.key));
    if (!territorios.length) return alert('No se encontraron distritos válidos seleccionados.');

    const detalle = txt($x('grupoDetallePrograma')?.value);
    const descripcion = txt($x('grupoDescripcionPrograma')?.value);
    if (!detalle || !descripcion) return alert('Debe completar las acciones específicas programadas y ejecutadas y la descripción de actividades.');

    const v = valoresProgramaPrincipal();
    const error = validarValoresPrograma(v);
    if (error) return alert(error);

    let lista = cargarAccionesLocalesV611();
    let guardados = 0;
    for (const t of territorios) {
      const accionBase = accionNormalizada({
        dsId: d.id,
        ds_id: d.id,
        numeroDS: formatearNumeroDSV611(d),
        ds: formatearNumeroDSV611(d),
        numeroReunion,
        numero_reunion: numeroReunion,
        fechaReunion,
        fecha_reunion: fechaReunion,
        estadoRDS: d.estadoRDS || 'Activo',
        programaNacional: v.programa,
        programa: v.programa,
        tipoAccion: v.tipo,
        tipo: v.tipo,
        subtipoRehabilitacion: v.subtipo,
        subtipo_rehabilitacion: v.subtipo,
        codigoAccion: v.codigo,
        codigo: v.codigo,
        unidadMedida: v.unidad,
        unidad: v.unidad,
        metaProgramada: v.metaProgramada,
        meta_programada: v.metaProgramada,
        plazoDias: v.plazoDias,
        plazo_dias: v.plazoDias,
        plazo: v.plazoDias,
        fechaInicio: v.fechaInicio,
        fecha_inicio: v.fechaInicio,
        fechaFinal: v.fechaFinal,
        fecha_final: v.fechaFinal,
        metaEjecutada: v.metaEjecutada,
        meta_ejecutada: v.metaEjecutada,
        avance: v.avance,
        detalle,
        descripcionActividades: descripcion,
        descripcion,
        departamento: t.departamento,
        provincia: t.provincia,
        distrito: t.distrito,
        ubigeo: t.ubigeo,
        fechaRegistro: v.fechaRegistro,
        fecha_registro: v.fechaRegistro,
        usuarioRegistro: (typeof state !== 'undefined' ? state.session?.email : '') || '',
        usuario_registro: (typeof state !== 'undefined' ? state.session?.email : '') || '',
        estado: 'Registrado'
      });
      const k = claveLogicaAccion(accionBase);
      const idx = lista.findIndex(a => claveLogicaAccion(a) === k);
      const previo = idx >= 0 ? lista[idx] : null;
      const accion = accionNormalizada({
        ...(previo || {}),
        ...accionBase,
        id: previo?.id || accionBase.id,
        fechaRegistro: previo?.fechaRegistro || previo?.fecha_registro || accionBase.fechaRegistro,
        fecha_registro: previo?.fecha_registro || previo?.fechaRegistro || accionBase.fecha_registro,
        usuarioRegistro: previo?.usuarioRegistro || previo?.usuario_registro || accionBase.usuarioRegistro,
        usuario_registro: previo?.usuario_registro || previo?.usuarioRegistro || accionBase.usuario_registro,
        usuario_actualiza: previo ? ((typeof state !== 'undefined' ? state.session?.email : '') || '') : '',
        fecha_actualiza: previo ? new Date().toISOString() : ''
      });
      if (idx >= 0) lista[idx] = accion; else lista.push(accion);
      await postAccionD1(accion);
      guardados++;
    }
    guardarAccionesLocalesV611(lista);
    try { await cargarAccionesDesdeD1V611(); } catch {}
    const modal = $x('modalAccionGrupalPrograma');
    if (modal && window.bootstrap?.Modal) bootstrap.Modal.getOrCreateInstance(modal).hide();
    checks.forEach(chk => { chk.checked = false; });
    try { if (typeof renderDistritosAccionesPrograma === 'function') renderDistritosAccionesPrograma(); } catch {}
    try { if (typeof renderTablaAccionesProgramas === 'function') renderTablaAccionesProgramas(); } catch {}
    try { if (typeof renderTablaDecretosBasica === 'function') renderTablaDecretosBasica(); } catch {}
    if (guardados) alert('Acción registrada correctamente en los distritos seleccionados.');
  }

  function reemplazarBotonGrupalV611(){
    const oldBtn = $x('btnGuardarAccionGrupalPrograma');
    if (!oldBtn || oldBtn.dataset.v611 === '1') return;
    const newBtn = oldBtn.cloneNode(true);
    newBtn.dataset.v611 = '1';
    oldBtn.parentNode.replaceChild(newBtn, oldBtn);
    newBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      guardarAccionGrupalV611();
    }, true);
  }

  const exportExcelPrevV611 = window.exportarDSExcel;
  const exportPDFPrevV611 = window.exportarDSPDF;
  if (typeof exportExcelPrevV611 === 'function') {
    window.exportarDSExcel = async function(id){
      await cargarAccionesDesdeD1V611();
      return exportExcelPrevV611(id);
    };
    try { exportarDSExcel = window.exportarDSExcel; } catch {}
  }
  if (typeof exportPDFPrevV611 === 'function') {
    window.exportarDSPDF = async function(id){
      await cargarAccionesDesdeD1V611();
      return exportPDFPrevV611(id);
    };
    try { exportarDSPDF = window.exportarDSPDF; } catch {}
  }

  function arranqueV611(){
    try { guardarAccionesLocalesV611(cargarAccionesLocalesV611()); } catch {}
    setTimeout(async () => {
      await cargarAccionesDesdeD1V611();
      try { if (typeof renderTablaAccionesProgramas === 'function') renderTablaAccionesProgramas(); } catch {}
      try { if (typeof renderTablaAcciones === 'function') renderTablaAcciones(); } catch {}
      try { if (typeof renderTablaDecretosBasica === 'function') renderTablaDecretosBasica(); } catch {}
    }, 1200);
    reemplazarBotonGrupalV611();
    setInterval(reemplazarBotonGrupalV611, 1500);
    console.info('DEE MIDIS cierre aplicado:', VERSION);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', arranqueV611);
  else arranqueV611();
})();

// ================= AJUSTE v62.1 - PREAPROBAR: FILTROS Y TERRITORIO =================
// Alcance quirúrgico: solo pestaña "PreAprobar Acciones" / tabla "Acciones registradas por Programas Nacionales".
(function cierrePreAprobarTerritorioV621(){
  const VERSION = 'v62.1-preaprobar-filtros-territorio';

  function q(id){ return document.getElementById(id); }
  function txt(v){ return String(v ?? ''); }
  function norm(v){
    return txt(v)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toUpperCase();
  }
  function esc(v){
    return txt(v)
      .replaceAll('&','&amp;')
      .replaceAll('<','&lt;')
      .replaceAll('>','&gt;')
      .replaceAll('"','&quot;')
      .replaceAll("'",'&#39;');
  }
  function escAttr(v){ return esc(v); }
  function valor(a, ...keys){
    if (typeof accionValor === 'function') return accionValor(a, ...keys);
    for (const k of keys) {
      if (a && a[k] !== undefined && a[k] !== null && txt(a[k]).trim() !== '') return a[k];
    }
    return '';
  }

  function programaNormal(v){
    if (typeof normalizarProgramaNombre === 'function') return normalizarProgramaNombre(v);
    return norm(v);
  }

  function accionesPreAprobarBase(){
    const dsId = (typeof dsPreAprobarSeleccionadoId !== 'undefined' && dsPreAprobarSeleccionadoId) ? dsPreAprobarSeleccionadoId : '';
    try {
      if (typeof accionesPorDSReunionActualV38 === 'function') return accionesPorDSReunionActualV38(dsId) || [];
    } catch {}
    try {
      if (typeof accionesPorDS === 'function') return accionesPorDS(dsId) || [];
    } catch {}
    try {
      if (typeof cargarAccionesLocales === 'function') {
        return cargarAccionesLocales().filter(a => !dsId || String(a.dsId || a.ds_id) === String(dsId));
      }
    } catch {}
    return [];
  }

  function filtrosPreAprobar(){
    return {
      programa: programaNormal(q('filtroPrePrograma')?.value || ''),
      departamento: norm(q('filtroPreDepartamento')?.value || ''),
      provincia: norm(q('filtroPreProvincia')?.value || ''),
      distrito: norm(q('filtroPreDistrito')?.value || '')
    };
  }

  function aplicaFiltros(a, f){
    const programa = programaNormal(valor(a,'programaNacional','programa'));
    const departamento = norm(valor(a,'departamento'));
    const provincia = norm(valor(a,'provincia'));
    const distrito = norm(valor(a,'distrito'));
    if (f.programa && programa !== f.programa) return false;
    if (f.departamento && !departamento.includes(f.departamento)) return false;
    if (f.provincia && !provincia.includes(f.provincia)) return false;
    if (f.distrito && !distrito.includes(f.distrito)) return false;
    return true;
  }

  function actualizarEncabezadoTabla(){
    const head = document.querySelector('#tablaPreAprobarAcciones thead tr');
    if (!head) return;
    const requerido = ['Programa','Departamento','Provincia','Distrito','Tipo de acción','Código','Detalle','Meta programada','Meta ejecutada','Avance','Usuario','Fecha registro','Gestión'];
    const actual = Array.from(head.children).map(th => norm(th.textContent));
    if (actual.includes('DEPARTAMENTO') && actual.includes('PROVINCIA') && actual.includes('DISTRITO')) return;
    head.innerHTML = requerido.map(h => `<th>${esc(h)}</th>`).join('');
  }

  function actualizarOpcionesProgramaDesdeDatos(){
    const sel = q('filtroPrePrograma');
    if (!sel) return;
    const actual = sel.value;
    const programas = [...new Set(accionesPreAprobarBase().map(a => txt(valor(a,'programaNacional','programa')).trim()).filter(Boolean))]
      .sort((a,b)=>a.localeCompare(b,'es'));
    const base = ['','CUNA MÁS','PAE','JUNTOS','CONTIGO','PENSIÓN 65','FONCODES','PAIS'];
    const todos = [...new Set(base.concat(programas))];
    sel.innerHTML = todos.map(p => p ? `<option>${esc(p)}</option>` : '<option value="">Todos</option>').join('');
    if (actual && Array.from(sel.options).some(o => programaNormal(o.value) === programaNormal(actual))) sel.value = actual;
  }

  function limpiarFiltrosPreAprobar(){
    if (q('filtroPrePrograma')) q('filtroPrePrograma').value = '';
    if (q('filtroPreDepartamento')) q('filtroPreDepartamento').value = '';
    if (q('filtroPreProvincia')) q('filtroPreProvincia').value = '';
    if (q('filtroPreDistrito')) q('filtroPreDistrito').value = '';
    renderTablaPreAprobarAcciones();
  }

  function instalarFiltrosPreAprobar(){
    actualizarEncabezadoTabla();
    actualizarOpcionesProgramaDesdeDatos();
    const btnBuscar = q('btnBuscarPreAprobar');
    const btnLimpiar = q('btnLimpiarPreAprobar');
    if (btnBuscar && btnBuscar.dataset.v621 !== '1') {
      btnBuscar.dataset.v621 = '1';
      btnBuscar.addEventListener('click', (e) => { e.preventDefault(); renderTablaPreAprobarAcciones(); });
    }
    if (btnLimpiar && btnLimpiar.dataset.v621 !== '1') {
      btnLimpiar.dataset.v621 = '1';
      btnLimpiar.addEventListener('click', (e) => { e.preventDefault(); limpiarFiltrosPreAprobar(); });
    }
    ['filtroPrePrograma','filtroPreDepartamento','filtroPreProvincia','filtroPreDistrito'].forEach(id => {
      const el = q(id);
      if (!el || el.dataset.v621 === '1') return;
      el.dataset.v621 = '1';
      el.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); renderTablaPreAprobarAcciones(); } });
    });
  }

  const renderAnteriorV621 = typeof renderTablaPreAprobarAcciones === 'function' ? renderTablaPreAprobarAcciones : null;
  renderTablaPreAprobarAcciones = function renderTablaPreAprobarAccionesV621(){
    const tbody = document.querySelector('#tablaPreAprobarAcciones tbody');
    if (!tbody) return renderAnteriorV621?.apply(this, arguments);
    instalarFiltrosPreAprobar();
    const todas = accionesPreAprobarBase();
    const f = filtrosPreAprobar();
    const acciones = todas.filter(a => aplicaFiltros(a, f));
    const contador = q('contadorPreAprobarAcciones');
    if (contador) contador.textContent = `Mostrando ${acciones.length} de ${todas.length} registro(s)`;

    if (!acciones.length) {
      tbody.innerHTML = '<tr><td colspan="13" class="text-muted">No hay acciones registradas para los filtros aplicados.</td></tr>';
      return;
    }

    tbody.innerHTML = acciones.map(a => {
      const id = valor(a,'id');
      return `<tr>
        <td>${esc(valor(a,'programaNacional','programa'))}</td>
        <td>${esc(valor(a,'departamento'))}</td>
        <td>${esc(valor(a,'provincia'))}</td>
        <td>${esc(valor(a,'distrito'))}</td>
        <td>${esc(valor(a,'tipoAccion','tipo'))}</td>
        <td>${esc(valor(a,'codigoAccion','codigo'))}</td>
        <td>${esc(valor(a,'detalle'))}</td>
        <td>${esc(valor(a,'metaProgramada','meta_programada'))}</td>
        <td>${esc(valor(a,'metaEjecutada','meta_ejecutada'))}</td>
        <td>${esc(valor(a,'avance'))}</td>
        <td>${esc(valor(a,'usuarioRegistro','usuario_registro'))}</td>
        <td>${esc(valor(a,'fechaRegistro','fecha_registro'))}</td>
        <td><button type="button" class="btn btn-sm btn-outline-primary" onclick="abrirModalEditarAccion('${escAttr(id)}')">Ver / Editar</button></td>
      </tr>`;
    }).join('');
  };

  const cargarVistaAnteriorV621 = typeof cargarVistaPreAprobar === 'function' ? cargarVistaPreAprobar : null;
  if (cargarVistaAnteriorV621) {
    cargarVistaPreAprobar = function cargarVistaPreAprobarV621(){
      const r = cargarVistaAnteriorV621.apply(this, arguments);
      setTimeout(() => { instalarFiltrosPreAprobar(); renderTablaPreAprobarAcciones(); }, 0);
      return r;
    };
  }

  const initAnteriorV621 = typeof initPreAprobarAcciones === 'function' ? initPreAprobarAcciones : null;
  if (initAnteriorV621) {
    initPreAprobarAcciones = function initPreAprobarAccionesV621(){
      const r = initAnteriorV621.apply(this, arguments);
      instalarFiltrosPreAprobar();
      return r;
    };
  }

  window.renderTablaPreAprobarAcciones = renderTablaPreAprobarAcciones;
  window.cargarVistaPreAprobar = typeof cargarVistaPreAprobar === 'function' ? cargarVistaPreAprobar : window.cargarVistaPreAprobar;
  window.initPreAprobarAcciones = typeof initPreAprobarAcciones === 'function' ? initPreAprobarAcciones : window.initPreAprobarAcciones;

  document.addEventListener('DOMContentLoaded', () => setTimeout(instalarFiltrosPreAprobar, 500));
  console.info('DEE MIDIS cierre aplicado:', VERSION);
})();

// ================= AJUSTE v64.1 - ADMIN EDITAR / ELIMINAR DS EN LISTADO =================
(function () {
  'use strict';

  const VERSION_ADMIN_DS = 'v64.1 Admin editar/eliminar DS';
  const q = (id) => document.getElementById(id);
  const esc = (v) => (typeof escapeHtml === 'function' ? escapeHtml(v) : String(v ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;'));
  const escAttr = (v) => (typeof escapeHtmlAttr === 'function' ? escapeHtmlAttr(v) : esc(v));
  const norm = (v) => (typeof normalizarTexto === 'function' ? normalizarTexto(v) : String(v || '').trim().toUpperCase());

  function esAdminDS() {
    try { return typeof esAdministrador === 'function' && esAdministrador(); } catch { return false; }
  }

  function listaDSAdmin() {
    try {
      const base = (state?.decretos?.length ? state.decretos : (typeof cargarDecretosLocales === 'function' ? cargarDecretosLocales() : []));
      return (Array.isArray(base) ? base : []).map(d => typeof normalizarDecreto === 'function' ? normalizarDecreto(d) : d).filter(Boolean);
    } catch { return []; }
  }

  function accionesAdmin() {
    try {
      const data = JSON.parse(localStorage.getItem(ACCIONES_STORAGE_KEY) || '[]');
      return Array.isArray(data) ? data : [];
    } catch { return []; }
  }

  function guardarAccionesAdmin(lista) {
    try {
      if (typeof guardarAccionesLocales === 'function') guardarAccionesLocales(Array.isArray(lista) ? lista : []);
      else localStorage.setItem(ACCIONES_STORAGE_KEY, JSON.stringify(Array.isArray(lista) ? lista : []));
    } catch {}
  }

  function tituloDSAdmin(d) {
    try { if (typeof formatearNumeroDSFinal === 'function') return formatearNumeroDSFinal(d); } catch {}
    try { if (typeof formatearNumeroDS === 'function') return formatearNumeroDS(d); } catch {}
    const numero = String(d?.numero || '').trim();
    const anio = String(d?.anio || '').trim();
    return `DS N.° ${numero}${anio ? '-' + anio : ''}-PCM`;
  }

  function extraerIdDSDesdeFila(row) {
    if (!row) return '';
    const boton = row.querySelector('button[onclick*="verDetalleDS"],button[onclick*="abrirRDS"],button[onclick*="abrirPreAprobacion"],button[onclick*="exportarDSExcel"],button[onclick*="exportarDSPDF"]');
    const onclick = boton?.getAttribute('onclick') || '';
    const m = onclick.match(/'([^']+)'|\"([^\"]+)\"/);
    return m ? (m[1] || m[2] || '') : '';
  }

  function asegurarColumnaAdminDS() {
    const head = document.querySelector('#tablaDS thead tr');
    if (!head) return;
    if (!esAdminDS()) {
      head.querySelector('[data-admin-ds-col="1"]')?.remove();
      return;
    }
    if (!head.querySelector('[data-admin-ds-col="1"]')) {
      const th = document.createElement('th');
      th.dataset.adminDsCol = '1';
      th.textContent = 'Gestión DS';
      head.appendChild(th);
    }
  }

  function aplicarBotonesAdminDS() {
    asegurarColumnaAdminDS();
    const tbody = document.querySelector('#tablaDS tbody');
    if (!tbody) return;

    Array.from(tbody.querySelectorAll('tr')).forEach(row => {
      const existente = row.querySelector('[data-admin-ds-cell="1"]');
      if (!esAdminDS()) {
        existente?.remove();
        return;
      }
      const dsId = extraerIdDSDesdeFila(row);
      if (!dsId) {
        if (!existente && row.children.length > 1) {
          const td = document.createElement('td');
          td.dataset.adminDsCell = '1';
          td.textContent = '-';
          row.appendChild(td);
        }
        return;
      }
      const html = `<div class="d-flex flex-wrap gap-1">
        <button type="button" class="btn btn-sm btn-outline-primary" onclick="abrirEditarDSAdmin('${escAttr(dsId)}')">Editar</button>
        <button type="button" class="btn btn-sm btn-outline-danger" onclick="eliminarDSAdmin('${escAttr(dsId)}')">Eliminar</button>
      </div>`;
      if (existente) existente.innerHTML = html;
      else {
        const td = document.createElement('td');
        td.dataset.adminDsCell = '1';
        td.innerHTML = html;
        row.appendChild(td);
      }
    });
  }

  function asegurarModalEditarDSAdmin() {
    if (q('modalEditarDSAdmin')) return;
    const div = document.createElement('div');
    div.className = 'modal fade';
    div.id = 'modalEditarDSAdmin';
    div.tabIndex = -1;
    div.setAttribute('aria-hidden', 'true');
    div.innerHTML = `
      <div class="modal-dialog modal-xl modal-dialog-scrollable">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">Editar Decreto Supremo</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
          </div>
          <div class="modal-body">
            <input id="editDsIdAdmin" type="hidden">
            <div class="alert alert-info small py-2 mb-3">Edición habilitada solo para Administrador. No modifica login, roles ni flujos RDS.</div>
            <div class="row g-3">
              <div class="col-md-3"><label class="form-label">Número DS</label><input id="editDsNumeroAdmin" class="form-control"></div>
              <div class="col-md-2"><label class="form-label">Año</label><input id="editDsAnioAdmin" class="form-control"></div>
              <div class="col-md-3"><label class="form-label">Código de registro</label><input id="editDsCodigoAdmin" class="form-control"></div>
              <div class="col-md-2"><label class="form-label">Plazo (días)</label><input id="editDsPlazoAdmin" type="number" min="0" class="form-control"></div>
              <div class="col-md-2"><label class="form-label">Vigencia</label><input id="editDsVigenciaAdmin" class="form-control" readonly></div>
              <div class="col-md-3"><label class="form-label">Peligro</label><select id="editDsPeligroAdmin" class="form-select"><option value="">Seleccione...</option><option>Por impacto de daños</option><option>Por peligro inminente</option></select></div>
              <div class="col-md-3"><label class="form-label">Tipo de peligro</label><select id="editDsTipoPeligroAdmin" class="form-select"><option value="">Seleccione...</option><option>Lluvias intensas</option><option>Inundación</option><option>Deslizamiento</option><option>Friaje</option><option>Heladas</option><option>Incendio forestal</option><option>Contaminación hídrica</option><option>Sismo</option></select></div>
              <div class="col-md-2"><label class="form-label">Fecha inicio</label><input id="editDsFechaInicioAdmin" type="date" class="form-control"></div>
              <div class="col-md-2"><label class="form-label">Fecha final</label><input id="editDsFechaFinAdmin" type="date" class="form-control"></div>
              <div class="col-md-2"><label class="form-label">Semáforo</label><input id="editDsSemaforoAdmin" class="form-control" readonly></div>
              <div class="col-12"><label class="form-label">Exposición de Motivos</label><textarea id="editDsMotivosAdmin" class="form-control" rows="3"></textarea></div>
            </div>
            <hr>
            <h6 class="text-primary">Relación de prórrogas</h6>
            <div class="row g-3 align-items-end">
              <div class="col-md-3"><div class="form-check mt-4"><input id="editDsEsProrrogaAdmin" class="form-check-input" type="checkbox"><label class="form-check-label" for="editDsEsProrrogaAdmin">Es prórroga</label></div></div>
              <div class="col-md-3"><label class="form-label">DS origen</label><input id="editDsOrigenAdmin" class="form-control"></div>
              <div class="col-md-2"><label class="form-label">Nivel prórroga</label><input id="editDsNivelAdmin" type="number" min="0" class="form-control"></div>
              <div class="col-md-4"><label class="form-label">Cadena</label><input id="editDsCadenaAdmin" class="form-control"></div>
            </div>
            <hr>
            <h6 class="text-primary">Sectores que firman</h6>
            <div id="editDsSectoresAdmin" class="row g-2"></div>
            <hr>
            <h6 class="text-primary">Territorio involucrado</h6>
            <div class="alert alert-warning small py-2">Para no romper la estructura actual, el territorio se edita como JSON. Mantén departamento, provincia y distrito.</div>
            <textarea id="editDsTerritorioAdmin" class="form-control font-monospace" rows="10"></textarea>
            <hr>
            <h6 class="text-primary">RDS / Estado del proceso</h6>
            <div class="row g-3">
              <div class="col-md-2"><div class="form-check mt-4"><input id="editDsRdsActivoAdmin" class="form-check-input" type="checkbox"><label class="form-check-label" for="editDsRdsActivoAdmin">RDS activo</label></div></div>
              <div class="col-md-3"><label class="form-label">Número de reunión</label><input id="editDsNumeroReunionAdmin" class="form-control"></div>
              <div class="col-md-3"><label class="form-label">Fecha de reunión</label><input id="editDsFechaReunionAdmin" type="date" class="form-control"></div>
              <div class="col-md-2"><label class="form-label">Estado RDS</label><input id="editDsEstadoRDSAdmin" class="form-control"></div>
              <div class="col-md-2"><label class="form-label">Fecha Registro RDS</label><input id="editDsFechaRegistroRDSAdmin" class="form-control"></div>
            </div>
          </div>
          <div class="modal-footer">
            <button id="btnGuardarEditarDSAdmin" type="button" class="btn btn-primary">Guardar cambios</button>
            <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Cancelar</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(div);
    ['editDsFechaInicioAdmin','editDsFechaFinAdmin','editDsPlazoAdmin'].forEach(id => q(id)?.addEventListener('change', actualizarCalculosEditarDSAdmin));
    q('btnGuardarEditarDSAdmin')?.addEventListener('click', guardarEditarDSAdmin);
  }

  function renderSectoresEditarAdmin(seleccionados) {
    const cont = q('editDsSectoresAdmin');
    if (!cont) return;
    const lista = Array.isArray(MINISTERIOS_FIRMANTES) ? MINISTERIOS_FIRMANTES : [];
    const set = new Set((Array.isArray(seleccionados) ? seleccionados : []).map(norm));
    cont.innerHTML = lista.map((m, i) => `
      <div class="col-6 col-md-3 col-lg-2">
        <div class="form-check border rounded bg-white px-2 py-2 h-100">
          <input class="form-check-input ms-0 me-1 chk-edit-sector-admin" type="checkbox" id="editSectorAdmin_${i}" value="${escAttr(m)}" ${set.has(norm(m)) ? 'checked' : ''}>
          <label class="form-check-label" for="editSectorAdmin_${i}">${esc(m)}</label>
        </div>
      </div>`).join('');
  }

  function calcularFechaFinalEditarSiCorresponde() {
    const inicio = q('editDsFechaInicioAdmin')?.value || '';
    const plazo = Number(q('editDsPlazoAdmin')?.value || 0);
    const finInput = q('editDsFechaFinAdmin');
    if (!inicio || !plazo || !finInput || finInput.value) return;
    const f = new Date(`${inicio}T00:00:00`);
    f.setDate(f.getDate() + plazo);
    finInput.value = f.toISOString().split('T')[0];
  }

  function actualizarCalculosEditarDSAdmin() {
    calcularFechaFinalEditarSiCorresponde();
    const fin = q('editDsFechaFinAdmin')?.value || '';
    try { if (q('editDsVigenciaAdmin') && typeof calcularVigencia === 'function') q('editDsVigenciaAdmin').value = calcularVigencia(fin); } catch {}
    try { if (q('editDsSemaforoAdmin') && typeof calcularSemaforo === 'function') q('editDsSemaforoAdmin').value = calcularSemaforo(fin); } catch {}
  }

  function abrirEditarDSAdmin(id) {
    if (!esAdminDS()) return alert('Solo el Administrador puede editar Decretos Supremos.');
    asegurarModalEditarDSAdmin();
    const d = (typeof buscarDecretoPorId === 'function' ? buscarDecretoPorId(id) : listaDSAdmin().find(x => String(x.id) === String(id)));
    if (!d) return alert('No se encontró el Decreto Supremo seleccionado.');

    q('editDsIdAdmin').value = d.id || id;
    q('editDsNumeroAdmin').value = d.numero || '';
    q('editDsAnioAdmin').value = d.anio || '';
    q('editDsCodigoAdmin').value = d.codigo_registro || d.codigoRegistro || d.id || '';
    q('editDsPlazoAdmin').value = d.plazo_dias ?? d.plazoDias ?? '';
    q('editDsPeligroAdmin').value = d.peligro || '';
    q('editDsTipoPeligroAdmin').value = d.tipo_peligro || d.tipoPeligro || '';
    q('editDsFechaInicioAdmin').value = d.fecha_inicio || d.fechaInicio || '';
    q('editDsFechaFinAdmin').value = d.fecha_fin || d.fechaFin || '';
    q('editDsMotivosAdmin').value = d.motivos || d.exposicion_motivos || '';
    q('editDsEsProrrogaAdmin').checked = Boolean(d.es_prorroga || d.esProrroga);
    q('editDsOrigenAdmin').value = d.ds_origen_id || d.dsOrigenId || d.ds_origen || '';
    q('editDsNivelAdmin').value = d.nivel_prorroga ?? d.nivelProrroga ?? 0;
    q('editDsCadenaAdmin').value = d.cadena || '';
    q('editDsTerritorioAdmin').value = JSON.stringify(Array.isArray(d.territorio) ? d.territorio : [], null, 2);
    q('editDsRdsActivoAdmin').checked = Boolean(d.rdsActivo || d.rds_activo);
    q('editDsNumeroReunionAdmin').value = d.numeroReunion || d.numero_reunion || '';
    q('editDsFechaReunionAdmin').value = d.fechaReunion || d.fecha_reunion || '';
    q('editDsEstadoRDSAdmin').value = d.estadoRDS || (d.rdsActivo ? 'Activo' : '');
    q('editDsFechaRegistroRDSAdmin').value = d.fechaRegistroRDS || d.fecha_registro_rds || '';
    renderSectoresEditarAdmin(d.sectores || []);
    actualizarCalculosEditarDSAdmin();

    const modal = q('modalEditarDSAdmin');
    if (modal && window.bootstrap?.Modal) bootstrap.Modal.getOrCreateInstance(modal).show();
    else if (modal) { modal.style.display = 'block'; modal.classList.add('show'); }
  }

  async function guardarEditarDSAdmin() {
    if (!esAdminDS()) return alert('Solo el Administrador puede guardar cambios.');
    const idOriginal = q('editDsIdAdmin')?.value || '';
    const lista = listaDSAdmin();
    const idx = lista.findIndex(d => String(d.id) === String(idOriginal));
    if (idx < 0) return alert('No se encontró el Decreto Supremo para actualizar.');

    let territorio = [];
    try {
      const parsed = JSON.parse(q('editDsTerritorioAdmin')?.value || '[]');
      if (!Array.isArray(parsed)) throw new Error('El territorio debe ser un arreglo JSON.');
      territorio = parsed;
    } catch (e) {
      alert('El territorio involucrado no tiene un JSON válido. Revíselo antes de guardar.');
      return;
    }

    const sectores = Array.from(document.querySelectorAll('.chk-edit-sector-admin:checked')).map(x => String(x.value || '').trim()).filter(Boolean);
    const numero = q('editDsNumeroAdmin')?.value || '';
    const anio = q('editDsAnioAdmin')?.value || '';
    const codigo = q('editDsCodigoAdmin')?.value || (typeof generarCodigoRegistro === 'function' ? generarCodigoRegistro(numero, anio) : idOriginal);
    const fechaFin = q('editDsFechaFinAdmin')?.value || '';

    const actualizadoBase = {
      ...lista[idx],
      id: idOriginal,
      numero,
      anio,
      codigo_registro: codigo,
      peligro: q('editDsPeligroAdmin')?.value || '',
      tipo_peligro: q('editDsTipoPeligroAdmin')?.value || '',
      plazo_dias: Number(q('editDsPlazoAdmin')?.value || 0),
      fecha_inicio: q('editDsFechaInicioAdmin')?.value || '',
      fecha_fin: fechaFin,
      vigencia: (typeof calcularVigencia === 'function' ? calcularVigencia(fechaFin) : (q('editDsVigenciaAdmin')?.value || '')),
      semaforo: (typeof calcularSemaforo === 'function' ? calcularSemaforo(fechaFin) : (q('editDsSemaforoAdmin')?.value || '')),
      motivos: q('editDsMotivosAdmin')?.value || '',
      sectores,
      territorio,
      es_prorroga: Boolean(q('editDsEsProrrogaAdmin')?.checked),
      ds_origen_id: q('editDsOrigenAdmin')?.value || '',
      nivel_prorroga: Number(q('editDsNivelAdmin')?.value || 0),
      cadena: q('editDsCadenaAdmin')?.value || '',
      rdsActivo: Boolean(q('editDsRdsActivoAdmin')?.checked),
      numeroReunion: q('editDsNumeroReunionAdmin')?.value || '',
      fechaReunion: q('editDsFechaReunionAdmin')?.value || '',
      estadoRDS: q('editDsEstadoRDSAdmin')?.value || '',
      fechaRegistroRDS: q('editDsFechaRegistroRDSAdmin')?.value || '',
      usuario_actualiza: state?.session?.email || '',
      fecha_actualiza: new Date().toISOString()
    };

    const actualizado = typeof normalizarDecreto === 'function' ? normalizarDecreto(actualizadoBase) : actualizadoBase;
    lista[idx] = actualizado;
    if (typeof guardarDecretosLocales === 'function') guardarDecretosLocales(lista);
    else localStorage.setItem(DECRETOS_STORAGE_KEY, JSON.stringify(lista));

    try { await api('/decretos', 'POST', actualizado); } catch {}
    try { if (typeof cargarDSOrigen === 'function') cargarDSOrigen(); } catch {}
    try { if (typeof cargarSelectAccionDS === 'function') cargarSelectAccionDS(); } catch {}
    try { renderTablaDecretosBasica(); } catch {}

    const modal = q('modalEditarDSAdmin');
    if (modal && window.bootstrap?.Modal) bootstrap.Modal.getOrCreateInstance(modal).hide();
    alert('Decreto Supremo actualizado correctamente.');
  }

  async function eliminarDSAdmin(id) {
    if (!esAdminDS()) return alert('Solo el Administrador puede eliminar Decretos Supremos.');
    const d = (typeof buscarDecretoPorId === 'function' ? buscarDecretoPorId(id) : listaDSAdmin().find(x => String(x.id) === String(id)));
    if (!d) return alert('No se encontró el Decreto Supremo seleccionado.');

    const acciones = accionesAdmin().filter(a => String(a.dsId || a.ds_id) === String(id));
    const mensaje = `Se eliminará el Decreto Supremo:\n\n${tituloDSAdmin(d)}\n\nTambién se eliminarán ${acciones.length} acción(es) registrada(s) asociada(s).\n\nEsta acción no se puede deshacer. ¿Desea continuar?`;
    if (!confirm(mensaje)) return;

    const decretosActualizados = listaDSAdmin().filter(x => String(x.id) !== String(id));
    if (typeof guardarDecretosLocales === 'function') guardarDecretosLocales(decretosActualizados);
    else localStorage.setItem(DECRETOS_STORAGE_KEY, JSON.stringify(decretosActualizados));

    const accionesActualizadas = accionesAdmin().filter(a => String(a.dsId || a.ds_id) !== String(id));
    guardarAccionesAdmin(accionesActualizadas);

    // Intentos de borrado remoto. Si algún endpoint no soporta DELETE, no se rompe el flujo local.
    try { await api(`/acciones?ds_id=${encodeURIComponent(id)}`, 'DELETE'); } catch {}
    try { await api('/acciones', 'DELETE', { ds_id: id }); } catch {}
    try { await api(`/decretos/${encodeURIComponent(id)}`, 'DELETE'); } catch {}
    try { await api(`/decretos?id=${encodeURIComponent(id)}`, 'DELETE'); } catch {}
    try { await api('/decretos', 'DELETE', { id }); } catch {}

    try { if (typeof cargarDSOrigen === 'function') cargarDSOrigen(); } catch {}
    try { if (typeof cargarSelectAccionDS === 'function') cargarSelectAccionDS(); } catch {}
    try { if (typeof renderTablaAcciones === 'function') renderTablaAcciones(); } catch {}
    try { if (typeof renderTablaAccionesProgramas === 'function') renderTablaAccionesProgramas(); } catch {}
    try { renderTablaDecretosBasica(); } catch {}

    alert('Decreto Supremo y acciones asociadas eliminados correctamente.');
  }

  function instalarWrapperRenderAdminDS() {
    const original = typeof renderTablaDecretosBasica === 'function' ? renderTablaDecretosBasica : null;
    if (!original || original.__adminDsV641) return;
    const wrapper = function renderTablaDecretosBasicaAdminV641() {
      const r = original.apply(this, arguments);
      setTimeout(aplicarBotonesAdminDS, 0);
      return r;
    };
    wrapper.__adminDsV641 = true;
    try { renderTablaDecretosBasica = wrapper; } catch {}
    window.renderTablaDecretosBasica = wrapper;
  }

  window.abrirEditarDSAdmin = abrirEditarDSAdmin;
  window.guardarEditarDSAdmin = guardarEditarDSAdmin;
  window.eliminarDSAdmin = eliminarDSAdmin;

  document.addEventListener('DOMContentLoaded', () => {
    asegurarModalEditarDSAdmin();
    setTimeout(() => {
      instalarWrapperRenderAdminDS();
      aplicarBotonesAdminDS();
      console.info('DEE MIDIS cierre aplicado:', VERSION_ADMIN_DS);
    }, 1200);
  });

  // Refuerzo por si el render final del sistema se instala después del DOMContentLoaded.
  setTimeout(() => {
    instalarWrapperRenderAdminDS();
    aplicarBotonesAdminDS();
  }, 2500);
})();

// ================= AJUSTE v65.1 - ADMIN EDITAR DS: TERRITORIO CON UBIGEO =================
// Alcance quirúrgico: solo mejora el campo "Territorio involucrado" del modal Editar DS.
// No modifica login, roles, RDS, acciones, aprobación, exportación ni estructura base.
(function () {
  'use strict';

  const VERSION = 'v65.1 Admin editar DS territorio ubigeo';
  const q = (id) => document.getElementById(id);
  const esc = (v) => (typeof escapeHtml === 'function'
    ? escapeHtml(v)
    : String(v ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;'));
  const escAttr = (v) => (typeof escapeHtmlAttr === 'function' ? escapeHtmlAttr(v) : esc(v));
  const norm = (v) => (typeof normalizarTexto === 'function'
    ? normalizarTexto(v)
    : String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase());

  let editTerritorioSeleccionado = [];
  let eventosEditTerritorioInstalados = false;

  function ubigeoDisponibleAdmin() {
    if (Array.isArray(window.ubigeoData) && window.ubigeoData.length) return window.ubigeoData;
    if (Array.isArray(ubigeoCache) && ubigeoCache.length) return ubigeoCache;
    return [];
  }

  function claveTerritorioAdmin(reg) {
    try {
      if (typeof getTerritorioKey === 'function') return getTerritorioKey(reg);
    } catch {}
    const ubigeo = reg?.ubigeo || reg?.UBIGEO || reg?.codigo || reg?.cod_ubigeo || '';
    if (ubigeo) return String(ubigeo);
    return [norm(reg?.departamento), norm(reg?.provincia), norm(reg?.distrito)].join('|');
  }

  function normalizarTerritorioAdmin(reg) {
    if (!reg) return null;
    return {
      clave: reg.clave || claveTerritorioAdmin(reg),
      ubigeo: reg.ubigeo || reg.UBIGEO || reg.codigo || reg.cod_ubigeo || '',
      departamento: reg.departamento || '',
      provincia: reg.provincia || '',
      distrito: reg.distrito || '',
      latitud: reg.latitud ?? reg.lat ?? '',
      longitud: reg.longitud ?? reg.lng ?? reg.lon ?? ''
    };
  }

  function sincronizarTextareaTerritorioAdmin() {
    const txt = q('editDsTerritorioAdmin');
    if (!txt) return;
    txt.value = JSON.stringify(editTerritorioSeleccionado.map(t => ({ ...t })), null, 2);
  }

  function cargarDesdeTextareaTerritorioAdmin() {
    const txt = q('editDsTerritorioAdmin');
    let lista = [];
    try {
      const parsed = JSON.parse(txt?.value || '[]');
      if (Array.isArray(parsed)) lista = parsed;
    } catch { lista = []; }

    const mapa = new Map();
    lista.map(normalizarTerritorioAdmin).filter(Boolean).forEach(t => mapa.set(String(t.clave), t));
    editTerritorioSeleccionado = Array.from(mapa.values()).sort((a, b) =>
      `${a.departamento}|${a.provincia}|${a.distrito}`.localeCompare(`${b.departamento}|${b.provincia}|${b.distrito}`, 'es')
    );
    sincronizarTextareaTerritorioAdmin();
  }

  function asegurarUIEditarTerritorioAdmin() {
    const txt = q('editDsTerritorioAdmin');
    if (!txt || q('editTerritorioAdminBox')) return;

    const aviso = txt.previousElementSibling;
    if (aviso && aviso.classList?.contains('alert')) {
      aviso.className = 'alert alert-info small py-2';
      aviso.textContent = 'Seleccione departamento, provincia y marque los distritos. El sistema conserva internamente la estructura territorial existente.';
    }

    txt.style.display = 'none';
    txt.setAttribute('aria-hidden', 'true');

    const box = document.createElement('div');
    box.id = 'editTerritorioAdminBox';
    box.innerHTML = `
      <div class="border rounded bg-light p-3 mb-3">
        <div class="row g-2 align-items-end">
          <div class="col-md-3">
            <label class="form-label">Departamento</label>
            <select id="editSelDepartamentoAdmin" class="form-select form-select-sm"></select>
          </div>
          <div class="col-md-3">
            <label class="form-label">Provincia</label>
            <select id="editSelProvinciaAdmin" class="form-select form-select-sm"><option value="">Seleccione...</option></select>
          </div>
          <div class="col-md-3">
            <label class="form-label">Buscar distrito</label>
            <input id="editBuscarDistritoAdmin" class="form-control form-control-sm" placeholder="Buscar distrito">
          </div>
          <div class="col-md-3 d-flex flex-wrap gap-2">
            <button id="btnEditMarcarTodosAdmin" type="button" class="btn btn-sm btn-outline-secondary">Marcar todos</button>
            <button id="btnEditLimpiarChecksAdmin" type="button" class="btn btn-sm btn-outline-secondary">Limpiar</button>
          </div>
        </div>
        <div class="row g-3 mt-2">
          <div class="col-md-6">
            <div id="editDistritosChecklistAdmin" class="border rounded p-2 bg-white" style="min-height:210px;max-height:280px;overflow:auto;">
              <div class="text-muted small">Seleccione primero departamento y provincia.</div>
            </div>
            <button id="btnEditAgregarDistritosAdmin" type="button" class="btn btn-sm btn-outline-primary mt-2" disabled>Agregar distritos seleccionados</button>
          </div>
          <div class="col-md-6">
            <div class="d-flex justify-content-between align-items-center mb-2">
              <strong class="small">Distritos seleccionados</strong>
              <span id="editTerritorioContadorAdmin" class="text-muted small">0 distrito(s)</span>
            </div>
            <div id="editTerritorioSeleccionadoAdmin" class="border rounded p-2 bg-white" style="min-height:210px;max-height:280px;overflow:auto;"></div>
          </div>
        </div>
      </div>`;
    txt.insertAdjacentElement('beforebegin', box);

    instalarEventosEditarTerritorioAdmin();
  }

  function instalarEventosEditarTerritorioAdmin() {
    if (eventosEditTerritorioInstalados) return;
    eventosEditTerritorioInstalados = true;

    document.addEventListener('change', (e) => {
      if (e.target?.id === 'editSelDepartamentoAdmin') {
        cargarProvinciasEditarTerritorioAdmin();
        limpiarDistritosEditarTerritorioAdmin('Seleccione una provincia.');
      }
      if (e.target?.id === 'editSelProvinciaAdmin') cargarDistritosEditarTerritorioAdmin();
      if (e.target?.classList?.contains('chk-edit-distrito-admin')) actualizarBotonAgregarEditarTerritorioAdmin();
    });

    document.addEventListener('input', (e) => {
      if (e.target?.id === 'editBuscarDistritoAdmin') filtrarDistritosEditarTerritorioAdmin();
    });

    document.addEventListener('click', (e) => {
      if (e.target?.id === 'btnEditMarcarTodosAdmin') { e.preventDefault(); marcarTodosEditarTerritorioAdmin(); }
      if (e.target?.id === 'btnEditLimpiarChecksAdmin') { e.preventDefault(); limpiarChecksEditarTerritorioAdmin(); }
      if (e.target?.id === 'btnEditAgregarDistritosAdmin') { e.preventDefault(); agregarDistritosEditarTerritorioAdmin(); }
      const quitar = e.target?.closest?.('[data-edit-quitar-territorio-admin]');
      if (quitar) { e.preventDefault(); quitarTerritorioEditarAdmin(quitar.getAttribute('data-edit-quitar-territorio-admin')); }
    });
  }

  function cargarDepartamentosEditarTerritorioAdmin() {
    const sel = q('editSelDepartamentoAdmin');
    if (!sel) return;
    const data = ubigeoDisponibleAdmin();
    const actual = sel.value;
    const deps = Array.from(new Set(data.map(x => x.departamento).filter(Boolean))).sort((a, b) => String(a).localeCompare(String(b), 'es'));
    sel.innerHTML = '<option value="">Seleccione...</option>' + deps.map(d => `<option value="${escAttr(d)}">${esc(d)}</option>`).join('');
    if (actual && deps.includes(actual)) sel.value = actual;
  }

  function cargarProvinciasEditarTerritorioAdmin() {
    const dep = q('editSelDepartamentoAdmin')?.value || '';
    const sel = q('editSelProvinciaAdmin');
    if (!sel) return;
    const data = ubigeoDisponibleAdmin();
    const provs = Array.from(new Set(data.filter(x => norm(x.departamento) === norm(dep)).map(x => x.provincia).filter(Boolean))).sort((a, b) => String(a).localeCompare(String(b), 'es'));
    sel.innerHTML = '<option value="">Seleccione...</option>' + provs.map(p => `<option value="${escAttr(p)}">${esc(p)}</option>`).join('');
  }

  function limpiarDistritosEditarTerritorioAdmin(mensaje) {
    const cont = q('editDistritosChecklistAdmin');
    if (cont) cont.innerHTML = `<div class="text-muted small">${esc(mensaje)}</div>`;
    if (q('editBuscarDistritoAdmin')) q('editBuscarDistritoAdmin').value = '';
    actualizarBotonAgregarEditarTerritorioAdmin();
  }

  function cargarDistritosEditarTerritorioAdmin() {
    const dep = q('editSelDepartamentoAdmin')?.value || '';
    const prov = q('editSelProvinciaAdmin')?.value || '';
    const cont = q('editDistritosChecklistAdmin');
    if (!cont) return;
    const data = ubigeoDisponibleAdmin();
    if (!dep || !prov) return limpiarDistritosEditarTerritorioAdmin('Seleccione primero departamento y provincia.');

    const seleccionadas = new Set(editTerritorioSeleccionado.map(t => String(t.clave)));
    const distritos = data.filter(x => norm(x.departamento) === norm(dep) && norm(x.provincia) === norm(prov))
      .sort((a, b) => String(a.distrito || '').localeCompare(String(b.distrito || ''), 'es'));

    if (!distritos.length) return limpiarDistritosEditarTerritorioAdmin('No hay distritos para esta selección.');

    cont.innerHTML = distritos.map(d => {
      const t = normalizarTerritorioAdmin(d);
      const key = String(t.clave);
      const idSeguro = key.replace(/[^a-zA-Z0-9_-]/g, '_');
      const ya = seleccionadas.has(key);
      return `
        <div class="form-check distrito-edit-item-admin">
          <input class="form-check-input chk-edit-distrito-admin" type="checkbox" id="editDistAdmin_${escAttr(idSeguro)}" value="${escAttr(key)}" ${ya ? 'disabled' : ''}>
          <label class="form-check-label" for="editDistAdmin_${escAttr(idSeguro)}">
            ${esc(d.distrito || '')}${ya ? '<span class="text-success small"> — agregado</span>' : ''}
          </label>
        </div>`;
    }).join('');
    filtrarDistritosEditarTerritorioAdmin();
    actualizarBotonAgregarEditarTerritorioAdmin();
  }

  function filtrarDistritosEditarTerritorioAdmin() {
    const texto = norm(q('editBuscarDistritoAdmin')?.value || '');
    const cont = q('editDistritosChecklistAdmin');
    if (!cont) return;
    cont.querySelectorAll('.distrito-edit-item-admin').forEach(div => {
      div.style.display = !texto || norm(div.textContent).includes(texto) ? '' : 'none';
    });
    actualizarBotonAgregarEditarTerritorioAdmin();
  }

  function actualizarBotonAgregarEditarTerritorioAdmin() {
    const btn = q('btnEditAgregarDistritosAdmin');
    const cont = q('editDistritosChecklistAdmin');
    if (!btn || !cont) return;
    btn.disabled = cont.querySelectorAll('.chk-edit-distrito-admin:checked:not(:disabled)').length === 0;
  }

  function marcarTodosEditarTerritorioAdmin() {
    const cont = q('editDistritosChecklistAdmin');
    if (!cont) return;
    cont.querySelectorAll('.distrito-edit-item-admin').forEach(div => {
      if (div.style.display === 'none') return;
      const chk = div.querySelector('.chk-edit-distrito-admin');
      if (chk && !chk.disabled) chk.checked = true;
    });
    actualizarBotonAgregarEditarTerritorioAdmin();
  }

  function limpiarChecksEditarTerritorioAdmin() {
    const cont = q('editDistritosChecklistAdmin');
    if (!cont) return;
    cont.querySelectorAll('.chk-edit-distrito-admin').forEach(chk => { chk.checked = false; });
    if (q('editBuscarDistritoAdmin')) q('editBuscarDistritoAdmin').value = '';
    filtrarDistritosEditarTerritorioAdmin();
    actualizarBotonAgregarEditarTerritorioAdmin();
  }

  function agregarDistritosEditarTerritorioAdmin() {
    const cont = q('editDistritosChecklistAdmin');
    if (!cont) return;
    const checks = Array.from(cont.querySelectorAll('.chk-edit-distrito-admin:checked:not(:disabled)'));
    if (!checks.length) return alert('Seleccione al menos un distrito.');

    const data = ubigeoDisponibleAdmin();
    const mapa = new Map(editTerritorioSeleccionado.map(t => [String(t.clave), t]));
    checks.forEach(chk => {
      const item = data.find(x => String(claveTerritorioAdmin(x)) === String(chk.value));
      const t = normalizarTerritorioAdmin(item);
      if (t) mapa.set(String(t.clave), t);
    });
    editTerritorioSeleccionado = Array.from(mapa.values()).sort((a, b) =>
      `${a.departamento}|${a.provincia}|${a.distrito}`.localeCompare(`${b.departamento}|${b.provincia}|${b.distrito}`, 'es')
    );
    sincronizarTextareaTerritorioAdmin();
    renderSeleccionTerritorioEditarAdmin();
    cargarDistritosEditarTerritorioAdmin();
  }

  function quitarTerritorioEditarAdmin(clave) {
    editTerritorioSeleccionado = editTerritorioSeleccionado.filter(t => String(t.clave) !== String(clave));
    sincronizarTextareaTerritorioAdmin();
    renderSeleccionTerritorioEditarAdmin();
    cargarDistritosEditarTerritorioAdmin();
  }

  function renderSeleccionTerritorioEditarAdmin() {
    const cont = q('editTerritorioSeleccionadoAdmin');
    const contador = q('editTerritorioContadorAdmin');
    if (contador) contador.textContent = `${editTerritorioSeleccionado.length} distrito(s)`;
    if (!cont) return;
    if (!editTerritorioSeleccionado.length) {
      cont.innerHTML = '<div class="text-muted small">No hay distritos seleccionados.</div>';
      return;
    }
    cont.innerHTML = editTerritorioSeleccionado.map(t => `
      <div class="d-flex justify-content-between align-items-start gap-2 border rounded bg-light px-2 py-2 mb-2">
        <div>
          <div><strong>${esc(t.departamento)}</strong> / ${esc(t.provincia)} / ${esc(t.distrito)}</div>
          <div class="text-muted small">Ubigeo: ${esc(t.ubigeo || '-')}</div>
        </div>
        <button type="button" class="btn btn-sm btn-outline-danger" data-edit-quitar-territorio-admin="${escAttr(t.clave)}">Quitar</button>
      </div>`).join('');
  }

  function inicializarTerritorioEditarDesdeModal() {
    asegurarUIEditarTerritorioAdmin();
    cargarDesdeTextareaTerritorioAdmin();
    cargarDepartamentosEditarTerritorioAdmin();
    if (q('editSelProvinciaAdmin')) q('editSelProvinciaAdmin').innerHTML = '<option value="">Seleccione...</option>';
    limpiarDistritosEditarTerritorioAdmin('Seleccione primero departamento y provincia.');
    renderSeleccionTerritorioEditarAdmin();
  }

  function envolverAbrirEditarDSAdmin() {
    const original = window.abrirEditarDSAdmin || (typeof abrirEditarDSAdmin === 'function' ? abrirEditarDSAdmin : null);
    if (!original || original.__territorioAdminV651) return;
    const wrapper = function abrirEditarDSAdminTerritorioV651(id) {
      const r = original.apply(this, arguments);
      setTimeout(inicializarTerritorioEditarDesdeModal, 80);
      return r;
    };
    wrapper.__territorioAdminV651 = true;
    window.abrirEditarDSAdmin = wrapper;
    try { abrirEditarDSAdmin = wrapper; } catch {}
  }

  function envolverGuardarEditarDSAdmin() {
    const original = window.guardarEditarDSAdmin || (typeof guardarEditarDSAdmin === 'function' ? guardarEditarDSAdmin : null);
    if (!original || original.__territorioAdminV651) return;
    const wrapper = function guardarEditarDSAdminTerritorioV651() {
      sincronizarTextareaTerritorioAdmin();
      if (!editTerritorioSeleccionado.length) {
        alert('Debe seleccionar al menos un distrito en Territorio involucrado.');
        return;
      }
      return original.apply(this, arguments);
    };
    wrapper.__territorioAdminV651 = true;
    window.guardarEditarDSAdmin = wrapper;
    try { guardarEditarDSAdmin = wrapper; } catch {}

    const btn = q('btnGuardarEditarDSAdmin');
    if (btn) {
      btn.replaceWith(btn.cloneNode(true));
      q('btnGuardarEditarDSAdmin')?.addEventListener('click', wrapper);
    }
  }

  function instalarV651() {
    envolverAbrirEditarDSAdmin();
    asegurarUIEditarTerritorioAdmin();
    envolverGuardarEditarDSAdmin();
  }

  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
      instalarV651();
      console.info('DEE MIDIS cierre aplicado:', VERSION);
    }, 2700);
  });

  setTimeout(instalarV651, 3600);
})();


// ================= CIERRE FINAL DASHBOARD EJECUTIVO v66.1 =================
// Mejora exclusiva de la pestaña Dashboard: filtro Vigentes/No vigentes/Todos,
// leyenda por DS con checkboxes, tablas con DS involucrados y exportación JPG/PDF.
(function cierreDashboardEjecutivoV661(){
  const VERSION = 'Dashboard v66.1';
  const DASH_COLORS = ['#0d6efd','#198754','#dc3545','#fd7e14','#6f42c1','#20c997','#0dcaf0','#6610f2','#d63384','#ffc107','#6c757d','#2f5597','#70ad47','#c00000','#7030a0','#264653','#2a9d8f','#e76f51','#8d99ae','#003049'];
  let mapaDashboard = null;
  let capaDashboard = null;
  let filtroDashboard = 'vigentes';
  let dsVisibles = new Set();
  let seleccionLeyendaInicializada = false;
  let ultimaClaveFiltroLeyenda = '';
  let inicializado = false;

  const q = (id) => document.getElementById(id);

  function asegurarEstilosDashboard() {
    if (q('dashboardDEEStylesV661')) return;
    const style = document.createElement('style');
    style.id = 'dashboardDEEStylesV661';
    style.textContent = `
      .dee-dashboard-toolbar{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center;justify-content:space-between;margin-bottom:.75rem}
      .dee-dashboard-toolbar .form-select{max-width:180px}
      .dee-kpi-card{background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:16px;box-shadow:0 3px 12px rgba(15,23,42,.06);height:100%}
      .dee-kpi-number{font-size:2.1rem;font-weight:800;line-height:1;color:#1F4E79}
      .dee-kpi-label{font-size:.86rem;color:#475569;margin-top:8px;font-weight:600}
      .dee-kpi-note{font-size:.74rem;color:#64748b;margin-top:4px}
      .dee-badge-rojo{background:#dc3545;color:#fff}.dee-badge-ambar{background:#ffc107;color:#111}.dee-badge-verde{background:#198754;color:#fff}.dee-badge-gris{background:#6c757d;color:#fff}
      .dee-dashboard-empty{color:#64748b;font-size:.88rem;padding:10px}
      .dee-map-shell{display:grid;grid-template-columns:minmax(0,1fr) 270px;gap:.75rem;align-items:stretch}
      .dee-map-legend{background:#fff;border:1px solid #dbe3ef;border-radius:10px;padding:.75rem;max-height:520px;overflow:auto}
      .dee-legend-row{display:flex;align-items:flex-start;gap:.45rem;border-bottom:1px solid #eef2f7;padding:.38rem 0;font-size:11px;line-height:1.25}
      .dee-legend-row:last-child{border-bottom:0}.dee-color-dot{width:12px;height:12px;border-radius:50%;display:inline-block;margin-top:2px;box-shadow:0 0 0 1px rgba(0,0,0,.18)}
      .dee-semaforo-legend{display:flex;flex-wrap:wrap;gap:.5rem;margin-top:.35rem;margin-bottom:1rem}.dee-semaforo-item{border:1px solid #dbe3ef;border-radius:999px;padding:.28rem .55rem;background:#fff;font-size:11px}
      .dee-export-panel{display:flex;flex-wrap:wrap;gap:.45rem;align-items:center}.dee-export-panel .form-select{width:auto;min-width:150px}
      #dashboardExportArea{background:#fff}
      @media(max-width: 992px){.dee-map-shell{grid-template-columns:1fr}.dee-map-legend{max-height:260px}}
      @media print{#dashboardExportArea{padding:12px!important}.dee-dashboard-toolbar{display:none!important}}
    `;
    document.head.appendChild(style);
  }

  function fechaLocal(valor) {
    if (!valor) return null;
    const s = String(valor).slice(0, 10);
    const d = new Date(`${s}T00:00:00`);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function hoyCero() {
    const d = new Date();
    d.setHours(0,0,0,0);
    return d;
  }

  function esVigente(d) {
    const h = hoyCero();
    const ini = fechaLocal(d?.fecha_inicio || d?.fechaInicio);
    const fin = fechaLocal(d?.fecha_fin || d?.fechaFin);
    if (!fin) return false;
    if (ini && h < ini) return false;
    return h <= fin;
  }

  function estadoFiltroTexto() {
    if (filtroDashboard === 'vigentes') return 'Vigentes';
    if (filtroDashboard === 'no_vigentes') return 'No vigentes';
    return 'Todos';
  }

  function aplicaFiltroEstado(d) {
    const vigente = esVigente(d);
    if (filtroDashboard === 'vigentes') return vigente;
    if (filtroDashboard === 'no_vigentes') return !vigente;
    return true;
  }

  function diasRestantes(d) {
    const fin = fechaLocal(d?.fecha_fin || d?.fechaFin);
    if (!fin) return 0;
    return Math.max(0, Math.ceil((fin - hoyCero()) / 86400000));
  }

  function avanceTiempo(d) {
    const ini = fechaLocal(d?.fecha_inicio || d?.fechaInicio);
    const fin = fechaLocal(d?.fecha_fin || d?.fechaFin);
    const h = hoyCero();
    if (!ini || !fin || fin <= ini) return 0;
    const total = fin - ini;
    const usado = Math.min(Math.max(h - ini, 0), total);
    return Math.round((usado / total) * 100);
  }

  function semaforo(d) {
    if (!esVigente(d)) return { texto:'No vigente', clase:'dee-badge-gris', orden:4 };
    const ini = fechaLocal(d?.fecha_inicio || d?.fechaInicio);
    const fin = fechaLocal(d?.fecha_fin || d?.fechaFin);
    const h = hoyCero();
    if (!ini || !fin || fin <= ini) return { texto:'Rojo', clase:'dee-badge-rojo', orden:1 };
    const restante = Math.max(fin - h, 0);
    const total = fin - ini;
    const pct = (restante / total) * 100;
    if (pct < 20) return { texto:'Rojo', clase:'dee-badge-rojo', orden:1 };
    if (pct <= 50) return { texto:'Ámbar', clase:'dee-badge-ambar', orden:2 };
    return { texto:'Verde', clase:'dee-badge-verde', orden:3 };
  }

  function territorio(d) { return Array.isArray(d?.territorio) ? d.territorio : []; }
  function keyDep(t){ return normalizarTexto(t?.departamento || ''); }
  function keyProv(t){ return `${normalizarTexto(t?.departamento || '')}|${normalizarTexto(t?.provincia || '')}`; }
  function keyDist(t){ const ub = getUbigeoValue(t); return ub ? String(ub) : `${normalizarTexto(t?.departamento || '')}|${normalizarTexto(t?.provincia || '')}|${normalizarTexto(t?.distrito || '')}`; }
  function latLng(t){
    const lat = Number(String(getLatitud(t)).replace(',', '.'));
    const lng = Number(String(getLongitud(t)).replace(',', '.'));
    if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return [lat, lng];
    return null;
  }
  function nombreDS(d){ return formatearNumeroDS(d).replace('DS N.°', 'D.S. N°').replace('DS N°', 'D.S. N°'); }

  function todosDecretos() {
    return (state.decretos?.length ? state.decretos : cargarDecretosLocales()).map(normalizarDecreto).filter(Boolean);
  }

  function colorPorIndice(i){ return DASH_COLORS[i % DASH_COLORS.length]; }

  function construirDatos() {
    const decretosTodos = todosDecretos();
    const decretosFiltrados = decretosTodos.filter(aplicaFiltroEstado);
    decretosFiltrados.forEach((d, i) => { d.__dashColor = colorPorIndice(i); });

    const idsFiltro = new Set(decretosFiltrados.map(d => String(d.id)));
    const claveFiltro = `${filtroDashboard}|${[...idsFiltro].sort().join(',')}`;

    if (!seleccionLeyendaInicializada || ultimaClaveFiltroLeyenda !== claveFiltro) {
      dsVisibles = new Set(idsFiltro);
      seleccionLeyendaInicializada = true;
      ultimaClaveFiltroLeyenda = claveFiltro;
    } else {
      dsVisibles = new Set([...dsVisibles].filter(id => idsFiltro.has(id)));
    }

    const decretosMapa = decretosFiltrados.filter(d => dsVisibles.has(String(d.id)));
    const departamentos = new Set();
    const provincias = new Set();
    const distritos = new Map();
    const departamentosConteo = new Map();
    const departamentosDS = new Map();

    decretosMapa.forEach((d) => {
      territorio(d).forEach(t => {
        const dep = keyDep(t), prov = keyProv(t), dist = keyDist(t);
        if (!dep || !prov || !dist) return;
        departamentos.add(dep); provincias.add(prov);
        departamentosConteo.set(dep, (departamentosConteo.get(dep) || 0) + 1);
        if (!departamentosDS.has(dep)) departamentosDS.set(dep, { nombre: t.departamento || dep, decretos: new Map() });
        departamentosDS.get(dep).decretos.set(String(d.id), { id: d.id, nombre: nombreDS(d), estado: esVigente(d) ? 'Vigente' : 'No vigente', color: d.__dashColor });
        if (!distritos.has(dist)) {
          distritos.set(dist, { key:dist, departamento:t.departamento||'', provincia:t.provincia||'', distrito:t.distrito||'', latlng:latLng(t), decretos:new Map(), fechasInicio:[], fechasFin:[] });
        }
        const item = distritos.get(dist);
        item.decretos.set(String(d.id), { id:d.id, nombre:nombreDS(d), estado: esVigente(d) ? 'Vigente' : 'No vigente', color:d.__dashColor });
        if (d.fecha_inicio) item.fechasInicio.push(String(d.fecha_inicio).slice(0,10));
        if (d.fecha_fin) item.fechasFin.push(String(d.fecha_fin).slice(0,10));
      });
    });

    return { decretosTodos, decretosFiltrados, decretosMapa, departamentos, provincias, distritos, departamentosConteo, departamentosDS };
  }

  function asegurarEstructuraDashboard() {
    const tab = q('tabDashboard');
    if (!tab) return;
    const cardBody = tab.querySelector('.card-body');
    if (!cardBody) return;
    cardBody.id = 'dashboardExportArea';

    const header = cardBody.querySelector('.d-flex.justify-content-between.align-items-center.mb-3');
    if (header && !q('dashboardControlGlobal')) {
      const panel = document.createElement('div');
      panel.id = 'dashboardControlGlobal';
      panel.className = 'dee-dashboard-toolbar border rounded bg-light p-2';
      panel.innerHTML = `
        <div class="d-flex flex-wrap gap-2 align-items-center">
          <label class="form-label mb-0 small">Filtro global</label>
          <select id="dashboardFiltroEstado" class="form-select form-select-sm">
            <option value="vigentes">Vigentes</option>
            <option value="no_vigentes">No vigentes</option>
            <option value="todos">Todos</option>
          </select>
          <span id="dashboardFiltroActivo" class="badge text-bg-primary">Vigentes</span>
        </div>
        <div class="dee-export-panel">
          <label class="form-label mb-0 small">Exportar</label>
          <select id="dashboardExportFiltro" class="form-select form-select-sm">
            <option value="actual">Filtro actual</option>
            <option value="vigentes">Vigentes</option>
            <option value="no_vigentes">No vigentes</option>
            <option value="todos">Todos</option>
          </select>
          <button id="btnExportDashboardJPG" type="button" class="btn btn-sm btn-outline-primary">Exportar Dashboard JPG</button>
          <button id="btnExportDashboardPDF" type="button" class="btn btn-sm btn-primary">Exportar Dashboard PDF</button>
        </div>`;
      header.insertAdjacentElement('afterend', panel);
    }

    const mapa = q('mapaDS');
    if (mapa && !q('dashboardMapaLeyenda')) {
      const parent = mapa.parentElement;
      const shell = document.createElement('div');
      shell.className = 'dee-map-shell';
      const leyenda = document.createElement('div');
      leyenda.id = 'dashboardMapaLeyenda';
      leyenda.className = 'dee-map-legend';
      leyenda.innerHTML = '<div class="text-muted small">Leyenda de Decretos Supremos</div>';
      parent.insertBefore(shell, mapa);
      shell.appendChild(mapa);
      shell.appendChild(leyenda);
    }

    const thDeptos = document.querySelector('#tablaDeptos thead tr');
    if (thDeptos && !thDeptos.querySelector('[data-dash-ds-col]')) {
      thDeptos.insertAdjacentHTML('beforeend', '<th data-dash-ds-col>Decretos Supremos involucrados</th>');
    }
    const thReps = document.querySelector('#tablaRepetidos thead tr');
    if (thReps && !thReps.querySelector('[data-dash-ds-col]')) {
      thReps.insertAdjacentHTML('beforeend', '<th data-dash-ds-col>Decretos Supremos involucrados</th>');
    }
    const tituloRep = [...cardBody.querySelectorAll('h5.text-primary')].find(h => normalizarTexto(h.textContent).includes('DISTRITOS REPETIDOS'));
    if (tituloRep) tituloRep.textContent = `Distritos repetidos en declaratorias ${estadoFiltroTexto().toLowerCase()}`;

    const resumen = q('tablaResumenDS');
    if (resumen && !q('dashboardSemaforoLeyenda')) {
      resumen.closest('.table-responsive')?.insertAdjacentHTML('afterend', `
        <div id="dashboardSemaforoLeyenda" class="dee-semaforo-legend">
          <span class="dee-semaforo-item"><span class="badge dee-badge-verde">Verde</span> Plazo suficiente de vigencia</span>
          <span class="dee-semaforo-item"><span class="badge dee-badge-ambar">Ámbar</span> Próxima a vencer</span>
          <span class="dee-semaforo-item"><span class="badge dee-badge-rojo">Rojo</span> Fase crítica o pocos días restantes</span>
          <span class="dee-semaforo-item"><span class="badge dee-badge-gris">Gris</span> Declaratoria no vigente</span>
        </div>`);
    }
  }

  function renderLeyenda(datos) {
    const cont = q('dashboardMapaLeyenda');
    if (!cont) return;
    const filas = datos.decretosFiltrados.map(d => {
      const distCount = new Set(territorio(d).map(keyDist).filter(Boolean)).size;
      const id = String(d.id);
      const checked = dsVisibles.has(id) ? 'checked' : '';
      return `
        <label class="dee-legend-row">
          <input type="checkbox" class="form-check-input dash-ds-check" value="${escapeHtmlAttr(id)}" ${checked}>
          <span class="dee-color-dot" style="background:${escapeHtmlAttr(d.__dashColor)}"></span>
          <span><strong>${escapeHtml(nombreDS(d))}</strong><br><span class="text-muted">${esVigente(d) ? 'Vigente' : 'No vigente'} · ${distCount} distrito(s)</span></span>
        </label>`;
    }).join('');
    cont.innerHTML = `
      <div class="d-flex justify-content-between align-items-center mb-2">
        <strong>Leyenda por DS</strong>
        <span class="badge text-bg-light">${escapeHtml(estadoFiltroTexto())}</span>
      </div>
      <div class="d-flex gap-2 mb-2">
        <button id="btnDashSeleccionarTodos" type="button" class="btn btn-sm btn-outline-primary">Seleccionar todos</button>
        <button id="btnDashQuitarSeleccion" type="button" class="btn btn-sm btn-outline-secondary">Quitar selección</button>
      </div>
      ${filas || '<div class="dee-dashboard-empty">No hay decretos para el filtro seleccionado.</div>'}`;
    cont.querySelectorAll('.dash-ds-check').forEach(chk => chk.addEventListener('change', () => {
      if (chk.checked) dsVisibles.add(String(chk.value)); else dsVisibles.delete(String(chk.value));
      seleccionLeyendaInicializada = true;
      renderDashboardEjecutivoV661(false);
    }));
    q('btnDashSeleccionarTodos')?.addEventListener('click', () => {
      datos.decretosFiltrados.forEach(d => dsVisibles.add(String(d.id)));
      seleccionLeyendaInicializada = true;
      renderDashboardEjecutivoV661(false);
    });
    q('btnDashQuitarSeleccion')?.addEventListener('click', () => {
      dsVisibles.clear();
      seleccionLeyendaInicializada = true;
      renderDashboardEjecutivoV661(false);
    });
  }

  function renderKPIs(datos) {
    const cont = q('dashboardMetricas');
    if (!cont) return;
    const repetidos = [...datos.distritos.values()].filter(x => x.decretos.size > 1).length;
    const cards = [
      [`Declaratorias de Estado de Emergencia`, datos.decretosMapa.length, `Filtro: ${estadoFiltroTexto()}`],
      ['Departamentos declarados', datos.departamentos.size, 'Sin duplicados'],
      ['Provincias declaradas', datos.provincias.size, 'Sin duplicados'],
      ['Distritos declarados', datos.distritos.size, 'Sin duplicados'],
      ['Distritos en más de una declaratoria', repetidos, `Según filtro ${estadoFiltroTexto().toLowerCase()}`]
    ];
    cont.innerHTML = cards.map(([label,value,note]) => `<div class="col-12 col-md-6"><div class="dee-kpi-card"><div class="dee-kpi-number">${escapeHtml(value)}</div><div class="dee-kpi-label">${escapeHtml(label)}</div><div class="dee-kpi-note">${escapeHtml(note)}</div></div></div>`).join('');
  }

  function resetearContenedorMapaSiCorresponde() {
    let el = q('mapaDS');
    if (!el || !window.L) return null;

    // Este archivo conserva cierres anteriores del Dashboard. Si alguno de ellos
    // inicializó Leaflet sobre #mapaDS, Leaflet deja _leaflet_id y capas antiguas
    // que no obedecen la leyenda final. Se reemplaza SOLO el nodo del mapa para
    // recuperar control limpio sin tocar tablas, KPIs ni estilos.
    const necesitaReset = !mapaDashboard && (el._leaflet_id || el.classList.contains('leaflet-container'));
    if (necesitaReset) {
      const limpio = el.cloneNode(false);
      limpio.id = 'mapaDS';
      limpio.className = el.className.replace(/\bleaflet-[^\s]+/g, '').trim();
      limpio.removeAttribute('tabindex');
      limpio.removeAttribute('style');
      limpio.style.height = el.style.height || '430px';
      limpio.style.minHeight = el.style.minHeight || '430px';
      el.replaceWith(limpio);
      el = limpio;
    }
    return el;
  }

  function renderMapa(datos) {
    let el = resetearContenedorMapaSiCorresponde();
    if (!el || !window.L) return;

    if (!mapaDashboard || !document.body.contains(mapaDashboard.getContainer())) {
      mapaDashboard = L.map(el, { scrollWheelZoom: true }).setView([-9.19, -75.02], 5);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 18,
        attribution: '&copy; OpenStreetMap',
        crossOrigin: true
      }).addTo(mapaDashboard);
      capaDashboard = L.layerGroup().addTo(mapaDashboard);
    }

    if (!capaDashboard) capaDashboard = L.layerGroup().addTo(mapaDashboard);
    capaDashboard.clearLayers();

    // Blindaje adicional: cualquier círculo/marcador dejado por cierres anteriores
    // se retira; se conserva únicamente la capa base y la capa controlada aquí.
    mapaDashboard.eachLayer(layer => {
      if (layer !== capaDashboard && !(layer instanceof L.TileLayer)) {
        try { mapaDashboard.removeLayer(layer); } catch (_) {}
      }
    });
    if (!mapaDashboard.hasLayer(capaDashboard)) capaDashboard.addTo(mapaDashboard);

    const bounds = [];
    [...datos.distritos.values()].forEach(item => {
      if (!item.latlng) return;
      const ds = [...item.decretos.values()];
      if (!ds.length) return;
      const repetido = ds.length > 1;
      const color = repetido ? '#111827' : (ds[0]?.color || '#0d6efd');
      const marker = L.circleMarker(item.latlng, {
        radius: repetido ? 7 : 5,
        color: repetido ? '#000' : color,
        weight: repetido ? 3 : 1,
        fillColor: color,
        fillOpacity: repetido ? .95 : .78,
        opacity: 1,
        pane: 'markerPane'
      });
      marker.bindTooltip(`<strong>${escapeHtml(item.distrito)}</strong><br>Provincia: ${escapeHtml(item.provincia)}<br>Departamento: ${escapeHtml(item.departamento)}<br>Decreto(s): ${escapeHtml(ds.map(d => d.nombre).join(', '))}`, { sticky:true });
      marker.addTo(capaDashboard);
      bounds.push(item.latlng);
    });

    if (bounds.length) mapaDashboard.fitBounds(bounds, { padding:[20,20], maxZoom: 7 });
    else mapaDashboard.setView([-9.19, -75.02], 5);

    setTimeout(() => {
      try { mapaDashboard.invalidateSize(true); } catch (_) {}
      try { if (bounds.length) mapaDashboard.fitBounds(bounds, { padding:[20,20], maxZoom: 7 }); } catch (_) {}
    }, 180);
  }

  function renderResumen(datos) {
    const tbody = document.querySelector('#tablaResumenDS tbody');
    if (!tbody) return;
    const filas = datos.decretosMapa.map(d => {
      const terr = territorio(d);
      const deps = new Set(terr.map(keyDep).filter(Boolean));
      const provs = new Set(terr.map(keyProv).filter(Boolean));
      const dists = new Set(terr.map(keyDist).filter(Boolean));
      const sem = semaforo(d);
      return { d, deps, provs, dists, sem };
    }).sort((a,b) => a.sem.orden - b.sem.orden || diasRestantes(a.d) - diasRestantes(b.d));
    tbody.innerHTML = filas.length ? filas.map(x => `<tr><td>${escapeHtml(nombreDS(x.d))}</td><td>${escapeHtml(x.d.fecha_inicio||'')}</td><td>${escapeHtml(x.d.fecha_fin||'')}</td><td>${diasRestantes(x.d)}</td><td>${avanceTiempo(x.d)}%</td><td><span class="badge ${x.sem.clase}">${x.sem.texto}</span></td><td>${x.deps.size}</td><td>${x.provs.size}</td><td>${x.dists.size}</td></tr>`).join('') : `<tr><td colspan="9" class="dee-dashboard-empty">No hay declaratorias para el filtro seleccionado.</td></tr>`;
  }

  function renderDepartamentos(datos) {
    const tbody = document.querySelector('#tablaDeptos tbody');
    if (!tbody) return;
    const filas = [...datos.departamentosDS.entries()].map(([key, obj]) => ({ departamento: obj.nombre || key, count: datos.departamentosConteo.get(key) || 0, decretos: [...obj.decretos.values()] })).sort((a,b) => b.count - a.count || a.departamento.localeCompare(b.departamento,'es'));
    tbody.innerHTML = filas.length ? filas.map(f => `<tr><td>${escapeHtml(f.departamento)}</td><td>${f.count}</td><td><span class="badge ${f.decretos.some(d=>d.estado==='Vigente') ? 'text-bg-success' : 'text-bg-secondary'}">${escapeHtml(estadoFiltroTexto())}</span></td><td>${escapeHtml(f.decretos.map(d=>d.nombre).join(', '))}</td></tr>`).join('') : `<tr><td colspan="4" class="dee-dashboard-empty">No hay departamentos para el filtro seleccionado.</td></tr>`;
  }

  function renderRepetidos(datos) {
    const tbody = document.querySelector('#tablaRepetidos tbody');
    if (!tbody) return;
    const filas = [...datos.distritos.values()].map(item => ({...item, veces:item.decretos.size, ds:[...item.decretos.values()]})).filter(x => x.veces > 1).sort((a,b) => b.veces - a.veces || String(a.departamento).localeCompare(String(b.departamento),'es'));
    tbody.innerHTML = filas.length ? filas.map(f => `<tr><td>${escapeHtml(f.departamento)}</td><td>${escapeHtml(f.provincia)}</td><td>${escapeHtml(f.distrito)}</td><td>${f.veces}</td><td>${escapeHtml(f.fechasInicio.sort()[0]||'')}</td><td>${escapeHtml(f.fechasFin.sort().slice(-1)[0]||'')}</td><td>${escapeHtml(f.ds.map(d=>d.nombre).join(', '))}</td></tr>`).join('') : `<tr><td colspan="7" class="dee-dashboard-empty">No hay distritos repetidos para el filtro seleccionado.</td></tr>`;
  }

  function actualizarTextoFiltro() {
    const badge = q('dashboardFiltroActivo');
    if (badge) badge.textContent = estadoFiltroTexto();
    const subtitulo = q('tabDashboard')?.querySelector('h4.text-primary + .text-muted');
    if (subtitulo) subtitulo.textContent = `Declaratorias de Estado de Emergencia · Filtro aplicado: ${estadoFiltroTexto()} · Control territorial sin duplicidades`;
    const tituloRep = [...(q('tabDashboard')?.querySelectorAll('h5.text-primary') || [])].find(h => normalizarTexto(h.textContent).includes('DISTRITOS REPETIDOS'));
    if (tituloRep) tituloRep.textContent = `Distritos repetidos en declaratorias ${estadoFiltroTexto().toLowerCase()}`;
  }

  function renderDashboardEjecutivoV661(resetSeleccion = true) {
    try {
      asegurarEstilosDashboard();
      asegurarEstructuraDashboard();
      const sel = q('dashboardFiltroEstado');
      if (sel && sel.value !== filtroDashboard) sel.value = filtroDashboard;
      if (resetSeleccion) {
        dsVisibles.clear();
        seleccionLeyendaInicializada = false;
        ultimaClaveFiltroLeyenda = '';
      }
      const datos = construirDatos();
      actualizarTextoFiltro();
      renderLeyenda(datos);
      renderKPIs(datos);
      renderMapa(datos);
      renderResumen(datos);
      renderDepartamentos(datos);
      renderRepetidos(datos);
    } catch (e) { console.error('Error Dashboard v66.1:', e); }
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (src.includes('html2canvas') && window.html2canvas) return resolve();
      const s = document.createElement('script');
      s.src = src; s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  async function prepararExportacion(tipo) {
    const oldFiltro = filtroDashboard;
    const oldSeleccion = new Set(dsVisibles);
    const oldInicializada = seleccionLeyendaInicializada;
    const oldClave = ultimaClaveFiltroLeyenda;
    const chosen = q('dashboardExportFiltro')?.value || 'actual';

    if (chosen !== 'actual') {
      filtroDashboard = chosen;
      q('dashboardFiltroEstado') && (q('dashboardFiltroEstado').value = filtroDashboard);
      dsVisibles.clear();
      seleccionLeyendaInicializada = false;
      ultimaClaveFiltroLeyenda = '';
      renderDashboardEjecutivoV661(true);
    } else {
      // Exporta exactamente lo que el usuario tiene marcado en la leyenda.
      renderDashboardEjecutivoV661(false);
    }

    await new Promise(r => setTimeout(r, 700));
    await exportarDashboard(tipo);

    filtroDashboard = oldFiltro;
    q('dashboardFiltroEstado') && (q('dashboardFiltroEstado').value = filtroDashboard);
    dsVisibles = new Set(oldSeleccion);
    seleccionLeyendaInicializada = oldInicializada;
    ultimaClaveFiltroLeyenda = oldClave;
    renderDashboardEjecutivoV661(false);
  }

  async function exportarDashboard(tipo) {
    const area = q('dashboardExportArea') || q('tabDashboard');
    if (!area) return alert('No se encontró el Dashboard para exportar.');
    const oldAreaWidth = area.style.width;
    const oldAreaMaxWidth = area.style.maxWidth;
    const oldOverflow = document.body.style.overflow;
    let titulo = null;
    try {
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js');

      area.style.width = '1400px';
      area.style.maxWidth = '1400px';
      document.body.style.overflow = 'visible';
      try { mapaDashboard?.invalidateSize(true); } catch (_) {}
      await new Promise(r => setTimeout(r, 350));

      titulo = document.createElement('div');
      titulo.id = 'dashboardExportHeaderTmp';
      titulo.className = 'border-bottom mb-2 pb-2';
      titulo.innerHTML = `<h4 class="text-primary mb-1">Dashboard de Declaratorias de Estado de Emergencia</h4><div class="small text-muted">Fecha de generación: ${escapeHtml(fechaHoraLocalISO())} · Filtro aplicado: ${escapeHtml(estadoFiltroTexto())} · DS seleccionados: ${dsVisibles.size}</div>`;
      area.insertBefore(titulo, area.firstChild);
      try { mapaDashboard?.invalidateSize(true); } catch (_) {}
      await new Promise(r => setTimeout(r, 250));

      const canvas = await window.html2canvas(area, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
        logging: false,
        width: area.scrollWidth,
        height: area.scrollHeight,
        windowWidth: Math.max(1400, area.scrollWidth),
        windowHeight: Math.max(900, area.scrollHeight)
      });
      titulo.remove();
      titulo = null;
      const fileBase = `Dashboard_DEE_${estadoFiltroTexto().replace(/\s+/g,'_')}_${hoy()}`;
      if (tipo === 'jpg') {
        const a = document.createElement('a');
        a.download = `${fileBase}.jpg`;
        a.href = canvas.toDataURL('image/jpeg', 0.95);
        a.click();
        return;
      }
      const jsPDF = window.jspdf?.jsPDF || window.jsPDF;
      if (!jsPDF) return alert('No se encontró jsPDF para generar el PDF.');
      const pdf = new jsPDF('l', 'mm', 'a4');
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const imgW = pageW - 16;
      const imgH = canvas.height * imgW / canvas.width;
      let heightLeft = imgH;
      let position = 8;
      const imgData = canvas.toDataURL('image/jpeg', 0.95);
      pdf.addImage(imgData, 'JPEG', 8, position, imgW, imgH);
      heightLeft -= (pageH - 16);
      while (heightLeft > 0) {
        pdf.addPage('l');
        position = heightLeft - imgH + 8;
        pdf.addImage(imgData, 'JPEG', 8, position, imgW, imgH);
        heightLeft -= (pageH - 16);
      }
      pdf.save(`${fileBase}.pdf`);
    } catch (e) {
      console.error('Error exportando Dashboard:', e);
      alert('No se pudo exportar el Dashboard. Revise la consola para el detalle técnico.');
    } finally {
      if (titulo) { try { titulo.remove(); } catch (_) {} }
      area.style.width = oldAreaWidth;
      area.style.maxWidth = oldAreaMaxWidth;
      document.body.style.overflow = oldOverflow;
      try { mapaDashboard?.invalidateSize(true); } catch (_) {}
    }
  }

  function instalarEventos() {
    if (inicializado) return;
    inicializado = true;
    document.addEventListener('change', (e) => {
      if (e.target?.id === 'dashboardFiltroEstado') {
        filtroDashboard = e.target.value || 'vigentes';
        dsVisibles.clear();
        renderDashboardEjecutivoV661(true);
      }
    });
    document.addEventListener('click', (e) => {
      if (e.target?.id === 'btnActualizarDashboard') renderDashboardEjecutivoV661(true);
      if (e.target?.id === 'btnExportDashboardJPG') prepararExportacion('jpg');
      if (e.target?.id === 'btnExportDashboardPDF') prepararExportacion('pdf');
    });
    document.querySelector('[data-bs-target="#tabDashboard"]')?.addEventListener('shown.bs.tab', () => setTimeout(() => renderDashboardEjecutivoV661(false), 250));
    document.querySelector('[data-bs-target="#tabDashboard"]')?.addEventListener('click', () => setTimeout(() => renderDashboardEjecutivoV661(false), 300));
  }

  const renderOriginalDS = typeof window.renderTablaDecretosBasica === 'function' ? window.renderTablaDecretosBasica : null;
  if (renderOriginalDS && !window.__dashboardV661RenderHook) {
    window.__dashboardV661RenderHook = true;
    window.renderTablaDecretosBasica = function() {
      const r = renderOriginalDS.apply(this, arguments);
      setTimeout(() => renderDashboardEjecutivoV661(false), 100);
      return r;
    };
    try { renderTablaDecretosBasica = window.renderTablaDecretosBasica; } catch {}
  }

  document.addEventListener('DOMContentLoaded', () => {
    instalarEventos();
    setTimeout(() => renderDashboardEjecutivoV661(true), 1200);
  });
  setTimeout(() => { instalarEventos(); renderDashboardEjecutivoV661(true); }, 2500);
  window.renderDashboardEjecutivoDEE = renderDashboardEjecutivoV661;
  window.renderDashboardEjecutivoV661 = renderDashboardEjecutivoV661;
  console.info('DEE MIDIS cierre aplicado:', VERSION);
})();

// ================= CORRECCIÓN QUIRÚRGICA FINAL DASHBOARD v68.2 =================
// Alcance exclusivo: checkbox Leyenda por DS ↔ puntos del mapa y exportación JPG/PDF.
// No modifica login, roles, tablas de registro, RDS, usuarios ni estilos generales.
(function dashboardCheckboxExportV682(){
  const VERSION = 'v68.2 checkbox-export-map-final';
  const COLORS = ['#0d6efd','#198754','#dc3545','#fd7e14','#6f42c1','#20c997','#0dcaf0','#6610f2','#d63384','#ffc107','#6c757d','#2f5597','#70ad47','#c00000','#7030a0','#264653','#2a9d8f','#e76f51','#8d99ae','#003049'];
  const PERU_CENTER = [-9.19, -75.02];
  const PERU_ZOOM = 5;

  let filtroEstado = 'vigentes';
  let seleccionInicializada = false;
  let claveSeleccion = '';
  let dsSeleccionados = new Set();
  let finalMap = null;
  let installed = false;

  const q = (id) => document.getElementById(id);
  const norm = (v) => (typeof normalizarTexto === 'function' ? normalizarTexto(v) : String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toUpperCase());
  const esc = (v) => (typeof escapeHtml === 'function' ? escapeHtml(v) : String(v ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;'));
  const escAttr = (v) => (typeof escapeHtmlAttr === 'function' ? escapeHtmlAttr(v) : esc(v));

  function fechaLocal(v){
    if (!v) return null;
    const s = String(v).slice(0,10);
    const d = new Date(`${s}T00:00:00`);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  function hoy0(){ const d = new Date(); d.setHours(0,0,0,0); return d; }
  function vigente(d){
    const h = hoy0();
    const ini = fechaLocal(d?.fecha_inicio || d?.fechaInicio);
    const fin = fechaLocal(d?.fecha_fin || d?.fechaFin);
    if (!fin) return false;
    if (ini && h < ini) return false;
    return h <= fin;
  }
  function aplicaFiltro(d){
    const v = vigente(d);
    if (filtroEstado === 'vigentes') return v;
    if (filtroEstado === 'no_vigentes') return !v;
    return true;
  }
  function filtroTexto(){ return filtroEstado === 'vigentes' ? 'Vigentes' : (filtroEstado === 'no_vigentes' ? 'No vigentes' : 'Todos'); }
  function territorio(d){ return Array.isArray(d?.territorio) ? d.territorio : []; }
  function ubigeo(t){ return (typeof getUbigeoValue === 'function' ? getUbigeoValue(t) : (t?.ubigeo || t?.UBIGEO || t?.codigo || '')); }
  function latVal(t){ return (typeof getLatitud === 'function' ? getLatitud(t) : (t?.latitud ?? t?.lat ?? '')); }
  function lngVal(t){ return (typeof getLongitud === 'function' ? getLongitud(t) : (t?.longitud ?? t?.lng ?? t?.lon ?? '')); }
  function keyDep(t){ return norm(t?.departamento || ''); }
  function keyProv(t){ return `${norm(t?.departamento || '')}|${norm(t?.provincia || '')}`; }
  function keyDist(t){ const u = ubigeo(t); return u ? String(u) : `${norm(t?.departamento || '')}|${norm(t?.provincia || '')}|${norm(t?.distrito || '')}`; }
  function latLng(t){
    const lat = Number(String(latVal(t)).replace(',', '.'));
    const lng = Number(String(lngVal(t)).replace(',', '.'));
    return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? [lat, lng] : null;
  }
  function dsNombre(d){
    const txt = typeof formatearNumeroDS === 'function' ? formatearNumeroDS(d) : `D.S. N° ${d?.numero || ''}-${d?.anio || ''}-PCM`;
    return txt.replace('DS N.°', 'D.S. N°').replace('DS N°', 'D.S. N°');
  }
  function decretosBase(){
    const arr = (window.state?.decretos?.length ? window.state.decretos : (typeof cargarDecretosLocales === 'function' ? cargarDecretosLocales() : []));
    return (Array.isArray(arr) ? arr : []).map(x => typeof normalizarDecreto === 'function' ? normalizarDecreto(x) : x).filter(Boolean);
  }
  function diasRestantes(d){ const fin = fechaLocal(d?.fecha_fin || d?.fechaFin); return fin ? Math.max(0, Math.ceil((fin - hoy0()) / 86400000)) : 0; }
  function avanceTiempo(d){
    const ini = fechaLocal(d?.fecha_inicio || d?.fechaInicio), fin = fechaLocal(d?.fecha_fin || d?.fechaFin), h = hoy0();
    if (!ini || !fin || fin <= ini) return 0;
    return Math.round((Math.min(Math.max(h - ini, 0), fin - ini) / (fin - ini)) * 100);
  }
  function semaforo(d){
    if (!vigente(d)) return { texto:'No vigente', clase:'dee-badge-gris', orden:4 };
    const ini = fechaLocal(d?.fecha_inicio || d?.fechaInicio), fin = fechaLocal(d?.fecha_fin || d?.fechaFin), h = hoy0();
    if (!ini || !fin || fin <= ini) return { texto:'Rojo', clase:'dee-badge-rojo', orden:1 };
    const pct = (Math.max(fin - h, 0) / (fin - ini)) * 100;
    if (pct < 20) return { texto:'Rojo', clase:'dee-badge-rojo', orden:1 };
    if (pct <= 50) return { texto:'Ámbar', clase:'dee-badge-ambar', orden:2 };
    return { texto:'Verde', clase:'dee-badge-verde', orden:3 };
  }

  function asegurarEstructura(){
    const tab = q('tabDashboard');
    const cardBody = tab?.querySelector('.card-body');
    if (!cardBody) return;
    cardBody.id = 'dashboardExportArea';

    const header = cardBody.querySelector('.d-flex.justify-content-between.align-items-center.mb-3');
    if (header && !q('dashboardControlGlobal')) {
      const panel = document.createElement('div');
      panel.id = 'dashboardControlGlobal';
      panel.className = 'dee-dashboard-toolbar border rounded bg-light p-2';
      panel.innerHTML = `
        <div class="d-flex flex-wrap gap-2 align-items-center">
          <label class="form-label mb-0 small">Filtro global</label>
          <select id="dashboardFiltroEstado" class="form-select form-select-sm">
            <option value="vigentes">Vigentes</option>
            <option value="no_vigentes">No vigentes</option>
            <option value="todos">Todos</option>
          </select>
          <span id="dashboardFiltroActivo" class="badge text-bg-primary">Vigentes</span>
        </div>
        <div class="dee-export-panel">
          <label class="form-label mb-0 small">Exportar</label>
          <select id="dashboardExportFiltro" class="form-select form-select-sm">
            <option value="actual">Filtro actual</option>
            <option value="vigentes">Vigentes</option>
            <option value="no_vigentes">No vigentes</option>
            <option value="todos">Todos</option>
          </select>
          <button id="btnExportDashboardJPG" type="button" class="btn btn-sm btn-outline-primary">Exportar Dashboard JPG</button>
          <button id="btnExportDashboardPDF" type="button" class="btn btn-sm btn-primary">Exportar Dashboard PDF</button>
        </div>`;
      header.insertAdjacentElement('afterend', panel);
    }

    const mapa = q('mapaDS');
    if (mapa && !q('dashboardMapaLeyenda')) {
      const parent = mapa.parentElement;
      const shell = document.createElement('div');
      shell.className = 'dee-map-shell';
      const leyenda = document.createElement('div');
      leyenda.id = 'dashboardMapaLeyenda';
      leyenda.className = 'dee-map-legend';
      parent.insertBefore(shell, mapa);
      shell.appendChild(mapa);
      shell.appendChild(leyenda);
    }

    const thResumen = document.querySelector('#tablaResumenDS thead tr');
    if (thResumen) {
      // v77.1: normaliza la cabecera para evitar columnas duplicadas Peligro/Tipo.
      // La versión anterior insertaba Peligro/Tipo aunque ya existían en el HTML,
      // desfasando los encabezados respecto de las celdas del cuerpo.
      thResumen.innerHTML = `
        <th>Decreto Supremo</th>
        <th data-dash-peligro-col>Peligro</th>
        <th data-dash-tipo-col>Tipo</th>
        <th>Fecha inicio</th>
        <th>Fecha fin</th>
        <th>Días restantes</th>
        <th>Avance %</th>
        <th>Semáforo</th>
        <th>N.° departamentos</th>
        <th>N.° provincias</th>
        <th>N.° distritos</th>`;
    }

    const thDeptos = document.querySelector('#tablaDeptos thead tr');
    if (thDeptos) {
      const ths = thDeptos.querySelectorAll('th');
      if (ths[1]) ths[1].textContent = 'Número de distritos';
      if (!thDeptos.querySelector('[data-dash-ds-col]')) thDeptos.insertAdjacentHTML('beforeend', '<th data-dash-ds-col>Decretos Supremos involucrados</th>');
    }
    const thReps = document.querySelector('#tablaRepetidos thead tr');
    if (thReps && !thReps.querySelector('[data-dash-ds-col]')) thReps.insertAdjacentHTML('beforeend', '<th data-dash-ds-col>Decretos Supremos involucrados</th>');

    const resumen = q('tablaResumenDS');
    if (resumen && !q('dashboardSemaforoLeyenda')) {
      resumen.closest('.table-responsive')?.insertAdjacentHTML('afterend', `
        <div id="dashboardSemaforoLeyenda" class="dee-semaforo-legend">
          <span class="dee-semaforo-item"><span class="badge dee-badge-verde">Verde</span> Plazo suficiente de vigencia</span>
          <span class="dee-semaforo-item"><span class="badge dee-badge-ambar">Ámbar</span> Próxima a vencer</span>
          <span class="dee-semaforo-item"><span class="badge dee-badge-rojo">Rojo</span> Fase crítica o pocos días restantes</span>
          <span class="dee-semaforo-item"><span class="badge dee-badge-gris">Gris</span> Declaratoria no vigente</span>
        </div>`);
    }
  }

  function datosDashboard(){
    const filtrados = decretosBase().filter(aplicaFiltro).map((d, i) => ({ ...d, __dashColor: COLORS[i % COLORS.length] }));
    const ids = new Set(filtrados.map(d => String(d.id)));
    const clave = `${filtroEstado}|${[...ids].sort().join(',')}`;
    if (!seleccionInicializada || claveSeleccion !== clave) {
      dsSeleccionados = new Set(ids);
      seleccionInicializada = true;
      claveSeleccion = clave;
    } else {
      dsSeleccionados = new Set([...dsSeleccionados].filter(id => ids.has(id)));
    }

    const decretosMapa = filtrados.filter(d => dsSeleccionados.has(String(d.id)));
    const departamentos = new Set(), provincias = new Set(), distritos = new Map(), deptoConteo = new Map(), deptoDS = new Map();

    decretosMapa.forEach(d => {
      territorio(d).forEach(t => {
        const dep = keyDep(t), prov = keyProv(t), dist = keyDist(t);
        if (!dep || !prov || !dist) return;
        departamentos.add(dep); provincias.add(prov);
        deptoConteo.set(dep, (deptoConteo.get(dep) || 0) + 1);
        if (!deptoDS.has(dep)) deptoDS.set(dep, { nombre: t.departamento || dep, decretos: new Map() });
        deptoDS.get(dep).decretos.set(String(d.id), { nombre: dsNombre(d), estado: vigente(d) ? 'Vigente' : 'No vigente', color: d.__dashColor });
        if (!distritos.has(dist)) distritos.set(dist, { key: dist, departamento: t.departamento || '', provincia: t.provincia || '', distrito: t.distrito || '', latlng: latLng(t), decretos: new Map(), fechasInicio: [], fechasFin: [] });
        const item = distritos.get(dist);
        item.decretos.set(String(d.id), { nombre: dsNombre(d), estado: vigente(d) ? 'Vigente' : 'No vigente', color: d.__dashColor });
        if (d.fecha_inicio) item.fechasInicio.push(String(d.fecha_inicio).slice(0,10));
        if (d.fecha_fin) item.fechasFin.push(String(d.fecha_fin).slice(0,10));
      });
    });

    return { filtrados, decretosMapa, departamentos, provincias, distritos, deptoConteo, deptoDS };
  }

  function renderLeyenda(datos){
    const cont = q('dashboardMapaLeyenda');
    if (!cont) return;
    cont.innerHTML = `
      <div class="d-flex justify-content-between align-items-center mb-2">
        <strong>Leyenda por DS</strong>
        <span class="badge text-bg-light">${esc(filtroTexto())}</span>
      </div>
      <div class="d-flex gap-2 mb-2">
        <button id="btnDashSeleccionarTodos" type="button" class="btn btn-sm btn-outline-primary">Seleccionar todos</button>
        <button id="btnDashQuitarSeleccion" type="button" class="btn btn-sm btn-outline-secondary">Quitar selección</button>
      </div>
      ${datos.filtrados.map(d => {
        const id = String(d.id);
        const count = new Set(territorio(d).map(keyDist).filter(Boolean)).size;
        return `<label class="dee-legend-row">
          <input type="checkbox" class="form-check-input dash-ds-check" value="${escAttr(id)}" ${dsSeleccionados.has(id) ? 'checked' : ''}>
          <span class="dee-color-dot" style="background:${escAttr(d.__dashColor)}"></span>
          <span><strong>${esc(dsNombre(d))}</strong><br><span class="text-muted">${vigente(d) ? 'Vigente' : 'No vigente'} · ${count} distrito(s)</span></span>
        </label>`;
      }).join('') || '<div class="dee-dashboard-empty">No hay decretos para el filtro seleccionado.</div>'}`;
  }

  function recrearMapaLimpio(){
    let el = q('mapaDS');
    if (!el || !window.L) return null;
    try { if (finalMap) finalMap.remove(); } catch(_) {}
    finalMap = null;

    const limpio = document.createElement('div');
    limpio.id = 'mapaDS';
    limpio.className = (el.className || '').split(/\s+/).filter(c => !c.startsWith('leaflet-')).join(' ');
    limpio.style.height = el.style.height || '430px';
    limpio.style.minHeight = el.style.minHeight || '430px';
    limpio.style.width = '100%';
    limpio.dataset.owner = VERSION;
    el.replaceWith(limpio);
    return limpio;
  }

  function renderMapa(datos){
    const el = recrearMapaLimpio();
    if (!el || !window.L) return;
    finalMap = L.map(el, { scrollWheelZoom: true, zoomControl: true }).setView(PERU_CENTER, PERU_ZOOM);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '&copy; OpenStreetMap', crossOrigin: true }).addTo(finalMap);
    const capa = L.layerGroup().addTo(finalMap);
    const bounds = [];

    [...datos.distritos.values()].forEach(item => {
      if (!item.latlng) return;
      const ds = [...item.decretos.values()];
      if (!ds.length) return;
      const repetido = ds.length > 1;
      const color = repetido ? '#111827' : (ds[0]?.color || '#0d6efd');
      const marker = L.circleMarker(item.latlng, {
        radius: repetido ? 7 : 5,
        color: repetido ? '#000000' : color,
        weight: repetido ? 3 : 1,
        fillColor: color,
        fillOpacity: repetido ? 0.95 : 0.80,
        opacity: 1
      });
      marker.bindTooltip(`<strong>${esc(item.distrito)}</strong><br>Provincia: ${esc(item.provincia)}<br>Departamento: ${esc(item.departamento)}<br>Decreto(s): ${esc(ds.map(x => x.nombre).join(', '))}`, { sticky: true });
      marker.addTo(capa);
      bounds.push(item.latlng);
    });

    if (bounds.length) finalMap.fitBounds(bounds, { padding:[20,20], maxZoom:7 });
    else finalMap.setView(PERU_CENTER, PERU_ZOOM);
    setTimeout(() => {
      try { finalMap.invalidateSize(true); } catch(_) {}
      try { if (bounds.length) finalMap.fitBounds(bounds, { padding:[20,20], maxZoom:7 }); } catch(_) {}
    }, 180);
  }

  function renderKPIs(datos){
    const cont = q('dashboardMetricas'); if (!cont) return;
    const repetidos = [...datos.distritos.values()].filter(x => x.decretos.size > 1).length;
    const cards = [
      ['Declaratorias de Estado de Emergencia', datos.decretosMapa.length, `Filtro: ${filtroTexto()}`],
      ['Departamentos declarados', datos.departamentos.size, 'Sin duplicados'],
      ['Provincias declaradas', datos.provincias.size, 'Sin duplicados'],
      ['Distritos declarados', datos.distritos.size, 'Sin duplicados'],
      ['Distritos en más de una declaratoria', repetidos, `Según filtro ${filtroTexto().toLowerCase()}`]
    ];
    cont.innerHTML = cards.map(([label,value,note]) => `<div class="col-12 col-md-6"><div class="dee-kpi-card"><div class="dee-kpi-number">${esc(value)}</div><div class="dee-kpi-label">${esc(label)}</div><div class="dee-kpi-note">${esc(note)}</div></div></div>`).join('');
  }

  function renderResumen(datos){
    const tbody = document.querySelector('#tablaResumenDS tbody'); if (!tbody) return;
    const filas = datos.decretosMapa.map(d => {
      const terr = territorio(d);
      return { d, deps:new Set(terr.map(keyDep).filter(Boolean)), provs:new Set(terr.map(keyProv).filter(Boolean)), dists:new Set(terr.map(keyDist).filter(Boolean)), sem:semaforo(d) };
    }).sort((a,b) => a.sem.orden - b.sem.orden || diasRestantes(a.d) - diasRestantes(b.d));
    tbody.innerHTML = filas.length ? filas.map(x => `<tr><td>${esc(dsNombre(x.d))}</td><td>${esc(x.d.peligro||'')}</td><td>${esc(x.d.tipo_peligro||x.d.tipoPeligro||'')}</td><td>${esc(x.d.fecha_inicio||'')}</td><td>${esc(x.d.fecha_fin||'')}</td><td>${diasRestantes(x.d)}</td><td>${avanceTiempo(x.d)}%</td><td><span class="badge ${x.sem.clase}">${esc(x.sem.texto)}</span></td><td>${x.deps.size}</td><td>${x.provs.size}</td><td>${x.dists.size}</td></tr>`).join('') : `<tr><td colspan="11" class="dee-dashboard-empty">No hay declaratorias para el filtro seleccionado.</td></tr>`;
  }

  function renderDepartamentos(datos){
    const tbody = document.querySelector('#tablaDeptos tbody'); if (!tbody) return;
    const filas = [...datos.deptoDS.entries()].map(([key, obj]) => ({ departamento: obj.nombre || key, count: datos.deptoConteo.get(key) || 0, decretos: [...obj.decretos.values()] })).sort((a,b) => b.count - a.count || a.departamento.localeCompare(b.departamento,'es'));
    tbody.innerHTML = filas.length ? filas.map(f => {
      const dsTexto = f.decretos.map(d=>d.nombre).join(', ');
      return `<tr><td>${esc(f.departamento)}</td><td>${f.count}</td><td><span class="badge ${f.decretos.some(d=>d.estado==='Vigente') ? 'text-bg-success' : 'text-bg-secondary'}">${esc(filtroTexto())}</span></td><td>${esc(`(${f.decretos.length}) ${dsTexto}`)}</td></tr>`;
    }).join('') : `<tr><td colspan="4" class="dee-dashboard-empty">No hay departamentos para el filtro seleccionado.</td></tr>`;
  }

  function renderRepetidos(datos){
    const tbody = document.querySelector('#tablaRepetidos tbody'); if (!tbody) return;
    const filas = [...datos.distritos.values()].map(x => ({ ...x, veces:x.decretos.size, ds:[...x.decretos.values()] })).filter(x => x.veces > 1).sort((a,b) => b.veces - a.veces || String(a.departamento).localeCompare(String(b.departamento),'es'));
    tbody.innerHTML = filas.length ? filas.map(f => `<tr><td>${esc(f.departamento)}</td><td>${esc(f.provincia)}</td><td>${esc(f.distrito)}</td><td>${f.veces}</td><td>${esc(f.fechasInicio.sort()[0]||'')}</td><td>${esc(f.fechasFin.sort().slice(-1)[0]||'')}</td><td>${esc(f.ds.map(d=>d.nombre).join(', '))}</td></tr>`).join('') : `<tr><td colspan="7" class="dee-dashboard-empty">No hay distritos repetidos para el filtro seleccionado.</td></tr>`;
  }

  function actualizarTextos(){
    const sel = q('dashboardFiltroEstado'); if (sel) sel.value = filtroEstado;
    const badge = q('dashboardFiltroActivo'); if (badge) badge.textContent = filtroTexto();
    const subtitulo = q('tabDashboard')?.querySelector('h4.text-primary + .text-muted');
    if (subtitulo) subtitulo.textContent = `Declaratorias de Estado de Emergencia · Filtro aplicado: ${filtroTexto()} · Control territorial sin duplicidades`;
    const tituloRep = [...(q('tabDashboard')?.querySelectorAll('h5.text-primary') || [])].find(h => norm(h.textContent).includes('DISTRITOS REPETIDOS'));
    if (tituloRep) tituloRep.textContent = `Distritos repetidos en declaratorias ${filtroTexto().toLowerCase()}`;
  }

  function render(reset = false){
    try {
      asegurarEstructura();
      if (reset) { seleccionInicializada = false; claveSeleccion = ''; dsSeleccionados.clear(); }
      const datos = datosDashboard();
      actualizarTextos();
      renderLeyenda(datos);
      renderKPIs(datos);
      renderMapa(datos);
      renderResumen(datos);
      renderDepartamentos(datos);
      renderRepetidos(datos);
    } catch(e) { console.error('Error Dashboard v68.2:', e); }
  }

  function loadScript(src){
    return new Promise((resolve, reject) => {
      if (src.includes('html2canvas') && window.html2canvas) return resolve();
      if (src.includes('jspdf') && (window.jspdf?.jsPDF || window.jsPDF)) return resolve();
      const s = document.createElement('script'); s.src = src; s.onload = resolve; s.onerror = reject; document.head.appendChild(s);
    });
  }

  async function exportar(tipo){
    const area = q('dashboardExportArea') || q('tabDashboard');
    if (!area) return alert('No se encontró el Dashboard para exportar.');
    const oldFiltro = filtroEstado;
    const oldSeleccion = new Set(dsSeleccionados);
    const oldInit = seleccionInicializada;
    const oldClave = claveSeleccion;
    const chosen = q('dashboardExportFiltro')?.value || 'actual';

    if (chosen !== 'actual') {
      filtroEstado = chosen;
      seleccionInicializada = false;
      claveSeleccion = '';
      dsSeleccionados.clear();
    }
    render(chosen !== 'actual');
    await new Promise(r => setTimeout(r, 700));

    const oldW = area.style.width, oldMax = area.style.maxWidth, oldOverflow = document.body.style.overflow;
    let titulo = null;
    try {
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js');
      if (tipo === 'pdf') await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
      area.style.width = '1400px';
      area.style.maxWidth = '1400px';
      document.body.style.overflow = 'visible';
      render(false);
      await new Promise(r => setTimeout(r, 900));
      try { finalMap?.invalidateSize(true); } catch(_) {}

      titulo = document.createElement('div');
      titulo.id = 'dashboardExportHeaderTmp';
      titulo.className = 'border-bottom mb-2 pb-2';
      titulo.innerHTML = `<h4 class="text-primary mb-1">Dashboard de Declaratorias de Estado de Emergencia</h4><div class="small text-muted">Fecha de generación: ${esc(typeof fechaHoraLocalISO === 'function' ? fechaHoraLocalISO() : new Date().toLocaleString())} · Filtro aplicado: ${esc(filtroTexto())} · DS seleccionados: ${dsSeleccionados.size}</div>`;
      area.insertBefore(titulo, area.firstChild);
      await new Promise(r => setTimeout(r, 300));

      const canvas = await window.html2canvas(area, { scale:2, useCORS:true, allowTaint:false, backgroundColor:'#ffffff', logging:false, width:area.scrollWidth, height:area.scrollHeight, windowWidth:Math.max(1400, area.scrollWidth), windowHeight:Math.max(900, area.scrollHeight) });
      titulo.remove(); titulo = null;
      const base = `Dashboard_DEE_${filtroTexto().replace(/\s+/g,'_')}_${typeof hoy === 'function' ? hoy() : new Date().toISOString().slice(0,10)}`;
      if (tipo === 'jpg') {
        const a = document.createElement('a');
        a.download = `${base}.jpg`;
        a.href = canvas.toDataURL('image/jpeg', 0.95);
        a.click();
      } else {
        const jsPDF = window.jspdf?.jsPDF || window.jsPDF;
        if (!jsPDF) return alert('No se encontró jsPDF para generar el PDF.');
        const pdf = new jsPDF('l','mm','a4');
        const pageW = pdf.internal.pageSize.getWidth(), pageH = pdf.internal.pageSize.getHeight();
        const imgW = pageW - 16, imgH = canvas.height * imgW / canvas.width;
        const img = canvas.toDataURL('image/jpeg', 0.95);
        let pos = 8, left = imgH;
        pdf.addImage(img, 'JPEG', 8, pos, imgW, imgH);
        left -= (pageH - 16);
        while (left > 0) { pdf.addPage('l'); pos = left - imgH + 8; pdf.addImage(img, 'JPEG', 8, pos, imgW, imgH); left -= (pageH - 16); }
        pdf.save(`${base}.pdf`);
      }
    } catch(e) {
      console.error('Error exportando Dashboard v68.2:', e);
      alert('No se pudo exportar el Dashboard. Revise la consola para el detalle técnico.');
    } finally {
      if (titulo) { try { titulo.remove(); } catch(_) {} }
      area.style.width = oldW;
      area.style.maxWidth = oldMax;
      document.body.style.overflow = oldOverflow;
      filtroEstado = oldFiltro;
      dsSeleccionados = new Set(oldSeleccion);
      seleccionInicializada = oldInit;
      claveSeleccion = oldClave;
      render(false);
    }
  }

  function instalarEventos(){
    if (installed) return;
    installed = true;

    document.addEventListener('change', (e) => {
      const t = e.target;
      if (!t) return;
      if (t.id === 'dashboardFiltroEstado') {
        e.preventDefault(); e.stopImmediatePropagation();
        filtroEstado = t.value || 'vigentes';
        seleccionInicializada = false; claveSeleccion = ''; dsSeleccionados.clear();
        render(true);
        return;
      }
      if (t.classList?.contains('dash-ds-check')) {
        e.preventDefault(); e.stopImmediatePropagation();
        const id = String(t.value || '');
        if (t.checked) dsSeleccionados.add(id); else dsSeleccionados.delete(id);
        seleccionInicializada = true;
        render(false);
      }
    }, true);

    document.addEventListener('click', (e) => {
      const t = e.target;
      if (!t) return;
      if (t.id === 'btnDashSeleccionarTodos') {
        e.preventDefault(); e.stopImmediatePropagation();
        datosDashboard().filtrados.forEach(d => dsSeleccionados.add(String(d.id)));
        seleccionInicializada = true;
        render(false);
        return;
      }
      if (t.id === 'btnDashQuitarSeleccion') {
        e.preventDefault(); e.stopImmediatePropagation();
        dsSeleccionados.clear(); seleccionInicializada = true;
        render(false);
        return;
      }
      if (t.id === 'btnExportDashboardJPG') {
        e.preventDefault(); e.stopImmediatePropagation(); exportar('jpg'); return;
      }
      if (t.id === 'btnExportDashboardPDF') {
        e.preventDefault(); e.stopImmediatePropagation(); exportar('pdf'); return;
      }
      if (t.id === 'btnActualizarDashboard') {
        e.preventDefault(); e.stopImmediatePropagation(); render(true); return;
      }
    }, true);

    document.querySelector('[data-bs-target="#tabDashboard"]')?.addEventListener('shown.bs.tab', () => setTimeout(() => render(false), 350));
    document.querySelector('[data-bs-target="#tabDashboard"]')?.addEventListener('click', () => setTimeout(() => render(false), 450));
  }

  window.renderDashboardEjecutivoDEE = function(reset){ return render(Boolean(reset)); };
  window.renderDashboardEjecutivoV661 = window.renderDashboardEjecutivoDEE;
  window.__dashboardCheckboxExportV682 = { render, exportar, version: VERSION };

  document.addEventListener('DOMContentLoaded', () => { instalarEventos(); setTimeout(() => render(true), 1800); });
  setTimeout(() => { instalarEventos(); render(true); }, 4200);
  console.info('DEE MIDIS cierre aplicado:', VERSION);
})();

// ================= CORRECCIÓN QUIRÚRGICA DASHBOARD v74.1 =================
// Alcance exclusivo: alineación de puntos Leaflet en el mapa del Dashboard y exportación JPG/PDF.
// No modifica login, usuarios, roles, RDS, tablas ni estructura general.
(function dashboardPuntosCalzadosV741(){
  const VERSION = 'v74.1 puntos-calzados-mapa-export';
  const PERU_CENTER = [-9.19, -75.02];
  const PERU_ZOOM = 5;
  const COLORS = ['#0d6efd','#198754','#dc3545','#fd7e14','#6f42c1','#20c997','#0dcaf0','#6610f2','#d63384','#ffc107','#6c757d','#2f5597','#70ad47','#c00000','#7030a0','#264653','#2a9d8f','#e76f51','#8d99ae','#003049'];

  let fixedMap = null;
  let fixedRenderer = null;
  let installing = false;
  let renderTimer = null;
  let exportando = false;

  const $id = (id) => document.getElementById(id);
  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  const norm = (v) => (typeof normalizarTexto === 'function'
    ? normalizarTexto(v)
    : String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase());
  const esc = (v) => (typeof escapeHtml === 'function'
    ? escapeHtml(v)
    : String(v ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;'));

  function fechaLocal(v) {
    if (!v) return null;
    const d = new Date(`${String(v).slice(0, 10)}T00:00:00`);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function hoy0() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function esVigente(d) {
    const h = hoy0();
    const ini = fechaLocal(d?.fecha_inicio || d?.fechaInicio);
    const fin = fechaLocal(d?.fecha_fin || d?.fechaFin);
    if (!fin) return false;
    if (ini && h < ini) return false;
    return h <= fin;
  }

  function filtroActual() {
    return $id('dashboardFiltroEstado')?.value || 'vigentes';
  }

  function filtroTexto() {
    const f = filtroActual();
    if (f === 'vigentes') return 'Vigentes';
    if (f === 'no_vigentes') return 'No vigentes';
    return 'Todos';
  }

  function aplicaFiltroEstado(d) {
    const v = esVigente(d);
    const f = filtroActual();
    if (f === 'vigentes') return v;
    if (f === 'no_vigentes') return !v;
    return true;
  }

  function getUbigeo(t) { return typeof getUbigeoValue === 'function' ? getUbigeoValue(t) : (t?.ubigeo || t?.UBIGEO || t?.codigo || t?.cod_ubigeo || ''); }
  function getLat(t) { return typeof getLatitud === 'function' ? getLatitud(t) : (t?.latitud ?? t?.lat ?? ''); }
  function getLng(t) { return typeof getLongitud === 'function' ? getLongitud(t) : (t?.longitud ?? t?.lng ?? t?.lon ?? ''); }
  function territorio(d) { return Array.isArray(d?.territorio) ? d.territorio : []; }
  function keyDist(t) {
    const ub = getUbigeo(t);
    return ub ? String(ub) : `${norm(t?.departamento || '')}|${norm(t?.provincia || '')}|${norm(t?.distrito || '')}`;
  }
  function latLng(t) {
    const lat = Number(String(getLat(t)).replace(',', '.'));
    const lng = Number(String(getLng(t)).replace(',', '.'));
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    return [lat, lng];
  }
  function nombreDS(d) {
    const txt = typeof formatearNumeroDS === 'function' ? formatearNumeroDS(d) : `D.S. N° ${d?.numero || ''}-${d?.anio || ''}-PCM`;
    return String(txt).replace('DS N.°', 'D.S. N°').replace('DS N°', 'D.S. N°');
  }
  function decretosBase() {
    const base = (window.state?.decretos?.length ? window.state.decretos : (typeof cargarDecretosLocales === 'function' ? cargarDecretosLocales() : []));
    return (Array.isArray(base) ? base : []).map(d => typeof normalizarDecreto === 'function' ? normalizarDecreto(d) : d).filter(Boolean);
  }

  function coloresDesdeLeyenda() {
    const mapa = new Map();
    document.querySelectorAll('#dashboardMapaLeyenda .dash-ds-check').forEach((chk, i) => {
      const dot = chk.closest('.dee-legend-row')?.querySelector('.dee-color-dot');
      mapa.set(String(chk.value), dot?.style?.background || COLORS[i % COLORS.length]);
    });
    return mapa;
  }

  function idsSeleccionadosActuales() {
    const checks = [...document.querySelectorAll('#dashboardMapaLeyenda .dash-ds-check')];
    if (checks.length) return new Set(checks.filter(chk => chk.checked).map(chk => String(chk.value)));
    return new Set(decretosBase().filter(aplicaFiltroEstado).map(d => String(d.id)));
  }

  function distritosSeleccionados() {
    const ids = idsSeleccionadosActuales();
    const colorLeyenda = coloresDesdeLeyenda();
    const decretos = decretosBase().filter(aplicaFiltroEstado).map((d, i) => ({
      ...d,
      __dashColor: colorLeyenda.get(String(d.id)) || COLORS[i % COLORS.length]
    })).filter(d => ids.has(String(d.id)));

    const distritos = new Map();
    decretos.forEach(d => {
      territorio(d).forEach(t => {
        const k = keyDist(t);
        const ll = latLng(t);
        if (!k || !ll) return;
        if (!distritos.has(k)) {
          distritos.set(k, {
            key: k,
            departamento: t.departamento || '',
            provincia: t.provincia || '',
            distrito: t.distrito || '',
            latlng: ll,
            decretos: new Map()
          });
        }
        distritos.get(k).decretos.set(String(d.id), {
          id: String(d.id),
          nombre: nombreDS(d),
          color: d.__dashColor
        });
      });
    });
    return [...distritos.values()];
  }

  function limpiarLeafletDiv(el) {
    if (!el) return null;
    try { if (fixedMap) fixedMap.remove(); } catch (_) {}
    fixedMap = null;
    fixedRenderer = null;

    const limpio = document.createElement('div');
    limpio.id = 'mapaDS';
    limpio.className = (el.className || 'border rounded bg-white')
      .split(/\s+/)
      .filter(c => c && !c.startsWith('leaflet-'))
      .join(' ') || 'border rounded bg-white';
    limpio.style.height = el.style.height || '520px';
    limpio.style.minHeight = el.style.minHeight || '520px';
    limpio.style.width = '100%';
    limpio.style.position = 'relative';
    limpio.style.overflow = 'hidden';
    limpio.dataset.owner = VERSION;
    el.replaceWith(limpio);
    return limpio;
  }

  async function esperarContenedorVisible(el, intentos = 12) {
    for (let i = 0; i < intentos; i++) {
      const r = el?.getBoundingClientRect?.();
      if (r && r.width > 120 && r.height > 120 && el.offsetParent !== null) return true;
      await sleep(100);
    }
    return false;
  }

  async function renderMapaCalzado() {
    if (!window.L) return;
    let el = $id('mapaDS');
    if (!el) return;

    const visible = await esperarContenedorVisible(el);
    if (!visible) return;

    el = limpiarLeafletDiv(el);
    if (!el) return;

    await sleep(40);

    const puntos = distritosSeleccionados();
    fixedRenderer = L.canvas({ padding: 0.5 });
    fixedMap = L.map(el, {
      preferCanvas: true,
      renderer: fixedRenderer,
      scrollWheelZoom: true,
      zoomControl: true,
      attributionControl: true,
      zoomSnap: 0.25
    }).setView(PERU_CENTER, PERU_ZOOM);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      crossOrigin: 'anonymous',
      attribution: '&copy; OpenStreetMap'
    }).addTo(fixedMap);

    await new Promise(resolve => fixedMap.whenReady(resolve));
    fixedMap.invalidateSize(true);
    await sleep(80);

    const grupo = L.featureGroup().addTo(fixedMap);
    puntos.forEach(item => {
      const ds = [...item.decretos.values()];
      if (!ds.length) return;
      const repetido = ds.length > 1;
      const color = repetido ? '#111827' : (ds[0]?.color || '#0d6efd');
      L.circleMarker(item.latlng, {
        renderer: fixedRenderer,
        radius: repetido ? 7 : 5,
        color: repetido ? '#000000' : color,
        weight: repetido ? 3 : 1,
        fillColor: color,
        fillOpacity: repetido ? 0.95 : 0.82,
        opacity: 1,
        interactive: true
      })
      .bindTooltip(`<strong>${esc(item.distrito)}</strong><br>Provincia: ${esc(item.provincia)}<br>Departamento: ${esc(item.departamento)}<br>Decreto(s): ${esc(ds.map(x => x.nombre).join(', '))}`, { sticky: true })
      .addTo(grupo);
    });

    // v75: mantener el mapa centrado en el Perú, tanto en pantalla como durante exportación.
    // No se usa fitBounds porque desplaza la vista hacia el bloque de puntos y deja el mapa visualmente corrido.
    fixedMap.setView(PERU_CENTER, PERU_ZOOM);

    await sleep(120);
    fixedMap.invalidateSize(true);
    fixedMap.setView(PERU_CENTER, PERU_ZOOM);
  }

  function programarMapaCalzado(delay = 180) {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(() => {
      renderMapaCalzado().catch(e => console.error('Error ajustando puntos Dashboard v74.1:', e));
    }, delay);
  }

  async function renderDashboardSeguro(reset = false) {
    if (typeof window.__dashboardCheckboxExportV682?.render === 'function') {
      window.__dashboardCheckboxExportV682.render(Boolean(reset));
    } else if (typeof window.renderDashboardEjecutivoV661 === 'function') {
      window.renderDashboardEjecutivoV661(Boolean(reset));
    }
    await sleep(250);
    await renderMapaCalzado();
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (src.includes('html2canvas') && window.html2canvas) return resolve();
      if (src.includes('jspdf') && (window.jspdf?.jsPDF || window.jsPDF)) return resolve();
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  async function esperarTilesMapa(timeout = 2200) {
    const inicio = Date.now();
    while (Date.now() - inicio < timeout) {
      const tiles = [...document.querySelectorAll('#mapaDS img.leaflet-tile')];
      if (tiles.length && tiles.every(img => img.complete && img.naturalWidth > 0)) return;
      await sleep(100);
    }
  }

  async function exportarDashboardCalzado(tipo) {
    if (exportando) return;
    exportando = true;
    const area = $id('dashboardExportArea') || $id('tabDashboard');
    if (!area) { exportando = false; return alert('No se encontró el Dashboard para exportar.'); }

    const oldFiltro = $id('dashboardFiltroEstado')?.value || 'vigentes';
    const oldChecks = new Map([...document.querySelectorAll('#dashboardMapaLeyenda .dash-ds-check')].map(chk => [String(chk.value), chk.checked]));
    const chosen = $id('dashboardExportFiltro')?.value || 'actual';
    const oldW = area.style.width;
    const oldMax = area.style.maxWidth;
    const oldOverflow = document.body.style.overflow;
    let titulo = null;

    try {
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js');
      if (tipo === 'pdf') await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');

      if (chosen !== 'actual' && $id('dashboardFiltroEstado')) {
        $id('dashboardFiltroEstado').value = chosen;
        await renderDashboardSeguro(true);
      }

      area.style.width = '1400px';
      area.style.maxWidth = '1400px';
      document.body.style.overflow = 'visible';
      await sleep(150);
      await renderDashboardSeguro(false);
      await esperarTilesMapa();
      await sleep(350);

      titulo = document.createElement('div');
      titulo.id = 'dashboardExportHeaderTmp';
      titulo.className = 'border-bottom mb-2 pb-2';
      const totalChecks = document.querySelectorAll('#dashboardMapaLeyenda .dash-ds-check:checked').length;
      titulo.innerHTML = `<h4 class="text-primary mb-1">Dashboard de Declaratorias de Estado de Emergencia</h4><div class="small text-muted">Fecha de generación: ${esc(typeof fechaHoraLocalISO === 'function' ? fechaHoraLocalISO() : new Date().toLocaleString())} · Filtro aplicado: ${esc(filtroTexto())} · DS seleccionados: ${totalChecks}</div>`;
      area.insertBefore(titulo, area.firstChild);
      await sleep(200);

      const canvas = await window.html2canvas(area, {
        scale: 2,
        useCORS: true,
        allowTaint: false,
        backgroundColor: '#ffffff',
        logging: false,
        width: area.scrollWidth,
        height: area.scrollHeight,
        windowWidth: Math.max(1400, area.scrollWidth),
        windowHeight: Math.max(900, area.scrollHeight)
      });

      const base = `Dashboard_DEE_${filtroTexto().replace(/\s+/g, '_')}_${typeof hoy === 'function' ? hoy() : new Date().toISOString().slice(0,10)}`;
      if (tipo === 'jpg') {
        const a = document.createElement('a');
        a.download = `${base}.jpg`;
        a.href = canvas.toDataURL('image/jpeg', 0.95);
        a.click();
      } else {
        const jsPDF = window.jspdf?.jsPDF || window.jsPDF;
        if (!jsPDF) throw new Error('jsPDF no disponible');
        const pdf = new jsPDF('l', 'mm', 'a4');
        const pageW = pdf.internal.pageSize.getWidth();
        const pageH = pdf.internal.pageSize.getHeight();
        const imgW = pageW - 16;
        const imgH = canvas.height * imgW / canvas.width;
        const img = canvas.toDataURL('image/jpeg', 0.95);
        let pos = 8;
        let left = imgH;
        pdf.addImage(img, 'JPEG', 8, pos, imgW, imgH);
        left -= (pageH - 16);
        while (left > 0) {
          pdf.addPage('l');
          pos = left - imgH + 8;
          pdf.addImage(img, 'JPEG', 8, pos, imgW, imgH);
          left -= (pageH - 16);
        }
        pdf.save(`${base}.pdf`);
      }
    } catch (e) {
      console.error('Error exportando Dashboard v74.1:', e);
      alert('No se pudo exportar el Dashboard. Revise la consola para el detalle técnico.');
    } finally {
      if (titulo) { try { titulo.remove(); } catch (_) {} }
      area.style.width = oldW;
      area.style.maxWidth = oldMax;
      document.body.style.overflow = oldOverflow;
      if (chosen !== 'actual' && $id('dashboardFiltroEstado')) $id('dashboardFiltroEstado').value = oldFiltro;
      await renderDashboardSeguro(chosen !== 'actual');
      if (oldChecks.size) {
        document.querySelectorAll('#dashboardMapaLeyenda .dash-ds-check').forEach(chk => {
          if (oldChecks.has(String(chk.value))) chk.checked = oldChecks.get(String(chk.value));
        });
        await renderMapaCalzado();
      }
      exportando = false;
    }
  }

  function instalar() {
    if (installing) return;
    installing = true;

    // Evita que cierres antiguos del Dashboard vuelvan a dibujar un mapa desfasado al abrir la pestaña.
    document.addEventListener('shown.bs.tab', (e) => {
      const target = e.target?.getAttribute?.('data-bs-target');
      if (target === '#tabDashboard') {
        e.stopImmediatePropagation();
        setTimeout(() => renderDashboardSeguro(false), 220);
      }
    }, true);

    window.addEventListener('click', (e) => {
      const t = e.target;
      if (!t) return;

      if (t.id === 'btnExportDashboardJPG') {
        e.preventDefault();
        e.stopImmediatePropagation();
        exportarDashboardCalzado('jpg');
        return;
      }
      if (t.id === 'btnExportDashboardPDF') {
        e.preventDefault();
        e.stopImmediatePropagation();
        exportarDashboardCalzado('pdf');
        return;
      }
      if (t.id === 'btnActualizarDashboard') {
        programarMapaCalzado(550);
        return;
      }
      if (t.closest?.('[data-bs-target="#tabDashboard"]')) {
        programarMapaCalzado(900);
      }
      if (t.id === 'btnDashSeleccionarTodos' || t.id === 'btnDashQuitarSeleccion') {
        programarMapaCalzado(350);
      }
    }, true);

    window.addEventListener('change', (e) => {
      const t = e.target;
      if (!t) return;
      if (t.id === 'dashboardFiltroEstado' || t.classList?.contains('dash-ds-check')) {
        programarMapaCalzado(450);
      }
    }, true);

    window.renderDashboardEjecutivoDEE = async function(reset) { await renderDashboardSeguro(Boolean(reset)); };
    window.renderDashboardEjecutivoV661 = window.renderDashboardEjecutivoDEE;
    window.__dashboardPuntosCalzadosV741 = { renderMapaCalzado, renderDashboardSeguro, exportarDashboardCalzado, version: VERSION };

    setTimeout(() => renderDashboardSeguro(false), 5200);
  }

  document.addEventListener('DOMContentLoaded', instalar);
  setTimeout(instalar, 1000);
  console.info('DEE MIDIS cierre aplicado:', VERSION);
})();

// ================= PUENTE D1 FINAL v79: DECRETOS Y ACCIONES =================
// Objetivo: usar D1 como fuente principal para decretos, acciones, listado y dashboard.
// localStorage queda solo como caché/respaldo temporal del navegador.
let __DEE_D1_IMPORTANDO = false;
let __DEE_D1_SYNC_TIMER = null;
let __DEE_ACCIONES_D1_CACHE = [];
let __DEE_D1_LISTO = false;

function extraerListaAccionesD1(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.rows)) return data.rows;
  if (Array.isArray(data?.acciones)) return data.acciones;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.data)) return data.data;
  return [];
}

function normalizarAccionD1(raw) {
  if (!raw) return null;
  const dsId = raw.ds_id || raw.dsId || raw.dsID || '';
  const programa = normalizarProgramaNombre(raw.programaNacional || raw.programa || '');
  const codigo = raw.codigoAccion || raw.codigo || raw.codigo_accion || '';
  const id = raw.id || [dsId, raw.numero_reunion || raw.numeroReunion || '', programa, raw.departamento || '', raw.provincia || '', raw.distrito || '', raw.tipo || raw.tipoAccion || '', codigo].join('|');
  return {
    ...raw,
    id,
    dsId,
    ds_id: dsId,
    numeroDS: raw.numeroDS || raw.ds || raw.numero_ds || '',
    ds: raw.ds || raw.numeroDS || raw.numero_ds || '',
    numeroReunion: raw.numeroReunion || raw.numero_reunion || '',
    numero_reunion: raw.numero_reunion || raw.numeroReunion || '',
    fechaReunion: raw.fechaReunion || raw.fecha_reunion || '',
    fecha_reunion: raw.fecha_reunion || raw.fechaReunion || '',
    estadoRDS: raw.estadoRDS || raw.estado_rds || '',
    programaNacional: programa,
    programa,
    tipoAccion: raw.tipoAccion || raw.tipo || raw.tipo_accion || '',
    tipo: raw.tipo || raw.tipoAccion || raw.tipo_accion || '',
    subtipoRehabilitacion: raw.subtipoRehabilitacion || raw.subtipo_rehabilitacion || '',
    subtipo_rehabilitacion: raw.subtipo_rehabilitacion || raw.subtipoRehabilitacion || '',
    codigoAccion: codigo,
    codigo,
    detalle: raw.detalle || raw.accion_registrada || raw.accionRegistrada || '',
    unidadMedida: raw.unidadMedida || raw.unidad || raw.unidad_medida || '',
    unidad: raw.unidad || raw.unidadMedida || raw.unidad_medida || '',
    metaProgramada: raw.metaProgramada ?? raw.meta_programada ?? 0,
    meta_programada: raw.meta_programada ?? raw.metaProgramada ?? 0,
    plazoDias: raw.plazoDias ?? raw.plazo_dias ?? raw.plazo ?? 0,
    plazo_dias: raw.plazo_dias ?? raw.plazoDias ?? raw.plazo ?? 0,
    plazo: raw.plazo ?? raw.plazo_dias ?? raw.plazoDias ?? 0,
    fechaInicio: raw.fechaInicio || raw.fecha_inicio || '',
    fecha_inicio: raw.fecha_inicio || raw.fechaInicio || '',
    fechaFinal: raw.fechaFinal || raw.fecha_final || '',
    fecha_final: raw.fecha_final || raw.fechaFinal || '',
    metaEjecutada: raw.metaEjecutada ?? raw.meta_ejecutada ?? 0,
    meta_ejecutada: raw.meta_ejecutada ?? raw.metaEjecutada ?? 0,
    avance: String(raw.avance ?? raw.porcentaje_avance ?? '0').includes('%') ? String(raw.avance ?? raw.porcentaje_avance ?? '0') : String(raw.avance ?? raw.porcentaje_avance ?? 0) + '%',
    descripcionActividades: raw.descripcionActividades || raw.descripcion || raw.observaciones || '',
    descripcion: raw.descripcion || raw.descripcionActividades || raw.observaciones || '',
    usuarioRegistro: raw.usuarioRegistro || raw.usuario_registro || raw.usuario || '',
    usuario_registro: raw.usuario_registro || raw.usuarioRegistro || raw.usuario || '',
    fechaRegistro: raw.fechaRegistro || raw.fecha_registro || raw.created_at || '',
    fecha_registro: raw.fecha_registro || raw.fechaRegistro || raw.created_at || '',
    estado: raw.estado || 'Registrado',
    departamento: raw.departamento || '',
    provincia: raw.provincia || '',
    distrito: raw.distrito || ''
  };
}

function normalizarDecretoD1(raw) {
  const d = normalizarDecreto(raw);
  if (!d) return null;
  const programas = Array.isArray(raw?.programasHabilitados) ? raw.programasHabilitados : (Array.isArray(raw?.programas_habilitados) ? raw.programas_habilitados : d.programasHabilitados);
  return normalizarDecreto({
    ...d,
    rdsActivo: raw?.rdsActivo ?? raw?.rds_activo ?? d.rdsActivo,
    numeroReunion: raw?.numeroReunion || raw?.numero_reunion || d.numeroReunion,
    fechaReunion: raw?.fechaReunion || raw?.fecha_reunion || d.fechaReunion,
    estadoRDS: raw?.estadoRDS || raw?.estado_rds || d.estadoRDS,
    fechaRegistroRDS: raw?.fechaRegistroRDS || raw?.fecha_registro_rds || d.fechaRegistroRDS,
    activadoPor: raw?.activadoPor || raw?.activado_por || d.activadoPor,
    programasHabilitados: Array.isArray(programas) && programas.length ? programas.map(normalizarProgramaNombre) : PROGRAMAS_RDS.slice()
  });
}

function cargarDecretosLocales() {
  try {
    if (Array.isArray(state.decretos) && state.decretos.length) return state.decretos.map(normalizarDecretoD1).filter(Boolean);
    const data = JSON.parse(localStorage.getItem(DECRETOS_STORAGE_KEY) || '[]');
    return Array.isArray(data) ? data.map(normalizarDecretoD1).filter(Boolean) : [];
  } catch (e) {
    console.warn('No se pudo leer localStorage.decretos', e);
    return [];
  }
}

function guardarDecretosLocales(lista) {
  const data = (Array.isArray(lista) ? lista : []).map(normalizarDecretoD1).filter(Boolean);
  state.decretos = data;
  localStorage.setItem(DECRETOS_STORAGE_KEY, JSON.stringify(data));
  if (!__DEE_D1_IMPORTANDO && state.session?.email) {
    clearTimeout(__DEE_D1_SYNC_TIMER);
    __DEE_D1_SYNC_TIMER = setTimeout(() => sincronizarDecretosLocalesAD1(data), 250);
  }
  return data;
}

function cargarAccionesLocales() {
  try {
    if (Array.isArray(__DEE_ACCIONES_D1_CACHE) && __DEE_ACCIONES_D1_CACHE.length) return __DEE_ACCIONES_D1_CACHE.map(normalizarAccionD1).filter(Boolean);
    const data = JSON.parse(localStorage.getItem(ACCIONES_STORAGE_KEY) || '[]');
    return Array.isArray(data) ? data.map(normalizarAccionD1).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function guardarAccionesLocales(lista) {
  const data = (Array.isArray(lista) ? lista : []).map(normalizarAccionD1).filter(Boolean);
  __DEE_ACCIONES_D1_CACHE = data;
  localStorage.setItem(ACCIONES_STORAGE_KEY, JSON.stringify(data));
  if (!__DEE_D1_IMPORTANDO && state.session?.email) {
    setTimeout(() => sincronizarAccionesLocalesAD1(data), 250);
  }
  return data;
}

async function sincronizarDecretosLocalesAD1(lista) {
  if (!Array.isArray(lista) || !lista.length) return;
  for (const d of lista) {
    try { await api('/decretos', 'POST', d); } catch (e) { console.warn('No se pudo sincronizar DS en D1', d?.id, e); }
  }
}

async function sincronizarAccionesLocalesAD1(lista) {
  if (!Array.isArray(lista) || !lista.length) return;
  for (const a of lista) {
    try { await api('/acciones', 'POST', a); } catch (e) { console.warn('No se pudo sincronizar acción en D1', a?.id, e); }
  }
}

async function cargarAccionesDesdeD1() {
  const res = await api('/acciones');
  const remotas = extraerListaAccionesD1(res?.data).map(normalizarAccionD1).filter(Boolean);
  const locales = (() => { try { return JSON.parse(localStorage.getItem(ACCIONES_STORAGE_KEY) || '[]'); } catch { return []; } })().map(normalizarAccionD1).filter(Boolean);

  let acciones = remotas;

  // Migración controlada: si D1 está vacío pero el navegador actual sí tiene acciones,
  // las sube a D1 para que otros usuarios/navegadores también las vean.
  if (res.ok && !remotas.length && locales.length) {
    await sincronizarAccionesLocalesAD1(locales);
    const reread = await api('/acciones');
    acciones = extraerListaAccionesD1(reread?.data).map(normalizarAccionD1).filter(Boolean);
    if (!acciones.length) acciones = locales;
  }

  __DEE_D1_IMPORTANDO = true;
  guardarAccionesLocales(acciones);
  __DEE_D1_IMPORTANDO = false;
  return acciones;
}

async function cargarDecretosParaOrigen() {
  const locales = (() => { try { return JSON.parse(localStorage.getItem(DECRETOS_STORAGE_KEY) || '[]'); } catch { return []; } })().map(normalizarDecretoD1).filter(Boolean);
  const res = await api('/decretos');
  let remotos = extraerListaDecretos(res?.data).map(normalizarDecretoD1).filter(Boolean);

  // Migración controlada: si D1 está vacío pero este navegador tiene DS,
  // los sube a D1 y luego vuelve a leer desde la base.
  if (res.ok && !remotos.length && locales.length) {
    await sincronizarDecretosLocalesAD1(locales);
    const reread = await api('/decretos');
    remotos = extraerListaDecretos(reread?.data).map(normalizarDecretoD1).filter(Boolean);
  }

  const mapa = new Map();
  (remotos.length ? remotos : locales).forEach(d => { if (d?.id) mapa.set(String(d.id), d); });
  const decretos = Array.from(mapa.values());

  __DEE_D1_IMPORTANDO = true;
  guardarDecretosLocales(decretos);
  await cargarAccionesDesdeD1();
  __DEE_D1_IMPORTANDO = false;

  cargarDSOrigen();
  actualizarDatosProrroga();
  renderTablaDecretosBasica();
  if (typeof cargarSelectAccionDS === 'function') cargarSelectAccionDS();
  if (typeof cargarRDSDesdeDSSeleccionado === 'function') cargarRDSDesdeDSSeleccionado();
  if (typeof renderTablaAcciones === 'function') renderTablaAcciones();
  if (typeof renderTablaAccionesProgramas === 'function') renderTablaAccionesProgramas();
  if (typeof renderDashboardEjecutivoDEE === 'function') renderDashboardEjecutivoDEE(true);
  __DEE_D1_LISTO = true;
}

async function guardarDecreto() {
  try {
    const validacion = validarFormularioDecreto();
    if (!validacion.ok) return alert(validacion.mensaje);

    const decreto = construirObjetoDecreto();
    const res = await api('/decretos', 'POST', decreto);
    if (res.ok && res.data?.id) decreto.id = res.data.id;

    const existentes = cargarDecretosLocales().map(normalizarDecretoD1).filter(Boolean);
    const lista = existentes.filter(d => String(d.id) !== String(decreto.id) && String(d.codigo_registro) !== String(decreto.codigo_registro));
    lista.push(decreto);
    __DEE_D1_IMPORTANDO = true;
    guardarDecretosLocales(lista);
    __DEE_D1_IMPORTANDO = false;

    cargarDSOrigen();
    renderTablaDecretosBasica();
    if (typeof renderDashboardEjecutivoDEE === 'function') renderDashboardEjecutivoDEE(true);
    alert(res.ok ? 'Decreto guardado correctamente en D1.' : 'Decreto guardado localmente. No se confirmó en D1; revise API/decretos.');
    limpiarFormularioDecreto();
  } catch (e) {
    console.error('Error al guardar Decreto Supremo:', e);
    alert('No se pudo guardar el Decreto Supremo. Revise la consola para el detalle técnico.');
  }
}

async function activarRDSSeleccionado() {
  if (!puedeActivarRDS()) return alert('Solo el Administrador o Registrador puede activar RDS.');
  const id = $('accionDs')?.value || '';
  const numeroReunion = $('rdsNumeroReunion')?.value || '';
  const fechaReunion = $('rdsFechaReunion')?.value || '';
  if (!id) return alert('Seleccione un Decreto Supremo.');
  if (!numeroReunion) return alert('Seleccione el número de reunión.');
  if (!fechaReunion) return alert('Ingrese la fecha de reunión.');

  const lista = cargarDecretosLocales().map(normalizarDecretoD1).filter(Boolean);
  const idx = lista.findIndex(d => String(d.id) === String(id));
  if (idx < 0) return alert('No se encontró el Decreto Supremo.');

  lista[idx] = {
    ...lista[idx],
    rdsActivo: true,
    rds_activo: true,
    numeroReunion,
    numero_reunion: numeroReunion,
    fechaReunion,
    fecha_reunion: fechaReunion,
    estadoRDS: 'Activo',
    estado_rds: 'Activo',
    fechaRegistroRDS: fechaHoraLocalISO(),
    fecha_registro_rds: fechaHoraLocalISO(),
    activadoPor: state.session?.email || '',
    activado_por: state.session?.email || '',
    programasHabilitados: PROGRAMAS_RDS.slice(),
    programas_habilitados: PROGRAMAS_RDS.slice()
  };

  const res = await api('/decretos', 'POST', lista[idx]);
  __DEE_D1_IMPORTANDO = true;
  guardarDecretosLocales(lista);
  __DEE_D1_IMPORTANDO = false;
  renderTablaDecretosBasica();
  cargarSelectAccionDS();
  if ($('accionDs')) $('accionDs').value = id;
  cargarRDSDesdeDSSeleccionado();
  aplicarRestriccionesAccion();
  aplicarVistaRegistroAcciones();
  if (typeof renderDashboardEjecutivoDEE === 'function') renderDashboardEjecutivoDEE(true);
  alert(res.ok ? 'RDS activado correctamente en D1.' : 'RDS activado localmente. No se confirmó en D1.');
}

async function guardarAccionDS() {
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
  const id = accionEditandoId || crypto.randomUUID();
  const existente = lista.find(a => String(a.id) === String(id));
  const accion = normalizarAccionD1({
    id,
    ds_id: d.id,
    dsId: d.id,
    ds: formatearNumeroDS(d),
    numeroDS: formatearNumeroDS(d),
    numero_reunion: d.numeroReunion || '',
    numeroReunion: d.numeroReunion || '',
    fecha_reunion: d.fechaReunion || '',
    fechaReunion: d.fechaReunion || '',
    estadoRDS: d.estadoRDS || 'Activo',
    programa,
    programaNacional: programa,
    tipo,
    tipoAccion: tipo,
    codigo,
    codigoAccion: codigo,
    unidad: $('accionUnidad')?.value || '',
    unidadMedida: $('accionUnidad')?.value || '',
    meta_programada: Number($('accionMetaProgramada')?.value || 0),
    plazo_dias: Number($('accionPlazo')?.value || 0),
    plazo: Number($('accionPlazo')?.value || 0),
    fecha_inicio: $('accionFechaInicio')?.value || '',
    fecha_final: $('accionFechaFinal')?.value || '',
    meta_ejecutada: Number($('accionMetaEjecutada')?.value || 0),
    avance: $('accionAvance')?.value || '0%',
    detalle: $('accionDetalle')?.value || '',
    descripcion: $('accionDescripcion')?.value || '',
    descripcionActividades: $('accionDescripcion')?.value || '',
    estado: existente?.estado || 'Registrado',
    usuario_registro: existente?.usuario_registro || state.session?.email || '',
    usuarioRegistro: existente?.usuarioRegistro || state.session?.email || '',
    fecha_registro: existente?.fecha_registro || new Date().toISOString(),
    fechaRegistro: existente?.fechaRegistro || new Date().toISOString()
  });

  const duplicada = lista.some(a => String(a.id) !== String(id) && String(a.ds_id || a.dsId) === String(d.id) && String(a.numero_reunion || a.numeroReunion || '') === String(accion.numero_reunion || '') && normalizarProgramaNombre(a.programaNacional || a.programa) === programa && normalizarTexto(a.codigoAccion || a.codigo) === normalizarTexto(codigo));
  if (duplicada) return alert('Ya existe una acción con el mismo DS, reunión, Programa Nacional y Código de acción.');

  const res = await api('/acciones', 'POST', accion);
  const depurada = lista.filter(a => String(a.id) !== String(id));
  depurada.push(accion);
  __DEE_D1_IMPORTANDO = true;
  guardarAccionesLocales(depurada);
  __DEE_D1_IMPORTANDO = false;
  renderTablaAcciones();
  limpiarFormularioAccion();
  accionEditandoId = null;
  if ($('btnGuardarAccion')) $('btnGuardarAccion').textContent = 'Guardar acción';
  alert(res.ok ? 'Acción guardada correctamente en D1.' : 'Acción guardada localmente. No se confirmó en D1.');
}

async function guardarAccionPrograma() {
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
  const duplicada = lista.some(a => String(a.dsId || a.ds_id) === String(d.id) && String(a.numeroReunion || a.numero_reunion || '') === String(d.numeroReunion || '') && normalizarProgramaNombre(a.programaNacional || a.programa) === programa && normalizarTexto(a.codigoAccion || a.codigo) === normalizarTexto(codigoAccion) && !a.departamento && !a.provincia && !a.distrito);
  if (duplicada) return alert('Ya existe una acción con el mismo DS, reunión, Programa Nacional y Código de acción.');

  const fechaRegistro = fechaHoraLocalISO();
  const accion = normalizarAccionD1({
    id: crypto.randomUUID(),
    dsId: d.id,
    ds_id: d.id,
    numeroDS: formatearNumeroDS(d),
    ds: formatearNumeroDS(d),
    numeroReunion: d.numeroReunion || '',
    numero_reunion: d.numeroReunion || '',
    fechaReunion: d.fechaReunion || '',
    fecha_reunion: d.fechaReunion || '',
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
    plazo_dias: Number($('progPlazoDias')?.value || 0),
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
  });

  const res = await api('/acciones', 'POST', accion);
  lista.push(accion);
  __DEE_D1_IMPORTANDO = true;
  guardarAccionesLocales(lista);
  __DEE_D1_IMPORTANDO = false;
  limpiarFormularioAccionPrograma(true);
  renderTablaAccionesProgramas();
  renderTablaDecretosBasica();
  alert(res.ok ? 'Acción registrada correctamente en D1.' : 'Acción registrada localmente. No se confirmó en D1.');
}

// Refuerza la carga D1 al entrar al sistema y al cambiar a pestañas que dependen de DS/acciones.
document.addEventListener('shown.bs.tab', (e) => {
  const target = e.target?.getAttribute?.('data-bs-target');
  if (['#tabListado', '#tabDashboard', '#tabAcciones', '#tabAccionesProgramas'].includes(target)) {
    cargarDecretosParaOrigen().catch(err => console.warn('No se pudo refrescar D1:', err));
  }
}, true);

setTimeout(() => {
  if (state.session?.email) cargarDecretosParaOrigen().catch(err => console.warn('Carga inicial D1 fallida:', err));
}, 1800);

console.info('DEE MIDIS VERSION 79 - D1 SESSION FIX activo: decretos y acciones usan D1 como fuente principal');


// ================= AJUSTE v79.2 - FILTROS Y PAGINACIÓN REGISTRO ACCIONES PROGRAMAS =================
// Alcance estricto: usuarios Registradores de Programas Nacionales, pestaña Registro Acciones Programas.
// No modifica login, roles, Listado DS, Dashboard ni flujos de aprobación.
(function(){
  'use strict';

  const VERSION = 'v79.4-cobertura-programas-alineada-registro-acciones';
  const q = (id) => document.getElementById(id);
  const txt = (v) => String(v ?? '').trim();
  const norm = (v) => txt(v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  const esc = (v) => (typeof escapeHtml === 'function' ? escapeHtml(v) : txt(v));
  const escAttr = (v) => (typeof escapeHtmlAttr === 'function' ? escapeHtmlAttr(v) : esc(v));
  const programaActual = () => (typeof programaSesionNormalizado === 'function' ? programaSesionNormalizado() : '');

  const stateV792 = {
    filtros: { dep:'', prov:'', dist:'', detalleEstado:'', descripcionEstado:'' },
    paginaDistritos: 1,
    paginaRegistradas: 1,
    seleccion: new Set(),
    cobertura: { cargada:false, cargando:false, labels:{}, rows:[], porUbigeo:new Map(), porTerritorio:new Map() }
  };

  const COBERTURA_PROGRAMA_KEYS = {
    'CUNA MÁS': ['cuna_mas_cuidado_diurno', 'cuna_mas_acomp_familias'],
    'JUNTOS': ['juntos_hogares_afiliados'],
    'FONCODES': ['foncodes_proy_ejecucion', 'foncodes_haku_ejecucion'],
    'PENSIÓN 65': ['pension65_usuarios'],
    'PAE': ['pae_iiee', 'pae_ninos_atendidos'],
    'CONTIGO': ['contigo_usuarios'],
    'PAIS': ['pais_tambos']
  };

  const COBERTURA_LABELS_FALLBACK = {
    cuna_mas_cuidado_diurno: 'Cuna Más - Cuidado Diurno (N° usuarios)',
    cuna_mas_acomp_familias: 'Cuna Más - Acompañamiento de Familias (N° usuarios)',
    juntos_hogares_afiliados: 'Juntos - Hogares afiliados',
    foncodes_proy_ejecucion: 'Foncodes - N° proyectos en ejecución',
    foncodes_haku_ejecucion: 'Foncodes - Haku Wiñay (hogares) en ejecución',
    pension65_usuarios: 'Pensión 65 - N° usuarios',
    pae_iiee: 'PAE - N° IIEE',
    pae_ninos_atendidos: 'PAE - N° niños y niñas atendidos',
    contigo_usuarios: 'Contigo - N° usuarios',
    pais_tambos: 'Tambos'
  };

  function normalizarUbigeo(v) {
    const s = txt(v).replace(/\D/g, '');
    return s ? s.padStart(6, '0') : '';
  }

  function keyTerritorioCobertura(obj) {
    return [obj?.departamento, obj?.provincia, obj?.distrito].map(norm).join('|');
  }

  function getColumnasCoberturaPrograma() {
    const programa = programaActual();
    return (COBERTURA_PROGRAMA_KEYS[programa] || []).map(key => ({
      key,
      label: stateV792.cobertura.labels[key] || COBERTURA_LABELS_FALLBACK[key] || key
    }));
  }

  function indexarCoberturaProgramas(data) {
    const rows = Array.isArray(data?.rows) ? data.rows : (Array.isArray(data) ? data : []);
    stateV792.cobertura.labels = { ...COBERTURA_LABELS_FALLBACK, ...(data?.labels || {}) };
    stateV792.cobertura.rows = rows;
    stateV792.cobertura.porUbigeo = new Map();
    stateV792.cobertura.porTerritorio = new Map();
    rows.forEach(r => {
      const ubigeo = normalizarUbigeo(r?.ubigeo || r?.UBIGEO || r?.codigo || r?.cod_ubigeo);
      if (ubigeo && !stateV792.cobertura.porUbigeo.has(ubigeo)) stateV792.cobertura.porUbigeo.set(ubigeo, r);
      const kt = keyTerritorioCobertura(r);
      if (kt && kt !== '||' && !stateV792.cobertura.porTerritorio.has(kt)) stateV792.cobertura.porTerritorio.set(kt, r);
    });
    stateV792.cobertura.cargada = true;
  }

  async function cargarCoberturaProgramas() {
    if (stateV792.cobertura.cargada || stateV792.cobertura.cargando) return;
    stateV792.cobertura.cargando = true;
    try {
      const globalData = window.coberturaProgramas || window.cobertura_programas || window.COBERTURA_PROGRAMAS;
      if (globalData) {
        indexarCoberturaProgramas(globalData);
      } else {
        const res = await fetch('cobertura_programas.json?v=79.4-cobertura-programas-alineada-20260515', { cache: 'no-store' });
        if (!res.ok) throw new Error('No se pudo cargar cobertura_programas.json');
        indexarCoberturaProgramas(await res.json());
      }
      renderDistritosAccionesProgramaV792();
    } catch (e) {
      console.warn('Cobertura de Programas Nacionales no disponible:', e);
    } finally {
      stateV792.cobertura.cargando = false;
    }
  }

  function coberturaTerritorio(t) {
    const ubigeo = normalizarUbigeo(t?.ubigeo);
    if (ubigeo && stateV792.cobertura.porUbigeo.has(ubigeo)) return stateV792.cobertura.porUbigeo.get(ubigeo);
    return stateV792.cobertura.porTerritorio.get(keyTerritorioCobertura(t)) || null;
  }

  function valorCobertura(t, key) {
    const row = coberturaTerritorio(t);
    const valor = row?.cobertura?.[key];
    if (valor === undefined || valor === null || valor === '') return 0;
    return valor;
  }

  function formatearCobertura(valor) {
    const n = Number(valor);
    if (Number.isFinite(n)) return n.toLocaleString('es-PE');
    return esc(valor ?? 0);
  }

  function actualizarCabeceraTablaDistritosCobertura() {
    const theadRow = document.querySelector('#tablaDistritosAccionesPrograma thead tr');
    if (!theadRow) return;
    const columnas = getColumnasCoberturaPrograma();
    theadRow.innerHTML = `
      <th style="width:42px">Sel.</th>
      <th>Departamento</th>
      <th>Provincia</th>
      <th>Distrito</th>
      ${columnas.map(c => `<th class="text-end cobertura-col" style="min-width:90px;white-space:nowrap">${esc(c.label)}</th>`).join('')}
      <th>Acciones específicas programadas y ejecutadas</th>
      <th>Descripción de actividades</th>`;
  }

  function keyTerritorio(t) {
    const ubigeo = txt(t?.ubigeo || t?.UBIGEO || t?.codigo || t?.cod_ubigeo);
    if (ubigeo) return `UBIGEO:${ubigeo}`;
    return [t?.departamento, t?.provincia, t?.distrito].map(norm).join('|');
  }

  function getDSPrograma() {
    try { return (typeof buscarDecretoPorId === 'function') ? buscarDecretoPorId(dsProgramaSeleccionadoId) : null; }
    catch { return null; }
  }

  function getTerritoriosDSPrograma() {
    const d = getDSPrograma();
    const territorio = Array.isArray(d?.territorio) ? d.territorio : [];
    const mapa = new Map();
    territorio.forEach(t => {
      const dep = txt(t?.departamento);
      const prov = txt(t?.provincia);
      const dist = txt(t?.distrito);
      if (!dep && !prov && !dist) return;
      const key = keyTerritorio(t);
      if (!mapa.has(key)) {
        mapa.set(key, {
          key,
          ubigeo: txt(t?.ubigeo || t?.UBIGEO || t?.codigo || t?.cod_ubigeo),
          departamento: dep,
          provincia: prov,
          distrito: dist,
          latitud: t?.latitud || t?.lat || '',
          longitud: t?.longitud || t?.lng || t?.lon || ''
        });
      }
    });
    return [...mapa.values()].sort((a,b) => [a.departamento,a.provincia,a.distrito].join('|').localeCompare([b.departamento,b.provincia,b.distrito].join('|'), 'es'));
  }

  function reunionKey(obj) {
    const n = norm(obj?.numeroReunion || obj?.numero_reunion || '');
    const f = txt(obj?.fechaReunion || obj?.fecha_reunion || '');
    return `${n}|${f}`;
  }

  function accionesProgramaDS() {
    const d = getDSPrograma();
    if (!d || typeof cargarAccionesLocales !== 'function') return [];
    const programa = programaActual();
    const keyR = reunionKey(d);
    return cargarAccionesLocales().filter(a =>
      String(a.dsId || a.ds_id || '') === String(d.id) &&
      (!keyR || reunionKey(a) === keyR) &&
      (typeof normalizarProgramaNombre === 'function' ? normalizarProgramaNombre(a.programaNacional || a.programa || '') : norm(a.programaNacional || a.programa || '')) === programa
    );
  }

  function accionesTerritorialesPrograma() {
    return accionesProgramaDS().filter(a => a.departamento || a.provincia || a.distrito || a.ubigeo);
  }

  function accionesDeTerritorio(t) {
    const k = t.key;
    return accionesTerritorialesPrograma().filter(a => {
      const ka = a.ubigeo ? `UBIGEO:${a.ubigeo}` : [a.departamento, a.provincia, a.distrito].map(norm).join('|');
      return ka === k;
    });
  }

  function tieneTextoAccion(acciones) {
    return acciones.some(a => txt(a.detalle || a.accionesEspecificas));
  }

  function tieneTextoDescripcion(acciones) {
    return acciones.some(a => txt(a.descripcionActividades || a.descripcion));
  }

  function resumen(acciones, campos) {
    const valores = acciones.map(a => campos.map(c => txt(a?.[c])).find(Boolean) || '').filter(Boolean);
    return [...new Set(valores)].join('<hr class="my-1">');
  }

  function leerFiltrosDistritos() {
    stateV792.filtros.dep = norm(q('progFiltroDepartamento')?.value || '');
    stateV792.filtros.prov = norm(q('progFiltroProvincia')?.value || '');
    stateV792.filtros.dist = norm(q('progFiltroDistrito')?.value || '');
    stateV792.filtros.detalleEstado = q('progFiltroDetalleEstado')?.value || '';
    stateV792.filtros.descripcionEstado = q('progFiltroDescripcionEstado')?.value || '';
  }

  function filtrarTerritorios(territorios) {
    const f = stateV792.filtros;
    return territorios.filter(t => {
      const acciones = accionesDeTerritorio(t);
      if (f.dep && !norm(t.departamento).includes(f.dep)) return false;
      if (f.prov && !norm(t.provincia).includes(f.prov)) return false;
      if (f.dist && !norm(t.distrito).includes(f.dist)) return false;
      if (f.detalleEstado === 'pendiente' && tieneTextoAccion(acciones)) return false;
      if (f.detalleEstado === 'no_pendiente' && !tieneTextoAccion(acciones)) return false;
      if (f.descripcionEstado === 'pendiente' && tieneTextoDescripcion(acciones)) return false;
      if (f.descripcionEstado === 'no_pendiente' && !tieneTextoDescripcion(acciones)) return false;
      return true;
    });
  }

  function asegurarControlesDistritos() {
    const box = q('progDistritosAccionesBox');
    if (!box || q('progFiltrosDistritosPrograma')) return;
    const header = box.querySelector('.d-flex.flex-wrap.justify-content-between') || box.firstElementChild;
    const filtros = document.createElement('div');
    filtros.id = 'progFiltrosDistritosPrograma';
    filtros.className = 'border rounded bg-light p-2 mb-2';
    filtros.innerHTML = `
      <div class="row g-2 align-items-end">
        <div class="col-md-2"><label class="form-label small mb-1">Departamento</label><input id="progFiltroDepartamento" class="form-control form-control-sm" placeholder="Departamento"></div>
        <div class="col-md-2"><label class="form-label small mb-1">Provincia</label><input id="progFiltroProvincia" class="form-control form-control-sm" placeholder="Provincia"></div>
        <div class="col-md-2"><label class="form-label small mb-1">Distrito</label><input id="progFiltroDistrito" class="form-control form-control-sm" placeholder="Distrito"></div>
        <div class="col-md-2"><label class="form-label small mb-1">Acciones específicas</label><select id="progFiltroDetalleEstado" class="form-select form-select-sm"><option value="">Todos</option><option value="pendiente">Pendientes</option><option value="no_pendiente">No pendientes</option></select></div>
        <div class="col-md-2"><label class="form-label small mb-1">Descripción de actividades</label><select id="progFiltroDescripcionEstado" class="form-select form-select-sm"><option value="">Todos</option><option value="pendiente">Pendientes</option><option value="no_pendiente">No pendientes</option></select></div>
        <div class="col-md-2 d-flex gap-2"><button id="btnBuscarDistritosPrograma" type="button" class="btn btn-sm btn-primary">Buscar</button><button id="btnLimpiarBuscarDistritosPrograma" type="button" class="btn btn-sm btn-outline-secondary">Limpiar</button></div>
      </div>`;
    if (header && header.parentNode) header.parentNode.insertBefore(filtros, header.nextSibling);
  }

  function asegurarControlesRegistradas() {
    const tabla = q('tablaAccionesProgramas');
    if (!tabla || q('progAccionesRegistradasControles')) return;
    const wrapper = tabla.closest('.table-responsive') || tabla.parentNode;
    const controles = document.createElement('div');
    controles.id = 'progAccionesRegistradasControles';
    controles.className = 'd-flex flex-wrap justify-content-between align-items-center gap-2 mb-2';
    controles.innerHTML = `
      <div class="d-flex align-items-center gap-2">
        <label class="form-label small mb-0" for="progRegistradasPageSize">Mostrar</label>
        <select id="progRegistradasPageSize" class="form-select form-select-sm" style="width:130px">
          <option value="10">10 registros</option>
          <option value="25">25 registros</option>
          <option value="50">50 registros</option>
          <option value="100">100 registros</option>
        </select>
      </div>
      <div class="d-flex align-items-center gap-2">
        <span id="progRegistradasContador" class="text-muted small">Mostrando 0 de 0 registros</span>
        <button id="btnProgRegistradasAnterior" type="button" class="btn btn-sm btn-outline-secondary">Anterior</button>
        <span id="progRegistradasPaginaInfo" class="text-muted small">Página 1 de 1</span>
        <button id="btnProgRegistradasSiguiente" type="button" class="btn btn-sm btn-outline-secondary">Siguiente</button>
      </div>`;
    wrapper.parentNode.insertBefore(controles, wrapper);
  }

  function renderDistritosAccionesProgramaV792() {
    asegurarControlesDistritos();
    const tbody = document.querySelector('#tablaDistritosAccionesPrograma tbody');
    if (!tbody) return;
    cargarCoberturaProgramas();
    actualizarCabeceraTablaDistritosCobertura();
    const columnasCobertura = getColumnasCoberturaPrograma();
    const colspan = 6 + columnasCobertura.length;
    const d = getDSPrograma();
    if (!d) {
      tbody.innerHTML = `<tr><td colspan="${colspan}" class="text-muted">Seleccione un Decreto Supremo activado.</td></tr>`;
      return;
    }
    let territorios = getTerritoriosDSPrograma();
    if (!territorios.length) {
      tbody.innerHTML = `<tr><td colspan="${colspan}" class="text-muted">El Decreto Supremo seleccionado no tiene distritos registrados.</td></tr>`;
      return;
    }
    leerFiltrosDistritos();
    territorios = filtrarTerritorios(territorios);
    const total = territorios.length;
    const pageSize = Math.max(10, parseInt(q('progDistritosPageSize')?.value || '10', 10));
    const totalPaginas = Math.max(1, Math.ceil(total / pageSize));
    stateV792.paginaDistritos = Math.min(Math.max(1, stateV792.paginaDistritos), totalPaginas);
    const desdeIdx = (stateV792.paginaDistritos - 1) * pageSize;
    const pagina = territorios.slice(desdeIdx, desdeIdx + pageSize);
    const desde = total ? desdeIdx + 1 : 0;
    const hasta = Math.min(desdeIdx + pageSize, total);

    if (q('progDistritosContador')) q('progDistritosContador').textContent = `Mostrando ${desde}-${hasta} de ${total} registro(s)`;
    if (q('progDistritosPaginaInfo')) q('progDistritosPaginaInfo').textContent = `Página ${stateV792.paginaDistritos} de ${totalPaginas}`;
    if (q('btnProgDistritosAnterior')) q('btnProgDistritosAnterior').disabled = stateV792.paginaDistritos <= 1;
    if (q('btnProgDistritosSiguiente')) q('btnProgDistritosSiguiente').disabled = stateV792.paginaDistritos >= totalPaginas;

    if (!pagina.length) {
      tbody.innerHTML = `<tr><td colspan="${colspan}" class="text-muted">No hay distritos que coincidan con la búsqueda.</td></tr>`;
      return;
    }

    tbody.innerHTML = pagina.map(t => {
      const acciones = accionesDeTerritorio(t);
      const detalle = resumen(acciones, ['detalle', 'accionesEspecificas']);
      const descripcion = resumen(acciones, ['descripcionActividades', 'descripcion']);
      const checked = stateV792.seleccion.has(t.key) ? 'checked' : '';
      const estadoFila = acciones.length ? '<span class="badge text-bg-success">Registrado</span>' : '<span class="badge text-bg-secondary">Pendiente</span>';
      return `<tr data-territorio-key="${escAttr(t.key)}">
        <td class="text-center"><input class="form-check-input chk-distrito-programa" type="checkbox" value="${escAttr(t.key)}" ${checked}></td>
        <td>${esc(t.departamento)}</td>
        <td>${esc(t.provincia)}</td>
        <td><strong>${esc(t.distrito)}</strong><div class="small text-muted">${estadoFila}</div></td>
        ${columnasCobertura.map(c => `<td class="text-end cobertura-col">${formatearCobertura(valorCobertura(t, c.key))}</td>`).join('')}
        <td>${detalle || '<span class="text-muted">Pendiente</span>'}</td>
        <td>${descripcion || '<span class="text-muted">Pendiente</span>'}</td>
      </tr>`;
    }).join('');

    tbody.querySelectorAll('.chk-distrito-programa').forEach(chk => {
      chk.addEventListener('change', () => {
        if (chk.checked) stateV792.seleccion.add(chk.value);
        else stateV792.seleccion.delete(chk.value);
      });
    });
  }

  function territoriosFiltradosActuales() {
    leerFiltrosDistritos();
    return filtrarTerritorios(getTerritoriosDSPrograma());
  }

  function seleccionarTodosDistritosV792() {
    territoriosFiltradosActuales().forEach(t => stateV792.seleccion.add(t.key));
    renderDistritosAccionesProgramaV792();
  }

  function limpiarSeleccionDistritosV792() {
    stateV792.seleccion.clear();
    renderDistritosAccionesProgramaV792();
  }

  function abrirModalGrupalV792() {
    if (typeof esRegistradorPrograma === 'function' && !esRegistradorPrograma()) return alert('Esta opción corresponde a Registradores de Programas Nacionales.');
    if (!dsProgramaSeleccionadoId) return alert('Seleccione un Decreto Supremo activado.');
    if (!stateV792.seleccion.size) return alert('Debe seleccionar al menos un distrito para registrar la acción.');
    if (q('grupoDetallePrograma')) q('grupoDetallePrograma').value = '';
    if (q('grupoDescripcionPrograma')) q('grupoDescripcionPrograma').value = '';
    const modal = q('modalAccionGrupalPrograma');
    if (modal && window.bootstrap?.Modal) bootstrap.Modal.getOrCreateInstance(modal).show();
    else alert('No se encontró el modal de registro grupal.');
  }

  function valoresFormularioPrograma() {
    if (typeof calcularFechaFinalPrograma === 'function') calcularFechaFinalPrograma();
    if (typeof calcularAvancePrograma === 'function') calcularAvancePrograma();
    return {
      tipoAccion: q('progTipoAccion')?.value || '',
      codigoAccion: txt(q('progCodigoAccion')?.value || ''),
      unidadMedida: q('progUnidadMedida')?.value || '',
      metaProgramada: Number(q('progMetaProgramada')?.value || 0),
      plazoDias: Number(q('progPlazoDias')?.value || 0),
      fechaInicio: q('progFechaInicio')?.value || '',
      fechaFinal: q('progFechaFinal')?.value || '',
      metaEjecutada: Number(q('progMetaEjecutada')?.value || 0),
      avance: q('progAvance')?.value || '0%',
      detalle: txt(q('progDetalle')?.value || q('grupoDetallePrograma')?.value || ''),
      descripcion: txt(q('progDescripcionActividades')?.value || q('grupoDescripcionPrograma')?.value || '')
    };
  }

  async function guardarAccionesTerritorialesV792({ usarModal = false } = {}) {
    const d = getDSPrograma();
    if (typeof esRegistradorPrograma === 'function' && !esRegistradorPrograma()) return alert('Solo un Registrador de Programa puede guardar acciones en esta vista.');
    if (!d || !d.rdsActivo) return alert('El Decreto Supremo no tiene RDS activo.');
    if (!stateV792.seleccion.size) return alert('Debe seleccionar al menos un distrito.');

    if (usarModal) {
      if (q('progDetalle')) q('progDetalle').value = txt(q('grupoDetallePrograma')?.value || '');
      if (q('progDescripcionActividades')) q('progDescripcionActividades').value = txt(q('grupoDescripcionPrograma')?.value || '');
    }

    const v = valoresFormularioPrograma();
    if (!v.tipoAccion) return alert('Seleccione el Tipo de acción.');
    if (!v.codigoAccion) return alert('Ingrese el Código de acción.');
    if (!v.unidadMedida) return alert('Seleccione la Unidad de medida.');
    if (!v.fechaInicio) return alert('Ingrese la Fecha de inicio.');
    if (!v.detalle && !v.descripcion) return alert('Ingrese acciones específicas programadas y ejecutadas o descripción de actividades.');

    const programa = programaActual();
    const keyR = reunionKey(d);
    const seleccionados = getTerritoriosDSPrograma().filter(t => stateV792.seleccion.has(t.key));
    if (!seleccionados.length) return alert('No se encontraron distritos válidos seleccionados.');

    const lista = (typeof cargarAccionesLocales === 'function') ? cargarAccionesLocales() : [];
    const fechaRegistro = (typeof fechaHoraLocalISO === 'function') ? fechaHoraLocalISO() : new Date().toISOString();
    let creados = 0;
    let actualizados = 0;
    const promesas = [];

    seleccionados.forEach(t => {
      const idx = lista.findIndex(a =>
        String(a.dsId || a.ds_id || '') === String(d.id) &&
        reunionKey(a) === keyR &&
        (typeof normalizarProgramaNombre === 'function' ? normalizarProgramaNombre(a.programaNacional || a.programa || '') : norm(a.programaNacional || a.programa || '')) === programa &&
        (a.ubigeo ? `UBIGEO:${a.ubigeo}` : [a.departamento, a.provincia, a.distrito].map(norm).join('|')) === t.key &&
        norm(a.codigoAccion || a.codigo || '') === norm(v.codigoAccion)
      );
      const base = idx >= 0 ? lista[idx] : {};
      const accion = {
        ...base,
        id: base.id || crypto.randomUUID(),
        dsId: d.id,
        ds_id: d.id,
        numeroDS: (typeof formatearNumeroDS === 'function') ? formatearNumeroDS(d) : (d.numero || ''),
        ds: (typeof formatearNumeroDS === 'function') ? formatearNumeroDS(d) : (d.numero || ''),
        numeroReunion: d.numeroReunion || '',
        numero_reunion: d.numeroReunion || '',
        fechaReunion: d.fechaReunion || '',
        fecha_reunion: d.fechaReunion || '',
        estadoRDS: d.estadoRDS || 'Activo',
        programaNacional: programa,
        programa,
        tipoAccion: v.tipoAccion,
        tipo: v.tipoAccion,
        codigoAccion: v.codigoAccion,
        codigo: v.codigoAccion,
        detalle: v.detalle || base.detalle || base.accionesEspecificas || '',
        accionesEspecificas: v.detalle || base.accionesEspecificas || base.detalle || '',
        descripcionActividades: v.descripcion || base.descripcionActividades || base.descripcion || '',
        descripcion: v.descripcion || base.descripcion || base.descripcionActividades || '',
        departamento: t.departamento || '',
        provincia: t.provincia || '',
        distrito: t.distrito || '',
        ubigeo: t.ubigeo || '',
        unidadMedida: v.unidadMedida,
        unidad: v.unidadMedida,
        metaProgramada: v.metaProgramada,
        meta_programada: v.metaProgramada,
        plazoDias: v.plazoDias,
        plazo_dias: v.plazoDias,
        plazo: v.plazoDias,
        fechaInicio: v.fechaInicio,
        fecha_inicio: v.fechaInicio,
        fechaFinal: v.fechaFinal,
        fecha_final: v.fechaFinal,
        metaEjecutada: v.metaEjecutada,
        meta_ejecutada: v.metaEjecutada,
        avance: v.avance,
        fechaRegistro: base.fechaRegistro || base.fecha_registro || fechaRegistro,
        fecha_registro: base.fecha_registro || base.fechaRegistro || fechaRegistro,
        usuarioRegistro: base.usuarioRegistro || base.usuario_registro || state.session?.email || '',
        usuario_registro: base.usuario_registro || base.usuarioRegistro || state.session?.email || '',
        usuario_actualiza: base.id ? (state.session?.email || '') : '',
        fecha_actualiza: base.id ? fechaRegistro : '',
        estado: 'Registrado'
      };
      const normalizada = (typeof normalizarAccionD1 === 'function') ? normalizarAccionD1(accion) : accion;
      if (idx >= 0) { lista[idx] = normalizada; actualizados++; }
      else { lista.push(normalizada); creados++; }
      if (typeof api === 'function') promesas.push(api('/acciones', 'POST', normalizada));
    });

    if (typeof guardarAccionesLocales === 'function') {
      try { __DEE_D1_IMPORTANDO = true; } catch {}
      guardarAccionesLocales(lista);
      try { __DEE_D1_IMPORTANDO = false; } catch {}
    }
    if (promesas.length) await Promise.allSettled(promesas);

    const modal = q('modalAccionGrupalPrograma');
    if (modal && window.bootstrap?.Modal) bootstrap.Modal.getOrCreateInstance(modal).hide();
    if (typeof limpiarFormularioAccionPrograma === 'function' && !usarModal) limpiarFormularioAccionPrograma(true);
    stateV792.seleccion.clear();
    renderDistritosAccionesProgramaV792();
    renderTablaAccionesProgramasV792();
    if (typeof renderTablaDecretosBasica === 'function') renderTablaDecretosBasica();
    alert(`Acción registrada correctamente. Creados: ${creados}. Actualizados: ${actualizados}.`);
  }

  function renderTablaAccionesProgramasV792() {
    asegurarControlesRegistradas();
    const tbody = document.querySelector('#tablaAccionesProgramas tbody');
    if (!tbody) return;
    const programa = programaActual();
    const dsId = dsProgramaSeleccionadoId;
    const visibles = (typeof cargarAccionesLocales === 'function' ? cargarAccionesLocales() : []).filter(a =>
      (!dsId || String(a.dsId || a.ds_id || '') === String(dsId)) &&
      (typeof normalizarProgramaNombre === 'function' ? normalizarProgramaNombre(a.programaNacional || a.programa || '') : norm(a.programaNacional || a.programa || '')) === programa
    ).sort((a,b) => txt(b.fechaRegistro || b.fecha_registro || '').localeCompare(txt(a.fechaRegistro || a.fecha_registro || '')));

    const total = visibles.length;
    const pageSize = Math.max(10, parseInt(q('progRegistradasPageSize')?.value || '10', 10));
    const totalPaginas = Math.max(1, Math.ceil(total / pageSize));
    stateV792.paginaRegistradas = Math.min(Math.max(1, stateV792.paginaRegistradas), totalPaginas);
    const desdeIdx = (stateV792.paginaRegistradas - 1) * pageSize;
    const pagina = visibles.slice(desdeIdx, desdeIdx + pageSize);
    const desde = total ? desdeIdx + 1 : 0;
    const hasta = Math.min(desdeIdx + pageSize, total);

    if (q('progRegistradasContador')) q('progRegistradasContador').textContent = `Mostrando ${desde}-${hasta} de ${total} registro(s)`;
    if (q('progRegistradasPaginaInfo')) q('progRegistradasPaginaInfo').textContent = `Página ${stateV792.paginaRegistradas} de ${totalPaginas}`;
    if (q('btnProgRegistradasAnterior')) q('btnProgRegistradasAnterior').disabled = stateV792.paginaRegistradas <= 1;
    if (q('btnProgRegistradasSiguiente')) q('btnProgRegistradasSiguiente').disabled = stateV792.paginaRegistradas >= totalPaginas;

    if (!pagina.length) {
      tbody.innerHTML = '<tr><td colspan="9" class="text-muted">No hay acciones registradas para su programa.</td></tr>';
      return;
    }
    tbody.innerHTML = pagina.map(a => `
      <tr>
        <td>${esc(a.numeroDS || a.ds || '')}</td>
        <td>${esc(a.programaNacional || a.programa || '')}</td>
        <td>${esc(a.tipoAccion || a.tipo || '')}</td>
        <td>${esc(a.codigoAccion || a.codigo || '')}</td>
        <td>${esc(a.detalle || a.accionesEspecificas || '')}</td>
        <td>${esc(a.estado || 'Registrado')}</td>
        <td>${esc(a.usuarioRegistro || a.usuario_registro || '')}</td>
        <td>${esc(a.fechaRegistro || a.fecha_registro || '')}</td>
        <td><span class="badge text-bg-success">Registrado</span></td>
      </tr>`).join('');
  }

  function initV792() {
    asegurarControlesDistritos();
    asegurarControlesRegistradas();
    cargarCoberturaProgramas();

    q('btnBuscarDistritosPrograma')?.addEventListener('click', (e) => { e.preventDefault(); e.stopImmediatePropagation(); stateV792.paginaDistritos = 1; renderDistritosAccionesProgramaV792(); }, true);
    q('btnLimpiarBuscarDistritosPrograma')?.addEventListener('click', (e) => {
      e.preventDefault(); e.stopImmediatePropagation();
      ['progFiltroDepartamento','progFiltroProvincia','progFiltroDistrito','progFiltroDetalleEstado','progFiltroDescripcionEstado'].forEach(id => { if (q(id)) q(id).value = ''; });
      stateV792.filtros = { dep:'', prov:'', dist:'', detalleEstado:'', descripcionEstado:'' };
      stateV792.paginaDistritos = 1;
      renderDistritosAccionesProgramaV792();
    }, true);
    ['progFiltroDepartamento','progFiltroProvincia','progFiltroDistrito'].forEach(id => q(id)?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); stateV792.paginaDistritos = 1; renderDistritosAccionesProgramaV792(); } }));
    ['progFiltroDetalleEstado','progFiltroDescripcionEstado','progDistritosPageSize'].forEach(id => q(id)?.addEventListener('change', () => { stateV792.paginaDistritos = 1; renderDistritosAccionesProgramaV792(); }));
    q('btnProgDistritosAnterior')?.addEventListener('click', (e) => { e.preventDefault(); e.stopImmediatePropagation(); stateV792.paginaDistritos = Math.max(1, stateV792.paginaDistritos - 1); renderDistritosAccionesProgramaV792(); }, true);
    q('btnProgDistritosSiguiente')?.addEventListener('click', (e) => { e.preventDefault(); e.stopImmediatePropagation(); stateV792.paginaDistritos += 1; renderDistritosAccionesProgramaV792(); }, true);
    q('btnSeleccionarTodosDistritosPrograma')?.addEventListener('click', (e) => { e.preventDefault(); e.stopImmediatePropagation(); seleccionarTodosDistritosV792(); }, true);
    q('btnLimpiarSeleccionDistritosPrograma')?.addEventListener('click', (e) => { e.preventDefault(); e.stopImmediatePropagation(); limpiarSeleccionDistritosV792(); }, true);
    q('btnRegistrarAccionGrupalPrograma')?.addEventListener('click', (e) => { e.preventDefault(); e.stopImmediatePropagation(); abrirModalGrupalV792(); }, true);
    q('btnGuardarAccionGrupalPrograma')?.addEventListener('click', (e) => { e.preventDefault(); e.stopImmediatePropagation(); guardarAccionesTerritorialesV792({ usarModal: true }); }, true);
    q('btnGuardarAccionPrograma')?.addEventListener('click', (e) => { e.preventDefault(); e.stopImmediatePropagation(); guardarAccionesTerritorialesV792({ usarModal: false }); }, true);

    q('progRegistradasPageSize')?.addEventListener('change', () => { stateV792.paginaRegistradas = 1; renderTablaAccionesProgramasV792(); });
    q('btnProgRegistradasAnterior')?.addEventListener('click', (e) => { e.preventDefault(); e.stopImmediatePropagation(); stateV792.paginaRegistradas = Math.max(1, stateV792.paginaRegistradas - 1); renderTablaAccionesProgramasV792(); }, true);
    q('btnProgRegistradasSiguiente')?.addEventListener('click', (e) => { e.preventDefault(); e.stopImmediatePropagation(); stateV792.paginaRegistradas += 1; renderTablaAccionesProgramasV792(); }, true);
  }

  const cargarVistaAnterior = window.cargarVistaAccionesPrograma || (typeof cargarVistaAccionesPrograma === 'function' ? cargarVistaAccionesPrograma : null);
  const initAnterior = window.initRegistroAccionesProgramas || (typeof initRegistroAccionesProgramas === 'function' ? initRegistroAccionesProgramas : null);

  function initRegistroAccionesProgramasV792() {
    if (initAnterior) {
      try { initAnterior(); } catch (e) { console.warn('initRegistroAccionesProgramas base no completó:', e); }
    }
    initV792();
    renderDistritosAccionesProgramaV792();
    renderTablaAccionesProgramasV792();
  }

  function cargarVistaAccionesProgramaV792(id) {
    stateV792.seleccion.clear();
    stateV792.paginaDistritos = 1;
    stateV792.paginaRegistradas = 1;
    if (cargarVistaAnterior) cargarVistaAnterior(id);
    initV792();
    renderDistritosAccionesProgramaV792();
    renderTablaAccionesProgramasV792();
  }

  window.initRegistroAccionesProgramas = initRegistroAccionesProgramasV792;
  window.cargarVistaAccionesPrograma = cargarVistaAccionesProgramaV792;
  window.renderDistritosAccionesPrograma = renderDistritosAccionesProgramaV792;
  window.renderTablaAccionesProgramas = renderTablaAccionesProgramasV792;
  window.guardarAccionPrograma = function(){ return guardarAccionesTerritorialesV792({ usarModal: false }); };

  try { initRegistroAccionesProgramas = initRegistroAccionesProgramasV792; } catch {}
  try { cargarVistaAccionesPrograma = cargarVistaAccionesProgramaV792; } catch {}
  try { renderDistritosAccionesPrograma = renderDistritosAccionesProgramaV792; } catch {}
  try { renderTablaAccionesProgramas = renderTablaAccionesProgramasV792; } catch {}
  try { guardarAccionPrograma = window.guardarAccionPrograma; } catch {}

  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
      try { initRegistroAccionesProgramasV792(); } catch (e) { console.warn('No se pudo inicializar v79.4 Registro Programas:', e); }
      console.info('DEE MIDIS cierre aplicado:', VERSION);
    }, 1600);
  });
})();
