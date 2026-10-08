/**
 * LIN-3124 PR1 (G) — baseline count pins (T5).
 *
 * The D6 §4 baselines, each an exact-equality count over the production source
 * roots (`lib`, `routes`, `server.js`), each with a +1 and a −1 planted
 * offender that must move the count. A count that regresses means a new site in
 * one of the credential surfaces the plan pins.
 *
 * The retired no-read-switch guard's arm (b) pinned the raw-session readers
 * statically; that pin lives here (5 off-session readers).
 *
 * Run with: node --test tests/unit/lin-3124-pr1-count-pins.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadRawSources, loadStrippedSources } from '../fixtures/connection-access-guards.js';

const RAW = loadRawSources();
const REAL = loadStrippedSources();

function total(sources, re) {
  let n = 0;
  for (const src of sources.values()) n += (src.match(re) || []).length;
  return n;
}

function withLine(sources, rel, line) {
  const m = new Map(sources);
  m.set(rel, `${m.get(rel)}\n${line}\n`);
  return m;
}

/** Remove the first line matching `re` (optionally only from files passing `fileRe`). */
function withoutFirstMatch(sources, re, fileRe = null) {
  const m = new Map(sources);
  for (const [rel, src] of m) {
    if (fileRe && !fileRe.test(rel)) continue;
    const lines = src.split('\n');
    const idx = lines.findIndex(l => re.test(l));
    if (idx !== -1) {
      lines.splice(idx, 1);
      m.set(rel, lines.join('\n'));
      return m;
    }
  }
  throw new Error('plant: pattern not found to remove');
}

// ---------------------------------------------------------------------------
// Count functions
// ---------------------------------------------------------------------------

const countTestTokenGuards = (s) => total(s, /accessToken === 'test-token'/g);
const countUrlKeyLookups = (s) => total(s, /w\??\.urlKey === urlKey/g);

function countProviderAuthEdges(sources) {
  let n = 0;
  for (const [rel, src] of sources) {
    if (!/^lib\/providers\/[^/]+\/index\.js$/.test(rel)) continue;
    n += (src.match(/^import .*routes\/[a-z-]*auth/gm) || []).length;
  }
  return n;
}

function countOffSessionReaders(sources) {
  const m = new Map(sources);
  m.delete('lib/workspace-token-resolver.js');
  return total(m, /(selectOwnerWorkspaceToken|selectOwnerWorkspaceRow|selectExpiredOwnerRow|selectOwnerSessionRow|selectAllOwnerSessionRows)\(/g);
}

function countBindingWriters(sources) {
  let link = 0;
  let upsert = 0;
  for (const src of sources.values()) {
    for (const line of src.split('\n')) {
      if (!/function\s+linkProvider/.test(line) && /(^|[^a-zA-Z])linkProvider\(/.test(line)) link++;
      if (!/function\s+upsertWorkspace/.test(line) && /(^|[^a-zA-Z])upsertWorkspace\(/.test(line)) upsert++;
    }
  }
  return { link, upsert, total: link + upsert };
}

const countRawAccessTokenWriters = (s) => total(s, /\.accessToken *=[^=]/g);

/**
 * LIN-3125 Phase 3 (F8): account↔workspace edge writers — every
 * `bindAccountToWorkspace(` CALL (never the method definition in
 * lib/account-workspace-store.js). 3 -> 4: the held `mode=new` picker arm writes
 * the new workspace's owner edge DIRECTLY (no `establishAccount`, so no
 * identityAuthenticatedAt freshness stamp). The reason is stated here and at the
 * call site in routes/held-connection.js.
 */
function countWorkspaceEdgeWriters(sources) {
  let n = 0;
  for (const src of sources.values()) {
    for (const line of src.split('\n')) {
      if (!/function\s+bindAccountToWorkspace/.test(line) && !/async\s+bindAccountToWorkspace/.test(line) && /(^|[^a-zA-Z])bindAccountToWorkspace\(/.test(line)) n++;
    }
  }
  return n;
}

/**
 * LIN-3125 Phase 3 (F1): the EXPLICIT held-entry marker emitters — every
 * `withHeldMarker(` CALL (never the definition in lib/held-connection-entry.js).
 * Byte-stable at exactly 4: the switcher add row, Settings "as a new
 * workspace", and the two server.js add-source redirects (github,
 * github-projects). A fifth call site means an entry the plan did not approve is
 * being captured (or a bare emitter was marked) — the exact F1 class the marker
 * exists to bound.
 */
function countHeldMarkerEmitters(sources) {
  let n = 0;
  for (const src of sources.values()) {
    for (const line of src.split('\n')) {
      if (!/function\s+withHeldMarker/.test(line) && /(^|[^.\w])withHeldMarker\(/.test(line)) n++;
    }
  }
  return n;
}

// ---------------------------------------------------------------------------
// The pins: value + (check, plus, minus)
// ---------------------------------------------------------------------------

const PINS = [
  {
    id: 'test-token-guards',
    label: "accessToken === 'test-token' guards",
    // LIN-3333: 38 -> 37 — the dispatch page's repo-selector block (server.js)
    // carried a `workspace.accessToken === 'test-token'` test-mode guard; it was
    // deleted with the repo= selector.
    expected: 37,
    sources: RAW,
    count: countTestTokenGuards,
    plus: (s) => countTestTokenGuards(withLine(s, 'lib/workspace.js', "const g = ws.accessToken === 'test-token';")),
    minus: (s) => countTestTokenGuards(withoutFirstMatch(s, /accessToken === 'test-token'/)),
  },
  {
    id: 'urlkey-lookups',
    label: 'hand-rolled `w.urlKey === urlKey` lookups',
    expected: 16,
    sources: REAL,
    count: countUrlKeyLookups,
    plus: (s) => countUrlKeyLookups(withLine(s, 'lib/workspace.js', 'if (w.urlKey === urlKey) {}')),
    minus: (s) => countUrlKeyLookups(withoutFirstMatch(s, /w\??\.urlKey === urlKey/)),
  },
  {
    id: 'provider-auth-edges',
    label: 'upward provider index.js -> routes/*-auth import edges (LIN-675)',
    expected: 4,
    sources: REAL,
    count: countProviderAuthEdges,
    plus: (s) => countProviderAuthEdges(withLine(s, 'lib/providers/local/index.js', "import '../routes/auth.js';")),
    minus: (s) => countProviderAuthEdges(withoutFirstMatch(s, /^import .*routes\/[a-z-]*auth/, /^lib\/providers\/[^/]+\/index\.js$/)),
  },
  {
    id: 'off-session-readers',
    label: 'off-session raw-session credential readers',
    // LIN-3124 PR3 checkpoint C: 5 -> 6 — the connection-first arm's
    // owner-scoped provider selection (ownerHeadlessProvider) reads the owner's
    // session row, exactly as D12 specifies. Deliberate growth, not a
    // hand-rolled session scan.
    expected: 7,
    sources: REAL,
    count: countOffSessionReaders,
    plus: (s) => countOffSessionReaders(withLine(s, 'lib/workspace.js', 'const r = selectOwnerSessionRow(s, u, o);')),
    minus: (s) => countOffSessionReaders(withoutFirstMatch(s, /select(OwnerSessionRow|OwnerWorkspaceRow|ExpiredOwnerRow|OwnerWorkspaceToken|AllOwnerSessionRows)\(/, /^(?!lib\/workspace-token-resolver\.js).*/)),
  },
  {
    id: 'binding-writers',
    label: 'binding writers (linkProvider 12 + upsertWorkspace 7)',
    // LIN-3125 Phase 3 (F3): upsertWorkspace 6 -> 7. The held `mode=new` picker
    // arm (`routes/held-connection.js`) builds a fresh container and upserts it
    // before persisting the held binding — the plan's deliberate +1. linkProvider
    // is unchanged at 12 (held mode never calls it; the converter rewrites the
    // binding directly). Reason stated at the call site too.
    expected: { link: 12, upsert: 7, total: 19 },
    sources: REAL,
    count: countBindingWriters,
    plus: (s) => countBindingWriters(withLine(withLine(s, 'lib/workspace.js', "linkProvider(ws, 'x', 'y', {});"), 'lib/workspace.js', 'upsertWorkspace(sess, w);')),
    minus: (s) => countBindingWriters(withoutFirstMatch(s, /(^|[^a-zA-Z])linkProvider\(/, /^(?!lib\/workspace\.js).*/)),
  },
  {
    // LIN-3125 Phase 3 (F8): the account↔workspace edge writers. 3 -> 4 (the
    // held new-workspace owner edge). Deliberate new pin; reason in
    // `countWorkspaceEdgeWriters` and at the call site.
    id: 'workspace-edge-writers',
    label: 'account<->workspace edge writers (bindAccountToWorkspace)',
    expected: 4,
    sources: REAL,
    count: countWorkspaceEdgeWriters,
    plus: (s) => countWorkspaceEdgeWriters(withLine(s, 'lib/workspace.js', "await accountWorkspaceStore.bindAccountToWorkspace('a', 'w');")),
    minus: (s) => countWorkspaceEdgeWriters(withoutFirstMatch(s, /(^|[^a-zA-Z])bindAccountToWorkspace\(/, /^(?!lib\/account-workspace-store\.js).*/)),
  },
  {
    id: 'raw-accesstoken-writers',
    label: 'raw .accessToken assignments',
    expected: 4,
    sources: REAL,
    count: countRawAccessTokenWriters,
    plus: (s) => countRawAccessTokenWriters(withLine(s, 'lib/workspace.js', "ws.accessToken = 'x';")),
    minus: (s) => countRawAccessTokenWriters(withoutFirstMatch(s, /\.accessToken *=[^=]/)),
  },
  {
    // LIN-3125 Phase 3 (F1): the EXPLICIT held-entry marker emitters. Exactly 4 —
    // navbar switcher add row, render-settings "as a new workspace", and the two
    // server.js add-source redirects. Deliberate new pin (the plan's
    // `held-marker-emitters`); the reason is stated here and in §D-F1.
    id: 'held-marker-emitters',
    label: 'explicit held-entry marker emitters (LIN-3125 F1)',
    expected: 4,
    sources: REAL,
    count: countHeldMarkerEmitters,
    plus: (s) => countHeldMarkerEmitters(withLine(s, 'lib/workspace.js', "const u = withHeldMarker('/auth/github', p);")),
    minus: (s) => countHeldMarkerEmitters(withoutFirstMatch(s, /(^|[^.\w])withHeldMarker\(/, /^(?!lib\/held-connection-entry\.js).*/)),
  },
];

describe('LIN-3124 PR1 T5 — baseline count pins', () => {
  for (const pin of PINS) {
    test(`pin ${pin.id}: ${pin.label} is exactly ${JSON.stringify(pin.expected)}`, () => {
      assert.deepEqual(pin.count(pin.sources), pin.expected);
    });

    test(`pin ${pin.id}: planted +1 fails`, () => {
      assert.notDeepEqual(pin.plus(pin.sources), pin.expected);
    });

    test(`pin ${pin.id}: planted −1 fails`, () => {
      assert.notDeepEqual(pin.minus(pin.sources), pin.expected);
    });
  }

  test('meta: every pin has both a +1 and a −1 plant that move the count', () => {
    for (const pin of PINS) {
      assert.notDeepEqual(pin.plus(pin.sources), pin.expected, `${pin.id} +1 plant did not move the count`);
      assert.notDeepEqual(pin.minus(pin.sources), pin.expected, `${pin.id} −1 plant did not move the count`);
    }
  });
});
