/**
 * Applies document themes, highlight.js stylesheets and typography settings.
 *
 * Document themes are plain custom-property blocks in assets/themes.css, so a
 * theme switch is a single attribute write. Code themes are separate
 * stylesheets shipped with the extension and swapped by href.
 */

import { FONT_STACKS, resolveTheme, resolveCodeTheme } from '../common/themes.js';
import { CODE_THEMES_BY_ID } from '../generated/hljs-themes.js';

const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

function asset(path) {
  return chrome.runtime.getURL(path);
}

function ensureLink(root, id, href) {
  let link = root.querySelector(`link#${id}`);
  if (!link) {
    link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    root.appendChild(link);
  }
  if (link.getAttribute('href') !== href) link.setAttribute('href', href);
  return link;
}

export function prefersDark() {
  return darkQuery.matches;
}

/** Re-run `callback` whenever the OS colour scheme flips. */
export function onSchemeChange(callback) {
  const handler = () => callback(darkQuery.matches);
  darkQuery.addEventListener('change', handler);
  return () => darkQuery.removeEventListener('change', handler);
}

/** Install the stylesheets that never change for the lifetime of the page. */
export function installBaseStyles(head) {
  ensureLink(head, 'mdl-css-viewer', asset('assets/viewer.css'));
  ensureLink(head, 'mdl-css-themes', asset('assets/themes.css'));
}

export function installMathStyles(head) {
  ensureLink(head, 'mdl-css-katex', asset('katex/katex.min.css'));
}

/**
 * Apply every visual setting at once.
 * @returns {{theme: object, codeThemeId: string}} the resolved selection
 */
export function applyAppearance(settings, { head = document.head, root = document.documentElement } = {}) {
  const theme = resolveTheme(settings, prefersDark());
  const codeThemeId = resolveCodeTheme(settings, theme);
  const codeTheme = CODE_THEMES_BY_ID.get(codeThemeId) || CODE_THEMES_BY_ID.get('github');

  root.setAttribute('data-mdl-theme', theme.id);
  root.setAttribute('data-mdl-scheme', theme.scheme);
  root.style.colorScheme = theme.scheme;

  if (codeTheme) ensureLink(head, 'mdl-css-code', asset(`hljs/${codeTheme.file}`));

  const style = root.style;

  // Code blocks normally sit on the document theme's surface, which keeps the
  // page cohesive. That only works while the two agree about light and dark:
  // a dark code theme writes pale text, which would be invisible on a light
  // surface, so in that case the code theme supplies its own background.
  if (codeTheme && codeTheme.bg && codeTheme.scheme !== theme.scheme) {
    style.setProperty('--mdl-pre-bg', codeTheme.bg);
  } else {
    style.removeProperty('--mdl-pre-bg');
  }

  style.setProperty('--mdl-font-body', FONT_STACKS[settings.font] || FONT_STACKS.system);
  style.setProperty('--mdl-font-code', FONT_STACKS[settings.codeFont] || FONT_STACKS['system-mono']);
  style.setProperty('--mdl-font-size', `${clamp(settings.fontSize, 11, 28)}px`);
  style.setProperty('--mdl-line-height', String(clamp(settings.lineHeight, 1.2, 2.4)));
  style.setProperty('--mdl-content-width', `${clamp(settings.contentWidth, 480, 2000)}px`);
  style.setProperty('--mdl-para-spacing', String(clamp(settings.paragraphSpacing, 0.4, 2.5)));

  root.classList.toggle('mdl-wrap-code', Boolean(settings.wrapCode));
  root.classList.toggle('mdl-line-numbers', Boolean(settings.lineNumbers));
  root.classList.toggle('mdl-no-toolbar', !settings.showToolbar);
  root.classList.toggle('mdl-no-progress', !settings.showProgress);

  applyCustomCss(head, settings.customCss);

  return { theme, codeThemeId: codeTheme ? codeTheme.id : codeThemeId };
}

function applyCustomCss(head, css) {
  let node = head.querySelector('style#mdl-custom-css');
  if (!css) {
    node?.remove();
    return;
  }
  if (!node) {
    node = document.createElement('style');
    node.id = 'mdl-custom-css';
    head.appendChild(node);
  }
  if (node.textContent !== css) node.textContent = css;
}

function clamp(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}
