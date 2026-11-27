/**
 * Reading a document in another language, with Chrome's built-in Translator
 * API. The model runs on this computer, so the document's text goes nowhere:
 * the extension promises it makes no network requests of its own, and a
 * translation service would have broken that. Chrome does download a language
 * pack the first time a pair is used, which the privacy policy says.
 *
 * Text is translated in place, sentence by sentence where the markup allows
 * and run by run where it does not, so links, tables and heading anchors all
 * survive. Code, math and diagrams are left exactly as
 * written: a translated command or formula is a wrong one, and a rendered
 * document is often pasted somewhere it has to work.
 */

/**
 * Languages offered in the toolbar. Chrome supports more pairs than this, but
 * a list of every one is too long to scan; these cover most readers.
 * Whether a particular pair works is asked of Chrome when it is chosen.
 */
export const TARGET_LANGUAGES = [
  'en', 'ko', 'ja', 'zh', 'zh-Hant', 'es', 'fr', 'de', 'it', 'pt', 'ru',
  'ar', 'hi', 'vi', 'th', 'id', 'tr', 'nl', 'pl', 'uk', 'sv',
];

/** Everything inside these stays as written. */
const KEEP = [
  'pre', 'code', 'kbd', 'samp', 'var', 'script', 'style', 'svg', 'math',
  '.katex', '.mdl-diagram', '.mdl-code-block', '.mdl-code-bar',
  '.mdl-anchor', '[translate="no"]',
].join(', ');

const LETTER = /\p{L}/u;

/** The blocks a sentence lives in. */
const BLOCKS = 'p, li, h1, h2, h3, h4, h5, h6, td, th, dt, dd, figcaption, summary, caption';

/**
 * Markup that only styles words. A block holding nothing else is translated
 * as one sentence, at the cost of that styling: split at each bold word, a
 * sentence comes back as fragments in the wrong order, which is worse than
 * losing the bold. Links, code, math and sub/superscripts are not on the
 * list, so blocks holding them keep their markup and go run by run.
 */
const STYLE_ONLY = 'strong, em, b, i, u, mark, del, s, ins, small';

/** False on Chrome before the API shipped, and on pages that are not a secure context. */
export function translationAvailable() {
  return typeof globalThis.Translator === 'function';
}

/** "한국어 · Korean": the native name first, since that is what a reader looks for. */
export function languageLabel(code) {
  const native = displayName(code, code);
  const english = displayName(code, 'en');
  return native && english && native !== english ? `${native} · ${english}` : (english || code);
}

function displayName(code, locale) {
  try {
    const name = new Intl.DisplayNames([locale], { type: 'language' }).of(code);
    return name ? name.charAt(0).toLocaleUpperCase(locale) + name.slice(1) : '';
  } catch {
    return '';
  }
}

/** Primary subtags compared, except that the two Chinese scripts are different targets. */
function sameLanguage(a, b) {
  const norm = (code) => {
    const lower = String(code).toLowerCase();
    if (lower === 'zh-hant' || lower === 'zh-tw' || lower === 'zh-hk') return 'zh-hant';
    return lower.split('-')[0];
  };
  return norm(a) === norm(b);
}

/**
 * @param {HTMLElement} article the rendered document
 * @param {object} hooks
 * @param {(status: {state: string, text?: string}) => void} hooks.onStatus
 * @param {() => void} hooks.onApplied called when the article's text changed
 */
export function createTranslation(article, { onStatus, onApplied }) {
  let target = null;
  let run = 0;
  let originals = [];
  let kept = [];
  let detector = null;
  const translators = new Map();
  const cache = new Map();

  function textNodes() {
    const nodes = [];
    const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!LETTER.test(node.nodeValue)) return NodeFilter.FILTER_REJECT;
        return node.parentElement?.closest(KEEP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      },
    });
    while (walker.nextNode()) nodes.push(walker.currentNode);
    return nodes;
  }

  /** What gets translated: whole simple blocks, and single runs elsewhere. */
  function units(nodes) {
    const list = [];
    const blocks = new Set();
    for (const node of nodes) {
      const block = node.parentElement?.closest(BLOCKS);
      if (block && article.contains(block) && isStyleOnly(block)) {
        if (!blocks.has(block)) {
          blocks.add(block);
          list.push({ block, text: block.textContent });
        }
      } else {
        list.push({ node, text: node.nodeValue });
      }
    }
    return list;
  }

  function isStyleOnly(block) {
    return [...block.querySelectorAll('*')].every((child) => child.matches(STYLE_ONLY));
  }

  function restore() {
    for (const [unit, saved] of originals) {
      if (unit.block) unit.block.replaceChildren(...saved);
      else unit.node.nodeValue = saved;
    }
    originals = [];
    for (const element of kept) element.removeAttribute('lang');
    kept = [];
    article.removeAttribute('lang');
  }

  /**
   * The article is now in the target language, but its code and formulas are
   * still in the source one. Saying so keeps a CJK font from redrawing code
   * comments in the wrong glyphs, and a screen reader from reading them in
   * the wrong voice.
   */
  function markLanguages(source) {
    article.setAttribute('lang', target);
    for (const element of article.querySelectorAll(KEEP)) {
      if (element.hasAttribute('lang') || element.parentElement.closest(KEEP)) continue;
      element.setAttribute('lang', source);
      kept.push(element);
    }
  }

  /**
   * A guess is worse than saying so: assumed to be English, a Korean document
   * would be fed to an English model, and a mixed one could be reported as
   * already in English with nothing translated.
   */
  async function detectSource(nodes) {
    const sample = nodes.map((node) => node.nodeValue).join(' ').slice(0, 4000);
    if (typeof globalThis.LanguageDetector !== 'function') throw new Error('undetected');
    detector ??= await globalThis.LanguageDetector.create();
    const [best] = await detector.detect(sample);
    if (!best || best.detectedLanguage === 'und' || best.confidence < 0.5) throw new Error('undetected');
    return best.detectedLanguage;
  }

  async function translatorFor(source, lang, isCurrent) {
    const key = `${source}>${lang}`;
    if (translators.has(key)) return translators.get(key);

    const availability = await globalThis.Translator.availability({ sourceLanguage: source, targetLanguage: lang });
    if (availability === 'unavailable') {
      throw Object.assign(new Error('unsupported'), { source });
    }
    const translator = await globalThis.Translator.create({
      sourceLanguage: source,
      targetLanguage: lang,
      monitor(monitor) {
        monitor.addEventListener('downloadprogress', (event) => {
          if (isCurrent()) onStatus({ state: 'busy', text: `Downloading ${Math.round(event.loaded * 100)}%` });
        });
      },
    });
    translators.set(key, translator);
    return translator;
  }

  /**
   * Translate into `lang`, or put the original back for null. A newer call,
   * or a re-render, cancels one still running.
   */
  async function setLanguage(lang) {
    const mine = ++run;
    const isCurrent = () => mine === run;
    target = lang || null;
    restore();

    if (!target) {
      onStatus({ state: 'idle' });
      onApplied();
      return;
    }

    const nodes = textNodes();
    if (!nodes.length) {
      onStatus({ state: 'idle' });
      return;
    }
    try {
      onStatus({ state: 'busy', text: 'Preparing…' });
      const source = await detectSource(nodes);
      if (!isCurrent()) return;
      if (sameLanguage(source, target)) {
        onStatus({ state: 'note', text: `Already in ${displayName(target, 'en') || target}` });
        onApplied();
        return;
      }

      const translator = await translatorFor(source, target, isCurrent);
      if (!isCurrent()) return;

      markLanguages(source);
      const work = units(nodes);
      for (let i = 0; i < work.length; i++) {
        const unit = work[i];
        const original = unit.text;
        // Leading and trailing spaces are what separate this run of text from
        // the link or emphasis beside it, and translators drop them.
        const [, lead, core, trail] = original.match(/^(\s*)([\s\S]*?)(\s*)$/);
        const key = `${source}>${target}\u0000${core}`;
        let translated = cache.get(key);
        if (translated === undefined) {
          translated = await translator.translate(core);
          if (!isCurrent()) return;
          cache.set(key, translated);
        }
        const text = `${lead}${translated}${trail}`;
        // It may have gone with a re-render while we waited.
        if (unit.block) {
          if (!unit.block.isConnected) continue;
          originals.push([unit, [...unit.block.childNodes]]);
          unit.block.replaceChildren(document.createTextNode(text));
        } else {
          if (!unit.node.isConnected) continue;
          originals.push([unit, original]);
          unit.node.nodeValue = text;
        }
        if (i % 20 === 0) onStatus({ state: 'busy', text: `Translating ${Math.round((i / work.length) * 100)}%` });
      }
      onStatus({ state: 'idle' });
      onApplied();
    } catch (error) {
      if (!isCurrent()) return;
      restore();
      onApplied();
      // Starting a download needs a recent click. On a first use the language
      // detector's own download outlasts the click, so the translation pack is
      // refused: one more click, on a button that says so, finishes the job.
      if (error?.name === 'NotAllowedError') onStatus({ state: 'retry', text: 'Click Continue to download' });
      else {
        // Forgotten, so live reload does not try again and fail again on
        // every save. The list box goes back to Original with it.
        const text = describe(error, target);
        target = null;
        onStatus({ state: 'error', text });
      }
    }
  }

  return {
    get language() { return target; },
    setLanguage,
    /**
     * The article was rebuilt (live reload, a setting that re-renders), so the
     * text is original again. Translate it anew into the same language; the
     * models are on hand by now, so no click is needed for it.
     */
    rerendered() {
      originals = [];
      kept = [];
      if (target) return setLanguage(target);
      return undefined;
    },
  };
}

function describe(error, target) {
  const to = displayName(target, 'en') || target;
  if (error?.message === 'undetected') return "Couldn't tell what language this is in";
  if (error?.message === 'unsupported') {
    const from = displayName(error.source, 'en') || error.source;
    return `Chrome can't translate ${from} to ${to}`;
  }
  console.warn('[Markdown Lens] translation failed:', error);
  return `Couldn't translate to ${to}`;
}
