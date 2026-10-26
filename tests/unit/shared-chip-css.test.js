/**
 * LIN-3977 (N2): the `.obs-act-chip` / `.obs-act-idle` rules live in the shared
 * /style.css, and every page whose client emits those chips loads that sheet.
 * Live Console no longer borrows observation.css. The judge cannot guard this
 * (no chip-bearing page is in tests/judge/pages.mjs), so this test recomputes the
 * emitters and the renderers from source and fails if the move is incomplete.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const CHIP_SELECTORS = ['.obs-act-chip', '.obs-act-idle'];
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test('each chip rule is defined in exactly one sheet, and that sheet is style.css', () => {
  const cssFiles = readdirSync(join(ROOT, 'public')).filter(f => f.endsWith('.css'));
  for (const sel of CHIP_SELECTORS) {
    const re = new RegExp(`^${escapeRe(sel)}\\s*\\{`, 'm');
    const sheets = cssFiles.filter(f => re.test(read(`public/${f}`)));
    assert.deepEqual(sheets, ['style.css'], `${sel} must be defined only in public/style.css`);
  }
});

test('every page whose client or server emits an obs-act- chip loads /style.css, and Live Console does not load observation.css', () => {
  const emitterScripts = readdirSync(join(ROOT, 'public'))
    .filter(f => f.endsWith('.js') && read(`public/${f}`).includes('obs-act-'));
  const serverEmitters = readdirSync(join(ROOT, 'lib'))
    .filter(f => f.endsWith('.js') && /class="obs-act-/.test(read(`lib/${f}`)));
  assert.ok(emitterScripts.includes('live-console.js') && emitterScripts.includes('observation.js'),
    'the census sees both chip emitters (Observation and Live Console)');

  const renderers = readdirSync(join(ROOT, 'lib'))
    .filter(f => /^render-.*\.js$/.test(f))
    .filter(f => {
      const src = read(`lib/${f}`);
      return emitterScripts.some(e => src.includes(`/${e}`)) || serverEmitters.includes(f);
    });
  assert.ok(renderers.length >= 2, `found the chip-bearing renderers: ${renderers.join(', ')}`);

  for (const f of renderers) {
    const src = read(`lib/${f}`);
    assert.ok(src.includes("'/style.css'"), `${f} must load /style.css, which holds the chip rules`);
  }
  const live = read('lib/render-live-console.js');
  assert.ok(!live.includes("'/observation.css'"), 'render-live-console.js must not load observation.css');
});
