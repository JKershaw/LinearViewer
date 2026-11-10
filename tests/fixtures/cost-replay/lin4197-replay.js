/**
 * LIN-4197 (beat 4): the baseline the records-first cutover (piece 4) is diffed against. It is the same replay
 * (`runReplay`, the LIN-4177 harness, unchanged) run over each LIN-4197 stage on its own, and over the
 * mixed-harness control, recorded into goldens-lin4197.json by `node tests/fixtures/cost-replay/record-lin4197.mjs`.
 *
 * It is a sibling of goldens.json, not an addition to it: goldens.json is the existing corpus's baseline and is
 * byte-identical after this change. A sibling keeps tests/unit/cost-read.test.js (W9, the change list over
 * goldens.json) exactly as it was.
 */
import { runReplay } from './harness.js';
import { LIN4197_CASES, LIN4197_MIXED_CONTROL, LIN4197_SOURCE_COMMIT, LIN4201_RECORDS_ONLY, buildMixedHarnessControl, lin4197StageCorpus, recordsOnlyCorpus } from './corpus.js';

export const LIN4197_GOLDENS_HEADER = {
  what: 'LIN-4197 beat 4: the read path\'s recorded baseline over the transcript corpus (each stage run on its own through runReplay), and over the mixed-harness control.',
  recordedAt: `Harbour 72305215 (main), recorded on feat/lin-4197-cost-corpus with the beat 3 corpus and the beat 4 fixture changes; no production code differs from 72305215. Corpus data copied from simple-dispatcher ${LIN4197_SOURCE_COMMIT}.`,
  baseline: 'Recorded BEFORE any read change. Piece 4 (the records-first cutover) must be diffed against these values; each case note says where the read path differs from its oracle, and those differences are the baseline, not defects to fix here.',
  mustNotBeRegenerated: 'Do not regenerate or edit this file to make a later production change pass. A change to any value here is a reviewed change to this baseline, with the reason stated. LIN-4404 (reviewed amendment, re-recorded with record-lin4197.mjs and diffed against the previous file): /cost/:identifier (S1) reads a task\'s whole life, not the 30-day reporting window (the task-life rule, lib/read-horizon.js, ruled on LIN-4395). Exactly these values moved, and nothing else: (1) every S1 body\'s window, in every section, from { days: 30, appCallsSince: <30 days before the replay clock> } to { days: null, appCallsSince: null, scope: \'task-life\' }; (2) existingCorpusAtHead S1 only: the straddlers now read their founders older than 30 days. LIN-8 so (corpus case 7) is complete and priced at 1.1 (0.7 founder delta + 0.4), so its costUsd, pricedUsd and totalUsd move from null/0/null to 1.1; so (case 7), nss (case 16), cg (case 17) and LIN-42 st (case 4) take their founder\'s dispatchedAt as the session\'s; LIN-42\'s appCalls gain call c5 (proxy-x, $0.90, 60 days old) and its totalUsd gains 0.90. S2 to S13 (the reporting windows) and the over-cap filler cases 20-21 do not move.',
  recordsOnlyAddition: 'LIN-4201 added one section, recordsOnly (change list item (e)): a lineage killed before its first Stop, so it has request records and NO [usage] snapshot. It was recorded at Harbour eb44eff9 (main, the read path before LIN-4201), so its values are the before. Every other section is byte-identical to the LIN-4197 recording.',
  fields: 'recordsOnly: runReplay output over that lineage, its summary and oracle (as a case). existingCorpusAtHead: runReplay over the existing corpus at this commit (the same output goldens.json holds, re-run here; goldens.json itself is the LIN-4177 baseline and is not re-recorded). replay: runReplay output over the stage (S1 to S13, mixedHarness). summary.readRunPageUsd: S13 cost for the stage\'s lineage (null when withheld). summary.readModelsSpendUsd / readModelsUnpriced: S5 for the implementation job (priced spend, and the count of unpriced runs). oracleUsd: the LIN-4197 beat 1 oracle (each record priced alone with computeUsageCostUsd, shared ids once). differenceUsd: readRunPageUsd minus oracleUsd (null when the read withholds the figure).',
};

/** Per-case notes: where today\'s read path departs from the oracle, and by how much. Written from the recorded values. */
export const LIN4197_NOTES = {
  'haiku-over-100k/final': 'Run page null (withheld); Models $0 spend with 1 unpriced run. Oracle $0.0255 over 3 requests (1 below and 2 above the 100k tier). Cause: the claude-code snapshot is a running total past the 100k tier, which computeUsageCostUsd prices to null. Difference: null vs $0.0255.',
  'killed-before-stop/final': 'Matches the oracle ($0.0381, 2 requests) on the run page and in Models. The truncated last line is skipped. The gap is upstream of the read: nothing is posted for a session killed before its first Stop.',
  'mixed-model/final': 'Run page null (withheld); Models $0 spend with 1 unpriced run. Oracle $0.31726 over 4 requests across opus, sonnet and haiku. Cause: the snapshot is priced as one running total, which crosses the 100k tier, so it is null. The model label is also the last model (claude-haiku-5-5), not the cost-dominant claude-opus-5. Difference: null vs $0.31726.',
  'reap-tail/atStop': 'Matches the oracle ($0.0236, 2 requests). The final text-only turn is not on disk at Stop, so it is absent here.',
  'reap-tail/atReap': 'Matches the oracle ($0.0317, 3 requests) on the transcript that holds the final turn. Nothing posts at reap today, so in production this figure never reaches the read.',
  'resumed-across-deploy/earlier': 'Matches the oracle ($0.02285, 2 requests).',
  'resumed-across-deploy/later': 'Matches the oracle ($0.03945, 4 requests). The snapshot is one running total, so the earlier requests are counted once.',
  'subagent-shared-message/final': 'Run page and Models both $0.0563 against oracle $0.0752: difference -$0.0189. The snapshot reads the main transcript only, so the two subagent-only requests are missing, and the shared request is at its main-copy output (50, not 120). This is not a double count.',
  'synthetic-tail/final': 'Run page null (withheld); Models $0 spend with 1 unpriced run. Oracle $0.0207 over 2 requests. Cause: the snapshot\'s last model is <synthetic>, which has no rate, so the whole figure is null.',
  'records-only': 'LIN-4201 (e): the killed-before-stop transcript\'s records with no [usage] snapshot (nothing posts before the first Stop). Before the cutover the read has nothing to read: no-telemetry on every surface, run page not reported. Oracle $0.0381 (the killed-before-stop stage\'s).',
  'mixed-harness-control': 'mh-sonnet: a Sonnet claude-code snapshot (no tier) and an opencode delta ($0.25) are both priced and summed: $0.28945, equal to the oracle. mh-haiku: the claude-code side is Haiku over 100k, so its snapshot is unpriced and the whole lineage is withheld, including the $0.25 opencode delta. Run page null and pricedUsd 0; oracle $0.2755 (0.0255 + 0.25). The request records are not read by the current read path (no store serves them), so the claude-code side is the snapshot. Both lineages are listed as mixed in the window tally.',
};

/** The three figures a case is compared on: the run page, the Models read, and the oracle. */
function summaryOf(replay, oracleUsd) {
  const step = replay.S13.steps[0];
  const impl = replay.S5.jobs.find((j) => j.id === 'implementation');
  const readRunPageUsd = step ? step.cost.usd : null;
  return {
    readRunPageUsd,
    readModelsSpendUsd: impl ? impl.spendUsd : null,
    readModelsUnpriced: impl ? impl.unpriced : null,
    oracleUsd,
    differenceUsd: readRunPageUsd === null ? null : Number((readRunPageUsd - oracleUsd).toFixed(10)),
  };
}

/**
 * Run the LIN-4197 stages, the records-only lineage and the mixed-harness control through the replay, and return the
 * sibling golden body. `readRecords` (LIN-4201) serves each corpus's request records to the read; the golden is the
 * recording without it (the before), and the LIN-4201 change list is the diff between the two.
 */
export async function recordLin4197({ readRecords = false } = {}) {
  const options = { readRecords };
  const existingCorpusAtHead = await runReplay(undefined, options);
  const cases = {};
  for (const key of Object.keys(LIN4197_CASES)) {
    const replay = await runReplay(lin4197StageCorpus(key), options);
    const oracleUsd = LIN4197_CASES[key].oracleUsd;
    cases[key] = { note: LIN4197_NOTES[key] ?? '', oracleUsd, summary: summaryOf(replay, oracleUsd), replay };
  }

  const recordsOnlyReplay = await runReplay(recordsOnlyCorpus(), options);
  const recordsOnly = { note: LIN4197_NOTES['records-only'], oracleUsd: LIN4201_RECORDS_ONLY.oracleUsd, summary: summaryOf(recordsOnlyReplay, LIN4201_RECORDS_ONLY.oracleUsd), replay: recordsOnlyReplay };

  const control = buildMixedHarnessControl();
  const controlReplay = await runReplay(control, options);
  const lineages = {};
  for (const [root, oracle] of Object.entries(LIN4197_MIXED_CONTROL)) {
    const step = controlReplay.S13.steps.find((s) => s.lineageId === root);
    const readRunPageUsd = step ? step.cost.usd : null;
    lineages[root] = { ...oracle, readRunPageUsd, differenceUsd: readRunPageUsd === null ? null : Number((readRunPageUsd - oracle.oracleUsd).toFixed(10)) };
  }
  return { existingCorpusAtHead, cases, recordsOnly, mixedHarnessControl: { note: LIN4197_NOTES['mixed-harness-control'] ?? '', lineages, replay: controlReplay } };
}
