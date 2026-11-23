// Modèle de données des annonces + validation.

export const VINTED_DOMAINS = [
  'vinted.fr',
  'vinted.be',
  'vinted.de',
  'vinted.at',
  'vinted.es',
  'vinted.it',
  'vinted.nl',
  'vinted.co.uk',
  'vinted.ie',
  'vinted.pt',
  'vinted.pl',
  'vinted.cz',
  'vinted.sk',
  'vinted.hu',
  'vinted.ro',
  'vinted.lt',
  'vinted.se',
  'vinted.fi',
  'vinted.gr',
  'vinted.lu',
  'vinted.com',
];

export const CURRENCY_BY_DOMAIN = {
  'vinted.fr': 'EUR',
  'vinted.be': 'EUR',
  'vinted.de': 'EUR',
  'vinted.at': 'EUR',
  'vinted.es': 'EUR',
  'vinted.it': 'EUR',
  'vinted.nl': 'EUR',
  'vinted.ie': 'EUR',
  'vinted.pt': 'EUR',
  'vinted.sk': 'EUR',
  'vinted.fi': 'EUR',
  'vinted.gr': 'EUR',
  'vinted.lu': 'EUR',
  'vinted.co.uk': 'GBP',
  'vinted.pl': 'PLN',
  'vinted.cz': 'CZK',
  'vinted.hu': 'HUF',
  'vinted.ro': 'RON',
  'vinted.lt': 'EUR',
  'vinted.se': 'SEK',
  'vinted.com': 'EUR',
};

export const LOCALE_BY_DOMAIN = {
  'vinted.fr': 'fr-FR',
  'vinted.be': 'fr-BE',
  'vinted.de': 'de-DE',
  'vinted.at': 'de-AT',
  'vinted.es': 'es-ES',
  'vinted.it': 'it-IT',
  'vinted.nl': 'nl-NL',
  'vinted.co.uk': 'en-GB',
  'vinted.ie': 'en-IE',
  'vinted.pt': 'pt-PT',
  'vinted.pl': 'pl-PL',
  'vinted.cz': 'cs-CZ',
  'vinted.sk': 'sk-SK',
  'vinted.hu': 'hu-HU',
  'vinted.ro': 'ro-RO',
  'vinted.lt': 'lt-LT',
  'vinted.se': 'sv-SE',
  'vinted.fi': 'fi-FI',
  'vinted.gr': 'el-GR',
  'vinted.lu': 'fr-LU',
  'vinted.com': 'en-US',
};

// Identifiants d'état communs à tous les catalogues Vinted.
export const CONDITION_OPTIONS = [
  { id: 6, label: 'Neuf avec étiquette' },
  { id: 1, label: 'Neuf sans étiquette' },
  { id: 2, label: 'Très bon état' },
  { id: 3, label: 'Bon état' },
  { id: 4, label: 'Satisfaisant' },
];

export const PACKAGE_SIZE_OPTIONS = [
  { id: 1, label: 'Petit colis (S)' },
  { id: 2, label: 'Colis moyen (M)' },
  { id: 3, label: 'Grand colis (L)' },
];

export const TITLE_MAX = 100;
export const DESCRIPTION_MAX = 2000;

export function currencyForDomain(domain) {
  return CURRENCY_BY_DOMAIN[domain] || 'EUR';
}

export function localeForDomain(domain) {
  return LOCALE_BY_DOMAIN[domain] || 'fr-FR';
}

export function newDraft(overrides = {}) {
  const now = Date.now();
  return {
    id: globalThis.crypto?.randomUUID?.() || `d-${now}-${Math.random().toString(16).slice(2)}`,
    createdAt: now,
    updatedAt: now,
    status: 'draft', // draft | publishing | published | draft_on_vinted | error
    title: '',
    description: '',
    price: '',
    cost: '',
    sku: '',
    currency: 'EUR',
    catalogId: null,
    catalogLabel: '',
    brand: '',
    brandId: null,
    sizeId: null,
    sizeLabel: '',
    conditionId: 2,
    colorIds: [],
    colorLabels: [],
    packageSizeId: 1,
    photos: [], // [{ id, name }] — les images sont dans IndexedDB
    remoteId: null,
    remoteUrl: '',
    remoteMode: '',
    error: '',
    publishedAt: null,
    ...overrides,
  };
}

export function normalizeDraft(input = {}) {
  const draft = newDraft();
  const merged = { ...draft, ...input };
  merged.title = String(merged.title || '').replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX);
  merged.description = String(merged.description || '').trim().slice(0, DESCRIPTION_MAX);
  merged.price = normalizePrice(merged.price);
  merged.cost = normalizePrice(merged.cost);
  merged.sku = String(merged.sku || '').trim().slice(0, 24);
  merged.catalogId = toId(merged.catalogId);
  merged.brandId = toId(merged.brandId);
  merged.sizeId = toId(merged.sizeId);
  merged.conditionId = toId(merged.conditionId) ?? 2;
  merged.packageSizeId = toId(merged.packageSizeId) ?? 1;
  merged.colorIds = (Array.isArray(merged.colorIds) ? merged.colorIds : []).map(toId).filter(Boolean);
  merged.colorLabels = Array.isArray(merged.colorLabels) ? merged.colorLabels.map(String) : [];
  merged.photos = Array.isArray(merged.photos) ? merged.photos.filter((p) => p && p.id) : [];
  merged.brand = String(merged.brand || '').trim();
  merged.catalogLabel = String(merged.catalogLabel || '').trim();
  merged.sizeLabel = String(merged.sizeLabel || '').trim();
  merged.currency = String(merged.currency || 'EUR').toUpperCase();
  return merged;
}

export function toId(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
}

export function normalizePrice(value) {
  if (value === null || value === undefined) return '';
  const raw = String(value).replace(',', '.').replace(/[^\d.]/g, '');
  if (!raw) return '';
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n)) return '';
  return String(Math.round(n * 100) / 100);
}

export function parseColorIds(value) {
  if (Array.isArray(value)) return value.map(toId).filter(Boolean);
  return String(value || '')
    .split(/[|,;/\s]+/)
    .map((v) => toId(v))
    .filter(Boolean);
}

/**
 * Contrôle une annonce avant envoi. `errors` bloquent la publication,
 * `warnings` signalent un risque de brouillon incomplet côté Vinted.
 */
export function validateDraft(draft) {
  const d = normalizeDraft(draft);
  const errors = [];
  const warnings = [];

  if (d.title.length < 5) errors.push({ field: 'title', message: 'Le titre doit faire au moins 5 caractères.' });
  if (d.title.length > TITLE_MAX) errors.push({ field: 'title', message: `Le titre dépasse ${TITLE_MAX} caractères.` });
  if (d.description.length < 5) errors.push({ field: 'description', message: 'La description doit faire au moins 5 caractères.' });
  if (!d.price || Number(d.price) <= 0) errors.push({ field: 'price', message: 'Indiquez un prix supérieur à 0.' });
  if (!d.catalogId) errors.push({ field: 'catalogId', message: 'Choisissez une catégorie (ou son identifiant).' });
  if (!d.brand) errors.push({ field: 'brand', message: 'Indiquez la marque.' });
  if (!d.conditionId) errors.push({ field: 'conditionId', message: "Choisissez l'état de l'article." });
  if (!d.packageSizeId) errors.push({ field: 'packageSizeId', message: 'Choisissez la taille du colis.' });
  if (!d.photos.length) errors.push({ field: 'photos', message: 'Ajoutez au moins une photo.' });
  if (!d.sizeId) warnings.push({ field: 'sizeId', message: 'Aucune taille sélectionnée : Vinted peut refuser la publication.' });
  if (!d.colorIds.length) warnings.push({ field: 'colorIds', message: 'Aucune couleur sélectionnée.' });
  if (d.photos.length > 20) warnings.push({ field: 'photos', message: 'Vinted accepte 20 photos maximum.' });

  return { ok: errors.length === 0, errors, warnings, draft: d };
}

export function nextSku(drafts = []) {
  let max = 0;
  for (const draft of drafts) {
    const match = /^E-(\d+)$/.exec(String(draft?.sku || ''));
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `E-${String(max + 1).padStart(4, '0')}`;
}
