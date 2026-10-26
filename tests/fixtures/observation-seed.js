/**
 * Seeding for the Observation e2e specs that need a run waiting on someone
 * (LIN-3983): a dispatch through the real API, taken by a runner, with its
 * `[blocked]` feedback and optionally a structured decision. Provider seeding
 * stays in tests/fixtures/local-harness.js; this file only drives the dispatch
 * and feedback routes the page reads.
 *
 * Shared by tests/e2e/observation-waiting-block.spec.js. The Rulings spec keeps
 * its own copy of these helpers for now (its seeding has grown past these two).
 */
import { expect } from './test-base.js';

// Drop every run the Observation feed reads, so each test starts from nothing.
export async function clearRuns(page, urlKey) {
  await page.goto(`/test/clear-dispatch-queue?urlKey=${urlKey}`);
  await page.goto(`/test/clear-dispatch-history?urlKey=${urlKey}`);
  await page.goto(`/test/clear-agent-status?urlKey=${urlKey}`);
  await page.goto(`/test/clear-observation-sessions?urlKey=${urlKey}`);
  await page.goto(`/test/clear-sessions-feed-cache?urlKey=${urlKey}`);
}

/**
 * Seed a taken run blocked on a question.
 *
 *   - `standalone: true`: one dispatch with no anchor, the case the autopilot
 *     feed does not carry (LIN-1194). Its `[blocked]` message is a plain wait.
 *   - otherwise: an autopilot anchor with one worker under it.
 *
 * With `decisionId`, the worker also carries a structured decision, so the
 * block has a ruling row for it. Without one, the wait is plain.
 */
export async function seedBlockedRun(page, { urlKey, issueIdentifier, issueTitle, decisionId, standalone = false, message = '[blocked] need a ruling before continuing' }) {
  let sessionId;
  if (!standalone) {
    const anchor = await page.request.post(`/workspace/${urlKey}/api/dispatch`, {
      data: { prompt: 'orchestrate', promptName: 'autopilot', kind: 'autopilot', issueIdentifier, issueTitle, target: 'cli' }
    });
    expect(anchor.status(), `anchor seed failed: ${await anchor.text()}`).toBe(201);
    sessionId = (await anchor.json()).item.id;
  }

  const worker = await page.request.post(`/workspace/${urlKey}/api/dispatch`, {
    data: {
      prompt: 'implement',
      promptName: 'implementation',
      kind: 'implementation',
      issueIdentifier,
      issueTitle,
      target: 'cli',
      ...(sessionId ? { sessionId } : {})
    }
  });
  expect(worker.status(), `worker seed failed: ${await worker.text()}`).toBe(201);
  const workerId = (await worker.json()).item.id;

  const tokenResp = await page.request.get(`/test/create-dispatch-token?label=runner&urlKey=${urlKey}`);
  const { token } = await tokenResp.json();
  const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const take = await page.request.post(`/api/dispatch/take/${workerId}`, { headers: auth });
  expect(take.status(), `take failed: ${await take.text()}`).toBe(200);

  const blocked = await page.request.post(`/api/dispatch/feedback/${workerId}`, {
    headers: auth, data: { message }
  });
  expect(blocked.status(), `blocked feedback failed: ${await blocked.text()}`).toBe(200);

  if (decisionId) {
    const decision = await page.request.post(`/api/dispatch/feedback/${workerId}`, {
      headers: auth,
      data: {
        kind: 'decision',
        message: JSON.stringify({
          decision_id: decisionId,
          question: 'Proceed with option A?',
          options: [{ id: 'a', label: 'Approve' }, { id: 'b', label: 'Reject' }],
          recommended: 'a'
        })
      }
    });
    expect(decision.status(), `decision feedback failed: ${await decision.text()}`).toBe(200);
  }
  return { workerId, sessionId };
}
