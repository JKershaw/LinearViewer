/**
 * The public prompt catalogue, rendered from the stage-kind records (LIN-4467): the section of public/llms.txt
 * that lists every prompt template, its group and its one-line catalogue wording. The wording is each record's
 * `catalogue` (lib/prompts/stage-kinds.js), kept apart from the template description, which dispatch and
 * /templates read.
 *
 * scripts/gen-llms-catalogue.mjs writes this into public/llms.txt; tests/unit/lin-4467-stage-kind-record.test.js
 * checks the file carries it byte for byte, so a hand-edited bullet fails.
 */
import { STAGE_KINDS } from './stage-kinds.js';

export const CATALOGUE_HEADING = '### Available Prompt Templates';
export const CATALOGUE_NEXT_HEADING = '### Public Templates Page';

const GROUPS = [
  ['default', '**Default Prompts** (shown for every issue, including completed/canceled):'],
  ['more', '**More Prompts** (behind "more" toggle):']
];

/** The whole catalogue section, heading to the blank line before the next heading. */
export function renderPromptCatalogue() {
  const kinds = Object.entries(STAGE_KINDS);
  const groups = GROUPS.map(([group, intro]) => {
    const bullets = kinds
      .filter(([, record]) => record.catalogue.group === group)
      .map(([kind, record]) => `- \`${kind}\` - ${record.catalogue.line}`);
    return `${intro}\n${bullets.join('\n')}\n`;
  });
  return `${CATALOGUE_HEADING} (${kinds.length} total)\n\n${groups.join('\n')}\n`;
}
