/**
 * Settings storage.
 *
 * Small preferences live in chrome.storage.sync so they follow the user between
 * machines. Custom CSS can be large (sync caps a single item at 8 KB), so it is
 * kept in chrome.storage.local.
 */

export const LOCAL_KEYS = ['customCss'];

export const DEFAULTS = {
  // Master switch
  enabled: true,

  // Document theme. `theme` is either a theme id or 'auto', in which case
  // themeLight / themeDark are chosen from the OS colour scheme.
  theme: 'auto',
  themeLight: 'github-light',
  themeDark: 'github-dark',

  // Code theme. 'auto' derives a sensible highlight.js theme from the document
  // theme; otherwise it is a highlight.js stylesheet id.
  codeTheme: 'auto',
  codeThemeLight: 'github',
  codeThemeDark: 'github-dark',

  // Typography
  font: 'system',
  codeFont: 'system-mono',
  fontSize: 16,
  lineHeight: 1.7,
  contentWidth: 860,
  paragraphSpacing: 1,

  // Layout
  toc: true,
  tocPosition: 'left',
  tocCollapsed: false,
  showToolbar: true,
  showProgress: true,
  showFooter: true,

  // Code blocks
  copyButtons: true,
  lineNumbers: false,
  wrapCode: false,

  // Markdown features
  math: true,
  mermaid: true,
  emoji: true,
  typographer: true,
  linkify: true,
  breaks: false,
  anchors: true,
  taskLists: true,
  footnotes: true,
  attrs: false,
  frontMatter: 'table',

  // Behaviour
  autoReload: true,
  autoReloadInterval: 1500,
  rememberScroll: true,
  openLinksInNewTab: false,
  scanAllPages: false,

  // Escape hatch
  customCss: '',
};

const listeners = new Set();
let cache = null;

function splitByArea(patch) {
  const sync = {};
  const local = {};
  for (const [key, value] of Object.entries(patch)) {
    (LOCAL_KEYS.includes(key) ? local : sync)[key] = value;
  }
  return { sync, local };
}

async function readArea(area, keys) {
  try {
    return await chrome.storage[area].get(keys);
  } catch {
    return {};
  }
}

/** Read the full, defaulted settings object. */
export async function getSettings() {
  if (cache) return { ...cache };
  const syncKeys = Object.keys(DEFAULTS).filter((k) => !LOCAL_KEYS.includes(k));
  const [synced, local] = await Promise.all([
    readArea('sync', syncKeys),
    readArea('local', LOCAL_KEYS),
  ]);
  cache = { ...DEFAULTS, ...synced, ...local };
  return { ...cache };
}

/** Merge a partial update into storage. */
export async function setSettings(patch) {
  const { sync, local } = splitByArea(patch);
  const writes = [];
  if (Object.keys(sync).length) writes.push(chrome.storage.sync.set(sync));
  if (Object.keys(local).length) writes.push(chrome.storage.local.set(local));
  await Promise.all(writes);
  if (cache) cache = { ...cache, ...patch };
}

/** Restore every preference to its default. */
export async function resetSettings() {
  const syncKeys = Object.keys(DEFAULTS).filter((k) => !LOCAL_KEYS.includes(k));
  await Promise.all([
    chrome.storage.sync.remove(syncKeys),
    chrome.storage.local.remove(LOCAL_KEYS),
  ]);
  cache = null;
}

/**
 * Subscribe to live setting changes. The callback receives the changed keys
 * merged over the current values.
 */
export function onSettingsChanged(callback) {
  if (!listeners.size) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync' && area !== 'local') return;
      const patch = {};
      for (const [key, { newValue }] of Object.entries(changes)) {
        if (!(key in DEFAULTS)) continue;
        patch[key] = newValue === undefined ? DEFAULTS[key] : newValue;
      }
      if (!Object.keys(patch).length) return;
      cache = { ...(cache || DEFAULTS), ...patch };
      for (const fn of listeners) fn({ ...cache }, patch);
    });
  }
  listeners.add(callback);
  return () => listeners.delete(callback);
}
