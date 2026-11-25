/**
 * GitHub alerts: a quote whose first line is a marker such as [!NOTE] is drawn
 * as the admonition of that kind. A title may follow the marker, the way
 * Obsidian writes it, as long as the quote goes on below it; otherwise the rest
 * of the line is the alert's text. [!NOTE](address) is a link, not a marker.
 */

const MARKER = /^\[!([a-z]+)\](?![([])[-+]?[ \t]*([^\n]*)(?:\n|$)/i;

export function githubAlerts(md, kinds) {
  // Before 'inline', while the marker is still source text: an escaped one
  // (\[!NOTE]) does not match.
  md.core.ruler.before('inline', 'github_alerts', (state) => {
    const { tokens } = state;

    for (let i = 0; i < tokens.length - 2; i += 1) {
      const open = tokens[i];
      const paragraph = tokens[i + 1];
      const inline = tokens[i + 2];
      if (open.type !== 'blockquote_open' || paragraph.type !== 'paragraph_open') continue;

      const match = MARKER.exec(inline.content);
      const kind = match?.[1].toLowerCase();
      if (!match || !kinds.includes(kind)) continue;

      const rest = inline.content.slice(match[0].length);
      // On to the next line, or to another block of the same quote.
      const goesOn = match[0].endsWith('\n') || tokens[i + 4]?.type !== 'blockquote_close';
      const titled = match[2].trim() && goesOn;
      const body = titled ? rest : [match[2], rest].filter((part) => part.trim()).join('\n');

      let depth = 0;
      const close = tokens.findIndex((token, index) => {
        if (index < i) return false;
        if (token.type === 'blockquote_open') depth += 1;
        if (token.type === 'blockquote_close') depth -= 1;
        return depth === 0;
      });

      open.tag = 'div';
      tokens[close].tag = 'div';
      open.attrJoin('class', `mdl-admonition mdl-admonition-${kind}`);

      const heading = [
        new state.Token('paragraph_open', 'p', 1),
        new state.Token('inline', '', 0),
        new state.Token('paragraph_close', 'p', -1),
      ];
      heading[0].attrSet('class', 'mdl-admonition-title');
      heading[1].content = titled ? match[2].trim() : kind[0].toUpperCase() + kind.slice(1);
      heading[1].children = [];
      for (const token of heading) {
        token.block = true;
        token.level = token.type === 'inline' ? inline.level : paragraph.level;
        token.map = inline.map;
      }

      if (body) {
        inline.content = body;
        tokens.splice(i + 1, 0, ...heading);
      } else {
        // Nothing but the marker in this paragraph.
        tokens.splice(i + 1, 3, ...heading);
      }
    }
  });
}
