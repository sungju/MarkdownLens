/**
 * Survival kit for the orphaned content script.
 *
 * Reloading, updating or disabling the extension detaches every content
 * script already running in a page, but leaves the page itself untouched.
 * The `chrome` object stays in scope and still looks usable, yet
 * `chrome.runtime.id` has gone undefined and every API call now throws
 * "Extension context invalidated" — synchronously, before returning a
 * promise, so a trailing `.catch()` never sees it.
 *
 * A rendered document is perfectly readable without the extension behind it,
 * so the right response is to keep the page working and quietly stop talking
 * to a runtime that is no longer there. Pages bundled with the extension
 * (options, popup, viewer) are torn down along with it and never hit this;
 * only code injected into someone else's document can outlive its extension.
 */

/** @returns {boolean} true while the extension this script came from is loaded */
export function extensionAlive() {
  try {
    return Boolean(chrome?.runtime?.id);
  } catch {
    return false;
  }
}

/**
 * Call a `chrome.*` API, treating a dead extension as "no result" rather than
 * an error. Covers both failure modes: the synchronous throw on an already
 * orphaned context, and the rejection of a call that was still in flight when
 * the extension went away.
 *
 * @template T
 * @param {() => T | Promise<T>} fn    the call to attempt
 * @param {T} [fallback]               returned instead when it cannot be made
 * @returns {Promise<T|undefined>}
 */
export async function guard(fn, fallback) {
  if (!extensionAlive()) return fallback;
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

/**
 * The synchronous form, for APIs that return a value rather than a promise.
 *
 * @template T
 * @param {() => T} fn
 * @param {T} [fallback]
 * @returns {T|undefined}
 */
export function guardSync(fn, fallback) {
  if (!extensionAlive()) return fallback;
  try {
    return fn();
  } catch {
    return fallback;
  }
}
