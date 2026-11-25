/**
 * LaTeX support, loaded only when math rendering is enabled.
 *
 * katex.css is injected separately by the viewer (it needs extension-relative
 * font URLs, which a bundled stylesheet cannot provide).
 */

import texmath from 'markdown-it-texmath';
import katex from 'katex';

/*
 * A dollar sign is far more often money or a shell variable than math. The
 * library's own rule let a formula run over other dollar signs and end against
 * a letter, so "$HOME/$USER" lost its signs. Here a formula starts after a
 * space or punctuation, holds no bare dollar, neither starts nor ends with a
 * space, and ends before one or before punctuation. Nor does it look like the
 * shell: no "quotes" in it, no $? or $@ to start it, no $( right after it.
 */
const inlineMath = texmath.rules.dollars.inline.find((rule) => rule.name === 'math_inline');
inlineMath.rex = /\$(?![\s?@#!*])((?:\\[^\n]|[^$\\\n"])+?)(?<!\s)\$/gy;
inlineMath.pre = (text, outerSpace, start) => start === 0 || !/[\w$\\]/.test(text[start - 1]);
inlineMath.post = (text, outerSpace, end) => end + 1 >= text.length || !/[\w${(@#]/.test(text[end + 1]);

// The result goes into a template through String.replace, which reads $& and $'
// in it as its own.
const render = texmath.render;
texmath.render = (...args) => render(...args).replaceAll('$', '$$$$');

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
