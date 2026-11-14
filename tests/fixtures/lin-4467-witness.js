/**
 * LIN-4467 witness: what every stage kind renders, and what the per-kind tables say. Renders are hashes; the tables are
 * their text (LIN-4470), so a change to one shows in the fixture's diff.
 *
 * Captured at HEAD before the one-record refactor, and compared after it (tests/unit/lin-4467-stage-kind-witness.test.js).
 * Kept since as a permanent ratchet (LIN-4469): it is the identity pin on real-context renders, which the budget's
 * caps (tests/unit/prompt-size-budget.test.js, context-free fixture) are not.
 * Renders use REAL context: a ticket with a parent, siblings, children, a project, comments that carry a PR, a
 * leftover and an attachment, not the context-free budget fixture (LIN-4393). Each kind renders twice: a fresh
 * start, and a fix round whose latest review requested changes (the revision section and the fix-round workflow).
 *
 * Regenerate with: node tests/fixtures/lin-4467-witness.js --write
 * (it rewrites tests/fixtures/lin-4467-witness.json; a deliberate change to a rendered text or table is written
 * here in the same PR, and says so there.)
 */
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const sha = (s) => createHash('sha256').update(s).digest('hex');
const at = (day) => `2026-11-${String(day).padStart(2, '0')}T10:00:00.000Z`;
const PR = 'https://github.com/JKershaw/LinearViewer/pull/2400';

const comment = (id, day, body) => ({ id, body, createdAt: at(day), user: { name: 'Ada' } });

const ISSUE = {
  id: 'LIN-900',
  identifier: 'LIN-900',
  title: 'Witness ticket for the stage-kind record',
  description: '## As asked\n\nWitness ask: every stage renders the same text it did.\n\n## Size of the move\n\n**Size:** just the task\n**Why:** one piece.\n**Cuts:** none\n**Decided by:** the standing policy\n\n## Implementation Plan\n\nWitness plan.\n\nfits one session\n\nplan-review due: no\n',
  url: 'https://linear.app/witness/issue/LIN-900',
  state: { name: 'In Progress', type: 'started' },
  labels: ['Bug', 'Area: prompts'],
  priority: 2,
  priorityLabel: 'High',
  assignee: { name: 'Ada' },
  createdAt: at(1),
  estimate: null,
  project: { name: 'Witness project' }
};

const PARENT = { identifier: 'LIN-899', title: 'Witness parent', state: { name: 'In Progress' }, description: 'Parent description.' };

const FRESH_COMMENTS = [
  comment('c1', 2, `Implementation: ${PR}`),
  comment('c2', 3, '### Leftovers\nNothing left.\nRetires: none'),
  comment('c3', 4, 'Context note from a person.')
];

const REVIEW_REQUESTS_CHANGES = comment('r1', 5, [
  '## Review — LIN-900',
  '',
  `Reviewed ${PR} at head \`abc1234\`.`,
  '',
  'CI: green',
  '',
  '### What CI Did Not Prove',
  '',
  'CI covers the deliverable; ledger empty',
  '',
  '### Verdict',
  '',
  'Request Changes',
  '',
  '1. The fix round must keep the leftover step.'
].join('\n'));

const contextFor = (comments) => ({
  parent: PARENT,
  siblings: [{ identifier: 'LIN-901', title: 'Witness sibling', state: { name: 'Todo' } }],
  children: [],
  project: { name: 'Witness project' },
  comments,
  attachments: [{ id: 'att:1', title: 'Witness spec', kind: 'file', contentType: 'text/markdown' }]
});

export const MODES = {
  fresh: contextFor(FRESH_COMMENTS),
  fix: contextFor([...FRESH_COMMENTS, REVIEW_REQUESTS_CHANGES])
};

/** Sorted-key JSON, so a reordered object literal does not move the hash. */
export function canonical(value) {
  if (typeof value === 'function') return `fn:${value.name}`;
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value === undefined ? '__undefined__' : value);
}

/**
 * The same content as canonical(), one key per line, so the fixture's diff shows what changed in a table (LIN-4470).
 * A hash only says that a table changed; the test names the table either way, but the fixture now holds the text.
 */
export function shown(value) {
  const plain = (v) => {
    if (typeof v === 'function') return `fn:${v.name}`;
    if (Array.isArray(v)) return v.map(plain);
    if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map(k => [k, plain(v[k])]));
    return v === undefined ? '__undefined__' : v;
  };
  return JSON.stringify(plain(value), null, 2);
}

/** The shown text as an array of lines, so each line of a table is one line of the fixture's diff (LIN-4470). */
const lines = (value) => shown(value).split('\n');

/** Captures every hash the witness pins. Async-free and network-free. */
export async function captureWitness() {
  const { PROMPT_TEMPLATES, generatePrompt } = await import('../../lib/prompt-templates.js');
  const { STAGE_LEADS } = await import('../../lib/prompt-template-defs.js');
  const { COMPLETION_SIGNALS } = await import('../../lib/completion-signals.js');
  const { STAGE_INTENT } = await import('../../lib/prompts/stage-intent.js');
  const { GROUNDING_BY_KIND } = await import('../../lib/prompt-formatters.js');
  const { STAGE_LABELS, stageLabel, stepKindWord } = await import('../../lib/run-view.js');
  const { formatStageContract } = await import('../../lib/prompt-contract.js');
  const { buildInstructions } = await import('../../lib/proxy-instructions.js');

  const kinds = Object.keys(PROMPT_TEMPLATES);
  const renders = {};
  for (const kind of kinds) {
    for (const [mode, context] of Object.entries(MODES)) {
      const out = generatePrompt(kind, ISSUE, context);
      renders[`${kind}:${mode}`] = { name: out.name, bytes: Buffer.byteLength(out.prompt), sha256: sha(out.prompt) };
    }
  }

  const tables = {
    COMPLETION_SIGNALS: lines(COMPLETION_SIGNALS),
    STAGE_INTENT: lines(STAGE_INTENT),
    GROUNDING_BY_KIND: lines(GROUNDING_BY_KIND),
    STAGE_LEADS: lines(STAGE_LEADS),
    STAGE_LABELS: lines(STAGE_LABELS),
    TEMPLATE_TRAITS: lines(Object.fromEntries(kinds.map(k => {
      const t = PROMPT_TEMPLATES[k];
      return [k, { name: t.name, category: t.category, description: t.description, route: t.route, writes: t.writes }];
    }))),
    TEMPLATE_KEYS: lines(kinds)
  };
  const labels = Object.fromEntries(kinds.map(k => [k, stageLabel(k)]));
  for (const k of ['leftover', 'autopilot', 'wake', 'periodical', 'custom', 'defer']) labels[`extra:${k}`] = stageLabel(k);
  const contracts = Object.fromEntries(kinds.map(k => [k, formatStageContract(k, 'LIN-900', { write: true })]));
  const override = buildInstructions({ baseUrl: 'https://h', scope: 'readWrite' });

  return {
    renders,
    tables,
    stageLabels: sha(canonical(labels)),
    contracts: sha(canonical(contracts)),
    stepWords: sha(canonical(Object.fromEntries(kinds.map(k => [k, stepKindWord(k)])))),
    overrideLine: sha(override.match(/VERB OVERRIDE[^\n]*/)?.[0] ?? 'missing')
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv.includes('--write')) {
  const witness = await captureWitness();
  writeFileSync(fileURLToPath(new URL('./lin-4467-witness.json', import.meta.url)), JSON.stringify(witness, null, 2) + '\n');
  console.log(`wrote ${Object.keys(witness.renders).length} renders`);
}
