/** First-run page. */

import { getSettings } from '../common/settings.js';
import { resolveTheme } from '../common/themes.js';
import { prefersDark } from '../app/theming.js';

init();

async function init() {
  const settings = await getSettings();
  const theme = resolveTheme(settings, prefersDark());
  document.documentElement.setAttribute('data-mdl-theme', theme.id);
  document.documentElement.setAttribute('data-mdl-scheme', theme.scheme);
  document.documentElement.style.colorScheme = theme.scheme;

  document.getElementById('open-details').addEventListener('click', () => {
    chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` });
  });

  document.getElementById('open-settings').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  document.getElementById('open-sample').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('viewer.html?sample=1') });
  });

  await refreshFileState();
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshFileState();
  });
}

async function refreshFileState() {
  const node = document.getElementById('file-state');
  const allowed = await chrome.extension.isAllowedFileSchemeAccess().catch(() => false);
  node.textContent = allowed
    ? 'Enabled — local Markdown files will render.'
    : 'Not enabled yet.';
  node.classList.toggle('is-ok', allowed);
}
