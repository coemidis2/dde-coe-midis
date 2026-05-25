(function () {
  function $(id) {
    return document.getElementById(id);
  }

  function hoy() {
    return new Date().toISOString().split('T')[0];
  }

  function getCookie(name) {
    const v = document.cookie.split('; ').find(x => x.startsWith(name + '='));
    return v ? decodeURIComponent(v.split('=')[1]) : '';
  }

  function getHeaders(getState) {
    const h = { 'Content-Type': 'application/json' };
    const csrf = getCookie('dee_csrf');
    if (csrf) h['x-csrf-token'] = csrf;

    const state = typeof getState === 'function' ? getState() || {} : {};
    const session = state.session || {};
    const localEmail = session.email || '';
    const localRole = session.role || session.rol || '';
    const localPrograma = session.programa || '';

    if (localEmail && localRole) {
      h['x-dee-local-session'] = '1';
      h['x-dee-user-email'] = String(localEmail).trim().toLowerCase();
      h['x-dee-user-role'] = String(localRole).trim();
      h['x-dee-user-programa'] = String(localPrograma || '').trim();
    }

    return h;
  }

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

  function createApi(apiBase, getState) {
    return async function api(path, method = 'GET', body = null) {
      try {
        const res = await fetch(apiBase + path, {
          method,
          headers: getHeaders(getState),
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
    };
  }

  window.DEE_SHARED = {
    $,
    hoy,
    getCookie,
    getHeaders,
    normalizarEmail,
    normalizarRol,
    normalizarPrograma,
    createApi
  };

  if (/[Ãâ]/.test(document.title)) {
    document.title = 'DEE MIDIS - Declaratorias de Estado de Emergencia';
  }

  document.addEventListener('DOMContentLoaded', () => {
    const replacements = [
      ['[aria-label="Inicio de sesiÃ³n DEE MIDIS"]', 'aria-label', 'Inicio de sesion DEE MIDIS'],
      ['[aria-label="InformaciÃ³n institucional"]', 'aria-label', 'Informacion institucional'],
      ['#progNumeroReunion', 'label', 'Numero de reunion'],
      ['#progFechaReunion', 'label', 'Fecha de reunion'],
      ['#progTipoAccion', 'label', 'Tipo de accion'],
      ['#progSubtipoRehabilitacion', 'label', 'Subtipo de Rehabilitacion'],
      ['#progCodigoAccion', 'label', 'Codigo de accion'],
      ['#progPlazoDias', 'label', 'Plazo (dias)'],
      ['#btnLimpiarSeleccionDistritosPrograma', 'text', 'Quitar seleccion'],
      ['#btnRegistrarAccionGrupalPrograma', 'text', 'Registrar accion grupal'],
      ['#progDistritosPaginaInfo', 'text', 'Pagina 1 de 1']
    ];

    replacements.forEach(([selector, type, value]) => {
      const node = document.querySelector(selector);
      if (!node) return;
      if (type === 'aria-label') {
        node.setAttribute('aria-label', value);
        return;
      }
      if (type === 'text') {
        if (/[Ãâ]/.test(node.textContent || '') || selector === '#progDistritosPaginaInfo') {
          node.textContent = value;
        }
        return;
      }
      if (type === 'label') {
        const label = node.closest('.col-md-2, .col-md-3, .col-md-4, .col-12')?.querySelector('label');
        if (label && /[Ãâ]/.test(label.textContent || '')) {
          label.textContent = value;
        }
      }
    });
  });
})();
