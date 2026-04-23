export function json(data, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set('content-type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(data), { ...init, headers });
}

export async function readJson(request) {
  const ct = request.headers.get('content-type') || '';
  if (!ct.includes('application/json')) {
    throw new Error('content_type_must_be_application_json');
  }
  return await request.json();
}

export function badRequest(error, detail = null) {
  return json({ ok: false, error, detail }, { status: 400 });
}

export function unauthorized(error = 'unauthorized') {
  return json({ ok: false, error }, { status: 401 });
}

export function forbidden(error = 'forbidden') {
  return json({ ok: false, error }, { status: 403 });
}

export function notFound(error = 'not_found') {
  return json({ ok: false, error }, { status: 404 });
}

export function tooManyRequests(error = 'too_many_requests') {
  return json({ ok: false, error }, { status: 429 });
}

export function serverError(error = 'server_error', detail = null) {
  return json({ ok: false, error, detail }, { status: 500 });
}

export function getCookie(request, name) {
  const cookie = request.headers.get('cookie') || '';
  const parts = cookie.split(/;\s*/).filter(Boolean);

  for (const part of parts) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;

    const key = part.slice(0, idx);
    const value = part.slice(idx + 1);

    if (key === name) return decodeURIComponent(value);
  }

  return '';
}

export function setCookie(name, value, opts = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${opts.path || '/'}`);

  if (opts.httpOnly !== false) parts.push('HttpOnly');
  if (opts.sameSite || opts.sameSite !== false) parts.push(`SameSite=${opts.sameSite || 'Lax'}`);
  if (opts.secure !== false) parts.push('Secure');

  if (typeof opts.maxAge === 'number') parts.push(`Max-Age=${opts.maxAge}`);

  if (opts.expires) {
    const expires = opts.expires instanceof Date
      ? opts.expires.toUTCString()
      : new Date(opts.expires).toUTCString();
    parts.push(`Expires=${expires}`);
  }

  return parts.join('; ');
}