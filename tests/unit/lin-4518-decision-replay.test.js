/**
 * LIN-4518 (P5 of LIN-4513, beat 1): the decision readers on records, replayed against the frozen comment-path goldens
 * (tests/fixtures/walk-8/comment-path/goldens/, P1 / LIN-4514) through the proxy.
 *
 * Each walk-8 ticket's history is written onto records through the real routes (POST /api/proxy/records under the run's
 * credential, lib/proxy-tokens.js), with Harbour's own head refresh and merge recorder (lib/change-records.js). At every
 * golden instant the ticket's standing is read from the store (lib/records/standing.js), and the decisions the records
 * give are compared with two things:
 *   - the golden, where the golden's landing is the records' landing (no foreign PR in it);
 *   - the comment path's own decision on the same trail, less the foreign PRs (where the golden's landing names one).
 *     A foreign PR (one the task's implementation did not write: LIN-4469's #2444) is not a change of this task, so the
 *     records cannot hold it; the replay names that, and compares the decision on what the records hold.
 *
 * Every difference is classified below, and an unclassified one fails the test. The classes are the records-side
 * differences the design names, and the walk-8 README's known baseline flaws:
 *   - foreign-PR: the comment landing names a PR of another task; the records do not (see above);
 *   - stale-refusal (LIN-4469, flaw 1): a later push staled the approval, and the records refuse on the moved PR; the comment
 *     path's multi-PR branch never read the head, so it does not;
 *   - the rest are named where they are asserted.
 *
 * Witness shapes: the close-out, the selector's facts and the stage routes are read as the production readers read them.
 * The run evidence box (beat 3) and the live-stage wait's run facts (allRuns, the dispatch store) are not replayed here.
 */
process.env.NODE_ENV = 'test';

import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';
import { createRecordsRouteHarness } from '../helpers/records-route-harness.js';
import { TICKETS, loadInput, loadDerived, loadSeeds, prStatusAt, ticketStateAt } from '../helpers/comment-path-capture.js';
import { getRecommendation, setFetchImpl, setPromptTraceRecorder } from '../../lib/openrouter.js';
import { createRecordWrites } from '../../lib/records/writes.js';
import { isTerminalState } from '../../lib/providers/state-map.js';
import { refreshTaskChanges } from '../../lib/change-records.js';
import { readStandingRecords, trailOfStanding } from '../../lib/records/standing.js';
import { blindReadStep } from '../../lib/recommendation-blind-read.js';
import { closeOutDecision, CLOSE_OUT_ACTOR } from '../../lib/run-closeout-state.js';
import { FINDINGS_NONE, findingsNotRead } from '../../lib/close-out-findings.js';
import { readTrail, commentKindOf } from '../../lib/run-trail.js';
import { parseRunLedger, prUrlsIn } from '../../lib/run-ledger.js';
import { canonicalChangeRef, changeKeyOf } from '../../lib/records/change-ref.js';
import { BLIND_READ_KIND, BLIND_READ_VERDICTS } from '../../lib/prompts/blind-read-words.js';

const URL_KEY = 'lin-4518-decision-replay';
const JUDGEMENTS = { review: 'review', blindRead: BLIND_READ_KIND };
const LADDER_FINDINGS = 'the ladder guard refuses on the blind read only and reads no findings';
const harness = createMangoTmpdir('lin-4518-decision-replay-');
before(() => harness.connect());
after(() => harness.close());

const ms = (t) => Date.parse(t);
const iso = (t) => new Date(t).toISOString();

/** The PR numbers of a walk-8 ticket's own landing commits (landings.json: each commit's subject ends `(#n)`). */
function ownLandingNumbers(name) {
  const landings = JSON.parse(readFileSync(new URL('../fixtures/walk-8/comment-path/landings.json', import.meta.url), 'utf8')).landings;
  return new Set((landings[name] ?? []).map((c) => (c.subject ?? c.body.split('\n')[0]).match(/\(#(\d+)\)\s*$/)?.[1]).filter(Boolean).map(Number));
}

/** The head a review judged, as the live head names it when they are the same commit. */
function judgedHead(reviewSha, live) {
  if (!reviewSha) return live ?? null;
  if (!live) return reviewSha;
  return live.startsWith(reviewSha) || reviewSha.startsWith(live) ? live : reviewSha;
}

/** A review word, as the records word it. */
function outcomeOf(verdict) {
  if (verdict === 'approve' || verdict === 'approve-conditional') return 'approve';
  if (verdict === 'request-changes') return 'request-changes';
  if (verdict === 'needs-discussion') return 'needs-discussion';
  return null;
}

/** A blind read's word: `same` when the body gives none. */
function blindWordOf(body) {
  const m = String(body || '').match(/Verdict:\s*(better|same|worse)\b/i);
  const word = m ? m[1].toLowerCase() : 'same';
  return BLIND_READ_VERDICTS.includes(word) ? word : 'same';
}

/** The decision's lanes the comparison reads, from one trail and its statuses (what each surface asks). */
function lanesOf(trail, { statuses }) {
  const lane = (stopAt, actor, prStatuses, openFindings) => closeOutDecision({
    trail, prStatuses, stopAt, runnerReady: true, actor, openFindings,
  });
  const pick = (d) => ({ status: d.status, reason: d.reason, refuses: d.refuses, setDone: d.setDone, waitsOn: d.waitsOn, followsPerson: d.followsPerson, headMoved: d.headMoved });
  return {
    stopAtHarbour: pick(lane('pr', CLOSE_OUT_ACTOR.HARBOUR, statuses, FINDINGS_NONE)),
    stopAtPerson: pick(lane('pr', CLOSE_OUT_ACTOR.PERSON, statuses, FINDINGS_NONE)),
    ladder: pick(lane(null, CLOSE_OUT_ACTOR.HARBOUR, null, findingsNotRead(LADDER_FINDINGS))),
  };
}

/** The golden's lanes, in the same shape (the golden holds more; these are the compared fields). */
function goldenLanesOf(instant) {
  const pick = (d) => ({ status: d.status, reason: d.reason, refuses: d.refuses, setDone: d.setDone, waitsOn: d.waitsOn, followsPerson: d.followsPerson, headMoved: d.headMoved });
  return {
    stopAtHarbour: pick(instant.decision.stopAtHarbour),
    stopAtPerson: pick(instant.decision.stopAtPerson),
    ladder: pick(instant.decision.ladder),
  };
}

/** Each lane's compared fields that differ: [{lane, field, want, got}]. */
function laneDiffs(want, got) {
  const out = [];
  for (const lane of Object.keys(want)) {
    for (const field of Object.keys(want[lane])) {
      const a = JSON.stringify(want[lane][field] ?? null);
      const b = JSON.stringify(got[lane][field] ?? null);
      if (a !== b) out.push({ lane, field, want: want[lane][field] ?? null, got: got[lane][field] ?? null });
    }
  }
  return out;
}

/**
 * Replay one walk-8 ticket onto records, instant by instant. Returns the differences found, classified.
 * @returns {Promise<{name: string, instants: number, compared: number, foreignInstants: number, diffs: object[], refusals: object[]}>}
 */
async function replayTicket(name) {
  const input = loadInput(name);
  const golden = loadDerived(`goldens/${name}.json`);
  const own = ownLandingNumbers(name);
  const prByUrl = new Map(input.prs.map((p) => [p.url, p]));
  const isOwn = (url) => own.has(Number(url.split('/').pop()));
  const foreign = new Set(input.prs.filter((p) => !isOwn(p.url)).map((p) => p.url));
  const ownPrs = input.prs.filter((p) => isOwn(p.url));

  let now = 0;
  // The PR reader the route's own refresh and Harbour's refresh share: each PR at its status at the replay's instant.
  let readPrStatus = async () => ({ readable: false });
  const rh = await createRecordsRouteHarness({
    harness, urlKey: URL_KEY, tickets: new Map(), people: [],
    changePrReaderFor: () => (args) => readPrStatus(args),
  });
  const diffs = [];
  const refusals = [];
  try {
    const store = rh.store;
    store.now = () => new Date(now);
    const taskId = (await store.ensureTask(URL_KEY, { identifier: name.toUpperCase(), asked: 'replayed', closed: false, closedReason: null }, { by: 'Harbour', at: iso(0) })).id;
    const writes = createRecordWrites({ recordsStore: store, isTerminalState });
    const statusAt = (url) => (prByUrl.has(url) && isOwn(url) ? prStatusAt(prByUrl.get(url), iso(now)) : { readable: false, state: 'unknown' });
    readPrStatus = async ({ repo, number }) => statusAt(`https://github.com/${repo}/pull/${number}`);
    const changeOf = new Map(); // canonical url -> change id
    let seq = 0;

    const runFor = async (stage) => {
      const id = `run-${stage}-${++seq}`;
      await store.openRun(URL_KEY, { id, stage, taskId, lineage: 'replay', at: iso(now) });
      return { id, token: await rh.mintRunToken(id) };
    };
    const post = (token, body) => rh.post('/api/proxy/records', token, body);

    for (const instant of golden.instants) {
      now = ms(instant.at);
      store.now = () => new Date(now);

      // 1. A change for each own PR, when a comment first cites it, at the head the PR had then.
      for (const pr of ownPrs) {
        if (changeOf.has(changeKeyOf(pr.url))) continue;
        const firstCite = input.comments.map((c) => ms(c.createdAt)).filter((t, i) => prUrlsIn(input.comments[i].body).includes(pr.url)).sort((a, b) => a - b)[0];
        if (firstCite === undefined || firstCite > now) continue;
        const head = statusAt(pr.url).head?.sha ?? null;
        const run = await runFor('implementation');
        const out = await post(run.token, { kind: 'change', in: taskId, ref: pr.url, head, run: run.id });
        if (out.status !== 201) refusals.push({ at: instant.at, what: `change ${pr.url}`, status: out.status, body: out.body });
        else changeOf.set(changeKeyOf(pr.url), out.body.id);
      }

      // 2. Harbour's refresh: each open change's head moves to the PR's live head, and a merge ends it.
      await refreshTaskChanges({ urlKey: URL_KEY, taskId, writes, recordsStore: store, readPrStatus });

      // 3. The comments posted at this instant, as the verdicts, runs and writes they are.
      for (const c of input.comments.filter((cm) => ms(cm.createdAt) === now)) {
        const kind = commentKindOf(c.body);
        const cited = [...new Set(prUrlsIn(c.body).map((u) => canonicalChangeRef(u)))].filter((u) => changeOf.has(changeKeyOf(u)));
        if (kind === 'review') {
          const ledger = parseRunLedger(c);
          const outcome = outcomeOf(ledger.verdict);
          let ids = cited.map((u) => changeOf.get(changeKeyOf(u)));
          if (!ids.length) {
            // A review that names no PR judges the task's open changes.
            const open = await store.find(URL_KEY, { kind: 'change', inRef: taskId, state: 'open' });
            ids = open.map((s) => s.id);
          }
          if (!outcome || !ids.length) continue;
          const heads = {};
          for (const id of ids) heads[id] = judgedHead(ledger.sha, (await store.current(URL_KEY, id)).fields.head);
          const run = await runFor('review');
          const out = await post(run.token, { kind: 'verdict', judgement: JUDGEMENTS.review, outcome, reasoning: 'replayed review', on: ids, heads, run: run.id });
          if (out.status !== 201) refusals.push({ at: instant.at, what: `review ${c.id}`, status: out.status, body: out.body });
        } else if (kind === BLIND_READ_KIND) {
          const ids = cited.map((u) => changeOf.get(changeKeyOf(u)));
          if (!ids.length) continue;
          const run = await runFor('blind-read');
          // The read judges each PR at the head the PR had then (its verdict pins to it, as a review's does).
          const heads = {};
          for (const id of ids) heads[id] = (await store.current(URL_KEY, id)).fields.head;
          const out = await post(run.token, { kind: 'verdict', judgement: JUDGEMENTS.blindRead, outcome: blindWordOf(c.body), reasoning: 'replayed read', on: ids, heads, run: run.id });
          if (out.status !== 201) refusals.push({ at: instant.at, what: `blind read ${c.id}`, status: out.status, body: out.body });
        } else if (kind === 'close-out') {
          const id = `co-${c.id}`;
          await store.openRun(URL_KEY, { id, stage: 'close-out', taskId, lineage: 'replay', at: instant.at });
          await store.endRun(URL_KEY, id, { state: 'done', at: instant.at });
        }
      }

      // 4. Compare at this instant.
      const standing = await readStandingRecords({ recordsStore: store, urlKey: URL_KEY, taskId, judgements: JUDGEMENTS });
      const records = trailOfStanding(standing);
      const goldenLanding = instant.trail.landing;
      const hasForeign = goldenLanding.some((u) => foreign.has(u));
      const expectedLanding = goldenLanding.filter((u) => !foreign.has(u));

      if (JSON.stringify(records.landing) !== JSON.stringify(expectedLanding)) {
        diffs.push({ at: instant.at, field: 'landing', want: expectedLanding, got: records.landing, class: hasForeign ? 'foreign-PR' : 'UNCLASSIFIED' });
      }

      // The comment path's answer on the same trail, less the foreign PRs: what the records must agree with.
      const commentsSoFar = input.comments.filter((cm) => ms(cm.createdAt) <= now);
      const ct = readTrail(commentsSoFar);
      const commentTrail = { review: ct.review, landing: ct.landing.filter((u) => !foreign.has(u)), workAfterReview: ct.workAfterReview, closeOutAfterReview: ct.closeOutAfterReview, closeOutOnTrail: ct.closeOutOnTrail, landingHasNotesPr: false };
      const statusesFor = (urls) => new Map(urls.map((u) => [u, statusAt(u)]));
      const baseline = hasForeign
        ? lanesOf(commentTrail, { statuses: statusesFor(commentTrail.landing) })
        : goldenLanesOf(instant);
      const got = lanesOf({ ...records, workAfterReview: records.workAfterReview, closeOutOnTrail: records.closeOutOnTrail }, { statuses: statusesFor(records.landing) });
      for (const d of laneDiffs(baseline, got)) {
        const staleRefusal = d.field === 'refuses' && d.got === 'head-moved' && (d.want ?? null) === null;
        diffs.push({ at: instant.at, ...d, class: hasForeign ? 'foreign-PR' : (staleRefusal ? 'stale-refusal' : 'UNCLASSIFIED') });
      }
      // Against the golden itself, where it names a foreign PR: the records hold one PR fewer, so the golden's multi-PR
      // branch and the records' single-PR branch are compared. A stale approval refused on the moved PR (LIN-4469,
      // walk-8 README flaw 1) is the records-side difference the plan names: the golden's multi-PR branch never refused it.
      if (hasForeign) {
        for (const d of laneDiffs(goldenLanesOf(instant), got)) {
          const flawOne = d.field === 'refuses' && d.got === 'head-moved' && (d.want ?? null) === null && goldenLanding.length > 1;
          diffs.push({ at: instant.at, golden: true, ...d, class: flawOne ? 'known-flaw-1 (LIN-4469 multi-PR head-moved)' : 'foreign-PR-consequence' });
        }
      }

      // The selector's blind-read step (the route the records answer), against the frozen step.
      const wantStep = instant.selector.blindReadStep?.step ?? null;
      const gotStep = blindReadStep({ state: { type: ticketStateAt(input, instant.at) } }, { standing, allRuns: null })?.step ?? null;
      if (wantStep !== gotStep) {
        const summary = { review: standing.review && { outcome: standing.review.outcome, at: standing.review.at, on: standing.review.on, staleUrls: standing.review.staleUrls }, landing: standing.landing, workAfterReview: standing.workAfterReview, blindRead: standing.blindRead && standing.blindRead.prs, closeOutOnTrail: standing.closeOutOnTrail };
        // A review whose judged head a later push had already passed when it was posted is stale on records from the start,
        // so the read waits for review (the design's "nothing is blessed unseen"). The golden routed the read.
        const unseenPush = wantStep === BLIND_READ_KIND && gotStep === null && (standing.review?.staleUrls?.length ?? 0) > 0;
        const cls = unseenPush ? 'stale-at-posting (LIN-4469: a push no review saw, before the re-review)' : (hasForeign ? 'foreign-PR' : 'UNCLASSIFIED');
        diffs.push({ at: instant.at, field: 'blindReadStep', want: wantStep, got: gotStep, standing: summary, class: cls });
      }
    }
    return { name, instants: golden.instants.length, foreignInstants: golden.instants.filter((i) => i.trail.landing.some((u) => foreign.has(u))).length, diffs, refusals };
  } finally {
    await rh.close();
  }
}

describe('walk 8 replayed through the proxy: records decide what the comment path decided (LIN-4518)', () => {
  for (const name of TICKETS) {
    test(`${name}: at every instant the records agree with the golden, or the difference is named and classified`, async (t) => {
      const r = await replayTicket(name);
      const classes = {};
      for (const d of r.diffs) classes[`${d.class}:${d.field ?? 'landing'}`] = (classes[`${d.class}:${d.field ?? 'landing'}`] ?? 0) + 1;
      t.diagnostic(`${name}: ${r.instants} instants, ${r.foreignInstants} with a foreign PR in the comment landing; differences ${JSON.stringify(classes)}`);
      for (const d of r.diffs.filter((x) => x.class !== 'UNCLASSIFIED' && x.golden !== true).slice(0, 40)) t.diagnostic(`  ${d.at} ${d.class} ${d.lane ?? ''}.${d.field}: golden/comment ${JSON.stringify(d.want)} records ${JSON.stringify(d.got)}${d.standing ? ' standing ' + JSON.stringify(d.standing) : ''}`);
      for (const d of r.diffs.filter((x) => x.golden === true)) t.diagnostic(`  vs golden ${d.at} ${d.class} ${d.lane ?? ''}.${d.field}: golden ${JSON.stringify(d.want)} records ${JSON.stringify(d.got)}`);
      assert.deepEqual(r.refusals, [], `${name}: the proxy refused a replayed write`);
      const unclassified = r.diffs.filter((d) => d.class === 'UNCLASSIFIED');
      assert.deepEqual(unclassified, [], `${name}: ${unclassified.length} difference(s) the replay does not name`);
      // The replay must reach the two named records-side differences on LIN-4469 (or it is not replaying the stale path).
      if (name === 'lin-4469') {
        assert.ok(r.diffs.some((d) => d.class.startsWith('known-flaw-1')), 'LIN-4469: the stale approval refused on the moved PR (flaw 1)');
        assert.ok(r.diffs.some((d) => d.class.startsWith('stale-at-posting')), 'LIN-4469: the re-review judged a head a later push had passed');
      }
    });
  }
});

// ─── The seed cases (goldens/seeds.json): one status snapshot each, replayed through the proxy, the route read live ───────

const SELECTOR_REPLY = { choices: [{ message: { content: '## Reasoning\n→ **close-out**' }, finish_reason: 'stop' }], usage: { completion_tokens: 3 } };
const NOT_OWN_CITER = /^## (Research notes|Blind read|Area read|Survey)/;

/** The seed's comments, in time order, with the ids the frozen seed gave them. */
function seedCommentsOf(seedInput, sc) {
  return sc.commentIds.map((id) => ({ id, body: seedInput.comments[id].body, createdAt: seedInput.comments[id].createdAt }))
    .sort((a, b) => ms(a.createdAt) - ms(b.createdAt));
}

/**
 * One seed case written onto records through the proxy, and its route read by the live recommendation (the selector stubbed
 * to answer close-out, as the capture did). Returns the route and the standing.
 */
async function replaySeedCase(sc, comments) {
  let now = 0;
  let readPrStatus = async () => ({ readable: false });
  const rh = await createRecordsRouteHarness({ harness, urlKey: URL_KEY, tickets: new Map(), people: [], changePrReaderFor: () => (args) => readPrStatus(args) });
  try {
    const store = rh.store;
    store.now = () => new Date(now);
    const taskId = (await store.ensureTask(URL_KEY, { identifier: 'LIN-1', asked: 'replayed', closed: false, closedReason: null }, { by: 'Harbour', at: iso(0) })).id;
    const writes = createRecordWrites({ recordsStore: store, isTerminalState });
    const statusOf = (url) => sc.statuses[url] ?? { readable: false, state: 'unknown' };
    readPrStatus = async ({ repo, number }) => statusOf(`https://github.com/${repo}/pull/${number}`);
    const changeOf = new Map();
    let seq = 0;
    const runFor = async (stage, at) => {
      const id = `seed-${stage}-${++seq}`;
      await store.openRun(URL_KEY, { id, stage, taskId, lineage: 'replay', at });
      return { id, token: await rh.mintRunToken(id) };
    };
    const post = (token, body) => rh.post('/api/proxy/records', token, body);
    for (const c of comments) {
      now = ms(c.createdAt);
      store.now = () => new Date(now);
      // A change for each PR a comment first cites, unless only a report that is not this task's work names it.
      for (const url of [...new Set(prUrlsIn(c.body).map((u) => canonicalChangeRef(u)))]) {
        if (changeOf.has(changeKeyOf(url))) continue;
        const citers = comments.filter((x) => prUrlsIn(x.body).includes(url));
        if (citers.every((x) => NOT_OWN_CITER.test(x.body) || commentKindOf(x.body) === BLIND_READ_KIND)) continue;
        const run = await runFor('implementation', c.createdAt);
        const out = await post(run.token, { kind: 'change', in: taskId, ref: url, head: statusOf(url).head?.sha ?? null, run: run.id });
        assert.equal(out.status, 201, `change ${url}: ${JSON.stringify(out.body)}`);
        changeOf.set(changeKeyOf(url), out.body.id);
      }
      const kind = commentKindOf(c.body);
      const cited = [...new Set(prUrlsIn(c.body).map((u) => canonicalChangeRef(u)))].filter((u) => changeOf.has(changeKeyOf(u)));
      if (kind === 'review') {
        const ledger = parseRunLedger(c);
        const outcome = outcomeOf(ledger.verdict);
        // A review that names no PR judges the task's open changes (as in the walk-8 replay).
        const ids = cited.length ? cited.map((u) => changeOf.get(changeKeyOf(u)))
          : (await store.find(URL_KEY, { kind: 'change', inRef: taskId, state: 'open' })).map((x) => x.id);
        if (!outcome || !ids.length) continue;
        const heads = {};
        for (const id of ids) heads[id] = judgedHead(ledger.sha, (await store.current(URL_KEY, id)).fields.head);
        const run = await runFor('review', c.createdAt);
        const out = await post(run.token, { kind: 'verdict', judgement: JUDGEMENTS.review, outcome, reasoning: 'replayed review', on: ids, heads, run: run.id });
        assert.equal(out.status, 201, `review ${c.id}: ${JSON.stringify(out.body)}`);
      } else if (kind === BLIND_READ_KIND && cited.length) {
        const ids = cited.map((u) => changeOf.get(changeKeyOf(u)));
        const heads = {};
        for (const id of ids) heads[id] = (await store.current(URL_KEY, id)).fields.head;
        const run = await runFor('blind-read', c.createdAt);
        const out = await post(run.token, { kind: 'verdict', judgement: JUDGEMENTS.blindRead, outcome: blindWordOf(c.body), reasoning: 'replayed read', on: ids, heads, run: run.id });
        // A read that does not name exactly the landing is refused at the write (seed 3: only a read naming both clears the
        // gate). The refusal is the answer the records hold: no read is on record, so the gate keeps waiting.
        if (out.status !== 201) assert.equal(out.status, 422, `blind read ${c.id}: ${JSON.stringify(out.body)}`);
      } else if (kind === 'close-out') {
        const id = `co-${c.id}`;
        await store.openRun(URL_KEY, { id, stage: 'close-out', taskId, lineage: 'replay', at: c.createdAt });
        await store.endRun(URL_KEY, id, { state: 'done', at: c.createdAt });
      }
    }
    // The statuses as the case freezes them: the head each PR is at, and a merge ends its change (Harbour's refresh).
    now = Math.max(...comments.map((c) => ms(c.createdAt)));
    store.now = () => new Date(now);
    await refreshTaskChanges({ urlKey: URL_KEY, taskId, writes, recordsStore: store, readPrStatus });
    const standing = await readStandingRecords({ recordsStore: store, urlKey: URL_KEY, taskId, judgements: JUDGEMENTS });
    const route = await liveRouteOf(sc, comments, standing);
    return { route, standing };
  } finally {
    await rh.close();
  }
}

/** The recommendation's route for the case, through getRecommendation with the stub selector (as the capture asks it). */
async function liveRouteOf(sc, comments, standing) {
  setPromptTraceRecorder(() => {});
  setFetchImpl(async () => ({ ok: true, json: async () => SELECTOR_REPLY }));
  try {
    const rec = await getRecommendation(
      { identifier: 'LIN-1', title: 'Gate fixture', description: '', state: { name: sc.ticketState, type: sc.ticketState }, labels: [] },
      { parent: null, siblings: [], project: null, children: [], comments, focusedChild: null, attachments: [], runs: [], allRuns: sc.allRuns, standing },
      { apiKey: 'stub', model: 'x' },
    );
    return { codeRoute: rec.codeRoute ?? null, recommendedAction: rec.recommendedAction ?? null, ...(rec.liveWait ? { liveWait: rec.liveWait } : {}) };
  } finally {
    setFetchImpl(null);
    setPromptTraceRecorder(null);
  }
}

/**
 * The seed cases whose records route differs from the golden's comment-path route, each named with its reason. Any other
 * difference fails the test.
 *
 * The parked close-out case agrees with the golden (live-wait) for a reason that is not the fix: this fixture's 22:08 review
 * names its merged PRs as text (`#2472`), not as URLs, and the fixture holds no change records for them. So the records hold
 * no approving verdict and no gate, and the live-stage wait applies on records just as it did on the comments. The deadlock
 * fix is witnessed where the gate is on record: tests/unit/lin-4518-deadlock.test.js.
 */
const NAMED_ROUTE_DIFFERENCES = {
  'parked-close-out': 'the LIN-4499 deadlock: a close-out parked on the blind read no longer holds the ticket (the golden froze live-wait); the approval gate is open on the landing, so the read is the next step unless work came after the review',
};

describe('the frozen seed cases replay through the proxy: the routes they decided (LIN-4518)', () => {
  const seedInput = loadSeeds();
  const golden = loadDerived('goldens/seeds.json').seeds;
  for (const seed of seedInput.seeds) {
    for (const sc of seed.cases) {
      test(`${seed.id} / ${sc.id}: the records route is the golden's, or the difference is named`, async (t) => {
        const comments = seedCommentsOf(seedInput, sc);
        const { route, standing } = await replaySeedCase(sc, comments);
        const want = golden.find((g) => g.id === seed.id).cases.find((c) => c.id === sc.id).output.surfaces.route;
        const wantRoute = { codeRoute: want.codeRoute ?? null, recommendedAction: want.recommendedAction ?? null, ...(want.liveWait ? { liveWait: want.liveWait } : {}) };
        t.diagnostic(`${sc.id}: records route ${JSON.stringify(route)}; golden ${JSON.stringify(wantRoute)}`);
        if (JSON.stringify(route) === JSON.stringify(wantRoute)) return;
        assert.ok(NAMED_ROUTE_DIFFERENCES[sc.id], `${sc.id}: records route ${JSON.stringify(route)}, golden ${JSON.stringify(wantRoute)}; standing ${JSON.stringify({ review: standing.review && standing.review.outcome, landing: standing.landing, workAfterReview: standing.workAfterReview })}`);
      });
    }
  }
});
