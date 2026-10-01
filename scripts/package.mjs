/**
 * Zips dist/ into releases/markdown-lens-<version>.zip for the Chrome Web Store.
 *
 * Runs a few sanity checks first, because the store rejects an upload long
 * after you have stopped paying attention to it.
 */

import { spawnSync } from 'node:child_process';
import { mkdir, readFile, readdir, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const RELEASES = path.join(ROOT, 'releases');

/** Files the extension cannot load without. */
const REQUIRED = [
  'manifest.json',
  'content.js',
  'background.js',
  'app/main.js',
  'options.html',
  'popup.html',
  'welcome.html',
  'viewer.html',
  'pages/options.js',
  'pages/popup.js',
  'pages/welcome.js',
  'pages/viewer.js',
  'assets/viewer.css',
  'assets/themes.css',
  'assets/pages.css',
  'katex/katex.min.css',
  'icons/icon-16.png',
  'icons/icon-32.png',
  'icons/icon-48.png',
  'icons/icon-128.png',
];

const MAX_BYTES = 128 * 1024 * 1024; // Chrome Web Store package limit.

async function directorySize(dir) {
  let total = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    total += entry.isDirectory() ? await directorySize(full) : (await stat(full)).size;
  }
  return total;
}

/** Walks dist/ looking for anything that should never reach the store. */
async function findStrays(dir, base = dir) {
  const strays = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      strays.push(...await findStrays(full, base));
    } else if (/\.(map|ts|md)$/.test(entry.name) || entry.name.startsWith('.')) {
      strays.push(path.relative(base, full));
    }
  }
  return strays;
}

function human(bytes) {
  const units = ['B', 'KB', 'MB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  return `${value.toFixed(value < 10 && unit > 0 ? 1 : 0)} ${units[unit]}`;
}

async function main() {
  if (!existsSync(DIST)) {
    throw new Error('dist/ not found. Run `npm run build -- --release` first.');
  }

  const pkg = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'));
  const manifest = JSON.parse(await readFile(path.join(DIST, 'manifest.json'), 'utf8'));

  if (manifest.version !== pkg.version) {
    throw new Error(`version mismatch: package.json ${pkg.version} vs manifest ${manifest.version}`);
  }

  const missing = REQUIRED.filter((file) => !existsSync(path.join(DIST, file)));
  if (missing.length) {
    throw new Error(`missing from dist/: ${missing.join(', ')}`);
  }

  const strays = await findStrays(DIST);
  if (strays.length) {
    console.warn(`  ! unexpected files in dist/: ${strays.slice(0, 8).join(', ')}`
      + (strays.length > 8 ? ` (+${strays.length - 8} more)` : ''));
    console.warn('    Source maps mean this is a development build; rebuild with --release.');
  }

  await mkdir(RELEASES, { recursive: true });
  const zipPath = path.join(RELEASES, `markdown-lens-${manifest.version}.zip`);
  await rm(zipPath, { force: true });

  // -X drops the macOS resource forks and extended attributes that otherwise
  // show up as a __MACOSX directory inside the uploaded package.
  const result = spawnSync('zip', ['-r', '-q', '-X', '-9', zipPath, '.'], {
    cwd: DIST,
    stdio: 'inherit',
  });

  if (result.error || result.status !== 0) {
    throw new Error(`zip failed${result.error ? `: ${result.error.message}` : ` with status ${result.status}`}`);
  }

  const zipped = (await stat(zipPath)).size;
  if (zipped > MAX_BYTES) {
    throw new Error(`package is ${human(zipped)}, over the ${human(MAX_BYTES)} store limit`);
  }

  console.log(`Markdown Lens ${manifest.version}`);
  console.log(`  unpacked: ${human(await directorySize(DIST))}`);
  console.log(`  package:  ${human(zipped)}`);
  console.log(`  ${path.relative(ROOT, zipPath)}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
