/**
 * End-to-end smoke test.
 *
 * Loads dist/ into a headless Chrome, visits the content-script path and every
 * extension page over the DevTools protocol, asserts the rendered DOM and
 * fails on any console error or uncaught exception. Screenshots land in
 * test/screenshots/ so the layout can be eyeballed afterwards.
 *
 *   node scripts/smoke.mjs              # all pages
 *   node scripts/smoke.mjs --keep       # leave the screenshots, print paths
 */

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const FIXTURES = path.join(ROOT, 'test');
const SHOTS = path.join(FIXTURES, 'screenshots');
const PROFILE = path.join(ROOT, '.smoke-profile');

const CHROME = process.env.CHROME_PATH
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

// The Chrome Web Store accepts screenshots at exactly 1280×800, so the shots
// this harness captures can be uploaded without being cropped first. It stays
// clear of the viewer's 1100px breakpoint, so the outline is still docked.
const VIEWPORT = { width: 1280, height: 800 };

/** Chrome derives an unpacked extension's id from its absolute path. */
function extensionId(dir) {
  const digest = createHash('sha256').update(dir, 'utf8').digest('hex').slice(0, 32);
  return [...digest].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
}

/* ------------------------------------------------------------ fixture host */

const MIME = {
  '.md': 'text/plain; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

async function startFixtureServer() {
  const server = createServer(async (req, res) => {
    const name = path.basename(new URL(req.url, 'http://x').pathname);
    const file = path.join(FIXTURES, name);
    if (!existsSync(file) || !file.startsWith(FIXTURES)) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(name)] || 'text/plain' });
    res.end(await readFile(file));
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, port: server.address().port };
}

/* ------------------------------------------------------------------- chrome */

/**
 * Chrome no longer honours --load-extension, so the extension is installed at
 * runtime with Extensions.loadUnpacked. That command is only exposed over the
 * debugging pipe, which is why this does not use the HTTP endpoint.
 */
async function launchChrome() {
  await rm(PROFILE, { recursive: true, force: true });

  const child = spawn(CHROME, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-timer-throttling',
    '--enable-unsafe-extension-debugging',
    '--remote-debugging-pipe',
    `--user-data-dir=${PROFILE}`,
    `--window-size=${VIEWPORT.width},${VIEWPORT.height}`,
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });

  const stderr = [];
  child.stderr.on('data', (chunk) => stderr.push(String(chunk)));

  if (!child.stdio[3] || !child.stdio[4]) {
    child.kill('SIGKILL');
    throw new Error(`Chrome did not open the debugging pipe.\n${stderr.join('')}`);
  }

  return { child, stderr };
}

/* --------------------------------------------------------- devtools client */

/** Minimal CDP client speaking the NUL-delimited JSON pipe protocol. */
class Devtools {
  #write;
  #nextId = 1;
  #pending = new Map();
  #listeners = new Set();

  static connect(child) {
    const client = new Devtools();
    const [, , , outgoing, incoming] = child.stdio;
    client.#write = (text) => outgoing.write(`${text}\0`);

    let buffer = '';
    incoming.on('data', (chunk) => {
      buffer += chunk;
      let end = buffer.indexOf('\0');
      while (end !== -1) {
        client.#receive(buffer.slice(0, end));
        buffer = buffer.slice(end + 1);
        end = buffer.indexOf('\0');
      }
    });

    return client;
  }

  #receive(raw) {
    const message = JSON.parse(raw);
    if (message.id !== undefined) {
      const entry = this.#pending.get(message.id);
      if (!entry) return;
      this.#pending.delete(message.id);
      if (message.error) entry.reject(new Error(`${entry.method}: ${message.error.message}`));
      else entry.resolve(message.result);
      return;
    }
    for (const listener of this.#listeners) listener(message);
  }

  on(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  send(method, params = {}, sessionId) {
    const id = this.#nextId++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    this.#write(JSON.stringify(payload));
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject, method });
      setTimeout(() => {
        if (!this.#pending.delete(id)) return;
        reject(new Error(`${method} timed out`));
      }, 30_000);
    });
  }

}

/* ------------------------------------------------------------------ checks */

/**
 * Rough luminance test for the colour strings getComputedStyle returns.
 * A fully transparent colour is not dark — it means nothing was painted.
 */
function isDark(colour) {
  const match = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?/.exec(colour || '');
  if (!match) return false;
  const [r, g, b, a = 1] = match.slice(1).map((n) => (n === undefined ? 1 : Number(n)));
  if (a < 0.5) return false;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.4;
}

/**
 * Each probe runs in the page and returns a plain object; the matching
 * `expect` turns it into pass/fail lines.
 */
const PAGES = [
  {
    name: 'content-script',
    url: ({ fixture }) => `${fixture}/fixture.md`,
    settle: 3000,
    shots: [
      { suffix: '-admonitions', anchor: '#admonitions' },
      { suffix: '-code', anchor: '#code-blocks' },
      { suffix: '-math', anchor: '#math' },
    ],
    probe: () => ({
      booted: !!document.querySelector('.mdl-root'),
      title: document.title,
      headings: document.querySelectorAll('.mdl-content h1, .mdl-content h2').length,
      outline: document.querySelectorAll('.mdl-toc nav a').length,
      codeBlocks: document.querySelectorAll('.mdl-code-block').length,
      highlighted: document.querySelectorAll('.mdl-content .hljs .hljs-keyword').length,
      copyButtons: document.querySelectorAll('.mdl-code-block button').length,
      frontMatter: document.querySelectorAll('.mdl-frontmatter-table tr').length,
      admonitions: document.querySelectorAll('.mdl-admonition').length,
      tasks: document.querySelectorAll('.mdl-content input[type=checkbox]').length,
      tables: document.querySelectorAll('.mdl-table-wrap table').length,
      math: document.querySelectorAll('.katex').length,
      diagrams: document.querySelectorAll('.mdl-diagram svg').length,
      footnotes: document.querySelectorAll('.footnotes li').length,
      emoji: document.querySelector('.mdl-content')?.textContent.includes('\u{1F680}'),
      details: document.querySelectorAll('.mdl-content details').length,
      theme: document.documentElement.dataset.mdlTheme,
      codeThemeHref: document.getElementById('mdl-css-code')?.getAttribute('href') || '',
      rawScript: !!document.querySelector('body > pre'),
      visibility: getComputedStyle(document.documentElement).visibility,
      prebootStyle: !!document.getElementById('mdl-preboot-hide'),
      firstHeadingBox: (() => {
        const h = document.querySelector('.mdl-content h1');
        if (!h) return null;
        const box = h.getBoundingClientRect();
        return { w: Math.round(box.width), h: Math.round(box.height) };
      })(),
      // What the clipboard would receive for a heading. The permalink marker
      // is decorative, so it must not come along for the ride.
      headingSelection: (() => {
        const h = document.querySelector('.mdl-content h2');
        if (!h) return '';
        const range = document.createRange();
        range.selectNode(h);
        const selection = getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        const text = selection.toString();
        selection.removeAllRanges();
        return text.trim();
      })(),
      // What Cmd+A → Cmd+C actually puts on the clipboard. Everything the
      // viewer adds around the document — outline, button labels — has to
      // stay out of it, so selecting the whole page must
      // yield exactly what selecting the document alone yields.
      chrome: {
        fileName: !!document.querySelector('.mdl-toolbar')?.textContent.includes('fixture.md'),
        footer: !!document.querySelector('.mdl-page > footer, .mdl-footer'),
      },
      selection: (() => {
        const take = (node) => {
          if (!node) return '';
          const range = document.createRange();
          range.selectNodeContents(node);
          const selection = getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
          const text = selection.toString();
          selection.removeAllRanges();
          return text.trim();
        };

        const whole = take(document.body);
        const content = take(document.querySelector('.mdl-page'));
        const furniture = ['.mdl-toolbar', '.mdl-toc', '.mdl-to-top']
          .filter((sel) => {
            const own = document.querySelector(sel)?.textContent.trim();
            return own && own.length > 2 && whole.includes(own);
          });

        return {
          whole,
          content,
          furniture,
          // A copied code block should be the code. The language caption and
          // the Copy button sit in the same wrapper and would otherwise be
          // pasted as two stray lines above it.
          codeBlock: take(document.querySelector('.mdl-code-block')),
          codeLang: document.querySelector('.mdl-code-lang')?.textContent || '',
        };
      })(),
    }),
    expect: (r) => [
      ['renders the shell', r.booted],
      ['reveals the page after booting', r.visibility === 'visible' && !r.prebootStyle],
      ['lays the content out', (r.firstHeadingBox?.w ?? 0) > 200 && (r.firstHeadingBox?.h ?? 0) > 20],
      ['uses the document title', r.title.includes('A tour of Markdown Lens')],
      ['replaces the plain-text source', !r.rawScript],
      ['applies a document theme', !!r.theme],
      ['loads a code theme stylesheet', r.codeThemeHref.startsWith('chrome-extension://') && r.codeThemeHref.includes('/hljs/')],
      ['builds the outline', r.outline >= 8],
      ['renders headings', r.headings >= 8],
      // Nine fences in the fixture, one of which becomes the diagram.
      ['renders every fence', r.codeBlocks === 8],
      ['highlights syntax', r.highlighted >= 10],
      ['adds copy buttons', r.copyButtons === 8],
      ['renders front matter', r.frontMatter >= 4],
      ['renders admonitions', r.admonitions === 3],
      ['renders task list items', r.tasks === 2],
      ['wraps tables', r.tables >= 1],
      ['typesets math', r.math >= 3],
      ['draws the diagram', r.diagrams === 1],
      ['renders footnotes', r.footnotes === 2],
      ['renders emoji', r.emoji === true],
      ['keeps inline HTML', r.details === 1],
      ['copies headings without the permalink marker',
        r.headingSelection.length > 0 && !r.headingSelection.startsWith('#')],
      ['selects the whole document', r.selection.whole.length > 500],
      ['selecting all copies the document and nothing else',
        r.selection.whole === r.selection.content],
      ['leaves the viewer\'s own furniture unselectable',
        r.selection.furniture.length === 0],
      // The page is the document alone: no file name in the toolbar and no
      // footer under the text.
      ['shows no file name in the toolbar', !r.chrome.fileName],
      ['shows no footer', !r.chrome.footer],
      ['copies code without its caption or Copy button',
        r.selection.codeBlock.length > 20
        && !r.selection.codeBlock.includes(r.selection.codeLang)
        && !r.selection.codeBlock.includes('Copy')],
    ],
  },
  {
    // A Markdown file is untrusted input: it arrives from the web and renders
    // into a page the extension controls. Nothing in test/hostile.md may
    // execute, and none of it may survive into the DOM.
    name: 'sanitiser',
    url: ({ fixture }) => `${fixture}/hostile.md`,
    settle: 3000,
    preload: () => {
      window.__fired = [];
      window.alert = (message) => window.__fired.push(String(message));
      window.confirm = window.alert;
      window.prompt = window.alert;
    },
    probe: () => {
      const article = document.querySelector('.mdl-content');
      const all = article ? [...article.querySelectorAll('*')] : [];
      const handlerAttrs = [];
      for (const node of all) {
        for (const attr of node.attributes) {
          if (/^on/i.test(attr.name)) handlerAttrs.push(`${node.localName}[${attr.name}]`);
        }
      }
      const hrefs = all
        .flatMap((n) => [n.getAttribute('href'), n.getAttribute('xlink:href')])
        .filter(Boolean);
      return {
        rendered: !!article,
        fired: window.__fired || [],
        scripts: article ? article.querySelectorAll('script').length : -1,
        styles: article ? article.querySelectorAll('style').length : -1,
        frames: article ? article.querySelectorAll('iframe, object, embed, base, form').length : -1,
        handlerAttrs,
        badHrefs: hrefs.filter((h) => /^(?:javascript|vbscript|data):/i.test(h.replace(/[\u0000- ]/g, ''))),
        // The benign tail of the document has to come through untouched.
        goodLink: !!article?.querySelector('a[href="https://baramsoft.com"]'),
        highlighted: article ? article.querySelectorAll('.hljs-string, .hljs-keyword').length : 0,
        tableCells: article ? article.querySelectorAll('td').length : 0,
        // This fixture carries TOML front matter, a format the store listing
        // advertises but no other pass exercises.
        frontMatterRows: document.querySelectorAll('.mdl-frontmatter-table tr').length,
        frontMatterText: document.querySelector('.mdl-frontmatter-table')?.textContent || '',
      };
    },
    expect: (r) => [
      ['renders the document at all', r.rendered],
      ['executes nothing', r.fired.length === 0],
      ['strips script elements', r.scripts === 0],
      ['strips style elements', r.styles === 0],
      ['strips framing and form elements', r.frames === 0],
      ['strips every event-handler attribute', r.handlerAttrs.length === 0],
      ['strips dangerous URL schemes', r.badHrefs.length === 0],
      ['keeps ordinary links', r.goodLink],
      ['still highlights code', r.highlighted >= 2],
      ['still renders tables', r.tableCells >= 2],
      ['parses TOML front matter into a table', r.frontMatterRows >= 10],
      ['folds multi-line TOML arrays and keeps hashes inside strings',
        r.frontMatterText.includes('security, sanitising') && r.frontMatterText.includes('#f6f8fa')],
      ['reads TOML strings, numbers, booleans and dates',
        ['Hostile input fixture', 'Baram Soft', '42', '1.5', 'false', '2026-10-01']
          .every((text) => r.frontMatterText.includes(text))],
      ['reads TOML arrays and tables',
        r.frontMatterText.includes('security, sanitising') && r.frontMatterText.includes('depth: 2')],
      ['unescapes TOML strings', r.frontMatterText.includes('a "quoted" word')],
    ],
  },
  {
    // The copy button is an advertised feature and the only part of the viewer
    // that writes to the system clipboard. Line numbers are switched on at the
    // same time, because the gutter sits inside the <pre> and must not end up
    // in the copied text.
    name: 'copy-button',
    url: ({ fixture }) => `${fixture}/fixture.md`,
    settle: 3000,
    seed: { lineNumbers: true },
    permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'],
    clicks: ['.mdl-code-block .mdl-copy'],
    probe: async () => {
      const button = document.querySelector('.mdl-code-block .mdl-copy');
      const code = document.querySelector('.mdl-code-block pre code');
      let clipboard = '';
      try {
        clipboard = await navigator.clipboard.readText();
      } catch (error) {
        clipboard = `__unreadable__ ${error.name}`;
      }
      return {
        clipboard,
        expected: code?.textContent ?? '',
        label: button?.textContent || '',
        done: !!button?.classList.contains('is-done'),
        gutters: document.querySelectorAll('.mdl-code-block pre.has-gutter .mdl-gutter').length,
        gutterText: document.querySelector('.mdl-gutter')?.textContent || '',
      };
    },
    expect: (r) => [
      ['renders the line-number gutter', r.gutters >= 1 && r.gutterText.startsWith('1')],
      ['writes the code to the clipboard', r.clipboard.length > 0 && r.clipboard === r.expected],
      ['keeps line numbers out of the copied text', !/^\s*1\s*2\s*3/.test(r.clipboard)],
      ['confirms the copy in the button', r.done && /cop/i.test(r.label)],
    ],
  },
  {
    // "Show the document outline" switched off in Settings must keep the
    // sidebar off the page, with the toolbar still showing.
    name: 'outline-off',
    url: ({ fixture }) => `${fixture}/fixture.md`,
    settle: 2500,
    seed: { toc: false, showToolbar: true },
    // Pressing O used to switch the outline straight back on.
    keys: ['o'],
    probe: () => {
      const main = document.querySelector('.mdl-main');
      const range = document.createRange();
      range.selectNodeContents(document.body);
      return {
        toc: !!document.querySelector('.mdl-toc, .mdl-toc-nav, .mdl-toc-link'),
        outlineButton: !!document.querySelector('.mdl-toolbar button[aria-label="Outline"]'),
        mainOffset: main ? parseFloat(getComputedStyle(main).marginLeft) : -1,
        toolbar: !!document.querySelector('.mdl-toolbar') && getComputedStyle(document.querySelector('.mdl-toolbar')).display !== 'none',
        pageText: range.toString(),
      };
    },
    expect: (r) => [
      ['keeps the toolbar', r.toolbar],
      ['leaves no outline in the page', !r.toc],
      ['leaves no outline button', !r.outlineButton],
      ['leaves no outline text to copy', !r.pageText.includes('OUTLINE') && !/\bOutline\b/.test(r.pageText)],
      ['gives the text the full width', r.mainOffset === 0],
    ],
  },
  {
    // The same switch flipped while the document is already open.
    name: 'outline-off-live',
    url: ({ fixture }) => `${fixture}/fixture.md`,
    settle: 2500,
    liveSeed: { toc: false },
    // Pressing O used to switch the outline straight back on.
    keys: ['o'],
    probe: () => {
      const main = document.querySelector('.mdl-main');
      const range = document.createRange();
      range.selectNodeContents(document.body);
      return {
        toc: !!document.querySelector('.mdl-toc, .mdl-toc-nav, .mdl-toc-link'),
        outlineButton: !!document.querySelector('.mdl-toolbar button[aria-label="Outline"]'),
        mainOffset: main ? parseFloat(getComputedStyle(main).marginLeft) : -1,
        toolbar: !!document.querySelector('.mdl-toolbar') && getComputedStyle(document.querySelector('.mdl-toolbar')).display !== 'none',
        pageText: range.toString(),
      };
    },
    expect: (r) => [
      ['keeps the toolbar', r.toolbar],
      ['leaves no outline in the page', !r.toc],
      ['leaves no outline button', !r.outlineButton],
      ['leaves no outline text to copy', !r.pageText.includes('OUTLINE') && !/\bOutline\b/.test(r.pageText)],
      ['gives the text the full width', r.mainOffset === 0],
    ],
  },
  {
    // Switching the outline back on with the document open has to rebuild it,
    // since switching it off removed it from the page.
    name: 'outline-back-on',
    url: ({ fixture }) => `${fixture}/fixture.md`,
    settle: 2500,
    seed: { toc: false },
    liveSeed: { toc: true },
    probe: () => ({
      links: document.querySelectorAll('.mdl-toc .mdl-toc-link').length,
      button: !!document.querySelector('.mdl-toolbar button[aria-label="Outline"]'),
      open: !!document.querySelector('.mdl-root.mdl-toc-open'),
    }),
    expect: (r) => [
      ['rebuilds the outline', r.links >= 8],
      ['brings the outline button back', r.button],
      ['opens the outline', r.open],
    ],
  },
  {
    // Dragging a slider fires an input event per step. Chrome's synced storage
    // takes 120 writes a minute, so a few drags used to exhaust it and every
    // later change — the outline switch included — was silently dropped while
    // the Settings page went on showing it as saved.
    name: 'settings-burst',
    url: ({ ext }) => `${ext}/options.html`,
    settle: 1500,
    actions: [
      {
        expression: `(() => {
          const range = document.querySelector('[data-setting="contentWidth"]');
          for (let i = 0; i < 200; i++) {
            range.value = String(560 + (i % 40) * 20);
            range.dispatchEvent(new Event('input', { bubbles: true }));
          }
          const toc = document.querySelector('[data-setting="toc"]');
          toc.checked = false;
          toc.dispatchEvent(new Event('change', { bubbles: true }));
        })()`,
        wait: 1500,
      },
    ],
    probe: async () => {
      const stored = await chrome.storage.sync.get(['toc', 'contentWidth']);
      return {
        toc: stored.toc,
        contentWidth: stored.contentWidth,
        shown: Number(document.querySelector('[data-setting="contentWidth"]').value),
      };
    },
    expect: (r) => [
      ['saves a switch flipped after dragging a slider', r.toc === false],
      ['saves where the slider was left', r.contentWidth === r.shown],
    ],
  },
  {
    // Same document again, flipped to dark with the keyboard shortcut. This is
    // the headline feature, so it gets its own pass rather than an assertion
    // tacked onto the end of the one above.
    name: 'content-script-dark',
    url: ({ fixture }) => `${fixture}/fixture.md`,
    settle: 3000,
    keys: ['d'],
    settleAfterKeys: 2000,
    shots: [{ suffix: '-code', anchor: '#code-blocks' }],
    probe: () => ({
      scheme: document.documentElement.dataset.mdlScheme,
      theme: document.documentElement.dataset.mdlTheme,
      colorScheme: document.documentElement.style.colorScheme,
      codeThemeHref: document.getElementById('mdl-css-code')?.getAttribute('href') || '',
      background: getComputedStyle(document.body).backgroundColor,
      diagramFill: (() => {
        const node = document.querySelector('.mdl-diagram svg .node rect, .mdl-diagram svg rect');
        return node ? getComputedStyle(node).fill : '';
      })(),
      stillHighlighted: document.querySelectorAll('.mdl-content .hljs .hljs-keyword').length,
      diagrams: document.querySelectorAll('.mdl-diagram svg').length,
    }),
    expect: (r) => [
      ['switches to the dark scheme', r.scheme === 'dark'],
      ['switches to the paired dark theme', r.theme === 'github-dark'],
      ['tells the browser about it', r.colorScheme === 'dark'],
      ['swaps the code stylesheet', r.codeThemeHref.includes('/hljs/github-dark.min.css')],
      ['paints a dark background', isDark(r.background)],
      ['keeps the highlighting', r.stillHighlighted >= 10],
      ['re-renders the diagram', r.diagrams === 1],
      ['rethemes the diagram', r.diagramFill !== '' && isDark(r.diagramFill)],
    ],
  },
  {
    // Drives the toolbar's code-theme picker the way a reader would: open it,
    // type a filter, click a result, and check the stylesheet actually changed.
    name: 'code-theme-picker',
    url: ({ fixture }) => `${fixture}/fixture.md`,
    settle: 3000,
    actions: [
      { expression: `document.querySelector('[aria-label="Code theme"]').click()`, wait: 400 },
      { expression: `(() => {
          const input = document.querySelector('.mdl-menu-code .mdl-menu-input');
          input.value = 'monokai';
          input.dispatchEvent(new Event('input', { bubbles: true }));
        })()`, wait: 300 },
    ],
    probe: () => {
      const menu = document.querySelector('.mdl-menu-code');
      const visible = [...menu.querySelectorAll('.mdl-menu-row')].filter((r) => !r.hidden);
      return {
        open: getComputedStyle(menu).display !== 'none',
        total: menu.querySelectorAll('.mdl-menu-row').length,
        matches: visible.map((r) => r.dataset.code),
        head: menu.querySelector('.mdl-menu-head')?.textContent || '',
        hasSearch: !!menu.querySelector('.mdl-menu-input'),
        selected: [...menu.querySelectorAll('.is-selected')].map((r) => r.dataset.code),
      };
    },
    expect: (r) => [
      ['opens the picker', r.open],
      ['lists every code theme plus the two modes', r.total === 260],
      ['announces the count', /\b258\b/.test(r.head)],
      ['offers a filter box', r.hasSearch],
      ['filters down to matches', r.matches.length > 0 && r.matches.length < 20],
      ['matches by name and id', r.matches.every((id) => id.includes('monokai'))],
      ['marks the current mode', r.selected.includes('auto')],
    ],
  },
  {
    name: 'code-theme-applied',
    url: ({ fixture }) => `${fixture}/fixture.md`,
    settle: 3000,
    actions: [
      { expression: `document.querySelector('[aria-label="Code theme"]').click()`, wait: 400 },
      { expression: `document.querySelector('.mdl-menu-code [data-code="monokai"]').click()`, wait: 900 },
    ],
    shots: [{ suffix: '-code', anchor: '#code-blocks' }],
    probe: () => ({
      href: document.getElementById('mdl-css-code')?.getAttribute('href') || '',
      menuOpen: (() => {
        const menu = document.querySelector('.mdl-menu-code');
        return menu ? getComputedStyle(menu).display !== 'none' : false;
      })(),
      codeBackground: (() => {
        const pre = document.querySelector('.mdl-content pre.mdl-code');
        return pre ? getComputedStyle(pre).backgroundColor : '';
      })(),
      codeForeground: (() => {
        const code = document.querySelector('.mdl-content pre.mdl-code code');
        return code ? getComputedStyle(code).color : '';
      })(),
      documentTheme: document.documentElement.dataset.mdlTheme,
      pageBackground: getComputedStyle(document.body).backgroundColor,
    }),
    expect: (r) => [
      ['swaps to the chosen stylesheet', r.href.endsWith('/hljs/monokai.min.css')],
      ['closes the picker', !r.menuOpen],
      ['leaves the document theme alone', r.documentTheme === 'github-light'],
      ['keeps the page light', !isDark(r.pageBackground)],
      // A dark code theme on a light page has to bring its own background,
      // otherwise its light foreground text lands on a light surface.
      ['keeps the code block readable', isDark(r.codeBackground) !== isDark(r.codeForeground)],
    ],
  },
  {
    name: 'options',
    url: ({ ext }) => `${ext}/options.html`,
    settle: 2500,
    probe: () => ({
      cards: document.querySelectorAll('.card').length,
      controls: document.querySelectorAll('[data-setting]').length,
      themeOptions: document.querySelector('[data-setting="theme"]')?.options.length || 0,
      codeThemeOptions: document.querySelector('[data-setting="codeTheme"]')?.options.length || 0,
      fontOptions: document.querySelector('[data-setting="font"]')?.options.length || 0,
      pairs: ['themeLight', 'themeDark', 'codeThemeLight', 'codeThemeDark']
        .map((key) => [key, document.querySelector(`[data-setting="${key}"]`)?.value ?? '']),
      preview: document.querySelectorAll('#preview .mdl-code-block').length,
      previewHighlighted: document.querySelectorAll('#preview .hljs-keyword').length,
      support: [...document.querySelectorAll('a')].some((a) => a.href.startsWith('https://baramsoft.com/support')),
      privacy: [...document.querySelectorAll('a')].some((a) => a.href === 'https://baramsoft.com/privacy-markdownlens/'),
    }),
    expect: (r) => [
      ['renders the settings cards', r.cards >= 6],
      ['binds the controls', r.controls >= 25],
      ['lists the document themes', r.themeOptions >= 20],
      ['lists the code themes', r.codeThemeOptions >= 100],
      ['lists the fonts', r.fontOptions >= 5],
      // An empty pair select means the default is not in its light/dark group.
      ['resolves every light/dark pair', r.pairs.every(([, value]) => value !== '')],
      ['renders the live preview', r.preview >= 1],
      ['highlights inside the preview', r.previewHighlighted >= 1],
      ['links to support', r.support],
      // The store holds the listing to its privacy policy URL, so the page it
      // points at has to stay reachable from inside the extension too.
      ['links to the privacy policy', r.privacy],
    ],
  },
  {
    name: 'popup',
    url: ({ ext }) => `${ext}/popup.html`,
    settle: 1500,
    viewport: { width: 320, height: 520 },
    probe: () => ({
      width: document.body.scrollWidth,
      selects: document.querySelectorAll('select').length,
      switches: document.querySelectorAll('input[type=checkbox]').length,
      buttons: document.querySelectorAll('button').length,
      themeOptions: document.querySelector('[data-setting="theme"]')?.options.length || 0,
    }),
    expect: (r) => [
      ['fits the popup width', r.width <= 320],
      ['offers the theme pickers', r.selects >= 2 && r.themeOptions >= 20],
      ['offers the quick toggles', r.switches >= 3],
      ['offers the actions', r.buttons >= 3],
    ],
  },
  {
    name: 'welcome',
    url: ({ ext }) => `${ext}/welcome.html`,
    settle: 1000,
    probe: () => ({
      steps: document.querySelectorAll('.steps li').length,
      shortcuts: document.querySelectorAll('kbd').length,
      sample: !!document.getElementById('open-sample'),
      fileState: document.getElementById('file-state')?.textContent || '',
      theme: document.documentElement.dataset.mdlTheme || '',
      support: [...document.querySelectorAll('a')].some((a) => a.href.startsWith('https://baramsoft.com/support')),
      privacy: [...document.querySelectorAll('a')].some((a) => a.href === 'https://baramsoft.com/privacy-markdownlens/'),
    }),
    expect: (r) => [
      ['explains the first-run steps', r.steps >= 3],
      ['documents the shortcuts', r.shortcuts >= 4],
      ['offers the sample document', r.sample],
      ['reports the file-access state', r.fileState.length > 0 && !r.fileState.includes('Checking')],
      ['themes itself like the viewer', !!r.theme],
      ['links to support', r.support],
      // The store holds the listing to its privacy policy URL, so the page it
      // points at has to stay reachable from inside the extension too.
      ['links to the privacy policy', r.privacy],
    ],
  },
  {
    name: 'viewer',
    url: ({ ext }) => `${ext}/viewer.html?sample=1`,
    settle: 2500,
    probe: () => ({
      booted: !!document.querySelector('.mdl-root'),
      codeBlocks: document.querySelectorAll('.mdl-code-block').length,
      picker: !!document.querySelector('input[type=file]'),
      outline: document.querySelectorAll('.mdl-toc nav a').length,
      footer: !!document.querySelector('.mdl-page > footer, .mdl-footer'),
    }),
    expect: (r) => [
      ['boots the sample document', r.booted],
      ['renders code', r.codeBlocks >= 1],
      ['keeps the file picker attached', r.picker],
      ['builds the outline', r.outline >= 2],
      ['shows no footer', !r.footer],
    ],
  },
];

/** Console noise that is not worth failing a build over. */
const IGNORED = [
  /Unchecked runtime\.lastError/i,
  /favicon/i,
  /ERR_FILE_NOT_FOUND.*favicon/i,
  // hostile.md deliberately points an <img> at a missing file: the image has
  // to fail for the stripped onerror handler to have had its chance to fire.
  /Failed to load resource.*\/x\)/,
];

/**
 * Settings are persisted, so a pass that changes the theme would otherwise
 * decide what the next pass sees. Clearing needs an extension context, which
 * is why it borrows a throwaway popup page.
 */
async function resetStorage(client, extUrl) {
  const { targetId } = await client.send('Target.createTarget', { url: `${extUrl}/popup.html` });
  const { sessionId } = await client.send('Target.attachToTarget', { targetId, flatten: true });
  await sleep(250);

  const { exceptionDetails } = await client.send('Runtime.evaluate', {
    expression: `Promise.all([
      chrome.storage.sync.clear(),
      chrome.storage.local.clear(),
      chrome.storage.session.clear(),
    ])`,
    awaitPromise: true,
  }, sessionId);

  await client.send('Target.closeTarget', { targetId });

  if (exceptionDetails) {
    throw new Error(`could not clear storage: ${exceptionDetails.exception?.description || exceptionDetails.text}`);
  }
}

/** Write preferences into synced storage, so a pass can boot with them set. */
async function seedSettings(client, extUrl, settings) {
  const { targetId } = await client.send('Target.createTarget', { url: `${extUrl}/popup.html` });
  const { sessionId } = await client.send('Target.attachToTarget', { targetId, flatten: true });
  await sleep(250);

  const { exceptionDetails } = await client.send('Runtime.evaluate', {
    expression: `chrome.storage.sync.set(${JSON.stringify(settings)})`,
    awaitPromise: true,
  }, sessionId);

  await client.send('Target.closeTarget', { targetId });
  if (exceptionDetails) {
    throw new Error(`could not seed settings: ${exceptionDetails.exception?.description || exceptionDetails.text}`);
  }
}

async function visit(client, page, urls) {
  const url = page.url(urls);
  const { targetId } = await client.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await client.send('Target.attachToTarget', { targetId, flatten: true });

  const problems = [];
  const off = client.on((message) => {
    if (message.sessionId !== sessionId) return;
    if (message.method === 'Runtime.exceptionThrown') {
      const d = message.params.exceptionDetails;
      problems.push(`uncaught: ${d.exception?.description || d.text}`);
    }
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      problems.push(`console.error: ${message.params.args.map((a) => a.description || a.value).join(' ')}`);
    }
    if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') {
      const { text, url } = message.params.entry;
      problems.push(`log: ${text}${url ? ` (${url})` : ''}`);
    }
  });

  const viewport = page.viewport || VIEWPORT;
  await client.send('Runtime.enable', {}, sessionId);
  await client.send('Log.enable', {}, sessionId);
  await client.send('Page.enable', {}, sessionId);
  await client.send('Emulation.setDeviceMetricsOverride',
    { ...viewport, deviceScaleFactor: 1, mobile: false }, sessionId);

  // Runs before any page script, so a payload that fires during rendering is
  // still caught. Used by the sanitiser pass to trap alert()/opener access.
  if (page.preload) {
    await client.send('Page.addScriptToEvaluateOnNewDocument',
      { source: `(${page.preload.toString()})()` }, sessionId);
  }

  await client.send('Page.navigate', { url }, sessionId);
  await sleep(page.settle);

  // Settings changed while the page is already open, the way a reader flips a
  // switch in Settings with a document sitting in another tab.
  if (page.liveSeed) {
    await seedSettings(client, urls.ext, page.liveSeed);
    await sleep(600);
  }

  for (const { expression, wait } of page.actions || []) {
    const { exceptionDetails } = await client.send('Runtime.evaluate', { expression }, sessionId);
    if (exceptionDetails) {
      problems.push(`action failed: ${exceptionDetails.exception?.description || exceptionDetails.text}`);
    }
    await sleep(wait ?? 300);
  }

  // A synthetic .click() is not a user gesture, and the clipboard API refuses
  // one. These go through the input pipeline, so the browser treats them as
  // real presses.
  for (const selector of page.clicks || []) {
    const { result } = await client.send('Runtime.evaluate', {
      expression: `(() => {
        const node = document.querySelector(${JSON.stringify(selector)});
        if (!node) return null;
        node.scrollIntoView({ block: 'center', behavior: 'instant' });
        const box = node.getBoundingClientRect();
        return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
      })()`,
      returnByValue: true,
    }, sessionId);

    if (!result?.value) {
      problems.push(`click target not found: ${selector}`);
      continue;
    }
    const { x, y } = result.value;
    const common = { x, y, button: 'left', clickCount: 1 };
    await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...common }, sessionId);
    await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...common }, sessionId);
    await sleep(600);
  }

  for (const key of page.keys || []) {
    const common = { key, code: `Key${key.toUpperCase()}`, windowsVirtualKeyCode: key.toUpperCase().charCodeAt(0) };
    await client.send('Input.dispatchKeyEvent', { type: 'keyDown', text: key, ...common }, sessionId);
    await client.send('Input.dispatchKeyEvent', { type: 'keyUp', ...common }, sessionId);
  }
  if (page.keys?.length) await sleep(page.settleAfterKeys ?? 1000);

  const { result, exceptionDetails } = await client.send('Runtime.evaluate', {
    expression: `(${page.probe.toString()})()`,
    returnByValue: true,
    awaitPromise: true,
  }, sessionId);

  if (exceptionDetails) {
    problems.push(`probe failed: ${exceptionDetails.exception?.description || exceptionDetails.text}`);
  }

  for (const { suffix, anchor } of [{ suffix: '' }, ...(page.shots || [])]) {
    if (anchor) {
      await client.send('Runtime.evaluate', {
        // 'instant' matters: the viewer sets scroll-behavior: smooth, which
        // would still be animating when the screenshot is taken.
        expression: `document.querySelector(${JSON.stringify(anchor)})?.scrollIntoView({ block: 'start', behavior: 'instant' })`,
      }, sessionId);
      await sleep(500);
    }
    const shot = await client.send('Page.captureScreenshot', { format: 'png' }, sessionId);
    await writeFile(path.join(SHOTS, `${page.name}${suffix}.png`), Buffer.from(shot.data, 'base64'));
  }

  off();
  await client.send('Target.closeTarget', { targetId });

  return {
    url,
    values: result?.value ?? {},
    problems: problems.filter((p) => !IGNORED.some((re) => re.test(p))),
  };
}

/* ------------------------------------------------------------ popup bridge */

/**
 * The popup talks to the rendered document over chrome.tabs.sendMessage, which
 * no single-page pass can reach: it needs a rendered tab and a popup alive at
 * the same time, with the document — not the popup — as the active tab.
 *
 * Opening the popup in its own tab makes it active, so the markdown tab is
 * re-activated and the popup reloaded; its init then queries the same active
 * tab a real toolbar popup would.
 */
async function checkPopupBridge(client, urls) {
  const problems = [];
  const targets = [];

  const open = async (url) => {
    const { targetId } = await client.send('Target.createTarget', { url });
    const { sessionId } = await client.send('Target.attachToTarget', { targetId, flatten: true });
    targets.push(targetId);
    return { targetId, sessionId };
  };

  const evaluate = async (sessionId, expression) => {
    const { result, exceptionDetails } = await client.send('Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise: true,
    }, sessionId);
    if (exceptionDetails) {
      problems.push(`popup-bridge: ${exceptionDetails.exception?.description || exceptionDetails.text}`);
    }
    return result?.value;
  };

  const doc = await open(`${urls.fixture}/fixture.md`);
  await sleep(3000);

  const popup = await open(`${urls.ext}/popup.html`);
  await client.send('Target.activateTarget', { targetId: doc.targetId });
  await client.send('Page.enable', {}, popup.sessionId);
  await client.send('Page.reload', {}, popup.sessionId);
  await sleep(1500);

  const detected = await evaluate(popup.sessionId, `({
    status: document.getElementById('status').textContent,
    active: document.getElementById('status').classList.contains('is-active'),
    disabled: [...document.querySelectorAll('.popup-actions .btn')].filter((b) => b.disabled).length,
  })`) || {};

  const before = await evaluate(doc.sessionId, `!document.querySelector('pre.mdl-raw')?.hidden`);

  // The popup closes its own window right after sending, so the click is fired
  // without awaiting it and the result is read from the document instead.
  await client.send('Runtime.evaluate', {
    expression: `document.getElementById('toggle-raw').click()`,
  }, popup.sessionId).catch(() => {});
  await sleep(1200);

  const after = await evaluate(doc.sessionId, `({
    raw: !document.querySelector('pre.mdl-raw')?.hidden,
    highlighted: (document.querySelector('pre.mdl-raw code')?.innerHTML || '').includes('hljs-'),
    articleHidden: !!document.querySelector('article.mdl-content')?.hidden,
  })`) || {};

  for (const targetId of targets) {
    await client.send('Target.closeTarget', { targetId }).catch(() => {});
  }

  return {
    values: { detected, before, after },
    problems,
    checks: [
      ['finds the rendered tab', detected.active === true],
      ['reports it in the status line', /rendering this tab/i.test(detected.status || '')],
      ['enables the actions', detected.disabled === 0],
      ['starts in rendered mode', before === false],
      ['switches the tab to source', after.raw === true],
      ['highlights the source', after.highlighted === true],
      ['hides the rendered article', after.articleHidden === true],
    ],
  };
}

/* -------------------------------------------------------------------- main */

/**
 * Reloading the extension orphans the content scripts already in a page, and
 * every `chrome.*` call then throws synchronously — which is why a trailing
 * `.catch()` used to miss it and leave an uncaught error on the page.
 *
 * This runs in Node rather than the browser because an extension cannot be
 * made to orphan itself on demand: `chrome.runtime.id` is read-only, and
 * unloading the extension mid-run would take the harness down with it. The
 * failure is pure logic, so a fake `chrome` reproduces it exactly.
 */
/**
 * Store-readiness checks, run against the sources rather than the browser.
 *
 * Everything here is something the Chrome Web Store enforces at upload time or
 * that silently degrades the listing. Finding out at upload is a slow way to
 * learn it, and some of these facts live in two files that drift apart quietly.
 */
function checkStoreReadiness() {
  const manifest = JSON.parse(readFileSync(path.join(ROOT, 'src', 'manifest.json'), 'utf8'));
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const checks = [];

  checks.push(['manifest and package versions agree', manifest.version === pkg.version]);
  checks.push([`name fits the 75-char limit (${manifest.name.length})`, manifest.name.length <= 75]);
  checks.push([`description fits the 132-char limit (${manifest.description.length})`,
    manifest.description.length > 0 && manifest.description.length <= 132]);
  checks.push(['points at the company site', manifest.homepage_url === 'https://baramsoft.com']);

  // An unknown top-level key is not an upload error — Chrome's own packer
  // ignores them silently — so nothing but a whitelist will catch a typo or a
  // key invented from memory.
  const KNOWN = new Set(['manifest_version', 'name', 'version', 'description', 'homepage_url',
    'minimum_chrome_version', 'icons', 'action', 'options_ui', 'background', 'permissions',
    'optional_permissions', 'host_permissions', 'optional_host_permissions', 'content_scripts',
    'web_accessible_resources', 'declarative_net_request', 'default_locale', 'commands']);
  const unknown = Object.keys(manifest).filter((key) => !KNOWN.has(key));
  checks.push([`declares no unrecognised manifest keys${unknown.length ? `: ${unknown}` : ''}`,
    unknown.length === 0]);

  // The content-type rule needs declarativeNetRequest response-header
  // conditions, which landed in Chrome 128. Advertising it to anyone older
  // would promise a feature that cannot work.
  const DNR_RESPONSE_HEADERS_SINCE = 128;
  const min = Number(manifest.minimum_chrome_version);
  checks.push([`minimum_chrome_version covers response-header rules (${min})`,
    min >= DNR_RESPONSE_HEADERS_SINCE]);

  const build = readFileSync(path.join(ROOT, 'scripts', 'build.mjs'), 'utf8');
  const target = build.match(/target:\s*\['chrome(\d+)'\]/)?.[1];
  checks.push([`build target matches the manifest minimum (chrome${target})`,
    Number(target) === min]);

  // Resolved against dist/ rather than the sources: these paths are what the
  // packed extension will actually resolve, so a copy step that missed a file
  // shows up here instead of in the store's review queue.
  for (const [size, file] of Object.entries(manifest.icons)) {
    const dim = pngSize(path.join(DIST, file));
    checks.push([`icon ${size} is ${size}×${size}`,
      dim !== null && dim.width === Number(size) && dim.height === Number(size)]);
  }

  const promo = pngSize(path.join(ROOT, 'store', 'promo-440x280.png'));
  checks.push(['promo tile is exactly 440×280',
    promo !== null && promo.width === 440 && promo.height === 280]);

  return checks;
}

/** Read a PNG's dimensions out of its IHDR chunk, or null if it is not there. */
function pngSize(file) {
  if (!existsSync(file)) return null;
  const buf = readFileSync(file);
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/**
 * The listing and the privacy policy promise that a document on someone
 * else's site is never re-requested on a timer. This holds the watcher to it.
 */
async function checkLiveReloadScope() {
  const { isLocalUrl, createWatcher } = await import(new URL('../src/app/watch.js', import.meta.url));
  const checks = [];

  for (const url of ['http://localhost:8000/a.md', 'http://127.0.0.1/a.md', 'http://[::1]:3000/a.md',
    'http://docs.localhost/a.md', 'file:///Users/me/a.md']) {
    checks.push([`treats ${url} as local`, isLocalUrl(url) === true]);
  }
  for (const url of ['https://raw.githubusercontent.com/x/y/main/README.md', 'http://localhost.example.com/a.md',
    'http://127.0.0.1.nip.io/a.md', 'http://192.168.1.10/a.md', 'not a url']) {
    checks.push([`treats ${url} as remote`, isLocalUrl(url) === false]);
  }

  // Run the watcher for real against a remote address and count requests.
  const originalFetch = globalThis.fetch;
  const originalDocument = globalThis.document;
  let requests = 0;
  globalThis.fetch = async () => { requests++; return new Response('changed'); };
  globalThis.document = { hidden: false };
  try {
    const remote = createWatcher({ url: 'https://example.com/a.md', interval: 400, enabled: true,
      current: () => 'same', onChange: async () => {} });
    remote.start();
    await sleep(1000);
    remote.stop();
    checks.push(['never polls a remote document', requests === 0]);

    const local = createWatcher({ url: 'http://localhost:8000/a.md', interval: 400, enabled: true,
      current: () => 'same', onChange: async () => {} });
    local.start();
    await sleep(1000);
    local.stop();
    checks.push(['polls a local one', requests >= 1]);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.document = originalDocument;
  }
  return checks;
}

async function checkOrphanedContext() {
  const { extensionAlive, guard, guardSync } =
    await import(new URL('../src/common/runtime.js', import.meta.url));

  const invalidated = () => { throw new Error('Extension context invalidated.'); };
  const checks = [];
  const original = globalThis.chrome;

  try {
    globalThis.chrome = { runtime: { id: 'abc' }, storage: { session: { set: async () => 'written' } } };
    checks.push(['sees a loaded extension', extensionAlive() === true]);
    checks.push(['passes a successful call through',
      await guard(() => chrome.storage.session.set()) === 'written']);
    checks.push(['passes a successful sync call through', guardSync(() => 42) === 42]);

    globalThis.chrome = { runtime: {}, storage: { session: { set: invalidated } } };
    checks.push(['sees an unloaded extension', extensionAlive() === false]);
    checks.push(['swallows the synchronous throw',
      await guard(() => chrome.storage.session.set()) === undefined]);
    checks.push(['returns the fallback instead', await guard(invalidated, 'fb') === 'fb']);
    checks.push(['swallows it for sync calls too', guardSync(invalidated, null) === null]);

    // The shape that caused the reported crash, kept as the thing not to do.
    let threw = false;
    try { chrome.storage.session.set({}).catch(() => {}); } catch { threw = true; }
    checks.push(['confirms a bare .catch() cannot catch it', threw === true]);

    globalThis.chrome = { runtime: { id: 'abc' },
      storage: { session: { set: async () => { throw new Error('closed'); } } } };
    checks.push(['catches a call that fails in flight',
      await guard(() => chrome.storage.session.set()) === undefined]);

    globalThis.chrome = undefined;
    checks.push(['copes with no chrome object at all', extensionAlive() === false]);
    checks.push(['guards a call with no chrome object',
      await guard(() => chrome.anything()) === undefined]);
  } finally {
    globalThis.chrome = original;
  }

  return checks;
}

async function main() {
  if (!existsSync(DIST)) throw new Error('dist/ not found. Run `npm run build` first.');
  if (!existsSync(CHROME)) throw new Error(`Chrome not found at ${CHROME}. Set CHROME_PATH.`);

  await mkdir(SHOTS, { recursive: true });

  let failures = 0;

  // These need no browser, and a failure in either is worth knowing about
  // before spending a minute on the browser passes.
  console.log('store-readiness');
  for (const [label, ok] of checkStoreReadiness()) {
    if (!ok) failures++;
    console.log(`  ${ok ? '✓' : '✗'} ${label}`);
  }
  console.log();

  console.log('live-reload-scope');
  for (const [label, ok] of await checkLiveReloadScope()) {
    if (!ok) failures++;
    console.log(`  ${ok ? '✓' : '✗'} ${label}`);
  }
  console.log();

  console.log('orphaned-context');
  for (const [label, ok] of await checkOrphanedContext()) {
    if (!ok) failures++;
    console.log(`  ${ok ? '✓' : '✗'} ${label}`);
  }
  console.log();

  const { server, port } = await startFixtureServer();
  const { child, stderr } = await launchChrome();

  try {
    const client = Devtools.connect(child);
    const version = await client.send('Browser.getVersion');

    let id;
    try {
      ({ id } = await client.send('Extensions.loadUnpacked', { path: DIST }));
    } catch (error) {
      throw new Error(`could not install the extension: ${error.message}\n${stderr.join('')}`);
    }
    if (id !== extensionId(DIST)) {
      console.log(`  ! extension id ${id} (expected ${extensionId(DIST)})`);
    }

    const urls = {
      fixture: `http://127.0.0.1:${port}`,
      ext: `chrome-extension://${id}`,
    };

    console.log(`Markdown Lens — smoke test (${version.product})\n`);

    for (const page of PAGES) {
      await resetStorage(client, urls.ext);
      if (page.seed) await seedSettings(client, urls.ext, page.seed);
      if (page.permissions) {
        await client.send('Browser.grantPermissions',
          { origin: urls.fixture, permissions: page.permissions });
      }

      const { values, problems } = await visit(client, page, urls);

      if (page.permissions) await client.send('Browser.resetPermissions');
      const checks = page.expect(values);

      console.log(`${page.name}`);
      for (const [label, ok] of checks) {
        if (!ok) failures++;
        console.log(`  ${ok ? '✓' : '✗'} ${label}`);
      }
      for (const problem of problems) {
        failures++;
        console.log(`  ✗ ${problem}`);
      }
      if (!checks.some(([, ok]) => !ok) && !problems.length) {
        console.log(`  → test/screenshots/${page.name}.png`);
      } else {
        console.log(`  values: ${JSON.stringify(values)}`);
      }
      console.log();
    }

    await resetStorage(client, urls.ext);
    const bridge = await checkPopupBridge(client, urls);
    console.log('popup-bridge');
    for (const [label, ok] of bridge.checks) {
      if (!ok) failures++;
      console.log(`  ${ok ? '✓' : '✗'} ${label}`);
    }
    for (const problem of bridge.problems) {
      failures++;
      console.log(`  ✗ ${problem}`);
    }
    if (bridge.checks.some(([, ok]) => !ok) || bridge.problems.length) {
      console.log(`  values: ${JSON.stringify(bridge.values)}`);
    }
    console.log();
  } finally {
    child.kill('SIGKILL');
    server.close();
    await rm(PROFILE, { recursive: true, force: true });
  }

  if (failures) {
    console.log(`${failures} check${failures === 1 ? '' : 's'} failed.`);
    process.exit(1);
  }
  console.log('All checks passed.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
