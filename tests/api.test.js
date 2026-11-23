import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { createVintedApi, VintedApiError } from '../src/lib/vinted-api.js';
import { newDraft } from '../src/lib/schema.js';

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

async function startServer(handler) {
  const server = http.createServer(async (req, res) => {
    const body = await readBody(req);
    const result = await handler(req, body);
    res.writeHead(result.status || 200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(result.body ?? {}));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return { server, base: `http://127.0.0.1:${port}` };
}

// Reproduit le comportement du pont de contenu : JSON ou multipart.
function directTransport(base) {
  return async function transport(request) {
    const headers = { ...(request.headers || {}) };
    let body;
    if (request.json !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(request.json);
    } else if (request.form) {
      const form = new FormData();
      for (const field of request.form.fields || []) form.append(field.name, field.value);
      for (const file of request.form.files || []) {
        const bytes = Buffer.from(file.base64, 'base64');
        form.append(file.field, new Blob([bytes], { type: file.mime }), file.filename);
      }
      body = form;
      delete headers['content-type'];
    }
    const response = await fetch(base + request.path, { method: request.method || 'GET', headers, body });
    return { status: response.status, text: await response.text() };
  };
}

const draft = {
  ...newDraft({ id: 'd1' }),
  title: 'Veste en jean',
  description: 'Bon état général.',
  price: '30',
  catalogId: 1908,
  brand: 'Levi’s',
  brandId: 104,
  sizeId: 208,
  conditionId: 3,
  colorIds: [7],
  packageSizeId: 2,
};

test('uploadPhoto envoie le multipart attendu par Vinted', async () => {
  let received = null;
  const { server, base } = await startServer((req, body) => {
    if (req.url === '/api/v2/photos') {
      received = {
        contentType: req.headers['content-type'] || '',
        csrf: req.headers['x-csrf-token'] || '',
        text: body.toString('latin1'),
      };
      return { body: { id: 555, high_resolution: { id: 556 } } };
    }
    return { status: 404, body: { message: 'not found' } };
  });

  try {
    const api = createVintedApi({ transport: directTransport(base) });
    const photo = await api.uploadPhoto({
      base64: Buffer.from('fake-jpeg').toString('base64'),
      mime: 'image/jpeg',
      filename: 'photo.jpg',
      sessionId: 'session-abc',
    });
    assert.equal(photo.id, 555);
    assert.match(received.contentType, /multipart\/form-data/);
    assert.match(received.text, /name="photo\[type\]"/);
    assert.match(received.text, /name="photo\[temp_uuid\]"/);
    assert.match(received.text, /session-abc/);
    assert.match(received.text, /name="photo\[file\]"; filename="photo.jpg"/);
    assert.match(received.text, /fake-jpeg/);
  } finally {
    server.close();
  }
});

test('createDraft envoie le brouillon complet', async () => {
  let payload = null;
  const { server, base } = await startServer((req, body) => {
    if (req.url === '/api/v2/item_upload/drafts') {
      payload = JSON.parse(body.toString('utf8'));
      return { body: { draft: { id: 9001 } } };
    }
    return { status: 404, body: {} };
  });

  try {
    const api = createVintedApi({ transport: directTransport(base) });
    const result = await api.createDraft({ ...draft, photoIds: [11, 12] }, 'session-xyz');
    assert.equal(result.id, 9001);
    assert.equal(payload.upload_session_id, 'session-xyz');
    assert.equal(payload.draft.catalog_id, 1908);
    assert.equal(payload.draft.title, 'Veste en jean');
    assert.deepEqual(payload.draft.assigned_photos, [
      { id: 11, orientation: 0 },
      { id: 12, orientation: 0 },
    ]);
    assert.deepEqual(payload.draft.item_attributes, [
      { code: 'condition', ids: [3] },
      { code: 'size', ids: [208] },
    ]);
  } finally {
    server.close();
  }
});

test('createLiveItem bascule sur /api/v2/items si le premier point d’entrée est absent', async () => {
  const seen = [];
  const { server, base } = await startServer((req, body) => {
    seen.push(req.url);
    if (req.url === '/api/v2/item_upload/items') return { status: 404, body: { message: 'gone' } };
    if (req.url === '/api/v2/items') {
      const parsed = JSON.parse(body.toString('utf8'));
      return { body: { item: { id: 4242, title: parsed.item.title } } };
    }
    return { status: 404, body: {} };
  });

  try {
    const api = createVintedApi({ transport: directTransport(base) });
    const result = await api.createLiveItem({ ...draft, photoIds: [1] }, 's');
    assert.equal(result.id, 4242);
    assert.deepEqual(seen, ['/api/v2/item_upload/items', '/api/v2/items']);
  } finally {
    server.close();
  }
});

test('une réponse 403 remonte un message explicite', async () => {
  const { server, base } = await startServer(() => ({ status: 403, body: { message: 'access_denied' } }));
  try {
    const api = createVintedApi({ transport: directTransport(base) });
    await assert.rejects(
      () => api.createDraft({ ...draft, photoIds: [1] }, 's'),
      (error) => error instanceof VintedApiError && error.status === 403 && /connecté/.test(error.message)
    );
  } finally {
    server.close();
  }
});

test('searchCatalogs normalise les résultats', async () => {
  const { server, base } = await startServer((req) => {
    if (req.url.startsWith('/api/v2/item_upload/catalogs/search')) {
      return { body: { catalogs: [{ id: 1904, title: 'Robes', path: 'Femmes > Robes' }] } };
    }
    return { status: 404, body: {} };
  });
  try {
    const api = createVintedApi({ transport: directTransport(base) });
    const results = await api.searchCatalogs('robe');
    assert.equal(results.length, 1);
    assert.deepEqual(results[0], { id: 1904, title: 'Robes', path: 'Femmes > Robes' });
  } finally {
    server.close();
  }
});
