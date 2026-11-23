import test from 'node:test';
import assert from 'node:assert/strict';

import { scoreDraft } from '../src/lib/score.js';
import { newDraft } from '../src/lib/schema.js';

const complete = {
  ...newDraft({ id: 's1' }),
  title: 'Sweat Tommy Hilfiger taille M bleu marine',
  description: 'Porté deux fois, très bon état, aucune tache. Matière 100 % coton, coupe droite. Envoi sous 24 h.',
  price: '25',
  catalogId: 1908,
  catalogLabel: 'Sweats',
  brand: 'Tommy Hilfiger',
  brandId: 94,
  sizeId: 208,
  conditionId: 2,
  colorIds: [7],
  photos: [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }],
};

test('une annonce complète obtient 100 et la note A', () => {
  const result = scoreDraft(complete);
  assert.equal(result.score, 100);
  assert.equal(result.grade, 'A');
  assert.ok(result.criteria.every((item) => item.ok));
});

test('une annonce vide ne garde que les points de l’état par défaut', () => {
  const result = scoreDraft(newDraft());
  assert.equal(result.score, 5);
  assert.equal(result.grade, 'D');
  assert.equal(result.criteria.length, 9);
});

test('une seule photo donne un score partiel sur la photo', () => {
  const result = scoreDraft({ ...complete, photos: [{ id: 'p1' }] });
  const photos = result.criteria.find((item) => item.id === 'photos');
  assert.equal(photos.ok, false);
  assert.equal(photos.points, 8);
  assert.equal(result.score, 88);
});

test('une marque sans identifiant vaut la moitié des points', () => {
  const result = scoreDraft({ ...complete, brandId: null });
  const brand = result.criteria.find((item) => item.id === 'brand');
  assert.equal(brand.points, 5);
  assert.equal(result.score, 95);
});

test('le score reste borné entre 0 et 100', () => {
  const result = scoreDraft({ ...complete, title: 'x'.repeat(200), photos: Array.from({ length: 30 }, (_, i) => ({ id: `p${i}` })) });
  assert.ok(result.score >= 0 && result.score <= 100);
});
