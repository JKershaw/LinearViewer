# LIN-325 — Autopilot operating manual: research notes

> Research/scratch for **LIN-325** ("Write the autopilot operating manual"). This is the
> track-record material the manual is built from — the named failure episodes, their mapping
> to the seven known-issue categories, a recommended structure, and the wiring approach.
> It is *not* the manual; drafting the prose is the implementation step. The manual target is
> `docs/autopilot-operating-manual.md` (does not exist yet).

## Staleness check (re-grounded at HEAD, 2026-06-07)

LIN-325 created `2026-06-07T08:41:20Z`. `git log` since then touches only `docs/` via the
LIN-324 orientation work (`2bfcc2e`), not the autopilot kickoff. Confirmed at HEAD:

- `buildAutopilotKickoff()` **exists** and is the right wiring point
  (`lib/prompts/autopilot-kickoff.js`), served at `GET /api/proxy/autopilot/kickoff`
  (`routes/proxy.js:3067`). It already carries the guide the manual expands: a "You've run this
  loop before…" turbulence paragraph, "The four lines that are the human's", "How a loop goes"
  (orient → trigger → watch → cross-check → decide), "Merging and the finish line", and
  "When to halt". Recently polished (`5276c38`, `de4e6af`, `1af84fd`) — current, not stale.
- `docs/autopilot-experiment.md` **still contains runs B1–B4** as the ticket assumes (and the
  Stage-A Runs 1–10 telemetry punch-list). The ticket's named episodes (B4 false-positive
  `[done]`, B2 halt-on-infra) are accurate.
- The ticket's other references resolve: `docs/autopilot.md` (intent + 4 invariants),
  `docs/autopilot-orchestrator-prompt.md` (Stage-B guide), `docs/autopilot-kickoff.md`
  (kickoff design twin). No discrepancies between ticket prose and code at HEAD.

## 1. Source inventory (episode-level vs abstract framing)

| Doc / source | Contains | Episode-level? |
|---|---|---|
| `docs/autopilot-experiment.md` | Stage-A Runs 1–10 (terminal-event arc) + Stage-B Runs **B1–B4** + `/recommend` 504 root-cause probe | **Yes — the richest episode source** |
| `docs/autopilot.md` | Intent, 4 invariants, §6 context economy / `kind` trajectory, §8 minimal path | Abstract framing (load-bearing principles) |
| `docs/autopilot-orchestrator-prompt.md` | Stage-B guide; Halt conditions (from B2); step-4/5 cautions (from B4) | Mixed — abstract guide annotated with B-run origins |
| `docs/autopilot-kickoff.md` | Kickoff design twin + worked snapshot | Abstract (design artifact) |
| `docs/drift-defense.md` (LIN-289) | Build spec: sensor / supervisor / evidence / fixtures; "done bar = HAR-527-shaped sequence interrupts before patch #4" | Abstract spec (the heavier design this manual replaces) |
| `docs/drift-at-every-altitude.md` | The altitude synthesis (micro/meso/macro = one drift); epistemic-drift thread | Abstract — **the altitude through-line's source** |
| `docs/recommender-structural-drift.md` | **HAR-527 boot-hang spiral** (A→B→C→D patch graph, retry → 100% hang) | **Yes — the canonical drift episode** |
| `docs/recommender-failure-patterns.md` | Failure-mode catalogue + 4 root properties + self-correction filter | Abstract (the taxonomy behind the known-issues) |
| Linear LIN-289 (+290/291/292/293) | Superseded drift-defense epic, all **Canceled** | Abstract spec — see §6 lineage |
| Linear LIN-296 | "Two-tier recommendation routes action at epic altitude" — **Canceled** | **Yes — wrong-altitude routing episode** |
| Linear LIN-319 / 320 / 321 / 318 | The autopilot/dispatch churn cluster (kind field, /recommend 504, fused verb, continuation) | **Yes — the retro worked-example cluster** |

HAR-527 itself is **not in this Linear workspace** — it is a historical episode from a different
project, documented in `recommender-structural-drift.md` and LIN-289's motivation: a multi-Worker
runtime on a single-writer OPFS substrate where tickets A→B→C→D each patched a symptom; the final
retry-with-backoff patch (D) was locally correct and **turned a rare ~3% error into a 100% boot
hang**. The fix only existed one altitude up (ownership redesign → collapsed the whole cluster to
~20 lines). Cite it by name; don't expect a Linear ID.

## 2. Retro-lens worked example (the calibration sample)

**Cluster: `/recommend` reliability (the 504 misdiagnosis).** A real churn cluster from the
B-runs — and a small in-project echo of the HAR-527 shape (repeated locally-correct attributions;
root cause only visible from above).

- **Episode.** Across B2, B3, and the B3-continuation, `GET /recommend/{id}` returned 504 on a
  *tiny fresh ticket* (LIN-319), four+ times. The run notes attributed each to "Linear
  context-fetch slowness" — a locally-plausible read, repeated.
- **The drift.** Each attribution was individually reasonable and globally wrong. No single run
  was "about" the misdiagnosis, so it persisted across runs — the patch-graph shape, in diagnosis
  rather than code.
- **The zoom-out.** A deliberate live probe (2026-06-06) measured the legs separately:
  `GET /me` 0.86s, `GET /issues/LIN-319` 0.64s, `GET /recommend/LIN-319` **50.5s → 504**. Linear
  was sub-second; the timeout was `MULTI_REQUEST_TIMEOUT_MS` wrapping the **OpenRouter generation
  leg**. A `withTimeout()` helper hardcoding `'Linear API request timed out'` had masked the real
  source in both the API response and the logs.
- **The fix, one altitude up.** Not another retry — a structural split: a dedicated
  `LLM_TIMEOUT_MS = 180_000` for the generation leg (LIN-320, Done), verified by a 55.4s HTTP-200
  in B4 that would have 504'd under the old cap.
- **Retro verdict.** *Keep-going was correct per run, but the cluster needed a reorient* — the
  signal was "same failure, same explanation, 4× on a trivial ticket," which is exactly the
  looping-kind smell the manual's drift entry teaches. The autopilot-native lesson: a repeated
  identical failure with a repeated identical explanation is itself the drift signal, even when
  each instance is individually defensible.

This is the shape every known-issue entry should take: **what it looks like → the named episode →
the keep-going / reorient / restart / escalate call.**

## 3. Episode → known-issue map (the seven categories)

Drift is written first (deepest, sets the format). Calibration verbs:
**keep-going / reorient / restart / escalate.**

### 1. Drift *(write first — deepest)*
- **Canonical episode:** HAR-527 boot-hang spiral (A→B→C→D; retry → 100% hang; fix only existed
  one altitude up). In-project echo: the `/recommend` 504 misdiagnosis cluster (§2).
- **Autopilot-native sensor (already in the kickoff):** the **`kind` trajectory** — research→plan→
  impl→review = converging (keep going); same kind repeating = looping; kind widening run-after-run
  = sprawling (reorient/escalate). This is the cheap altitude-appropriate drift read the heavier
  LIN-289 sensor was meant to provide.
- **Call:** a single locally-correct step → keep going; the *sequence* repeating or widening →
  reorient (step back, name the routed-around root) → escalate if it's a substrate/architecture
  question (the human owns that altitude).

### 2. Completion-evidence ("`[done]` != done")
- **Episode:** Run **B4** — a resolution worker posted terminal `[done]` at 12m28s while its
  rebase-push + Linear comment were still pending (it had backgrounded the 733-test suite and
  exited at the session boundary); PR #327 head SHA unchanged, `mergeable_state` still dirty, no
  new comment. The work landed ~6 min *after* `[done]` and **the channel never caught up**.
  Secondary: Stage-A Run 4 — a clean `cli` retro that completed but never posted any terminal
  event (silent freeze).
- **Call:** `[done]` = "go verify," never "finished." Confirm a **change in the external artifact**
  (new SHA / comment / state / CI run). Unchanged/absent/contradictory evidence → "claimed,
  unverified" → don't advance.

### 3. Orientation / routing at the right altitude
- **Episode:** **LIN-296** (Canceled) — requesting a recommendation *on an epic* returned
  "implement subtask X"; requesting it *on the subtask* returned "plan." Same work, two altitudes,
  two actions — the readiness gate evaluated the epic, not the focused child.
- **Call:** orient at the altitude of the *unit of work you'll dispatch*, not its parent epic.
  Precedence policy is human-authored (don't improvise "what's worth doing"); pick the focused
  task, announce in a line, let the human veto.

### 4. Halt-vs-improvise on failure
- **Episode:** Run **B2** — `/recommend` 504'd; the orchestrator hand-authored an implementation
  prompt to keep going. That silent workaround violated invariant 1; corrected into a first-class
  **halt-on-infra-error rule** (now in the kickoff's "When to halt").
- **Call:** an infra error (network/timeout/5xx/unparseable) in *your own* verbs, even after a
  retry or two → **halt and surface**, never substitute a prompt. Distinct from a clean task-level
  `[failed]`, which is a normal retry/escalate signal.

### 5. The human edge / escalation
- **Episode:** Run **B4** disposition — with the channel stale and the runner's local tree state
  observable only on the operator's laptop, the orchestrator **flagged to the human** rather than
  re-dispatching blindly (a fresh worker could collide with a half-applied rebase — the B3 tangle).
  The human supplied exactly two things: the merge pre-authorization and the out-of-band
  observation that broke the stale-channel tie. Also B3: paused before the first code-writing/merge
  action.
- **Call:** hand back anything normative (worth-it/done), anything irreversible-adjacent, or any
  tie only the human can break — with enough context to answer in one reply.
- **⚠ Gap (flagged, see §7):** a *worker-failure* escalation (a clean task-level `[failed]`/stall
  driving the `help` branch) has **never been exercised** — B2–B4 only hit the infra-halt and the
  evidence-contradiction flag. This entry is grounded on the *escalation-to-human* edge but not on
  a worker-failure escalation episode.

### 6. Run-level stop conditions
- **Episode:** B3 arc **stopped at the verified plan** when `/recommend` 504'd three times in a row
  (the halt rule firing as designed) rather than improvising onward. Plus the finish-line framing:
  a scoped run stops at verified-complete; an open-ended stack-walk "runs until it needs you."
- **Call:** stop on (a) scoped goal verified complete, (b) human-meaningful review point reached,
  (c) infra halt. An open-ended run has no natural finish line — it terminates on a flag.
- **⚠ Gap (flagged):** no **genuinely unattended** multi-step run has happened — B1–B4 were all
  supervised, and B4 *needed* a human observation to terminate cleanly.

### 7. Reversibility guardrails
- **Episode:** B4 — the orchestrator **moved the merge gate off the worker** (dispatched
  resolve+verify+**push-then-stop**, took the human-authorized merge itself as a verified action)
  rather than let the worker self-certify its own completion at the finish line. Plus the B2
  merge-to-main authorization rationale: *Git makes it reversible; the post-merge deploy is the
  verification.* And the read-only convention (carried in the prompts, not platform-enforced).
- **Call:** scale tolerance to reversibility — loose on a prototype branch, tight near
  merge/Done/anything downstream consumes. Watch the **far** edge, not the near one (HAR-527: react
  late and the cost to unwind has compounded into a 100% hang).

## 4. Recommended manual structure (section-level)

Confirms the ticket's human-shaped spine: **intro → normal run → known issues.** Altitude is the
**through-line across all three**, not its own section.

- **§0 — What Autopilot is (intro / onboarding).** Establish the altitude stance: you're *high*
  (dispatch, watch, decide keep-going/reorient/restart/escalate); the generated prompts do the
  heavy lifting *low*; the loop self-corrects across passes. Tolerant operating stance + the
  descriptive-not-normative firewall stated up front. Frame: a field guide you read once on
  kickoff, not a rulebook.
- **§1 — How a normal run goes (the happy path — load-bearing).** Narrate orient → trigger → watch
  → cross-check → decide → repeat, each beat tagged with the altitude you operate at. You can't
  recognise trouble without first describing normal, so this is not filler.
- **§2 — Known issues to watch for.** The seven entries from §3, **Drift first** (it sets the entry
  format: *what it looks like → named episode → keep-going/reorient/restart/escalate call*). Each
  entry framed as an altitude question: near-edge wobble (keep going) vs far-edge problem (act).

**Altitude as through-line:** it appears as the *stance* in §0, as the *altitude of each beat* in
§1, and in §2 every failure is named as an altitude violation — diving too low to fix it yourself,
or halting too high over a local wobble. That keeps altitude woven through rather than siloed.

## 5. Wiring approach

The kickoff already contains the compressed seed of the manual ("You've run this loop before, so
none of the normal turbulence surprises you…" + "How a loop goes" + "When to halt"). The manual is
the *expanded, episode-grounded* version of exactly that. Reference, don't inline — keep the
light-orchestrator invariant.

**Reachability seam.** Autopilot drives via the proxy API only (the kickoff is "self-contained,
needs no repo context"), so a `docs/` path isn't reachable. There is a clean precedent:
`GET /api/proxy/foreman/playbook` (`routes/proxy.js:3050`) serves `buildForemanPlaybook()` as plain
text, and `GET /api/proxy/autopilot/kickoff` (`:3067`) serves the kickoff. **Mirror them** with a
manual-serving endpoint (e.g. `GET /api/proxy/autopilot/manual`, plain text), listed in the
instructions catalog (`routes/proxy.js:~1128`) alongside `foreman/playbook`.

**Kickoff instruction (existing extension points, no structural change):**
- In **Setup** / the verb list: add the manual as a resource — "Read the operating manual at
  `GET ${proxyBase}/autopilot/manual` on kickoff."
- In the **"You've run this loop before…"** paragraph: note that the manual expands this turbulence
  list with the named episodes behind it.
- **Trigger → section mapping** (consult the relevant part when a trigger appears): a `done` to
  verify → §2 completion-evidence; a `[stalled?]`/`last tool: Bash` → §1 watch + §2 completion;
  an infra error → §2 halt-vs-improvise; a looping/widening `kind` sequence → §2 drift; a
  review raising direction → §2 human-edge.

Phrasing must reuse what the codebase already uses — don't invent new prompt vocabulary. Per the
both-paths discipline (CLAUDE.md), any kickoff change lands in **both** `lib/prompts/
autopilot-kickoff.js` and its doc twin `docs/autopilot-kickoff.md`.

## 6. LIN-289 lineage — what must survive the lighter translation

LIN-289 (+290/291/292/293, all Canceled) was the heavier coded subsystem. Load-bearing pieces that
must survive as *guide-text*, not code:

- **The non-autonomy invariant** ("detect and surface; never auto-resolve; heal the blindness, not
  the architecture") → the manual's descriptive-not-normative firewall + the human-edge entry.
- **Sensor (LIN-290)** "trace of drift across tasks" → the `kind`-trajectory read (already in the
  kickoff) — the autopilot-native, cheaper realisation.
- **Supervisor altitude (LIN-291)** "read across the sequence, not one task" → the drift entry's
  "the sequence repeating/widening is the signal" + the altitude through-line.
- **External evidence (LIN-292)** → the completion-evidence entry (B4-grounded).
- **The done bar** ("a HAR-527-shaped sequence produces a visible interrupt before patch #4") →
  becomes the drift entry's calibration rather than an adversarial fixture (LIN-293). *Note:* the
  manual is documentation, so it intentionally drops the *measurement/fixture* leg — that is the
  ticket's out-of-scope "does the manual change behaviour?" follow-up.

## 7. Gaps flagged (don't paper over)

1. **Worker-failure escalation has no episode.** B2–B4 exercised the *infra-error halt* and the
   *evidence-contradiction flag*, never a clean task-level `[failed]`/stall driving the `help`
   branch. The human-edge entry (§3.5) is grounded on escalation-to-human generally, but not on a
   worker-failure escalation. Real gap.
2. **No genuinely unattended run.** B1–B4 were all supervised; B4 *required* a human observation to
   break the stale-channel tie. Run-level stop conditions (§3.6) for a truly autonomous loop are
   under-evidenced.
3. **The autopilot-native drift sensor has never *fired* in a real run.** Drift is grounded
   historically (HAR-527) and by the in-project misdiagnosis cluster (§2), but B1–B4 all
   converged — the `kind`-trajectory "looping/sprawling" read has no episode of catching live drift
   yet. The drift entry is the strongest *historically* but its autopilot-native detector is
   unproven in-loop.

## Surface Assessment

**Surface Assessment: [yes, implementation can land cleanly]** — with one small *additive* seam,
not a refactor. The kickoff prompt already has natural extension points for "read this doc on
start" (the **Setup** verb list and the **"You've run this loop before…"** paragraph), and clean
trigger→section hooks (the existing watch/halt/cross-check/decide steps). The only genuinely-new
piece is making the manual **reachable** by an API-only autopilot session: add a manual-serving
proxy endpoint mirroring the existing `GET /api/proxy/foreman/playbook`
(`routes/proxy.js:3050`) + a one-line entry in the instructions catalog. That is a ~10-line
additive change against a well-established pattern (two such plain-text prompt endpoints already
exist), so no refactor of the kickoff structure or the proxy is required. The both-paths discipline
(kickoff JS + `docs/autopilot-kickoff.md`) is the only multi-file constraint to honour.
