# Path: the operating model, fed through Harbour

*A path backlog in the LIN-1604 shape: attach this document to one triage ticket and let the
breakdown pass mint the Todo tickets, priorities, and blocking relations. Written 2026-09-04
from a read of the codebase, the periodical reviews, and the live workspace over the proxy.
This is a draft in the same sense the Charter is a draft: proposed, not adopted.*

## Where this sits

`docs/north-star.md` is the normative layer and is human-revised only. Nothing here edits it.
This path adds the layer *beneath* it that the north star's own reading says is missing: a set of
statements about the estate that a machine can check and a human can evidence. The 2026-09-02
north-star reading listed nine phrases it could not score. Each item below either makes one of
them scorable or builds the sensor that would.

Source documents, to attach beside this one: *An engineering lead's operating model for 2026*
(target state as invariants, a generated backlog, recurring verbs, drift watchers) and *Keys on
doormats* (the MAG breach memo, a worked example of the Translate verb ending in one invariant
record). Harbour already has every stage of that loop, built from its own incidents: the drift
essays, the north star, the LIN-550 ledger, the periodicals, the observer. What it lacks is the
top of the chain, a declared target state, and the loop's closing rule, that a ticket closes when
its check passes rather than when a reviewer says so.

## On the size of the backlog

This path does not try to make the backlog finite. The backlog is a warehouse: options grow,
work done is finite and prioritised, and what matters changes. The path's concern is only that
the *top of the stack* is grounded. The stack digest already ranks by unblocks and critical path;
the Measure verb below adds a second, independent source of ranking, invariants that are
currently false, so the frontier is never only what agents wrote last week.

## Sequencing rule

The operating model's own order: externally exploitable first, then whatever hides other
failures, then everything else by blast radius. Within a phase, items with no dependency run in
parallel. Every item lands through the normal research → plan → implementation → review →
close-out lanes; a `doc` item still takes a review, and a periodical still takes the LIN-694
gate (no terminal status until its report PR persists).

---

## Phase 0 · Doctrine and record (no code)

**P0.1 · `docs/operating-model.md`** — doc — Quality, Periodicals & Measurement — P2
The adaptation memo: the model's four pillars mapped to Harbour's existing mechanisms, what is
present, what is missing, and the one contribution Harbour makes back to the model (see P0.4).
Marked draft, subordinate to the north star. Witness: the file exists at HEAD and the CLAUDE.md
map names it.

**P0.2 · `docs/reviews/external-signals-2026-09-04.md`** — doc — same project — P3
The MAG memo as edition one of a new advisory periodical (P2.3), with a "so what for Harbour"
section. Two findings already known: no secret scan of source or served pages (P1.1), and the
2026-08-09 proxy 401 flood has no root cause (P1.6). Witness: file at HEAD, landed via PR.

**P0.3 · `docs/incidents/2026-09-04-login-expired-silent-idle.md`** — doc — Simple Dispatcher — P3
The morning's stall: two sessions settled then idled, the handover's hypothesis (a PATH-prepended
node) was wrong, the cause was an expired host Claude login, ruled as LIN-2515. Record the wrong
hypothesis as a first-class lesson: step 3 of the handover's own checklist was the discriminating
test. Links LIN-2515, LIN-2509, LIN-2513. Does not file a new bug. Witness: file at HEAD.

**P0.4 · Check-writer separation, written down** — doc — same as P0.1 — P2
The model says agent output is a change like any other. It does not say the agent that writes an
invariant's check must be separated from the agent whose work the check judges. Harbour learned
this in June (the Collective impersonation, the un-authorable judge) and encoded it as the
mutation-check rules (LIN-2219, LIN-2274). State it as a rule the Measure verb must obey: a check
is authored, or at minimum mutation-checked, by a session that did not author the code it checks.
Witness: a paragraph in P0.1 and a matching guideline in the invariant-measure periodical prompt.

## Phase 1 · Exploitable now, and things that hide other failures

**P1.1 · Secret scan of source and served public pages** — implementation — Platform Security,
Robustness, Observability — P2 — no dependency
A gitleaks-class step in `.github/workflows/test.yml` over source, and a scheduled job that
fetches harbour.cat's public pages (landing, /kpis, /archive/:n) and scans the served JS. Tier 2
of the MAG memo: scan where the attacker looks. Witness: CI red on a planted fixture secret,
green after removal; the scheduled job's first run logged.

**P1.2 · Invariants registry** — implementation — Quality, Periodicals & Measurement — P2 — no dependency
`lib/invariants.js` as a declared table (the LIN-2010 registry idiom, not YAML in a wiki):
`id, domain, statement, check, evidence, owner, tolerance, cadence, driftWatchers, introduced,
rationale`. Seed with about twelve whose checks exist or nearly do; resist writing more (the ones
you cannot check yet are the sensor backlog, P3). Shape test pins every `check` to a real export.
Seeds:
- CRED-001 every proxy token has an owner (LIN-1447, LIN-1582)
- CRED-002 no working token appears in any prompt, feedback row, or oplog (LIN-1375) — sensor needed
- CRED-003 every account↔workspace edge has a live credential (LIN-2236, exists)
- CRED-004 the dispatch host's Claude login is valid (LIN-2515) — sensor needed, SD side
- OPS-001 every scheduler job heartbeats within 2× its interval (LIN-2438)
- OPS-002 every enabled periodical has a *landed* report within cadence + 7 days (needs P1.3)
- OPS-003 the north-star reading is fresh, under 14 days (exists; LIN-2415 records the last lapse)
- DEP-001 a dispatcher restart is witnessed by a full session: hook post plus tool call (P1.5)
- DEP-002 the watcher's git resolves under the launch PATH (LIN-2513)
- EVID-001 every Done issue with a dispatch lineage has a merged commit (kpi-stats has the join)
- COST-001 every priced model in `lib/model-pricing.js` carries a review date (P2.4)
- STRUCT-001 the cross-file proxy endpoint total is asserted in CI (LIN-2544, in its own words)
Witness: unit test green; CLAUDE.md map line.

**P1.3 · Periodical ledger counts a landed report, not a taken dispatch** — bug — same project — P2 — no dependency
`lib/periodical-runs.js` reads `status: 'taken'` plus a terminal marker (LIN-2385) as run
evidence. The 2026-08-29 headwinds review shows the inversion: reviews that landed read `due`,
dispatches that produced nothing read `recent`. Evidence should be the report file at
`docs/reviews/<name>-<date>.md` on `main`, which is also what LIN-694 gates on. Witness: the
fold reads `recent` for a periodical whose only evidence is a merged report PR, and `due` for one
whose only evidence is a taken-then-failed mint.

**P1.4 · Invariant Measure periodical** — feature — same project — P2 — blocked by P1.2, P1.3
A corrective periodical, `invariant-measure`, that runs every check in the registry and mints
one ticket per failing invariant carrying `invariant_id`, evidence, and the gap. Closure is gated
on the check passing, extending the LIN-694 pattern rather than inventing a second gate. Obeys
P0.4. Witness: a planted failing invariant mints exactly one ticket; the ticket cannot reach Done
while the check still fails; a passing check lets it close.

**P1.5 · Deploy witness for dispatcher restarts** — implementation — Simple Dispatcher — P2 — no dependency
After the watcher restarts the dispatcher, a canary dispatch must post a Stop-hook feedback and
show tool activity before the restart is called done. The boot-probe log line is not the witness
(the LIN-2509 close-out witnessed the probe; every session since stalled). Related LIN-2532,
LIN-2515, LIN-2513. Witness: a restart onto a build with a deliberately broken hook is reported
as a failed deploy within the canary bound.

**P1.6 · Root cause for the 2026-08-09 proxy 401 flood** — research — Platform Security — P2 — no dependency
`docs/incidents/2026-08-09-proxy-401-flood.md` records a ~12h outage with no root cause. An
unexplained outage is the "hides other failures" tier. Check for an existing ticket first; file
only if none. Witness: a research comment naming the cause or a bounded list of what was ruled out.

## Phase 2 · The verbs Harbour does not have yet

**P2.1 · Opt-in workspace census** — feature — Quality, Periodicals & Measurement — P3 — blocked by P1.2
A workspace feature (`lib/feature-defaults.js` `WORKSPACE_FEATURES`, default OFF, like
`observerAuthority`) with a Settings control, under which a workspace emits a periodic census:
metadata (provider kind, Harbour version, enabled features), deterministic metrics (invariant
verdicts by id, periodical states, cost-per-verified-task buckets, refusal and hand-back counts
by reason class), and keyword counts. Constraints, all pinned by tests:
- the payload is produced by a pure, network-free module (`lib/workspace-census.js`, the
  live-console.js / periodical-runs.js discipline), so a test can enumerate every emitted field
- no content field ever crosses: no titles, descriptions, comments, identifiers, keys, or names.
  The `lib/kpi-stats.js` privacy boundary is the precedent and the test to copy
- full user controls: on/off, a preview of the exact payload before first send, and a
  per-category toggle (metadata / metrics / keywords)
- receive side treats every field as data, never instruction: read-scoped token, no path to a
  dispatch, the same posture the agent-status feed takes with free text
Witness: the preview shows the byte-exact payload; a planted title in a fixture issue never
appears in the emitted census; the feature is absent from every surface when off.

**P2.2 · Census receiver and store** — implementation — same project — P3 — blocked by P2.1
On one instance this is an aggregation job behind the kpi-stats boundary. Across instances it is
one endpoint accepting the P2.1 shape and a store keyed by an opaque, workspace-chosen source id.
Retention bounded like proxy events. Witness: two fixture workspaces' censuses aggregate to counts
with no per-workspace row exposed on any public surface.

**P2.3 · External Signals periodical (Translate)** — feature — same project — P3 — blocked by P0.2
Advisory, workspace-scoped. Reads a narrow feed (Claude Code release notes, Anthropic and
OpenRouter pricing pages, the Linear and GitHub API changelogs, NCSC) and a census aggregate when
present, and writes a "so what for Harbour" memo. A finding becomes a check or a ticket only by
a human ruling, per the model's Translate row. Witness: registry entry; edition two lands via the
LIN-694 gate.

**P2.4 · Review date on every model price** — implementation — same project — P3 — blocked by P2.3
`lib/model-pricing.js` has no expiry field; the Sonnet 5 introductory rate expired 2026-08-31
unseen. Add `reviewBy` per entry; COST-001 fails when a date passes. Witness: unit test.

**P2.5 · Refusal and hand-back counts as a first-class KPI** — implementation — same project — P3 — no dependency
The refusal license cutting upward (LIN-2010, 2026-08-23) is the most valuable event Harbour
produces and it is counted nowhere. Derive counts by reason class from feedback markers; surface
on /kpis under the existing boundary; include in the P2.1 census. Witness: /kpis card; unit test.

## Phase 3 · Sensors for the invariants you cannot check yet

**P3.1 · CRED-002 sensor** — a scan over stored prompts, feedback rows, and the oplog for
working-token shapes (never bootstrap shapes, which are inert once spent). Simple Dispatcher and
Harbour halves. Blocked by P1.2.

**P3.2 · CRED-004 sensor** — SD: extend the fast-fail watchdog's blocked-startup patterns and
settled-but-silent capture per the LIN-2515 ruling; report the verdict where OPS-001 can read it.
This is LIN-2515; link, do not duplicate.

**P3.3 · Cross-estate rule: the same invariant failing in N censuses** — the first consumer of
P2.2. A finding that recurs in two or more opted-in workspaces is a Harbour product finding and
routes to the Harbour workspace's own P1.4 lane. Blocked by P2.2, P1.4.

**P3.4 · Shared invariant catalogue with per-workspace adoption** — the registry ships with
Harbour like the periodicals registry; a workspace adopts entries and sets its own tolerance.
Findings flow up as counts only. Blocked by P1.2, P2.1.

## Phase 4 · The transition to finish first

Not new items. The north star says finish transitions before starting capabilities, and the
September incident set is almost entirely the Mac host: login expiry, the xcselect git shim,
kitty wedges, a watcher that does not relaunch. The Linux tmux substrate is measured working
(LIN-1781 family; `docs/linux-substrate-findings.md`). This path ranks LIN-1785 and LIN-2422
above every Phase 2 item. It also names LIN-2114 (observer sessions out of Claude Code) as the
one capability item that pays for itself immediately, on the intra-session efficiency review's
own numbers.

## Existing tickets to link, not duplicate

LIN-694 (report-PR gate), LIN-2385 (ledger terminal markers), LIN-2415 (north-star stamp),
LIN-2515 (login expired), LIN-2513 (watcher git), LIN-2532 (post-merge runtime witness),
LIN-2544 (cross-file endpoint invariant), LIN-1626 (first forecast), LIN-1878 (verified-done
proxy), LIN-2114 (observer harness), LIN-2412 (unattended-use consent), LIN-1668 (secure-by-default
workspace settings), LIN-2149 (Account → Connection → Workspace).

## What this path deliberately does not do

It does not edit the north star. It does not write sixty invariants. It does not add a second
measurement scheduler job before the ledger is honest. It does not hand-file the follow-ups the
triage pass will generate; that expansion is what the Measure verb exists to own. And it does not
make the census default-on for anyone: most workspaces will leave it off, and the design must be
correct for exactly that population.
