#!/usr/bin/env node
/**
 * Regenerate meta-prompt.baseline.txt (Arm A) from the LIVE template.
 *
 * Run this whenever lib/prompts/meta-prompt-template.js changes, so the eval's
 * baseline stays a faithful snapshot. After shipping a proven candidate, run this
 * then `cp meta-prompt.baseline.txt meta-prompt.candidate.txt` to reset A==B.
 *
 * The snapshot is for a LEAF task (no subtasks/comments), featureFlags:{} —
 * exactly what the proxy passes — with {{ISSUE_CONTEXT}} / {{IDENTIFIER}} left as
 * placeholders the harness fills per case.
 */
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { buildMetaPromptTemplate } from '../../lib/prompts/meta-prompt-template.js';
import { formatAIHintsForMetaPrompt, getAIRecommendationActionNames } from '../../lib/prompt-templates.js';
import { formatAllSignalsForMetaPrompt } from '../../lib/completion-signals.js';

const text = buildMetaPromptTemplate({
  issueContext: '{{ISSUE_CONTEXT}}',
  identifier: '{{IDENTIFIER}}',
  hasSubtasks: false, subtaskCount: 0, completedCount: 0, inProgressCount: 0, remainingCount: 0,
  hasComments: false, commentCount: 0,
  aiHints: formatAIHintsForMetaPrompt(),
  actionVocabulary: getAIRecommendationActionNames().join(', '),
  completionSignals: formatAllSignalsForMetaPrompt(),
  focusedSubtaskId: null,
  featureFlags: {}
});

const out = join(dirname(fileURLToPath(import.meta.url)), 'meta-prompt.baseline.txt');
writeFileSync(out, text);
console.log(`wrote baseline snapshot: ${text.length} chars -> ${out}`);
