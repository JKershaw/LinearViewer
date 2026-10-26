// LIN-3975: the task page's states, for the visual replay judge. Each state is one owner, member, guest or runner-less
// view of one task (`LOCAL-JT1`) in its own workspace (its own urlKey), since a runner token, an ownership edge and a
// share are all per workspace. The sessions are real dispatch rows driven through the consumer take + feedback flow,
// on both sides, so the base renders them too. Nothing leaves the machine: the PR is a seeded GitHub stub.
import { localSeedId } from '../fixtures/local-harness.js';
import { seedWorkspaceOwnership } from '../fixtures/workspace-ownership.js';

export const TASK_ID = 'LOCAL-JT1';
const TITLE = 'A task for the judge';
// A UUID, not the seeded slug: the dispatch route validates `issueId` as a UUID, and the ready state presses a real dispatch.
const TASK_UUID = '11111111-2222-3333-4444-555555555555';
const PR_URL = 'https://github.com/acme/app/pull/41';

// The review summary the ready state's evidence reads: approve, with the close-out's ledger still to discharge.
const REVIEW_BODY = [
  '## Review — seeded',
  '',
  'CI on `abc1234` is green.',
  '',
  '### What CI Did Not Prove',
  '| # | Claim | In/Out | Discharge |',
  '|---|---|---|---|',
  '| L1 | the task page keeps its evidence across a repaint | inside | this state |',
  '',
  '**Verdict: Approve — conditional on close-out discharging the ledger.**',
].join('\n');

/** The workspace's one task. The ready state adds the PR and its review as comments, so the evidence reads them. */
export function taskSeed(urlKey, { ready = false } = {}) {
  const id = (raw) => localSeedId(urlKey, raw);
  const comments = ready
    ? [{ id: 'jt-c-pr', body: `Opened the pull request: ${PR_URL}`, createdAt: '2026-10-06T09:00:00Z', user: 'Runner' },
      { id: 'jt-c-review', body: REVIEW_BODY, createdAt: '2026-10-06T10:00:00Z', user: 'Reviewer' }]
    : [{ id: 'jt-c1', body: 'A comment on the task.', createdAt: '2026-10-06T09:00:00Z', user: 'Alice' }];
  return {
    urlKey,
    projects: [{ id: id('jt-proj'), name: 'Task judge project', content: 'A project', sortOrder: 1 }],
    issues: [{
      id: ready ? TASK_UUID : id('jt-task'), identifier: TASK_ID, title: TITLE, description: 'The **task** this page is about.',
      projectId: id('jt-proj'), sortOrder: 1, state: { name: 'In Progress', type: 'started' },
      url: `/workspace/${urlKey}/issue/${ready ? TASK_UUID : id('jt-task')}`, comments,
    }],
  };
}

// Each state's stage sessions, in order: [kind, feedback]. A null feedback leaves the session running (taken, not ended).
const BUILT = [['plan', '[done] planned it'], ['implementation', '[done] built it']];
const STAGES = {
  'task-build-done': BUILT,
  'task-running': [['plan', '[done] planned it'], ['implementation', null]],
  'task-failed': [...BUILT, ['review', '[failed] review could not finish']],
  'task-waiting': [['plan', '[done] planned it'], ['implementation', '[blocked] which API key should the build use?']],
  'task-chat-open': BUILT,
  'task-member': BUILT,
  'task-guest': BUILT,
};

async function runnerAuth(request, urlKey) {
  const minted = await request.get(`/test/create-dispatch-token?label=runner&urlKey=${urlKey}`);
  if (!minted.ok()) throw new Error(`token mint failed: ${minted.status()}`);
  const { token } = await minted.json();
  return { token, auth: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } };
}

/** One stage session for the task: dispatch, take, then its feedback when there is one. */
async function seedStage(request, urlKey, token, kind, feedback) {
  const res = await request.post(`/workspace/${urlKey}/api/dispatch`, {
    data: { prompt: `${kind} prompt`, promptName: kind, kind, issueIdentifier: TASK_ID, issueTitle: TITLE, target: 'cli' },
  });
  if (!res.ok()) throw new Error(`dispatch seed failed (${kind}): ${res.status()} ${await res.text()}`);
  const itemId = (await res.json()).item.id;
  const taken = await request.post(`/api/dispatch/take/${itemId}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!taken.ok()) throw new Error(`take failed (${kind}): ${taken.status()}`);
  if (feedback) {
    const fb = await request.post(`/api/dispatch/feedback/${itemId}`, { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, data: { message: feedback } });
    if (!fb.ok()) throw new Error(`feedback failed (${kind}): ${fb.status()} ${await fb.text()}`);
  }
}

/**
 * The ready state: a stop-at-PR run, finished, with its PR open and its review approved on the GitHub stub. The
 * stub is global, so it is cleared first and seeded for this state alone.
 */
async function seedReady(request, urlKey) {
  await request.get('/test/clear-pr-status');
  const { token, auth } = await runnerAuth(request, urlKey);
  const anchor = await request.post(`/workspace/${urlKey}/api/dispatch`, {
    data: { prompt: 'orchestrate', promptName: `Autopilot (${TASK_ID})`, kind: 'autopilot', issueIdentifier: TASK_ID, issueTitle: TITLE, target: 'cli', stopAt: 'pr', variant: 'standard' },
  });
  if (!anchor.ok()) throw new Error(`anchor seed failed: ${anchor.status()} ${await anchor.text()}`);
  const anchorId = (await anchor.json()).item.id;
  await request.post(`/api/dispatch/take/${anchorId}`, { headers: { Authorization: `Bearer ${token}` } });
  await request.post(`/api/dispatch/feedback/${anchorId}`, { headers: auth, data: { message: '[done] orchestrated the run' } });
  const pr = await request.post('/test/seed-pr-status', {
    data: { repo: 'acme/app', number: 41, readable: true, state: 'open', merged: false, headSha: 'abc1234deadbeefdeadbeefdeadbeefdeadbeef0', checks: [{ name: 'unit', conclusion: 'success' }] },
  });
  if (!pr.ok()) throw new Error(`seed-pr-status failed: ${pr.status()}`);
}

/**
 * Seed one task state's sessions and set-up, through the same routes the e2e specs use. Called once per server and
 * state (the dispatch guard refuses the same kind on the same task for five minutes).
 */
export async function seedTaskState(request, urlKey, state) {
  if (state === 'task-ready') return seedReady(request, urlKey);
  if (state === 'task-no-runner') return;
  const { token } = await runnerAuth(request, urlKey);
  for (const [kind, feedback] of STAGES[state]) await seedStage(request, urlKey, token, kind, feedback);
  if (state === 'task-member') await seedWorkspaceOwnership(request, urlKey, 'foreign');
}

/** The share path a guest opens (the owner mints it; the page navigates there as the guest). */
export async function mintGuestPath(request, urlKey) {
  const minted = await request.post(`/workspace/${urlKey}/api/task/${TASK_ID}/share`, { data: { source: 'local' } });
  if (!minted.ok()) throw new Error(`share mint failed: ${minted.status()} ${await minted.text()}`);
  return (await minted.json()).path;
}
