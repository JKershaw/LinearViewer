// Writes samples/synthetic-descriptions.json: hand-written Markdown edge cases
// plus seeded generator output. Synthetic only — no real task text.
import fs from 'node:fs';
import path from 'node:path';
import { Rng, markdown } from '../lib/gen-common.mjs';
const HERE = path.dirname(new URL(import.meta.url).pathname);
const hand = [
  '', '   ', 'One line.', 'a\nb\nc', 'a\nb\nc\nd', 'x'.repeat(300), 'x'.repeat(301),
  '# Heading\n\nPara with **bold**, _em_, `code`, and a [link](https://example.com/?a=1&b=2).',
  '- one\n  - nested\n    - deeper\n- two\n\n1. first\n2. second\n   1. nested ordered',
  '```html\n<script>alert("x")</script>\n```\n\nafter fence',
  '> quote\n> > nested quote\n\n| a | b |\n|---|---|\n| <i>1</i> | 2 & 3 |',
  'Intro line\n---\nThe setup prompt body\n---\nRemainder one\nRemainder two',
  '<div onclick="evil()">raw html</div>\n\n<img src=x onerror=alert(1)>',
  '![shot](https://uploads.linear.app/a/b.png)\n![ext](https://cdn.example.com/c.jpg "Title")',
  'Ünïcødé — 日本語 ✓ 🚀\n‮RTL‬\nzero​width',
  'line one\r\nline two\r\nline three\r\nline four',
  '&amp; &lt;already&gt; &#39;escaped&#39;',
  '\n\n\nleading blank lines\n\n\n'
];
const rng = new Rng(20261016);
const gen = Array.from({ length: 80 }, () => markdown(rng));
fs.writeFileSync(path.join(HERE, 'synthetic-descriptions.json'), JSON.stringify([...hand, ...gen], null, 1) + '\n');
console.log(`${hand.length + gen.length} synthetic descriptions`);
