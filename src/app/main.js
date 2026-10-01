/**
 * Viewer entry point. Takes over the document, renders the Markdown and keeps
 * everything in sync with the user's settings.
 */

import { getSettings, setSettings, onSettingsChanged } from '../common/settings.js';
import { THEMES_BY_ID, FONT_STACKS } from '../common/themes.js';
import { applyAppearance, installBaseStyles, installMathStyles, onSchemeChange, prefersDark } from './theming.js';
import { renderMarkdown, highlightSource } from './render.js';
import { buildShell } from './shell.js';
import { buildToc } from './toc.js';
import { enhance } from './enhance.js';
import { formatValue } from './frontmatter.js';
import { createWatcher } from './watch.js';
import { extensionAlive, guard } from '../common/runtime.js';

const state = {
  settings: null,
  shell: null,
  source: '',
  url: '',
  name: null,
  theme: null,
  rawMode: false,
  toc: null,
  watcher: null,
  watchEnabled: true,
  onRequestOpen: null,
  previewRestore: null,
};

/**
 * Take over the document and render `context.source`.
 *
 * @param {object} context
 * @param {string} context.source        Markdown text
 * @param {string} context.url           document URL, used for links and scroll memory
 * @param {string} [context.name]        display name (defaults to the URL's file name)
 * @param {boolean} [context.watch=true] poll the URL for changes
 * @param {() => void} [context.onRequestOpen] replaces the reload button with "open a file"
 */
export async function boot(context) {
  state.source = context.source;
  state.url = context.url;
  state.name = context.name || null;
  state.watchEnabled = context.watch !== false;
  state.onRequestOpen = context.onRequestOpen || null;
  state.settings = await getSettings();

  prepareDocument();
  installBaseStyles(document.head);

  state.shell = buildShell({
    title: displayName(),
    actions: {
      toggleOutline: (force) => toggleOutline(force),
      toggleScheme: () => toggleScheme(),
      toggleRaw: () => toggleRaw(),
      reload: () => (state.onRequestOpen ? state.onRequestOpen() : reloadFromDisk()),
      openSettings: () => guard(() => chrome.runtime.sendMessage({ type: 'open-options' })),
      setTheme: (id) => setSettings({ theme: id }),
      setCodeTheme: (id) => setSettings({ codeTheme: id }),
      previewCodeTheme: (id) => previewCodeTheme(id),
    },
  });

  document.body.appendChild(state.shell.root);
  applyAll();

  await renderDocument();

  restoreScroll();
  installKeyboardShortcuts();
  installMessageBridge();

  onSettingsChanged(async (next, patch) => {
    state.settings = next;
    applyAll();
    if (needsRerender(patch)) await renderDocument({ keepScroll: true });
    else if ('lineNumbers' in patch || 'copyButtons' in patch) await renderDocument({ keepScroll: true });
    if ('autoReload' in patch || 'autoReloadInterval' in patch) startWatcher();
  });

  onSchemeChange(() => {
    applyAll();
    refreshDiagrams();
  });

  startWatcher();
  document.documentElement.classList.add('mdl-ready');
}

/* ------------------------------------------------------------- document */

function prepareDocument() {
  document.documentElement.classList.add('mdl-host');
  document.head.textContent = '';
  document.body.textContent = '';
  document.body.className = 'mdl-body';

  const charset = document.createElement('meta');
  charset.setAttribute('charset', 'utf-8');
  const viewport = document.createElement('meta');
  viewport.name = 'viewport';
  viewport.content = 'width=device-width, initial-scale=1';
  document.head.append(charset, viewport);

  document.title = documentName(location.href);
}

function documentName(url) {
  try {
    const { pathname } = new URL(url);
    const name = decodeURIComponent(pathname.split('/').filter(Boolean).pop() || '');
    return name || url;
  } catch {
    return url;
  }
}

function displayName() {
  return state.name || documentName(state.url);
}

/** Swap in a different document without rebuilding the shell. */
export async function openSource(source, name) {
  state.source = source;
  if (name) state.name = name;
  state.rawMode = false;
  await renderDocument();
  window.scrollTo({ top: 0 });
}

function applyAll() {
  const { theme, codeThemeId } = applyAppearance(state.settings);
  state.theme = theme;
  state.codeThemeId = codeThemeId;

  state.shell.root.classList.toggle('mdl-toc-right', state.settings.tocPosition === 'right');
  state.shell.setOutline(state.settings.toc && !state.settings.tocCollapsed);
  state.shell.setScheme(theme.scheme);
  state.shell.setFooterVisible(state.settings.showFooter);
  state.shell.menus.themeMenu.sync(state.settings);
  state.shell.menus.codeMenu.sync(state.settings);
  document.documentElement.classList.toggle('mdl-toc-disabled', !state.settings.toc);
}

/** Settings that change the parsed output rather than just its appearance. */
function needsRerender(patch) {
  const keys = ['breaks', 'linkify', 'typographer', 'emoji', 'math', 'anchors',
    'taskLists', 'footnotes', 'attrs', 'frontMatter', 'mermaid', 'openLinksInNewTab'];
  return keys.some((key) => key in patch);
}

async function renderDocument({ keepScroll = false } = {}) {
  const previousScroll = keepScroll ? window.scrollY : null;
  const { shell, settings } = state;

  shell.article.setAttribute('aria-busy', 'true');

  let result;
  try {
    result = await renderMarkdown(state.source, settings);
  } catch (error) {
    console.error('[Markdown Lens] render failed:', error);
    shell.article.textContent = state.source;
    shell.article.setAttribute('aria-busy', 'false');
    return;
  }

  shell.article.innerHTML = result.html;
  renderFrontMatter(result);

  const heading = shell.article.querySelector('h1');
  const title = heading ? heading.textContent.replace(/^#/, '').trim() : displayName();
  document.title = `${title} — Markdown Lens`;
  shell.setTitle(displayName());

  enhance(shell.article, settings);

  state.toc?.destroy();
  state.toc = buildToc(shell.article, shell.tocNav);

  if (shell.article.querySelector('.katex')) installMathStyles(document.head);
  if (settings.mermaid) await refreshDiagrams();

  shell.article.setAttribute('aria-busy', 'false');

  if (previousScroll != null) window.scrollTo({ top: previousScroll });
  else scrollToHash();

  if (state.rawMode) await showRaw(true);
}

function renderFrontMatter({ frontMatter, frontMatterRaw }) {
  const { meta } = state.shell;
  meta.textContent = '';

  const mode = state.settings.frontMatter;
  if (mode === 'hide' || !frontMatterRaw) {
    meta.hidden = true;
    return;
  }

  if (mode === 'raw' || !frontMatter) {
    const pre = document.createElement('pre');
    pre.className = 'mdl-frontmatter-raw';
    pre.textContent = frontMatterRaw.trim();
    meta.append(pre);
    meta.hidden = false;
    return;
  }

  const table = document.createElement('table');
  table.className = 'mdl-frontmatter-table';
  const body = document.createElement('tbody');
  for (const [key, value] of Object.entries(frontMatter)) {
    const row = document.createElement('tr');
    const th = document.createElement('th');
    th.textContent = key;
    const td = document.createElement('td');
    td.textContent = formatValue(value);
    row.append(th, td);
    body.append(row);
  }
  table.append(body);
  meta.append(table);
  meta.hidden = false;
}

async function refreshDiagrams() {
  const { shell, settings, theme } = state;
  if (!settings.mermaid) return;
  const hasSource = shell.article.querySelector('code.mdl-mermaid, .mdl-diagram[data-mdl-mermaid-source]');
  if (!hasSource) return;

  try {
    const mod = await import('../lazy/mermaid.js');
    const options = {
      scheme: theme?.scheme || 'light',
      fontFamily: FONT_STACKS[settings.font] || FONT_STACKS.system,
    };
    if (shell.article.querySelector('code.mdl-mermaid')) {
      await mod.renderDiagrams(shell.article, options);
    } else {
      await mod.retheme(shell.article, options);
    }
  } catch (error) {
    console.warn('[Markdown Lens] diagram rendering unavailable:', error);
  }
}

/* -------------------------------------------------------------- actions */

function toggleOutline(force) {
  const open = force ?? !(state.settings.toc && !state.settings.tocCollapsed);
  if (!state.settings.toc && open) setSettings({ toc: true, tocCollapsed: false });
  else setSettings({ tocCollapsed: !open });
}

function toggleScheme() {
  const current = state.theme;
  const wantDark = current.scheme !== 'dark';
  const { settings } = state;

  if (settings.theme === 'auto') {
    // Pin to the explicit theme the user already picked for that side.
    setSettings({ theme: wantDark ? settings.themeDark : settings.themeLight });
    return;
  }
  const fallback = wantDark ? settings.themeDark : settings.themeLight;
  const target = THEMES_BY_ID.get(fallback)?.scheme === (wantDark ? 'dark' : 'light')
    ? fallback
    : (wantDark ? 'github-dark' : 'github-light');
  setSettings({ theme: target });
}

async function toggleRaw() {
  state.rawMode = !state.rawMode;
  await showRaw(state.rawMode);
}

async function showRaw(on) {
  const { shell } = state;
  shell.setRaw(on);
  if (on) {
    shell.rawCode.innerHTML = await highlightSource(state.source);
    shell.rawView.hidden = false;
    shell.article.hidden = true;
    shell.meta.hidden = true;
  } else {
    shell.rawView.hidden = true;
    shell.article.hidden = false;
    shell.meta.hidden = !shell.meta.hasChildNodes() || state.settings.frontMatter === 'hide';
  }
}

function previewCodeTheme(id) {
  if (id === null) {
    if (state.previewRestore) {
      applyAppearance(state.previewRestore);
      state.previewRestore = null;
    }
    return;
  }
  state.previewRestore ??= { ...state.settings };
  applyAppearance({ ...state.settings, codeTheme: id });
}

async function reloadFromDisk() {
  const fresh = await state.watcher?.fetchOnce();
  if (fresh == null) {
    location.reload();
    return;
  }
  state.source = fresh;
  await renderDocument({ keepScroll: true });
}

/* --------------------------------------------------------------- scroll */

function scrollKey() {
  return `scroll:${state.url.split('#')[0]}`;
}

function scrollToHash() {
  const hash = location.hash.slice(1);
  if (!hash) return;
  const target = document.getElementById(decodeURIComponent(hash));
  target?.scrollIntoView({ block: 'start' });
}

async function restoreScroll() {
  if (location.hash) return scrollToHash();
  if (!state.settings.rememberScroll) return;
  try {
    const stored = await chrome.storage.session.get(scrollKey());
    const top = stored[scrollKey()];
    if (typeof top === 'number' && top > 0) window.scrollTo({ top });
  } catch { /* session storage unavailable */ }

  // Detaching matters as much as not throwing: once the extension is gone it
  // is never coming back for this page, so the listener should go with it
  // rather than fail on every scroll for as long as the document is open.
  const detach = new AbortController();
  let pending = null;
  window.addEventListener('scroll', () => {
    clearTimeout(pending);
    pending = setTimeout(async () => {
      if (!extensionAlive()) return detach.abort();
      await guard(() => chrome.storage.session.set({ [scrollKey()]: window.scrollY }));
    }, 250);
  }, { passive: true, signal: detach.signal });
}

/* ------------------------------------------------------------ live edit */

function startWatcher() {
  state.watcher?.stop();
  if (!state.watchEnabled) return;
  state.watcher = createWatcher({
    url: state.url,
    interval: state.settings.autoReloadInterval,
    enabled: state.settings.autoReload,
    current: () => state.source,
    onChange: async (text) => {
      state.source = text;
      await renderDocument({ keepScroll: true });
      flashReloaded();
    },
  });
  state.watcher.start();
}

function flashReloaded() {
  const toast = document.createElement('div');
  toast.className = 'mdl-toast';
  toast.textContent = 'Reloaded';
  state.shell.root.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('is-visible'));
  setTimeout(() => {
    toast.classList.remove('is-visible');
    setTimeout(() => toast.remove(), 300);
  }, 1200);
}

/* ------------------------------------------------------------- bindings */

function installKeyboardShortcuts() {
  document.addEventListener('keydown', (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target;
    if (target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;

    switch (event.key) {
      case 'o': toggleOutline(); break;
      case 'r': toggleRaw(); break;
      case 'd': toggleScheme(); break;
      case 'p': if (!event.shiftKey) return; window.print(); break;
      case 'g': window.scrollTo({ top: 0, behavior: 'smooth' }); break;
      case 'G': window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }); break;
      default: return;
    }
    event.preventDefault();
  });
}

function installMessageBridge() {
  if (!extensionAlive()) return;
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    switch (message?.type) {
      case 'ping':
        sendResponse({ ok: true, title: document.title, raw: state.rawMode });
        return false;
      case 'toggle-raw':
        toggleRaw();
        break;
      case 'toggle-scheme':
        toggleScheme();
        break;
      case 'reload-source':
        reloadFromDisk();
        break;
      case 'print':
        window.print();
        break;
      default:
        return false;
    }
    sendResponse({ ok: true });
    return false;
  });
}
