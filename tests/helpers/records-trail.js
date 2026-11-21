/**
 * LIN-4518 (P5 of LIN-4513): a comment trail, written as the records it would be, for the unit tests and the eval that
 * feed a recommendation or a gate its context.
 *
 * The readers that decide from records (lib/task-standing.js, lib/records/standing.js) take a ticket's standing. The frozen
 * comment trails in these tests predate records, so `standingOfComments` writes each trail as record versions and reads
 * them through the same `standingOf` production uses:
 *   - a change for each PR a landing-carrying comment cites (a review, a close-out, an agent note, a plan review, a person's
 *     comment), at the instant it is first cited, with the head its review read (or the PR's live head);
 *   - a review verdict on the changes its comment cites, pinned to the head that review read, with the outcome its word gives;
 *   - a blind read on the changes it names (its verdict word, `same` when it gives none);
 *   - a close-out run, done at its comment's instant;
 *   - a merge when a close-out says `Merged <url>`, or the PR reads merged, ending the change at that instant;
 *   - a head refresh, at the instant after the last comment, to the PR's live head when the review read another.
 * Pure: no store and no network, so it runs as a plain function. The through-the-proxy replay of the walk-8 goldens is
 * tests/unit/lin-4518-decision-replay.test.js; this helper is for the fixtures that only need the standing.
 *
 * Not written as records (named, because the comment trail carries them and records do not yet): an audit's notes PR is
 * a change like any other PR it cites; research notes, area reads, Surveys and Harbour summaries are not landing carriers,
 * so the PRs they name are not changes (the classifier's own `landing` reading, lib/run-trail.js COMMENT_KINDS).
 */
import { commentKindOf, COMMENT_KINDS } from '../../lib/run-trail.js';
import { parseRunLedger, prUrlsIn } from '../../lib/run-ledger.js';
import { canonicalChangeRef, changeKeyOf } from '../../lib/records/change-ref.js';
import { standingOf } from '../../lib/records/standing.js';
import { index } from '../../lib/records/views.js';
import { BLIND_READ_KIND, BLIND_READ_VERDICTS } from '../../lib/prompts/blind-read-words.js';

const TASK = 'task-trail';
const JUDGEMENTS = Object.freeze({ review: 'review', blindRead: BLIND_READ_KIND });
/** The comment kinds whose PRs join the landing (lib/run-trail.js COMMENT_KINDS, `landing` all or first-cited). */
const LANDING_KINDS = new Set(['review', 'close-out', 'agent-note', 'plan-review', 'plain', 'audit']);

const epoch = (iso) => Date.parse(iso || '') || 0;
const at = (ms) => new Date(ms).toISOString();

/** The approval word a review's verdict gives, as records word it: approve (conditional included), request-changes, needs-discussion. */
function outcomeOf(verdict) {
  if (verdict === 'approve' || verdict === 'approve-conditional') return 'approve';
  if (verdict === 'request-changes') return 'request-changes';
  if (verdict === 'needs-discussion') return 'needs-discussion';
  return null;
}

/** A blind read's verdict word, or `same` when the body gives none. */
function blindOutcomeOf(body) {
  const m = String(body || '').match(/Verdict:\s*(better|same|worse)\b/i);
  const word = m ? m[1].toLowerCase() : 'same';
  return BLIND_READ_VERDICTS.includes(word) ? word : 'same';
}

/**
 * The record versions of one comment trail.
 * @param {Array<{id?: string, body: string, createdAt: string}>} comments
 * @param {{statuses?: Record<string, object>}} [options] - PR statuses by URL (the live head, merged state); a PR with no
 *   status keeps the head its review read
 * @returns {object[]} record versions in the shape lib/records/views.js reads
 */
export function versionsOfComments(comments, { statuses = {} } = {}) {
  // A comment without an id (a fixture's) takes its position's id, so its records never collide.
  const sorted = comments.map((c, i) => ({ ...c, id: c.id ?? `cm-${i}` })).sort((a, b) => epoch(a.createdAt) - epoch(b.createdAt));
  const versions = [];
  const changeOf = new Map(); // canonical url -> { id, head, v }
  const headOf = (url) => {
    const s = statuses[url];
    return s && s.readable !== false && s.head?.sha ? s.head.sha : null;
  };
  const lastMs = sorted.length ? epoch(sorted.at(-1).createdAt) : 0;

  // 1. Changes: each landing PR at its first citation, with the head its first citing review read, else the live head.
  for (const c of sorted) {
    if (!LANDING_KINDS.has(commentKindOf(c.body))) continue;
    const kind = commentKindOf(c.body);
    const reviewSha = kind === 'review' ? parseRunLedger(c).sha : null;
    for (const raw of prUrlsIn(c.body)) {
      const url = canonicalChangeRef(raw);
      if (!url || changeOf.has(changeKeyOf(url))) continue;
      const live = headOf(url);
      const head = reviewSha ? sameSha(reviewSha, live) : live;
      const id = `chg-${changeKeyOf(url)}`;
      changeOf.set(changeKeyOf(url), { id, url, head, v: 1, at: c.createdAt });
      // An audit's PR is its notes PR, written by the audit stage (lib/records/standing.js).
      const by = kind === 'audit' ? 'retrospective-audit' : 'implementation';
      versions.push({ id, v: 1, at: at(epoch(c.createdAt)), kind: 'change', state: 'open', in: TASK, to: null, links: {}, fields: { ref: url, head }, by });
    }
  }

  // 2. Verdicts, blind reads and runs, each at its comment's instant, after the changes it cites exist.
  for (const c of sorted) {
    const kind = commentKindOf(c.body);
    const named = prUrlsIn(c.body).map((u) => changeOf.get(changeKeyOf(canonicalChangeRef(u)))).filter(Boolean);
    // A review that names no PR judges the task's changes open at its instant (the landing the trail carries).
    const cited = kind === 'review' && !named.length ? openChangesAt(versions, changeOf, c.createdAt) : named;
    if (kind === 'review') {
      const ledger = parseRunLedger(c);
      const outcome = outcomeOf(ledger.verdict);
      if (!outcome || !cited.length) continue;
      // The judge's head: pinned to the version holding it, revised first when no version does (as the real pin does).
      const on = cited.map((ch) => {
        const sha = sameSha(ledger.sha, headOf(ch.url)) ?? ch.head;
        if (!versions.some((v) => v.id === ch.id && v.fields?.head === sha && !v.op)) {
          const cur = versions.filter((v) => v.id === ch.id && !v.op).sort((a, b) => b.v - a.v)[0];
          versions.push({ ...cur, v: cur.v + 1, at: at(epoch(c.createdAt)), fields: { ...cur.fields, head: sha }, by: 'review' });
        }
        return `${ch.id}@${versionHolding(versions, ch.id, sha)}`;
      });
      versions.push({ id: `vrd-${c.id}`, v: 1, at: at(epoch(c.createdAt)), kind: 'verdict', state: 'stands', in: TASK, to: null, links: { on }, fields: { judgement: JUDGEMENTS.review, outcome, reasoning: 'trail' }, by: 'review' });
    } else if (kind === BLIND_READ_KIND) {
      const named = cited.filter((ch) => changeOf.has(changeKeyOf(ch.url)));
      if (!named.length) continue;
      versions.push({ id: `brd-${c.id}`, v: 1, at: at(epoch(c.createdAt)), kind: 'verdict', state: 'stands', in: TASK, to: null, links: { on: named.map((ch) => ch.id) }, fields: { judgement: JUDGEMENTS.blindRead, outcome: blindOutcomeOf(c.body), reasoning: 'trail' }, by: 'blind-read' });
    } else if (kind === 'close-out') {
      versions.push({ id: `run-${c.id}`, v: 1, at: at(epoch(c.createdAt)), kind: 'run', state: 'done', in: TASK, to: null, links: {}, fields: { stage: 'close-out' }, by: 'harbour' });
      versions.push({ id: `run-${c.id}`, v: 2, at: at(epoch(c.createdAt)), kind: 'run', state: 'done', in: TASK, to: null, links: {}, fields: { stage: 'close-out' }, by: 'harbour', op: 'end' });
      // A close-out that says it merged a PR ends that change at this instant.
      for (const u of prUrlsIn(c.body)) if (/Merged /.test(c.body) && changeOf.has(changeKeyOf(u))) endChange(versions, changeOf.get(changeKeyOf(u)), c.createdAt, 'merged');
    }
  }

  // 3. Merges the statuses read (the PR merged with no close-out saying so): ended at the first close-out that cites it.
  for (const ch of changeOf.values()) {
    const s = statuses[ch.url];
    if (s?.merged === true && !versions.some((v) => v.id === ch.id && v.state === 'merged')) {
      const firstClose = sorted.find((c) => commentKindOf(c.body) === 'close-out' && prUrlsIn(c.body).some((u) => changeKeyOf(canonicalChangeRef(u)) === changeKeyOf(ch.url)));
      endChange(versions, ch, firstClose?.createdAt ?? at(lastMs), 'merged');
    }
  }

  // 4. Head refresh after the last comment: a PR whose live head is not the one its review read moves on, once.
  for (const ch of changeOf.values()) {
    const live = headOf(ch.url);
    const current = versions.filter((v) => v.id === ch.id && !v.op).sort((a, b) => b.v - a.v)[0];
    if (live && current && current.fields.head !== live && !versions.some((v) => v.id === ch.id && v.op === 'end')) {
      versions.push({ id: ch.id, v: current.v + 1, at: at(lastMs + 1), kind: 'change', state: 'open', in: TASK, to: null, links: {}, fields: { ref: ch.url, head: live }, by: 'harbour' });
    }
  }
  return versions;
}

/** The changes of the task open at `when`: written by then, and not ended by then. */
function openChangesAt(versions, changeOf, when) {
  const t = epoch(when);
  return [...changeOf.values()].filter((ch) => {
    const seen = versions.filter((v) => v.id === ch.id && epoch(v.at) <= t);
    return seen.length > 0 && !seen.some((v) => v.op === 'end');
  });
}

/** The head a review read, as the live head names it when the two are the same commit (an abbreviation counts). */
function sameSha(reviewSha, live) {
  if (!reviewSha) return live ?? null;
  if (!live) return reviewSha;
  return live.startsWith(reviewSha) || reviewSha.startsWith(live) ? live : reviewSha;
}

/** The version of change `id` that holds `head` (the newest), else the current one. */
function versionHolding(versions, id, head) {
  const held = versions.filter((v) => v.id === id && v.fields?.head === head && !v.op).sort((a, b) => b.v - a.v)[0];
  return held ? held.v : Math.max(...versions.filter((v) => v.id === id && !v.op).map((v) => v.v));
}

/** Ends change `ch` at `when` as `state` (merged), keeping its last fields. */
function endChange(versions, ch, when, state) {
  const last = versions.filter((v) => v.id === ch.id).sort((a, b) => b.v - a.v)[0];
  versions.push({ ...last, v: last.v + 1, at: at(epoch(when)), state, op: 'end', ended: { reason: 'the PR merged' }, by: 'harbour' });
}

/**
 * The standing of a comment trail, written as records (see the header).
 * @param {Array<{id?: string, body: string, createdAt: string}>} comments
 * @param {{statuses?: Record<string, object>, taskId?: string}} [options]
 * @returns {ReturnType<typeof standingOf>}
 */
export function standingOfComments(comments, options = {}) {
  return standingOf({ taskId: options.taskId ?? TASK, versions: versionsOfComments(comments, options), judgements: JUDGEMENTS });
}

/** The comment kinds the trail writes as changes: exported for the header's claim (the classifier's own rows). */
export const LANDING_CARRIER_KINDS = [...LANDING_KINDS];
export { COMMENT_KINDS };

/**
 * A records store, for a fixture's trail, that serves the trail's records (the versions of versionsOfComments) to the readers
 * that take a store: `taskForTicket`, `find` and `versionsOf`. Test-only, with no database.
 * @param {Array<{id?: string, body: string, createdAt: string}>} comments
 * @param {{statuses?: Record<string, object>, taskId?: string}} [options]
 */
export function recordsStoreOf(comments, options = {}) {
  const taskId = options.taskId ?? TASK;
  const versions = versionsOfComments(comments, options);
  const current = () => index(versions).all();
  return {
    async taskForTicket() { return taskId; },
    async find(_urlKey, query = {}) {
      return current().filter((s) => (!query.kind || s.kind === query.kind)
        && (!query.inRef || s.in === query.inRef)
        && (!query.state || s.state === query.state));
    },
    async versionsOf(_urlKey, ids) { return versions.filter((v) => ids.includes(v.id)); },
  };
}
