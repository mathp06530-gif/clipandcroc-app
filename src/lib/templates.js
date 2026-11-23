// Modèles de description réutilisables, avec variables.

import { CONDITION_OPTIONS, normalizeDraft } from './schema.js';

export const TEMPLATE_VARIABLES = [
  { key: 'titre', label: 'Titre' },
  { key: 'marque', label: 'Marque' },
  { key: 'taille', label: 'Taille' },
  { key: 'etat', label: 'État' },
  { key: 'couleur', label: 'Couleur' },
  { key: 'categorie', label: 'Catégorie' },
  { key: 'prix', label: 'Prix' },
  { key: 'sku', label: 'Référence' },
];

export const DEFAULT_TEMPLATES = [
  {
    id: 'tpl-essentiel',
    name: 'Essentiel',
    body:
      '{{titre}}\n\n' +
      'Marque : {{marque}}\n' +
      'Taille : {{taille}}\n' +
      'État : {{etat}}\n' +
      'Couleur : {{couleur}}\n\n' +
      'Envoi rapide et soigné sous 24 h. Article propre, provenant d’un foyer non-fumeur.',
  },
  {
    id: 'tpl-mesures',
    name: 'Avec mesures',
    body:
      '{{titre}}\n\n' +
      'Marque : {{marque}}\n' +
      'Taille indiquée : {{taille}}\n' +
      'État : {{etat}}\n\n' +
      'Mesures à plat :\n' +
      '• Épaules : … cm\n' +
      '• Poitrine : … cm\n' +
      '• Longueur : … cm\n\n' +
      'Dites-moi si vous avez besoin d’une autre mesure. Envoi sous 24 h.',
  },
  {
    id: 'tpl-vintage',
    name: 'Vintage',
    body:
      '{{titre}} — pièce vintage en {{etat}}.\n\n' +
      'Marque : {{marque}}\n' +
      'Taille : {{taille}}\n' +
      'Couleur : {{couleur}}\n\n' +
      'Quelques traces d’usage normales qui font son charme (voir photos). ' +
      'Coupe et matière d’époque, introuvable en neuf.\n\n' +
      'Emballage soigné, envoi rapide.',
  },
];

export function conditionLabel(id) {
  return CONDITION_OPTIONS.find((option) => Number(option.id) === Number(id))?.label || '';
}

export function renderTemplate(body, input) {
  const draft = normalizeDraft(input);
  const values = {
    titre: draft.title,
    marque: draft.brand,
    taille: draft.sizeLabel || (draft.sizeId ? `#${draft.sizeId}` : ''),
    etat: conditionLabel(draft.conditionId),
    couleur: draft.colorLabels.join(', '),
    categorie: draft.catalogLabel,
    prix: draft.price ? `${draft.price} ${draft.currency}` : '',
    sku: draft.sku,
  };
  return String(body || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key) => {
    if (!(key in values)) return match;
    return values[key] || '';
  });
}

export function newTemplate(overrides = {}) {
  return {
    id: globalThis.crypto?.randomUUID?.() || `tpl-${Date.now()}`,
    name: 'Nouveau modèle',
    body: '{{titre}}\n\nMarque : {{marque}}\nTaille : {{taille}}\nÉtat : {{etat}}\n\n',
    ...overrides,
  };
}
