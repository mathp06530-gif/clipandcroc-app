import {
  CONDITION_OPTIONS,
  DESCRIPTION_MAX,
  PACKAGE_SIZE_OPTIONS,
  TITLE_MAX,
  VINTED_DOMAINS,
  currencyForDomain,
  localeForDomain,
  newDraft,
  nextSku,
  normalizeDraft,
  normalizePrice,
  validateDraft,
} from '../lib/schema.js';
import { draftsToCsv, parseCsv, rowsToDrafts } from '../lib/csv.js';
import { createVintedApi } from '../lib/vinted-api.js';
import { createDemoTransport } from '../lib/demo.js';
import { createTabTransport, ensureBridge, ensureVintedTab, findVintedTab, sleep } from '../lib/transport.js';
import { compressImage, deletePhoto, getPhoto, loadPhotoPayload, putPhoto } from '../lib/photos.js';
import { bumpCounter, formatDuration, randomDelayMs, remainingToday, todayKey } from '../lib/pacing.js';
import { scoreDraft } from '../lib/score.js';
import { DEFAULT_TEMPLATES, TEMPLATE_VARIABLES, newTemplate, renderTemplate } from '../lib/templates.js';
import { STATUS_LABELS, dashboardStats, listingMargin, suggestedRange } from '../lib/stats.js';
import { itemUrl } from '../lib/payload.js';

// Repli hors extension (ouverture directe de studio.html) : stockage local du
// navigateur, sans accès aux onglets Vinted.
if (!globalThis.chrome?.storage?.local) {
  const readAll = () => {
    try {
      return JSON.parse(localStorage.getItem('etal-studio') || '{}');
    } catch {
      return {};
    }
  };
  globalThis.chrome = {
    storage: {
      local: {
        get: async (keys) => {
          const all = readAll();
          if (keys == null) return all;
          const list = Array.isArray(keys) ? keys : [keys];
          const out = {};
          for (const key of list) if (key in all) out[key] = all[key];
          return out;
        },
        set: async (values) => {
          localStorage.setItem('etal-studio', JSON.stringify({ ...readAll(), ...values }));
        },
      },
    },
    tabs: {
      query: async () => [],
      create: async () => ({}),
      sendMessage: async () => {
        throw new Error("Indisponible hors de l'extension.");
      },
      onUpdated: { addListener() {}, removeListener() {} },
    },
    scripting: { executeScript: async () => {} },
    permissions: { request: async () => false },
    runtime: { getURL: (path) => path },
  };
}

const DEFAULTS = {
  domain: 'vinted.fr',
  mode: 'live',
  minDelay: 45,
  maxDelay: 120,
  dailyLimit: 10,
  demoMode: false,
};

const FILTERS = [
  ['all', 'Toutes'],
  ['draft', 'Brouillons'],
  ['published', 'En ligne'],
  ['error', 'Erreurs'],
];

const state = {
  drafts: [],
  templates: [],
  settings: { ...DEFAULTS },
  counter: null,
  view: 'listings',
  filter: 'all',
  query: '',
  activeId: null,
  estimate: null,
  meta: { colors: [], sizes: [], catalogResults: [], brandResults: [] },
  catalogQuery: '',
  brandQuery: '',
  api: null,
  connection: { status: 'idle' },
  photoCache: new Map(),
};

const queue = { running: false, stop: false, nextAt: 0, progress: 0, log: [] };

const refs = {
  main: document.getElementById('main'),
  connection: document.getElementById('connection'),
  quotaFill: document.getElementById('quota-fill'),
  quotaText: document.getElementById('quota-text'),
  queue: document.getElementById('queue'),
  queueTitle: document.getElementById('queue-title'),
  queueStatus: document.getElementById('queue-status'),
  queueBar: document.getElementById('queue-bar'),
  queueLog: document.getElementById('queue-log'),
  drawer: document.getElementById('drawer'),
  drawerBody: document.getElementById('drawer-body'),
  backdrop: document.getElementById('drawer-backdrop'),
  photoInput: document.getElementById('photo-input'),
  csvInput: document.getElementById('csv-input'),
  toasts: document.getElementById('toasts'),
};

/* ------------------------------------------------------------------ utils */

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
}

function activeDraft() {
  return state.drafts.find((draft) => draft.id === state.activeId) || null;
}

function money(value, currency = 'EUR') {
  const number = Number(value) || 0;
  return `${number.toFixed(number % 1 === 0 ? 0 : 2).replace('.', ',')} ${currency === 'EUR' ? '€' : currency}`;
}

function priceText(draft) {
  return draft.price ? money(draft.price, draft.currency) : '—';
}

function statusLabel(status) {
  return STATUS_LABELS[status] || 'Brouillon';
}

function persist() {
  chrome.storage.local.set({
    drafts: state.drafts,
    templates: state.templates,
    settings: state.settings,
    counter: state.counter,
    activeId: state.activeId,
  });
}

function toast(message, kind = '') {
  const node = document.createElement('div');
  node.className = `toast ${kind}`.trim();
  node.textContent = message;
  refs.toasts.appendChild(node);
  setTimeout(() => node.remove(), kind === 'error' ? 7000 : 3600);
}

async function getCachedPhoto(photoId) {
  if (!photoId) return '';
  if (state.photoCache.has(photoId)) return state.photoCache.get(photoId);
  const dataUrl = await getPhoto(photoId).catch(() => null);
  state.photoCache.set(photoId, dataUrl || '');
  return dataUrl || '';
}

/* ---------------------------------------------------------------- storage */

async function loadState() {
  const stored = await chrome.storage.local.get(['drafts', 'templates', 'settings', 'counter', 'activeId']);
  state.settings = { ...DEFAULTS, ...(stored.settings || {}) };
  state.drafts = Array.isArray(stored.drafts) ? stored.drafts.map(normalizeDraft) : [];
  state.templates = Array.isArray(stored.templates) && stored.templates.length
    ? stored.templates
    : DEFAULT_TEMPLATES.map((template) => ({ ...template }));
  state.counter = stored.counter || null;
  state.activeId = stored.activeId && state.drafts.some((d) => d.id === stored.activeId) ? stored.activeId : null;
  if (!state.drafts.length) {
    const draft = newDraft({ currency: currencyForDomain(state.settings.domain), sku: nextSku([]) });
    state.drafts.push(draft);
    state.activeId = draft.id;
    persist();
  }
}

/* ----------------------------------------------------------------- render */

async function render() {
  renderRail();
  renderQuota();
  renderConnection();

  if (state.view === 'dashboard') refs.main.innerHTML = await dashboardMarkup();
  else if (state.view === 'templates') refs.main.innerHTML = templatesMarkup();
  else if (state.view === 'editor') refs.main.innerHTML = await editorMarkup();
  else refs.main.innerHTML = await listingsMarkup();
}

function renderRail() {
  document.querySelectorAll('.rail-item').forEach((button) => {
    button.classList.toggle('active', button.dataset.view === state.view || (state.view === 'editor' && button.dataset.view === 'listings'));
  });
}

function renderQuota() {
  const limit = Number(state.settings.dailyLimit) || 0;
  const used = state.counter && state.counter.date === todayKey() ? Number(state.counter.count) || 0 : 0;
  refs.quotaFill.style.width = limit > 0 ? `${Math.min(100, (used / limit) * 100)}%` : '0%';
  refs.quotaText.textContent = limit > 0 ? `${used} / ${limit} publiées` : `${used} publiées · sans plafond`;
}

function renderConnection() {
  const el = refs.connection;
  const label = el.querySelector('span');
  el.className = 'conn';
  if (state.connection.status === 'demo') {
    el.classList.add('demo');
    label.textContent = 'Mode démo';
  } else if (state.connection.status === 'ok') {
    el.classList.add('ok');
    label.textContent = `Connecté${state.connection.user ? ` · ${state.connection.user}` : ''}`;
  } else if (state.connection.status === 'bad') {
    el.classList.add('bad');
    label.textContent = state.connection.label || 'Non connecté';
  } else {
    label.textContent = 'Vérification…';
  }
}

/* --------------------------------------------------------------- listings */

async function listingsMarkup() {
  const cards = await listingCards();
  return `
    <div class="page-head">
      <div>
        <p class="eyebrow">Atelier</p>
        <h1>Vos annonces <span class="count">${state.drafts.length}</span></h1>
      </div>
      <div class="page-tools">
        <label class="search"><input id="search" type="search" placeholder="Rechercher un titre, une marque…" value="${esc(state.query)}" /></label>
        <div class="segmented">
          ${FILTERS.map(([key, label]) => `<button type="button" data-filter="${key}" class="${state.filter === key ? 'active' : ''}">${label}</button>`).join('')}
        </div>
      </div>
    </div>
    <div class="listing-grid" id="listing-grid">${cards}</div>`;
}

async function listingCards() {
  const query = state.query.trim().toLowerCase();
  const filtered = state.drafts.filter((draft) => {
    if (state.filter === 'draft' && !['draft', 'draft_on_vinted'].includes(draft.status)) return false;
    if (state.filter === 'published' && draft.status !== 'published') return false;
    if (state.filter === 'error' && draft.status !== 'error') return false;
    if (!query) return true;
    return `${draft.title} ${draft.brand} ${draft.catalogLabel} ${draft.sku}`.toLowerCase().includes(query);
  });

  const cards = await Promise.all(filtered.map(async (draft) => {
    const thumb = draft.photos.length ? await getCachedPhoto(draft.photos[0].id) : '';
    const score = scoreDraft(draft);
    return `
      <button class="listing-card" type="button" data-id="${esc(draft.id)}">
        <div class="thumb">
          ${thumb ? `<img src="${thumb}" alt="" />` : '▢'}
          <span class="score-pin grade-${score.grade}" title="Score de qualité">${score.score}</span>
        </div>
        <div class="body">
          <span class="status-pill ${esc(draft.status)}">${esc(statusLabel(draft.status))}</span>
          <h3>${esc(draft.title || 'Annonce sans titre')}</h3>
          <p class="meta">${esc([draft.brand, draft.sizeLabel, draft.catalogLabel].filter(Boolean).join(' · ') || 'À compléter')}</p>
          <div class="price-row"><strong>${esc(priceText(draft))}</strong><span class="sku">${esc(draft.sku || '')}</span></div>
        </div>
      </button>`;
  }));

  if (!filtered.length) {
    cards.push('<div class="empty-state"><h2>Rien ici</h2><p>Aucune annonce ne correspond à ce filtre.</p></div>');
  }
  cards.push('<button class="listing-card add" type="button" data-action="new"><span>+</span>Nouvelle annonce</button>');
  return cards.join('');
}

async function refreshListings() {
  const grid = document.getElementById('listing-grid');
  if (!grid) return;
  grid.innerHTML = await listingCards();
}

/* ----------------------------------------------------------------- editor */

async function editorMarkup() {
  const draft = activeDraft();
  if (!draft) {
    state.view = 'listings';
    return listingsMarkup();
  }

  const photos = await Promise.all(draft.photos.map(async (photo) => ({ ...photo, dataUrl: await getCachedPhoto(photo.id) })));
  const validation = validateDraft(draft);
  const score = scoreDraft(draft);
  const margin = listingMargin(draft);

  return `
    <button class="back" type="button" data-view="listings">← Toutes les annonces</button>

    <div class="editor-head">
      <div class="titles">
        <h1 id="editor-title-text">${esc(draft.title || 'Nouvelle annonce')}</h1>
        <span class="status-pill ${esc(draft.status)}">${esc(statusLabel(draft.status))}</span>
      </div>
      <div class="editor-actions">
        <button class="btn ghost" type="button" data-action="duplicate">Dupliquer</button>
        <button class="btn ghost danger" type="button" data-action="delete">Supprimer</button>
        <button class="btn" type="button" data-action="create-draft">Créer un brouillon</button>
        <button class="btn primary" type="button" data-action="publish">Publier maintenant</button>
      </div>
    </div>

    ${bannerFor(draft)}

    <div class="editor-grid">
      <div>
        <section class="card photo-drop" id="photo-drop">
          <div class="card-head">
            <h2>Photos</h2>
            <span class="muted" style="font-size:11.5px">${photos.length}/20 · la première sert de couverture</span>
          </div>
          <div class="photo-grid">
            ${photos.map((photo, index) => `
              <div class="photo" data-photo="${esc(photo.id)}">
                ${photo.dataUrl ? `<img src="${photo.dataUrl}" alt="" />` : '<div class="muted" style="display:grid;place-items:center;height:100%">?</div>'}
                ${index === 0 ? '<span class="tag">Couverture</span>' : ''}
                <div class="photo-tools">
                  <button type="button" data-photo-move="${esc(photo.id)}" data-dir="-1" title="Déplacer avant">←</button>
                  <button type="button" data-photo-move="${esc(photo.id)}" data-dir="1" title="Déplacer après">→</button>
                  <button type="button" data-photo-remove="${esc(photo.id)}" title="Retirer">×</button>
                </div>
              </div>`).join('')}
            <button class="photo-add" type="button" id="photo-add"><span>+</span>Ajouter des photos</button>
          </div>
        </section>

        <section class="card">
          <div class="card-head">
            <h2>Texte de l'annonce</h2>
            <select id="template-select" style="width:auto;padding:5px 8px;border:1.5px solid var(--line-strong);border-radius:6px;background:#fff;font-size:12px">
              <option value="">Insérer un modèle…</option>
              ${state.templates.map((template) => `<option value="${esc(template.id)}">${esc(template.name)}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label for="f-title">Titre <span class="hint"><span class="counter" data-counter="title">${draft.title.length}</span>/${TITLE_MAX}</span></label>
            <input id="f-title" type="text" data-field="title" maxlength="${TITLE_MAX}" value="${esc(draft.title)}" placeholder="Ex. : Sweat Tommy Hilfiger taille M bleu marine" />
          </div>
          <div class="field">
            <label for="f-description">Description <span class="hint"><span class="counter" data-counter="description">${draft.description.length}</span>/${DESCRIPTION_MAX}</span></label>
            <textarea id="f-description" data-field="description" maxlength="${DESCRIPTION_MAX}" placeholder="État, matière, mesures, raison de la vente…">${esc(draft.description)}</textarea>
          </div>
        </section>

        <section class="card">
          <div class="card-head"><h2>Détails Vinted</h2></div>
          <div class="field">
            <label for="f-catalog">Catégorie</label>
            ${draft.catalogId
              ? `<div class="selected-chip">${esc(draft.catalogLabel || `Catégorie #${draft.catalogId}`)}<button class="link" type="button" data-action="clear-catalog">Changer</button></div>`
              : `<div class="picker">
                   <input id="f-catalog" type="search" data-field="catalogSearch" value="${esc(state.catalogQuery)}" placeholder="Rechercher une catégorie (ex. robes)" autocomplete="off" />
                   <div class="picker-results" id="catalog-results">${pickerResults(state.meta.catalogResults, 'catalog', state.catalogQuery)}</div>
                 </div>`}
          </div>
          <div class="field">
            <label for="f-brand">Marque</label>
            <div class="picker">
              <input id="f-brand" type="search" data-field="brandSearch" value="${esc(draft.brand || state.brandQuery)}" placeholder="Ex. : Nike, Zara, Levi's…" autocomplete="off" />
              ${state.meta.brandResults.length ? `<div class="picker-results" id="brand-results">${pickerResults(state.meta.brandResults, 'brand', state.brandQuery)}</div>` : ''}
            </div>
          </div>
          <div class="field">
            <div class="two">
              <div>
                <label for="f-size">Taille</label>
                <select id="f-size" data-field="sizeId">
                  <option value="">— Choisir —</option>
                  ${state.meta.sizes.map((size) => `<option value="${size.id}" ${Number(draft.sizeId) === Number(size.id) ? 'selected' : ''}>${esc(size.label)}</option>`).join('')}
                  ${draft.sizeId && !state.meta.sizes.some((s) => Number(s.id) === Number(draft.sizeId)) ? `<option value="${draft.sizeId}" selected>Taille #${draft.sizeId}</option>` : ''}
                </select>
              </div>
              <div>
                <label for="f-condition">État</label>
                <select id="f-condition" data-field="conditionId">
                  ${CONDITION_OPTIONS.map((option) => `<option value="${option.id}" ${Number(draft.conditionId) === option.id ? 'selected' : ''}>${esc(option.label)}</option>`).join('')}
                </select>
              </div>
            </div>
            ${!state.meta.sizes.length ? '<p class="muted" style="font-size:11px;margin:6px 0 0">Les tailles se chargent après le choix de la catégorie. Sinon, renseignez l’identifiant dans « Options avancées ».</p>' : ''}
          </div>
          <div class="field">
            <span class="label">Couleurs</span>
            <div class="chips">
              ${state.meta.colors.length
                ? state.meta.colors.map((color) => `<button type="button" class="chip ${draft.colorIds.includes(color.id) ? 'on' : ''}" data-color="${color.id}" data-color-label="${esc(color.title)}">${esc(color.title)}</button>`).join('')
                : '<span class="muted" style="font-size:12px">Connectez-vous à Vinted pour charger les couleurs, ou saisissez leurs identifiants plus bas.</span>'}
            </div>
          </div>
          <div class="field">
            <label for="f-package">Taille du colis</label>
            <select id="f-package" data-field="packageSizeId">
              ${PACKAGE_SIZE_OPTIONS.map((option) => `<option value="${option.id}" ${Number(draft.packageSizeId) === option.id ? 'selected' : ''}>${esc(option.label)}</option>`).join('')}
            </select>
          </div>
        </section>
      </div>

      <div>
        <section class="card">
          <div class="card-head"><h2>Prix</h2></div>
          <div class="field">
            <label for="f-price">Prix de vente</label>
            <div class="price-input">
              <input id="f-price" type="number" min="0" step="0.5" data-field="price" value="${esc(draft.price)}" placeholder="0" />
              <span class="suffix">${esc(draft.currency)}</span>
            </div>
          </div>
          <div class="field">
            <label for="f-cost">Prix d'achat <span class="hint">pour calculer la marge</span></label>
            <div class="price-input">
              <input id="f-cost" type="number" min="0" step="0.5" data-field="cost" value="${esc(draft.cost)}" placeholder="0" />
              <span class="suffix">${esc(draft.currency)}</span>
            </div>
          </div>
          ${margin !== null
            ? `<p class="muted" style="font-size:12px;margin:0 0 12px">Marge brute : <strong style="color:${margin >= 0 ? 'var(--ok)' : 'var(--danger)'}">${esc(money(margin, draft.currency))}</strong>${draft.price ? ` · ${Math.round((margin / Number(draft.price)) * 100)} %` : ''}</p>`
            : ''}
          <div id="estimate">${estimateMarkup(draft)}</div>
        </section>

        <section class="card" id="score-card">${scoreCardInner(draft)}</section>

        <section class="card">
          <details class="advanced">
            <summary>Options avancées</summary>
            <div class="body">
              <div class="field">
                <label for="f-sku">Référence interne</label>
                <input id="f-sku" type="text" data-field="sku" value="${esc(draft.sku)}" placeholder="E-0001" />
              </div>
              <div class="field">
                <label for="f-catalog-id">Identifiant de catégorie</label>
                <input id="f-catalog-id" type="number" min="1" data-field="catalogId" value="${draft.catalogId ?? ''}" placeholder="ex. 1904" />
              </div>
              <div class="field">
                <label for="f-brand-id">Identifiant de marque</label>
                <input id="f-brand-id" type="number" min="1" data-field="brandId" value="${draft.brandId ?? ''}" placeholder="ex. 53" />
              </div>
              <div class="field">
                <label for="f-size-id">Identifiant de taille</label>
                <input id="f-size-id" type="number" min="1" data-field="sizeId" value="${draft.sizeId ?? ''}" placeholder="ex. 208" />
              </div>
              <div class="field">
                <label for="f-color-ids">Identifiants de couleurs</label>
                <input id="f-color-ids" type="text" data-field="colorIds" value="${esc(draft.colorIds.join(', '))}" placeholder="ex. 1, 7" />
              </div>
              <p class="muted" style="font-size:11px;margin:0">Ces champs servent de secours si la recherche Vinted ne répond pas.</p>
            </div>
          </details>
        </section>
      </div>
    </div>`;
}

const FIELD_TO_CRITERION = {
  title: 'title',
  description: 'description',
  photos: 'photos',
  catalogId: 'category',
  brand: 'brand',
  sizeId: 'size',
  price: 'price',
  conditionId: 'condition',
};

function scoreCardInner(draft) {
  const score = scoreDraft(draft);
  const validation = validateDraft(draft);
  const blocking = validation.errors.map((error) => `<li class="err"><span class="mark">✕</span><span>${esc(error.message)}</span></li>`);
  // Un champ bloquant est déjà affiché : inutile de répéter son critère.
  const blocked = new Set(validation.errors.map((error) => FIELD_TO_CRITERION[error.field]).filter(Boolean));
  const criteria = score.criteria.filter((item) => !blocked.has(item.id)).map((item) => {
    const cls = item.ok ? 'ok' : item.partial ? 'warn' : 'err';
    const mark = item.ok ? '✓' : item.partial ? '~' : '·';
    return `<li class="${cls}"><span class="mark">${mark}</span><span>${esc(item.label)}${item.ok ? '' : `<span class="hint">${esc(item.hint)}</span>`}</span></li>`;
  });
  const verdict = score.score >= 85 ? 'Prête à vendre' : score.score >= 70 ? 'Bonne base' : score.score >= 50 ? 'À compléter' : 'Trop incomplète';

  return `
    <div class="score-block">
      <div class="score-dial grade-${score.grade}">${score.score}</div>
      <div class="score-caption"><strong>${verdict}</strong>${score.score} points sur 100 · note ${score.grade}</div>
    </div>
    <ul class="checks">${blocking.join('')}${criteria.join('')}</ul>`;
}

function refreshScore() {
  const draft = activeDraft();
  const card = document.getElementById('score-card');
  if (draft && card) card.innerHTML = scoreCardInner(draft);
}

function estimateMarkup(draft) {
  const estimate = state.estimate;
  if (!estimate || estimate.draftId !== draft.id) {
    return '<button class="btn small block" type="button" data-action="estimate">Estimer le prix du marché</button>';
  }
  if (estimate.error) return `<div class="estimate">${esc(estimate.error)}</div>`;
  const { range, query } = estimate;
  return `
    <div class="estimate">
      <span class="muted">Annonces similaires (${range.count})</span>
      <div class="row">
        <span>Fourchette <strong>${esc(money(range.low, draft.currency))} – ${esc(money(range.high, draft.currency))}</strong></span>
        <button class="link" type="button" data-action="use-estimate" data-price="${range.median}">Médiane ${esc(money(range.median, draft.currency))}</button>
      </div>
      <p class="muted" style="margin:6px 0 0">Recherche : « ${esc(query)} ». Les prix incluent les frais Vinted, visez le bas de la fourchette.</p>
    </div>`;
}

function bannerFor(draft) {
  if (draft.status === 'error' && draft.error) {
    return `<div class="banner error"><div><strong>La dernière publication a échoué.</strong><br />${esc(draft.error)}</div></div>`;
  }
  if (draft.status === 'published' && draft.remoteId) {
    return `<div class="banner ok"><div><strong>Annonce en ligne.</strong> <a href="${esc(draft.remoteUrl)}" target="_blank" rel="noreferrer">Ouvrir sur Vinted</a></div></div>`;
  }
  if (draft.status === 'draft_on_vinted' && draft.remoteId) {
    return `<div class="banner warn"><div><strong>Brouillon enregistré sur Vinted.</strong> La publication automatique n'a pas abouti : <a href="${esc(draft.remoteUrl)}/edit" target="_blank" rel="noreferrer">terminer sur Vinted</a>.</div></div>`;
  }
  return '';
}

function pickerResults(results, kind, query) {
  if (!results.length) {
    if (!query) return '<div class="muted">Tapez pour rechercher.</div>';
    return '<div class="muted">Aucun résultat. Vérifiez la connexion à Vinted.</div>';
  }
  return results.map((item) => `
    <button type="button" data-pick="${kind}" data-id="${item.id}" data-label="${esc(item.title)}" data-path="${esc(item.path || item.title)}">
      ${esc(item.title)}<small>#${item.id}${item.path ? ` · ${esc(item.path)}` : ''}</small>
    </button>`).join('');
}

/* -------------------------------------------------------------- dashboard */

async function dashboardMarkup() {
  const stats = dashboardStats(state.drafts);
  const limit = Number(state.settings.dailyLimit) || 0;
  const used = state.counter && state.counter.date === todayKey() ? Number(state.counter.count) || 0 : 0;
  const remaining = remainingToday(state.counter, state.settings.dailyLimit);
  const max = Math.max(1, ...Object.values(stats.byStatus));
  const recent = await Promise.all(
    [...state.drafts]
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      .slice(0, 6)
      .map(async (draft) => ({ draft, thumb: draft.photos.length ? await getCachedPhoto(draft.photos[0].id) : '' }))
  );

  return `
    <div class="page-head">
      <div>
        <p class="eyebrow">Tableau de bord</p>
        <h1>Votre boutique</h1>
      </div>
      <div class="page-tools">
        <button class="btn" type="button" data-view="listings">Voir les annonces</button>
      </div>
    </div>

    <div class="metrics">
      <div class="metric"><span>En ligne</span><strong>${stats.online}</strong><small>${stats.byStatus.draft + stats.byStatus.draft_on_vinted} brouillon(s) en attente</small></div>
      <div class="metric accent"><span>Valeur en vitrine</span><strong>${esc(money(stats.onlineValue))}</strong><small>prix affichés, hors frais</small></div>
      <div class="metric"><span>Marge prévue</span><strong>${esc(money(stats.marginTotal))}</strong><small>${stats.marginCount} annonce(s) avec prix d'achat</small></div>
      <div class="metric"><span>Score moyen</span><strong>${stats.averageScore}</strong><small>${stats.photoCount} photo(s) préparée(s)</small></div>
    </div>

    <div class="dashboard-grid">
      <section class="card">
        <h2>Répartition</h2>
        <div class="status-bars">
          ${Object.entries(STATUS_LABELS).map(([status, label]) => `
            <div class="status-bar ${status}">
              <span>${esc(label)}</span>
              <div class="track"><span style="width:${Math.round(((stats.byStatus[status] || 0) / max) * 100)}%"></span></div>
              <b>${stats.byStatus[status] || 0}</b>
            </div>`).join('')}
        </div>
      </section>

      <section class="card">
        <h2>Quota du jour</h2>
        <p style="font-family:var(--serif);font-size:30px;margin:6px 0 0">${limit > 0 ? `${used} <span class="muted" style="font-size:16px">/ ${limit}</span>` : used}</p>
        <p class="muted" style="font-size:12px;margin:2px 0 12px">${limit > 0 ? `${remaining === 0 ? 'Plafond atteint pour aujourd’hui.' : `${remaining} publication(s) encore possible(s).`}` : 'Aucun plafond quotidien.'}</p>
        <div class="quota-bar" style="height:8px"><span style="width:${limit > 0 ? Math.min(100, (used / limit) * 100) : 0}%"></span></div>
        <p class="muted" style="font-size:11.5px;margin:12px 0 0">Pause entre deux annonces : ${state.settings.minDelay}–${state.settings.maxDelay} s.</p>
      </section>

      <section class="card wide">
        <h2>Activité récente</h2>
        <ul class="recent">
          ${recent.map(({ draft, thumb }) => `
            <li data-id="${esc(draft.id)}">
              <span class="mini"${thumb ? ` style="background-image:url('${thumb}')"` : ''}></span>
              <span><span class="t">${esc(draft.title || 'Annonce sans titre')}</span><span class="s">${esc(statusLabel(draft.status))} · ${esc(draft.sku || 'sans référence')}</span></span>
              <span class="p">${esc(priceText(draft))}</span>
            </li>`).join('')}
        </ul>
      </section>
    </div>`;
}

/* -------------------------------------------------------------- templates */

function templatesMarkup() {
  return `
    <div class="page-head">
      <div>
        <p class="eyebrow">Bibliothèque</p>
        <h1>Modèles de description</h1>
      </div>
      <div class="page-tools">
        <button class="btn primary" type="button" data-action="new-template">Nouveau modèle</button>
      </div>
    </div>
    <p class="muted" style="margin:-8px 0 18px;font-size:12.5px;max-width:620px">
      Les variables entre accolades sont remplacées par les informations de l'annonce. Un modèle s'insère en un clic depuis l'éditeur.
    </p>
    <div class="template-grid">
      ${state.templates.map((template) => `
        <article class="card template-card">
          <div class="card-head">
            <input class="template-name" data-template-name="${esc(template.id)}" value="${esc(template.name)}" aria-label="Nom du modèle" />
            <button class="icon-btn" type="button" data-action="delete-template" data-id="${esc(template.id)}" title="Supprimer">×</button>
          </div>
          <textarea class="template-body" data-template-body="${esc(template.id)}" spellcheck="false">${esc(template.body)}</textarea>
          <div class="variables">${TEMPLATE_VARIABLES.map((variable) => `<code>{{${variable.key}}}</code>`).join('')}</div>
          <div class="template-foot">
            <span class="muted" style="font-size:11px">${state.activeId ? 'Sera inséré dans l’annonce ouverte' : 'Ouvrez une annonce pour l’utiliser'}</span>
            <button class="btn small" type="button" data-action="use-template" data-id="${esc(template.id)}" ${state.activeId ? '' : 'disabled'}>Insérer</button>
          </div>
        </article>`).join('')}
    </div>`;
}

/* ------------------------------------------------------------------ queue */

function renderQueue() {
  refs.queue.hidden = !queue.running && !queue.log.length;
  refs.queueBar.style.width = `${Math.round(queue.progress * 100)}%`;
  refs.queueLog.innerHTML = queue.log.slice(-6).map((entry) => `<li><i class="${esc(entry.kind)}"></i><span>${esc(entry.text)}</span></li>`).join('');
}

function setQueueStatus(text) {
  refs.queueStatus.textContent = text;
}

function logQueue(text, kind = '') {
  queue.log.push({ text, kind });
  renderQueue();
}

/* ------------------------------------------------------------------- data */

async function createNewDraft() {
  const draft = newDraft({ currency: currencyForDomain(state.settings.domain), sku: nextSku(state.drafts) });
  state.drafts.unshift(draft);
  state.activeId = draft.id;
  state.estimate = null;
  state.view = 'editor';
  persist();
  await render();
  document.getElementById('f-title')?.focus();
}

async function duplicateDraft(draft) {
  const copy = normalizeDraft({
    ...draft,
    id: newDraft().id,
    sku: nextSku(state.drafts),
    status: 'draft',
    remoteId: null,
    remoteUrl: '',
    error: '',
    publishedAt: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    photos: [],
  });
  for (const photo of draft.photos) {
    const dataUrl = await getCachedPhoto(photo.id);
    if (!dataUrl) continue;
    const newId = newDraft().id;
    await putPhoto(newId, dataUrl);
    copy.photos.push({ id: newId, name: photo.name });
  }
  state.drafts.unshift(copy);
  state.activeId = copy.id;
  state.view = 'editor';
  persist();
  await render();
  toast('Annonce dupliquée.', 'ok');
}

async function removeDraft(draft) {
  if (!confirm(`Supprimer « ${draft.title || 'cette annonce'} » ?`)) return;
  for (const photo of draft.photos) {
    const shared = state.drafts.some((other) => other.id !== draft.id && other.photos.some((p) => p.id === photo.id));
    if (!shared) {
      await deletePhoto(photo.id).catch(() => {});
      state.photoCache.delete(photo.id);
    }
  }
  state.drafts = state.drafts.filter((d) => d.id !== draft.id);
  state.activeId = state.drafts[0]?.id || null;
  state.view = 'listings';
  persist();
  await render();
}

async function addPhotos(files) {
  const draft = activeDraft();
  if (!draft) return;
  const list = Array.from(files).filter((file) => file.type.startsWith('image/'));
  if (!list.length) return;
  let added = 0;
  for (const file of list) {
    if (draft.photos.length >= 20) {
      toast('Vinted accepte 20 photos maximum par annonce.', 'error');
      break;
    }
    try {
      const compressed = await compressImage(file);
      const photoId = newDraft().id;
      await putPhoto(photoId, compressed.dataUrl);
      state.photoCache.set(photoId, compressed.dataUrl);
      draft.photos.push({ id: photoId, name: compressed.name });
      added += 1;
    } catch (error) {
      toast(`${file.name} : ${error.message}`, 'error');
    }
  }
  if (added) {
    draft.updatedAt = Date.now();
    persist();
    await render();
  }
}

async function movePhoto(photoId, direction) {
  const draft = activeDraft();
  if (!draft) return;
  const index = draft.photos.findIndex((photo) => photo.id === photoId);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= draft.photos.length) return;
  const [photo] = draft.photos.splice(index, 1);
  draft.photos.splice(target, 0, photo);
  persist();
  await render();
}

async function removePhoto(photoId) {
  const draft = activeDraft();
  if (!draft) return;
  draft.photos = draft.photos.filter((photo) => photo.id !== photoId);
  await deletePhoto(photoId).catch(() => {});
  state.photoCache.delete(photoId);
  persist();
  await render();
}

function updateDraftField(field, value) {
  const draft = activeDraft();
  if (!draft) return;
  switch (field) {
    case 'title': draft.title = value.slice(0, TITLE_MAX); break;
    case 'description': draft.description = value.slice(0, DESCRIPTION_MAX); break;
    case 'price': draft.price = normalizePrice(value); break;
    case 'cost': draft.cost = normalizePrice(value); break;
    case 'sku': draft.sku = value.slice(0, 24); break;
    case 'catalogId': draft.catalogId = value ? Number(value) : null; draft.catalogLabel = ''; break;
    case 'brandId': draft.brandId = value ? Number(value) : null; break;
    case 'sizeId': draft.sizeId = value ? Number(value) : null; break;
    case 'conditionId': draft.conditionId = Number(value); break;
    case 'packageSizeId': draft.packageSizeId = Number(value); break;
    case 'colorIds':
      draft.colorIds = String(value).split(/[,\s]+/).map(Number).filter((v) => Number.isFinite(v) && v > 0);
      break;
    default: break;
  }
  draft.updatedAt = Date.now();
  persist();
}

function updateCounters() {
  const draft = activeDraft();
  if (!draft) return;
  const title = document.querySelector('[data-counter="title"]');
  const description = document.querySelector('[data-counter="description"]');
  if (title) title.textContent = draft.title.length;
  if (description) description.textContent = draft.description.length;
  const heading = document.getElementById('editor-title-text');
  if (heading) heading.textContent = draft.title || 'Nouvelle annonce';
}

/* -------------------------------------------------------------- Vinted API */

function connectApi(tab) {
  return createVintedApi({
    transport: createTabTransport(tab.id),
    domain: state.settings.domain,
    locale: localeForDomain(state.settings.domain),
    currency: currencyForDomain(state.settings.domain),
  });
}

async function ensureApi() {
  if (state.settings.demoMode) {
    return createVintedApi({
      transport: createDemoTransport(),
      domain: state.settings.domain,
      locale: localeForDomain(state.settings.domain),
      currency: currencyForDomain(state.settings.domain),
    });
  }
  if (state.api) return state.api;
  const tab = await ensureVintedTab(state.settings.domain);
  if (!(await ensureBridge(tab.id))) throw new Error("L'extension n'a pas pu s'activer sur la page Vinted.");
  state.api = connectApi(tab);
  return state.api;
}

async function checkConnection() {
  state.connection = { status: 'idle' };
  renderConnection();
  if (state.settings.demoMode) {
    state.connection = { status: 'demo' };
    renderConnection();
    await loadMeta();
    return;
  }
  try {
    const tab = await findVintedTab(state.settings.domain);
    if (!tab) {
      state.connection = { status: 'bad', label: 'Vinted non ouvert' };
      renderConnection();
      return;
    }
    if (!(await ensureBridge(tab.id))) throw new Error('Pont indisponible');
    state.api = connectApi(tab);
    const user = await state.api.currentUser();
    state.connection = { status: 'ok', user: user?.login || user?.username || '' };
    renderConnection();
    await loadMeta();
  } catch (error) {
    state.api = null;
    state.connection = { status: 'bad', label: 'Non connecté' };
    renderConnection();
    console.warn('[Étal] connexion :', error);
  }
}

async function loadMeta() {
  const api = await ensureApi().catch(() => null);
  if (!api) return;
  try {
    state.meta.colors = await api.getColors();
  } catch {
    state.meta.colors = [];
  }
  if (state.view === 'editor') await render();
}

async function loadSizes(catalogId) {
  const api = await ensureApi().catch(() => null);
  if (!api || !catalogId) return;
  try {
    state.meta.sizes = (await api.getCatalogConfig(catalogId)).sizes;
  } catch {
    state.meta.sizes = [];
  }
}

async function estimatePrice(draft) {
  const api = await ensureApi().catch(() => null);
  if (!api) {
    state.estimate = { draftId: draft.id, error: 'Connectez-vous à Vinted pour estimer les prix.' };
    await render();
    return;
  }
  const query = [draft.brand, draft.catalogLabel?.split('>').pop()?.trim(), draft.sizeLabel].filter(Boolean).join(' ') || draft.title;
  if (!query.trim()) {
    state.estimate = { draftId: draft.id, error: 'Renseignez au moins la marque ou le titre pour estimer.' };
    await render();
    return;
  }
  try {
    const items = await api.searchItems({ searchText: query, perPage: 30 });
    const range = suggestedRange(items.map((item) => item.price));
    state.estimate = range
      ? { draftId: draft.id, range, query }
      : { draftId: draft.id, error: `Pas assez d'annonces comparables pour « ${query} ».` };
  } catch (error) {
    state.estimate = { draftId: draft.id, error: `Estimation impossible : ${error.message}` };
  }
  await render();
}

/* --------------------------------------------------------------- recherche */

let catalogTimer = null;
function scheduleCatalogSearch(query) {
  state.catalogQuery = query;
  clearTimeout(catalogTimer);
  if (!query.trim()) {
    state.meta.catalogResults = [];
    const box = document.getElementById('catalog-results');
    if (box) box.innerHTML = pickerResults([], 'catalog', '');
    return;
  }
  catalogTimer = setTimeout(async () => {
    const api = await ensureApi().catch(() => null);
    if (!api) return;
    try {
      state.meta.catalogResults = await api.searchCatalogs(query);
    } catch {
      state.meta.catalogResults = [];
    }
    const box = document.getElementById('catalog-results');
    if (box) box.innerHTML = pickerResults(state.meta.catalogResults, 'catalog', state.catalogQuery);
  }, 350);
}

let brandTimer = null;
function scheduleBrandSearch(query) {
  state.brandQuery = query;
  clearTimeout(brandTimer);
  brandTimer = setTimeout(async () => {
    if (!query.trim()) {
      state.meta.brandResults = [];
      return;
    }
    const api = await ensureApi().catch(() => null);
    if (!api) return;
    try {
      state.meta.brandResults = await api.searchBrands(query);
    } catch {
      state.meta.brandResults = [];
    }
    const field = document.getElementById('f-brand')?.closest('.field');
    if (!field) return;
    const html = pickerResults(state.meta.brandResults, 'brand', state.brandQuery);
    const existing = document.getElementById('brand-results');
    if (existing) existing.innerHTML = html;
    else if (state.meta.brandResults.length) {
      const box = document.createElement('div');
      box.className = 'picker-results';
      box.id = 'brand-results';
      box.innerHTML = html;
      field.appendChild(box);
    }
  }, 350);
}

/* ---------------------------------------------------------------- publier */

async function publishOne(draft, mode) {
  const api = await ensureApi();
  const sessionId = crypto.randomUUID();
  const photos = await loadPhotoPayload(draft.photos.map((photo) => photo.id));
  if (!photos.length) throw new Error('Photos introuvables : ajoutez-les à nouveau.');

  const photoIds = [];
  for (let i = 0; i < photos.length; i += 1) {
    setQueueStatus(`Envoi de la photo ${i + 1}/${photos.length}…`);
    const uploaded = await api.uploadPhoto({
      base64: photos[i].base64,
      mime: photos[i].mime,
      filename: `annonce-${i + 1}.jpg`,
      sessionId,
    });
    photoIds.push(uploaded.id);
  }

  const payloadDraft = { ...draft, photoIds };

  if (mode === 'live') {
    try {
      const result = await api.createLiveItem(payloadDraft, sessionId);
      if (result.id) return { mode: 'live', id: result.id };
    } catch (error) {
      if ([401, 403, 429].includes(error.status)) throw error;
      logQueue('Publication directe refusée, repli sur un brouillon.', 'publishing');
    }
    const draftResult = await api.createDraft(payloadDraft, sessionId);
    if (!draftResult.id) throw new Error("Vinted n'a pas renvoyé d'identifiant d'annonce.");
    try {
      await api.publishDraft(draftResult.id);
      return { mode: 'live', id: draftResult.id };
    } catch {
      return { mode: 'draft', id: draftResult.id };
    }
  }

  const result = await api.createDraft(payloadDraft, sessionId);
  if (!result.id) throw new Error("Vinted n'a pas renvoyé d'identifiant d'annonce.");
  return { mode: 'draft', id: result.id };
}

async function runQueue(ids, { forceMode } = {}) {
  if (queue.running) {
    toast('Une publication est déjà en cours.', 'error');
    return;
  }
  const drafts = ids.map((id) => state.drafts.find((d) => d.id === id)).filter(Boolean);
  if (!drafts.length) return;

  for (const draft of drafts) {
    const validation = validateDraft(draft);
    if (!validation.ok) {
      toast(`« ${draft.title || 'Annonce'} » : ${validation.errors[0].message}`, 'error');
      return;
    }
  }

  const mode = forceMode || state.settings.mode;
  queue.running = true;
  queue.stop = false;
  queue.progress = 0;
  queue.log = [];
  refs.queue.hidden = false;
  refs.queueTitle.textContent = mode === 'live' ? 'Publication sur Vinted' : 'Création des brouillons';
  renderQueue();

  let publishedToday = 0;

  try {
    for (let i = 0; i < drafts.length; i += 1) {
      if (queue.stop) break;
      const draft = drafts[i];

      if (mode === 'live' && remainingToday(state.counter, state.settings.dailyLimit) <= 0) {
        logQueue(`Plafond quotidien atteint (${state.settings.dailyLimit}).`, 'error');
        toast('Plafond quotidien atteint : publication interrompue.', 'error');
        break;
      }

      draft.status = 'publishing';
      draft.error = '';
      await render();
      setQueueStatus(`Publication de « ${draft.title} » (${i + 1}/${drafts.length})…`);
      logQueue(`Envoi : ${draft.title}`, 'publishing');

      try {
        const result = await publishOne(draft, mode);
        draft.status = result.mode === 'live' ? 'published' : 'draft_on_vinted';
        draft.remoteId = result.id;
        draft.remoteMode = result.mode;
        draft.remoteUrl = itemUrl(state.settings.domain, result.id);
        draft.publishedAt = Date.now();
        draft.error = '';
        if (result.mode === 'live') {
          state.counter = bumpCounter(state.counter);
          publishedToday += 1;
        }
        logQueue(result.mode === 'live' ? `En ligne : ${draft.title} (#${result.id})` : `Brouillon : ${draft.title} (#${result.id})`, result.mode === 'live' ? 'published' : 'draft_on_vinted');
      } catch (error) {
        draft.status = 'error';
        draft.error = error.message;
        state.api = null;
        logQueue(`Échec : ${draft.title} — ${error.message}`, 'error');
        if ([401, 403].includes(error.status)) {
          toast('Vinted a refusé la publication : reconnectez-vous puis réessayez.', 'error');
          break;
        }
      }

      queue.progress = (i + 1) / drafts.length;
      persist();
      await render();

      if (i < drafts.length - 1 && !queue.stop) {
        const delay = randomDelayMs(state.settings.minDelay, state.settings.maxDelay);
        queue.nextAt = Date.now() + delay;
        while (Date.now() < queue.nextAt && !queue.stop) {
          setQueueStatus(`Prochaine annonce dans ${formatDuration(queue.nextAt - Date.now())}.`);
          await sleep(500);
        }
      }
    }
  } finally {
    queue.running = false;
    queue.nextAt = 0;
    setQueueStatus(queue.stop ? 'Publication arrêtée.' : publishedToday ? `Terminé : ${publishedToday} annonce(s) publiée(s).` : 'Terminé.');
    persist();
    await render();
    setTimeout(() => {
      if (!queue.running) refs.queue.hidden = true;
    }, 6000);
  }
}

/* -------------------------------------------------------------------- CSV */

async function importCsv(file) {
  let records;
  try {
    records = rowsToDrafts(parseCsv(await file.text()), { currency: currencyForDomain(state.settings.domain) });
  } catch (error) {
    toast(`Lecture du CSV impossible : ${error.message}`, 'error');
    return;
  }
  if (!records.length) {
    toast('Aucune annonce trouvée dans ce fichier (vérifiez la ligne d’en-têtes).', 'error');
    return;
  }

  const withUrls = records.filter((record) => record.photoUrls?.length);
  if (withUrls.length) {
    const granted = await chrome.permissions.request({ origins: ['<all_urls>'] }).catch(() => false);
    if (!granted) {
      toast('Photos par lien ignorées : autorisation refusée.', 'error');
    } else {
      for (const record of withUrls) {
        record.photos = [];
        for (const url of record.photoUrls.slice(0, 20)) {
          try {
            const response = await fetch(url);
            if (!response.ok) continue;
            const blob = await response.blob();
            const compressed = await compressImage(new File([blob], 'photo.jpg', { type: blob.type || 'image/jpeg' }));
            const photoId = newDraft().id;
            await putPhoto(photoId, compressed.dataUrl);
            state.photoCache.set(photoId, compressed.dataUrl);
            record.photos.push({ id: photoId, name: 'photo.jpg' });
          } catch {
            // lien mort ou format non supporté
          }
        }
      }
    }
  }

  let counter = 0;
  for (const record of records) {
    delete record.photoUrls;
    record.sku = nextSku([...state.drafts, ...records.slice(0, counter)]);
    counter += 1;
  }
  state.drafts = [...records, ...state.drafts];
  state.activeId = records[0].id;
  state.view = 'listings';
  persist();
  await render();
  toast(`${records.length} annonce(s) importée(s).`, 'ok');
}

function exportCsv() {
  const csv = draftsToCsv(state.drafts);
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'annonces-vinted.csv';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/* ---------------------------------------------------------------- réglages */

function openDrawer() {
  refs.drawer.hidden = false;
  refs.backdrop.hidden = false;
  renderDrawer();
}

function closeDrawer() {
  refs.drawer.hidden = true;
  refs.backdrop.hidden = true;
}

function renderDrawer() {
  const s = state.settings;
  refs.drawerBody.innerHTML = `
    <div class="settings-group">
      <h4>Connexion Vinted</h4>
      <div class="field">
        <label for="s-domain">Site Vinted</label>
        <select id="s-domain" data-setting="domain">
          ${VINTED_DOMAINS.map((domain) => `<option value="${domain}" ${s.domain === domain ? 'selected' : ''}>${domain}</option>`).join('')}
        </select>
      </div>
      <button class="btn small" type="button" data-action="open-vinted">Ouvrir Vinted et se connecter</button>
      <button class="btn small" type="button" data-action="export-csv" style="margin-left:8px">Exporter en CSV</button>
      <p class="settings-note">La publication utilise votre session Vinted ouverte dans ce navigateur. Aucun mot de passe n'est stocké.</p>
    </div>

    <div class="settings-group">
      <h4>Publication</h4>
      <div class="field">
        <label for="s-mode">Comportement</label>
        <select id="s-mode" data-setting="mode">
          <option value="live" ${s.mode === 'live' ? 'selected' : ''}>Publier directement (en ligne)</option>
          <option value="draft" ${s.mode === 'draft' ? 'selected' : ''}>Créer un brouillon Vinted (à valider à la main)</option>
        </select>
      </div>
      <div class="field">
        <label>Pause entre deux annonces <span class="hint">en secondes</span></label>
        <div class="row">
          <input type="number" min="10" max="3600" step="5" data-setting="minDelay" value="${s.minDelay}" aria-label="Délai minimum" />
          <input type="number" min="10" max="3600" step="5" data-setting="maxDelay" value="${s.maxDelay}" aria-label="Délai maximum" />
        </div>
      </div>
      <div class="field">
        <label for="s-limit">Plafond quotidien <span class="hint">0 = aucun</span></label>
        <input id="s-limit" type="number" min="0" max="100" data-setting="dailyLimit" value="${s.dailyLimit}" />
      </div>
    </div>

    <div class="settings-group">
      <h4>Test</h4>
      <label class="toggle">
        <input type="checkbox" data-setting="demoMode" ${s.demoMode ? 'checked' : ''} />
        <span><b>Mode démo</b>Simule Vinted : aucune requête réelle, aucune annonce publiée.</span>
      </label>
    </div>

    <div class="settings-group">
      <h4>Zone sensible</h4>
      <button class="btn small danger" type="button" data-action="delete-all">Supprimer toutes les annonces locales</button>
      <p class="settings-note">Vinted interdit les outils externes dans ses conditions d'utilisation. Un usage intensif peut entraîner une suspension temporaire du compte. Gardez un rythme lent et publiez uniquement vos propres articles.</p>
    </div>`;
}

function updateSetting(key, value) {
  if (['minDelay', 'maxDelay', 'dailyLimit'].includes(key)) state.settings[key] = Number(value) || 0;
  else if (key === 'demoMode') {
    state.settings[key] = Boolean(value);
    state.api = null;
  } else state.settings[key] = value;

  if (key === 'domain') {
    state.api = null;
    for (const draft of state.drafts) if (draft.status === 'draft') draft.currency = currencyForDomain(value);
  }
  persist();
  if (key === 'demoMode' || key === 'domain') {
    checkConnection();
    render();
  } else {
    renderQuota();
  }
}

/* ------------------------------------------------------------------ events */

async function applyTemplate(templateId) {
  const draft = activeDraft();
  const template = state.templates.find((item) => item.id === templateId);
  if (!draft || !template) return;
  const text = renderTemplate(template.body, draft);
  draft.description = draft.description.trim() ? `${draft.description.trim()}\n\n${text}` : text;
  persist();
  await render();
  toast(`Modèle « ${template.name} » inséré.`, 'ok');
}

async function handleAction(action, element) {
  const draft = activeDraft();

  if (action === 'new') return createNewDraft();
  if (action === 'new-template') {
    state.templates.unshift(newTemplate());
    persist();
    return render();
  }
  if (action === 'delete-template') {
    const id = element.dataset.id;
    state.templates = state.templates.filter((template) => template.id !== id);
    persist();
    return render();
  }
  if (action === 'use-template') return applyTemplate(element.dataset.id);
  if (action === 'export-csv') {
    exportCsv();
    return;
  }
  if (action === 'open-vinted') {
    await chrome.tabs.create({ url: `https://www.${state.settings.domain}/` });
    setTimeout(checkConnection, 2500);
    return;
  }
  if (action === 'delete-all') {
    if (!confirm('Supprimer toutes les annonces locales ? Cette action est irréversible.')) return;
    for (const item of state.drafts) for (const photo of item.photos) await deletePhoto(photo.id).catch(() => {});
    state.drafts = [];
    state.activeId = null;
    state.photoCache.clear();
    persist();
    closeDrawer();
    return createNewDraft();
  }

  if (!draft) return;

  if (action === 'duplicate') return duplicateDraft(draft);
  if (action === 'delete') return removeDraft(draft);
  if (action === 'clear-catalog') {
    draft.catalogId = null;
    draft.catalogLabel = '';
    draft.sizeId = null;
    state.meta.sizes = [];
    persist();
    return render();
  }
  if (action === 'estimate') return estimatePrice(draft);
  if (action === 'use-estimate') {
    draft.price = normalizePrice(element.dataset.price);
    persist();
    await render();
    toast('Prix du marché appliqué.', 'ok');
    return;
  }
  if (action === 'create-draft' || action === 'publish') {
    const validation = validateDraft(draft);
    if (!validation.ok) {
      toast(validation.errors[0].message, 'error');
      return;
    }
    return runQueue([draft.id], action === 'create-draft' ? { forceMode: 'draft' } : undefined);
  }
}

function bindEvents() {
  document.addEventListener('click', async (event) => {
    const viewButton = event.target.closest('[data-view]');
    if (viewButton) {
      state.view = viewButton.dataset.view;
      await render();
      return;
    }

    const filterButton = event.target.closest('[data-filter]');
    if (filterButton) {
      state.filter = filterButton.dataset.filter;
      await render();
      return;
    }

    const card = event.target.closest('.listing-card[data-id]');
    if (card) {
      state.activeId = card.dataset.id;
      state.estimate = null;
      state.view = 'editor';
      persist();
      await render();
      return;
    }

    const recentRow = event.target.closest('.recent li[data-id]');
    if (recentRow) {
      state.activeId = recentRow.dataset.id;
      state.view = 'editor';
      await render();
      return;
    }

    const actionButton = event.target.closest('[data-action]');
    if (actionButton) {
      await handleAction(actionButton.dataset.action, actionButton);
      return;
    }

    if (event.target.closest('#photo-add')) {
      refs.photoInput.click();
      return;
    }

    const moveButton = event.target.closest('[data-photo-move]');
    if (moveButton) {
      await movePhoto(moveButton.dataset.photoMove, Number(moveButton.dataset.dir));
      return;
    }

    const removeButton = event.target.closest('[data-photo-remove]');
    if (removeButton) {
      await removePhoto(removeButton.dataset.photoRemove);
      return;
    }

    const colorButton = event.target.closest('[data-color]');
    const draft = activeDraft();
    if (colorButton && draft) {
      const id = Number(colorButton.dataset.color);
      const label = colorButton.dataset.colorLabel;
      if (draft.colorIds.includes(id)) {
        draft.colorIds = draft.colorIds.filter((value) => value !== id);
        draft.colorLabels = draft.colorLabels.filter((value) => value !== label);
      } else {
        draft.colorIds = [...draft.colorIds, id];
        draft.colorLabels = [...draft.colorLabels, label];
      }
      persist();
      colorButton.classList.toggle('on');
      refreshScore();
      return;
    }

    const pick = event.target.closest('[data-pick]');
    if (pick && draft) {
      if (pick.dataset.pick === 'catalog') {
        draft.catalogId = Number(pick.dataset.id);
        draft.catalogLabel = pick.dataset.path || pick.dataset.label;
        state.catalogQuery = '';
        state.meta.catalogResults = [];
        await loadSizes(draft.catalogId);
      } else {
        draft.brand = pick.dataset.label;
        draft.brandId = Number(pick.dataset.id);
        state.brandQuery = '';
        state.meta.brandResults = [];
      }
      persist();
      await render();
    }
  });

  document.addEventListener('input', (event) => {
    const target = event.target;

    const templateName = target.dataset?.templateName;
    if (templateName) {
      const template = state.templates.find((item) => item.id === templateName);
      if (template) {
        template.name = target.value;
        persist();
      }
      return;
    }
    const templateBody = target.dataset?.templateBody;
    if (templateBody) {
      const template = state.templates.find((item) => item.id === templateBody);
      if (template) {
        template.body = target.value;
        persist();
      }
      return;
    }

    if (target.id === 'search') {
      state.query = target.value;
      refreshListings();
      return;
    }

    const field = target.dataset?.field;
    if (!field) return;
    if (field === 'catalogSearch') {
      scheduleCatalogSearch(target.value);
      return;
    }
    if (field === 'brandSearch') {
      const draft = activeDraft();
      if (draft) {
        draft.brand = target.value;
        draft.brandId = null;
        persist();
      }
      scheduleBrandSearch(target.value);
      return;
    }
    updateDraftField(field, target.value);
    if (field === 'title' || field === 'description') updateCounters();
    if (['title', 'description', 'price', 'cost', 'sku', 'catalogId', 'brandId', 'sizeId', 'colorIds'].includes(field)) refreshScore();
  });

  document.addEventListener('change', async (event) => {
    const target = event.target;

    if (target.id === 'template-select') {
      if (target.value) await applyTemplate(target.value);
      return;
    }

    const setting = target.dataset?.setting;
    if (setting) {
      updateSetting(setting, target.type === 'checkbox' ? target.checked : target.value);
      return;
    }

    const field = target.dataset?.field;
    if (field && ['sizeId', 'conditionId', 'packageSizeId'].includes(field)) {
      updateDraftField(field, target.value);
      refreshScore();
    }
  });

  document.getElementById('btn-new').addEventListener('click', createNewDraft);
  document.getElementById('btn-settings').addEventListener('click', openDrawer);
  document.getElementById('btn-import').addEventListener('click', () => refs.csvInput.click());
  document.getElementById('queue-stop').addEventListener('click', () => {
    queue.stop = true;
    setQueueStatus('Arrêt demandé…');
  });
  document.getElementById('drawer-close').addEventListener('click', closeDrawer);
  refs.backdrop.addEventListener('click', closeDrawer);
  refs.connection.addEventListener('click', async () => {
    if (state.settings.demoMode) {
      toast('Mode démo actif : aucune connexion réelle à Vinted.', 'ok');
      return;
    }
    await chrome.tabs.create({ url: `https://www.${state.settings.domain}/` });
    setTimeout(checkConnection, 2500);
  });

  refs.photoInput.addEventListener('change', async () => {
    await addPhotos(refs.photoInput.files);
    refs.photoInput.value = '';
  });

  refs.csvInput.addEventListener('change', async () => {
    if (refs.csvInput.files[0]) await importCsv(refs.csvInput.files[0]);
    refs.csvInput.value = '';
  });

  document.addEventListener('dragover', (event) => {
    const drop = event.target.closest?.('#photo-drop');
    if (drop) {
      event.preventDefault();
      drop.classList.add('dragover');
    }
  });
  document.addEventListener('dragleave', (event) => {
    const drop = event.target.closest?.('#photo-drop');
    if (drop) drop.classList.remove('dragover');
  });
  document.addEventListener('drop', async (event) => {
    const drop = event.target.closest?.('#photo-drop');
    if (!drop) return;
    event.preventDefault();
    drop.classList.remove('dragover');
    if (event.dataTransfer?.files?.length) await addPhotos(event.dataTransfer.files);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeDrawer();
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'n') {
      event.preventDefault();
      createNewDraft();
    }
  });
}

/* -------------------------------------------------------------------- init */

async function init() {
  await loadState();
  bindEvents();
  const onlyDraft = state.drafts.length === 1 ? state.drafts[0] : null;
  state.view = onlyDraft && !onlyDraft.title && !onlyDraft.photos.length ? 'editor' : 'listings';
  await render();
  checkConnection();
}

init().catch((error) => {
  console.error('[Étal]', error);
  refs.main.innerHTML = `<div class="banner error">Impossible de charger le studio : ${esc(error.message)}</div>`;
});
