/**
 * LIN-4515 (P2): the change records a PR gets, written and refreshed in one place.
 *
 * - `backstopChangeFor`: a done implementation run that reported a PR on its own DONE:/[done] line (never a runner's
 *   structured url, LIN-4518 finding-0f91d9be) and has no change for it gets one, under that run, written as `harbour`.
 *   It writes nothing for a PR another task holds or one merged before the run opened. The existence check is by ref
 *   within the task (a stage's own change has a store-generated id, so the two writers agree on the ref, not the id);
 *   the id it writes under is `fixedIdOf('change', taskId, key)`, so a retry hits the store's version index and writes
 *   nothing new. Its head is read through the injected reader; an
 *   unreadable PR still gets its change, without a head, and the refresh fills the head in once the PR can be read.
 * - `refreshTaskChanges`: the one validity read. For each open change of a task it reads the PR through the injected
 *   reader, revises `head` when the PR's head moved (one new version per observed move), ends the change `merged` through
 *   the one merge function, or `abandoned` when the PR closed unmerged. It leaves the change alone when the PR cannot be
 *   read (fail open, as close-out does).
 * - `versionChangeWrite` (LIN-4518 step 2): a stage's change write for a PR its task holds open revises that change to the new
 *   head, a new version of the one record, instead of adding a second. The POST route calls it before adding.
 * - `attachLandingChanges` (LIN-4518 step 2): hands a blind read's prompt the change records it judges, the ids its verdict is `on`.
 * - `recordChangeMerged`: the one merge function. Every merge recorder calls it. It revises the change's head to the PR's
 *   head at merge (never the merge commit, which would stale every approval), then ends the change `merged`.
 *
 * Writes go through the checked pipeline (lib/records/writes.js), never the store's add, revise or end (records area
 * note). The PR reader is injected: lib/records/ imports only Platform, so this module lives beside it, not in it.
 * Nothing else reads a change's head (the characterization test in lin-4515-characterization.test.js enforces it).
 */
import { createRecordWrites } from './records/writes.js';
import { canonicalChangeRef, changeKeyOf, prRefOf } from './records/change-ref.js';
import { splitRef } from './records/check.js';
import { readLanding, landingChangesFor } from './records/landing.js';
import { fixedIdOf } from './records/refs.js';
import { isTerminalState } from './providers/state-map.js';
import { readPrStatusOf } from './github-pr-status.js';
import { terminalReportedPrUrlOfFeedback } from './dispatch-wake.js';
import { BLIND_READ_KIND } from './prompts/blind-read-words.js';

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
 * LIN-4516: the verdict's head pin. A verdict's `heads` (a write-only request field, never stored) names the head
 * its judge read for each change in its `on`: `{<change id>: <sha>}`. For each such change this finds the newest change
 * version whose head is that sha and pins to it as `id@v`. When no version holds the sha, it revises the change to that
 * sha first, through reviseHead (the one head writer besides the refresh), and pins to the version that revise made.
 * The caller writes the verdict on the returned refs and only then runs refreshTaskChanges, so a refresh that moves the
 * change on creates a newer version the pin never names: a push the judge never saw shows the verdict stale at once.
 *
 * Refusals (nothing is written when any holds): a change in `on` with no sha in `heads`; a `heads` key that names no
 * change in `on`; a `@v` on a change (a change is pinned by its head, never by a version the judge did not name); a
 * `heads` that is not an object of strings. A target that is not a change (a plan-review verdict rests on a plan piece)
 * is left as it is for the checked pipeline, and needs no head.
 *
 * Side effect the caller should know: a refused verdict write after this pin may leave a head revise behind. The revise
 * records a head the judge really read, so it is true; the next refresh reconciles the change to the live PR either way.
 *
 * @returns {Promise<{problems: object[]}|{on: string[], tasks: string[]}>} `on` is the refs to write the verdict on;
 *   `tasks` is the task of each pinned change, and of each other target that has one (the verdict is filed under them, and
 *   refreshed)
 */
export async function pinVerdictToHeads({ urlKey, on, heads, writes, recordsStore, run = null }) {
  const refs = [].concat(on ?? []).filter((x) => typeof x === 'string');
  if (heads !== undefined && (heads === null || typeof heads !== 'object' || Array.isArray(heads)
    || Object.values(heads).some((sha) => typeof sha !== 'string' || !sha.trim()))) {
    return { problems: [{ field: 'heads', message: "'heads' must be an object of one sha per change: {\"<change id>\": \"<sha>\"}" }] };
  }
  const headOf = heads ?? {};
  const problems = [];
  const changes = [];
  const tasks = new Set();
  for (const ref of refs) {
    const { id, v } = splitRef(ref);
    const snap = await recordsStore.current(urlKey, id);
    // LIN-4516: a verdict on a non-change target (a plan piece) is filed under that target's task, if it has one.
    if (snap?.kind !== 'change') { if (snap?.in) tasks.add(snap.in); continue; }
    changes.push({ ref, id, snap });
    if (v !== undefined) {
      problems.push({ field: 'on', message: `'${ref}': a change is pinned by its head in heads, not by @${v}` });
    } else if (typeof headOf[id] !== 'string') {
      problems.push({ field: 'heads', message: `${id} is a change this verdict rests on: name the head its judge read, as heads {"${id}": "<sha>"}`, works: [`heads: {"${id}": "<sha>"}`] });
    }
  }
  const named = new Set(changes.map((c) => c.id));
  for (const key of Object.keys(headOf)) {
    if (!named.has(key)) problems.push({ field: 'heads', message: `'${key}' is not a change in on; heads names one head per change the verdict rests on` });
  }
  if (problems.length) return { problems };
  const pinnedBy = new Map();
  for (const { ref, id, snap } of changes) {
    const pin = await pinChangeTo({ urlKey, change: snap, sha: headOf[id], writes, recordsStore, run });
    if (pin.problems) return { problems: pin.problems };
    pinnedBy.set(ref, `${id}@${pin.v}`);
    if (snap.in) tasks.add(snap.in);
  }
  return { on: refs.map((ref) => pinnedBy.get(ref) ?? ref), tasks: [...tasks] };
}

/** The version to pin a change to for `sha`: the newest version holding it, else a new one made by reviseHead. */
async function pinChangeTo({ urlKey, change, sha, writes, recordsStore, run }) {
  const held = (await recordsStore.versionsOf(urlKey, [change.id]))
    .filter((s) => s.fields?.head === sha)
    .sort((a, b) => b.v - a.v)[0];
  if (held) return { v: held.v };
  const revised = await reviseHead({ writes, urlKey, change, headSha: sha, reason: `the head its judge read, ${sha}`, run });
  if (!revised) return { problems: [{ field: 'heads', message: `${change.id} could not take the head its judge read (${sha})` }] };
  return { v: revised.v };
}

/**
 * LIN-4516: the blind-read exactness rule, on the one landing function (lib/records/landing.js). A blind read's
 * `on` must name exactly the landing: the task's open changes plus those merged in the current round. A subset (a landing
 * PR left out) and a superset (a PR the landing does not hold, such as one abandoned, or another task's) are both refused,
 * naming the on field. The rule holds for a partly merged landing too: the change merged this round is in it, so a blind read
 * naming both of a two-PR landing is accepted. Only the record-side rule lives here: the comment-side guard in
 * routes/proxy-writes.js keeps its own landing until P5 flips the stages to records, and P7 retires it.
 * @param {Object} deps
 * @param {string[]} deps.on - the changes the blind read names, by record id (an `@v` is ignored: the pin is the caller's)
 * @returns {Promise<object[]>} the problems: empty when the set is exactly the landing
 */
export async function blindReadSetProblems({ urlKey, recordsStore, on }) {
  const ids = [...new Set(on.map((ref) => splitRef(ref).id))];
  const problems = [];
  const named = new Map();
  const tasks = new Set();
  for (const id of ids) {
    const snap = await recordsStore.current(urlKey, id);
    const key = snap?.kind === 'change' ? changeKeyOf(snap.fields?.ref) : null;
    if (!key || !snap.in) {
      problems.push({ field: 'on', message: `'${id}' is not a change of a task: a blind read's on names the landing's changes` });
      continue;
    }
    named.set(key, snap.fields.ref);
    tasks.add(snap.in);
  }
  if (problems.length) return problems;
  if (tasks.size !== 1) return [{ field: 'on', message: "a blind read names the changes of one task; these are on more than one" }];
  const landing = await readLanding({ recordsStore, urlKey, taskId: [...tasks][0] });
  const want = new Set(landing.map((url) => changeKeyOf(url)));
  const missing = landing.filter((url) => !named.has(changeKeyOf(url)));
  const extra = [...named.entries()].filter(([key]) => !want.has(key)).map(([, ref]) => canonicalChangeRef(ref));
  if (!missing.length && !extra.length) return [];
  const parts = [];
  if (missing.length) parts.push(`leaves out ${missing.join(', ')}`);
  if (extra.length) parts.push(`names ${extra.join(', ')}, which the landing does not hold`);
  return [{
    field: 'on',
    message: `a blind read names exactly the landing: it ${parts.join(' and ')}`,
    works: landing,
    expected: landing,
    got: [...named.values()].map((ref) => canonicalChangeRef(ref)),
  }];
}

/**
 * LIN-4518 step 2 (finding 798836ce): a stage's change write for a PR its task already has an open change for is a new
 * version of that change, not a second record. A new head revises the one record (`head`, with the body's other fields),
 * so a verdict pinned to an earlier version reads stale. The body's `in` is a task or a ticket; its `ref` is the PR.
 * Returns null when the body is not a change write or no open change of the task holds the PR (the caller adds, as
 * before). A write whose head is the head already held writes nothing and answers the change as it stands.
 * `input` is the write's body as the route built it (its routing keys already removed, lib/records/writes.js takes the same
 * shape), so the non-field keys are stripped in one place: the route's list (routes/proxy-records.js).
 * @returns {Promise<null|{record: object}|{problems: object[]}>}
 */
export async function versionChangeWrite({ urlKey, kind, input, writes, recordsStore, by, run = null }) {
  if (kind !== 'change' || typeof input?.in !== 'string' || typeof input?.ref !== 'string') return null;
  const key = changeKeyOf(input.ref);
  if (!key) return null;
  const taskId = await taskIdOfRef({ recordsStore, urlKey, ref: input.in });
  if (!taskId) return null;
  const [change] = await changesOfPr({ recordsStore, urlKey, taskId, key, state: 'open' });
  if (!change) return null;
  const head = typeof input.head === 'string' && input.head.trim() ? input.head.trim() : null;
  const fields = Object.fromEntries(Object.entries(input).filter(([k]) => !['in', 'ref'].includes(k)));
  if (head) fields.head = head;
  const moved = Object.keys(fields).some((k) => k !== 'reason' && change.fields?.[k] !== fields[k]);
  if (!moved) return { record: await recordsStore.viewOfRecord(urlKey, change) };
  const out = await writes.revise({
    urlKey,
    id: change.id,
    input: { ...fields, reason: typeof input.reason === 'string' && input.reason.trim() ? input.reason : `head ${head ?? change.fields?.head}, written by the stage` },
    by,
    run,
  });
  return out.problems ? { problems: out.problems } : { record: out.record };
}

/**
 * LIN-4518 step 2: a blind read's prompt context carries the change records it judges (`landingChanges`). Other stages'
 * contexts pass through unchanged. A records fault leaves `landingChanges` null, which the prompt reads as "not read", so
 * a blind read is never given a guessed id.
 * @returns {Promise<object>} the context, with `landingChanges` when `kind` is the blind read
 */
export async function attachLandingChanges(context, { kind, urlKey, recordsStore, ticket, log = (m) => console.error(m) }) {
  if (kind !== BLIND_READ_KIND || !recordsStore || !urlKey || !ticket) return context;
  try {
    return { ...context, landingChanges: await landingChangesFor({ urlKey, ticket, recordsStore }) };
  } catch (err) {
    log(`[change-records] ${urlKey} ${ticket}: the landing's change records could not be read: ${err?.message || err}`);
    return { ...context, landingChanges: null };
  }
}

/** The task a body's `in` names: a task record by id, or the task a ticket has; null when neither exists yet. */
async function taskIdOfRef({ recordsStore, urlKey, ref }) {
  const snap = await recordsStore.current(urlKey, ref);
  if (snap?.kind === 'task') return snap.id;
  return recordsStore.taskForTicket(urlKey, ref);
}

/**
 * The changes of PR `key` that another task of this workspace holds (any state). A PR is one task's change: the
 * backstop never gives a second task the PR a first task already has (LIN-4518 finding-0f91d9be).
 */
async function changesOfPrElsewhere({ recordsStore, urlKey, taskId, key }) {
  const found = await recordsStore.find(urlKey, { kind: 'change' });
  return found.filter((change) => change.in !== taskId && changeKeyOf(change.fields?.ref) === key);
}

/** When the run opened: the time of its first version, or null when the run record cannot be read. */
async function runStartOf({ recordsStore, urlKey, runId }) {
  if (!runId) return null;
  const { snap } = await recordsStore.read(urlKey, runId, { v: 1 });
  return snap?.at ? new Date(snap.at) : null;
}

/**
 * The backstop (LIN-4515, plan item 6): a done run's PR gets its change from Harbour when no change for it exists in the
 * task. Returns `{existing}`, `{record}`, `{skipped}` or `{problems}`; never a second change for one PR. It writes no
 * change for a PR another task holds, or for a PR the forge reports merged before the run opened (LIN-4518
 * finding-0f91d9be): such a PR cannot be this run's work.
 * @param {Object} deps
 * @param {(args: {repo: string, number: number}) => Promise<object>} [deps.readPrStatus] - the per-PR reader, for the head
 */
export async function backstopChangeFor({ urlKey, taskId, runId, prUrl, writes, recordsStore, readPrStatus = null }) {
  const pr = prRefOf(prUrl);
  if (!pr) return { skipped: 'the run reported no PR URL' };
  const existing = await changesOfPr({ recordsStore, urlKey, taskId, key: changeKeyOf(prUrl) });
  if (existing.length) return { existing: existing[0].id };
  if ((await changesOfPrElsewhere({ recordsStore, urlKey, taskId, key: changeKeyOf(prUrl) })).length) {
    return { skipped: `${canonicalChangeRef(prUrl)} is already another task's change` };
  }
  let headSha = null;
  let mergedAt = null;
  if (readPrStatus) {
    try {
      const status = await readPrStatus({ repo: pr.repo, number: pr.number });
      if (status?.readable === true) {
        headSha = headShaOf(status);
        mergedAt = status.merged_at ? new Date(status.merged_at) : null;
      }
    } catch { headSha = null; mergedAt = null; }
  }
  const startedAt = mergedAt ? await runStartOf({ recordsStore, urlKey, runId }) : null;
  if (mergedAt && startedAt && mergedAt < startedAt) {
    return { skipped: `${canonicalChangeRef(prUrl)} merged before run ${runId} began` };
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
      const prUrl = canonicalChangeRef(terminalReportedPrUrlOfFeedback(feedback));
      if (!taskId || !prUrl) return null;
      const readPrStatus = prReaderFor(urlKey);
      const answer = await backstopChangeFor({ urlKey, taskId, runId, prUrl, writes, recordsStore, readPrStatus });
      if (answer.problems) log(`[change-backstop] ${urlKey} ${runId}: ${JSON.stringify(answer.problems).slice(0, 300)}`);
      else if (answer.skipped) log(`[change-backstop] ${urlKey} ${runId}: no change written, ${answer.skipped}`);
      return answer;
    } catch (err) {
      log(`[change-backstop] ${urlKey} ${runId}: ${err?.message || err}`);
      return null;
    }
  };
}
