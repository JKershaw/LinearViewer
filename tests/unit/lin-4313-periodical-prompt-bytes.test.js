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
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { getPeriodicals, renderPeriodicalPrompt, withAutopilotTail } from '../../lib/periodicals.js';

const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');

const PINNED = {
  "documentation-review": { plain: "a9d5394857241df8f4c45cd51ac2fb46db158cfa27e1120d55348f1c4e14e55b", autopilot: "4325662eb7742351e16948efc04028204093a62d1cee3e3a7d90685615f6538f" },
  "test-coverage-gap": { plain: "db553226e20d40dc38f2cec30e8526c2a3bf31a62c00a72564d85e24f1cc404b", autopilot: "c40ab5afb89f1d6cd24fba778c8c58e28cc1dbe61c2f343da83ef0b325289156" },
  "security-review": { plain: "83e4ba3bc7ae533cfd11ff7efd53d611140d1829e817a9a7d05bc333d329e336", autopilot: "9af2581eca9c8599335a7da951145225487697167bd3f3ebc96b37f34293c35f" },
  "api-quality": { plain: "0fe82947c39e1b5ea50b1fefa2fbfaf44dab2fbf87a5a2059ba6c04884954e7b", autopilot: "e856f7d0d5a2c777da70e39a9f6ef67196c5c4515f8a7dfc4d4fcacf3277990a" },
  "code-quality": { plain: "42156eb16c57797bcea6c6d23fba38e51bb64999c3bce2ab72456d731430a9e1", autopilot: "6e04d1fc0a3d4c006002980a37778c8b99b4cf46712009dac5f75e51fc11fb8b" },
  "drift-coherence": { plain: "6a14262dbb1ccc97b06e975d463c72de50fea8a389177db1a1cebe100934d893", autopilot: "0edd2a714c0992e992bb7ffc314084846a5a28b17861d33f12cfcb4f1fc2093a" },
  "comprehension-debt": { plain: "0fc3638b40aad059aa5420a0fd1bbbab054858759a9b47c7a2d8e7278a8d8dd5", autopilot: "16258cc3f44db78c1002fb40bafc742be09c561a8d935184ebe8a321f9fb2cb3" },
  "stability-review": { plain: "5a2ef42b8d9bd342e71078200bcc8b9037475663aad8e8bfe3897090b0747fd2", autopilot: "010ac9f6a9bf767c3c66f14dea98ba4437efc5594c3b75b7714416eebc7b7498" },
  "dependency-supply-chain": { plain: "01b030c7e4da524d4f915e5c00a9fa85901d7bdfbba1289bf77ed9374564eb84", autopilot: "1d967f203d6f1a1598b2b8f089e0a69cd4e06a3cf054396ee1c00bc13a4b5c9e" },
  "recent-headwinds": { plain: "0871665214ff0f0dfb2517311c492470008b937f9d016816bbf0612c1c311377", autopilot: "7626d1a3a2186bf68778becbde396a0619a09e6ed8a624202c46e519e939ee1f" },
  "design-review": { plain: "6df9f5f8448f0a55f2b0964ba575c6b8c0ffb2d7220521723a9b7676b7183d9d", autopilot: "656e2791f74767aa3c4d78e009cfb73b1f5ce1790b34df04610571bd710c443b" },
  "performance-scale": { plain: "74d01c27e07e1bb9b8048a5f8ff52984899a028320d61c9294e674feba0714d7", autopilot: "0be5c4fedb03d4a6b5b472c06d821346508b3b0279df19617ccf35927e2c71e5" },
  "data-fetch-architecture": { plain: "22c9556985958111b3276835e506890269bf91986516ff6270b7d5d68c2bfc1d", autopilot: "3576f7340cadb38260f4c2662c1d4dfbd3e1fd70fe29299207e2556e6a55bc47" },
  "integration-surface-maturity": { plain: "56f99610e57e22362dd19ba8fae37b6d2b409b709e549b3b2c4eb152b9d49815", autopilot: "f73ba50c5fc8f0746217303a22653e259de5f8407a08b8fa3e6818e63716a2e8" },
  "onboarding-journey": { plain: "71ebcf21556216bab26f7b0591acd5044783495ff018a6fcded93ca883919b82", autopilot: "758ba103dac539ff838d45b59331dd4ae8f35394b55af8a1416c89fd654e3703" },
  "seams-tangles": { plain: "36eccf316b0e6eb3274b4fb291637b02e8e536feb4f55ed701207d7be70eea61", autopilot: "cbf9966d14c119e4437143c0b1d9b935c5bb650c219d696167656c73aa09fa8d" },
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
