/**
 * LIN-4518 (finding-004175cc): the eval's authored records agree with the comment history they were authored from.
 *
 * The dense sweep hands each bundle its trail, landing and plan-review loop from records
 * (scripts/eval/fixtures/recommend-records, seeded by scripts/eval/records-context.mjs). The records are written by hand
 * from each bundle's comments, so this file checks them against those comments. LIN-4520 retired the comment readers
 * (readTrail, assemblePlanReviewFacts), so the comment side is no longer computed here: ORACLE_AT_HEAD is the comment
 * side as the retired readers read it at HEAD before LIN-4520 (a frozen snapshot, one entry per bundle, taken by running
 * those readers over each bundle's comments). Each mismatch the authoring leaves is named in `EXCEPTIONS` with its reason,
 * so a record that drifts from its comments fails here rather than moving the sweep.
 *
 * Run with: node scripts/run-unit-tests.mjs tests/unit/lin-4518-eval-records.test.js
 */
process.env.NODE_ENV = 'test';

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { attachRecordsContext } from '../../scripts/eval/records-context.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, '..', '..', 'scripts', 'eval', 'fixtures');
const RECORDS_DIR = join(FIXTURES, 'recommend-records');

/**
 * Where the authored records differ from the comment side on purpose. Each entry names the bundle, the field and why.
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

/**
 * The comment side at HEAD (before LIN-4520), per bundle: the review the comment reader found (verdict word and instant,
 * or null), the landing it read, its close-out-after-review fact, and the plan-review run's verdicts since the latest
 * Approve. Frozen, not recomputed: the readers it was read with are retired.
 */
const ORACLE_AT_HEAD = {
  "FIX-812-approve-ledger": { review: { verdict: "approve-conditional", at: "2026-06-20T02:00:00.000Z" }, landing: [], closeOutAfterReview: false, planRun: [] },
  "FIX-812-approve-empty": { review: { verdict: "approve", at: "2026-06-21T02:00:00.000Z" }, landing: [], closeOutAfterReview: false, planRun: [] },
  "LIN-1892": { review: { verdict: "request-changes", at: "2026-09-29T10:09:47.602Z" }, landing: ["https://github.com/JKershaw/LinearViewer/pull/1611"], closeOutAfterReview: true, planRun: [] },
  "LIN-2944": { review: { verdict: "approve-conditional", at: "2026-09-29T05:26:10.064Z" }, landing: ["https://github.com/JKershaw/LinearViewer/pull/1604"], closeOutAfterReview: true, planRun: [] },
  "LIN-3059": { review: null, landing: ["https://github.com/JKershaw/LinearViewer/pull/1605", "https://github.com/JKershaw/LinearViewer/pull/1606"], closeOutAfterReview: false, planRun: [] },
  "LIN-3098": { review: { verdict: "approve-conditional", at: "2026-10-01T06:29:23.137Z" }, landing: ["https://github.com/JKershaw/LinearViewer/pull/1619", "https://github.com/JKershaw/LinearViewer/pull/1620", "https://github.com/JKershaw/LinearViewer/pull/1621", "https://github.com/JKershaw/LinearViewer/pull/1623"], closeOutAfterReview: true, planRun: [] },
  "LIN-3107": { review: { verdict: "approve", at: "2026-09-27T08:35:39.893Z" }, landing: ["https://github.com/JKershaw/LinearViewer/pull/1598"], closeOutAfterReview: true, planRun: ["request changes", "request changes", "request changes"] },
  "LIN-3124": { review: { verdict: "approve-conditional", at: "2026-09-29T14:29:13.269Z" }, landing: ["https://github.com/JKershaw/LinearViewer/pull/1618", "https://github.com/JKershaw/LinearViewer/pull/1610", "https://github.com/JKershaw/LinearViewer/pull/1613"], closeOutAfterReview: true, planRun: [] },
  "LIN-3135": { review: { verdict: "unknown", at: "2026-09-29T12:28:17.802Z" }, landing: ["https://github.com/JKershaw/LinearViewer/pull/1616"], closeOutAfterReview: true, planRun: [] },
  "LIN-2403": { review: { verdict: "approve-conditional", at: "2026-09-02T23:13:35.162Z" }, landing: ["https://github.com/JKershaw/LinearViewer/pull/1333"], closeOutAfterReview: true, planRun: [] },
  "LIN-2882": { review: { verdict: "approve", at: "2026-09-27T10:40:32.526Z" }, landing: ["https://github.com/JKershaw/LinearViewer/pull/1600"], closeOutAfterReview: true, planRun: [] },
  "NSC-LIN-2950-R2": { review: null, landing: [], closeOutAfterReview: false, planRun: ["request changes", "request changes"] },
  "NSC-LIN-2950-GO": { review: null, landing: [], closeOutAfterReview: false, planRun: ["request changes", "request changes", "request changes"] },
  "NSC-LIN-2950-HOLD": { review: null, landing: [], closeOutAfterReview: false, planRun: ["request changes", "request changes", "request changes"] },
  "NSC-LIN-2950-NOTE": { review: null, landing: [], closeOutAfterReview: false, planRun: ["request changes", "request changes", "request changes"] },
  "NSC-LIN-2950-LATEST-REPLY": { review: null, landing: [], closeOutAfterReview: false, planRun: ["request changes", "request changes"] },
  "NSC-LIN-2950-GO-REV": { review: null, landing: [], closeOutAfterReview: false, planRun: ["request changes", "request changes", "request changes"] },
  "NSC-LIN-3309-REVISED": { review: null, landing: [], closeOutAfterReview: false, planRun: ["request changes"] },
  "NSC-LIN-3309-NOW": { review: null, landing: [], closeOutAfterReview: false, planRun: ["request changes"] },
  "NSC-LIN-3309-R2-REV": { review: null, landing: [], closeOutAfterReview: false, planRun: ["request changes", "request changes"] },
  "NSC-LIN-3309-LANDED": { review: null, landing: ["https://github.com/JKershaw/LinearViewer/pull/1748"], closeOutAfterReview: false, planRun: ["request changes", "request changes"] },
  "NSC-PR-1603-RC1-REV": { review: null, landing: [], closeOutAfterReview: false, planRun: ["request changes"] },
  "NSC-PR-1603-RC1-HOLD": { review: null, landing: [], closeOutAfterReview: false, planRun: ["request changes"] },
  "NSC-PR-1603-RC1-FC-RULING": { review: null, landing: [], closeOutAfterReview: false, planRun: ["request changes"] },
  "NSC-PR-1603-APPROVE-LANDED": { review: null, landing: ["https://github.com/JKershaw/LinearViewer/pull/1603"], closeOutAfterReview: false, planRun: [] },
  "PR-1603-verdict-approve": { review: null, landing: [], closeOutAfterReview: false, planRun: [] },
  "PR-1603-request-changes-1": { review: null, landing: [], closeOutAfterReview: false, planRun: ["request changes"] },
  "PR-1603-request-changes-2": { review: null, landing: [], closeOutAfterReview: false, planRun: ["request changes", "request changes"] },
  "PR-1603-request-changes-3": { review: null, landing: [], closeOutAfterReview: false, planRun: ["request changes", "request changes", "request changes"] },
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
  test('every sidecar bundle carries its authored events, and each is seeded', () => {
    assert.ok(bundlesOf.length >= 25, `expected the authored bundles, got ${bundlesOf.length}`);
    for (const { id, entry } of bundlesOf) {
      assert.ok(Array.isArray(entry.events), `${id} has no events`);
    }
  });

  test('the frozen comment side covers every authored bundle, and no other', () => {
    assert.deepStrictEqual(Object.keys(ORACLE_AT_HEAD).sort(), bundlesOf.map((b) => b.id).sort());
  });

  test('a review of a task with no PR is on record as a review of its plan, not "not read" (LIN-4518 finding-d3b5b9de)', () => {
    for (const id of ['FIX-812-approve-ledger', 'FIX-812-approve-empty']) {
      const { bundle } = bundlesOf.find((b) => b.id === id);
      const trail = bundle.recordsContext.trail;
      assert.ok(trail, `${id}: the trail is read from records, not handed as null`);
      assert.ok(isApproval(trail.review?.verdict), `${id}: the approve is on record, got ${trail.review?.verdict}`);
      assert.deepEqual(trail.landing, [], `${id}: no change, so no landing`);
    }
  });

  test('the trail gate facts (review, landing, close-out after the review) agree with the comment side', () => {
    for (const { id, bundle } of bundlesOf) {
      const ctx = bundle.recordsContext;
      const oracle = ORACLE_AT_HEAD[id];
      const exc = EXCEPTIONS[id] || {};
      if (!exc.review) {
        const rec = ctx.trail?.review ?? null;
        const com = oracle.review;
        assert.equal(rec !== null, com !== null, `${id}: review on record ${rec !== null} vs in comments ${com !== null}`);
        if (rec && com) {
          assert.equal(isApproval(rec.verdict), isApproval(com.verdict), `${id}: review verdict ${rec.verdict} vs comment ${com.verdict}`);
          assert.equal(String(rec.at).slice(0, 16), String(com.at).slice(0, 16), `${id}: review instant`);
        }
      }
      assert.deepEqual(prsOf(ctx.trail?.landing || []), prsOf(oracle.landing), `${id}: landing PRs`);
      assert.equal(ctx.trail?.closeOutAfterReview, oracle.closeOutAfterReview, `${id}: a close-out after the review`);
    }
  });

  test('the plan-review run agrees with the comment side: the same verdicts since the latest Approve', () => {
    for (const { id, bundle } of bundlesOf) {
      if (EXCEPTIONS[id]?.planReview) continue;
      const records = bundle.recordsContext.planReviewLoop.run.map((r) => r.verdict);
      assert.deepEqual(records, ORACLE_AT_HEAD[id].planRun, `${id}: plan-review run`);
    }
  });

  test('a stated blocking count is recorded as that many findings: LIN-3124 (1), LIN-2882 (3), LIN-3059 (3)', () => {
    const counts = Object.fromEntries(['LIN-3124', 'LIN-2882', 'LIN-3059'].map((id) => [id, bundlesOf.find((b) => b.id === id)]).map(([id, b]) => [id, b.entry.events.filter((e) => e.kind === 'planReview').map((e) => e.findings || 0)]));
    assert.deepEqual(counts, { 'LIN-3124': [1, 0, 0, 0], 'LIN-2882': [3, 0], 'LIN-3059': [3, 0, 0] });
  });
});
