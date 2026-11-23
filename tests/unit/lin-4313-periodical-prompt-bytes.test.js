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
 * LIN-4533 (close-out, review fixes) re-pinned all 16 again: the second-read bullet's two leftover phrases, "not a substitute for the
 * comment" and "visible in the comment and the appendix", name the verdict record, since no comment exists on this path
 * (blind-read finding finding-501a9a7a). Those two phrases are the only change.
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
  "documentation-review": { plain: "cfdef2578704eebfe8b69549370dd7f2417755ef73de3a0dcd2b7b75fbedc11e", autopilot: "7a475d34ff053b51fb015db1f4ef46a12c9418fc4e188e1ddad70cc1ea72175c" },
  "test-coverage-gap": { plain: "74282f9d37cf2a93167dfd56b6883a52a7d81bb41da5776b68ac3e8716153d76", autopilot: "f1944acb960593804d0bd55998dc738ac2192797db2cd4195fecf297487c034f" },
  "security-review": { plain: "870d53633f9b39c04e6cf8d45921ba464b244f59f27aea4ea0877fa2beef91a0", autopilot: "eebbb56d734d0377a039a62dd877ee18ed4b5a8f04789f5eac605e07682e9836" },
  "api-quality": { plain: "d4abff47afe3a00081287e2584cfe4bc7655de0d4aa67ecbfa9ff35850791cf6", autopilot: "918119f8086510f640b638aa03ae0882b975a3810574ea9f9fc141714f960146" },
  "code-quality": { plain: "963a42fce1cdaa90c610824e27e07030683452e0a9e78ba1ff608eb240ca1240", autopilot: "abd0645e131c80ba798aef2ac5a2419f1674f3ec3743219ca7a15842258edee8" },
  "drift-coherence": { plain: "146aab7575122749a41bcd3423bdc816d30fcee4fb8ed526fec1eb4be77012ef", autopilot: "a996b9faadd5a57158e97558cc6ea28c65b7cbc07051fd09c1769e67eb003dcc" },
  "comprehension-debt": { plain: "f2204ed6d4f1c130bee8879004ecd0c90fe51f2da0c16331953cecbc048962f4", autopilot: "a2de2a845695bf47bfc481c9241c4f41b2533d9a6f22f69f46c21d812cced44e" },
  "stability-review": { plain: "90ab182f5dafccc16eeaf26f17dde79027f706ae26b6360a7405ee5d479ba960", autopilot: "9b4cb9c8522a42d1f990ae5b7912e5478dc6283ada4fd835ce8f3e84efe15b25" },
  "dependency-supply-chain": { plain: "5dea0e7ef7c73214e5e8a24d35de47a4f0ead7d24abcaf929c135ce92d18a795", autopilot: "330a04a73c53ca0e59b9ae73e3a60ba9c7915c6c5de31b7ba228133a03c40aef" },
  "recent-headwinds": { plain: "bd1de3beaa68287d173ac5098b68120725426fd0e760f8ef98b8249b7a9015a7", autopilot: "43509a9c8dbed7464c9b74b8a2e88176f8e2fdc04e2e437a7936b6690db4d319" },
  "design-review": { plain: "4b79c88900f209a4cc00ec5e55c59adaa275b84d04904bde39b4e2a305833ef6", autopilot: "bbb5239bbf47a6c191f374b0a5ebe2c759bd0d01fc58fe7ea8ca3a8ae1bab6a8" },
  "performance-scale": { plain: "68a50e1ee529f627677560dc48401d2afb771402fba2f8c62fb3fe8ea29be2a6", autopilot: "8eba8d0950e6fe62b6f56d8d282c669c3f65a04e9abbe20864da0010a48baf6f" },
  "data-fetch-architecture": { plain: "e7e3cc6748adfb0dd77b72add9aef592f0e8094918d8feac2ea964e6b727cf9b", autopilot: "86e148c3f139ccfee3cab57d520f2db48b7031d43367e4b64a7b7e0d34ce26e2" },
  "integration-surface-maturity": { plain: "f1b65e93ae7538793732c6670c911c3560b4f846dd4a66dd442d0bc3a8aa8661", autopilot: "efb4efa85959bb4af13b47f97de89cdea8264868d1ac719b40a40037f140d9b9" },
  "onboarding-journey": { plain: "eb70099507e15692b5f2e5756095d497ede27e941efef9ea6bdb816f16b12c4d", autopilot: "0ce1d8b84367243d348169c208c6dcd8b80be3a5c41ffb91f007123957115f96" },
  "seams-tangles": { plain: "cb17cbd53e2a887e9fe53ccbc8d4492105b886fc7ca498db6a40ca96945931a9", autopilot: "d1467d76b3adc27b05eccb228c5f6e4d3d64ecca59669b2e94d0c8185e200c84" },
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
