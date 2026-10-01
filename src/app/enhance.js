/**
 * Post-render DOM decoration: code block chrome, line numbers, link policy and
 * heading permalinks.
 */

const COPY_IDLE = 'Copy';
const COPY_DONE = 'Copied';
const COPY_FAIL = 'Press ⌘C';

export function enhance(article, settings) {
  decorateCodeBlocks(article, settings);
  decorateLinks(article, settings);
  decorateHeadings(article);
  decorateTables(article);
}

/* ------------------------------------------------------------------ code */

function decorateCodeBlocks(article, settings) {
  for (const pre of article.querySelectorAll('pre.mdl-code')) {
    if (pre.parentElement?.classList.contains('mdl-code-block')) continue;

    const code = pre.querySelector('code');
    if (!code || code.classList.contains('mdl-mermaid')) continue;

    const wrapper = document.createElement('div');
    wrapper.className = 'mdl-code-block';
    pre.replaceWith(wrapper);

    const bar = document.createElement('div');
    bar.className = 'mdl-code-bar';

    const lang = pre.dataset.lang;
    if (lang) {
      const label = document.createElement('span');
      label.className = 'mdl-code-lang';
      label.textContent = lang;
      bar.appendChild(label);
    }

    if (settings.copyButtons) {
      bar.appendChild(makeCopyButton(() => code.textContent ?? ''));
    }

    if (bar.childElementCount) wrapper.appendChild(bar);
    wrapper.appendChild(pre);

    if (settings.lineNumbers) addGutter(pre, code);
  }
}

function makeCopyButton(getText) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'mdl-copy';
  button.textContent = COPY_IDLE;
  button.setAttribute('aria-label', 'Copy code to clipboard');

  button.addEventListener('click', async () => {
    const text = getText();
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch {
      ok = legacyCopy(text);
    }
    button.textContent = ok ? COPY_DONE : COPY_FAIL;
    button.classList.toggle('is-done', ok);
    setTimeout(() => {
      button.textContent = COPY_IDLE;
      button.classList.remove('is-done');
    }, 1600);
  });

  return button;
}

function legacyCopy(text) {
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.cssText = 'position:fixed;top:-1000px;opacity:0';
  document.body.appendChild(area);
  area.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  area.remove();
  return ok;
}

/**
 * Line numbers live in a separate gutter column rather than being interleaved
 * with the highlighted markup, because highlight.js spans routinely straddle
 * newlines.
 */
function addGutter(pre, code) {
  const text = (code.textContent ?? '').replace(/\n$/, '');
  const count = text.length ? text.split('\n').length : 1;
  const gutter = document.createElement('span');
  gutter.className = 'mdl-gutter';
  gutter.setAttribute('aria-hidden', 'true');
  gutter.textContent = Array.from({ length: count }, (_, i) => i + 1).join('\n');
  pre.classList.add('has-gutter');
  pre.insertBefore(gutter, pre.firstChild);
}

/* ----------------------------------------------------------------- links */

function decorateLinks(article, settings) {
  const here = location.href.split('#')[0];

  for (const link of article.querySelectorAll('a[href]')) {
    const href = link.getAttribute('href') || '';

    if (href.startsWith('#')) {
      link.classList.add('mdl-link-internal');
      link.addEventListener('click', (event) => {
        const id = decodeURIComponent(href.slice(1));
        const target = article.querySelector(`[id="${CSS.escape(id)}"]`);
        if (!target) return;
        event.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        history.replaceState(null, '', href);
      });
      continue;
    }

    let absolute;
    try {
      absolute = new URL(href, location.href);
    } catch {
      continue;
    }

    if (!/^https?:|^file:/.test(absolute.protocol)) {
      link.classList.add('mdl-link-external');
      continue;
    }

    const external = absolute.href.split('#')[0] !== here;
    if (external) link.classList.add('mdl-link-external');
    if (external && settings.openLinksInNewTab) {
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
    }
  }
}

/* -------------------------------------------------------------- headings */

function decorateHeadings(article) {
  for (const anchor of article.querySelectorAll('a.mdl-anchor')) {
    anchor.setAttribute('title', 'Copy link to this section');
    anchor.addEventListener('click', (event) => {
      event.preventDefault();
      const href = anchor.getAttribute('href') || '';
      const target = article.querySelector(`[id="${CSS.escape(decodeURIComponent(href.slice(1)))}"]`);
      target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      history.replaceState(null, '', href);
      navigator.clipboard?.writeText(location.href.split('#')[0] + href).catch(() => {});
      anchor.classList.add('is-copied');
      setTimeout(() => anchor.classList.remove('is-copied'), 1200);
    });
  }
}

/* ---------------------------------------------------------------- tables */

function decorateTables(article) {
  for (const wrap of article.querySelectorAll('.mdl-table-wrap')) {
    const update = () => {
      wrap.classList.toggle('is-scrollable', wrap.scrollWidth > wrap.clientWidth + 1);
    };
    update();
    new ResizeObserver(update).observe(wrap);
  }
}
