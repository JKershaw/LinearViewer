/**
 * The scope lines code adds to every stage prompt (LIN-3291, LIN-3299): `## Scope and Authority`.
 *
 * The text lives on each kind's record (lib/prompts/stage-kinds.js, LIN-4467); STAGE_INTENT is the view
 * of it, keyed by kind. Only the stages with a Scope and Authority block have an entry.
 */

import { STAGE_KINDS } from './stage-kinds.js';

/** kind -> its Scope and Authority lines, for the kinds that have any. */
export const STAGE_INTENT = Object.fromEntries(
  Object.entries(STAGE_KINDS).filter(([, record]) => record.intent).map(([kind, record]) => [kind, record.intent])
);

export function formatStageIntent(kind) {
  const lines = Object.hasOwn(STAGE_INTENT, kind) ? STAGE_INTENT[kind] : null;
  return lines ? `\n\n## Scope and Authority\n\n${lines.map(l => `- ${l}`).join('\n')}` : '';
}

/**
 * `text` with the stage's Scope and Authority at the end of its `## Goal` (after the lead,
 * before the process), or at its end when it has none. finishStagePrompt adds it here, once.
 */
export function withStageIntent(text, kind) {
  const block = formatStageIntent(kind);
  if (!block) return text;
  const goal = /^## Goal\b[^\n]*\n[\s\S]*?(?=^## |(?![\s\S]))/m.exec(text);
  if (!goal) return text + block;
  const at = goal.index + goal[0].length;
  const tail = text.slice(at);
  return `${text.slice(0, at).trimEnd()}${block}${tail ? `\n\n${tail}` : ''}`;
}
