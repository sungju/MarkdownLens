/**
 * Document outline: builds the sidebar tree and keeps the active entry in sync
 * with the scroll position.
 */

const HEADING_SELECTOR = 'h1, h2, h3, h4, h5, h6';

/**
 * @param {HTMLElement} article rendered Markdown
 * @param {HTMLElement} nav     container to fill
 * @returns {{headings: HTMLElement[], destroy: () => void}}
 */
export function buildToc(article, nav) {
  nav.textContent = '';

  const headings = [...article.querySelectorAll(HEADING_SELECTOR)]
    .filter((h) => (h.textContent || '').trim().length > 0);

  if (headings.length < 2) {
    nav.closest('.mdl-toc')?.classList.add('mdl-toc-empty');
    return { headings: [], destroy() {} };
  }
  nav.closest('.mdl-toc')?.classList.remove('mdl-toc-empty');

  const minLevel = Math.min(...headings.map((h) => Number(h.tagName[1])));
  const list = document.createElement('ul');
  list.className = 'mdl-toc-list';

  const links = new Map();
  for (const heading of headings) {
    if (!heading.id) heading.id = `section-${links.size + 1}`;
    const level = Number(heading.tagName[1]) - minLevel;

    const item = document.createElement('li');
    item.className = `mdl-toc-item mdl-toc-l${Math.min(level, 4)}`;

    const link = document.createElement('a');
    link.href = `#${encodeURIComponent(heading.id)}`;
    link.className = 'mdl-toc-link';
    link.textContent = headingText(heading);
    link.title = link.textContent;
    link.addEventListener('click', (event) => {
      event.preventDefault();
      heading.scrollIntoView({ behavior: 'smooth', block: 'start' });
      history.replaceState(null, '', `#${encodeURIComponent(heading.id)}`);
      setActive(links, heading.id);
    });

    item.appendChild(link);
    list.appendChild(item);
    links.set(heading.id, link);
  }

  nav.appendChild(list);

  const destroy = observeHeadings(headings, links, nav);
  return { headings, destroy };
}

function headingText(heading) {
  const clone = heading.cloneNode(true);
  clone.querySelectorAll('.mdl-anchor').forEach((a) => a.remove());
  return (clone.textContent || '').trim();
}

function setActive(links, id) {
  for (const [key, link] of links) {
    link.classList.toggle('is-active', key === id);
  }
}

/**
 * Scroll spy. Tracks which headings are above the fold and highlights the last
 * one, which matches how a reader perceives "where am I".
 */
function observeHeadings(headings, links, nav) {
  const visible = new Set();

  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) visible.add(entry.target);
      else visible.delete(entry.target);
    }

    let current = null;
    if (visible.size) {
      current = headings.find((h) => visible.has(h));
    } else {
      // Nothing in the band: fall back to the last heading scrolled past.
      for (const heading of headings) {
        if (heading.getBoundingClientRect().top <= 120) current = heading;
        else break;
      }
    }
    if (!current) current = headings[0];
    setActive(links, current.id);
    scrollIntoView(nav, links.get(current.id));
  }, { rootMargin: '-80px 0px -70% 0px', threshold: 0 });

  headings.forEach((h) => observer.observe(h));
  return () => observer.disconnect();
}

function scrollIntoView(nav, link) {
  if (!link) return;
  const navBox = nav.getBoundingClientRect();
  const linkBox = link.getBoundingClientRect();
  if (linkBox.top < navBox.top + 8) {
    nav.scrollTop -= navBox.top + 8 - linkBox.top;
  } else if (linkBox.bottom > navBox.bottom - 8) {
    nav.scrollTop += linkBox.bottom - navBox.bottom + 8;
  }
}
