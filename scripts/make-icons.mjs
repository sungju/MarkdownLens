/**
 * Draws the Markdown Lens icon and writes the four PNG sizes Chrome asks for.
 *
 * Everything is rasterised by hand with 4x supersampling and encoded with
 * node:zlib, so the build has no native image dependencies.
 */

import { deflateSync } from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'icons');
const SIZES = [16, 32, 48, 128];
const SS = 4; // supersampling factor

/* ------------------------------------------------------------- colours */

const BG_TOP = [0x3b, 0x82, 0xf6];
const BG_BOTTOM = [0x6d, 0x44, 0xe4];
const GLASS = [0xff, 0xff, 0xff];

/* ------------------------------------------------------------- geometry */

const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (v) => Math.min(1, Math.max(0, v));

function roundedRectCoverage(x, y, size, radius) {
  const r = radius;
  const inL = x >= r && x <= size - r;
  const inV = y >= r && y <= size - r;
  if (inL || inV) return x >= 0 && x <= size && y >= 0 && y <= size ? 1 : 0;
  const cx = x < r ? r : size - r;
  const cy = y < r ? r : size - r;
  return Math.hypot(x - cx, y - cy) <= r ? 1 : 0;
}

/** The lens: a ring plus a diagonal handle. */
function lensCoverage(x, y, size) {
  const cx = size * 0.44;
  const cy = size * 0.43;
  const outer = size * 0.23;
  const inner = size * 0.155;
  const d = Math.hypot(x - cx, y - cy);
  if (d <= outer && d >= inner) return 1;

  // Handle: thick segment from the lower-right of the ring outwards.
  const hx0 = cx + outer * 0.72;
  const hy0 = cy + outer * 0.72;
  const hx1 = size * 0.78;
  const hy1 = size * 0.77;
  const vx = hx1 - hx0;
  const vy = hy1 - hy0;
  const t = clamp01(((x - hx0) * vx + (y - hy0) * vy) / (vx * vx + vy * vy));
  const px = hx0 + vx * t;
  const py = hy0 + vy * t;
  return Math.hypot(x - px, y - py) <= size * 0.075 ? 1 : 0;
}

/** Two short bars inside the lens, standing in for lines of text. */
function textCoverage(x, y, size) {
  const bars = [
    { cx: 0.44, cy: 0.375, w: 0.19, h: 0.038 },
    { cx: 0.44, cy: 0.455, w: 0.13, h: 0.038 },
  ];
  for (const bar of bars) {
    const left = (bar.cx - bar.w / 2) * size;
    const right = (bar.cx + bar.w / 2) * size;
    const top = (bar.cy - bar.h / 2) * size;
    const bottom = (bar.cy + bar.h / 2) * size;
    if (x >= left && x <= right && y >= top && y <= bottom) return 1;
  }
  return 0;
}

function renderRGBA(size) {
  const big = size * SS;
  const pixels = new Uint8ClampedArray(size * size * 4);
  const radius = size * 0.225;

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let accR = 0; let accG = 0; let accB = 0; let accA = 0;

      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = px + (sx + 0.5) / SS;
          const y = py + (sy + 0.5) / SS;

          const bg = roundedRectCoverage(x, y, size, radius);
          if (!bg) continue;

          const t = y / size;
          let r = lerp(BG_TOP[0], BG_BOTTOM[0], t);
          let g = lerp(BG_TOP[1], BG_BOTTOM[1], t);
          let b = lerp(BG_TOP[2], BG_BOTTOM[2], t);

          if (lensCoverage(x, y, size) || textCoverage(x, y, size)) {
            [r, g, b] = GLASS;
          }

          accR += r; accG += g; accB += b; accA += 255;
        }
      }

      const samples = SS * SS;
      const i = (py * size + px) * 4;
      const alpha = accA / samples;
      if (alpha > 0) {
        pixels[i] = accR / (accA / 255);
        pixels[i + 1] = accG / (accA / 255);
        pixels[i + 2] = accB / (accA / 255);
      }
      pixels[i + 3] = alpha;
    }
  }

  void big;
  return pixels;
}

/* ----------------------------------------------------------- PNG output */

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(size, rgba) {
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ------------------------------------------------------------------ main */

await mkdir(OUT, { recursive: true });
for (const size of SIZES) {
  const png = encodePng(size, renderRGBA(size));
  await writeFile(path.join(OUT, `icon-${size}.png`), png);
  console.log(`  icons/icon-${size}.png  ${png.length} bytes`);
}
