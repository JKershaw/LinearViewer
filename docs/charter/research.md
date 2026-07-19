# The Harbour Charter — Research & Reasoning

> **Status: reference material, not adopted.** This document captures the research and the
> form decisions behind [`charter.md`](./charter.md). Neither is in force. We are writing it
> now, while the project is tiny and there's no money to bias the author, so that our
> intentions are on record and we have a concrete thing to argue with later. Dated 2026-07-19.

This is the "why" behind the charter: what actually makes a governing document bind the people
who wrote it rather than decorate them, and how those findings shaped the draft's length, shape,
and clause-by-clause labelling.

---

## Part 1 — Research brief

The question behind the whole exercise is narrow: *what makes a governing document genuinely
bind the people who wrote it, rather than decorate them?* Five bodies of evidence bear on that.

### 1. Cooperative governance: principles as a check against drift, not a vibe

The **Rochdale Principles** (codified by the International Cooperative Alliance, rooted in the
1844 Rochdale Pioneers) are the oldest living answer to "how do you encode *members' interest*
so it doesn't decay into whatever management wanted anyway." The useful reframing from the
literature: the principles are **protective, not merely aspirational** — a continuous check
against the specific failure of a co-op being *captured by outside interests* or drifting from
its members. Three of the seven principles map directly onto Harbour's worries: **members'
economic participation** (surplus is allocated *by rule*, not discretion), **autonomy and
independence** (the 1995 addition, written precisely to stop co-ops that take outside money or
partnerships from losing their member-controlled character — i.e. the acquirer problem), and
**concern for community** (an anchor in a purpose larger than profit).

The most useful concrete precedent is small and specific: the Rochdale Pioneers' 1854 statutes
ring-fenced a fixed **2.5% levy on surplus** for a separate education fund, with its own
committee. That is a 170-year-old example of the exact mechanism Harbour wants for its free
tier — *a fixed slice, set by rule, ring-fenced before profit, for a communal good.*

- *Understanding the Principles of Cooperatives*, Agriculture.Institute — the "protective,
  continuous check against drift" framing.
  https://agriculture.institute/cooperative-and-farmers-organizations/understanding-principles-of-cooperatives/
- *Rochdale Principles: Foundation for Modern Co-operatives*, TheLaw.Institute — on
  autonomy/independence (1995) as a deliberate anti-capture provision.
  https://thelaw.institute/co-operation-genesis-principles-values-growth-and-development/rochdale-principles-modern-cooperatives-foundation/
- *The Rochdale Principles* (principle5.coop) — the 2.5% education-fund levy.
  https://www.principle5.coop/wp-content/uploads/2020/01/The-Rochdale-Principles.pdf

### 2. Open-source governance: BDFL is right *for now*, and what makes it rot

The consensus across the practitioner literature is unglamorous: **most projects start as a
BDFL (benevolent-dictator) model, and small, homogeneous ones should** — committees and
foundations add coordination cost and neutrality that a two-person project doesn't need yet.
Projects *graduate* to open governance as they grow. So building a council now would be
governance theatre for a community that doesn't exist.

But the same literature is candid about how BDFL rots: the founder becomes a **bottleneck**,
and worse, a **"caste system"** forms where non-founders feel they can't change anything against
the founder's vision. The two things that keep a solo maintainer honest are therefore
*external*, not personal: **transparency** (decisions visible and reasoned) and a **credible
exit** (the community can fork). Those aren't nice-to-haves; they are the entire accountability
mechanism when there's no board.

- *Leadership and Governance*, Open Source Guides (GitHub).
  https://opensource.guide/leadership-and-governance/
- *Understanding open source governance models*, Red Hat — the BDFL "bottleneck" and "caste"
  failure modes. https://www.redhat.com/en/blog/understanding-open-source-governance-models
- Scientific Python, *SPEC 9 — Governance* — "most projects start BDFL; smaller, homogeneous
  communities are more suited to it." https://scientific-python.org/specs/spec-0009/

### 3. What makes a constitution endure (and the honest twist on "keep it short")

The best empirical work here is Elkins, Ginsburg & Melton, *The Endurance of National
Constitutions* (Cambridge, 2009) — a dataset of every national constitution since 1789. The
headline is sobering: constitutions are short-lived. Fewer than half survive two decades (the
authors' own framing; popular summaries cite a mean nearer nine to nineteen years — sources
vary, but all are startlingly low). And the punchline that matters for Harbour: **design
choices, not just circumstances, drive survival.** Three design factors correlate with
endurance — **specificity, flexibility (ease of amendment), and inclusiveness.**

Here is the twist, and I want to be honest about it rather than cherry-pick: their data shows
that **longer, more specific constitutions tend to survive *longer*, controlling for other
factors** — which cuts against a naive "short = durable." But the *mechanism* rescues the
instinct. Constitutions endure when they are **self-enforcing**, and self-enforcement requires
**common knowledge**: provisions specific enough that everyone can *recognise a violation* and
coordinate against it (they lean on Michael Chwe's work on focal points and common knowledge).
Specificity matters because it makes breaches **legible**, not because length is a virtue.
Vague length is the worst of both worlds.

So the defensible synthesis for Harbour is: **short, but sharp.** Cut every clause that isn't
load-bearing (length is a genuine cost to being read and understood — the binding constraint at
two people). But whatever survives the cut must be *specific enough that a reader could tell it
had been broken.* That is exactly the project's own "every principle must be observable" rule,
now with a citation behind it. (Inclusiveness is deferred honestly — there's no community to
include yet — and flexibility is handled by making the charter genuinely amendable.)

Illustrative magnitude from the same work: the least-inclusive constitutions averaged ~14
years, the most-inclusive ~69.

- Elkins, Ginsburg & Melton, *The Endurance of National Constitutions* (CUP 2009).
  https://www.cambridge.org/core/books/endurance-of-national-constitutions/CD671879ADBFF7420C25C3707E6135F0
- Ginsburg & Elkins, *The Lifespan of Written Constitutions* — flexibility as
  context-dependent; rigidity survivable only if change is slow.
  https://www.law.uchicago.edu/news/lifespan-written-constitutions
- *The Lifespan of Written Constitutions* (working paper) — specificity → common knowledge →
  self-enforcement (Chwe 2003).
  https://www.lexisnexis.com/documents/pdf/20080806035737_large.pdf
- Book review (Academia.edu) — the 14-vs-69-year inclusiveness figures.
  https://www.academia.edu/8169469/

### 4. Pre-commitment: how you actually bind your future self

This is the theoretical heart of the charter. Jon Elster's *Ulysses and the Sirens* (1979) is
the canonical treatment: a rational agent, while clear-headed, binds their future self against a
foreseen weakness. The practitioner distillations converge on three conditions for a
self-binding commitment to *work*:

1. You must **correctly predict the future weakness** — vague good intentions don't count.
2. The **cost of breaking must be high enough** that future-you treats the constraint as
   binding, not advisory.
3. **The chain can't be slippable in the moment of temptation.** "If everything is instantly
   revocable, nothing is credibly committed."

The design consequence for Harbour is direct and, I think, elegant: **transparency is the
binding mechanism.** An AI has no reputation to lose and a solo maintainer under pressure can
rationalise almost anything — so the charter can't rely on either one's good intentions (that's
the whole premise). What it *can* do is convert private decisions into **public, dated,
reasoned** ones. Publication is the cost. A raise taken quietly costs nothing; a raise that must
be posted with its reasoning before it takes effect, next to the books, is expensive to take
unfairly. The compensation rule, the published overrides, and the waiting period on amendments
are all Ulysses pacts: they don't stop the future self from changing course, they stop it from
changing course *silently and cheaply.*

- Elster, *Ulysses and the Sirens* (CUP 1979/1984).
  https://archive.org/details/ulyssessirensstu0000elst
- *Precommitment*, Lockin glossary — the three conditions.
  https://lockinapp.org/glossary/precommitment
- *Binding Commitments Lens* — "if everything is instantly revocable, nothing is credibly
  committed." https://revisitingssi.com/lenses/briefs/binding-commitments/

### 5. The licence as a structural guarantee, and transparent money as infrastructure

**Licensing.** The licence is the one part of the charter that is *self-executing* — it binds
even people who never read the charter. The tradeoff is real and worth stating plainly.
**Permissive licences (MIT, Apache 2.0)** maximise adoption but let anyone — including a
well-funded cloud host or an acquirer — take the code, wrap it, and sell it as a locked-in
proprietary service without giving anything back. **Network-copyleft (AGPL-class)** closes that
"SaaS loophole": anyone who runs a modified version as a network service must release their
changes to its users, which structurally prevents proprietary capture. The costs of AGPL are
also real: some companies ban it by policy, and critics fairly call aggressive dual-licensing
"license ransomware." Two adjacent points matter as much as the licence choice:

- **Don't rug-pull.** The most-hated move in open source is starting permissive to gain adoption
  and *relicensing later*. Whatever is chosen should be chosen as if permanent.
- **A Contributor License Agreement that assigns copyright to one party is a capture vector** —
  it's exactly what lets a single owner (or an acquirer of that owner) relicense the whole
  project unilaterally. *Not* taking such a CLA is itself an anti-capture commitment.

**Transparent money.** "Open books" isn't aspirational hand-waving; it has mature
infrastructure. **Open Collective / Open Source Collective** give projects public, real-time
budgets and "ring-fenced" sub-budgets for specific purposes, and OSC itself runs on a *fixed,
published* 10% cut for operations — a working precedent for exactly the two money commitments
Harbour wants: a public ledger, and a fixed slice reserved by rule.

- *Why Open Source Isn't Always Fair* — the rug-pull trap and permissive-vs-copyleft tradeoff.
  https://www.architecture-weekly.com/p/why-open-source-isnt-always-fair
- *Open Source License Guide* (2026) — AGPL closes the SaaS loophole; CLAs enable relicensing.
  https://www.opensourcealternatives.to/blog/open-source-license-guide
- Open Collective, *How it works* — public budgets, ring-fenced funds, "you own your data, no
  lock-in." https://opencollective.com/how-it-works
- Open Source Collective — the fixed, published 10% operations model.
  https://oscollective.org/projects/

> **Sourcing caveat (added in review).** Several citations above are secondary explainers
> (agriculture.institute, thelaw.institute, a precommitment glossary). They're fine for a v0.1
> reference, but before any of this is presented publicly as "well-sourced," the primaries
> behind them — the ICA's own principles text, and the actual Elster / Elkins–Ginsburg–Melton
> works — should be cited directly.

---

## Part 2 — Recommendation on form

**Length: short. Target ~1,000–1,500 words for the Charter itself** (the reasoning here is
scaffolding and lives in this separate document). Justification: at current scale — one
maintainer, ~one other user — the binding constraint is *being read and understood.* An unread
charter constrains nothing, and length is the tax on comprehension. The endurance research (§3)
says the way to buy durability *without* buying length is **specificity**: keep the clause count
low, make each surviving clause sharp enough that a breach is visible.

**Complexity: flat and plain.** No sub-bodies, no procedures, no voting machinery for a
community that doesn't exist. One reading level: a smart general reader, not a lawyer. Three
labels, used on every clause so aspiration can't masquerade as commitment:

- **[BINDING]** — a rule with teeth and an observable breach. If you can't say how a reader would
  know it was violated, it doesn't get this label.
- **[PRINCIPLE]** — a stated value that guides judgement but isn't mechanically enforceable.
  Honestly labelled as such.
- **[DEFERRED]** — deliberately not built yet, with the reason why.

**Structure:** a short preamble (what this is and why), then seven short sections — Purpose,
Governance & the human-only line, Transparency, The maintainer's pay, The commons, Open source &
exit, Amendment — then an explicit Deferred list.

**Amendability:** genuinely amendable (rigidity kills documents whose world is changing fast,
and Harbour's is), but amendment is the **highest-scrutiny act**: proposed in public, with
reasoning, after a waiting period, recorded as a new version. Flexible enough to adapt; not
slippable in a weak moment.

**One test applied to every binding clause:** *"How would an outsider know this was broken?"* If
there's no answer, the clause is cut or rewritten.

---

## Review notes that shaped v0.2

The first draft (v0.1) was reviewed against its own "observable breach" test. Five changes
followed, and they're recorded in the changelog at the top of [`charter.md`](./charter.md):

1. **The anti-dark-pattern clause was the weakest binding clause** — its breach ("a change that
   doesn't survive scrutiny") wasn't observable, exactly the failure the closing note predicted.
   Rewritten as a list of mechanical prohibitions.
2. **At two users, transparency is *latent* enforcement, not active** — there's no audience yet
   with the attention and means to hold anyone to it. The preamble now says so plainly: most of
   what binds us today binds us to our *future* selves and users.
3. **The pay interlock depended on ledger granularity §3 didn't mandate.** §3 now requires the
   commons slice and the maintainer's pay to each appear as their own line, so the "pay only
   after the commons is funded" promise is checkable rather than trusted.
4. **"Reversible" was carrying the whole human-only line and was the fuzziest word in the
   document.** It's now defined by blast radius and externally-visible side effect, not "can it
   be undone," with "when in doubt, irreversible."
5. **Data handling was a notable omission** for a tool that reads private repos and issue
   backends. A binding clause on what hosted operation stores, retains, trains on, and shares
   was added.
