# Working on Markdown Lens

Orientation for anyone — human or assistant — picking this project up. The
README covers what the extension does, how to build it and where the files
live; this file covers the decisions behind it, which are the expensive part
to reconstruct from the code alone.

## Status

Version 1.0.0, **built and verified but not yet submitted** to the Chrome Web
Store. `main` is pushed to <https://github.com/sungju/MarkdownLens>.

The upload package is `releases/markdown-lens-1.0.0.zip`, rebuilt with
`npm run release`. `releases/` and `test/screenshots/` are both gitignored, so
after a fresh clone neither exists until you run `npm run release` and
`npm test` respectively.

Remaining to submit: upload the zip, paste the listing copy from `STORE.md`,
attach the five 1280×800 screenshots from `test/screenshots/` and the promo
tile from `store/`. Nothing in the code is blocking.

## House rules

- **The AI tooling's name appears nowhere in this repository** — not in code,
  comments, metadata, documentation or commit messages. This is a Baram Soft
  standard and it applies to the published repo and the published package.
  It is why this file is `AGENTS.md` and not the more conventional name.
- Comments explain *why*, not *what*. Match the density already in the file
  you are editing; most functions have a short block above them explaining the
  reasoning, and most non-obvious lines have a sentence.
- Commit messages are imperative mood, with a body explaining the reasoning
  rather than listing the diff. No attribution or trailer lines.
- `src/generated/` is written by the build. Never edit it by hand.

## Testing discipline

`npm test` is the whole suite: 123 checks across 13 lanes. Two run in Node
before Chrome starts (`store-readiness`, `orphaned-context`); the rest drive a
headless Chrome over the DevTools protocol.

**A new assertion must be shown to fail before it is trusted.** Break the thing
deliberately, confirm the check goes red, then restore. This caught a real
mistake during store preparation: Chrome's `--pack-extension` was accepting an
unverified manifest key, and a control run proved it accepts an entirely
invented key just as happily — so its acceptance had never been evidence of
anything. Assertions that have never failed are decoration.

`npm run serve` starts a local server for the two paths the harness cannot
reach, because they need switches only a human can flip in `chrome://extensions`:
file:// access and the scan-every-page / content-type opt-in. It serves
positive fixtures and negative controls (a log file, a borderline document)
with a before/after table for each.

## Decisions worth knowing

**Free, with no in-app purchase.** The Baram Soft standard is free-app-plus-IAP,
but Chrome Web Store payments shut down in 2021, so there is no store-native
purchase mechanism to wire up. Settings carries a Support link instead. This
waiver is specific to browser extensions.

**`minimum_chrome_version` is 128, not lower.** The content-type feature
rewrites `text/markdown` responses using declarativeNetRequest *response
header* conditions, which Chrome supports only from 128. On an older browser it
would fail silently while the listing advertised it. The esbuild target in
`scripts/build.mjs` must match; the `store-readiness` lane fails if the two
numbers disagree, because two places answering the same question differently is
how one of them ends up wrong.

**No `author` key in the manifest.** The string form is undocumented, and
Chrome's packer cannot tell you whether it is valid — it ignores unknown
top-level keys entirely. Rather than ship something unverified, the key is gone
(the store takes the publisher from the developer account anyway) and the
`store-readiness` lane whitelists the top-level keys Chrome actually defines,
so a typo or an invented key fails the build instead of shipping.

**Content scripts must survive the extension being reloaded.** When Chrome
updates or reloads an extension, content scripts already running in open pages
are orphaned: `chrome.runtime.id` becomes undefined and every `chrome.*` call
throws `Extension context invalidated.` **synchronously**, before returning a
promise — so a trailing `.catch()` never fires. This reached a user as a real
crash. Every `chrome.*` call on a content-script path now goes through
`guard` / `guardSync` / `extensionAlive` in `src/common/runtime.js`. If you add
a new one, guard it. Bundled pages (options, popup, viewer) die with the
extension and never hit this, so they do not need it.

**The viewer's own UI is excluded from text selections.** Select All reaches
the whole page, so without `user-select: none` on the toolbar, outline, footer,
menus, progress bar and code-block captions, a reader copying an article also
pastes the file name, the outline and every button label. The raw source view
and the front matter table are deliberately left selectable — both are the
document. The code-theme filter opts back in, since a field you cannot select
text in is broken.

**The privacy policy exists twice.** `PRIVACY.md` in the repo and
<https://baramsoft.com/privacy-markdownlens/> published on the site. The store
holds the listing to whichever it can read, so changing one means changing the
other. Nothing enforces this — the test only checks that the extension links to
the right address, not that the words still match.

**Assets.** Icons are rasterised by hand in `scripts/make-icons.mjs` with no
native dependencies. The 440×280 promo tile is screenshotted from a small HTML
page instead (`npm run promo`), because a promo tile is mostly type and
hand-rasterising a typeface is not worth it. Recent Chrome does not exit after
writing a screenshot, so that script waits for the file to stop growing rather
than waiting on the process — waiting on the process hangs forever.

## Known wart

The first commit's message says "Twelve document themes"; there are 20. Every
shipped document is correct — the error is only in pushed history, so fixing it
would mean a force-push. Left alone deliberately.
