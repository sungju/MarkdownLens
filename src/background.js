/**
 * Service worker.
 *
 * Three jobs: expose session storage to the viewer, manage the opt-in
 * "scan every page" content script, and (where Chrome supports it) rewrite
 * `Content-Type: text/markdown` to `text/plain` so Chrome renders those
 * documents instead of downloading them.
 */

const SCAN_SCRIPT_ID = 'mdl-scan-all';
const MARKDOWN_CT_RULE_ID = 1;

chrome.runtime.onInstalled.addListener(async (details) => {
  await enableSessionStorageForContentScripts();
  await syncOptionalFeatures();
  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') });
  }
});

chrome.runtime.onStartup.addListener(async () => {
  await enableSessionStorageForContentScripts();
  await syncOptionalFeatures();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && 'scanAllPages' in changes) syncOptionalFeatures();
});

chrome.permissions.onAdded.addListener(() => syncOptionalFeatures());
chrome.permissions.onRemoved.addListener(() => syncOptionalFeatures());

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'open-options') {
    chrome.runtime.openOptionsPage();
    sendResponse({ ok: true });
    return false;
  }
  if (message?.type === 'sync-features') {
    syncOptionalFeatures().then((result) => sendResponse(result));
    return true;
  }
  return false;
});

/** Content scripts cannot touch session storage unless we opt in here. */
async function enableSessionStorageForContentScripts() {
  try {
    await chrome.storage.session.setAccessLevel({
      accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS',
    });
  } catch { /* older Chrome: scroll memory simply does not persist */ }
}

async function hasBroadHostAccess() {
  try {
    return await chrome.permissions.contains({ origins: ['*://*/*'] });
  } catch {
    return false;
  }
}

/**
 * Keeps the optional pieces in step with the user's choices.
 * @returns {Promise<{scanning: boolean, contentTypeFix: boolean}>}
 */
async function syncOptionalFeatures() {
  const { scanAllPages } = await chrome.storage.sync.get('scanAllPages');
  const granted = await hasBroadHostAccess();
  const wanted = Boolean(scanAllPages) && granted;

  const scanning = await setScanScript(wanted);
  const contentTypeFix = await setContentTypeRule(granted);
  return { scanning, contentTypeFix };
}

async function setScanScript(enable) {
  try {
    const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [SCAN_SCRIPT_ID] });
    if (enable && !existing.length) {
      await chrome.scripting.registerContentScripts([{
        id: SCAN_SCRIPT_ID,
        js: ['content.js'],
        matches: ['*://*/*'],
        runAt: 'document_start',
        allFrames: false,
        persistAcrossSessions: true,
      }]);
    } else if (!enable && existing.length) {
      await chrome.scripting.unregisterContentScripts({ ids: [SCAN_SCRIPT_ID] });
    }
    return enable;
  } catch (error) {
    console.warn('[Markdown Lens] could not update the page scanner:', error);
    return false;
  }
}

/**
 * Chrome downloads `text/markdown` responses instead of displaying them.
 * Rewriting the header lets the viewer handle them. Response-header
 * conditions need Chrome 128+, so failure here is expected on older builds.
 */
async function setContentTypeRule(enable) {
  if (!chrome.declarativeNetRequest?.updateDynamicRules) return false;

  const allowed = enable && await chrome.permissions.contains({
    permissions: ['declarativeNetRequestWithHostAccess'],
  }).catch(() => false);

  try {
    if (!allowed) {
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: [MARKDOWN_CT_RULE_ID],
      });
      return false;
    }

    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [MARKDOWN_CT_RULE_ID],
      addRules: [{
        id: MARKDOWN_CT_RULE_ID,
        priority: 1,
        condition: {
          resourceTypes: ['main_frame'],
          responseHeaders: [{ header: 'content-type', values: ['text/markdown*', 'text/x-markdown*'] }],
        },
        action: {
          type: 'modifyHeaders',
          responseHeaders: [{ header: 'content-type', operation: 'set', value: 'text/plain; charset=utf-8' }],
        },
      }],
    });
    return true;
  } catch (error) {
    console.info('[Markdown Lens] content-type rewriting is not available on this Chrome version.');
    return false;
  }
}
