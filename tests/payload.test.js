import test from 'node:test';
import assert from 'node:assert/strict';

import { buildDraftBody, buildItemPayload, buildLiveItemBody, extractItemId, itemUrl } from '../src/lib/payload.js';
import { newDraft, normalizeDraft, validateDraft, normalizePrice } from '../src/lib/schema.js';

const baseDraft = {
  ...newDraft({ id: 'draft-1' }),
  title: 'Sweat Tommy Hilfiger M',
  description: 'Très bon état, porté deux fois.',
  price: '25',
  currency: 'EUR',
  catalogId: 1908,
  brand: 'Tommy Hilfiger',
  brandId: 94,
  sizeId: 208,
  conditionId: 2,
  colorIds: [7],
  packageSizeId: 1,
};

test('buildItemPayload respecte le format attendu par Vinted', () => {
  const payload = buildItemPayload(baseDraft, [11, 12], 'session-1');
  assert.equal(payload.title, 'Sweat Tommy Hilfiger M');
  assert.equal(payload.catalog_id, 1908);
  assert.equal(payload.brand_id, 94);
  assert.equal(payload.brand, 'Tommy Hilfiger');
  assert.equal(payload.price, 25);
  assert.equal(payload.package_size_id, 1);
  assert.equal(payload.temp_uuid, 'session-1');
  assert.equal(payload.currency, 'EUR');
  assert.deepEqual(payload.assigned_photos, [
    { id: 11, orientation: 0 },
    { id: 12, orientation: 0 },
  ]);
  assert.deepEqual(payload.item_attributes, [
    { code: 'condition', ids: [2] },
    { code: 'size', ids: [208] },
  ]);
  assert.deepEqual(payload.color_ids, [7]);
  assert.equal(payload.id, null);
});

test("buildItemPayload omet la taille quand elle n'est pas renseignée", () => {
  const payload = buildItemPayload({ ...baseDraft, sizeId: null }, [1], 's');
  assert.deepEqual(payload.item_attributes, [{ code: 'condition', ids: [2] }]);
});

test('buildDraftBody et buildLiveItemBody enveloppent le payload', () => {
  const item = buildItemPayload(baseDraft, [1], 's');
  const draftBody = buildDraftBody(item, 's');
  assert.equal(draftBody.upload_session_id, 's');
  assert.equal(draftBody.draft, item);
  assert.equal(draftBody.parcel, null);

  const liveBody = buildLiveItemBody(item, 's');
  assert.equal(liveBody.item, item);
  assert.equal(liveBody.push_up, false);
});

test('extractItemId gère les différentes formes de réponse', () => {
  assert.equal(extractItemId({ draft: { id: 123 } }), 123);
  assert.equal(extractItemId({ item: { id: '456' } }), 456);
  assert.equal(extractItemId({ id: 789 }), 789);
  assert.equal(extractItemId({}), null);
});

test('itemUrl construit le lien public', () => {
  assert.equal(itemUrl('vinted.fr', 42), 'https://www.vinted.fr/items/42');
});

test('validateDraft bloque les annonces incomplètes', () => {
  const result = validateDraft(newDraft());
  assert.equal(result.ok, false);
  const fields = result.errors.map((error) => error.field);
  assert.ok(fields.includes('title'));
  assert.ok(fields.includes('price'));
  assert.ok(fields.includes('photos'));
});

test('validateDraft accepte une annonce complète', () => {
  const result = validateDraft({ ...baseDraft, photos: [{ id: 'p1' }] });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.warnings.length, 0);
});

test('normalizeDraft nettoie les valeurs saisies', () => {
  const draft = normalizeDraft({
    title: '  Sweat   coton  ',
    price: '12,90 €',
    conditionId: '3',
    colorIds: ['7', '', null, '2'],
  });
  assert.equal(draft.title, 'Sweat coton');
  assert.equal(draft.price, '12.9');
  assert.equal(draft.conditionId, 3);
  assert.deepEqual(draft.colorIds, [7, 2]);
  assert.equal(normalizePrice('abc'), '');
});
