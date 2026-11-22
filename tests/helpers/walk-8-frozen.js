// Frozen walk-8 inputs for the replay (LIN-4516, LIN-4520). The comment path that once read these trails is retired:
// the goldens under tests/fixtures/walk-8/comment-path/ are the captured results it gave, kept as evidence. This file
// only loads them.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

export const FIXTURE_DIR = new URL('../fixtures/walk-8/comment-path/', import.meta.url);
export const TICKETS = Object.freeze(['lin-4469', 'lin-4446', 'lin-4450']);
const ISSUE = 'LIN-1';

function sorted(value) {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === 'object') {
    if (value instanceof Map || value instanceof Set) throw new TypeError('comment-path-capture: a Map or Set reached the output');
    return Object.fromEntries(Object.keys(value).sort().filter((k) => value[k] !== undefined).map((k) => [k, sorted(value[k])]));
  }
  return value;
}

/** Sorted-key JSON, two-space indent, one trailing newline: the goldens' byte form. */
export function stableJson(value) {
  return `${JSON.stringify(sorted(value), null, 2)}\n`;
}

// ─── Repeated text, stored once ─────────────────────────────────────────────────────────────────────
//
// The same review's ledger text repeats at every instant after it, and the same comment trail repeats across rows
// (lin-4460's full and unreadable reads; lin-4458's rows are lin-4438's; a seed's prefixes). Each distinct one is
// stored once in the file's `texts` (a ledger's raw text) or `comments` (an input comment), under the first 12 hex of
// its sha-256, and referenced where it was: `ledger.rawRef` for `ledger.raw`, `inputs.commentRefs` for
// `inputs.comments`. Nothing else changes. Read a file through resolveRefs (or loadDerived), which puts each one back.

const refOf = (value) => createHash('sha256').update(typeof value === 'string' ? value : stableJson(value)).digest('hex').slice(0, 12);

/** The document with repeated texts and trails replaced by references, and the tables beside them. */
export function internRefs(doc) {
  const texts = {};
  const comments = {};
  const walk = (v) => {
    if (Array.isArray(v)) return v.map(walk);
    if (!v || typeof v !== 'object') return v;
    const out = {};
    for (const [k, x] of Object.entries(v)) {
      if (k === 'ledger' && x && typeof x === 'object' && typeof x.raw === 'string') {
        const ref = refOf(x.raw);
        texts[ref] = x.raw;
        const { raw, ...rest } = x;
        out[k] = { ...walk(rest), rawRef: ref };
      } else if (k === 'inputs' && x && Array.isArray(x.comments)) {
        const refs = x.comments.map((cm) => { const ref = refOf(cm); comments[ref] = cm; return ref; });
        const { comments: _, ...rest } = x;
        out[k] = { ...walk(rest), commentRefs: refs };
      } else {
        out[k] = walk(x);
      }
    }
    return out;
  };
  const body = walk(doc);
  return { ...body, ...(Object.keys(texts).length ? { texts } : {}), ...(Object.keys(comments).length ? { comments } : {}) };
}

/** internRefs undone: every `rawRef` and `commentRefs` put back as what it names; the tables dropped. */
export function resolveRefs(doc) {
  const { texts = {}, comments = {}, ...body } = doc;
  const walk = (v) => {
    if (Array.isArray(v)) return v.map(walk);
    if (!v || typeof v !== 'object') return v;
    const out = {};
    for (const [k, x] of Object.entries(v)) {
      if (k === 'rawRef') {
        if (!Object.hasOwn(texts, x)) throw new Error(`comment-path-capture: no text ${x}`);
        out.raw = texts[x];
      } else if (k === 'commentRefs') {
        out.comments = x.map((ref) => {
          if (!Object.hasOwn(comments, ref)) throw new Error(`comment-path-capture: no comment ${ref}`);
          return comments[ref];
        });
      } else {
        out[k] = walk(x);
      }
    }
    return out;
  };
  return walk(body);
}

/** A derived file (goldens/*.json, rows.json), read and resolved. */
export function loadDerived(path) {
  return resolveRefs(JSON.parse(readFileSync(new URL(path, FIXTURE_DIR), 'utf8')));
}

// ─── Time ───────────────────────────────────────────────────────────────────────────────────────────


const ms = (iso) => {
  const n = Date.parse(iso);
  if (!Number.isFinite(n)) throw new TypeError(`comment-path-capture: not a time: ${iso}`);
  return n;
};
const iso = (n) => new Date(n).toISOString();

// ─── The frozen inputs, read at an instant ──────────────────────────────────────────────────────────

export function loadInput(name) {
  return JSON.parse(readFileSync(new URL(`${name}.json`, FIXTURE_DIR), 'utf8'));
}

/**
 * Every instant of a ticket, in time order, each with why it is one. Events before the trail's first comment or
 * step are left out: nothing on the trail can have read them.
 */
