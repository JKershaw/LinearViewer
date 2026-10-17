// Comparison of one (old, new) output pair.
//
// HTML results are classified into exactly one kind, coarsest first:
//   identical           byte-equal
//   whitespace-only     DOM-equal and equal once whitespace runs are collapsed
//                       ('runs': only run length/kind differs) or once
//                       whitespace touching tags is removed ('presence': a
//                       space appeared/disappeared at a tag boundary — can be
//                       visible between inline elements)
//   serialization-only  DOM-equal but not whitespace-equal: entity spelling,
//                       attribute order/quoting, class-token order, JSON key
//                       order inside data-*/embedded payloads
//   structural          normalised DOM differs (sub-kind element/attribute/text)
// and, independently, a DOM-CONTRACT difference (top severity) whenever the
// projection of the page onto the contract tokens (every data-* attribute and
// value, ids, testids, consumer-referenced classes and their keyed nesting)
// changes. Non-HTML results (data exports) are deep-compared, Map/Set order
// and object key order included (key order alone = serialization-only).

import { parseHtml, normalizeTree, serializeNorm, describeEl, walkElements, canonicalJson, embeddedPayload } from './html.mjs';

// ---------------------------------------------------------------------------
// String-level whitespace views
// ---------------------------------------------------------------------------
const RAW_RE = /(<(script|pre|textarea|style)\b[^>]*>)([\s\S]*?)(<\/\2\s*>)/gi;
export function collapseWs(html) {
  let out = '';
  let last = 0;
  const c = s => s.replace(/\s+/g, ' ');
  for (const m of html.matchAll(RAW_RE)) {
    out += c(html.slice(last, m.index)) + c(m[1]) + m[3] + m[4];
    last = m.index + m[0].length;
  }
  return (out + c(html.slice(last))).trim();
}
export function stripTagWs(html) {
  return collapseWs(html).replace(/>\s+/g, '>').replace(/\s+</g, '<');
}

function firstDiffIndex(a, b) {
  let i = 0;
  const n = Math.min(a.length, b.length);
  while (i < n && a.charCodeAt(i) === b.charCodeAt(i)) i++;
  return i;
}
function excerpt(s, idx, r = 60) {
  const a = Math.max(0, idx - r);
  return (a > 0 ? '…' : '') + s.slice(a, idx) + '⟦' + s.slice(idx, idx + r) + (idx + r < s.length ? '…' : '');
}

// Open-element path at a character offset of raw HTML (for string-level kinds).
const VOIDS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
export function pathAt(html, idx) {
  const head = html.slice(0, idx);
  const stack = [];
  const re = /<(\/?)([A-Za-z][A-Za-z0-9-]*)([^>]*)>/g;
  let m;
  while ((m = re.exec(head))) {
    const tag = m[2].toLowerCase();
    if (m[1]) { const at = stack.map(e => e.tag).lastIndexOf(tag); if (at >= 0) stack.length = at; continue; }
    if (VOIDS.has(tag) || m[3].endsWith('/')) continue;
    const attrs = [];
    for (const am of m[3].matchAll(/([^\s=/>"']+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>]+))?/g)) attrs.push([am[1], (am[2] || '').replace(/^["']|["']$/g, '')]);
    stack.push({ tag, desc: describeEl({ type: 'el', tag, attrs }) });
  }
  const lastLt = head.lastIndexOf('<');
  const inTag = lastLt > head.lastIndexOf('>');
  return stack.slice(-6).map(e => e.desc).join(' > ') + (inTag ? ' :: in-tag' : ' :: #text');
}

// ---------------------------------------------------------------------------
// Data deep diff (order-aware)
// ---------------------------------------------------------------------------
function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (v instanceof Map) return 'map';
  if (v instanceof Set) return 'set';
  if (v instanceof Date) return 'date';
  return typeof v;
}
function brief(v) {
  let s;
  try { s = v instanceof Map ? `Map(${v.size})` : v instanceof Set ? `Set(${v.size})` : v === undefined ? 'undefined' : JSON.stringify(v); } catch { s = String(v); }
  return s && s.length > 140 ? s.slice(0, 137) + '...' : s;
}
/** Returns { path, kind, old, new } for the first difference ignoring key order, or null. */
export function deepDiff(a, b, path = '$', memo = new WeakMap()) {
  if (Object.is(a, b)) return null;
  const ta = typeOf(a); const tb = typeOf(b);
  if (a !== null && b !== null && typeof a === 'object' && typeof b === 'object') {
    // shared subgraphs / cycles: each (a, b) pair is compared once
    let s = memo.get(a);
    if (!s) memo.set(a, s = new WeakSet());
    if (s.has(b)) return null;
    s.add(b);
  }
  if (ta !== tb) return { path, kind: 'type', old: `${ta}:${brief(a)}`, new: `${tb}:${brief(b)}` };
  if (ta === 'number' && Number.isNaN(a) && Number.isNaN(b)) return null;
  if (ta === 'date') return a.getTime() === b.getTime() || (Number.isNaN(a.getTime()) && Number.isNaN(b.getTime())) ? null : { path, kind: 'value', old: brief(a), new: brief(b) };
  if (ta === 'array') {
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) { const d = deepDiff(a[i], b[i], `${path}[${i}]`, memo); if (d) return d; }
    if (a.length !== b.length) return { path: `${path}.length`, kind: 'length', old: a.length, new: b.length };
    return null;
  }
  if (ta === 'map' || ta === 'set') {
    const ea = [...a.entries()]; const eb = [...b.entries()];
    if (ea.length !== eb.length) return { path: `${path}.size`, kind: 'length', old: ea.length, new: eb.length };
    for (let i = 0; i < ea.length; i++) {
      const dk = deepDiff(ea[i][0], eb[i][0], `${path}<key ${i}>`, memo);
      if (dk) return { ...dk, kind: dk.kind === 'value' ? 'map-key/order' : dk.kind };
      const dv = deepDiff(ea[i][1], eb[i][1], `${path}<${brief(ea[i][0])}>`, memo);
      if (dv) return dv;
    }
    return null;
  }
  if (ta === 'object') {
    const ka = Object.keys(a); const kb = Object.keys(b);
    const keys = [...new Set([...ka, ...kb])].sort();
    for (const k of keys) {
      const ia = Object.prototype.hasOwnProperty.call(a, k); const ib = Object.prototype.hasOwnProperty.call(b, k);
      if (!ia) return { path: `${path}.${k}`, kind: b[k] === undefined ? 'added-undefined' : 'added', old: undefined, new: brief(b[k]) };
      if (!ib) return { path: `${path}.${k}`, kind: a[k] === undefined ? 'removed-undefined' : 'removed', old: brief(a[k]), new: undefined };
      const d = deepDiff(a[k], b[k], `${path}.${k}`, memo);
      if (d) return d;
    }
    return null;
  }
  return { path, kind: 'value', old: brief(a), new: brief(b) };
}
/** First object whose own-key order differs (deep). */
export function keyOrderDiff(a, b, path = '$', memo = new WeakSet()) {
  const ta = typeOf(a);
  if (ta !== typeOf(b)) return null;
  if (a && typeof a === 'object') { if (memo.has(a)) return null; memo.add(a); }
  if (ta === 'array') { for (let i = 0; i < Math.min(a.length, b.length); i++) { const d = keyOrderDiff(a[i], b[i], `${path}[${i}]`, memo); if (d) return d; } return null; }
  if (ta === 'map') { const ea = [...a.values()]; const eb = [...b.values()]; for (let i = 0; i < Math.min(ea.length, eb.length); i++) { const d = keyOrderDiff(ea[i], eb[i], `${path}<${i}>`, memo); if (d) return d; } return null; }
  if (ta === 'object') {
    const ka = Object.keys(a).join(','); const kb = Object.keys(b).join(',');
    if (ka !== kb) return { path, kind: 'key-order', old: ka.slice(0, 120), new: kb.slice(0, 120) };
    for (const k of Object.keys(a)) { const d = keyOrderDiff(a[k], b[k], `${path}.${k}`, memo); if (d) return d; }
  }
  return null;
}
const genericPath = p => p.replace(/\[\d+\]/g, '[]').replace(/<key \d+>/g, '<key>');

// ---------------------------------------------------------------------------
// Normalised-DOM diff
// ---------------------------------------------------------------------------
function nodeKey(n) {
  if (n.type !== 'el') return n.type;
  const a = Object.fromEntries(n.attrs || []);
  return `${n.tag}#${a.id || ''}[${a['data-testid'] || ''}]{${a['data-id'] || ''}}.${(a.class || '').split(' ')[0]}`;
}
function lcsAlign(xs, ys) {
  const n = xs.length; const m = ys.length;
  if (n * m > 250000) return null;
  const kx = xs.map(nodeKey); const ky = ys.map(nodeKey);
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = kx[i] === ky[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const pairs = [];
  let i = 0; let j = 0;
  while (i < n && j < m) {
    if (kx[i] === ky[j]) { pairs.push([i, j]); i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) { pairs.push([i, null]); i++; } else { pairs.push([null, j]); j++; }
  }
  while (i < n) pairs.push([i++, null]);
  while (j < m) pairs.push([null, j++]);
  return pairs;
}

function pathStr(stack) { return stack.slice(-6).map(describeEl).join(' > ') || '(root)'; }

export function domDiffs(a, b, limit = 60) {
  const out = [];
  const push = (d) => { if (out.length < limit) out.push(d); };
  const rec = (x, y, stack) => {
    if (out.length >= limit) return;
    if (x.type !== y.type) { push({ path: pathStr(stack), what: `node-type ${x.type}→${y.type}`, cls: 'element' }); return; }
    if (x.type === 'text' || x.type === 'comment' || x.type === 'doctype') {
      if (x.value !== y.value) {
        if (x.embedded && y.embedded) {
          const pa = embeddedValue(x); const pb = embeddedValue(y);
          const d = deepDiff(pa, pb);
          push({ path: pathStr(stack), what: d ? `#embedded(${x.embedded}) ${genericPath(d.path)} (${d.kind})` : `#embedded(${x.embedded}) (order-only)`, cls: 'text', old: d?.old, new: d?.new });
        } else {
          const i = firstDiffIndex(x.value, y.value);
          push({ path: pathStr(stack), what: `#${x.type}`, cls: x.type === 'text' ? 'text' : 'element', old: excerpt(x.value, i, 40), new: excerpt(y.value, i, 40) });
        }
      }
      return;
    }
    const here = x.type === 'el' ? [...stack, x] : stack;
    if (x.type === 'el') {
      if (x.tag !== y.tag) { push({ path: pathStr(stack), what: `tag <${x.tag}>→<${y.tag}>`, cls: 'element' }); return; }
      const ax = new Map(x.attrs); const ay = new Map(y.attrs);
      for (const [k, v] of ax) {
        if (!ay.has(k)) push({ path: pathStr(here), what: `attr-removed @${k}`, cls: 'attribute', old: v.slice(0, 80) });
        else if (ay.get(k) !== v) push({ path: pathStr(here), what: `attr-changed @${k}`, cls: 'attribute', old: v.slice(0, 100), new: ay.get(k).slice(0, 100) });
      }
      for (const [k, v] of ay) if (!ax.has(k)) push({ path: pathStr(here), what: `attr-added @${k}`, cls: 'attribute', new: v.slice(0, 80) });
      if ((x.dupAttrs || []).join() !== (y.dupAttrs || []).join()) push({ path: pathStr(here), what: `duplicate-attrs ${(x.dupAttrs || []).join()}→${(y.dupAttrs || []).join()}`, cls: 'attribute' });
    }
    const cx = x.children; const cy = y.children;
    if (cx.length === cy.length) { for (let i = 0; i < cx.length; i++) rec(cx[i], cy[i], here); return; }
    const pairs = lcsAlign(cx, cy);
    if (!pairs) { push({ path: pathStr(here), what: `child-count ${cx.length}→${cy.length}`, cls: 'element' }); return; }
    for (const [i, j] of pairs) {
      if (i !== null && j !== null) rec(cx[i], cy[j], here);
      else if (i !== null) push({ path: pathStr(here), what: `child-removed ${cx[i].type === 'el' ? '<' + describeEl(cx[i]) + '>' : '#' + cx[i].type}`, cls: 'element', old: cx[i].type === 'el' ? undefined : String(cx[i].value).slice(0, 80) });
      else push({ path: pathStr(here), what: `child-added ${cy[j].type === 'el' ? '<' + describeEl(cy[j]) + '>' : '#' + cy[j].type}`, cls: 'element', new: cy[j].type === 'el' ? undefined : String(cy[j].value).slice(0, 80) });
    }
  };
  rec(a, b, []);
  return out;
}
function embeddedValue(textNode) {
  const raw = textNode.value.replace(/^window\.[A-Za-z_$][\w$]*=/, '');
  try { return JSON.parse(raw); } catch { return raw; }
}

// ---------------------------------------------------------------------------
// DOM-contract projection
// ---------------------------------------------------------------------------
export function contractProjection(tree, contract) {
  const counts = new Map();
  const inc = (k) => counts.set(k, (counts.get(k) || 0) + 1);
  const keyOf = new Map();
  const elKey = (el) => {
    if (keyOf.has(el)) return keyOf.get(el);
    const a = el.attrs || [];
    const cls = (Object.fromEntries(a).class || '').split(' ').filter(c => contract.classes.has(c)).sort();
    const names = a.map(([k]) => k).filter(k => contract.isAttr(k)).sort();
    const k = cls.length || names.length ? `${el.tag}${cls.map(c => '.' + c).join('')}${names.map(nm => `[${nm}]`).join('')}` : null;
    keyOf.set(el, k);
    return k;
  };
  for (const [el, anc] of walkElements(tree)) {
    for (const [k, v] of el.attrs || []) {
      if (k === 'class') { for (const c of v.split(' ')) if (contract.classes.has(c)) inc(`.${c}`); continue; }
      if (contract.isAttr(k)) inc(`@${k}=${v.length > 200 ? v.slice(0, 200) + `…(${v.length})` : v}`);
    }
    const k = elKey(el);
    if (!k) continue;
    let rel = null;
    for (let i = anc.length - 1; i >= 0; i--) { const pk = elKey(anc[i]); if (pk) { rel = `${pk} ${i === anc.length - 1 ? '>' : '>>'} ${k}`; break; } }
    inc(rel || `(top) >> ${k}`);
  }
  return counts;
}
function projectionDiff(pa, pb) {
  const lost = []; const gained = [];
  for (const [k, n] of pa) { const m = pb.get(k) || 0; if (m < n) lost.push(n - m > 1 ? `${k} ×${n - m}` : k); }
  for (const [k, n] of pb) { const m = pa.get(k) || 0; if (m < n) gained.push(n - m > 1 ? `${k} ×${n - m}` : k); }
  return lost.length || gained.length ? { lost, gained } : null;
}
const genericToken = t => t.replace(/=.*$/, '=…').replace(/ ×\d+$/, '');

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------
export function compareHtml(a, b, contract) {
  if (a === b) return { equal: true, kind: 'identical' };
  const ta = parseHtml(a); const tb = parseHtml(b);
  const na = normalizeTree(ta); const nb = normalizeTree(tb);
  const sa = serializeNorm(na); const sb = serializeNorm(nb);
  const pc = projectionDiff(contractProjection(na, contract), contractProjection(nb, contract));
  const contractInfo = pc ? { lost: pc.lost.slice(0, 12), gained: pc.gained.slice(0, 12), lostCount: pc.lost.length, gainedCount: pc.gained.length, signature: [...new Set([...pc.lost.map(t => '-' + genericToken(t)), ...pc.gained.map(t => '+' + genericToken(t))])].slice(0, 6).join(' ') } : null;
  const warn = (ta.warnings.join('|') !== tb.warnings.join('|')) ? { old: ta.warnings.slice(0, 5), new: tb.warnings.slice(0, 5) } : null;
  if (sa === sb) {
    const ca = collapseWs(a); const cb = collapseWs(b);
    let kind; let sub; let x; let y;
    if (ca === cb) { kind = 'whitespace-only'; sub = 'runs'; x = a; y = b; }
    else if (stripTagWs(a) === stripTagWs(b)) { kind = 'whitespace-only'; sub = 'presence'; x = ca; y = cb; }
    else { kind = 'serialization-only'; sub = 'encoding/order'; x = ca; y = cb; }
    const i = firstDiffIndex(x, y);
    const where = pathAt(x, i);
    return { equal: false, kind, subkind: sub, signature: `${kind}(${sub}) @ ${where}`, coarse: `${kind}(${sub})`, before: excerpt(x, i), after: excerpt(y, i), contract: contractInfo, parseWarnings: warn };
  }
  const diffs = domDiffs(na, nb);
  const classes = new Set(diffs.map(d => d.cls));
  const sub = classes.has('element') ? 'element' : classes.has('attribute') ? 'attribute' : 'text';
  const first = diffs[0] || { path: '(unknown)', what: '?' };
  const i = firstDiffIndex(sa, sb);
  return {
    equal: false,
    kind: 'structural',
    subkind: sub,
    signature: `${first.path} :: ${first.what}`,
    coarse: `structural(${sub}) ${first.what.replace(/\s.*$/, '')} ${first.what.includes('@') ? first.what.slice(first.what.indexOf('@')).split(' ')[0] : ''}`.trim(),
    first,
    diffCount: diffs.length,
    diffs: diffs.slice(0, 8),
    normBefore: excerpt(sa, i), normAfter: excerpt(sb, i),
    contract: contractInfo,
    parseWarnings: warn
  };
}

export function compareData(a, b) {
  const d = deepDiff(a, b);
  if (!d) {
    const k = keyOrderDiff(a, b);
    if (!k) return { equal: true, kind: 'identical' };
    return { equal: false, kind: 'serialization-only', subkind: 'key-order', signature: `data ${genericPath(k.path)} (key-order)`, coarse: 'data key-order', old: k.old, new: k.new };
  }
  return { equal: false, kind: 'data', subkind: d.kind, signature: `data ${genericPath(d.path)} (${d.kind})`, coarse: `data (${d.kind})`, path: d.path, old: d.old, new: d.new };
}

export { canonicalJson, embeddedPayload };
