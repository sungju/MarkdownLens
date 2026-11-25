# Markdown Lens

A fast, themeable Markdown viewer for Chrome. Open any `.md` file — local or on
the web — and it is rendered with real typography, an optional live outline, syntax
highlighting, math and diagrams.

Free software by [Sungju Kwon](https://github.com/sungju). No account, no
tracking, and nothing sent anywhere.

## Features

**Themes**

- 20 document themes (GitHub, Solarized, Nord, Dracula, One, Gruvbox, Tokyo
  Night, Catppuccin, Rosé Pine, Sepia, Paper, Midnight, high contrast, …), each
  available in light and dark.
- All 258 highlight.js code themes are bundled, searchable from the toolbar with
  a live preview as you hover.
- Code themes can follow the document theme automatically, follow your own
  light/dark pair, or be pinned to one specific theme.
- Everything follows the OS light/dark setting by default, and `d` flips it.

**Rendering**

- CommonMark plus tables, task lists, footnotes, definition lists,
  abbreviations, subscript, superscript, `==mark==`, `++ins++`, emoji and
  optional attribute syntax.
- Math with KaTeX (`$…$`, `$$…$$` and `\begin{align}` environments).
- Diagrams with Mermaid, rethemed when you switch between light and dark.
- Admonitions: `::: note`, `::: warning`, `::: danger` and seven more, and
  GitHub alerts such as `> [!WARNING]`.
- Addresses become links; file names such as `setup.py` do not. `$HOME` and `$5`
  stay text.
- YAML, TOML and JSON front matter, shown as a table or as raw source.
- Output is sanitised with DOMPurify.

**Reading**

- Optional sticky outline that tracks your position, dockable left or right.
  Off by default; switch it on in Settings or the popup.
- Reading-progress bar, copy buttons on code blocks, optional line numbers,
  permalinks on headings, horizontally scrollable tables.
- Raw source view, also syntax highlighted.
- Adjustable body and code font, text size, line height, content width and
  paragraph spacing, plus a custom CSS escape hatch.
- Scroll position is remembered per document; print stylesheet included.

**Keyboard shortcuts**

| Key       | Action                 |
| --------- | ---------------------- |
| `o`       | Open or close the outline (when it is switched on) |
| `r`       | Toggle the raw source  |
| `d`       | Light / dark           |
| `Shift+P` | Print                  |
| `g` / `G` | Top / bottom           |

## Install

From the Chrome Web Store, or from the source as described here.

### Local installation

You need [Node.js](https://nodejs.org) 20 or later, npm, and Chrome 128 or later.

1. Get the source and build it:

   ```bash
   git clone https://github.com/sungju/MarkdownLens.git
   cd MarkdownLens
   npm ci
   npm run build
   ```

   Without Git, choose **Code → Download ZIP** on
   [GitHub](https://github.com/sungju/MarkdownLens), unzip it, and run the two
   `npm` commands in the unzipped folder.

2. Open `chrome://extensions` and turn on **Developer mode** in the top right.
3. Click **Load unpacked** and select the `dist/` folder the build
   created.
4. To render local files, open the extension's **Details** page and turn on
   **Allow access to file URLs**. Chrome keeps that switch off for every
   extension until you ask for it. If you would rather not grant it, the bundled
   viewer (`viewer.html`) reads files you drag into it.
5. Open any `.md` file, or reload one that is already open.

Chrome runs the extension from that folder, so keep it where it is. If the Web
Store version is installed too, turn one of the two off; they are separate
extensions and do not share settings.

### Updating a local installation

In the folder you cloned:

```bash
git pull
npm ci
npm run build
```

From a ZIP, replace the source files with the new ones instead of `git pull`.
Then press the reload button on the extension's card at `chrome://extensions`,
and reload any Markdown pages that are open. Your settings are kept.

## Permissions

| Permission                           | Why                                                             |
| ------------------------------------ | --------------------------------------------------------------- |
| `storage`                            | Save your settings, and sync them between your own machines.    |
| `scripting`                          | Register the scanner used by the optional "every page" mode.    |
| `file:///*` content script           | Render Markdown files you open from disk.                       |
| `*://*/*.md` and friends             | Render Markdown files served over the web.                      |
| `*://*/*` (optional, off by default) | "Scan every page" mode and the `text/markdown` content-type fix. |

The broad host permission is never requested at install time. It is only
granted if you turn on one of those two options in Settings, and revoking it
turns them back off.

Nothing is ever sent anywhere. Every library, stylesheet and font is bundled
in the package — see [PRIVACY.md](PRIVACY.md).

## Development

```bash
npm run build          # development build with source maps → dist/
npm run watch          # rebuild on change
npm test               # headless Chrome end-to-end smoke test
npm run release        # minified build + releases/markdown-lens-<version>.zip
npm run serve          # local server for the manual checks the harness cannot do
npm run icons          # redraw the PNG icons
npm run promo          # redraw the 440×280 store promo tile
npm run id             # print the extension id Chrome derives from dist/
```

See [AGENTS.md](AGENTS.md) for the reasoning behind the project's less obvious
decisions, and the conventions to follow when changing them.

`npm test` installs `dist/` into a throwaway Chrome profile, serves
`test/fixture.md` over localhost, and checks the rendered DOM of the
content-script path and all four extension pages — failing on any console error.
Screenshots of each pass land in `test/screenshots/`.

Chrome no longer honours `--load-extension`, so the harness installs the
extension over the DevTools protocol instead. That needs a real Chrome; set
`CHROME_PATH` if yours is not at the macOS default location.

### Layout

```
src/
  manifest.json      Extension manifest (MV3)
  background.js      Service worker: optional permissions, session storage
  content/loader.js  Decides whether a page is Markdown, then loads the app
  app/               The viewer: render pipeline, shell, outline, theming
  lazy/              KaTeX and Mermaid, imported only when a document needs them
  pages/             Settings, popup, welcome and the standalone viewer
  common/            Settings storage and the document theme catalogue
  assets/            Stylesheets
scripts/
  build.mjs          esbuild bundling, code-theme index, asset copying
  make-icons.mjs     Draws and encodes the PNG icons with no native deps
  smoke.mjs          End-to-end test
  package.mjs        Builds the Web Store zip
```

The code-theme catalogue in `src/generated/hljs-themes.js` is written by the
build: it reads every stylesheet shipped with `@highlightjs/cdn-assets`, parses
the `.hljs` background colour and classifies the theme as light or dark from its
relative luminance. Do not edit it by hand.

## Built with

[markdown-it](https://github.com/markdown-it/markdown-it) ·
[highlight.js](https://highlightjs.org) ·
[KaTeX](https://katex.org) ·
[Mermaid](https://mermaid.js.org) ·
[DOMPurify](https://github.com/cure53/DOMPurify) ·
[js-yaml](https://github.com/nodeca/js-yaml) ·
[esbuild](https://esbuild.github.io)

## Licence

MIT — see [LICENSE](LICENSE). Bundled libraries keep their own licences.

Support: <https://github.com/sungju/MarkdownLens/issues>
