# Chrome Web Store listing — Markdown Lens

Copy for the developer dashboard. Not shipped in the package.

## Basics

- **Name:** Markdown Lens
- **Category:** Developer Tools (secondary: Productivity)
- **Language:** English
- **Price:** Free, no in-app purchases
- **Website:** https://baramsoft.com
- **Support URL:** https://baramsoft.com/support/
- **Privacy policy URL:** https://baramsoft.com/privacy-markdownlens/

## Short description (132 characters max)

The store shows the manifest's `description` as the summary, so this must
match `src/manifest.json` word for word; `npm run store-kit` refuses to build
if it does not.

> Render Markdown files beautifully in Chrome. 20 document themes, every
> highlight.js code theme, math, diagrams, and a live outline.

(131 characters.)

## Detailed description

> Markdown Lens turns any Markdown file into a properly typeset document — the
> moment you open it, with no upload and no round trip to a server.
>
> PICK A LOOK THAT SUITS YOU
> • 20 document themes: GitHub, Solarized, Nord, Dracula, One, Gruvbox, Tokyo
>   Night, Catppuccin, Rosé Pine, Sepia, Paper, Midnight and high-contrast
>   pairs, all in light and dark.
> • Every one of the 258 highlight.js code themes is bundled. Search them from
>   the toolbar and preview each one on your own code as you hover.
> • Let the code theme follow the document theme, set your own light/dark pair,
>   or pin one favourite. Press D to flip between light and dark at any time.
> • Choose the body font, the code font, text size, line height, content width
>   and paragraph spacing — or write your own CSS.
>
> EVERYTHING MARKDOWN CAN DO
> • Tables, task lists, footnotes, definition lists, abbreviations, subscript,
>   superscript, highlighted text and emoji.
> • Mathematics with KaTeX, including display equations and align environments.
> • Diagrams with Mermaid, recoloured when you switch themes.
> • Note, tip, warning, caution and danger callouts.
> • YAML, TOML and JSON front matter, shown as a tidy table.
>
> BUILT FOR READING
> • A sticky outline that follows your position, docked left or right.
> • Reading-progress bar, copy buttons on every code block, optional line
>   numbers, permalinks on headings.
> • Raw source view, syntax highlighted too.
> • Your scroll position is remembered. Printing works properly.
>
> PRIVATE BY DESIGN
> Markdown Lens makes no network requests at all. Every library, theme and font
> is inside the extension. Nothing is collected, nothing is transmitted, and
> there is no account to create.
>
> To read files from your own disk, turn on "Allow access to file URLs" on the
> extension's details page — Chrome keeps that off until you ask. Prefer not
> to? Drag a file onto the bundled viewer instead.
>
> Free software from Baram Soft. https://baramsoft.com

## Permission justifications

Paste these into the dashboard's permission-justification fields.

**storage**
> Saves the user's own display preferences (theme, fonts, layout, feature
> toggles) so documents render consistently, and syncs them across the user's
> signed-in Chrome profiles. No other data is stored.

**scripting**
> Registers and unregisters the optional "scan every page" content script at
> runtime, so that script only exists when the user has explicitly enabled the
> feature and granted the matching host permission.

**declarativeNetRequestWithHostAccess (optional)**
> Only requested if the user enables the content-type fix. Rewrites the
> Content-Type response header of documents served as text/markdown to
> text/plain, so Chrome displays them instead of downloading them. One static
> rule; no requests are blocked, redirected or inspected.

**Host permission `*://*/*` (optional)**
> Only requested if the user enables "scan every page" or the content-type fix.
> It lets the extension examine plain-text pages to decide whether they are
> Markdown. It is not requested at install time and revoking it disables both
> features.

**Content scripts on `file:///*` and `*://*/*.md` (and other Markdown
extensions)**
> Reads the text of a Markdown document in order to render it in place. The
> text never leaves the browser.

**Remote code**
> None. The extension executes no remote code; every script, stylesheet and
> font is bundled in the package.

**Data usage disclosures**
> Does not collect or use any of the listed data types. Certify all three:
> no selling to third parties, no use unrelated to the single purpose, no use
> for creditworthiness or lending.

## Single purpose statement

> Markdown Lens renders Markdown documents as formatted, themeable pages in the
> browser.

## Assets to prepare

| Asset | Size | Notes |
| ----- | ---- | ----- |
| Store icon | 128×128 PNG | `icons/icon-128.png` |
| Screenshot 1 | 1280×800 | A document in GitHub Light with the outline open — `test/screenshots/content-script.png` is the right composition. |
| Screenshot 2 | 1280×800 | The same document in GitHub Dark, scrolled to the code blocks — `content-script-dark-code.png`. |
| Screenshot 3 | 1280×800 | Math and the Mermaid diagram — `content-script-math.png`. |
| Screenshot 4 | 1280×800 | Settings with the live preview — `options.png`. |
| Screenshot 5 | 1280×800 | The code-theme picker open — `code-theme-picker.png`. |
| Small promo tile | 440×280 | `store/promo-440x280.png`. Optional, but needed to be considered for featuring. |

Run `npm test` to regenerate the screenshots. They are captured at 1280×800
and can be uploaded as they are. `test/screenshots/` is not committed, so the
test run is the only way to get them; the promo tile is committed and only
needs `npm run promo` if the branding changes.

Note that `popup.png` is 320×520 and is not a store screenshot — the store
rejects anything that is not 1280×800 or 640×400.

## Browser support

`minimum_chrome_version` is **128**. The binding constraint is the
content-type rule: rewriting `text/markdown` responses relies on
declarativeNetRequest *response header* conditions, which Chrome only
supports from 128. On an older browser that feature would fail silently
while the listing advertised it, so the manifest excludes those versions
rather than under-deliver. Chrome is well past 154, so in practice this
excludes nobody.

## Release checklist

1. Bump `version` in both `package.json` and `src/manifest.json`.
2. `npm test` — every check green.
3. `npm run release` — produces `releases/markdown-lens-<version>.zip`.
4. Update the listing copy above if features changed.
5. `npm run store-kit` — gathers the zip, screenshots, icon, promo tile and
   paste-ready text into `releases/store-kit-<version>/`, with an `UPLOAD.md`
   that maps each file to its dashboard field. Upload from there, submit.

### Dashboard fields that live outside this repo

- **Privacy policy URL** — <https://baramsoft.com/privacy-markdownlens/>.
  The dashboard requires one even though the extension collects nothing.
  That page is the published copy of `PRIVACY.md`; when one changes, change
  the other, because the store holds you to whichever it can read.
- **Support URL** — <https://baramsoft.com/support/>.
- **Category** — Developer Tools.
