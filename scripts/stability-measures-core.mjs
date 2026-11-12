// The Stability Review's five measures, per piece of work (LIN-4399; this core, LIN-4420). Pure: the reads come in
// as data (numstat text, shape totals at two commits, Waiting counts, CI runs) and the ordered reading comes out.
// No I/O here: scripts/stability-measures.mjs does the git, shape and `gh` reads and hands their results over.
//
// Every row has one shape, { key, value, reference, status, reason, unreadable }, in one of three states:
//   measured      value set, reason null, unreadable 0;
//   partial       value set from what could be read, `unreadable` counts what could not, `reason` names it;
//   not measured  value null, reason says why, unreadable null.
// A source that is missing or unreadable is `not measured`, never 0. Zero is a reading: a commit that can be read and
// has no notes directory has 0 Waiting entries. Later pieces add rows of the same shape.
// LIN-4421 adds the tracker half: landing ownership, finished-task selection, sessions, speed, cost and the ID-span
// search for tickets minted. Its reads come in as records too (issue reads, /cost bodies, probe results); the search
// takes an injected probe, so the core still does no I/O of its own.
// LIN-4422 adds measures 1 and 4 in their own pure modules, beside this one: the blind-read sample and tally
// (scripts/stability-measures-blind.mjs, which owns the one Balance-to-sign rule) and the person's seat
// (scripts/stability-measures-seat.mjs). Their rows use row/notMeasured from here; formatTable prints them.

export const SCOPE_INCLUDE = '^(server\\.js$|(lib|routes|public)/.*\\.[cm]?js$)';
export const NOT_BUILT = 'not built yet';

export const STATUS = Object.freeze({ MEASURED: 'measured', PARTIAL: 'partial', NOT_MEASURED: 'not measured' });

/** A row read in full, or in part when `unreadable` > 0 (then `reason` names what was not read). */
export function row(key, value, { unreadable = 0, reason = null, reference = null } = {}) {
  if (value == null) throw new TypeError(`${key}: a row with no value is notMeasured, not row`);
  if (unreadable > 0 && !reason) throw new TypeError(`${key}: a partial read names what it could not read`);
  return { key, value, reference, status: unreadable > 0 ? STATUS.PARTIAL : STATUS.MEASURED, reason: unreadable > 0 ? reason : null, unreadable };
}

/** A row whose source could not be read: no value, never a zero. */
export function notMeasured(key, reason, { reference = null } = {}) {
  if (!reason) throw new TypeError(`${key}: not measured needs a reason`);
  return { key, value: null, reference, status: STATUS.NOT_MEASURED, reason, unreadable: null };
}

// Rounding, the mean and a percentage: one spelling for every stability module (blind and seat import them).
export const round = (n, places) => (n == null ? null : Math.round(n * 10 ** places) / 10 ** places);
const perLanding = (n, landings) => round(n / landings, 1);

export const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// ── churn ────────────────────────────────────────────────────────────────────
/**
 * `git log --format=@%H --numstat` text → [{ commit, files: [{ path, added, deleted }] }], one entry per commit in
 * log order. A binary file's counts are null (numstat prints `-`).
 */
export function parseNumstat(text) {
  const commits = [];
  for (const line of text.split('\n')) {
    if (line.startsWith('@')) { commits.push({ commit: line.slice(1), files: [] }); continue; }
    const m = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line);
    if (!m || !commits.length) continue;
    const num = (s) => (s === '-' ? null : Number(s));
    commits.at(-1).files.push({ path: m[3], added: num(m[1]), deleted: num(m[2]) });
  }
  return commits;
}

/**
 * Added and deleted lines over the window's landings, on the files `inScope` accepts. The denominator is the landings,
 * every first-parent commit, whether it touched the scope or not. An in-scope binary file has no line counts: it is
 * counted as unreadable, so the read is partial rather than short.
 */
export function churnRow(landings, inScope, { reference } = {}) {
  if (!landings.length) return notMeasured('churn', 'no landings in the window', { reference });
  let added = 0;
  let deleted = 0;
  let binary = 0;
  for (const { files } of landings) {
    for (const f of files) {
      if (!inScope(f.path)) continue;
      if (f.added == null) { binary++; continue; }
      added += f.added;
      deleted += f.deleted;
    }
  }
  const n = landings.length;
  const value = {
    landings: n, added, deleted, net: added - deleted,
    perLanding: { added: perLanding(added, n), deleted: perLanding(deleted, n), net: perLanding(added - deleted, n) },
    deletedPerAdded: added ? round(deleted / added, 2) : null,
  };
  return row('churn', value, { unreadable: binary, reason: binary ? `${binary} in-scope binary file change(s) have no line counts` : null, reference });
}

// ── lines ────────────────────────────────────────────────────────────────────
// Comment-only share is over all lines, blanks included: 78,976 / 200,226 = 39.44% at 5334c81a (not 42.5%, the share
// of code + comment). The denominator is pinned by a test.
const endpoint = ({ codeLines, commentLines, blankLines }) => {
  const total = codeLines + commentLines + blankLines;
  return { code: codeLines, comment: commentLines, blank: blankLines, total, commentShare: total ? round((commentLines / total) * 100, 2) : null };
};

/**
 * Net production lines between two commits, from the shape kit's totals at each (measureShape's `totals`, with its
 * `scope.parseFailures.length` as `parseFailures`). Code, comment-only and blank stay apart; the comment-only share is
 * given at both ends. Files the counter could not parse are the partial-read count.
 */
export function linesRow({ base, head, landings, reference }) {
  if (!base || !head) return notMeasured('lines', 'shape totals missing at an endpoint', { reference });
  if (!landings) return notMeasured('lines', 'no landings in the window', { reference });
  const b = endpoint(base.totals);
  const h = endpoint(head.totals);
  const net = { total: h.total - b.total, code: h.code - b.code, comment: h.comment - b.comment, blank: h.blank - b.blank };
  const value = {
    base: b, head: h, net,
    perLanding: Object.fromEntries(Object.entries(net).map(([k, v]) => [k, perLanding(v, landings)])),
  };
  const unreadable = (base.parseFailures ?? 0) + (head.parseFailures ?? 0);
  return row('lines', value, { unreadable, reason: unreadable ? `${unreadable} in-scope file(s) did not parse (base ${base.parseFailures}, head ${head.parseFailures})` : null, reference });
}

// ── CI ───────────────────────────────────────────────────────────────────────
/**
 * Median minutes of successful `test.yml` runs on main whose head sha is a window landing; duration is updatedAt −
 * startedAt. `runs` is null when the listing could not be read (then `reason` says why). Landings with no matched run
 * make the read partial: a listing that stopped short, or a landing whose CI did not pass, both show as unreadable.
 */
export function ciRow({ runs, reason, landingShas, listingCapped = false, reference }) {
  if (runs == null) return notMeasured('ci', reason ?? 'CI runs not read', { reference });
  if (!landingShas.length) return notMeasured('ci', 'no landings in the window', { reference });
  const wanted = new Set(landingShas);
  const matched = runs.filter((r) => wanted.has(r.headSha) && (r.conclusion == null || r.conclusion === 'success'));
  if (!matched.length) return notMeasured('ci', `no successful run matched any of the ${landingShas.length} landings`, { reference });
  const minutes = matched.map((r) => (new Date(r.updatedAt) - new Date(r.startedAt)) / 60000);
  const landingsWithRun = new Set(matched.map((r) => r.headSha)).size;
  const missing = landingShas.length - landingsWithRun;
  const value = { medianMinutes: round(median(minutes), 2), runs: matched.length, landingsWithRun, landings: landingShas.length, listingCapped };
  const why = [missing ? `${missing} landing(s) have no successful run` : null, listingCapped ? 'the run listing hit its limit' : null].filter(Boolean).join('; ');
  return row('ci', value, { unreadable: missing, reason: missing ? why : null, reference });
}

// ── Waiting ──────────────────────────────────────────────────────────────────
/**
 * Waiting entries at the window's two ends for one source. `base` and `head` are each { count } or { reason } (the
 * count read, or why it could not be). Totals at both ends, the change, and the change per landing.
 */
export function waitingRow(key, { base, head, landings, reference, detail = {} }) {
  const missing = [base?.reason && `base: ${base.reason}`, head?.reason && `head: ${head.reason}`].filter(Boolean);
  if (!base || !head) missing.push('endpoint not read');
  if (missing.length) return notMeasured(key, missing.join('; '), { reference });
  if (!landings) return notMeasured(key, 'no landings in the window', { reference });
  const change = head.count - base.count;
  return row(key, { ...detail, base: base.count, head: head.count, change, perLanding: round(change / landings, 2) }, { reference });
}

/** Harbour and the runner apart, and their sum, which exists only when both were read. */
export function waitingRows({ harbour, runner, landings, references = {} }) {
  const h = waitingRow('waiting.harbour', { ...harbour, landings, reference: references['waiting.harbour'] });
  const r = runner.reason
    ? notMeasured('waiting.runner', runner.reason, { reference: references['waiting.runner'] })
    : waitingRow('waiting.runner', { ...runner, landings, reference: references['waiting.runner'] });
  const unread = [h, r].filter((x) => x.status === STATUS.NOT_MEASURED).map((x) => x.key);
  const total = unread.length
    ? notMeasured('waiting.total', `${unread.join(' and ')} not measured`, { reference: references['waiting.total'] })
    : waitingRow('waiting.total', {
      base: { count: h.value.base + r.value.base }, head: { count: h.value.head + r.value.head }, landings, reference: references['waiting.total'],
    });
  return [h, r, total];
}

// ── tracker: landing ownership ──────────────────────────────────────────────
// LIN-4421 ruling (comment 8bec1ee6): each landing names only its own ticket. Matching whole messages picks up
// precedents ("LIN-690 reopened") and gives tickets fake last landings: 163 ids in the 8 Nov window against 106 by
// own ticket. This is the one ownership rule for the measure; the CLI keeps no ticket regex of its own.
export const TICKET_KEY = 'LIN';

const MERGE_PR = /^Merge pull request #\d+ from (\S+)/;
const MERGE_BRANCH = /^Merge (?:remote-tracking )?branch '([^']+)'/;

/**
 * The ticket a landing delivers, or null. A squash landing: the first id in its subject. A merge landing: the id in
 * its branch name (`feat/lin-4421-...`, case-insensitive), else the first id in the PR title (the body's first line).
 * Branch before title: the branch is named when the work is dispatched, the title can be re-worded to cite another
 * ticket; in the 8 Nov window they never disagree (114 of 114 landings), so the order is pinned, not observed.
 */
export function ownTicket(subject, body = '', { key = TICKET_KEY } = {}) {
  const first = (text, flags = '') => {
    const m = new RegExp(`\\b${key}-(\\d+)\\b`, flags).exec(text ?? '');
    return m ? `${key}-${Number(m[1])}` : null;
  };
  const merge = MERGE_PR.exec(subject) ?? MERGE_BRANCH.exec(subject);
  if (!merge) return first(subject);
  const title = String(body ?? '').trim().split('\n')[0];
  return first(merge[1], 'i') ?? first(title);
}

/**
 * `git log --format=%H%x1f%cI%x1f%s%x1f%b%x1e` text → [{ commit, date, subject, body }], in log order.
 */
export function parseLandingLog(text) {
  return text.split('\x1e').map((r) => r.replace(/^\n+/, '')).filter(Boolean).map((r) => {
    const [commit, date, subject, body = ''] = r.split('\x1f');
    return { commit, date, subject, body: body.trim() };
  });
}

/** ticket → { landings: [sha…], lastLandingAt } over the given landings; plus the landings that own no ticket. */
export function landingOwners(landings) {
  const owners = new Map();
  const unowned = [];
  for (const l of landings) {
    const id = ownTicket(l.subject, l.body);
    if (!id) { unowned.push(l.commit); continue; }
    const o = owners.get(id) ?? { landings: [], lastLandingAt: null };
    o.landings.push(l.commit);
    if (!o.lastLandingAt || new Date(l.date) > new Date(o.lastLandingAt)) o.lastLandingAt = l.date;
    owners.set(id, o);
  }
  return { owners, unowned };
}

// ── tracker: finished tasks ──────────────────────────────────────────────────
const inWindow = (at, baseDate, headDate) => at != null && new Date(at) > new Date(baseDate) && new Date(at) <= new Date(headDate);

/**
 * Finished tasks (D3 as the LIN-4421 ruling changed it): a ticket owned by a landing up to head, Done, with
 * `completedAt` in (base, head]. A ticket that lands in two windows counts once, where it finished; one merged just
 * before base and marked Done after it (close-out runs after the merge) counts here, not nowhere.
 *
 * `window` and `prior` are landingOwners() of the window's landings and of the landings read before base.
 * `issues` maps id → { state: { type }, completedAt, parent? } or { reason } (an issue read that failed). A finished
 * task carries its parent's id (or null), so the seat row can name rulings anchored on a parent (LIN-4422).
 * Window tickets not finished here are counted by why, never dropped. A prior-only ticket not finished here belongs
 * to another window and is not reported. Any failed read is unreadable: it might have been finished here.
 */
export function selectFinished({ window, prior = { owners: new Map() }, issues, baseDate, headDate }) {
  const finished = [];
  const notDone = [];
  const doneOutside = [];
  const unreadable = [];
  const ids = new Set([...window.owners.keys(), ...prior.owners.keys()]);
  for (const id of [...ids].sort((a, b) => Number(a.split('-')[1]) - Number(b.split('-')[1]))) {
    const issue = issues.get(id);
    const inThis = window.owners.has(id);
    if (!issue || issue.reason) { unreadable.push({ id, reason: issue?.reason ?? 'not read' }); continue; }
    const done = issue.state?.type === 'completed';
    if (done && inWindow(issue.completedAt, baseDate, headDate)) {
      const own = [window.owners.get(id), prior.owners.get(id)].filter(Boolean);
      const lastLandingAt = own.map((o) => o.lastLandingAt).sort((a, b) => new Date(b) - new Date(a))[0];
      finished.push({ id, completedAt: issue.completedAt, lastLandingAt, landedInWindow: inThis, parent: issue.parent ?? null });
    } else if (inThis) {
      (done ? doneOutside : notDone).push(done ? { id, completedAt: issue.completedAt } : { id, state: issue.state?.name ?? issue.state?.type ?? null });
    }
  }
  return { finished, notDone, doneOutside, unreadable };
}

/** The finished-task row: the denominator of speed and cost, with what landed and did not finish beside it. */
export function tasksRow({ selection, windowTickets, unownedLandings, lookback, reference }) {
  const { finished, notDone, doneOutside, unreadable } = selection;
  if (unreadable.length && !finished.length && !notDone.length && !doneOutside.length) {
    return notMeasured('tasks', `every issue read failed (${unreadable[0].reason})`, { reference });
  }
  const value = {
    finished: finished.length,
    finishedLandedBefore: finished.filter((t) => !t.landedInWindow).length,
    windowTickets,
    landedUnfinished: notDone.length,
    landedDoneOutside: doneOutside.length,
    unownedLandings: unownedLandings.length,
    lookback,
    ids: {
      finished: finished.map((t) => t.id), landedUnfinished: notDone, landedDoneOutside: doneOutside,
      unreadable, unownedLandings,
    },
  };
  return row('tasks', value, { unreadable: unreadable.length, reason: unreadable.length ? `${unreadable.length} issue read(s) failed: ${[...new Set(unreadable.map((u) => u.reason))].join('; ')}` : null, reference });
}

// ── tracker: sessions, speed and cost from /cost ─────────────────────────────
// LIN-4421 ruling: a session is a dispatch lineage as /cost counts it (`workerSessions`, lib/cost-read.js), not a
// non-wake dispatch row. LIN-4393 has 14 rows, 5 of them wakes, so the row rule gives 9; its leftover run resumes the
// implementation's lineage, and /cost reads 8. Speed and cost share this one count.
export const sessionsOf = (cost) => (cost?.noLineage || !Array.isArray(cost?.workerSessions) ? null : cost.workerSessions.length);

/** The earliest dispatch of the task: the earliest lineage root (a root is its lineage's first member). */
export function firstDispatchOf(cost) {
  if (sessionsOf(cost) == null) return null;
  const times = cost.workerSessions.flatMap((s) => [s.dispatchedAt, ...(s.dispatches ?? []).map((d) => d.dispatchedAt)]).filter(Boolean);
  if (!times.length) return null;
  return times.reduce((a, b) => (new Date(b) < new Date(a) ? b : a));
}

export const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
/** n / d as a percentage to one place; null when there is no denominator. */
export const percent = (n, d) => (d ? round((n / d) * 100, 1) : null);
const tally = (items) => Object.entries(items.reduce((m, k) => ({ ...m, [k]: (m[k] ?? 0) + 1 }), {})).map(([k, n]) => `${n} ${k}`).join(', ');

/**
 * Speed per finished task: minutes from first dispatch to last landing, and sessions. `tasks` is
 * [{ id, lastLandingAt, cost: { body } | { reason } }]. A failed /cost read, a task with no lineage, or one whose
 * first dispatch came after its last landing (landed by hand, dispatched later) has no speed: unreadable, counted.
 */
export function speedRow(tasks, { reference } = {}) {
  if (!tasks.length) return notMeasured('speed', 'no finished tasks in the window', { reference });
  const minutes = [];
  const sessions = [];
  const why = [];
  const perTask = [];
  for (const t of tasks) {
    if (t.cost.reason) { why.push('cost read failed'); continue; }
    const n = sessionsOf(t.cost.body);
    const first = firstDispatchOf(t.cost.body);
    if (n == null) { why.push('no lineage'); continue; }
    if (!first) { why.push('no dispatch time'); continue; }
    const m = (new Date(t.lastLandingAt) - new Date(first)) / 60000;
    if (m < 0) { why.push('first dispatch after last landing'); continue; }
    minutes.push(m);
    sessions.push(n);
    perTask.push({ id: t.id, minutes: round(m, 1), sessions: n });
  }
  if (!minutes.length) return notMeasured('speed', `no finished task could be timed (${tally(why)})`, { reference });
  const value = {
    tasks: tasks.length, read: minutes.length,
    medianMinutes: round(median(minutes), 1), meanMinutes: round(mean(minutes), 1),
    medianSessions: median(sessions), meanSessions: round(mean(sessions), 2),
    perTask,
  };
  return row('speed', value, { unreadable: why.length, reason: why.length ? tally(why) : null, reference });
}

/**
 * Cost per finished task: median and mean `totalUsd`. A null `totalUsd` is unreadable, never 0, and so is a failed
 * read; the causes stay apart (a task partly unpriced is not a broken read). /cost's own counters are summed beside.
 */
export function costRow(tasks, { reference } = {}) {
  if (!tasks.length) return notMeasured('cost', 'no finished tasks in the window', { reference });
  const usd = [];
  const nullTotal = { unpriced: 0, noTelemetry: 0, unreadable: 0, noLineage: 0, other: 0 };
  const failures = [];
  const counters = { unpriced: 0, noTelemetryCount: 0, unreadableCount: 0, noLineage: 0 };
  const perTask = [];
  for (const t of tasks) {
    if (t.cost.reason) { failures.push({ id: t.id, reason: t.cost.reason }); continue; }
    const c = t.cost.body;
    counters.unpriced += c.unpriced?.length ?? 0;
    counters.noTelemetryCount += c.noTelemetryCount ?? 0;
    counters.unreadableCount += c.unreadableCount ?? 0;
    counters.noLineage += c.noLineage ? 1 : 0;
    if (typeof c.totalUsd === 'number') { usd.push(c.totalUsd); perTask.push({ id: t.id, usd: round(c.totalUsd, 2) }); continue; }
    // One cause per task, first that applies, so the causes sum to the null count.
    if (c.noLineage) nullTotal.noLineage++;
    else if (c.unpriced?.length) nullTotal.unpriced++;
    else if (c.noTelemetryCount) nullTotal.noTelemetry++;
    else if (c.unreadableCount) nullTotal.unreadable++;
    else nullTotal.other++;
    perTask.push({ id: t.id, usd: null });
  }
  const nulls = Object.values(nullTotal).reduce((a, b) => a + b, 0);
  const unreadable = nulls + failures.length;
  const causes = [
    nulls ? `${nulls} null totalUsd (${Object.entries(nullTotal).filter(([, n]) => n).map(([k, n]) => `${k} ${n}`).join(', ')})` : null,
    failures.length ? `${failures.length} cost read(s) failed (${[...new Set(failures.map((f) => f.reason))].join('; ')})` : null,
  ].filter(Boolean).join('; ');
  if (!usd.length) return notMeasured('cost', `no finished task has a total: ${causes}`, { reference });
  const value = {
    tasks: tasks.length, priced: usd.length,
    medianUsd: round(median(usd), 2), meanUsd: round(mean(usd), 2),
    nullTotal, readFailures: failures, counters, perTask,
  };
  return row('cost', value, { unreadable, reason: unreadable ? causes : null, reference });
}

// ── tracker: tickets minted (ID-span estimate) ───────────────────────────────
/**
 * The highest issue number created at or before `at`, searched by probing single issues (the issue list carries no
 * timestamps). `probe(n)` resolves to { status: 'ok', createdAt, trashed } | { status: 'missing' } |
 * { status: 'unreadable', reason }. `hi` must be a known existing number (a 404 cannot tell a gap from beyond the
 * maximum, so the search never walks above it); `lo` a number known to be created at or before `at`, or 0.
 * A 404 or a trashed issue is a gap: the search steps up past it to the next number that exists. Issue numbers rise
 * with creation, so this is a bisection on (lo, hi). Every probe is recorded; an unreadable probe ends the search
 * with its reason (an answer around a hole would be a guess).
 */
export async function idSpanSearch({ at, lo = 0, hi, probe, cache = new Map() }) {
  const probes = [];
  const read = async (n) => {
    if (!cache.has(n)) cache.set(n, await probe(n));
    const r = cache.get(n);
    probes.push({ n, status: r.status === 'ok' && r.trashed ? 'trashed' : r.status, createdAt: r.createdAt ?? null });
    return r;
  };
  const exists = (r) => r.status === 'ok' && !r.trashed;
  const before = (r) => new Date(r.createdAt) <= new Date(at);
  const top = await read(hi);
  if (top.status === 'unreadable') return { reason: `probe of ${hi} unreadable: ${top.reason}`, probes };
  if (!exists(top)) return { reason: `bracket ${hi} is not an existing issue`, probes };
  if (before(top)) return { value: hi, atBracket: true, probes };
  // Invariant: lo exists (or is 0) and was created at or before `at`; every existing number >= hi was created after.
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    let n = mid;
    let r = await read(n);
    while (!exists(r) && r.status !== 'unreadable' && n + 1 < hi) r = await read(++n);
    if (r.status === 'unreadable') return { reason: `probe of ${n} unreadable: ${r.reason}`, probes };
    if (!exists(r)) { hi = mid; continue; } // mid..hi-1 are all gaps
    if (before(r)) lo = n; else hi = mid;
  }
  return { value: lo, atBracket: false, probes };
}

/**
 * Tickets minted per landing, labelled an ID-span estimate: the highest issue number created at or before head minus
 * the same at base, over the window's landings. The span counts trashed and missing numbers (they were minted too).
 */
export function mintedRow({ base, head, landings, bracket, key = TICKET_KEY, reference }) {
  const failed = [base?.reason && `base: ${base.reason}`, head?.reason && `head: ${head.reason}`].filter(Boolean);
  if (!base || !head) failed.push('endpoint not searched');
  if (failed.length) return notMeasured('minted', `ID-span search failed (${failed.join('; ')})`, { reference });
  if (!landings) return notMeasured('minted', 'no landings in the window', { reference });
  const span = head.value - base.value;
  return row('minted', {
    label: 'ID-span estimate', base: `${key}-${base.value}`, head: `${key}-${head.value}`, span, perLanding: round(span / landings, 2),
    bracket: bracket ?? null, headAtBracket: head.atBracket,
    probes: { base: base.probes.map((p) => p.n), head: head.probes.map((p) => p.n), detail: [...base.probes, ...head.probes] },
  }, { reference });
}

// ── the reading ──────────────────────────────────────────────────────────────
/** The five measures in the order they win when they clash (LIN-4399's ask). */
export const MEASURES = Object.freeze([
  { rank: 1, key: 'no-new-mess', title: 'No new mess' },
  { rank: 2, key: 'curve', title: 'The curve' },
  { rank: 3, key: 'speed', title: 'Speed' },
  { rank: 4, key: 'seat', title: "The person's seat" },
  { rank: 5, key: 'cost', title: 'Cost per finished task' },
]);

export const MINTED_NOT_SUPPLIED = 'tracker reads not supplied';

/**
 * The ordered reading. `rows` maps a measure key to its rows; a measure with none yet reads `not measured: not built
 * yet`. The curve opens with net production lines, then churn, CI and Waiting, and always ends with tickets minted
 * per landing: a caller that supplies no minted row gets `not measured: tracker reads not supplied`, never a gap.
 */
export function buildReading({ window, rows = {}, references = {} }) {
  const curve = rows.curve ?? [];
  const withMinted = curve.some((r) => r.key === 'minted') ? curve : [...curve, notMeasured('minted', MINTED_NOT_SUPPLIED, { reference: references.minted })];
  const filled = { ...rows, curve: withMinted };
  return {
    window,
    measures: MEASURES.map((m) => ({
      ...m,
      rows: filled[m.key]?.length ? filled[m.key] : [notMeasured(m.key, NOT_BUILT, { reference: references[m.key] })],
    })),
  };
}

// ── the opening table (stderr) ───────────────────────────────────────────────
const num = (n) => (n == null ? '—' : n.toLocaleString('en-GB'));
const signed = (n) => (n == null ? '—' : `${n > 0 ? '+' : ''}${n.toLocaleString('en-GB')}`);

const summarise = (r) => {
  const v = r.value;
  switch (r.key) {
    case 'sample': return `${v.sampled} of ${v.ordinary} ordinary landings (of ${v.landings}; ${v.repeatLandings} repeat ticket landing(s) skipped): ${v.commits.map((c) => `${c.commit.slice(0, 9)} ${c.ticket}`).join(', ')}`;
    case 'blind': return `${v.neutralOrBetterShare}% neutral or better (${v.neutralOrBetter} of ${v.read} read), ${v.worse} worse, mean sign ${signed(v.meanSign)} (better ${v.counts.better}, neutral ${v.counts.neutral}, mixed ${v.counts.mixed}, worse ${v.counts.worse})`;
    case 'rulings': return `${v.label}: ${v.raised} raised over ${v.finished} finished tasks, ${v.perFinishedTask} per task (distinct decisions); answered ${v.answeredShare == null ? '—' : `${v.answeredShare}%`} of answered + dismissed (answered ${v.outcomes.answered}, dismissed ${v.outcomes.dismissed}, withdrawn ${v.outcomes.withdrawn}, open ${v.outcomes.open}); not read: ${v.notRead.join('; ')}`;
    case 'operator-free': return `${v.label}: ${v.share}% (${v.operatorFree} of ${v.read} tasks) with ${v.conditions.join(', ')}; failing: ruling ${v.failing.ruling}, blocked ${v.failing.blocked}, operator-closed ${v.failing.operatorClosed}; missing condition: ${v.missingCondition}; closedReason 'operator' is a catch-all and may push the share down`;
    case 'lines': return `net ${signed(v.net.total)} (code ${signed(v.net.code)}, comment-only ${signed(v.net.comment)}, blank ${signed(v.net.blank)}); ${signed(v.perLanding.total)} per landing; totals ${num(v.base.total)} → ${num(v.head.total)}; comment-only share ${v.base.commentShare}% → ${v.head.commentShare}%`;
    case 'churn': return `${num(v.added)} added, ${num(v.deleted)} deleted over ${v.landings} landings; ${v.perLanding.added} added and ${v.perLanding.deleted} deleted per landing; ${v.deletedPerAdded} deleted per added`;
    case 'ci': return `median ${v.medianMinutes} min over ${v.runs} runs (${v.landingsWithRun} of ${v.landings} landings)`;
    case 'minted': return `${v.span} over ${v.base} → ${v.head}, ${v.perLanding} per landing (${v.label}; ${v.probes.detail.length} probes)`;
    case 'tasks': return `${v.finished} finished (${v.finishedLandedBefore} landed before base); of ${v.windowTickets} tickets landed here, ${v.landedUnfinished} not done and ${v.landedDoneOutside} done outside the window; ${v.unownedLandings} landing(s) own no ticket; lookback ${v.lookback?.days ?? '—'} days`;
    case 'speed': return `median ${v.medianMinutes} min (mean ${v.meanMinutes}) first dispatch → last landing; median ${v.medianSessions} sessions (mean ${v.meanSessions}); ${v.read} of ${v.tasks} tasks`;
    case 'cost': return `median $${v.medianUsd} (mean $${v.meanUsd}) over ${v.priced} of ${v.tasks} tasks; unpriced ${v.counters.unpriced}, noTelemetryCount ${v.counters.noTelemetryCount}, unreadableCount ${v.counters.unreadableCount}, noLineage ${v.counters.noLineage}`;
    default:
      if (r.key.startsWith('waiting.')) return `${num(v.base)} → ${num(v.head)} (${signed(v.change)}, ${signed(v.perLanding)} per landing)${v.branch ? `; ${v.branch} ${v.baseSha?.slice(0, 9)}..${v.headSha?.slice(0, 9)}` : ''}`;
      return JSON.stringify(v);
  }
};

const describeRow = (r) => {
  const body = r.status === STATUS.NOT_MEASURED ? `not measured: ${r.reason}` : summarise(r);
  return `${body}${r.status === STATUS.PARTIAL ? ` [partial: ${r.unreadable} unreadable — ${r.reason}]` : ''}`;
};

// A reference from a committed reading (referencesFrom) prints on its own line under the live row, summarised by the
// same rule as the row; any other reference value prints as it is.
const describeReference = (r) => {
  const ref = r.reference;
  if (ref && typeof ref === 'object' && 'status' in ref) return `${ref.label}: ${describeRow({ ...ref, key: r.key })}`;
  return `reference: ${typeof ref === 'object' ? JSON.stringify(ref) : ref}`;
};

/** One line per row, measures in order: the review's opening table. A row with a reference gets a second line. */
export function formatTable(reading) {
  const { window: w } = reading;
  const lines = [`stability measures ${w.base.slice(0, 9)}..${w.head.slice(0, 9)} (${w.baseDate} → ${w.headDate}), ${w.landings} landings`];
  for (const m of reading.measures) {
    lines.push(`${m.rank}. ${m.title}`);
    for (const r of m.rows) {
      lines.push(`   ${r.key.padEnd(16)} ${describeRow(r)}`);
      if (r.reference != null) lines.push(`   ${''.padEnd(16)} ${describeReference(r)}`);
    }
  }
  return lines.join('\n');
}

// ── the reference reading (LIN-4423) ─────────────────────────────────────────
// A reference is a reading of an earlier window written by this tool with --as-reference <label>, committed, and read
// back with --reference <file>: so every reference value beside a live row has the live row's own definition and unit.
// The rows a starting point never had are written as not measured with NO_REFERENCE_READING's reason, never read today
// and passed off as then. docs/reviews/stability-measures/README.md is the declaration that names all of this.

/** The rows a reference reading never has: measure 1 (the blind read) and measure 4 (the person's seat). */
export const NO_REFERENCE_KEYS = Object.freeze(['sample', 'blind', 'rulings', 'origin', 'operator-free']);

/** The reason those rows carry in a reference reading. */
export const noReferenceReading = (label) => `no ${label} reading; the first reading sets it`;

/**
 * The reference slots from a committed reading, keyed by row key: { label, status, value, reason, unreadable }.
 * Throws when the file is not this tool's reference reading or counts lines on another scope, because a reference
 * with another definition would sit beside the live row as if it were comparable.
 */
export function referencesFrom(json, { file = 'reference' } = {}) {
  if (json?.tool !== 'stability-measures') throw new Error(`${file} is not a stability-measures reading`);
  const label = json.reference?.label;
  if (typeof label !== 'string' || !label) throw new Error(`${file} is not a reference reading (no reference.label; write one with --as-reference <label>)`);
  if (json.scope?.include !== SCOPE_INCLUDE) throw new Error(`${file} counts lines on another scope (${json.scope?.include}), not ${SCOPE_INCLUDE}`);
  if (!Array.isArray(json.measures)) throw new Error(`${file} has no measures`);
  const byKey = {};
  for (const m of json.measures) {
    for (const r of m.rows ?? []) byKey[r.key] = { label, status: r.status, value: r.value, reason: r.reason, unreadable: r.unreadable };
  }
  return byKey;
}
