/**
 * LIN-3126 residual (review `5902c5c1` finding F1) — a follow-up dispatch row
 * must inherit the anchor's binding pair (`issueSource`/`issueBindingScope`),
 * so the run page's Close out / reply senders keep working on a repoB run that
 * has had a reply.
 *
 * The bug: `lib/dispatch-factory.js` §5.5 (LIN-1292) copies the anchor's issue
 * identity onto a follow-up row but not its binding pair. The run page renders
 * the hoisted reply box from the lineage TAIL, so after any reply that tail row
 * is unstamped and `closeOutContext` / the reply sender dispatch with an
 * `issueIdentifier` but no pair — a `422 BINDING_REQUIRED` on the two-binding
 * connection-backed workspace this residual exists to make usable.
 *
 * Fails before on the unfixed head `f931c274`:
 *   - the factory copies no `issueSource`/`issueBindingScope` onto the row
 *   - the hoisted reply box on a two-run lineage therefore carries no
 *     `data-source`/`data-binding-scope`
 *
 * Run with: node --test tests/unit/lin-3126-followup-binding.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { createDispatchItem } from '../../lib/dispatch-factory.js';
import { getLoopsForWorkspace } from '../../lib/pipeline-loops.js';
import { collectUnansweredDecisions } from '../../lib/unanswered-decisions.js';
import { renderSessionPage } from '../../lib/render-session.js';

const SOURCE = 'github';
const REPO_B = 'octo/repoB';
const NOW = new Date();

// A store that captures the item verbatim and serves the anchor lookup from a
// fixed table — the shape §5.5's inheritance reads (mirrors
// tests/unit/dispatch-factory.test.js).
function capturingStoreWithItems(items) {
  const captured = {};
  return {
    captured,
    async addItem(urlKey, item) {
      captured.urlKey = urlKey;
      captured.item = item;
      return { _id: 'item-1', ...item };
    },
    async getItemStatus(_urlKey, id) {
      return items[id] || null;
    },
  };
}

describe('LIN-3126 F1 — follow-up rows inherit the binding pair (dispatch-factory §5.5)', () => {
  const stampedAnchor = {
    id: 'anchor-1',
    issueId: 'uuid-1',
    issueIdentifier: 'GB-1',
    issueTitle: 'Repo B issue',
    issueUrl: 'https://github.com/octo/repoB/issues/1',
    issueSource: SOURCE,
    issueBindingScope: REPO_B,
  };

  test('a follow-up that names no issue fields inherits the anchor pair', async () => {
    const store = capturingStoreWithItems({ 'anchor-1': stampedAnchor });
    await createDispatchItem({
      store, urlKey: 'acme', prompt: 'one more thing',
      fields: { followUpTo: 'anchor-1', target: 'cli' },
    });
    assert.equal(store.captured.item.issueSource, SOURCE, 'issueSource inherited');
    assert.equal(store.captured.item.issueBindingScope, REPO_B, 'issueBindingScope inherited');
    assert.equal(store.captured.item.issueIdentifier, 'GB-1', 'issue identity still inherited too');
  });

  test('a follow-up that names its own issue fields for the SAME issue still inherits the anchor pair', async () => {
    // The pre-fix guard `!fields.issueIdentifier` skips the whole inheritance
    // block once the follow-up names its own issue, which would silently drop
    // the pair. The pair rides the same anchor lookup, not that guard — but only
    // while the named issue is the anchor's own (correction (a)).
    const store = capturingStoreWithItems({ 'anchor-1': stampedAnchor });
    await createDispatchItem({
      store, urlKey: 'acme', prompt: 'x',
      fields: { followUpTo: 'anchor-1', issueIdentifier: 'GB-1', target: 'cli' },
    });
    assert.equal(store.captured.item.issueIdentifier, 'GB-1', 'the follow-up\'s own identity wins');
    assert.equal(store.captured.item.issueSource, SOURCE, 'pair still inherited');
    assert.equal(store.captured.item.issueBindingScope, REPO_B, 'pair still inherited');
  });

  test('a follow-up that names a DIFFERENT issue gets NO anchor pair (correction a)', async () => {
    // `fields.X || anchor.X` alone would stamp issue A's binding onto issue B.
    const store = capturingStoreWithItems({ 'anchor-1': stampedAnchor });
    await createDispatchItem({
      store, urlKey: 'acme', prompt: 'x',
      fields: { followUpTo: 'anchor-1', issueIdentifier: 'GB-2', target: 'cli' },
    });
    assert.equal(store.captured.item.issueIdentifier, 'GB-2', 'the follow-up\'s own identity wins');
    assert.ok(!('issueSource' in store.captured.item), 'no issueSource borrowed from a different issue');
    assert.ok(!('issueBindingScope' in store.captured.item), 'no issueBindingScope borrowed from a different issue');
  });

  test('a different issue named by issueId (not identifier) also gets no anchor pair (correction a)', async () => {
    const store = capturingStoreWithItems({ 'anchor-1': stampedAnchor });
    await createDispatchItem({
      store, urlKey: 'acme', prompt: 'x',
      fields: { followUpTo: 'anchor-1', issueId: 'uuid-2', target: 'cli' },
    });
    assert.ok(!('issueSource' in store.captured.item), 'no issueSource borrowed');
    assert.ok(!('issueBindingScope' in store.captured.item), 'no issueBindingScope borrowed');
  });

  test('an explicit half of the pair takes NOTHING from the anchor (correction b)', async () => {
    // The pair moves as a unit: a follow-up that carries its own `issueSource`
    // must never have the anchor's `issueBindingScope` spliced onto it.
    const store = capturingStoreWithItems({ 'anchor-1': stampedAnchor });
    await createDispatchItem({
      store, urlKey: 'acme', prompt: 'x',
      fields: { followUpTo: 'anchor-1', issueSource: 'linear', target: 'cli' },
    });
    assert.equal(store.captured.item.issueSource, 'linear', 'explicit source wins');
    assert.ok(!('issueBindingScope' in store.captured.item), 'no anchor half spliced in');
  });

  test('an explicit scope alone likewise takes nothing from the anchor (correction b)', async () => {
    const store = capturingStoreWithItems({ 'anchor-1': stampedAnchor });
    await createDispatchItem({
      store, urlKey: 'acme', prompt: 'x',
      fields: { followUpTo: 'anchor-1', issueBindingScope: 'org-9', target: 'cli' },
    });
    assert.equal(store.captured.item.issueBindingScope, 'org-9', 'explicit scope wins');
    assert.ok(!('issueSource' in store.captured.item), 'no anchor half spliced in');
  });

  test('an explicit full pair on the follow-up is never overridden', async () => {
    const store = capturingStoreWithItems({ 'anchor-1': stampedAnchor });
    await createDispatchItem({
      store, urlKey: 'acme', prompt: 'x',
      fields: {
        followUpTo: 'anchor-1',
        issueSource: 'linear',
        issueBindingScope: 'org-1',
        target: 'cli',
      },
    });
    assert.equal(store.captured.item.issueSource, 'linear', 'explicit source wins');
    assert.equal(store.captured.item.issueBindingScope, 'org-1', 'explicit scope wins');
  });

  test('an unstamped anchor gives a row with NO pair keys (sparse, no nulls)', async () => {
    const store = capturingStoreWithItems({
      'anchor-1': { id: 'anchor-1', issueIdentifier: 'GB-1' }, // no pair — legacy/Linear row
    });
    await createDispatchItem({
      store, urlKey: 'acme', prompt: 'x',
      fields: { followUpTo: 'anchor-1', target: 'cli' },
    });
    assert.ok(!('issueSource' in store.captured.item), 'no issueSource key invented');
    assert.ok(!('issueBindingScope' in store.captured.item), 'no issueBindingScope key invented');
  });

  test('a non-follow-up row is untouched (no pair keys from the anchor path)', async () => {
    const store = capturingStoreWithItems({ 'anchor-1': stampedAnchor });
    await createDispatchItem({ store, urlKey: 'acme', prompt: 'x', fields: { target: 'cli' } });
    assert.ok(!('issueSource' in store.captured.item));
    assert.ok(!('issueBindingScope' in store.captured.item));
  });
});

// ---------------------------------------------------------------------------
// Render join: the run page's ONE hoisted reply box is the lineage TAIL's box.
// The tail row is the follow-up the factory just stamped, so the hoisted box
// carries the pair the Close out / reply senders read from `box.dataset`.
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

function extractReplyBoxAttrs(html) {
  const match = html.match(/<div class="sess-inline-reply" ([^>]*)>/);
  assert.ok(match, 'a hoisted reply box renders');
  const attrs = {};
  const attrRe = /([a-z-]+)="([^"]*)"/g;
  let m;
  while ((m = attrRe.exec(match[1]))) attrs[m[1]] = m[2];
  return attrs;
}

// A stamped two-run lineage: `root-1` is the anchor; the follow-up row is
// produced by the real factory (no issue fields of its own — the reply-box
// producer's `{ prompt, followUpTo, target }` shape).
async function stampedTwoRunLineage() {
  const anchor = {
    id: 'root-1',
    issueId: 'uuid-1',
    issueIdentifier: 'GB-1',
    issueTitle: 'Repo B issue',
    issueUrl: 'https://github.com/octo/repoB/issues/1',
    issueSource: SOURCE,
    issueBindingScope: REPO_B,
    promptName: 'plan',
    prompt: 'plan prompt text',
    // Within the pipeline's lookback window (real `getLoopsForWorkspace` reads
    // only recent rows; a fixed past date would be dropped).
    dispatchedAt: new Date(Date.now() - 3600_000).toISOString(),
    dispatchedBy: 'user-1',
    target: 'cli',
    repo: null,
  };
  const store = capturingStoreWithItems({ 'root-1': anchor });
  await createDispatchItem({
    store, urlKey: 'acme', prompt: 'a reply',
    fields: { followUpTo: 'root-1', target: 'cli' },
  });
  const followItem = { ...store.captured.item, id: 'follow-1', dispatchedAt: new Date(Date.now() - 1800_000).toISOString() };
  return getLoopsForWorkspace('acme', feedStoreWith([anchor, followItem]));
}

function sessionFrom(loops) {
  return { sessionId: 'sess-1', seedIssue: 'GB-1', tasksTouched: ['GB-1'], loops };
}

describe('LIN-3126 F1 — the hoisted reply box renders the inherited pair (render-session)', () => {
  test('a two-run lineage whose follow-up carries none of its own fields renders the pair on the one hoisted box', async () => {
    const loops = await stampedTwoRunLineage();
    const html = renderSessionPage({ session: sessionFrom(loops), urlKey: 'acme', canReply: true, issueContext: [] });

    assert.equal((html.match(/data-testid="session-inline-reply"/g) || []).length, 1, 'one hoisted reply box');
    const attrs = extractReplyBoxAttrs(html);
    assert.equal(attrs['data-source'], SOURCE, 'hoisted box forwards the inherited source');
    assert.equal(attrs['data-binding-scope'], REPO_B, 'hoisted box forwards the inherited scope');
    assert.equal(attrs['data-loop-id'], 'follow-1', 'the box targets the tail (the follow-up)');
  });

  test('the question card renders the anchor pair when the root has aged out (anchor falls back to the follow-up)', async () => {
    // A wake-first fetch: only the lineage's follow-up is in the read set, so
    // `collectUnansweredDecisions` anchors the ruling on the content loop — the
    // follow-up whose pair the factory just inherited. Pre-fix this card loses
    // the pair and the run-page answer/dismiss senders 422.
    const all = await stampedTwoRunLineage();
    const tail = all.find(l => l.loopId === 'follow-1');
    const loops = [{ ...tail, decision: { decision_id: 'd-1', question: 'Proceed?' }, decisionCase: [], answeredDecisions: [] }];
    const decisions = collectUnansweredDecisions({ loops }, { now: NOW });
    assert.equal(decisions.length, 1, 'the ruling anchors on the follow-up');
    const html = renderSessionPage({
      session: sessionFrom(loops), urlKey: 'acme', canReply: true, issueContext: [], decisions,
    });
    assert.match(html, /data-testid="session-question-card"[^>]*data-source="github"/);
    assert.match(html, /data-testid="session-question-card"[^>]*data-binding-scope="octo\/repoB"/);
  });
});
