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
  autoLogin();
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

// ================== CRUD ==================
async function saveDecreto(decreto){
  state.decretos.push(decreto);
  saveStorage();

  await apiPost('/decretos', decreto);
}

async function saveAccion(accion){
  state.acciones.push(accion);
  saveStorage();

  await apiPost('/acciones', accion);
}

// ================== RENDER ==================
function renderAll(){
  console.log("Sistema cargado", state);
}