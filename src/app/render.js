/**
 * Markdown pipeline: front matter -> markdown-it -> highlight.js -> DOMPurify.
 */

import MarkdownIt from 'markdown-it';
import anchor from 'markdown-it-anchor';
import footnote from 'markdown-it-footnote';
import taskLists from 'markdown-it-task-lists';
import deflist from 'markdown-it-deflist';
import sub from 'markdown-it-sub';
import sup from 'markdown-it-sup';
import mark from 'markdown-it-mark';
import ins from 'markdown-it-ins';
import abbr from 'markdown-it-abbr';
import attrs from 'markdown-it-attrs';
import container from 'markdown-it-container';
import { full as emoji } from 'markdown-it-emoji';
import hljs from 'highlight.js/lib/common';
import DOMPurify from 'dompurify';
import { parseFrontMatter } from './frontmatter.js';
import { githubAlerts } from './alerts.js';

/** Fence languages that are rendered by something other than highlight.js. */
const NON_CODE_FENCES = new Set([
  'mermaid', 'math', 'katex', 'latex-math', 'plain', 'text', 'txt',
  'none', 'output', 'result', 'raw', 'ascii', 'chart',
]);

/** Admonition kinds exposed as `::: note` style containers. */
const ADMONITIONS = ['note', 'info', 'tip', 'success', 'warning', 'caution', 'danger', 'important', 'question', 'quote'];

let fullLanguagesLoaded = false;
let fullLanguagesPromise = null;

/**
 * highlight.js ships ~40 languages in its "common" bundle. The rest are pulled
 * in on first sight of an unknown fence language, which keeps the hot path
 * small for the overwhelmingly common case.
 */
async function ensureLanguages(source) {
  if (fullLanguagesLoaded) return;
  const wanted = new Set();
  const fence = /^[ \t]{0,3}(?:`{3,}|~{3,})[ \t]*([A-Za-z0-9_+#.-]+)/gm;
  let match;
  while ((match = fence.exec(source))) {
    const lang = match[1].toLowerCase();
    if (!NON_CODE_FENCES.has(lang)) wanted.add(lang);
  }
  const missing = [...wanted].some((lang) => !hljs.getLanguage(lang));
  if (!missing) return;

  fullLanguagesPromise ??= import('highlight.js').then(() => {
    fullLanguagesLoaded = true;
  });
  try {
    await fullLanguagesPromise;
  } catch (error) {
    console.warn('[Markdown Lens] extended language pack unavailable:', error);
  }
}

const MATH_PATTERN = /\$\$[\s\S]+?\$\$|\$[^\s$][^$\n]*\$|\\begin\{(?:equation|align|gather|cases|matrix|[pbvB]matrix|array|split|multline)\*?\}/;

/** Cheap pre-check so documents without math never pay for KaTeX. */
function hasMath(source) {
  return MATH_PATTERN.test(source);
}

function slugify(text) {
  return text
    .trim()
    .toLowerCase()
    .replace(/[ -⁯⸀-⹿'"`!"#$%&()*+,./:;<=>?@[\]\\^{|}~]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'section';
}

/**
 * Languages an untagged block may be guessed as. Auto-detection across every
 * registered language is slow and wild: short prose came back as CSS, a file
 * tree as Makefile. These are the ones READMEs actually leave untagged, and
 * each has enough distinctive syntax to be told apart from plain text.
 */
const GUESSABLE = [
  'json', 'yaml', 'python', 'javascript', 'typescript', 'go', 'rust', 'java',
  'c', 'cpp', 'csharp', 'ruby', 'php', 'sql', 'xml', 'swift', 'kotlin', 'diff',
];

/**
 * Below this relevance a guess is noise. Measured: real snippets of the
 * languages above scored 3 to 9, while prose, log lines and key = value pairs
 * scored 2 or less.
 */
const MIN_GUESS_RELEVANCE = 3;

/**
 * Shell commands score too low for the relevance floor (an `npm install` line
 * gets 1), yet they are the most common untagged block in a README. A block
 * whose first line is a prompt or a well-known command is taken as shell.
 */
const SHELL_LINE = /^\s*(?:[$#%] |(?:sudo|npm|npx|pnpm|yarn|bun|node|deno|git|gh|cd|ls|mkdir|rm|cp|mv|cat|echo|export|source|curl|wget|brew|apt|apt-get|dnf|yum|pip3?|pipx|python3?|uv|poetry|cargo|rustup|go|make|cmake|docker|kubectl|helm|ssh|scp|chmod|chown|tar|unzip|swift|xcodebuild|gem|bundle|composer|dotnet|java|mvn|gradle|\.\/[\w.-]+)(?:\s|$))/;

function guessLanguage(str) {
  const first = str.split('\n').find((line) => line.trim()) || '';
  if (SHELL_LINE.test(first)) return 'bash';
  const subset = GUESSABLE.filter((name) => hljs.getLanguage(name));
  const result = hljs.highlightAuto(str, subset);
  return result.language && result.relevance >= MIN_GUESS_RELEVANCE ? result.language : '';
}

function highlightCode(md, str, lang) {
  const language = (lang || '').trim().toLowerCase();

  if (NON_CODE_FENCES.has(language)) {
    const cls = language === 'mermaid' ? 'language-mermaid mdl-mermaid' : 'mdl-plain';
    return `<pre class="mdl-code"><code class="${cls}">${md.utils.escapeHtml(str)}</code></pre>`;
  }

  // An untagged block, or one tagged with a language highlight.js does not
  // know, gets a guess. The guess colours the code but is not shown as the
  // block's label: a wrong label reads as a claim, a wrong colour does not.
  const known = language && hljs.getLanguage(language);
  const target = known ? language : guessLanguage(str);

  let body;
  let resolved = '';
  if (target) {
    try {
      const result = hljs.highlight(str, { language: target, ignoreIllegals: true });
      body = result.value;
      resolved = result.language || target;
    } catch {
      body = md.utils.escapeHtml(str);
    }
  } else {
    body = md.utils.escapeHtml(str);
  }

  const label = known ? resolved || language : language;
  const classLang = resolved || language;
  const attr = label ? ` data-lang="${md.utils.escapeHtml(label)}"` : '';
  const codeClass = `hljs${classLang ? ` language-${md.utils.escapeHtml(classLang)}` : ''}`;
  return `<pre class="mdl-code"${attr}><code class="${codeClass}">${body}</code></pre>`;
}

/** Build a markdown-it instance for the current settings. */
export function createRenderer(settings) {
  const md = new MarkdownIt({
    html: true,
    xhtmlOut: false,
    breaks: Boolean(settings.breaks),
    linkify: Boolean(settings.linkify),
    typographer: Boolean(settings.typographer),
    langPrefix: 'language-',
    highlight: (str, lang) => highlightCode(md, str, lang),
  });

  // Any name ending in a country code passes for a bare host: setup.py,
  // README.md and install.sh all became links to somebody's domain. Only
  // written-out addresses, www. ones and e-mail addresses are linked. Not
  // "//name" either, which starts a comment as often as an address.
  md.linkify.set({ fuzzyLink: false });
  md.linkify.add('//', null);
  md.linkify.add('www.', {
    // www.conf and /var/www.example.com are files: the name has to stand by
    // itself, have a name between www. and its ending, and have a real ending.
    validate: (text, pos, self) => {
      const before = text[pos - 'www.'.length - 1];
      if (before && !/[\s([{<>"'“‘«*_~|,;（「『【〈《]/.test(before)) return 0;
      const host = new RegExp(`^(?:[\\p{L}\\p{N}-]+\\.)+(?:${self.re.src_tlds})(?![\\p{L}\\p{N}@_-]|\\.[\\p{L}\\p{N}])`, 'iu');
      if (!host.test(text.slice(pos))) return 0;
      return Math.max(0, self.testSchemaAt(`http://www.${text.slice(pos)}`, 'http:', 'http:'.length) - '//www.'.length);
    },
    normalize: (match) => {
      match.url = `http://${match.url}`;
    },
  });

  md.use(deflist).use(sub).use(sup).use(mark).use(ins).use(abbr);

  if (settings.footnotes) md.use(footnote);
  // Short names only. The emoticon shortcuts turned "load <3" into a heart and
  // a lone ":/" into a face.
  if (settings.emoji) md.use(emoji, { shortcuts: {} });
  if (settings.attrs) md.use(attrs);
  if (settings.taskLists) md.use(taskLists, { enabled: false, label: true });

  if (settings.anchors) {
    md.use(anchor, {
      level: [1, 2, 3, 4, 5, 6],
      slugify,
      tabIndex: false,
      permalink: anchor.permalink.linkInsideHeader({
        symbol: '#',
        placement: 'before',
        class: 'mdl-anchor',
        ariaHidden: true,
      }),
    });
  }

  for (const kind of ADMONITIONS) {
    md.use(container, kind, {
      render(tokens, idx) {
        const token = tokens[idx];
        if (token.nesting !== 1) return '</div>\n';
        const title = token.info.trim().slice(kind.length).trim();
        const heading = md.utils.escapeHtml(title || kind[0].toUpperCase() + kind.slice(1));
        return `<div class="mdl-admonition mdl-admonition-${kind}">`
          + `<p class="mdl-admonition-title">${heading}</p>`;
      },
    });
  }

  md.use(githubAlerts, ADMONITIONS);

  // Indented code blocks bypass the highlight option in markdown-it, so they
  // came out as bare <pre> with no colours, copy button or code styling.
  md.renderer.rules.code_block = (tokens, idx) => `${highlightCode(md, tokens[idx].content, '')}\n`;

  // Tables always get a wrapper so wide tables scroll instead of blowing out
  // the column width.
  md.renderer.rules.table_open = () => '<div class="mdl-table-wrap"><table>';
  md.renderer.rules.table_close = () => '</table></div>';

  return md;
}

const PURIFY_CONFIG = {
  USE_PROFILES: { html: true, svg: true, svgFilters: true, mathMl: true },
  // KaTeX keeps each formula's TeX in an annotation. Without these two the tag
  // was removed but not its text, which a screen reader then read after the
  // formula and no copier could tell from it. <annotation-xml> stays out: it
  // can hold HTML, and with it a mutation that gets past the sanitiser.
  ADD_TAGS: ['iframe-placeholder', 'semantics', 'annotation'],
  ADD_ATTR: ['target', 'rel', 'allowfullscreen', 'frameborder', 'start', 'reversed', 'align'],
  FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'base', 'form'],
  FORBID_ATTR: ['srcdoc', 'formaction', 'ping'],
  ALLOW_DATA_ATTR: true,
};

/**
 * Render Markdown to a sanitized HTML string.
 *
 * Returns the HTML plus the parsed front matter, so the caller can show it as
 * a metadata table.
 */
export async function renderMarkdown(source, settings) {
  const { body, data, raw: frontMatterRaw } = parseFrontMatter(source);

  await ensureLanguages(body);

  const md = createRenderer(settings);

  if (settings.math && hasMath(body)) {
    try {
      const { applyMath } = await import('../lazy/math.js');
      applyMath(md);
    } catch (error) {
      console.warn('[Markdown Lens] math rendering unavailable:', error);
    }
  }

  const dirty = md.render(body);
  const html = DOMPurify.sanitize(dirty, PURIFY_CONFIG);

  return { html, frontMatter: data, frontMatterRaw };
}

/** Syntax-highlight the Markdown source itself, for the "raw source" view. */
export async function highlightSource(source) {
  if (!hljs.getLanguage('markdown')) {
    try {
      await import('highlight.js');
      fullLanguagesLoaded = true;
    } catch { /* fall through to plain text */ }
  }
  try {
    return hljs.highlight(source, { language: 'markdown', ignoreIllegals: true }).value;
  } catch {
    return source.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  }
}
