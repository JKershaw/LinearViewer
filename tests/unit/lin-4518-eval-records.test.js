/**
 * LIN-4518 (finding-004175cc): the eval's authored records agree with the comment history they were authored from.
 *
 * The dense sweep hands each bundle its trail, landing and plan-review loop from records
 * (scripts/eval/fixtures/recommend-records, seeded by scripts/eval/records-context.mjs). The records are written by hand
 * from each bundle's comments, so this file checks them against those comments: the comment reader (readTrail and the plan
 * review fold) is the ORACLE here, read in a test only, never to build a record. Each mismatch the authoring leaves is named
 * in `EXCEPTIONS` with its reason, so a record that drifts from its comments fails here rather than moving the sweep.
 *
 * Run with: node scripts/run-unit-tests.mjs tests/unit/lin-4518-eval-records.test.js
 */
process.env.NODE_ENV = 'test';

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readTrail } from '../../lib/run-trail.js';
import { assemblePlanReviewFacts } from '../../lib/recommendation-facts.js';
import { attachRecordsContext } from '../../scripts/eval/records-context.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, '..', '..', 'scripts', 'eval', 'fixtures');
const RECORDS_DIR = join(FIXTURES, 'recommend-records');

/**
 * Where the authored records differ from the comment oracle on purpose. Each entry names the bundle, the field and why.
 * Anything not listed must agree.
 */
const EXCEPTIONS = {
  'LIN-3135': {
    review: 'the comment reads its verdict as `unknown` (the verdict sits in a heading the comment parser does not read); the record holds the approval the review states ("Approve — conditional on close-out discharging the ledger")',
  },
  'LIN-3098': {
    planReview: '"Verdict: Revise" (13:50) is not a plan-review outcome in the records vocabulary (approve | request-changes | needs-discussion), so no record holds it; the comment fold ignores it too',
  },
};

let harness;
const bundlesOf = [];

before(async () => {
  const workspaces = readdirSync(FIXTURES_RECOMMEND()).filter((f) => f.endsWith('.json')).sort()
    .filter((f) => readdirSync(RECORDS_DIR).includes(f))
    .map((f) => {
      const ws = JSON.parse(readFileSync(join(FIXTURES_RECOMMEND(), f), 'utf8'));
      return { file: f, targets: ws.targets, bundles: ws.bundles };
    });
  const seeded = await attachRecordsContext(workspaces, RECORDS_DIR);
  harness = seeded.harness;
  for (const ws of workspaces) {
    const sidecar = JSON.parse(readFileSync(join(RECORDS_DIR, ws.file), 'utf8'));
    for (const id of Object.keys(sidecar)) {
      if (id.startsWith('_') || !ws.bundles[id]) continue;
      bundlesOf.push({ file: ws.file, id, bundle: ws.bundles[id], entry: sidecar[id] });
    }
  }
});

after(async () => {
  await harness?.close();
});

function FIXTURES_RECOMMEND() {
  return join(FIXTURES, 'recommend');
}

const prsOf = (urls) => [...new Set(urls)].sort();
const isApproval = (word) => /^approve/.test(String(word || ''));

describe('the authored records agree with the comment history they were written from', () => {
  test('every sidecar bundle is seeded or deliberately unrepresentable', () => {
    assert.ok(bundlesOf.length >= 25, `expected the authored bundles, got ${bundlesOf.length}`);
    for (const { id, entry } of bundlesOf) {
      assert.ok(entry.unrepresentable || Array.isArray(entry.events), `${id} has neither events nor an unrepresentable reason`);
    }
  });

  test('the trail gate facts (review, landing, close-out after the review) agree with the comments', () => {
    for (const { id, bundle, entry } of bundlesOf) {
      if (entry.unrepresentable) continue;
      const ctx = bundle.recordsContext;
      const oracle = readTrail(bundle.comments || []);
      const exc = EXCEPTIONS[id] || {};
      if (!exc.review) {
        const rec = ctx.trail?.review ?? null;
        const com = oracle?.review ?? null;
        assert.equal(rec !== null, com !== null, `${id}: review on record ${rec !== null} vs in comments ${com !== null}`);
        if (rec && com) {
          assert.equal(isApproval(rec.verdict), isApproval(com.verdict), `${id}: review verdict ${rec.verdict} vs comment ${com.verdict}`);
          assert.equal(String(rec.at).slice(0, 16), String(com.at).slice(0, 16), `${id}: review instant`);
        }
      }
      assert.deepEqual(prsOf(ctx.trail?.landing || []), prsOf(oracle?.landing || []), `${id}: landing PRs`);
      assert.equal(ctx.trail?.closeOutAfterReview, oracle?.closeOutAfterReview, `${id}: a close-out after the review`);
    }
  });

  test('the plan-review run agrees with the comments: the same verdicts since the latest Approve', () => {
    for (const { id, bundle, entry } of bundlesOf) {
      if (entry.unrepresentable || EXCEPTIONS[id]?.planReview) continue;
      const comment = assemblePlanReviewFacts(bundle.comments || []).run.map((r) => r.verdict);
      const records = bundle.recordsContext.planReviewLoop.run.map((r) => r.verdict);
      assert.deepEqual(records, comment, `${id}: plan-review run`);
    }
  });

  test('a stated blocking count is recorded as that many findings: LIN-3124 (1), LIN-2882 (3), LIN-3059 (3)', () => {
    const counts = Object.fromEntries(['LIN-3124', 'LIN-2882', 'LIN-3059'].map((id) => [id, bundlesOf.find((b) => b.id === id)]).map(([id, b]) => [id, b.entry.events.filter((e) => e.kind === 'planReview').map((e) => e.findings || 0)]));
    assert.deepEqual(counts, { 'LIN-3124': [1, 0, 0, 0], 'LIN-2882': [3, 0], 'LIN-3059': [3, 0, 0] });
  });
});
