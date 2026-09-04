# Path: the operating model, fed through Harbour

*A path backlog in the LIN-1604 shape, for the human to attach to one triage ticket. Written
2026-09-04 from a read of the codebase, the periodical reviews, and the live workspace over the
proxy. Revised the same day after a fresh-context adversarial second read (17 findings, 3
blocking; all addressed below, see "Revision record"). A draft in the same sense the Charter is
a draft: proposed, not adopted.*

*Citation note. Ticket ids that appear nowhere in this tree (LIN-1604, 1626, 1668, 2415, 2422,
2513, 2515, 2532, 2544) are live-workspace facts read over the proxy on 2026-09-04, not file
facts. The "nine unscorable phrases" are from the proxy's `/north-star` reading of 2026-09-02,
which is served, not stored under `docs/`.*

## Where this sits

`docs/north-star.md` is the normative layer and is human-revised only. Nothing here edits it.
This path adds the layer *beneath* it that the north star's own reading says is missing: a set
of statements about the estate that a machine can check and a human can evidence. Each item
below either makes one of the nine unscorable phrases scorable or builds the sensor that would.

The source is *An engineering lead's operating model for 2026* (target state as invariants, a
generated backlog, recurring verbs, drift watchers). Its worked example, a memo on the August
2026 MAG breach ending in one invariant record, stays out of this public tree; the two findings
it produced for Harbour are carried as P1.1 and P1.6 below. Harbour already has every stage of
the model's loop, built from its own incidents: the drift essays, the north star, the LIN-550
ledger, the periodicals, the observer sweep and pass. What it lacks is the top of the chain, a
declared target state, and the loop's closing rule, that a ticket closes when its check passes
rather than when a reviewer says so.

## On the size of the backlog

This path does not try to make the backlog finite. The backlog is a warehouse: options grow,
work done is finite and prioritised, and what matters changes. The path's concern is only that
the *top of the stack* is grounded. The stack digest already ranks by unblocks and critical path;
the Measure job below adds a second, independent ranking source, invariants that are currently
false, so the frontier is never only what agents wrote last week.

## Vocabulary and conventions this path obeys

- **Kinds** are the registered dispatch kinds only: `research`, `plan`, `implementation`. A
  documentation deliverable is an `implementation` with the `Improvement` label. `Bug`,
  `Improvement`, `Feature` are workflow labels, not kinds.
- **Names.** `census` already means the observer sweep's seven-lane fleet census
  (`sweep:v1:<urlKey>`), and `credential-invariant-sweep` already owns the word invariant for one
  contract. This path therefore says **registry** for the declared table of invariants and
  **estate report** for the opt-in outbound telemetry, and it makes the registry the thing the
  two existing sweeps *register into* rather than a parallel list.
- **Deterministic checks are scheduler jobs, never periodicals.** A periodical is an LLM
  dispatch whose contract is to mint one well-scoped task and stop (`lib/periodicals.js`). Running
  N checks and minting N tickets is the `credential-invariant-sweep` shape, a `lib/scheduler.js`
  job with a CAS lease. This path adds exactly **one** new scheduler job (P2.2). The estate report
  rides that job's tick when the feature is on; it is not a second job.
- **Every prompt-text change moves both prompt paths** (`lib/prompt-templates.js` and the
  meta-prompt). Periodical prompts are outside that rule; close-out template text is inside it.
  P2.3 touches close-out semantics and must be checked against both.
- **Every new module gets a CLAUDE.md map line.** `docs/incidents/` is not in the map today and
  P0.2 adds it. `docs/incidents/` lives in this repo only; simple-dispatcher has `docs/reports/`.
- **Sequencing rule:** externally exploitable first, then whatever hides other failures, then
  everything else by blast radius. Phase numbers are in that priority order. Within a phase,
  items with no `blocked by` run in parallel.

---

## Phase 0 · Doctrine and record

**P0.1 · `docs/operating-model.md`** — implementation (Improvement) — Quality, Periodicals &
Measurement — P2 — no dependency
The adaptation memo: the model's four pillars mapped to Harbour's existing mechanisms, present
and missing, plus the one rule Harbour contributes back (P0.3). Marked draft, subordinate to the
north star. Witness: file at HEAD; CLAUDE.md map line.

**P0.2 · `docs/incidents/2026-09-04-login-expired-silent-idle.md`** — implementation
(Improvement) — Simple Dispatcher project, file in this repo — P3 — no dependency
The morning's stall: two sessions settled then idled; the handover's hypothesis (a PATH-prepended
node) was wrong; the cause was an expired host Claude login, ruled as LIN-2515. Record the wrong
hypothesis as the lesson: step 3 of the handover's own checklist was the discriminating test.
Links LIN-2515, LIN-2509, LIN-2513. Files no new bug. Witness: file at HEAD; `docs/incidents/`
added to the CLAUDE.md map.

**P0.3 · Check-writer separation, written down** — folded into P0.1 — P2
The model says agent output is a change like any other. It does not say the agent that writes an
invariant's check must be separated from the agent whose work the check judges. Harbour learned
this in June (the Collective impersonation, the un-authorable judge) and encoded it as the
mutation-check rules (LIN-2219, LIN-2274). State it as a rule P2.2's checks obey: a check is
authored, or at minimum mutation-checked, by a session that did not author the code it checks.
Witness: a paragraph in P0.1 and a guideline in P2.3's periodical prompt.

**P0.4 · CLAUDE.md scheduler line is stale** — implementation (Improvement) — P4 — no dependency
The map says three jobs are registered; there are four (`observer-sweep`, `observer-pass`,
`credential-invariant-sweep`, `pricing-conformance-sweep`, `server.js`). Fix the line, and let
P2.2 make it five. Witness: map matches `server.js`.

## Phase 1 · Exploitable now, and things that hide other failures

**P1.1 · Secret scan of source and served public pages** — implementation (Improvement) —
Platform Security, Robustness, Observability — P2 — no dependency
A gitleaks-class step in `.github/workflows/test.yml` over source, and a scheduled job that
fetches harbour.cat's public pages (landing, /kpis, /archive/:n) and scans the served JS. Scan
where an attacker looks, not only where a reviewer looks. Witness: CI red on a planted fixture
secret, green after removal; the scheduled job's first run logged.

**P1.2 · Finish the host transition: Linux dispatcher box** — existing tickets LIN-1785,
LIN-2422 — Dispatch & Execution Runtime — P2 — no dependency
Not a new item. The north star says finish transitions before starting capabilities, and the
September incident set is almost entirely the Mac host: login expiry (LIN-2515), the xcselect
git shim (LIN-2507/2509/2513), kitty wedges (LIN-2446), a watcher that does not relaunch. The
tmux substrate is measured working (`simple-dispatcher/docs/linux-substrate-findings.md`,
LIN-1781 family). This path ranks these two tickets above every Phase 3 item. Witness: theirs.

**P1.3 · Deploy witness for dispatcher restarts, at zero cost** — implementation (Improvement) —
Simple Dispatcher — P2 — no dependency
No canary session and no creator: the witness is the **first real session after a boot**. The
dispatcher stamps a boot id; the first hook-substrate session launched after that boot that
posts a Stop-hook feedback and shows tool activity within a bound marks the boot witnessed. If
the first N post-boot sessions all settle and idle with no hook post, write a loud
`deploy.unwitnessed` oplog line naming the boot id and commit. The verdict is a log line, never
a relaunch: the watcher's rule that a dead dispatcher stays dead is untouched. Related
LIN-2532 (the post-merge runtime witness for LIN-2511), LIN-2515, LIN-2513. Witness: a boot
onto a build with a deliberately broken hook produces the oplog line within the bound; a
healthy boot marks witnessed on its first session.

**P1.4 · `periodicalId` stamping on lane and batch dispatches** — implementation (Bug) —
Quality, Periodicals & Measurement — P2 — no dependency
The 2026-08-29 headwinds review found landed reviews reading `due` and taken-then-failed mints
reading `recent`. Half of that is already fixed at HEAD: `lib/periodical-runs.js` now requires
`status:'taken'` **and** a terminal `done` marker (LIN-2385). The other half is a join problem,
not an evidence-rule problem: lane and batch dispatches that produced the 08-23 reports were
never stamped with `periodicalId`, so the fold cannot match them. Stamp it at the dispatch
seams the lane and batch paths use. Do **not** re-derive evidence from a file on `main`;
`lib/periodical-report-gate.js` records why that was rejected (`lib/periodicals.js` is
location-agnostic). Witness: a lane-produced report row folds to `recent` for its template.

**P1.5 · Widen the LIN-694 gate to the session write path** — implementation (Bug) — same
project — P2 — no dependency
`checkPeriodicalReportGate` runs at one site, `routes/proxy.js` `PATCH /api/proxy/issues/:id`.
The session-auth `PATCH /workspace/:urlKey/api/issues/:issueId` and Linear's own UI bypass it
(the integration-surface review of 2026-08-29, finding R7). Any closure gate this path adds
inherits the same hole, so close it first, or at least name it on every witness that depends on
it. The UI path cannot be gated by Harbour and stays a documented bypass. Witness: a
periodical-gated task PATCHed to Done over the session route is refused with the same 422 the
proxy lane gives.

**P1.6 · Has the 401-flood monitor fired?** — research — Platform Security — P3 — no dependency
`docs/incidents/2026-08-09-proxy-401-flood.md` does not lack tickets: LIN-1980 is the amplifier
fix and LIN-1981 + LIN-1982 are the root-cause pair, held against a named monitor (the next
`[credential-rejected]` line with `expiryKind:'sentinel'` or `shapeMismatch:true`). The research
question is only whether that monitor has fired since 2026-08-09 and, if not, whether the
monitor is actually wired. Link, do not duplicate. Witness: a research comment on LIN-1981.

## Phase 2 · The registry and the Measure job

**P2.1 · Invariants registry** — implementation (Feature) — Quality, Periodicals & Measurement
— P2 — no dependency
`lib/invariants.js` as a declared table (the LIN-2010 registry idiom): `id, domain, statement,
check, evidence, owner, tolerance, cadence, driftWatchers, introduced, rationale`. The two
existing sweeps register into it as the first entries. The shape test pins every `check` in the
**checkable** group to a real export; the **sensor backlog** group has `check: null` by
construction and a `sensorItem` naming the path item that builds it.

Checkable at seed:
- CRED-001 every proxy token has an owner (`lib/ownerless-token-policy.js`, LIN-1447/1582)
- CRED-003 every account↔workspace edge has a live credential (`lib/credential-invariant-sweep.js`, LIN-2236)
- COST-001 the pricing-conformance sweep reports zero violations and `verified:true`
  (`lib/pricing-conformance-sweep.js`, LIN-2384; a live diff against the OpenRouter catalog,
  stronger than any review date). Known blind spot to record: a table id absent from the
  catalog is skipped.
- OPS-001 the observer sweep's `lastSeenAt` is within 2× its interval (`sweep:v1:<urlKey>`,
  LIN-2438). Scoped to that instance: `lib/scheduler.js` has no heartbeat concept and the other
  jobs emit none.
- OPS-003 the north-star reading is fresh, under the 14-day cap (LIN-2415 records the last lapse)

Sensor backlog (built in Phase 4):
- CRED-002 no working token appears in any prompt, feedback row, or oplog (LIN-1375) → P4.1
- CRED-004 the dispatch host's Claude login is valid → LIN-2515, link
- OPS-002 every template has a landed report within cadence + 7 days, when the workspace
  `periodicals` feature is on (there is no per-template enable) → P1.4
- OPS-004 every scheduler job heartbeats → P4.2
- DEP-001 a dispatcher boot is witnessed by a real session → P1.3
- DEP-002 the watcher's git resolves under the launch PATH → LIN-2513, link
- EVID-001 every Done issue with a dispatch lineage has a merged commit. `lib/kpi-stats.js` has
  no such join; its "evidence" is a count of agent-claimed `[evidence]` markers. Needs a GitHub
  read → P4.3
- STRUCT-001 the cross-file proxy endpoint total is asserted in CI (LIN-2544; no such test exists
  yet) → P4.4

Witness: unit test green; CLAUDE.md map line. Retention for stored verdicts: 30 days, like proxy
events.

**P2.2 · Invariant Measure scheduler job** — implementation (Feature) — same project — P2 —
blocked by P2.1
The one new job: `invariant-measure`, registered in `server.js` like the four before it, CAS
lease, deterministic, **no LLM call**, so its cost is a few reads per tick and not a session.
Each tick runs every checkable invariant and advances a stored verdict document per invariant
(`observer-state-store.js` pattern, instance key `invariant:v1:<urlKey>:<id>`). It mints nothing.
Obeys P0.3 for any check it later gains. Witness: a planted failing invariant produces a stored
`false` verdict with evidence within one tick; the tick is byte-identical when nothing changed.

**P2.3 · Invariant findings periodical** — implementation (Feature) — same project — P2 —
blocked by P2.2, P1.5
A corrective periodical, `invariant-findings`, that reads the stored verdicts and, per its
contract, mints **one** well-scoped task for the highest-ranked currently-false invariant,
carrying `invariant_id`, evidence, and the gap, and stops. Closure of that task is gated on the
stored verdict reading `true`, using the LIN-694 gate mechanism (a marker on the task, checked
at the write seams P1.5 leaves gated). The check is **never run inline** in the issue-write
handler; the gate reads the precomputed verdict, which is what keeps the multi-provider write
endpoint free of a live external dependency. Witness, scoped honestly: over the proxy lane and
the session lane, a task whose invariant still reads `false` is refused Done with a 422; the
Linear UI remains a documented bypass. Prompt lives in `lib/periodicals.js` (outside the
both-paths rule); any close-out template text it changes moves both paths.

## Phase 3 · The verbs Harbour does not have yet

**P3.1 · Opt-in estate report** — implementation (Feature) — Quality, Periodicals &
Measurement — P3 — blocked by P2.1
A workspace feature (`WORKSPACE_FEATURES`, default OFF, like `observerAuthority`) with a
Settings control, under which a workspace emits, on the P2.2 tick, a report of: metadata
(provider kind; Harbour version, which is `null` unless `DEPLOY_VERSION` is set; enabled
features), deterministic metrics (invariant verdicts by id, periodical states,
**terminal-marked** task cost buckets, using that module's own vocabulary since "verified" is a
banned emitted-field name there, refusal and hand-back counts by reason class), and keyword
counts **against a fixed, Harbour-shipped vocabulary only**. Free-text tokens never cross: in a
small workspace a rare keyword re-identifies content, so V1 counts only app-defined terms,
exactly the `lib/kpi-stats.js` boundary (counts and app-defined labels, never keys or content).
Constraints, each pinned by a test:
- the payload is produced by a pure, network-free module (`lib/estate-report.js`) so a test can
  enumerate every emitted field
- a planted title, description, comment, identifier, or key in a fixture workspace never
  appears in the emitted report
- full user controls: on/off, a byte-exact preview before first send, per-category toggles
  (metadata / metrics / vocabulary counts)
- when off, the feature is absent from every surface, and nothing in Harbour depends on it
  being on. Most workspaces will leave it off; the design must be correct for that population.
Witness: the four tests above.

**P3.2 · Estate report receiver** — implementation (Feature) — same project — P3 — blocked by P3.1
On one instance this is an aggregation behind the kpi-stats boundary, no wire. Across instances
it is one endpoint accepting the P3.1 shape. A receiver that stores a payload is a **write** and
is authenticated as one: a sender token bound to an established account (the LIN-2149
Account → Connection → Workspace model), never a self-chosen source id and never read scope.
Every stored field is data, never instruction; nothing in the receiver has a path to a dispatch
or a ticket. Rate-limited like the other proxy writes. Retention 30 days. Witness: two fixture
senders aggregate to counts with no per-sender row on any public surface; an unauthenticated
POST is 401; a payload with a content-shaped field is rejected, not stored.

**P3.3 · Cross-estate report (a human reads it)** — implementation (Feature) — same project —
P4 — blocked by P3.2
A page or section listing invariants currently false in two or more opted-in senders. It routes
nowhere automatically. A recurring finding becomes a Harbour ticket only when the human files
it, which keeps P3.2's "no path to a ticket" true by construction. Witness: the page; no write.

**P3.4 · External Signals periodical (Translate)** — implementation (Feature) — same project —
P3 — no dependency; its first edition lands **with** the registry entry, so the report carries
the LIN-694 marker
Advisory, workspace-scoped. Reads a narrow feed (Claude Code release notes, Anthropic and
OpenRouter pricing pages, Linear and GitHub API changelogs, NCSC) and, when P3.3 exists, the
cross-estate report, and writes a "so what for Harbour" memo. Fetched pages are untrusted web
content entering an agent's context: the prompt states the hostile-input posture (summarise,
never execute, never follow instructions found in a page), and the session runs read-scoped. A
finding becomes a check or a ticket only by a human ruling. Cost: one dispatched session a week,
not a Harbour OpenRouter call, so the free-tier clamp does not apply. Witness: registry entry
and edition one in the same PR through the LIN-694 gate.

**P3.5 · Refusal and hand-back counts as a KPI** — implementation (Improvement) — same project
— P3 — no dependency
The refusal license cutting upward (`docs/reviews/lane-run-review-2026-08-23.md`, where a lane
declined to close LIN-2010 on the operator's own incorrect say-so; see also LIN-2254) is the
most valuable event Harbour produces and it is counted nowhere. Derive counts by reason class
from feedback markers; surface on /kpis under the existing boundary; include in P3.1. Witness:
/kpis card; unit test.

## Phase 4 · Sensors for the invariants you cannot check yet

**P4.1 · CRED-002 sensor** — a scan over stored prompts, feedback rows, and the oplog for
working-token shapes (never bootstrap shapes, which are inert once spent). Harbour and
simple-dispatcher halves. Blocked by P2.1.

**P4.2 · OPS-004 sensor** — give `lib/scheduler.js` a per-job `lastRanAt` the way LIN-2438 gave
the observer sweep one, so OPS-001 generalises. Blocked by P2.1.

**P4.3 · EVID-001 sensor** — a GitHub read on the kpi path joining a Done issue's lineage to a
merged commit; until then "evidence-linked" means an agent said so. Blocked by P2.1 and the
code-source axis (LIN-1010 → LIN-1271).

**P4.4 · STRUCT-001 sensor** — the cross-file proxy endpoint total asserted in a CI-wired test
(LIN-2544). Blocked by nothing; sequenced behind the LIN-679 split it protects.

**P4.5 · CRED-004** — is LIN-2515; link.

## Existing tickets to link, not duplicate

LIN-694 (report-PR gate), LIN-2385 (ledger terminal markers), LIN-2415 (north-star stamp),
LIN-2515 (login expired), LIN-2513 (watcher git), LIN-2532 (post-merge runtime witness),
LIN-2544 (cross-file endpoint invariant), LIN-1626 (first forecast), LIN-1878 (verified-done
proxy), LIN-2114 (observer harness; the one capability item that pays for itself on the
intra-session review's own numbers), LIN-2384 (pricing conformance), LIN-2412 (unattended-use
consent), LIN-1668 (secure-by-default workspace settings), LIN-2149 (Account → Connection →
Workspace), LIN-1980/1981/1982 (401 flood).

## What this path deliberately does not do

It does not edit the north star. It does not write sixty invariants; five are checkable at seed
and the rest name their sensor. It adds one scheduler job, not two. It does not hand-file the
follow-ups the triage pass will generate; that expansion is what the Measure job and its
periodical exist to own. It does not put a third party's breach memo in a public tree. And it
does not make the estate report default-on for anyone.

## Revision record (adversarial second read, 2026-09-04)

Blocking: closure-gated-on-check rewritten so the check is a stored verdict read at the gated
seams, with the two bypasses named and one of them closed first (P1.5, P2.3). The ledger item
re-scoped from "inverted evidence rule" to the `periodicalId` join gap, since LIN-2385 already
landed the evidence half (P1.4). A review-date field on pricing dropped in favour of the live
conformance sweep that already runs (COST-001). Major: EVID-001 moved to the sensor backlog;
seeds split into checkable and not; the recurring-finding router replaced by a human-read
report; the receiver made a write with account-bound auth; free-text keyword counts replaced by
a fixed vocabulary; "census" and "invariant" renamed to avoid two meanings; Measure split into a
job plus a one-task periodical; the 401-flood item re-pointed at the existing root-cause pair;
the deploy canary replaced by a zero-cost first-real-session witness; phases renumbered into
priority order and the dead edges cut. Minor: kinds corrected to the registered vocabulary,
live-workspace citations flagged, omissions added (map lines, retention, job cost, web-content
posture, per-template enable), agent-facing instructions moved to the appendix, the refusal
citation pointed at its review.

## Appendix · suggested triage ticket body

> Triage: operating-model path backlog. Attached: `docs/operating-model-path.md` (this file)
> and the operating-model source memo. Break the path into Todo tickets with the projects,
> priorities, kinds, and `blocked by` edges as written; link the tickets named under "Existing
> tickets to link, not duplicate" rather than filing new ones; file nothing for Phase 4 items
> that are already tickets. Every item's acceptance witness becomes its ticket's acceptance
> section. Do not edit `docs/north-star.md`.
