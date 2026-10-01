/** Settings page: control binding, theme pickers and the live preview. */

import { bindControls } from './controls.js';
import { getSettings, setSettings, resetSettings, DEFAULTS } from '../common/settings.js';
import { THEMES, FONTS, CODE_FONTS } from '../common/themes.js';
import { CODE_THEMES } from '../generated/hljs-themes.js';
import { applyAppearance, installBaseStyles, installMathStyles, onSchemeChange } from '../app/theming.js';
import { renderMarkdown } from '../app/render.js';
import { enhance } from '../app/enhance.js';
import { SAMPLES } from './samples.js';

const preview = document.getElementById('preview');
let sampleIndex = 0;
let renderToken = 0;

init();

async function init() {
  document.getElementById('version').textContent = `v${chrome.runtime.getManifest().version}`;
  document.getElementById('code-theme-count').textContent = String(CODE_THEMES.length);

  populateSelects();
  installBaseStyles(document.head);

  const readSettings = await bindControls(document, (settings) => {
    paint(settings);
    schedulePreview(settings);
  });

  wireButtons();
  await refreshPermissionState();

  const settings = readSettings();
  paint(settings);
  await renderPreview(settings);

  onSchemeChange(async () => {
    const current = await getSettings();
    paint(current);
    schedulePreview(current);
  });
}

/* --------------------------------------------------------------- selects */

function option(value, label) {
  const node = document.createElement('option');
  node.value = value;
  node.textContent = label;
  return node;
}

function fillThemeSelect(select, { includeAuto = false, scheme = null } = {}) {
  select.textContent = '';
  if (includeAuto) select.append(option('auto', 'Match system'));

  for (const group of ['light', 'dark']) {
    if (scheme && scheme !== group) continue;
    const optgroup = document.createElement('optgroup');
    optgroup.label = group === 'light' ? 'Light' : 'Dark';
    for (const theme of THEMES.filter((t) => t.scheme === group)) {
      optgroup.append(option(theme.id, theme.name));
    }
    select.append(optgroup);
  }
}

function fillCodeThemeSelect(select, { includeAuto = false, scheme = null } = {}) {
  select.textContent = '';
  if (includeAuto) {
    select.append(option('auto', 'Match the document theme'));
    select.append(option('pair', 'Use my light / dark pair'));
  }

  for (const group of ['light', 'dark']) {
    if (scheme && scheme !== group) continue;
    const optgroup = document.createElement('optgroup');
    optgroup.label = group === 'light' ? 'Light themes' : 'Dark themes';
    for (const theme of CODE_THEMES.filter((t) => t.scheme === group)) {
      optgroup.append(option(theme.id, theme.name));
    }
    select.append(optgroup);
  }
}

function populateSelects() {
  fillThemeSelect(document.getElementById('theme-mode'), { includeAuto: true });
  fillThemeSelect(document.getElementById('theme-light'), { scheme: 'light' });
  fillThemeSelect(document.getElementById('theme-dark'), { scheme: 'dark' });

  fillCodeThemeSelect(document.getElementById('code-theme'), { includeAuto: true });
  fillCodeThemeSelect(document.getElementById('code-theme-light'), { scheme: 'light' });
  fillCodeThemeSelect(document.getElementById('code-theme-dark'), { scheme: 'dark' });

  const font = document.getElementById('font');
  for (const item of FONTS) font.append(option(item.id, item.name));

  const codeFont = document.getElementById('code-font');
  for (const item of CODE_FONTS) codeFont.append(option(item.id, item.name));
}

/* --------------------------------------------------------------- preview */

function paint(settings) {
  applyAppearance(settings);
}

let previewTimer = null;
function schedulePreview(settings) {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => renderPreview(settings), 120);
}

async function renderPreview(settings) {
  const token = ++renderToken;
  const sample = SAMPLES[sampleIndex];

  let result;
  try {
    result = await renderMarkdown(sample.text, settings);
  } catch (error) {
    console.error('[Markdown Lens] preview failed:', error);
    return;
  }
  if (token !== renderToken) return;

  preview.innerHTML = result.html;
  enhance(preview, settings);

  if (preview.querySelector('.katex')) installMathStyles(document.head);

  if (settings.mermaid && preview.querySelector('code.mdl-mermaid')) {
    try {
      const mod = await import('../lazy/mermaid.js');
      const scheme = document.documentElement.getAttribute('data-mdl-scheme') || 'light';
      await mod.renderDiagrams(preview, { scheme });
    } catch { /* preview simply keeps the source block */ }
  }
}

/* --------------------------------------------------------------- actions */

function wireButtons() {
  document.getElementById('preview-sample').addEventListener('click', async () => {
    sampleIndex = (sampleIndex + 1) % SAMPLES.length;
    await renderPreview(await getSettings());
  });

  document.getElementById('reset').addEventListener('click', async () => {
    if (!confirm('Reset every Markdown Lens setting to its default?')) return;
    await resetSettings();
    const fresh = { ...DEFAULTS };
    paint(fresh);
    location.reload();
  });

  document.getElementById('open-file-access').addEventListener('click', () => {
    chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` });
  });

  document.getElementById('grant-scan').addEventListener('click', async () => {
    const granted = await chrome.permissions.request({
      origins: ['*://*/*'],
      permissions: ['declarativeNetRequestWithHostAccess'],
    }).catch(() => false);

    if (granted) await setSettings({ scanAllPages: true });
    await chrome.runtime.sendMessage({ type: 'sync-features' }).catch(() => {});
    await refreshPermissionState();
  });
}

async function refreshPermissionState() {
  const status = document.getElementById('scan-status');
  const button = document.getElementById('grant-scan');
  const toggle = document.querySelector('[data-setting="scanAllPages"]');

  const granted = await chrome.permissions.contains({ origins: ['*://*/*'] }).catch(() => false);
  button.disabled = granted;
  button.textContent = granted ? 'Access granted' : 'Grant access';
  toggle.disabled = !granted;

  const fileAccess = await chrome.extension.isAllowedFileSchemeAccess().catch(() => false);
  const fileRow = document.getElementById('file-access');
  fileRow.classList.toggle('is-ok', fileAccess);
  fileRow.querySelector('strong').textContent = fileAccess
    ? 'Local files — enabled'
    : 'Local files — not enabled';

  status.textContent = granted
    ? 'Wider access is granted. Turn the switch off at any time to stop scanning.'
    : 'Without this permission, Markdown Lens only touches file:// documents and Markdown URLs.';
}
