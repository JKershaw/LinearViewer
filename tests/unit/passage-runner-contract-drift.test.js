/**
 * Passage Runner contract drift monitor (LIN-2165, S5 of LIN-1870).
 *
 * The Passage Runner prompt (docs/passage-runner-prompt.md) hard-codes several
 * claims about the proxy-token surface: field names, status codes, an error
 * code, and its own "the generator now exists" preamble. Nothing fails loudly
 * when one of those copies drifts from the code or from a sibling doc copy —
 * this file is that alarm, for the proxy-token surface only (the non-proxy
 * twin, routes/dispatch.js + docs/dispatch-integration.md, is LIN-2160's).
 *
 * Deliberately NOT `tests/unit/trashed-signal.test.js`'s concatenate-and-assert
 * shape (`proxySource + docsSource`, asserted over the blob): a concatenation
 * assertion can't tell which copy dropped a token, so it stays green when one
 * copy alone drifts. Every source below is read into its own variable and
 * asserted per-source.
 *
 * Coverage is NOT seven equally-strong pins:
 *   - five genuine code-side pins (assertions 1, 2, 3, and both halves of 4)
 *   - one honestly-weak absence pin (claim 2, below) — CORRECTED in beat 2:
 *     the header here previously claimed this was already covered by
 *     tests/unit/proxy-issue-cost-route.test.js. That file's thirteen tests
 *     cover identifier validation, scoping, aliasing, the lineage batch
 *     query, response shape, degraded-store handling and the zeroed-not-404
 *     case — none of them asserts the absence of a voyage-level roll-up.
 *     The claim was false. Pinned here instead, honestly labelled weak.
 *   - one honestly-labelled prose<->prose pin (assertion 5)
 * The already-pinned `issueIdentifier` budget guard (dispatch-factory.test.js:1284,
 * dispatch-store-task-budget.test.js:160/:194) gets no third assertion here either.
 *
 * Structural assertions only — no line numbers. This ticket's own citations
 * rotted mid-flight (:1499 -> :1743), which is the standing argument against
 * pinning by line number rather than by anchor text.
 *
 * Run with: node --test tests/unit/passage-runner-contract-drift.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { DUPLICATE_DISPATCH_CODE } from '../../lib/dispatch-factory.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Five sources, five variables — never concatenated (see file header).
const docsSource = readFileSync(join(__dirname, '../../docs/passage-runner-prompt.md'), 'utf8');
const proxySource = readFileSync(join(__dirname, '../../routes/proxy.js'), 'utf8');
// LIN-679 Stage 4 (LIN-2538): group F compute (including /north-star and
// /cost) moved to its own sub-router, mounted from routes/proxy.js.
const proxyComputeSource = readFileSync(join(__dirname, '../../routes/proxy-compute.js'), 'utf8');
// LIN-679 Stage 6 (LIN-2540): group I, including the shared
// `formatDispatchWatch`/`sessionId` band, moved to its own sub-router.
const proxyDispatchSource = readFileSync(join(__dirname, '../../routes/proxy-dispatch.js'), 'utf8');
const factorySource = readFileSync(join(__dirname, '../../lib/dispatch-factory.js'), 'utf8');
const integrationSource = readFileSync(join(__dirname, '../../docs/proxy-integration.md'), 'utf8');
// LIN-2245: the /api/proxy/instructions catalog (the source of all 3
// routes/proxy.js copies below) moved out to its own pure builder module.
const instructionsSource = readFileSync(join(__dirname, '../../lib/proxy-instructions.js'), 'utf8');

// Slices `source` from `startMarker` up to (not including) `endMarker`. Both
// markers are literal anchor text, not line numbers, so the slice tracks the
// code if it moves and breaks loudly (assert.ok below) if the anchor itself
// is renamed away — which is exactly the drift this file exists to catch.
function sliceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.ok(start !== -1, `start marker not found: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(end !== -1, `end marker not found after start: ${endMarker}`);
  return source.slice(start, end);
}

// Pulls the top-level `key:` names out of an object-literal slice (one level
// of properties, no nested `{`). Skips comment lines and blank lines so an
// inline `// LIN-1470: ...`-style comment can't be mistaken for a field.
function literalKeys(literalText) {
  const keys = [];
  for (const rawLine of literalText.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('//')) continue;
    const m = line.match(/^(\w+):/);
    if (m) keys.push(m[1]);
  }
  return keys;
}

describe('assertion 1+2 (LIN-1870-F4): the sessionId asymmetry, both sides pinned separately', () => {
  // GET /api/proxy/dispatch (list) now carries sessionId and maxTasks
  // (LIN-2975) — a list reader can confirm budget stamping without a
  // per-row detail GET. What stays true is the ALLOW-LIST shape: this is
  // still an explicit field set, never a spread of the stored item (that
  // would leak `bootstrapToken`). Scoped to the list-item map literal so a
  // whole-file token search can't pass by finding sessionId elsewhere on
  // the route (it appears byte-identical in formatDispatchWatch too — see
  // assertion 2 below).
  test('/dispatch list item is an exact field set that includes sessionId, maxTasks, and maxSessionsPerTask', () => {
    const itemsLiteral = sliceBetween(
      proxyDispatchSource,
      'const items = filtered.slice(0, limit).map(i => ({',
      '}));'
    );
    const keys = literalKeys(itemsLiteral);
    assert.deepStrictEqual(
      new Set(keys),
      // LIN-2885: consumerLastSeenAt/consumerPollWarning added deliberately
      // (the consumer poll-recency stamp + derived warning) — not a leak.
      // LIN-2975: sessionId/maxTasks added deliberately, closing the read
      // artifact that misled a passage runner into reporting budget
      // stamping as absent when it was only unread.
      // LIN-2934: maxSessionsPerTask added deliberately — the sibling
      // per-task bound, same list-read visibility rationale as maxTasks.
      // This is an intended contract change, not silent drift.
      new Set(['id', 'status', 'promptName', 'kind', 'issueIdentifier', 'issueUrl', 'target',
        'sessionId', 'maxTasks', 'maxSessionsPerTask', 'dispatchedAt', 'resolvedAt', 'completedAt',
        'feedbackCount', 'consumerLastSeenAt', 'consumerPollWarning']),
      'list item field set drifted — check whether sessionId/maxTasks/maxSessionsPerTask was silently dropped, or a bootstrapToken-shaped leak was added'
    );
    assert.ok(keys.includes('sessionId'), 'sessionId must appear on the list item');
  });

  // The other side of the asymmetry: formatDispatchWatch (the watch/detail
  // read) DOES carry sessionId, deliberately. `sessionId: item.sessionId ||
  // null,` appears 5x byte-identical in routes/proxy.js, so a file-level
  // match would stay green after deleting it from just this one formatter
  // (plan-review note 2). Scoped to the function body via anchor text so it
  // can only see this one copy.
  test('formatDispatchWatch includes sessionId, scoped to its own function body', () => {
    const fnBody = sliceBetween(
      proxyDispatchSource,
      'function formatDispatchWatch(item, meta = null, wakeShadow = null) {',
      'function dispatchWatchChanged(baseline, item) {'
    );
    assert.match(fnBody, /\bsessionId:\s*item\.sessionId \|\| null\b/);
  });
});

describe('assertion 3: DUPLICATE_DISPATCH named consistently across the three sources', () => {
  // LIN-3218 (LIN-3201 A1): the exact-count pins are replaced by a derived
  // relation — the authoritative value is the exported `DUPLICATE_DISPATCH_CODE`
  // constant, and EVERY quoted / named DUPLICATE literal across the three
  // sources must equal it. A stray or misspelt spelling (e.g.
  // DUPLICATE_DISPATCH_OLD) fails; a bare-token match can no longer pass by
  // accidentally containing the right substring. LIN-3218 close-out (review
  // ledger M6b): the token charset includes digits (`[A-Z0-9_]`), so a
  // digit-bearing stray such as `DUPLICATE_DISPATCH_V2` is visible and fails
  // rather than being silently skipped by the matcher.
  const CODE = DUPLICATE_DISPATCH_CODE;

  test('lib/dispatch-factory.js exports DUPLICATE_DISPATCH_CODE and every quoted DUPLICATE literal equals it', () => {
    assert.match(
      factorySource,
      new RegExp(`DUPLICATE_DISPATCH_CODE\\s*=\\s*'${CODE}'`),
      `the exported constant must be the authoritative quoted literal '${CODE}'`
    );
    const quoted = [...factorySource.matchAll(/'DUPLICATE[A-Z0-9_]*'/g)].map((m) => m[0].slice(1, -1));
    assert.ok(quoted.length > 0, 'the factory must quote the code at least once');
    for (const token of quoted) {
      assert.equal(
        token, CODE,
        `lib/dispatch-factory.js quotes '${token}', which is not the exported DUPLICATE_DISPATCH_CODE ('${CODE}')`
      );
    }
  });

  test('every DUPLICATE token named in docs/passage-runner-prompt.md equals the exported constant', () => {
    const tokens = docsSource.match(/DUPLICATE[A-Z0-9_]*/g) || [];
    assert.ok(tokens.length > 0, 'the runner doc must name the code');
    for (const token of tokens) {
      assert.equal(
        token, CODE,
        `docs/passage-runner-prompt.md names ${token}, not the exported code ${CODE}`
      );
    }
  });

  test('every DUPLICATE token named in docs/proxy-integration.md equals the exported constant', () => {
    const tokens = integrationSource.match(/DUPLICATE[A-Z0-9_]*/g) || [];
    assert.ok(tokens.length > 0, 'the integration doc must name the code');
    for (const token of tokens) {
      assert.equal(
        token, CODE,
        `docs/proxy-integration.md names ${token}, not the exported code ${CODE}`
      );
    }
  });
});

describe('assertion 4: north-star reading.state/roadmap.state match the handler literal', () => {
  // Scoped to the GET /api/proxy/north-star handler's own res.json({...})
  // literal — NOT the /api/proxy/instructions prose block describing the
  // same shape, which would match whether or not the handler still agrees
  // (that's the trap this ticket's plan review found).
  // LIN-679 Stage 4 (LIN-2538): the handler moved to routes/proxy-compute.js.
  test('the north-star handler emits reading.state and roadmap.state', () => {
    const handler = sliceBetween(
      proxyComputeSource,
      "router.get('/api/proxy/north-star',",
      'GET /api/proxy/periodicals'
    );
    assert.match(handler, /reading:\s*\{[^}]*\bstate:\s*readingState\b[^}]*\}/s, 'reading.state field drifted in the handler literal');
    assert.match(handler, /roadmap:\s*\{[^}]*\bstate:\s*roadmapState\b[^}]*\}/s, 'roadmap.state field drifted in the handler literal');
  });
});

describe('assertion 5: /dispatch status enum — every occurrence parses to the canonical set', () => {
  // LIN-3218 (LIN-3201 A1): the prose<->prose exact-count pins are replaced by
  // a derived relation. Every enum-shaped run in each source is parsed to a set
  // and must deep-equal the canonical STATUS_ENUM. This now DOES catch a
  // code-side derivation change that reaches any copy (a dropped/added member),
  // which the old count could not. The runner doc has no status enum of its own
  // — its blocks/blocked-by vocabulary is an unrelated sense and is not swept in
  // (see the `queued`+`taken` anchor below). LIN-2245: the copies moved verbatim
  // from routes/proxy.js's /api/proxy/instructions catalog to
  // lib/proxy-instructions.js, so routes/proxy.js carries none.
  // LIN-3364: `closed` joined the wire enum (a row stamped `bookkeeping`).
  const STATUS_ENUM = 'queued|taken|done|failed|blocked|aborted|closed';
  const STATUS_SET = [...STATUS_ENUM.split('|')].sort();

  // Selection rule (deliberately not anchored on any single member, so a run
  // that itself drops `queued` or `taken` is still selected and still fails the
  // set equality): a pipe-run is dispatch-status-enum-shaped iff it has at least
  // two members drawn from the canonical status vocabulary AND is not drawn
  // entirely from the terminal-marker vocabulary. The second clause excludes the
  // unrelated `done|failed|aborted|skipped` terminal run by the principled fact
  // that it uses only terminal markers — not by an exception list of literals.
  const TERMINAL_MARKERS = new Set(['done', 'failed', 'aborted', 'skipped', 'complete']);
  function statusEnumRuns(source) {
    return [...source.matchAll(/[a-z]+(?:\|[a-z]+)+/g)]
      .map((m) => m[0])
      .filter((run) => {
        const parts = run.split('|');
        const canonical = parts.filter((p) => STATUS_SET.includes(p)).length;
        const allTerminal = parts.every((p) => TERMINAL_MARKERS.has(p));
        return canonical >= 2 && !allTerminal;
      });
  }

  // STATED BOUND (LIN-3218 close-out, review ledger B1/B2): the selection rule
  // above needs at least two canonical members, so a prose copy that is DELETED
  // outright, or renamed wholesale to a vocabulary with fewer than two canonical
  // members (e.g. `pending|running`), is not detected as an enum-shaped run at
  // all. B1 (a deleted docs enum copy) was caught by the retired exact-count pin;
  // this derived relation states the bound rather than re-pinning a number.

  test('routes/proxy.js carries no dispatch status enum copy (the LIN-2245 move holds)', () => {
    assert.deepEqual(
      statusEnumRuns(proxySource), [],
      'routes/proxy.js gained a prose enum copy back — a copy was added or the LIN-2245 move regressed'
    );
  });

  test('every dispatch status enum in lib/proxy-instructions.js parses to the canonical set', () => {
    const runs = statusEnumRuns(instructionsSource);
    // Non-vacuity is proven by the planted-offender witness in the PR (drop a
    // member from the lib enum and this test goes red), not by this guard alone.
    assert.ok(runs.length > 0, 'no enum-shaped run found in lib/proxy-instructions.js');
    for (const run of runs) {
      assert.deepEqual(
        [...run.split('|')].sort(), STATUS_SET,
        `lib/proxy-instructions.js enum "${run}" drifted from the canonical STATUS_ENUM`
      );
    }
  });

  test('every dispatch status enum in docs/proxy-integration.md parses to the canonical set', () => {
    const runs = statusEnumRuns(integrationSource);
    assert.ok(runs.length > 0, 'no enum-shaped run found in docs/proxy-integration.md');
    for (const run of runs) {
      assert.deepEqual(
        [...run.split('|')].sort(), STATUS_SET,
        `docs/proxy-integration.md enum "${run}" drifted from the canonical STATUS_ENUM`
      );
    }
  });
});

describe('claim 2 (honestly weak pin): /cost stays a single per-identifier route', () => {
  // Absence-claim, weak by construction — say so rather than upgrading it.
  // This proves only that today there is no SIBLING ROUTE REGISTRATION for a
  // voyage-level cost roll-up (e.g. /api/proxy/voyage/cost,
  // /api/proxy/cost/session/:id). It cannot catch a roll-up folded into this
  // SAME route instead — a `?rollup=1` query param or an internal branch —
  // since that would leave the route's registration, and this count, wholly
  // unchanged. Nothing can honestly pin more than that from source alone.
  // LIN-3218 (LIN-3201 A1): the `length === 1` count is replaced by a derived
  // set equality — the registrations in routes/proxy-compute.js that carry a
  // cost path must be exactly the one array-path registration covering both
  // paths. A second distinct cost registration (a sibling roll-up) adds another
  // element and fails. Still honestly weak: a roll-up folded INTO this same
  // route leaves the registration set unchanged.
  test('routes/proxy-compute.js registers the two cost paths in one registration, no sibling cost registration (weak absence-claim)', () => {
    const costRegistrations = [...proxyComputeSource.matchAll(/router\.(?:get|post|put|patch|delete)\(\s*(\[[^\]]*\]|'[^']*')/g)]
      .map((m) => m[1])
      .filter((paths) => paths.includes('cost'));
    assert.deepEqual(
      costRegistrations,
      ["['/api/proxy/issues/:identifier/cost', '/api/proxy/cost/:identifier']"],
      'expected exactly the one array-path cost registration — a new sibling cost registration was added'
    );
  });
});

describe('assertion 6: runner doc preamble no longer asserts "no generator yet"', () => {
  test('the preamble names the real generator instead of claiming none exists', () => {
    const preamble = docsSource.slice(0, docsSource.indexOf('\n---\n'));
    assert.doesNotMatch(preamble, /no generator/i, 'preamble reverted to the stale "no generator yet" claim');
    assert.match(preamble, /buildPassageRunnerKickoff/, 'preamble should name the generator that now serves this file');
  });
});
