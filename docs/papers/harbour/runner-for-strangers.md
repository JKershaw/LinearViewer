---
title: Which runner and which credential lane can run a stranger's task to a PR?
version: 1
date: 2026-09-19
authors: [Claude, John Kershaw]
model: claude-opus-5 on claude-code, effort high, dispatched as LIN-2937's research child (dispatch c4379756, session b3edaaa3)
grounded_at: d249ec51 (LinearViewer), d0e809e3 (simple-dispatcher)
cites: [docs/v1.md@d249ec51:98, docs/v1.md@d249ec51:83, docs/north-star.md@d249ec51:17, simple-dispatcher/executors.js@d0e809e3:117-131, simple-dispatcher/executors.js@d0e809e3:427-431, simple-dispatcher/executors.js@d0e809e3:483, simple-dispatcher/harnesses.js@d0e809e3:247-263, simple-dispatcher/harnesses.js@d0e809e3:355-369, simple-dispatcher/harbour-token-mcp-server.js@d0e809e3:19-24, simple-dispatcher/harbour-token-mcp-server.js@d0e809e3:232-235, simple-dispatcher/harbour-token-mcp-server.js@d0e809e3:358-363, simple-dispatcher/opencode-runner.js@d0e809e3:88-96, simple-dispatcher/opencode-runner.js@d0e809e3:409-430, simple-dispatcher/clones.js@d0e809e3:5-11, simple-dispatcher/dispatcher.js@d0e809e3:74, simple-dispatcher/config.js@d0e809e3:1100-1102, simple-dispatcher/deploy/provision.sh@d0e809e3:16, simple-dispatcher/deploy/provision.sh@d0e809e3:75, simple-dispatcher/deploy/provision.sh@d0e809e3:95-113, simple-dispatcher/docs/substrate.md@d0e809e3, simple-dispatcher/docs/deployment.md@d0e809e3, simple-dispatcher/docs/dispatching-into-a-repo.md@d0e809e3, simple-dispatcher/docs/remote-execution-epic.md@d0e809e3:25-80, simple-dispatcher/docs/cloud-deployment-feasibility.md@d0e809e3:1-14, lib/dispatch-store.js@d249ec51:170-171, lib/user-preferences.js@d249ec51:23-34, lib/user-preferences.js@d249ec51:152-178, lib/model-pricing.js@d249ec51:108-134, lib/terminal-marked-task-cost.js@d249ec51:137-161, lib/free-tier-store.js@d249ec51:23-39, routes/proxy.js@d249ec51:98-115, routes/openrouter-auth.js@d249ec51:1-12, docs/papers/harbour/cheap-implementer.md@d249ec51, LIN-1781 (description and comments, 2026-08-01 to 2026-09-19), LIN-1785 (description and comments, 2026-08-30 and 2026-09-19), LIN-2421, LIN-2422, LIN-1786, LIN-1301 (description and comments, 2026-07-13, 2026-07-31, 2026-08-01, 2026-08-29, 2026-09-19), LIN-1302 to LIN-1305, LIN-259, LIN-1590, LIN-2883 (2026-09-17), LIN-2884, LIN-1892, LIN-1234 (comments 2026-07-14), LIN-2412, LIN-1345, LIN-2934 (and its correction comment, 2026-09-19), LIN-2954, LIN-1635, LIN-1712, LIN-2114, LIN-1871]
---

# Which runner and which credential lane can run a stranger's task to a PR?

**Neither path can today, and the reason is not the machine.** Every credential a dispatched
run touches is the operator's — the Claude plan login the launcher uses (`LIN-1301`, comment
2026-07-31), the `~/.ssh` directory and the `gh` OAuth token copied into each session's scratch
HOME (`harnesses.js@d0e809e3:247-263`), and the workspace token in a file on the host
(`dispatcher.js@d0e809e3:74`). The Linux box is the only path with landed code and would run a
stranger's task on all three of those. Cloud execution is the only path whose design names the
two things that must replace them — a per-task `git clone <url>@<ref>` and per-session injected
secrets — and it has no code at all: LIN-1302 through LIN-1305 are every one of them Todo. On
five of the six questions the two paths need the **same** work, and most of that work sits above
the runtime seam, in Harbour. They differ on one: isolation, where a container is strictly better
than one shared Unix user, and partly on retention, which a container answers by dying.

The recommendation is the box as the host, the account's own OpenRouter key through the
`opencode` harness as the credential lane, and LIN-1301's Phase 1 *workspace-prep and secrets*
seam built on the box rather than in a container. What it would cost to be wrong is asymmetric,
and that asymmetry is the paper's most useful output: being wrong about the **machine** costs
about $18 of Hetzner and a provisioning week, because the clone, the secrets and the credential
work all sit above the `RuntimeProfile` seam and transfer unchanged; being wrong about the
**lane** costs a stranger's run against a shared key with no cap, which has already happened once
on Harbour's own traffic (LIN-1345, the LIN-1329 run).

## Findings

**The milestone's two paths are not the whole class, and one of the others is a better-argued
design than either.** `docs/remote-execution-epic.md` (simple-dispatcher, status *proposed*)
describes a third path — a hosted managed-agent API claimed by a Harbour-internal loop via a new
`runsIn: dispatcher|harbour` axis — and says explicitly that it "supersedes/absorbs parts of
`docs/cloud-execution-epic.md` (LIN-1301→1305)". It is not in the milestone's Related list and its
only ticket is LIN-1590, Backlog, still at *research*. Its §2.1 contains the sharpest sentence
anyone has written on this question: the hosted sandbox must be able to `git push`, open a PR and
read CI, "**and that capability check belongs in P1's research, ahead of any executor code**". Two
further members exist and are correctly out: LIN-259 / Harbour OS (Backlog, and `docs/v1.md:79`
puts it Out), and the operator's laptop, which is the status quo `docs/v1.md:98` calls the
critical path.

**The box exists as a host; it does not exist as a runner for anybody's repo but the operator's.**
`deploy/provision.sh` is 419 lines on `main` and covers the non-root `harbour` service user
(`:16`, `:75`), a systemd unit with `KillMode=process`, a measured reflink verdict, a patch-reboot
window and a daily clone reaper (LIN-1785's research comment, 2026-08-30). Phase 1's remaining
defects are code-complete and green — simple-dispatcher PR #199, `MERGEABLE`/`CLEAN`, unit tests
green on `bd87c32` — and unmerged only because seven of its ledger items need a box that does not
exist. But the workspace it would prepare is not a stranger's. `buildWorkspacePrep` is "a
FILESYSTEM copy — **NOT** `git clone`" of an operator-placed template folder
(`executors.js@d0e809e3:117-131`), `repo=` resolves only against a basename already in
`workspaces.json` with "no filesystem guessing" (`docs/dispatching-into-a-repo.md`), and the
handover script's own instruction is `git clone git@github.com:JKershaw/…` by hand
(`provision.sh:372-373`). Nothing on this path ever takes a repository URL from a dispatch payload.

**The cloud path is a design, not a codebase, and its one decided thing is the one the box
lacks.** LIN-1301's `RuntimeProfile` table names exactly the two substitutions this milestone
needs: workspace prep becomes `git clone <url>@<ref>`, and auth becomes "injected per-session
secrets" in place of copying `~/.ssh`/`gh`/`opencode` HOME. Its Phase 0 is a pure refactor with
zero behaviour change, and every phase LIN-1302–1305 is Todo. Its stated scope guard — `opencode`
only, because `claude-code` is welded to a terminal — was contradicted by measurement in
August: the full LIN-790 ladder passes under tmux on headless Linux (LIN-1781; the banner on
`docs/cloud-deployment-feasibility.md:1-14` withdraws the premise in the source document). So the
harness is no longer forced by either path, which matters, because the credential lane follows the
harness.

**A credential lane that is not the operator's already exists, durably, and is already wired to
the harness that could use it.** LIN-2412 (Done) put the OpenRouter OAuth key in a durable
per-account store, keyed by `accountId`, behind an explicit consent beat for *unattended* use
(`routes/openrouter-auth.js:1-12`, `lib/user-preferences.js:23-34` and `:152-178`). The `opencode`
harness routes every model through the `openrouter` provider and nothing else
(`opencode-runner.js@d0e809e3:88-96`), and reports OpenRouter's own USD figure back on the feedback
rail (`:409-430`). What is missing is the join: nothing resolves that key *at dispatch time for a
runner*. LIN-1234 asked exactly this question — "which principal should a dispatched run resolve
LLM credentials from?" — and closed on 2026-07-14 by deferring it to an account model that is
still Todo (LIN-1892). Its decisive finding still holds at HEAD: a GitHub-App-authenticated human
has no user identity at all, so their dispatched run necessarily falls to the free tier.

**The four lanes that are not the account's own key each fail the v1 constraint for a different
reason.** The operator's Claude plan login is what `docs/v1.md:83` and LIN-1301's cost gate both
rule out for a headless runner. The server env `OPENROUTER_API_KEY` bills the operator and, worse,
"un-clamps every non-OAuth user's prompts" (LIN-2412). The shared `OPENROUTER_FREE_TIER_KEY` is a
*prompt* meter, not a *run* meter — `FreeTierStore` counts prompts per workspace per UTC day,
default 20, with a 50/hour global ceiling (`lib/free-tier-store.js:23-39`) — and it has already
been exhausted mid-run once by a single autopilot session, halting routing entirely (LIN-1345).
The user's own key as a paid option is a `docs/v1.md:84` hypothesis with no number yet.

**Isolation is the only question where the two paths genuinely differ, and the box's answer is one
Unix user.** What exists on the box: a private per-session clone directory (LIN-558) and a
per-session `TMPDIR` (LIN-1701). What that is not: `provision.sh` creates exactly one service user
(`:16`, `:75`), every session runs as it, and the per-session temp dir is created at default mode
rather than `0700`, so "another user on the same host can therefore still **read** a session's temp
files" (LIN-1712, Backlog). Every launch carries `--dangerously-skip-permissions`
(`executors.js@d0e809e3:483`). A container-per-task bounds one account's blast radius to its own
task by construction; the box does not, and no ticket closes that gap. There is also no
threat-model document to check this against — LIN-1635 ("the missing document") is Todo and
records that `docs/` contains none.

**What blocks hostile repository content today is real but narrow, and one hole is wide.** Three
controls exist and both paths inherit them: `--strict-mcp-config` with a per-session config, so "a
target repo's own servers can't load" (`executors.js@d0e809e3:427-431`); `permissions.deny:
['AskUserQuestion']`; and `autoUpdates: false` (`executors.js:71-92`). Against that, the loop runs
the repository's own code — `npm ci`, its tests — in bypass-permissions mode, and a
credential-injecting broker listens on `127.0.0.1` inside the session that forwards every
`/api/proxy/*` call with an injected `Authorization` header and **accepts unauthenticated requests
by design** (`harbour-token-mcp-server.js@d0e809e3:19-24`, `:232-235`, `:358-363`). Any process a
hostile repository starts in that session can read and write the workspace's tracker. Writes need
only an `X-Harbour-Intent: write` header, which is a deliberateness guard, not an authentication
one. On the box this is compounded by the named local-privilege threat — CVE-2026-64600, an XFS
reflink race whose mitigation is a scheduled reboot window (LIN-1781) — and by port 22 standing
open to `0.0.0.0/0`, with the upstream firewall parked on an operator ruling (LIN-2421).

**Nothing today is deleted, and nothing today is written down.** simple-dispatcher "never
auto-deletes a clone" — deleting a live one is the footgun the project has been bitten by, and
disk accumulation "is not a current concern" (`clones.js@d0e809e3:5-11`); the box adds a daily
`clones.js reap`, but "orphan" means only that the session record has gone, not that the code
should. Claude Code transcripts persist under `~/.claude/projects/`, which is the property the box
relies on to re-fire sessions after a reboot (LIN-1781). On the Harbour side the numbers exist and
are short: dispatch queue items 24 hours, dispatch history 30 days
(`lib/dispatch-store.js@d249ec51:170-171`). There is no retention policy for a user's code or
transcripts on either path; LIN-2954 is where that one-page note on terms, retention and revocation
is owed, and it is blocked on this milestone.

**One run cannot be capped today, on either path, and the instrument that would cap it is off.**
`maxTasks` counts *distinct issue identifiers*: ten worker sessions on one ticket is a count of
one, so "a scoped run on one ticket has no bound" (LIN-2934, as corrected 2026-09-19) — and one
task is precisely the shape `docs/v1.md`'s Go puts in front of a stranger. The north star's clause
("no autonomous run starts without a declared task budget, enforced at the seam") is therefore not
met for the exact run shape v1 ships. Worse for a cap keyed on money: the usage relay that carries
cost back is default-OFF (`config.js@d0e809e3:1100-1102`), and `MODEL_PRICING`
(`lib/model-pricing.js@d249ec51:108-134`) carries rows for Claude, GPT and `gpt-5.4-mini` and **no
cheap-model row at all** — no DeepSeek, no GLM, no Gemini Flash — so a table-priced fold of a cheap
run prices `null` and is excluded from the sum.

**A cheap-tier run costs single-digit dollars in tokens on either path, and the compute difference
between the paths is noise against that.** Tokens, from `cheap-implementer.md`: a median
implementation leg cost **$0.45** on `deepseek/deepseek-v4.1-flash` and **$3.75** on
`z-ai/glm-5.3`, both read off the operator's own OpenRouter export; the floor run produced two green
PRs on the older DeepSeek V4 Flash "for a tenth of a cent each"; a single Opus review leg costs
**$2.26 to $4.79** regardless of ticket size. A v1 Go run is about ten worker sessions (LIN-2934's
own recorded run, and "the paper runs cost roughly ten sessions each"). So an all-cheap stranger
run lands at roughly **$1–$5, most plausibly $2–3**, and a single frontier leg anywhere in it
doubles that. Compute: the box is a fixed **€16.49/month** Hetzner CX43 (LIN-1781) — about $0.06 a
run at ten runs a day, about $0.60 at one; a cloud task at the recommended 2 vCPU / 4 GB for 20
minutes is **$0.01 (Fly) to $0.055 (E2B/Cloud Run)** plus a ~$12/month control-plane floor
(LIN-1301, comment 2026-07-13). Compute is between 0.3% and 20% of the token bill on both paths.
**The path choice is not a cost decision at v1 volume.**

**That estimate is not something Harbour can currently reproduce, and the limitation is
structural.** Every figure above comes from the operator's OpenRouter export or a per-platform
price list — not from Harbour's own telemetry — and `cheap-implementer.md` says so in terms ("a
reading Harbour's own relay cannot make"). Three things stand between that and a cap that tracks
real money: the relay is default-off; the pricing table has no cheap rows; and `maxTasks` counts
tickets, not dollars, so it cannot be made into a spend cap by tuning. The one path that does work
needs no new pricing: `reduceLineageCost`'s `opencode` branch sums the harness's own reported
`costUsd` — OpenRouter's real figure — and marks `fullyPriced: false` when any row fails to price
rather than silently dropping it (`lib/terminal-marked-task-cost.js@d249ec51:137-161`). The
`claude-code` branch cannot: that harness reports `costUsd: null`, which is the asymmetry LIN-1425
was built around. **So a per-run spend cap is buildable on the opencode/OpenRouter lane and is not
buildable on the plan-login lane** — which makes question 6 an argument for the same lane question
1 is.

**Machine identity and dispatch authority are each modelled once, in the wrong place, with the
replacement designed but unbuilt.** The runner's binding is per workspace in a file on the machine
carrying a workspace-scoped consumer token (`dispatcher.js@d0e809e3:74`); LIN-2883 replaces it with
an account-owned machine record whose assignments are fetched server-side, and states the principle
this milestone needs in one line: "authority flows from the account, never from the repo… A
stranger connecting the same public repo gets their own workspace under their own account, served
by their own machines or by nothing." It is Backlog, blocked on LIN-1892. Separately, a `readWrite`
proxy token today passes the dispatch routes, so "a token minted for issue triage can start a
Claude Code or opencode session on the operator's machine"; LIN-2884 makes `dispatch` its own
scope, mintable only by the workspace's owning account. Also Backlog. Neither is on the milestone's
critical path as filed, and both become load-bearing the moment a second account exists.

## Why the recommendation might be wrong

**The strongest case against the box is that v1's own gate moves.** The recommendation leans on
`docs/v1.md:31`: v1 is done at the dress rehearsal — "a fresh account, a repo Harbour has never
seen", the operator as a stranger to his own product — and the invited period comes *after*. That
gate is single-tenant, which is the only reason one Unix user is tolerable. If John decides the
invited period starts at the same moment, or that two invited testers may run concurrently, the
box's isolation answer fails immediately and a container is not an optimisation but a requirement.
Nothing in this paper's evidence resolves that; it is a decision, and it belongs to LIN-2938.

**The second-strongest is that the design document nobody put on the milestone disagrees with
both paths.** `docs/remote-execution-epic.md` argues that a managed-agent API collapses the
container driver, the image and the runtime decision to "an HTTP client and a status poll", and
that the control plane is already half server-side and paid for twice — citing LIN-623, LIN-1005,
LIN-1445 and the LIN-1461→1480 cluster as the interest. If that is right, building per-task clone
and secrets onto a Hetzner box is work that a hosted agent would have supplied. The same document
supplies the counter-argument to itself: secrets injection "does not evaporate — it changes form
and gets harder", because a hosted sandbox has no HOME to copy from and still needs push, PR and CI
capability. That check has never been run against any vendor, which is why LIN-1590 is still at
research — and it is the single piece of evidence that would most change this recommendation.

**The recommendation assumes strangers will connect an OpenRouter account, and no one has
measured that.** The lane exists (LIN-2412) but it puts an OAuth consent interstitial between step
2 and step 4 of `docs/v1.md`'s golden path, and `docs/v1.md:85` already flags Entry as an unmeasured
hypothesis. If connect-your-own-key is where people stop, the lane has to become Harbour-fronted
metered spend, and then the cap stops being follow-on work and becomes a precondition — with
LIN-1345's incident as the precedent for what an uncapped shared key does under one autonomous run.

**The cost numbers are weaker than they look.** Thirteen tickets is a small population; every
figure is Harbour's *own* tickets in Harbour's *own* repositories, on an operator's template clone
with dependencies already installed. A stranger's repository is the case none of it measured: a
cold `npm ci`, an unfamiliar toolchain, tests that fail for reasons the model did not cause. The
honest direction of that bias is **upward** — the same paper found the driver run's cheap legs
going round three times each on "green-CI legs that were wrong against the real rows", and rounds
are what cost money.

**And the cheapest reading of all the evidence is that this milestone is not really about the
runner.** Five of six questions need identical work on both paths, and that work is a credential
principal (LIN-1892/LIN-1234), a dispatch scope (LIN-2884), a machine record (LIN-2883), a per-task
clone, a spend bound (LIN-2934) and a retention note (LIN-2954) — one of which is a host decision
and none of which a host delivers. If that reading is right, LIN-2940 should be re-scoped from
"build the runner" to "build the per-task clone and the lane, on whatever host is cheapest to
stand up", and the box wins by being cheapest to stand up rather than by being right.

## Method

**Population.** Everything LIN-2937 names, plus what an adversarial sweep found beside it.
Grounded at `d249ec51` (LinearViewer) and `d0e809e3` (simple-dispatcher), both of which predate the
ticket's own creation (2026-09-19T20:34:52Z): `git log --since` over both repositories returns no
commits, so the ticket is not stale against either tree and every quotation below was re-read at
HEAD rather than taken from ticket prose.

**Documents read in full.** `docs/v1.md`, `docs/papers/standard.md`, `docs/papers/harbour/cheap-implementer.md`,
and simple-dispatcher's `docs/substrate.md`, `docs/deployment.md`, `docs/dispatching-into-a-repo.md`,
plus the heads of `docs/remote-execution-epic.md`, `docs/control-plane-split-research.md` and
`docs/cloud-deployment-feasibility.md`.

**Issues read with their comments.** LIN-2936, LIN-2937, LIN-2938, LIN-2939, LIN-2940, LIN-1781,
LIN-1785, LIN-2421, LIN-2422, LIN-1786, LIN-1301, LIN-2883, LIN-2884, LIN-1871, LIN-1234, LIN-1635,
LIN-2954, LIN-2412, LIN-1345, LIN-2934, LIN-2114, LIN-1712.

**Code read at HEAD.** `executors.js` (workspace prep, dispatch settings, launch composition),
`harnesses.js` (MCP config, scratch HOME), `harbour-token-mcp-server.js` (the broker),
`opencode-runner.js` (provider pinning, usage relay), `clones.js`, `dispatcher.js:74`,
`config.js:1100-1102`, `deploy/provision.sh`; and LinearViewer's `lib/dispatch-store.js`,
`lib/user-preferences.js`, `lib/model-pricing.js`, `lib/terminal-marked-task-cost.js`,
`lib/free-tier-store.js`, `lib/weekly-budget.js`, `routes/proxy.js`, `routes/openrouter-auth.js`,
`routes/proxy-kickoff.js`.

### The classes, and how each was bounded (LIN-1871)

**Candidate execution paths.** Bounded by taking the milestone's two, then sweeping
`simple-dispatcher/docs/*.md` for any document describing where a session executes, then searching
the tracker for `container`, `sandbox`, `cloud execution`, `Hetzner`, `GitHub Actions` and
`Codespaces`. Five members: (1) the Linux box, LIN-1781 + LIN-1785 + LIN-2421/2422 + LIN-1786;
(2) cloud execution, LIN-1301 + LIN-1302–1305; (3) the hosted-agent remote-execution epic,
`docs/remote-execution-epic.md` + LIN-1590 — **found by the sweep, not named by the milestone**;
(4) Harbour OS / LIN-259, Backlog and Out per `docs/v1.md:79`; (5) the operator's laptop, the status
quo. `GitHub Actions` and `Codespaces` returned nothing relevant — the former only CI tickets, the
latter no results at all — so a managed-CI runner is not a member anyone has proposed.

**Credential lanes.** Bounded by walking every credential a dispatched run touches, from the
launch command outward: `buildClaudeCommand`, `writeClaudeMcpConfig`, `writeOpenCodeLaunchInputs`,
`resolveProxyLLM`, and the provisioning script's Secrets section. Eight members in two groups.
*Model lanes:* (i) the operator's Claude plan login, no API key injected; (ii) server env
`OPENROUTER_API_KEY`; (iii) shared `OPENROUTER_FREE_TIER_KEY`; (iv) the durable per-account
OpenRouter OAuth key (LIN-2412); (v) the user's own key as a paid v1 option (`docs/v1.md:84`,
hypothesis only). *Repository and tracker lanes:* (vi) the operator's GitHub identity — `~/.ssh` +
`gh` `oauth_token` copied into the session HOME (`harnesses.js:247-263`) — or the operator-placed
deploy key on the box (LIN-1785, Secrets); (vii) the workspace dispatch/consumer token
(`lib/dispatch-tokens.js`, the one store whose tokens never expire per the proxy catalog);
(viii) the proxy bootstrap/working token brokered on localhost. LIN-2937's question 1 is only the
model lanes; its question 2 is lane (vi), and the two are independent choices.

**Host and dispatcher surfaces a runner must stay consistent with.** Bounded by reading
`docs/substrate.md`, `docs/module-map.md` and `docs/deployment.md` and taking every seam a change of
host crosses. Nine: workspace binding (`loadWorkspaces`, `dispatcher.js:74`); workspace prep and
the clone-strategy seam (`executors.js`, `config.js`'s `defaultCloneStrategy`); the terminal-driver
registry (iTerm / Terminal.app / tmux); the harness registry (`claude-code` / `opencode`); liveness
(Stop hook + transcript, versus opencode's exit sentinel); the feedback rail and the `[usage]`
relay; the reapers and stall failsafe; the localhost credential broker; and the dispatch-queue
contract itself (`docs/dispatch-protocol.md`), which LIN-1301's principle 1 exists to protect.

**Consumers of this answer.** Bounded by relations plus a tracker search on the milestone's own
identifiers. Seven: LIN-2938 (the conversation that decides), LIN-2940 (the build), LIN-2954 (the
hardening pass, which reads this paper's isolation, hostile-input and retention answers by name),
LIN-2934 (the spend bound), LIN-2883 and LIN-2884 (machine record and dispatch scope), LIN-1892
(the account root everything credential-shaped is deferred to).

**One class could not be bounded: the retention policy.** No document states what is kept of a
user's code or transcripts, for how long, or how access is revoked. LIN-1635 records that `docs/`
holds no threat model at all, and LIN-2954 is where the one-page note is owed but has not been
written. The evidence required is the document itself — it cannot be derived from the repository,
because the repository's behaviour is "never delete" plus two TTLs on a different collection, which
is a default, not a policy.

**The adversarial pass.** The searches that would have surfaced a missed sibling, and what they
returned: `cloud execution` → LIN-1301–1305, LIN-259, LIN-2114 and this milestone, no sixth path;
`container` → the same phases plus unrelated UI tickets; `sandbox` → LIN-1814 (agent verification
environments, a testing concern, not a runner) and LIN-1273 (token-scope enforcement); `Hetzner` →
the box cluster and the fleet tickets LIN-1787/1793–1797; `isolation` → LIN-1712 and LIN-558, both
folded in above; `per-user token` → LIN-1234 and LIN-2412, both folded in; `retention` → LIN-2198
and LIN-1522, neither about user code; `spend cap` → LIN-2934 and LIN-1345, both folded in.
One query, `runner`, returned an empty result set from the proxy search — an instrument fault, not
evidence of absence — so that class was bounded by document sweep and relations instead, which is
how path (3) was found. **The layer set is complete** in the sense that every layer a stranger's
task crosses between a dispatch row and a PR is named above — binding, prep, launch, credential,
harness, liveness, feedback, retention — and each was walked in code rather than in prose. The one
layer that is named but not readable is the policy layer, and it is recorded as unbounded rather
than assumed empty.

### The six questions, both paths, side by side

| | **The Linux box** (LIN-1781/1785) | **Cloud execution** (LIN-1301) |
|---|---|---|
| **1. Credential lane** | *Exists:* the operator's plan login, placed by hand (LIN-1785 Secrets) — which is the lane v1 forbids. The account's own OpenRouter key exists durably (LIN-2412) and `opencode` already routes it (`opencode-runner.js:88-96`). *Left:* resolve that key per dispatch — blocked on the principal decision LIN-1234 deferred to LIN-1892. | *Exists:* nothing. *Left:* "injected per-session secrets" as designed, plus the same principal decision. The 2026-07-31 cost gate states the constraint plainly: a headless runner cannot use a desktop plan login, and migrating converts the burn to metered cash. |
| **2. The clone** | *Exists:* a per-session filesystem copy of an operator-placed template (`executors.js:117-131`); `repo=` resolves basenames only. *Left:* everything — a URL from the payload, a per-task `git clone` with the account's token, and dropping it. Push identity today is the operator's `~/.ssh` + `gh` token (`harnesses.js:247-263`). | *Exists:* nothing, but the design is decided — `git clone <url>@<ref>` — with one open choice (Harbour supplies URL+ref, or SD resolves from `repo`). *Left:* all of it, plus `remote-execution-epic.md` §2.1's unrun capability check: can the sandbox push, open a PR and read CI? |
| **3. Isolation** | *Exists:* per-session clone dir (LIN-558), per-session `TMPDIR` (LIN-1701), one non-root service user (`provision.sh:16,75`). *Left:* the temp dir is not `0700` (LIN-1712), all sessions share one Unix user, and every launch is `--dangerously-skip-permissions`. No per-account boundary at all. | *Exists:* nothing. *Designed:* container-per-task, which is a real boundary by construction and the one place this path is strictly better. *Left:* the runtime is undecided (Docker → Fargate / Cloud Run / K8s / Fly). |
| **4. Hostile input** | Same three controls both paths inherit: `--strict-mcp-config` blocks the repo's own MCP servers (`executors.js:427-431`), `AskUserQuestion` denied, auto-updates off. Against them: the repo's own code runs in bypass mode, and the localhost broker accepts unauthenticated `/api/proxy/*` calls from anything in the session (`harbour-token-mcp-server.js:19-24,232-235`). Box-specific: CVE-2026-64600 local privesc, mitigated only by a reboot window; port 22 at `0.0.0.0/0` with the upstream firewall parked (LIN-2421). | The same three controls and the same broker hole. The container bounds the blast radius of what the repo's code can reach on the host — the one improvement — but it must then hold push credentials, which `remote-execution-epic.md` calls "the single most underestimated piece of P1". |
| **5. Retention** | *Exists:* never delete (`clones.js:5-11`); a daily orphan reap on the box; transcripts persist under `~/.claude/projects/` by design, because the reboot recovery depends on it. Harbour side: 24h queue, 30d history (`dispatch-store.js:170-171`). *Left:* a written policy — none exists (LIN-2954, LIN-1635). | *Exists:* nothing. *By construction:* the container dies with the task, which answers the question for code but not for transcripts or feedback, which still land in Harbour under the same two TTLs. *Left:* the same written policy. |
| **6. Spend** | *Exists:* `maxTasks`, which counts distinct issue identifiers and therefore cannot bound a one-task run (LIN-2934). Fixed cost €16.49/mo. *Left:* a per-run bound; and the telemetry to enforce it is default-off (`config.js:1100-1102`) with no cheap-model pricing rows. On the `claude-code` lane `costUsd` is null, so a money cap is not buildable there. | The same absent cap, plus per-minute compute that is directly metered ($0.01–$0.055 a 20-minute run). On the `opencode` lane the harness reports OpenRouter's own USD (`opencode-runner.js:409-430`) and `reduceLineageCost` sums it with an explicit `fullyPriced` flag — so a real money cap **is** buildable, on either host, if the harness is `opencode`. |

### The recommendation

**Host:** the Linux box. It is the only path with landed, reviewed, CI-green code (PR #199), its
remaining Phase 1 work is a merge decision rather than a build, and its fixed cost is $18 a month
against a token bill of $2–3 a run. **Lane:** the account's own OpenRouter key through the
`opencode` harness — the only lane that is durable, per-account, consented for unattended use, and
measurable in real money. **Method:** build LIN-1301's Phase 1 workspace-prep and secrets seam — a
per-task `git clone <url>@<ref>` with the account's token, dropped after the run — on the box, not
in a container, and take LIN-1302's `RuntimeProfile` refactor first so the seam exists to build
against.

Three things must land with it rather than after it, because a stranger reaches them on the first
run: the `dispatch` scope (LIN-2884), so a triage token cannot start a session; a per-run spend
bound with the usage relay on (LIN-2934); and `0700` on the session temp dir (LIN-1712). The
machine record (LIN-2883) is needed before a *second* account, not before the dress rehearsal.

**What it costs to be wrong, by what is wrong.** *Wrong about the host:* about $18 and a
provisioning week. The clone, the secrets, the scope and the cap all sit above the `RuntimeProfile`
seam and move to a container unchanged — which is the whole point of taking LIN-1302 first.
*Wrong about the harness:* moderate. Choosing `claude-code` on the box is defensible now that tmux
is measured, but it forfeits the only real-money cost reading Harbour has, and a spend cap on that
lane would have to be rebuilt from a pricing table that has no cheap rows. *Wrong about the lane:*
expensive, and it is the one that has already happened. A stranger's run on a shared key with a
prompt-shaped meter and no per-run bound is LIN-1345's incident with a stranger's hand on it — one
run exhausted the shared key's daily cap and halted every AI path in the product. *Wrong about the
gate:* if the invited period starts with the rehearsal rather than after it, the box's one-user
model is not adequate and the container becomes required, costing the difference between a
provisioning week and LIN-1303 in full.

### Questions for LIN-2938

1. **The lane.** Is the account's own OpenRouter key the v1 lane, or does Harbour front metered
   spend for strangers? `docs/v1.md:84` leaves it open and the plan asked for John's view directly.
   If Harbour fronts it: what is the per-run cap in dollars, and what happens when a run hits it
   mid-PR?
2. **The gate.** Is the dress rehearsal single-tenant? The recommendation depends on it. If two
   invited people may run concurrently, isolation stops being a deferred item.
3. **The box's lapsed gates.** Merge PR #199 with the seven on-box ledger items deferred to first
   provisioning, or provision first and discharge them properly? And the SSH-ingress ruling for
   LIN-2421 — option (a) carrier-range allowlist, (b) SSH closed plus WireGuard/Tailscale, or (c)
   record `0.0.0.0/0` as an accepted deviation. Both have waited since 2026-08-30 and both are
   John's alone.
4. **Which of LIN-1301's phases v1 needs.** The recommendation says Phase 0's seam and Phase 1's
   prep-and-secrets half, and not the ContainerDriver, Phase 2 or Phase 3. Is that the cut?
5. **The third path.** Should LIN-1590 run its capability check — can a hosted sandbox push, open a
   PR and read CI — before LIN-2940 starts? It is the one piece of evidence that would most change
   this recommendation, and it is a day of research, not a build.
6. **The retention line.** What is kept of a user's code and transcripts, and for how long? The
   repository's current answer is "never delete", which is a default rather than a decision, and
   LIN-2954 cannot write the note until this is ruled.

## Limits

This paper read code and tickets; it ran nothing. No box exists to measure, no container has been
built, and no stranger's repository has ever been cloned by either path — so every "what is left to
build" is an inference from absence, and absence in a 12,000-line dispatcher is the claim most
likely to be wrong in the direction of *more* exists than this paper found. The cost figures are
second-hand from `cheap-implementer.md` and from a July 2026 platform price survey; both are on
Harbour's own repositories and Harbour's own prices, and the bias runs upward for a stranger's
repository. The OpenRouter lane's viability is assumed from the credential's existence, not from any
run having used it for a dispatched worker — no such run has happened. And one instrument failed: a
tracker search for `runner` returned nothing, so that class rests on a document sweep, which is
weaker than a query anyone can re-run.

## Next

- Run `docs/remote-execution-epic.md` §2.1's capability check against one managed-agent vendor:
  can a hosted sandbox `git push`, open a PR, and read CI? One line goes into `proposals.md`.
- After the first stranger-shaped run on the box, re-read this paper's §6 against the actual
  `[usage]` rows with the relay on, and report the measured per-run cost against the $2–3 estimate.

Surface Assessment: lands cleanly. The deliverable is two markdown files and no code path changes.
Two second-representation signals were found and both belong to other tickets with their own cited
consumers, not to this one: `/etc/harbour-clone-strategy` versus `SD_CLONE_STRATEGY`, already
assessed on LIN-1785 and owned by LIN-2422; and the machine/host concept modelled three times
(`workspaces.json` binding at `dispatcher.js:74`, `fleet-design.md`'s display-only `host` id, and
LIN-2883's account-owned record), which LIN-2883's own 17 September comment already scopes as its
delta. Neither has a consumer in this task, so neither is refactor-required here.
