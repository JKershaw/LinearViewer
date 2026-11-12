/**
 * LIN-4432 (piece B of LIN-4401): the after-merge audit's notes PR on an already-Done ticket.
 *
 * Part (a): the trail facts after an audit's notes PR (verdict note 5). Characterization: the
 *   facts the selector reads are the same after the notes PR's close-out as on landing day, so
 *   nothing computed in code records that an audit ran. The behavioural witness is the router
 *   fixture (scripts/eval/jev-routing-eval.mjs); this pins the fact-level cause.
 * Part (b): the stale claims the audit's piece corrects (the size record's tidy, D5's
 *   "only filer" wording, the leftover header, the llms.txt audit line). Each is red until its
 *   edit lands in beat 2.
 *
 * Run with: node --test tests/unit/lin-4432-audit-notes-pr.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assembleTrailFacts, formatTrailFactsBlock } from '../../lib/recommendation-facts.js';
import { generatePrompt, PROMPT_TEMPLATES } from '../../lib/prompt-templates.js';

const ISSUE = {
  id: 'issue-4432', identifier: 'LIN-9432', title: 'Audit notes PR fixture', description: 'Some work',
  url: 'https://linear.app/test/issue/LIN-9432', state: { name: 'Done', type: 'completed' },
  labels: [], createdAt: '2026-11-12T00:00:00.000Z'
};
const CONTEXT = { parent: null, siblings: [], project: null, children: [], comments: [] };
const occurrences = (text, needle) => text.split(needle).length - 1;

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (path) => readFileSync(join(ROOT, path), 'utf8');

const at = (d) => `2026-11-1${d}T10:00:00.000Z`;
const LANDING_PR = 'https://github.com/JKershaw/LinearViewer/pull/2402';
const NOTES_PR = 'https://github.com/JKershaw/LinearViewer/pull/2500';

const landingReview = { createdAt: at(1), body: `## Review — LIN-1\n\nReviewed ${LANDING_PR}.\n\n### Verdict\nApprove.\n\n### What CI Did Not Prove\n- L1 (inside): the live run.` };
const landingCloseOut = { createdAt: at(2), body: `## Close-out — LIN-1\n\nMerged ${LANDING_PR}.` };
const audit = { createdAt: at(3), body: `## Retrospective audit — LIN-1\n\nNo claim failed. Notes PR: ${NOTES_PR}.` };
const notesReview = { createdAt: at(4), body: `## Review — LIN-1\n\nReviewed ${NOTES_PR}.\n\n### Verdict\nApprove.\n\n### What CI Did Not Prove\n- L1 (inside): the notes.` };
const notesCloseOut = { createdAt: at(5), body: `## Close-out — LIN-1\n\nMerged ${NOTES_PR}.` };

describe('(a) trail facts around an audit notes PR on a Done ticket (LIN-4432, verdict note 5)', () => {
  test('while the notes PR is open, the audit comment is work after the landing review (the selector routes to review)', () => {
    const facts = assembleTrailFacts([landingReview, landingCloseOut, audit], '', { leaf: true });
    assert.equal(facts.review.verdict, 'approve');
    assert.equal(facts.workAfterReview, true, 'an audit comment linking a PR counts as work reported after the review');
    assert.equal(facts.closeOutAfterReview, true);
  });

  // Verdict note 5 (beat 3): the second audit. Engineering choice: a computed trail fact, because
  // nothing in the existing facts records that an audit ran, and a prose whenNot alone would rest
  // on the model reading comment prose. Witness: before the fact existed, these were undefined.
  test("after the notes PR's review and close-out, the trail fact says an audit already ran on this landing (landing day's says it did not)", () => {
    const landing = assembleTrailFacts([landingReview, landingCloseOut], '', { leaf: true });
    const afterNotes = assembleTrailFacts([landingReview, landingCloseOut, audit, notesReview, notesCloseOut], '', { leaf: true });
    assert.equal(landing.auditAfterCloseOut, false, 'landing day still routes to the audit: no audit has run');
    assert.equal(afterNotes.auditAfterCloseOut, true, 'the post-notes-PR trail records the audit, so the selector stops re-selecting it');
    assert.ok(afterNotes.prUrls.includes(NOTES_PR), 'the notes PR is linked on the trail');
    assert.equal(afterNotes.workAfterReview, false);
    assert.equal(afterNotes.closeOutAfterReview, true);
  });

  test('while the notes PR is open, the audit fact is already yes, so the audit whenNot sends the open PR to review', () => {
    const window = assembleTrailFacts([landingReview, landingCloseOut, audit], '', { leaf: true });
    assert.equal(window.auditAfterCloseOut, true);
  });

  test('the trail block states the audit fact beside the close-out fact, on landing day and after the notes PR', () => {
    const landing = formatTrailFactsBlock(assembleTrailFacts([landingReview, landingCloseOut], '', { leaf: true }), 2);
    const afterNotes = formatTrailFactsBlock(assembleTrailFacts([landingReview, landingCloseOut, audit, notesReview, notesCloseOut], '', { leaf: true }), 5);
    assert.match(landing, /- Audit reported after the landing close-out: no/);
    assert.match(afterNotes, /- Audit reported after the landing close-out: yes/);
  });

  // The reopen edge (beat 4). Key: the landing close-out is the last close-out that does not merge
  // a notes PR (a PR an audit report links for the first time). Chosen over keying on the first
  // close-out, which would block a re-audit of a reopened ticket's second landing for good.
  const REOPEN_PR = 'https://github.com/JKershaw/LinearViewer/pull/2600';
  const reopenReview = { createdAt: at(6), body: `## Review — LIN-1\n\nReviewed ${REOPEN_PR}.\n\n### Verdict\nApprove.\n\n### What CI Did Not Prove\n- L1 (inside): the reopened work.` };
  const reopenCloseOut = { createdAt: at(7), body: `## Close-out — LIN-1\n\nMerged ${REOPEN_PR}.` };
  const secondAudit = { createdAt: at(8), body: `## Retrospective audit — LIN-1\n\nNo claim failed.` };

  test('a reopened ticket that lands again is not already audited: its landing close-out merges a new PR, not a notes PR', () => {
    const facts = assembleTrailFacts([landingReview, landingCloseOut, audit, notesReview, notesCloseOut, reopenReview, reopenCloseOut], '', { leaf: true });
    assert.equal(facts.auditAfterCloseOut, false, 'the second landing has no audit after it yet');
  });

  test('an audit of the reopened ticket\'s second landing is recognised as that landing\'s audit', () => {
    const facts = assembleTrailFacts([landingReview, landingCloseOut, audit, notesReview, notesCloseOut, reopenReview, reopenCloseOut, secondAudit], '', { leaf: true });
    assert.equal(facts.auditAfterCloseOut, true);
  });

  test('an audit that cites the landing PR (already linked before it) does not make that PR a notes PR', () => {
    const citing = { createdAt: at(3), body: `## Retrospective audit — LIN-1\n\nAudited ${LANDING_PR}; no claim failed.` };
    const facts = assembleTrailFacts([landingReview, landingCloseOut, citing], '', { leaf: true });
    assert.equal(facts.auditAfterCloseOut, true, 'the landing close-out is still a landing, so the audit is after it');
  });
});

describe('(c) the audit notes PR sentences, each rendered once where they belong (LIN-4432, beat 3 and 4)', () => {
  const render = (kind) => generatePrompt(kind, ISSUE, CONTEXT, {}).prompt;

  test("review judges an audit's notes PR on a Done ticket against the audit's findings comment, once", () => {
    const text = render('review');
    assert.equal(occurrences(text, "An audit's notes PR on a Done ticket is judged against the audit's findings comment"), 1);
  });

  test('close-out merges an approved, unmerged audit notes PR on a Done ticket and posts its summary only, once', () => {
    const text = render('close-out');
    assert.equal(occurrences(text, 'On a Done ticket with an approved, unmerged audit notes PR, merge and post the summary only'), 1);
    assert.ok(text.includes("a Done ticket's audit notes PR gets its summary alone (Land It)"), "close-out's Workflow step 5 points to Land It");
  });

  test("close-out's route covers an approved, unmerged audit notes PR on a Done ticket", () => {
    assert.match(PROMPT_TEMPLATES['close-out'].route.when, /an audit's notes PR is approved and unmerged on a Done ticket/);
  });
});

describe('(b) the stale claims this piece corrects (LIN-4432, beat 1 tests for beat 2 edits)', () => {
  test("docs/areas/README.md no longer says close-out is the only one that files a ticket", () => {
    assert.ok(!/Close-out is the only one that files/.test(read('docs/areas/README.md')));
  });

  test("docs/areas/README.md's writers list names the after-merge audit", () => {
    const text = read('docs/areas/README.md');
    const who = text.slice(text.indexOf('Who writes here:'));
    assert.ok(who.includes('retrospective-audit'), 'the audit writes a note-bound find into a notes PR, so the writers list names it');
  });

  test("close-out's Make the Fixes comment no longer calls close-out the only filer", () => {
    assert.ok(!read('lib/prompt-template-defs.js').includes('the only filer'));
  });

  test('the leftover words header names the audit as a reader of CONSEQUENCE_TEST', () => {
    const src = read('lib/prompts/leftover-words.js');
    const header = src.slice(0, src.indexOf('\nexport '));
    assert.ok(header.includes('retrospective-audit'), 'the header names where the gate renders, including the audit');
  });

  test("public/llms.txt's retrospective-audit line is accurate: it no longer says the audit presents findings without writing back", () => {
    const line = read('public/llms.txt').split('\n').find(l => l.startsWith('- `retrospective-audit`'));
    assert.ok(line, 'the llms.txt retrospective-audit line exists');
    assert.ok(!line.includes('without writing back'), line);
  });
});
