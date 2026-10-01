/**
 * Build script.
 *
 * 1. Generates src/generated/hljs-themes.js from the highlight.js stylesheets
 *    that ship with @highlightjs/cdn-assets (including the base16 family),
 *    classifying each one as light or dark from its background luminance.
 * 2. Bundles the content script, the viewer app (code-split so KaTeX, Mermaid
 *    and the extended language pack load on demand) and the extension pages.
 * 3. Copies static assets, the KaTeX stylesheet and its fonts, and the icons.
 */

import { build, context } from 'esbuild';
import { createRequire } from 'node:module';
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');

const WATCH = process.argv.includes('--watch');
const RELEASE = process.argv.includes('--release');

const HLJS_STYLES = path.join(ROOT, 'node_modules/@highlightjs/cdn-assets/styles');
const KATEX_DIST = path.dirname(require.resolve('katex/package.json')) + '/dist';

/* ------------------------------------------------------- hljs theme index */

const NAMED_COLOURS = {
  white: '#ffffff', black: '#000000', transparent: null,
  ivory: '#fffff0', snow: '#fffafa', gainsboro: '#dcdcdc',
};

function parseColour(raw) {
  const value = raw.trim().toLowerCase();
  if (value in NAMED_COLOURS) return NAMED_COLOURS[value];

  let match = /^#([0-9a-f]{3,8})$/.exec(value);
  if (match) {
    let hex = match[1];
    if (hex.length === 3 || hex.length === 4) hex = [...hex].map((c) => c + c).join('');
    return `#${hex.slice(0, 6)}`;
  }

  match = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(value);
  if (match) {
    const [, r, g, b] = match;
    return `#${[r, g, b].map((n) => Math.round(Number(n)).toString(16).padStart(2, '0')).join('')}`;
  }
  return null;
}

function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  const channels = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

/**
 * How closely a selector identifies the code block's own background. Lower
 * wins, so a bare `.hljs` rule beats `pre code.hljs` beats anything else.
 */
function selectorRank(selector) {
  if (selector === '.hljs') return 0;
  if (/(?:^|[\s>+~])\.hljs$/.test(selector)) return 1;
  if (/(?:^|[\s>+~])[a-z]+\.hljs$/.test(selector)) return 2;
  return Infinity;
}

/**
 * Pull the `.hljs` background colour out of a highlight.js stylesheet.
 *
 * Comments are stripped first: the minified files run a `/*! Theme: … *\/`
 * banner straight into the following selector, which would otherwise hide the
 * one rule we care about.
 */
function themeBackground(css) {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  let best = { rank: Infinity, colour: null };

  for (const [, selector, body] of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const rank = Math.min(...selector.split(',').map((s) => selectorRank(s.trim())));
    if (rank > best.rank) continue;

    const decl = /(?:^|;)\s*background(?:-color)?\s*:\s*([^;]+)/i.exec(body);
    if (!decl) continue;

    const colour = parseColour(decl[1].split(/\s+/)[0]);
    // Equal rank means a later rule overriding an earlier one, so keep the last.
    if (colour) best = { rank, colour };
  }

  return best.colour;
}

function prettyName(id) {
  const base16 = id.startsWith('base16/');
  const stem = base16 ? id.slice('base16/'.length) : id;
  const words = stem.split(/[-_]/).map((w) => {
    if (/^\d+c$/i.test(w)) return w.toUpperCase();
    if (['ir', 'vs', 'xt', 'qt', 'an', 'a11y'].includes(w.toLowerCase())) return w.toUpperCase();
    return w.charAt(0).toUpperCase() + w.slice(1);
  }).join(' ');
  return base16 ? `Base16 · ${words}` : words;
}

async function collectThemeFiles(dir, prefix = '') {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      files.push(...await collectThemeFiles(path.join(dir, entry.name), `${prefix}${entry.name}/`));
    } else if (entry.name.endsWith('.min.css')) {
      files.push({
        id: prefix + entry.name.replace(/\.min\.css$/, ''),
        file: `${prefix}${entry.name}`,
        abs: path.join(dir, entry.name),
      });
    }
  }
  return files;
}

async function buildCodeThemeIndex() {
  if (!existsSync(HLJS_STYLES)) {
    throw new Error(`highlight.js stylesheets not found at ${HLJS_STYLES}. Run npm install.`);
  }

  const files = (await collectThemeFiles(HLJS_STYLES)).sort((a, b) => a.id.localeCompare(b.id));
  const themes = [];

  await mkdir(path.join(DIST, 'hljs'), { recursive: true });

  for (const entry of files) {
    const css = await readFile(entry.abs, 'utf8');
    const background = themeBackground(css);
    const scheme = background && luminance(background) < 0.4 ? 'dark' : 'light';

    const target = path.join(DIST, 'hljs', entry.file);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, css);

    // `bg` is kept so the viewer can fall back to the code theme's own surface
    // when it is paired with a document theme of the opposite scheme.
    themes.push({ id: entry.id, name: prettyName(entry.id), scheme, file: entry.file, bg: background });
  }

  const generatedDir = path.join(SRC, 'generated');
  await mkdir(generatedDir, { recursive: true });
  await writeFile(
    path.join(generatedDir, 'hljs-themes.js'),
    `// Generated by scripts/build.mjs — do not edit.\n`
    + `export const CODE_THEMES = ${JSON.stringify(themes, null, 0)};\n\n`
    + `export const CODE_THEMES_BY_ID = new Map(CODE_THEMES.map((t) => [t.id, t]));\n`
  );

  return themes;
}

/**
 * Warn if a document theme points at a code theme that is not installed, or at
 * one whose light/dark classification disagrees with it — pairing a dark
 * document theme with a light code theme looks broken.
 */
async function verifyThemePairings(themes) {
  const byId = new Map(themes.map((t) => [t.id, t]));
  const { THEMES } = await import(path.join(SRC, 'common/themes.js'));

  for (const theme of THEMES) {
    const code = byId.get(theme.code);
    if (!code) {
      console.warn(`  ! ${theme.id}: companion code theme '${theme.code}' is not installed`);
    } else if (code.scheme !== theme.scheme) {
      console.warn(`  ! ${theme.id} is ${theme.scheme} but '${theme.code}' is ${code.scheme}`);
    }
  }
}

/* --------------------------------------------------------------- bundles */

const shared = {
  bundle: true,
  target: ['chrome116'],
  minify: RELEASE,
  sourcemap: RELEASE ? false : 'linked',
  legalComments: 'none',
  logLevel: 'warning',
  define: { 'process.env.NODE_ENV': JSON.stringify(RELEASE ? 'production' : 'development') },
};

const BUILDS = [
  {
    name: 'content script',
    options: {
      ...shared,
      entryPoints: [path.join(SRC, 'content/loader.js')],
      outfile: path.join(DIST, 'content.js'),
      format: 'iife',
    },
  },
  {
    name: 'background',
    options: {
      ...shared,
      entryPoints: [path.join(SRC, 'background.js')],
      outfile: path.join(DIST, 'background.js'),
      format: 'esm',
    },
  },
  {
    // One graph for the viewer and every extension page, so Mermaid, KaTeX,
    // markdown-it and the language pack are emitted exactly once and shared.
    name: 'viewer and pages',
    options: {
      ...shared,
      entryPoints: [
        { in: path.join(SRC, 'app/main.js'), out: 'app/main' },
        { in: path.join(SRC, 'pages/options.js'), out: 'pages/options' },
        { in: path.join(SRC, 'pages/popup.js'), out: 'pages/popup' },
        { in: path.join(SRC, 'pages/welcome.js'), out: 'pages/welcome' },
        { in: path.join(SRC, 'pages/viewer.js'), out: 'pages/viewer' },
      ],
      outdir: DIST,
      format: 'esm',
      splitting: true,
      chunkNames: 'chunks/[name]-[hash]',
    },
  },
];

/* ---------------------------------------------------------------- assets */

async function copyStatic() {
  await cp(path.join(SRC, 'manifest.json'), path.join(DIST, 'manifest.json'));
  await cp(path.join(SRC, 'assets'), path.join(DIST, 'assets'), { recursive: true });
  await cp(path.join(ROOT, 'icons'), path.join(DIST, 'icons'), { recursive: true });

  for (const page of ['options', 'popup', 'welcome', 'viewer']) {
    await cp(path.join(SRC, 'pages', `${page}.html`), path.join(DIST, `${page}.html`));
  }

  await mkdir(path.join(DIST, 'katex'), { recursive: true });
  await cp(path.join(KATEX_DIST, 'katex.min.css'), path.join(DIST, 'katex/katex.min.css'));
  await cp(path.join(KATEX_DIST, 'fonts'), path.join(DIST, 'katex/fonts'), { recursive: true });
}

/* ------------------------------------------------------------------ main */

async function main() {
  console.log(`Markdown Lens — ${RELEASE ? 'release' : 'development'} build`);

  await rm(DIST, { recursive: true, force: true });
  await mkdir(DIST, { recursive: true });

  const themes = await buildCodeThemeIndex();
  console.log(`  code themes: ${themes.length} (${themes.filter((t) => t.scheme === 'dark').length} dark)`);
  await verifyThemePairings(themes);

  if (WATCH) {
    for (const { name, options } of BUILDS) {
      const ctx = await context(options);
      await ctx.watch();
      console.log(`  watching ${name}`);
    }
  } else {
    await Promise.all(BUILDS.map(({ options }) => build(options)));
  }

  await copyStatic();
  console.log(`  output: ${path.relative(ROOT, DIST)}/`);

  if (WATCH) console.log('\nWatching for changes. Reload the extension in chrome://extensions after each change.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
