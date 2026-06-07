# Recursive Defer — tree-traversing recommendations resolve a node to its actionable work

## Goal

Make the recursive tree shape of "what's next for this task" structurally present in
the AI recommendation. When you ask for a recommendation on a **node** (a task with
subtasks), the recommender should answer "defer to child X" and the system should
**follow that automatically**, repeating until it reaches the first task whose honest
next action is *real work*. Asking an epic "what's next" then traverses the tree and
returns the actionable task's prompt plus the descent path that led there.

This replaces the current **two-tier blend**, which drills context down to a leaf but
keeps the *action framed at the parent* — producing the hybrid "defer/implement child"
where the parent's "you have a plan, go execute" overrides the child's real need
(usually research or planning). See `lib/openrouter.js` `formatIssueContext` (two-tier
branch) and `lib/prompts/meta-prompt-template.js` (the `SUGGESTED NEXT` injection at
Step 3).

## Background — why this is the right shape

"What's next for this task" sometimes treats the task as a **node** (route down) and
sometimes as a **leaf** (do the work). Today those two answers get fused. A human
navigates the tree by hand: generate the parent's prompt, see it says "implement child",
generate the *child's* prompt instead, see it correctly says "research", and pick that
one. The fix is to make that traversal a property of the tool.

**Defer must be a decision, not an automatic descent.** A node-shaped task does not
always mean "go to a child." Sometimes the honest next action *is* node-level work:

- the epic isn't decomposed yet → `breakdown`
- all children are done → close the parent
- the node is vague → `triage`

So the terminus of the traversal is **"the first task whose next action is real work"** —
usually a leaf, but sometimes a node doing node-work (breakdown / close / triage). Only
the recommender (looking at each node) can tell "descend" from "do node-work" apart; a
deterministic always-descend (today's `selectFocusSubtask`) would wrongly skip a needed
breakdown. `defer` therefore has to be one more action the recommender can *choose or
decline* per node, alongside research / plan / implement.

## Design

### 1. `defer` as a first-class, structured recommender action

Add `defer` to the recommender's bounded action vocabulary (the set
`getAIRecommendationActionNames()` exposes and `isValidDispatchKind` validates). A
deferring recommendation returns a structured target, not a prose marker:

```
{ recommendedAction: 'defer', deferTo: 'ABC-123', reasoning: '<short, one line>' }
```

- **Structured, not regex.** The recursion triggers off the `deferTo` field, never off
  parsing `[DEFER TO ABC-123]` out of prose. The reasoning may *narrate* the defer for
  humans, but format drift in the prose must never break the traversal — same discipline
  that already makes `kind` structured.
- **`defer` is a meta action, resolved server-side before any dispatch.** Like
  `autopilot`, it is never an enqueued step-kind. The recommend path swallows all defers
  internally and only ever returns a *terminal, actionable* recommendation. Nothing
  downstream — including `recommend-and-dispatch` — ever receives a `defer` to act on.

### 2. A deferring recommendation emits **no prompt body**

This is the cost model. The defer decision lives in the (short) reasoning; the (long)
prompt body is the expensive part. A `defer` response **must omit the prompt body** —
it produces only `recommendedAction: defer`, `deferTo`, and a one-line reason. The full
prompt is generated **once**, at the terminal actionable node.

Consequence: descending ~10 layers costs ≈ 10× a short routing reply + 1× a full prompt,
which is dominated by the single terminal prompt. This makes a deep-epic traversal cheap
enough to run inline. The meta-prompt contract must state explicitly: *if you defer, do
not generate a prompt body.*

### 3. Server-side recursion wrapper

One wrapper around the existing recommend path (re-enter `getRecommendation` on
`deferTo`), so **every** surface that calls it benefits:

- `GET /api/proxy/recommend/:identifier`
- `POST /api/proxy/recommend-and-dispatch` (the verb Autopilot drives)
- the human-facing UI recommendation in `routes/workspace-api.js`

Loop, per hop:

1. `fetchRecommendationContext(node)` — its description, children overview, the
   `selectFocusSubtask` suggestion as `SUGGESTED NEXT` (kept as a *seed*; the LLM may
   override, exactly as the meta-prompt already instructs).
2. `getRecommendation(node)`.
3. If `recommendedAction === 'defer'` and within caps → push `node` onto the chain,
   set `node = deferTo`, repeat.
4. Otherwise → terminal. Return the terminal recommendation (with its full prompt and
   `kind`) plus the accumulated chain.

The child the LLM defers to is seeded by `selectFocusSubtask` (in-progress → first
non-blocked todo → first incomplete) and validated/overridden by the LLM — reuse the
existing two-tier machinery, just change what it produces (a defer decision, not a
blended prompt).

### 4. Termination and guards

- **Depth cap** ≈ 10 hops. On cap-hit, stop and return the last node's recommendation
  with a `deferTruncated: true` flag rather than looping.
- **Cycle guard.** Track visited identifiers; a `deferTo` pointing at an already-visited
  node (or upward) terminates with a flag instead of recursing.
- **Missing / invalid child.** A `deferTo` that doesn't resolve, is terminal-state, or
  isn't actually a child → stop at the current node and surface the anomaly (don't crash,
  don't silently swap).
- **Timeout budget.** Each hop is a Linear fetch + an LLM call. `recommend-and-dispatch`
  already runs under `CONTEXT_FETCH_TIMEOUT_MS` + `LLM_TIMEOUT_MS`; the wrapper must
  budget across hops (a shared deadline, not per-call), and on exhaustion return the
  best terminal-so-far with a flag.

### 5. Response shape — keep the descent auditable

The resolved recommendation carries the path, not just the destination:

```
{
  identifier: 'LIN-297',          // the TERMINAL actionable node (fixes today's bug
                                  //   where the parent's identifier was returned)
  recommendedAction: 'research',
  kind: 'research',
  prompt: '<full prompt for LIN-297>',
  deferredVia: ['LIN-318', 'LIN-297'],   // breadcrumb: epic → ... → actionable node
  deferTruncated: false,
  reasoning: '...'
}
```

`recommend-and-dispatch` surfaces the same breadcrumb in the task header it returns to
Autopilot, so a one-liner can read:

```
LIN-318 is a container → descended to LIN-297 (research) · dispatched
```

### 6. Both-paths discipline

Per CLAUDE.md, prompt-behavior changes update both prompt paths:

- **Meta-prompt (AI path)** — `lib/openrouter.js` → `lib/prompts/meta-prompt-template.js`:
  teach the recommender to emit `defer { deferTo }` with no prompt body; add the
  "node vs. node-work vs. defer" decision and the no-body rule to the relevant step.
- **Handwritten action vocabulary** — `lib/prompt-templates.js` /
  `lib/prompt-template-defs.js`: register `defer` in the action/kind vocabulary so
  `deriveKind`/`isValidDispatchKind` recognize it and it can't fall back to `custom`.

(The recursion *orchestration* itself is server code in `routes/proxy.js` /
`routes/workspace-api.js`, shared by both surfaces — not part of either prompt body.)

## Autopilot integration

This dissolves the subtask-altitude problem from the parent thread without any
disposition/handbook change. Autopilot picks **any** task off the stack — node or leaf,
it no longer matters — fires `recommend-and-dispatch`, and the tool traverses to the
actionable node and returns its real prompt + `kind` + the descent. "What altitude do I
aim at" stops being something the light orchestrator has to *hold*; the recommendation
answers it structurally. The descent chain is a legible signal: a run of defers down an
epic is "descending a container that's progressing"; a defer landing on a leaf that then
loops is the thing worth flagging — and the orchestrator reads all of it from the
structured header, never from a prompt body.

## Edge cases

- **Node-work terminus.** Recursion stops the moment a hop returns a non-`defer` action.
  A parent needing decomposition returns `breakdown` and we stop and dispatch *that* —
  we do not descend past it.
- **All children terminal.** The node's honest action is "close the parent"
  (a non-`defer` action); stop there.
- **Read-only runs.** `recommend-and-dispatch` generates write-shaped prompts; read-only
  Autopilot uses plain `POST /dispatch`. The defer traversal is a property of the
  *recommend* path, so read-only behavior is unchanged (a read-only run that wants
  routing must still author its own investigation prompt).
- **Scoped run pinned to a parent.** A human pinning a parent as the goal now gets the
  parent transparently resolved to its actionable descendant, with the breadcrumb shown —
  not a blended parent-framed implement.

## Testing

- Unit: a node whose recommendation is `defer { deferTo: X }` re-enters on X; chain
  accumulates; terminal node's identifier/kind/prompt are returned.
- Unit: depth cap, cycle guard, missing-child, and all-terminal cases each stop with the
  right flag and never throw.
- Unit: a `defer` recommendation carries no prompt body (cost contract).
- Unit (both-paths): `defer` is a valid kind in `isValidDispatchKind`; `deriveKind`
  resolves it (not `custom`).
- Structural: `recommend-and-dispatch` response includes `deferredVia` and the terminal
  (not parent) `identifier`.
- Eval: extend the offline harness so a parent-with-research-needing-leaf resolves to
  `research` at the leaf, not `implement` at the parent (the regression this fixes).

## Out of scope / future

- Caching context fetches across hops (the per-hop Linear call is the latency cost; a
  later optimization, not needed for correctness).
- Surfacing the descent visually in the human swipe/foreman UI beyond the breadcrumb
  string.
- Periodicals/precedence interactions (tracked separately).

## Acceptance criteria

1. Requesting a recommendation on a parent returns the **actionable descendant's** prompt
   and `kind`, with `deferredVia` naming the path — never a parent-framed "implement the
   child" blend.
2. A node whose real next action is node-work (`breakdown`/close/`triage`) is **not**
   descended past; it is returned as the terminus.
3. `defer` never reaches dispatch as a kind; it is resolved entirely inside the recommend
   path.
4. Deferring replies emit no prompt body; a ~10-deep descent stays within the existing
   `recommend-and-dispatch` timeout budget.
5. Depth cap, cycle, missing-child, and all-terminal cases each terminate safely with a
   flag.
6. Both prompt paths know `defer`; Autopilot's header/narration shows the descent.
