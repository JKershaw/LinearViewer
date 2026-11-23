/**
 * LIN-4504 (slice 2, P4), session 2: no stage writes a plan into a description.
 *
 * The proxy's description writes refuse a write that ADDS a plan heading, with a 422 naming `POST /api/proxy/records`
 * (routes/proxy-writes.js refusedByPlanHeading, through lib/legacy-plan-text.js addedPlanHeadings). Drives the REAL
 * proxy write routes over a REAL seeded LocalStore, and reads the stored description back:
 *   - create, PATCH, append, replace and the description-target attachment each refuse an added heading, and store
 *     nothing;
 *   - `#`, `##` and `###` headings are all refused (the deliberate widening, plan-review note 6), and so is a renamed
 *     heading line;
 *   - a legitimate edit elsewhere in an old description that already holds a plan passes (the guard judges what the
 *     write adds, not the whole result), plain and Linear-escaped, and so does dropping the old plan section;
 *   - a heading written as prose, or in a comment, is not a description write and is not refused.
 */
process.env.NODE_ENV = 'test';

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';
import { PLAN_IN_DESCRIPTION } from '../../lib/legacy-plan-text.js';
import { localProvider } from '../../lib/providers/local/index.js';
import { createLocalStore } from '../fixtures/local-harness.js';

// Must match TEST_LOCAL_URL_KEY in routes/proxy.js (and LOCAL_WORKSPACE_URL_KEY).
const LOCAL_URL_KEY = 'local-workspace';
const OLD = 'The person\'s words.\n\n## Implementation Plan\n\n1. an old step\n\n## Notes\n\nkept';
const linearEscape = (text) => text.replace(/([#*_[\]])/g, '\\$1');
// A 1x1 PNG.
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function proxyApp() {
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: {
      validateToken: async () => ({ tokenId: 't1', urlKey: LOCAL_URL_KEY, label: 'test', scope: 'readWrite', createdBy: 'u1' }),
    },
    proxyEventStore: { recordEvent: async () => {} },
    resolveWorkspaceAccess: async () => ({ token: null, reason: 'not_connected' }),
    getWorkspaceAccessToken: async () => null,
    agentStatusStore: {},
    recapCacheStore: {},
    briefCacheStore: {},
    dispatchQueueStore: {},
    workspaceFromUrl: (req, res, next) => next(),
    getWorkspaceOpenRouterKey: async () => null,
    workspacePreferencesStore: {},
    freeTierStore: { tryUse: async () => ({ allowed: true }) },
  }));
  return app;
}

async function call(method, path, body) {
  const server = proxyApp().listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { Authorization: 'Bearer anything', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    let parsed = {};
    try { parsed = await res.json(); } catch { /* empty body */ }
    return { status: res.status, body: parsed };
  } finally {
    await new Promise((r) => server.close(r));
  }
}

const refusedAsPlan = (res, what) => {
  assert.equal(res.status, 422, `${what}: ${JSON.stringify(res.body)}`);
  assert.equal(res.body.code, PLAN_IN_DESCRIPTION, what);
  assert.equal(res.body.use, 'POST /api/proxy/records', what);
  assert.match(res.body.error, /POST \/api\/proxy\/records/, `${what}: the refusal names the records write`);
};

for (const variant of [{ name: 'plain', store: (t) => t }, { name: 'Linear-escaped', store: linearEscape }]) {
  describe(`the plan-heading refusal on every proxy description lane (${variant.name} stored body)`, () => {
    let store;
    const saved = { uploadFile: localProvider.uploadFile };
    beforeEach(async () => {
      ({ store } = createLocalStore());
      await store.seed(LOCAL_URL_KEY, {
        projects: [{ id: 'p1', name: 'Alpha', content: 'a', sortOrder: 1 }],
        issues: [
          { id: 'i1', identifier: 'LOCAL-1', title: 'Old plan', description: variant.store(OLD), projectId: 'p1', state: { name: 'Todo', type: 'unstarted' } },
          { id: 'i2', identifier: 'LOCAL-2', title: 'No plan', description: 'Just words.', projectId: 'p1', state: { name: 'Todo', type: 'unstarted' } },
        ],
      });
      localProvider.configure({ store });
    });
    afterEach(() => { localProvider.uploadFile = saved.uploadFile; });
    const stored = async (id) => (await store.getIssue(LOCAL_URL_KEY, id)).description;

    test('create: a body with a plan heading is refused and nothing is made; without one it is made', async () => {
      refusedAsPlan(await call('POST', '/api/proxy/issues', { title: 'Planned', description: 'Goal.\n\n## Implementation Plan\n\nsteps' }), 'create');
      const made = await call('POST', '/api/proxy/issues', { title: 'Plain', description: 'Goal only.' });
      assert.equal(made.status, 201, JSON.stringify(made.body));
    });

    test('PATCH: adding a heading is refused (#, ##, ###), the store unchanged', async () => {
      for (const h of ['#', '##', '###']) {
        refusedAsPlan(await call('PATCH', '/api/proxy/issues/i2', { description: `Just words.\n\n${h} Implementation Plan\n\nsteps` }), `PATCH ${h}`);
      }
      assert.equal(await stored('i2'), 'Just words.');
    });

    test('PATCH: an edit elsewhere in an old description that holds a plan passes; a renamed heading is refused', async () => {
      const edited = OLD.replace('kept', 'kept, and edited');
      const ok = await call('PATCH', '/api/proxy/issues/i1', { description: edited });
      assert.equal(ok.status, 200, JSON.stringify(ok.body));
      assert.equal(await stored('i1'), edited);
      refusedAsPlan(await call('PATCH', '/api/proxy/issues/i1', { description: edited.replace('## Implementation Plan', '## Implementation Plan (revision 2)') }), 'renamed heading');
    });

    test('PATCH: dropping the old plan section passes', async () => {
      const res = await call('PATCH', '/api/proxy/issues/i1', { description: 'The person\'s words.\n\n## Notes\n\nkept' });
      assert.equal(res.status, 200, JSON.stringify(res.body));
    });

    test('append: a block with a heading is refused; an ordinary block appends', async () => {
      refusedAsPlan(await call('POST', '/api/proxy/issues/i1/description/append', { block: '### Implementation Plan\n\nmore' }), 'append');
      assert.equal(await stored('i1'), variant.store(OLD));
      const ok = await call('POST', '/api/proxy/issues/i1/description/append', { block: '## Found\n\nour implementation plan prose is fine' });
      assert.equal(ok.status, 200, JSON.stringify(ok.body));
    });

    test('replace: a span that becomes a heading is refused; a replace inside the old plan passes', async () => {
      refusedAsPlan(await call('POST', '/api/proxy/issues/i2/description/replace', { oldString: 'Just words.', newString: 'Just words.\n\n## Implementation Plan\n\nx' }), 'replace');
      const ok = await call('POST', '/api/proxy/issues/i1/description/replace', { oldString: 'an old step', newString: 'an old step, reworded' });
      assert.equal(ok.status, 200, JSON.stringify(ok.body));
    });

    test('attachment to the description: a caption with a heading is refused before any upload', async () => {
      let uploads = 0;
      localProvider.uploadFile = async () => { uploads += 1; return 'https://assets.example/x.png'; };
      const res = await call('POST', '/api/proxy/issues/i2/attachments', { image: `data:image/png;base64,${PNG}`, target: 'description', body: '## Implementation Plan\n\nin a caption' });
      refusedAsPlan(res, 'attachment');
      assert.equal(uploads, 0, 'nothing uploaded');
      assert.equal(await stored('i2'), 'Just words.');
    });
  });
}

// ---------------------------------------------------------------------------
// John's ruling (LIN-4504 comment d1d5ab31, 20 Nov): the design stage writes no plan record; design → plan →
// plan-review, as before. Plan update 684cd6fd names this test: after a design pass (an approach comment plus a
// description summary, no plan record), the selector's facts read no plan and route to `plan`.
// ---------------------------------------------------------------------------
import { planFactsOf } from '../../lib/records/plan-facts.js';
import { buildSelectorArgs } from '../../lib/openrouter.js';
import { buildRouterPrompt } from '../../lib/stage-router.js';
import { generatePrompt } from '../../lib/prompt-templates.js';
import { formatStageContract } from '../../lib/prompt-contract.js';
import { addedPlanHeadings } from '../../lib/legacy-plan-text.js';
import { DESIGN_PLAN_LINE } from '../../lib/prompts/plan-record-words.js';

describe('the design stage writes no plan record (ruling d1d5ab31): design, then plan, then review', () => {
  const before = 'Choose how to store it.';
  const summary = `${before}\n\n## Chosen approach\n\nThe second shape: one collection, versioned rows.`;
  const issue = { identifier: 'LIN-70', title: 'Pick a shape', description: summary, state: { name: 'Todo', type: 'unstarted' }, labels: [] };
  const comments = [{ user: 'Agent', createdAt: '2026-11-20T09:00:00.000Z', body: '## Design analysis\n\nThree shapes; the second wins.' }];

  test('design\'s prompt reports in its final message, sends the plan to the plan stage, and has no contract', () => {
    const p = generatePrompt('design', issue, { comments: [] }).prompt;
    assert.match(p, /\*\*Report\*\*: Your final message holds the full design analysis and the chosen approach/);
    assert.match(p, /- \*\*Report\*\* \(your final message, kept on your run's record\): Full design analysis with all approaches evaluated, the chosen approach and its key implementation details/);
    assert.ok(p.includes(DESIGN_PLAN_LINE), 'the one line saying the plan goes to the plan stage');
    assert.doesNotMatch(p, /"kind": "plan"/, 'no plan-record call');
    assert.equal(formatStageContract('design', 'LIN-70'), '', 'design\'s contract is null');
    assert.deepEqual(addedPlanHeadings(before, summary), [], 'the summary carries no plan heading, so the 422 guard allows it');
  });

  test('after a design pass with no plan record, the selector reads no plan and the plan route applies', () => {
    const args = buildSelectorArgs(issue, { comments, children: [], planFacts: planFactsOf({ task: { id: 'task-d', kind: 'task', state: 'open' } }) });
    assert.match(args.facts, /- Plan records on this task: none$/m);
    assert.match(args.facts, /- Session fit \(the plan records' addressee\): none/);
    assert.match(args.facts, /- Plan review owed: no/);
    // Plan's own route says it applies when the task has no plan record of its own and is not a piece of a parent's plan.
    assert.match(buildRouterPrompt(args), /`plan`:[^\n]*\n  When:[^\n]*the task has no plan record of its own and is not a piece of its parent's plan/);
  });
});
