import test from 'node:test';
import assert from 'node:assert/strict';

import { dashboardStats, listingMargin, priceStats, suggestedRange } from '../src/lib/stats.js';
import { newDraft } from '../src/lib/schema.js';

const base = {
  ...newDraft({ id: 'x' }),
  title: 'Article de test avec un titre correct',
  description: 'Description suffisamment longue pour valider les critères de qualité sans souci particulier.',
  price: '40',
  cost: '15',
  catalogId: 1904,
  brand: 'Zara',
  brandId: 179,
  sizeId: 208,
  conditionId: 2,
  colorIds: [1],
  photos: [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }],
};

test('dashboardStats compte les statuts et les montants', () => {
  const drafts = [
    { ...base, id: 'a', status: 'published', price: '40' },
    { ...base, id: 'b', status: 'published', price: '60', cost: '20' },
    { ...base, id: 'c', status: 'draft', price: '10' },
    { ...base, id: 'd', status: 'error', price: '5' },
  ];
  const stats = dashboardStats(drafts);
  assert.equal(stats.total, 4);
  assert.equal(stats.online, 2);
  assert.equal(stats.byStatus.published, 2);
  assert.equal(stats.byStatus.draft, 1);
  assert.equal(stats.byStatus.error, 1);
  assert.equal(stats.onlineValue, 100);
  assert.equal(stats.marginTotal, 50);
  assert.equal(stats.marginCount, 4);
  assert.equal(stats.photoCount, 12);
  assert.ok(stats.averageScore > 80);
});

test('dashboardStats gère une liste vide', () => {
  const stats = dashboardStats([]);
  assert.equal(stats.total, 0);
  assert.equal(stats.averageScore, 0);
  assert.equal(stats.onlineValue, 0);
});

test('listingMargin ne calcule que si le prix d’achat existe', () => {
  assert.equal(listingMargin({ ...base, price: '40', cost: '15' }), 25);
  assert.equal(listingMargin({ ...base, price: '40', cost: '' }), null);
  assert.equal(listingMargin({ ...base, price: '10', cost: '15' }), -5);
});

test('priceStats calcule médiane, moyenne et bornes', () => {
  const stats = priceStats([10, 20, 30, 40]);
  assert.equal(stats.count, 4);
  assert.equal(stats.min, 10);
  assert.equal(stats.max, 40);
  assert.equal(stats.median, 25);
  assert.equal(stats.average, 25);

  const odd = priceStats([5, 9, 12]);
  assert.equal(odd.median, 9);
  assert.equal(priceStats([]).count, 0);
});

test('suggestedRange exige au moins trois annonces', () => {
  assert.equal(suggestedRange([10, 20]), null);
  const range = suggestedRange([10, 20, 30, 40, 50, 60, 70, 80]);
  assert.equal(range.count, 8);
  assert.ok(range.low <= range.median && range.median <= range.high);
});
