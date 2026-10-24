/**
 * Non-opt-in byte-identical assertion (LIN-2412, plan §A.10/§E.7).
 *
 * LIN-2412 adds consent-gated, env-free unattended resolution — it must NOT
 * change the interactive `OAuth > env > free` chain for users who never opt
 * in. This is a scoped source census (same house pattern as
 * tests/unit/observer-pass.test.js's static-import assertion and
 * tests/unit/owner-credential-durable-delete-census.test.js's call-site
 * count): it pins the EXACT six interactive route families' control-flow
 * shape, plus server.js's getOpenRouterSource, so an accidental edit to any
 * of them — not just a deletion — fails loudly here rather than silently
 * shipping alongside this ticket's real (additive) changes.
 *
 * The six families (research §L5 / plan §A.10, corrected to six by F3):
 * routes/task-chat.js, routes/next-run.js, routes/ship-biscuit.js,
 * routes/workspace-api-roadmap.js (two call sites), routes/workspace-api.js,
 * and routes/dashboard.js (two call sites, a distinct shape from the other
 * five — no explicit apiKeyToUse, relies on streamChat's own env default).
 * None of these files, nor server.js's getOpenRouterSource, are touched by
 * this ticket's implementation.
 *
 * routes/workspace-api.js correction (LIN-2412 review finding F3): the
 * original version of this file claimed ONE occurrence of the shared
 * `sessionApiKey || getPaidEnvKey() || freeTierKey` expression in
 * routes/workspace-api.js and stopped there, describing that as the whole
 * family's presence in the file. In fact routes/workspace-api.js carries SIX
 * interactive resolution sites, not one: the pinned occurrence (the
 * feedback-title path) plus FIVE more using a distinct shape,
 * `apiKeyToUse = sessionApiKey || (isFreeTier ? freeTierKey : undefined)`
 * (recommend, recommend-stream, recap, brief, scan). The constraint held as a
 * matter of fact either way (the file was untouched by this ticket's diff),
 * but the claim over-stated what was pinned. This revision pins all six, per
 * the review's "extend the census" resolution rather than merely narrowing
 * the claim's wording.
 *
 * LIN-2650 WS4 addendum: the new scan retire route (routes/workspace-api.js)
 * is a genuine seventh interactive resolution site sharing the SAME
 * `apiKeyToUse` shape as recommend/recommend-stream/recap/brief/scan (it
 * runs its own live re-scan, so it needs the same free-tier clamp) — the
 * census below is updated to six occurrences of that shape, not five. This
 * file otherwise stays a byte-identity pin for LIN-2412's own five families;
 * only the workspace-api.js count moves, and only because a real new site
 * was added in the same shape, not because an existing one changed.
 *
 * LIN-2970 addendum: the chat lane's own two occurrences of the inline
 * expression — routes/task-chat.js's single site, and ONE of
 * routes/workspace-api-roadmap.js's two (its roadmap-CHAT site; roadmap-
 * GENERATE's own site was untouched at the time, named follow-up) — were
 * deliberately extracted into `lib/chat-request.js`'s `resolveChatCredential`,
 * which now carries the ONE canonical copy of the expression those two sites
 * call instead of inlining. This is the exact `OAuth > paid env key > free
 * tier` precedence, relocated, not changed — LIN-2970's own acceptance
 * criterion is "no change to the precedence, only to where it lives".
 *
 * LIN-2978 addendum: the follow-up sweep LIN-2970 deferred lands here. Every
 * site this file used to pin by its OLD hand-derived shape now calls the
 * shared helper instead, so the census below is rewritten rather than just
 * re-numbered:
 *
 *   - Mechanism 1 (the five-file byte-count allow-list) is replaced by a
 *     repo-wide sweep: `SHARED_CHAIN_EXPR` must occur EXACTLY ONCE across
 *     `routes/`, `lib/`, and `server.js` — in `lib/chat-request.js`, its one
 *     canonical definition. A hard-coded five-file list can't catch a new
 *     inline copy appearing anywhere else in the tree; a repo-wide sweep can.
 *   - `routes/workspace-api-roadmap.js` now calls `resolveChatCredential`
 *     TWICE, not once — roadmap-chat (adopted under LIN-2970) AND roadmap-
 *     generate/`resolveRoadmapLLM` (adopted under LIN-2978, credential only;
 *     `chargeRoadmapLayer`'s own per-layer charge is untouched and stays
 *     outside this module). The old assertion encoded LIN-2970's deferral —
 *     "never roadmap-generate" — as a permanent invariant; that was always
 *     scope, not a structural guarantee, and this ticket is what retires it.
 *   - `routes/workspace-api.js`'s old duplicated-ternary shape
 *     (`apiKeyToUse = sessionApiKey || (isFreeTier ? freeTierKey : undefined)`)
 *     is gone from the file entirely (six sites adopted the helper, deleting
 *     it outright); the six full-adopt sites plus the pre-existing
 *     credential-only feedback-title site now show up as SEVEN
 *     `resolveChatCredential` calls in the file — a positive pin on adoption
 *     replaces a negative pin on a duplicate.
 *   - `routes/dashboard.js`'s old three-term degrade guard
 *     (`if (!sessionApiKey && !hasPaidEnvKey() && !freeTierKey)`) is gone;
 *     both call sites now read `if (!apiKey)`, proven behaviour-identical by
 *     plan-review (`hasPaidEnvKey()` is literally `!!getPaidEnvKey()`, so
 *     `!apiKey` is true in exactly the rows the old guard refused).
 *     `resolveChatCredential` is now called exactly twice in the file, and
 *     `hasPaidEnvKey` is fully dead there (dropped from the import).
 *   - `routes/next-run.js` and `routes/ship-biscuit.js` also adopted (full
 *     adopt, gate stays exactly where each site's own guard already put it)
 *     — their old counts of the shared inline expression (1 each) now fold
 *     into the repo-wide sweep above rather than a per-file allow-list entry.
 *   - `routes/proxy.js` is explicitly OUT of this sweep (struck pending
 *     human confirmation — LIN-2427 INVERTED this: it now resolves the
 *     TOKEN CREATOR's key via `getWorkspaceOpenRouterKey` and feeds it to
 *     `resolveChatCredential`). The pin below asserts it imports the shared
 *     resolver.
 *   - A new pin (research's recommendation, `tests/unit/task-chat-route.test.js`'s
 *     existing "once per turn, never per hop" idiom) asserts `checkFreeTierGate`
 *     is called exactly once per full-adopt site across this sweep's files —
 *     the runtime property a source census CAN still catch cheaply, even
 *     though the 429/503 body SHAPE itself is only provable by the e2e specs
 *     (tests/e2e/free-tier.spec.js, roadmap.spec.js, streaming.spec.js,
 *     observation-scan-due.spec.js), never by this file.
 *
 * server.js's getOpenRouterSource pins are untouched — out of scope for both
 * LIN-2970 and LIN-2978.
 *
 * Run with: node --test tests/unit/interactive-openrouter-chain-byte-identity.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import { dashboardUnitFiles, isDashboardUnitFile } from './lib/dashboard-unit.js';
import { workspaceApiUnitFiles, isWorkspaceApiUnitFile } from './lib/workspace-api-unit.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

function read(relPath) {
  return readFileSync(join(ROOT, relPath), 'utf8');
}

// Repo-wide sweep helper (same walk idiom as
// tests/unit/lin-688-undici-not-a-dependency.test.js): every .js file under a
// directory, recursively, skipping nothing special here since routes/ and
// lib/ are both first-party source with no generated subtrees.
function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      out.push(full);
    }
  }
  return out;
}

// The exact shared chain expression the interactive-resolution families used
// to inline by hand. Counting occurrences (not just presence) catches both a
// removed site and an accidental duplicate/new site.
const SHARED_CHAIN_EXPR = 'sessionApiKey || getPaidEnvKey() || freeTierKey';

// The ten full-adopt sites this sweep landed. Each is one call site except
// routes/workspace-api.js, which carries six (recommend GET/SSE, recap,
// brief, scan, scan-retire) in one file.
const expectedGateCalls = {
  'routes/next-run.js': 1,
  'routes/ship-biscuit.js': 1,
  // Six full-adopt sites + the feedback-title live call (LIN-3635).
  'routes/workspace-api.js': 7,
  // LIN-3840: the routes/dashboard.js row (2) is gone. One quota unit per request at the two
  // summary routes is carried by (1) the dashboard-unit rule at the end of this file (exactly 2
  // checkFreeTierGate( calls across the unit), (2) dashboard-routes.test.js 'LIN-3658: a
  // free-tier denial is a 429 ...' at both summary routes (the store is charged exactly once,
  // deepEqual(calls, ['ws-a'])), and (3) dashboard-summary-credential-chain.test.js (d), the
  // allow path: a free-tier key with an allowing store is charged exactly once.
  'routes/workspace-api-roadmap.js': 1,
  'routes/flight-companion.js': 2,
  'routes/task-chat.js': 1,
};

describe('Interactive OpenRouter chain: byte-identity census (LIN-2412 / LIN-2970 / LIN-2978)', () => {
  test('SHARED_CHAIN_EXPR occurs EXACTLY ONCE across routes/, lib/, and server.js — lib/chat-request.js\'s one canonical definition', () => {
    const files = [
      ...walk(join(ROOT, 'routes')),
      ...walk(join(ROOT, 'lib')),
      join(ROOT, 'server.js'),
    ];
    let total = 0;
    const hits = [];
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      const count = src.split(SHARED_CHAIN_EXPR).length - 1;
      if (count > 0) {
        total += count;
        hits.push(`${relative(ROOT, file)} (${count})`);
      }
    }
    assert.equal(total, 1, `expected exactly one occurrence of the shared chain expression across routes/, lib/, and server.js; found ${total} — at: ${hits.join(', ') || 'nowhere'}`);
    assert.deepEqual(hits, ['lib/chat-request.js (1)'], 'the one occurrence must be lib/chat-request.js\'s own canonical definition, not a stray inline copy elsewhere');
  });

  test('LIN-2970/LIN-2978: lib/chat-request.js carries the ONE remaining copy of the expression, and every adopted site calls it instead of inlining', () => {
    const chatRequestSrc = read('lib/chat-request.js');
    const chatRequestCount = chatRequestSrc.split(SHARED_CHAIN_EXPR).length - 1;
    assert.equal(chatRequestCount, 1, 'lib/chat-request.js should carry exactly one occurrence — the canonical definition');

    const taskChatSrc = read('routes/task-chat.js');
    assert.match(taskChatSrc, /resolveChatCredential\s*\(/, 'routes/task-chat.js must call the shared resolver');

    const roadmapSrc = read('routes/workspace-api-roadmap.js');
    const roadmapCallCount = (roadmapSrc.match(/resolveChatCredential\s*\(/g) || []).length;
    assert.equal(roadmapCallCount, 2, 'routes/workspace-api-roadmap.js should call resolveChatCredential exactly TWICE — roadmap-chat (LIN-2970) and roadmap-generate/resolveRoadmapLLM (LIN-2978, credential only; chargeRoadmapLayer stays its own per-layer charge, outside this module)');
  });

  test('routes/workspace-api.js: resolveChatCredential is called exactly 8 times, and the old duplicated ternary shape is gone entirely (LIN-2978, LIN-3238)', () => {
    const src = read('routes/workspace-api.js');
    const callCount = (src.match(/resolveChatCredential\s*\(/g) || []).length;
    assert.equal(callCount, 8, `expected exactly 8 resolveChatCredential calls in routes/workspace-api.js (the six full-adopt sites — recommend/recommend-stream/recap/brief/scan/scan-retire — plus the credential-only feedback-title site, plus the LIN-3238 feedback dispatch-point re-derivation for the free-tier run gate), found ${callCount}`);
    assert.doesNotMatch(src, /apiKeyToUse = sessionApiKey \|\| \(isFreeTier \? freeTierKey : undefined\)/, 'the old per-site duplicated ternary must be gone — resolveChatCredential now supplies apiKeyToUse directly at each site');
  });

  // LIN-3840: 'routes/dashboard.js: resolveChatCredential is called exactly twice, and the
  // degrade guard at both sites is now `if (!apiKey)` (LIN-2978)' is gone. The two counts are
  // carried by behaviour: dashboard-summary-credential-chain.test.js drives POST run-summary and
  // POST session-summary over HTTP (no key anywhere -> 503 "AI summaries are not configured"; the
  // session key wins and is never free-tier; the paid env key alone; the free-tier key alone,
  // charged once). The absence (hasPaidEnvKey dead) is the dashboard-unit rule at the end of
  // this file, over every unit file.

  test('routes/proxy.js resolves through lib/chat-request.js (LIN-2427)', () => {
    const src = read('routes/proxy.js');
    assert.match(src, /import \{[^}]*resolveChatCredential[^}]*\} from\s+['"][^'"]*chat-request(?:\.js)?['"]/, 'routes/proxy.js must import resolveChatCredential from lib/chat-request.js');
  });

  test('checkFreeTierGate is called exactly once per full-adopt site (one quota unit per request, LIN-2978)', () => {
    for (const [relPath, expected] of Object.entries(expectedGateCalls)) {
      const src = read(relPath);
      const actual = (src.match(/checkFreeTierGate\s*\(/g) || []).length;
      assert.equal(actual, expected, `${relPath}: expected ${expected} checkFreeTierGate call(s), found ${actual}`);
    }
  });

  // LIN-3840: 'expectedGateCalls is exhaustive — every routes/ or lib/ file calling
  // checkFreeTierGate( is pinned' is now the dashboard-unit rule at the end of this file: a file
  // calling checkFreeTierGate( must be a key of expectedGateCalls OR a dashboard-unit file, and
  // the unit holds exactly 2 calls in total.

  // LIN-3658: the priority ladder moved to lib/chat-request.js
  // (resolveOpenRouterSource); its behavioural replacement for the old byte pin
  // is tests/unit/chat-request-free-tier-rule.test.js (truth table + the home
  // never reads the LIN-2412 consent fields). Here: server.js keeps only a
  // delegate that hands the home exactly the two session fields.
  test('server.js getOpenRouterSource is a delegate to the home, passing only the key and the flag', () => {
    const src = read('server.js');
    const expected = `function getOpenRouterSource(req) {
  return resolveOpenRouterSource({ sessionApiKey: req.session.openRouterApiKey, sessionFreeTierFlag: req.session.freeTierEnabled });
}`;
    assert.ok(src.includes(expected), 'getOpenRouterSource must stay a one-expression delegate — LIN-2412 must never read consent here');
  });

  test('getOpenRouterSource itself never references the new durable consent field', () => {
    const src = read('server.js');
    const fnStart = src.indexOf('function getOpenRouterSource(req) {');
    const fnEnd = src.indexOf('\n}', fnStart);
    const fnBody = src.slice(fnStart, fnEnd);
    assert.doesNotMatch(fnBody, /openRouterDurableConsentAt|getOpenRouterConsent/, 'the interactive source predicate must never read the unattended-use consent field');
  });
});

// ─── LIN-3840: the dashboard routes as one unit ──────────────────────────────
// The rules below judge routes/dashboard.js and routes/dashboard-*.js as a set
// (tests/unit/lib/dashboard-unit.js), so the createDashboardRoutes rebuild
// (LIN-3742) can place its code anywhere in the unit. Pure functions over a
// `{ rel: src }` map, so the witnesses plant violations in a synthetic map.
const UNIT_GATE_CALLS = 2; // run-summary + session-summary: one quota unit per request, kept EXACT
const readMap = (rels) => Object.fromEntries(rels.map(rel => [rel, read(rel)]));

/** `{rel: src}` for the dashboard unit, and for every routes/ + lib/ file. */
const liveUnit = () => readMap(dashboardUnitFiles(ROOT));
const liveGateScope = () => readMap([...walk(join(ROOT, 'routes')), ...walk(join(ROOT, 'lib'))]
  .map(f => relative(ROOT, f)).filter(rel => rel !== 'lib/chat-request.js'));

/** hasPaidEnvKey must stay dead in every unit file. */
function paidEnvKeyProblems(unit) {
  return Object.entries(unit).filter(([, src]) => /hasPaidEnvKey/.test(src)).map(([rel]) => `${rel}: hasPaidEnvKey is back`);
}

/**
 * A file calling checkFreeTierGate( must be a key of `expected` or a dashboard-unit
 * file, and the unit holds EXACTLY UNIT_GATE_CALLS calls in total.
 */
function gateCallProblems(files, expected) {
  const problems = [];
  const calls = (src) => (src.match(/checkFreeTierGate\s*\(/g) || []).length;
  let unitCalls = 0;
  const outside = [];
  for (const [rel, src] of Object.entries(files)) {
    const n = calls(src);
    if (!n) continue;
    if (isDashboardUnitFile(rel)) unitCalls += n;
    else outside.push(rel);
  }
  if (unitCalls !== UNIT_GATE_CALLS) problems.push(`the dashboard unit holds ${unitCalls} checkFreeTierGate( call(s), expected exactly ${UNIT_GATE_CALLS}`);
  const listed = Object.keys(expected).filter(rel => !isDashboardUnitFile(rel));
  // LIN-3861: the workspace-API unit is a second unit. A W file is not "unlisted" (its calls are
  // counted by the W rule below, exactly); a keyed W file (roadmap's row) is still checked as listed.
  for (const rel of outside) if (!listed.includes(rel) && !isWorkspaceApiUnitFile(rel)) problems.push(`${rel} calls checkFreeTierGate( but is neither a key of expectedGateCalls nor a dashboard-unit file`);
  for (const rel of listed) if (!outside.includes(rel)) problems.push(`${rel} is a key of expectedGateCalls but no longer calls checkFreeTierGate(`);
  return problems;
}

describe('LIN-3840: dashboard unit rules (B pins, each with planted-violation witnesses)', () => {
  const planted = (files, rel, fn) => ({ ...files, [rel]: fn(files[rel] ?? '') });

  test('hasPaidEnvKey is absent from every dashboard-unit file', () => {
    assert.deepEqual(paidEnvKeyProblems(liveUnit()), []);
  });

  test('witness: hasPaidEnvKey planted in a unit file other than routes/dashboard.js fails', () => {
    const unit = planted(liveUnit(), 'routes/dashboard-x.js', () => 'import { hasPaidEnvKey } from "../lib/openrouter.js";\nexport const k = hasPaidEnvKey();\n');
    assert.deepEqual(paidEnvKeyProblems(unit), ['routes/dashboard-x.js: hasPaidEnvKey is back']);
  });

  const expectedOutsideUnit = Object.fromEntries(Object.entries(expectedGateCalls).filter(([rel]) => !isDashboardUnitFile(rel)));

  test('checkFreeTierGate( : the unit holds exactly 2 calls, every other caller is a key of expectedGateCalls', () => {
    assert.deepEqual(gateCallProblems(liveGateScope(), expectedOutsideUnit), []);
  });

  // The unit is judged whole, wherever its two calls sit. These cases are built from synthetic
  // unit files (never from the live text of routes/dashboard.js, which is free to move).
  const CALL = 'const check = await checkFreeTierGate({ isFreeTier, urlKey, freeTierStore });\n';
  const withUnit = (unit) => {
    const files = Object.fromEntries(Object.entries(liveGateScope()).filter(([rel]) => !isDashboardUnitFile(rel)));
    return { ...files, ...unit };
  };

  test('the two calls may sit in one unit file or be split across unit files (the unit is judged whole)', () => {
    assert.deepEqual(gateCallProblems(withUnit({ 'routes/dashboard.js': CALL + CALL }), expectedOutsideUnit), []);
    assert.deepEqual(gateCallProblems(withUnit({ 'routes/dashboard.js': CALL, 'routes/dashboard-body.js': CALL }), expectedOutsideUnit), []);
  });

  test('witness: a third call planted in a unit file fails', () => {
    const files = withUnit({ 'routes/dashboard.js': CALL + CALL + CALL });
    assert.deepEqual(gateCallProblems(files, expectedOutsideUnit), ['the dashboard unit holds 3 checkFreeTierGate( call(s), expected exactly 2']);
  });

  test('witness: a call in a new routes/dashboard-x.js counts toward the unit and fails', () => {
    const files = withUnit({ 'routes/dashboard.js': CALL + CALL, 'routes/dashboard-x.js': CALL });
    assert.deepEqual(gateCallProblems(files, expectedOutsideUnit), ['the dashboard unit holds 3 checkFreeTierGate( call(s), expected exactly 2']);
  });

  test('witness: a call removed from the unit fails', () => {
    assert.deepEqual(gateCallProblems(withUnit({ 'routes/dashboard.js': CALL }), expectedOutsideUnit), ['the dashboard unit holds 1 checkFreeTierGate( call(s), expected exactly 2']);
  });

  test('witness: a call in an unlisted non-unit file fails', () => {
    const files = planted(liveGateScope(), 'routes/zz-unlisted.js', () => 'await checkFreeTierGate({});\n');
    assert.deepEqual(gateCallProblems(files, expectedOutsideUnit), ['routes/zz-unlisted.js calls checkFreeTierGate( but is neither a key of expectedGateCalls nor a dashboard-unit file']);
  });
});

// ─── LIN-3861: the workspace-API routes as one unit ──────────────────────────
// The rules below judge routes/workspace-api.js and routes/workspace-api-*.js as a set
// (tests/unit/lib/workspace-api-unit.js), so the LIN-2246 moves can place the route groups in
// any unit file. Pure functions over a `{ rel: src }` map: the live tests read the unit through
// workspaceApiUnitFiles; the witnesses plant violations in a synthetic map (never in live text).
// The counts stay EXACT over the unit (an allow-list, never "at least one"). Roadmap keeps its own
// pinned rows (expectedGateCalls' roadmap row, the `resolveChatCredential` count of 2 above): no
// planned move touches it, so the W counts below exclude it by file name.
const W_GATE_CALLS = 7;            // recommend GET, recommend stream, recap, brief, scan, scan retire, feedback title
const W_CHAT_CREDENTIAL_CALLS = 8; // the 6 full-adopt sites + feedback title + the LIN-3238 feedback re-derivation
const ROADMAP_FILE = 'routes/workspace-api-roadmap.js';
const OLD_APIKEY_TERNARY = /apiKeyToUse = sessionApiKey \|\| \(isFreeTier \? freeTierKey : undefined\)/;
const liveWorkspaceUnit = () => readMap(workspaceApiUnitFiles(ROOT));
const countOf = (src, re) => (src.match(re) || []).length;

/** The W files other than those keyed in `expected` hold EXACTLY W_GATE_CALLS checkFreeTierGate( calls in total. */
function workspaceGateProblems(files, expected) {
  let total = 0;
  for (const [rel, src] of Object.entries(files)) {
    if (isWorkspaceApiUnitFile(rel) && !(rel in expected)) total += countOf(src, /checkFreeTierGate\s*\(/g);
  }
  return total === W_GATE_CALLS ? [] : [`the workspace-API unit (files not keyed in expectedGateCalls) holds ${total} checkFreeTierGate( call(s), expected exactly ${W_GATE_CALLS}`];
}

/** resolveChatCredential( exactly W_CHAT_CREDENTIAL_CALLS over the W files other than roadmap; the old ternary absent from EVERY W file. */
function workspaceChatCredentialProblems(unit) {
  const problems = [];
  let total = 0;
  for (const [rel, src] of Object.entries(unit)) {
    if (rel !== ROADMAP_FILE) total += countOf(src, /resolveChatCredential\s*\(/g);
    if (OLD_APIKEY_TERNARY.test(src)) problems.push(`${rel}: the old per-site duplicated apiKeyToUse ternary is back`);
  }
  if (total !== W_CHAT_CREDENTIAL_CALLS) problems.push(`the workspace-API unit (other than roadmap) holds ${total} resolveChatCredential( call(s), expected exactly ${W_CHAT_CREDENTIAL_CALLS}`);
  return problems;
}

describe('LIN-3861: workspace-API unit rules (B pins, each with planted-violation witnesses)', () => {
  // expectedGateCalls without its routes/workspace-api.js row: that row is carried by the W rule.
  const expectedOutsideW = Object.fromEntries(Object.entries(expectedGateCalls).filter(([rel]) => rel !== 'routes/workspace-api.js'));
  const GATE = 'const gate = await checkFreeTierGate({ isFreeTier, urlKey, freeTierStore });\n';
  const CRED = 'const { apiKey: apiKeyToUse } = resolveChatCredential({ sessionApiKey, freeTierKey });\n';
  const gateFiles = (unit) => ({ ...Object.fromEntries(Object.entries(liveGateScope()).filter(([rel]) => !isWorkspaceApiUnitFile(rel))), ...unit });
  const gateUnit = (n) => GATE.repeat(n);

  test('checkFreeTierGate( : the W files not keyed in expectedGateCalls hold exactly 7 calls in total', () => {
    assert.deepEqual(workspaceGateProblems(liveGateScope(), expectedOutsideW), []);
  });

  test('the live scope passes the extended gateCallProblems with the W row dropped (a W file is not unlisted)', () => {
    assert.deepEqual(gateCallProblems(liveGateScope(), Object.fromEntries(Object.entries(expectedOutsideW).filter(([rel]) => !isDashboardUnitFile(rel)))), []);
  });

  test('witness: the 7 may sit in one W file or be split across W files (the unit is judged whole)', () => {
    assert.deepEqual(workspaceGateProblems(gateFiles({ 'routes/workspace-api.js': gateUnit(7) }), expectedOutsideW), []);
    assert.deepEqual(workspaceGateProblems(gateFiles({ 'routes/workspace-api.js': gateUnit(4), 'routes/workspace-api-x.js': gateUnit(3) }), expectedOutsideW), []);
    assert.deepEqual(workspaceGateProblems(gateFiles({ 'routes/workspace-api-a.js': gateUnit(7), [ROADMAP_FILE]: GATE }), expectedOutsideW), [], 'roadmap keeps its own keyed row and is not counted');
  });

  test('witness: an 8th call planted in a synthetic W file fails', () => {
    const files = gateFiles({ 'routes/workspace-api.js': gateUnit(7), 'routes/workspace-api-x.js': GATE });
    assert.deepEqual(workspaceGateProblems(files, expectedOutsideW), ['the workspace-API unit (files not keyed in expectedGateCalls) holds 8 checkFreeTierGate( call(s), expected exactly 7']);
  });

  test('witness: a call removed from the unit fails', () => {
    assert.deepEqual(workspaceGateProblems(gateFiles({ 'routes/workspace-api.js': gateUnit(6) }), expectedOutsideW),
      ['the workspace-API unit (files not keyed in expectedGateCalls) holds 6 checkFreeTierGate( call(s), expected exactly 7']);
  });

  test('witness: a roadmap call does not count toward the 7, and an extra one there is the roadmap row\'s to catch', () => {
    const files = gateFiles({ 'routes/workspace-api.js': gateUnit(7), [ROADMAP_FILE]: gateUnit(2) });
    assert.deepEqual(workspaceGateProblems(files, expectedOutsideW), []);
    assert.deepEqual(gateCallProblems(files, Object.fromEntries(Object.entries(expectedOutsideW).filter(([rel]) => !isDashboardUnitFile(rel)))), [], 'gateCallProblems takes no count for the roadmap key (its count is the :156-class row pinned in the test above)');
  });

  test('witness: a call in a synthetic routes/workspace-api-x.js is not "unlisted" but counts toward W, and a call in an unlisted non-unit file still fails', () => {
    const files = gateFiles({ 'routes/workspace-api.js': gateUnit(7), 'routes/workspace-api-x.js': GATE });
    const outsideDashboard = Object.fromEntries(Object.entries(expectedOutsideW).filter(([rel]) => !isDashboardUnitFile(rel)));
    assert.ok(!gateCallProblems({ ...liveGateScope(), 'routes/workspace-api-x.js': GATE }, outsideDashboard).some(p => p.includes('workspace-api-x.js')), 'a W file is not "unlisted"');
    assert.equal(workspaceGateProblems(files, expectedOutsideW).length, 1, 'but it counts toward (and fails) the W total');
    assert.deepEqual(gateCallProblems({ ...liveGateScope(), 'routes/zz-unlisted.js': GATE }, outsideDashboard),
      ['routes/zz-unlisted.js calls checkFreeTierGate( but is neither a key of expectedGateCalls nor a dashboard-unit file']);
  });

  test('resolveChatCredential( : exactly 8 over the W files other than roadmap, and the old ternary is absent from every W file', () => {
    assert.deepEqual(workspaceChatCredentialProblems(liveWorkspaceUnit()), []);
  });

  test('witness: the 8 may be split across W files; roadmap\'s own calls are not counted here', () => {
    assert.deepEqual(workspaceChatCredentialProblems({ 'routes/workspace-api.js': CRED.repeat(5), 'routes/workspace-api-x.js': CRED.repeat(3), [ROADMAP_FILE]: CRED.repeat(2) }), []);
  });

  test('witness: a 9th call planted in a synthetic W file fails; a call removed fails', () => {
    assert.deepEqual(workspaceChatCredentialProblems({ 'routes/workspace-api.js': CRED.repeat(8), 'routes/workspace-api-x.js': CRED }),
      ['the workspace-API unit (other than roadmap) holds 9 resolveChatCredential( call(s), expected exactly 8']);
    assert.deepEqual(workspaceChatCredentialProblems({ 'routes/workspace-api.js': CRED.repeat(7) }),
      ['the workspace-API unit (other than roadmap) holds 7 resolveChatCredential( call(s), expected exactly 8']);
  });

  test('witness: the old ternary planted in routes/workspace-api-x.js (or roadmap) fails', () => {
    const ternary = 'const apiKeyToUse = sessionApiKey || (isFreeTier ? freeTierKey : undefined);\n';
    assert.deepEqual(workspaceChatCredentialProblems({ 'routes/workspace-api.js': CRED.repeat(8), 'routes/workspace-api-x.js': ternary }),
      ['routes/workspace-api-x.js: the old per-site duplicated apiKeyToUse ternary is back']);
    assert.deepEqual(workspaceChatCredentialProblems({ 'routes/workspace-api.js': CRED.repeat(8), [ROADMAP_FILE]: ternary }),
      [`${ROADMAP_FILE}: the old per-site duplicated apiKeyToUse ternary is back`]);
  });
});
