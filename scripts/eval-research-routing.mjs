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
  // Capture the list up to the FIRST period after "from this list:". The list
  // contains no periods, so this is the full vocab. (Earlier this anchored on
  // ". This name", but a ". Keep the surrounding ..." clause was later inserted
  // between the list and "This name", breaking the match and silently falling
  // back to a 7-action subset — masking the real 14-action vocab.)
  const m = text.match(/from this list:\s*([^.]+?)\./i);
  const list = m ? m[1] : 'plan, research, implement, review, breakdown, blocked, bug';
  return new Set(list.split(',').map(s => s.trim().toLowerCase()).filter(Boolean));
}
const VOCAB = vocabFrom(PROMPTS.A);

const inProgress = { name: 'In Progress', type: 'started' };
const todo = { name: 'Todo', type: 'unstarted' };

// Render a leaf-task context block in the SAME shape lib/openrouter.js
// formatIssueContext produces, so the snapshot + context is faithful.
//
// Comments matter for the LOOP cases (LIN-555): the prior-attempt trail is the
// ONLY window the recommender has onto past work, so a loop fixture encodes its
// recaps in issue.comments and we render them exactly as the leaf branch of
// formatIssueContext does — `**Discussion History:** N comment(s)` followed by
// `\n**<user>** (Mon D, YYYY):` + body per comment (oldest-first). Dates go
// through the same en-US toLocaleDateString shape formatCommentsForPrompt uses.
function renderComments(comments) {
  const L = [`**Discussion History:** ${comments.length} comment(s)`];
  for (const c of comments) {
    const date = new Date(c.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    L.push(`\n**${c.user}** (${date}):`);
    L.push(c.body);
  }
  return L.join('\n');
}

function renderContext(issue, project = 'Product') {
  const L = [];
  L.push(`**Issue:** ${issue.identifier} - ${issue.title}`);
  L.push(`**State:** ${issue.state.name} (${issue.state.type})`);
  if (issue.createdAt) L.push(`**Created:** ${issue.createdAt}`);
  if (issue.description) L.push(`**Description:** ${issue.description}`);
  if (issue.labels?.length) L.push(`**Labels:** ${issue.labels.join(', ')}`);
  if (project) L.push(`**Project:** ${project}`);
  if (issue.comments?.length) L.push(renderComments(issue.comments));
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
         'Knowledge is ungathered, so research is the honest next action; live production routes it ' +
         'to plan/implementation instead. Baseline gpt-5.4-mini K=12: research 0/12 (plan-heavy) — ' +
         'grades the under-fire direction.',
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
  },

  // ---- HAPPY/TYPICAL: review (completes the common-action regression net) ----
  // The suite already covers research/plan/implement/blocked/bug/breakdown happy
  // cases; review was the gap. Comment-driven (landed-evidence in the trail), so it
  // also exercises the Step-3 already-landed guard reading the comment recap.
  {
    id: 'happy: landed work awaiting review (comments)',
    expect: ['review'], researchWrong: true,
    why: 'Implementation has demonstrably landed per the completion recap (PR open, CI green) but is not yet reviewed → confirm-and-close, not re-implement. Real shape: LIN-420/LIN-542 pre-merge state.',
    issue: {
      identifier: 'SYN-16', createdAt: '2026-06-10T00:00:00Z', state: inProgress, labels: [],
      title: 'Adopt the shared error-envelope helpers in the three largest route files',
      description: 'Replace the ad-hoc `res.status(...).json({error})` blocks in the three largest route files with the shared envelope helpers. Net-additive, no behaviour change.',
      comments: [
        { user: 'agent', createdAt: '2026-06-10T09:10:00Z',
          body: 'Implemented — adopted the envelope helpers across all three route files. PR open (#505, commit 7f790dc). CI green: unit + all 4 E2E shards + ci-success. Scope held to exactly the named files; no behaviour change. Ready for review.' }
      ]
    }
  },

  // ---- LOOP / STUCK edge cases (LIN-555) ----
  // The prior-attempt trail lives ONLY in `comments` (the recommender's sole window
  // onto past work — mirrors reality, since agents post recaps). Expected action =
  // do NOT repeat the looping action; break the loop (escalate / review / fix the
  // blocker). `loop:true` + `avoid` make the forbidden repeat explicit so the summary
  // can report a loop-repeat rate. This is the cheap test of the bigger idea: if the
  // engine breaks these loops FROM THE COMMENT TRAIL, structured prior-session input
  // is unnecessary; if it can't even with the trail in front of it, that earns a
  // follow-up (richer session context) with evidence rather than speculation.
  {
    id: 'loop: review stuck — 3× Request Changes, unchanged (real LIN-510)',
    expect: ['implement', 'blocked', 'plan', 'bug'], loop: true, avoid: 'review', researchWrong: true,
    why: 'REAL loop (LIN-510): three consecutive reviews all Request-Changes on the SAME unaddressed blocker (dishonest visual baselines, no acknowledgment commit) against an unchanged commit. A 4th review repeats the loop; the correct break is to route to the blocker fix (regenerate the baselines) — Step-3 already-landed guard: "if review would surface a blocker that must be fixed first, route the next action to that blocker, not a repeated review".',
    issue: {
      identifier: 'SYN-17', createdAt: '2026-06-19T07:00:00Z', state: inProgress, labels: [],
      title: 'Converge the near-gray neutral values onto design tokens (intended visual delta)',
      description: 'Wire the residual near-gray hexes that are close-but-not-equal to a token onto that token, accepting the small intended visual delta. Two stylesheet files only.',
      comments: [
        { user: 'agent', createdAt: '2026-06-19T07:38:00Z',
          body: 'Implemented — converged the near-gray neutrals onto tokens in the two stylesheets (commit 0ba8f61). PR open, CI green.' },
        { user: 'agent', createdAt: '2026-06-19T07:46:00Z',
          body: 'Review — Request Changes. Code is approve-ready and matches the plan, but the visual-regression baselines were committed as-is and now bake in the OLD colours, so they are dishonest — they must be regenerated against the intended delta and an acknowledgment commit added before this can approve. No code change needed, only the baselines.' },
        { user: 'agent', createdAt: '2026-06-19T07:52:00Z',
          body: 'Review #2 — Request Changes (unchanged). State is identical to the prior review: still commit 0ba8f61, no acknowledgment commit, baselines still dishonest. Nothing has addressed the prior finding.' },
        { user: 'agent', createdAt: '2026-06-19T08:49:00Z',
          body: 'Review #3 — Request Changes (unchanged). Independent re-verification from scratch: still 0ba8f61, baselines still not regenerated. Same blocker as Review #1 and #2; no progress between attempts.' }
      ]
    }
  },
  {
    id: 'loop: bug already investigated — root cause + fix in comments (real LIN-537)',
    expect: ['implement', 'plan'], loop: true, avoid: 'bug', researchWrong: true,
    why: 'REAL shape (LIN-537): `bug` label, but the comment trail already records a code-grounded investigation naming the root cause AND a minimal fix approach. Step-2 bug guard: the label marks unexpected behavior, not investigation still owed — advance to the fix, do not re-investigate. Tests the loop guard reading the trail from comments, not the description.',
    issue: {
      identifier: 'SYN-18', createdAt: '2026-06-18T07:00:00Z', state: inProgress, labels: ['bug'],
      title: 'Dispatched tasks via autopilot ignore the resolved repo',
      description: 'The fused autopilot dispatch verb does not respect the resolved repo for the task — dispatched items land against the wrong repo.',
      comments: [
        { user: 'agent', createdAt: '2026-06-18T07:38:00Z',
          body: 'Investigation — root cause found (isolated). The fused verb builds the dispatched item with `repo: repo || itemRepo` but the server-resolved repo was discarded one layer up, so the fallback always wins. Confirmed at HEAD by reading the handler and tracing the resolved value. Minimal fix: thread the resolved repo into the item build at that call site. Checked for siblings — this is the only call site with the pattern (isolated, not a class).' }
      ]
    }
  },
  {
    id: 'loop: implementation stuck — 2× same wall, approach is wrong (authored)',
    expect: ['plan', 'research', 'blocked'], loop: true, avoid: 'implement', researchWrong: true,
    why: 'Two implementation recaps both hit the SAME wall: the chosen approach rests on an assumption the code contradicts, and each attempt patches-then-reverts with no forward progress. Repeating implementation repeats the loop; the honest break is to re-ground the approach (plan/research) or surface that it is genuinely blocked — not a third identical attempt.',
    issue: {
      identifier: 'SYN-19', createdAt: '2026-06-12T00:00:00Z', state: inProgress, labels: [],
      title: 'Make the queue consumer process items strictly in dispatch order',
      description: 'Items should be consumed in the order they were dispatched. Update the consumer so ordering is guaranteed end-to-end.',
      comments: [
        { user: 'agent', createdAt: '2026-06-12T10:00:00Z',
          body: 'Attempt 1 — implemented a sort on the consumer side, but the ordering integration test still fails intermittently. The poll endpoint returns items in an order the consumer cannot fully control; sorting after the fact does not hold under concurrent takes. Reverted the sort.' },
        { user: 'agent', createdAt: '2026-06-12T14:30:00Z',
          body: 'Attempt 2 — tried a per-item sequence stamp on the consumer, same failing test. Root issue is upstream: the claim/take step is not itself ordered, so no consumer-side change can guarantee order. The approach in the ticket (fix it "on the consumer") rests on an assumption the take path contradicts. Patched and reverted again — no net progress across either attempt.' }
      ]
    }
  },
  {
    id: 'loop: research redo — findings + approach already in comments (comment-driven trap)',
    expect: ['plan', 'implement'], loop: true, avoid: 'research', researchWrong: true,
    why: 'Comment-driven version of the "research already done" trap: a prior research recap in the trail establishes the findings AND a chosen, validated approach. Re-recommending research loops it; the work should move forward. Proves the engine reads completion evidence from the comment trail, not only from a description block.',
    issue: {
      identifier: 'SYN-20', createdAt: '2026-06-08T00:00:00Z', state: inProgress, labels: [],
      title: 'Cache the recommendation responses to cut latency',
      description: 'Recommendation responses are slow. Reduce the latency.',
      comments: [
        { user: 'agent', createdAt: '2026-06-08T11:00:00Z',
          body: 'Research complete. Traced the latency: the model-generation leg dominates; the data fetch is fast. Considered an in-memory LRU vs reusing the existing hash-keyed cache store. Chosen approach (validated with a spike): reuse the existing recap-style cache keyed by issue id + updatedAt, 10-minute TTL. Feasibility confirmed. Findings and the chosen approach are settled; this just needs building.' }
      ]
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
// lp/lpN = loop-repeat: on a `loop` case, how often the model chose the forbidden
// `avoid` action (i.e. repeated the loop) out of all loop-case runs. Lower is better.
const mk = () => ({ hit: 0, n: 0, rr: 0, rrN: 0, of: 0, ofN: 0, ov: 0, lp: 0, lpN: 0 });
const stats = { A: mk(), B: mk() };

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
    // Loop-repeat: count how often the model chose the forbidden repeat action.
    if (c.loop && c.avoid) { s.lp += res.filter(a => a === norm(c.avoid)).length; s.lpN += K; }
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
console.log(row('loop-REPEAT', (s, raw) => raw ? (s.lpN ? s.lp / s.lpN * 100 : 0) : `${s.lp}/${s.lpN} (${pct(s.lp, s.lpN)})`));
console.log('\nrecall↑ over-fire↓ off-vocab↓ loop-repeat↓ is better. (Δ shown only in AB mode.)');
