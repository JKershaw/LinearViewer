/**
 * LIN-4313 — byte-identity witness for the periodical prompts.
 *
 * The Periodical mint route (POST /api/proxy/periodicals/:id/mint) and the UI both dispatch
 * the registry's prompt text. This pins the sha256 of every registry id's plain prompt
 * (`generatePrompt()`) and its Mint + Autopilot variant (`withAutopilotTail(...)`) as they
 * stood at 165c61e7f, before the shared renderer existed. The refactor that moves the
 * rendering into `renderPeriodicalPrompt` must leave every hash unchanged: "prompt sizes
 * unchanged" in LIN-4313 is this test.
 *
 * It is a deliberate tripwire. A change to a periodical's prompt text (not this ticket's
 * scope) fails here and must re-pin the hash with its reason in the PR. A new registry entry
 * fails here until it is pinned.
 *
 * LIN-4353 re-pinned all 16: the mint closing asked for the gate marker as "the very first line"
 * of the description, but a proxy create now seals the description into the `## As asked` block
 * (LIN-4352), so it reads "the first line … (once Harbour seals it, the first line inside its
 * `## As asked` block)". Swapping the old phrase back into each new prompt reproduces every old
 * hash, so that phrase is the only change.
 *
 * LIN-4379 re-pinned seams-tangles only: it feeds the area notes and mints no follow-ups
 * (LIN-4349 P1). Its mint and one-move bullets went, the notes and routes bullets came in, and its
 * gap-audit, conclude, review-only and adversarial second-read bullets take their `notes` wording
 * (the second read follows the report and its note edits, not follow-up tasks). The other 15 hashes are
 * unchanged, which is the witness that only Seams & Tangles moved.
 *
 * LIN-4380 re-pinned the other 12 corrective templates: they feed the area notes and mint no
 * follow-ups (LIN-4349 P2). Each swaps its mint bullet for the notes and routes bullets and takes
 * the `notes` wording for gap-audit, review-only and the second read; conclude has only the notes
 * wording now. Design & Interface and Onboarding & Cold-Start route objective breakage to the
 * person instead of minting fix-tasks, and the template-specific minting phrases (Drift's
 * follow-up tasks for real groups, Dependency's remediation, Design's minting half, Performance's
 * fix-task bar) say what the run does instead. The three advisory hashes and Seams & Tangles' are
 * unchanged, which is the witness that only these 12 moved.
 *
 * LIN-4390 re-pinned all 16: a Periodical run hands off instead of finishing itself. Close-out
 * merges its PR, sets Done and posts the final summary, as the dispatch gate says for every task.
 * The second read (all 16) and the hand-off bullets (13 corrective, 3 advisory; once conclude and
 * concludeAdvisory, now handOff and handOffAdvisory) reach every template, and the notes bullet (13)
 * hands its PR off instead of merging it. Swapping the old text of those four bullets back into
 * `lib/periodicals.js` reproduces every old hash, so they are the only change.
 *
 * LIN-4414 re-pinned the 13 corrective templates: the notes bullet (`areaNotes()`) stops telling a
 * reading to "distil" a note "under its cap", drops "the byte cap" from the rules it lists, and
 * no longer restates Waiting versus Lesson or the citation format (the notes' README owns them);
 * the gap-audit `notes` bound drops ", each note under its cap". The three advisory hashes are
 * unchanged, which is the witness that only the notes wording moved.
 *
 * LIN-4399 (LIN-4424) re-pinned stability-review only: it opens with a repository's committed
 * declaration of its measures when one exists. One bullet joins its bullets (open the report with the
 * declared rows, in their order and unit, beside the reference reading, read with the committed tool;
 * endpoint totals allowed, "relative" governing the trajectory assessment; not measured, never
 * estimated; a replaced ledger row closed as superseded; no declaration, discover as before), its
 * orient sentence starts discovery with that declaration, and its run bullet's "introducing no new
 * tooling" became "introducing no tooling beyond what the repo commits". The plain prompt grew 1,246
 * bytes (12,468 to 13,714, +10.0%); the Mint + Autopilot one the same (13,799 to 15,045). The other 15
 * hashes are unchanged, Drift & Coherence and Recent Headwinds keeping their own tooling phrase, which
 * is the witness that only Stability moved.
 *
 * LIN-4451 re-pinned all 16: the Periodical prompts said "Linear task" and "in Linear", which a
 * Jira-backed workspace mints into a Jira issue. The three phrases become "task" (the mint opening,
 * the "Write a task" connector) and "on this task" (the hand-off closing). Swapping those three
 * phrases back into `lib/periodicals.js` reproduces every old hash, so they are the only change.
 *
 * LIN-4469 (piece 5) re-pinned 13 (all but Stability, Recent Headwinds and Integration Surface): the notes bullet's
 * "one docs-only pull request" sentence now reads NOTES_PR (lib/prompts/leftover-words.js), the committed-tool
 * sentences of Drift & Coherence, Seams & Tangles' second bullet and Stability are built by `committedSearch` (lib/periodicals.js;
 * Stability passes its look-beside tail as the helper's second argument, its bytes unchanged; Seams & Tangles' first bullet is
 * main's own words and does not use the helper), and the rebase instruction is gone (the clause says "off main"). The three
 * unchanged hashes are the witness that only the notes-bearing and tool-naming templates moved.
 * LIN-4495 (piece 4) re-pinned 13: the cutover's notes bullet (`areaNotes()`) now records each finding for the project
 * (a finding to `project`, not a Waiting entry), its routes bullet (`areaNotesRoutes()`) and `routeObjectiveBreakage`
 * name the person and the project, the hand-off tail names the report pull request, and the second read follows the
 * report and its findings. Every other hash is unchanged, which is the witness that only those bullets moved.
 * LIN-4533 re-pinned all 16: a Periodical's report is recorded as records, not comments. The hand-off bullet asks for the
 * change as a change record (kind `change`) and ends with a final message, not a closing comment; the second read is a verdict
 * record (judgement `adversarial-read`, with outcome, differed and disposition) on that change; the notes and routes bullets name the final
 * message. The phrases those bullets used to carry are the only change.
 * LIN-4502 re-pinned all 16: the As-asked seal is retired, so no proxy create seals the minted task's description and the
 * mint closing drops its parenthetical "(once Harbour seals it, the first line inside its `## As asked` block)". Swapping
 * that phrase back into each new prompt reproduces every old hash, plain and Mint + Autopilot, so it is the only change.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { getPeriodicals, renderPeriodicalPrompt, withAutopilotTail } from '../../lib/periodicals.js';

const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');

const PINNED = {
  "documentation-review": { plain: "dbeb99c6b381a49da1c5edc9287aad22777b6057165afd9fa1d02339eb7572ce", autopilot: "b74785e1b7bb6567d6d4e729a436b46377fa27d609d621b095c8383fae8eb991" },
  "test-coverage-gap": { plain: "c71f297d1f07e2ab597b018acab8cc979de332e25fa93c42c10526ace74ecaef", autopilot: "5678890a1d8fe1f9c456b98624851f4562a00bf7be7c421b39623c8285981dd3" },
  "security-review": { plain: "10231c8ca51f41b8b9370665fad1cdaccffed5f71e2ee3c59d47aba9017b16a2", autopilot: "c7f2feec34a84c21ee37435f4842b87a5b10136603b61ec0b7803a863273f9b5" },
  "api-quality": { plain: "0e510a51de0deb1831dac1ab87d9c1bd32855c3d735f5604cfdc2a8627dc9f29", autopilot: "a6e1e860a024a7361e38c1c53988c6be14eefd4436afe37b9e0960f93466168d" },
  "code-quality": { plain: "b546e4c63beec20b4ca5033e369f6ecb4005a7c3af0b2d2f4b3748583b9aeddc", autopilot: "91c07dc79af0fc0c5994d37ace13c7be5909dbee4b1b7c64b96286da449075f5" },
  "drift-coherence": { plain: "12f9db407fe000de3f1dcbf0faf3ef90b9489094bdcf3bc9a7e64f828df15ebe", autopilot: "bad20cf94bf6282801797767787c3969a8782ee167378327bfe27e9ba52772d1" },
  "comprehension-debt": { plain: "c8a00df4f4aaf66bf1dfe3f1d9f1eda258ffd0238be33dbec268e76c02af00cc", autopilot: "e89b13e5a51e5bccdb50a12c8860465aec819f6e90e1d3e919300c4a79dfd68e" },
  "stability-review": { plain: "d81b0b4b53f4b7405fd01e2828b0dc9fcf1d7f90bac24a38bf0463622fc07e02", autopilot: "e1314c889cfb4d68d349c1235e0b42632db92dd2c9bf2d7c6fb84ebe82ff43eb" },
  "dependency-supply-chain": { plain: "5ce5c0aa8dd5cf3615606e1bc3dae779fc9204ea4f810e721981526a4ab4d3ff", autopilot: "360158903fd441f8e88607f2ea2f609cc9673622e815563a5fc9642f7213d396" },
  "recent-headwinds": { plain: "45269cae8699fa56d902ccc7f7c697af749103aa82cf432da050d21319b49779", autopilot: "44336ae76694ed0505aae7b27615564464a1bb6d28071f956d7176c9dde6e2ee" },
  "design-review": { plain: "e43d3d348726b9d54cbb603b58cde6317a362312785f44938d9915ef602fd406", autopilot: "49dae32a28141a79b3e101fd5c9bc8d141297f9fb3364ac46d7caf19ad5cee5b" },
  "performance-scale": { plain: "a4235f77f4fb7d48a6105238f04e447894054739d9111c67ccb811246dc6ded4", autopilot: "4f0a0fc6f1a9480dd963bba4726d1b8a56013be3697a0134e4b5ff89aa388762" },
  "data-fetch-architecture": { plain: "57bddf412cfa8552358943a10b279de93b301251802daedb0aeeb84e69a26b45", autopilot: "adca57bed30e5b2059dfd8a2a6fc9cf4983154314500aeadb39b365157d0d09d" },
  "integration-surface-maturity": { plain: "dcba5c1932081806a5c41ae97674310deefaae1a72dda678e8449f97080b761b", autopilot: "ce0c648185217435796409ae74113b0c269f22f0d6b2f82a6e7aae2408139e99" },
  "onboarding-journey": { plain: "185641a7fbe83b266ae7a6dc591820633df001642a6ef25bb8ba419502472992", autopilot: "98d1c96889f8407d9d3d2de4a7a8163d72a33b1c92b6d776bc79a02b61d54209" },
  "seams-tangles": { plain: "ea98c70bd4d2255961f0dac9a7659f574fc54f9cdc481b4366065ee390ee040d", autopilot: "2c53e2dde806a00cd4eae5f2cf90d37a01476e78665112430d3b622268792e9e" },
};

test('LIN-4313: every registry id has a pinned plain and Mint + Autopilot prompt, byte for byte', () => {
  const registryIds = getPeriodicals().map(t => t.id).sort();
  assert.deepEqual(Object.keys(PINNED).sort(), registryIds, 'the pinned ids must be exactly the registry ids (re-pin a new or removed id with its reason)');
  for (const template of getPeriodicals()) {
    const plain = template.generatePrompt();
    assert.equal(sha256(plain), PINNED[template.id].plain, `${template.id}: plain prompt bytes changed`);
    assert.equal(sha256(withAutopilotTail(plain)), PINNED[template.id].autopilot, `${template.id}: Mint + Autopilot prompt bytes changed`);
  }
});

// LIN-4317: the same pins, now through the one renderer the UI and the mint route both read. No new
// hashes: matching PINNED is the parity claim (the renderer's output equals the composition's output).
test('LIN-4317: renderPeriodicalPrompt matches the same pinned hashes for every id, plain and Mint + Autopilot', () => {
  for (const template of getPeriodicals()) {
    assert.equal(sha256(renderPeriodicalPrompt(template.id)), PINNED[template.id].plain, `${template.id}: renderer plain bytes changed`);
    assert.equal(sha256(renderPeriodicalPrompt(template.id, { autopilot: false })), PINNED[template.id].plain, `${template.id}: renderer plain (autopilot: false) bytes changed`);
    assert.equal(sha256(renderPeriodicalPrompt(template.id, { autopilot: true })), PINNED[template.id].autopilot, `${template.id}: renderer Mint + Autopilot bytes changed`);
  }
});
