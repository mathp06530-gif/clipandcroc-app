// Construction des corps de requêtes attendus par l'API interne de Vinted.

import { normalizeDraft } from './schema.js';

/**
 * Corps d'une annonce. `photos` est la liste des identifiants numériques
 * renvoyés par POST /api/v2/photos.
 */
export function buildItemPayload(draft, photos, sessionId) {
  const d = normalizeDraft(draft);
  const itemAttributes = [{ code: 'condition', ids: [d.conditionId] }];
  if (d.sizeId) itemAttributes.push({ code: 'size', ids: [d.sizeId] });

  return {
    id: null,
    currency: d.currency,
    temp_uuid: sessionId,
    title: d.title,
    description: d.description,
    brand_id: d.brandId,
    brand: d.brand,
    catalog_id: d.catalogId,
    isbn: null,
    is_unisex: false,
    ai_photo: false,
    price: Number(d.price),
    package_size_id: d.packageSizeId,
    shipment_prices: { domestic: null, international: null },
    color_ids: d.colorIds,
    assigned_photos: photos.map((id) => ({ id: Number(id), orientation: 0 })),
    measurement_length: null,
    measurement_width: null,
    item_attributes: itemAttributes,
    manufacturer: null,
    manufacturer_labelling: null,
  };
}

export function buildDraftBody(item, sessionId) {
  return {
    draft: item,
    feedback_id: null,
    parcel: null,
    upload_session_id: sessionId,
  };
}

export function buildLiveItemBody(item, sessionId) {
  return {
    item,
    push_up: false,
    parcel: null,
    upload_session_id: sessionId,
  };
}

export const DYNAMIC_ATTRIBUTE_HEADERS = {
  'x-enable-dynamic-attribute-condition': 'true',
  'x-enable-dynamic-attribute-size': 'true',
  'x-enable-dynamic-attribute-video-game-rating': 'true',
};

/** Extrait l'identifiant d'annonce d'une réponse Vinted, quelle que soit sa forme. */
export function extractItemId(response) {
  if (!response || typeof response !== 'object') return null;
  const candidates = [
    response.draft?.id,
    response.item?.id,
    response.id,
    response.data?.id,
    response.draft?.item_id,
    response.item?.item_id,
  ];
  for (const candidate of candidates) {
    const n = Number(candidate);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

export function itemUrl(domain, id) {
  return id ? `https://www.${domain}/items/${id}` : '';
}
