/**
 * Test helper for the stylesheets (LIN-4015).
 *
 * A CSS-text pin asks how a rule is written: its selector list, its newlines, its indentation. Merging a
 * selector list, moving a rule or reformatting a sheet breaks it without changing what any element gets.
 * These helpers ask the question the pin meant instead: which declarations apply to this selector, in the
 * cascade order a page loads its sheets in.
 *
 *   const sheets = readSheets(['/style.css', '/run-control.css']);
 *   appliedDecls(sheets, '.opened-task-setup').get('font-size')   // the value that wins, or a throw
 *
 * Only the selector's own rules are read: a rule for another selector is not the same rule, so a
 * different selector that wins on an element is a separate question (the interference report, in
 * tests/measures/css-cascade.mjs). A query that matches no rule throws, so a converted pin cannot pass
 * on an absent selector.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '../../public');

// Splits on `sep` at parenthesis, bracket and quote depth zero.
function splitTop(text, sep) {
  const parts = [];
  let depth = 0;
  let quote = null;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '(' || ch === '[') {
      depth++;
    } else if (ch === ')' || ch === ']') {
      depth--;
    } else if (ch === sep && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

// Whitespace-insensitive form of a selector, so `a  >  b` and `a > b` and `a\n  b` compare equal.
export const normalizeSelector = (selector) => selector.replace(/\s+/g, ' ').replace(/\s*([>+~])\s*/g, ' $1 ').trim();

export function parseDecls(body) {
  const decls = [];
  for (const raw of splitTop(body, ';')) {
    const colon = raw.indexOf(':');
    if (colon < 0) continue;
    const prop = raw.slice(0, colon).trim().toLowerCase();
    let value = raw.slice(colon + 1).trim();
    if (!prop) continue;
    const important = /!\s*important\s*$/i.test(value);
    if (important) value = value.replace(/!\s*important\s*$/i, '').trim();
    decls.push({ prop, value, important });
  }
  return decls;
}

const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

// The index of the `}` that closes the `{` at `open`.
function closeOf(css, open) {
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) return i;
  }
  throw new Error('css-rules: unclosed block');
}

const normalizeMedia = (prelude) => prelude.replace(/^@media\s*/i, '').replace(/\s+/g, '').toLowerCase();

// One sheet as { name, rules: [{ selectors, media, decls, order }] }, rules in source order. `media` is null
// for an unconditional rule, or the normalized condition of the enclosing @media (nested ones joined by `and`).
// `@font-face`, `@keyframes` and other at-rules are not style rules and are skipped.
export function parseSheet(css, name = '') {
  const rules = [];
  const walk = (text, media) => {
    let i = 0;
    while (i < text.length) {
      const brace = text.indexOf('{', i);
      const semi = text.indexOf(';', i);
      if (brace < 0 && semi < 0) break;
      if (brace < 0 || (semi >= 0 && semi < brace)) {
        i = semi + 1;
        continue;
      }
      const prelude = text.slice(i, brace).trim();
      const end = closeOf(text, brace);
      const body = text.slice(brace + 1, end);
      if (/^@media/i.test(prelude)) {
        const condition = normalizeMedia(prelude);
        walk(body, media ? `${media}and${condition}` : condition);
      } else if (!prelude.startsWith('@')) {
        const selectors = splitTop(prelude, ',').map(normalizeSelector).filter(Boolean);
        rules.push({ selectors, media, decls: parseDecls(body), order: rules.length });
      }
      i = end + 1;
    }
  };
  walk(stripComments(css), null);
  return { name, rules };
}

// The sheets a page loads, parsed, in the order it loads them. `names` are URL paths (`/style.css`).
export function readSheets(names, dir = PUBLIC) {
  return names.map((n) => parseSheet(readFileSync(join(dir, n.replace(/^\//, '')), 'utf8'), n));
}

// Every rule across `sheets`, in cascade order, whose selector list contains `selector`.
// `media` is null (unconditional rules, the default), a condition such as '(max-width:640px)', or 'any'.
export function rulesFor(sheets, selector, { media = null } = {}) {
  const want = normalizeSelector(selector);
  const wantMedia = media === null || media === 'any' ? media : normalizeMedia(`@media ${media}`);
  const out = [];
  for (const sheet of sheets) {
    for (const rule of sheet.rules) {
      if (!rule.selectors.includes(want)) continue;
      if (wantMedia !== 'any' && rule.media !== wantMedia) continue;
      out.push({ sheet: sheet.name, ...rule });
    }
  }
  return out;
}

// The declarations that apply to `selector`: each property's winning value, the last rule in cascade order
// winning, except that an !important declaration beats a later plain one. Throws when no rule matches.
export function appliedDecls(sheets, selector, options = {}) {
  const matched = rulesFor(sheets, selector, options);
  if (!matched.length) throw new Error(`css-rules: no rule for "${selector}"${options.media ? ` under ${options.media}` : ''}`);
  const winners = new Map();
  for (const rule of matched) {
    for (const d of rule.decls) {
      const held = winners.get(d.prop);
      if (held && held.important && !d.important) continue;
      winners.set(d.prop, d);
    }
  }
  return new Map([...winners].map(([prop, d]) => [prop, d.value]));
}

// The one value a property resolves to for `selector`, or a throw when no applicable rule sets it.
export function declOf(sheets, selector, prop, options = {}) {
  const decls = appliedDecls(sheets, selector, options);
  if (!decls.has(prop)) throw new Error(`css-rules: "${selector}" sets no ${prop}`);
  return decls.get(prop);
}
