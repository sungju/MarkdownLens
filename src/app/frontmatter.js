/**
 * YAML / TOML / JSON front matter detection.
 *
 * All three are parsed into structured data where possible, so the viewer can
 * show a table. Anything that fails to parse keeps its raw text and is shown
 * verbatim instead.
 */

import { load as parseYaml } from 'js-yaml';
import { parseToml } from './toml.js';

const DELIMITERS = [
  { open: /^---[ \t]*\r?\n/, close: /\r?\n---[ \t]*(?:\r?\n|$)/, format: 'yaml' },
  { open: /^\+\+\+[ \t]*\r?\n/, close: /\r?\n\+\+\+[ \t]*(?:\r?\n|$)/, format: 'toml' },
  { open: /^;;;[ \t]*\r?\n/, close: /\r?\n;;;[ \t]*(?:\r?\n|$)/, format: 'json' },
];

/**
 * @returns {{ body: string, data: object|null, raw: string|null, format: string|null }}
 */
export function parseFrontMatter(source) {
  const text = source.replace(/^﻿/, '');

  for (const { open, close, format } of DELIMITERS) {
    const start = open.exec(text);
    if (!start) continue;

    const rest = text.slice(start[0].length);
    const end = close.exec(rest);
    if (!end) continue;

    const raw = rest.slice(0, end.index);
    const body = rest.slice(end.index + end[0].length);

    let data = null;
    if (format === 'yaml') {
      try {
        const parsed = parseYaml(raw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) data = parsed;
      } catch { /* malformed front matter is shown raw */ }
    } else if (format === 'toml') {
      try {
        data = parseToml(raw);
      } catch { /* outside the supported subset, so shown raw */ }
    } else if (format === 'json') {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) data = parsed;
      } catch { /* shown raw */ }
    }

    return { body, data, raw, format };
  }

  return { body: text, data: null, raw: null, format: null };
}

/** Flatten a front matter value into something printable in a table cell. */
export function formatValue(value) {
  if (value == null) return '';
  if (Array.isArray(value)) return value.map(formatValue).join(', ');
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    return Object.entries(value).map(([k, v]) => `${k}: ${formatValue(v)}`).join('; ');
  }
  return String(value);
}
