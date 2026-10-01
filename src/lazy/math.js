/**
 * LaTeX support, loaded only when math rendering is enabled.
 *
 * katex.css is injected separately by the viewer (it needs extension-relative
 * font URLs, which a bundled stylesheet cannot provide).
 */

import texmath from 'markdown-it-texmath';
import katex from 'katex';

export function applyMath(md) {
  md.use(texmath, {
    engine: katex,
    delimiters: ['dollars', 'beg_end'],
    katexOptions: {
      throwOnError: false,
      strict: 'ignore',
      output: 'htmlAndMathml',
      trust: false,
      maxSize: 50,
      maxExpand: 1000,
    },
  });
}
