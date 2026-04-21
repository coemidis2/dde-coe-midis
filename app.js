// ================== CONFIG API ==================
const API_BASE = window.location.origin + '/api';
let AUTH_TOKEN = localStorage.getItem('auth_token') || '';

function setToken(token){
  AUTH_TOKEN = token;
  localStorage.setItem('auth_token', token);
}

function getHeaders(){
  return {
    'Content-Type': 'application/json',
    'Authorization': AUTH_TOKEN ? `Bearer ${AUTH_TOKEN}` : ''
  };
}

async function apiGet(path){
  try{
    const res = await fetch(API_BASE + path, {headers: getHeaders()});
    return await res.json();
  }catch(e){
    console.warn('API GET error:', e);
    return null;
  }
}

async function apiPost(path, data){
  try{
    const res = await fetch(API_BASE + path, {
      method:'POST',
      headers: getHeaders(),
      body: JSON.stringify(data)
    });
    return await res.json();
  }catch(e){
    console.warn('API POST error:', e);
    return null;
  }
}

// ================== TU APP ORIGINAL ==================

const STORAGE_KEY = 'dee_midis_local_v4';

let state = {
  session: null,
  decretos: [],
  acciones: [],
  nuevoDSTerritorios: []
};

const $ = (id)=>document.getElementById(id);

// ================== INIT ==================
document.addEventListener('DOMContentLoaded', init);

function init(){
  loadStorage();
  wireLogin();
  wireUI();
  autoLogin();
  initUbigeo();
}

// ================== STORAGE ==================
function loadStorage(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(raw){
      const parsed = JSON.parse(raw);
      state.decretos = parsed.decretos || [];
      state.acciones = parsed.acciones || [];
      state.nuevoDSTerritorios = [];
    }
  }catch(e){}
}

function saveStorage(){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

// ================== LOGIN ==================
function wireLogin(){
  if($('btnLogin')){
    $('btnLogin').addEventListener('click', doLogin);
  }
}

function wireUI(){
  if($('btnLogout')){
    $('btnLogout').addEventListener('click', ()=>{
      localStorage.removeItem('auth_token');
      location.reload();
    });
  }
}

async function doLogin(){
  const email = ($('loginUser')?.value || '').trim().toLowerCase();
  const pass = $('loginPass')?.value || '';

  const resp = await apiPost('/login', {email, password: pass});

  if(resp && resp.ok){
    setToken(resp.token);

    state.session = {
      email,
      name: resp.name || email,
      role: resp.role || 'Administrador'
    };

    if($('loginView')) $('loginView').classList.add('d-none');
    if($('appView')) $('appView').classList.remove('d-none');

    await syncFromBackend();
    renderAll();
    return;
  }

  alert('Login backend falló, usando modo local.');
}

// ================== AUTO LOGIN ==================
async function autoLogin(){
  if(!AUTH_TOKEN) return;

  const data = await apiGet('/decretos');

  if(data && data.ok){
    state.session = {
      email:'admin@midis.gob.pe',
      name:'Administrador MIDIS',
      role:'Administrador'
    };

    if($('loginView')) $('loginView').classList.add('d-none');
    if($('appView')) $('appView').classList.remove('d-none');

    state.decretos = data.decretos || [];
    state.acciones = data.acciones || [];

    renderAll();
  }
}

// ================== SYNC ==================
async function syncFromBackend(){
  const data = await apiGet('/decretos');

  if(data && data.ok){
    state.decretos = data.decretos || [];
    state.acciones = data.acciones || [];
    saveStorage();
  }
}

// ================== UBIGEO ==================

let ubigeoCache = [];

function initUbigeo(){
  if(!window.ubigeoData || !Array.isArray(window.ubigeoData)){
    console.error('ubigeoData no cargó');
    return;
  }

  ubigeoCache = window.ubigeoData;

  cargarDepartamentos();
  renderTerritorioSeleccionado();

  if($('selDepartamento')){
    $('selDepartamento').addEventListener('change', cargarProvincias);
  }

  if($('selProvincia')){
    $('selProvincia').addEventListener('change', cargarDistritos);
  }

  if($('buscarDistrito')){
    $('buscarDistrito').addEventListener('input', filtrarDistritos);
  }

  if($('btnAgregarDistritos')){
    $('btnAgregarDistritos').addEventListener('click', (e)=>{
      e.preventDefault();
      agregarDistritosSeleccionados();
    });
  }

  if($('btnMarcarTodos')){
    $('btnMarcarTodos').addEventListener('click', (e)=>{
      e.preventDefault();
      marcarTodosDistritosVisibles();
    });
  }

  if($('btnLimpiarChecks')){
    $('btnLimpiarChecks').addEventListener('click', (e)=>{
      e.preventDefault();
      limpiarChecksDistritos();
    });
  }
}

function cargarDepartamentos(){
  const sel = $('selDepartamento');
  if(!sel) return;

  sel.innerHTML = '<option value="">Seleccione...</option>';

  const deps = [...new Set(ubigeoCache.map(x => x.departamento))];

  deps.sort().forEach(dep=>{
    const opt = document.createElement('option');
    opt.value = dep;
    opt.textContent = dep;
    sel.appendChild(opt);
  });
}

function cargarProvincias(){
  const dep = $('selDepartamento')?.value || '';
  const selProv = $('selProvincia');

  if(!selProv) return;

  selProv.innerHTML = '<option value="">Seleccione...</option>';

  if(!dep){
    if($('distritosChecklist')){
      $('distritosChecklist').innerHTML = '<div class="text-muted small">Seleccione primero departamento y provincia.</div>';
    }
    return;
  }

  const provincias = [...new Set(
    ubigeoCache
      .filter(x => x.departamento === dep)
      .map(x => x.provincia)
  )];

  provincias.sort().forEach(p=>{
    const opt = document.createElement('option');
    opt.value = p;
    opt.textContent = p;
    selProv.appendChild(opt);
  });

  if($('distritosChecklist')){
    $('distritosChecklist').innerHTML = '<div class="text-muted small">Seleccione una provincia.</div>';
  }

  if($('buscarDistrito')){
    $('buscarDistrito').value = '';
  }

  limpiarChecksDistritos(true);
}

function cargarDistritos(){
  const dep = $('selDepartamento')?.value || '';
  const prov = $('selProvincia')?.value || '';
  const cont = $('distritosChecklist');

  if(!cont) return;

  if(!dep || !prov){
    cont.innerHTML = '<div class="text-muted small">Seleccione primero departamento y provincia.</div>';
    return;
  }

  cont.innerHTML = '';

  if($('buscarDistrito')){
    $('buscarDistrito').value = '';
  }

  const distritos = ubigeoCache.filter(x =>
    x.departamento === dep && x.provincia === prov
  );

  if(!distritos.length){
    cont.innerHTML = '<div class="text-muted small">No hay distritos para la selección actual.</div>';
    return;
  }

  distritos.forEach(d=>{
    const yaSeleccionado = state.nuevoDSTerritorios.some(t => String(t.ubigeo) === String(d.ubigeo));

    const div = document.createElement('div');
    div.className = 'form-check';
    div.innerHTML = `
      <input class="form-check-input chk-distrito" type="checkbox" id="dist_${d.ubigeo}" value="${d.ubigeo}" ${yaSeleccionado ? 'checked' : ''}>
      <label class="form-check-label" for="dist_${d.ubigeo}">${d.distrito}</label>
    `;
    cont.appendChild(div);
  });
}

function filtrarDistritos(){
  const txt = ($('buscarDistrito')?.value || '').trim().toLowerCase();
  const checklist = $('distritosChecklist');
  if(!checklist) return;

  const filas = checklist.querySelectorAll('.form-check');

  filas.forEach(div=>{
    const visible = div.textContent.toLowerCase().includes(txt);
    div.style.display = visible ? '' : 'none';
  });
}

function marcarTodosDistritosVisibles(){
  const checklist = $('distritosChecklist');
  if(!checklist) return;

  const visibles = [...checklist.querySelectorAll('.form-check')]
    .filter(div => div.style.display !== 'none')
    .map(div => div.querySelector('input[type="checkbox"]'))
    .filter(Boolean);

  visibles.forEach(chk => chk.checked = true);
}

function limpiarChecksDistritos(silencioso = false){
  const checklist = $('distritosChecklist');
  if(checklist){
    checklist.querySelectorAll('input[type="checkbox"]').forEach(chk => {
      chk.checked = false;
    });
  }

  if(!silencioso){
    if($('buscarDistrito')){
      $('buscarDistrito').value = '';
    }
    filtrarDistritos();
  }
}

function agregarDistritosSeleccionados(){
  const checklist = $('distritosChecklist');
  if(!checklist) return;

  const checks = checklist.querySelectorAll('input[type="checkbox"]:checked');

  if(!checks.length){
    alert('Seleccione al menos un distrito para agregar.');
    renderTerritorioSeleccionado();
    return;
  }

  let agregados = 0;

  checks.forEach(chk=>{
    const data = ubigeoCache.find(x => String(x.ubigeo) === String(chk.value));
    if(!data) return;

    const existe = state.nuevoDSTerritorios.some(t => String(t.ubigeo) === String(data.ubigeo));
    if(existe) return;

    state.nuevoDSTerritorios.push({
      ubigeo: data.ubigeo,
      departamento: data.departamento,
      provincia: data.provincia,
      distrito: data.distrito,
      latitud: data.latitud ?? data.lat ?? '',
      longitud: data.longitud ?? data.lng ?? ''
    });

    agregados += 1;
  });

  renderTerritorioSeleccionado();

  if(agregados === 0){
    alert('Los distritos marcados ya estaban agregados.');
  }else{
    limpiarChecksDistritos(true);
    cargarDistritos();
  }
}

function quitarTerritorioSeleccionado(ubigeo){
  state.nuevoDSTerritorios = state.nuevoDSTerritorios.filter(
    t => String(t.ubigeo) !== String(ubigeo)
  );

  renderTerritorioSeleccionado();
  cargarDistritos();
}

function renderTerritorioSeleccionado(){
  const cont = $('territorioSeleccionado');
  if(!cont) return;

  if(!state.nuevoDSTerritorios.length){
    cont.innerHTML = '<div class="text-muted">No hay territorios agregados.</div>';
    return;
  }

  cont.innerHTML = state.nuevoDSTerritorios.map(t => `
    <div class="d-flex justify-content-between align-items-start gap-2 border rounded bg-white px-2 py-1 mb-2">
      <div>
        <div><strong>${escapeHtml(t.departamento)}</strong> - ${escapeHtml(t.provincia)} - ${escapeHtml(t.distrito)}</div>
        <div class="text-muted small">Ubigeo: ${escapeHtml(String(t.ubigeo))}</div>
      </div>
      <button type="button" class="btn btn-sm btn-outline-danger" onclick="quitarTerritorioSeleccionado('${String(t.ubigeo).replace(/'/g, "\\'")}')">Quitar</button>
    </div>
  `).join('');
}

function escapeHtml(value){
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

// ================== RENDER ==================
function renderAll(){
  console.log('Sistema cargado', state);
}