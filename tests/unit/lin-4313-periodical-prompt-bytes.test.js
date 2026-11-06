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
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { getPeriodicals, withAutopilotTail } from '../../lib/periodicals.js';

const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');

const PINNED = {
  "documentation-review": { plain: "a1a444f32f4633029e09c449457d8071594c8f3c7e0a4b53e37aded379cbede2", autopilot: "4f1924c07e32208be9be41308475038be69151bf825909697138e671fa63b518" },
  "test-coverage-gap": { plain: "97044e51227591f5c5f09e9b0716d062c9c7854e62e4cf058c3a4451e3b5e030", autopilot: "a38d4be8bcbd2bc91a97f89aa25582164dfcde6439527ea269a2d1645ed3c2ff" },
  "security-review": { plain: "9372a58c93a342586aecb6e1b07af321ba6c03bc9f4c96aeba885b0bd8647d4a", autopilot: "2f27d49db88adbe533b8e29915703ecf3ca2519854a7af870f76d822bd3e35e7" },
  "api-quality": { plain: "0ba46e77670f195689426325206c30b320d9585d99f29e4c13415d4d5564dbd7", autopilot: "e957ef822bf4b0b38650131c99d23153179a40ffbcdf1f665b21fce453357f50" },
  "code-quality": { plain: "20e228cb4d03dd16e82f0429e460969a838b4cf743d8f84a37109ec446a71607", autopilot: "460c6cb9fe36fbb3d38b3dc7c842eeef3a9f656a5c41b655e31a73b50f0d7238" },
  "drift-coherence": { plain: "6a46ee28530b485c5c1cf1273a7c64debacb3050f0957486a7949a1b93d394e4", autopilot: "57962ac99d9b7e73f8e4bec4b2eec77a08fa63354c504f3d14a2509e5effd426" },
  "comprehension-debt": { plain: "c92556e90d3f7d0cf645c3ad2c9db5c41f26cac9162d290a09377b6140439eca", autopilot: "a981bd4fb36b3ebf653afe87e8b54f3f6ed46df87185fe9b704760a162a0e1a5" },
  "stability-review": { plain: "4992bc521c4a75d29db2bcc56a3942040e50151352c6a3cb46c23d66333e15f6", autopilot: "dbbbb2a569df54f59a950787d9d3c5a5e3eb4c1bb250ccdc5fac5863d14125be" },
  "dependency-supply-chain": { plain: "b3c1b28fa8119c1363785f57f678d38e9cdecca5fa5be249252a68e005dd7f92", autopilot: "838bca96c5c9fe88c51146da2a639d5f4cfb30236c691b38333f2602db04ee42" },
  "recent-headwinds": { plain: "a39d105a3c048135ba5dbf661e8e75bc7910b1cae90d226c3f44ebcf0b663dd5", autopilot: "36b019dab043f367691355fd478ca3b03cc6eb04e98b5b916f07e5913c3c53ac" },
  "design-review": { plain: "9090fe1887a96316c0c0221833d16f5f490f64990327a0ed0c7a654ada906e5a", autopilot: "5cc7b21b94b2c344c060843571eb727172275e34e334c9c44149f805dff8afbd" },
  "performance-scale": { plain: "30c6321ced8eb2d72bb1e561c02e85f5be87ad68ab357d86800ce6b2f6d43166", autopilot: "ab6e4a2aa780b350b4d43ed1524d72117f894b1e30b3f47b454f19bee51a6226" },
  "data-fetch-architecture": { plain: "53120b724f673a40629c0f34eff0c0c684066dacb8c46629c055795ce5355ce1", autopilot: "32912487ce191854acc41dd4250a81fc4206fab6ca7feed919045f806869dc91" },
  "integration-surface-maturity": { plain: "fb314d104dd0ddfe45ac30ef5fc23d51c3294cf35338f80d25e72e5a773ba934", autopilot: "84fb6016cc1f5068bcfea0a4abb2fe2423fbd781ad8c9bfe5e130528ab3d1290" },
  "onboarding-journey": { plain: "5d38b2d4b78e44fe38159995c4238e10948a52f610d22d513b47355361c66c21", autopilot: "d0e410814d474453bf5f4a897250670fef21fa3f81432b20f3e17fd0b4575f57" },
  "seams-tangles": { plain: "7c7327ccca803df4ab6e72d1d73a05d93ee57d5b9ae41704dbe03b7919ce7663", autopilot: "21a3e459a172bfc41fded476e9582661150daeada206efb5fa68081193219a65" },
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
