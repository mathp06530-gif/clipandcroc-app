// Pont exécuté dans l'onglet Vinted : il ne contient aucune logique métier,
// seulement le transport HTTP (cookies de session, jeton CSRF, multipart).
(() => {
  const FLAG = '__vintedPublisherBridge';
  if (window[FLAG]) return;
  window[FLAG] = true;

  let cachedCsrf = '';
  let cachedAnonId = '';

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.source !== 'vinted-publisher') return undefined;

    if (message.action === 'ping') {
      sendResponse({ ok: true, url: location.href, origin: location.origin });
      return false;
    }

    if (message.action === 'request') {
      handleRequest(message.request)
        .then((result) => sendResponse(result))
        .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
      return true;
    }

    return undefined;
  });

  async function handleRequest(request) {
    if (!request || !request.path) throw new Error('Requête vide.');
    const path = String(request.path);
    if (!path.startsWith('/')) throw new Error('Chemin relatif attendu.');

    const headers = { ...(request.headers || {}) };
    if (request.withCsrf) {
      const csrf = await getCsrf();
      if (csrf) headers['x-csrf-token'] = csrf;
      const anonId = getAnonId();
      if (anonId) headers['x-anon-id'] = anonId;
    }

    let body;
    if (request.json !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(request.json);
    } else if (request.form) {
      body = buildFormData(request.form);
      delete headers['content-type'];
    }

    const response = await fetch(location.origin + path, {
      method: request.method || 'GET',
      credentials: 'include',
      headers,
      body,
      redirect: 'follow',
      cache: 'no-store',
    });

    const text = await response.text();
    return {
      ok: true,
      status: response.status,
      headers: { 'x-csrf-token': response.headers.get('x-csrf-token') || '' },
      text,
      url: response.url,
    };
  }

  function buildFormData(form) {
    const data = new FormData();
    for (const field of form.fields || []) {
      data.append(field.name, field.value);
    }
    for (const file of form.files || []) {
      const bytes = base64ToBytes(file.base64);
      const blob = new Blob([bytes], { type: file.mime || 'image/jpeg' });
      data.append(file.field, blob, file.filename || 'photo.jpg');
    }
    return data;
  }

  function base64ToBytes(base64) {
    const binary = atob(String(base64 || ''));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  async function getCsrf() {
    const meta = document.querySelector('meta[name="csrf-token"]');
    if (meta && meta.content) {
      cachedCsrf = meta.content;
      return cachedCsrf;
    }
    if (cachedCsrf) return cachedCsrf;
    try {
      const response = await fetch('/api/v2/users/current', {
        credentials: 'include',
        headers: { accept: 'application/json' },
      });
      const token = response.headers.get('x-csrf-token');
      if (token) cachedCsrf = token;
    } catch {
      // le jeton sera redemandé à la prochaine requête
    }
    return cachedCsrf;
  }

  function getAnonId() {
    if (cachedAnonId) return cachedAnonId;
    const match = document.cookie.match(/(?:^|;\s*)anon_id=([^;]+)/);
    if (match) cachedAnonId = decodeURIComponent(match[1]);
    return cachedAnonId;
  }
})();
