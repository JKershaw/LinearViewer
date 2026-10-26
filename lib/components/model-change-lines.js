/**
 * What a model-routing change says, in words (LIN-3952). One function for both logs: Settings › Models' recent changes
 * and Settings › Change log. It names the model by its display name (getModelDisplayName, the one name authority), a
 * job by its stage word (STAGE_LABELS for an agent job), and gives one line per job, so a grouped change reads as a
 * list of jobs, not as raw keys.
 *
 * Pure: it takes the entry's `changes` ({ scope, surface, key, field, to }) and returns strings.
 */

import { getModelDisplayName } from '../openrouter.js';
import { STAGE_LABELS, stepKindWord } from '../run-view.js';
import { SURFACES } from '../llm-jobs.js';
import { DISPATCH_HARNESS_LABELS } from '../model-routing-harnesses.js';

const FIELD_WORDS = { harness: 'harness', model: 'model', effort: 'effort' };

/** A job id in words, for a Harbour call: `plan-review` reads "Plan review". */
const idWords = (id) => {
  const words = id.replace(/-/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/**
 * A job's name in the words the pages use. An agent job takes its stage word (`STAGE_LABELS`, the one authority for
 * stage words: "Build", "Close-out"); a Harbour call has no stage word, so it reads its id in words.
 */
export function jobWords(id, surface = SURFACES.AGENT_SESSION) {
  if (surface === SURFACES.AGENT_SESSION) return STAGE_LABELS[id] || stepKindWord(id);
  return idWords(id);
}

/** A group's name in words: `make` reads "Make". */
export const groupWords = (id) => id.charAt(0).toUpperCase() + id.slice(1);

function valueWords(change) {
  if (change.to === null || change.to === undefined || change.to === '') return 'follow the group';
  if (change.field === 'model') return getModelDisplayName(change.to);
  if (change.field === 'harness') return DISPATCH_HARNESS_LABELS[change.to] || change.to;
  return String(change.to);
}

function whereWords(change) {
  if (change.scope === 'group') return `${groupWords(change.key)} group`;
  if (change.scope === 'default') return 'No job';
  return jobWords(change.key, change.surface);
}

/**
 * One line per job (or group): `Build: model → Claude Sonnet 5, effort → high`. Lines keep the order the changes came in.
 * A change whose group is unknown still reads, with its key in words, so an old entry never prints nothing.
 *
 * @param {Array<{scope: string, surface: string, key: string, field: string, to: *}>} [changes]
 * @returns {string[]}
 */
export function modelChangeLines(changes = []) {
  const byWhere = new Map();
  for (const change of changes || []) {
    const where = whereWords(change);
    if (!byWhere.has(where)) byWhere.set(where, []);
    byWhere.get(where).push(`${FIELD_WORDS[change.field] || change.field} → ${valueWords(change)}`);
  }
  return [...byWhere].map(([where, parts]) => `${where}: ${parts.join(', ')}`);
}
