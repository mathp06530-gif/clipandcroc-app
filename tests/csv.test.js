import test from 'node:test';
import assert from 'node:assert/strict';

import { detectDelimiter, draftsToCsv, parseCsv, rowsToDrafts } from '../src/lib/csv.js';

test('parseCsv gère les guillemets, les virgules et les points-virgules', () => {
  const rows = parseCsv('title;description;price\n"Sweat, bleu";"Ligne 1\nLigne 2";12,50\n');
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], ['title', 'description', 'price']);
  assert.deepEqual(rows[1], ['Sweat, bleu', 'Ligne 1\nLigne 2', '12,50']);
});

test('detectDelimiter choisit le séparateur de la ligne d’en-têtes', () => {
  assert.equal(detectDelimiter('titre;prix;marque\nA;1;B'), ';');
  assert.equal(detectDelimiter('title,price,brand\nA,1,B'), ',');
  assert.equal(detectDelimiter('titre\nA'), ',');
});

test('parseCsv ignore les lignes vides et le BOM', () => {
  const rows = parseCsv('\uFEFFtitre,prix\n\nVeste,20\n');
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[1], ['Veste', '20']);
});

test('rowsToDrafts convertit les en-têtes français', () => {
  const rows = parseCsv(
    'titre;description;prix;categorie_id;marque;taille;etat;couleurs;colis\n' +
      'Robe fleurie;Très bon état;18,5;1904;Zara;M;Très bon état;7|2;1\n'
  );
  const drafts = rowsToDrafts(rows, { currency: 'EUR' });
  assert.equal(drafts.length, 1);
  const [draft] = drafts;
  assert.equal(draft.title, 'Robe fleurie');
  assert.equal(draft.price, '18.5');
  assert.equal(draft.catalogId, 1904);
  assert.equal(draft.brand, 'Zara');
  assert.equal(draft.conditionId, 2);
  assert.deepEqual(draft.colorIds, [7, 2]);
  assert.equal(draft.packageSizeId, 1);
  assert.equal(draft.currency, 'EUR');
});

test('rowsToDrafts accepte les en-têtes anglais et les photos par lien', () => {
  const rows = parseCsv('title,description,price,brand,photos\nBag,Cuir noir,42,Zara,https://a.test/1.jpg|https://a.test/2.jpg\n');
  const [draft] = rowsToDrafts(rows);
  assert.equal(draft.brand, 'Zara');
  assert.equal(draft.photoUrls.length, 2);
});

test('draftsToCsv produit un CSV relisible', () => {
  const csv = draftsToCsv([
    {
      title: 'Sweat "coton"',
      description: 'Bon état',
      price: '15',
      currency: 'EUR',
      catalogId: 1908,
      catalogLabel: 'Sweats',
      brand: 'Nike',
      brandId: 53,
      sizeId: 208,
      sizeLabel: 'M',
      conditionId: 3,
      colorIds: [1, 7],
      packageSizeId: 2,
    },
  ]);
  const rows = parseCsv(csv);
  assert.equal(rows.length, 2);
  assert.equal(rows[1][0], 'Sweat "coton"');
  assert.equal(rows[1][11], '1|7');
});
