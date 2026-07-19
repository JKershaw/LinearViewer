# The Harbour Charter — v0.2 (draft)

> **Status: DRAFT, not adopted.** This is a thing to live with and argue against, not a promise
> in force. It records our intentions while the project is small enough to set them honestly.
> The research and form decisions behind it live in [`research.md`](./research.md). Dated
> 2026-07-19.

**Changes from v0.1 → v0.2** (all from applying the "observable breach" test to the first draft):

1. Hardened the anti-dark-pattern clause (§1) — replaced the un-observable "survives scrutiny"
   breach with mechanical, checkable prohibitions.
2. Added honesty to the preamble that today's transparency is *latent* enforcement — most of
   what binds us now binds us to our future selves and users.
3. Pinned ledger granularity in §3 — the commons slice and the maintainer's pay must each be
   their own line, so the §4 pay interlock is verifiable rather than trusted.
4. Defined "reversible" (§2) by blast radius and externally-visible side effect, not "can it be
   undone" — with "when in doubt, irreversible."
5. Added a binding data-handling clause (§1) for a tool that reads private repos and issue
   backends.

---

## The Harbour Charter, v0.2

**What this is.** Harbour is an open-source control plane for keeping human intent in command of
AI execution. This charter is the promise about *how the project is run* and *who it's run for.*
It binds two parties: the **maintainer** (whoever holds that role — not just today's person) and
the **AI** that does much of the work. It exists because our objective — lasting usefulness to
people, closer to a cooperative than a startup — is easy to state and easy to quietly abandon.
Neither an AI (which has no reputation at stake) nor a maintainer under financial pressure can be
trusted to keep it on good intentions alone. So the charter supplies accountability from
*outside*: it makes our commitments specific enough that you could catch us breaking them, and it
binds the humans at least as tightly as the machine. **Our trustworthiness is meant to come from
transparency and pre-commitment, not from anyone's character.**

We are writing this while the project is tiny and there's no money to bias the author — deciding
the rules before we know which way they'll cut.

**An honest caveat about enforcement.** At today's scale — one maintainer and roughly one other
user — this transparency is mostly *latent* enforcement. There isn't yet a community with the
attention and the means to hold us to these promises, so much of what binds us today binds us to
our *future* selves and our *future* users: publication is a cost we impose now on our own later
defection. The enforcement becomes real as the community does. We'd rather state that than let
the charter overclaim.

---

**1. Purpose — what "utility" means here**

We inherit our definition from cooperative practice rather than inventing a metric. There is
deliberately **no single "utility score"** — a dial is the easiest thing in the world to game.
Instead, utility means concrete things, each observable:

- **[BINDING] It stays genuinely affordable.** The paid tier's price is published, and a free
  tier remains usable for people who can't pay (see §5). *Breach: the free tier disappears or
  becomes unusable, or pricing stops being public.*
- **[BINDING] Users can always leave.** The code stays forkable and self-hostable, with no
  feature held hostage to the hosted version to punish exit (see §6). *Breach: a released
  capability can't be run from public source.*
- **[BINDING] We don't optimise against our users.** Specifically: no forced-continuity billing;
  cancellation is self-serve and takes effect without obstruction; no user data is sold or shared
  with third parties; and no capability is removed from the open-source project in order to push
  people toward the hosted tier. *Breach: any one of those specific things happens, or a shipped
  change makes leaving materially harder with no published, dated reason.*
- **[BINDING] We are careful with what we can see.** Harbour reads private repositories and issue
  backends. Hosted operation stores only what a task needs while it runs, does not retain
  customer content beyond operational need, never uses it to train models, and never shares it
  with a third party. *Breach: customer content is retained past operational need, used for
  training, or shared externally.*
- **[PRINCIPLE] We build for the person steering, not for engagement.** The tool should make one
  human more capable of directing AI work well — not maximise time-in-app or dispatch volume for
  its own sake.

---

**2. Governance — and the line the AI may not cross**

Harbour runs sometimes by hand, sometimes on autopilot with a human in the loop. The AI is
trusted with a lot; it is not trusted with everything.

- **[PRINCIPLE] The AI may** rank the backlog, ground and draft prompts, dispatch work to
  agents, run the autopilot loop, verify work against evidence, propose decisions, and draft
  reports — and may take **reversible** technical actions within pre-agreed bounds (see Open
  Questions).
- **[BINDING] Human-only actions, which the AI may never take alone:** (a) anything
  **irreversible**; (b) **spending or moving money**; (c) **changing prices**; (d) **changing the
  licence**; (e) **cutting a release**; (f) **approving the maintainer's own pay** (see §4); and
  (g) **amending this charter** (see §7). *Breach: any of these happens without a named human
  accountable for it in the public log.*
- **[BINDING] Every human-only action is logged in public with a human's name and a date.**
  *Breach: one of the actions above appears with no public, attributed record.*

> **What "reversible" means here.** Reversibility is judged by **blast radius and
> externally-visible side effect**, not by whether an action can technically be undone. Anything
> that sends a message, posts to a user's tracker, spends money, exposes a secret, or is seen by
> anyone outside the project is **irreversible** for this charter's purposes, even if it can be
> retracted afterwards. **When in doubt, an action is irreversible** and needs a human.

---

**3. Transparency**

Transparency is not a courtesy here; it is the enforcement mechanism for everything else.

- **[BINDING] Open books.** Income and spending are public and updated at least [CADENCE — see
  Open Questions]. The ledger must be itemised enough to check the promises that depend on it:
  the **commons slice (§5) appears as its own line**, and the **maintainer's pay (§4) appears as
  its own line**, so both can be verified rather than taken on trust. *Breach: the books go dark,
  miss their cadence, or fold the commons slice or pay into an unverifiable lump.*
- **[BINDING] Published decisions.** Significant decisions are recorded in a public log with
  their reasoning. *Breach: a §2 human-only action has no entry.*
- **[BINDING] Honest reports, including blind spots.** On a set cadence we publish a report whose
  honest form is always *"here is what we looked at, and here is what we can't see"* — **never
  "all clear."** A report that claims no blind spots is itself a violation of this clause.
  *Breach: a report ships with no "what we can't see" section, or the reports stop appearing.*

---

**4. The maintainer's pay**

The maintainer builds this for love but still has to eat. The risk is not that they're paid —
it's that pay gets decided quietly and grows to fit whatever revenue allows. So pay runs on a
**pre-committed rule**, and there are two very different events:

- **[BINDING] (a) The rule pays more because revenue grew.** Mechanical, low-drama, no approval
  needed — it simply appears as a line in the public books. The rule has two parts: a
  **living-wage floor** (an external benchmark — see Open Questions) that the maintainer is paid
  even in lean months *if funds exist*, and, above the floor, a **capped** share of net revenue
  (the cap — a percentage, a hard salary ceiling, or a multiple of the floor — is an Open
  Question). The maintainer's variable pay is computed **only after the commons slice (§5) is
  funded**, so pay can never be grown by starving the free tier.
- **[BINDING] (b) The maintainer wants to change the rule.** This is a high-scrutiny event. It
  must be **argued in public, published with its reasoning, and subject to the amendment process
  (§7) before it takes effect.** The maintainer **never silently self-approves a raise**, and any
  override of the rule is published with its reasoning *before* it applies. *Breach for the whole
  section: the maintainer's pay changes without either (a) the mechanical rule explaining it in
  the books, or (b) a dated, reasoned, pre-published rule-change.*

---

**5. The commons**

- **[BINDING] A fixed, published slice of revenue is ring-fenced to fund a free tier** for people
  who can't pay — reserved *before* the maintainer's variable pay, not from whatever's left over.
  (Precedent: the Rochdale Pioneers' ring-fenced fund; Open Collective's ring-fenced budgets.)
  The slice's size is an Open Question, but that there *is* a fixed, pre-committed slice is
  binding. *Breach: the free tier is unfunded while variable pay is taken, or the slice stops
  being a visible line in the books.*

---

**6. Open source & the right to leave**

- **[BINDING] The licence is the structural guarantee against extraction.** Harbour is released
  under a licence chosen so that anyone can self-host and fork, and so that **no one — not a
  future maintainer, not an acquirer — can take the code proprietary and lock users in.** (The
  specific licence is the single most important Open Question.) *Breach: a release ships under
  terms that permit proprietary capture or that can't be built from public source.*
- **[BINDING] No relicensing back door.** The project will not require a contributor agreement
  that assigns copyright to a single party in a way that lets it relicense the whole project
  unilaterally. *Breach: such a CLA is adopted.*
- **[PRINCIPLE] Exit now, voice later.** Today the community's power is **exit** — the freedom to
  fork. As a real community forms, we intend to add **voice** — a genuine say in decisions (see
  Deferred).

---

**7. Amendment**

- **[BINDING] This charter is versioned and public, and changing it is the highest-scrutiny act
  in the project.** Any change must be (a) **proposed in public with its reasoning**, (b) held
  for a **waiting period** of [N — see Open Questions] before taking effect, and (c) recorded as
  a **new numbered version with a dated changelog**. Amendment is human-only; the AI may draft
  proposals but may not enact them. *Breach: the charter changes without a public proposal, a
  waiting period, and a version bump.*
- **[BINDING] The core is entrenched.** Two things carry a higher bar (a longer waiting period
  and an explicit, prominent notice): **this amendment process itself (§7) and the anti-extraction
  licence commitment (§6).** These are the clauses whose quiet removal would unravel everything
  else, so they are the hardest to remove quietly. *Breach: either is changed under the ordinary
  process rather than the higher bar.*

---

**Deferred — deliberately not built yet**

- **[DEFERRED] Formal community governance** (councils, voting, elected roles). *Why: there is no
  community to govern. Building this now would be theatre, and the research is clear that small
  projects should stay lightweight and graduate to open governance only as they grow.*
- **[DEFERRED] The mechanism for "voice."** The move from exit-only to a real community say is
  intended, not yet designed. *Why: it should be designed with the community it serves, not for a
  hypothetical one.*
- **[DEFERRED] Succession and multi-maintainer rules.** *Why: there's one maintainer. When
  there's a second, we write how the role passes and how disagreements resolve.*
- **[DEFERRED] Code of conduct and dispute resolution.** *Why: adopt a standard one (e.g.
  Contributor Covenant) when contributors arrive, rather than inventing bespoke machinery now.*

*End of Charter v0.2.*

---

## Open questions for the human

These are the choices the charter deliberately leaves blank because only the maintainer can make
them. Each is a real fork, not a formality.

1. **The licence — the single most consequential decision.** Network-copyleft (AGPL-class)
   maximally prevents extraction but deters some commercial users and can read as unfriendly;
   permissive (MIT/Apache) maximises adoption but permits capture. Which tradeoff fits Harbour's
   soul? And will you commit *now* to treating the choice as permanent (no later rug-pull
   relicensing)?

2. **Compensation inputs.** Three numbers: (a) the **living-wage floor** benchmark — which
   source/locality? (b) the **cap** above the floor — a percentage of net, a hard salary
   ceiling, or a multiple of the floor? (c) the **free-tier slice** — what fixed percentage,
   reserved before variable pay?

3. **Cadences.** How often do the **public books** update, and how often does the **honest "what
   we can't see" report** ship? (Monthly and quarterly are natural defaults, but pick what you'll
   actually sustain — a missed cadence is a visible breach.)

4. **The amendment waiting period.** How many days' public notice before a change takes effect —
   and how much longer for the entrenched core (§6 licence, §7 amendment)?

5. **Where the books and decision log live.** Open Collective (public budgets, ring-fenced funds,
   fiscal hosting) or a public repo you maintain yourself? This determines how cheap "open books"
   is to keep.

6. **The autopilot bounds.** The precise, pre-agreed limits within which the AI may act without a
   human clicking approve — e.g. *never spends money, only reversible actions (as defined in §2),
   only below some blast radius.* The charter names the line (§2); you draw exactly where it sits.

---

*Notes for the next revision: this is a starting point to live with, not a finished
constitution. The two things most worth re-reading before it ever goes public are (a) any clause
that sounds binding but whose breach isn't actually observable, and (b) any number left blank so
long that the "rule" quietly becomes discretion.*
