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
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { getPeriodicals, renderPeriodicalPrompt, withAutopilotTail } from '../../lib/periodicals.js';

const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');

const PINNED = {
  "documentation-review": { plain: "e3c84cf96461261b60b7051c4df353ecaddabf3bad8c9da57ae47ca8d19c5f70", autopilot: "b3b5646996dd1b2b52227f14fc149c6f0fee84ec25e4945187c77f24ebf7631e" },
  "test-coverage-gap": { plain: "59d2e3cf587badda5eb450c0240f834e3ba210dfedb1fafd8976c7844cebae03", autopilot: "20d833e02d5968333f7c8758c404d3edef65da29562cfb3dc9aa4a2349d066ff" },
  "security-review": { plain: "39f9260e4a6a0683bee1942d4ae0aaadbb0269503e463101e8acc1ea554f9d87", autopilot: "917900dd0e7613c2db4945087c1f78c10c3b26f4f47fd3cb973c4a901eae5744" },
  "api-quality": { plain: "c2befed7b13e56c77c845149013757d5a2f2f526e38c13ebc78a42075c658f6c", autopilot: "d9f7441f6f3dd986046e126f9b7f7234966e37a24c21fa6188f312dea7142f7e" },
  "code-quality": { plain: "ba8cba31c82d135ecdc281e08451c28e9a876ac0bed08f9807ef3e9c4cfe75c0", autopilot: "419cc31fc59271da358e58c4c3c3253b7213759f0c66c4d80741bf5955099872" },
  "drift-coherence": { plain: "4abf21b07fe403e3e86b4d8f1772670fd7d3954143ef1d13d851b491a507b23f", autopilot: "8689c75f17bd86f31c4167293f2bc872e94221f7fb51c8c6346440b29da64ff5" },
  "comprehension-debt": { plain: "98950e2ac929657e4727e6916990b74b9bf7f0d41da3ab3728bb3ff1b84fe738", autopilot: "6dbaa004cd3322ceecca900d3e7cf4e48ad5b2e30ffdf09f59cf588dfd9c88cc" },
  "stability-review": { plain: "b1487f0285eae021538a620043175e7f86fa5cfeb10fc52dbb8111a6dc07be04", autopilot: "98f64ee0b8a7ce13a092676c3db5ef35e7b6472f8786db2a4265aeec0283bea3" },
  "dependency-supply-chain": { plain: "074f695bf3aa462817acf6fe6add4e1c19ef0863d7ad1a473c026a18a5cc34e2", autopilot: "3dbe93c2407007feab33bf8a41dfc618805c11f1c45ff5f9eb02893c94ae114c" },
  "recent-headwinds": { plain: "d637582a9d960c38624029136723abd000d9e2d64ad197fa6dde326da98959de", autopilot: "630b70d45eb0eaee3257d6295f4e2c3fb5bddb2c51e29d28dd8365cd299fbeb5" },
  "design-review": { plain: "e3ce2c96f08c5da35155dfd20a7f0f04870df04730c818e100cbfeffbd4460a5", autopilot: "9a508d5ad4264461c5f30a5be9c4639f201f3b0d8be62c956d6a06dad17e5130" },
  "performance-scale": { plain: "c6804754ad38be7deafad0596c8220d51c6b19a8d8103d2f80c255eb4af39794", autopilot: "7e4780b1cf9c37618bbc6d05066e56ef40cdb1a474291802f6718bb2874dd605" },
  "data-fetch-architecture": { plain: "6d7a915a201a279db7fe8625536070119da73783ad14aa11155cd11ec7d3cb19", autopilot: "823905b01e2f542624b566a992e61ae6cc07af8c0441ae4ed770e84841d62039" },
  "integration-surface-maturity": { plain: "27e1d9f872b8e5301ec6132626e94df41353f24b5458c4614a83fc9278b2c139", autopilot: "d19a166bacb512047677c0665834a8eb50dc67e1f2e7f71179d96e6f25daaec6" },
  "onboarding-journey": { plain: "8118bf151b28fc2046ab74845e35a1805228744e32c630d734261b284a5b0dd9", autopilot: "2a8199176c9b2a3d27f5ba69f3ddcd99c01ac2f9fcc8045a3a23f6f2e6e34921" },
  "seams-tangles": { plain: "9bfb1bdc84880ea81a7a59a6bff0e010d83860ecd3670969c2b46622cdc60384", autopilot: "74fc471fe85e0f596f1c2911b56b09f3cf2bef4f99967faad6fff3faa3c989c1" },
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
