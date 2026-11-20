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
  "documentation-review": { plain: "24de37bcb75e32072a592868bfa6d7848efb14fe591ed8aedb830dfd7f03aec2", autopilot: "c3eeed5c06749a540bb0d1c8b13f44222541945aa85133a2836c6341cff77b1a" },
  "test-coverage-gap": { plain: "7d7fcdfe4267e596e3c8af75de4b8167bcbc145ac83365030ee8b03228a50088", autopilot: "3155851bf38cad02222b4a50e5b87d2d91304051b45bebbe24ddfdab68097e77" },
  "security-review": { plain: "67199e354bfaec527cbed1033084275adb93e90fc5fc3b8de226aadc0d1cb2ef", autopilot: "fb1a4d5305795c028067c632c0b0b53414a43fd8164f0f58967191def281c767" },
  "api-quality": { plain: "65113f1a7d0ef796918019adf41de1467047d9502f28bd25cc359365ff8fbed5", autopilot: "10be36d6cc79179bb733988ad5094a52b0f86a4d1de67ae475988108eeeb4e3a" },
  "code-quality": { plain: "3179bfcf68c6543c2b14ce804a6e42d6b948e97cc8c8fe6e2ab4cd6125d8593f", autopilot: "83ea302e71e99e3e593b12bbbe328ae9778a6c33814e885124d10fad26dd957f" },
  "drift-coherence": { plain: "abf2b1d4a9ad861bc9a28433307ab1fe578b1337da85ffbec5a4c42c07748a61", autopilot: "eefcea93a36fa9f5c9b11106be85d37a6890d9664f0d5b22966a0d3e17e8aa63" },
  "comprehension-debt": { plain: "eb98e5ef7397a86b91eb70a6145cc9cbf44c08b37969a5dec57bc3b239373832", autopilot: "7c1129b5da48cab28a60f08cdf24a8d1044725f9c08eaa7b53a22f33e4929f7b" },
  "stability-review": { plain: "d2575ead15242c8860c972d0f40ddd037477425876d721fc0da666c10c2e0fdc", autopilot: "733ec829ad2a5f2db0209bd39db734ab9617a0abefd76c77b0696c6b374d0a84" },
  "dependency-supply-chain": { plain: "2b4da10c21f7ba3a40dc41368fda58926f783a921297e4c6d37f75af086fcf46", autopilot: "50669c19f2befe2bc310387de310e46cac9606abed944ceb8a77a274e1fdf7f4" },
  "recent-headwinds": { plain: "e7eea3ca36bf09e85edf6bbd418fb9a460e9a10eb58a3bf531a8870175097aa2", autopilot: "ab65d8a17e517dfa4e639a6e9910d8df9863cedadbb4055254789dc36a1b9877" },
  "design-review": { plain: "0c481068852cfa4e72d45732c539934f722558f38c098434a711932f9bc9a4ee", autopilot: "e91d15f1de9fd3051f5071a6c60e22534a51767bd7e02e505f24191b316d443f" },
  "performance-scale": { plain: "3e89283075dce26067120574de8899daaf90b73c7ecec39d1a34b0de1a52622a", autopilot: "04f9fd2304d36aef5758b0300321d41f56c7f8c36a18602e3a6ffb7b6c316dfc" },
  "data-fetch-architecture": { plain: "40fb767037d42e00d8781d49c3fddd080857c596a68e3184ea70fc202374ba37", autopilot: "c64ddfffe858eb80d619a634450aa01490d089212c36865bc04db4f96eb3896a" },
  "integration-surface-maturity": { plain: "44f60dd848e41dd6f28f09641d0e8248d5c479d4707b702012f81541e45a6901", autopilot: "6d3b29fe7bb5a469ac338cd9d250995eb1b166011db92d5829033e47b64085f7" },
  "onboarding-journey": { plain: "74863f2733953b125940c99f4aa7e0d5673c69a8e01a6216f52e56026915baa0", autopilot: "28fb5be733fae24a8a6a432c8825873b6cdc304f8e5a7b789a33fb7f160cd351" },
  "seams-tangles": { plain: "25febdd6e3da85de1e84734c266c03feb66278a1af8744aa577dc2282e4231ab", autopilot: "65dbf14945bde06c2515a56385da55cfa2d1abbe224fa19ee23f8e42b00e91e1" },
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
