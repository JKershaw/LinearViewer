# LinearViewer — North Star

*The workspace north star: prose, singular, normative. Native to LinearViewer (not a Linear
primitive). This file is the version-controlled canonical copy; paste it into the Roadmap page's
north-star input (`PUT /workspace/:urlKey/api/roadmap/north-star`) to make it live. The layer-3b
reader (`lib/prompts/roadmap-north-star-template.js`) scores work against it; the same
classification eventually orients the Ship view's FORWARD sector.*

---

LinearViewer exists to keep human intent in command of AI-accelerated execution.

As agents make producing work cheap, the scarce act is no longer doing the work — it is deciding
what is worth doing, and noticing when the body of work has drifted from it. The product's job is
to make two things legible faster than the work can drift: **where the work is**, and **whether it
is pointed somewhere worth going**.

**Forward** work builds or sharpens instruments that surface drift at every altitude — commit,
plan, and backlog — before it compounds, and keeps direction and execution coupled so a human can
continuously and cheaply see whether today's work served the intent.

**Necessary maintenance** is work that keeps the workbench running — auth, storage, sessions,
deploys, bug fixes, refactors — without itself advancing intent-legibility.

**Drift** is capability added without serving intent-legibility: a feature that makes the tool do
more but does not help a human keep execution pointed at intent.

---

## How to read this against the work

The layer-3b reader classifies each project/issue as `aligned` / `necessary maintenance` /
`drift` / `archive candidate` against the phrases above. A correct reading should land, for
example:

- **aligned** — the drift-defense subsystem (LIN-289 and children), the direction layer
  (LIN-273), the model benchmark (LIN-263), the state/direction views.
- **necessary maintenance** — OAuth/PAT, session store, privacy/ToS, refresh-token fixes,
  client-JS refactors.
- **drift** — net-new capability with no intent-legibility purpose.

## Calibration note

This is a v1. It is deliberately specific enough to discriminate (the maintenance-vs-forward split
and the "capability without intent-legibility" test are the discriminators), but some phrases will
still be vague to score against. That is expected: the Roadmap "feedback on the north star" button
exists to surface specificity gaps and sharpen this text over time. The north star is **fixed
until a human deliberately revises it** — the analyzer must never rewrite it to match observed
behaviour (drift-as-rationalization).
