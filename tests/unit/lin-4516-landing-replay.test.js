/**
 * LIN-4516: the record-side landing replayed against the comment path's frozen decisions (P1, LIN-4514).
 *
 * The plan's second-likeliest break is the landing: the record side must agree with the comment side wherever the comment
 * side is right, and where they differ, say which is right. Each replay writes a ticket's history onto records in time
 * order, each write at its own instant (the store's clock), with the real pipeline (lib/records/writes.js), the real
 * head refresh (lib/change-records.js refreshTaskChanges) and the real pin (pinVerdictToHeads). Then the landing (readLanding)
 * is read at each instant (asOf), and compared with what the comment path decided at that instant.
 *
 * What the replay writes, and the one assumption it makes about time:
 * - A change is written when its PR is first cited (the implementation that made it came before the citing comment). Its head
 *   is the head the PR timeline has at that instant; later head moves are refreshes at their own instants.
 * - A PR's merge is written at mergedAt (walk 8's real trails) or, for a frozen row (a snapshot with no timeline), at the first
 *   close-out comment that cites it. A close-out merges its landing, so that is when the merge happened there.
 * - A review comment is a review verdict on the changes it cites, at its own instant. A close-out comment opens and ends a
 *   close-out run at its own instant. The comment path decides a close-out with its comment; the run's end is that instant.
 *
 * Which PRs get changes: the task's OWN PRs, not every PR a comment cites. A change record exists only for a PR the task's
 * own implementation wrote. For walk 8 the ticket's own landing commits (tests/fixtures/walk-8/comment-path/landings.json)
 * name them; for a frozen row, every PR its comments cite except one cited only in "## Research notes" (an earlier attempt
 * elsewhere, which the row itself says is not this ticket's).
 *
 * Known differences, each named and asserted below rather than hidden. In each, the comment path's landing takes a foreign
 * PR the record side does not, so the expected landing is the comment path's, minus those PRs:
 * - LIN-4469: the 21:49 comment cites LIN-4467's PR #2444 (the walk-8 README's known flaw 1, row 15's stated limit). Its
 *   landing commit is #2447 alone. So the comment path holds #2444 in the landing from 21:49 to the merge, and the record side
 *   does not. The walk-8 README says the same of the approval: it is right to refuse on #2447, and #2444 is not this task's.
 * - LIN-4438 row 15: a foreign PR (other/repo#7) cited only in research notes. The record side does not take it.
 */
process.env.NODE_ENV = 'test';

import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';
import { RecordsStore, RECORDS_COLLECTION, REFS_COLLECTION, QUERY_LOG_COLLECTION } from '../../lib/records-store.js';
import { INDEX_SPECS } from '../../lib/db-indexes.js';
import { createRecordWrites } from '../../lib/records/writes.js';
import { isTerminalState } from '../../lib/providers/state-map.js';
import { STAGE_KINDS } from '../../lib/prompts/stage-kinds.js';
import { askedOf } from '../../lib/asked-of.js';
import { refreshTaskChanges, pinVerdictToHeads } from '../../lib/change-records.js';
import { readLanding } from '../../lib/records/landing.js';
import { changeKeyOf } from '../../lib/records/change-ref.js';
import { prUrlsIn } from '../../lib/run-ledger.js';
import { commentKindOf } from '../../lib/run-trail.js';
import { TICKETS, loadInput, loadDerived } from '../helpers/comment-path-capture.js';

const URL_KEY = 'lin-4516-replay-workspace';
const harness = createMangoTmpdir('lin-4516-landing-replay-');
before(() => harness.connect());
after(() => harness.close());

/** An ISO instant with milliseconds, whatever the frozen input wrote (`2026-11-13T21:58:11Z` or `...11.000Z`). */
const iso = (t) => new Date(t).toISOString();

async function freshStore() {
  const db = harness.freshDb();
  for (const collection of [RECORDS_COLLECTION, REFS_COLLECTION]) {
    for (const spec of INDEX_SPECS.filter((x) => x.collection === collection && x.options?.unique)) {
      await db.collection(collection).createIndex(spec.keySpec, spec.options);
    }
  }
  const store = new RecordsStore({
    records: db.collection(RECORDS_COLLECTION),
    refs: db.collection(REFS_COLLECTION),
    queryLog: db.collection(QUERY_LOG_COLLECTION),
    now: () => new Date(0),
  });
  const writes = createRecordWrites({
    recordsStore: store, isTerminalState, askedText: askedOf, stageKinds: Object.keys(STAGE_KINDS), listPeople: async () => [],
  });
  return { store, writes };
}

/** A PR status in the shape readPrStatusOf returns, for the replay's PR reader. */
function statusOf(url, { sha, merged, closed = false }) {
  const number = Number(url.split('/').pop());
  const repo = url.split('/').slice(3, 5).join('/');
  return {
    repo, number, readable: true,
    state: merged || closed ? 'closed' : 'open', merged,
    head: { ref: 'feat/replay', sha }, ref: sha,
    created_at: null, merged_at: merged ? 'replayed' : null, checks: [],
  };
}

/**
 * Replay one ticket's history onto records. Returns `landingAt(instant)`: the record-side landing as the store stood then.
 * @param {object} t
 * @param {string} t.ticket
 * @param {{id: string, createdAt: string, body: string}[]} t.comments
 * @param {{url: string, head?: string, heads?: {at: string, sha: string}[], mergedAt?: string|null, mergedHead?: string|null}[]} t.prs
 *   each PR's head: a timeline (`heads`, real trails) or one `head` (a snapshot); its merge instant and merged head
 */
async function replay({ ticket, comments, prs }) {
  const { store, writes } = await freshStore();
  const clock = (instant) => { store.now = () => new Date(instant); };
  clock(0);
  const taskId = (await store.ensureTask(URL_KEY, { identifier: ticket, asked: 'replay', closed: false, closedReason: null }, { by: 'Harbour', at: iso(0) })).id;

  const byKey = new Map();
  for (const pr of prs) {
    const timeline = pr.heads ? pr.heads.map((h) => ({ at: iso(h.at), sha: h.sha })).sort((a, b) => (a.at < b.at ? -1 : 1)) : null;
    byKey.set(changeKeyOf(pr.url), { url: pr.url, timeline, head: pr.head ?? null, mergedAt: pr.mergedAt ? iso(pr.mergedAt) : null, mergedHead: pr.mergedHead ?? null, closedAt: pr.closedAt ? iso(pr.closedAt) : null, changeId: null, merged: false, closed: false });
  }
  const headAt = (pr, at) => {
    if (!pr.timeline) return pr.head;
    const seen = pr.timeline.filter((h) => h.at <= at);
    return (seen.length ? seen[seen.length - 1] : pr.timeline[0]).sha;
  };
  const cited = (url) => comments.filter((c) => prUrlsIn(c.body).some((u) => changeKeyOf(u) === changeKeyOf(url)));

  const readPrStatus = async ({ repo, number }) => {
    const pr = byKey.get(changeKeyOf(`https://github.com/${repo}/pull/${number}`));
    if (!pr) return { readable: false };
    return statusOf(pr.url, { sha: pr.currentHead, merged: pr.merged, closed: pr.closed });
  };
  const refresh = () => refreshTaskChanges({ urlKey: URL_KEY, taskId, writes, recordsStore: store, readPrStatus });

  const events = [];
  for (const pr of byKey.values()) {
    const first = cited(pr.url).map((c) => iso(c.createdAt)).sort()[0];
    if (first) events.push({ at: first, rank: 0, run: async () => {
      pr.currentHead = headAt(pr, first);
      clock(first);
      const out = await writes.add({ urlKey: URL_KEY, kind: 'change', input: { in: taskId, ref: pr.url, head: pr.currentHead }, by: 'implementation' });
      assert.ok(!out.problems, `the change for ${pr.url} was refused: ${JSON.stringify(out.problems)}`);
      pr.changeId = out.record.id;
    } });
    if (pr.timeline) for (const h of pr.timeline) events.push({ at: h.at, rank: 1, run: async () => {
      if (!pr.changeId || pr.merged) return;
      pr.currentHead = h.sha; clock(h.at); await refresh();
    } });
    if (pr.closedAt) events.push({ at: pr.closedAt, rank: 2, run: async () => {
      if (!pr.changeId || pr.merged) return;
      pr.closed = true; clock(pr.closedAt); await refresh();
    } });
    if (pr.mergedAt) {
      events.push({ at: pr.mergedAt, rank: 2, run: async () => {
        if (!pr.changeId) return;
        pr.merged = true; pr.currentHead = pr.mergedHead ?? pr.currentHead; clock(pr.mergedAt); await refresh();
      } });
    }
  }
  for (const c of comments) {
    const at = iso(c.createdAt);
    const kind = commentKindOf(c.body);
    events.push({ at, rank: 3, run: async () => {
      clock(at);
      if (kind === 'close-out') {
        const id = `co-${c.id}`;
        await store.openRun(URL_KEY, { id, stage: 'close-out', taskId, lineage: 'replay', at });
        await store.endRun(URL_KEY, id, { state: 'done', at });
        return;
      }
      if (kind === 'review') {
        const ids = [...byKey.values()].filter((pr) => pr.changeId && prUrlsIn(c.body).some((u) => changeKeyOf(u) === changeKeyOf(pr.url)));
        if (!ids.length) return;
        const heads = {};
        for (const pr of ids) heads[pr.changeId] = (await store.current(URL_KEY, pr.changeId)).fields.head;
        const pin = await pinVerdictToHeads({ urlKey: URL_KEY, on: ids.map((pr) => pr.changeId), heads, writes, recordsStore: store });
        assert.ok(!pin.problems, `the review at ${at} did not pin: ${JSON.stringify(pin.problems)}`);
        const input = { judgement: 'review', outcome: 'approve', reasoning: 'replayed review', on: pin.on };
        if (pin.tasks.length === 1) input.in = pin.tasks[0];
        const out = await writes.add({ urlKey: URL_KEY, kind: 'verdict', input, by: 'review' });
        assert.ok(!out.problems, `the review at ${at} was refused: ${JSON.stringify(out.problems)}`);
      }
    } });
  }
  events.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.rank - b.rank));
  for (const e of events) await e.run();

  return {
    landingAt: (instant) => readLanding({ recordsStore: store, urlKey: URL_KEY, taskId, asOf: iso(instant) }),
  };
}

/** The PR numbers of a walk-8 ticket's own landing commits (landings.json: each commit's subject ends `(#n)`). */
function ownLandingNumbers(name) {
  const landings = JSON.parse(readFileSync(new URL('../fixtures/walk-8/comment-path/landings.json', import.meta.url), 'utf8')).landings;
  return new Set((landings[name] ?? []).map((c) => (c.subject ?? c.body.split('\n')[0]).match(/\(#(\d+)\)\s*$/)?.[1]).filter(Boolean).map(Number));
}

describe('walk 8: the record-side landing replays the comment path at every instant (LIN-4516)', () => {
  for (const name of TICKETS) {
    test(`${name}: at each instant, the records give the comment path's landing less the foreign PRs it takes`, async () => {
      const input = loadInput(name);
      const golden = loadDerived(`goldens/${name}.json`);
      const own = ownLandingNumbers(name);
      const ownPrs = input.prs.filter((p) => own.has(Number(p.url.split('/').pop())));
      const foreign = new Set(input.prs.filter((p) => !own.has(Number(p.url.split('/').pop()))).map((p) => p.url));
      assert.ok(ownPrs.length > 0, `${name}: the ticket's own landing names a PR the trail cites`);
      const r = await replay({
        ticket: name.toUpperCase(),
        comments: input.comments.map((c) => ({ id: c.id, createdAt: c.createdAt, body: c.body })),
        prs: ownPrs.map((p) => ({ url: p.url, heads: p.heads, mergedAt: p.mergedAt, mergedHead: p.mergedHead })),
      });
      const mismatches = [];
      let foreignInstants = 0;
      for (const instant of golden.instants) {
        const record = await r.landingAt(instant.at);
        const comment = instant.trail.landing;
        const expected = comment.filter((url) => !foreign.has(url));
        if (comment.some((url) => foreign.has(url))) foreignInstants += 1;
        if (JSON.stringify(record) !== JSON.stringify(expected)) mismatches.push({ at: instant.at, record, comment, expected });
      }
      assert.deepEqual(mismatches, [], `${name}: ${mismatches.length} instant(s) differ from the comment path less its foreign PRs`);
      assert.ok(foreign.size === 0 || foreignInstants > 0, `${name}: the foreign PRs are named by the comment path at some instant`);
    });
  }
});

describe('the frozen landing rows replay (LIN-4438 rows 14-15, LIN-4458 landing rows) (LIN-4516)', () => {
  const rows = loadDerived('rows.json').rows.filter((row) => Array.isArray(row.expected?.landing));
  for (const row of rows) {
    test(`${row.id}: the record-side landing is the row's landing, or the difference is named`, async () => {
      const statuses = row.inputs.statuses ?? {};
      const comments = row.inputs.comments ?? [];
      // A PR the task's own implementation did not write: one only a research note, blind read, area read or survey names.
      const NOT_OWN = /^## (Research notes|Blind read|Area read|Survey)/;
      const citers = (url) => comments.filter((c) => prUrlsIn(c.body).includes(url));
      const foreign = new Set(Object.keys(statuses).filter((url) => citers(url).every((c) => NOT_OWN.test(c.body) || commentKindOf(c.body) === 'blind-read')));
      const closeOuts = comments.filter((c) => commentKindOf(c.body) === 'close-out');
      const lastAt = comments.map((c) => iso(c.createdAt)).sort().at(-1);
      const prs = Object.entries(statuses).filter(([url]) => !foreign.has(url)).map(([url, s]) => {
        // What a close-out says it did with the PR: "Merged <url>" is the merge recorder's write; "closed unmerged" ends the change.
        const merged = closeOuts.find((c) => c.body.includes(url) && /Merged /.test(c.body))?.createdAt;
        const closed = closeOuts.find((c) => c.body.includes(url) && /closed unmerged/.test(c.body))?.createdAt;
        const firstCloseOutCiting = closeOuts.filter((c) => prUrlsIn(c.body).includes(url)).map((c) => c.createdAt).sort()[0];
        return {
          url,
          head: s.head?.sha ?? null,
          mergedAt: merged ?? (s.merged ? (firstCloseOutCiting ?? lastAt) : null),
          mergedHead: (merged || s.merged) ? s.head?.sha ?? null : null,
          closedAt: closed && !merged ? closed : null,
        };
      });
      const r = await replay({ ticket: 'LIN-4438', comments, prs });
      const record = await r.landingAt(lastAt);
      const expected = row.expected.landing;
      const wanted = expected.filter((url) => !foreign.has(url));
      assert.deepEqual(record, wanted, `${row.id}: records ${JSON.stringify(record)}, comment path ${JSON.stringify(wanted)} (foreign PRs removed from the comment side: ${[...foreign].join(', ') || 'none'})`);
    });
  }
});
