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
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { getPeriodicals, renderPeriodicalPrompt, withAutopilotTail } from '../../lib/periodicals.js';

const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');

const PINNED = {
  "documentation-review": { plain: "30b16739c5ce6b7be8a549f7f7e09c22ce2adef0bca34f8872d3efce115ec2ca", autopilot: "d4de11b4acac2d06393235dd49424aaa1257417c0849a4c739620ec864526a8d" },
  "test-coverage-gap": { plain: "acea474121948a7235621bf6f440bf640b13fc6ef578701b138642cdcdd7150a", autopilot: "7782565b85be282f2624f4f5b76bbfc84b8d36cfc001058b4057f4a837208318" },
  "security-review": { plain: "57036fc4fa15e2330c28066d3cbff6fdccea1df2d9e0fa817867365fb1efc86e", autopilot: "43ef8fa9ac233c3a5895d39e83b33c47097c82ab5b1978c1f89c47edf15825dc" },
  "api-quality": { plain: "faca306b7f5aeb172778da896d0103da4bbee96eeb4ca3683eef5e141e698701", autopilot: "425a038096d00e25800892b1425815e66297b22e2db2ac0cf93e7bf334c8bc17" },
  "code-quality": { plain: "9860b454e163ee4c9b3da391f3da118f0786f45b18ccfd422d34456c7508761e", autopilot: "8e44134e5ce7b6efb95684e1225a4cd2ed66979113c5661543bb4ab062a0c5d1" },
  "drift-coherence": { plain: "12f611b1c230251babb0cb5ae4bf12af8a631610ffa94e05a93da001e3dba647", autopilot: "3eb6a45d327bad196483b96a1344658435edcbb692a20d65dfae8adfbbcc624a" },
  "comprehension-debt": { plain: "c9e6afe0dd6c2fb066a3ae65b151e97e6bdd23d487f5f119b4d84c8032124b31", autopilot: "410961082d2181237f97859f7b4e4a9a9f56f4556b65577bce0edfc767195910" },
  "stability-review": { plain: "9a608db3da3b3a3928f3f6eeef85cdffd250dd3b6391ab2531e5994e9da9b3b8", autopilot: "ef27bd9cce7f1a0785d49687a729fd103042aeb620fe2ecf1a610ef5633d34ba" },
  "dependency-supply-chain": { plain: "695efbb7b71e2638a0ff79868b3505c4f27601acb1ed0790424c61348101e743", autopilot: "c6bd81a8c8f07771d9b41bfd0fbb5e725f76cc0b41d598bec087af0d81fb5199" },
  "recent-headwinds": { plain: "30beb3d5b555c07e06f097b05f5313f46df6256a44022e9b0d31034cb0bbeb6d", autopilot: "f0f36cd876ba6b854a5b2518c593c91abe962dff4625e505271f0c4c4047ffe9" },
  "design-review": { plain: "237a4739a7bda5f465edad634f1ee06c485c3354e475376be1b6413941551c3c", autopilot: "851c9a99f8907862779c8a933ad3f2689d7fad9f2f1ecf497ef2bbadfc288719" },
  "performance-scale": { plain: "008afdb3eb19bcb081de90c4beb7ac3eef58f628c9a228544bb5f4e6813a0661", autopilot: "c427244b1a0827ff75585a61bb30396ce0754fe65ab6b0aef8a81dc37ef4ce2d" },
  "data-fetch-architecture": { plain: "fd6a8869e5ee9dc6c4fbe2c39836c1cd236e943ee29e2d1eaaf97afb08095541", autopilot: "0400117360c6695d09ef41eac71ba7c9f5871c79d5849dc58012478ab6b201b7" },
  "integration-surface-maturity": { plain: "772d7e1f5fdc5e19ba8480cb271e90fb8a88ff54df6ee3d52ce9c9ea17d64097", autopilot: "94b881ed667442c4af6d3b59316dfd34d5378531634640d7c64c0983dfe737ab" },
  "onboarding-journey": { plain: "860edc3eb42526ce82d80faf0f68b7f2a45d156b05a358f442e9b1161ddac8a2", autopilot: "24c1ab99510c4f2296ce5673ae722b14e345850fa62a26c383e0b2d47801fdb1" },
  "seams-tangles": { plain: "6a24e76c4c53decf7b73dc01eddb131fb1821da0fd87b1a6f6f58c99ac0c5dfa", autopilot: "ededf149e0c07e38d780da33b01c7206b6750a71b0ef9f9d10333d26146c0613" },
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
