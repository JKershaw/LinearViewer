// Observation judge states (LIN-3983 PR 2). `obs-two-runs` seeds the set the ticket names: one run
// waiting on a structured question (so the waiting block shows its answer), and one run still working.
// Both the Runs view and the Rulings tab are shot from that one seed (the same urlKey, seeded once per
// server). The seed runs through the dispatch API, the same routes the e2e seed uses (both sides have them),
// on the real clock: the rows are relative to now, and their times are masked in pages.mjs.

export const OBSERVATION_STATES = new Set(['obs-two-runs']);

const seeded = new Set();

async function enqueueAndTake(request, urlKey, { task, title, kind, sessionId }, token) {
  const created = await request.post(`/workspace/${urlKey}/api/dispatch`, {
    data: { prompt: 'implement', promptName: kind, kind, issueIdentifier: task, issueTitle: title, target: 'cli', ...(sessionId ? { sessionId } : {}) },
  });
  if (!created.ok()) throw new Error(`observation seed enqueue ${task} failed: ${created.status()} ${await created.text()}`);
  const id = (await created.json()).item.id;
  const taken = await request.post(`/api/dispatch/take/${id}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!taken.ok()) throw new Error(`observation seed take ${task} failed: ${taken.status()}`);
  return id;
}

async function feedback(request, id, token, body) {
  const res = await request.post(`/api/dispatch/feedback/${id}`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: body,
  });
  if (!res.ok()) throw new Error(`observation seed feedback failed: ${res.status()} ${await res.text()}`);
}

// Seeds once per (server, workspace): a second shot of the same state is a no-op, because the dispatch
// guard refuses the same kind on the same task inside five minutes.
export async function seedObservation(request, baseURL, urlKey, state) {
  const key = `${baseURL}|${urlKey}`;
  if (!OBSERVATION_STATES.has(state) || seeded.has(key)) return;
  const tokenRes = await request.get(`/test/create-dispatch-token?label=judge-runner&urlKey=${urlKey}`);
  if (!tokenRes.ok()) throw new Error(`observation seed token failed: ${tokenRes.status()}`);
  const { token } = await tokenRes.json();

  // A waiting run: an autopilot anchor with one worker, the worker blocked on a structured question.
  const anchorRes = await request.post(`/workspace/${urlKey}/api/dispatch`, {
    data: { prompt: 'orchestrate', promptName: 'autopilot', kind: 'autopilot', issueIdentifier: 'LOCAL-1', issueTitle: 'Local parent task', target: 'cli' },
  });
  if (!anchorRes.ok()) throw new Error(`observation seed anchor failed: ${anchorRes.status()} ${await anchorRes.text()}`);
  const anchor = (await anchorRes.json()).item.id;
  const waiting = await enqueueAndTake(request, urlKey, { task: 'LOCAL-1', title: 'Local parent task', kind: 'implementation', sessionId: anchor }, token);
  await feedback(request, waiting, token, { message: '[blocked] Which sign-in method should I build?' });
  await feedback(request, waiting, token, {
    kind: 'decision',
    message: JSON.stringify({
      decision_id: 'judge-decision-sign-in',
      question: 'Which sign-in method should I build?',
      options: [{ id: 'a', label: 'Email link' }, { id: 'b', label: 'Linear OAuth' }],
      recommended: 'a',
    }),
  });

  // A working run: its own standalone dispatch, with a heartbeat.
  const working = await enqueueAndTake(request, urlKey, { task: 'LOCAL-2', title: 'Local child task', kind: 'plan-review' }, token);
  await feedback(request, working, token, { message: '[working] 4 tools in 2m 03s: Read×4' });
  seeded.add(key);
}
