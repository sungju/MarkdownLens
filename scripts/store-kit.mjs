/**
 * Gathers everything the Chrome Web Store dashboard asks for into one folder:
 * releases/store-kit-<version>/.
 *
 * STORE.md stays the single source for the listing copy. Its blockquotes are
 * hard-wrapped for reading, but the dashboard's text fields keep every line
 * break, so the copy is unwrapped here into paste-ready text files.
 *
 * Expects `npm test` (screenshots) and `npm run release` (zip) to have run.
 */

import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { version, description } = JSON.parse(await readFile(path.join(ROOT, 'src/manifest.json'), 'utf8'));
const KIT = path.join(ROOT, 'releases', `store-kit-${version}`);
const SHOTS = path.join(ROOT, 'test/screenshots');

/** Screenshot order on the listing, matching the table in STORE.md. */
const SCREENSHOTS = [
  ['content-script.png', '1-outline-light.png'],
  ['content-script-dark-code.png', '2-code-dark.png'],
  ['content-script-math.png', '3-math-diagrams.png'],
  ['options.png', '4-settings.png'],
  ['code-theme-picker.png', '5-code-theme-picker.png'],
];

function fail(message) {
  console.error(`store-kit: ${message}`);
  process.exit(1);
}

/** Splits STORE.md into { heading: body } on its `## ` headings. */
function sections(markdown) {
  const out = {};
  let current = null;
  for (const line of markdown.split('\n')) {
    const m = /^## (.+)$/.exec(line);
    if (m) out[current = m[1].trim()] = [];
    else if (current) out[current].push(line);
  }
  return out;
}

/** Returns each blockquote in `lines` with the bold label that precedes it. */
function quotes(lines) {
  const found = [];
  let label = null;
  let block = null;
  for (const line of lines) {
    if (line.startsWith('>')) {
      block ??= [];
      block.push(line.replace(/^> ?/, ''));
      continue;
    }
    if (block) {
      found.push({ label, text: unwrap(block) });
      block = null;
    }
    const bold = /^\*\*(.+?)\*\*/.exec(line);
    if (bold) label = bold[1];
    else if (line.startsWith('**')) label = line.replace(/\*\*/g, '').trim();
    else if (label && /^[^\s>]/.test(line) && !line.startsWith('Paste')) {
      // A bold label wrapped over two lines.
      label += ' ' + line.replace(/\*\*/g, '').trim();
    }
  }
  if (block) found.push({ label, text: unwrap(block) });
  return found;
}

const isHeading = (s) => /[A-Z]/.test(s) && s === s.toUpperCase();

/** Joins hard-wrapped lines back into paragraphs, bullets and headings. */
function unwrap(lines) {
  const out = [];
  for (const raw of lines) {
    const line = raw.trim();
    const prev = out.at(-1);
    if (!line) out.push('');
    else if (prev === undefined || prev === '' || line.startsWith('•') || isHeading(prev) || isHeading(line)) out.push(line);
    else out[out.length - 1] = `${prev} ${line}`;
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

const store = sections(await readFile(path.join(ROOT, 'STORE.md'), 'utf8'));
const pick = (heading) => {
  const key = Object.keys(store).find((k) => k.startsWith(heading));
  if (!key) fail(`STORE.md has no "## ${heading}" section`);
  return quotes(store[key]);
};

const zip = path.join(ROOT, 'releases', `markdown-lens-${version}.zip`);
if (!existsSync(zip)) fail(`${path.relative(ROOT, zip)} is missing — run npm run release`);
for (const [src] of SCREENSHOTS) {
  if (!existsSync(path.join(SHOTS, src))) fail(`test/screenshots/${src} is missing — run npm test`);
}

const short = pick('Short description')[0].text.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
if (short.length > 132) fail(`short description is ${short.length} characters; the limit is 132`);
if (short !== description) fail('STORE.md short description differs from the manifest description, which is what the store shows');
const detailed = pick('Detailed description')[0].text;
const purpose = pick('Single purpose')[0].text.replace(/\n/g, ' ').trim();
const permissions = pick('Permission justifications')
  .map(({ label, text }) => `=== ${label} ===\n${text.replace(/\n(?!\n)/g, ' ').trim()}\n`)
  .join('\n');

await rm(KIT, { recursive: true, force: true });
await mkdir(path.join(KIT, 'screenshots'), { recursive: true });

await copyFile(zip, path.join(KIT, path.basename(zip)));
for (const [src, dest] of SCREENSHOTS) await copyFile(path.join(SHOTS, src), path.join(KIT, 'screenshots', dest));
await copyFile(path.join(ROOT, 'icons/icon-128.png'), path.join(KIT, 'store-icon-128.png'));
await copyFile(path.join(ROOT, 'store/promo-440x280.png'), path.join(KIT, 'small-promo-tile-440x280.png'));

await writeFile(path.join(KIT, 'short-description.txt'), short + '\n');
await writeFile(path.join(KIT, 'detailed-description.txt'), detailed);
await writeFile(path.join(KIT, 'single-purpose.txt'), purpose + '\n');
await writeFile(path.join(KIT, 'permission-justifications.txt'), permissions);

await writeFile(path.join(KIT, 'UPLOAD.md'), `# Markdown Lens ${version} — upload checklist

Dashboard: https://chrome.google.com/webstore/devconsole

## Package
- [ ] Upload \`${path.basename(zip)}\`

## Store listing tab
- [ ] Description → paste \`detailed-description.txt\`
      (the summary line comes from the manifest in the zip, and is copied to
      \`short-description.txt\` only so you can check it)
- [ ] Category → Developer Tools
- [ ] Language → English
- [ ] Store icon → \`store-icon-128.png\`
- [ ] Screenshots → \`screenshots/1-…\` to \`5-…\`, in that order (all 1280×800)
- [ ] Small promo tile → \`small-promo-tile-440x280.png\`
- [ ] Official URL / Homepage → https://baramsoft.com
- [ ] Support URL → https://baramsoft.com/support/

## Privacy practices tab
- [ ] Single purpose → paste \`single-purpose.txt\`
- [ ] Permission justifications → paste each block from
      \`permission-justifications.txt\` into its field
- [ ] Remote code → "No, I am not using remote code"
- [ ] Data usage → tick nothing as collected; certify all three statements
- [ ] Privacy policy URL → https://baramsoft.com/privacy-markdownlens/

## Distribution tab
- [ ] Payments → Free
- [ ] Visibility → Public
- [ ] Regions → All regions

Then **Submit for review**.
`);

console.log(`Store kit for ${version}: ${path.relative(ROOT, KIT)}/`);
console.log(`  short description: ${short.length}/132 characters`);
