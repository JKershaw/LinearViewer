// LIN-3968: the Home states the visual replay judges. One In Progress task is the top task. Its stage sessions
// are seeded through the consumer API (take, then feedback), which exists on both sides, so the base renders them
// too. Nothing leaves the machine: the write's stream is a fixed fixture.
import { localSeedId } from '../fixtures/local-harness.js';

export const HOME_TOP = 'LOCAL-H1';

/** One project and one In Progress task, the top task. The caller adds `runnerKey` (see replay.spec.js). */
export function homeSeed(urlKey) {
  const id = (raw) => localSeedId(urlKey, raw);
  return {
    urlKey,
    openRouterConnected: true,
    projects: [{ id: id('h-proj'), name: 'Home project', content: 'A project', sortOrder: 1 }],
    issues: [{
      id: id('h-top'), identifier: HOME_TOP, title: 'Home polish task', description: 'Seeded task', projectId: id('h-proj'),
      sortOrder: 1, state: { name: 'In Progress', type: 'started' }, url: `/workspace/${urlKey}/issue/${id('h-top')}`,
    }],
  };
}

// Each state's stages, in order: [kind, feedback]. A null feedback leaves the session running (taken, not ended).
const STAGES = {
  'home-stages-done': [['plan', '[done] planned it'], ['implementation', '[done] built it']],
  'home-running': [['plan', '[done] planned it'], ['implementation', null]],
  'home-failed': [['plan', '[done] planned it'], ['implementation', '[done] built it'], ['review', '[failed] review could not finish']],
};

export const hasHomeSessions = (state) => Object.hasOwn(STAGES, state);

/** Seed the stage sessions for one state through the dispatch API (enqueue, take, feedback). */
export async function seedHomeSessions(request, urlKey, state) {
  const minted = await request.get(`/test/create-dispatch-token?label=runner&urlKey=${urlKey}`);
  if (!minted.ok()) throw new Error(`token mint failed: ${minted.status()}`);
  const { token } = await minted.json();
  const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  for (const [kind, feedback] of STAGES[state]) {
    const res = await request.post(`/workspace/${urlKey}/api/dispatch`, {
      data: { prompt: `${kind} prompt`, promptName: kind, kind, issueIdentifier: HOME_TOP, issueTitle: 'Home polish task', target: 'cli' },
    });
    if (!res.ok()) throw new Error(`dispatch seed failed: ${res.status()} ${await res.text()}`);
    const itemId = (await res.json()).item.id;
    const taken = await request.post(`/api/dispatch/take/${itemId}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!taken.ok()) throw new Error(`take failed: ${taken.status()}`);
    if (feedback) {
      const fb = await request.post(`/api/dispatch/feedback/${itemId}`, { headers: auth, data: { message: feedback } });
      if (!fb.ok()) throw new Error(`feedback failed: ${fb.status()} ${await fb.text()}`);
    }
  }
}

/** The write's stream: a prompt for a subtask of the top task (the container routed to it). */
export const HOME_WRITE_SSE = [
  ['delta', { section: 'prompt', content: 'Write the test for the copy-first view.' }],
  ['done', { truncated: false, completionTokens: null, issueUrl: null, identifier: 'LOCAL-H2', title: 'Write the test', deferredVia: [HOME_TOP] }],
].map(([type, data]) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`).join('');
