// Import CSV tolérant : séparateur , ou ;, en-têtes FR ou EN.

import { normalizeDraft, normalizePrice, parseColorIds, toId } from './schema.js';

const HEADER_ALIASES = {
  title: ['title', 'titre', 'nom', 'name'],
  description: ['description', 'desc', 'descriptif', 'texte'],
  price: ['price', 'prix', 'montant', 'amount'],
  catalogId: ['catalog_id', 'catalogid', 'categorie_id', 'category_id', 'categorie', 'category', 'cat'],
  catalogLabel: ['catalog_label', 'categorie', 'category_path', 'category_name'],
  brand: ['brand', 'marque'],
  brandId: ['brand_id', 'marque_id'],
  sizeId: ['size_id', 'taille_id'],
  sizeLabel: ['size', 'taille'],
  conditionId: ['condition_id', 'etat_id', 'status_id'],
  conditionLabel: ['condition', 'etat', 'état'],
  colorIds: ['color_ids', 'couleur_ids', 'couleurs', 'colors'],
  packageSizeId: ['package_size_id', 'colis_id', 'package_size'],
  photos: ['photos', 'photo_urls', 'images', 'image_urls', 'photo'],
  currency: ['currency', 'devise'],
};

const CONDITION_BY_LABEL = new Map([
  ['neuf avec etiquette', 6],
  ['neuf avec étiquette', 6],
  ['new with tags', 6],
  ['neuf sans etiquette', 1],
  ['neuf sans étiquette', 1],
  ['new without tags', 1],
  ['tres bon etat', 2],
  ['très bon état', 2],
  ['very good', 2],
  ['bon etat', 3],
  ['bon état', 3],
  ['good', 3],
  ['satisfaisant', 4],
  ['satisfactory', 4],
]);

export function detectDelimiter(source) {
  const firstLine = String(source || '').split('\n')[0] || '';
  const counts = { ',': 0, ';': 0, '\t': 0 };
  let quoted = false;
  for (const char of firstLine) {
    if (char === '"') quoted = !quoted;
    else if (!quoted && char in counts) counts[char] += 1;
  }
  const [best] = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return best[1] > 0 ? best[0] : ',';
}

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const source = String(text || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const delimiter = detectDelimiter(source);

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === delimiter) {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => String(cell).trim() !== ''));
}

function keyFor(header) {
  const clean = String(header || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
  for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
    if (aliases.includes(clean)) return key;
  }
  return null;
}

export function rowsToDrafts(rows, options = {}) {
  if (!rows.length) return [];
  const headers = rows[0].map(keyFor);
  const drafts = [];
  for (const row of rows.slice(1)) {
    const record = {};
    headers.forEach((key, index) => {
      if (key) record[key] = String(row[index] ?? '').trim();
    });
    if (!record.title && !record.description) continue;
    drafts.push(recordToDraft(record, options));
  }
  return drafts;
}

function recordToDraft(record, options = {}) {
  const conditionId =
    toId(record.conditionId) ||
    CONDITION_BY_LABEL.get(String(record.conditionLabel || '').toLowerCase()) ||
    2;

  // « categorie » peut contenir un identifiant ou un nom : on garde les deux.
  const rawCatalog = String(record.catalogId || '').trim();
  const catalogId = toId(rawCatalog);

  return normalizeDraft({
    title: record.title || '',
    description: record.description || '',
    price: normalizePrice(record.price),
    catalogId,
    catalogLabel: record.catalogLabel || (catalogId ? '' : rawCatalog),
    brand: record.brand || '',
    brandId: toId(record.brandId),
    sizeId: toId(record.sizeId),
    sizeLabel: record.sizeLabel || '',
    conditionId,
    colorIds: parseColorIds(record.colorIds),
    packageSizeId: toId(record.packageSizeId) || 1,
    currency: record.currency || options.currency || 'EUR',
    photoUrls: String(record.photos || '')
      .split(/[|\n]+/)
      .map((s) => s.trim())
      .filter(Boolean),
  });
}

export function draftsToCsv(drafts) {
  const headers = [
    'title',
    'description',
    'price',
    'currency',
    'catalog_id',
    'catalog_label',
    'brand',
    'brand_id',
    'size_id',
    'size',
    'condition_id',
    'color_ids',
    'package_size_id',
  ];
  const lines = [headers.join(',')];
  for (const draft of drafts) {
    lines.push(
      [
        draft.title,
        draft.description,
        draft.price,
        draft.currency,
        draft.catalogId ?? '',
        draft.catalogLabel ?? '',
        draft.brand,
        draft.brandId ?? '',
        draft.sizeId ?? '',
        draft.sizeLabel ?? '',
        draft.conditionId ?? '',
        (draft.colorIds || []).join('|'),
        draft.packageSizeId ?? '',
      ]
        .map(csvCell)
        .join(',')
    );
  }
  return lines.join('\n');
}

function csvCell(value) {
  const text = String(value ?? '');
  if (/[",\n;]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}
