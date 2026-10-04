/**
 * Integration test: mock LLM responses → real recommendation path → real recursion
 * (LIN-327/329; one path since LIN-3300).
 *
 * The route-level E2E tests drive the *test-mode* mock in computeRecommendation, which
 * returns a hardcoded recommendation and never touches the LLM-text parser. This test
 * closes the seam in between: it feeds canned OpenRouter completion strings — the
 * `## Reasoning` shape the routing prompt elicits — through the REAL getRecommendation
 * (routing parse, then code assembles the stage's prompt) and the REAL
 * resolveRecommendation, proving the full chain descends as intended:
 *
 *   LLM emits `defer { DeferTo: X }` (no body)  →  { recommendedAction:'defer', deferTo:X }
 *     →  resolver re-enters on X  →  LLM emits a real action  →  code assembles its prompt
 *     →  terminal returned + breadcrumb.
 *
 * Only the HTTP transport is stubbed (setFetchImpl); a `## Prompt` body a model writes
 * anyway is ignored, which the action replies below exercise.
 *
 * Run with: node --test tests/unit/recommend-defer-integration.test.js
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { getRecommendation, setFetchImpl } from '../../lib/openrouter.js';
import { generatePrompt } from '../../lib/prompt-templates.js';
import { resolveRecommendation, describeDescent } from '../../lib/recommend-recurse.js';

const issueOf = (identifier) => ({
  identifier, title: `Task ${identifier}`, description: 'd', url: `https://linear.app/x/issue/${identifier}`,
  state: { name: 'In Progress', type: 'started' }, labels: [], createdAt: '2026-01-01T00:00:00.000Z'
});
const CONTEXT = { parent: null, siblings: [], project: null, children: [], comments: [], focusedChild: null };

// The canned completion the stubbed transport returns for the next call.
let nextReply = null;
before(() => {
  setFetchImpl(async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: nextReply }, finish_reason: 'stop' }], usage: { completion_tokens: 100 } })
  }));
});
after(() => { setFetchImpl(null); });

/** One recommendation hop through the live path: routing reply in, routed recommendation out. */
async function recommend(text, identifier) {
  nextReply = text;
  return getRecommendation(issueOf(identifier), CONTEXT, { apiKey: 'stub-key' });
}

// A defer reply: action `defer`, a structured DeferTo line, and an EMPTY prompt body.
const deferReply = (target) => `## Reasoning
**Assessment:**
- Preparation: ✓ Not needed
- Blockers: ✓ None
- Ready: ✗ No (this is a container; the real work lives in a child)
→ **defer**
**Next:** descend to the actionable child
**DeferTo:** ${target}

## Prompt
`;

// A real-action reply: an action, and a prompt body the path ignores (code assembles it).
const actionReply = (action, body) => `## Reasoning
**Assessment:**
- Preparation: ✗ Needed
- Blockers: ✓ None
- Ready: ✗ No
→ **${action}**
**Next:** do the work

## Prompt
${body}
`;

// Build a computeOne backed by a table of canned LLM completions, run through the REAL
// getRecommendation with only the network removed.
function llmBackedComputeOne(completions) {
  return async (identifier) => {
    const text = completions[identifier];
    if (!text) throw new Error(`Issue not found: ${identifier}`);
    const rec = await recommend(text, identifier);
    return { identifier, ...rec };
  };
}

// Same, but also attaches each node's own `state` and its `children` (with state) —
// the fields the terminal-state descent guard (LIN-353) reads. Faithful to the real
// computeOne shapes, which now surface ctx.issue.state + ctx.children per hop.
function llmBackedComputeOneWithTree(completions, trees) {
  return async (identifier) => {
    const text = completions[identifier];
    if (!text) throw new Error(`Issue not found: ${identifier}`);
    const rec = await recommend(text, identifier);
    const node = trees[identifier] || {};
    return { identifier, ...rec, state: node.state, children: node.children };
  };
}

describe('mock-LLM → parse → recurse (defer end-to-end)', () => {
  test('a container LLM-deferral resolves to the actionable leaf', async () => {
    const computeOne = llmBackedComputeOne({
      'LIN-318': deferReply('LIN-297'),
      'LIN-297': actionReply('research', '# Research LIN-297\n\nInvestigate the dependency contract.')
    });

    const out = await resolveRecommendation({ computeOne, startIdentifier: 'LIN-318' });

    // Terminal node, not the parent — the bug this fixes.
    assert.strictEqual(out.recommendation.identifier, 'LIN-297');
    assert.strictEqual(out.recommendation.recommendedAction, 'research');
    assert.strictEqual(out.recommendation.prompt, generatePrompt('research', issueOf('LIN-297'), CONTEXT).prompt,
      'the terminal node carries the stage prompt code assembled');
    assert.deepStrictEqual(out.deferredVia, ['LIN-318', 'LIN-297']);
    assert.strictEqual(out.deferTruncated, false);
    assert.strictEqual(describeDescent(out.deferredVia, out.recommendation),
      'LIN-318 is a container → descended to LIN-297 (research)');
  });

  test('the deferring hop itself carries NO prompt body (cost contract, via the real path)', async () => {
    const parentRec = await recommend(deferReply('LIN-297'), 'LIN-318');
    assert.strictEqual(parentRec.recommendedAction, 'defer');
    assert.strictEqual(parentRec.deferTo, 'LIN-297');
    assert.strictEqual(parentRec.prompt, null);
  });

  test('descends multiple LLM-deferral levels to the first real-work node', async () => {
    const computeOne = llmBackedComputeOne({
      'LIN-100': deferReply('LIN-200'),
      'LIN-200': deferReply('LIN-300'),
      'LIN-300': actionReply('implement', '# Implement LIN-300\n\nBuild it.')
    });
    const out = await resolveRecommendation({ computeOne, startIdentifier: 'LIN-100' });
    assert.strictEqual(out.recommendation.identifier, 'LIN-300');
    assert.strictEqual(out.recommendation.recommendedAction, 'implement');
    assert.deepStrictEqual(out.deferredVia, ['LIN-100', 'LIN-200', 'LIN-300']);
  });

  test('node-work terminus: an LLM that returns breakdown is NOT descended past', async () => {
    // The recommender, looking at the node, decides node-work over defer — the case a
    // blind always-descend would get wrong. Real LLM text drives the stop.
    const computeOne = llmBackedComputeOne({
      'UNDECOMPOSED': actionReply('breakdown', '# Break down UNDECOMPOSED\n\nDecompose into subtasks.')
    });
    const out = await resolveRecommendation({ computeOne, startIdentifier: 'UNDECOMPOSED' });
    assert.strictEqual(out.recommendation.recommendedAction, 'breakdown');
    assert.deepStrictEqual(out.deferredVia, ['UNDECOMPOSED']);
    assert.strictEqual(out.deferTruncated, false);
  });

  test('an LLM deferral to a missing child stops safely with the unresolved flag', async () => {
    const computeOne = llmBackedComputeOne({
      'LIN-1': deferReply('GHOST-999') // GHOST-999 has no completion → "not found"
    });
    const out = await resolveRecommendation({ computeOne, startIdentifier: 'LIN-1' });
    assert.strictEqual(out.deferTruncated, true);
    assert.strictEqual(out.deferStopReason, 'unresolved');
    assert.strictEqual(out.recommendation.recommendedAction, 'defer');
    assert.strictEqual(out.recommendation.deferTo, 'GHOST-999');
  });
});

describe('container-descent bug reproduction (LIN-353)', () => {
  // The reported loop: triggering container HAR-589 twice re-descended into the
  // already-Done HAR-591 and dispatched no-op look-intos, never advancing to the
  // ready crux. With the edge guard, both consecutive triggers reach the ready child.
  test('a container that LLM-defers into a Done child redirects to the ready crux — twice in a row', async () => {
    const completions = {
      'HAR-589': deferReply('HAR-591'), // LLM (wrongly) names the Done child
      'HAR-590': actionReply('implement', '# Implement HAR-590\n\nBuild the ready crux.'),
      'HAR-591': actionReply('look-into', '# Look into HAR-591\n\nNo-op against finished work.')
    };
    const trees = {
      'HAR-589': {
        state: { type: 'started' },
        children: [
          { identifier: 'HAR-591', state: { type: 'completed' } },
          { identifier: 'HAR-590', state: { type: 'unstarted' } }
        ]
      },
      'HAR-590': { state: { type: 'unstarted' }, children: [] },
      'HAR-591': { state: { type: 'completed' }, children: [] }
    };
    const computeOne = llmBackedComputeOneWithTree(completions, trees);

    // Run twice — the original loop reproduced every time the container was triggered.
    for (const pass of [1, 2]) {
      const out = await resolveRecommendation({ computeOne, startIdentifier: 'HAR-589' });
      assert.strictEqual(out.recommendation.identifier, 'HAR-590', `pass ${pass}: reaches the READY crux, not the Done child`);
      assert.strictEqual(out.recommendation.recommendedAction, 'implement', `pass ${pass}: dispatches real work`);
      assert.strictEqual(out.recommendation.prompt, generatePrompt('implementation', issueOf('HAR-590'), CONTEXT).prompt,
        `pass ${pass}: the ready crux's prompt, never the Done child's look-into`);
      assert.deepStrictEqual(out.deferredVia, ['HAR-589', 'HAR-590'], `pass ${pass}: breadcrumb shows the redirect`);
      assert.strictEqual(out.deferTruncated, false, `pass ${pass}: clean resolution, not a truncation`);
    }
  });

  test('container whose only remaining children are all Done stops with deferStopReason=terminal (no no-op dispatch)', async () => {
    const completions = {
      'HAR-589': deferReply('HAR-591'),
      'HAR-591': actionReply('look-into', '# Look into HAR-591\n\nNo-op.')
    };
    const trees = {
      'HAR-589': {
        state: { type: 'started' },
        children: [{ identifier: 'HAR-591', state: { type: 'completed' } }]
      }
    };
    const computeOne = llmBackedComputeOneWithTree(completions, trees);
    const out = await resolveRecommendation({ computeOne, startIdentifier: 'HAR-589' });
    assert.strictEqual(out.deferTruncated, true);
    assert.strictEqual(out.deferStopReason, 'terminal');
    // Stops on the deferring container (a defer, no prompt) → the route's 422 guard,
    // never the Done child's no-op look-into.
    assert.strictEqual(out.recommendation.identifier, 'HAR-589');
    assert.strictEqual(out.recommendation.recommendedAction, 'defer');
  });
});
