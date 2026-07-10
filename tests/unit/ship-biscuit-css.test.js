/**
 * CSS-presence guard for the Theme B newspaper hierarchy (LIN-1198, B5/B6).
 *
 * There is no ship-biscuit visual-regression baseline (the page is flag-gated and has
 * no screenshot spec), so this pins the load-bearing style contract structurally: the
 * stylesheet must target every hook the renderers emit, map data-prominence to a
 * descending headline type scale, reuse the existing single narrow breakpoint, and
 * stay semantic-token-only (dark-theme safe — no hard-coded colours).
 *
 * Run with: node --test tests/unit/ship-biscuit-css.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSS = readFileSync(join(__dirname, '../../public/ship-biscuit.css'), 'utf8');

/** Pull the font-size (in rem) from the first rule whose selector matches `re`. */
function fontSizeRem(re) {
  const block = CSS.match(new RegExp(re.source + '\\s*\\{[^}]*\\}'));
  assert.ok(block, `expected a rule for ${re}`);
  const m = block[0].match(/font-size:\s*([\d.]+)rem/);
  assert.ok(m, `expected a rem font-size in the rule for ${re}`);
  return parseFloat(m[1]);
}

describe('ship-biscuit.css — newspaper hierarchy hooks (LIN-1198)', () => {
  test('styles every structural hook the renderers emit', () => {
    for (const hook of [
      '.ship-biscuit-lead-headline',
      '.ship-biscuit-standfirst',
      '.ship-biscuit-lede',
      '.ship-biscuit-sections',
      '.ship-biscuit-stubs',
      '.ship-biscuit-stub'
    ]) {
      assert.ok(CSS.includes(hook), `missing style for ${hook}`);
    }
  });

  test('targets all three data-prominence tiers', () => {
    for (const tier of ['high', 'medium', 'standard']) {
      assert.ok(CSS.includes(`[data-prominence="${tier}"]`), `missing data-prominence=${tier}`);
    }
  });
});

describe('ship-biscuit.css — type scale + prominence mapping', () => {
  test('lead headline is the largest editorial type, above standfirst and lede', () => {
    const lead = fontSizeRem(/\.ship-biscuit-lead-headline/);
    const standfirst = fontSizeRem(/\.ship-biscuit-standfirst/);
    const lede = fontSizeRem(/\.ship-biscuit-lede/);
    assert.ok(lead > standfirst, `lead (${lead}) should exceed standfirst (${standfirst})`);
    assert.ok(lead > lede, `lead (${lead}) should exceed lede (${lede})`);
  });

  test('data-prominence maps to a descending headline size (high > medium > standard)', () => {
    const high = fontSizeRem(/\.ship-biscuit-weighted\[data-prominence="high"\] \.ship-biscuit-headline/);
    const medium = fontSizeRem(/\.ship-biscuit-weighted\[data-prominence="medium"\] \.ship-biscuit-headline/);
    const standard = fontSizeRem(/\.ship-biscuit-weighted\[data-prominence="standard"\] \.ship-biscuit-headline/);
    assert.ok(high > medium, `high (${high}) should exceed medium (${medium})`);
    assert.ok(medium > standard, `medium (${medium}) should exceed standard (${standard})`);
  });

  test('the high-prominence lead spans the full grid width', () => {
    assert.match(CSS, /\.ship-biscuit-weighted\[data-prominence="high"\]\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/);
  });

  test('stub headlines are smaller than the weighted standard tier (compact/low-emphasis)', () => {
    const stub = fontSizeRem(/\.ship-biscuit-stub \.ship-biscuit-headline/);
    const standard = fontSizeRem(/\.ship-biscuit-weighted\[data-prominence="standard"\] \.ship-biscuit-headline/);
    assert.ok(stub < standard, `stub (${stub}) should be smaller than standard weighted (${standard})`);
  });
});

describe('ship-biscuit.css — responsive + theme safety', () => {
  test('reuses the existing single narrow breakpoint and collapses both grids to one column', () => {
    const mq = CSS.match(/@media \(max-width:\s*600px\)\s*\{[\s\S]*?\n\}/);
    assert.ok(mq, 'expected the max-width:600px breakpoint');
    assert.match(mq[0], /grid-template-columns:\s*1fr/);
  });

  test('uses relative units for the responsive grids (auto-fill + minmax, no fixed px columns)', () => {
    assert.match(CSS, /\.ship-biscuit-sections\s*\{[^}]*repeat\(auto-fill,\s*minmax\([\d.]+px,\s*1fr\)\)/);
    assert.match(CSS, /\.ship-biscuit-stubs\s*\{[^}]*repeat\(auto-fill,\s*minmax\([\d.]+px,\s*1fr\)\)/);
  });

  test('stays semantic-token-only — no hard-coded hex colours (dark-theme safe)', () => {
    assert.doesNotMatch(CSS, /#[0-9a-fA-F]{3,6}\b/, 'no raw hex colours — colours must come from semantic tokens');
    // colours are expressed through var(--token) references
    assert.match(CSS, /color:\s*var\(--/);
  });
});
