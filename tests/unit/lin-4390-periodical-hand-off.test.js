/**
 * LIN-4390: a Periodical review run hands off; close-out merges its PR and sets Done.
 *
 * The Stage-2 text used to give the run its own finish line (LIN-386's "self-conclude", LIN-2396's
 * "owns merging its own report PR"), while the dispatch gate the run works under gives merge and
 * Done to close-out after review approves. Runs resolved the clash differently (PR #2372 declined
 * to merge). The decision (LIN-4390 comment 8810f969): the run stops at a green, rebased PR with its
 * link and second-read comments posted, and its closing comment names review as approver and
 * close-out as the stage that merges, sets Done and posts the final summary.
 *
 * This is the first test that reads both sides: every Periodical render (16 plain + 16 Mint +
 * Autopilot) and the gate prose (close-out, review, the proxy preamble). The retired phrases are
 * matched exactly, so a sentence that gives the merge to close-out ("close-out merges it") passes.
 * Each template gets its own test so a regression names the templates it reaches.
 *
 * Run with: node --test tests/unit/lin-4390-periodical-hand-off.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PERIODICALS, withAutopilotTail } from '../../lib/periodicals.js';
import { generatePrompt } from '../../lib/prompt-templates.js';
import { buildProxyContextPreamble } from '../../lib/proxy-preamble.js';

// The self-finish wording this change retired, one entry per bullet it lived in.
const RETIRED = [
  /owns merging/i, // adversarialRead (LIN-2396)
  /merge it before the Done/i, // adversarialRead
  /merging it yourself is safe/i, // adversarialRead
  /may this task conclude with that PR left open/i, // adversarialRead
  /before the Done transition described above can actually succeed/i, // adversarialRead
  /merge it under the merge authority/i, // areaNotes
  /move the task to its done/i, // old conclude() / concludeAdvisory()
  /done\/completed state/i, // old conclude() / concludeAdvisory()
  /Then conclude this task/, // the old conclude() / concludeAdvisory() title
  /self-conclud/i,
];

const ISSUE = { id: 'x', identifier: 'ABC-1', title: 'T', description: 'D', state: { name: 'In Progress', type: 'started' }, labels: [] };

test('the registry is the 16 templates this test was written against (13 corrective, 3 advisory)', () => {
  assert.equal(PERIODICALS.length, 16);
  assert.equal(PERIODICALS.filter(p => p.mode === 'advisory').length, 3);
});

for (const p of PERIODICALS) {
  const plain = p.generatePrompt();
  for (const [variant, text] of [['plain', plain], ['Mint + Autopilot', withAutopilotTail(plain)]]) {
    test(`${p.id} (${variant}): the run hands off; close-out merges and sets Done`, () => {
      for (const re of RETIRED) assert.doesNotMatch(text, re, `${p.id} still carries retired self-finish wording ${re}`);

      // The hand-off bullet (handOff / handOffAdvisory): the run neither merges nor sets Done,
      // and the closing comment names who finishes.
      assert.match(text, /Then hand off — do not stop silently, and do not merge or set Done yourself/);
      assert.match(text, /it neither merges nor moves the task to Done, and the task stays In Progress until close-out finishes/);
      assert.match(text, /review approves, then close-out merges (?:that|any report) pull request, sets this task to Done and posts the final summary/);
      assert.match(text, /if the pull request cannot be made green, name the blocker in the closing comment/);

      // The second read (adversarialRead, all 16): comes before the hand-off, so close-out's Done is
      // not refused; the run leaves the PR green for close-out; an open PR is never a Done state.
      assert.match(text, /second-read before you hand off/);
      assert.match(text, /before the hand-off described above \(close-out's Done transition is refused until this comment exists\)/);
      assert.match(text, /This run neither merges its report pull request, if it opened one, nor sets Done: it leaves that pull request rebased and green for close-out, which merges it and then sets Done/);
      assert.match(text, /never Done with the pull request open/);
      assert.match(text, /AGREE and DISAGREE both end in the normal hand-off/);

      if (p.mode === 'advisory') {
        // handOffAdvisory: no area-notes PR is required of the three advisory templates.
        assert.doesNotMatch(text, /area-notes pull request|area notes/i, `${p.id} gained the area-notes wording`);
        assert.match(text, /If you open a pull request for the report, post its full URL as a comment on this task/);
        assert.match(text, /hands its decision to the human through that summary/);
      } else {
        // areaNotes: the notes PR is handed off, never merged by the run.
        assert.match(text, /one docs-only pull request\*\*: rebase it onto main and get it green under the notes guard and the required checks, then hand it off/);
        assert.match(text, /review approves it and close-out merges it, never this run/);
        // conclude: the PR link comes first (the gate's evidence), then the closing comment.
        assert.match(text, /As soon as the area-notes pull request is open, post its full URL as a comment on this task/);
        assert.match(text, /The area-notes pull request carries the findings forward/);
        // Findings stay in the notes and the closing comment; close-out is not handed them as tickets.
        assert.doesNotMatch(text, /close-out[^.]*(?:files?|mints?|turns?)[^.]*(?:findings|tickets)/i);
      }
    });
  }
}

// The gate side. Left unchanged by LIN-4390 because it already says what the decision says; these
// pins keep the two sides in step if either moves.
test('close-out merges, then sets the task Done and posts the final summary', () => {
  const { prompt } = generatePrompt('close-out', ISSUE, {});
  assert.match(prompt, /Merge pinned to the commit CI passed on/);
  assert.match(prompt, /Then set the task to Done\./);
  assert.match(prompt, /Post the summary comment: what merged/);
});

test('review approves but does not merge or mark Done', () => {
  const { prompt } = generatePrompt('review', ISSUE, {});
  assert.match(prompt, /You do NOT merge, mark the task Done, or file the gate's tickets — the `close-out` step does/);
});

test('every dispatched session, a Periodical run included, reads that merge and Done are gated on review', () => {
  const preamble = buildProxyContextPreamble({ baseUrl: 'https://host', token: 'T', issueIdentifier: 'LIN-42' });
  assert.match(preamble, /merge and Done are gated separately on a recorded review Approve/);
});
