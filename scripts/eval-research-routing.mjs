#!/usr/bin/env node
/**
 * Routing eval for the AI meta-prompt's action choice (`→ **action**`).
 *
 * Unlike eval-completeness-check.mjs (which grades free text with an LLM judge),
 * this measures the recommender's ROUTING DECISION directly: the meta-prompt
 * emits the chosen action on its own line, parseRecommendedAction reads it, so we
 * grade deterministically — no judge calls, cheap and fast.
 *
 * It runs a labelled set of synthetic tasks through the REAL recommendation path
 * (lib/openrouter.js → buildMetaPrompt → the live meta-prompt template) and
 * compares the chosen action to an expected set per task. The headline numbers:
 *   - research RECALL: of the tasks that should route to research, how many do?
 *   - research OVER-FIRE: of the tasks that should NOT, how many wrongly do?
 *
 * This is the baseline measurement for the "favour research before planning"
 * change. To A/B a meta-prompt edit: run this, note the numbers, apply the edit
 * to lib/prompts/meta-prompt-template.js, re-run, compare. (The change is
 * structural rewording of Step 1, so unlike the completeness eval it can't be
 * armed by string-stripping — measure before vs after the edit instead.)
 *
 * Usage:
 *   OPENROUTER_API_KEY=... node scripts/eval-research-routing.mjs
 *
 * Env knobs:
 *   GEN_MODEL  recommender under test  (default anthropic/claude-haiku-4.5)
 *   K          runs per task           (default 3)
 *   ONLY       substring filter on id  (e.g. ONLY=manual)
 */
import { getRecommendation, DEFAULT_MODEL } from '../lib/openrouter.js';
import { deriveDispatchKind } from '../lib/prompt-templates.js';

if (!process.env.OPENROUTER_API_KEY) { console.error('Set OPENROUTER_API_KEY'); process.exit(1); }
const GEN_MODEL = process.env.GEN_MODEL || DEFAULT_MODEL;
const K = Number(process.env.K) || 3;
const ONLY = process.env.ONLY;

const inProgress = { name: 'In Progress', type: 'started' };
const todo = { name: 'Todo', type: 'unstarted' };
const ctx = (over = {}) => ({ project: { name: 'Product' }, parent: null, siblings: [], children: [], comments: [], ...over });

// Each case: the action(s) we'd accept as correct, why, and a synthetic issue.
// `expect[0]` is the primary expectation; extra entries are also-acceptable
// (genuine overlap, per the "overlap is healthy" principle).
const CASES = [
  // ---- should route to RESEARCH (the cases we care most about) ----
  {
    // REAL gold case — verbatim LIN-325 text. A paraphrase of this routed cleanly
    // to research (false pass); the verbatim text reproduces the real failure
    // (Sonnet/Opus -> plan/implement; Haiku echoes the ticket phrase -> kind=custom).
    // Lesson from docs/prompt-change-validation.md: use a real gold case, don't
    // simplify it — the simplification removes exactly what tips the decision.
    id: 'LIN-325 verbatim (content-gathering manual)',
    expect: ['research'],
    why: 'Deliverable substance must be gathered from the track record; ticket even prescribes a research Method first.',
    issue: {
      identifier: 'LIN-325', createdAt: '2026-06-07T08:41:20.522Z', state: inProgress, labels: [],
      title: 'Write the autopilot operating manual',
      description: `## What

Write the **autopilot operating manual** — a field guide the autopilot reads on kickoff and references when a situation calls for it — and wire the Autopilot prompt to consult it.

\`docs/autopilot-operating-manual.md\` (or similar) + an instruction in the Autopilot kickoff/orchestrator prompt (\`lib/prompts/autopilot-kickoff.js\` / \`buildAutopilotKickoff()\`) to read it on kickoff and reference the relevant part when a trigger appears. Reference, don't inline — keep the light-orchestrator invariant.

## Why

This is the **autopilot-native, cheaper realisation of the superseded drift-defense epic LIN-289**: the supervisor and evidence-discipline become guide-text read by an agent already positioned to flag, rather than bespoke coded subsystems. Most detection already exists in the per-prompt sensors and the proxy API; the manual is the **judgment layer that ties them together**.

## The specifics that matter (and why)

These are the decisions research won't independently rediscover — hold them; fill in everything else from the track record.

* **Write it human-shaped: intro → how a run normally goes → known issues to watch for.** An onboarding doc, not a flat rulebook.
* **Ground it on altitude.** The autopilot is high; the generated prompts do the heavy lifting low; the loop self-corrects across passes.
* **Tolerant operating stance.** Don't halt at the first sign of trouble.
* **Descriptive, never normative.**

## Method (high level)

Seed from the design conversation (above) → **research our own track record concretely** — the named failure episodes, not abstractions (\`docs/autopilot-experiment.md\` runs B1–B4, the autopilot + drift docs, real Linear/git episodes; run the \`retro\` lens over a real churn cluster for a worked example per known-issue) → write it → wire the prompt to it.

## Done when

The manual exists and is human-shaped, with the Drift entry complete and the rest at least drafted from named episodes; altitude is the visible through-line; and the Autopilot prompt reads and references it.

## Out of scope

No new sensor service, scheduler, or auto-remediation — this is documentation + a prompt instruction.

## Relations

Supersedes LIN-289.`
    }
  },
  {
    id: 'external dependency (unpinned 3rd-party API)',
    expect: ['research'],
    why: 'Integration depends on an external API whose contract is not pinned down in the ticket.',
    issue: {
      identifier: 'SYN-2', createdAt: '2026-06-01T00:00:00Z', state: todo, labels: [],
      title: 'Sync paid invoices from the Acme billing service into Linear',
      description: 'When an invoice is marked paid in Acme, reflect it on the corresponding Linear issue. Use the Acme billing API.'
    }
  },
  {
    id: 'hedged feasibility wording',
    expect: ['research', 'spike'],
    why: '"Investigate whether" — the approach is assumed, not confirmed.',
    issue: {
      identifier: 'SYN-3', createdAt: '2026-06-01T00:00:00Z', state: todo, labels: [],
      title: 'Investigate whether we can render the dashboard tree server-side for faster first paint',
      description: 'We believe SSR should be possible for the tree view and would help first paint. See if we can do it without a build step.'
    }
  },
  {
    id: 'vague / empty intent',
    expect: ['research', 'look into', 'triage', 'scoping'],
    why: 'Description too thin to know what to do — needs preparation of some kind.',
    issue: {
      identifier: 'SYN-4', createdAt: '2026-06-01T00:00:00Z', state: todo, labels: [],
      title: 'Improve dashboard performance',
      description: ''
    }
  },

  // ---- should route to PLAN (clear intent, no plan yet) ----
  {
    id: 'clear multi-surface, no plan',
    expect: ['plan'],
    why: 'Requirements clear and approach familiar, but spans surfaces and has no documented plan.',
    issue: {
      identifier: 'SYN-5', createdAt: '2026-06-01T00:00:00Z', state: todo, labels: [],
      title: 'Add pagination to the issues list (API + UI)',
      description: 'The issues list returns everything at once. Add page-based pagination to the GET /issues endpoint and add prev/next controls to the issues list UI. Keep the existing default behavior for callers that pass no page param.'
    }
  },
  {
    id: 'clear refactor, no plan',
    expect: ['plan', 'implement'],
    why: 'Familiar refactor; borderline plan/implement — either is defensible.',
    issue: {
      identifier: 'SYN-6', createdAt: '2026-06-01T00:00:00Z', state: todo, labels: [],
      title: 'Extract duplicated date-formatting helpers into lib/format.js',
      description: 'The same toLocaleDateString date-formatting block is copy-pasted in render.js, render-dispatch.js, and openrouter.js. Pull it into one helper in lib/format.js and call it from all three.'
    }
  },

  // ---- should route to IMPLEMENT (plan exists or trivially scoped) ----
  {
    id: 'trivial one-liner',
    expect: ['implement'],
    why: 'Obvious, tiny, no unknowns — preparation would be waste.',
    issue: {
      identifier: 'SYN-7', createdAt: '2026-06-01T00:00:00Z', state: todo, labels: [],
      title: 'Fix typo in footer: "Copyrght" -> "Copyright"',
      description: 'The footer in lib/components/footer.js renders "Copyrght". Fix the spelling.'
    }
  },
  {
    id: 'plan already documented (fits one session)',
    expect: ['implement'],
    why: 'Description contains a complete plan and commits to "fits one session".',
    issue: {
      identifier: 'SYN-8', createdAt: '2026-06-01T00:00:00Z', state: inProgress, labels: [],
      title: 'Add a --json flag to the CLI viewer command',
      description: `## Plan
- Files to modify: lib/linear-cli.js (the 'viewer' command handler).
- Change: when argv includes --json, JSON.stringify the user object instead of pretty-printing.
- Edge: --json with no other args; unknown user (null) -> print {}.
- Testing: add a unit test asserting JSON output shape.

## Scope
Single surface (one command handler). Fits one session.`
    }
  },
  {
    id: 'simple well-scoped, approach obvious',
    expect: ['implement', 'plan'],
    why: 'Well-scoped single-surface change; readiness check should skip prep.',
    issue: {
      identifier: 'SYN-9', createdAt: '2026-06-01T00:00:00Z', state: todo, labels: [],
      title: 'Add validation: reject dispatch prompts longer than 50k chars',
      description: 'In the POST dispatch handler (routes/dispatch.js), return 400 if the prompt field exceeds 50000 characters. Mirror the existing empty-prompt validation right above it.'
    }
  },

  // ---- non research/plan/implement routes (sanity that the tree still works) ----
  {
    id: 'blocked label',
    expect: ['blocked'],
    why: 'Has blocked label and an external dependency.',
    issue: {
      identifier: 'SYN-10', createdAt: '2026-06-01T00:00:00Z', state: inProgress, labels: ['blocked'],
      title: 'Wire the new billing webhook into the dispatch queue',
      description: 'Blocked: waiting on the platform team to provision the webhook secret (tracked in SYN-200). Cannot proceed until that lands.'
    }
  },
  {
    id: 'bug label',
    expect: ['bug'],
    why: 'Has bug label and reports unexpected behavior to investigate.',
    issue: {
      identifier: 'SYN-11', createdAt: '2026-06-01T00:00:00Z', state: inProgress, labels: ['bug'],
      title: 'Dispatch button intermittently returns 500',
      description: 'Roughly 1 in 10 dispatch clicks returns a 500 and the item is not queued. No clear pattern yet. Logs show a TypeError but the stack is truncated.'
    }
  },
  {
    id: 'plan says needs multiple sessions',
    expect: ['breakdown'],
    why: 'A complete plan exists and explicitly says it needs multiple sessions.',
    issue: {
      identifier: 'SYN-12', createdAt: '2026-06-01T00:00:00Z', state: inProgress, labels: [],
      title: 'Migrate session storage from file-based MangoDB to MongoDB',
      description: `## Plan
Surfaces: session-store.js (read/write/expire), server.js (store wiring), user-preferences.js (shares the store), a data migration step, and a rollback path.
Dependency arrows: server wiring depends on the store rewrite; migration depends on both.
## Scope
Needs multiple sessions — the migration + rollback alone is its own focused pass, and the three call sites each carry distinct edge cases.`
    }
  }
];

const norm = s => (s || '').toLowerCase().trim();

async function routeOnce(issue) {
  try {
    const r = await getRecommendation(issue, ctx(), { model: GEN_MODEL });
    return norm(r.recommendedAction) || '(unparsed)';
  } catch (e) {
    return '__ERR__ ' + e.message.slice(0, 60);
  }
}

const cases = CASES.filter(c => !ONLY || c.id.includes(ONLY));
console.log(`gen=${GEN_MODEL}  K=${K}  cases=${cases.length}  (n=${K} per case)\n`);

let overallHits = 0, overallN = 0, offVocab = 0;
const researchCases = [], nonResearchCases = [];

// An action is "off-vocabulary" when deriveDispatchKind can't place it and falls
// back to 'custom' (yet the model didn't literally choose 'custom'). This is a
// distinct failure from a wrong route: the action is LOST downstream even if the
// model picked the right intent — e.g. Haiku emitting the ticket's prose phrase
// "research our own track record concretely" instead of the token "research".
const isOffVocab = a => a !== 'custom' && !a.startsWith('__err__') && deriveDispatchKind(a) === 'custom';

for (const c of cases) {
  const accept = new Set(c.expect.map(norm));
  const results = await Promise.all(Array.from({ length: K }, () => routeOnce(c.issue)));
  const dist = {};
  for (const a of results) dist[a] = (dist[a] || 0) + 1;
  const hits = results.filter(a => accept.has(a)).length;
  offVocab += results.filter(isOffVocab).length;
  overallHits += hits; overallN += K;

  const distStr = Object.entries(dist).sort((a, b) => b[1] - a[1]).map(([a, n]) => `${a}×${n}`).join(', ');
  const pass = hits === K ? 'ok ' : hits > 0 ? 'mix' : 'MISS';
  console.log(`[${pass}] ${c.id}`);
  console.log(`      expect {${c.expect.join(' | ')}}  got: ${distStr}  (${hits}/${K})`);

  // Track for research recall / over-fire summary.
  const wantsResearch = accept.has('research');
  const choseResearch = results.filter(a => a === 'research').length;
  if (wantsResearch) researchCases.push({ id: c.id, choseResearch, K });
  else nonResearchCases.push({ id: c.id, choseResearch, K });
}

const rrN = researchCases.reduce((a, c) => a + c.K, 0);
const rrHit = researchCases.reduce((a, c) => a + c.choseResearch, 0);
const ofN = nonResearchCases.reduce((a, c) => a + c.K, 0);
const ofHit = nonResearchCases.reduce((a, c) => a + c.choseResearch, 0);

console.log('\n========== summary ==========');
console.log(`overall routing accuracy : ${overallHits}/${overallN}  (${(overallHits / overallN * 100).toFixed(0)}%)`);
console.log(`research RECALL          : ${rrHit}/${rrN}  (${rrN ? (rrHit / rrN * 100).toFixed(0) : '-'}%)   [research-expected cases that chose research]`);
console.log(`research OVER-FIRE       : ${ofHit}/${ofN}  (${ofN ? (ofHit / ofN * 100).toFixed(0) : '-'}%)   [non-research cases that wrongly chose research]`);
console.log(`off-vocabulary actions   : ${offVocab}/${overallN}  (${(offVocab / overallN * 100).toFixed(0)}%)   [action echoed prose -> deriveDispatchKind=custom, kind lost downstream]`);
