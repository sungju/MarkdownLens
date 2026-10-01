/**
 * Prints the extension ID Chrome assigns to an unpacked extension, which is
 * derived from the absolute path of its directory. Handy for smoke tests that
 * need to navigate to a chrome-extension:// URL.
 */

import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.resolve(process.argv[2] || path.join(ROOT, 'dist'));

const digest = createHash('sha256').update(target, 'utf8').digest('hex').slice(0, 32);
const id = [...digest].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');

console.log(id);
