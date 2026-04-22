// ================== CONFIG API ==================
const API_BASE = window.location.origin + '/api';

function getHeaders() {
  return {
    'Content-Type': 'application/json'
  };
}

async function apiGet(path) {
  try {
    const res = await fetch(API_BASE + path, {
      method: 'GET',
      headers: getHeaders(),
      credentials: 'include'
    });
    return await res.json();
  } catch (e) {
    console.warn('API GET error:', e);
    return null;
  }
}

async function apiPost(path, data) {
  try {
    const res = await fetch(API_BASE + path, {
      method: 'POST',
      headers: getHeaders(),
      credentials: 'include',
      body: JSON.stringify(data)
    });
    return await res.json();
  } catch (e) {
    console.warn('API POST error:', e);
    return null;
  }
}

async function apiPatch(path, data) {
  try {
    const res = await fetch(API_BASE + path, {
      method: 'PATCH',
      headers: getHeaders(),
      credentials: 'include',
      body: JSON.stringify(data)
    });
    return await res.json();
  } catch (e) {
    console.warn('API PATCH error:', e);
    return null;
  }
}

async function apiDelete(path) {
  try {
    const res = await fetch(API_BASE + path, {
      method: 'DELETE',
      headers: getHeaders(),
      credentials: 'include'
    });
    return await res.json();
  } catch (e) {
    console.warn('API DELETE error:', e);
    return null;
  }
}

// ================== APP STATE ==================
const STORAGE_KEY = 'dee_midis_local_v4';

let state = {
  session: null,
  decretos: [],
  acciones: [],
  nuevoDSTerritorios: []
};

const SECTORES_FIRMANTES = [
  'PCM',
  'MIDIS',
  'MINEDU',
  'MINSA',
  'MVCS',
  'MTC',
  'MININTER',
  'MINDEF',
  'MINAGRI',
  'MIMP',
  'MINEM',
  'MINAM'
];

let ubigeoCache = [];

const $ = (id) => document.getElementById(id);

document.addEventListener('DOMContentLoaded', init);

async function init() {
  loadStorage();
  wireLogin();
  wireUI();
  wireDSForm();
  initUbigeo();
  renderSectoresFirmantes();
  renderTablaDecretos();
  renderSelectAccionDs();
  generarCodigoRegistro();
  actualizarOrigenesProrroga();
  renderSesion();
  await autoLogin();
}

// ================== STORAGE ==================
function loadStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      state.decretos = parsed.decretos || [];
      state.acciones = parsed.acciones || [];
    }
    state.nuevoDSTerritorios = [];
  } catch (e) {
    console.warn('loadStorage error', e);
  }
}

function saveStorage() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    decretos: state.decretos,
    acciones: state.acciones
  }));
}

// ================== LOGIN / SESSION ==================
function wireLogin() {
  if ($('btnLogin')) {
    $('btnLogin').addEventListener('click', doLogin);
  }
}

async function doLogin() {
  const email = ($('loginUser')?.value || '').trim().toLowerCase();
  const password = $('loginPass')?.value || '';

  const resp = await apiPost('/login', { email, password });
  console.log('LOGIN RESPONSE:', resp);

  if (!resp || !resp.ok) {
    alert('Credenciales inválidas.');
    return;
  }

  const sessionResp = await apiGet('/session');
  console.log('SESSION RESPONSE:', sessionResp);

  if (!sessionResp || !sessionResp.ok || !sessionResp.user) {
    alert('Se autenticó, pero no se pudo recuperar la sesión.');
    return;
  }

  state.session = {
    email: sessionResp.user.email || email,
    name: sessionResp.user.name || email,
    role: sessionResp.user.role || '',
    programa: sessionResp.user.programa || ''
  };

  $('loginView')?.classList.add('d-none');
  $('appView')?.classList.remove('d-none');

  await syncFromBackend();
  renderAll();
}

async function autoLogin() {
  const sessionResp = await apiGet('/session');

  if (sessionResp && sessionResp.ok && sessionResp.user) {
    state.session = {
      email: sessionResp.user.email || '',
      name: sessionResp.user.name || sessionResp.user.email || '',
      role: sessionResp.user.role || '',
      programa: sessionResp.user.programa || ''
    };

    $('loginView')?.classList.add('d-none');
    $('appView')?.classList.remove('d-none');

    await syncFromBackend();
    renderAll();
  }
}

async function syncFromBackend() {
  const data = await apiGet('/decretos');

  if (data && data.ok) {
    state.decretos = (data.decretos || []).map(normalizarDecretoDesdeBackend);
    state.acciones = data.acciones || [];
    saveStorage();
  }
}

function wireUI() {
  if ($('btnLogout')) {
    $('btnLogout').addEventListener('click', () => {
      localStorage.removeItem(STORAGE_KEY);
      location.reload();
    });
  }

  if ($('btnAdminPanel')) {
    $('btnAdminPanel').addEventListener('click', openAdminPanel);
  }

  if ($('btnCrearUsuarioAdmin')) {
    $('btnCrearUsuarioAdmin').addEventListener('click', createUserAdmin);
  }

  if ($('btnCopiarClaveAdmin')) {
    $('btnCopiarClaveAdmin').addEventListener('click', copyGeneratedPassword);
  }

  if ($('btnVerAuditoria')) {
    $('btnVerAuditoria').addEventListener('click', loadAuditLog);
  }

  if ($('btnLimpiarAuditoria')) {
    $('btnLimpiarAuditoria').addEventListener('click', clearAuditLog);
  }

  if ($('btnLimpiarConflictos')) {
    $('btnLimpiarConflictos').addEventListener('click', clearConflictos);
  }
}

// ================== SESSION / ROLES ==================
function renderSesion() {
  if ($('sessionName')) {
    $('sessionName').textContent = state.session?.name || '';
  }
  if ($('sessionRole')) {
    $('sessionRole').textContent = state.session?.role || '';
  }
}

function applyRolePermissions() {
  const role = state.session?.role || '';
  const isAdmin = role === 'Administrador';
  const isRevisor = role === 'Revisor' || role === 'Evaluador';
  const isConsulta = role === 'Consulta';

  const adminBtn = $('btnAdminPanel');
  const tabSegBtn = document.querySelector('[data-bs-target="#tabSeg"]');
  const tabNuevoBtn = document.querySelector('[data-bs-target="#tabNuevo"]');
  const tabAccionesBtn = document.querySelector('[data-bs-target="#tabAcciones"]');

  if (adminBtn) adminBtn.style.display = isAdmin ? '' : 'none';
  if (tabSegBtn) tabSegBtn.style.display = (isAdmin || isRevisor) ? '' : 'none';
  if (tabNuevoBtn) tabNuevoBtn.style.display = (isAdmin || isRevisor) ? '' : (isConsulta ? 'none' : '');
  if (tabAccionesBtn) tabAccionesBtn.style.display = isConsulta ? 'none' : '';
}

// ================== ADMIN PANEL ==================
async function openAdminPanel() {
  await loadUsers();
  await loadAuditLog();
  await loadConflictos();

  const modalEl = $('modalAdminPanel');
  if (modalEl && window.bootstrap) {
    const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
    modal.show();
  }
}

function formatRole(role, programa) {
  if (role === 'Registrador' && programa) return `Registrador (${programa})`;
  if (role === 'Evaluador') return 'Revisor';
  return role || '';
}

// ================== USERS ==================
async function loadUsers() {
  const tbody = document.querySelector('#tablaAdminUsuarios tbody');
  if (!tbody) return;

  const resp = await apiGet('/users');

  if (!resp || !resp.ok) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted">No se pudo cargar usuarios.</td></tr>`;
    return;
  }

  tbody.innerHTML = (resp.users || []).map(u => `
    <tr>
      <td>${escapeHtml(u.name || '')}</td>
      <td>${escapeHtml(u.email || '')}</td>
      <td>${escapeHtml(formatRole(u.role, u.programa))}</td>
      <td>${u.active ? 'Activo' : 'Inactivo'}</td>
      <td>
        <button class="btn btn-sm btn-outline-warning" type="button"
          onclick="toggleUserStatus('${u.id}', ${u.active ? 0 : 1})">
          ${u.active ? 'Desactivar' : 'Activar'}
        </button>
        <button class="btn btn-sm btn-outline-primary" type="button"
          onclick="resetUserPassword('${u.id}')">
          Reset clave
        </button>
      </td>
    </tr>
  `).join('');
}

async function createUserAdmin() {
  const name = ($('adminUserName')?.value || '').trim();
  const email = ($('adminUserEmail')?.value || '').trim().toLowerCase();
  const rawRole = ($('adminUserRole')?.value || '').trim();

  if (!name || !email || !rawRole) {
    alert('Complete Nombre, Correo y Rol.');
    return;
  }

  let role = rawRole;
  let programa = '';

  if (rawRole.startsWith('Registrador|')) {
    role = 'Registrador';
    programa = rawRole.split('|')[1] || '';
  } else if (rawRole === 'Evaluador') {
    role = 'Revisor';
  }

  const resp = await apiPost('/users', { name, email, role, programa });

  if (!resp || !resp.ok) {
    alert('No se pudo crear el usuario.');
    return;
  }

  if ($('adminGeneratedPassword')) {
    $('adminGeneratedPassword').value = resp.temporaryPassword || '';
  }

  await loadUsers();
  alert('Usuario creado correctamente.');
}

function copyGeneratedPassword() {
  const val = $('adminGeneratedPassword')?.value || '';
  if (!val) {
    alert('No hay clave para copiar.');
    return;
  }

  navigator.clipboard.writeText(val)
    .then(() => alert('Clave copiada.'))
    .catch(() => alert('No se pudo copiar la clave.'));
}

async function toggleUserStatus(id, active) {
  const resp = await apiPatch('/users', {
    action: 'status',
    id,
    active
  });

  if (!resp || !resp.ok) {
    alert('No se pudo actualizar el estado del usuario.');
    return;
  }

  await loadUsers();
}

async function resetUserPassword(id) {
  const resp = await apiPatch('/users', {
    action: 'reset_password',
    id
  });

  if (!resp || !resp.ok) {
    alert('No se pudo resetear la clave.');
    return;
  }

  if ($('adminGeneratedPassword')) {
    $('adminGeneratedPassword').value = resp.temporaryPassword || '';
  }

  alert('Clave reseteada correctamente.');
}

// ================== AUDITORIA ==================
async function loadAuditLog() {
  const tbody = document.querySelector('#tablaAuditoria tbody');
  if (!tbody) return;

  const from = $('auditDesde')?.value || '';
  const to = $('auditHasta')?.value || '';
  const actor = $('auditActor')?.value || '';

  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  if (actor) params.set('actor', actor);

  const resp = await apiGet('/audit-log' + (params.toString() ? `?${params.toString()}` : ''));

  if (!resp || !resp.ok) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted">No se pudo cargar auditoría.</td></tr>`;
    return;
  }

  const rows = resp.rows || [];

  tbody.innerHTML = rows.length ? rows.map(r => `
    <tr>
      <td>${escapeHtml(r.created_at || '')}</td>
      <td>${escapeHtml(r.actor || '')}</td>
      <td>${escapeHtml(r.action || '')}</td>
      <td>${escapeHtml(r.detail || '')}</td>
      <td><button class="btn btn-sm btn-outline-primary" type="button">Ver</button></td>
    </tr>
  `).join('') : `<tr><td colspan="5" class="text-center text-muted">No hay registros de auditoría.</td></tr>`;

  fillAuditActorSelect(rows);
}

function fillAuditActorSelect(rows) {
  const sel = $('auditActor');
  if (!sel) return;

  const current = sel.value;
  const actors = [...new Set(rows.map(x => x.actor).filter(Boolean))].sort();

  sel.innerHTML = '<option value="">Todos</option>' +
    actors.map(a => `<option value="${escapeHtml(a)}">${escapeHtml(a)}</option>`).join('');

  sel.value = current;
}

async function clearAuditLog() {
  const ok = confirm('¿Seguro que desea limpiar la auditoría?');
  if (!ok) return;

  const resp = await apiDelete('/audit-log');
  if (!resp || !resp.ok) {
    alert('No se pudo limpiar la auditoría.');
    return;
  }

  await loadAuditLog();
}

// ================== CONFLICTOS ==================
async function loadConflictos() {
  const tbody = document.querySelector('#tablaConflictos tbody');
  if (!tbody) return;

  const resp = await apiGet('/conflictos');

  if (!resp || !resp.ok) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted">No se pudo cargar conflictos.</td></tr>`;
    return;
  }

  const rows = resp.rows || [];

  tbody.innerHTML = rows.length ? rows.map(c => `
    <tr>
      <td>${escapeHtml(c.created_at || '')}</td>
      <td>${escapeHtml(c.codigo || '')}</td>
      <td>${escapeHtml(c.motivo || '')}</td>
      <td>${escapeHtml(c.fecha_servidor || '')}</td>
      <td>${escapeHtml(c.estado_local_servidor || '')}</td>
      <td>${escapeHtml(c.resolucion_aplicada || '')}</td>
      <td>-</td>
    </tr>
  `).join('') : `<tr><td colspan="7" class="text-center text-muted">No hay conflictos registrados.</td></tr>`;
}

async function clearConflictos() {
  const ok = confirm('¿Seguro que desea limpiar conflictos?');
  if (!ok) return;

  const resp = await apiDelete('/conflictos');
  if (!resp || !resp.ok) {
    alert('No se pudo limpiar conflictos.');
    return;
  }

  await loadConflictos();
}

// ================== FORM DECRETOS ==================
function wireDSForm() {
  $('btnGuardarDS')?.addEventListener('click', guardarDecretoSupremo);

  $('dsFechaInicio')?.addEventListener('change', recalcularFechasDS);
  $('dsPlazoDias')?.addEventListener('input', recalcularFechasDS);
  $('dsNumero')?.addEventListener('input', actualizarDatosProrrogaVisual);

  $('dsEsProrroga')?.addEventListener('change', onToggleProrroga);
  $('dsOrigen')?.addEventListener('change', actualizarDatosProrrogaVisual);
}

function renderSectoresFirmantes() {
  const cont = $('sectoresContainer');
  if (!cont) return;

  cont.innerHTML = SECTORES_FIRMANTES.map((sector, i) => `
    <div class="col-md-3 col-sm-4 col-6">
      <div class="form-check">
        <input class="form-check-input ds-sector-firma" type="checkbox" value="${sector}" id="sectorFirma_${i}">
        <label class="form-check-label" for="sectorFirma_${i}">${sector}</label>
      </div>
    </div>
  `).join('');
}

function generarCodigoRegistro() {
  const input = $('dsCodigoRegistro');
  if (!input) return;

  const correlativo = String(state.decretos.length + 1).padStart(4, '0');
  input.value = `DS-${new Date().getFullYear()}-${correlativo}`;
}

function recalcularFechasDS() {
  const fechaInicio = $('dsFechaInicio')?.value || '';
  const plazo = parseInt($('dsPlazoDias')?.value || '0', 10);

  if (!fechaInicio || !plazo || plazo < 1) {
    if ($('dsFechaFin')) $('dsFechaFin').value = '';
    if ($('dsVigencia')) $('dsVigencia').value = '';
    if ($('dsSemaforo')) $('dsSemaforo').value = '';
    return;
  }

  const inicio = new Date(fechaInicio + 'T00:00:00');
  const fin = new Date(inicio);
  fin.setDate(fin.getDate() + plazo - 1);

  if ($('dsFechaFin')) $('dsFechaFin').value = toDateInputValue(fin);
  if ($('dsVigencia')) $('dsVigencia').value = String(plazo);

  actualizarSemaforo(fin);
}

function actualizarSemaforo(fechaFin) {
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);

  const fin = new Date(fechaFin);
  fin.setHours(0, 0, 0, 0);

  const diffDias = Math.ceil((fin - hoy) / 86400000);

  let texto = 'Vencido';
  if (diffDias > 15) texto = 'Verde';
  else if (diffDias >= 1) texto = 'Amarillo';
  else texto = 'Rojo';

  if ($('dsSemaforo')) $('dsSemaforo').value = texto;
}

function onToggleProrroga() {
  const checked = $('dsEsProrroga')?.checked || false;
  const origen = $('dsOrigen');

  if (origen) {
    origen.disabled = !checked;

    if (!checked) {
      origen.value = '';
      if ($('dsNivelProrroga')) $('dsNivelProrroga').value = '0';
      if ($('dsCadena')) $('dsCadena').value = '';
    } else {
      actualizarOrigenesProrroga();
    }
  }
}

function actualizarOrigenesProrroga() {
  const sel = $('dsOrigen');
  if (!sel) return;

  const actual = sel.value;
  sel.innerHTML = '<option value="">Seleccione...</option>';

  state.decretos
    .slice()
    .sort((a, b) => (a.numero || '').localeCompare(b.numero || ''))
    .forEach(ds => {
      const opt = document.createElement('option');
      opt.value = ds.id;
      opt.textContent = ds.numero;
      sel.appendChild(opt);
    });

  if (actual) sel.value = actual;
  actualizarDatosProrrogaVisual();
}

function actualizarDatosProrrogaVisual() {
  const esProrroga = $('dsEsProrroga')?.checked || false;
  const origenId = $('dsOrigen')?.value || '';

  if (!esProrroga || !origenId) {
    if ($('dsNivelProrroga')) $('dsNivelProrroga').value = esProrroga ? '1' : '0';
    if ($('dsCadena')) $('dsCadena').value = '';
    return;
  }

  const dataProrroga = construirCadenaProrroga(origenId);
  if ($('dsNivelProrroga')) $('dsNivelProrroga').value = String(dataProrroga.nivel);
  if ($('dsCadena')) $('dsCadena').value = dataProrroga.cadenaPreview;
}

function getSectoresFirmantesSeleccionados() {
  return [...document.querySelectorAll('.ds-sector-firma:checked')].map(x => x.value);
}

function construirCadenaProrroga(origenId) {
  const origen = state.decretos.find(x => String(x.id) === String(origenId));
  if (!origen) {
    return {
      nivel: 1,
      cadena: '',
      cadenaPreview: ''
    };
  }

  const nivelBase = parseInt(origen.nivelProrroga || 0, 10);
  const nivel = nivelBase + 1;
  const baseCadena = origen.cadenaProrroga || origen.numero || '';
  const numeroNuevo = ($('dsNumero')?.value || '').trim() || '[NUEVO]';

  return {
    nivel,
    origen,
    cadena: `${baseCadena} -> ${numeroNuevo}`,
    cadenaPreview: `${baseCadena} -> ${numeroNuevo}`
  };
}

async function guardarDecretoSupremo() {
  const numero = ($('dsNumero')?.value || '').trim();
  const anio = ($('dsAnio')?.value || '').trim();
  const codigoRegistro = ($('dsCodigoRegistro')?.value || '').trim();
  const peligro = ($('dsPeligro')?.value || '').trim();
  const tipoPeligro = ($('dsTipoPeligro')?.value || '').trim();
  const plazoDias = parseInt($('dsPlazoDias')?.value || '0', 10);
  const fechaInicio = ($('dsFechaInicio')?.value || '').trim();
  const fechaFin = ($('dsFechaFin')?.value || '').trim();
  const vigencia = ($('dsVigencia')?.value || '').trim();
  const semaforo = ($('dsSemaforo')?.value || '').trim();
  const motivos = ($('dsMotivos')?.value || '').trim();

  const esProrroga = $('dsEsProrroga')?.checked || false;
  const dsOrigenId = ($('dsOrigen')?.value || '').trim();

  const sectoresFirmantes = getSectoresFirmantesSeleccionados();

  if (!numero) return alert('Ingrese el Número de Decreto Supremo.');
  if (!anio) return alert('Ingrese el Año.');
  if (!peligro) return alert('Seleccione el Peligro.');
  if (!tipoPeligro) return alert('Seleccione el Tipo de Peligro.');
  if (!plazoDias || plazoDias < 1) return alert('Ingrese el Plazo (Días).');
  if (!fechaInicio) return alert('Ingrese la Fecha de inicio.');
  if (!fechaFin) return alert('No se pudo calcular la Fecha final.');
  if (!sectoresFirmantes.length) return alert('Seleccione al menos un Sector que firma.');
  if (!state.nuevoDSTerritorios.length) return alert('Agregue al menos un distrito.');
  if (esProrroga && !dsOrigenId) return alert('Seleccione el DS de origen inmediato.');

  if (state.decretos.some(x => (x.numero || '').toUpperCase() === numero.toUpperCase())) {
    return alert('Ya existe un Decreto Supremo con ese número.');
  }

  let nivelProrroga = 0;
  let cadenaProrroga = '';
  let origenNumero = '';

  if (esProrroga) {
    const dataProrroga = construirCadenaProrroga(dsOrigenId);
    nivelProrroga = dataProrroga.nivel;
    origenNumero = dataProrroga.origen?.numero || '';
    cadenaProrroga = dataProrroga.cadena;
  }

  const nuevoUI = {
    id: cryptoRandomId(),
    numero,
    anio,
    codigoRegistro,
    peligro,
    tipoPeligro,
    plazoDias,
    fechaInicio,
    fechaFin,
    vigencia,
    semaforo,
    motivos,
    territorios: structuredCloneSafe(state.nuevoDSTerritorios),
    sectoresFirmantes: structuredCloneSafe(sectoresFirmantes),
    esProrroga,
    dsOrigenId: esProrroga ? dsOrigenId : '',
    dsOrigenNumero: esProrroga ? origenNumero : '',
    nivelProrroga,
    cadenaProrroga,
    creadoEn: new Date().toISOString()
  };

  const payload = {
    id: nuevoUI.id,
    codigo_registro: codigoRegistro,
    numero,
    anio,
    peligro,
    tipo_peligro: tipoPeligro,
    fecha_inicio: fechaInicio,
    fecha_fin: fechaFin,
    vigencia,
    semaforo,
    motivos,
    sectores: sectoresFirmantes,
    territorio: state.nuevoDSTerritorios,
    es_prorroga: esProrroga ? 1 : 0,
    usuario_registro: state.session?.email || '',
    fecha_registro: new Date().toISOString(),
    estado: 'activo',
    version: 1,
    locked: 0
  };

  console.log('PAYLOAD DS -> BACKEND:', payload);

  const resp = await apiPost('/decretos', payload);
  console.log('RESPUESTA POST /decretos:', resp);

  if (resp && resp.ok) {
    console.log('Guardado en backend');
    state.decretos.unshift(nuevoUI);
    saveStorage();
    renderTablaDecretos();
    actualizarOrigenesProrroga();
    renderSelectAccionDs();
    limpiarFormularioDS();
    alert('Decreto Supremo guardado correctamente.');
    return;
  }

  console.warn('No se confirmó guardado en backend; no se agregó a la lista local.');
  alert('No se pudo guardar el Decreto Supremo en backend.');
}

function limpiarFormularioDS() {
  [
    'dsNumero',
    'dsPeligro',
    'dsTipoPeligro',
    'dsPlazoDias',
    'dsFechaInicio',
    'dsFechaFin',
    'dsVigencia',
    'dsSemaforo',
    'dsMotivos',
    'dsOrigen',
    'dsCadena'
  ].forEach(id => {
    if ($(id)) $(id).value = '';
  });

  if ($('dsAnio')) $('dsAnio').value = new Date().getFullYear();
  if ($('dsEsProrroga')) $('dsEsProrroga').checked = false;
  if ($('dsOrigen')) $('dsOrigen').disabled = true;
  if ($('dsNivelProrroga')) $('dsNivelProrroga').value = '0';

  document.querySelectorAll('.ds-sector-firma').forEach(chk => chk.checked = false);

  state.nuevoDSTerritorios = [];
  renderTerritorioSeleccionado();

  if ($('selDepartamento')) $('selDepartamento').value = '';
  if ($('selProvincia')) $('selProvincia').innerHTML = '<option value="">Seleccione...</option>';
  if ($('buscarDistrito')) $('buscarDistrito').value = '';
  if ($('distritosChecklist')) {
    $('distritosChecklist').innerHTML = '<div class="text-muted small">Seleccione primero departamento y provincia.</div>';
  }

  generarCodigoRegistro();
}

// ================== TABLA / MODAL DECRETOS ==================
function renderTablaDecretos() {
  const tbody = document.querySelector('#tablaDS tbody');
  if (!tbody) return;

  if (!state.decretos.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="17" class="text-center text-muted">No hay Decretos Supremos registrados.</td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = state.decretos.map(ds => {
    const territorios = Array.isArray(ds.territorios) ? ds.territorios : [];
    const departamentos = new Set(territorios.map(x => normalizarTexto(x.departamento))).size;
    const provincias = new Set(territorios.map(x => `${normalizarTexto(x.departamento)}|${normalizarTexto(x.provincia)}`)).size;
    const distritos = territorios.length;

    return `
      <tr>
        <td>${escapeHtml(ds.numero)}</td>
        <td>${escapeHtml(ds.anio)}</td>
        <td>${escapeHtml(ds.peligro)}</td>
        <td>${escapeHtml(ds.tipoPeligro)}</td>
        <td>${escapeHtml(ds.fechaInicio)}</td>
        <td>${escapeHtml(ds.fechaFin)}</td>
        <td>${escapeHtml(String(ds.vigencia || ''))}</td>
        <td>${escapeHtml(ds.semaforo || '')}</td>
        <td>${departamentos}</td>
        <td>${provincias}</td>
        <td>${distritos}</td>
        <td>${ds.esProrroga ? `Prórroga de ${escapeHtml(ds.dsOrigenNumero || '')}` : 'Original'}</td>
        <td>${escapeHtml(ds.cadenaProrroga || '')}</td>
        <td>${escapeHtml(String(ds.nivelProrroga || 0))}</td>
        <td>-</td>
        <td>-</td>
        <td><button type="button" class="btn btn-sm btn-outline-primary" onclick="verDecreto('${ds.id}')">Ver</button></td>
      </tr>
    `;
  }).join('');
}

function renderSelectAccionDs() {
  const sel = $('accionDs');
  if (!sel) return;

  sel.innerHTML = '<option value="">Seleccione...</option>';

  state.decretos
    .slice()
    .sort((a, b) => (a.numero || '').localeCompare(b.numero || ''))
    .forEach(ds => {
      const opt = document.createElement('option');
      opt.value = ds.id;
      opt.textContent = ds.numero;
      sel.appendChild(opt);
    });
}

function verDecreto(id) {
  const ds = state.decretos.find(x => String(x.id) === String(id));
  if (!ds) return;

  const body = $('modalDSBody');
  if (body) {
    body.innerHTML = `
      <div class="mb-2"><strong>DS:</strong> ${escapeHtml(ds.numero)}</div>
      <div class="mb-2"><strong>Peligro:</strong> ${escapeHtml(ds.peligro)}</div>
      <div class="mb-2"><strong>Tipo de peligro:</strong> ${escapeHtml(ds.tipoPeligro)}</div>
      <div class="mb-2"><strong>Plazo:</strong> ${escapeHtml(String(ds.plazoDias))} días</div>
      <div class="mb-2"><strong>Fecha inicio:</strong> ${escapeHtml(ds.fechaInicio)}</div>
      <div class="mb-2"><strong>Fecha final:</strong> ${escapeHtml(ds.fechaFin)}</div>
      <div class="mb-2"><strong>Sectores firmantes:</strong> ${escapeHtml((ds.sectoresFirmantes || []).join(', '))}</div>
      <div class="mb-2"><strong>Territorios:</strong></div>
      <ul>${(ds.territorios || []).map(t => `<li>${escapeHtml(t.departamento)} - ${escapeHtml(t.provincia)} - ${escapeHtml(t.distrito)}</li>`).join('')}</ul>
    `;
  }

  const modalEl = $('modalDS');
  if (modalEl && window.bootstrap) {
    const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
    modal.show();
  }
}

// ================== NORMALIZACION BACKEND -> UI ==================
function normalizarDecretoDesdeBackend(ds) {
  const territorios = Array.isArray(ds.territorio) ? ds.territorio : parseJsonSafe(ds.territorio, []);
  const sectoresFirmantes = Array.isArray(ds.sectores) ? ds.sectores : parseJsonSafe(ds.sectores, []);

  return {
    id: ds.id,
    numero: ds.numero || '',
    anio: ds.anio || '',
    codigoRegistro: ds.codigo_registro || '',
    peligro: ds.peligro || '',
    tipoPeligro: ds.tipo_peligro || '',
    plazoDias: safeNumber(ds.vigencia),
    fechaInicio: ds.fecha_inicio || '',
    fechaFin: ds.fecha_fin || '',
    vigencia: ds.vigencia || '',
    semaforo: ds.semaforo || '',
    motivos: ds.motivos || '',
    territorios: Array.isArray(territorios) ? territorios : [],
    sectoresFirmantes: Array.isArray(sectoresFirmantes) ? sectoresFirmantes : [],
    esProrroga: Number(ds.es_prorroga || 0) === 1,
    dsOrigenId: '',
    dsOrigenNumero: '',
    nivelProrroga: 0,
    cadenaProrroga: '',
    creadoEn: ds.fecha_registro || ''
  };
}

// ================== UBIGEO ==================
function initUbigeo() {
  if (!window.ubigeoData || !Array.isArray(window.ubigeoData)) {
    console.error('ubigeoData no cargó');
    return;
  }

  ubigeoCache = window.ubigeoData;

  cargarDepartamentos();
  renderTerritorioSeleccionado();

  $('selDepartamento')?.addEventListener('change', cargarProvincias);
  $('selProvincia')?.addEventListener('change', cargarDistritos);
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

function normalizarTexto(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase();
}

function obtenerUbigeoRegistro(reg) {
  return reg.ubigeo || reg.UBIGEO || reg.codigo || reg.cod_ubigeo || '';
}

function obtenerClaveTerritorio(reg) {
  const ubigeo = obtenerUbigeoRegistro(reg);
  if (ubigeo) return String(ubigeo);

  return [
    normalizarTexto(reg.departamento),
    normalizarTexto(reg.provincia),
    normalizarTexto(reg.distrito)
  ].join('|');
}

function cargarDepartamentos() {
  const sel = $('selDepartamento');
  if (!sel) return;

  sel.innerHTML = '<option value="">Seleccione...</option>';

  const deps = [...new Set(ubigeoCache.map(x => x.departamento))];
  deps.sort().forEach(dep => {
    const opt = document.createElement('option');
    opt.value = dep;
    opt.textContent = dep;
    sel.appendChild(opt);
  });
}

function cargarProvincias() {
  const dep = $('selDepartamento')?.value || '';
  const selProv = $('selProvincia');
  if (!selProv) return;

  selProv.innerHTML = '<option value="">Seleccione...</option>';

  if (!dep) {
    if ($('distritosChecklist')) {
      $('distritosChecklist').innerHTML = '<div class="text-muted small">Seleccione primero departamento y provincia.</div>';
    }
    return;
  }

  const provincias = [...new Set(
    ubigeoCache
      .filter(x => normalizarTexto(x.departamento) === normalizarTexto(dep))
      .map(x => x.provincia)
  )];

  provincias.sort().forEach(p => {
    const opt = document.createElement('option');
    opt.value = p;
    opt.textContent = p;
    selProv.appendChild(opt);
  });

  if ($('distritosChecklist')) {
    $('distritosChecklist').innerHTML = '<div class="text-muted small">Seleccione una provincia.</div>';
  }

  if ($('buscarDistrito')) $('buscarDistrito').value = '';
}

function cargarDistritos() {
  const dep = $('selDepartamento')?.value || '';
  const prov = $('selProvincia')?.value || '';
  const cont = $('distritosChecklist');
  if (!cont) return;

  if (!dep || !prov) {
    cont.innerHTML = '<div class="text-muted small">Seleccione primero departamento y provincia.</div>';
    return;
  }

  cont.innerHTML = '';
  if ($('buscarDistrito')) $('buscarDistrito').value = '';

  const distritos = ubigeoCache.filter(x =>
    normalizarTexto(x.departamento) === normalizarTexto(dep) &&
    normalizarTexto(x.provincia) === normalizarTexto(prov)
  );

  if (!distritos.length) {
    cont.innerHTML = '<div class="text-muted small">No hay distritos para la selección actual.</div>';
    return;
  }

  distritos.forEach(d => {
    const clave = obtenerClaveTerritorio(d);
    const idSeguro = clave.replace(/[^a-zA-Z0-9_-]/g, '_');

    const yaSeleccionado = state.nuevoDSTerritorios.some(
      t => String(t.clave) === String(clave)
    );

    const div = document.createElement('div');
    div.className = 'form-check';
    div.innerHTML = `
      <input class="form-check-input chk-distrito" type="checkbox" id="dist_${idSeguro}" value="${escapeHtml(clave)}" ${yaSeleccionado ? 'checked' : ''}>
      <label class="form-check-label" for="dist_${idSeguro}">${escapeHtml(d.distrito)}</label>
    `;
    cont.appendChild(div);
  });
}

function filtrarDistritos() {
  const txt = ($('buscarDistrito')?.value || '').trim().toLowerCase();
  const checklist = $('distritosChecklist');
  if (!checklist) return;

  checklist.querySelectorAll('.form-check').forEach(div => {
    div.style.display = div.textContent.toLowerCase().includes(txt) ? '' : 'none';
  });
}

function marcarTodosDistritosVisibles() {
  const checklist = $('distritosChecklist');
  if (!checklist) return;

  [...checklist.querySelectorAll('.form-check')]
    .filter(div => div.style.display !== 'none')
    .forEach(div => {
      const chk = div.querySelector('input[type="checkbox"]');
      if (chk) chk.checked = true;
    });
}

function limpiarChecksDistritos(silencioso = false) {
  const checklist = $('distritosChecklist');
  if (checklist) {
    checklist.querySelectorAll('input[type="checkbox"]').forEach(chk => chk.checked = false);
  }

  if (!silencioso) {
    if ($('buscarDistrito')) $('buscarDistrito').value = '';
    filtrarDistritos();
  }
}

function agregarDistritosSeleccionados() {
  const checklist = $('distritosChecklist');
  if (!checklist) return;

  const checks = checklist.querySelectorAll('input[type="checkbox"]:checked');

  if (!checks.length) {
    alert('Seleccione al menos un distrito para agregar.');
    renderTerritorioSeleccionado();
    return;
  }

  let agregados = 0;

  checks.forEach(chk => {
    const data = ubigeoCache.find(x => String(obtenerClaveTerritorio(x)) === String(chk.value));
    if (!data) return;

    const clave = obtenerClaveTerritorio(data);

    const existe = state.nuevoDSTerritorios.some(
      t => String(t.clave) === String(clave)
    );
    if (existe) return;

    state.nuevoDSTerritorios.push({
      clave,
      ubigeo: obtenerUbigeoRegistro(data),
      departamento: data.departamento,
      provincia: data.provincia,
      distrito: data.distrito,
      latitud: data.latitud ?? data.lat ?? '',
      longitud: data.longitud ?? data.lng ?? ''
    });

    agregados += 1;
  });

  renderTerritorioSeleccionado();

  if (agregados === 0) {
    alert('Los distritos marcados ya estaban agregados.');
  } else {
    limpiarChecksDistritos(true);
    cargarDistritos();
  }
}

function quitarTerritorioSeleccionado(clave) {
  state.nuevoDSTerritorios = state.nuevoDSTerritorios.filter(
    t => String(t.clave) !== String(clave)
  );

  renderTerritorioSeleccionado();
  cargarDistritos();
}

function renderTerritorioSeleccionado() {
  const cont = $('territorioSeleccionado');
  if (!cont) return;

  if (!state.nuevoDSTerritorios.length) {
    cont.innerHTML = '<div class="text-muted">No hay territorios agregados.</div>';
    return;
  }

  cont.innerHTML = state.nuevoDSTerritorios.map(t => `
    <div class="d-flex justify-content-between align-items-start gap-2 border rounded bg-white px-2 py-1 mb-2">
      <div>
        <div><strong>${escapeHtml(t.departamento)}</strong> - ${escapeHtml(t.provincia)} - ${escapeHtml(t.distrito)}</div>
        <div class="text-muted small">Ubigeo: ${escapeHtml(String(t.ubigeo || ''))}</div>
      </div>
      <button type="button" class="btn btn-sm btn-outline-danger" onclick="quitarTerritorioSeleccionado('${String(t.clave).replace(/'/g, "\\'")}')">Quitar</button>
    </div>
  `).join('');
}

// ================== HELPERS ==================
function toDateInputValue(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function structuredCloneSafe(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function cryptoRandomId() {
  if (window.crypto?.randomUUID) {
    return crypto.randomUUID();
  }
  return 'id-' + Date.now() + '-' + Math.random().toString(16).slice(2);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function parseJsonSafe(value, fallback) {
  try {
    if (value == null || value === '') return fallback;
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function safeNumber(value) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : 0;
}

// ================== RENDER ==================
function renderAll() {
  renderSesion();
  renderSectoresFirmantes();
  renderTerritorioSeleccionado();
  renderTablaDecretos();
  actualizarOrigenesProrroga();
  renderSelectAccionDs();
  applyRolePermissions();
  console.log('Sistema cargado', state);
}