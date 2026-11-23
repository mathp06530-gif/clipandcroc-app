// Client de l'API interne de Vinted.
//
// Toutes les requêtes passent par un `transport` : dans l'extension, il relaie
// la requête au script de contenu qui l'exécute depuis l'onglet Vinted (même
// origine, cookies de session inclus). Les tests utilisent un transport direct.

import { DYNAMIC_ATTRIBUTE_HEADERS, buildDraftBody, buildItemPayload, buildLiveItemBody, extractItemId } from './payload.js';

export class VintedApiError extends Error {
  constructor(message, { status = 0, body = '', path = '' } = {}) {
    super(message);
    this.name = 'VintedApiError';
    this.status = status;
    this.body = body;
    this.path = path;
  }
}

export function createVintedApi({ transport, domain = 'vinted.fr', locale = 'fr-FR', currency = 'EUR' }) {
  if (typeof transport !== 'function') throw new Error('transport requis');

  async function request({ method = 'GET', path, json, form, withCsrf = false, headers = {} }) {
    const response = await transport({
      method,
      path,
      json,
      form,
      withCsrf,
      headers: { accept: 'application/json, text/plain, */*', locale, ...headers },
    });
    const status = Number(response?.status) || 0;
    const text = typeof response?.text === 'string' ? response.text : '';
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = null;
      }
    }
    if (status < 200 || status >= 300) {
      throw new VintedApiError(messageFromResponse(status, text, data), { status, body: text, path });
    }
    return data ?? {};
  }

  return {
    async currentUser() {
      const data = await request({ path: '/api/v2/users/current' });
      return data?.user || data?.current_user || data;
    },

    async searchCatalogs(keyword) {
      const q = encodeURIComponent(String(keyword || '').trim());
      const attempts = [
        `/api/v2/item_upload/catalogs/search?keyword=${q}`,
        `/api/v2/catalogs?keyword=${q}`,
        `/api/v2/catalogs?search_text=${q}`,
      ];
      for (const path of attempts) {
        try {
          const data = await request({ path });
          const list = normalizeList(data, ['catalogs', 'catalog', 'data', 'items']);
          if (list.length) return list.map(normalizeCatalog).filter((c) => c.id);
        } catch (error) {
          if (error.status && error.status !== 404 && error.status !== 400) throw error;
        }
      }
      return [];
    },

    async searchBrands(keyword) {
      const q = encodeURIComponent(String(keyword || '').trim());
      const data = await request({ path: `/api/v2/brands?keyword=${q}` });
      return normalizeList(data, ['brands', 'data', 'items']).map(normalizeBrand).filter((b) => b.id);
    },

    async getColors() {
      const data = await request({ path: '/api/v2/colors' });
      return normalizeList(data, ['colors', 'data', 'items']).map(normalizeColor).filter((c) => c.id);
    },

    async searchItems({ searchText = '', perPage = 24, order = 'price_low_to_high' } = {}) {
      const params = new URLSearchParams();
      if (searchText) params.set('search_text', searchText);
      params.set('per_page', String(perPage));
      params.set('order', order);
      const data = await request({ path: `/api/v2/catalog/items?${params.toString()}` });
      return normalizeList(data, ['items', 'data'])
        .map((item) => ({
          id: Number(item?.id),
          title: item?.title || '',
          price: Number(item?.price?.amount ?? item?.price ?? item?.total_item_price?.amount),
          url: item?.url || '',
        }))
        .filter((item) => Number.isFinite(item.price) && item.price > 0);
    },

    async getCatalogConfig(catalogId) {
      const id = Number(catalogId);
      if (!Number.isFinite(id)) return { sizes: [] };
      const attempts = [
        `/api/v2/item_upload/configuration?catalog_ids[]=${id}`,
        `/api/v2/size_groups?catalog_ids[]=${id}`,
        `/api/v2/sizes?catalog_ids[]=${id}`,
      ];
      for (const path of attempts) {
        try {
          const data = await request({ path });
          const sizes = extractSizes(data);
          if (sizes.length) return { sizes };
        } catch (error) {
          if (error.status && error.status !== 404 && error.status !== 400) throw error;
        }
      }
      return { sizes: [] };
    },

    async uploadPhoto({ base64, filename, mime = 'image/jpeg', sessionId }) {
      const data = await request({
        method: 'POST',
        path: '/api/v2/photos',
        withCsrf: true,
        form: {
          fields: [
            { name: 'photo[type]', value: 'item' },
            { name: 'photo[temp_uuid]', value: sessionId },
          ],
          files: [{ field: 'photo[file]', filename, mime, base64 }],
        },
      });
      const photo = data?.photo || data?.data || data;
      const id = Number(photo?.id ?? photo?.photo?.id);
      if (!Number.isFinite(id) || id <= 0) {
        throw new VintedApiError("Vinted n'a pas renvoyé d'identifiant de photo.", { path: '/api/v2/photos' });
      }
      return { id, raw: photo };
    },

    async createDraft(draft, sessionId) {
      const payload = buildItemPayload(draft, draft.photoIds || [], sessionId);
      const data = await request({
        method: 'POST',
        path: '/api/v2/item_upload/drafts',
        withCsrf: true,
        headers: DYNAMIC_ATTRIBUTE_HEADERS,
        json: buildDraftBody(payload, sessionId),
      });
      return { id: extractItemId(data), data };
    },

    async createLiveItem(draft, sessionId) {
      const payload = buildItemPayload(draft, draft.photoIds || [], sessionId);
      const attempts = [
        { path: '/api/v2/item_upload/items', json: buildLiveItemBody(payload, sessionId) },
        { path: '/api/v2/items', json: { item: payload } },
      ];
      const failures = [];
      for (const attempt of attempts) {
        try {
          const data = await request({
            method: 'POST',
            path: attempt.path,
            withCsrf: true,
            headers: DYNAMIC_ATTRIBUTE_HEADERS,
            json: attempt.json,
          });
          return { id: extractItemId(data), data, path: attempt.path };
        } catch (error) {
          failures.push(`${attempt.path} → ${error.status || '?'} ${error.message}`);
          if (error.status && ![400, 404, 405, 422, 500].includes(error.status)) throw error;
        }
      }
      throw new VintedApiError(`Publication directe refusée (${failures.join(' ; ')})`, {
        status: 0,
        path: '/api/v2/item_upload/items',
      });
    },

    async publishDraft(draftId) {
      const id = Number(draftId);
      const attempts = [
        { method: 'POST', path: `/api/v2/item_upload/drafts/${id}/publish` },
        { method: 'POST', path: `/api/v2/items/${id}/publish` },
        { method: 'PUT', path: `/api/v2/item_upload/drafts/${id}/publish` },
      ];
      const failures = [];
      for (const attempt of attempts) {
        try {
          const data = await request({ ...attempt, withCsrf: true });
          return { id, data, path: attempt.path };
        } catch (error) {
          failures.push(`${attempt.path} → ${error.status || '?'}`);
          if (error.status && ![400, 404, 405, 422].includes(error.status)) throw error;
        }
      }
      throw new VintedApiError(`Publication du brouillon impossible (${failures.join(' ; ')})`, {
        status: 0,
        path: `/api/v2/item_upload/drafts/${id}/publish`,
      });
    },
  };
}

function messageFromResponse(status, text, data) {
  const detail =
    data?.message ||
    data?.error ||
    data?.error_message ||
    data?.errors?.[0]?.message ||
    (typeof data?.errors?.[0] === 'string' ? data.errors[0] : '') ||
    text.slice(0, 200);
  if (status === 401 || status === 403) {
    return `Vinted a refusé la requête (${status}). Vérifiez que vous êtes connecté, puis rechargez la page Vinted. ${detail}`.trim();
  }
  if (status === 429) return 'Trop de requêtes envoyées à Vinted : patientez avant de réessayer.';
  return `Vinted a répondu ${status || 'sans statut'}. ${detail}`.trim();
}

function normalizeList(data, keys) {
  if (Array.isArray(data)) return data;
  for (const key of keys) {
    const value = data?.[key];
    if (Array.isArray(value)) return value;
    if (value && Array.isArray(value.data)) return value.data;
    if (value && Array.isArray(value.items)) return value.items;
  }
  return [];
}

function normalizeCatalog(raw) {
  const id = Number(raw?.id ?? raw?.catalog_id ?? raw?.value);
  const title = raw?.title || raw?.name || raw?.label || raw?.catalog_title || '';
  const path = raw?.path || raw?.catalog_path || raw?.full_path || title;
  return { id, title, path };
}

function normalizeBrand(raw) {
  return {
    id: Number(raw?.id ?? raw?.brand_id),
    title: raw?.title || raw?.name || raw?.brand || '',
  };
}

function normalizeColor(raw) {
  return {
    id: Number(raw?.id ?? raw?.color_id),
    title: raw?.title || raw?.name || raw?.color || '',
    hex: raw?.hex || raw?.code || '',
  };
}

function extractSizes(data) {
  const groups = normalizeList(data, ['size_groups', 'sizes', 'size_group', 'data']);
  const out = [];
  for (const group of groups) {
    if (Array.isArray(group?.sizes)) {
      for (const size of group.sizes) {
        out.push({
          id: Number(size.id ?? size.size_id),
          label: size.title || size.name || size.label || '',
          group: group.title || group.name || '',
        });
      }
    } else if (group?.id && (group.title || group.name)) {
      out.push({ id: Number(group.id), label: group.title || group.name, group: '' });
    }
  }
  return out.filter((s) => Number.isFinite(s.id) && s.id > 0);
}
