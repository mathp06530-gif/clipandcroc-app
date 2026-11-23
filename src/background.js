// Service worker : ouvre le studio (pas de popup, l'interface est une page complète).

const STUDIO_PATH = 'src/studio/studio.html';

async function openStudio() {
  const url = chrome.runtime.getURL(STUDIO_PATH);
  const tabs = await chrome.tabs.query({ url });
  if (tabs.length) {
    const tab = tabs[0];
    await chrome.tabs.update(tab.id, { active: true });
    if (tab.windowId) await chrome.windows.update(tab.windowId, { focused: true });
    return tab;
  }
  return chrome.tabs.create({ url });
}

chrome.action.onClicked.addListener(() => {
  openStudio().catch((error) => console.error('[Vinted Publisher]', error));
});

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    openStudio().catch((error) => console.error('[Vinted Publisher]', error));
  }
});
