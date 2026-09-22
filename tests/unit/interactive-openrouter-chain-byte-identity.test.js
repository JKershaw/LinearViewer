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
 *     human confirmation — its `resolveProxyLLM` resolves the TOKEN
 *     CREATOR's key via `getWorkspaceOpenRouterKey`, a different mechanism,
 *     not a session field). A new pin below asserts it never imports from
 *     `lib/chat-request.js`, so that scope line is enforced, not just
 *     remembered.
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

  test('routes/workspace-api.js: resolveChatCredential is called exactly 7 times, and the old duplicated ternary shape is gone entirely (LIN-2978)', () => {
    const src = read('routes/workspace-api.js');
    const callCount = (src.match(/resolveChatCredential\s*\(/g) || []).length;
    assert.equal(callCount, 7, `expected exactly 7 resolveChatCredential calls in routes/workspace-api.js (the six full-adopt sites — recommend/recommend-stream/recap/brief/scan/scan-retire — plus the credential-only feedback-title site), found ${callCount}`);
    assert.doesNotMatch(src, /apiKeyToUse = sessionApiKey \|\| \(isFreeTier \? freeTierKey : undefined\)/, 'the old per-site duplicated ternary must be gone — resolveChatCredential now supplies apiKeyToUse directly at each site');
  });

  test('routes/dashboard.js: resolveChatCredential is called exactly twice, and the degrade guard at both sites is now `if (!apiKey)` (LIN-2978)', () => {
    const src = read('routes/dashboard.js');
    const callCount = (src.match(/resolveChatCredential\s*\(/g) || []).length;
    assert.equal(callCount, 2, `expected exactly 2 resolveChatCredential calls in routes/dashboard.js (run-summary + session-summary), found ${callCount}`);
    const guardCount = (src.match(/if \(!apiKey\) \{/g) || []).length;
    assert.equal(guardCount, 2, `expected exactly 2 "if (!apiKey) {" degrade guards in routes/dashboard.js, found ${guardCount}`);
    assert.doesNotMatch(src, /hasPaidEnvKey/, 'hasPaidEnvKey must be fully dead in routes/dashboard.js — its only calls were inside the code this sweep replaced');
  });

  test('routes/proxy.js never imports from lib/chat-request.js — the struck-scope line stays enforced, not just remembered', () => {
    const src = read('routes/proxy.js');
    assert.doesNotMatch(src, /from\s+['"][^'"]*chat-request(?:\.js)?['"]/, 'routes/proxy.js must not import from lib/chat-request.js — its credential chain resolves the token creator\'s key via getWorkspaceOpenRouterKey + resolveProxyLLM, a deliberately separate mechanism');
  });

  test('checkFreeTierGate is called exactly once per full-adopt site (one quota unit per request, LIN-2978)', () => {
    // The ten full-adopt sites this sweep landed. Each is one call site except
    // routes/workspace-api.js, which carries six (recommend GET/SSE, recap,
    // brief, scan, scan-retire) in one file.
    const expectedGateCalls = {
      'routes/next-run.js': 1,
      'routes/ship-biscuit.js': 1,
      'routes/workspace-api.js': 6,
      'routes/dashboard.js': 2,
      'routes/workspace-api-roadmap.js': 1,
    };
    for (const [relPath, expected] of Object.entries(expectedGateCalls)) {
      const src = read(relPath);
      const actual = (src.match(/checkFreeTierGate\s*\(/g) || []).length;
      assert.equal(actual, expected, `${relPath}: expected ${expected} checkFreeTierGate call(s), found ${actual}`);
    }
  });

  test('server.js getOpenRouterSource (the priority predicate behind the footer/settings status) is byte-identical to its pinned shape', () => {
    const src = read('server.js');
    const expected = `function getOpenRouterSource(req) {
  if (req.session.openRouterApiKey) return 'oauth';
  // hasPaidEnvKey() trims, so a blank/whitespace OPENROUTER_API_KEY is NOT
  // classified as a paid \`env\` source (LIN-961). This keeps the operator-facing
  // status honest: the footer can no longer read a blank key as \`env\` while the
  // token-authed proxy path silently runs on the free tier — the exact
  // divergence that hid this bug.
  if (hasPaidEnvKey()) return 'env';
  if (process.env.OPENROUTER_FREE_TIER_KEY || req.session.freeTierEnabled) return 'free';
  return null;
}`;
    assert.ok(src.includes(expected), 'getOpenRouterSource must remain byte-identical — LIN-2412 must never read consent here');
  });

  test('getOpenRouterSource itself never references the new durable consent field', () => {
    const src = read('server.js');
    const fnStart = src.indexOf('function getOpenRouterSource(req) {');
    const fnEnd = src.indexOf('\n}', fnStart);
    const fnBody = src.slice(fnStart, fnEnd);
    assert.doesNotMatch(fnBody, /openRouterDurableConsentAt|getOpenRouterConsent/, 'the interactive source predicate must never read the unattended-use consent field');
  });
});
