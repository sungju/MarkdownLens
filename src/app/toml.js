/**
 * Minimal TOML reader, sized for front matter rather than for TOML at large.
 *
 * Front matter is nearly always a flat block of `key = value` pairs, so this
 * covers that shape — strings, integers, floats, booleans, dates, inline
 * arrays, inline tables and `[table]` headers — and throws on anything it does
 * not fully understand, including multi-line strings and arrays of tables.
 *
 * Throwing is the point: the caller falls back to printing the block verbatim,
 * so an exotic document is shown exactly as it is written rather than being
 * quietly misread. A bundled TOML library would cost more than the feature.
 */

const BARE_KEY = /^[A-Za-z0-9_-]+/;
const DATE = /^\d{4}-\d{2}-\d{2}(?:[Tt ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[Zz]|[+-]\d{2}:\d{2})?)?/;
const TIME = /^\d{2}:\d{2}:\d{2}(?:\.\d+)?/;
const NUMBER = /^[+-]?(?:0x[0-9a-fA-F_]+|0o[0-7_]+|0b[01_]+|inf|nan|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?)/;

const ESCAPES = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', '"': '"', '\\': '\\' };

function skipSpace(text, index) {
  let i = index;
  while (i < text.length && (text[i] === ' ' || text[i] === '\t')) i++;
  return i;
}

function readString(text, index) {
  const quote = text[index];
  let i = index + 1;

  // Literal strings take no escapes at all, which is why they are separate.
  if (quote === "'") {
    const end = text.indexOf("'", i);
    if (end === -1) throw new Error('unterminated literal string');
    return { value: text.slice(i, end), i: end + 1 };
  }

  let out = '';
  while (i < text.length) {
    const char = text[i];
    if (char === '"') return { value: out, i: i + 1 };
    if (char !== '\\') {
      out += char;
      i++;
      continue;
    }
    const escape = text[i + 1];
    if (escape in ESCAPES) {
      out += ESCAPES[escape];
      i += 2;
      continue;
    }
    if (escape === 'u' || escape === 'U') {
      const width = escape === 'u' ? 4 : 8;
      const hex = text.slice(i + 2, i + 2 + width);
      if (hex.length !== width || /[^0-9a-fA-F]/.test(hex)) throw new Error('bad unicode escape');
      out += String.fromCodePoint(parseInt(hex, 16));
      i += 2 + width;
      continue;
    }
    throw new Error('bad escape');
  }
  throw new Error('unterminated string');
}

/** Read a possibly dotted, possibly quoted key such as `a."b c".d`. */
function readKeyPath(text, index) {
  const path = [];
  let i = index;
  for (;;) {
    i = skipSpace(text, i);
    if (text[i] === '"' || text[i] === "'") {
      const read = readString(text, i);
      path.push(read.value);
      i = read.i;
    } else {
      const match = BARE_KEY.exec(text.slice(i));
      if (!match) throw new Error('missing key');
      path.push(match[0]);
      i += match[0].length;
    }
    i = skipSpace(text, i);
    if (text[i] !== '.') return { path, i };
    i++;
  }
}

function readArray(text, index) {
  const out = [];
  let i = index + 1;
  for (;;) {
    i = skipSpace(text, i);
    if (i >= text.length) throw new Error('unterminated array');
    if (text[i] === ']') return { value: out, i: i + 1 };

    const read = readValue(text, i);
    out.push(read.value);
    i = skipSpace(text, read.i);

    if (text[i] === ',') {
      i++;
      continue;
    }
    if (text[i] === ']') return { value: out, i: i + 1 };
    throw new Error('bad array');
  }
}

function readInlineTable(text, index) {
  const out = {};
  let i = skipSpace(text, index + 1);
  if (text[i] === '}') return { value: out, i: i + 1 };

  for (;;) {
    const key = readKeyPath(text, i);
    i = skipSpace(text, key.i);
    if (text[i] !== '=') throw new Error('bad inline table');

    const read = readValue(text, i + 1);
    assign(out, key.path, read.value);
    i = skipSpace(text, read.i);

    if (text[i] === ',') {
      i = skipSpace(text, i + 1);
      continue;
    }
    if (text[i] === '}') return { value: out, i: i + 1 };
    throw new Error('bad inline table');
  }
}

function readValue(text, index) {
  const i = skipSpace(text, index);
  const char = text[i];
  if (char === undefined) throw new Error('missing value');

  if (char === '"' || char === "'") return readString(text, i);
  if (char === '[') return readArray(text, i);
  if (char === '{') return readInlineTable(text, i);

  const rest = text.slice(i);
  if (rest.startsWith('true')) return { value: true, i: i + 4 };
  if (rest.startsWith('false')) return { value: false, i: i + 5 };

  // Dates are kept as the text that was written: front matter only displays
  // them, and converting would force a timezone choice the document never made.
  const moment = DATE.exec(rest) || TIME.exec(rest);
  if (moment) return { value: moment[0], i: i + moment[0].length };

  const number = NUMBER.exec(rest);
  if (number) {
    const digits = number[0].replace(/_/g, '');
    let value;
    if (/inf$/.test(digits)) value = digits.startsWith('-') ? -Infinity : Infinity;
    else if (/nan$/.test(digits)) value = NaN;
    else value = Number(digits);
    if (value === undefined || (Number.isNaN(value) && !/nan$/.test(digits))) {
      throw new Error('bad number');
    }
    return { value, i: i + number[0].length };
  }

  throw new Error('unsupported value');
}

function assign(target, path, value) {
  let node = target;
  for (const key of path.slice(0, -1)) {
    if (!Object.hasOwn(node, key)) node[key] = {};
    if (typeof node[key] !== 'object' || Array.isArray(node[key])) throw new Error('conflicting key');
    node = node[key];
  }
  const last = path[path.length - 1];
  if (Object.hasOwn(node, last)) throw new Error('duplicate key');
  node[last] = value;
}

/**
 * Strip a line's trailing comment and report how far it opens or closes
 * brackets, ignoring anything inside quotes.
 */
function scanLine(line) {
  let depth = 0;
  let quote = null;
  let end = line.length;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quote) {
      if (char === '\\' && quote === '"') i++;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === '#') { end = i; break; }
    else if (char === '[' || char === '{') depth++;
    else if (char === ']' || char === '}') depth--;
  }

  return { text: line.slice(0, end).trim(), depth };
}

/**
 * Fold the block into one entry per key, joining the continuation lines of a
 * multi-line array or inline table. Whitespace carries no meaning inside
 * those, so joining with a space is safe; anything still unbalanced at the end
 * is handed over as-is for the parser to reject.
 */
function logicalLines(text) {
  const lines = [];
  let buffer = null;
  let depth = 0;

  for (const raw of text.split(/\r?\n/)) {
    const { text: trimmed, depth: delta } = scanLine(raw);
    if (buffer === null) {
      if (!trimmed) continue;
      if (delta > 0) {
        buffer = trimmed;
        depth = delta;
        continue;
      }
      lines.push(trimmed);
      continue;
    }

    if (trimmed) buffer += ` ${trimmed}`;
    depth += delta;
    if (depth <= 0) {
      lines.push(buffer);
      buffer = null;
    }
  }

  if (buffer !== null) lines.push(buffer);
  return lines;
}

/**
 * @param {string} text the front matter block, without its `+++` delimiters
 * @returns {object} the parsed table
 * @throws if the document uses anything outside the supported subset
 */
export function parseToml(text) {
  const root = {};
  let target = root;

  for (const trimmed of logicalLines(text)) {
    if (trimmed.startsWith('[[')) throw new Error('arrays of tables are not supported');

    if (trimmed.startsWith('[')) {
      if (!trimmed.endsWith(']')) throw new Error('bad table header');
      const { path, i } = readKeyPath(trimmed, 1);
      if (skipSpace(trimmed, i) !== trimmed.length - 1) throw new Error('bad table header');

      target = root;
      for (const key of path) {
        if (!Object.hasOwn(target, key)) target[key] = {};
        if (typeof target[key] !== 'object' || Array.isArray(target[key])) {
          throw new Error('conflicting table');
        }
        target = target[key];
      }
      continue;
    }

    const key = readKeyPath(trimmed, 0);
    let i = skipSpace(trimmed, key.i);
    if (trimmed[i] !== '=') throw new Error('expected =');

    const read = readValue(trimmed, i + 1);
    i = skipSpace(trimmed, read.i);
    if (i < trimmed.length && trimmed[i] !== '#') throw new Error('trailing characters');

    assign(target, key.path, read.value);
  }

  if (Object.keys(root).length === 0) throw new Error('no keys');
  return root;
}
