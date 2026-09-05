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
  // GET /api/proxy/dispatch (list) intentionally omits sessionId — see the
  // comment on formatDispatchWatch's own dispatchedBy field ("this list
  // response ... re-projects through its own explicit field allow-list").
  // Scoped to the list-item map literal so a whole-file token search can't
  // pass by finding sessionId elsewhere on the route (it appears 5x
  // byte-identical across routes/proxy.js — see assertion 2 below).
  test('/dispatch list item is an exact field set that excludes sessionId', () => {
    const itemsLiteral = sliceBetween(
      proxyDispatchSource,
      'const items = filtered.slice(0, limit).map(i => ({',
      '}));'
    );
    const keys = literalKeys(itemsLiteral);
    assert.deepStrictEqual(
      new Set(keys),
      new Set(['id', 'status', 'promptName', 'kind', 'issueIdentifier', 'issueUrl', 'target',
        'dispatchedAt', 'resolvedAt', 'completedAt', 'feedbackCount']),
      'list item field set drifted — check whether sessionId was added (voyage reconstruction leak) or a field was silently dropped'
    );
    assert.ok(!keys.includes('sessionId'), 'sessionId must not appear on the list item');
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
      'function formatDispatchWatch(item, meta = null) {',
      'function dispatchWatchChanged(baseline, item) {'
    );
    assert.match(fnBody, /\bsessionId:\s*item\.sessionId \|\| null\b/);
  });
});

describe('assertion 3: DUPLICATE_DISPATCH named consistently across the three sources', () => {
  // Authoritative source is the quoted literal in lib/dispatch-factory.js —
  // exactly one occurrence, at the DUPLICATE_DISPATCH_CODE definition. The
  // bare token appears 7x in that file (6 are DUPLICATE_DISPATCH_WINDOW_MS /
  // DUPLICATE_DISPATCH_CODE), so a bare-token match would survive renaming
  // the actual value (plan-review note 3) — assert the quoted form.
  test("lib/dispatch-factory.js defines the quoted 'DUPLICATE_DISPATCH' literal exactly once", () => {
    const quoted = factorySource.match(/'DUPLICATE_DISPATCH'/g) || [];
    assert.strictEqual(quoted.length, 1, 'expected exactly one quoted DUPLICATE_DISPATCH literal (the authoritative definition)');
    assert.match(factorySource, /DUPLICATE_DISPATCH_CODE\s*=\s*'DUPLICATE_DISPATCH'/);
  });

  // The runner doc's Step 7 names the same code. Exact-count, not existence:
  // a bare `match` stays green if 1 of the doc's 2 mentions is renamed away
  // (existence-check blind spot, same class as assertion 5 below).
  test('docs/passage-runner-prompt.md names DUPLICATE_DISPATCH in exactly 2 places', () => {
    const occurrences = (docsSource.match(/\bDUPLICATE_DISPATCH\b/g) || []).length;
    assert.strictEqual(occurrences, 2, 'docs/passage-runner-prompt.md DUPLICATE_DISPATCH mention count drifted');
  });

  // The consumer integration guide names the same code. Exact-count for the
  // same reason: a bare `match` stays green if 1 of the doc's 4 mentions is
  // renamed away.
  test('docs/proxy-integration.md names DUPLICATE_DISPATCH in exactly 4 places', () => {
    const occurrences = (integrationSource.match(/\bDUPLICATE_DISPATCH\b/g) || []).length;
    assert.strictEqual(occurrences, 4, 'docs/proxy-integration.md DUPLICATE_DISPATCH mention count drifted');
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

describe('assertion 5: /dispatch status enum — prose<->prose only (known limit, see comment)', () => {
  // This is a coupling check between two prose copies, not a code-side pin.
  // Each source's occurrence count is pinned exactly (not an existence
  // check), so it fails loud if a single copy drops a value OR if the two
  // docs disagree with each other — dropping/diverging even one of the
  // five real copies (3 in lib/proxy-instructions.js, 2 in
  // docs/proxy-integration.md) goes red. It still does NOT catch a
  // code-side derivation change to the enum (exactly what 7c6d811d was,
  // adding `blocked`) unless that change also reaches a prose copy — that
  // limit is real and stays undisclosed only in the sense that no
  // code-side pin exists at all, which is honest.
  // The runner doc has no status enum of its own — its blocks/blocked-by
  // vocabulary is an unrelated sense and is not a source for this assertion.
  // LIN-2245: the 3 copies used to live inline in routes/proxy.js's
  // /api/proxy/instructions catalog; that catalog moved verbatim to
  // lib/proxy-instructions.js, so routes/proxy.js now carries zero copies.
  const STATUS_ENUM = 'queued|taken|done|failed|blocked|aborted';

  function occurrenceCount(source, needle) {
    return source.split(needle).length - 1;
  }

  test('routes/proxy.js prose states the enum in exactly 0 places (moved to lib/proxy-instructions.js)', () => {
    assert.strictEqual(
      occurrenceCount(proxySource, STATUS_ENUM),
      0,
      'routes/proxy.js prose enum copy count drifted — a copy was added back, or the LIN-2245 move regressed'
    );
  });

  test('lib/proxy-instructions.js prose states the enum in exactly 3 places', () => {
    assert.strictEqual(
      occurrenceCount(instructionsSource, STATUS_ENUM),
      3,
      'lib/proxy-instructions.js prose enum copy count drifted — a copy was added, dropped, or diverged'
    );
  });

  test('docs/proxy-integration.md prose states the same enum in exactly 2 places', () => {
    assert.strictEqual(
      occurrenceCount(integrationSource, STATUS_ENUM),
      2,
      'docs/proxy-integration.md prose enum copy count drifted — a copy was added, dropped, or diverged'
    );
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
  // LIN-679 Stage 4 (LIN-2538): /cost moved wholesale to routes/proxy-compute.js.
  test('routes/proxy-compute.js registers exactly one cost route, with no sibling roll-up path', () => {
    const routeRegistrations = proxyComputeSource.match(/router\.(?:get|post|put|patch|delete)\((?:\[[^\]]*\]|'[^']*')/g) || [];
    const costRegistrations = routeRegistrations.filter(r => r.includes('cost'));
    assert.strictEqual(costRegistrations.length, 1, 'expected exactly one cost-related route registration — a new sibling path was added');
    assert.match(costRegistrations[0], /'\/api\/proxy\/issues\/:identifier\/cost'/);
    assert.match(costRegistrations[0], /'\/api\/proxy\/cost\/:identifier'/);
  });
});

describe('assertion 6: runner doc preamble no longer asserts "no generator yet"', () => {
  test('the preamble names the real generator instead of claiming none exists', () => {
    const preamble = docsSource.slice(0, docsSource.indexOf('\n---\n'));
    assert.doesNotMatch(preamble, /no generator/i, 'preamble reverted to the stale "no generator yet" claim');
    assert.match(preamble, /buildPassageRunnerKickoff/, 'preamble should name the generator that now serves this file');
  });
});
