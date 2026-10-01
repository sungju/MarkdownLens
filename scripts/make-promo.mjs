/**
 * Renders the 440x280 small promo tile the Chrome Web Store asks for.
 *
 * The icons are rasterised by hand, but a promo tile is mostly type, and
 * hand-rasterising a typeface is not worth it for one image. Chrome is already
 * a build dependency for the smoke test, so this screenshots a small HTML page
 * instead. The tile is a committed asset: it changes only when the branding
 * does, and the store needs it long after any particular checkout is gone.
 */

import { spawn } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'store', 'promo-440x280.png');

const CHROME = process.env.CHROME_PATH
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const WIDTH = 440;
const HEIGHT = 280;

/* The same gradient the icon is drawn with, so the tile and the icon that sits
   next to it in the store listing read as one piece of branding. */
const BG_TOP = '#3b82f6';
const BG_BOTTOM = '#6d44e4';

function page(iconDataUrl) {
  return `<!doctype html>
<meta charset="utf-8">
<style>
  html, body { margin: 0; padding: 0; }
  body {
    width: ${WIDTH}px;
    height: ${HEIGHT}px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 14px;
    background: linear-gradient(160deg, ${BG_TOP}, ${BG_BOTTOM});
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    color: #fff;
    -webkit-font-smoothing: antialiased;
    overflow: hidden;
  }
  /* A faint wash off the top-left corner keeps the flat gradient from looking
     like a placeholder at thumbnail size. */
  body::before {
    content: "";
    position: fixed;
    inset: -40% 40% 40% -40%;
    background: radial-gradient(circle, rgba(255,255,255,.22), transparent 70%);
  }
  .mark { position: relative; display: flex; align-items: center; gap: 16px; }
  /* The icon is drawn in the same gradient as the tile, so without a shadow to
     lift it off the background its edges disappear at thumbnail size. */
  .mark img {
    width: 76px;
    height: 76px;
    display: block;
    border-radius: 17px;
    box-shadow: 0 6px 18px rgba(23, 18, 66, .32);
  }
  .name { font-size: 40px; font-weight: 650; letter-spacing: -0.8px; }
  .tagline {
    position: relative;
    font-size: 17px;
    font-weight: 450;
    letter-spacing: 0.1px;
    color: rgba(255,255,255,.88);
  }
</style>
<div class="mark"><img src="${iconDataUrl}" alt=""><div class="name">Markdown Lens</div></div>
<div class="tagline">Markdown files, beautifully rendered.</div>
`;
}

async function main() {
  if (!existsSync(CHROME)) throw new Error(`Chrome not found at ${CHROME}. Set CHROME_PATH.`);

  const icon = await readFile(path.join(ROOT, 'icons', 'icon-128.png'));
  const html = page(`data:image/png;base64,${icon.toString('base64')}`);

  const work = path.join(tmpdir(), `mdl-promo-${process.pid}`);
  await mkdir(work, { recursive: true });
  const source = path.join(work, 'promo.html');
  await writeFile(source, html);
  await mkdir(path.dirname(OUT), { recursive: true });

  try {
    await shoot(source, work);
  } finally {
    await rm(work, { recursive: true, force: true });
  }

  const { size } = await readFile(OUT).then((b) => ({ size: b.length }));
  console.log(`store/promo-440x280.png  ${WIDTH}x${HEIGHT}  ${(size / 1024).toFixed(1)} kB`);
}

/**
 * Chrome writes the screenshot and then, in recent versions, keeps running
 * instead of exiting. Waiting on the process would hang forever, so wait on
 * the artefact: once the file has stopped growing it is complete, and Chrome
 * has nothing left to do. The process is still reaped either way.
 */
function shoot(source, profile) {
  return new Promise((resolve, reject) => {
    const child = spawn(CHROME, [
      '--headless=new',
      `--screenshot=${OUT}`,
      `--window-size=${WIDTH},${HEIGHT}`,
      '--force-device-scale-factor=1',
      '--hide-scrollbars',
      '--no-first-run',
      '--no-default-browser-check',
      `--user-data-dir=${profile}/chrome`,
      `file://${source}`,
    ], { stdio: ['ignore', 'ignore', 'pipe'] });

    let stderr = '';
    let settled = false;
    child.stderr.on('data', (c) => { stderr += c; });

    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearInterval(poll);
      clearTimeout(deadline);
      child.kill('SIGKILL');
      if (error) reject(error); else resolve();
    };

    child.on('error', finish);
    child.on('exit', (code) => {
      if (existsSync(OUT)) finish();
      else finish(new Error(`Chrome exited ${code} without writing a screenshot\n${stderr}`));
    });

    let lastSize = -1;
    const poll = setInterval(() => {
      if (!existsSync(OUT)) return;
      const { size } = statSync(OUT);
      if (size > 0 && size === lastSize) finish();
      lastSize = size;
    }, 250);

    const deadline = setTimeout(
      () => finish(new Error(`Chrome produced no screenshot within 60s\n${stderr}`)),
      60_000,
    );
  });
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
