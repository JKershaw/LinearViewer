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
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { getPeriodicals, renderPeriodicalPrompt, withAutopilotTail } from '../../lib/periodicals.js';

const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');

const PINNED = {
  "documentation-review": { plain: "91b4c4d9d2fe38d3e49a93558d983213981b2b042f0c49782cedf99fe4ba2ecc", autopilot: "b3bc200709c80569ad85d66ec72959e618a9e465439beac83de6a57d76368300" },
  "test-coverage-gap": { plain: "d846952a1998d0f2e44ab7ccea7b7bf3de2fd75e2f6f25da2146dfe84569cea6", autopilot: "77edc483d8999c6ad7259496fca1f3bc58735ba8a54b8ec8c348940b0791240c" },
  "security-review": { plain: "c0acb62899a4dd5340453287ebf571584453721b3f31e54a7a9b42f0067e9b73", autopilot: "dfee6cf4874eb74e102915499f31d1a74f7b488c504889cf04cb4aab1c16519b" },
  "api-quality": { plain: "468a03ddcea31111d3f7a2df58e03aa41167840c622da725f0eb22c814d64da7", autopilot: "3a272e10d6325f55fbb32e6cfc929cd2dfa40bbb043482ffbd6ea51829e5ac2b" },
  "code-quality": { plain: "c5fdd28a0df4739fa4f3b469706f2d3d1035007aedf35ab5e4641d0780223dff", autopilot: "ba40c3d5b5a77b6589fb961a3c316dae897ddedac670e4cb2b066599818c61a7" },
  "drift-coherence": { plain: "941e6cce6835349fd5e90bf4b465cefc8f5e5d56b546fee23ee6de9f945df55d", autopilot: "f0c9974f8d858f034b8454eb2ff3b5ebe5ede8454b1b0c42f1b4b29c3b906c09" },
  "comprehension-debt": { plain: "2aa7e16c6ea736803a9b9de63f8ebc849087ca0d8eb219e203f1ae944ecf671e", autopilot: "b435516d9c2d86d8529da7eb3ad418887509cd9859b7656aabc2a7509e97d439" },
  "stability-review": { plain: "b1487f0285eae021538a620043175e7f86fa5cfeb10fc52dbb8111a6dc07be04", autopilot: "98f64ee0b8a7ce13a092676c3db5ef35e7b6472f8786db2a4265aeec0283bea3" },
  "dependency-supply-chain": { plain: "70447953b093082cdef088d564343712c86d2c99044d72527d8d1aa0cd6c676d", autopilot: "04c60d4694714773f40400fd5aab546004d3a4ea88b2861fc4f26a5a11dcb6f8" },
  "recent-headwinds": { plain: "d637582a9d960c38624029136723abd000d9e2d64ad197fa6dde326da98959de", autopilot: "630b70d45eb0eaee3257d6295f4e2c3fb5bddb2c51e29d28dd8365cd299fbeb5" },
  "design-review": { plain: "e05cc31c3bc421329af585d0ce5ffe037375852395492d8c6dd2d382917ecf98", autopilot: "1ca92b3b97b909e01bcebf51f018719db55e5856e3dcf14d60a3550784f3608d" },
  "performance-scale": { plain: "889762371eab2adec7e41d3ebc3967bca7c7f6e529c6c0b3dc2756e5eef32e02", autopilot: "da27a11aa1f089d9cc6c8264bea516f95b58729bf3762390186fc9be726832f9" },
  "data-fetch-architecture": { plain: "baae7f6da1b0e984e02c785bb2648a6c91495a4410902b439bd89a64a3dfc910", autopilot: "d7468144971c5055c57d8a301097d1c9a5b91c76decba93e9d454b3cea99086c" },
  "integration-surface-maturity": { plain: "27e1d9f872b8e5301ec6132626e94df41353f24b5458c4614a83fc9278b2c139", autopilot: "d19a166bacb512047677c0665834a8eb50dc67e1f2e7f71179d96e6f25daaec6" },
  "onboarding-journey": { plain: "777ed2b45377f914ba7e72c68692ce46afdb181e6d4576dcc969af1198edb795", autopilot: "cb3cfcdf7cff642d0064ea098008d4fd6540cbe5beea6a4041619698dc249533" },
  "seams-tangles": { plain: "2db80fe6fc811372db2996bc8211cc88da20307628bae3196ce2ec5188468bde", autopilot: "ec8a33b09f331f60fca153866ba8ac097b5121f40a76f5f749819b60654da4d6" },
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
