// Resolved-cascade equivalence (LIN-4015). For every stylesheet list the renderers in lib/ pass to a page, this reads the
// sheets in that order and records, per theme and media condition, the declarations that win for each selector, with
// var() resolved to the value it renders as in that theme. Run it at base and at head and diff the two: a shrink or a
// token swap must change exactly the declarations it meant to, and nothing else.
//
//   node tests/measures/css-cascade.mjs <repoDir>                > snapshot.json
//   node tests/measures/css-cascade.mjs --diff <base.json> <head.json>   → changed entries, JSON on stdout
//
// What it can see: a selector's own winning declarations, per page, theme and media. A different selector of equal
// specificity that starts to win on the same element is NOT visible here (each selector is read on its own); that is
// the interference report's job (`--interference`). Specificity is ignored on purpose: the winner for a selector is the
// last rule in cascade order that names it.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSheets, normalizeSelector } from '../helpers/css-rules.js';

// Every distinct literal stylesheet list in the renderers, in first-seen order. Each `stylesheets:` line may hold several
// arrays (a ternary between two lists); a spread list yields the literal names it does contain.
export function pageLists(root) {
  const seen = new Map();
  const walk = (dir) => {
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, name.name);
      if (name.isDirectory()) walk(path);
      else if (name.name.endsWith('.js')) {
        for (const line of readFileSync(path, 'utf8').split('\n')) {
          if (!line.includes('stylesheets:')) continue;
          for (const m of line.matchAll(/\[([^\[\]]*)\]/g)) {
            const names = [...m[1].matchAll(/'(\/[^']+\.css)'/g)].map((x) => x[1]);
            if (names.length && !seen.has(names.join(' '))) seen.set(names.join(' '), names);
          }
        }
      }
    }
  };
  walk(join(root, 'lib'));
  return [...seen.values()];
}

const VAR = /var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*(?:\([^()]*\)[^()]*)*))?\)/g;

// Replaces each var(--x, fallback) with the token's value in `tokens`, or its fallback, or a marker when neither exists.
export function resolve(value, tokens, depth = 0) {
  if (depth > 8) return value;
  return value.replace(VAR, (_, name, fallback) => {
    if (tokens.has(name)) return resolve(tokens.get(name), tokens, depth + 1);
    if (fallback !== undefined) return resolve(fallback.trim(), tokens, depth + 1);
    return `UNDEFINED(${name})`;
  });
}

// The token values a theme sets: :root, then .theme-dark for the dark theme (it overrides by cascade order).
function tokensFor(sheets, theme) {
  const tokens = new Map();
  for (const sheet of sheets) {
    for (const rule of sheet.rules) {
      if (rule.media !== null) continue;
      const applies = rule.selectors.includes(':root') || (theme === 'dark' && rule.selectors.includes('.theme-dark'));
      if (!applies) continue;
      for (const d of rule.decls) if (d.prop.startsWith('--')) tokens.set(d.prop, d.value);
    }
  }
  return tokens;
}

// { theme: { media: { selector: { prop: resolved } } } } for one page's sheet list.
export function pageSnapshot(root, names) {
  const sheets = readSheets(names, join(root, 'public'));
  const out = {};
  for (const theme of ['light', 'dark']) {
    const tokens = tokensFor(sheets, theme);
    const byMedia = {};
    for (const sheet of sheets) {
      for (const rule of sheet.rules) {
        const media = rule.media ?? 'base';
        for (const sel of rule.selectors) {
          const key = normalizeSelector(sel);
          const slot = ((byMedia[media] ??= {})[key] ??= {});
          for (const d of rule.decls) {
            if (d.prop.startsWith('--')) continue;
            if (slot[d.prop] && slot[d.prop].important && !d.important) continue;
            slot[d.prop] = { value: resolve(d.value, tokens), important: d.important };
          }
        }
      }
    }
    // Keep the resolved values only; the importance flag has done its job in the cascade above.
    for (const media of Object.keys(byMedia)) {
      for (const sel of Object.keys(byMedia[media])) {
        for (const prop of Object.keys(byMedia[media][sel])) byMedia[media][sel][prop] = byMedia[media][sel][prop].value;
      }
    }
    out[theme] = byMedia;
  }
  return out;
}

export function snapshot(root) {
  const result = {};
  for (const names of pageLists(root)) result[names.join(' ')] = pageSnapshot(root, names);
  return result;
}

// Changed, added and removed declarations between two snapshots, page by page.
export function diffSnapshots(base, head) {
  const changes = {};
  const keys = new Set([...Object.keys(base), ...Object.keys(head)]);
  for (const page of [...keys].sort()) {
    const a = base[page] ?? {};
    const b = head[page] ?? {};
    const list = [];
    for (const theme of ['light', 'dark']) {
      const mediaKeys = new Set([...Object.keys(a[theme] ?? {}), ...Object.keys(b[theme] ?? {})]);
      for (const media of mediaKeys) {
        const sa = a[theme]?.[media] ?? {};
        const sb = b[theme]?.[media] ?? {};
        for (const sel of new Set([...Object.keys(sa), ...Object.keys(sb)])) {
          const pa = sa[sel] ?? {};
          const pb = sb[sel] ?? {};
          for (const prop of new Set([...Object.keys(pa), ...Object.keys(pb)])) {
            if (pa[prop] === pb[prop]) continue;
            list.push({ theme, media, selector: sel, prop, base: pa[prop] ?? null, head: pb[prop] ?? null });
          }
        }
      }
    }
    if (list.length) changes[page] = list;
  }
  return changes;
}

// Specificity [ids, classes-and-attributes-and-pseudo-classes, elements] of one selector, as the cascade ranks it.
// :is() and :not() count as their most specific argument, :where() counts as nothing, and a pseudo-element counts as an element.
export function specificity(selector) {
  let text = selector;
  let ids = 0;
  let classes = 0;
  let elements = 0;
  for (let guard = 0; guard < 20; guard++) {
    const m = text.match(/:(is|not|where)\(([^()]*)\)/);
    if (!m) break;
    if (m[1] !== 'where') {
      const best = m[2].split(',').map((x) => specificity(x.trim())).sort((a, b) => b[0] - a[0] || b[1] - a[1] || b[2] - a[2])[0] ?? [0, 0, 0];
      ids += best[0];
      classes += best[1];
      elements += best[2];
    }
    text = text.replace(m[0], ' ');
  }
  text = text.replace(/\[[^\]]*\]/g, () => { classes++; return ' '; });
  text = text.replace(/::[a-z-]+/gi, () => { elements++; return ' '; });
  ids += (text.match(/#[\w-]+/g) || []).length;
  classes += (text.match(/\.[\w-]+/g) || []).length;
  classes += (text.match(/:[a-z-]+/gi) || []).length;
  text = text.replace(/#[\w-]+|\.[\w-]+|:[a-z-]+/gi, ' ');
  elements += (text.match(/(?:^|[\s>+~,])[a-z][\w-]*/gi) || []).length;
  return [ids, classes, elements];
}

// The classes a selector requires on one element (its `.name` tokens), for the element-overlap question.
export const classesOf = (selector) => new Set([...selector.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]));

// The cascade order of every selector on one page's sheet list, flattened: [{ selector, rule, index }]. A selector
// in several rules has one entry per rule.
const flatten = (sheets) => {
  const order = [];
  for (const sheet of sheets) {
    for (const rule of sheet.rules) {
      for (const sel of rule.selectors) order.push({ selector: normalizeSelector(sel), rule, index: order.length });
    }
  }
  return order;
};

// Pairs of selectors whose cascade order flips between base and head on one page: a moved rule can pass another
// rule it used to lose to (or the reverse). Only pairs that could land on one element are worth a hand read, so the
// result keeps those whose specificity is equal and whose declarations share a property. Selectors that occur more
// than once on the page are not paired (their order is not one number); the caller checks those by hand.
export function flippedPairs(baseRoot, headRoot, names) {
  const baseOrder = flatten(readSheets(names, join(baseRoot, 'public')));
  const headOrder = flatten(readSheets(names, join(headRoot, 'public')));
  const once = (order) => {
    const m = new Map();
    for (const e of order) m.set(e.selector, m.has(e.selector) ? null : e);
    return m;
  };
  const base = once(baseOrder);
  const head = once(headOrder);
  const both = [...head.keys()].filter((k) => base.get(k) && head.get(k));
  const out = [];
  for (let i = 0; i < both.length; i++) {
    for (let j = i + 1; j < both.length; j++) {
      const a = both[i];
      const b = both[j];
      const flipped = Math.sign(base.get(a).index - base.get(b).index) !== Math.sign(head.get(a).index - head.get(b).index);
      if (!flipped) continue;
      const sa = specificity(a).join(',');
      const sb = specificity(b).join(',');
      const shared = [...new Set(head.get(a).rule.decls.map((d) => d.prop))].filter((p) => head.get(b).rule.decls.some((d) => d.prop === p));
      if (sa !== sb || shared.length === 0) continue;
      out.push({ a, b, specificity: sa, shared, baseOrder: [base.get(a).index, base.get(b).index], headOrder: [head.get(a).index, head.get(b).index] });
    }
  }
  return out;
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === '--flips') {
    const [baseRoot, headRoot] = [process.argv[3], process.argv[4]];
    const lists = [...new Set([...pageLists(baseRoot), ...pageLists(headRoot)].map((l) => l.join(' ')))].map((l) => l.split(' '));
    const report = {};
    for (const names of lists) {
      const pairs = flippedPairs(baseRoot, headRoot, names);
      if (pairs.length) report[names.join(' ')] = pairs;
    }
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else if (process.argv[2] === '--diff') {
    const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
    const changes = diffSnapshots(read(process.argv[3]), read(process.argv[4]));
    const summary = Object.fromEntries(Object.entries(changes).map(([page, list]) => [page, list.length]));
    process.stdout.write(`${JSON.stringify({ pages: Object.keys(changes).length, summary, changes }, null, 2)}\n`);
  } else {
    const root = process.argv[2] ?? '.';
    process.stdout.write(`${JSON.stringify(snapshot(root))}\n`);
  }
}

