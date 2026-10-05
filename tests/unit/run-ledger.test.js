// Unit tests for the pure run-ledger reader (LIN-3247, P2 of LIN-2949).
//
// Run with: node --test tests/unit/run-ledger.test.js
//
// The parser is grounded in REAL review comments (verbatim bodies in
// tests/fixtures/run-ledger-comments.js, extracted from
// scripts/eval/fixtures/recommend/_source/large-dense.json and
// scripts/eval/fixtures/recommend/closeout-review.json). Nothing here invents
// a review comment except the one deliberately malformed ledger used to prove
// the raw fallback.

import { test, describe } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseRunLedger, readRunLedger, latestReviewComment } from '../../lib/run-ledger.js';
import { RUN_LEDGER_COMMENTS } from '../fixtures/run-ledger-comments.js';
import { RUN_COMMENT_TRAILS } from '../fixtures/run-ledger-trails.js';

const fixture = name => RUN_LEDGER_COMMENTS[name].comment;

describe('run-ledger: verdict', () => {
  test('distinguishes a plain Approve from the conditional form', () => {
    assert.strictEqual(parseRunLedger(fixture('plain-approve-ci')).verdict, 'approve');
    assert.strictEqual(parseRunLedger(fixture('empty-ledger')).verdict, 'approve');
    assert.strictEqual(parseRunLedger(fixture('conditional-table')).verdict, 'approve-conditional');
    assert.strictEqual(parseRunLedger(fixture('conditional-bullets')).verdict, 'approve-conditional');
  });

  test('a non-approve verdict is carried, not read as approval', () => {
    const model = parseRunLedger(fixture('request-changes-table'));
    assert.strictEqual(model.verdict, 'request-changes');
    assert.match(model.verdictText, /Request Changes/);
  });

  test('the verdict text is exactly as the review wrote it', () => {
    const model = parseRunLedger(fixture('conditional-table'));
    assert.strictEqual(model.verdictText, 'Approve — conditional on close-out discharging the ledger.');
  });

  test('an absent review is an unknown verdict with an absent ledger, never a crash', () => {
    const model = parseRunLedger(null);
    assert.strictEqual(model.verdict, 'unknown');
    assert.strictEqual(model.ledger.present, false);
    assert.deepStrictEqual(model.ledger.items, []);
    assert.strictEqual(model.ledger.raw, null);
  });
});

describe('run-ledger: the review CI line and sha', () => {
  test('captures the CI line verbatim and the head sha the comment carries', () => {
    const model = parseRunLedger(fixture('plain-approve-ci'));
    assert.ok(model.ciLine.startsWith('CI on `1dffc408` is **green**.'), `ciLine was: ${model.ciLine}`);
    assert.match(model.ciLine, /36306122471/);
    assert.strictEqual(model.sha, '1dffc408');
  });

  test('captures a different real review head sha', () => {
    assert.strictEqual(parseRunLedger(fixture('conditional-table')).sha, 'e10768db');
    assert.strictEqual(parseRunLedger(fixture('request-changes-table')).sha, '8790ce34');
  });

  test('carries the comment time', () => {
    assert.strictEqual(parseRunLedger(fixture('conditional-table')).at, '2026-09-28T21:27:05.078Z');
  });
});

describe('run-ledger: ledger items and their marks', () => {
  test('table ledger: each item keeps its own inside/outside mark, not a blended one', () => {
    const { ledger } = parseRunLedger(fixture('request-changes-table'));
    assert.strictEqual(ledger.present, true);
    assert.strictEqual(ledger.empty, false);
    const byId = Object.fromEntries(ledger.items.map(i => [i.id, i]));
    assert.strictEqual(byId.D1.scope, 'inside');
    assert.strictEqual(byId.N2.scope, 'inside');
    assert.strictEqual(byId['R-L1'].scope, 'inside');
    assert.strictEqual(byId.C6.scope, 'outside', 'the one outside item must stay outside');
    assert.notStrictEqual(byId.C6.scope, byId.D1.scope);
  });

  test('table ledger: the discharge route is captured per item', () => {
    const { ledger } = parseRunLedger(fixture('request-changes-table'));
    const d3 = ledger.items.find(i => i.id === 'D3');
    assert.strictEqual(d3.discharge, '**implementation** (test only), then re-review');
  });

  test('a follow-up link named for an outside item is surfaced', () => {
    const { ledger } = parseRunLedger(fixture('request-changes-table'));
    const c6 = ledger.items.find(i => i.id === 'C6');
    assert.strictEqual(c6.followUp, 'LIN-2149');
  });

  test('a discharged item carries its discharge evidence', () => {
    const { ledger } = parseRunLedger(fixture('conditional-table'));
    const l7 = ledger.items.find(i => i.id === 'L7');
    assert.strictEqual(l7.discharged, true);
    assert.match(l7.dischargedBy, /:236/);
    assert.ok(ledger.items.every(i => i.scope === 'inside'));
  });

  test('numbered-list ledger: marks are read per item across inside and outside', () => {
    const { ledger } = parseRunLedger(fixture('numbered-list'));
    assert.strictEqual(ledger.items.length, 6);
    const scopes = ledger.items.map(i => i.scope);
    assert.ok(scopes.includes('inside'));
    assert.ok(scopes.includes('outside'));
    assert.strictEqual(scopes.at(-1), 'outside', 'the last numbered item is the outside one');
    assert.match(ledger.items[0].discharge, /F1's fix/);
  });

  test('bullet ledger: items are still enumerated', () => {
    const { ledger } = parseRunLedger(fixture('conditional-bullets'));
    assert.strictEqual(ledger.items.length, 2);
    assert.match(ledger.items[0].claim, /backoff actually fires/);
  });
});

describe('run-ledger: a stated discharge route is not a discharge (LIN-3296)', () => {
  // The review template asks each item to "state how it can be discharged", so
  // a route phrase sits in nearly every OPEN item. Only a result reads as
  // discharged. The item wording mirrors that template; one review per case so
  // each assertion names the phrase that failed.
  const ledgerOf = itemText => parseRunLedger({
    createdAt: '2026-10-03T00:00:00.000Z',
    body: `## Review\n\n### What CI Did Not Prove\n- L1 (inside): ${itemText}\n\n**Verdict: Approve — conditional on close-out discharging the ledger.**`,
  }).ledger.items[0];

  test('a route phrase ("<modal>/to be discharged") leaves the item open', () => {
    for (const phrase of [
      'The live read. Can be discharged by a manual repro naming its exact precondition.',
      'The live read. It could be discharged at close-out by opening the page.',
      'The live read, still to be discharged by a real-world check.',
      'The live read. May be discharged through normal post-merge observation.',
      'The live read. Will be discharged by the deploy check.',
      'The live read. Should be discharged by a manual repro.',
      'The live read. It can only be discharged by cited evidence.',
      'The live read. Discharges through normal post-merge observation.',
    ]) {
      assert.strictEqual(ledgerOf(phrase).discharged, false, phrase);
      assert.strictEqual(ledgerOf(phrase).dischargedBy, null, phrase);
    }
  });

  test('contractions, "un-" and "get discharged" leave the item open too', () => {
    for (const phrase of [
      'The live read. It isn\'t discharged yet.',
      'The live read. It isn’t discharged yet.',
      'The live read. It hasn\'t been discharged.',
      'The live read. Still un-discharged.',
      'The live read. It should get discharged by close-out.',
      'The live read. It was never discharged.',
    ]) {
      assert.strictEqual(ledgerOf(phrase).discharged, false, phrase);
      assert.strictEqual(ledgerOf(phrase).dischargedBy, null, phrase);
    }
  });

  test('evidence is read from the result, not the route stated before it', () => {
    const item = ledgerOf('The live read. Can be discharged by a repro; discharged by the repro in comment 4.');
    assert.strictEqual(item.dischargedBy, 'the repro in comment 4');
  });

  test('a negated discharge leaves the item open (real LIN-3247 review, item 4)', () => {
    const { ledger } = readRunLedger(RUN_COMMENT_TRAILS['lin-3247'].comments);
    const item4 = ledger.items[3];
    assert.match(item4.raw, /Inside, not discharged/);
    assert.strictEqual(item4.discharged, false);
  });

  test('a stated result still reads as discharged', () => {
    for (const phrase of [
      'The live read — discharged by #123.',
      'The live read. **Discharged:** filed LIN-9.',
      'The live read — discharged.',
      'The live read, already discharged at review.',
      'The live read. Can be discharged by a repro; discharged by the repro in comment 4.',
    ]) {
      assert.strictEqual(ledgerOf(phrase).discharged, true, phrase);
    }
  });
});

describe('run-ledger: the ledger heading is anchored to a line start (R3)', () => {
  test('a heading mentioned inside prose/backticks does not start the ledger', () => {
    const body = [
      '## Review — draft',
      '',
      'An earlier review quoted the heading `### What CI Did Not Prove` in backticks.',
      '- S13: a bullet that is not ledger content',
      '- Scope held: a second non-ledger bullet',
      '',
      '### What CI Did Not Prove',
      '',
      '- L1: the real first item, *Inside*',
      '- L2: the real second item, *Outside*',
      '',
      '**Verdict: Approve.**',
    ].join('\n');
    const { ledger } = parseRunLedger({ body });
    assert.strictEqual(ledger.present, true);
    assert.deepStrictEqual(ledger.items.map(i => i.id), ['L1', 'L2'], 'only the real ledger items are read');
    assert.doesNotMatch(ledger.raw, /S13|Scope held/, 'the prose bullets must not be captured as ledger content');
  });
});

describe('run-ledger: the empty ledger is a distinct state', () => {
  test('an explicit "(none ...)" ledger is empty, not unparsed and not absent', () => {
    const { ledger } = parseRunLedger(fixture('empty-ledger'));
    assert.strictEqual(ledger.present, true);
    assert.strictEqual(ledger.empty, true);
    assert.strictEqual(ledger.unparsed, false);
    assert.deepStrictEqual(ledger.items, []);
  });
});

describe('run-ledger: unparseable text falls back to raw', () => {
  const malformed = {
    createdAt: '2026-07-01T12:00:00.000Z',
    body: [
      '## Review',
      '',
      '### What CI Did Not Prove',
      '',
      'This change leans on a remote queue CI cannot reach, and that is the whole story.',
      '',
      '**Verdict: Approve.**',
    ].join('\n'),
  };

  test('the raw section survives intact and is flagged unparsed', () => {
    const model = parseRunLedger(malformed);
    assert.strictEqual(model.ledger.present, true);
    assert.strictEqual(model.ledger.empty, false);
    assert.strictEqual(model.ledger.unparsed, true);
    assert.deepStrictEqual(model.ledger.items, []);
    assert.strictEqual(
      model.ledger.raw,
      'This change leans on a remote queue CI cannot reach, and that is the whole story.',
    );
  });
});

describe('run-ledger: latest review comment selection', () => {
  const review = (id, createdAt, body) => ({ id, createdAt, body });

  test('picks the newest review summary comment and ignores non-review chatter', () => {
    const comments = [
      review('eng-1', '2026-07-01T00:00:00.000Z', 'Implemented it. PR #1 opened; CI green.'),
      review('r1', '2026-07-02T00:00:00.000Z', '## Review\n\n### What CI Did Not Prove\n- one item\n\n**Verdict: Approve.**'),
      review('r2', '2026-07-03T00:00:00.000Z', '## Re-review\n\n### What CI Did Not Prove\n- carried\n\n**Verdict: Approve — conditional on close-out discharging the ledger.**'),
      review('note', '2026-07-04T00:00:00.000Z', 'A later non-review note with no verdict and no ledger.'),
    ];
    assert.strictEqual(latestReviewComment(comments)?.id, 'r2');
    assert.strictEqual(readRunLedger(comments).verdict, 'approve-conditional');
  });

  test('returns null / an unknown model when no review comment exists', () => {
    assert.strictEqual(latestReviewComment([]), null);
    assert.strictEqual(latestReviewComment([{ id: 'x', body: 'nothing review-like' }]), null);
    assert.strictEqual(readRunLedger([]).verdict, 'unknown');
  });
});

describe('run-ledger: real finished-run trails (R1/R2)', () => {
  const trail = name => RUN_COMMENT_TRAILS[name].comments;

  test('LIN-3245: picks the review, not the close-out or autopilot wrap-up that shadow it', () => {
    const comments = trail('lin-3245');
    assert.strictEqual(comments.length, 10);
    const picked = latestReviewComment(comments);
    assert.strictEqual(picked?.id, '3e984ba9-c93e-4fea-83b8-9890af4e107b', 'the review summary must win');
    assert.notStrictEqual(picked?.id, '6522575f-ad97-4465-9345-20d397144673', 'the close-out must not shadow the review');
    assert.notStrictEqual(picked?.id, '4222f717-02b0-4dee-a915-f5e80ab9a41f', 'the autopilot wrap-up must not shadow the review');
  });

  test('LIN-3245: the reader yields Approve with the ledger, not an unknown verdict', () => {
    const model = readRunLedger(trail('lin-3245'));
    assert.strictEqual(model.verdict, 'approve');
    assert.strictEqual(model.ledger.present, true);
    assert.strictEqual(model.ledger.items.length, 5);
  });

  test('LIN-3245: In/Out table cells keep their mark, including the "Out (P1b)" suffix', () => {
    const { ledger } = readRunLedger(trail('lin-3245'));
    assert.deepStrictEqual(
      ledger.items.map(i => i.scope),
      ['inside', 'outside', 'outside', 'inside', 'outside'],
    );
    assert.strictEqual(ledger.items[2].scope, 'outside', 'the "Out (P1b)" suffix must still read as outside');
    assert.strictEqual(ledger.items.at(-1).scope, 'outside', 'the run-page item stays outside');
    assert.ok(ledger.items.every(i => i.scope !== 'unknown'), 'no item may lose its mark');
  });

  test('LIN-3247: picks this review out of its own beat/autopilot trail', () => {
    const comments = trail('lin-3247');
    assert.strictEqual(comments.length, 6);
    assert.strictEqual(latestReviewComment(comments)?.id, '3f374473-e5e4-4914-98ea-25bbfd7b7bf9');
    assert.strictEqual(readRunLedger(comments).verdict, 'request-changes');
  });

  test('LIN-3098: the close-out/autopilot title exclusion keeps the S6 review over the autopilot wrap-up that follows it', () => {
    const comments = trail('lin-3098-pair');
    assert.strictEqual(comments.length, 2);
    assert.strictEqual(
      latestReviewComment(comments)?.id,
      '81c9f76f-d68a-4f65-b55e-38383ad833eb',
      'the S6 review must beat the autopilot wrap-up whose title names a review',
    );
    assert.notStrictEqual(
      latestReviewComment(comments)?.id,
      '4f3ef92a-1203-49d8-a20c-0addd3ddc4e7',
      'an autopilot-titled comment must not be selected as the review',
    );
    assert.strictEqual(readRunLedger(comments).verdict, 'approve-conditional');
  });
});

describe('run-ledger: selection over the real large-dense corpus (R1′)', () => {
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
  const source = JSON.parse(readFileSync(
    join(ROOT, 'scripts/eval/fixtures/recommend/_source/large-dense.json'),
    'utf8',
  ));

  // The source capture keeps only body/createdAt/user (build-large-dense-fixtures.mjs
  // strips ids), so give each comment a stable synthetic id from its bundle and
  // index before asserting which one the selector picks.
  const commentsFor = bundleId => source.bundles[bundleId].comments
    .map((c, i) => ({ ...c, id: `${bundleId}#${i}` }));

  // Hand-verified expected review comment per bundle; null = the trail holds no
  // review. LIN-2149 (breakdown/autopilot only) and LIN-3059 (plan reviews only)
  // are the two bundles with no review.
  const EXPECTED = {
    'LIN-2149': null,
    'LIN-1892': 'LIN-1892#40',
    'LIN-2944': 'LIN-2944#34',
    'LIN-3059': null,
    'LIN-3098': 'LIN-3098#26',
    'LIN-3107': 'LIN-3107#15',
    'LIN-3124': 'LIN-3124#41',
    'LIN-3135': 'LIN-3135#9',
    'LIN-2403': 'LIN-2403#4',
    'LIN-2882': 'LIN-2882#15',
    'LIN-3125': 'LIN-3125#13',
  };

  test('every bundle selects its review comment, or nothing when it has none', () => {
    assert.deepStrictEqual(
      Object.keys(EXPECTED).sort(),
      Object.keys(source.bundles).sort(),
      'the table must cover every bundle in the corpus',
    );
    for (const [bundleId, expectedId] of Object.entries(EXPECTED)) {
      const comments = commentsFor(bundleId);
      const picked = latestReviewComment(comments);
      assert.strictEqual(picked?.id ?? null, expectedId, `${bundleId}: selected the wrong comment`);

      const model = readRunLedger(comments);
      assert.strictEqual(model.commentId, expectedId, `${bundleId}: readRunLedger parsed the wrong comment`);
      if (expectedId === null) {
        assert.strictEqual(model.verdict, 'unknown', `${bundleId}: no review must read as unknown`);
        assert.strictEqual(model.ledger.present, false, `${bundleId}: no review must have no ledger`);
      } else {
        assert.strictEqual(model.ledger.present, true, `${bundleId}: the selected review must carry its ledger`);
      }
    }
  });

  test('the two whole-trail fixtures still select their review', () => {
    assert.strictEqual(
      latestReviewComment(RUN_COMMENT_TRAILS['lin-3245'].comments)?.id,
      '3e984ba9-c93e-4fea-83b8-9890af4e107b',
    );
    assert.strictEqual(
      latestReviewComment(RUN_COMMENT_TRAILS['lin-3247'].comments)?.id,
      '3f374473-e5e4-4914-98ea-25bbfd7b7bf9',
    );
  });

  test('a review-titled fix-up with no verdict word or ledger is not selected as the review', () => {
    const fixUp = source.bundles['LIN-2944'].comments[26];
    assert.match(fixUp.body.split('\n')[0], /re-review fix-up/);
    assert.strictEqual(
      latestReviewComment([{ ...fixUp, id: 'fixup' }]),
      null,
      'a title that merely names a review must still carry a verdict or ledger',
    );
  });
});
