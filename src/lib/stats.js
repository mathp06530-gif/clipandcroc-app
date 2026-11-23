// Statistiques du tableau de bord et analyse des prix du marché.

import { normalizeDraft } from './schema.js';
import { scoreDraft } from './score.js';

export const STATUS_ORDER = ['draft', 'draft_on_vinted', 'published', 'publishing', 'error'];

export const STATUS_LABELS = {
  draft: 'Brouillon',
  draft_on_vinted: 'Brouillon Vinted',
  published: 'En ligne',
  publishing: 'En cours',
  error: 'Erreur',
};

export function listingMargin(draft) {
  const d = normalizeDraft(draft);
  const price = Number(d.price) || 0;
  const cost = Number(d.cost);
  if (!d.cost || !Number.isFinite(cost)) return null;
  return Math.round((price - cost) * 100) / 100;
}

export function dashboardStats(drafts = []) {
  const byStatus = Object.fromEntries(STATUS_ORDER.map((status) => [status, 0]));
  let onlineValue = 0;
  let marginTotal = 0;
  let marginCount = 0;
  let photoCount = 0;
  let scoreSum = 0;

  for (const raw of drafts) {
    const draft = normalizeDraft(raw);
    byStatus[draft.status] = (byStatus[draft.status] || 0) + 1;
    photoCount += draft.photos.length;
    scoreSum += scoreDraft(draft).score;
    if (draft.status === 'published') onlineValue += Number(draft.price) || 0;
    const margin = listingMargin(draft);
    if (margin !== null) {
      marginTotal += margin;
      marginCount += 1;
    }
  }

  return {
    total: drafts.length,
    byStatus,
    online: byStatus.published || 0,
    onlineValue: round(onlineValue),
    marginTotal: round(marginTotal),
    marginCount,
    photoCount,
    averageScore: drafts.length ? Math.round(scoreSum / drafts.length) : 0,
  };
}

export function priceStats(amounts = []) {
  const values = amounts.map(Number).filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  if (!values.length) return { count: 0, min: 0, median: 0, max: 0, average: 0 };
  const middle = Math.floor(values.length / 2);
  const median = values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
  return {
    count: values.length,
    min: round(values[0]),
    median: round(median),
    max: round(values[values.length - 1]),
    average: round(values.reduce((sum, value) => sum + value, 0) / values.length),
  };
}

/** Fourchette conseillée : la médiane, encadrée par les premier et troisième quarts. */
export function suggestedRange(amounts = []) {
  const values = amounts.map(Number).filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  if (values.length < 3) return null;
  const q = (p) => values[Math.min(values.length - 1, Math.floor((values.length - 1) * p))];
  return {
    low: round(q(0.25)),
    median: round(priceStats(values).median),
    high: round(q(0.75)),
    count: values.length,
  };
}

function round(value) {
  return Math.round(value * 100) / 100;
}
