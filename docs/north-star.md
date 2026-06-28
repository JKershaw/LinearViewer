# Harbour — North Star

*The workspace north star: prose, singular, normative. Native to Harbour (not a Linear
primitive). This file is the version-controlled canonical copy. To make it live, paste **only the
fenced "Live text" block below** into the Roadmap page's north-star input
(`PUT /workspace/:urlKey/api/roadmap/north-star`). The framing around that block is documentation
for humans and is deliberately **not** part of the live text — the live string is injected verbatim
into the roadmap LLM calls, so process/meta prose there would only become citable noise the model
must wade through.*

*The layer-3b reader (`lib/prompts/roadmap-north-star-template.js`) scores work against it into the
4-class taxonomy (`aligned` / `necessary maintenance` / `drift` / `archive candidate`); the
orientation reader (`lib/prompts/roadmap-orientation-template.js`) maps each task onto the 8-point
compass (N…S, plus OFF) that drives the Ship view's FORWARD sector. The orientation reader sees the
**raw** north star only — never the 4-class prose — which is why the live text below names each
class's compass bearing inline, so the two taxonomies cannot drift apart.*

*The north star is **fixed until a human deliberately revises it**. The analyzer must never rewrite
it to match observed behaviour (drift-as-rationalization); that guard is enforced as instruction in
every consumer prompt. The Roadmap "feedback on the north star" button exists to surface
specificity gaps and sharpen this text over time.*

---

## Live text (paste this block)

```
Harbour keeps human intent in command of AI-accelerated execution.

When agents make producing work cheap, the scarce act is no longer doing the
work — it is deciding what is worth doing, noticing when the body of work has
drifted from it, and staying able to steer. Harbour makes three things legible
and controllable faster than the work can drift: where the work is, whether it
is pointed somewhere worth going, and whether a human can still read and
redirect it.

Forward (compass N) — work that builds or sharpens the instruments that keep
intent in command: surfacing drift at every altitude (commit, plan, backlog)
before it compounds; coupling direction to execution so a human can cheaply see
whether today's work served the intent; making the command surface legible and
steerable — read what is in flight, intervene, and choose what runs next; and
making completeness verifiable, so finished work cannot silently miss what it
was for.

Necessary maintenance (compass E/W, off the direct line) — work that keeps the
workbench running: auth, storage, sessions, deploys, providers, security
hardening, bug fixes, refactors. Required, but it does not itself advance
intent-command.

Drift (compass S, points away) — capability added that makes the tool do more
without helping a human keep execution pointed at, and able to steer toward,
intent.

Archive candidate (compass OFF) — work that neither serves the north star nor
keeps the workbench running. Consider stopping it.

The test that separates Forward from Drift: does this make a human better able
to see where the work is, judge whether it is worth doing, and redirect it? If
yes, Forward. If it only adds capability, Drift. If part of this north star is
too vague to score a given task against, say so plainly rather than stretching
the call.

Worked examples:
- Forward — the drift-surfacing periodicals and trajectory reviews; the
  roadmap / north-star alignment layer; the suggested-next-run chooser and the
  in-flight chat that let a human watch and steer (LIN-603 / LIN-751);
  verifiable close-out that proves nothing was missed (LIN-550 / LIN-554 /
  LIN-604).
- Necessary maintenance — OAuth / PAT, the session store, the provider
  abstraction and GitHub backend, attachment relay, security hardening, the
  dispatch runner.
- Drift — net-new capability with no intent-command purpose.
- Archive candidate — a surface that serves neither intent nor the workbench.
```

---

## Why this shape (ingestion notes)

The live text is built for how the roadmap layer actually consumes it (verbatim injection, no
structural parsing):

- **Discrete, quotable, atomic phrases.** Every consumer is instructed to cite *a specific north
  star phrase* per call; self-contained clauses are citable, flowing prose forces invented
  paraphrases that can't be pinned.
- **The two taxonomies are bridged inline** (Forward = N, maintenance = E/W off-line, drift = S,
  archive = OFF), because the orientation/compass reader only ever sees the raw text.
- **One sharp discriminator is kept** (the Forward-vs-Drift test) — the load-bearing call the
  system leans on — plus an explicit "too vague to score" escape so the model refuses rather than
  fudges.
- **Worked examples key to live ticket IDs** — effectively few-shot grounding.
- **Steerability and verifiable completeness are named as Forward intent**, not left to the
  backlog — otherwise the analyzer scores them as mere maintenance. These reflect the current
  frontier: the human reading *and redirecting* the loop (the chat-driver direction), and finished
  work that cannot silently miss a section.

> **Known mechanical gap (not a wording problem):** the suggested-next-run chooser does **not**
> ingest this north star directly — it sees only a lossy, alignment-stripped digest echo of a recent
> roadmap report. Threading the north-star reading into the next-run context is a code change, not a
> redraft. Tracked separately.
