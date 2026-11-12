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
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { getPeriodicals, renderPeriodicalPrompt, withAutopilotTail } from '../../lib/periodicals.js';

const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');

const PINNED = {
  "documentation-review": { plain: "0dfebae571f72299d2bdef1b7be625fcd1180db94857444daffca6e0c58f0679", autopilot: "dce863eb052162604d3c5017208e525b739c58bf8fb7bbbd1c8540aced0f312c" },
  "test-coverage-gap": { plain: "6e3fd350667dc10418079b184c9a439db61704a66f85b3c2744bc35398199b2c", autopilot: "a252352268e8f6395fd806462a66a5249122197f1d75c67e880f05f0beb70d89" },
  "security-review": { plain: "88ee484a8e0f1d3bbc7827b97569cf078ea2db5433b37e2bd46950a232c8bf26", autopilot: "42a01943f7e4c06b08bfd50bd16834e4bf3fd17e65cb0bb409dad0fa9fcf7f01" },
  "api-quality": { plain: "ae40c2db52f7c1a7139fdb5076a4d680fdfeab4418f1a08c3a3e6f175ea9df4f", autopilot: "f8fb28572738a15a9a9d625d9f43dcf827d15f0a8826d81dffac79636ce261bc" },
  "code-quality": { plain: "abd5a8e20c58eb6a80adddf2a05cfb3ebd6316ff40b77f6e1c1b8f89ebce6d71", autopilot: "cb9201327a36feac91dafa46447997ee5524da573d9894fc4324790a48900d4c" },
  "drift-coherence": { plain: "b6c5bd60af7cfdce8446f83639584f20687dca5f6d601a161e672f1758092918", autopilot: "6a47915883f0e77d5378b65a44efb1e8763a3b706720786d0eaa4d4c0d806250" },
  "comprehension-debt": { plain: "f22cb3bf0e1bf03d54d63f27435a6d913235198e583d2a42b308d57038bb8332", autopilot: "681c366ec8cef4d7545dade9eb81efd7613c097359a5ce5a78eee7c202b9dc14" },
  "stability-review": { plain: "8ab4e80235311f63c2839edbaad5f689d2aa8b53d33e1bc39986818ba39863e5", autopilot: "1914d2da61c3503b48be367557fe19c570a11324a3b332ca8303aa804b3b2529" },
  "dependency-supply-chain": { plain: "15599302b823251d60c119ea78f489ce21486959648d593a7884b563567a7f35", autopilot: "3290ee915f46c40febfdc5b9742570ff669cf6f583bd6ed59af11f55b46aba52" },
  "recent-headwinds": { plain: "30beb3d5b555c07e06f097b05f5313f46df6256a44022e9b0d31034cb0bbeb6d", autopilot: "f0f36cd876ba6b854a5b2518c593c91abe962dff4625e505271f0c4c4047ffe9" },
  "design-review": { plain: "cb655c359ea9874437d01843314a5dcb2213a5df39453d24543da18482a4dcdf", autopilot: "6191abd84f5c9fe4307dc483e75c191a081891a62027cef7c92c7b9a58af20bf" },
  "performance-scale": { plain: "68d517c92f2a3d71fa629740d98295129a2bb05211f1de4c9fb5b0db62e22833", autopilot: "4c454d28174d6032bb641398750d72adef1bb5e4a4eafaedfe3dea9e5cdcfec9" },
  "data-fetch-architecture": { plain: "09b808828e669f7273987df84061f90c4c2de7aeb087ce6563b5bc453a9fbf30", autopilot: "1f89f3a649353be7a737c212d9cf93f2d17f66bbb51dcc317cad201db2a2b4eb" },
  "integration-surface-maturity": { plain: "772d7e1f5fdc5e19ba8480cb271e90fb8a88ff54df6ee3d52ce9c9ea17d64097", autopilot: "94b881ed667442c4af6d3b59316dfd34d5378531634640d7c64c0983dfe737ab" },
  "onboarding-journey": { plain: "3d6ff23b6632ceda9418bfa1acddec31fb229dce7e27858a1a774870c3728f01", autopilot: "41683357b22f9ad33b7ff65751d6e4056d9955fa68ca4b1694c9337a4b7dbaeb" },
  "seams-tangles": { plain: "4dcca9ea41cf624f9be1cc71d01268a8c1e7b62a37cf7aa28fb3bd6ed6e2fa0f", autopilot: "d1b03a5f2bd3d17bedc905d5aefc997147a19eb27a5a94972819cc48f83aa0c4" },
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
