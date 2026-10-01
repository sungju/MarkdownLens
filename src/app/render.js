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

function highlightCode(md, str, lang) {
  const language = (lang || '').trim().toLowerCase();

  if (NON_CODE_FENCES.has(language)) {
    const cls = language === 'mermaid' ? 'language-mermaid mdl-mermaid' : 'mdl-plain';
    return `<pre class="mdl-code"><code class="${cls}">${md.utils.escapeHtml(str)}</code></pre>`;
  }

  let body;
  let resolved = '';
  if (language && hljs.getLanguage(language)) {
    try {
      const result = hljs.highlight(str, { language, ignoreIllegals: true });
      body = result.value;
      resolved = result.language || language;
    } catch {
      body = md.utils.escapeHtml(str);
    }
  } else {
    body = md.utils.escapeHtml(str);
  }

  const label = resolved || language;
  const attr = label ? ` data-lang="${md.utils.escapeHtml(label)}"` : '';
  const codeClass = `hljs${label ? ` language-${md.utils.escapeHtml(label)}` : ''}`;
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

  md.use(deflist).use(sub).use(sup).use(mark).use(ins).use(abbr);

  if (settings.footnotes) md.use(footnote);
  if (settings.emoji) md.use(emoji);
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

  // Tables always get a wrapper so wide tables scroll instead of blowing out
  // the column width.
  md.renderer.rules.table_open = () => '<div class="mdl-table-wrap"><table>';
  md.renderer.rules.table_close = () => '</table></div>';

  return md;
}

const PURIFY_CONFIG = {
  USE_PROFILES: { html: true, svg: true, svgFilters: true, mathMl: true },
  ADD_TAGS: ['iframe-placeholder'],
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
