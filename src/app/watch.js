/**
 * Live reload.
 *
 * Polls the document's own URL and re-renders when the bytes change. Chrome
 * refuses same-origin fetches for `file://` documents, so the first failed
 * attempt disables polling permanently and the toolbar's reload button falls
 * back to a full page reload.
 */

const MIN_INTERVAL = 400;

export function createWatcher({ url, interval, enabled, current, onChange }) {
  let timer = null;
  let stopped = false;
  let supported = true;
  let inFlight = false;

  async function fetchOnce() {
    try {
      const response = await fetch(url, { cache: 'no-store', credentials: 'omit' });
      if (!response.ok) return null;
      return await response.text();
    } catch {
      supported = false;
      return null;
    }
  }

  async function tick() {
    if (stopped || inFlight || document.hidden) return;
    inFlight = true;
    try {
      const text = await fetchOnce();
      if (text != null && text !== current()) await onChange(text);
    } finally {
      inFlight = false;
    }
    if (!supported) stop();
  }

  function start() {
    if (!enabled || stopped) return;
    const delay = Math.max(MIN_INTERVAL, Number(interval) || 1500);
    timer = setInterval(tick, delay);
  }

  function stop() {
    stopped = true;
    if (timer) clearInterval(timer);
    timer = null;
  }

  return {
    start,
    stop,
    fetchOnce,
    get supported() { return supported; },
  };
}
