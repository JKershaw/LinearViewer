# Spike LIN-192: Research should include refactoring recommendations

**Status:** Spike complete — go (reframed)
**Role:** Technical explorer validating feasibility, not implementing the production change.

## The ask (from the ticket)

> Often research uncovers areas of a codebase where some refactoring would improve
> the outcome of the task being researched. Currently our prompts don't include this
> when we create the Research prompt. In addition, often other tasks can be done first,
> making the task more straightforward. Ideally the research (and maybe planning,
> spike, etc) finds these. It could also [be] a stand alone prompt?

Two distinct asks:
1. **Research surfaces refactoring** that would improve the task's outcome.
2. **Research surfaces prerequisite work** ("other tasks done first") so the task
   becomes more straightforward.
Plus an open design question: should this be a **standalone prompt**?

## Staleness check (ticket created 2026-03-02)

The ticket references "our prompts" / "the Research prompt." Per `CLAUDE.md`, prompt
behavior lives in **two paths**:
- Handwritten: `lib/prompt-template-defs.js` (+ `lib/prompt-formatters.js`)
- AI-generated: `lib/prompts/meta-prompt-template.js`

`git log --since=2026-03-02` on those paths shows heavy churn. Re-reading them at HEAD
**invalidates the ticket's core premise.** The ticket assumed *neither* path surfaces
refactoring. That is no longer true.

## Questions answered

### Q1. Does the current research prompt surface refactoring? (both paths)

- **AI path: YES.** `meta-prompt-template.js:197` carries a quality rule:
  > Research prompts must end with a **Surface Assessment**: state explicitly whether
  > the implementation can land cleanly on the current code, or whether a specific
  > minimal refactor would make it land better. Format: `Surface Assessment:
  > [implementation can land cleanly] / [refactor needed: describe the minimal scoped change]`.
- **Handwritten path: NO.** The `research` template (`prompt-template-defs.js:443-496`)
  has no Surface Assessment and never mentions refactoring.

### Q2. Does "do other tasks first" already have a mechanism?

- **AI path: YES.** `meta-prompt-template.js:198` (plan rule):
  > If a Surface Assessment in prior research comments identifies a prerequisite
  > refactor, the plan prompt must encode it as a **separate blocking subtask** using
  > the assessment's description directly — do not absorb the refactor into
  > implementation steps, as that loses the sequencing guarantee.
  `breakdown` then copies `blocked-by` arrows into real relations. That chain *is*
  the "other tasks done first" behavior the ticket asks for.
- **Handwritten path: NO.** The handwritten `plan` template (`:138-225`) has Strategy
  Framing + Scope Assessment + Completeness check, but never consumes a prior-research
  Surface Assessment into a blocking subtask.

### Q3. So what is actually missing?

**Path divergence**, not a missing feature. The design the ticket describes already
exists — but only in the AI/meta-prompt path. The handwritten path lags on both halves
(Surface Assessment in research; prerequisite-refactor → blocking subtask in plan).
This violates the `CLAUDE.md` both-paths rule, and means handwritten/template-based
prompts silently behave differently from AI-generated ones.

### Q4. Standalone prompt — yes or no?

**No (recommended).** A free-floating "scan for refactors / tech debt" prompt cuts
against the system's deliberate design:
- The recommender is **grounded to a single issue** (`meta-prompt-template.js:69-73`
  Grounding Rule) and routes exactly **one** next action. A standalone refactor-hunt
  has no single-issue anchor.
- `docs/recommender-failure-patterns.md` flags **decomposition sprawl** and
  **perpetual preparation** as risks the design works to suppress; an open-ended
  refactor prompt reintroduces both.
The chosen pattern — refactor recommendation rides *inside* research as the Surface
Assessment, then becomes a *blocking subtask* via plan/breakdown — keeps refactors
scoped, sequenced, and auditable. Keep that; do not add a standalone prompt.

### Q5. Minimal change + how to validate?

**Close the divergence**, in two small edits, validated by the existing process
(`docs/prompt-change-validation.md`):
1. Port the **Surface Assessment** into the handwritten `research` template.
2. Port the **prerequisite-refactor → blocking-subtask** rule into the handwritten
   `plan` template (mirror meta-prompt `:198`).
3. Add **structural tests** asserting the directive is present (and, for plan,
   correctly ordered) in **both** paths — none exist today, so even the AI-path rule
   is currently unguarded against drift.
4. Run the offline A/B eval harness (`scripts/eval-completeness-check.mjs`) per the
   validation doc.

## Proof-of-concept

### PoC 1 — Surface Assessment block for the handwritten `research` template

Insert before the `**Output:**` block in `prompt-template-defs.js` research `generate()`:

```js
'### Surface Assessment',
'',
'End your research with an explicit Surface Assessment: state whether the implementation can land cleanly on the current code, or whether a specific minimal refactor would make it land better. The answer must be explicit — not implied — so the plan step can act on it.',
'',
'Format: `Surface Assessment: [implementation can land cleanly]` OR `Surface Assessment: [refactor needed: <describe the minimal scoped change>]`',
'',
'Describe the specific scoped change (not a general tidy-up), or state clearly that no preparation is needed. A prerequisite refactor identified here becomes a separate blocking subtask at the plan step — it is not absorbed into implementation.',
'',
```

And extend the existing Output line so it is captured where plan reads it (a comment):

```js
'- **Comment**: Full research notes, exploration process, sources consulted, and the Surface Assessment',
```

### PoC 2 — consumption rule for the handwritten `plan` template

Mirror `meta-prompt-template.js:198`. Add to the plan Goal (near Strategy Framing):

```js
'If a Surface Assessment in prior research comments identifies a prerequisite refactor, encode it as a **separate blocking subtask** using the assessment\'s description directly — do not absorb the refactor into implementation steps, as that loses the sequencing guarantee.',
```

### PoC 3 — structural test sketch (both paths)

```js
// research Surface Assessment present in BOTH paths
assert.ok(generatePrompt(issue, ctx, 'research').includes('Surface Assessment'));
assert.ok(buildMetaPromptTemplate({ /* ... */ }).includes('Surface Assessment'));
// plan consumes prior Surface Assessment as a blocking subtask in BOTH paths
assert.ok(generatePrompt(issue, ctx, 'plan').toLowerCase().includes('blocking subtask'));
```

## Go / No-go

**GO — reframed.** Do **not** "add refactoring to research" as if from scratch (the
design already exists in the AI path). **Do** close the path divergence: port Surface
Assessment + the prerequisite-refactor→blocking-subtask rule into the handwritten path
and add both-paths structural tests. **No standalone prompt.**

Scope is small (two template edits + tests), low-risk, and has an established
validation process. Suitable for a single implementation ticket.

## Risks & unknowns remaining

1. **Instructed, not enforced.** `recommender-failure-patterns.md:60` notes
   self-verification (incl. Surface Assessment) is instructed in templates, not
   enforced at runtime. Porting it raises coverage but does not guarantee an agent
   produces or acts on a refactor recommendation. No runtime gate exists.
2. **Output routing dependency.** The plan rule reads the Surface Assessment from
   "prior research **comments**." The handwritten research template currently splits
   output (notes → comment, findings/approach → description). The assessment must land
   in the comment (PoC 1 puts it there) — verify this routing during implementation,
   or the plan step won't find it.
3. **Completion signals lag.** `lib/completion-signals.js:119` research signals don't
   mention a Surface Assessment; consider adding one so "research done" includes it.
4. **Overfitting.** Wording must read sensibly for UI, backend, and one-liner tickets
   (validation doc step 3). The meta-prompt wording already generalizes — reuse it
   rather than re-deriving.
5. **Existing AI-path rule is unguarded.** No structural test currently protects the
   meta-prompt Surface Assessment rule; it could silently drift. The recommended
   tests fix this for both paths.
