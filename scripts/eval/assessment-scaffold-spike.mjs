#!/usr/bin/env node
/**
 * Assessment-scaffold spike — does broadening the Reasoning self-assessment lift
 * the under-served routing types without denting the common implement-funnel flow?
 *
 * HYPOTHESIS. The meta-prompt's `## Reasoning` block asks the model to fill three
 * bullets — Preparation / Blockers / Ready — which mirror decision-tree Steps 1–3
 * (the implement funnel). It has no slot for Step 0 (already-complete → `review`)
 * or Step 4 (node → `defer`/`breakdown`), nor for the vague→`triage`/`look into`
 * fallback. Structured CoT shapes the reasoning, not just records it, so the
 * scaffold may bias toward funnel outcomes and under-select `review`/`triage`.
 *
 * METHOD. Build the prompt from the LIVE template per case (always faithful — no
 * stale snapshot), then swap ONLY the three-bullet Assessment block per arm so the
 * rest of the prompt stays byte-identical and any delta is attributable to the
 * scaffold. Grade the `→ **action**` line deterministically (no LLM judge).
 *
 *   baseline          the current 3 bullets (control)
 *   disposition       prepend one branch-naming line before the 3 bullets
 *   broadened         add Completion + Shape bullets (full-tree framing)
 *   completion-first  minimal: add only a leading Completion bullet
 *
 * Leaf scope (same boundary as eval-research-routing.mjs / LIN-327): `defer` is a
 * node action and is NOT exercised here. The under-served types we CAN reach at a
 * leaf are `review` (terminal-Done leaf, and landed-but-In-Progress leaf) and
 * `triage`/`look into` (vague leaf). Those are the lift we measure; the guard cases
 * are the regression we must not cause.
 *
 * Usage:
 *   OPENROUTER_API_KEY=... node scripts/eval/assessment-scaffold-spike.mjs
 *
 * Env knobs:
 *   MODEL       model under test       (default openai/gpt-5.4-mini — the prod default)
 *   K           runs per arm per case  (default 3; temp 0, so variance is low)
 *   ARMS        comma list of arm ids  (default all four)
 *   ONLY        substring case filter  (e.g. ONLY=review)
 *   MAX_TOKENS  output cap             (default 600 — only need through the action line)
 *   OUT_DIR     output dir override    (default scripts/eval/assessment-scaffold-out)
 */
import 'dotenv/config';
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { buildMetaPromptTemplate } from '../../lib/prompts/meta-prompt-template.js';
import { formatAIHintsForMetaPrompt, getAIRecommendationActionNames } from '../../lib/prompt-templates.js';
import { formatAllSignalsForMetaPrompt } from '../../lib/completion-signals.js';
import { formatIssueContext } from '../../lib/openrouter.js';
import { isTerminalState } from '../../lib/tree.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const KEY = process.env.OPENROUTER_API_KEY;
if (!KEY) { console.error('Set OPENROUTER_API_KEY (env or .env)'); process.exit(1); }
const MODEL = process.env.MODEL || 'openai/gpt-5.4-mini';
const K = Number(process.env.K) || 3;
const ONLY = process.env.ONLY;
const MAX_TOKENS = Number(process.env.MAX_TOKENS) || 600;
const OUT_DIR = process.env.OUT_DIR || join(HERE, 'assessment-scaffold-out');

const AI_HINTS = formatAIHintsForMetaPrompt();
const VOCAB = getAIRecommendationActionNames().join(', ');
const SIGNALS = formatAllSignalsForMetaPrompt();

// ---- the scaffold arms: each replaces the 3-bullet block in the live template ----
// The exact baseline block, copied verbatim from buildMetaPromptTemplate's output.
// We assert it is present in every built prompt, so template drift fails loudly
// instead of silently testing four identical arms.
const BASELINE_BULLETS =
  '- Preparation: <✓ Complete | ✓ Not needed | ✗ Needed> - <brief reason, mention comments if relevant>\n' +
  '- Blockers: <✓ None | ✗ Blocked> - <brief reason>\n' +
  '- Ready: <✓ Yes | ✗ No> - <brief reason>';

const ARMS = {
  baseline: BASELINE_BULLETS,

  // One line that forces the model to name which decision-tree branch the task is
  // in BEFORE the funnel bullets — giving review/node/triage a first-class slot
  // without disturbing the common flow that follows.
  disposition:
    '- Disposition: <complete (→ review) | node (→ defer/breakdown) | blocked/bug | needs-prep (→ research/triage) | ready> - <which decision-tree branch this task falls into, and why>\n' +
    BASELINE_BULLETS,

  // Full-tree framing: Completion (Step 0/3-landed) and Shape (Step 4) become
  // explicit bullets alongside the funnel.
  broadened:
    '- Completion: <✓ work already landed or state terminal | ◐ in progress | ✗ not started> - <evidence; if landed/terminal, route review — do not restart finished work>\n' +
    '- Shape: <leaf | node: descend to a child or decompose> - <brief>\n' +
    BASELINE_BULLETS,

  // Minimal broadening: surface only "is this already done?" — isolates whether a
  // single completion slot is enough to recover review recall.
  'completion-first':
    '- Completion: <✓ already landed or terminal | ✗ not yet> - <evidence; if landed/terminal, recommend review>\n' +
    BASELINE_BULLETS
};

const armIds = (process.env.ARMS ? process.env.ARMS.split(',').map(s => s.trim()) : Object.keys(ARMS))
  .filter(a => ARMS[a]);

// ---- cases. Each: id, bucket, accept set, and a leaf issue (+ optional state). ----
// bucket drives which recall/guard metric the case feeds.
const inProgress = { name: 'In Progress', type: 'started' };
const todo = { name: 'Todo', type: 'unstarted' };
const done = { name: 'Done', type: 'completed' };

const CASES = [
  // ---- UNDER-SERVED: review (terminal leaf) ----
  {
    id: 'review: terminal Done leaf', bucket: 'review', expect: ['review'],
    why: 'State is terminal (Done), no open children — Step 0 routes to review/close, never a fresh look-into/implement.',
    issue: {
      identifier: 'SYN-20', createdAt: '2026-05-20T00:00:00Z', state: done, labels: [],
      title: 'Add a --json flag to the CLI viewer command',
      description: 'Add a --json flag to the viewer command that emits JSON.stringify of the user object. Implemented in lib/linear-cli.js; unit test added asserting the JSON shape. Marked Done.'
    }
  },
  // ---- UNDER-SERVED: review (landed but still In Progress) ----
  {
    id: 'review: landed but still In Progress', bucket: 'review', expect: ['review'],
    why: 'Completion evidence recorded (committed, PR merged, tests pass) on an open leaf — Step 3 landed-branch routes to review, not another implement pass.',
    issue: {
      identifier: 'SYN-21', createdAt: '2026-05-28T00:00:00Z', state: inProgress, labels: [],
      title: 'Cache /recommend responses to cut latency',
      description: `## Status
Implemented: added a recap-style cache keyed by issue id + updatedAt, 10-min TTL, in lib/openrouter.js. Committed in PR #214 (merged). Unit tests for cache hit/miss/expiry pass; e2e latency check confirms the win. Summary comment recorded. Left In Progress only because the column wasn't moved.`
    }
  },
  // ---- UNDER-SERVED: triage / look into (vague leaf) ----
  {
    id: 'triage: vague empty intent', bucket: 'triage', expect: ['triage', 'look into', 'research', 'scoping'],
    why: 'Too thin to know the intent — needs preparation/scoping, not a guessed implementation.',
    issue: {
      identifier: 'SYN-22', createdAt: '2026-06-01T00:00:00Z', state: todo, labels: [],
      title: 'Improve dashboard performance', description: ''
    }
  },
  {
    id: 'triage: one-liner no scope', bucket: 'triage', expect: ['triage', 'look into', 'research', 'scoping'],
    why: 'A title with no description or acceptance criteria — intent unknown, needs scoping before any work.',
    issue: {
      identifier: 'SYN-23', createdAt: '2026-06-01T00:00:00Z', state: todo, labels: [],
      title: 'Rework the settings page', description: ''
    }
  },

  // ---- GUARD: research recall (must stay high) ----
  {
    id: 'guard research: external unpinned API', bucket: 'guard-research', expect: ['research', 'spike'],
    why: 'Depends on an external API whose contract is not pinned — substance must be gathered.',
    issue: {
      identifier: 'SYN-2', createdAt: '2026-06-01T00:00:00Z', state: todo, labels: [],
      title: 'Sync paid invoices from the Acme billing service into Linear',
      description: 'When an invoice is marked paid in Acme, reflect it on the corresponding Linear issue. Use the Acme billing API.'
    }
  },

  // ---- GUARD: common path (implement/plan/blocked/bug/breakdown) ----
  {
    id: 'guard implement: trivial typo', bucket: 'guard-common', expect: ['implement'],
    why: 'Obvious, tiny, no unknowns. Research/review here would be over-firing.',
    issue: {
      identifier: 'SYN-7', createdAt: '2026-06-01T00:00:00Z', state: todo, labels: [],
      title: 'Fix typo in footer: "Copyrght" -> "Copyright"',
      description: 'The footer in lib/components/footer.js renders "Copyrght". Fix the spelling.'
    }
  },
  {
    id: 'guard implement: plan documented, fits one session', bucket: 'guard-common', expect: ['implement'],
    why: 'Complete plan in description, commits to one session — implement, not review/plan.',
    issue: {
      identifier: 'SYN-8', createdAt: '2026-06-01T00:00:00Z', state: inProgress, labels: [],
      title: 'Add a --json flag to the CLI viewer command',
      description: `## Plan
- Files to modify: lib/linear-cli.js (the 'viewer' command handler).
- Change: when argv includes --json, JSON.stringify the user object instead of pretty-printing.
- Edge: --json with no other args; unknown user (null) -> print {}.
- Testing: add a unit test asserting JSON output shape.
## Scope
Single surface. Fits one session.`
    }
  },
  {
    id: 'guard plan: multi-surface, no plan', bucket: 'guard-common', expect: ['plan'],
    why: 'Clear approach but spans surfaces with no documented plan.',
    issue: {
      identifier: 'SYN-5', createdAt: '2026-06-01T00:00:00Z', state: todo, labels: [],
      title: 'Add pagination to the issues list (API + UI)',
      description: 'The issues list returns everything at once. Add page-based pagination to GET /issues and prev/next controls to the issues list UI. Keep existing default behavior when no page param is passed.'
    }
  },
  {
    id: 'guard blocked', bucket: 'guard-common', expect: ['blocked'],
    why: 'Blocked label + active external dependency.',
    issue: {
      identifier: 'SYN-10', createdAt: '2026-06-01T00:00:00Z', state: inProgress, labels: ['blocked'],
      title: 'Wire the new billing webhook into the dispatch queue',
      description: 'Blocked: waiting on the platform team to provision the webhook secret (tracked in SYN-200). Cannot proceed until that lands.'
    }
  },
  {
    id: 'guard bug', bucket: 'guard-common', expect: ['bug'],
    why: 'Bug label + unexpected behavior, no prior investigation in evidence.',
    issue: {
      identifier: 'SYN-11', createdAt: '2026-06-01T00:00:00Z', state: inProgress, labels: ['bug'],
      title: 'Dispatch button intermittently returns 500',
      description: 'Roughly 1 in 10 dispatch clicks returns a 500 and the item is not queued. No clear pattern. Logs show a truncated TypeError.'
    }
  },
  {
    id: 'guard breakdown: plan says needs multiple sessions', bucket: 'guard-common', expect: ['breakdown'],
    why: 'Complete plan that explicitly needs multiple sessions.',
    issue: {
      identifier: 'SYN-12', createdAt: '2026-06-01T00:00:00Z', state: inProgress, labels: [],
      title: 'Migrate session storage from file-based MangoDB to MongoDB',
      description: `## Plan
Surfaces: session-store.js, server.js (store wiring), user-preferences.js (shares the store), a data migration step, and a rollback path.
Arrows: server wiring depends on the store rewrite; migration depends on both.
## Scope
Needs multiple sessions — migration + rollback alone is its own focused pass; the three call sites each carry distinct edges.`
    }
  },
  {
    id: 'guard breakdown: plan spans many surfaces, multi-session', bucket: 'guard-common', expect: ['breakdown'],
    why: 'Complete plan, explicitly multi-session — the node/decompose branch the funnel has no slot for.',
    issue: {
      identifier: 'SYN-24', createdAt: '2026-06-01T00:00:00Z', state: inProgress, labels: [],
      title: 'Replace the bespoke auth layer with the shared provider abstraction',
      description: `## Plan
Surfaces: routes/auth.js, lib/providers/registry.js, the session store wiring, every call site reading req.session.token (12+), and a backfill for existing sessions.
Arrows: registry wiring blocks the call-site migration; backfill blocks cutover.
## Scope
Needs multiple sessions — the call-site sweep alone is a focused pass, and the backfill carries its own rollback risk.`
    }
  }
];

// ---- prompt assembly: live template per case, then swap the Assessment block ----
function renderContext(issue) {
  const L = [];
  L.push(`**Issue:** ${issue.identifier} - ${issue.title}`);
  L.push(`**State:** ${issue.state.name} (${issue.state.type})`);
  if (issue.createdAt) L.push(`**Created:** ${issue.createdAt}`);
  if (issue.description) L.push(`**Description:** ${issue.description}`);
  if (issue.labels?.length) L.push(`**Labels:** ${issue.labels.join(', ')}`);
  L.push('**Project:** Product');
  return L.join('\n');
}

// Synthetic leaf case → base prompt (no children/comments, like the proxy default).
function basePromptForSynthetic(issue) {
  return buildMetaPromptTemplate({
    issueContext: renderContext(issue),
    identifier: issue.identifier,
    hasSubtasks: false, subtaskCount: 0, completedCount: 0, inProgressCount: 0, remainingCount: 0,
    hasComments: false, commentCount: 0,
    aiHints: AI_HINTS, actionVocabulary: VOCAB, completionSignals: SIGNALS,
    focusedSubtaskId: null,
    isTerminal: isTerminalState(issue.state?.type),
    hasOpenChildren: false,
    featureFlags: {}
  });
}

// Real proxy bundle → base prompt, mirroring lib/openrouter.js buildMetaPrompt exactly
// (full-size context: real description, comments, children, focusedChild). This is what
// makes the REAL run a faithful, large-prompt comparison against the synthetic one.
function basePromptForBundle(b) {
  const { issue, focusedChild } = b;
  const children = b.children || [];
  const comments = b.comments || [];
  const completedCount = children.filter(c => isTerminalState(c.state?.type)).length;
  const inProgressCount = children.filter(c => c.state?.type === 'started').length;
  const remainingCount = children.length - completedCount;
  return buildMetaPromptTemplate({
    issueContext: formatIssueContext(issue, b),
    identifier: issue.identifier,
    hasSubtasks: children.length > 0,
    subtaskCount: children.length,
    completedCount, inProgressCount, remainingCount,
    hasComments: comments.length > 0,
    commentCount: comments.length,
    aiHints: AI_HINTS, actionVocabulary: VOCAB, completionSignals: SIGNALS,
    focusedSubtaskId: focusedChild?.issue?.identifier || null,
    isTerminal: isTerminalState(issue.state?.type),
    hasOpenChildren: remainingCount > 0,
    featureFlags: {}
  });
}

function promptFor(arm, c) {
  const base = c.bundle ? basePromptForBundle(c.bundle) : basePromptForSynthetic(c.issue);
  if (!base.includes(BASELINE_BULLETS)) {
    throw new Error(`Assessment block drifted in live template — update BASELINE_BULLETS (case ${c.id})`);
  }
  return base.replace(BASELINE_BULLETS, ARMS[arm]);
}

// ---- LLM call (temp 0, retries on 429/5xx) ----
const norm = s => (s || '').toLowerCase().trim();
let lastErr = '';
async function call(prompt) {
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) await new Promise(r => setTimeout(r, 1000 * 2 ** (attempt - 1)));
    try {
      const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: MODEL, temperature: 0, max_tokens: MAX_TOKENS, messages: [{ role: 'user', content: prompt }] })
      });
      if (r.status === 429 || r.status >= 500) { lastErr = `HTTP ${r.status}`; continue; }
      const j = await r.json();
      if (j.choices?.[0]?.message?.content) return j.choices[0].message.content;
      lastErr = (j.error?.message || JSON.stringify(j)).slice(0, 160);
    } catch (e) { lastErr = e.message.slice(0, 160); }
  }
  return '__ERR__' + lastErr;
}

async function routeOnce(arm, c) {
  const out = await call(promptFor(arm, c));
  if (out.startsWith('__ERR__')) return { action: '__err', raw: out };
  const m = out.match(/→\s*\*\*(.+?)\*\*/);
  return { action: m ? norm(m[1]) : '(unparsed)', raw: out };
}

// ---- case source: synthetic (default) or real proxy bundles (REAL_DIR) ----
// REAL_DIR mode keeps the big task text OUT of this orchestrator: the subagent-built
// gold.json carries only {expect, bucket} per id; the bundles are read by the harness
// at runtime, never surfaced. gold.json shape: { "LIN-123": { expect:[..], bucket:".." } }.
function loadRealCases(dir) {
  const goldPath = join(dir, 'gold.json');
  if (!existsSync(goldPath)) {
    console.error(`REAL_DIR set but no gold.json in ${dir}. Run fetch-proxy-tasks.mjs, then have a subagent write gold.json.`);
    process.exit(1);
  }
  const gold = JSON.parse(readFileSync(goldPath, 'utf8'));
  return Object.entries(gold).map(([id, g]) => {
    const bundle = JSON.parse(readFileSync(join(dir, `${id}.json`), 'utf8'));
    return { id, bucket: g.bucket || 'real', expect: g.expect, bundle };
  });
}

// ---- run ----
const allCases = process.env.REAL_DIR ? loadRealCases(process.env.REAL_DIR) : CASES;
const cases = allCases.filter(c => !ONLY || c.id.includes(ONLY));
console.log(`model=${MODEL}  K=${K}  arms=${armIds.join('+')}  cases=${cases.length}  (n=${K}/arm/case)\n`);

// per-arm aggregates
const agg = {};
for (const a of armIds) agg[a] = { hit: 0, n: 0, byBucket: {}, researchOverfire: 0, overfireN: 0 };
const detail = []; // per case/arm rows for the artifact

for (const c of cases) {
  const accept = new Set(c.expect.map(norm));
  const isResearchCase = c.bucket === 'guard-research' || accept.has('research');
  const line = [`• [${c.bucket}] ${c.id}  {${c.expect.join(' | ')}}`];
  for (const arm of armIds) {
    const res = await Promise.all(Array.from({ length: K }, () => routeOnce(arm, c)));
    const actions = res.map(r => r.action);
    const dist = {};
    for (const a of actions) dist[a] = (dist[a] || 0) + 1;
    const hits = actions.filter(a => accept.has(a)).length;

    const s = agg[arm];
    s.hit += hits; s.n += K;
    s.byBucket[c.bucket] = s.byBucket[c.bucket] || { hit: 0, n: 0 };
    s.byBucket[c.bucket].hit += hits; s.byBucket[c.bucket].n += K;
    // research over-fire: chose research where research is NOT acceptable
    if (!accept.has('research')) {
      s.overfireN += K;
      s.researchOverfire += actions.filter(a => a === 'research').length;
    }

    const distStr = Object.entries(dist).sort((a, b) => b[1] - a[1]).map(([a, n]) => `${a}×${n}`).join(', ');
    const tag = hits === K ? 'ok ' : hits > 0 ? 'mix' : 'MISS';
    line.push(`    ${arm.padEnd(16)} [${tag}] ${hits}/${K}  ${distStr}`);
    detail.push({ case: c.id, bucket: c.bucket, arm, expect: c.expect, hits, K, dist });
  }
  console.log(line.join('\n'));
}

// ---- summary ----
const pct = (x, n) => n ? (x / n * 100).toFixed(0) + '%' : '-';
const buckets = [...new Set(cases.map(c => c.bucket))];
const summaryLines = [];
const head = 'metric'.padEnd(26) + armIds.map(a => a.padEnd(18)).join('');
summaryLines.push(head);
summaryLines.push('-'.repeat(head.length));
const rowFor = (label, fn) => label.padEnd(26) + armIds.map(a => fn(agg[a]).padEnd(18)).join('');
summaryLines.push(rowFor('overall accuracy', s => `${s.hit}/${s.n} (${pct(s.hit, s.n)})`));
for (const b of buckets) {
  summaryLines.push(rowFor(`  ${b}`, s => {
    const x = s.byBucket[b];
    return x ? `${x.hit}/${x.n} (${pct(x.hit, x.n)})` : '-';
  }));
}
summaryLines.push(rowFor('research over-fire', s => `${s.researchOverfire}/${s.overfireN} (${pct(s.researchOverfire, s.overfireN)})`));

console.log('\n========== summary ==========');
console.log(summaryLines.join('\n'));
console.log('\nWant: review↑ and triage↑ (the under-served buckets) WITHOUT guard-common/guard-research dropping or over-fire rising.');

// ---- artifacts ----
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, 'run.json'),
  JSON.stringify({ meta: { model: MODEL, K, arms: armIds, date: new Date().toISOString() }, agg, detail }, null, 2));
writeFileSync(join(OUT_DIR, 'summary.md'),
  `# Assessment-scaffold spike\n\nmodel: \`${MODEL}\` · K=${K} · arms: ${armIds.join(', ')}\n\n\`\`\`\n${summaryLines.join('\n')}\n\`\`\`\n`);
console.log(`\nartifacts:\n  ${join(OUT_DIR, 'summary.md')}\n  ${join(OUT_DIR, 'run.json')}`);
