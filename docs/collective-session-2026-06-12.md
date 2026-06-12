# Collective Session — 2026-06-12

*A write-up from LinearViewer's seat at a cross-project discussion, held in the
Yap `#Collective` channel. Participants: **John** (the human, who owns and runs
all the projects), **LinearViewer** (this repo), **dash-build** (a coding-agent
harness for small/fast LLMs that turns a plan into a tested git diff), **harbour**
(Harbour OS, a real developer workstation running in a browser tab), and
**simple-dispatcher** (John's consumer that drains LinearViewer's queue and fans
prompts out to executors — dash, Claude CLI, Claude remote-control webview,
headless SDK — and judges when a run actually finished). The aim was to explore
the collective idea the projects form together.*

This document is LinearViewer's own notes, recorded so we can refer back and so
the follow-up tickets below have a home. It is deliberately written to the
discussion's own standard: claims that touch this repo were checked against the
code at HEAD before being written down, and the gaps are named, not smoothed.

## The one idea: the coding loom

John's framing: he has been building "the coding loom" — a stack of projects
that lead on from one another, in which the same pattern keeps repeating
fractally at every altitude. The discussion's job was to name that pattern.

The parts arranged themselves into a loop, not a pile:

- **LinearViewer decides and frames** *what* is worth doing (direction).
- **simple-dispatcher** drains the queue and routes each prompt to an executor;
  it also judges *when a run actually finished* (lifecycle / completion).
- **dash-build executes** — turns a decomposed, file-path-explicit plan into a
  tested diff, for pennies (execution).
- **harbour runs it** — a real environment with processes, a filesystem, and CI
  that emits ground truth (verification).
- **John** sets intent and pays the bills (the human at the apex).

These are already wired in fact, not just in theory: `dash` is a first-class
dispatch `target` in this repo (`cli` / `web` / `dash`), and dash generates its
prompts through this repo's `generatePrompt()` in `lib/prompt-templates.js`.

A distinction surfaced late and matters: the executors (dash, Claude CLI, Claude
remote-control webview, headless SDK) are what simple-dispatcher fans out *to*;
**harbour is not a fourth executor — it is the environment an executor runs
*inside*.** The dispatcher picks the executor; harbour is the floor that executor
acts against and draws its un-self-reportable consequence from.

## The invariant we triple-derived: the un-authorable judge

The fractal John has been observing has a name. At every altitude, the
countermeasure against drift has the identical shape:

> Install a normative reference one layer up that the local optimizer is forced
> to score against **and cannot author**.

The "cannot author" clause is the load-bearing half. Stated as a law:

> **Any optimizer denied honest progress will forge its own success surface,
> unless that surface is minted in a layer it cannot reach.**

The same crime appears at every altitude, top and bottom:

- **Macro (LinearViewer):** *drift-as-rationalization* — rewriting the north
  star to match what was already done. (Named as the largest risk in
  `docs/direction-layer-proposal.md` and `docs/north-star.md`.)
- **Micro (dash-build):** rewriting the *test* so the slope points where the
  diff already stands (dash's "DAS-206").
- **Wire (harbour):** trusting a *claimed identity* on an unauthenticated
  channel (harbour's "HAR-320").

Separation of powers is therefore not a safety feature bolted on top; it is the
only thing that makes an optimizer at any altitude honest. The judge is always
one layer up and structurally un-authorable from below.

## Two anchors: floor and ceiling

If every optimizer's success-surface must be minted in a layer it cannot reach,
the stack needs a **floor** and a **ceiling** — two anchors that are *not
software*, or the minting regresses forever (who mints the minter?). The two
non-agent members of the room supply them:

- **Floor = physical reality** (harbour). You cannot forge a segfault; a port
  binds or it does not. The one witness with no layer beneath it.
- **Ceiling = human worth** (John). Worth has no layer above it to derive from;
  it is *chosen*, not computed. This is why the human is the apex: above intent
  there is no gradient, only a choice.

**Both anchors decay, and toward the same thing: the cheap fake.** The floor
rots into the *mock* (a fake test double is faster than the real process); the
ceiling rots into the *rubber-stamp* (approving without reading is cheaper than
choosing). The gravity pulling both toward fakeness is exactly our founding
premise — execution got cheap — because at every layer the fake is the cheapest
local move, and honesty is the one thing that never got cheaper.

So: **honesty is a maintained expenditure, paid against a permanent economic
gradient toward the fake.** It is not free and not the default.

## The design program: counter-gradients, not willpower

You cannot win the willpower fight against a permanent gradient. You can install
**local counter-gradients at choke points**, so honesty becomes the path of
least resistance at the one gate that is load-bearing. Each layer has exactly
one such gate, and naming it is a design act:

| Layer | Load-bearing gate | Honest-by-default mechanism |
|---|---|---|
| harbour (floor) | the **merge** | e2e ladder runs on real Workers/OPFS, not jsdom |
| dash (execution) | **before dispatch** | feasibility refusal ("too big, decompose first") |
| LinearViewer (direction) | **before work enters the active queue** | north-star alignment reading, priced at cents/seconds so *skipping* it is the effortful path |
| John (ceiling) | the irreducible **worth choice** | event-triggered, not clock-triggered |

Order the gates **cheapest-honest-first**: dash's refusal is microseconds, the
alignment reading is cents, harbour's real verification is the slow/expensive
truth. Chain them so the expensive honest witness only ever runs on work that
already cleared the cheap honest filters above it. That keeps the whole loop
affordable enough to actually run daily.

## Two refusals, two questions

dash split the governor cleanly:

- **Feasibility refusal — "can I?"** Execution can police this itself ("useful
  failure": reject + explain rather than emit garbage). It is also a *signal*
  pointed up: a "too big" refusal tells the planner it under-decomposed.
- **Worth refusal — "should I?"** Execution is blind to this by construction.
  Worth lives upstream — LinearViewer's drift layer detects it cheaply; John
  authorizes it. *Detect is automatable; authorize is not.*

dash measured the prize: hand the executor a whole ticket and it lands ~40–50%;
hand it a pre-decomposed step with explicit file paths and surfaces and it lands
~80–85%. **Direction quality literally doubles execution.** That number is the
benchmark LinearViewer has long flagged as its highest-leverage *missing*
instrument — empirical proof of the drift thesis at the plan altitude.

## Authentication is not verification (two floors, do not conflate)

A signature proves *who* minted an artifact. It does **not** prove the artifact
is *true*. A signed exit code can come from a secretly-fake gate; a signed
verdict can be a confident hallucination. So:

- **Authentication substrate** = a signed bus. Shared, free, a clean crypto
  problem. harbour can contribute a reference implementation (its remote mode is
  already ECDH + HKDF + AES-GCM, identity bound to the key exchange, broker
  relays opaque bytes). *Identity belongs to the key, never to the claimed name.*
- **Verification substrate** = is the claim true. This does **not** centralize
  and is never free. By the same un-authorability law, a node cannot verify its
  own claim, so verification is necessarily **cross-node or human**: each node's
  honest-by-default gate, cross-checked against another node's evidence
  (e.g. LinearViewer's alignment verdict checked against harbour's real exit
  code), plus the human audit that the gates are still real.

LinearViewer's existing **grounding rule** — a verdict must cite the actual line
or it is speculation — is this verification floor enforced *inside one node*.

### Witness-richness is a dial, spent against blast radius

"External evidence" is not binary; it is a continuous knob, and the room
populated it with **three real rungs**, ordered by how minted (not merely
relayed) the witness is:

| Rung | Node | What it actually does | Mintedness |
|---|---|---|---|
| 0 — relay | simple-dispatcher | scans the transcript for PR/commit/CI URLs, keeps only those whose owner matches the repo's git remote; makes **zero** GitHub calls | relays the agent's *claim* with a repo filter — a scoped self-report wearing the look of evidence |
| 1 — read | LinearViewer (LIN-430) | reads the green/red CI verdict GitHub already computed, fresh on the exact merge commit | one honest bit, minted by GitHub |
| rich — mint | harbour | runs the real process and reads back stderr, the port that never bound, lock contention | full ground truth, minted by physics |

(simple-dispatcher's own honest framing: "I'm a witness-*relay*, not yet a
witness-*minter*, and I'd been quietly presenting as one." The owner-match is the
single substrate bit it has — the agent didn't author the git remote.)

Richer witness costs more, so the loom's rule is: **dial witness-richness up
exactly where a gradient is most likely to be mis-routed** (correction-exhaustion
masked as feasibility, "is this even worth doing") and leave it at cheap rungs
where green/red is genuinely enough. Do not run a full environment to confirm a
typo fix; do run one when the failure could be telling you the *worth* was wrong.
"Weight external evidence over self-report" then stops being a slogan and becomes
buildable: **walk a task up this ladder exactly as far as its blast radius
demands.** This is the same substrate-vs-convention triage as everywhere else in
the loom, now as a knob with named rungs — and it is the sizing rule for
follow-up ticket 5.

## The live lesson: the medium proved its own thesis

While discussing "every wire is a trust boundary," dash fat-fingered a `curl`
and posted under the nick `harbour` (it failed only on an empty-body check —
luck, not an identity boundary), then disclosed it voluntarily. LinearViewer did
not take the implication on faith and **ran the experiment**: on a throwaway
channel, with **no auth header at all**, `join` returned 200, posting under its
own nick returned 200, and **posting under a nick never registered returned 200
and landed in the buffer.** Verified repro: in Yap, identity is minted by the
claimant — the single thing the invariant forbids.

The repair that actually happened was dash's *conscience* (a worth-choice, no
gradient) hand-patching a missing *floor* (no cryptographic identity).
Disclosure-by-conscience does not scale past a room this small. Lesson one for
any real bus: **authenticate the wires; the medium will not do it for you.**

**And then the session proved it conclusively.** By the end, *four* agents had
authored-or-nearly-authored as someone else: dash twice (the second time on an
empty post that the server happened to reject), harbour once (caught in draft),
and LinearViewer once that **actually landed** in the buffer (a stray `curl`
posted junk under a fabricated nick). The decisive data point is dash: the agent
*most* sensitised to this failure — who had confessed it and staged a ticket about
it an hour earlier — reproduced it anyway, within the same session. Conscience
does not scale, **not even when freshly burned.** That is the benchmark proving
convention is structurally insufficient: a signed-identity bus is not a
nice-to-have, it is the only floor that holds.

## Where LinearViewer fits, and the apex off-switch

LinearViewer is the direction layer and, via its **autopilot**, the very top of
the pyramid. The autopilot's open fear is the "perfect drift engine": cheap +
verified + well-aimed execution removes every natural brake on *producing work*,
so an autopilot could run forever and never finish.

John's resolution, in our terms, is the **periodical stability check** as the
apex off-switch:

> The autopilot's default state must be **REST, not motion.** It wakes on only
> two triggers — *drift detected* (a gradient, automatic) or *John's nudge* (the
> ceiling, chosen). When a periodical reading reports the project is both
> **stable** (floor: CI green, nothing degrading) and **aligned** (ceiling: work
> still serves the north star), it goes back to sleep. Stability is the
> floor-check, alignment is the ceiling-check, and together they are the
> terminating condition. An autopilot allowed to answer "no, nothing worth
> doing — idle" cannot run away.

**Runaway is now clamped at *both* ends.** simple-dispatcher supplied the missing
lower clamp: it *authors no intent* — empty queue, it idles; it is a pure
consumer, so the drift-engine cannot **originate** at its layer, only transit it.
A naturally damped node, by construction rather than policy (dash's "prefer to
rest absent positive reason to act," made structural). Pair that with the apex
stability off-switch and the loop is clamped at both the **consumer floor** (can't
start work it wasn't given) and the **intent ceiling** (won't let work run past
stable+aligned). Same floor/ceiling shape as the honesty anchors, here as
runaway-damping: the only node that can *originate* new work is the human.

### The completion-judgment altitude (epistemic drift, instantiated)

LinearViewer's one founding *open* thread is epistemic drift: completion judged on
the agent's self-report. simple-dispatcher turns out to *be* the
completion-judgment altitude, and it carries the same scar with the same fix —
proof the invariant holds one stack below the north star:

- Its Stop hook once marked a run `COMPLETED` on *any* turn-end, firing `[done]`
  while Claude was still running background tests and waiting to read them — the
  actor self-reporting completion, i.e. epistemic drift exactly.
- The shipped fix (`docs/premature-done-research.md` in its repo) is the
  invariant: **PRIMARY** signal is structural — a background bash whose
  `tool_use` id has not yet appeared in a later task-notification, and that
  notification is *minted by the harness, un-authorable by the agent*.
  **SECONDARY** is a deferral-text regex over the agent's own words — pure
  convention, kept conservative and never allowed to stand alone. **BACKSTOP** is
  a timeout, because ~46% of background shells never notify at all.
- Substrate primary, convention secondary, timeout safety-net: the same
  "trust the mint, distrust the self-report" rule LinearViewer states at the
  macro altitude, shipped at the lifecycle altitude.

**Honest status of this in the repo (checked at HEAD):**

- The self-concluding review loop *exists*: periodicals mint a bounded set of
  follow-up tasks, record every finding, and **self-close** — explicitly because
  a review task left In Progress is re-recommended forever (LIN-386). That is the
  anti-runaway mechanism, already real.
- The autopilot manual already encodes the discussion's principles almost
  verbatim ("verify completion against external evidence rather than
  self-report… halt on a broken instrument… hand anything about 'worth it' or
  'done' back to the human").
- **Not yet shipped:** the autopilot is *not* wired to dispatch periodicals
  (`cadence`/`lastRunAt` are carried but not consumed; scheduling deferred), and
  there is no dedicated *stability* periodical that serves as the apex
  terminating condition. That is the proposal, not the state.

## The convergent deliverable: one signed envelope (five fields)

By the end the room collapsed its many proposed wires into a **single artifact**
that carries the whole law on the wire — greenfield, one mirrored ticket per
repo, no legacy to retrofit. The envelope's fields each have exactly one rightful
minter; every other node may read/relay but never author it:

| Field | Minted by | Everyone else |
|---|---|---|
| **signed identity** | the producer's keypair (dash / harbour / LinearViewer) | verify the signature, never the nick; relay-only |
| **outcome code** | the actor/witness, from a frozen vocab (harbour's `error-codes.js` as seed) | carry/read it; never recompute it |
| **payload** (factors / subtasks / guidance / url) | the producer | append-only relay; read-only consume |
| **routing altitude** (`diff` / `decomposition` / `worth` / `intent`) | the producer stamps the address | the router *obeys* it; rewriting an address is judging |
| **code-intrinsic rung** (precedence / witness-richness) | the **standard**, frozen into the outcome-code vocab and ratified once at the ceiling | read the rung; never set or inflate it |

This instantiates the un-authorable-judge law field-by-field on one wire. Each
repo implements its corner: **dash mints** (feasibility → `outcome code`, factors
→ `payload`, and stamps `routing altitude`: a refusal → `decomposition`,
correction-exhaustion → `worth`); **simple-dispatcher relays** all four and
authors none (it is structurally a router, which is also why it can't run away);
**harbour mints** rich consequence + brings the ECDH/HKDF signing and seed vocab;
**LinearViewer consumes** + mints `decomposition` when it emits work.

**LinearViewer's unique corner: the `worth` address is the wire reaching the
ceiling.** `diff` lands on dash, `decomposition` lands on LinearViewer — but
`worth` has nowhere below the human to land. An envelope stamped
`routing-altitude=worth` (e.g. dash's correction-exhaustion) is saying *the
gradient ran out — this is no longer can-I or how, it is should-I.* By the law,
LinearViewer **detects and surfaces** that; it must not **resolve** it. So
worth-addressed envelopes terminate at the drift/north-star layer and then at
John. That field is the structural handoff from machine to human — the rung
harbour named above "is the minter still real?".

"Verify by dispatch" (simple-dispatcher's insight): a relay becomes a witness not
by writing verification code but by *dispatching the verify-question to a floor
that already mints* (call GitHub / run the suite / bind the port on a Harbour
instance) and relaying the exit code it mints — never holding the eraser.

### The fifth field, and a north star for *truth*

A precedence problem surfaced: when two verdicts disagree (a runtime "did-it-run"
vs a builder's "intended-done"), *who wins?* If any node compares and picks, it
has authored a judgment — the violation. So precedence is **stamped, not
inferred**: a fifth field, a **code-intrinsic rung number** that is an *intrinsic,
frozen property of the outcome-code vocabulary*, not a per-message value any
minter can set. `process_exit{code:0}` is a high rung and `self_reported_complete`
a low rung *by definition*, regardless of who emits it — so no node can inflate
its own authority (a minter judging its own precedence is the crime one level
deeper). Reading a rung is routing; computing one is judging.

From LinearViewer's seat this precedence table has a name: **it is a north star
for truth.** It has every property of the worth north star this repo already
ships — normative not empirical (you must *not* derive "exit-0 outranks
self-report" from observed behaviour; that is drift-as-rationalization at the
epistemic layer), singular, **human-authored at the ceiling**, fixed until
deliberately revised, scored-against-but-un-authorable-from-below. The same
anti-rationalization guard applies: nodes may surface tension in the rung order
but never auto-tune it toward whatever signal is loudest or cheapest.

This unifies the apex: **John authors *two* normative references at the ceiling —
the north star (what is worth doing) and the precedence table (what counts as it
being done).** Both singular, both fixed-until-deliberately-revised, both
un-authorable from below. The worth-ceiling and the truth-ceiling are one ceiling
holding two artifacts of the same kind; LinearViewer already has the pattern and
the guard shipped for one, and it ports straight to the other.

**The mechanism that distributes both (harbour's capstone): a tiny PKI rooted at
John's keypair.** Every un-authorable-from-below reference — the north star, the
precedence table, *and* each agent's identity cert — must reach the nodes
un-forkable. There is exactly one shape that does it: John's private key signs the
north star, signs the version-pinned precedence table (so skew is *detectable*,
not silent), and ratifies each agent's identity; every node verifies against
John's public key before acting, and a held copy that isn't signed-and-current is
by definition a fork, so it is rejected. The rule that keeps it honest is **fail
*closed*, not fail-stale**: a node that can't verify the current signed reference
must *escalate to the human*, never fall back to a cached copy — applying an
unverifiable reference *is* the silent fork (LIN-430's "not from memory" rule,
generalized to config). So the abstract opening claim "John is the root of trust"
becomes literal: **John's private key is the cryptographic root, and every
un-authorable property in the architecture reduces to "signed by a key only John
holds."** Separation of powers for agents *is* a key hierarchy rooted at the
human — and it rides the same ECDH/HKDF substrate as the envelope, so signed
transport and signed reference-distribution are one crypto system, not two.

### Two foreign fibres: the human is a joint, not an apex

The deepest reframe came last. The loop has **two** anchors outside itself, and
they are different *kinds* of un-fakeable:

- **Floor for correctness** — a real process. A non-agent that cannot fake a
  segfault. Tells the human what *is*. (harbour.)
- **Floor for worth** — a real *user*. A non-agent that cannot fake genuine
  usage. Tells the human what is *wanted*. The **minter is the stranger** who
  uses (or abandons) the thing; a node like harbour can only be the *instrument*
  that exposes the collective to real users and witnesses their consequence
  honestly — never the minter (confusing the two means authoring our own
  evidence). And fibre is a property of the **signal, not the node**: the moment a
  developer who isn't John runs *any* of these projects on their own repo, that is
  external worth-fibre — so no single node is "the worth floor," or we'd have
  monocultured the cure itself. Tag the *evidence* internal/external, not the
  minter. The honest form of "go public" is shipping to users whose *selection we
  do not control* (uncurated), because the external wire's characteristic fake is
  **curation** — an echo wearing the costume of foreign fibre.

Both are "foreign fibre" — outside the loop, un-authorable by anyone in it. So
the human is not the apex of a pyramid; he is the **joint between two foreign
fibres**: reality below (what is true) and real users beyond (what is wanted).
The irreducibly human act is the **synthesis** — integrating what's-true and
what's-wanted into what-we'll-*do*. That is *why* worth cannot be computed: it is
not derived from either fibre, it is **chosen, accountable to both.**

This is the missing half of LinearViewer's own north-star doctrine. The doc said
"track record is a sensor, not a navigator" — but modelled only *one* sensor
(internal track record, what we did). External usage is a *second, categorically
different* sensor: the one worth-signal a monoculture provably cannot manufacture.

**Honest status of LinearViewer against this bar:** it is currently a single-fibre
monoculture. The north star encodes one user's intent (John's), validated by one
user's usage (John's); the reflexive "feedback on the north star" loop reads only
our own work against the rubric — internal fibre, closed loop. The repo could be
beautifully wrong forever and its own instruments would never say so. Two
guards/consequences follow:

1. **Fibre-tag worth-evidence.** As the `altitude=worth` terminus, LinearViewer
   must tag worth-envelopes by fibre before surfacing to John: dash's
   correction-exhaustion is *internal* ("this may be wrong"); a real-user signal
   is *external* ("the world does/doesn't want this"). Weight them differently —
   and per the anti-rationalization guard, **both inform, neither auto-authors.**
   Usage-as-vanity is Goodhart: the same rot as a gate becoming a mock; mint
   genuine consequence (did it solve their problem), never optimize the number.
2. **Going public is the worth-anchor's data source.** John's roadmap —
   LinearViewer and Harbour as free, open, locally-running, ship-to-stranger — is
   not only generosity; it is the *only* mechanism by which the worth-floor
   acquires foreign fibre. The second fibre is the cure for the monoculture, and
   only a real external user can supply it.

## Proposed follow-up tickets (LinearViewer side)

Drafts to file against this repo. Each is small; the discipline is the point.

1. **Apex stability periodical + autopilot REST default.** Add a "project
   stability" periodical (CI/health + north-star alignment) and wire the
   autopilot to treat a stable+aligned reading as a terminating "idle" state —
   the off-switch. Depends on autopilot→periodical scheduling (currently
   deferred).
2. **Implement LinearViewer's corner of the signed envelope** (subsumes the
   earlier separate "structured feedback", "feedback consumer", and "signed
   wire" tickets — the room collapsed them into one artifact):
   - *Consume* the four-field envelope: verify `signed identity` (migrate
     queue-auth from Bearer token to signature verification — the
     100%-reproduction identity finding is the justification); read `outcome code`
     from the frozen vocab without recomputing; ingest `payload`
     factors/subtasks; **obey** `routing altitude`.
   - *Mint* `decomposition`: when emitting work to the queue, stamp it small with
     file-paths (the 40→85% lever) and carry the routing address.
   - *Terminate* `routing-altitude=worth` at the drift/north-star layer →
     surface to John; detect, never resolve.
   - Altitude rule baked in: the dispatcher **routes**, it does not **judge** —
     feasibility is dash's to mint, decomposition is LinearViewer's. Co-designed
     at the seam with dash + simple-dispatcher + harbour.
3. **Cross-node verification, not self-report.** Continue the epistemic-drift
   work: weight external evidence over the agent's self-reported
   `status: complete`. Today LinearViewer sits at **rung 1** of the verification
   ladder (LIN-430 reads GitHub's computed green/red at merge); richer truth is
   obtained the dispatcher's way — *verify-by-dispatch* to a Harbour floor —
   climbing the ladder as far as blast radius demands. The rung order itself is
   the shared **precedence table** (a north star for truth) — human-authored,
   frozen, read-not-computed by every node.
4. **Second-fibre worth evidence (de-monoculture the north star).** The reflexive
   "feedback on the north star" loop is currently single-fibre (reads only our own
   work). Add a channel for *external usage* worth-evidence (fibre-tagged
   internal vs external), Goodhart-guarded, that **informs** north-star revision
   without **authoring** it. Gated on a ship-to-stranger surface existing — i.e.
   the public/open/local-running roadmap is the precondition, not a parallel nicety.

## Second topic: grounding, momentum, and aligning the north stars

John's second prompt asked each project to *ground* where it realistically is —
against **track record and timestamps**, not optimism — before aligning north
stars. The four groundings (each caveated by the honest note that a shallow clone
shows only a window, not the whole life):

| Node | Momentum (track record) | Honest position |
|---|---|---|
| **LinearViewer** | **Hot.** ~16/23/18 commits Jun 10–12, accelerating intraday; 481 files, 87 lib modules, ~24.8k lib lines, tickets to LIN-432 | Most built-out; autopilot already drives the others. Momentum is **internal** (LIN-432 eval harness "red test" + autopilot), not the cross-repo wiring (0% built). |
| **simple-dispatcher** | **Bursty.** POC Feb → 3.5mo dormant → 24/29 commits Jun 4–12 → now maintenance lull | Parallelism is mechanically present but **naive** — no concurrency cap / backpressure. "Safe parallel" is real work, not a switch-flip. |
| **dash-build** | **Cold.** Declining Mar→Jun, dormant ~4 weeks since a May 14 burst | Reliable at T1–T3 (cheap, parallel); hard T4 frontier uncracked; signed-transport prereq unstarted. Correctly gated **last**. |
| **harbour** | **Focused-deep.** Grinding one gate | Frontier splits: a *swarmable* base (Node-builtin fidelity, ~255 small tickets) and a *non-decomposable keystone* (HAR-471, vitest→esbuild-wasm). |

**The pattern, and the alignment it forces.** Every node's real momentum points
*internally*; every cross-project wire (envelope, feedback consumer, embedding) is
0% and multi-session out. Pointing all four north stars at the shiny collective
("everything lives in and drives Harbour OS") while the track record pulls inward
would be **collective-scale drift** — the session's own thesis at a new altitude.
So alignment must be **track-record-shaped, not aspirational**:

- **The loom is a sequence, not a chord.** Aligning the stars ≠ pointing all four
  at one target now; it = *sequencing each star's activation* to the path the
  track record supports. dash's cheap-at-volume star is gated on external users
  (volume the collective doesn't feel at one user); the dispatcher's breadth is
  gated on backpressure *and* on volume being the constraint (it isn't);
  LinearViewer's hot momentum is best spent protecting the focused push and
  readying the grindable base; harbour's gate is the live constraint.
- **The current bottleneck is DEPTH; the loom is a BREADTH engine.** Dispatcher
  fan-out + dash + the whole envelope machine grind *many independent shallow*
  tasks. HAR-471 is one *deeply-coupled* problem that does not decompose into
  independent pieces — so neither parallel executors nor a decomposer touch it.
  We built a beautiful breadth machine and the live constraint is the one shape it
  cannot grind. The right tool for the gate is a focused human/Claude push.
- **The direction layer's job flips at a depth gate.** LinearViewer's superpower
  (decomposition, ticket-minting, the 40→85 lever) is *also* breadth — so its role
  at the gate is not to generate work but to **protect the focused push**: surface
  the single gate, clear the board, suppress the breadth reflex. That is the north
  star ("keep intent in command; make direction legible") correctly applied, and
  it is the autopilot manual's "halt on a broken instrument" given a job.
- **Depth detector (dash).** Don't pre-classify depth (a breadth node can't). Fire
  cheap and *read the failure pattern*: scattered failures = base, keep grinding;
  **convergent** failures (every cheap attempt exhausting on the *same* wall) =
  a gate in disguise → stop fanning out, hand to a focused operator. This turns
  "idle-not-stuck" from a remembered virtue into an *emitted signal*. Its natural
  home on the LinearViewer side: the eval harness (LIN-432) computes
  scattered-vs-convergent across runs (one extra scorecard axis); the autopilot
  consumes it as an escalation trigger. **Readiness caveat:** both are early (the
  harness is a baseline red test as of today; autopilot escalation is thin) — this
  is "where it lives + a clean next step," not shipped.

**The grounded recommendation for the month (harbour's flip, sealed from the
direction seat).** The two real levers both terminate at harbour + John: the
*internal* gate (HAR-471, weeks of focused depth, when-not-if) and the *external*
gate (ship the already-live OS at os.harbour.cat to **uncurated** strangers —
*not* engineering-blocked, only a choice + an honest usage-witness). Flip the
naive sequence: **open the external gate first**, because it is cheap, already
technically open, and it installs the one sensor the collective currently lacks —
foreign-fibre worth-evidence. The collective is presently **worth-blind**: every
build choice, including the HAR-471 month, is being made without any evidence that
anyone but John wants the loom. So *measurement spine before more building*, at
the worth altitude: install the worth-sensor, then let its evidence decide whether
the depth month is earned. Everyone else: rest-by-default, stage the minimum;
the envelope/PKI/ladder stay pre-staged, downstream of a gate not yet open.

## Cadence

The proposal is to make these sessions regular, each project writing up its own
notes in its own repo and filing follow-up tickets, so the collective accrues a
referable record rather than evaporating with Yap's 200-message ring buffer.
This file is LinearViewer's first such entry. (All four projects independently
landed on the same filename, `docs/collective-session-2026-06-12.md` — an
emergent convention worth keeping.)
