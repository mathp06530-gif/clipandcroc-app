import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_TEMPLATES, conditionLabel, newTemplate, renderTemplate } from '../src/lib/templates.js';
import { newDraft } from '../src/lib/schema.js';

const draft = {
  ...newDraft({ id: 't1' }),
  title: 'Robe fleurie Zara',
  brand: 'Zara',
  sizeLabel: 'M',
  sizeId: 208,
  conditionId: 2,
  colorLabels: ['Bleu', 'Blanc'],
  catalogLabel: 'Femmes > Robes',
  price: '18.5',
  currency: 'EUR',
  sku: 'E-0007',
};

test('renderTemplate remplace les variables connues', () => {
  const text = renderTemplate('{{titre}} / {{marque}} / {{taille}} / {{etat}} / {{couleur}} / {{prix}} / {{sku}}', draft);
  assert.equal(text, 'Robe fleurie Zara / Zara / M / Très bon état / Bleu, Blanc / 18.5 EUR / E-0007');
});

test('les variables inconnues sont conservées', () => {
  assert.equal(renderTemplate('{{titre}} {{inconnue}}', draft), 'Robe fleurie Zara {{inconnue}}');
});

test('les variables vides ne laissent pas de placeholder', () => {
  const empty = newDraft({ id: 't2' });
  assert.equal(renderTemplate('[{{marque}}]', empty), '[]');
});

test('conditionLabel renvoie le libellé français', () => {
  assert.equal(conditionLabel(2), 'Très bon état');
  assert.equal(conditionLabel(999), '');
});

test('les modèles par défaut contiennent le titre', () => {
  assert.ok(DEFAULT_TEMPLATES.length >= 3);
  for (const template of DEFAULT_TEMPLATES) {
    assert.match(template.body, /\{\{titre\}\}/);
    assert.ok(template.name);
    assert.ok(template.id);
  }
});

test('newTemplate génère un identifiant unique', () => {
  const a = newTemplate();
  const b = newTemplate();
  assert.notEqual(a.id, b.id);
  assert.equal(a.name, 'Nouveau modèle');
});
