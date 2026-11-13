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
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { getPeriodicals, renderPeriodicalPrompt, withAutopilotTail } from '../../lib/periodicals.js';

const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');

const PINNED = {
  "documentation-review": { plain: "d251ecd0533bd0f27ad97596706bfa2b17145d9662dd2b14a06427f13d04c45f", autopilot: "dfdce59ac15ab9bccf92a5171b8220ad457b5f606488005f7ce700b9e5119468" },
  "test-coverage-gap": { plain: "eee2d7a5f30ec55cf279d0f04191a8e6d30831deeca7e0a4ddb26af4f08752eb", autopilot: "0bfdd7e14329a28954d41f89b4b4ec9b167e187c0ef06121ad3f809f5941214c" },
  "security-review": { plain: "6a40a1e1eb793c7c7cca3f560a07579b9d1c36dd3476d3bc170753a1acce6bad", autopilot: "4bcee4d74ac0ea427f0d0d637fe5c11aea6f7be289393114d3f990e2d4b16202" },
  "api-quality": { plain: "9653d8485b55bff652a23b4987c1f26e7792ad1d440015efbc6f9c9a414cf7f9", autopilot: "ee422e198f4bd48203417ce12df1f172c190fe17908861f76da39556487d1b7b" },
  "code-quality": { plain: "7f553cce1c177da9750979ca26284762a04cbf61a1e313883e72b62d5ba17e68", autopilot: "55df910d0885bf1f2669120e0a7e5a90f821f9e149a8a478111a1554e1db33d5" },
  "drift-coherence": { plain: "8414088bc30eb30e59ec08f98441879fd470fd7a892c240a79572b13567d3f7d", autopilot: "c1e440f15bd04e3e925c7b3e9d543e9f632fa53ecacf3ae431d7c196c0e24ee7" },
  "comprehension-debt": { plain: "d07fe6edb1fb8d5d75bd41c6ea5deb64c6fd9b1c9a88600f348bd6e4e80f75e9", autopilot: "60dbc6e3f3af76457e2905f11739931b87d2e1d5032a0e20dbc45d97ba03e87e" },
  "stability-review": { plain: "b1487f0285eae021538a620043175e7f86fa5cfeb10fc52dbb8111a6dc07be04", autopilot: "98f64ee0b8a7ce13a092676c3db5ef35e7b6472f8786db2a4265aeec0283bea3" },
  "dependency-supply-chain": { plain: "b0d5dd6a2a11b9eef4097cc3dfc8565e16aae5e9ca08a22f95a2d664424ce4c3", autopilot: "2bad4010b3e1362107223165c7dbf0b5f8f15d0ffa70bd38c6fa817b8aed36e4" },
  "recent-headwinds": { plain: "d637582a9d960c38624029136723abd000d9e2d64ad197fa6dde326da98959de", autopilot: "630b70d45eb0eaee3257d6295f4e2c3fb5bddb2c51e29d28dd8365cd299fbeb5" },
  "design-review": { plain: "d4ef6c0d320387d07a27b138863f37cbc506380fd7be7febed5fc1356c56c20b", autopilot: "c5aa6b66cf51dd0cc247c332bf7c2bbbdc5087ffa937f6949231d4c6f629fee4" },
  "performance-scale": { plain: "96b56954e946b54c6b31272e8d20c3afa2092faa675116725a715c40f42bf74a", autopilot: "831b4fbc5f3ccc9e653f0949c036d9a8a0c81943081ea860aaef751eb6d3ed7e" },
  "data-fetch-architecture": { plain: "6c0309947728cae4352d36944270fd8e56710ba6dacc5a6c09f64915e0672419", autopilot: "f2ccd4b2634e871ed4a3686790a4fd40d51a989fb8565d799ed0170fe4d576d8" },
  "integration-surface-maturity": { plain: "27e1d9f872b8e5301ec6132626e94df41353f24b5458c4614a83fc9278b2c139", autopilot: "d19a166bacb512047677c0665834a8eb50dc67e1f2e7f71179d96e6f25daaec6" },
  "onboarding-journey": { plain: "469a757893788705a86ce32373f575026417d9f97abb0c01cbc8ad2478dc9929", autopilot: "8cb2dd9a0d92bf89a64b2a3e7086f6270acca8075c5738db158b9f35a0d62ecb" },
  "seams-tangles": { plain: "1d1f1e6e6b183199fb979b3558f147e7c0e12ee0cd255328a9b2a0590d6f3efb", autopilot: "4174e9420dca12222c595ebd31cbe601d8c9a8b0313ddfcad422347106a345d3" },
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
