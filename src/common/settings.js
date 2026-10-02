/**
 * Settings storage.
 *
 * Small preferences live in chrome.storage.sync so they follow the user between
 * machines. Custom CSS can be large (sync caps a single item at 8 KB), so it is
 * kept in chrome.storage.local.
 */

import { extensionAlive, guard, guardSync } from './runtime.js';

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

/*
 * Synced storage accepts 120 writes a minute and 1800 an hour, and a slider
 * fires an input event for every step it passes. Written straight through, a
 * few drags in Settings used up the allowance, and every change after that
 * was rejected — silently, since the page had already shown it as saved. So
 * synced writes are spaced at least SYNC_SPACING apart, with whatever arrives
 * in between merged into the next one. The first change after a quiet spell
 * still goes out at once, which keeps toolbar buttons instant. A write the
 * store refuses anyway is kept and tried again until it lands.
 */
const SYNC_SPACING = 500;
const SYNC_RETRY = 5000;
let syncPending = null;
let syncTimer = null;
let syncLastWrite = 0;
let syncWaiters = [];

function scheduleSync(delay) {
  if (syncTimer) return;
  syncTimer = setTimeout(flushSync, Math.max(0, delay));
}

async function flushSync() {
  syncTimer = null;
  const batch = syncPending;
  const waiters = syncWaiters;
  syncPending = null;
  syncWaiters = [];
  syncLastWrite = Date.now();
  if (!batch) return;

  try {
    if (extensionAlive()) await chrome.storage.sync.set(batch);
  } catch (error) {
    if (extensionAlive()) {
      console.warn('[Markdown Lens] settings not saved yet, retrying:', error?.message || error);
      // Newer values for the same keys win over the batch being retried.
      syncPending = { ...batch, ...syncPending };
      syncWaiters = [...waiters, ...syncWaiters];
      scheduleSync(SYNC_RETRY);
      return;
    }
  }
  for (const resolve of waiters) resolve();
  if (syncPending) scheduleSync(syncLastWrite + SYNC_SPACING - Date.now());
}

function writeSync(patch) {
  syncPending = { ...syncPending, ...patch };
  const done = new Promise((resolve) => syncWaiters.push(resolve));
  scheduleSync(syncLastWrite + SYNC_SPACING - Date.now());
  return done;
}

/** Merge a partial update into storage. */
export async function setSettings(patch) {
  // The cache is updated before the write, and whether or not it lands: a
  // synced write can be held back for a while, and a viewer whose extension
  // has been reloaded keeps honouring choices made in it for the rest of the
  // page's life, even though nothing is persisted.
  if (cache) cache = { ...cache, ...patch };
  const { sync, local } = splitByArea(patch);
  const writes = [];
  if (Object.keys(sync).length) writes.push(writeSync(sync));
  if (Object.keys(local).length) writes.push(guard(() => chrome.storage.local.set(local)));
  await Promise.all(writes);
}

/** Restore every preference to its default. */
export async function resetSettings() {
  // A change still waiting to be written would otherwise land after the reset
  // and undo part of it.
  clearTimeout(syncTimer);
  syncTimer = null;
  syncPending = null;
  for (const resolve of syncWaiters) resolve();
  syncWaiters = [];
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
    guardSync(() => chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync' && area !== 'local') return;
      const patch = {};
      for (const [key, { newValue }] of Object.entries(changes)) {
        if (!(key in DEFAULTS)) continue;
        patch[key] = newValue === undefined ? DEFAULTS[key] : newValue;
      }
      if (!Object.keys(patch).length) return;
      cache = { ...(cache || DEFAULTS), ...patch };
      for (const fn of listeners) fn({ ...cache }, patch);
    }));
  }
  listeners.add(callback);
  return () => listeners.delete(callback);
}
