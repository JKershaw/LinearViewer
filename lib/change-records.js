/**
 * LIN-4515 (P2): the change records a PR gets, written and refreshed in one place.
 *
 * - `backstopChangeFor`: a done implementation run that reported a PR and has no change for it gets one, under that run,
 *   written as `harbour`. The existence check is by ref within the task (a stage's own change has a store-generated id,
 *   so the two writers agree on the ref, not the id); the id it writes under is `fixedIdOf('change', taskId, key)`, so a
 *   retry hits the store's version index and writes nothing new. Its head is read through the injected reader; an
 *   unreadable PR still gets its change, without a head, and the refresh fills the head in once the PR can be read.
 * - `refreshTaskChanges`: the one validity read. For each open change of a task it reads the PR through the injected
 *   reader, revises `head` when the PR's head moved (one new version per observed move), ends the change `merged` through
 *   the one merge function, or `abandoned` when the PR closed unmerged. It leaves the change alone when the PR cannot be
 *   read (fail open, as close-out does).
 * - `recordChangeMerged`: the one merge function. Every merge recorder calls it. It revises the change's head to the PR's
 *   head at merge (never the merge commit, which would stale every approval), then ends the change `merged`.
 *
 * Writes go through the checked pipeline (lib/records/writes.js), never the store's add, revise or end (records area
 * note). The PR reader is injected: lib/records/ imports only Platform, so this module lives beside it, not in it.
 * Nothing else reads a change's head (the characterization test in lin-4515-characterization.test.js enforces it).
 */
import { createRecordWrites } from './records/writes.js';
import { canonicalChangeRef, changeKeyOf, prRefOf } from './records/change-ref.js';
import { fixedIdOf } from './records/refs.js';
import { isTerminalState } from './providers/state-map.js';
import { readPrStatusOf } from './github-pr-status.js';
import { terminalPrUrlOfFeedback } from './dispatch-wake.js';

const HARBOUR = 'harbour';

/** The head a PR status reports: the sha it was read at (the same rule close-out's statusHeadSha uses). */
export function headShaOf(status) {
  return status?.head?.sha || status?.ref || null;
}

/** The task's changes whose ref names the PR `key` (every state unless `state` is given). */
async function changesOfPr({ recordsStore, urlKey, taskId, key, state = null }) {
  const found = await recordsStore.find(urlKey, { kind: 'change', inRef: taskId, ...(state ? { state } : {}) });
  return found.filter((change) => changeKeyOf(change.fields?.ref) === key);
}

/** Revise a change's head to `headSha` when it differs. Returns the change as it now stands, or null on a refusal. */
async function reviseHead({ writes, urlKey, change, headSha, reason, run = null }) {
  if (!headSha || change.fields?.head === headSha) return change;
  const out = await writes.revise({ urlKey, id: change.id, input: { head: headSha, reason }, by: HARBOUR, run });
  return out.problems ? null : out.record;
}

/**
 * The one merge function (LIN-4515, plan-review notes 5 and 6): ends every open change of `prUrl` in the task `merged`,
 * after revising its head to the PR's head at merge. A change already ended is left as it is (`end` is idempotent).
 * @returns {Promise<object[]>} the changes it ended, as the writes answered them
 */
export async function recordChangeMerged({ urlKey, taskId, prUrl, headSha, writes, recordsStore, run = null }) {
  const key = changeKeyOf(prUrl);
  if (!key) return [];
  const ended = [];
  for (const change of await changesOfPr({ recordsStore, urlKey, taskId, key, state: 'open' })) {
    const revised = await reviseHead({ writes, urlKey, change, headSha, reason: `head at merge, ${headSha}`, run });
    if (!revised) continue;
    const out = await writes.end({ urlKey, id: change.id, input: { state: 'merged', reason: 'the PR merged' }, by: HARBOUR, run });
    if (!out.problems) ended.push(out.record);
  }
  return ended;
}

/**
 * The changes-of-a-task end for a merge recorder: `({prUrl, headSha}) => Promise<object[]>`, resolving the task by the
 * ticket the merge is for. A task with no changes, or no task, ends nothing. Never throws: a records fault is logged and
 * the merge still records (the merge event is the older record; the change is caught up by the next refresh).
 */
export function changesEndingFor({ recordsStore, urlKey, issueIdentifier, log = (m) => console.error(m) }) {
  const writes = createRecordWrites({ recordsStore, isTerminalState });
  return async ({ prUrl, headSha }) => {
    try {
      const taskId = await recordsStore.taskForTicket(urlKey, issueIdentifier);
      if (!taskId) return [];
      return await recordChangeMerged({ urlKey, taskId, prUrl, headSha, writes, recordsStore });
    } catch (err) {
      log(`[change-records] ${urlKey} ${issueIdentifier}: ${err?.message || err}`);
      return [];
    }
  };
}

/**
 * The one validity read (LIN-4515, plan item 2): refreshes each open change of the task from its PR. Returns one answer per
 * open change, so a caller can say what it found.
 * @param {Object} deps
 * @param {(args: {repo: string, number: number}) => Promise<object>} deps.readPrStatus - the per-PR reader (a fail-open
 *   status; the shared 60 s cache is the reader's own)
 */
export async function refreshTaskChanges({ urlKey, taskId, writes, recordsStore, readPrStatus }) {
  const answers = [];
  const open = await recordsStore.find(urlKey, { kind: 'change', inRef: taskId, state: 'open' });
  for (const change of open) {
    const pr = prRefOf(change.fields?.ref);
    if (!pr) { answers.push({ id: change.id, skipped: 'no PR URL' }); continue; }
    let status = null;
    try { status = await readPrStatus({ repo: pr.repo, number: pr.number }); } catch { status = null; }
    if (status?.readable !== true) { answers.push({ id: change.id, unreadable: true }); continue; }
    const headSha = headShaOf(status);
    if (status.merged === true) {
      await recordChangeMerged({ urlKey, taskId, prUrl: pr.url, headSha, writes, recordsStore });
      answers.push({ id: change.id, merged: true, headSha });
      continue;
    }
    if (status.state === 'closed') {
      const out = await writes.end({ urlKey, id: change.id, input: { state: 'abandoned', reason: 'the PR closed unmerged' }, by: HARBOUR });
      answers.push({ id: change.id, abandoned: !out.problems });
      continue;
    }
    const revised = await reviseHead({ writes, urlKey, change, headSha, reason: `head moved to ${headSha}` });
    answers.push({ id: change.id, head: revised?.fields?.head ?? null });
  }
  return answers;
}

/**
 * The backstop (LIN-4515, plan item 6): a done run's PR gets its change from Harbour when no change for it exists in the
 * task. Returns `{existing}`, `{record}` or `{problems}`; never a second change for one PR.
 * @param {Object} deps
 * @param {(args: {repo: string, number: number}) => Promise<object>} [deps.readPrStatus] - the per-PR reader, for the head
 */
export async function backstopChangeFor({ urlKey, taskId, runId, prUrl, writes, recordsStore, readPrStatus = null }) {
  const pr = prRefOf(prUrl);
  if (!pr) return { skipped: 'the run reported no PR URL' };
  const existing = await changesOfPr({ recordsStore, urlKey, taskId, key: changeKeyOf(prUrl) });
  if (existing.length) return { existing: existing[0].id };
  let headSha = null;
  if (readPrStatus) {
    try {
      const status = await readPrStatus({ repo: pr.repo, number: pr.number });
      if (status?.readable === true) headSha = headShaOf(status);
    } catch { headSha = null; }
  }
  const out = await writes.add({
    urlKey,
    kind: 'change',
    input: { in: taskId, ref: pr.url, ...(headSha ? { head: headSha } : {}) },
    by: HARBOUR,
    run: runId,
    fixedId: fixedIdOf('change', taskId, changeKeyOf(prUrl)),
  });
  return out.problems ? { problems: out.problems } : { record: out.record };
}

/**
 * LIN-4515 (beat 4): the change records' PR reader, per workspace, on the one PR-read path (readPrStatusOf in
 * lib/github-pr-status.js, which readPrStatuses uses too). `resolveAccess(urlKey)` is the workspace's tracker access, the
 * same credential the tracker reads use: `{callScope, providerKind}`, or null. `resolveWorkspaceId(urlKey)` names the
 * workspace the owner's installation token is minted for (a Linear- or Jira-bound repo needs it; the live session names
 * it). Anything unresolved reads anonymously, as the close-out chain does; a private repo then reads unreadable, and its
 * change is written or refreshed later, never guessed.
 * @returns {(urlKey: string) => (args: {repo: string, number: number}) => Promise<object>}
 */
export function createChangePrReaders({ resolveAccess, resolveWorkspaceId = null, installationTokenFor = null, seam = {} }) {
  return (urlKey) => async ({ repo, number }) => {
    const access = resolveAccess ? await resolveAccess(urlKey).catch(() => null) : null;
    const workspaceId = resolveWorkspaceId ? await resolveWorkspaceId(urlKey).catch(() => null) : null;
    return readPrStatusOf({
      repo,
      number,
      callScope: access?.callScope ?? null,
      workspace: { urlKey },
      seam,
      providerKind: access?.providerKind ?? null,
      workspaceId,
      installationTokenFor,
    });
  };
}

/**
 * The backstop as the run lifecycle calls it (lib/run-records.js onFeedback): `({urlKey, runId, feedback})`. It reads the
 * run's task and the PR the run's terminal entry reported, then runs the backstop with the reader for that workspace
 * (`prReaderFor`, from createChangePrReaders; required, so no caller can fall back to an anonymous read by accident).
 * Best-effort, like the run seam: a fault is logged, never thrown.
 */
export function createChangeBackstop({ recordsStore, prReaderFor, log = (m) => console.log(m) }) {
  if (typeof prReaderFor !== 'function') throw new Error('createChangeBackstop needs prReaderFor (createChangePrReaders)');
  const writes = createRecordWrites({ recordsStore, isTerminalState });
  return async ({ urlKey, runId, feedback }) => {
    try {
      const run = await recordsStore.run(urlKey, runId);
      const taskId = run?.in ?? null;
      const prUrl = canonicalChangeRef(terminalPrUrlOfFeedback(feedback));
      if (!taskId || !prUrl) return null;
      const readPrStatus = prReaderFor(urlKey);
      const answer = await backstopChangeFor({ urlKey, taskId, runId, prUrl, writes, recordsStore, readPrStatus });
      if (answer.problems) log(`[change-backstop] ${urlKey} ${runId}: ${JSON.stringify(answer.problems).slice(0, 300)}`);
      return answer;
    } catch (err) {
      log(`[change-backstop] ${urlKey} ${runId}: ${err?.message || err}`);
      return null;
    }
  };
}
