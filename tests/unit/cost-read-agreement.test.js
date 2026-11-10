/**
 * LIN-4179 agreement (plan W4, the rest): on one fixture corpus, the surfaces that show the same figure agree. A
 * surface that drifts fails here by name. W4's S1 = ΣS5 lives in cost-read.test.js and is not repeated.
 *
 * What is pinned, and on which selection (the replay corpus is the same for every surface):
 *  - S2 = Σ S7 across features, priced and unpriced counts both (the workspace calls total is the sum of its features);
 *  - S1's own calls inside 30 days are a subset of S2's (every issue's calls sit inside the workspace total); since
 *    LIN-4404 S1 reads the task's whole life, so it also counts exactly its own calls older than 30 days;
 *  - S1 = S13 per lineage (the run page's lineage figure is the issue's lineage figure), for every lineage since
 *    LIN-4404: both read the lineage's whole life;
 *  - S5 = S12 over the lineages both count (30-day agent spend, on a selection with no straddler and no row-cap truncation).
 *
 * Run with: node --test tests/unit/cost-read-agreement.test.js
 */
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { runReplay } from '../fixtures/cost-replay/harness.js';
import { buildCorpus, NOW_MS, REPLAY_ISSUES } from '../fixtures/cost-replay/corpus.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const close = (a, b, message) => assert.ok(Math.abs(a - b) < 1e-9, `${message}: ${a} vs ${b}`);

let current;
before(async () => {
  current = await runReplay();
});

describe('S2 = Σ S7 across features (priced and unpriced counts both)', () => {
  test('the calls total is the sum of the per-feature rows, and so are the priced and unpriced counts', () => {
    const features = current.S7;
    const calls = features.reduce((n, f) => n + f.runs, 0);
    const priced = features.reduce((n, f) => n + f.priced, 0);
    const unpriced = features.reduce((n, f) => n + f.unpriced, 0);
    const spend = features.reduce((n, f) => n + f.spendUsd, 0);
    assert.equal(current.S2.totalCalls, calls, 'calls');
    assert.equal(current.S2.totalCalls - current.S2.unpricedCalls, priced, 'priced calls');
    assert.equal(current.S2.unpricedCalls, unpriced, 'unpriced calls (a null cost is never a $0 call)');
    close(current.S2.pricedUsd, spend, 'priced spend');
  });

  test('the Biscuit Weather line reads the same figure as Health (S3 = S2)', () => {
    assert.deepEqual(current.S3, current.S2);
  });
});

describe("S1's calls are a subset of S2's", () => {
  // LIN-4404: S1 reads the task's whole life and S2 (the workspace calls) the 30-day window, so the subset is taken over
  // the window: each issue's calls older than 30 days (from the corpus) are taken out of its S1 figures first, and the
  // second test pins that S1 counts exactly those old calls on top.
  const oldCallsOf = (issue) => buildCorpus().calls.filter(c => c.issueIdentifier === issue && NOW_MS - new Date(c.timestamp).getTime() >= 30 * DAY_MS);

  test('every issue\'s own calls sit inside the workspace calls, and so do its per-feature calls', () => {
    let issueCalls = 0;
    let issueSpend = 0;
    for (const issue of REPLAY_ISSUES) {
      const app = current.S1[issue].body.appCalls;
      const old = oldCallsOf(issue);
      issueCalls += app.calls - old.length;
      issueSpend += app.costUsd - old.reduce((sum, c) => sum + (c.cost ?? 0), 0);
      for (const row of app.byFeature) {
        const whole = current.S2.byFeature.find(f => f.feature === row.feature);
        const inWindow = row.calls - old.filter(c => c.feature === row.feature).length;
        if (inWindow === 0) continue;
        assert.ok(whole, `${issue}: feature ${row.feature} is in the workspace calls`);
        assert.ok(inWindow <= whole.calls, `${issue}: ${row.feature} calls ${inWindow} are within the workspace ${whole.calls}`);
      }
    }
    assert.ok(issueCalls <= current.S2.totalCalls, `Σ issue calls ${issueCalls} <= workspace ${current.S2.totalCalls}`);
    assert.ok(issueSpend <= current.S2.pricedUsd + 1e-9, `Σ issue spend ${issueSpend} <= workspace ${current.S2.pricedUsd}`);
  });

  test('LIN-4404: S1 counts its own calls older than 30 days, which S2 does not', () => {
    const old = oldCallsOf('LIN-42');
    assert.ok(old.length > 0, 'the corpus has an issue call older than 30 days, so this is not vacuous');
    const app = current.S1['LIN-42'].body.appCalls;
    assert.equal(app.calls, buildCorpus().calls.filter(c => c.issueIdentifier === 'LIN-42').length, 'every LIN-42 call, of any age');
    for (const call of old) {
      assert.ok(app.byFeature.some(f => f.feature === call.feature), `${call._id} (${call.feature}) is in LIN-42's calls`);
    }
  });
});

describe('S1 = S13 per lineage', () => {
  // The run page is unbounded (plan: S13 reads the session's loops whatever their age). Until LIN-4404 /cost was windowed,
  // so a straddler (founder older than 30 days) agreed only on lineages founded in the window. Since LIN-4404 /cost reads
  // the task's whole life too, so the agreement holds on every lineage, and the test asserts a straddler is compared.
  const founderInWindow = new Map();
  for (const row of [...buildCorpus().history, ...buildCorpus().queue]) {
    if (row._id === row.rootItemId) founderInWindow.set(row._id, NOW_MS - new Date(row.dispatchedAt).getTime() < 30 * DAY_MS);
  }

  test('a lineage the run page shows with a figure carries the same figure on its issue (S1)', () => {
    const s1 = new Map();
    for (const issue of REPLAY_ISSUES) {
      for (const session of current.S1[issue].body.workerSessions) s1.set(session.rootItemId, session);
    }
    let compared = 0;
    let straddlers = 0;
    for (const step of current.S13.steps) {
      const lineage = step.lineageId;
      const figure = step.cost;
      const session = s1.get(lineage);
      if (!session) continue;
      compared += 1;
      if (founderInWindow.get(lineage) === false) straddlers += 1;
      if (figure.usd === null || figure.usd === undefined) {
        assert.equal(session.costUsd, null, `${lineage}: the run page withholds its figure, so S1 must too`);
      } else {
        assert.equal(session.costUsd, figure.usd, `${lineage}: S13 ${figure.usd} vs S1 ${session.costUsd}`);
      }
    }
    assert.ok(compared > 0, 'at least one run-page lineage is also an issue lineage, so the agreement is not vacuous');
    assert.ok(straddlers > 0, 'a lineage founded more than 30 days ago is compared (LIN-4404: both reads are whole-life)');
  });
});

describe('S5 = S12 over the lineages both count', () => {
  // The selection both surfaces count the same way: no straddler (its founder is outside the 30-day window, so S5 and
  // S12 window it differently by design), no filler (S5's 2000-row cap would truncate it), every lineage inside 29 days.
  function agreeingCorpus() {
    const corpus = buildCorpus();
    const founderAge = new Map();
    for (const row of [...corpus.history, ...corpus.queue]) {
      if (row._id === row.rootItemId) founderAge.set(row._id, NOW_MS - new Date(row.dispatchedAt).getTime());
    }
    const keep = (row) => {
      if (/^f(42|99)-/.test(row._id)) return false;
      const age = founderAge.get(row.rootItemId);
      return age !== undefined && age < 29 * DAY_MS;
    };
    return { ...corpus, history: corpus.history.filter(keep), queue: corpus.queue.filter(keep) };
  }

  test('30-day agent spend (S5, priced) equals S12\'s 30-day cost-per-day sum', async () => {
    const run = await runReplay(agreeingCorpus());
    assert.equal(run.S5.truncated, false, 'the selection is under S5\'s cap, so S5 sees every lineage');
    const s5 = run.S5.jobs.reduce((sum, job) => sum + job.spendUsd, 0);
    const s12 = run.S12.daily.cost.perDay.reduce((sum, usd) => sum + usd, 0);
    assert.ok(s5 > 0, 'some spend is priced, so the agreement is not 0 = 0');
    close(s5, s12, 'S5 spend vs S12 per-day sum');
  });
});
