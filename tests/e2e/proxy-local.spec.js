/**
 * Phase B2 (LIN-584) — full `/api/proxy/*` consumer-API e2e against a LOCAL
 * workspace, over the real data path.
 *
 * Until now `proxy.spec.js` only reached auth/scope/validation: its data path
 * 401s on the fake `test-token` (no real Linear behind it), so the unified
 * consumer contract had no genuine end-to-end coverage. Phase B1 (LIN-583) routed
 * the proxy reads + writes through the injectable `provider` and gave the
 * LocalProvider the proxy surface; this suite rides that seam.
 *
 * The seam (no mocks, no stubbed 200s):
 *   - POST /test/set-local-session seeds the REAL LocalStore partition
 *     'local-workspace' (the same singleton the proxy's resolveProviderAccess
 *     reaches under NODE_ENV=test) with the issues/projects we assert on.
 *   - GET /test/create-proxy-token?urlKey=local-workspace mints a proxy token
 *     whose urlKey routes resolveProviderAccess to the LocalProvider, with the
 *     urlKey as the store partition key — NOT a Linear session scan.
 * Every call below therefore exercises the genuine local data path and the
 * shared lib/proxy-wire.js flatten contract (plain arrays, name-only labels, no
 * backend URLs), proving the source-neutral contract over a second provider.
 *
 * Boundaries that a local workspace structurally cannot exhibit (NOT gaps in
 * this suite — covered elsewhere at the same canonical altitude):
 *   - 409 trashed / trashed-signal: the local store models no soft-delete, so
 *     issueWriteGuard/issueDescription/issueLabels always report trashed:false.
 *     The trashed flatten/signal contract is pinned in tests/unit/proxy-wire.test.js
 *     and the Linear-backed proxy.spec.js.
 *   - 422 CAPABILITY_NOT_SUPPORTED: the LocalProvider supports the full write
 *     surface, so the capability gate is always a pass here. The wire-level
 *     decline (same canonical code) is asserted over HTTP in
 *     tests/unit/proxy-write-capability.test.js via the declining GitHub provider.
 * The 422 this suite DOES assert is the description-splice NOT_FOUND/NOT_UNIQUE.
 */

import { test, expect } from '../fixtures/test-base.js';

const LOCAL_URL_KEY = 'local-workspace';
// teamId/labelId must be UUID-shaped to clear the route's format validation.
// Local has no teams (the filter resolves to nothing) and stores label "ids"
// verbatim as names, so a UUID round-trips as a label name — odd but it exercises
// the real read-modify-write data path, which is the point.
const ANY_UUID = '11111111-1111-1111-1111-111111111111';
const LABEL_UUID = '22222222-2222-2222-2222-222222222222';

// Seeded local workspace: one project; an in-progress parent (LOCAL-1) with a
// label, a comment, and a splice-friendly multi-line body; a todo child
// (LOCAL-2); and a completed issue (LOCAL-3).
const LOCAL_SEED = {
  projects: [
    { id: 'p1', name: 'Proxy Local Project', content: 'Backed by the local store', sortOrder: 1 },
  ],
  issues: [
    {
      id: 'i1', identifier: 'LOCAL-1', title: 'Parent task',
      description: 'Parent body line.\n\nSecond paragraph for splice tests.',
      projectId: 'p1', sortOrder: 1, state: { name: 'In Progress', type: 'started' },
      labels: ['bug'],
      comments: [{ id: 'c1', body: 'Seeded comment', createdAt: '2026-01-01T00:00:00Z', user: 'Alice' }],
    },
    {
      id: 'i2', identifier: 'LOCAL-2', title: 'Child task', description: 'child body',
      projectId: 'p1', parentId: 'i1', sortOrder: 2, state: { name: 'Todo', type: 'unstarted' },
    },
    {
      id: 'i3', identifier: 'LOCAL-3', title: 'Done task', description: 'done body',
      projectId: 'p1', sortOrder: 3, state: { name: 'Done', type: 'completed' },
      completedAt: '2026-01-02T00:00:00Z',
    },
  ],
};

test.describe('Proxy API — local workspace e2e (LIN-584)', () => {
  let readToken;
  let writeToken;

  test.beforeEach(async ({ page }) => {
    // Fresh token store + a freshly seeded local partition for every test.
    await page.goto('/test/clear-proxy-tokens');
    const seedResp = await page.request.post('/test/set-local-session', { data: LOCAL_SEED });
    expect(seedResp.ok()).toBeTruthy();

    const readResp = await page.goto(`/test/create-proxy-token?urlKey=${LOCAL_URL_KEY}&scope=read&label=local-read`);
    readToken = (await readResp.json()).token;
    const writeResp = await page.goto(`/test/create-proxy-token?urlKey=${LOCAL_URL_KEY}&scope=readWrite&label=local-write`);
    writeToken = (await writeResp.json()).token;
  });

  const read = (request, path) => request.get(path, { headers: { Authorization: `Bearer ${readToken}` } });
  const write = (request, method, path, data) =>
    request[method](path, {
      headers: { Authorization: `Bearer ${writeToken}`, 'Content-Type': 'application/json' },
      ...(data ? { data } : {}),
    });

  // ---- Reads --------------------------------------------------------------

  test('GET /me returns the synthetic local viewer', async ({ request }) => {
    const resp = await read(request, '/api/proxy/me');
    expect(resp.status()).toBe(200);
    expect(await resp.json()).toEqual({ id: 'local-user', name: 'Local User', email: 'local@localhost' });
  });

  test('GET /teams is empty (local has no teams)', async ({ request }) => {
    const resp = await read(request, '/api/proxy/teams');
    expect(resp.status()).toBe(200);
    expect((await resp.json()).teams).toEqual([]);
  });

  test('GET /projects returns the seeded project, URL-neutralized', async ({ request }) => {
    const resp = await read(request, '/api/proxy/projects');
    expect(resp.status()).toBe(200);
    const { projects } = await resp.json();
    const p = projects.find(x => x.id === 'p1');
    expect(p).toMatchObject({ id: 'p1', name: 'Proxy Local Project' });
    expect(p.url).toBeUndefined();
  });

  test('GET /issues returns the flat-wire issue list', async ({ request }) => {
    const resp = await read(request, '/api/proxy/issues');
    expect(resp.status()).toBe(200);
    const { issues } = await resp.json();
    expect(issues).toHaveLength(3);
    const parent = issues.find(i => i.identifier === 'LOCAL-1');
    expect(parent.labels).toEqual(['bug']); // flattened to name strings
    expect(parent.url).toBeUndefined();      // backend deep-link stripped
  });

  test('GET /issues?teamId resolves to nothing (local has no teams)', async ({ request }) => {
    const resp = await read(request, `/api/proxy/issues?teamId=${ANY_UUID}`);
    expect(resp.status()).toBe(200);
    expect((await resp.json()).issues).toEqual([]);
  });

  test('GET /issues/:id returns the detail shape with flat children/comments/labels', async ({ request }) => {
    const resp = await read(request, '/api/proxy/issues/LOCAL-1');
    expect(resp.status()).toBe(200);
    const issue = await resp.json();
    expect(issue.identifier).toBe('LOCAL-1');
    expect(issue.trashed).toBe(false);
    expect(Array.isArray(issue.children)).toBe(true);
    expect(issue.children[0].identifier).toBe('LOCAL-2');
    expect(Array.isArray(issue.comments)).toBe(true);
    expect(issue.comments[0].body).toBe('Seeded comment');
    expect(issue.labels).toEqual(['bug']);
    expect(issue.url).toBeUndefined();
  });

  test('GET /search finds issues by text', async ({ request }) => {
    const resp = await read(request, '/api/proxy/search?q=Parent');
    expect(resp.status()).toBe(200);
    const { issues } = await resp.json();
    expect(issues.some(i => i.identifier === 'LOCAL-1')).toBe(true);
  });

  test('GET /states/:teamId returns the local workflow states', async ({ request }) => {
    const resp = await read(request, `/api/proxy/states/${ANY_UUID}`);
    expect(resp.status()).toBe(200);
    const { states } = await resp.json();
    expect(Array.isArray(states)).toBe(true);
    expect(states.length).toBeGreaterThan(0);
    expect(states[0]).toHaveProperty('type');
  });

  test('GET /labels returns the distinct seeded labels', async ({ request }) => {
    const resp = await read(request, '/api/proxy/labels');
    expect(resp.status()).toBe(200);
    const { labels } = await resp.json();
    expect(labels.some(l => l.name === 'bug')).toBe(true);
  });

  test('GET /cycles is empty (local has no cycle concept)', async ({ request }) => {
    const resp = await read(request, '/api/proxy/cycles');
    expect(resp.status()).toBe(200);
    expect(await resp.json()).toEqual({ cycles: [] });
  });

  // ---- Writes: issues + comments ------------------------------------------

  test('POST /issues creates an issue that then reads back (real data path)', async ({ request }) => {
    // LIN-2352: Local's createFields() omits teamId — no fabricated UUID needed.
    const resp = await write(request, 'post', '/api/proxy/issues', {
      title: 'Created over the proxy', description: 'fresh body',
    });
    expect(resp.status()).toBe(201);
    const body = await resp.json();
    expect(body.success).toBe(true);
    expect(body.issue.title).toBe('Created over the proxy');

    // It actually landed: fetch it back by its minted identifier.
    const back = await read(request, `/api/proxy/issues/${body.issue.identifier}`);
    expect(back.status()).toBe(200);
    expect((await back.json()).title).toBe('Created over the proxy');
  });

  test('PATCH /issues/:id updates an issue and persists', async ({ request }) => {
    const resp = await write(request, 'patch', '/api/proxy/issues/LOCAL-2', { title: 'Renamed child' });
    expect(resp.status()).toBe(200);
    expect((await resp.json()).success).toBe(true);

    const back = await read(request, '/api/proxy/issues/LOCAL-2');
    expect((await back.json()).title).toBe('Renamed child');
  });

  // LIN-589: a write response must be self-verifying — it echoes the fields the
  // request set (here: priority + its derived priorityLabel + the project it
  // already had), so a consumer needs no follow-up GET to confirm the mutation.
  test('PATCH echo is self-verifying: carries the set priority + derived priorityLabel (LIN-589)', async ({ request }) => {
    const resp = await write(request, 'patch', '/api/proxy/issues/LOCAL-2', { priority: 2 });
    expect(resp.status()).toBe(200);
    const echoed = (await resp.json()).issue;
    // No follow-up read needed — the echo itself reflects the post-write state.
    expect(echoed.priority).toBe(2);
    expect(echoed.priorityLabel).toBe('High');
    expect(echoed.labels).toEqual([]);        // mutable field present (flat array), not omitted
    expect(echoed.project).toMatchObject({ id: 'p1' }); // existing field round-trips on the echo

    // And it agrees with a subsequent read (priorityLabel also populated on reads).
    const back = await read(request, '/api/proxy/issues/LOCAL-2');
    const fresh = await back.json();
    expect(fresh.priority).toBe(2);
    expect(fresh.priorityLabel).toBe('High');
  });

  test('GET issue/list carry priorityLabel; default priority reads as "No priority" (LIN-589)', async ({ request }) => {
    const detail = await read(request, '/api/proxy/issues/LOCAL-1');
    expect((await detail.json()).priorityLabel).toBe('No priority'); // seeded with no priority → 0

    const list = await read(request, '/api/proxy/issues');
    const parent = (await list.json()).issues.find(i => i.identifier === 'LOCAL-1');
    expect(parent.priorityLabel).toBe('No priority');
  });

  // POST echo completeness: a freshly created issue's response reflects the
  // priority the request set, with no follow-up GET (LIN-589).
  test('POST echo is self-verifying: reflects the set priority + priorityLabel (LIN-589)', async ({ request }) => {
    const resp = await write(request, 'post', '/api/proxy/issues', {
      title: 'Urgent thing', priority: 1,
    });
    expect(resp.status()).toBe(201);
    const issue = (await resp.json()).issue;
    expect(issue.priority).toBe(1);
    expect(issue.priorityLabel).toBe('Urgent');
  });

  // LIN-2352: state-resolution non-regression witness. resolveStateInput
  // throws 422 when its teamId argument is falsy — a teamless create must
  // pass provider.name as a real placeholder so a symbolic stateId still
  // resolves, never regressing 201 → 422 now that teamId itself is optional.
  test('POST /issues {stateId} with no teamId still resolves the symbolic state (LIN-2352)', async ({ request }) => {
    const resp = await write(request, 'post', '/api/proxy/issues', {
      title: 'State-scoped without a team', stateId: 'done',
    });
    expect(resp.status()).toBe(201);
    const issue = (await resp.json()).issue;
    expect(issue.state.type).toBe('completed');
  });

  // LIN-2352: Local's own instance of the stray-teamId refusal, complementing
  // GitHub's in tests/unit/proxy-github-write-routes.test.js.
  test('POST /issues with an explicit teamId on a teamless provider → 400 (LIN-2352)', async ({ request }) => {
    const resp = await write(request, 'post', '/api/proxy/issues', {
      title: 'Should not land', teamId: ANY_UUID,
    });
    expect(resp.status()).toBe(400);
    expect((await resp.json()).error).toContain('teamId is not supported');
  });

  // LIN-1557: the write-contract gate composed with a REAL provider's own
  // apiWriteFields() — every other refusal test injects a hand-written array.
  // LocalProvider omits assigneeId (lib/local-store.js writes `assignee`, never
  // an id), so the field is refused rather than silently dropped on a false 201.
  test('POST /issues refuses a field the real provider does not honour (LIN-1557)', async ({ request }) => {
    const resp = await write(request, 'post', '/api/proxy/issues', {
      title: 'Refused before create', assigneeId: ANY_UUID,
    });
    expect(resp.status()).toBe(400);
    expect((await resp.json()).error).toContain('assigneeId');

    // Nothing half-written: the refusal happens before createIssue is reached.
    const list = await read(request, '/api/proxy/issues');
    const titles = (await list.json()).issues.map(i => i.title);
    expect(titles).not.toContain('Refused before create');
  });

  test('POST /issues/:id/comments creates a comment that shows on the issue', async ({ request }) => {
    const resp = await write(request, 'post', '/api/proxy/issues/LOCAL-1/comments', { body: 'A proxy comment' });
    expect(resp.status()).toBe(201);
    const body = await resp.json();
    expect(body.success).toBe(true);
    expect(body.comment.body).toBe('A proxy comment');

    const back = await read(request, '/api/proxy/issues/LOCAL-1');
    expect((await back.json()).comments.some(c => c.body === 'A proxy comment')).toBe(true);
  });

  // ---- Writes: comment delete/edit (LIN-1160) ------------------------------

  test('comments: create → delete → read-back round-trip (comment is actually gone)', async ({ request }) => {
    const created = await write(request, 'post', '/api/proxy/issues/LOCAL-1/comments', { body: 'Doomed comment' });
    expect(created.status()).toBe(201);
    const commentId = (await created.json()).comment.id;
    expect(commentId).toBeTruthy();

    const del = await write(request, 'delete', `/api/proxy/issues/LOCAL-1/comments/${commentId}`);
    expect(del.status()).toBe(200);
    expect(await del.json()).toEqual({ success: true });

    const after = await read(request, '/api/proxy/issues/LOCAL-1');
    expect((await after.json()).comments.some(c => c.id === commentId)).toBe(false);
  });

  test('comments: create → edit → read-back round-trip (new body lands)', async ({ request }) => {
    const created = await write(request, 'post', '/api/proxy/issues/LOCAL-1/comments', { body: 'Typo-ed comment' });
    expect(created.status()).toBe(201);
    const commentId = (await created.json()).comment.id;

    const edit = await write(request, 'patch', `/api/proxy/issues/LOCAL-1/comments/${commentId}`, { body: 'Corrected comment' });
    expect(edit.status()).toBe(200);
    const editBody = await edit.json();
    expect(editBody.success).toBe(true);
    expect(editBody.comment.body).toBe('Corrected comment');

    const after = await read(request, '/api/proxy/issues/LOCAL-1');
    const afterComment = (await after.json()).comments.find(c => c.id === commentId);
    expect(afterComment.body).toBe('Corrected comment');
  });

  test('comments: delete does not confess a non-UUID/missing id, and non-Linear ids 400', async ({ request }) => {
    const del = await write(request, 'delete', '/api/proxy/issues/LOCAL-1/comments/not-a-uuid');
    expect(del.status()).toBe(400);
  });

  test('comments: dedupe invalidation — create → delete → identical re-create mints a fresh comment, not a stale dedupe echo', async ({ request }) => {
    const body = 'Repeatable comment body';

    const first = await write(request, 'post', '/api/proxy/issues/LOCAL-1/comments', { body });
    expect(first.status()).toBe(201);
    const firstId = (await first.json()).comment.id;

    const del = await write(request, 'delete', `/api/proxy/issues/LOCAL-1/comments/${firstId}`);
    expect(del.status()).toBe(200);

    // Without generation-tag invalidation, this would hit the LIN-399 dedupe
    // cache and come back 200 { deduped: true } carrying the now-deleted id.
    const recreate = await write(request, 'post', '/api/proxy/issues/LOCAL-1/comments', { body });
    expect(recreate.status()).toBe(201);
    const recreateBody = await recreate.json();
    expect(recreateBody.deduped).toBeFalsy();
    expect(recreateBody.comment.id).not.toBe(firstId);

    const after = await read(request, '/api/proxy/issues/LOCAL-1');
    const comments = (await after.json()).comments;
    expect(comments.some(c => c.id === firstId)).toBe(false);
    expect(comments.some(c => c.id === recreateBody.comment.id)).toBe(true);
  });

  test('comments: dedupe invalidation survives mixed issue-id forms — create via identifier, delete via raw id (LIN-2005)', async ({ request }) => {
    const body = 'Mixed-id-form comment body';

    // Create addressed via the identifier form (LOCAL-1)...
    const first = await write(request, 'post', '/api/proxy/issues/LOCAL-1/comments', { body });
    expect(first.status()).toBe(201);
    const firstId = (await first.json()).comment.id;

    // ...but delete addressed via the LocalStore's underlying raw id (i1),
    // per the seed at the top of this file. Per-issue-id-keyed invalidation
    // would bump a different generation key than the create used, leaving
    // the create's dedupe entry live — exactly the LIN-2005 bug.
    const del = await write(request, 'delete', `/api/proxy/issues/i1/comments/${firstId}`);
    expect(del.status()).toBe(200);

    const recreate = await write(request, 'post', '/api/proxy/issues/LOCAL-1/comments', { body });
    expect(recreate.status()).toBe(201);
    const recreateBody = await recreate.json();
    expect(recreateBody.deduped).toBeFalsy();
    expect(recreateBody.comment.id).not.toBe(firstId);

    const after = await read(request, '/api/proxy/issues/LOCAL-1');
    const comments = (await after.json()).comments;
    expect(comments.some(c => c.id === firstId)).toBe(false);
    expect(comments.some(c => c.id === recreateBody.comment.id)).toBe(true);
  });

  // ---- Writes: description splices -----------------------------------------

  test('description/append adds a block, preserving the existing body', async ({ request }) => {
    const resp = await write(request, 'post', '/api/proxy/issues/LOCAL-2/description/append', { block: 'Appended note.' });
    expect(resp.status()).toBe(200);
    const back = await read(request, '/api/proxy/issues/LOCAL-2');
    const desc = (await back.json()).description;
    expect(desc).toContain('child body');     // original preserved
    expect(desc).toContain('Appended note.'); // new block present
  });

  test('description/replace swaps a unique span', async ({ request }) => {
    const resp = await write(request, 'post', '/api/proxy/issues/LOCAL-1/description/replace', {
      oldString: 'Second paragraph', newString: 'Edited paragraph',
    });
    expect(resp.status()).toBe(200);
    const back = await read(request, '/api/proxy/issues/LOCAL-1');
    expect((await back.json()).description).toContain('Edited paragraph');
  });

  test('description/replace → 422 NOT_FOUND when the span is absent', async ({ request }) => {
    const resp = await write(request, 'post', '/api/proxy/issues/LOCAL-1/description/replace', {
      oldString: 'this text is not in the body', newString: 'x',
    });
    expect(resp.status()).toBe(422);
    expect((await resp.json()).code).toBe('NOT_FOUND');
  });

  test('description/replace → 422 NOT_UNIQUE when the span repeats', async ({ request }) => {
    // Seed a body with a repeated token, then try to replace it.
    await write(request, 'patch', '/api/proxy/issues/LOCAL-3', { description: 'dup marker dup marker' });
    const resp = await write(request, 'post', '/api/proxy/issues/LOCAL-3/description/replace', {
      oldString: 'dup marker', newString: 'once',
    });
    expect(resp.status()).toBe(422);
    const body = await resp.json();
    expect(body.code).toBe('NOT_UNIQUE');
    expect(body.matchCount).toBeGreaterThan(1);
  });

  // ---- Writes: relations ---------------------------------------------------

  test('relations: create → read → delete round-trip', async ({ request }) => {
    // Create LOCAL-1 blocks LOCAL-2.
    const created = await write(request, 'post', '/api/proxy/issues/i1/relations', { type: 'blocks', relatedIssueId: 'i2' });
    expect(created.status()).toBe(201);
    const createdBody = await created.json();
    expect(createdBody.success).toBe(true);
    const relationId = createdBody.issueRelation.id;
    expect(relationId).toBeTruthy();

    // It reads back on the source issue's relations.
    const rel = await read(request, '/api/proxy/issues/i1/relations');
    expect(rel.status()).toBe(200);
    const relBody = await rel.json();
    expect(relBody.trashed).toBe(false);
    expect(relBody.relations.some(r => r.type === 'blocks')).toBe(true);

    // Delete it by its own id.
    const del = await write(request, 'delete', `/api/proxy/issues/i1/relations/${relationId}`);
    expect(del.status()).toBe(200);
    expect((await del.json()).success).toBe(true);

    const after = await read(request, '/api/proxy/issues/i1/relations');
    expect((await after.json()).relations).toEqual([]);
  });

  // ---- Writes: labels (read-modify-write) ----------------------------------

  test('labels: add → already-present → remove → not-present round-trip', async ({ request }) => {
    // Add a (UUID-shaped) label id; local stores it verbatim as a label name.
    const add = await write(request, 'post', '/api/proxy/issues/LOCAL-2/labels', { labelId: LABEL_UUID });
    expect(add.status()).toBe(200);
    expect((await add.json()).success).toBe(true);

    const back = await read(request, '/api/proxy/issues/LOCAL-2');
    expect((await back.json()).labels).toContain(LABEL_UUID);

    // Adding the same label again is an idempotent no-op.
    const again = await write(request, 'post', '/api/proxy/issues/LOCAL-2/labels', { labelId: LABEL_UUID });
    expect(again.status()).toBe(200);
    expect((await again.json()).message).toBe('Label already present');

    // Remove it.
    const del = await write(request, 'delete', `/api/proxy/issues/LOCAL-2/labels/${LABEL_UUID}`);
    expect(del.status()).toBe(200);
    expect((await read(request, '/api/proxy/issues/LOCAL-2').then(r => r.json())).labels).not.toContain(LABEL_UUID);

    // Removing an absent label is a no-op.
    const noop = await write(request, 'delete', `/api/proxy/issues/LOCAL-2/labels/${LABEL_UUID}`);
    expect(noop.status()).toBe(200);
    expect((await noop.json()).message).toBe('Label not present');
  });

  // ---- Documented error codes (against the real local path) ----------------

  test('401 — missing token', async ({ request }) => {
    const resp = await request.get('/api/proxy/me');
    expect(resp.status()).toBe(401);
  });

  test('401 — invalid token', async ({ request }) => {
    const resp = await request.get('/api/proxy/me', { headers: { Authorization: 'Bearer not-a-real-token' } });
    expect(resp.status()).toBe(401);
  });

  test('403 — read-only token on a write endpoint', async ({ request }) => {
    const resp = await request.post('/api/proxy/issues/LOCAL-1/comments', {
      headers: { Authorization: `Bearer ${readToken}`, 'Content-Type': 'application/json' },
      data: { body: 'should be blocked' },
    });
    expect(resp.status()).toBe(403);
    expect((await resp.json()).error).toContain('read-write');
  });

  test('400 — malformed issue id', async ({ request }) => {
    const resp = await read(request, '/api/proxy/issues/not%20valid!!!');
    expect(resp.status()).toBe(400);
  });

  test('404 — issue detail for a well-formed but unknown id', async ({ request }) => {
    const resp = await read(request, '/api/proxy/issues/LOCAL-9999');
    expect(resp.status()).toBe(404);
  });

  test('502 — write that does not land (update a nonexistent issue)', async ({ request }) => {
    // Valid id format + valid body, but no such issue: the local updateIssue
    // returns null, normalized to { success: false } → writeRejected → 502.
    const resp = await write(request, 'patch', '/api/proxy/issues/LOCAL-9999', { title: 'ghost' });
    expect(resp.status()).toBe(502);
  });
});
