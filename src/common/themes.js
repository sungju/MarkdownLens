/**
 * Document theme registry.
 *
 * Every theme is a block of CSS custom properties in assets/themes.css keyed by
 * `html[data-mdl-theme="<id>"]`, so switching costs nothing at runtime.
 * `code` names the highlight.js stylesheet used when the code theme is 'auto'.
 */

export const THEMES = [
  { id: 'github-light',      name: 'GitHub Light',       scheme: 'light', code: 'github' },
  { id: 'github-dark',       name: 'GitHub Dark',        scheme: 'dark',  code: 'github-dark' },
  { id: 'github-dimmed',     name: 'GitHub Dimmed',      scheme: 'dark',  code: 'github-dark-dimmed' },
  { id: 'solarized-light',   name: 'Solarized Light',    scheme: 'light', code: 'base16/solarized-light' },
  { id: 'solarized-dark',    name: 'Solarized Dark',     scheme: 'dark',  code: 'base16/solarized-dark' },
  { id: 'nord',              name: 'Nord',               scheme: 'dark',  code: 'nord' },
  { id: 'dracula',           name: 'Dracula',            scheme: 'dark',  code: 'base16/dracula' },
  { id: 'one-light',         name: 'One Light',          scheme: 'light', code: 'base16/one-light' },
  { id: 'one-dark',          name: 'One Dark',           scheme: 'dark',  code: 'atom-one-dark' },
  { id: 'gruvbox-light',     name: 'Gruvbox Light',      scheme: 'light', code: 'base16/gruvbox-light-medium' },
  { id: 'gruvbox-dark',      name: 'Gruvbox Dark',       scheme: 'dark',  code: 'base16/gruvbox-dark-medium' },
  { id: 'tokyo-night',       name: 'Tokyo Night',        scheme: 'dark',  code: 'base16/tomorrow-night' },
  { id: 'catppuccin-latte',  name: 'Catppuccin Latte',   scheme: 'light', code: 'base16/one-light' },
  { id: 'catppuccin-mocha',  name: 'Catppuccin Mocha',   scheme: 'dark',  code: 'base16/dracula' },
  { id: 'rose-pine',         name: 'Rosé Pine',          scheme: 'dark',  code: 'base16/pop' },
  { id: 'sepia',             name: 'Sepia',              scheme: 'light', code: 'base16/atelier-dune-light' },
  { id: 'paper',             name: 'Paper',              scheme: 'light', code: 'base16/grayscale-light' },
  { id: 'midnight',          name: 'Midnight (OLED)',    scheme: 'dark',  code: 'base16/grayscale-dark' },
  { id: 'contrast-light',    name: 'High Contrast Light',scheme: 'light', code: 'a11y-light' },
  { id: 'contrast-dark',     name: 'High Contrast Dark', scheme: 'dark',  code: 'a11y-dark' },
];

export const THEMES_BY_ID = new Map(THEMES.map((t) => [t.id, t]));

export const FONTS = [
  { id: 'system',   name: 'System UI',   stack: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", sans-serif' },
  { id: 'serif',    name: 'Serif',       stack: '"Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Georgia, "Apple SD Gothic Neo", "Nanum Myeongjo", "Noto Serif KR", serif' },
  { id: 'humanist', name: 'Humanist',    stack: 'Optima, Candara, "Gill Sans", "Gill Sans MT", "Trebuchet MS", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif' },
  { id: 'grotesk',  name: 'Grotesk',     stack: 'Inter, "Helvetica Neue", Helvetica, Arial, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif' },
  { id: 'mono',     name: 'Monospace',   stack: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace' },
];

export const CODE_FONTS = [
  { id: 'system-mono', name: 'System Mono', stack: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace' },
  { id: 'jetbrains',   name: 'JetBrains Mono', stack: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' },
  { id: 'fira',        name: 'Fira Code',  stack: '"Fira Code", "Fira Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' },
  { id: 'cascadia',    name: 'Cascadia Code', stack: '"Cascadia Code", "Cascadia Mono", ui-monospace, Consolas, Menlo, monospace' },
  { id: 'ibm-plex',    name: 'IBM Plex Mono', stack: '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' },
  { id: 'courier',     name: 'Courier',    stack: '"Courier New", Courier, monospace' },
];

export const FONT_STACKS = Object.fromEntries(
  [...FONTS, ...CODE_FONTS].map((f) => [f.id, f.stack])
);

/** Resolve 'auto' against the OS colour scheme and return a concrete theme. */
export function resolveTheme(settings, prefersDark) {
  const id = settings.theme === 'auto'
    ? (prefersDark ? settings.themeDark : settings.themeLight)
    : settings.theme;
  return THEMES_BY_ID.get(id) || THEMES_BY_ID.get('github-light');
}

/**
 * Resolve the highlight.js stylesheet id.
 *
 *   'auto'   follow the document theme's hand-picked companion
 *   'pair'   use codeThemeLight / codeThemeDark, chosen by the document theme
 *   <id>     always this stylesheet
 */
export function resolveCodeTheme(settings, theme) {
  if (settings.codeTheme === 'auto') return theme.code;
  if (settings.codeTheme === 'pair') {
    return theme.scheme === 'dark' ? settings.codeThemeDark : settings.codeThemeLight;
  }
  return settings.codeTheme;
}
