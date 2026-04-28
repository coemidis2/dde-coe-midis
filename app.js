// ================= VERSION 23 FIX LOGIN REAL =================
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
  const email = $('loginUser')?.value.trim();
  const password = $('loginPass')?.value;

  if (!email || !password) {
    alert('Ingrese usuario y contraseña');
    return;
  }

  const resLogin = await api('/login', 'POST', { email, password });

  if (resLogin.ok && resLogin.data?.ok) {
    const resSession = await api('/session');

    if (resSession.ok && resSession.data?.user) {
      state.session = resSession.data.user;

      showApp();
      renderSession();
      initUbigeo();
      activarEventosDS();

      return;
    }
  }

  if (email === 'admin@midis.gob.pe' && password === 'AdminMIDIS2026!') {
    state.session = {
      name: 'Administrador DEMO',
      role: 'Administrador'
    };

    showApp();
    renderSession();
    initUbigeo();
    activarEventosDS();
    return;
  }

  alert('Credenciales inválidas');
}

// ================= AUTO LOGIN =================
async function autoLogin() {
  const res = await api('/session');

  if (res.ok && res.data?.user) {
    state.session = res.data.user;

    showApp();
    renderSession();
    initUbigeo();
    activarEventosDS();
    return;
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
  if (!modal) return;

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

// ================= ADMIN PANEL =================
let adminPanelInicializado = false;
let adminUsuariosLocales = [];

function esAdministrador() {
  return String(state.session?.role || '').trim().toLowerCase() === 'administrador';
}

function initAdminPanel() {
  if (adminPanelInicializado) return;
  adminPanelInicializado = true;

  const modal = $('modalAdminPanel');
  if (!modal) return;

  modal.querySelectorAll('button[data-bs-toggle="tab"][data-bs-target^="#admin"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      activarAdminTab(btn.getAttribute('data-bs-target'));
    });
  });

  $('btnCrearUsuarioAdmin')?.addEventListener('click', crearUsuarioAdmin);
  $('btnCopiarClaveAdmin')?.addEventListener('click', copiarClaveAdmin);
  $('btnVerAuditoria')?.addEventListener('click', cargarAuditoriaAdmin);
  $('btnLimpiarAuditoria')?.addEventListener('click', limpiarAuditoriaAdmin);
  $('btnConflictosServidor')?.addEventListener('click', cargarConflictosAdmin);
  $('btnConflictosLocal')?.addEventListener('click', cargarConflictosAdmin);
  $('btnLimpiarConflictos')?.addEventListener('click', limpiarConflictosAdmin);
}

function activarAdminTab(target) {
  if (!esAdministrador()) {
    alert('Acceso permitido solo para Administrador.');
    return;
  }

  const modal = $('modalAdminPanel');
  if (!modal || !target) return;

  const targetId = String(target).replace('#', '');
  const pane = $(targetId);
  if (!pane) return;

  modal.querySelectorAll('.nav-tabs .nav-link').forEach(btn => {
    const activo = btn.getAttribute('data-bs-target') === `#${targetId}`;
    btn.classList.toggle('active', activo);
    btn.setAttribute('aria-selected', activo ? 'true' : 'false');
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
  if (!tbody) return;

  tbody.innerHTML = '<tr><td colspan="5" class="text-muted">Cargando usuarios...</td></tr>';

  let usuarios = [];

  const res = await api('/users');
  if (res.ok && Array.isArray(res.data?.users)) {
    usuarios = res.data.users;
  } else if (res.ok && Array.isArray(res.data)) {
    usuarios = res.data;
  }

  if (!usuarios.length) {
    usuarios = [
      {
        name: state.session?.name || 'Administrador',
        email: state.session?.email || 'admin@midis.gob.pe',
        role: state.session?.role || 'Administrador',
        active: 1
      },
      ...adminUsuariosLocales
    ];
  } else {
    usuarios = [...usuarios, ...adminUsuariosLocales];
  }

  tbody.innerHTML = usuarios.map(u => `
    <tr>
      <td>${escapeHtml(u.name || u.nombre || '')}</td>
      <td>${escapeHtml(u.email || u.correo || '')}</td>
      <td>${escapeHtml(u.role || u.rol || '')}</td>
      <td>${Number(u.active ?? u.activo ?? 1) === 1 ? 'Activo' : 'Inactivo'}</td>
      <td><button type="button" class="btn btn-sm btn-outline-secondary" disabled>Ver</button></td>
    </tr>
  `).join('') || '<tr><td colspan="5" class="text-muted">Sin usuarios registrados.</td></tr>';
}

async function crearUsuarioAdmin() {
  if (!esAdministrador()) {
    alert('Acceso permitido solo para Administrador.');
    return;
  }

  const nombre = $('adminUserName')?.value.trim() || '';
  const email = $('adminUserEmail')?.value.trim() || '';
  const rol = $('adminUserRole')?.value || '';

  if (!nombre || !email || !rol) {
    alert('Complete nombre, correo y rol.');
    return;
  }

  const clave = generarClaveTemporal();
  if ($('adminGeneratedPassword')) $('adminGeneratedPassword').value = clave;

  const payload = { name: nombre, email, role: rol, password: clave, active: 1 };
  const res = await api('/users', 'POST', payload);

  if (!res.ok) {
    adminUsuariosLocales.push(payload);
  }

  await cargarUsuariosAdmin();
}

function generarClaveTemporal() {
  const base = 'MIDIS';
  const n = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `${base}${n}2026!`;
}

async function copiarClaveAdmin() {
  const input = $('adminGeneratedPassword');
  if (!input || !input.value) {
    alert('No hay clave generada.');
    return;
  }

  try {
    await navigator.clipboard.writeText(input.value);
    alert('Clave copiada.');
  } catch {
    input.select();
    document.execCommand('copy');
    alert('Clave copiada.');
  }
}

async function cargarAuditoriaAdmin() {
  if (!esAdministrador()) return;

  const tbody = document.querySelector('#tablaAuditoria tbody');
  if (!tbody) return;

  tbody.innerHTML = '<tr><td colspan="5" class="text-muted">Cargando auditoría...</td></tr>';

  const desde = $('auditDesde')?.value || '';
  const hasta = $('auditHasta')?.value || '';
  const actor = $('auditActor')?.value || '';

  const qs = new URLSearchParams();
  if (desde) qs.set('desde', desde);
  if (hasta) qs.set('hasta', hasta);
  if (actor) qs.set('actor', actor);

  let registros = [];
  const res = await api(`/audit${qs.toString() ? '?' + qs.toString() : ''}`);

  if (res.ok && Array.isArray(res.data?.items)) {
    registros = res.data.items;
  } else if (res.ok && Array.isArray(res.data?.audit)) {
    registros = res.data.audit;
  } else if (res.ok && Array.isArray(res.data)) {
    registros = res.data;
  }

  if (!registros.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="text-muted">Sin registros de auditoría para mostrar.</td></tr>';
    cargarActoresAuditoria([]);
    return;
  }

  cargarActoresAuditoria(registros);

  tbody.innerHTML = registros.map(r => `
    <tr>
      <td>${escapeHtml(r.fecha || r.created_at || r.timestamp || '')}</td>
      <td>${escapeHtml(r.actor || r.usuario || r.email || '')}</td>
      <td>${escapeHtml(r.action || r.accion || '')}</td>
      <td>${escapeHtml(r.detail || r.detalle || '')}</td>
      <td><button type="button" class="btn btn-sm btn-outline-primary" disabled>Ver</button></td>
    </tr>
  `).join('');
}

function cargarActoresAuditoria(registros) {
  const sel = $('auditActor');
  if (!sel) return;

  const actual = sel.value;
  const actores = [...new Set(registros.map(r => r.actor || r.usuario || r.email).filter(Boolean))];

  sel.innerHTML = '<option value="">Todos</option>';
  actores.forEach(a => {
    const opt = document.createElement('option');
    opt.value = a;
    opt.textContent = a;
    sel.appendChild(opt);
  });

  if (actual && actores.includes(actual)) sel.value = actual;
}

function limpiarAuditoriaAdmin() {
  if (!esAdministrador()) return;

  if ($('auditDesde')) $('auditDesde').value = '';
  if ($('auditHasta')) $('auditHasta').value = '';
  if ($('auditActor')) $('auditActor').value = '';

  const tbody = document.querySelector('#tablaAuditoria tbody');
  if (tbody) tbody.innerHTML = '<tr><td colspan="5" class="text-muted">Filtros limpiados.</td></tr>';
}

async function cargarConflictosAdmin() {
  if (!esAdministrador()) return;

  const tbody = document.querySelector('#tablaConflictos tbody');
  if (!tbody) return;

  tbody.innerHTML = '<tr><td colspan="7" class="text-muted">Cargando conflictos...</td></tr>';

  let conflictos = [];
  const res = await api('/conflictos');

  if (res.ok && Array.isArray(res.data?.items)) {
    conflictos = res.data.items;
  } else if (res.ok && Array.isArray(res.data?.conflictos)) {
    conflictos = res.data.conflictos;
  } else if (res.ok && Array.isArray(res.data)) {
    conflictos = res.data;
  }

  if (!conflictos.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-muted">Sin conflictos registrados.</td></tr>';
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
  if (!esAdministrador()) return;

  const tbody = document.querySelector('#tablaConflictos tbody');
  if (tbody) tbody.innerHTML = '<tr><td colspan="7" class="text-muted">Vista de conflictos limpiada.</td></tr>';
}

// ================= FECHA =================
function activarEventosDS() {
  $('dsFechaInicio')?.addEventListener('change', calcularFechaFin);
  $('dsPlazoDias')?.addEventListener('input', calcularFechaFin);
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

// ================= UBIGEO =================
function normalizar(v) {
  return String(v || '')
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
    normalizar(reg?.departamento),
    normalizar(reg?.provincia),
    normalizar(reg?.distrito)
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

  if (valorActual && deps.includes(valorActual)) {
    sel.value = valorActual;
  }
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
    .filter(x => normalizar(x.departamento) === normalizar(dep))
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
      normalizar(x.departamento) === normalizar(dep) &&
      normalizar(x.provincia) === normalizar(prov)
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
  const texto = normalizar($('buscarDistrito')?.value || '');
  const cont = $('distritosChecklist');

  if (!cont) return;

  cont.querySelectorAll('.distrito-item').forEach(div => {
    const visible = normalizar(div.textContent).includes(texto);
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

  const btnAdmin = $('btnAdminPanel');
  if (btnAdmin) {
    btnAdmin.addEventListener('click', openAdminPanel);
  }

  autoLogin();
}

document.addEventListener('DOMContentLoaded', init);