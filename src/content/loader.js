/**
 * Content script entry point.
 *
 * Runs at document_start on every file:// URL and on http(s) URLs with a
 * Markdown extension. It is deliberately tiny: it decides whether the page is
 * Markdown, hides the raw text to avoid a flash of unstyled source, and then
 * dynamically imports the real viewer bundle.
 */

const MD_EXTENSION = /\.(md|markdown|mdown|mkd|mkdn|mdwn|mdtxt|mdtext|rmd|qmd|ronn|apib)(?:$|[?#])/i;

const MD_CONTENT_TYPES = new Set([
  'text/markdown',
  'text/x-markdown',
  'text/x-web-markdown',
  'application/markdown',
  'application/x-markdown',
]);

const TEXT_CONTENT_TYPES = new Set([
  'text/plain',
  ...MD_CONTENT_TYPES,
]);

const HIDE_STYLE_ID = 'mdl-preboot-hide';

if (!window.__markdownLensBooted) {
  window.__markdownLensBooted = true;
  start();
}

function start() {
  const likely = MD_EXTENSION.test(location.pathname) || MD_EXTENSION.test(location.hash);
  if (likely) hideDocument();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => decide(likely), { once: true });
  } else {
    decide(likely);
  }
}

/**
 * Hide the raw text until the viewer has taken over. The style goes on the
 * document element rather than in <head>, because boot() empties the head and
 * would otherwise unhide the page midway through the swap.
 */
function hideDocument() {
  if (document.getElementById(HIDE_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = HIDE_STYLE_ID;
  style.textContent = ':root{visibility:hidden!important}';
  document.documentElement.appendChild(style);
}

function revealDocument() {
  document.getElementById(HIDE_STYLE_ID)?.remove();
}

async function decide(likelyByUrl) {
  const contentType = (document.contentType || '').toLowerCase();

  // Chrome renders text documents as <body><pre>…</pre></body>. Anything else
  // (an HTML page, a directory listing, an image) is none of our business.
  if (!TEXT_CONTENT_TYPES.has(contentType)) return revealDocument();

  const source = extractSource();
  if (source === null) return revealDocument();

  let settings;
  try {
    settings = await chrome.storage.sync.get(['enabled', 'scanAllPages']);
  } catch {
    settings = {};
  }
  if (settings.enabled === false) return revealDocument();

  const byContentType = MD_CONTENT_TYPES.has(contentType);
  const byScan = settings.scanAllPages === true && looksLikeMarkdown(source);
  if (!likelyByUrl && !byContentType && !byScan) return revealDocument();

  hideDocument();

  try {
    const url = chrome.runtime.getURL('app/main.js');
    const app = await import(url);
    await app.boot({ source, url: location.href, contentType });
    revealDocument();
  } catch (error) {
    console.error('[Markdown Lens] failed to render this document:', error);
    revealDocument();
  }
}

/** Pull the raw text out of Chrome's plain-text viewer. */
function extractSource() {
  const body = document.body;
  if (!body) return null;
  const only = body.children.length === 1 ? body.firstElementChild : null;
  if (only && only.tagName === 'PRE') return only.textContent ?? '';
  if (body.children.length === 0) return body.textContent ?? '';
  return null;
}

/**
 * Heuristic used only in "scan every page" mode: look for a few unambiguous
 * Markdown constructs so that plain log files are left alone.
 */
function looksLikeMarkdown(text) {
  const sample = text.slice(0, 50000);
  if (sample.trim().length < 16) return false;
  const signals = [
    /^#{1,6}\s+\S/m,            // ATX heading
    /^```/m,                    // fenced code
    /^\s*[-*+]\s+\S/m,          // bullet list
    /^\s*\d+\.\s+\S/m,          // ordered list
    /\[[^\]]+\]\([^)]+\)/,      // inline link
    /^\s*>\s+\S/m,              // block quote
    /^\|.+\|\s*$/m,             // table row
    /^[^\n]+\n[=-]{3,}\s*$/m,   // setext heading
  ];
  return signals.filter((re) => re.test(sample)).length >= 2;
}
