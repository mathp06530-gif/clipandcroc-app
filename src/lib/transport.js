// Transport navigateur : chaque requête est exécutée par le script de contenu
// dans un onglet Vinted, donc en même origine que le site (cookies inclus).

import { VINTED_DOMAINS } from './schema.js';

export async function findVintedTab(domain) {
  const tabs = await chrome.tabs.query({ url: VINTED_DOMAINS.map((d) => `*://*.${d}/*`) });
  if (!tabs.length) return null;
  const preferred = tabs.find((tab) => tab.url && tab.url.includes(`//www.${domain}/`));
  return preferred || tabs[0];
}

export async function ensureVintedTab(domain) {
  const existing = await findVintedTab(domain);
  if (existing) return existing;
  const tab = await chrome.tabs.create({ url: `https://www.${domain}/`, active: false });
  await waitForTabComplete(tab.id);
  return tab;
}

function waitForTabComplete(tabId, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("La page Vinted met trop de temps à charger."));
    }, timeoutMs);

    function finish() {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }

    function listener(updatedId, info) {
      if (updatedId === tabId && info.status === 'complete') finish();
    }

    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId).then((tab) => {
      if (tab?.status === 'complete') finish();
    }).catch(() => {});
  });
}

async function pingBridge(tabId) {
  try {
    const res = await chrome.tabs.sendMessage(tabId, { source: 'vinted-publisher', action: 'ping' });
    return Boolean(res?.ok);
  } catch {
    return false;
  }
}

export async function ensureBridge(tabId) {
  if (await pingBridge(tabId)) return true;
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['src/content/bridge.js'] });
  } catch (error) {
    throw new Error(`Impossible d'activer l'extension sur cet onglet Vinted (${error.message}). Rechargez la page Vinted puis réessayez.`);
  }
  for (let i = 0; i < 10; i += 1) {
    if (await pingBridge(tabId)) return true;
    await sleep(300);
  }
  return false;
}

export function createTabTransport(tabId) {
  return async function transport(request) {
    const response = await chrome.tabs.sendMessage(tabId, {
      source: 'vinted-publisher',
      action: 'request',
      request,
    });
    if (!response) throw new Error("Aucune réponse de l'onglet Vinted.");
    if (response.ok === false) {
      throw new Error(response.error || "L'onglet Vinted a renvoyé une erreur.");
    }
    return { status: response.status, headers: response.headers || {}, text: response.text || '' };
  };
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
