#!/usr/bin/env node
/**
 * Build the LIN-3107 widened routing fixtures under `scripts/eval/fixtures-widened/`.
 *
 * Mirrors the build-recommend-fixtures.mjs / build-routing-fixtures.mjs recipe: the
 * frozen files are committed, so this builder runs token-free on a fresh clone. It
 * reshapes the committed raw captures in `_source/` into the exact context-bundle
 * shape `getRecommendation` consumes, and hand-builds the two synthetic construction
 * cases. The existing frozen `scripts/eval/fixtures/` directory is READ-ONLY here.
 *
 * Classes produced (class D of the plan's widening set):
 *   • LIN-830.json          — 2 targets from LIN-830's own two recorded override
 *                             comments (not LIN-838's description): @implement and @review.
 *   • LIN-1084.json         — 1 target, frozen at its recorded close-out-vs-review miss.
 *   • breakdown-fork-neg.json — synthetic, contract-safe LIN-838-recipe negative.
 *   • all-terminal-node.json  — synthetic node whose children are all terminal (the
 *                             defer-must-NOT-fire case; no committed bundle has one).
 *
 * Freeze semantics: a target's visible state is `description as filed` + every comment
 * STRICTLY BEFORE the recorded override moment that establishes gold. The override
 * comment itself is the gold provenance, never part of the state the engine saw.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, 'fixtures-widened', '_source');
const OUT = join(HERE, 'fixtures-widened');

const STARTED = { name: 'In Progress', type: 'started' };
const DONE = { name: 'Done', type: 'completed' };

const readSource = (id) => JSON.parse(readFileSync(join(SRC, `${id}.json`), 'utf8'));

/** Shape a raw capture issue-slice into the bundle's `issue` field (forced `started`). */
function issueFrom(src) {
  return {
    id: src.identifier,
    identifier: src.identifier,
    title: src.title,
    description: src.description,
    state: { ...STARTED },
    createdAt: src.createdAt,
    labels: src.labels || [],
  };
}

/** Leaf bundle: description + comments strictly before `freezeTs`; no children/focus. */
function leafBundle(src, freezeTs) {
  const comments = (src.comments || [])
    .filter((c) => new Date(c.createdAt) < new Date(freezeTs))
    .map((c) => ({ body: c.body, createdAt: c.createdAt, user: c.user }));
  return {
    issue: issueFrom(src),
    parent: null,
    siblings: [],
    siblingsTotal: 0,
    project: src.project ? { name: src.project.name, description: null } : null,
    children: [],
    comments,
    focusedChild: null,
  };
}

// ── Real freezes (class D) ───────────────────────────────────────────────────────────────────
const FREEZES = {
  'LIN-830@implement': {
    source: 'LIN-830', at: '2026-06-30T15:59:54.405Z', expect: ['implement'],
    role: 'real leaf @ routing miss #1 — engine picked `breakdown`, correct is a single-session meta-prompt implementation (LIN-838 overfit positive); no children, no independently-landable phase structure',
    goldSourceComment:
      'LIN-830 override #1, 2026-06-30T15:59:54.405Z ("engine picked `breakdown` → stepping as `implementation`"). ' +
      'CONTRACT CHECK (today, LIN-1603): LIN-830 has 0 children and no plan-review verdict on its trail; its ' +
      '"needs multiple sessions" text is a QUOTE of the meta-prompt, not a session-fit answer for its own scope — ' +
      'override #1 says it has "no independently-landable multi-session phase structure". Criterion (a) therefore does ' +
      'NOT fire; `implement` is unambiguous gold under today\'s contract.',
  },
  'LIN-830@review': {
    source: 'LIN-830', at: '2026-06-30T16:52:21.983Z', expect: ['review'],
    role: 'real leaf @ routing miss #2 — after implementation landed (PR #698, CI green @ f4bf5ba) the engine picked `close-out`; no review verdict was on record, so the fresh-eyes gate must run first',
    goldSourceComment:
      'LIN-830 override #2, 2026-06-30T16:52:21.983Z ("engine picked `close-out` → pinning `review`"). ' +
      'CONTRACT CHECK (today, LIN-1603): criterion (a) does not fire (same reason as @implement). `review` is sound: ' +
      'the PR was open, unmerged and CI-green (`f4bf5ba`) with no Approve on record; the subsequent review at 16:57 ' +
      'confirms "the `review` pin was correct". Freeze composition = description + override #1 + exactly THREE ' +
      'intervening comments (16:06:32, 16:43:11, 16:49:46).',
  },
  'LIN-1084': {
    source: 'LIN-1084', at: '2026-07-06T10:47:57.757Z', expect: ['review'],
    role: 'real leaf @ close-out-vs-review miss — implementation landed (PR #828, CI green) but no review verdict on trail; `recommend-and-dispatch` picked `close-out` (the irreversible merge+Done), correct is `review`',
    goldSourceComment:
      'LIN-1084 autopilot note, 2026-07-06T10:47:57.757Z ("picked `close-out` here even though no review verdict exists yet"). ' +
      'CONTRACT CHECK (today, LIN-1603): its plan touched dispatch-contract surfaces (criterion (d)) at PLANNING time, but ' +
      'the freeze point is post-implementation, at the review-vs-close-out fork the gate does not govern; `review` holds.',
  },
};

function buildReal() {
  // Emit one file per source group.
  const groups = {
    'LIN-830.json': ['LIN-830@implement', 'LIN-830@review'],
    'LIN-1084.json': ['LIN-1084'],
  };
  const out = [];
  for (const [file, ids] of Object.entries(groups)) {
    const bundles = {};
    const targets = [];
    for (const id of ids) {
      const cfg = FREEZES[id];
      bundles[id] = leafBundle(readSource(cfg.source), cfg.at);
      targets.push({
        id, role: cfg.role, expect: cfg.expect, descentExpect: id,
        labelledBy: 'LIN-3107 implementation (real Linear history via workspace proxy)',
        goldSourceComment: cfg.goldSourceComment,
      });
    }
    const fixture = {
      name: file.replace(/\.json$/, ''),
      note: 'LIN-3107 widened class D (real tracker history). Frozen from the committed raw capture in ' +
        '_source/ at the recorded override moment; the override comment is gold provenance, not visible state. ' +
        'Regenerate with scripts/eval/build-widened-routing-fixtures.mjs.',
      targets,
      bundles,
    };
    writeFileSync(join(OUT, file), JSON.stringify(fixture, null, 2) + '\n');
    out.push(`${file} (${targets.length} target${targets.length > 1 ? 's' : ''})`);
  }
  return out;
}

// ── Synthetic class D ────────────────────────────────────────────────────────────────────────
/**
 * LIN-838 recipe negative, built CONTRACT-SAFE. LIN-838 gift-wraps "a genuine multi-session
 * task with an enumerated plan + arrows → must STILL pick breakdown". Built literally with no
 * plan-review verdict it would hit the LIN-1603 criterion-(a) trap (an explicit multi-session
 * answer with no verdict routes to `plan-review` today). As NEW construction we instead attach
 * a recorded plan-review Approve verdict to the trail (mirroring the committed
 * PR-1603-verdict-approve pattern) so `breakdown` is unambiguous under today's contract.
 */
function breakdownForkNeg() {
  const issue = {
    id: 'breakdown-fork-neg-uuid',
    identifier: 'breakdown-fork-neg',
    title: 'Split the workspace provider layer into independently-landable phases',
    description: `## Implementation Plan

- Surfaces: \`lib/provider/adapter.js\` (the interface), \`lib/provider/linear.js\` and
  \`lib/provider/github.js\` (the two implementations), the workspace resolver, and the
  credential store.
- Arrows: adapter interface → both implementations (blocked-by the interface landing);
  resolver wiring → adapter (blocked-by both implementations); credential-store scoping →
  resolver (blocked-by resolver wiring).
- This is a genuine multi-session migration: the interface landing, each provider port, and
  the resolver/credential re-scoping each land independently with their own acceptance.

**Session fit:** needs multiple sessions — five surfaces with dependency arrows; no single
focused pass can land them coherently.

**plan-review due:** yes — (d) the credential-store re-scoping touches a credential surface.`,
    state: { ...STARTED },
    createdAt: '2026-07-01T00:00:00.000Z',
    labels: [],
  };
  const bundle = {
    issue,
    parent: null, siblings: [], siblingsTotal: 0,
    project: { name: 'Product', description: null },
    children: [], comments: [
      {
        user: 'reviewer', createdAt: '2026-07-01T01:00:00.000Z',
        body: `### Plan Review Verdict

1. Completeness — the surface list matches the tree (\`lib/provider/\`, the resolver, the
   credential store are the only seams).
2. Strategy framing — no routed-around contract gap.
3. History — checked; nothing protects an invariant the plan misses.
4. Session fit — the five dependency-arrowed surfaces genuinely span sessions.
5. Relaxation guard — the credential-surface change is named.
6. Prerequisite refactor — none claimed.

**Verdict: Approve.** Proceed; decompose into per-surface subtasks.`,
      },
    ],
    focusedChild: null,
  };
  writeFileSync(join(OUT, 'breakdown-fork-neg.json'), JSON.stringify({
    name: 'breakdown-fork-neg',
    note: 'Synthetic LIN-3107 class D. The LIN-838-recipe negative (a genuine multi-session plan ' +
      'with enumerated arrows → breakdown), built contract-safe: it carries a recorded plan-review ' +
      'Approve verdict on its trail, so criterion (a) is already discharged and `breakdown` is ' +
      'unambiguous under today\'s LIN-1603 contract. Recipe source: LIN-838 description ' +
      '(2026-06-30T15:02:18.930Z) plus the LIN-3107 plan §6 D.4 contract-safety amendment.',
    targets: [{
      id: 'breakdown-fork-neg', role: 'genuine multi-session plan + dependency arrows + plan-review Approve → expect breakdown',
      expect: ['breakdown'], descentExpect: 'breakdown-fork-neg',
      labelledBy: 'plan LIN-3107 (§6 D.4)',
      goldSourceComment: 'LIN-838 description ("Negative (must STILL pick `breakdown`): a genuine ' +
        'multi-session task with an enumerated plan + arrows") + LIN-3107 plan §6 D.4 (contract-safety: ' +
        'attach a recorded plan-review Approve so LIN-1603 criterion (a) does not re-route to plan-review).',
    }],
    bundles: { 'breakdown-fork-neg': bundle },
  }, null, 2) + '\n');
  return 'breakdown-fork-neg.json (1 target)';
}

/**
 * All-terminal-children node: children non-empty but every child terminal, so there is NO
 * real non-terminal child. The eval defer rule makes `defer` ineligible; the node's own
 * work is finished, so the honest next action is review/close, never a descent.
 */
function allTerminalNode() {
  const children = [
    { id: 'atn-c1', identifier: 'ATN-1', title: 'Phase 1 — interface', state: { ...DONE } },
    { id: 'atn-c2', identifier: 'ATN-2', title: 'Phase 2 — port', state: { ...DONE } },
  ];
  const issue = {
    id: 'all-terminal-node-uuid',
    identifier: 'all-terminal-node',
    title: 'Provider migration (subtasks all completed)',
    description: 'Parent task whose child subtasks have all been completed. Verify the aggregate result and close it out.',
    state: { ...STARTED },
    createdAt: '2026-07-02T00:00:00.000Z',
    labels: [],
  };
  const bundle = {
    issue,
    parent: null, siblings: [], siblingsTotal: 0,
    project: { name: 'Product', description: null },
    children,
    comments: [
      { user: 'agent', createdAt: '2026-07-02T01:00:00.000Z', body: 'Both phases completed and merged (PR #901, CI green). Nothing open on either child.' },
    ],
    focusedChild: null, // no non-terminal child to focus
  };
  writeFileSync(join(OUT, 'all-terminal-node.json'), JSON.stringify({
    name: 'all-terminal-node',
    note: 'Synthetic LIN-3107 class D. A node whose children are ALL terminal — the defer-must-NOT-fire ' +
      'case no committed bundle covers. Under the eval defer rule (eligible only with a real non-terminal ' +
      'child) `defer` is withheld at prompt time for arms 1/2 and graded a miss for arm 3, so the graded ' +
      'action is review/close-out.',
    targets: [{
      id: 'all-terminal-node', role: 'node with all-terminal children — defer ineligible; terminal-completion routes to review/close',
      expect: ['review', 'close-out'], descentExpect: 'all-terminal-node',
      labelledBy: 'plan LIN-3107 (§6 D node/`defer` coverage)',
      goldSourceComment: 'Synthetic. Live contract (meta-prompt Step 0, LIN-353): a task whose own state is ' +
        'terminal OR whose every subtask is terminal routes to review/close, never a no-op. No committed fixture ' +
        'has an all-terminal-children node; constructed to exercise the defer-ineligibility branch.',
    }],
    bundles: { 'all-terminal-node': bundle },
  }, null, 2) + '\n');
  return 'all-terminal-node.json (1 target)';
}

// ── main ─────────────────────────────────────────────────────────────────────────────────────
mkdirSync(OUT, { recursive: true });
const built = [...buildReal(), breakdownForkNeg(), allTerminalNode()];
for (const b of built) console.log('wrote', b);
console.log('Done. Widened fixtures committed under scripts/eval/fixtures-widened/.');
