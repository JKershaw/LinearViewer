# Validating prompt-system changes (a repeatable process)

This documents the process we used to turn a retro finding into a validated change
to the prompt templates. It is deliberately high-level — a checklist and the
reasoning behind each step, not a rigid script. Use it whenever a retro (or a bug,
or a review) suggests the prompts themselves should change.

The worked example throughout is **LIN-295**: a retro found that the plan that
drove the work declared "blast radius confined" after grepping the *class name* the
ticket cited, missing two sibling surfaces that implemented the same feature under
different names. The fix was a "Completeness check" directive added to the plan
prompt; this doc is how we got from finding → shipped-and-measured change.

## The loop

```
retro finding ──▶ does this live in our own tooling? ──▶ change BOTH prompt paths
      ▲                                                          │
      │                                                          ▼
   re-measure ◀── behavioral A/B eval ◀── structural tests ◀── guard against overfitting
```

### 1. Promote the finding from "this task" to "the system"

A retro normally produces a lesson about one task. Before filing it away, ask:
**does this failure mode live in our own tooling?** Harbour *generates* the
plan prompts that shape how work is planned — so "the plan missed sibling surfaces"
wasn't just a LIN-295 mistake, it was a gap in the plan template. The highest-value
retro outcomes are the ones you can push upstream into the prompts so the whole
fleet benefits, not just the next person who reads the ticket.

### 2. Change both prompt paths

Per `CLAUDE.md`, prompt behavior lives in two places and both must change together:

- **Handwritten**: `lib/prompt-template-defs.js` (+ shared blocks in
  `lib/prompt-formatters.js`), assembled by `generatePrompt()`.
- **AI-generated**: `lib/prompts/meta-prompt-template.js` (the meta-prompt's
  quality rules), consumed via `lib/openrouter.js`.

A change in only one path silently diverges the two.

### 3. Guard the wording against overfitting

A directive written straight off a single incident tends to encode that incident's
shape. LIN-295 was a UI bug, and the first draft said "rendered markup / label" —
useless for a backend ticket. Generalize:

- Name the **failure mode** abstractly (e.g. "the same concept implemented in more
  than one place under a different name"), not the domain it showed up in.
- **Verify against diverse cases** by reading the wording as if attached to 3–4
  unlike tickets (UI, backend "apply to all X", a cross-path change, a trivial
  one-liner). It should read sensibly for each.
- Add a **guard against misfiring** on the common case (e.g. "a genuinely
  single-surface result is valid") so the directive doesn't manufacture work where
  there is none.

### 4. Add structural tests (cheap, deterministic)

Assert the directive is present, and ordered correctly, in **both** paths. These
catch regressions and accidental divergence but prove nothing about behavior — see
`tests/unit/prompt-templates.test.js` (handwritten) and the
`buildMetaPromptTemplate` assertions in `tests/unit/openrouter.test.js` (meta).

### 5. Measure behavioral impact (an offline A/B eval)

Structural tests prove the words are there; an A/B eval estimates whether the words
change model behavior. The harness is `scripts/eval-completeness-check.mjs` (plan
breadth-awareness); `scripts/eval-research-routing.mjs` (research routing) and
`scripts/eval-review-closeout.mjs` (LIN-550 — whether the review ledger adds *noise*
on self-contained, CI-covered tasks) are sibling harnesses cut from the same pattern
when a directive lives in a different prompt with a different metric. Adapt the cases
for other directives. The design rules that made it trustworthy:

- **The prompt is the only variable.** Arm B = the live prompt; arm A = the same
  prompt with the one directive stripped. Nothing else differs.
- **Don't pre-solve the evidence.** Our first attempt handed the model snippets from
  every surface — both arms scored 100% (a ceiling effect). A "go and search"
  directive can only be measured when the answer is *not* already in context. Match
  the eval's evidence to the regime the directive targets: give only what the author
  saw (a clean grep of the cited symbol + a file tree with no contents) and measure
  the **decision to search**.
- **Use a real gold case with known ground truth.** A ticket where the failure
  actually happened, where you know the full surface set.
- **Grade with a constant LLM judge** on a strict YES/NO rubric. Hold the judge
  model fixed even when you vary the generator, so cross-model numbers compare.
- **Run k× across replications; report rate and Δ**, not a single sample.
- **Test more than one model** — a consumer-representative one and a frontier one.
  Stronger models often have a higher baseline (they sometimes do the right thing
  unprompted) *and* follow the directive better; reporting both shows whether the
  change is a crutch for weak models or a genuine lift everywhere.

**Read the result honestly.** It is a **lower bound**: a single call can't use
tools, so it measures the decision to search, not the search itself — real agents
that can grep should do better. It is also **model- and sample-dependent** and
usually **small-n**. Treat it as directional evidence, not a precise estimate.

### 6. Be price-conscious

Eval calls cost money. Pick the **decisive case** (the one with the cleanest
baseline), use a **smaller K** for a first read, keep the **judge on a cheap model**,
and add replications only to firm up a number that already looks directional. Don't
run a frontier model 3× before you've seen the signal once.

## Worked numbers (LIN-295 completeness check)

`scripts/eval-completeness-check.mjs`, judge held on `claude-haiku-4.5`:

| Generator | Arm A (no check) | Arm B (+check) | Δ |
|---|---|---|---|
| `claude-haiku-4.5` (n=30) | 0% | 43% | +43 pts |
| `claude-opus-4.8` (n=16)  | 19% | 69% | +50 pts |

Reading: the unmodified prompt almost never flagged the breadth risk on this case
(0% / 19%); the directive lifted that to 43% / 69%. The lift held — and grew — on
the frontier model, so it is a genuine improvement rather than a weak-model crutch.
It is not a guarantee (Opus + directive still missed ~31%), consistent with this
being a lower-bound measurement.
