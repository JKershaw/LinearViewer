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
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { getPeriodicals, renderPeriodicalPrompt, withAutopilotTail } from '../../lib/periodicals.js';

const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');

const PINNED = {
  "documentation-review": { plain: "ead963e92830bfbfa6dff68f171ce0aea3192602de47fc73eae7a625b99984eb", autopilot: "1cb15f1ecd8dd197951c43b4ab5a071ffa949d71cc99b754d25f29b6621d4805" },
  "test-coverage-gap": { plain: "2cedbe00bf4ba9bae7f50ad3f88481a9c255ee40983b678d2f92bdc061ae3359", autopilot: "efed147792d83898dedb6b11284f6ba797d5790d52576e297907585f15050334" },
  "security-review": { plain: "bf34b713a791a073f1c2523c193ec8555aafd04dc01b32927953c908af099f53", autopilot: "9cc48e1e1d00dd2c15ce263b196786bde5df5560291eee8c517f9a646f0aaee5" },
  "api-quality": { plain: "076d1906899eef70c4d3ee5995fd02bf30cb89b2af80ab8efad8fe0f13524d62", autopilot: "4c8b534aa2d92eff0c50527c5db2b2dc8beef82b7bd693e4325697126aad5360" },
  "code-quality": { plain: "44c9a1215cb69c99d430924ffc5c82eeeec209ef2db567ddb07c8e8bfbe31fe4", autopilot: "755937db61e0b1c324a7a103e54dc0a1ba552598a1b8c7cb101babde74a417db" },
  "drift-coherence": { plain: "b4b9a1fce007d76bfe7f21d642a8fb4e310a0c7540aaa40b3e74084cc5d58a0f", autopilot: "6983954bb6379c4d4222d5b2b1566d64128bb0ac1ef38bd31255f432a06c3573" },
  "comprehension-debt": { plain: "8b515566aaa4139887bbec85e6b232abc3539a3bab6591a33c17c9a536184143", autopilot: "2e1110ea8d1db76671bcc57d18959f016a172c73a64abf1fe4b19b947ab120e6" },
  "stability-review": { plain: "5a2ef42b8d9bd342e71078200bcc8b9037475663aad8e8bfe3897090b0747fd2", autopilot: "010ac9f6a9bf767c3c66f14dea98ba4437efc5594c3b75b7714416eebc7b7498" },
  "dependency-supply-chain": { plain: "d0e13e7fe92b44b5074be573f4ed7d8113b7668ca894821ece9e651143a5adc9", autopilot: "dce7dccff00649cba1065e46efedd5d261adb2f25e74e078565352e5ca4bcc40" },
  "recent-headwinds": { plain: "0871665214ff0f0dfb2517311c492470008b937f9d016816bbf0612c1c311377", autopilot: "7626d1a3a2186bf68778becbde396a0619a09e6ed8a624202c46e519e939ee1f" },
  "design-review": { plain: "a5d804e33caa7b572bca7dd9917c20294987c75e99be53d6bd2507e05084c2ef", autopilot: "75a265036c3741b7f51f8a203ea4c1d81ac4e37aa8a2aae43142d6d5ffc93856" },
  "performance-scale": { plain: "51410c9ed1bd48de03b65a9a6d2a52f8be0130088cba674d682658187b6f3d03", autopilot: "33f4978f43b33241aeb7cd1d0fa128648ac654befe762eba8b29d04849f9b92b" },
  "data-fetch-architecture": { plain: "0d20cb9eef94bd9ab6e0863faecfa7ba4323a9f2830ad52a8ddb858b1ebb9bc3", autopilot: "3ccb4658335669cb84cd1d08c3abad114de0b5961fbe36f3ee784a96feec4105" },
  "integration-surface-maturity": { plain: "56f99610e57e22362dd19ba8fae37b6d2b409b709e549b3b2c4eb152b9d49815", autopilot: "f73ba50c5fc8f0746217303a22653e259de5f8407a08b8fa3e6818e63716a2e8" },
  "onboarding-journey": { plain: "58451ff660b499a3bba2573ba8871e992ad9312a536ab07d04950978f543be69", autopilot: "ce24d062b6a28236016b7ef63da83b9151f06a1238dabebc9b60c926b8925553" },
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
