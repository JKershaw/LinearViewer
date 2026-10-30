/**
 * LIN-3983 PR 2: observation.css is Observation's own sheet. Flight Companion, Passage Planner and Ship
 * Biscuit no longer load it (Live Console stopped in LIN-3977). The one rule they borrowed, the card-body
 * frame behind their prompt box, is folded into each page's own sheet. This guard recomputes the loaders
 * and the emitters from source, so a page that borrows an `obs-` class again fails here.
 *
 * Run with: node --test tests/unit/observation-css-borrow.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSheets, appliedDecls } from '../helpers/css-rules.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

// Each page's renderer and its client script, the pages that must not borrow observation.css.
const PAGES = [
  { renderer: 'lib/render-flight-companion.js', client: 'public/flight-companion.js', sheet: 'public/flight-companion.css' },
  { renderer: 'lib/render-passage-planner.js', client: 'public/passage-planner.js', sheet: 'public/passage-planner.css' },
  { renderer: 'lib/render-ship-biscuit.js', client: 'public/ship-biscuit.js', sheet: 'public/ship-biscuit.css' },
];

test('Flight Companion, Passage Planner and Ship Biscuit do not load observation.css', () => {
  for (const { renderer } of PAGES) {
    assert.ok(!read(renderer).includes("'/observation.css'"), `${renderer} must not load observation.css`);
  }
});

test('no page borrows an obs- class from observation.css: each class its renderer or client emits is defined elsewhere, or nowhere', () => {
  const observationCss = read('public/observation.css');
  for (const { renderer, client } of PAGES) {
    const emitted = new Set([...read(renderer).matchAll(/\bobs-[a-z0-9-]+/g), ...read(client).matchAll(/\bobs-[a-z0-9-]+/g)].map(m => m[0]));
    for (const name of emitted) {
      const rule = new RegExp(`\\.${name}(?![a-z0-9-])`);
      assert.ok(!rule.test(observationCss), `${renderer} or ${client} emits .${name}, which only observation.css styles`);
    }
  }
});

test('each prompt box keeps the card-body frame, whichever sheet its rule is in', () => {
  // What applies to each prompt on its own page, in the page's sheet order (LIN-4015: the rule may be shared by a list).
  const frame = [/padding: 0\.5rem 0\.8rem 0\.65rem/, /border-top: 1px solid var\(--line-soft\)/, /font-size: 0\.84rem/];
  for (const [prompt, page] of [['.flight-companion-prompt', ['/style.css', '/common-actions.css', '/chat.css', '/flight-companion.css']], ['.passage-planner-prompt', ['/style.css', '/common-actions.css', '/passage-planner.css']]]) {
    const block = [...appliedDecls(readSheets(page), prompt)].map(([prop, value]) => `${prop}: ${value};`).join(' ');
    for (const re of frame) assert.match(block, re, `${prompt} on its page`);
  }
});

test('no sheet still describes the borrow as live', () => {
  const stale = [/observation\.css \(the \.obs-session-body/, /leans on the shared shell \+ observation\.css/];
  for (const f of readdirSync(join(ROOT, 'public')).filter(n => n.endsWith('.css') || n.endsWith('.js'))) {
    const s = read(`public/${f}`);
    for (const re of stale) assert.doesNotMatch(s, re, `public/${f} still describes the old borrow`);
  }
});
