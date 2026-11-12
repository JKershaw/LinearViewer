// dispatch-legs.mjs — LIN-4426. The one home of the dispatch-mode rules, shared by freeze.mjs (which refuses a
// dispatch it cannot classify) and analyse.mjs (which classifies). Pure: no network, no git. The one file read is
// the inputs file, in takeTaskSizeInputs.
//
// Classification of one /cost dispatch, in this order (classifyDispatch):
//   1. a custom dispatch whose first prompt line is an after-answer (AFTER_RE)  → survey
//   2. a survey-* kind                                                           → survey
//   3. any other custom dispatch                                                 → its lineage's leg
//   4. every other kind                                                          → lib/wall-clock-summary.js BUCKET_OF_KIND
// `custom` is itself a key of BUCKET_OF_KIND (→ orchestration), so a custom dispatch must be routed in step 3, before
// step 4. A kind missing from BUCKET_OF_KIND throws (bucketOfKind): bucketOf() would fall back to orchestration silently.

import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUCKET_OF_KIND, bucketOf } from '../../../../lib/wall-clock-summary.js';
import { takeInputs } from '../cleaner-than-it-started-scripts/inputs.mjs';

export const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_INPUTS = path.join(SCRIPT_DIR, 'inputs-v1.json');

// Survey after-answers: the Opus custom follow-up the Survey resumes into a build session. Defined once, here.
export const AFTER_RE = /^(A short, read-only follow-up for research \(the Survey|One more short, read-only follow-up for the same research)/;
// A custom first line that says "read-only follow-up" but misses AFTER_RE has drifted wording: the freeze refuses it.
export const DRIFT_RE = /read-only follow-up/i;

// A custom-founded lineage's coding (inputs.custom_founded_legs, keyed by rootItemId) names a leg; each leg fills a bucket.
export const CODED_LEGS = ['floor', 'work', 'keepAlive', 'survey'];
const CODED_BUCKET = { floor: 'before', work: 'diff', keepAlive: 'orchestration', survey: 'survey' };

export const isSurveyKind = (kind) => kind.startsWith('survey-');
export const firstLineOf = (prompt) => String(prompt ?? '').split('\n').find((l) => l.trim()) ?? '';
export const isAfterAnswer = (firstLine) => AFTER_RE.test(firstLine);

// The bucket of a non-custom kind. A kind the shared mapping does not name throws.
export function bucketOfKind(kind) {
  if (!Object.hasOwn(BUCKET_OF_KIND, kind)) {
    throw new Error(`kind "${kind}" is missing from BUCKET_OF_KIND (lib/wall-clock-summary.js): bucketOf would count it as orchestration silently`);
  }
  return bucketOf(kind);
}

// The bucket a lineage (one workerSessions entry) gives its own cost, and the bucket a custom dispatch in it inherits.
// A custom-founded lineage (kind "custom", which is also what a kindless lineage reads as) has no kind to map, so it
// takes its leg from the inputs coding; an uncoded one throws.
export function lineageBucketOf(w, coding) {
  if (w.kind === 'custom') {
    const coded = coding?.[w.rootItemId];
    if (coded === undefined) throw new Error(`custom-founded lineage ${w.rootItemId} has no leg in the inputs (custom_founded_legs): refusing to guess one`);
    if (!CODED_LEGS.includes(coded)) throw new Error(`custom_founded_legs[${w.rootItemId}] is "${coded}"; it must be one of ${CODED_LEGS.join(', ')}`);
    return CODED_BUCKET[coded];
  }
  if (isSurveyKind(w.kind)) return 'survey';
  return bucketOfKind(w.kind);
}

// The bucket of one /cost dispatch. `firstLine` is the first line of its prompt, read for custom dispatches only.
export function classifyDispatch({ kind, firstLine, lineageBucket }) {
  if (kind === 'custom') {
    if (firstLine === undefined) throw new Error('a custom dispatch needs its prompt first line to classify');
    return isAfterAnswer(firstLine) ? 'survey' : lineageBucket;
  }
  if (isSurveyKind(kind)) return 'survey';
  return bucketOfKind(kind);
}

// freeze's check on one custom prompt: drifted after-answer wording throws. Anything else passes.
export function checkAfterWording(firstLine, label) {
  if (DRIFT_RE.test(firstLine) && !AFTER_RE.test(firstLine)) {
    throw new Error(`${label}: the first line says "read-only follow-up" but misses AFTER_RE: ${JSON.stringify(firstLine.slice(0, 120))}. The after-answer wording drifted; update AFTER_RE on purpose or refuse the freeze.`);
  }
}

// The inputs policy (LIN-4426). `--inputs <file>` is read through the sibling's takeInputs. Without the flag, the v1
// inputs beside these scripts are the default, but only where the target folder holds no inputs.json of its own: a folder
// that has one must name its inputs, so the default cannot silently govern another version's folder. The sibling's
// takeInputs exits without the flag; this wrapper supplies the default before that call, and the reason is recorded here
// because the sibling's header says the opposite.
export function takeTaskSizeInputs(argv, usage, targetDirs) {
  if (argv.includes('--inputs')) return takeInputs(argv, usage);
  for (const dir of targetDirs) {
    const own = path.join(dir, 'inputs.json');
    if (existsSync(own)) {
      throw new Error(`refusing the implicit default inputs: ${own} exists. Name its inputs: --inputs ${own}`);
    }
  }
  return takeInputs([...argv, '--inputs', DEFAULT_INPUTS], usage);
}
