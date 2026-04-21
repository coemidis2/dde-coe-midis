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
  acciones: []
};

const $ = (id)=>document.getElementById(id);

// ================== INIT ==================
document.addEventListener('DOMContentLoaded', init);

function init(){
  loadStorage();
  wireLogin();
  wireUI();
  autoLogin();
  initUbigeo(); // 👈 CLAVE
}

// ================== STORAGE ==================
function loadStorage(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(raw){
      const parsed = JSON.parse(raw);
      state.decretos = parsed.decretos || [];
      state.acciones = parsed.acciones || [];
    }
  }catch(e){}
}

function saveStorage(){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

// ================== LOGIN ==================
function wireLogin(){
  $('btnLogin').addEventListener('click', doLogin);
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
  const email = ($('loginUser').value || '').trim().toLowerCase();
  const pass = $('loginPass').value || '';

  const resp = await apiPost('/login', {email, password: pass});

  if(resp && resp.ok){
    setToken(resp.token);

    state.session = {
      email,
      name: resp.name || email,
      role: resp.role || 'Administrador'
    };

    $('loginView').classList.add('d-none');
    $('appView').classList.remove('d-none');

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

    $('loginView').classList.add('d-none');
    $('appView').classList.remove('d-none');

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
    console.error("ubigeoData no cargó");
    return;
  }

  ubigeoCache = window.ubigeoData;

  cargarDepartamentos();

  $('selDepartamento').addEventListener('change', cargarProvincias);
  $('selProvincia').addEventListener('change', cargarDistritos);
  $('buscarDistrito').addEventListener('input', filtrarDistritos);
  $('btnAgregarDistritos').addEventListener('click', agregarDistritosSeleccionados);
}

function cargarDepartamentos(){
  const sel = $('selDepartamento');
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
  const dep = $('selDepartamento').value;
  const selProv = $('selProvincia');

  selProv.innerHTML = '<option value="">Seleccione...</option>';

  if(!dep) return;

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

  $('distritosChecklist').innerHTML = '';
}

function cargarDistritos(){
  const dep = $('selDepartamento').value;
  const prov = $('selProvincia').value;

  if(!dep || !prov) return;

  const cont = $('distritosChecklist');
  cont.innerHTML = '';

  const distritos = ubigeoCache.filter(x =>
    x.departamento === dep && x.provincia === prov
  );

  distritos.forEach(d=>{
    const div = document.createElement('div');
    div.innerHTML = `
      <label>
        <input type="checkbox" value="${d.ubigeo}">
        ${d.distrito}
      </label>
    `;
    cont.appendChild(div);
  });
}

function filtrarDistritos(){
  const txt = $('buscarDistrito').value.toLowerCase();
  const checks = $('distritosChecklist').querySelectorAll('div');

  checks.forEach(div=>{
    div.style.display = div.textContent.toLowerCase().includes(txt)
      ? ''
      : 'none';
  });
}

function agregarDistritosSeleccionados(){
  const checks = $('distritosChecklist').querySelectorAll('input:checked');
  const cont = $('territorioSeleccionado');

  if(!checks.length){
    cont.innerHTML = '<div class="text-muted">No hay territorios agregados.</div>';
    return;
  }

  let html = '';

  checks.forEach(chk=>{
    const data = ubigeoCache.find(x => x.ubigeo === chk.value);
    if(data){
      html += `<div>${data.departamento} - ${data.provincia} - ${data.distrito}</div>`;
    }
  });

  cont.innerHTML = html;
}

// ================== RENDER ==================
function renderAll(){
  console.log("Sistema cargado", state);
}