/**
 * LIN-4532 (P2b) e2e seeding for question records: an asking run parked on `[blocked]` (the way a runner writes it), the question
 * record it asked the signed-in person, a stop of that run, and reads of what an answer or a dismissal wrote.
 *
 * The run and its feedback go through the dispatch API as a runner does (enqueue as the owner, take and feedback with a runner
 * token); the question goes through the test-only seed route (routes/test.js POST /test/seed-question-record), which writes it
 * through the checked records pipeline. Nothing here calls a model.
 */
import { expect } from '@playwright/test';

/** The runner token for a workspace, from the test seam (the same one lin-4242-waiting-live.spec.js uses). */
export async function runnerTokenFor(page, urlKey) {
  const res = await page.request.get(`/test/create-dispatch-token?label=runner&urlKey=${urlKey}`);
  return (await res.json()).token;
}

/** A run parked on `[blocked] which way?`: enqueued by the owner, taken by a runner, then blocked. Returns its item id (the run id). */
export async function askingRun(page, urlKey, identifier, { token = null } = {}) {
  const bearer = token || await runnerTokenFor(page, urlKey);
  const res = await page.request.post(`/workspace/${urlKey}/api/dispatch`, {
    data: { prompt: 'implementation prompt', promptName: 'implementation', kind: 'implementation', issueIdentifier: identifier, issueTitle: identifier, target: 'cli' },
  });
  expect(res.status(), `dispatch seed failed: ${await res.text()}`).toBe(201);
  const itemId = (await res.json()).item.id;
  const taken = await page.request.post(`/api/dispatch/take/${itemId}`, { headers: { Authorization: `Bearer ${bearer}` } });
  expect(taken.status(), `take failed: ${await taken.text()}`).toBe(200);
  const feedback = await page.request.post(`/api/dispatch/feedback/${itemId}`, {
    headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
    data: { message: '[blocked] which way?' },
  });
  expect(feedback.status()).toBe(200);
  return itemId;
}

/** One open question the signed-in person was asked by `runId`, filed under `ticket`. Returns the question record id. */
export async function seedQuestion(page, urlKey, { ticket, runId = null, asks = 'Which way?', options = ['left', 'right'], recommended = 'left', ifUnanswered = 'pick left' } = {}) {
  const res = await page.request.post('/test/seed-question-record', {
    data: { urlKey, ticket, runId, asks, options, recommended, ifUnanswered },
  });
  expect(res.status(), `question seed failed: ${await res.text()}`).toBe(200);
  return (await res.json()).id;
}

/** Stops `runId` as Home's Stop does: an abort row aimed at the run (public/prompt-section.js stopRunNow). */
export async function stopRun(page, urlKey, runId, identifier) {
  const res = await page.request.post(`/workspace/${urlKey}/api/dispatch`, {
    data: { abort: true, abortTo: runId, cascade: false, target: 'cli', issueIdentifier: identifier },
  });
  expect(res.status(), `stop failed: ${await res.text()}`).toBe(201);
}

/** The records of one kind in the workspace, as the store reads them now. */
export async function recordsOf(page, urlKey, kind) {
  const res = await page.request.get(`/test/records-of?urlKey=${urlKey}&kind=${kind}`);
  expect(res.ok()).toBeTruthy();
  return res.json();
}

/** The current state of one question record ('open', 'answered', 'withdrawn'). */
export async function questionState(page, urlKey, questionId) {
  return (await recordsOf(page, urlKey, 'question')).find((r) => r.id === questionId)?.state ?? null;
}

/** The decision record an answer wrote for `questionId` (its `links.answers`), or null. */
export async function decisionFor(page, urlKey, questionId) {
  return (await recordsOf(page, urlKey, 'decision')).find((r) => r.links?.answers === questionId) ?? null;
}

/**
 * A worker waiting on an old-style ruling, written the way lin-4242-waiting-live.spec.js writes it (a `[decision]` on the parked
 * run). Used where a ruling and a question are open together.
 */
export async function seedRuling(page, urlKey, identifier, decision, { token = null } = {}) {
  const bearer = token || await runnerTokenFor(page, urlKey);
  const res = await page.request.post(`/workspace/${urlKey}/api/dispatch`, {
    data: { prompt: 'implementation prompt', promptName: 'implementation', kind: 'implementation', issueIdentifier: identifier, issueTitle: identifier, target: 'cli' },
  });
  expect(res.status(), `dispatch seed failed: ${await res.text()}`).toBe(201);
  const itemId = (await res.json()).item.id;
  const taken = await page.request.post(`/api/dispatch/take/${itemId}`, { headers: { Authorization: `Bearer ${bearer}` } });
  expect(taken.status(), `take failed: ${await taken.text()}`).toBe(200);
  const feedback = (data) => page.request.post(`/api/dispatch/feedback/${itemId}`, {
    headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' }, data,
  });
  expect((await feedback({ message: '[blocked] which way?' })).status()).toBe(200);
  const res2 = await feedback({ kind: 'decision', message: JSON.stringify({ decision_id: `d-${identifier}`, question: `Which for ${identifier}?`, ...decision }) });
  expect(res2.status(), `decision failed: ${await res2.text()}`).toBe(200);
  return itemId;
}
