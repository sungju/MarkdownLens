# Working on Markdown Lens

Orientation for anyone — human or assistant — picking this project up. The
README covers what the extension does, how to build it and where the files
live; this file covers the decisions behind it, which are the expensive part
to reconstruct from the code alone.

## Status

Version 1.0.4, **built and verified but not yet submitted** to the Chrome Web
Store. Versions since 1.0.2 are under Sungju Kwon's own name. The
repository is <https://github.com/sungju/MarkdownLens>.

The upload package is `releases/markdown-lens-1.0.4.zip`, rebuilt with
`npm run release`. `releases/` and `test/screenshots/` are both gitignored, so
after a fresh clone neither exists until you run `npm run release` and
`npm test` respectively.

Remaining to submit: push `main`, because the privacy policy the listing points
at is the file on GitHub, then work through `UPLOAD.md` in the folder
`npm run store-kit` makes. Nothing in the code is blocking.

## House rules

- **The AI tooling's name appears nowhere in this repository** — not in code,
  comments, metadata, documentation or commit messages. The rule
  applies to the published repo and the published package. It is why this file
  is `AGENTS.md` and not the more conventional name.
- Comments explain *why*, not *what*. Match the density already in the file
  you are editing; most functions have a short block above them explaining the
  reasoning, and most non-obvious lines have a sentence.
- Commit messages are imperative mood, with a body explaining the reasoning
  rather than listing the diff. No attribution or trailer lines.
- `src/generated/` is written by the build. Never edit it by hand.

## Testing discipline

`npm test` is the whole suite: 167 checks across 20 lanes. Three run in
Node before Chrome starts (`store-readiness`, `live-reload-scope`,
`orphaned-context`); the rest drive a headless Chrome over the DevTools protocol.

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

**A personal product, free, with no in-app purchase.** Markdown Lens is
published by Sungju Kwon as an individual: no company name, site or address
appears in the package or the listing, and the website, support and privacy
links all point at the GitHub repository. Chrome Web Store payments shut down
in 2021, so there is no store-native purchase mechanism to wire up either.

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
the whole page, so without `user-select: none` on the toolbar, outline,
menus, progress bar and code-block captions, a reader copying an article also
pastes the outline and every button label. The raw source view
and the front matter table are deliberately left selectable — both are the
document. The code-theme filter opts back in, since a field you cannot select
text in is broken.

**"Show the document outline" is off by default, and off means no outline at
all.** The sidebar and
its toolbar button are removed from the page, not hidden, and neither the
button nor the `o` shortcut can turn the setting back on — only the switch in
Settings or the popup can. Readers turn it off to copy documents cleanly, so
nothing of the outline may survive in the page. The `outline-off` smoke passes
press `o` to prove it stays gone, and `outline-default` proves a fresh install
starts that way. Passes that need the outline, the store screenshots included,
seed `toc: true`.

**Synced settings are written through a throttle.** `chrome.storage.sync`
allows 120 writes a minute, and a Settings slider fires one input event per
step. Written straight through, a few drags exhausted the quota; later changes
were rejected inside `guard`, so Settings showed them as saved while open
documents never heard of them (the outline stayed up after being switched
off). `setSettings` now spaces synced writes 500 ms apart, merges what arrives
in between, and retries a rejected write. The `settings-burst` smoke pass
reproduces the original failure.

**The rendered page carries nothing but the document.** No file name in the
toolbar and no footer under the text: the browser tab already names the file,
and a footer of links on every document someone opens is the extension talking
over their content. The developer and Support links live in Settings
and the popup instead. The smoke suite fails if either comes back.

**Live reload only polls this machine.** `createWatcher` refuses any URL that
`isLocalUrl` does not accept (`localhost`, `127.x`, `::1`, `*.localhost`). It
used to poll every `http(s)` document every 1.5 s, while the listing said the
extension made no network requests: the kind of mismatch store review rejects
for. Documents on other sites are re-read only by the Reload button. The
listing and `PRIVACY.md` describe exactly this, so change all three together.

**The privacy policy is `PRIVACY.md` on `main`.** The store listing and the
extension's own pages link to the rendered file on GitHub, so there is one copy
and nothing to keep in step. It does mean the repository has to stay public,
the file has to keep its path, and an edit only counts once it is pushed.

**What is on the page is what people paste.** A rendered document is often
copied into a ticket, so text that would be wrong there is wrong here too:

- Only addresses that say they are one (`https://…`, `www.example.com`, an
  email) become links. Guessing turned `setup.py`, `README.md` and `install.sh`
  into links to real domains someone else owns, and a careless `www.` rule does
  the same to `www.conf` and `/var/www.example.com`.
- Emoji are read from `:short_names:` only. The plugin's emoticons turned `<3`
  and `:/` in technical text into pictures.
- An inline formula may not hold a bare `$` or a `"`, start with one of `?@#!*`,
  touch a word, or be followed by `(`, `@` or `#`. Money and shell variables are
  far more common than `x$a$y`, and losing their signs changes what a command
  means. Not every command is caught: `$$ … $$` on one
  line is still display math.
- The sanitiser keeps MathML `semantics` and `annotation`. Without them KaTeX's
  TeX stayed behind as stray text in the MathML, and there was nothing to copy
  a formula from. `annotation-xml` is an HTML integration point and stays out;
  `test/hostile.md` covers both.
- What the viewer adds around the text (line numbers, the outline, labels, the
  diagram error) is `user-select: none`, so a copy leaves it behind.

**GitHub alerts share the admonition boxes.** `> [!NOTE]` is how most Markdown
now writes one, and without it the marker showed up as text in a quote. A line
after the marker becomes the title, which GitHub itself does not do.

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
