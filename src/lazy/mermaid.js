/**
 * Mermaid diagram rendering, loaded only when a document contains a
 * ```mermaid fence.
 */

import mermaid from 'mermaid';

let initialised = false;
let counter = 0;

function themeFor(scheme) {
  return scheme === 'dark' ? 'dark' : 'default';
}

/**
 * Replace every `pre > code.mdl-mermaid` in `root` with a rendered diagram.
 * Blocks that fail to parse keep their source and show the error inline.
 */
export async function renderDiagrams(root, { scheme = 'light', fontFamily } = {}) {
  const blocks = [...root.querySelectorAll('code.mdl-mermaid')];
  if (!blocks.length) return 0;

  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: themeFor(scheme),
    fontFamily: fontFamily || 'inherit',
    flowchart: { htmlLabels: false, useMaxWidth: true },
    sequence: { useMaxWidth: true },
    gantt: { useMaxWidth: true },
  });
  initialised = true;

  let rendered = 0;
  for (const block of blocks) {
    const pre = block.closest('pre') || block;
    const source = block.textContent || '';
    const figure = document.createElement('figure');
    figure.className = 'mdl-diagram';

    try {
      const { svg } = await mermaid.render(`mdl-mermaid-${++counter}`, source);
      figure.innerHTML = svg;
      figure.dataset.mdlMermaidSource = source;
      pre.replaceWith(figure);
      rendered += 1;
    } catch (error) {
      figure.classList.add('mdl-diagram-error');
      const message = document.createElement('p');
      message.className = 'mdl-diagram-message';
      message.textContent = `Diagram could not be rendered: ${error?.message || error}`;
      figure.append(message, pre.cloneNode(true));
      pre.replaceWith(figure);
      // Mermaid leaves its scratch node behind when parsing throws.
      document.getElementById(`dmdl-mermaid-${counter}`)?.remove();
    }
  }
  return rendered;
}

/** Re-theme already rendered diagrams after a theme switch. */
export async function retheme(root, options) {
  if (!initialised) return;
  for (const figure of root.querySelectorAll('.mdl-diagram[data-mdl-mermaid-source]')) {
    const pre = document.createElement('pre');
    const code = document.createElement('code');
    code.className = 'language-mermaid mdl-mermaid';
    code.textContent = figure.dataset.mdlMermaidSource;
    pre.className = 'mdl-code';
    pre.append(code);
    figure.replaceWith(pre);
  }
  await renderDiagrams(root, options);
}
