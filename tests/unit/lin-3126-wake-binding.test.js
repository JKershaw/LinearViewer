/**
 * LIN-3126 residual (review `4740cf11` finding W1) — wake follow-ups are the
 * SECOND row producer. They never reach `createDispatchItem` (the factory's
 * §5.5a pair inheritance), so `buildWakeFollowUp` must stamp the child's
 * binding pair itself, sparsely, next to the LIN-2121 `issueIdentifier`.
 *
 * The bug: a wake row is minted with `issueIdentifier` but no
 * `issueSource`/`issueBindingScope`. The run page renders the wake as its own
 * lineage root, so its reply box carries no pair; a reply typed there, and any
 * follow-up chained off it (the factory inherits from an unstamped anchor),
 * sends no pair and 422s `BINDING_REQUIRED` on the two-repo witness workspace.
 * A ruling raised on the wake-resumed turn anchors on the wake loop for the
 * same reason, so its Answer→dispatch / record writes lose the pair too.
 *
 * Fails before on the unfixed head `14fd4d2d`:
 *   - the wake descriptor has no `issueSource`/`issueBindingScope`
 *   - the wake's run-page reply box therefore carries no
 *     `data-source`/`data-binding-scope`
 *   - a ruling on the wake loop yields an anchor with no `source`/`bindingScope`
 *
 * Run with: node --test tests/unit/lin-3126-wake-binding.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { buildWakeFollowUp } from '../../lib/dispatch-wake.js';
import { getLoopsForWorkspace } from '../../lib/pipeline-loops.js';
import { collectUnansweredDecisions } from '../../lib/unanswered-decisions.js';
import { renderSessionPage } from '../../lib/render-session.js';

const SOURCE = 'github';
const REPO_B = 'octo/repoB';
const NOW = new Date();
const DONE_FEEDBACK = [{ message: 'started' }, { message: '[done] shipped in 40s', timestamp: 't' }];

function stampedChild(overrides = {}) {
  return {
    id: 'child-1',
    sessionId: 'root-1',
    subscription: 'terminal-only',
    kind: 'implementation',
    followUpTo: null,
    issueIdentifier: 'GB-1',
    issueTitle: 'Repo B issue',
    issueUrl: 'https://github.com/octo/repoB/issues/1',
    issueSource: SOURCE,
    issueBindingScope: REPO_B,
    promptName: 'implementation',
    ...overrides,
  };
}

describe('LIN-3126 W1 — buildWakeFollowUp stamps the child binding pair (sparse)', () => {
  test('a stamped child yields issueSource/issueBindingScope on the wake descriptor', () => {
    const wake = buildWakeFollowUp(stampedChild(), DONE_FEEDBACK);
    assert.ok(wake, 'expected a wake descriptor');
    assert.equal(wake.issueIdentifier, 'GB-1', 'the LIN-2121 identity stamp is unchanged');
    assert.equal(wake.issueSource, SOURCE, 'the child pair rides the wake row');
    assert.equal(wake.issueBindingScope, REPO_B, 'the child pair rides the wake row');
  });

  test('an unstamped child yields NO pair keys — byte-identical descriptor', () => {
    const wake = buildWakeFollowUp(
      stampedChild({ issueSource: undefined, issueBindingScope: undefined }),
      DONE_FEEDBACK,
    );
    assert.ok(wake, 'expected a wake descriptor');
    assert.ok(!('issueSource' in wake), 'no issueSource key invented');
    assert.ok(!('issueBindingScope' in wake), 'no issueBindingScope key invented');
    assert.deepEqual(
      Object.keys(wake).sort(),
      ['followUpTo', 'issueIdentifier', 'kind', 'prompt', 'queueIfBusy', 'sessionId', 'subscription'].sort(),
      'the unstamped key set stays at 7 (LIN-1430/LIN-2121 pin holds)',
    );
  });
});

// ---------------------------------------------------------------------------
// The run-page join: the wake is its OWN lineage root, so it renders its own
// reply box. That box must carry the pair the Close out / reply senders read
// from `box.dataset`.
// ---------------------------------------------------------------------------
function feedStoreWith(items) {
  return {
    dispatchStore: {
      async listItems() { return items; },
      async listHistory() { return { items: [], total: 0 }; },
    },
    agentStatusStore: { async listStatus() { return { items: [], total: 0 }; } },
  };
}

function extractAllReplyBoxAttrs(html) {
  const boxes = [...html.matchAll(/<div class="sess-inline-reply" ([^>]*)>/g)];
  assert.ok(boxes.length > 0, 'at least one reply box renders');
  return boxes.map((box) => {
    const attrs = {};
    const attrRe = /([a-z-]+)="([^"]*)"/g;
    let m;
    while ((m = attrRe.exec(box[1]))) attrs[m[1]] = m[2];
    return attrs;
  });
}

// A stamped root plus the wake the real builder mints from a stamped child.
// The wake carries no `rootItemId` (the store falls back to its own `_id`), so
// it is its own lineage root and renders its own reply box.
async function rootPlusWakeLineage() {
  const root = {
    id: 'root-1',
    issueId: 'uuid-1',
    issueIdentifier: 'GB-1',
    issueTitle: 'Repo B issue',
    issueUrl: 'https://github.com/octo/repoB/issues/1',
    issueSource: SOURCE,
    issueBindingScope: REPO_B,
    promptName: 'plan',
    prompt: 'plan prompt text',
    dispatchedAt: new Date(Date.now() - 3600_000).toISOString(),
    dispatchedBy: 'user-1',
    target: 'cli',
    repo: null,
    kind: 'autopilot',
  };
  const wakeDesc = buildWakeFollowUp(stampedChild(), DONE_FEEDBACK);
  assert.ok(wakeDesc, 'the child terminal mints a wake');
  const wake = {
    ...wakeDesc,
    id: 'wake-1',
    promptName: 'wake',
    prompt: 'wake prompt text',
    target: 'cli',
    dispatchedAt: new Date(Date.now() - 1800_000).toISOString(),
  };
  return getLoopsForWorkspace('acme', feedStoreWith([root, wake]));
}

function sessionFrom(loops) {
  return { sessionId: 'sess-1', seedIssue: 'GB-1', tasksTouched: ['GB-1'], loops };
}

describe('LIN-3126 W1 — every run-page reply box carries the wake pair (render-session)', () => {
  test('root + wake from a stamped child: EVERY session-inline-reply box forwards the pair', async () => {
    const loops = await rootPlusWakeLineage();
    const html = renderSessionPage({ session: sessionFrom(loops), urlKey: 'acme', canReply: true, issueContext: [] });

    const boxes = extractAllReplyBoxAttrs(html);
    assert.equal(boxes.length, 2, 'the root and the wake each render their own reply box');
    for (const attrs of boxes) {
      assert.equal(attrs['data-source'], SOURCE, `box ${attrs['data-loop-id']} forwards the source`);
      assert.equal(attrs['data-binding-scope'], REPO_B, `box ${attrs['data-loop-id']} forwards the scope`);
    }
    const wakeBox = boxes.find((a) => a['data-loop-id'] === 'wake-1');
    assert.ok(wakeBox, 'the wake box is present and is the one that was dropping the pair');
  });
});

describe('LIN-3126 W1 — a ruling on the wake loop carries the pair (collectUnansweredDecisions)', () => {
  test('the wake-anchored ruling yields anchor.source / anchor.bindingScope', async () => {
    const all = await rootPlusWakeLineage();
    const wake = all.find((l) => l.loopId === 'wake-1');
    assert.ok(wake, 'the wake loop is in the read set');
    const loops = [{ ...wake, decision: { decision_id: 'd-1', question: 'Proceed?' }, decisionCase: [], answeredDecisions: [] }];

    const decisions = collectUnansweredDecisions({ loops }, { now: NOW });
    assert.equal(decisions.length, 1, 'the ruling anchors on the wake loop');
    assert.equal(decisions[0].anchor.source, SOURCE, 'anchor carries the wake source');
    assert.equal(decisions[0].anchor.bindingScope, REPO_B, 'anchor carries the wake binding scope');
  });
});
