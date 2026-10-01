/**
 * The viewer chrome: toolbar, outline sidebar, reading progress and the
 * theme pickers. Pure DOM construction — no Markdown knowledge lives here.
 */

import { ICONS } from './icons.js';
import { THEMES } from '../common/themes.js';
import { CODE_THEMES } from '../generated/hljs-themes.js';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function iconButton(icon, label, { pressed = null } = {}) {
  const button = el('button', 'mdl-btn');
  button.type = 'button';
  button.innerHTML = ICONS[icon] || '';
  button.append(el('span', 'mdl-btn-label', label));
  button.title = label;
  button.setAttribute('aria-label', label);
  if (pressed !== null) button.setAttribute('aria-pressed', String(pressed));
  return button;
}

/**
 * Build the whole shell into a blank document.
 * @returns a handle with element references and small helpers.
 */
export function buildShell({ actions }) {
  const root = el('div', 'mdl-root');

  /* ---- sidebar ---- */
  const sidebar = el('aside', 'mdl-toc');
  const tocHead = el('div', 'mdl-toc-head');
  tocHead.append(el('span', 'mdl-toc-title', 'Outline'));
  const tocClose = iconButton('close', 'Hide outline');
  tocClose.classList.add('mdl-toc-close');
  tocHead.append(tocClose);
  const tocNav = el('nav', 'mdl-toc-nav');
  tocNav.setAttribute('aria-label', 'Document outline');
  sidebar.append(tocHead, tocNav);

  /* ---- toolbar ---- */
  const toolbar = el('header', 'mdl-toolbar');
  const toolbarLeft = el('div', 'mdl-toolbar-group');
  const toolbarRight = el('div', 'mdl-toolbar-group');

  const outlineBtn = iconButton('outline', 'Outline', { pressed: true });
  toolbarLeft.append(outlineBtn);

  const themeBtn = iconButton('palette', 'Theme');
  const codeBtn = iconButton('code', 'Code theme');
  const schemeBtn = iconButton('moon', 'Toggle dark mode');
  const rawBtn = iconButton('raw', 'Source', { pressed: false });
  const reloadBtn = iconButton('reload', 'Reload');
  const printBtn = iconButton('print', 'Print');
  const settingsBtn = iconButton('settings', 'Settings');
  toolbarRight.append(themeBtn, codeBtn, schemeBtn, rawBtn, reloadBtn, printBtn, settingsBtn);

  toolbar.append(toolbarLeft, toolbarRight);

  /* ---- content ---- */
  const main = el('div', 'mdl-main');
  const page = el('div', 'mdl-page');
  const article = el('article', 'mdl-content markdown-body');
  const meta = el('div', 'mdl-frontmatter');
  meta.hidden = true;
  const rawView = el('pre', 'mdl-raw');
  rawView.hidden = true;
  const rawCode = el('code', 'hljs language-markdown');
  rawView.append(rawCode);

  page.append(meta, article, rawView);
  main.append(toolbar, page);

  const progress = el('div', 'mdl-progress');
  const progressBar = el('div', 'mdl-progress-bar');
  progress.append(progressBar);

  const toTop = iconButton('top', 'Back to top');
  toTop.classList.add('mdl-to-top');

  root.append(progress, sidebar, main, toTop);

  /* ---- wiring ---- */
  outlineBtn.addEventListener('click', () => actions.toggleOutline());
  tocClose.addEventListener('click', () => actions.toggleOutline(false));
  schemeBtn.addEventListener('click', () => actions.toggleScheme());
  rawBtn.addEventListener('click', () => actions.toggleRaw());
  reloadBtn.addEventListener('click', () => actions.reload());
  printBtn.addEventListener('click', () => window.print());
  settingsBtn.addEventListener('click', () => actions.openSettings());
  toTop.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));

  const themeMenu = createThemeMenu(themeBtn, actions);
  const codeMenu = createCodeThemeMenu(codeBtn, actions);
  root.append(themeMenu.element, codeMenu.element);

  window.addEventListener('scroll', () => {
    const doc = document.documentElement;
    const max = doc.scrollHeight - doc.clientHeight;
    const top = window.scrollY;
    progressBar.style.transform = `scaleX(${max > 0 ? top / max : 0})`;
    toTop.classList.toggle('is-visible', top > 400);
  }, { passive: true });

  return {
    root, sidebar, tocNav, article, meta, rawView, rawCode, page, toolbar,
    buttons: { outlineBtn, themeBtn, codeBtn, schemeBtn, rawBtn, reloadBtn, printBtn, settingsBtn },
    menus: { themeMenu, codeMenu },
    setOutline(open) {
      root.classList.toggle('mdl-toc-open', open);
      outlineBtn.setAttribute('aria-pressed', String(open));
    },
    setRaw(on) {
      rawBtn.setAttribute('aria-pressed', String(on));
      rawBtn.classList.toggle('is-active', on);
    },
    setScheme(scheme) {
      schemeBtn.innerHTML = ICONS[scheme === 'dark' ? 'sun' : 'moon'];
      const label = scheme === 'dark' ? 'Switch to a light theme' : 'Switch to a dark theme';
      schemeBtn.append(el('span', 'mdl-btn-label', label));
      schemeBtn.title = label;
      schemeBtn.setAttribute('aria-label', label);
    },
  };
}

/* ----------------------------------------------------------------- menus */

function createPopover(anchorButton) {
  const popover = el('div', 'mdl-menu');
  popover.hidden = true;
  popover.setAttribute('role', 'dialog');
  document.addEventListener('click', (event) => {
    if (popover.hidden) return;
    if (popover.contains(event.target) || anchorButton.contains(event.target)) return;
    close();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !popover.hidden) close();
  });

  function open() {
    for (const other of document.querySelectorAll('.mdl-menu')) {
      if (other !== popover) other.hidden = true;
    }
    popover.hidden = false;
    anchorButton.classList.add('is-active');
    const box = anchorButton.getBoundingClientRect();
    popover.style.top = `${box.bottom + 6}px`;
    popover.style.right = `${Math.max(8, window.innerWidth - box.right)}px`;
    popover.dispatchEvent(new CustomEvent('mdl:open'));
  }
  function close() {
    popover.hidden = true;
    anchorButton.classList.remove('is-active');
  }
  anchorButton.addEventListener('click', () => (popover.hidden ? open() : close()));

  return { popover, open, close };
}

function createThemeMenu(button, actions) {
  const { popover, close } = createPopover(button);
  popover.classList.add('mdl-menu-theme');

  const header = el('div', 'mdl-menu-head', 'Document theme');
  popover.append(header);

  const autoRow = el('button', 'mdl-menu-row mdl-menu-auto');
  autoRow.type = 'button';
  autoRow.dataset.theme = 'auto';
  autoRow.append(el('span', 'mdl-menu-name', 'Match system'));
  autoRow.addEventListener('click', () => { actions.setTheme('auto'); close(); });
  popover.append(autoRow);

  for (const group of ['light', 'dark']) {
    popover.append(el('div', 'mdl-menu-sub', group === 'light' ? 'Light' : 'Dark'));
    const grid = el('div', 'mdl-theme-grid');
    for (const theme of THEMES.filter((t) => t.scheme === group)) {
      const row = el('button', 'mdl-theme-chip');
      row.type = 'button';
      row.dataset.theme = theme.id;
      row.title = theme.name;
      const swatch = el('span', 'mdl-theme-swatch');
      swatch.setAttribute('data-mdl-theme', theme.id);
      swatch.innerHTML = '<i class="s1"></i><i class="s2"></i><i class="s3"></i>';
      row.append(swatch, el('span', 'mdl-theme-name', theme.name));
      row.addEventListener('click', () => { actions.setTheme(theme.id); close(); });
      grid.append(row);
    }
    popover.append(grid);
  }

  return {
    element: popover,
    close,
    sync(settings) {
      for (const node of popover.querySelectorAll('[data-theme]')) {
        node.classList.toggle('is-selected', node.dataset.theme === settings.theme);
      }
    },
  };
}

function createCodeThemeMenu(button, actions) {
  const { popover, close } = createPopover(button);
  popover.classList.add('mdl-menu-code');

  popover.append(el('div', 'mdl-menu-head', `Code theme · ${CODE_THEMES.length} available`));

  const searchWrap = el('div', 'mdl-menu-search');
  searchWrap.innerHTML = ICONS.search;
  const search = el('input', 'mdl-menu-input');
  search.type = 'search';
  search.placeholder = 'Filter themes…';
  search.spellcheck = false;
  searchWrap.append(search);
  popover.append(searchWrap);

  const list = el('div', 'mdl-menu-list');
  popover.append(list);

  const rows = [];
  const addRow = (id, name, meta) => {
    const row = el('button', 'mdl-menu-row');
    row.type = 'button';
    row.dataset.code = id;
    row.append(el('span', 'mdl-menu-name', name));
    if (meta) row.append(el('span', 'mdl-menu-meta', meta));
    row.addEventListener('click', () => { actions.setCodeTheme(id); close(); });
    row.addEventListener('mouseenter', () => actions.previewCodeTheme(id));
    list.append(row);
    rows.push({ row, haystack: `${name} ${id}`.toLowerCase() });
  };

  addRow('auto', 'Match document theme', 'auto');
  addRow('pair', 'Use my light / dark pair', 'pair');
  for (const theme of CODE_THEMES) {
    addRow(theme.id, theme.name, theme.scheme);
  }

  list.addEventListener('mouseleave', () => actions.previewCodeTheme(null));

  search.addEventListener('input', () => {
    const query = search.value.trim().toLowerCase();
    for (const { row, haystack } of rows) {
      row.hidden = query ? !haystack.includes(query) : false;
    }
  });

  popover.addEventListener('mdl:open', () => {
    search.value = '';
    search.dispatchEvent(new Event('input'));
    setTimeout(() => search.focus(), 0);
    popover.querySelector('.is-selected')?.scrollIntoView({ block: 'center' });
  });

  return {
    element: popover,
    close,
    sync(settings) {
      for (const row of list.children) {
        row.classList.toggle('is-selected', row.dataset.code === settings.codeTheme);
      }
    },
  };
}
