#!/usr/bin/env node
/**
 * Routing eval for the recommendation meta-prompt — standalone research infra.
 *
 * This is DELIBERATELY decoupled from lib/. It treats the meta-prompt as plain
 * text: it reads two prompt files, injects each case's task context, asks the
 * model, and grades the routing decision off the `→ **action**` line it emits
 * (no LLM judge — deterministic and cheap).
 *
 *   scripts/eval/meta-prompt.baseline.txt   Arm A — faithful snapshot of the LIVE
 *                                           meta-prompt (regenerate when lib changes:
 *                                           see scripts/eval/README or the snapshot note).
 *   scripts/eval/meta-prompt.candidate.txt  Arm B — the variant under test. Edit the
 *                                           Step-1 research-routing wording HERE.
 *
 * Workflow: iterate candidate.txt → run AB → when Arm B lifts research recall on the
 * LIN-325 gold case WITHOUT raising over-fire on the guard cases, make ONE manual edit
 * to lib/prompts/meta-prompt-template.js (+ the research aiHint, per CLAUDE.md). The
 * live prompt stays plain text; nothing here is wired into it.
 *
 * Both files use placeholders {{ISSUE_CONTEXT}} and {{IDENTIFIER}}, filled per case.
 * The snapshot is for a LEAF task (no subtasks/comments), featureFlags:{} — exactly
 * what the proxy sends — so cases must likewise have no children/comments to stay faithful.
 *
 * Usage:
 *   OPENROUTER_API_KEY=... node scripts/eval-research-routing.mjs
 *
 * Env knobs:
 *   GEN_MODEL   model under test            (default anthropic/claude-sonnet-4.6)
 *   K           runs per arm per case       (default 2)
 *   ARMS        A | B | AB                   (default AB — run both, show delta)
 *   ONLY        substring filter on case id  (e.g. ONLY=LIN-325) — for cheap focused runs
 *   MAX_TOKENS  output cap                   (default 600 — only need through the action line)
 *
 * Cost note: input (~5k-tok meta-prompt) dominates. Iterate cheaply with a small
 * ONLY subset + K=1 to get a directional read before running the full suite.
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const HERE = dirname(fileURLToPath(import.meta.url));
const KEY = process.env.OPENROUTER_API_KEY;
if (!KEY) { console.error('Set OPENROUTER_API_KEY'); process.exit(1); }
const GEN_MODEL = process.env.GEN_MODEL || 'anthropic/claude-sonnet-4.6';
const K = Number(process.env.K) || 2;
const ARMS = (process.env.ARMS || 'AB').toUpperCase();
const ONLY = process.env.ONLY;
const MAX_TOKENS = Number(process.env.MAX_TOKENS) || 600;

const PROMPTS = {
  A: readFileSync(join(HERE, 'eval', 'meta-prompt.baseline.txt'), 'utf8'),
  B: readFileSync(join(HERE, 'eval', 'meta-prompt.candidate.txt'), 'utf8')
};

// Valid action vocabulary, parsed from the prompt text itself (the line
// "...from this list: a, b, c. This name is parsed..."). Keeping it self-derived
// means off-vocabulary detection tracks exactly what the prompt told the model,
// with no lib import. Falls back to a known set if the marker moves.
function vocabFrom(text) {
  const m = text.match(/from this list:\s*([^.]+?)\.\s*This name/i);
  const list = m ? m[1] : 'plan, research, implement, review, breakdown, blocked, bug';
  return new Set(list.split(',').map(s => s.trim().toLowerCase()).filter(Boolean));
}
const VOCAB = vocabFrom(PROMPTS.A);

const inProgress = { name: 'In Progress', type: 'started' };
const todo = { name: 'Todo', type: 'unstarted' };

// Render a leaf-task context block in the SAME shape lib/openrouter.js
// formatIssueContext produces, so the snapshot + context is faithful.
function renderContext(issue, project = 'Product') {
  const L = [];
  L.push(`**Issue:** ${issue.identifier} - ${issue.title}`);
  L.push(`**State:** ${issue.state.name} (${issue.state.type})`);
  if (issue.createdAt) L.push(`**Created:** ${issue.createdAt}`);
  if (issue.description) L.push(`**Description:** ${issue.description}`);
  if (issue.labels?.length) L.push(`**Labels:** ${issue.labels.join(', ')}`);
  if (project) L.push(`**Project:** ${project}`);
  return L.join('\n');
}

const buildPrompt = (arm, issue) => PROMPTS[arm]
  .replaceAll('{{ISSUE_CONTEXT}}', renderContext(issue))
  .replaceAll('{{IDENTIFIER}}', issue.identifier);

// Each case: action(s) we accept as correct (overlap is fine), why, and the task.
const CASES = [
  // ---- RESEARCH-expected ----
  {
    id: 'LIN-325 verbatim (content-gathering manual)',
    expect: ['research'],
    why: 'Deliverable substance must be gathered from the track record; ticket even prescribes a research Method first. THE gold case — verbatim text reproduces the real plan-over-research failure.',
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
    id: 'LIN-551 verbatim (real under-fire case, LIN-557)',
    expect: ['research'],
    why: 'REAL case behind LIN-557 ("research too easily skipped"). Clear intent, but the ' +
         'deliverable depends on code that must be discovered first — where merge-strategy ' +
         'wording lives across the prompt surfaces and where the settings value is stored/threaded. ' +
         'Knowledge is ungathered, so research is the honest next action (triage/look-into are no ' +
         'longer in the AI action vocab, so grounding here is research-or-nothing); live production ' +
         'routes it to plan/implementation instead. Baseline gpt-5.4-mini K=6: research 1/6 — grades ' +
         'the under-fire direction.',
    issue: {
      identifier: 'LIN-551', createdAt: '2026-06-20T07:12:25.604Z', state: todo, labels: [],
      title: 'Branch base / merge strategy needs to be a system guarantee',
      description: 'Users should set their strategy in settings (default to standard merge, not squash and merge), and this is carried into prompts which deal with merging branches.'
    }
  },
  {
    id: 'external dependency (unpinned 3rd-party API)',
    expect: ['research'],
    why: 'Integration depends on an external API whose contract is not pinned down.',
    issue: {
      identifier: 'SYN-2', createdAt: '2026-06-01T00:00:00Z', state: todo, labels: [],
      title: 'Sync paid invoices from the Acme billing service into Linear',
      description: 'When an invoice is marked paid in Acme, reflect it on the corresponding Linear issue. Use the Acme billing API.'
    }
  },
  {
    id: 'hedged feasibility wording',
    expect: ['research', 'spike'],
    why: '"Investigate whether" — approach assumed, not confirmed.',
    issue: {
      identifier: 'SYN-3', createdAt: '2026-06-01T00:00:00Z', state: todo, labels: [],
      title: 'Investigate whether we can render the dashboard tree server-side for faster first paint',
      description: 'We believe SSR should be possible for the tree view and would help first paint. See if we can do it without a build step.'
    }
  },
  {
    id: 'vague / empty intent',
    expect: ['research', 'look into', 'triage', 'scoping'],
    why: 'Too thin to know what to do — needs preparation of some kind.',
    issue: {
      identifier: 'SYN-4', createdAt: '2026-06-01T00:00:00Z', state: todo, labels: [],
      title: 'Improve dashboard performance', description: ''
    }
  },
  {
    id: 'content-gathering: document existing behavior',
    expect: ['research', 'look into'],
    why: 'Substance lives in the current code/history, not the ticket — must be gathered before writing.',
    issue: {
      identifier: 'SYN-13', createdAt: '2026-06-01T00:00:00Z', state: todo, labels: [],
      title: 'Write a doc explaining how dispatch tokens, scopes, and feedback actually work today',
      description: 'We have no single reference for the dispatch consumer contract. Produce one that reflects how the system behaves now (token lifecycle, scope rules, feedback TTL), grounded in the actual implementation and recent changes — not how we wish it worked.'
    }
  },

  // ---- PLAN-expected ----
  {
    id: 'clear multi-surface, no plan',
    expect: ['plan'],
    why: 'Clear, familiar approach but spans surfaces and has no documented plan.',
    issue: {
      identifier: 'SYN-5', createdAt: '2026-06-01T00:00:00Z', state: todo, labels: [],
      title: 'Add pagination to the issues list (API + UI)',
      description: 'The issues list returns everything at once. Add page-based pagination to the GET /issues endpoint and add prev/next controls to the issues list UI. Keep existing default behavior for callers that pass no page param.'
    }
  },
  {
    id: 'clear refactor, no plan',
    expect: ['plan', 'implement'],
    why: 'Familiar refactor; borderline plan/implement.',
    issue: {
      identifier: 'SYN-6', createdAt: '2026-06-01T00:00:00Z', state: todo, labels: [],
      title: 'Extract duplicated date-formatting helpers into lib/format.js',
      description: 'The same toLocaleDateString block is copy-pasted in render.js, render-dispatch.js, and openrouter.js. Pull it into one helper in lib/format.js and call it from all three.'
    }
  },

  // ---- IMPLEMENT-expected (research here would be over-firing) ----
  {
    id: 'trivial one-liner',
    expect: ['implement'], researchWrong: true,
    why: 'Obvious, tiny, no unknowns.',
    issue: {
      identifier: 'SYN-7', createdAt: '2026-06-01T00:00:00Z', state: todo, labels: [],
      title: 'Fix typo in footer: "Copyrght" -> "Copyright"',
      description: 'The footer in lib/components/footer.js renders "Copyrght". Fix the spelling.'
    }
  },
  {
    id: 'plan already documented (fits one session)',
    expect: ['implement'], researchWrong: true,
    why: 'Complete plan in description, commits to "fits one session".',
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
    id: 'simple well-scoped',
    expect: ['implement', 'plan'], researchWrong: true,
    why: 'Single-surface, approach obvious; readiness check should skip prep.',
    issue: {
      identifier: 'SYN-9', createdAt: '2026-06-01T00:00:00Z', state: todo, labels: [],
      title: 'Add validation: reject dispatch prompts longer than 50k chars',
      description: 'In the POST dispatch handler (routes/dispatch.js), return 400 if the prompt exceeds 50000 chars. Mirror the existing empty-prompt validation right above it.'
    }
  },

  // ---- OVER-FIRE TRAPS: mention unknowns/research but should NOT route to research ----
  {
    id: 'trap: research already done, now ready',
    expect: ['plan', 'implement'], researchWrong: true,
    why: 'Findings + chosen approach already in the description — research is complete, do not loop it.',
    issue: {
      identifier: 'SYN-14', createdAt: '2026-06-01T00:00:00Z', state: inProgress, labels: [],
      title: 'Cache /recommend responses to cut latency',
      description: `## Research findings (done)
Investigated the latency: the OpenRouter generation leg is the cost (traced via the B-run probe), Linear fetch is fast. Options considered: in-memory LRU vs the existing MangoDB store. Recommended approach: reuse the existing recap-style cache keyed by issue id + updatedAt, 10-min TTL. Feasibility confirmed with a spike.

Approach is settled; just needs building.`
    }
  },
  {
    id: 'trap: mentions unknown but trivially answerable',
    expect: ['implement', 'plan'], researchWrong: true,
    why: 'A passing "not sure which file" is resolved by a grep, not a research phase.',
    issue: {
      identifier: 'SYN-15', createdAt: '2026-06-01T00:00:00Z', state: todo, labels: [],
      title: 'Bump the dispatch item TTL from 24h to 48h',
      description: 'Change the dispatch expiry from 24 hours to 48. Not 100% sure which file holds the constant — find it and update it (and any test that asserts 24h).'
    }
  },

  // ---- WORKFLOW routes (tree sanity) ----
  {
    id: 'blocked label',
    expect: ['blocked'], researchWrong: true,
    why: 'Blocked label + external dependency.',
    issue: {
      identifier: 'SYN-10', createdAt: '2026-06-01T00:00:00Z', state: inProgress, labels: ['blocked'],
      title: 'Wire the new billing webhook into the dispatch queue',
      description: 'Blocked: waiting on the platform team to provision the webhook secret (tracked in SYN-200). Cannot proceed until that lands.'
    }
  },
  {
    id: 'bug label',
    expect: ['bug'], researchWrong: true,
    why: 'Bug label + unexpected behavior to investigate.',
    issue: {
      identifier: 'SYN-11', createdAt: '2026-06-01T00:00:00Z', state: inProgress, labels: ['bug'],
      title: 'Dispatch button intermittently returns 500',
      description: 'Roughly 1 in 10 dispatch clicks returns a 500 and the item is not queued. No clear pattern. Logs show a truncated TypeError.'
    }
  },
  {
    id: 'plan says needs multiple sessions',
    expect: ['breakdown'], researchWrong: true,
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
  }
];

const norm = s => (s || '').toLowerCase().trim();
const isOffVocab = a => a && !a.startsWith('__err') && a !== '(unparsed)' && !VOCAB.has(a);

let lastErr = '';
async function call(prompt, model) {
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) await new Promise(r => setTimeout(r, 1000 * 2 ** (attempt - 1))); // 1s,2s,4s
    try {
      const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, temperature: 0, max_tokens: MAX_TOKENS, messages: [{ role: 'user', content: prompt }] })
      });
      if (r.status === 429 || r.status >= 500) { lastErr = `HTTP ${r.status}`; continue; }
      const j = await r.json();
      if (j.choices?.[0]?.message?.content) return j.choices[0].message.content;
      lastErr = (j.error?.message || JSON.stringify(j)).slice(0, 120);
    } catch (e) { lastErr = e.message.slice(0, 120); }
  }
  return '__ERR__' + lastErr;
}

async function routeOnce(arm, issue) {
  const out = await call(buildPrompt(arm, issue), GEN_MODEL);
  if (out.startsWith('__ERR__')) return '__err';
  const m = out.match(/→\s*\*\*(.+?)\*\*/);
  return m ? norm(m[1]) : '(unparsed)';
}

// ONLY accepts a comma-separated list of substrings (match ANY) for cheap focused
// A/B runs over a hand-picked subset, e.g. ONLY=LIN-551,multi-surface,trap
const onlyTerms = ONLY ? ONLY.split(',').map(s => s.trim()).filter(Boolean) : null;
const cases = CASES.filter(c => !onlyTerms || onlyTerms.some(t => c.id.includes(t)));
const armList = ARMS === 'A' ? ['A'] : ARMS === 'B' ? ['B'] : ['A', 'B'];
console.log(`model=${GEN_MODEL}  K=${K}  arms=${armList.join('+')}  cases=${cases.length}  (n=${K}/arm/case)`);
console.log(`vocab(${VOCAB.size}): ${[...VOCAB].join(', ')}\n`);

const armName = { A: 'baseline', B: 'candidate' };
const stats = { A: { hit: 0, n: 0, rr: 0, rrN: 0, of: 0, ofN: 0, ov: 0 }, B: { hit: 0, n: 0, rr: 0, rrN: 0, of: 0, ofN: 0, ov: 0 } };

for (const c of cases) {
  const accept = new Set(c.expect.map(norm));
  const wantsResearch = accept.has('research');
  const line = [`• ${c.id}  {${c.expect.join(' | ')}}`];
  for (const arm of armList) {
    const res = await Promise.all(Array.from({ length: K }, () => routeOnce(arm, c.issue)));
    const dist = {};
    for (const a of res) dist[a] = (dist[a] || 0) + 1;
    const hits = res.filter(a => accept.has(a)).length;
    const choseResearch = res.filter(a => a === 'research').length;
    const s = stats[arm];
    s.hit += hits; s.n += K; s.ov += res.filter(isOffVocab).length;
    if (wantsResearch) { s.rr += choseResearch; s.rrN += K; }
    // Over-fire = chose research on ANY case where research is not acceptable
    // (auto-derived from expect; subsumes the old manual researchWrong flag, which
    // had a blind spot: it didn't count plan-expected cases pulled into research).
    else { s.of += choseResearch; s.ofN += K; }
    const distStr = Object.entries(dist).sort((a, b) => b[1] - a[1]).map(([a, n]) => `${a}×${n}`).join(', ');
    const tag = hits === K ? 'ok ' : hits > 0 ? 'mix' : 'MISS';
    line.push(`    ${arm}(${armName[arm]}) [${tag}] ${hits}/${K}  ${distStr}`);
  }
  console.log(line.join('\n'));
}

const pct = (x, n) => n ? (x / n * 100).toFixed(0) + '%' : '-';
console.log('\n========== summary ==========');
console.log(`metric                     ${armList.map(a => (armName[a] + ' (' + a + ')').padEnd(16)).join('')}${armList.length === 2 ? 'Δ (B-A)' : ''}`);
const row = (label, sel) => {
  const vals = armList.map(a => sel(stats[a]));
  let l = label.padEnd(27) + vals.map(v => String(v).padEnd(16)).join('');
  if (armList.length === 2) {
    const a = sel(stats.A, true), b = sel(stats.B, true);
    if (typeof a === 'number') l += `${b - a >= 0 ? '+' : ''}${(b - a).toFixed(0)} pts`;
  }
  return l;
};
console.log(row('routing accuracy', (s, raw) => raw ? s.hit / s.n * 100 : `${s.hit}/${s.n} (${pct(s.hit, s.n)})`));
console.log(row('research RECALL', (s, raw) => raw ? (s.rrN ? s.rr / s.rrN * 100 : 0) : `${s.rr}/${s.rrN} (${pct(s.rr, s.rrN)})`));
console.log(row('research OVER-FIRE', (s, raw) => raw ? (s.ofN ? s.of / s.ofN * 100 : 0) : `${s.of}/${s.ofN} (${pct(s.of, s.ofN)})`));
console.log(row('off-vocabulary', (s, raw) => raw ? s.ov / s.n * 100 : `${s.ov}/${s.n} (${pct(s.ov, s.n)})`));
console.log('\nrecall↑ over-fire↓ off-vocab↓ is better. (Δ shown only in AB mode.)');
