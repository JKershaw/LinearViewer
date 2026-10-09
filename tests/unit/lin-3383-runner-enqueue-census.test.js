/**
 * LIN-3383 — runner-enqueue census (S1.4 of LIN-2954; house pattern: the C1
 * scanner in lin-3136-enqueue-census.test.js).
 *
 * A Node file walk (not `rg`) over `routes/`, `lib/` and `server.js` that
 * re-bounds, at the current tree, every place that can write a runner-consumed
 * queue row, and fails on any member missing from the table below. Each row
 * carries a verdict (`gated | token-scoped`) and a reason; a gated row also names
 * the handler/function whose text must hold the gate before the sink.
 *
 * Sinks scanned: createDispatchItem( · dispatchSessionFollowUp( ·
 * expandCascadeAborts( · addFeedback( · _mintWake( · .addItem(.
 * Execute-mode callers scanned: runAgentTurn(. A caller's mode comes from its
 * TABLE ROW, never from a literal in the call: Task Chat's call contains
 * `followUpMode: 'propose'` inside a conditional spread, so a text rule would
 * classify the one ordinary-turn execute caller as propose-only.
 *
 * Mutation witnesses run the same scanners over planted copies of the tree.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '../..');

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith('.js')) out.push(p);
  }
  return out;
}

function loadTree() {
  const files = [...walk(join(REPO, 'routes')), ...walk(join(REPO, 'lib')), join(REPO, 'server.js')];
  return files.map(p => ({ file: relative(REPO, p).split('\\').join('/'), src: readFileSync(p, 'utf8') }));
}

const GATE = 'resolveRunnerOwnerRefusal(';

// The seams themselves: the factory and the store implement the sinks and serve
// proxy/orchestrator callers with no session, which is exactly why the gate is
// not inside them (plan, "Do not place the gate inside createDispatchItem").
const IMPLEMENTATION_FILES = new Set(['lib/dispatch-factory.js', 'lib/dispatch-store.js']);

const SINK_RE = /\b(createDispatchItem|dispatchSessionFollowUp|expandCascadeAborts|addFeedback|_mintWake)\(|\.addItem\(/g;

/** Non-comment, non-import, non-definition sink hits: [{file, line, sink}]. */
function findSinks(tree) {
  const hits = [];
  for (const { file, src } of tree) {
    if (IMPLEMENTATION_FILES.has(file)) continue;
    src.split('\n').forEach((text, i) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(text) || /^\s*import\b/.test(text)) return;
      if (/\b(?:export\s+)?(?:async\s+)?function\s+\w+\s*\(/.test(text)) return; // a definition, not a call
      for (const m of text.matchAll(SINK_RE)) {
        hits.push({ file, line: i + 1, sink: m[1] || 'addItem' });
      }
    });
  }
  return hits;
}

/**
 * The member table. `count` is how many hits of `sink` the file holds.
 * gated rows: `handler` locates the route registration (its text runs to the
 * next top-level `router.` registration), `before` lists the call tokens that
 * must each be preceded, inside that text, by GATE (or the row's own `gate`).
 */
const MEMBERS = [
  { id: 1, file: 'routes/dispatch.js', sink: 'createDispatchItem', count: 1, verdict: 'gated',
    reason: "POST /api/dispatch: every browser launcher (Dispatch page, ladder, Home, swipe, kickoff prompts, reply box, close-out press) lands here",
    handler: "router.post('/workspace/:urlKey/api/dispatch'", before: ['createDispatchItem('] },
  { id: 2, file: 'routes/dispatch.js', sink: 'expandCascadeAborts', count: 1, verdict: 'gated',
    reason: 'cascade abort expansion writes runner-consumed abort rows without the factory; same handler, gate runs first',
    handler: "router.post('/workspace/:urlKey/api/dispatch'", before: ['expandCascadeAborts('] },
  { id: '3-4', file: 'routes/workspace-api.js', sink: 'createDispatchItem', count: 2, verdict: 'gated',
    reason: 'feedback triage + autopilot lanes; the two helper callers below are the only entry and sit in the feedback handler',
    handler: "router.post('/workspace/:urlKey/api/feedback'", before: ['enqueueFeedbackTriage(', 'enqueueFeedbackAutopilot('],
    onlyCalledIn: ['enqueueFeedbackTriage(', 'enqueueFeedbackAutopilot('] },
  { id: 5, file: 'lib/follow-up-dispatch.js', sink: 'createDispatchItem', count: 1, verdict: 'gated',
    reason: 'dispatchSessionFollowUp: fail-closed owner seam after derivation, before the factory',
    fn: 'export async function dispatchSessionFollowUp(', before: ['createDispatchItem('] },
  { id: '5a', file: 'routes/dashboard.js', sink: 'dispatchSessionFollowUp', count: 1, verdict: 'gated',
    reason: 'dashboard run-proposal Apply: route-level owner check BEFORE the CAS claim (LIN-3254 refused-before-claiming), seam inside as backstop',
    handler: "router.post('/workspace/:urlKey/api/run/:runId/proposals/:id/apply'", before: ['runProposalsStore.apply(', 'dispatchSessionFollowUp('],
    passes: ['ownerCheck:', 'workspaceId:'] },
  { id: '5b', file: 'routes/flight-companion.js', sink: 'dispatchSessionFollowUp', count: 1, verdict: 'gated',
    reason: 'Flight Companion approve-follow-up: the seam is the gate (fails closed on missing owner params)',
    handler: "router.post('/workspace/:urlKey/api/flight-companion/approve-follow-up'", before: [],
    passes: ['ownerCheck:', 'workspaceId:'] },
  { id: 6, file: 'lib/chat-tools.js', sink: 'createDispatchItem', count: 1, verdict: 'gated',
    reason: 'send_follow_up (execute mode): injected enqueueGuard, absent guard refuses',
    fn: 'send_follow_up: async (', before: ['enqueueGuard(', 'createDispatchItem('], gateToken: 'enqueueGuard(', failClosed: "typeof enqueueGuard !== 'function'" },
  { id: 7, file: 'routes/collective.js', sink: 'createDispatchItem', count: 1, verdict: 'gated',
    reason: 'Collective start: per participant workspace, a seat the session does not own is ok:false',
    handler: "router.post('/workspace/:urlKey/collective/start'", before: ['createDispatchItem('] },
  { id: 8, file: 'routes/proxy-dispatch.js', sink: 'createDispatchItem', count: 3, verdict: 'token-scoped',
    reason: "proxy token routes behind requireGrant('dispatch') (LIN-3136); pinned by lin-3136-enqueue-census C1; the grant is minted owner-checked only" },
  { id: 8, file: 'routes/proxy-dispatch.js', sink: 'expandCascadeAborts', count: 1, verdict: 'token-scoped',
    reason: "proxy abort/cascade, same requireGrant('dispatch') POST" },
  { id: 8, file: 'routes/proxy-kickoff.js', sink: 'createDispatchItem', count: 1, verdict: 'token-scoped',
    reason: "proxy kickoff behind requireGrant('dispatch') (LIN-3136 C1)" },
  { id: 9, file: 'routes/dispatch.js', sink: 'addFeedback', count: 1, verdict: 'token-scoped',
    reason: 'runner/feedback-token write; comes from the runner itself, not a session' },
  { id: 9, file: 'routes/proxy-runner.js', sink: 'addFeedback', count: 1, verdict: 'token-scoped',
    reason: 'runner token write; comes from the runner itself, not a session' }
];

/** Execute-mode caller table. `mode` is authoritative (see header). */
const AGENT_TURN_CALLERS = [
  { file: 'routes/task-chat.js', index: 0, mode: 'execute-unless-run-scoped',
    reason: 'ordinary (not run-scoped) Task Chat turn runs send_follow_up in execute mode' },
  { file: 'routes/flight-companion.js', index: 0, mode: 'execute',
    reason: 'FC turn ("reply"): user-initiated turn executes send_follow_up' },
  { file: 'routes/flight-companion.js', index: 1, mode: 'propose',
    reason: "FC boot: followUpMode 'propose'" },
  { file: 'routes/proxy-flight-companion.js', index: 0, mode: 'propose',
    reason: "proxy FC: propose-only, pinned by lin-3136-enqueue-census C4" }
];

// ── scanning helpers ─────────────────────────────────────────────────────────

/** Text of the route registration beginning at `marker`, to the next `  router.`. */
function handlerText(src, marker) {
  const start = src.indexOf(marker);
  if (start === -1) return null;
  const rest = src.slice(start + marker.length);
  const next = rest.search(/\n  router\.(get|post|put|patch|delete|use)\(|\n  return router/);
  return src.slice(start, next === -1 ? src.length : start + marker.length + next);
}

function functionText(src, marker) {
  const start = src.indexOf(marker);
  if (start === -1) return null;
  // A function body ends at the next line that starts at the same-or-lower
  // indent with a closing brace, followed by a blank/definition; the table only
  // needs the span up to the sink, so the rest of the file is a safe upper bound
  // for "gate precedes sink" (it can only ever be satisfied by an earlier token).
  return src.slice(start);
}

/** The full text of a call beginning at `from` (balanced parens). */
function callBlock(src, from) {
  const open = src.indexOf('(', from);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')') { depth--; if (depth === 0) return src.slice(from, i + 1); }
  }
  return src.slice(from);
}

function gatedBefore(text, tokens, gate) {
  const violations = [];
  for (const token of tokens) {
    let from = 0; let seen = 0;
    for (;;) {
      const at = text.indexOf(token, from);
      if (at === -1) break;
      // skip a definition of the token (e.g. `async function enqueueFeedbackTriage(`)
      const lineStart = text.lastIndexOf('\n', at) + 1;
      const isDef = /function\s+\w*$/.test(text.slice(lineStart, at));
      if (!isDef) {
        seen++;
        const g = text.indexOf(gate);
        if (g === -1 || g > at) violations.push(`${token} is reached before ${gate}`);
      }
      from = at + token.length;
    }
    if (seen === 0) violations.push(`${token} was not found where the table says it is`);
  }
  return violations;
}

function scanSinks(tree) {
  const v = [];
  const hits = findSinks(tree);
  const counts = {};
  for (const h of hits) { const k = `${h.file}|${h.sink}`; counts[k] = (counts[k] || 0) + 1; }
  const listed = new Set();
  for (const m of MEMBERS) {
    const k = `${m.file}|${m.sink}`;
    if (listed.has(k)) v.push(`table lists ${k} twice`);
    listed.add(k);
    if (!m.reason) v.push(`${k}: a row needs a recorded reason`);
    if (!['gated', 'token-scoped'].includes(m.verdict)) v.push(`${k}: verdict must be gated | token-scoped`);
    if ((counts[k] || 0) !== m.count) v.push(`${k}: expected ${m.count} sink(s), found ${counts[k] || 0}`);
  }
  for (const k of Object.keys(counts)) {
    if (!listed.has(k)) {
      const lines = hits.filter(h => `${h.file}|${h.sink}` === k).map(h => h.line).join(',');
      v.push(`${k}: an unlisted session-reachable sink (line ${lines}) — give it a gated | token-scoped verdict`);
    }
  }

  for (const m of MEMBERS.filter(x => x.verdict === 'gated')) {
    const f = tree.find(t => t.file === m.file);
    if (!f) { v.push(`${m.file}: missing`); continue; }
    const where = m.handler || m.fn;
    const text = m.handler ? handlerText(f.src, m.handler) : functionText(f.src, m.fn);
    if (text === null) { v.push(`${m.file}: ${where} not found`); continue; }
    const gate = m.gateToken || GATE;
    for (const msg of gatedBefore(text, m.before, gate)) v.push(`${m.file} (${where}): ${msg}`);
    if (m.failClosed && !text.includes(m.failClosed)) v.push(`${m.file} (${where}): missing the fail-closed branch ${m.failClosed}`);
    for (const token of m.passes || []) {
      const block = callBlock(text, text.indexOf(`${m.sink}(`));
      if (!block.includes(token)) v.push(`${m.file} (${where}): the ${m.sink}( call does not pass ${token}`);
    }
    for (const helper of m.onlyCalledIn || []) {
      const handlerStart = f.src.indexOf(m.handler);
      const handlerEnd = handlerStart + text.length;
      let from = 0;
      for (;;) {
        const at = f.src.indexOf(helper, from);
        if (at === -1) break;
        const lineStart = f.src.lastIndexOf('\n', at) + 1;
        const isDef = /function\s+\w*$/.test(f.src.slice(lineStart, at));
        if (!isDef && (at < handlerStart || at > handlerEnd)) v.push(`${m.file}: ${helper} is also called outside ${m.handler} (ungated entry)`);
        from = at + helper.length;
      }
    }
  }
  return v;
}

function scanAgentTurnCallers(tree) {
  const v = [];
  const byFile = {};
  for (const { file, src } of tree) {
    if (file === 'lib/agent-turn.js') continue; // the core's own definition
    const hits = [];
    src.split('\n').forEach((text, i) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(text) || /^\s*import\b/.test(text)) return;
      if (/\brunAgentTurn\(/.test(text)) hits.push(i);
    });
    if (hits.length) byFile[file] = src;
  }
  const seen = {};
  for (const [file, src] of Object.entries(byFile)) {
    let from = 0; let index = 0;
    for (;;) {
      const at = src.indexOf('runAgentTurn(', from);
      if (at === -1) break;
      const lineStart = src.lastIndexOf('\n', at) + 1;
      const prefix = src.slice(lineStart, at);
      if (!/^\s*(\/\/|\*)/.test(prefix) && !/import\b/.test(prefix) && !/function\s+$/.test(prefix)) {
        const row = AGENT_TURN_CALLERS.find(r => r.file === file && r.index === index);
        const label = `${file} runAgentTurn( #${index}`;
        if (!row) v.push(`${label}: an unlisted runAgentTurn( caller — record its mode (execute | propose) and gate it`);
        else {
          seen[`${file}#${index}`] = true;
          const block = callBlock(src, at);
          if (row.mode.startsWith('execute') && !block.includes('enqueueGuard:')) v.push(`${label}: an execute-mode caller must pass an enqueueGuard`);
          if (row.mode === 'propose' && !/followUpMode:\s*'propose'/.test(block)) v.push(`${label}: a propose-mode caller must set followUpMode: 'propose'`);
          if (row.mode.startsWith('execute') && !block.includes(GATE)) {
            // the guard closes over the resolver; it must be built from it in this file
            if (!src.includes(GATE)) v.push(`${label}: ${file} never builds its guard from ${GATE}`);
          }
        }
        index++;
      }
      from = at + 'runAgentTurn('.length;
    }
  }
  for (const row of AGENT_TURN_CALLERS) {
    if (!seen[`${row.file}#${row.index}`]) v.push(`${row.file} runAgentTurn( #${row.index}: listed but not found`);
    if (!row.reason) v.push(`${row.file}#${row.index}: a row needs a recorded reason`);
  }
  return v;
}

// ── the live tree ────────────────────────────────────────────────────────────

const TREE = loadTree();

describe('LIN-3383 census — every session-reachable runner enqueue sink is gated or token-scoped', () => {
  test('the live tree: every sink is in the table, every gated sink is behind its gate', () => {
    assert.deepEqual(scanSinks(TREE), []);
  });

  test('the live tree: every runAgentTurn( caller is in the table; execute callers carry the guard', () => {
    assert.deepEqual(scanAgentTurnCallers(TREE), []);
  });

  test('the table records a reason for every row and only the two verdicts', () => {
    for (const m of MEMBERS) {
      assert.ok(m.reason && m.reason.length > 10, `${m.file}|${m.sink}`);
      assert.ok(['gated', 'token-scoped'].includes(m.verdict));
    }
  });
});

// ── mutation witnesses ───────────────────────────────────────────────────────

const mutate = (file, fn) => TREE.map(t => (t.file === file ? { ...t, src: fn(t.src) } : t));

describe('LIN-3383 census — mutation witnesses', () => {
  test('removing the Dispatch route gate fails the census', () => {
    const v = scanSinks(mutate('routes/dispatch.js', s => s.replace('const enqueueRefusal = await resolveRunnerOwnerRefusal(', 'const enqueueRefusal = await (async () => null)(')));
    assert.ok(v.some(m => m.startsWith('routes/dispatch.js (router.post') && m.includes('is reached before')), v.join('\n'));
  });

  test('moving the cascade expansion above the gate fails the census', () => {
    const v = scanSinks(mutate('routes/dispatch.js', s => s.replace("      // LIN-3383 owner-only runner enqueue.", "      await dispatchQueueStore.expandCascadeAborts(workspace.urlKey, abortTo, {});\n      // LIN-3383 owner-only runner enqueue.")));
    assert.ok(v.length > 0);
  });

  test('removing the feedback lane gate fails the census', () => {
    const v = scanSinks(mutate('routes/workspace-api.js', s => s.replaceAll('resolveRunnerOwnerRefusal(', 'noGate(')));
    assert.ok(v.some(m => m.startsWith('routes/workspace-api.js') && m.includes('enqueueFeedbackTriage(')), v.join('\n'));
  });

  test('a second, ungated caller of a feedback helper fails the census', () => {
    const v = scanSinks(mutate('routes/workspace-api.js', s => s.replace("  router.post('/workspace/:urlKey/api/feedback'", "  router.post('/workspace/:urlKey/api/x', async () => { await enqueueFeedbackTriage(); });\n  router.post('/workspace/:urlKey/api/feedback'")));
    assert.ok(v.some(m => m.includes('also called outside')), v.join('\n'));
  });

  test('removing the Apply pre-claim gate fails the census', () => {
    const v = scanSinks(mutate('routes/dashboard.js', s => s.replace('const refusal = await resolveRunnerOwnerRefusal(', 'const refusal = await (async () => null)(')));
    assert.ok(v.some(m => m.startsWith('routes/dashboard.js') && m.includes('runProposalsStore.apply(')), v.join('\n'));
  });

  test('Apply or FC approve that stops passing the owner params to the seam fails the census', () => {
    assert.ok(scanSinks(mutate('routes/dashboard.js', s => s.replace('          ownerCheck: workspaceOwnerCheck,\n          workspaceId: workspace.id,\n        });\n        if (outcome', '        });\n        if (outcome'))).some(m => m.includes('does not pass ownerCheck:')));
    assert.ok(scanSinks(mutate('routes/flight-companion.js', s => s.replace('        ownerCheck: workspaceOwnerCheck,\n        workspaceId: workspace.id,\n      });\n      res.status', '      });\n      res.status'))).some(m => m.includes('does not pass ownerCheck:')));
  });

  test('removing the seam gate inside dispatchSessionFollowUp fails the census', () => {
    const v = scanSinks(mutate('lib/follow-up-dispatch.js', s => s.replace('const refusal = await resolveRunnerOwnerRefusal(', 'const refusal = await (async () => null)(')));
    assert.ok(v.some(m => m.startsWith('lib/follow-up-dispatch.js')), v.join('\n'));
  });

  test('removing the send_follow_up guard, or its fail-closed branch, fails the census', () => {
    assert.ok(scanSinks(mutate('lib/chat-tools.js', s => s.replace('const enqueueRefusal = await enqueueGuard({ target });', 'const enqueueRefusal = null;'))).some(m => m.startsWith('lib/chat-tools.js')));
    assert.ok(scanSinks(mutate('lib/chat-tools.js', s => s.replace("typeof enqueueGuard !== 'function'", 'false'))).some(m => m.includes('fail-closed branch')));
  });

  test('removing the Collective per-seat gate fails the census', () => {
    const v = scanSinks(mutate('routes/collective.js', s => s.replace('const seatRefusal = await resolveRunnerOwnerRefusal(', 'const seatRefusal = await (async () => null)(')));
    assert.ok(v.some(m => m.startsWith('routes/collective.js')), v.join('\n'));
  });

  test('an unlisted session-reachable sink fails the census', () => {
    const planted = [...TREE, { file: 'routes/new-feature.js', src: "export function r() {\n  router.post('/x', async () => {\n    await createDispatchItem({});\n  });\n}\n" }];
    assert.ok(scanSinks(planted).some(m => m.startsWith('routes/new-feature.js|createDispatchItem') && m.includes('unlisted')));
    const viaStore = [...TREE, { file: 'lib/new-helper.js', src: 'export async function go(store) {\n  return store.addItem(1, {});\n}\n' }];
    assert.ok(scanSinks(viaStore).some(m => m.startsWith('lib/new-helper.js|addItem')));
  });

  test('a new sink added to a listed file (count drift) fails the census', () => {
    const v = scanSinks(mutate('routes/collective.js', s => s + "\nawait createDispatchItem({});\n"));
    assert.ok(v.some(m => m.startsWith('routes/collective.js|createDispatchItem: expected 1')));
  });

  test("deleting Task Chat's guard fails the census (the member the research added)", () => {
    const v = scanAgentTurnCallers(mutate('routes/task-chat.js', s => s.replace('enqueueGuard: ({ target }) =>', 'unrelated: ({ target }) =>')));
    assert.ok(v.some(m => m.startsWith('routes/task-chat.js') && m.includes('must pass an enqueueGuard')), v.join('\n'));
  });

  test("deleting the FC reply's guard fails the census; the FC boot (propose) does not need one", () => {
    const v = scanAgentTurnCallers(mutate('routes/flight-companion.js', s => s.replace('enqueueGuard: ({ target }) =>', 'unrelated: ({ target }) =>')));
    assert.ok(v.some(m => m.startsWith('routes/flight-companion.js runAgentTurn( #0') && m.includes('enqueueGuard')), v.join('\n'));
    assert.ok(!v.some(m => m.includes('#1')));
  });

  test('a fifth runAgentTurn( caller fails the census', () => {
    const planted = mutate('routes/collective.js', s => s + "\nawait runAgentTurn({ turnKind: 'user-initiated' });\n");
    assert.ok(scanAgentTurnCallers(planted).some(m => m.startsWith('routes/collective.js runAgentTurn( #0') && m.includes('unlisted')));
    const second = mutate('routes/task-chat.js', s => s + "\nawait runAgentTurn({});\n");
    assert.ok(scanAgentTurnCallers(second).some(m => m.startsWith('routes/task-chat.js runAgentTurn( #1')));
  });

  test("a propose caller that drops followUpMode: 'propose' fails the census", () => {
    const v = scanAgentTurnCallers(mutate('routes/proxy-flight-companion.js', s => s.replace("followUpMode: 'propose'", "followUpMode: 'execute'")));
    assert.ok(v.some(m => m.startsWith('routes/proxy-flight-companion.js') && m.includes("followUpMode: 'propose'")), v.join('\n'));
  });
});
