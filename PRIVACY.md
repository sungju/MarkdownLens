# Privacy Policy — Markdown Lens

_Last updated: 3 October 2026_

Markdown Lens does not collect, transmit, sell or share any data. There is no
analytics, no telemetry, no crash reporting and no remote code.

## What the extension stores

| Data | Where | Why |
| ---- | ----- | --- |
| Your settings (theme, fonts, layout, toggles) | `chrome.storage.sync` | So the viewer looks the same every time, and on your other signed-in Chrome profiles. |
| Custom CSS | `chrome.storage.local` | It can exceed the per-item size limit of synced storage, so it stays on the one machine. |
| Scroll position per document | `chrome.storage.session` | So reopening a document returns you to where you were. Cleared when Chrome closes. |

All three are Chrome's own storage areas on your device. Synced settings travel
through your Google account exactly like your bookmarks do; Baram Soft has no
access to them and operates no server for this extension.

## What the extension reads

The content script reads the text of a document only when it is going to render
it: a `file://` URL, a URL ending in a Markdown extension, or a page served as
`text/markdown`. That text is parsed and displayed in your browser and is never
sent anywhere.

If you turn on **Scan every page** in Settings, the extension also looks at
plain-text pages on other sites to decide whether they are Markdown. This is why
that option — and the related `text/markdown` content-type fix — asks for access
to all sites before it can be switched on. Both are off by default, and
revoking the permission turns them off again.

## Network access

The extension sends nothing anywhere and downloads no code. Every library,
every one of the 258 code themes, the KaTeX stylesheet and its fonts are
bundled inside the package, which is also why the download is larger than a
typical extension.

It only ever re-reads the document you are already viewing, from the same
address your browser already loaded it from, and only in two cases:

- when you press the **Reload** button;
- when **Reload automatically** is on (it is by default) and the document is
  served from your own computer — `localhost` or `127.0.0.1` — so a file you
  are editing updates as you save it. Documents on any other site are never
  re-read on a timer.

No cookies or credentials are sent with these requests.

## Children

The extension is suitable for all ages and collects nothing from anyone.

## Changes

Any change to this policy will be published with a new version of the extension
and dated at the top of this file.

## Contact

Questions or concerns: <https://baramsoft.com/support/>
