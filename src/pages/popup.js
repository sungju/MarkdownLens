/** Toolbar popup: quick theme switching and actions for the current tab. */

import { bindControls } from './controls.js';
import { getSettings } from '../common/settings.js';
import { THEMES, resolveTheme } from '../common/themes.js';
import { CODE_THEMES } from '../generated/hljs-themes.js';
import { prefersDark } from '../app/theming.js';

let activeTabId = null;

init();

async function init() {
  fillSelects();
  await bindControls(document, paintTheme);
  paintTheme(await getSettings());

  document.getElementById('settings').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
    window.close();
  });

  for (const [id, type] of [['toggle-raw', 'toggle-raw'], ['reload', 'reload-source'], ['print', 'print']]) {
    document.getElementById(id).addEventListener('click', async () => {
      if (activeTabId == null) return;
      await chrome.tabs.sendMessage(activeTabId, { type }).catch(() => {});
      window.close();
    });
  }

  await detectActiveDocument();
}

function option(value, label) {
  const node = document.createElement('option');
  node.value = value;
  node.textContent = label;
  return node;
}

function fillSelects() {
  const theme = document.getElementById('theme');
  theme.append(option('auto', 'Match system'));
  for (const group of ['light', 'dark']) {
    const optgroup = document.createElement('optgroup');
    optgroup.label = group === 'light' ? 'Light' : 'Dark';
    for (const item of THEMES.filter((t) => t.scheme === group)) {
      optgroup.append(option(item.id, item.name));
    }
    theme.append(optgroup);
  }

  const code = document.getElementById('code-theme');
  code.append(option('auto', 'Match the document theme'));
  code.append(option('pair', 'Use my light / dark pair'));
  for (const group of ['light', 'dark']) {
    const optgroup = document.createElement('optgroup');
    optgroup.label = group === 'light' ? 'Light themes' : 'Dark themes';
    for (const item of CODE_THEMES.filter((t) => t.scheme === group)) {
      optgroup.append(option(item.id, item.name));
    }
    code.append(optgroup);
  }
}

/** Paint the popup itself in the theme the user has selected. */
function paintTheme(settings) {
  const theme = resolveTheme(settings, prefersDark());
  document.documentElement.setAttribute('data-mdl-theme', theme.id);
  document.documentElement.setAttribute('data-mdl-scheme', theme.scheme);
  document.documentElement.style.colorScheme = theme.scheme;
}

/** Ask the active tab whether Markdown Lens is rendering it. */
async function detectActiveDocument() {
  const status = document.getElementById('status');
  const actions = [...document.querySelectorAll('.popup-actions .btn')];

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => []);
  if (!tab?.id) {
    status.textContent = '';
    actions.forEach((b) => { b.disabled = true; });
    return;
  }
  activeTabId = tab.id;

  const response = await chrome.tabs.sendMessage(tab.id, { type: 'ping' }).catch(() => null);
  const active = Boolean(response?.ok);
  status.textContent = active ? 'Rendering this tab' : 'Not a Markdown document';
  status.classList.toggle('is-active', active);
  actions.forEach((b) => { b.disabled = !active; });
}
