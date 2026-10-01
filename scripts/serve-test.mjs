/**
 * Serves the handful of responses that the smoke harness cannot produce.
 *
 * Two features need a switch only a human can flip — file access, granted on
 * the extension's details page, and wide host access, granted from a real
 * click in the options page — so they are checked by hand. What they need is
 * a server that sends Markdown the awkward ways a real site does: without a
 * recognisable extension, and under a `text/markdown` content type that
 * Chrome would otherwise download rather than display.
 *
 * Run `node scripts/serve-test.mjs`, then work through the routes it prints.
 * Each one states what should happen, so a wrong result is obvious.
 */

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 8777);

const fixture = readFileSync(path.join(ROOT, 'test/fixture.md'), 'utf8');

/**
 * A log file carries none of the constructs the heuristic looks for, so it is
 * the control that proves scanning does not grab every text document in sight.
 */
const log = [
  '2026-10-01 09:14:02 INFO  starting worker pool size=8',
  '2026-10-01 09:14:02 INFO  bound to 0.0.0.0:8080',
  '2026-10-01 09:14:11 WARN  slow query 1824ms table=sessions',
  '2026-10-01 09:15:00 ERROR upstream timeout after 30s',
  '2026-10-01 09:15:01 INFO  retrying in 5s',
].join('\n');

/**
 * One Markdown signal and no more. The heuristic wants at least two before it
 * claims a document, so this must stay plain text even with scanning on.
 */
const borderline = [
  'Shopping list for the weekend, nothing fancy.',
  '',
  '- milk, bread, coffee, and something for Sunday lunch',
  '',
  'Call ahead about the coffee, they were out of it last time.',
].join('\n');

/**
 * Each route states what it should do on both sides of the permission grant.
 * The pairs that do not change are as much of the test as the ones that do:
 * they are what shows the grant widened access by exactly the intended amount.
 */
const ROUTES = {
  '/fixture.md': {
    type: 'text/plain; charset=utf-8',
    body: fixture,
    before: 'renders',
    after: 'renders',
    why: 'the manifest already matches *.md, so no grant is involved either way',
  },
  '/readme': {
    type: 'text/plain; charset=utf-8',
    body: fixture,
    before: 'plain text',
    after: 'renders',
    why: 'no extension to match on, so only the page scanner can claim it',
  },
  '/notes': {
    type: 'text/markdown; charset=utf-8',
    body: fixture,
    before: 'downloads as a file',
    after: 'renders',
    why: 'Chrome downloads text/markdown until the content-type rule rewrites it',
  },
  '/server.log': {
    type: 'text/plain; charset=utf-8',
    body: log,
    before: 'plain text',
    after: 'plain text',
    why: 'zero Markdown signals — the scanner must leave log files alone',
  },
  '/borderline': {
    type: 'text/plain; charset=utf-8',
    body: borderline,
    before: 'plain text',
    after: 'plain text',
    why: 'one Markdown signal, and the heuristic demands at least two',
  },
};

const escape = (text) => text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

/**
 * The menu is HTML on purpose. It has to be clickable to be worth having, and
 * serving it as HTML also keeps the extension's content script out of it —
 * the menu is scaffolding, not one of the cases under test.
 */
function indexPage() {
  const rows = Object.entries(ROUTES).map(([url, r]) => `
    <tr>
      <td><a href="${url}" target="_blank" rel="noopener">${url}</a>
          <div class="why">${escape(r.why)}</div></td>
      <td><code>${r.type.split(';')[0]}</code></td>
      <td class="${r.before === r.after ? 'same' : 'change'}">${escape(r.before)}</td>
      <td class="${r.before === r.after ? 'same' : 'change'}">${escape(r.after)}</td>
    </tr>`).join('');

  return `<!doctype html>
<meta charset="utf-8">
<title>Markdown Lens test server</title>
<style>
  body { font: 15px/1.55 -apple-system, system-ui, sans-serif; max-width: 60rem;
         margin: 3rem auto; padding: 0 1.5rem; color: #1b1f24; }
  h1 { font-size: 1.4rem; margin-bottom: .2rem; }
  p.sub { color: #596069; margin-top: 0; }
  table { border-collapse: collapse; width: 100%; margin: 1.5rem 0; }
  th, td { text-align: left; padding: .6rem .7rem; border-bottom: 1px solid #e3e6ea;
           vertical-align: top; }
  th { font-size: .8rem; text-transform: uppercase; letter-spacing: .04em; color: #596069; }
  a { color: #0a66c2; }
  code { background: #f2f4f6; padding: .1rem .3rem; border-radius: 3px; font-size: .88em; }
  .why { color: #70767e; font-size: .85rem; margin-top: .2rem; }
  .change { font-weight: 600; }
  .same { color: #70767e; }
  ol { color: #363c44; } li { margin: .3rem 0; }
  @media (prefers-color-scheme: dark) {
    body { background: #14171a; color: #e6e9ec; }
    th, p.sub, .why, .same { color: #9aa2ab; }
    th, td { border-bottom-color: #2a2f35; }
    code { background: #22272c; } a { color: #6cb0f5; } ol { color: #c7ccd2; }
  }
</style>
<h1>Markdown Lens test server</h1>
<p class="sub">Open each route in turn, once before granting access and once after.
   Rows in bold are the ones the grant is supposed to change.</p>
<table>
  <tr><th>Route</th><th>Sent as</th><th>Before grant</th><th>After grant</th></tr>
  ${rows}
</table>
<ol>
  <li>Visit all five routes now and record what each one does.</li>
  <li>Open the extension's options page → <strong>Permissions</strong> →
      <strong>Grant access</strong>, and accept Chrome's prompt.</li>
  <li>Visit all five again, hard-reloading each. Only the bold cells may differ.</li>
</ol>
<p class="sub">Served with <code>cache-control: no-store</code>, so a retest after a
   permission change is never answered from cache.</p>
`;
}

const server = createServer((request, response) => {
  const { pathname } = new URL(request.url, `http://localhost:${PORT}`);
  const route = ROUTES[pathname];

  if (!route) {
    response.writeHead(pathname === '/' ? 200 : 404, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    });
    response.end(indexPage());
    return;
  }

  response.writeHead(200, {
    'content-type': route.type,
    // Chrome caches aggressively, and a stale response would quietly
    // invalidate a retest after a permission has been toggled.
    'cache-control': 'no-store',
  });
  response.end(route.body);
});

server.listen(PORT, () => {
  console.log(`Markdown Lens test server on http://localhost:${PORT}`);
  console.log('Open that address for the clickable checklist.\n');
  for (const [url, route] of Object.entries(ROUTES)) {
    console.log(`  http://localhost:${PORT}${url}`);
    console.log(`      sent as ${route.type.split(';')[0]}`);
    console.log(`      before: ${route.before}   ->   after: ${route.after}\n`);
  }
  console.log('Ctrl-C to stop.');
});
