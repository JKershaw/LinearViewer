/**
 * LIN-4531 (LIN-4529 plan D2, John's ruling 23 Nov on question-6a487149): every dispatch kind that asks in production either
 * starts a run, or inherits the run it resumes, or has a line in docs/plans/survey/integration/design.md §11 saying why not.
 *
 * The kinds are the production census (LIN-4531 comment d119199f, read-only over dispatch-history, 23 Nov, window 2026-08-31 to
 * 2026-11-23): 815 asks, all in dispatch-history. A question can be written only under a run (lib/run-lineage.js writerOf refuses
 * a credential with no run, `no-run`), so this test pins where a run comes from for each kind. A new kind that asks must be added
 * here with its run rule, or the census test fails.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startsRunRow, runRecordIdFor } from '../../lib/run-identity.js';

const DESIGN = fileURLToPath(new URL('../../docs/plans/survey/integration/design.md', import.meta.url));

/** The census's asking kinds, with their ask counts (the comment's table). `wake` and `custom` are follow-up-heavy; see below. */
const CENSUS_ASKS = Object.freeze({
  'wake': 305, 'close-out': 99, 'research': 84, 'implementation': 83, 'review': 64, 'custom': 49, 'plan-review': 32,
  'scoping': 24, 'plan': 18, 'autopilot': 12, 'bug': 11, 'blocked': 10, 'design': 10, 'breakdown': 7, 'spike': 3,
  'look-into': 2, 'triage': 1, 'retrospective-audit': 1,
});

/** Kinds whose fresh row starts a run: every stage kind (lib/prompts/stage-kinds.js) is one. */
const STAGE_KIND_ASKS = ['close-out', 'research', 'implementation', 'review', 'plan-review', 'scoping', 'plan', 'bug', 'blocked', 'design', 'breakdown', 'spike', 'look-into', 'triage', 'retrospective-audit'];

/**
 * Kinds whose FRESH row starts no run, with the design §11 line that says why. A follow-up of any of them still inherits its
 * parent's run (below). Nothing else may be listed here without a §11 line.
 */
const NO_RUN_JUSTIFIED = Object.freeze({
  custom: 'design §11 item 11',
});

const RUN = 'run-parent';

describe('every census kind that asks has a run rule', () => {
  test('the census covers the kinds the ask counts name, and no kind is left unplaced', () => {
    const placed = new Set([...STAGE_KIND_ASKS, 'wake', 'autopilot', ...Object.keys(NO_RUN_JUSTIFIED)]);
    assert.deepEqual([...placed].sort(), Object.keys(CENSUS_ASKS).sort());
  });

  test('every stage kind that asks starts its own run when fresh', () => {
    for (const kind of STAGE_KIND_ASKS) {
      assert.equal(startsRunRow({ kind, followUpTo: null }), true, `${kind} must start a run, so its records and questions have one`);
    }
  });

  test('a fresh autopilot kickoff starts its run, and its follow-up does not', () => {
    assert.equal(startsRunRow({ kind: 'autopilot', followUpTo: null }), true);
    assert.equal(startsRunRow({ kind: 'autopilot', followUpTo: 'some-row' }), false);
  });

  test('a wake row and a custom follow-up continue the run they resume, and start none', () => {
    for (const kind of ['wake', 'custom']) {
      assert.equal(startsRunRow({ kind, followUpTo: 'some-row' }), false, `${kind} follow-up starts no run`);
      assert.equal(runRecordIdFor({ kind, id: 'row-x', resumedRunRecordId: RUN, followUpTo: 'some-row' }), RUN, `${kind} follow-up inherits the run`);
    }
  });

  test('a question resume (a custom follow-up with no kind) continues the asking run, so the answer lands on the run that asked', () => {
    assert.equal(runRecordIdFor({ kind: 'custom', id: 'fu-0', resumedRunRecordId: RUN, followUpTo: 'run-tail' }), RUN);
  });

  test('a kind listed as having no run is refused a run when fresh, and has a §11 line in the design', () => {
    for (const [kind, anchor] of Object.entries(NO_RUN_JUSTIFIED)) {
      assert.equal(startsRunRow({ kind, followUpTo: null }), false, `${kind} fresh starts no run`);
      assert.equal(runRecordIdFor({ kind, id: 'row-fresh', resumedRunRecordId: null, followUpTo: null }), null, `${kind} fresh belongs to no run`);
      const design = readFileSync(DESIGN, 'utf8');
      const section = design.slice(design.indexOf('## 11. For John'));
      assert.match(section, /^11\. /m, `${anchor} must exist in design §11`);
      const item = section.slice(section.search(/^11\. /m));
      assert.match(item, new RegExp(`\`${kind}\``), `§11 item 11 names \`${kind}\``);
    }
  });
});
