/**
 * LIN-3762 — the archive documents' muted text tier must meet WCAG AA (4.5:1).
 *
 * The archives under docs/archive/ are standalone HTML served verbatim by
 * /archive/:n (any digits-only file), so each carries its own colour tokens.
 * For every such file and every theme this reads the muted-tier tokens used as a
 * text `color:` and checks them against the page and card backgrounds (and the
 * chip tint where the rule sets one). Decorative uses (borders, strokes,
 * fills) are deliberately not measured: only `color:` declarations are.
 *
 * Run with: node --test tests/unit/archive-text-contrast.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const AA = 4.5;
// The muted tier named in LIN-3762, plus the ink tokens the repo chips use.
// Other text tokens (status hues, glyph rows, tooltips) are separate findings.
const MUTED_TIER = new Set(['--muted', '--faint', '--faint-ink', '--blue-ink', '--amber-ink']);

const lum = hex => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export function contrast(a, b) {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const decls = body => Object.fromEntries(
  [...body.matchAll(/(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{6})\b/g)].map(m => [m[1], m[2].toLowerCase()]));

/** Token maps per theme: light = :root (+ light override), dark = :root overridden by dark. */
export function themes(css) {
  const block = sel => [...css.matchAll(new RegExp(`${sel}\\s*\\{([^}]*)\\}`, 'g'))].map(m => decls(m[1]));
  const merge = list => Object.assign({}, ...list);
  const plain = block(String.raw`(?<![\w-])(?:\.\w+\s*)?:root(?!\[|:)`);
  // A media-query dark block nests `:root { ... }`; take bodies after the media header.
  const media = [...css.matchAll(/@media\s*\(prefers-color-scheme:\s*dark\)\s*\{\s*:root[^{]*\{([^}]*)\}/g)].map(m => decls(m[1]));
  const lightOverride = block(String.raw`:root\[data-theme="light"\]`);
  const darkOverride = block(String.raw`:root\[data-theme="dark"\]`);
  const base = merge(plain.slice(0, 1));
  return {
    light: merge([base, ...lightOverride]),
    'dark (data-theme)': merge([base, ...darkOverride]),
    'dark (prefers-color-scheme)': merge([base, ...media]),
  };
}

/** [{ selector, token, bgToken }] for each `color: var(--x)` rule in the stylesheet. */
export function textRules(css) {
  const out = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = m[1].trim();
    if (sel.startsWith('@') || sel.startsWith(':root')) continue;
    const color = m[2].match(/(?:^|[\s;])color:\s*var\((--[\w-]+)\)/);
    if (!color) continue;
    const bg = m[2].match(/background:\s*var\((--[\w-]+)\)/);
    out.push({ selector: sel.replace(/\s+/g, ' '), token: color[1], bgToken: bg ? bg[1] : null });
  }
  return out;
}

const dir = join(ROOT, 'docs/archive');
// The route serves any digits-only file, so discover them rather than listing 1-9.
const files = readdirSync(dir).filter(n => /^\d+\.html$/.test(n));

describe('archive muted text tier meets AA', () => {
  test('covers archives 1-9 at least', () => {
    for (let n = 1; n <= 9; n++) assert.ok(files.includes(`${n}.html`), `${n}.html missing`);
  });

  for (const name of files) {
    const html = readFileSync(join(dir, name), 'utf8');
    const css = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map(m => m[1]).join('\n');
    const rules = textRules(css);
    for (const [theme, tokens] of Object.entries(themes(css))) {
      test(`${name} · ${theme}`, () => {
        const bgs = [tokens['--paper'] ?? tokens['--bg'], tokens['--card']];
        assert.ok(bgs.every(Boolean), 'page/card background tokens not found');
        const failures = [];
        for (const r of rules) {
          const fg = tokens[r.token];
          // Chip rules are measured whatever their token (LIN-3762 names repo-h/repo-d), so a chip
          // pointed back at --blue/--amber cannot slip past the MUTED_TIER list.
          if ((!MUTED_TIER.has(r.token) && !/\.chip\b/.test(r.selector)) || !fg) continue; // not a plain hex token in this file (e.g. rgba, or defined elsewhere)
          const surfaces = [...bgs];
          if (r.bgToken && tokens[r.bgToken]) surfaces.push(tokens[r.bgToken]);
          for (const bg of surfaces) {
            const c = contrast(fg, bg);
            if (c < AA) failures.push(`${r.selector} { color: ${r.token} ${fg} } on ${bg} = ${c.toFixed(2)}:1`);
          }
        }
        assert.deepEqual(failures, []);
      });
    }
  }
});
