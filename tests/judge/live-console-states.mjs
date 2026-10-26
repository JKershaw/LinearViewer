// Live Console judge states (LIN-3977). Each state seeds its own workspace through the dispatch API, the
// same routes the e2e spec uses (both sides have them), once per server, then the page is shot as it is.
// Seeds are made on the real clock (the page's rows are relative to now), so the judge does not freeze the
// clock for these states; the volatile parts are masked in pages.mjs with their reasons.

export const LIVE_CONSOLE_STATES = new Set(['live-working', 'live-history']);

const seeded = new Set();

async function enqueueAndTake(request, urlKey, { task, title, kind, token }) {
  const created = await request.post(`/workspace/${urlKey}/api/dispatch`, {
    data: { prompt: 'implement', promptName: kind, kind, issueIdentifier: task, issueTitle: title, target: 'cli' },
  });
  if (!created.ok()) throw new Error(`live seed enqueue ${task} failed: ${created.status()} ${await created.text()}`);
  const id = (await created.json()).item.id;
  const taken = await request.post(`/api/dispatch/take/${id}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!taken.ok()) throw new Error(`live seed take ${task} failed: ${taken.status()}`);
  return id;
}

async function feedback(request, id, token, message) {
  const res = await request.post(`/api/dispatch/feedback/${id}`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: { message },
  });
  if (!res.ok()) throw new Error(`live seed feedback failed: ${res.status()} ${await res.text()}`);
}

async function status(request, urlKey, row) {
  const res = await request.post('/test/seed-agent-status', { data: { urlKey, ...row } });
  if (!res.ok()) throw new Error(`live seed status failed: ${res.status()} ${await res.text()}`);
}

// Seeds the state once per (server, workspace). A second shot of the same state is a no-op, because the
// dispatch guard refuses the same kind on the same task inside five minutes.
export async function seedLiveConsole(request, baseURL, urlKey, state) {
  const key = `${baseURL}|${urlKey}`;
  if (!LIVE_CONSOLE_STATES.has(state) || seeded.has(key)) return;
  const tokenRes = await request.get(`/test/create-dispatch-token?label=judge-runner&urlKey=${urlKey}`);
  if (!tokenRes.ok()) throw new Error(`live seed token failed: ${tokenRes.status()}`);
  const { token } = await tokenRes.json();

  if (state === 'live-working') {
    // Two working lanes and one that waits on a question. Each is a run the page can name, with a heartbeat.
    const build = await enqueueAndTake(request, urlKey, { task: 'LOCAL-1', title: 'Local parent task', kind: 'implementation', token });
    await feedback(request, build, token, '[working] 12 tools in 8m 11s: Bash×7, Read×5 · 15 total');
    await status(request, urlKey, { taskIdentifier: 'LOCAL-1', action: 'implementation', status: 'in_progress', summary: 'Writing the picker', dispatchId: build });
    const review = await enqueueAndTake(request, urlKey, { task: 'LOCAL-2', title: 'Local child task', kind: 'plan-review', token });
    await feedback(request, review, token, '[working] 4 tools in 2m 03s: Read×4');
    const waiting = await enqueueAndTake(request, urlKey, { task: 'LOCAL-4', title: 'Second project task', kind: 'plan', token });
    await feedback(request, waiting, token, '[blocked] Which sign-in method should I build: email or Linear?');
  }

  if (state === 'live-history') {
    // A finished run, a failed run, and a status row from earlier, so the stream has history to show.
    const done = await enqueueAndTake(request, urlKey, { task: 'LOCAL-3', title: 'Local done task', kind: 'implementation', token });
    await feedback(request, done, token, '[done] changelog written');
    const failed = await enqueueAndTake(request, urlKey, { task: 'LOCAL-1', title: 'Local parent task', kind: 'research', token });
    await feedback(request, failed, token, '[failed] migration timed out');
    const earlier = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    await status(request, urlKey, { taskIdentifier: 'LOCAL-2', action: 'research', status: 'in_progress', summary: 'Reading the old notes', timestamp: earlier });
  }
  seeded.add(key);
}
