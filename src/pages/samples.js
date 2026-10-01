/** Sample documents used by the live preview on the settings page. */

export const SAMPLES = [
  {
    id: 'guide',
    label: 'Guide',
    text: `---
title: Release notes
version: 1.0.0
tags: [markdown, chrome]
---

# Markdown Lens

A **fast**, themeable Markdown viewer. Open any \`.md\` file and it is rendered
with your fonts, your colours and your favourite code theme.

## Highlights

- 20 document themes and every highlight.js code theme
- Math, diagrams, footnotes and task lists
- Nothing leaves your machine — no network calls at all

> Everything is bundled with the extension, including the fonts metrics for math.

### Task list

- [x] Render Markdown
- [x] Theme the code blocks
- [ ] Decide on a favourite theme

### A table

| Feature      | Shortcut | Notes                   |
| ------------ | -------- | ----------------------- |
| Outline      | \`o\`      | Docks left or right     |
| Raw source   | \`r\`      | Highlighted as Markdown |
| Dark mode    | \`d\`      | Flips the theme pair    |

### Code

\`\`\`javascript
export function render(source, options = {}) {
  const tokens = parse(source);          // CommonMark + GFM
  return tokens.map((token) => emit(token, options)).join('');
}
\`\`\`

::: tip
Type \`:::\` followed by \`note\`, \`tip\`, \`warning\` or \`danger\` to get a callout.
:::

Inline \`code\`, ~~strikethrough~~, ==highlight==, H~2~O and 10^3^ all work.

[^1]: Footnotes land at the bottom of the document.

Footnotes are supported too.[^1]
`,
  },
  {
    id: 'code',
    label: 'Code',
    text: `# Syntax showcase

\`\`\`python
from dataclasses import dataclass

@dataclass(frozen=True)
class Lens:
    name: str
    focal_length: float = 50.0

    def describe(self) -> str:
        return f"{self.name} @ {self.focal_length}mm"
\`\`\`

\`\`\`rust
pub fn parse(input: &str) -> Result<Document, ParseError> {
    let mut blocks = Vec::new();
    for line in input.lines() {
        blocks.push(Block::from_line(line)?);
    }
    Ok(Document { blocks })
}
\`\`\`

\`\`\`sql
SELECT theme, count(*) AS uses
FROM   documents
WHERE  opened_at > now() - interval '7 days'
GROUP  BY theme
ORDER  BY uses DESC;
\`\`\`

\`\`\`diff
- const theme = 'github-light';
+ const theme = resolveTheme(settings, prefersDark());
\`\`\`
`,
  },
  {
    id: 'math',
    label: 'Math & diagrams',
    text: `# Math and diagrams

The Gaussian integral is $\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}$.

$$
\\mathcal{L}\\{f\\}(s) = \\int_0^\\infty f(t)\\,e^{-st}\\,dt
$$

\`\`\`mermaid
flowchart LR
  A[Markdown file] --> B{Known extension?}
  B -- yes --> C[Render]
  B -- no --> D[Leave alone]
  C --> E[Theme + highlight]
\`\`\`
`,
  },
];
