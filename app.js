
const STORAGE_KEY = 'dee_midis_local_v4';
const CUSTOM_USERS_KEY = 'dee_midis_custom_users_v1';
const USER_META_KEY = 'dee_midis_user_meta_v1';
const AUDIT_LOG_KEY = 'dee_midis_audit_log_v1';
const CONFLICT_LOG_KEY = 'dee_midis_conflict_log_v1';
const USERS = [
  {email:'admin@midis.gob.pe', password:'AdminMIDIS2026!', role:'Administrador', name:'Administrador MIDIS'},
  {email:'evaluador@midis.gob.pe', password:'Evaluador2026!', role:'Evaluador', name:'Evaluador MIDIS'},
  {email:'registrador@midis.gob.pe', password:'Registrador2026!', role:'Registrador', name:'Registrador MIDIS'},
  {email:'consulta@midis.gob.pe', password:'Consulta2026!', role:'Consulta', name:'Consulta MIDIS'},
  {email:'registrador@cunamas.gob.pe', password:'CunaMas2026!', role:'Registrador', name:'Registrador Cuna Más', programa:'CUNA MÁS'},
  {email:'registrador@pae.gob.pe', password:'PAE2026!', role:'Registrador', name:'Registrador PAE', programa:'PAE'},
  {email:'registrador@juntos.gob.pe', password:'Juntos2026!', role:'Registrador', name:'Registrador Juntos', programa:'JUNTOS'},
  {email:'registrador@contigo.gob.pe', password:'Contigo2026!', role:'Registrador', name:'Registrador Contigo', programa:'CONTIGO'},
  {email:'registrador@pension65.gob.pe', password:'Pension652026!', role:'Registrador', name:'Registrador Pensión 65', programa:'PENSIÓN 65'},
  {email:'registrador@foncodes.gob.pe', password:'Foncodes2026!', role:'Registrador', name:'Registrador Foncodes', programa:'FONCODES'},
  {email:'registrador@pais.gob.pe', password:'Pais2026!', role:'Registrador', name:'Registrador PAIS', programa:'PAIS'}
];
const SECTORES = ['MINAM','MIDAGRI','MINCETUR','MINCUL','MINDEF','MEF','MINEDU','MINEM','MININTER','MINJUSDH','MIMP','PRODUCE','RREE','MINSA','MTPE','MTC','MVCS','MIDIS'];
const PROGRAMAS_NACIONALES = ['CUNA MÁS','PAE','JUNTOS','CONTIGO','PENSIÓN 65','FONCODES','PAIS'];

const REUNIONES = ['Primera Reunión','Segunda Reunión','Tercera Reunión','Cuarta Reunión','Quinta Reunión','Sexta Reunión','Séptima Reunión','Octava Reunión','Novena Reunión','Décima Reunión'];
let currentAccionContext = null;
let editingAccionId = null;

const state = {
  session: null,
  decretos: [],
  acciones: [],
  territorioActual: [],
  map: null,
  markers: [],
  customUsers: [],
  userMeta: {},
  auditLog: [],
  conflictLog: [],
  generatedPassword: '',
  dashboardDsSelected: [],
  dashboardDsTouched: false
};

const $ = (id) => document.getElementById(id);

function setRegistroAccionesEvaluadorView(enabled){
  const keepIds = new Set(['accionDs','accionReunion','accionFechaReunion']);
  const keepAll = isPreApproveMode() && (state.session?.role === 'Administrador' || state.session?.role === 'Evaluador');
  const allFieldIds = ['accionDs','accionReunion','accionFechaReunion','accionPrograma','accionTipo','accionCodigo','accionDetalle','accionUnidad','accionMetaProg','accionPlazo','accionFechaInicio','accionFechaFinal','accionMetaEj','accionAvance','accionDescripcion','accionFechaRegistro'];
  allFieldIds.forEach(id=>{
    const el = $(id);
    const group = el ? el.closest('.col-md-1, .col-md-2, .col-md-3, .col-md-4, .col-md-8, .col-md-9, .col-md-12') : null;
    if(group) group.classList.toggle('d-none', enabled && !keepAll && !keepIds.has(id));
  });
  const btnGuardar = $('btnGuardarAccion');
  const btnPre = $('btnPreaprobarAccion');
  const btnApr = $('btnAprobarAccion');
  const btnCancel = $('btnCancelarEdicionAccion');
  if(btnGuardar) btnGuardar.classList.toggle('d-none', false);
  if(btnPre) btnPre.classList.toggle('d-none', enabled && !keepAll);
  if(btnApr) btnApr.classList.toggle('d-none', enabled && !keepAll);
  if(btnCancel) btnCancel.classList.toggle('d-none', true);
  const tablaWrap = $('tablaAcciones') ? $('tablaAcciones').closest('.table-responsive') : null;
  if(tablaWrap) tablaWrap.classList.toggle('d-none', enabled && !keepAll);
  const hr = tablaWrap ? tablaWrap.previousElementSibling : null;
  if(hr && hr.tagName === 'HR') hr.classList.toggle('d-none', enabled && !keepAll);
}

function getAllUsers(){
  return USERS.concat(Array.isArray(state.customUsers) ? state.customUsers : []).map(u => applyUserMeta(u));
}

function applyUserMeta(user){
  const meta = state.userMeta && state.userMeta[user.email] ? state.userMeta[user.email] : {};
  return {...user, password: meta.password || user.password, active: meta.active !== false};
}

function loadCustomUsers(){
  try{
    const raw = localStorage.getItem(CUSTOM_USERS_KEY);
    state.customUsers = raw ? JSON.parse(raw) : [];
    if(!Array.isArray(state.customUsers)) state.customUsers = [];
  }catch(e){ state.customUsers = []; }
  try{ state.userMeta = JSON.parse(localStorage.getItem(USER_META_KEY) || '{}') || {}; }catch(e){ state.userMeta = {}; }
  try{ state.auditLog = JSON.parse(localStorage.getItem(AUDIT_LOG_KEY) || '[]') || []; if(!Array.isArray(state.auditLog)) state.auditLog=[]; }catch(e){ state.auditLog=[]; }
  try{ state.conflictLog = JSON.parse(localStorage.getItem(CONFLICT_LOG_KEY) || '[]') || []; if(!Array.isArray(state.conflictLog)) state.conflictLog=[]; }catch(e){ state.conflictLog=[]; }
}

function persistAdminData(){
  localStorage.setItem(CUSTOM_USERS_KEY, JSON.stringify(state.customUsers || []));
  localStorage.setItem(USER_META_KEY, JSON.stringify(state.userMeta || {}));
  localStorage.setItem(AUDIT_LOG_KEY, JSON.stringify(state.auditLog || []));
  localStorage.setItem(CONFLICT_LOG_KEY, JSON.stringify(state.conflictLog || []));
}

function saveCustomUsers(){
  persistAdminData();
}

function getProgramaByEmail(email){
  const value = String(email || '').toLowerCase();
  const found = getAllUsers().find(u => String(u.email || '').toLowerCase() === value);
  return found && found.programa ? found.programa : '';
}


function getProgramaSession(){
  return state.session ? getProgramaByEmail(state.session.email) : '';
}

function buildResumenDS(ds){
  if(!ds) return '<div class="text-muted">No hay Decreto Supremo activo.</div>';
  const territorio = Array.isArray(ds.territorio) ? ds.territorio : [];
  const deps = new Set(territorio.map(t => t.departamento)).size;
  const provs = new Set(territorio.map(t => `${t.departamento}|${t.provincia}`)).size;
  const dists = new Set(territorio.map(t => `${t.departamento}|${t.provincia}|${t.distrito}`)).size;
  return `
    <div><strong>Decreto Supremo activo:</strong> ${escapeHtml(ds.numero || '')}</div>
    <div><strong>Inicio:</strong> ${escapeHtml(ds.fechaInicio || '')} | <strong>Final:</strong> ${escapeHtml(ds.fechaFin || '')} | <strong>Vigencia:</strong> ${escapeHtml(computeVigencia(ds.fechaFin || ''))}</div>
    <div><strong>Territorio:</strong> ${deps} departamento(s), ${provs} provincia(s), ${dists} distrito(s)</div>
    <div><strong>Exposición de Motivos:</strong> ${escapeHtml(ds.motivos || 'Sin información')}</div>
  `;
}

function renderResumenDSActivo(){
  const box = $('resumenDSActivo');
  if(!box) return;
  const role = state.session ? state.session.role : '';
  if(role !== 'Registrador'){
    box.classList.add('d-none');
    box.innerHTML = '';
    return;
  }
  const dsId = (currentAccionContext && currentAccionContext.dsId) || $('accionDs')?.value || '';
  const ds = getDecretoById(dsId);
  if(!ds){
    box.classList.add('d-none');
    box.innerHTML = '';
    return;
  }
  box.classList.remove('d-none');
  box.innerHTML = buildResumenDS(ds);
}


function getUbigeoData(){
  try{
    if(Array.isArray(window.ubigeoData)) return window.ubigeoData;
  }catch(e){}
  try{
    if(typeof ubigeoData !== 'undefined' && Array.isArray(ubigeoData)) return ubigeoData;
  }catch(e){}
  return [];
}



function syncEstadoRdsEvaluador(){
  getSelectedDashboardDecretos().forEach(ds => {
    if(getActiveConvocatoria(ds)){
      ds.rdsBloqueadoEvaluador = !convocatoriaCompleta(ds);
    }else{
      ds.rdsBloqueadoEvaluador = false;
    }
  });
}

document.addEventListener('DOMContentLoaded', init);

function init(){
  loadStorage();
  loadCustomUsers();
  syncEstadoRdsEvaluador();
  renderSectores();
  loadDepartamentos();
  wireLogin();
  wireGeneral();
  wireNuevoDS();
  wireAcciones();
  wireAdminUsers();
  applyRoleUI();
  renderAll();
}

function loadStorage(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(raw){
      const parsed = JSON.parse(raw);
      state.decretos = Array.isArray(parsed.decretos) ? parsed.decretos : [];
      state.acciones = Array.isArray(parsed.acciones) ? parsed.acciones : [];
    }
  }catch(e){}
}

function saveStorage(){
  localStorage.setItem(STORAGE_KEY, JSON.stringify({decretos: state.decretos, acciones: state.acciones}));
}

function wireLogin(){
  $('btnLogin').addEventListener('click', doLogin);
  $('btnLogout').addEventListener('click', ()=>{
    state.session = null;
    $('appView').classList.add('d-none');
    $('loginView').classList.remove('d-none');
    $('loginPass').value = '';
    $('loginMsg').textContent = '';
    currentAccionContext = null;
  });
}

function doLogin(){
  const email = ($('loginUser').value || '').trim().toLowerCase();
  const pass = $('loginPass').value || '';
  const user = getAllUsers().find(u => u.email === email && u.password === pass);
  if(!user || user.active === false){
    $('loginMsg').textContent = 'Usuario o password incorrecto.';
    return;
  }
  state.session = user;
  $('sessionName').textContent = user.name;
  $('sessionRole').textContent = user.role;
  $('loginView').classList.add('d-none');
  $('appView').classList.remove('d-none');
  $('loginMsg').textContent = '';
  applyRoleUI();
  renderAll();
}

function applyRoleUI(){
  const role = state.session ? state.session.role : '';
  document.querySelectorAll('.admin-only').forEach(el => {
    el.classList.toggle('hidden-by-role', role !== 'Administrador');
  });
  const adminBtn = $('btnAdminPanel');
  if(adminBtn){
    adminBtn.classList.toggle('hidden-by-role', role !== 'Administrador');
    adminBtn.textContent = 'Administrador';
  }
  if($('sessionRole')) $('sessionRole').classList.toggle('d-none', role === 'Administrador');

  const tabNuevoBtn = $('btnTabNuevo') || document.querySelector('[data-bs-target="#tabNuevo"]');
  if(tabNuevoBtn){
    const hideNuevo = role === 'Registrador' || role === 'Consulta';
    const tabItem = tabNuevoBtn.closest('li') || tabNuevoBtn.parentElement;
    if(tabItem) tabItem.classList.toggle('d-none', hideNuevo);
    if(hideNuevo && tabNuevoBtn.classList.contains('active')){
      const tabListadoBtn = document.querySelector('[data-bs-target="#tabListado"]');
      if(tabListadoBtn && window.bootstrap){
        bootstrap.Tab.getOrCreateInstance(tabListadoBtn).show();
      }
    }
  }

  const bloqueAcciones = $('accionesRoleMsg');
  if(!state.session){
    bloqueAcciones.classList.add('d-none');
    return;
  }

  const canRegister = role === 'Administrador' || role === 'Evaluador' || role === 'Registrador';
  ['btnGuardarDS','btnGuardarAccion'].forEach(id=>{
    const el = $(id);
    if(el) el.disabled = !canRegister && id !== 'btnGuardarAccion';
  });

  $('btnPreaprobarAccion').disabled = !(role === 'Administrador' || role === 'Evaluador');
  $('btnAprobarAccion').disabled = !(role === 'Administrador');

  renderAdminUsers();

  if(role === 'Consulta'){
    bloqueAcciones.classList.remove('d-none');
    bloqueAcciones.textContent = 'Rol Consulta: solo visualización.';
  }else if(role !== 'Evaluador' && role !== 'Registrador'){
    bloqueAcciones.classList.add('d-none');
  }
  applyActionMode();
}


function wireGeneral(){
  $('btnExportListadoExcel').addEventListener('click', exportListadoCSV);
  $('btnPrintListado').addEventListener('click', ()=>window.print());
  if($('btnAdminPanel')) $('btnAdminPanel').addEventListener('click', ()=>openAdminPanel('usuarios'));
  if($('btnVerAuditoria')) $('btnVerAuditoria').addEventListener('click', renderAuditoria);
  if($('btnLimpiarAuditoria')) $('btnLimpiarAuditoria').addEventListener('click', clearAuditoria);
  if($('btnLimpiarConflictos')) $('btnLimpiarConflictos').addEventListener('click', clearConflictos);
  document.querySelectorAll('[data-bs-toggle="tab"]').forEach(btn => {
    btn.addEventListener('shown.bs.tab', (ev)=>{
      if(String(ev.target?.getAttribute('data-bs-target') || '') === '#tabDashboard' && state.map){
        setTimeout(()=>state.map.invalidateSize(), 0);
      }
    });
  });
}

function wireNuevoDS(){
  if($('dsAnio')) $('dsAnio').value = new Date().getFullYear();
  refreshCodigoRegistro();
  if($('dsAnio')) $('dsAnio').addEventListener('input', refreshCodigoRegistro);
  if($('dsFechaInicio')) $('dsFechaInicio').addEventListener('change', updateFechaFinal);
  if($('dsEsProrroga')) $('dsEsProrroga').addEventListener('change', onToggleProrroga);
  if($('dsOrigen')) $('dsOrigen').addEventListener('change', syncRelacionFields);

  if($('selDepartamento')) $('selDepartamento').addEventListener('change', onDepartamentoChange);
  if($('selProvincia')) $('selProvincia').addEventListener('change', renderDistrictChecklist);
  if($('buscarDistrito')) $('buscarDistrito').addEventListener('input', renderDistrictChecklist);
  if($('btnMarcarTodos')) $('btnMarcarTodos').addEventListener('click', ()=>toggleDistrictChecks(true));
  if($('btnLimpiarChecks')) $('btnLimpiarChecks').addEventListener('click', ()=>toggleDistrictChecks(false));
  if($('btnAgregarDistritos')) $('btnAgregarDistritos').addEventListener('click', addSelectedDistricts);
  if($('btnGuardarDS')) $('btnGuardarDS').addEventListener('click', saveDecreto);
}

function wireAcciones(){
  $('accionFechaRegistro').value = todayText();
  $('btnGuardarAccion').addEventListener('click', saveAccion('Registrado'));
  $('btnPreaprobarAccion').addEventListener('click', saveAccion('Pre aprobado'));
  $('btnAprobarAccion').addEventListener('click', saveAccion('Aprobado'));
  $('accionDs').addEventListener('change', ()=>{
    if(state.session?.role === 'Evaluador'){
      currentAccionContext = { dsId: $('accionDs').value || '' };
      applyActionMode();
    }
  });
}



function wireAdminUsers(){
  if($('btnCrearUsuarioAdmin')) $('btnCrearUsuarioAdmin').addEventListener('click', createAdminUser);
  if($('btnCopiarClaveAdmin')) $('btnCopiarClaveAdmin').addEventListener('click', ()=>copyText(($('adminGeneratedPassword')?.value || '').trim(), 'Clave copiada'));
}

function parseAdminRole(value){
  const [role, programa] = String(value || '').split('|');
  return {role: role || 'Consulta', programa: programa || ''};
}

function createAdminUser(){
  if(!state.session || state.session.role !== 'Administrador') return;
  const name = String($('adminUserName')?.value || '').trim();
  const email = String($('adminUserEmail')?.value || '').trim().toLowerCase();
  const roleValue = $('adminUserRole')?.value || 'Consulta';
  const parsed = parseAdminRole(roleValue);
  if(!name || !email){ alert('Complete Nombre y Apellidos y Correo.'); return; }
  if(getAllUsers().some(u => String(u.email || '').toLowerCase() === email)){
    addConflictLog({codigo: email, motivo: 'duplicate_user_email', fechaServidor: new Date().toISOString(), estadoLocalServidor: 'local=creación / servidor=existente', resolucionAplicada: 'pendiente'});
    alert('Ese correo ya existe.');
    renderConflictos();
    return;
  }
  const password = generatePassword();
  const newUser = {email, password, role: parsed.role, name, programa: parsed.programa || undefined};
  state.customUsers.push(newUser);
  state.userMeta[email] = {active: true, password};
  state.generatedPassword = password;
  if($('adminGeneratedPassword')) $('adminGeneratedPassword').value = password;
  persistAdminData();
  addAuditLog(state.session.email, 'Crear usuario', `${email} | ${parsed.role}${parsed.programa ? ' | '+parsed.programa : ''}`);
  $('adminUserName').value=''; $('adminUserEmail').value='';
  renderAdminUsers();
  renderAuditoria();
  alert('Usuario creado correctamente.');
}

function renderAdminUsers(){
  const tbody = $('tablaAdminUsuarios') ? document.querySelector('#tablaAdminUsuarios tbody') : $('tablaUsuariosProgramaBody');
  if(!tbody) return;
  const users = getAllUsers();
  if(!users.length){
    tbody.innerHTML = '<tr><td colspan="5" class="text-muted">No hay usuarios registrados.</td></tr>';
    return;
  }
  tbody.innerHTML = users.map(u => {
    const rolTexto = u.role === 'Registrador' && u.programa ? `Registrador (${u.programa})` : u.role;
    const estado = u.active === false ? 'Inactivo' : 'Activo';
    const btnToggle = `<button class="btn btn-sm btn-outline-${u.active === false ? 'success' : 'warning'}" onclick="toggleUserStatus('${u.email}')">${u.active === false ? 'Activar' : 'Desactivar'}</button>`;
    const btnReset = `<button class="btn btn-sm btn-outline-primary" onclick="resetUserPassword('${u.email}')">Reset clave</button>`;
    return `<tr><td>${escapeHtml(u.name || '')}</td><td>${escapeHtml(u.email || '')}</td><td>${escapeHtml(rolTexto)}</td><td><span class="badge ${u.active === false ? 'text-bg-secondary' : 'text-bg-success'}">${estado}</span></td><td class="d-flex gap-1 flex-wrap">${btnToggle}${btnReset}</td></tr>`;
  }).join('');
}

function updateAccionFechaFinal(){
  const plazoEl = $('accionPlazo');
  const iniEl = $('accionFechaInicio');
  const finEl = $('accionFechaFinal');
  if(!plazoEl || !iniEl || !finEl) return;
  const plazo = parseInt(plazoEl.value || '', 10);
  const inicio = iniEl.value;
  if(!inicio || !Number.isFinite(plazo)){
    finEl.value = '';
    return;
  }
  const d = new Date(`${inicio}T00:00:00`);
  d.setDate(d.getDate() + plazo);
  finEl.value = toDateInput(d);
}

function getDecretoById(id){
  return state.decretos.find(x => x.id === id) || null;
}

function getActiveConvocatoria(ds){
  return ds && ds.convocatoriaAcciones && ds.convocatoriaAcciones.activa ? ds.convocatoriaAcciones : null;
}

function getAccionesByConvocatoria(dsId, reunion, fechaReunion){
  return state.acciones.filter(a => a.dsId === dsId && a.reunion === reunion && a.fechaReunion === fechaReunion);
}

function decretoTieneAlerta(ds){
  if(!ds) return false;
  const conv = getActiveConvocatoria(ds);
  if(!conv) return false;
  return getAccionesByConvocatoria(ds.id, conv.reunion, conv.fechaReunion).length === 0;
}


function programasPendientesConvocatoria(ds){
  if(!ds) return PROGRAMAS_NACIONALES.slice();
  const conv = getActiveConvocatoria(ds);
  if(!conv) return PROGRAMAS_NACIONALES.slice();
  const registrados = new Set(
    getAccionesByConvocatoria(ds.id, conv.reunion, conv.fechaReunion)
      .map(a => String(a.programa || '').trim().toUpperCase())
      .filter(Boolean)
  );
  return PROGRAMAS_NACIONALES.filter(p => !registrados.has(String(p).trim().toUpperCase()));
}

function convocatoriaCompleta(ds){
  if(!ds) return false;
  const conv = getActiveConvocatoria(ds);
  if(!conv) return false;
  return programasPendientesConvocatoria(ds).length === 0;
}

function accionesPorDecreto(dsId){
  return state.acciones.filter(a => a.dsId === dsId);
}

function dsTienePendientePreAprobar(dsId){
  return accionesPorDecreto(dsId).some(a => String(a.estado || '') === 'Registrado');
}

function dsTienePendienteAprobar(dsId){
  return accionesPorDecreto(dsId).some(a => String(a.estado || '') === 'Pre aprobado');
}

function dsTienePendienteFlujo(dsId){
  const rows = accionesPorDecreto(dsId);
  return rows.length > 0 && rows.some(a => String(a.estado || '') !== 'Aprobado');
}

function isPreApproveMode(){
  return !!(currentAccionContext && currentAccionContext.preApproveMode);
}

function renderPreAprobarResumen(){
  const box = $('preAprobarResumen');
  if(!box) return;
  const role = state.session ? state.session.role : '';
  if(!(role === 'Administrador' || role === 'Evaluador') || !isPreApproveMode()){
    box.classList.add('d-none');
    box.innerHTML = '';
    return;
  }
  const dsId = (currentAccionContext && currentAccionContext.dsId) || $('accionDs').value || '';
  const ds = getDecretoById(dsId);
  const rows = accionesPorDecreto(dsId);
  const registradas = rows.filter(a => String(a.estado || '') === 'Registrado').length;
  const preaprobadas = rows.filter(a => String(a.estado || '') === 'Pre aprobado').length;
  const aprobadas = rows.filter(a => String(a.estado || '') === 'Aprobado').length;
  box.classList.remove('d-none');
  box.innerHTML = `<strong>${escapeHtml(ds ? ds.numero : '')}</strong> | Total acciones: ${rows.length} | Registradas: ${registradas} | Pre aprobadas: ${preaprobadas} | Aprobadas: ${aprobadas}`;
}

function openPreApproveMode(dsId){
  currentAccionContext = { dsId: dsId, preApproveMode: true };
  editingAccionId = null;
  if($('accionDs')) $('accionDs').value = dsId;
  const ds = getDecretoById(dsId);
  const conv = getActiveConvocatoria(ds);
  if(conv){
    if($('accionReunion')) $('accionReunion').value = conv.reunion || '';
    if($('accionFechaReunion')) $('accionFechaReunion').value = conv.fechaReunion || '';
  }
  clearActionDetailFields();
  if($('accionFechaRegistro')) $('accionFechaRegistro').value = todayText();
}

function loadAccionForEdit(accionId){
  const item = state.acciones.find(a => a.id === accionId);
  if(!item) return;
  editingAccionId = accionId;
  $('accionDs').value = item.dsId || '';
  $('accionReunion').value = item.reunion || '';
  $('accionFechaReunion').value = item.fechaReunion || '';
  $('accionPrograma').value = item.programa || '';
  $('accionTipo').value = item.tipo || '';
  $('accionCodigo').value = item.codigo || '';
  $('accionDetalle').value = item.detalle || '';
  $('accionUnidad').value = item.unidad || '';
  $('accionMetaProg').value = item.metaProgramada || '';
  $('accionPlazo').value = item.plazo || '';
  $('accionFechaInicio').value = item.fechaInicio || '';
  $('accionFechaFinal').value = item.fechaFinal || '';
  $('accionMetaEj').value = item.metaEjecutada || '';
  $('accionAvance').value = item.avance || '';
  $('accionDescripcion').value = item.descripcion || '';
  $('accionFechaRegistro').value = item.fechaRegistro || todayText();
  applyActionMode();
}

function clearActionDetailFields(){
  ['accionPrograma','accionTipo','accionCodigo','accionDetalle','accionUnidad','accionMetaProg','accionPlazo','accionFechaInicio','accionFechaFinal','accionMetaEj','accionAvance','accionDescripcion'].forEach(id=>{
    const el = $(id);
    if(!el) return;
    if(el.tagName === 'SELECT') el.selectedIndex = 0;
    else el.value = '';
  });
}

function setFieldsDisabled(ids, disabled){
  ids.forEach(id=>{ const el=$(id); if(el) el.disabled = !!disabled; });
}

function applyActionMode(){
  const role = state.session ? state.session.role : '';
  const msg = $('accionesRoleMsg');
  const ds = getDecretoById($('accionDs').value || (currentAccionContext && currentAccionContext.dsId));
  const convocatoria = ds ? getActiveConvocatoria(ds) : null;
  const detailIds = ['accionPrograma','accionTipo','accionCodigo','accionDetalle','accionUnidad','accionMetaProg','accionPlazo','accionFechaInicio','accionFechaFinal','accionMetaEj','accionAvance','accionDescripcion'];

  $('btnGuardarAccion').classList.remove('d-none');
  $('btnPreaprobarAccion').classList.remove('d-none');
  $('btnAprobarAccion').classList.remove('d-none');
  setRegistroAccionesEvaluadorView(role === 'Evaluador');

  if(role === 'Evaluador' && !isPreApproveMode()){
    msg.classList.remove('d-none');
    msg.className = 'alert alert-info mt-2';
    msg.textContent = 'Evaluador: seleccione el Decreto Supremo, registre el Número de Reunión, la Fecha de Reunión y pulse Activar registro.';
    $('btnGuardarAccion').textContent = 'Activar registro';
    $('btnGuardarAccion').disabled = false;
    $('btnPreaprobarAccion').classList.add('d-none');
    $('btnAprobarAccion').classList.add('d-none');
    const dsBloqueadoEvaluador = !!(currentAccionContext && currentAccionContext.dsId);
    setFieldsDisabled(['accionDs'], dsBloqueadoEvaluador);
    setFieldsDisabled(['accionReunion','accionFechaReunion'], false);
    if(dsBloqueadoEvaluador && $('accionDs')) $('accionDs').value = currentAccionContext.dsId;
    setFieldsDisabled(detailIds, true);
    renderPreAprobarResumen();
    $('accionFechaRegistro').value = todayText();
    return;
  }

  if((role === 'Evaluador' || role === 'Administrador') && isPreApproveMode()){
    msg.classList.remove('d-none');
    msg.className = 'alert alert-info mt-2';
    msg.textContent = role === 'Administrador'
      ? 'Administrador: revise todas las acciones del Decreto Supremo, modifique el texto si corresponde y apruebe el conjunto.'
      : 'Evaluador: revise todas las acciones del Decreto Supremo, modifique el texto si corresponde y pre apruebe el conjunto.';
    $('btnGuardarAccion').textContent = 'Grabar';
    $('btnGuardarAccion').disabled = !editingAccionId;
    $('btnPreaprobarAccion').classList.remove('d-none');
    $('btnPreaprobarAccion').textContent = 'Pre aprobar';
    $('btnPreaprobarAccion').disabled = !dsTienePendientePreAprobar(($('accionDs').value || ''));
    $('btnAprobarAccion').classList.toggle('d-none', role !== 'Administrador');
    $('btnAprobarAccion').textContent = 'Aprobar';
    $('btnAprobarAccion').disabled = role !== 'Administrador' ? true : !dsTienePendienteAprobar(($('accionDs').value || ''));
    setFieldsDisabled(['accionDs','accionReunion','accionFechaReunion'], true);
    setFieldsDisabled(detailIds, !editingAccionId);
    renderPreAprobarResumen();
    $('accionFechaRegistro').value = $('accionFechaRegistro').value || todayText();
    return;
  }

  if(role === 'Registrador'){
    $('btnGuardarAccion').textContent = 'Guardar acción';
    $('btnPreaprobarAccion').classList.add('d-none');
    $('btnAprobarAccion').classList.add('d-none');
    const programaSesion = state.session?.programa || getProgramaByEmail(state.session?.email);
    if(programaSesion && $('accionPrograma')) $('accionPrograma').value = programaSesion;
    if(convocatoria){
      $('accionDs').value = ds.id;
      $('accionReunion').value = convocatoria.reunion;
      $('accionFechaReunion').value = convocatoria.fechaReunion;
      setFieldsDisabled(['accionDs','accionReunion','accionFechaReunion'], true);
      setFieldsDisabled(detailIds, false);
      if(programaSesion) setFieldsDisabled(['accionPrograma'], true);
      if($('accionFechaFinal')) $('accionFechaFinal').readOnly = true;
      msg.classList.remove('d-none');
      msg.className = 'alert alert-danger mt-2';
      msg.textContent = `Alerta: debe registrar acciones de programas para ${ds.numero} | ${convocatoria.reunion} | ${convocatoria.fechaReunion}.`;
    }else{
      setFieldsDisabled(['accionDs'], false);
      setFieldsDisabled(['accionReunion','accionFechaReunion'], true);
      setFieldsDisabled(detailIds, true);
      msg.classList.remove('d-none');
      msg.className = 'alert alert-warning mt-2';
      msg.textContent = 'Registrador: primero el Evaluador debe activar el registro desde el botón RDS.';
    }
    $('accionFechaRegistro').value = todayText();
    updateAccionFechaFinal();
    return;
  }

  $('btnGuardarAccion').textContent = 'Guardar acción';
  setFieldsDisabled(['accionDs','accionReunion','accionFechaReunion'], false);
  setFieldsDisabled(detailIds, false);
  if(role === 'Administrador'){
    msg.classList.add('d-none');
    $('btnPreaprobarAccion').classList.remove('d-none');
    $('btnAprobarAccion').classList.remove('d-none');
  } else if(role === 'Consulta') {
    msg.classList.remove('d-none');
    msg.className = 'alert alert-warning mt-2';
    msg.textContent = 'Rol Consulta: solo visualización.';
    setFieldsDisabled(['accionDs','accionReunion','accionFechaReunion'].concat(detailIds), true);
    $('btnGuardarAccion').disabled = true;
    $('btnPreaprobarAccion').disabled = true;
    $('btnAprobarAccion').disabled = true;
  } else {
    msg.classList.add('d-none');
  }
}

function renderSectores(){
  $('sectoresContainer').innerHTML = SECTORES.map(sec => `
    <div class="col-md-3 col-sm-4 col-6 sector-chip">
      <label><input class="form-check-input me-2" type="checkbox" name="sectorFirma" value="${escapeHtml(sec)}">${escapeHtml(sec)}</label>
    </div>
  `).join('');
}

function loadDepartamentos(){
  const deps = [...new Set(getUbigeoData().map(x=>x.departamento))].sort();
  $('selDepartamento').innerHTML = '<option value="">Seleccione...</option>' + deps.map(d=>`<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join('');
  $('selProvincia').innerHTML = '<option value="">Seleccione...</option>';
}

function updateFechaFinal(){
  const start = $('dsFechaInicio').value;
  if(!start){
    $('dsFechaFin').value = '';
    $('dsVigencia').value = '';
    if($('dsSemaforo')) $('dsSemaforo').value = '';
    return;
  }
  const d = new Date(`${start}T00:00:00`);
  d.setDate(d.getDate()+60);
  $('dsFechaFin').value = toDateInput(d);
  $('dsVigencia').value = computeVigencia($('dsFechaFin').value);
  if($('dsSemaforo')) $('dsSemaforo').value = getSemaforo($('dsFechaFin').value).label;
}

function computeVigencia(fechaFin){
  if(!fechaFin) return '';
  const hoy = startOfDay(new Date());
  const fin = startOfDay(new Date(`${fechaFin}T00:00:00`));
  return fin >= hoy ? 'Vigente' : 'No vigente';
}

function getSemaforo(fechaFin){
  const hoy = startOfDay(new Date());
  const fin = startOfDay(new Date(`${fechaFin}T00:00:00`));
  const diff = Math.ceil((fin - hoy)/(1000*60*60*24));
  if(diff <= 15) return {label:'Rojo', cls:'badge-sem-rojo'};
  if(diff <= 30) return {label:'Ámbar', cls:'badge-sem-ambar'};
  return {label:'Verde', cls:'badge-sem-verde'};
}

function onToggleProrroga(){
  $('dsOrigen').disabled = !$('dsEsProrroga').checked;
  if(!$('dsEsProrroga').checked){
    if($('dsOrigen')) $('dsOrigen').value = '';
  }
  syncRelacionFields();
  refreshCodigoRegistro();
}


function refreshOrigenOptions(){
  $('dsOrigen').innerHTML = '<option value="">Seleccione...</option>' + state.decretos
    .map(ds => `<option value="${escapeHtml(ds.id)}">${escapeHtml(ds.numero)} | ${escapeHtml(ds.cadenaId)}</option>`).join('');
}

function syncRelacionFields(){
  if(!$('dsEsProrroga').checked){
    if($('dsNivelProrroga')) $('dsNivelProrroga').value = '0';
    const numero = ($('dsNumero').value || 'SINNUM').trim();
    const anio = ($('dsAnio').value || new Date().getFullYear()).trim();
    $('dsCadena').value = buildCadenaId(numero, anio);
    return;
  }
  const origen = state.decretos.find(x => x.id === $('dsOrigen').value);
  if(!origen){
    $('dsNivelProrroga').value = '';
    if($('dsCadena')) $('dsCadena').value = '';
    return;
  }
  $('dsNivelProrroga').value = String((origen.nivelProrroga || 0) + 1);
  $('dsCadena').value = origen.cadenaId;
}

function onDepartamentoChange(){
  const dep = $('selDepartamento').value;
  if($('buscarDistrito')) $('buscarDistrito').value = '';
  if(!dep){
    $('selProvincia').innerHTML = '<option value="">Seleccione...</option>';
    $('distritosChecklist').innerHTML = '';
    return;
  }
  const provincias = [...new Set(getUbigeoData().filter(x => x.departamento === dep).map(x => x.provincia))].sort();
  $('selProvincia').innerHTML = '<option value="">Seleccione...</option>' + provincias.map(p => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join('');
  renderDistrictChecklist();
}

function renderDistrictChecklist(){
  const dep = $('selDepartamento').value;
  const prov = $('selProvincia').value;
  const text = (($('buscarDistrito') ? $('buscarDistrito').value : '') || '').trim().toUpperCase();
  if(!dep || !prov){
    $('distritosChecklist').innerHTML = '<div class="text-muted small">Seleccione primero departamento y provincia.</div>';
    return;
  }
  const rows = getUbigeoData().filter(x => x.departamento === dep && x.provincia === prov && (!text || x.distrito.toUpperCase().includes(text)));
  if(!rows.length){
    $('distritosChecklist').innerHTML = '<div class="text-muted small">No hay distritos para ese filtro.</div>';
    return;
  }
  $('distritosChecklist').innerHTML = rows.map((r, idx) => `
    <div class="form-check border rounded p-2 mb-2 bg-white">
      <input class="form-check-input distrito-check" type="checkbox" id="dist_${idx}" data-key="${escapeHtml(makeTerritorioKey(r))}">
      <label class="form-check-label w-100" for="dist_${idx}">
        <strong>${escapeHtml(r.distrito)}</strong><br>
        <small class="text-muted">Lat: ${r.lat} | Lon: ${r.lon}</small>
      </label>
    </div>
  `).join('');
}

function toggleDistrictChecks(value){
  document.querySelectorAll('.distrito-check').forEach(ch => ch.checked = value);
}

function addSelectedDistricts(){
  const dep = $('selDepartamento').value;
  const prov = $('selProvincia').value;
  if(!dep || !prov) return;
  const sourceRows = getUbigeoData().filter(x => x.departamento === dep && x.provincia === prov);
  const byKey = new Map(sourceRows.map(x => [makeTerritorioKey(x), x]));
  document.querySelectorAll('.distrito-check:checked').forEach(ch => {
    const row = byKey.get(ch.dataset.key);
    if(!row) return;
    if(!state.territorioActual.some(t => makeTerritorioKey(t) === makeTerritorioKey(row))){
      state.territorioActual.push({
        departamento: row.departamento,
        provincia: row.provincia,
        distrito: row.distrito,
        lat: row.lat,
        lon: row.lon
      });
    }
  });
  toggleDistrictChecks(false);
  renderTerritorioSeleccionado();
}

function renderTerritorioSeleccionado(){
  const box = $('territorioSeleccionado');
  if(!state.territorioActual.length){
    box.innerHTML = '<div class="text-muted">No hay territorios agregados.</div>';
    return;
  }
  box.innerHTML = state.territorioActual.map((t, idx) => `
    <div class="selected-territorio">
      <div><strong>${escapeHtml(t.departamento)}</strong> / ${escapeHtml(t.provincia)} / ${escapeHtml(t.distrito)}</div>
      <div class="text-muted">Lat: ${t.lat} | Lon: ${t.lon}</div>
      <button class="btn btn-sm btn-outline-danger mt-2" onclick="removeTerritorio(${idx})">Quitar</button>
    </div>
  `).join('');
}
window.removeTerritorio = function(idx){
  state.territorioActual.splice(idx,1);
  renderTerritorioSeleccionado();
};

function saveDecreto(){
  if(!state.session || state.session.role === 'Consulta'){
    alert('Tu rol no puede registrar decretos.');
    return;
  }
  const numero = ($('dsNumero').value || '').trim();
  const anio = ($('dsAnio').value || '').trim();
  const peligro = $('dsPeligro') ? $('dsPeligro').value : '';
  const tipoPeligro = $('dsTipoPeligro') ? $('dsTipoPeligro').value : '';
  const fechaInicio = $('dsFechaInicio').value;
  const fechaFin = $('dsFechaFin').value;
  const motivos = ($('dsMotivos').value || '').trim();
  const sectores = [...document.querySelectorAll('input[name="sectorFirma"]:checked')].map(x=>x.value);

  if(!numero || !anio || !fechaInicio || !fechaFin){
    alert('Completa número, año, fecha de inicio y fecha final.');
    return;
  }
  if(!state.territorioActual.length){
    alert('Agrega al menos un distrito.');
    return;
  }
  if(!sectores.length){
    alert('Selecciona al menos un sector que firma.');
    return;
  }

  const esProrroga = $('dsEsProrroga') ? $('dsEsProrroga').checked : false;
  const origen = esProrroga && $('dsOrigen') ? state.decretos.find(x => x.id === $('dsOrigen').value) : null;
  if(esProrroga && !origen){
    alert('Selecciona el DS de origen inmediato.');
    return;
  }

  const decreto = {
    id: (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())),
    codigoRegistro: ($('dsCodigoRegistro')?.value || nextCodigoRegistro(anio)),
    numero,
    anio,
    peligro,
    tipoPeligro,
    fechaInicio,
    fechaFin,
    vigencia: computeVigencia(fechaFin),
    semaforo: getSemaforo(fechaFin).label,
    motivos,
    sectores,
    territorio: JSON.parse(JSON.stringify(state.territorioActual)),
    esProrroga,
    dsOrigenId: origen ? origen.id : null,
    dsOrigenNumero: origen ? origen.numero : null,
    nivelProrroga: origen ? (origen.nivelProrroga || 0) + 1 : 0,
    cadenaId: origen ? origen.cadenaId : buildCadenaId(numero, anio),
    usuarioRegistro: state.session.email,
    fechaRegistro: new Date().toISOString()
  };

  state.decretos.push(decreto);
  saveStorage();
  addAuditLog(state.session?.email || 'sistema', 'Crear Decreto Supremo', `${decreto.codigoRegistro} | ${decreto.numero}`);
  resetNuevoDS();
  refreshOrigenOptions();
  renderAll();
  alert('Decreto Supremo guardado correctamente.');
}

function resetNuevoDS(){
  $('dsNumero').value = '';
  $('dsAnio').value = new Date().getFullYear();
  if($('dsPeligro')) $('dsPeligro').value = '';
  if($('dsTipoPeligro')) $('dsTipoPeligro').value = '';
  $('dsFechaInicio').value = '';
  $('dsFechaFin').value = '';
  $('dsVigencia').value = '';
  if($('dsSemaforo')) $('dsSemaforo').value = '';
  $('dsMotivos').value = '';
  if($('dsEsProrroga')) $('dsEsProrroga').checked = false;
  if($('dsOrigen')) $('dsOrigen').value = '';
  if($('dsOrigen')) $('dsOrigen').disabled = true;
  if($('dsNivelProrroga')) $('dsNivelProrroga').value = '0';
  if($('dsCadena')) $('dsCadena').value = '';
  $('selDepartamento').value = '';
  $('selProvincia').innerHTML = '<option value="">Seleccione...</option>';
  if($('buscarDistrito')) $('buscarDistrito').value = '';
  $('distritosChecklist').innerHTML = '<div class="text-muted small">Seleccione primero departamento y provincia.</div>';
  document.querySelectorAll('input[name="sectorFirma"]').forEach(ch => ch.checked = false);
  state.territorioActual = [];
  renderTerritorioSeleccionado();
  syncRelacionFields();
  refreshCodigoRegistro();
}


function saveAccion(estadoObjetivo){
  return function(){
    if(!state.session || state.session.role === 'Consulta'){
      alert('Tu rol no puede registrar acciones.');
      return;
    }

    const dsId = $('accionDs').value;
    const ds = state.decretos.find(x => x.id === dsId);
    if(!ds){
      alert('Selecciona un Decreto Supremo.');
      return;
    }

    if(isPreApproveMode() && (state.session.role === 'Evaluador' || state.session.role === 'Administrador')){
      if(estadoObjetivo === 'Registrado'){
        if(!editingAccionId){
          alert('Seleccione una acción para modificar.');
          return;
        }
        const idx = state.acciones.findIndex(x => x.id === editingAccionId);
        if(idx < 0){
          alert('No se encontró la acción a modificar.');
          return;
        }
        const original = state.acciones[idx];
        state.acciones[idx] = {
          ...original,
          codigo: $('accionCodigo').value || '',
          detalle: $('accionDetalle').value || '',
          unidad: $('accionUnidad').value || '',
          metaProgramada: $('accionMetaProg').value || '',
          plazo: $('accionPlazo').value || '',
          fechaInicio: $('accionFechaInicio').value || '',
          fechaFinal: $('accionFechaFinal').value || '',
          metaEjecutada: $('accionMetaEj').value || '',
          avance: $('accionAvance').value || '',
          descripcion: $('accionDescripcion').value || '',
          tipo: $('accionTipo').value || '',
          editadoPor: state.session.email,
          editadoEn: new Date().toISOString()
        };
        editingAccionId = null;
        clearActionDetailFields();
        saveStorage();
        renderAcciones();
        renderLista();
        renderPreAprobarResumen();
        addAuditLog(state.session?.email || 'sistema', 'Modificar acción', `${original.dsId} | ${original.codigo || ''}`);
        alert('Cambios grabados correctamente.');
        return;
      }
      if(editingAccionId){
        alert('Primero grabe los cambios de la acción que está modificando.');
        return;
      }
      if(estadoObjetivo === 'Pre aprobado'){
        state.acciones = state.acciones.map(a => a.dsId === dsId ? {...a, estado:'Pre aprobado', preAprobadoPor: state.session.email, preAprobadoEn: new Date().toISOString()} : a);
        saveStorage();
        renderAcciones();
        renderLista();
        renderPreAprobarResumen();
        addAuditLog(state.session?.email || 'sistema', 'Pre aprobar acciones', ds.numero);
        alert('Las acciones del Decreto Supremo fueron pre aprobadas.');
        return;
      }
      if(estadoObjetivo === 'Aprobado' && state.session.role === 'Administrador'){
        state.acciones = state.acciones.map(a => a.dsId === dsId ? {...a, estado:'Aprobado', aprobadoPor: state.session.email, aprobadoEn: new Date().toISOString()} : a);
        saveStorage();
        renderAcciones();
        renderLista();
        renderPreAprobarResumen();
        addAuditLog(state.session?.email || 'sistema', 'Aprobar acciones', ds.numero);
        alert('Las acciones del Decreto Supremo fueron aprobadas.');
        return;
      }
    }

    if(state.session.role === 'Evaluador'){
      const reunion = ($('accionReunion').value || '').trim();
      const fechaReunion = $('accionFechaReunion').value || '';
      if(!REUNIONES.map(x=>x.toLowerCase()).includes(reunion.toLowerCase())){
        alert('Seleccione un Número de Reunión válido.');
        return;
      }
      if(!fechaReunion){
        alert('Ingrese la Fecha de Reunión.');
        return;
      }
      ds.convocatoriaAcciones = {
        activa: true,
        reunion,
        fechaReunion,
        activadoPor: state.session.email,
        activadoEn: new Date().toISOString()
      };
      ds.rdsBloqueadoEvaluador = true;
      saveStorage();
      currentAccionContext = { dsId: ds.id };
      renderAll();
      const tab = document.querySelector('[data-bs-target="#tabListado"]');
      bootstrap.Tab.getOrCreateInstance(tab).show();
      alert('Registro de acciones activado para el Registrador.');
      return;
    }

    if(estadoObjetivo === 'Pre aprobado' && !(state.session.role === 'Evaluador' || state.session.role === 'Administrador')){
      alert('Solo Evaluador o Administrador pueden pre aprobar.');
      return;
    }
    if(estadoObjetivo === 'Aprobado' && state.session.role !== 'Administrador'){
      alert('Solo Administrador puede aprobar.');
      return;
    }

    if(state.session.role === 'Registrador'){
      const conv = getActiveConvocatoria(ds);
      if(!conv){
        alert('Este Decreto Supremo no tiene registro activado por el Evaluador.');
        return;
      }
      $('accionReunion').value = conv.reunion;
      $('accionFechaReunion').value = conv.fechaReunion;
    }

    const item = {
      id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
      dsId,
      dsNumero: ds.numero,
      reunion: $('accionReunion').value || '',
      fechaReunion: $('accionFechaReunion').value || '',
      programa: ((state.session?.role === 'Registrador' && (state.session?.programa || getProgramaByEmail(state.session?.email))) ? (state.session.programa || getProgramaByEmail(state.session.email)) : ($('accionPrograma').value || '')), 
      tipo: $('accionTipo').value || '',
      codigo: $('accionCodigo').value || '',
      detalle: $('accionDetalle').value || '',
      unidad: $('accionUnidad').value || '',
      metaProgramada: $('accionMetaProg').value || '',
      plazo: $('accionPlazo').value || '',
      fechaInicio: $('accionFechaInicio').value || '',
      fechaFinal: $('accionFechaFinal').value || '',
      metaEjecutada: $('accionMetaEj').value || '',
      avance: $('accionAvance').value || '',
      descripcion: $('accionDescripcion').value || '',
      fechaRegistro: todayText(),
      creadoEn: new Date().toISOString(),
      estado: estadoObjetivo,
      usuario: state.session.email
    };

    if(state.session.role === 'Registrador'){
      const required = ['programa','tipo','codigo','detalle','unidad','metaProgramada','plazo','fechaInicio','fechaFinal','metaEjecutada','avance','descripcion'];
      const missing = required.filter(k => !String(item[k] || '').trim());
      if(missing.length){
        alert('Complete todos los campos de la acción antes de guardar.');
        return;
      }
    }

    state.acciones.push(item);

    if(ds){
      ds.rdsBloqueadoEvaluador = !convocatoriaCompleta(ds);
    }

    saveStorage();
    $('accionFechaRegistro').value = todayText();
    clearActionDetailFields();
    renderAcciones();
    renderLista();
    renderSeguimiento();
    renderDashboard();
    addAuditLog(state.session?.email || 'sistema', 'Registrar acción', `${ds.numero} | ${estadoObjetivo}`);
    alert(`Acción ${estadoObjetivo.toLowerCase()} correctamente.`);
  }
}

function renderLista(){
  const tbody = document.querySelector('#tablaDS tbody');
  const decretos = getSelectedDashboardDecretos();
  if(!decretos.length){
    tbody.innerHTML = '<tr><td colspan="17" class="text-muted">No hay decretos registrados.</td></tr>';
    return;
  }
  tbody.innerHTML = decretos.map(ds => {
    const counts = uniqueCounts(ds.territorio);
    const sem = getSemaforo(ds.fechaFin);
    const prorrogas = state.decretos.filter(x => x.cadenaId === ds.cadenaId).length - 1;
    const canReview = state.session?.role === 'Administrador' || state.session?.role === 'Evaluador';
    const preBtn = canReview ? `<button class="btn btn-sm btn-outline-success${dsTienePendienteFlujo(ds.id) ? ' blink-soft' : ''}" onclick="openPreaprobarDS('${ds.id}')">PreAprobar</button>` : '';
    return `
      <tr>
        <td><strong>${escapeHtml(ds.numero)}</strong><div class="small text-muted">${escapeHtml(ds.codigoRegistro || '')}</div></td>
        <td>${escapeHtml(ds.anio)}</td>
        <td>${escapeHtml(ds.peligro)}</td>
        <td>${escapeHtml(ds.tipoPeligro)}</td>
        <td>${ds.fechaInicio}</td>
        <td>${ds.fechaFin}</td>
        <td><span class="badge ${computeVigencia(ds.fechaFin)==='Vigente' ? 'text-bg-danger':'text-bg-success'}">${computeVigencia(ds.fechaFin)}</span></td>
        <td><span class="badge ${sem.cls}">${sem.label}</span></td>
        <td>${counts.departamentos}</td>
        <td>${counts.provincias}</td>
        <td>${counts.distritos}</td>
        <td>${ds.esProrroga ? 'Prórroga de ' + escapeHtml(ds.dsOrigenNumero || '') : 'Decreto base'}</td>
        <td>${escapeHtml(ds.cadenaId)}</td>
        <td>${Math.max(0, prorrogas)}</td>
        <td>${state.session?.role === 'Registrador' && decretoTieneAlerta(ds) ? '<span class="badge text-bg-danger me-1">Alerta</span>' : ''}${state.session?.role === 'Evaluador' && getActiveConvocatoria(ds) && !convocatoriaCompleta(ds) ? '<span class="badge text-bg-warning text-dark me-1">En registro</span>' : ''}<button class="btn btn-sm btn-outline-primary" onclick="goAcciones('${ds.id}')" ${state.session?.role === 'Evaluador' && getActiveConvocatoria(ds) && !convocatoriaCompleta(ds) ? 'disabled' : ''}>RDS</button></td>
        <td>${preBtn}</td>
        <td><button class="btn btn-sm btn-outline-secondary" onclick="viewDS('${ds.id}')">👁</button></td>
      </tr>
    `;
  }).join('');
}
window.goAcciones = function(id){
  currentAccionContext = { dsId: id };
  $('accionDs').value = id;
  const ds = getDecretoById(id);
  if(state.session?.role === 'Registrador' && ds && !getActiveConvocatoria(ds)){
    alert('Este Decreto Supremo aún no ha sido activado por el Evaluador para registrar acciones.');
    return;
  }
  if(state.session?.role === 'Registrador' && ds && getActiveConvocatoria(ds)){
    const conv = getActiveConvocatoria(ds);
    $('accionReunion').value = conv.reunion;
    $('accionFechaReunion').value = conv.fechaReunion;
  }
  applyActionMode();
  renderResumenDSActivo();
  renderAcciones();
  const tab = document.querySelector('[data-bs-target="#tabAcciones"]');
  bootstrap.Tab.getOrCreateInstance(tab).show();
};
window.openPreaprobarDS = function(id){
  openPreApproveMode(id);
  renderAcciones();
  applyActionMode();
  const tab = document.querySelector('[data-bs-target="#tabAcciones"]');
  bootstrap.Tab.getOrCreateInstance(tab).show();
};
window.editAccion = function(id){
  loadAccionForEdit(id);
};
window.viewDS = function(id){
  const ds = state.decretos.find(x => x.id === id);
  if(!ds) return;
  const counts = uniqueCounts(ds.territorio);
  $('modalDSBody').innerHTML = `
    <div class="mb-2"><strong>Decreto Supremo:</strong> ${escapeHtml(ds.numero)}</div>
    <div class="mb-2"><strong>Código de registro:</strong> ${escapeHtml(ds.codigoRegistro || '')}</div>
    <div class="mb-2"><strong>Peligro:</strong> ${escapeHtml(ds.peligro)}</div>
    <div class="mb-2"><strong>Tipo de peligro:</strong> ${escapeHtml(ds.tipoPeligro)}</div>
    <div class="mb-2"><strong>Inicio:</strong> ${ds.fechaInicio} | <strong>Final:</strong> ${ds.fechaFin}</div>
    <div class="mb-2"><strong>Vigencia:</strong> ${computeVigencia(ds.fechaFin)}</div>
    <div class="mb-2"><strong>Relación:</strong> ${ds.esProrroga ? 'Prórroga de ' + escapeHtml(ds.dsOrigenNumero || '') : 'Decreto base'}</div>
    <div class="mb-2"><strong>Cadena:</strong> ${escapeHtml(ds.cadenaId)} | <strong>Nivel:</strong> ${ds.nivelProrroga}</div>
    <div class="mb-2"><strong>Territorio:</strong> ${counts.departamentos} departamentos, ${counts.provincias} provincias, ${counts.distritos} distritos</div>
    <div class="mb-2"><strong>Sectores que firman:</strong> ${escapeHtml(ds.sectores.join(', '))}</div>
    <div class="mb-2"><strong>Exposición de Motivos:</strong><br>${escapeHtml(ds.motivos || '').replace(/\n/g,'<br>')}</div>
    <hr>
    <div class="small"><strong>Distritos:</strong><br>${ds.territorio.map(t => `${escapeHtml(t.departamento)} / ${escapeHtml(t.provincia)} / ${escapeHtml(t.distrito)} (Lat ${t.lat}, Lon ${t.lon})`).join('<br>')}</div>
  `;
  bootstrap.Modal.getOrCreateInstance($('modalDS')).show();
};


function renderAcciones(){
  const prev = (currentAccionContext && currentAccionContext.dsId) || $('accionDs').value || '';
  $('accionDs').innerHTML = '<option value="">Seleccione...</option>' + state.decretos.map(ds => `<option value="${escapeHtml(ds.id)}">${escapeHtml(ds.numero)}</option>`).join('');
  if(prev) $('accionDs').value = prev;

  renderResumenDSActivo();
  renderPreAprobarResumen();

  const tbody = document.querySelector('#tablaAcciones tbody');
  const wrap = $('tablaAccionesWrap');
  const role = state.session ? state.session.role : '';
  const programaSession = getProgramaSession();
  let rows = state.acciones.slice();

  if(role === 'Registrador'){
    const dsId = (currentAccionContext && currentAccionContext.dsId) || $('accionDs').value || '';
    rows = rows.filter(a => (!dsId || a.dsId === dsId) && (!programaSession || a.programa === programaSession));
    if(wrap) wrap.classList.remove('d-none');
  } else if(isPreApproveMode() && (role === 'Administrador' || role === 'Evaluador')){
    const dsId = (currentAccionContext && currentAccionContext.dsId) || $('accionDs').value || '';
    rows = rows.filter(a => !dsId || a.dsId === dsId);
    if(wrap) wrap.classList.remove('d-none');
  }

  if(!rows.length){
    tbody.innerHTML = '<tr><td colspan="9" class="text-muted">No hay acciones registradas.</td></tr>';
    applyActionMode();
    return;
  }

  tbody.innerHTML = rows.map(a => {
    const canReview = isPreApproveMode() && (role === 'Administrador' || role === 'Evaluador');
    return `
      <tr>
        <td>${escapeHtml(a.dsNumero || '')}</td>
        <td>${escapeHtml(a.programa || '')}</td>
        <td>${escapeHtml(a.tipo || '')}</td>
        <td>${escapeHtml(a.codigo || '')}</td>
        <td>${escapeHtml(a.detalle || '')}</td>
        <td>${escapeHtml(a.estado || '')}</td>
        <td>${escapeHtml(a.usuario || '')}</td>
        <td>${escapeHtml(a.fechaRegistro || '')}</td>
        <td>${canReview ? `<button class="btn btn-sm btn-outline-primary" onclick="editAccion('${a.id}')">Modificar</button>` : ''}</td>
      </tr>
    `;
  }).join('');
  applyActionMode();
}

function syncDashboardSelection(){
  const validIds = new Set(state.decretos.map(ds => ds.id));
  let selected = Array.isArray(state.dashboardDsSelected) ? state.dashboardDsSelected.filter(id => validIds.has(id)) : [];
  if(!selected.length && !state.dashboardDsTouched) selected = state.decretos.map(ds => ds.id);
  state.dashboardDsSelected = selected;
}

function getSelectedDashboardDecretos(){
  syncDashboardSelection();
  const selected = new Set(state.dashboardDsSelected || []);
  return state.decretos.filter(ds => selected.has(ds.id));
}

function renderMapControls(){
  const box = $('mapDashboardControls');
  if(!box) return;
  syncDashboardSelection();
  if(!state.decretos.length){
    box.innerHTML = '<div class="text-muted">No hay Decretos Supremos para mostrar en el mapa.</div>';
    return;
  }
  const selected = new Set(state.dashboardDsSelected || []);
  const chips = state.decretos.map((ds, idx) => {
    const active = selected.has(ds.id);
    const color = pickColor(idx);
    return `<button type="button" class="map-ds-chip ${active ? 'active' : ''}" style="${active ? `background:${color};border-color:${color};` : `border-color:${color};box-shadow: inset 0 0 0 1px ${color};`}" onclick="toggleDashboardDs('${ds.id}')">${escapeHtml(ds.numero || '')}</button>`;
  }).join('');
  box.innerHTML = `<div class="map-ds-toolbar mb-2"><button type="button" class="btn btn-sm btn-outline-secondary" onclick="selectAllDashboardDs()">Marcar todos</button><button type="button" class="btn btn-sm btn-outline-secondary" onclick="clearDashboardDs()">Limpiar</button></div><div class="map-ds-toolbar">${chips}</div><div class="map-ds-help mt-2">Cada botón activa o desactiva los puntos georreferenciados del Decreto Supremo y actualiza el resumen del Dashboard.</div>`;
}

function renderDashboard(){
  syncDashboardSelection();
  renderMapControls();
  renderMap();
  renderStats();
  renderResumenDashboard();
  renderDepartamentosDashboard();
  renderDistritosRepetidosDashboard();
  renderAlertasDashboard();
  renderSlaUsuariosDashboard();
  renderRankingProgramasDashboard();
}

function renderMap(){
  const selected = getSelectedDashboardDecretos();
  if(!state.map){
    state.map = L.map('mapDashboard').setView([-9.19, -75.02], 5);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {maxZoom: 18, attribution: '&copy; OpenStreetMap'}).addTo(state.map);
  }
  state.markers.forEach(m => state.map.removeLayer(m));
  state.markers = [];
  const bounds = [];
  selected.forEach((ds, idx) => {
    (Array.isArray(ds.territorio) ? ds.territorio : []).forEach(t => {
      const lat = Number(t.lat), lon = Number(t.lon);
      if(!Number.isFinite(lat) || !Number.isFinite(lon)) return;
      const color = pickColor(idx);
      const marker = L.circleMarker([lat, lon], {
        radius: 6,
        color,
        fillColor: color,
        fillOpacity: .8,
        weight: 2
      }).addTo(state.map).bindPopup(`<strong>${escapeHtml(ds.numero)}</strong><br>${escapeHtml(t.departamento)} / ${escapeHtml(t.provincia)} / ${escapeHtml(t.distrito)}`);
      state.markers.push(marker);
      bounds.push([lat, lon]);
    });
  });
  if(bounds.length) state.map.fitBounds(bounds, {padding:[20,20]});
  else state.map.setView([-9.19, -75.02], 5);
  setTimeout(()=>state.map.invalidateSize(), 0);
}

function renderStats(){
  const grid = $('statsGrid');
  if(!grid) return;
  const decretos = getSelectedDashboardDecretos();
  const vigentes = decretos.filter(ds => computeVigencia(ds.fechaFin) === 'Vigente');
  const uniqueDep = new Set();
  const uniqueProv = new Set();
  const uniqueDist = new Set();
  const repeatCount = {};
  decretos.forEach(ds => (Array.isArray(ds.territorio) ? ds.territorio : []).forEach(t => {
    uniqueDep.add(t.departamento);
    uniqueProv.add(`${t.departamento}|${t.provincia}`);
    const key = makeTerritorioKey(t);
    uniqueDist.add(key);
    repeatCount[key] = (repeatCount[key] || 0) + 1;
  }));
  const repetidos = Object.values(repeatCount).filter(v => v > 1).length;
  const porVencer = vigentes.filter(ds => daysRemaining(ds.fechaFin) <= 15).length;
  const alertas = buildAlertasCOE();
  const sla = buildSlaUsuariosRows();
  const criticos = sla.filter(r => r.estadoKey === 'critico').length;
  const inicioMasAntiguo = decretos.length ? [...decretos].sort((a,b)=>a.fechaInicio.localeCompare(b.fechaInicio))[0].fechaInicio : '-';
  grid.innerHTML = [
    statCard('Declaratorias vigentes', vigentes.length),
    statCard('Departamentos únicos', uniqueDep.size),
    statCard('Provincias únicas', uniqueProv.size),
    statCard('Distritos únicos', uniqueDist.size),
    statCard('Distritos repetidos', repetidos),
    statCard('DS por vencer (<15 días)', porVencer),
    statCard('Alertas COE activas', alertas.length),
    statCard('Usuarios SLA crítico', criticos),
    statCard('Inicio más antiguo', inicioMasAntiguo)
  ].join('');
}

function renderResumenDashboard(){
  const tbody = document.querySelector('#tablaResumenDashboard tbody');
  const decretos = getSelectedDashboardDecretos();
  if(!decretos.length){
    tbody.innerHTML = '<tr><td colspan="8" class="text-muted">No hay datos.</td></tr>';
    return;
  }
  tbody.innerHTML = decretos.map(ds => {
    const counts = uniqueCounts(ds.territorio);
    const sem = getSemaforo(ds.fechaFin);
    return `
      <tr>
        <td>${escapeHtml(ds.numero)}</td>
        <td>${ds.fechaInicio}</td>
        <td>${ds.fechaFin}</td>
        <td>${daysRemaining(ds.fechaFin)}</td>
        <td><span class="badge ${sem.cls}">${sem.label}</span></td>
        <td>${counts.departamentos}</td>
        <td>${counts.provincias}</td>
        <td>${counts.distritos}</td>
      </tr>
    `;
  }).join('');
}


function parseDateTimeSafe(value){
  if(!value) return null;
  const raw = String(value).trim();
  if(!raw) return null;
  if(/^\d{4}-\d{2}-\d{2}$/.test(raw)) return new Date(`${raw}T00:00:00`);
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function hoursBetween(startValue, endValue=new Date()){
  const start = parseDateTimeSafe(startValue);
  const end = parseDateTimeSafe(endValue) || new Date(endValue);
  if(!start || !end || Number.isNaN(end.getTime())) return null;
  return Math.max(0, (end.getTime() - start.getTime()) / 3600000);
}

function formatHours(value){
  if(value === null || value === undefined || !Number.isFinite(value)) return '-';
  return value.toFixed(1);
}

function badgeByHours(hours){
  if(hours === null || hours === undefined || !Number.isFinite(hours)) return {label:'Sin dato', cls:'text-bg-secondary'};
  if(hours >= 24) return {label:'Rojo', cls:'sla-critico'};
  if(hours >= 8) return {label:'Ámbar', cls:'sla-observado'};
  return {label:'Verde', cls:'sla-ok'};
}

function getActionsForConvocatoriaAndPrograma(dsId, conv, programa){
  if(!conv) return [];
  return state.acciones.filter(a => a.dsId === dsId && a.reunion === conv.reunion && a.fechaReunion === conv.fechaReunion && String(a.programa || '').trim().toUpperCase() === String(programa || '').trim().toUpperCase());
}

function buildAlertasCOE(){
  const rows = [];
  getSelectedDashboardDecretos().forEach(ds => {
    const conv = getActiveConvocatoria(ds);
    if(!conv) return;
    const pendientes = programasPendientesConvocatoria(ds);
    if(!pendientes.length) return;
    const horas = hoursBetween(conv.activadoEn || `${conv.fechaReunion || todayText()}T00:00:00`, new Date());
    const tone = badgeByHours(horas);
    rows.push({
      dsNumero: ds.numero,
      reunion: conv.reunion || '-',
      pendientes,
      activadoEn: conv.activadoEn || conv.fechaReunion || '-',
      horas,
      alerta: tone.label,
      cls: tone.cls
    });
  });
  return rows.sort((a,b) => (b.horas || 0) - (a.horas || 0));
}

function renderAlertasDashboard(){
  const tbody = document.querySelector('#tablaAlertasDashboard tbody');
  if(!tbody) return;
  const rows = buildAlertasCOE();
  if(!rows.length){
    tbody.innerHTML = '<tr><td colspan="6" class="text-muted">No hay alertas automáticas activas. Todos los programas convocados registraron información.</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map(r => `
    <tr>
      <td>${escapeHtml(r.dsNumero)}</td>
      <td>${escapeHtml(r.reunion)}</td>
      <td>${escapeHtml(r.pendientes.join(', '))}</td>
      <td>${escapeHtml(formatDateTime(r.activadoEn))}</td>
      <td>${formatHours(r.horas)}</td>
      <td><span class="badge ${r.cls}">${escapeHtml(r.alerta)}</span></td>
    </tr>
  `).join('');
}

function buildDepartamentosResumen(){
  const map = new Map();
  getSelectedDashboardDecretos().forEach(ds => {
    (Array.isArray(ds.territorio) ? ds.territorio : []).forEach(t => {
      const dep = String(t.departamento || '').trim();
      if(!dep) return;
      if(!map.has(dep)) map.set(dep, {departamento: dep, provincias: new Set(), distritos: new Set(), decretos: new Set()});
      const row = map.get(dep);
      row.provincias.add(`${dep}|${t.provincia}`);
      row.distritos.add(makeTerritorioKey(t));
      row.decretos.add(ds.numero);
    });
  });
  return [...map.values()].map(r => ({
    departamento: r.departamento,
    provincias: r.provincias.size,
    distritos: r.distritos.size,
    decretos: [...r.decretos].sort()
  })).sort((a,b)=>a.departamento.localeCompare(b.departamento));
}

function renderDepartamentosDashboard(){
  const tbody = document.querySelector('#tablaDepartamentosDashboard tbody');
  if(!tbody) return;
  const rows = buildDepartamentosResumen();
  if(!rows.length){
    tbody.innerHTML = '<tr><td colspan="4" class="text-muted">No hay datos.</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map(r => `
    <tr>
      <td>${escapeHtml(r.departamento)}</td>
      <td>${r.provincias}</td>
      <td>${r.distritos}</td>
      <td>${escapeHtml(r.decretos.join(', '))}</td>
    </tr>
  `).join('');
}

function normalizeText(value){
  return String(value || '').trim().toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function makeTerritorioKeyNormalized(t){
  return `${normalizeText(t.departamento)}|${normalizeText(t.provincia)}|${normalizeText(t.distrito)}`;
}

function collectRepeatedVigenteDistricts(){
  const map = new Map();
  getSelectedDashboardDecretos().filter(ds => computeVigencia(ds.fechaFin) === 'Vigente').forEach(ds => {
    const uniqueDistricts = new Map();
    (Array.isArray(ds.territorio) ? ds.territorio : []).forEach(t => uniqueDistricts.set(makeTerritorioKeyNormalized(t), t));
    uniqueDistricts.forEach((t, key) => {
      if(!map.has(key)) map.set(key, {departamento: t.departamento, provincia: t.provincia, distrito: t.distrito, decretos: new Set()});
      map.get(key).decretos.add(ds.numero);
    });
  });
  return [...map.values()]
    .filter(r => r.decretos.size > 1)
    .map(r => ({departamento: r.departamento, provincia: r.provincia, distrito: r.distrito, veces: r.decretos.size, decretos: [...r.decretos].sort()}))
    .sort((a,b)=> `${a.departamento}|${a.provincia}|${a.distrito}`.localeCompare(`${b.departamento}|${b.provincia}|${b.distrito}`));
}

function renderDistritosRepetidosDashboard(){
  const tbody = document.querySelector('#tablaDistritosRepetidosDashboard tbody');
  if(!tbody) return;
  const rows = collectRepeatedVigenteDistricts();
  if(!rows.length){
    tbody.innerHTML = '<tr><td colspan="5" class="text-muted">No hay distritos repetidos en más de una declaratoria vigente.</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map(r => `
    <tr>
      <td>${escapeHtml(r.departamento)}</td>
      <td>${escapeHtml(r.provincia)}</td>
      <td>${escapeHtml(r.distrito)}</td>
      <td>${r.veces}</td>
      <td>${escapeHtml(r.decretos.join(', '))}</td>
    </tr>
  `).join('');
}

function buildSlaUsuariosRows(){
  const registradores = getAllUsers().filter(u => u.role === 'Registrador' && u.programa);
  return registradores.map(u => {
    const convocatorias = [];
    getSelectedDashboardDecretos().forEach(ds => {
      const conv = getActiveConvocatoria(ds);
      if(!conv) return;
      const acciones = getActionsForConvocatoriaAndPrograma(ds.id, conv, u.programa);
      const firstAction = acciones.slice().sort((a,b) => String(a.creadoEn || a.fechaRegistro || '').localeCompare(String(b.creadoEn || b.fechaRegistro || '')))[0] || null;
      const horas = hoursBetween(conv.activadoEn || `${conv.fechaReunion || todayText()}T00:00:00`, firstAction ? (firstAction.creadoEn || firstAction.fechaRegistro) : new Date());
      convocatorias.push({pendiente: !firstAction, horas});
    });
    const total = convocatorias.length;
    const registradas = convocatorias.filter(c => !c.pendiente).length;
    const pendientes = convocatorias.filter(c => c.pendiente).length;
    const horasRegistradas = convocatorias.filter(c => !c.pendiente && Number.isFinite(c.horas)).map(c => c.horas);
    const promedio = horasRegistradas.length ? horasRegistradas.reduce((a,b)=>a+b,0)/horasRegistradas.length : null;
    const mayor = convocatorias.length ? Math.max(...convocatorias.map(c => Number.isFinite(c.horas) ? c.horas : 0)) : null;
    let estadoKey = 'ok';
    if(pendientes > 0 || (mayor !== null && mayor >= 24)) estadoKey = 'critico';
    else if((promedio !== null && promedio >= 8) || pendientes > 0) estadoKey = 'observado';
    const estado = estadoKey === 'critico' ? 'Crítico' : (estadoKey === 'observado' ? 'Observado' : 'OK');
    const cls = estadoKey === 'critico' ? 'sla-critico' : (estadoKey === 'observado' ? 'sla-observado' : 'sla-ok');
    return {usuario: u.email, programa: u.programa, total, registradas, pendientes, promedio, mayor, estado, cls, estadoKey};
  }).filter(r => r.total > 0).sort((a,b) => {
    const order = {critico: 0, observado: 1, ok: 2};
    return order[a.estadoKey] - order[b.estadoKey] || (b.mayor || 0) - (a.mayor || 0) || a.programa.localeCompare(b.programa);
  });
}

function renderSlaUsuariosDashboard(){
  const tbody = document.querySelector('#tablaSlaUsuariosDashboard tbody');
  if(!tbody) return;
  const rows = buildSlaUsuariosRows();
  if(!rows.length){
    tbody.innerHTML = '<tr><td colspan="8" class="text-muted">No hay convocatorias activas para medir SLA por usuario.</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map(r => `
    <tr>
      <td>${escapeHtml(r.usuario)}</td>
      <td>${escapeHtml(r.programa)}</td>
      <td>${r.total}</td>
      <td>${r.registradas}</td>
      <td>${r.pendientes}</td>
      <td>${formatHours(r.promedio)}</td>
      <td>${formatHours(r.mayor)}</td>
      <td><span class="badge ${r.cls}">${escapeHtml(r.estado)}</span></td>
    </tr>
  `).join('');
}

function buildRankingProgramas(){
  const base = PROGRAMAS_NACIONALES.map(p => ({programa:p, total:0, aprobadas:0, pre:0, registradas:0, score:0, cumplimiento:0}));
  const map = new Map(base.map(r => [r.programa, r]));
  const selectedIds = new Set(getSelectedDashboardDecretos().map(ds => ds.id));
  state.acciones.filter(a => selectedIds.has(a.dsId)).forEach(a => {
    const programa = String(a.programa || '').trim().toUpperCase();
    if(!map.has(programa)) map.set(programa, {programa, total:0, aprobadas:0, pre:0, registradas:0, score:0, cumplimiento:0});
    const row = map.get(programa);
    row.total += 1;
    if(a.estado === 'Aprobado') row.aprobadas += 1;
    else if(a.estado === 'Pre aprobado') row.pre += 1;
    else row.registradas += 1;
  });
  return [...map.values()].map(r => {
    r.cumplimiento = r.total ? (r.aprobadas / r.total) * 100 : 0;
    r.score = (r.aprobadas * 3) + (r.pre * 2) + (r.registradas * 1);
    return r;
  }).sort((a,b) => b.cumplimiento - a.cumplimiento || b.score - a.score || b.aprobadas - a.aprobadas || a.programa.localeCompare(b.programa));
}

function renderRankingProgramasDashboard(){
  const tbody = document.querySelector('#tablaRankingProgramasDashboard tbody');
  if(!tbody) return;
  const rows = buildRankingProgramas();
  if(!rows.length){
    tbody.innerHTML = '<tr><td colspan="8" class="text-muted">No hay acciones registradas.</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map((r, idx) => `
    <tr>
      <td>${idx + 1}</td>
      <td>${escapeHtml(r.programa)}</td>
      <td>${r.total}</td>
      <td>${r.aprobadas}</td>
      <td>${r.pre}</td>
      <td>${r.registradas}</td>
      <td>${r.cumplimiento.toFixed(1)}%</td>
      <td>${r.score}</td>
    </tr>
  `).join('');
}

function renderSeguimiento(){
  const box = $('segMetrics');
  const total = state.acciones.length;
  const registradas = state.acciones.filter(x => x.estado === 'Registrado').length;
  const pre = state.acciones.filter(x => x.estado === 'Pre aprobado').length;
  const aprobadas = state.acciones.filter(x => x.estado === 'Aprobado').length;
  const byUser = {};
  state.acciones.forEach(a => byUser[a.usuario] = (byUser[a.usuario] || 0) + 1);
  box.innerHTML = [
    statCard('Total acciones', total),
    statCard('Registradas', registradas),
    statCard('Pre aprobadas', pre),
    statCard('Aprobadas', aprobadas),
    statCard('Backlog Registrador', registradas),
    statCard('Carga máxima por usuario', Math.max(0, ...Object.values(byUser), 0))
  ].map(x => `<div class="col-md-4">${x}</div>`).join('');
}

function statCard(label, value){
  return `<div class="stat-card"><div class="small text-muted">${escapeHtml(label)}</div><div class="fs-4 fw-bold text-primary">${escapeHtml(String(value))}</div></div>`;
}

function uniqueCounts(territorio){
  const deps = new Set(territorio.map(t => t.departamento));
  const provs = new Set(territorio.map(t => `${t.departamento}|${t.provincia}`));
  const dists = new Set(territorio.map(t => makeTerritorioKey(t)));
  return {departamentos: deps.size, provincias: provs.size, distritos: dists.size};
}

function daysRemaining(fechaFin){
  const hoy = startOfDay(new Date());
  const fin = startOfDay(new Date(`${fechaFin}T00:00:00`));
  return Math.ceil((fin - hoy)/(1000*60*60*24));
}

function exportListadoCSV(){
  if(!state.decretos.length){
    alert('No hay datos para exportar.');
    return;
  }
  const rows = [
    ['DS','Año','Peligro','Tipo de Peligro','Inicio','Final','Vigencia','Semáforo','Departamentos','Provincias','Distritos','Relación','Cadena','Prórrogas']
  ];
  state.decretos.forEach(ds => {
    const counts = uniqueCounts(ds.territorio);
    rows.push([
      ds.numero, ds.anio, ds.peligro, ds.tipoPeligro, ds.fechaInicio, ds.fechaFin, computeVigencia(ds.fechaFin), getSemaforo(ds.fechaFin).label,
      counts.departamentos, counts.provincias, counts.distritos, ds.esProrroga ? `Prórroga de ${ds.dsOrigenNumero || ''}` : 'Decreto base',
      ds.cadenaId, state.decretos.filter(x => x.cadenaId === ds.cadenaId).length - 1
    ]);
  });
  const csv = rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'listado_decretos_supremos.csv';
  a.click();
  URL.revokeObjectURL(url);
}


window.toggleDashboardDs = function(id){
  syncDashboardSelection();
  const set = new Set(state.dashboardDsSelected || []);
  if(set.has(id)) set.delete(id); else set.add(id);
  state.dashboardDsTouched = true;
  state.dashboardDsSelected = [...set];
  renderDashboard();
};

window.selectAllDashboardDs = function(){
  state.dashboardDsTouched = true;
  state.dashboardDsSelected = state.decretos.map(ds => ds.id);
  renderDashboard();
};

window.clearDashboardDs = function(){
  state.dashboardDsTouched = true;
  state.dashboardDsSelected = [];
  renderDashboard();
};

function renderAll(){
  refreshOrigenOptions();
  syncRelacionFields();
  refreshCodigoRegistro();
  renderTerritorioSeleccionado();
  renderLista();
  renderAcciones();
  renderDashboard();
  renderSeguimiento();
  renderAdminUsers();
  renderAuditoria();
  renderConflictos();
}

function nextCodigoRegistro(anio){
  const year = String(anio || new Date().getFullYear());
  let maxN = 0;
  state.decretos.forEach(ds => {
    const code = String(ds.codigoRegistro || '');
    const m = code.match(/^(\d+)-(.+)$/);
    if(m && m[2] === year) maxN = Math.max(maxN, parseInt(m[1],10) || 0);
  });
  return `${String(maxN + 1).padStart(4,'0')}-${year}`;
}

function refreshCodigoRegistro(){
  const el = $('dsCodigoRegistro');
  if(!el) return;
  el.value = nextCodigoRegistro($('dsAnio')?.value || new Date().getFullYear());
}

function generatePassword(){
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789@#$';
  let out='';
  for(let i=0;i<10;i++) out += chars[Math.floor(Math.random()*chars.length)];
  return out;
}

function copyText(text, okMsg){
  if(!text) return;
  navigator.clipboard.writeText(text).then(()=>alert(okMsg || 'Copiado')).catch(()=>alert('No se pudo copiar la clave.'));
}

function addAuditLog(actor, accion, detalle=''){
  state.auditLog.unshift({id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()+Math.random()), fechaHora: new Date().toISOString(), actor, accion, detalle});
  persistAdminData();
}

function addConflictLog(entry){
  state.conflictLog.unshift({
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()+Math.random()),
    fechaHora: new Date().toISOString(),
    codigo: entry.codigo || '-',
    motivo: entry.motivo || '-',
    fechaServidor: entry.fechaServidor || '-',
    estadoLocalServidor: entry.estadoLocalServidor || '-',
    resolucionAplicada: entry.resolucionAplicada || 'pendiente'
  });
  persistAdminData();
}

function openAdminPanel(tabName='usuarios'){
  if(!state.session || state.session.role !== 'Administrador') return;
  renderAdminUsers();
  renderAuditoria();
  renderConflictos();
  const modal = bootstrap.Modal.getOrCreateInstance($('modalAdminPanel'));
  modal.show();
  const map = {usuarios:'#adminUsuarios', auditoria:'#adminAuditoria', conflictos:'#adminConflictos'};
  const btn = document.querySelector(`[data-bs-target="${map[tabName] || '#adminUsuarios'}"]`);
  if(btn) bootstrap.Tab.getOrCreateInstance(btn).show();
}

function renderAuditActorOptions(){
  const sel = $('auditActor');
  if(!sel) return;
  const current = sel.value || '';
  const actors = [...new Set(state.auditLog.map(x => x.actor).filter(Boolean))].sort();
  sel.innerHTML = '<option value="">Todos</option>' + actors.map(a => `<option value="${escapeHtml(a)}">${escapeHtml(a)}</option>`).join('');
  sel.value = current;
}

function renderAuditoria(){
  renderAuditActorOptions();
  const tbody = $('tablaAuditoria') ? document.querySelector('#tablaAuditoria tbody') : null;
  if(!tbody) return;
  const desde = $('auditDesde')?.value || '';
  const hasta = $('auditHasta')?.value || '';
  const actor = $('auditActor')?.value || '';
  let rows = state.auditLog.slice();
  if(desde) rows = rows.filter(r => String(r.fechaHora || '').slice(0,10) >= desde);
  if(hasta) rows = rows.filter(r => String(r.fechaHora || '').slice(0,10) <= hasta);
  if(actor) rows = rows.filter(r => r.actor === actor);
  if(!rows.length){ tbody.innerHTML = '<tr><td colspan="5" class="text-muted">No hay registros de auditoría.</td></tr>'; return; }
  tbody.innerHTML = rows.map(r => `<tr><td>${escapeHtml(formatDateTime(r.fechaHora))}</td><td>${escapeHtml(r.actor || '')}</td><td>${escapeHtml(r.accion || '')}</td><td>${escapeHtml(r.detalle || '')}</td><td><button class="btn btn-sm btn-outline-primary" onclick="viewAudit('${r.id}')">Ver</button></td></tr>`).join('');
}

function clearAuditoria(){
  if(!confirm('¿Desea limpiar la bitácora/auditoría?')) return;
  state.auditLog = [];
  persistAdminData();
  renderAuditoria();
}

function renderConflictos(){
  const tbody = $('tablaConflictos') ? document.querySelector('#tablaConflictos tbody') : null;
  if(!tbody) return;
  if(!state.conflictLog.length){ tbody.innerHTML = '<tr><td colspan="7" class="text-muted">No hay conflictos registrados.</td></tr>'; return; }
  tbody.innerHTML = state.conflictLog.map(r => `<tr><td>${escapeHtml(formatDateTime(r.fechaHora))}</td><td>${escapeHtml(r.codigo)}</td><td>${escapeHtml(r.motivo)}</td><td>${escapeHtml(formatDateTime(r.fechaServidor))}</td><td>${escapeHtml(r.estadoLocalServidor)}</td><td>${escapeHtml(r.resolucionAplicada || 'pendiente')}</td><td class="d-flex gap-1 flex-wrap"><button class="btn btn-sm btn-outline-success" onclick="resolveConflict('${r.id}','local')">Aplicar local</button><button class="btn btn-sm btn-outline-primary" onclick="resolveConflict('${r.id}','servidor')">Aplicar servidor</button></td></tr>`).join('');
}

function clearConflictos(){
  if(!confirm('¿Desea limpiar los conflictos sync?')) return;
  state.conflictLog = [];
  persistAdminData();
  renderConflictos();
}

window.resolveConflict = function(id, resolution){
  const item = state.conflictLog.find(x => x.id === id);
  if(!item) return;
  item.resolucionAplicada = resolution;
  persistAdminData();
  addAuditLog(state.session?.email || 'sistema', 'Resolver conflicto', `${item.codigo} | ${resolution}`);
  renderConflictos();
  renderAuditoria();
};

window.toggleUserStatus = function(email){
  const current = getAllUsers().find(u => u.email === email);
  if(!current) return;
  const meta = state.userMeta[email] || {};
  meta.active = current.active === false ? true : false;
  if(!meta.password) meta.password = current.password;
  state.userMeta[email] = meta;
  persistAdminData();
  addAuditLog(state.session?.email || 'sistema', meta.active ? 'Activar usuario' : 'Desactivar usuario', email);
  renderAdminUsers();
  renderAuditoria();
};

window.resetUserPassword = function(email){
  const newPass = generatePassword();
  const current = getAllUsers().find(u => u.email === email);
  const meta = state.userMeta[email] || {};
  meta.password = newPass;
  meta.active = meta.active !== false;
  state.userMeta[email] = meta;
  if($('adminGeneratedPassword')) $('adminGeneratedPassword').value = newPass;
  persistAdminData();
  addAuditLog(state.session?.email || 'sistema', 'Reset clave', email);
  renderAdminUsers();
  renderAuditoria();
  alert(`Nueva clave generada para ${email}: ${newPass}`);
};

window.viewAudit = function(id){
  const r = state.auditLog.find(x => x.id === id);
  if(!r) return;
  $('modalAuditDetalleBody').innerHTML = `<div class="mb-2"><strong>Fecha/Hora:</strong> ${escapeHtml(formatDateTime(r.fechaHora))}</div><div class="mb-2"><strong>Actor:</strong> ${escapeHtml(r.actor || '')}</div><div class="mb-2"><strong>Acción:</strong> ${escapeHtml(r.accion || '')}</div><div class="mb-2"><strong>Detalle:</strong> ${escapeHtml(r.detalle || '')}</div>`;
  bootstrap.Modal.getOrCreateInstance($('modalAuditDetalle')).show();
};

function formatDateTime(value){
  if(!value || value === '-') return '-';
  const d = new Date(value);
  if(Number.isNaN(d.getTime())) return String(value);
  return `${toDateInput(d)} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

function buildCadenaId(numero, anio){
  const limpio = String(numero || 'DS').replace(/[^A-Za-z0-9-]/g,'').replace(/\s+/g,'');
  return `CAD-${String(anio || new Date().getFullYear())}-${limpio || 'DS'}`;
}
function makeTerritorioKey(t){ return `${t.departamento}|${t.provincia}|${t.distrito}`; }
function todayText(){ return new Date().toISOString().slice(0,10); }
function toDateInput(date){
  const y = date.getFullYear();
  const m = String(date.getMonth()+1).padStart(2,'0');
  const d = String(date.getDate()).padStart(2,'0');
  return `${y}-${m}-${d}`;
}
function startOfDay(d){ const x = new Date(d); x.setHours(0,0,0,0); return x; }
function pickColor(i){ return ['#dc3545','#0d6efd','#198754','#fd7e14','#6f42c1','#20c997','#6610f2','#198754'][i % 8]; }
function escapeHtml(str){
  return String(str ?? '').replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
}
