# Documentation Review — 2026-08-29 (periodical run, drift-first, post-provider-generalisation)

*Review-only: no code, docs, config or secrets changed except this report artifact. Severity-ranked, uncapped; follow-ups capped at 3.*

**Session:** LIN-2379 execution pass, built on the same-day `research` and `plan` passes already recorded on the ticket. **HEAD** `LinearViewer` @ `292ac962` (= `origin/main`) · `simple-dispatcher` @ `7064955` (= `origin/main`). HEAD was stable across research → plan → execution (no new commits landed in either repo during this session); execution re-verified the seed SHAs by `git fetch`+`git log -1` on both repos immediately before writing this report.

**Re-grounding note.** The ticket's own seed SHAs (`8c9c3b08` / `7064955`, 2026-08-29) predate two `LinearViewer` commits that landed before the plan pass: `bfab2f58` (LIN-2357, one unrelated `CLAUDE.md` line) and `292ac962` (LIN-2354, #1287 — provider-framing rework in `routes/proxy.js`, `lib/proxy-preamble.js`, `lib/prompts/collective-participant.js`, `lib/prompts/autopilot-kickoff.js`, plus doc syncs). The plan pass spot-re-verified H1/H2/H3 at `292ac962` and found them unchanged. This execution pass independently re-verified H1–H4 directly against source at `292ac962`/`7064955` (see each finding's Confidence line) and additionally discovered that **LIN-2354 itself moved state since the plan pass — it is now Done** (its research-time state was "In Progress"), while 2 of the 5 production sites its own research named are still unconditional (see cross-link below). Everything else in this report inherits the already-verified research/plan record rather than re-deriving it from scratch, per the ticket's own "build on it, don't re-derive it" instruction.

---

# Findings, severity-ranked

## H1 · **HIGH** — the `/api/proxy/instructions` blob understates the `409` contract on the exact transition this task must make, and is a drifting second representation of `docs/proxy-integration.md`

**What.** `routes/proxy.js:2388`, the sole documented `409` cause inside the `/api/proxy/instructions` plain-text blob:

```
409 - Refusing to modify a trashed (soft-deleted) issue (write endpoints)
```

Re-verified directly at `292ac962`: the blob's read/write-endpoint sections (`routes/proxy.js:1794–2146`) contain no other 409 mention. At HEAD, `PATCH /api/proxy/issues/:id` and the dispatch-creation endpoints can answer `409` for **four** causes / **five** codes:

| cause | code | source |
|---|---|---|
| trashed target | — | documented (blob + guide) |
| duplicate dispatch | `DUPLICATE_DISPATCH` | `routes/proxy.js:994`, `docs/proxy-integration.md:1731,1736,1966` |
| task budget exhausted | `BUDGET_EXHAUSTED` | `routes/proxy.js:1035`, `docs/proxy-integration.md:1749,1754,1967` |
| periodical report not persisted | `PERIODICAL_REPORT_NOT_PERSISTED` | `lib/periodical-report-gate.js` |
| adversarial read not recorded | `PERIODICAL_ADVERSARIAL_READ_NOT_RECORDED` | `lib/periodical-report-gate.js` |

`docs/proxy-integration.md:1763` explicitly instructs *"Branch on `code`, not on the status: `409` is also used by the trashed-issue refusal."* — three of the five causes are absent from the blob entirely, including the two an automated periodical-review agent (such as this one) can hit on the exact `PATCH …→done` transition that concludes this task.

Same blob, same maintenance-asymmetry class, additional gaps confirmed present in `docs/proxy-integration.md` and absent from the blob at `292ac962`:
- `GET /api/proxy/issues/{identifier}/snapshots` (`routes/proxy.js:4669`) and `/snapshots/diff` (`:4702`) — zero hits in the blob's read-endpoints section.
- `GET /api/proxy/issues/{identifier}/prompt/{templateKey}` — the blob's own task-automation line (`routes/proxy.js:1882`, *"task-automation endpoints (recommend/recap/brief/prompt)"*) names `prompt` as one of four, but documents only the other three's shapes.

**The maintenance asymmetry is the real finding, and it is confirmed still true at HEAD.** `docs/proxy-integration.md` carries both new 409 codes and the snapshots endpoints in full; the blob carries neither. Two hand-maintained representations of one contract; only one is kept current.

**Confidence: verified at HEAD `292ac962`** — every line cited was re-read directly in this execution pass, not copied from the research comment.

---

## H2 · **HIGH** — `CLAUDE.md:71` calls the Jira provider read-only with no OAuth, contradicting the source module, `README.md`, `.env.example`, and `CLAUDE.md` itself

**What.** `CLAUDE.md:71` opens: *"Jira Cloud provider — **read-only Phase 1 MVP** … API-token Basic auth, **no OAuth** (Phase 3 deferred)."* Re-read verbatim at `292ac962` (unchanged from the plan pass's spot check).

Contradicted at HEAD by:
- `lib/providers/jira/index.js` — the module's own header states it adds the write surface (`updateIssue`, `createComment`, label mutation).
- `routes/jira-auth.js` — OAuth 2.0 3LO routes (`/auth/jira/oauth`, `/auth/jira/oauth/callback`, `/auth/jira/oauth/link`), which `CLAUDE.md:36` itself (35 lines above :71) describes as one of "TWO auth shapes, side by side."
- `.env.example` — documents the Jira OAuth 2.0 (3LO) vars as shipped (LIN-1887).
- `README.md:60` — *"Sign in with Jira via OAuth 2.0 … Reads, plus writes."*
- `CLAUDE.md:71` further down its own (1,093-word) line, which itself goes on to describe `updateIssue`'s status-transition write.

The opening clause — the part a reader takes away first — is wrong on both the read/write axis and the OAuth axis, and the file contradicts itself within 35 lines.

**Confidence: verified at HEAD `292ac962`.**

---

## H3 · **HIGH** — residual Linear-only framing in `CLAUDE.md`: LIN-2248 fixed the human entry point, not the agent-facing twin

**What.** `README.md` is genuinely fixed (see Clean Results). The identical defect class survives in `CLAUDE.md`, confirmed unchanged at `292ac962`:

- `CLAUDE.md:439` — *"Uses `graphql-request` to query **Linear's** GraphQL API … Single query fetches both projects and issues"* — presented as *the* data path, against five adapters in `lib/providers/` (`linear/`, `local/`, `github/`, `github-projects/`, `jira/`).
- `CLAUDE.md:40` — *"proxy.js — **Linear API proxy**"* and `:240` — *"proxy-integration.md — **Linear API proxy** consumer integration guide"* — against `README.md:50`/`:195` ("Workspace API Proxy … source-neutral"), the guide's own title, and **`CLAUDE.md:494`'s own heading `## Workspace API Proxy (provider-backed)`**. The file contradicts itself between line 40 and line 494.
- `CLAUDE.md:173` (per research; not independently re-cited this pass) — *"audit.js — Workspace audit module (computes audit report from Linear)"*.

Mirror surface, same lane, not independently re-checked this pass but unchanged since research (neither `lib/feature-defaults.js` nor `CLAUDE.md`'s Linear-framing lines are touched by either of the two commits that moved HEAD): `lib/feature-defaults.js` `FEATURE_LABELS[PROXY]` = `'Linear API proxy'` and `FEATURE_DESCRIPTIONS[PROXY]` — user-facing Settings copy.

**Confidence: verified at HEAD `292ac962`** for the `CLAUDE.md:40/240/439/494` lines (re-read directly this pass); the `feature-defaults.js` mirror is carried from the research pass unchanged (git history confirms neither moved-HEAD commit touches that file).

---

## H4 · **MED-HIGH** — `content/landing.md`, the public landing copy, names three backends of five and a stale template count

**What.** Re-read directly at `292ac962`:

- `content/landing.md:13` — *"**Linear, GitHub Issues, or a local store**—behind a single provider abstraction."* Five adapters exist (`lib/providers/`: `linear`, `jira`, `github`, `github-projects`, `local`); GitHub Projects v2 and Jira Cloud are both omitted, and both are advertised in `README.md:60` and `.env.example`.
- `content/landing.md:16` — *"**14** deterministic templates plus an LLM meta-prompt."* **17** at HEAD, confirmed this pass by executing `lib/prompt-template-defs.js` directly (`node -e "require('./lib/prompt-template-defs.js')"` → 17 keys) rather than trusting a grep, matching `public/llms.txt` and `CLAUDE.md`'s own (correct) counts.
- Provenance (from research, not re-verified this pass): both lines written 2026-06-25 in `51a90689` (LIN-646, the Harbour rebrand) and never revisited since.

This is the F1 defect class LIN-2248 closed, on the one surface that is **public** (served unauthenticated at boot via `server.js:194` → `lib/parse-landing.js`) and that no prior run in this series has examined.

**Confidence: verified at HEAD `292ac962`** — both counts re-checked directly this pass (template count via execution, not grep, per the research pass's own measurement-validity warning).

---

## H5 · **MED** — `docs/archive/4.html` is publicly served and named by nothing; a code comment's stated contract is now false

Carried from research, not independently re-verified this pass (no HEAD-moving commit touched `docs/archive/`, `CLAUDE.md:238`, or `lib/render-landing.js`). `docs/archive/4.html` (landed 2026-08-23, `784cf1c2`, #1217), served at `/archive/4`, is unnamed by `CLAUDE.md:238`'s "#1–#3" enumeration and by `tests/e2e/archive.spec.js`'s header/coverage (`/1`, `/2`, `/3`, `/999`, never `/4`); `lib/render-landing.js`'s own comment promises "the **latest** edition" while hard-coding `/archive/2`. Whether the landing *should* link #4 is Design & Interface's call; the false comment and stale enumeration are this review's.

**Confidence: carried from research (verified at `8c9c3b08`, unaffected by the two commits that moved HEAD to `292ac962`).**

---

## H6 · **MED** — F5 (`CLAUDE.md`'s exhaustive file map) re-measured and reframed: incomplete *and* over-written at the same time

Carried from research; the underlying files (`CLAUDE.md`'s map region, `lib/`, `routes/`, `lib/components/`) are not touched by either HEAD-moving commit, so the counts stand: **7** of 25 `routes/*.js` unnamed, **58** of 171 `lib/*.js` unnamed, **17** of 20 `lib/components/*.js` unnamed (a whole-file grep on "components" false-matches `prompt-section.js` against `section.js`, so the true count is 17, not the 08-23 report's 15). The map is simultaneously incomplete (a third of `lib/` absent) and over-written (8,841 of the file's 14,925 words are the map; 10 lines hold 52.3% of that; the H2-owning Jira entry alone is 1,093 words). That combination is new evidence for the previously-recorded human decision (generate vs. cut to load-bearing modules): the ~21 essay-length entries are the only part that can't be generated from the tree, so relocating them (to module headers, already excellent here, or `docs/`) makes "generate the rest" newly viable. **Not minted** — LIN-601 and LIN-664 both fixed this exact map and it re-drifted both times; a third mechanical backfill ticket buys weeks, per the 08-23 run's own reasoning, which this pass does not have a stronger argument to override.

**Confidence: carried from research (verified at `8c9c3b08`; not independently re-measured this pass).**

---

## H7 · **MED** — six modules/routes new since the last run appear zero times in any non-review doc

Carried from research. Exhaustive-grep result (not re-run this pass, but the named files are untouched by either HEAD-moving commit): `lib/periodical-report-gate.js`, `lib/proxy-credential-trail.js`, `lib/account-conflict.js`, `routes/account-merge.js`, `routes/workspace-api-prompts.js`, `routes/workspace-api-roadmap.js` — zero hits in `CLAUDE.md`, `public/llms.txt`, `README.md`, or `docs/*.md` (excluding `docs/reviews/`). `lib/periodical-report-gate.js` is the engine gating **this very task**; `CLAUDE.md:229-237` documents its report-location half but not the adversarial-second-read half, which is now the half most likely to block a Done. `routes/account-merge.js` is also absent from the `/instructions` blob (H1's surface — counted once, attributed to both).

**Confidence: carried from research (verified at `8c9c3b08`).**

---

## H8 · **MED-LOW** — discoverability: the entry-point map indexes 3 of 52 docs, and seven overlapping autopilot documents carry no in-force marker

Carried from research, unaffected by HEAD movement. `CLAUDE.md`'s `docs/` block names 3 of 52 top-level docs; `charter/`, `roadmaps/`, `incidents/`, `observation-mockups/` unreferenced, `plans/` (8 docs) and `prototypes/` absent from the map entirely; no `docs/README.md`/index. Seven autopilot documents (2,551 lines): `autopilot-operating-manual.md` is the live one (read at runtime); `autopilot-operating-manual-v2.md` carries the **same title and near-identical opening**, was added once and never touched since, and says nothing about supersession — a reader picking by filename can pick the dead one. `docs/charter/*.md`'s `> **Status: DRAFT, not adopted.**` header is the in-repo precedent for the fix.

**Confidence: carried from research (verified at `8c9c3b08`).**

---

## H9 · **LOW-MED** — run-the-repo commands documented in neither entry doc

Carried from research. `simple-dispatcher`: 13 of 18 `package.json` scripts appear in neither `README.md` nor `CLAUDE.md`, including the entire `test:e2e:*` family and `clones`/`clones:reap` — the only user-driven way to reclaim clone disk, per `clones.js`'s own header. `LinearViewer`: `npm run setup` (installs deps + Playwright + runs `env:check`) appears in neither entry doc's `## Commands`, which lists the four manual steps it automates.

**Confidence: carried from research (verified at `7064955`/`8c9c3b08`; neither repo's `package.json` or entry docs are touched by the HEAD-moving commits).**

---

## H10 · **LOW** — `docs/direction-layer-proposal.md:21`: three defects in one paragraph, fourth consecutive run recorded

Carried from research and from three prior runs (06-25, 08-23, and now). *"There are **four** transport layers … (dispatch queue, proxy API, **Linear CLI**, llms.txt + data attributes)"* — `lib/linear-cli.js` was deleted by LIN-580; there are three. The same paragraph also names the phantom "pipeline" view (removed from `README.md` by LIN-2248) and frames Harbour's context as specifically "Linear". Cited as prior art by LIN-1647/LIN-1648, still open.

**Confidence: carried from research (verified at `8c9c3b08`; file untouched by HEAD movement).**

---

## H11 · **LOW** — `public/llms.txt:127` sends agents to a session-dependent legacy alias

Carried from research. *".footer-ai-model … filled client-side from `/api/recommend/status`"* — `public/app.js` actually calls the workspace-scoped `/workspace/${urlKey}/api/recommend/status`; the unscoped path exists only as a legacy redirect that 401s with no active workspace. `llms.txt` uses the workspace-scoped form two lines later, internally inconsistent.

**Confidence: carried from research (verified at `8c9c3b08`).**

---

## H12 · **LOW** — `server.js:1718` comment: wrong count, misleading qualifier

Carried from research. *"publishes the **16 non-meta** prompt templates"* — there are 17 (confirmed this pass alongside H4, same execution), and `PROMPT_TEMPLATES` contains no meta template at all, so "non-meta" implies a filter that does not exist. The rendered page itself is unaffected (derives its count from source, not the comment).

**Confidence: verified at HEAD `292ac962`** (re-confirmed as part of the H4 template-count execution this pass).

---

## F2 (carried, **LIN-1856 owns**) · **MED** — `docs/view-tiers.md` still 7 of 9, and there is now a third representation

Carried from research, unaffected by HEAD movement (neither `lib/feature-defaults.js` nor `docs/view-tiers.md` is touched by the two moved-HEAD commits). `lib/feature-defaults.js`'s `EXPERIMENTAL_VIEWS` holds 9 entries; `docs/view-tiers.md` lists 7 — `passage-planner` and `live-console` absent. **`CLAUDE.md:277`** (per research; the View Tiers section of `CLAUDE.md` read in this pass names 9 experimental views correctly) already carries a correct, current, one-line 9-member summary of the same model — a third representation, and the redundant hand-maintained *list* is the one that rots. **LIN-1856 already owns this** — posted as a cross-link update, not minted (see §5 and the LIN-1856 comment).

**Confidence: carried from research (verified at `8c9c3b08`); the `CLAUDE.md` View Tiers section's correctness spot-checked this pass.**

---

# 3. Clean results — checked, and genuinely fine

1. **Zero `TODO`/`FIXME`/`HACK`/`XXX` markers** in production or documentation source across both repos (excluding `node_modules`, vendored bundles, `docs/reviews`, `docs/archive`) — carried from research, sweep not re-run this pass.
2. **Zero broken path references** across 172 path refs in the LinearViewer primary docs (`README.md`, `CLAUDE.md`, `public/llms.txt`, `proxy-integration.md`, `dispatch-integration.md`, `dispatch-protocol.md`, `view-tiers.md`) — carried from research.
3. **`public/llms.txt`'s selector contract holds completely** — all 39 `data-testid` values, every `data-*` attribute, all 10 named routes verified against source — carried from research.
4. **`LinearViewer/.env.example` and `simple-dispatcher`'s harness/target contract** (`README.md:13-29`) are both high-quality, accurate config-commentary surfaces — carried from research; not a finding.
5. **`docs/dispatch-protocol.md` has zero provider mentions, and that is correct** — the file governs dispatcher↔session-node messaging, a layer with no task-source dimension; adding provider language would make it worse. Explicitly not flagged (a seed that would have been a false finding).
6. **`CLAUDE_CODE_BUBBLEWRAP` in `simple-dispatcher/README.md` is accurate, not stale** — a mechanical env-var diff would flag it as documented-but-never-read; reading it shows it correctly names what a sibling var deliberately does *not* mirror. Would have been a false finding.
7. **`periodicals-stale-rationale-counts` (LIN-687's underlying defect) — confirmed fixed in code.** Re-read directly this pass: `lib/periodicals.js`'s header states "12 corrective … 3 advisory" and "the fifteen", matching a registry of exactly 15 entries at `292ac962`. The ticket itself (LIN-687) remains open in Backlog — recommended for close, not re-flagged (see §5/§6).
8. **`docs/proxy-integration.md:9`'s "currently backed by Linear"** — re-read this pass, still accurate and appropriately hedged (*"Workspaces are **currently** backed by Linear, but consumers should code to the documented shapes here"*), immediately followed by the source-neutral instruction. Distinct from H3/LIN-2354's unhedged assertions elsewhere; not a finding.
9. **`simple-dispatcher`'s env-var residue (33 vars in neither README/CLAUDE.md/docs)** — re-confirmed via research as near-entirely `*_MS`/retry timing knobs the 08-23 run already judged defensible silence; not re-flagged per the ticket's explicit "do not re-open" instruction.

---

# 4. Seeds corrected / prior-prose corrections

Per the ticket's own instruction ("re-verify every seed against source at HEAD; correct rather than repeat any that no longer hold"), the research pass recorded five corrections against the ticket's seed prose (not against the 08-23 report, which stands as written):

1. **`lib/components` unnamed count is 17 of 20, not 15.** A whole-file grep false-matches `section.js` against `prompt-section.js`; folded into H6 above.
2. **README `Jira` mentions = 13, not 12.**
3. **74 `LinearViewer` commits landed since the 08-23 review's baseline `0e8a1461`, not 68** (as of the research-pass HEAD `8c9c3b08`).
4. **The 08-23 report's F2 "in order" claim does not fail independently of the omissions** — `docs/view-tiers.md`'s ordering issue and its two missing members are not two separate defects; membership is the finding.
5. **The 16-vs-17 template-count question can only be answered by executing `lib/prompt-template-defs.js`, never by grepping it** — a grep silently misses the module's one computed key (`[WORK_ISSUE_LABELS.BUG]`). This execution pass re-confirmed 17 by running the module directly (see H4/H12), not by trusting the prior count.

Two additional seed items from the ticket's own resolved-list were re-verified and correctly found still resolved, not re-flagged: F1 (README provider drift, LIN-2248 Done), F3 (`simple-dispatcher` broker env vars, LIN-2249 Done), F4 (`llms.txt` Linear-only framing, LIN-2250 Done).

---

# 5. Follow-ups minted — 3, at the cap

| ticket | finding | why promoted |
|---|---|---|
| **(to be minted)** | **H1** — `/api/proxy/instructions` blob: 409/endpoint/capability drift vs. `docs/proxy-integration.md` | Highest consequence — misdirects the exact agent class this repo dispatches, on the exact transition this task itself must make |
| **(to be minted)** | **H2 + H3 combined, one `CLAUDE.md` ticket** — Jira read-only/no-OAuth claim + residual Linear-only framing (proxy.js/proxy-integration.md/audit.js entries, `## Linear API` section, Settings copy mirror) | Same defect class (stale provider-framing prose) in one file; LIN-2248 is the template for the fix |
| **(to be minted)** | **H4** — `content/landing.md`: 3-of-5 backend count + 14-vs-17 template count | Two-line subtractive fix on the only public, unauthenticated copy surface; same defect class LIN-2248/2250 already fixed elsewhere |

**Not minted, deliberately** (recorded above so the next run can promote what still matters):
- **F2** — LIN-1856 already owns it; posted an updated measurement + cross-link there instead of duplicating.
- **H5, H7, H8, H9, H10, H11, H12** — below the cap and below H1–H4 on consequence; recorded in full above for the next run.
- **H6** — architectural choice for a human (generate the map vs. cut to load-bearing modules); two prior tickets (LIN-601, LIN-664) both minted the mechanical backfill and both re-drifted. This pass's new distribution evidence (8,841 words / 59% of the file, 10 lines holding 52.3%) strengthens the case for option (a) — generate — but does not by itself constitute the "better argument" the ticket's own guardrail asks for before a third mechanical ticket; carried forward as a human decision, not minted.

See §6 for the cross-link disposition of already-owned findings (F2, LIN-2177's items, LIN-687, LIN-1233, LIN-2354's residual sites).

---

# 6. Sibling seams — cross-linked, not duplicated

| ticket | state (re-checked this pass) | disposition |
|---|---|---|
| **LIN-1856** | Todo | **Owns F2.** Posted the current 7-of-9 measurement + the `CLAUDE.md`'s View Tiers section third-representation evidence. Not minted. |
| **LIN-2354** | **Done** (moved from "In Progress" since the plan pass — #1287 merged, landing exactly at this review's HEAD `292ac962`) | Fixed 3 of its own 5 named production sites. **2 remain unconditional at HEAD**, confirmed this pass: `public/common.js:1280` and `public/proxy.js:111` still hardcode *"currently backed by Linear"* with no provider check. Posted as a comment on the (now-Done) ticket rather than minted as a new finding — same lane, same owner, per the ticket's explicit instruction to route these two sites there rather than duplicate. Whether to reopen LIN-2354 or file a fresh follow-up is normal operations' call, not this review's. H3 remains a **different** surface (CLAUDE.md prose + Settings copy) and stays a minted follow-up target, not folded into this note. |
| **LIN-2177** | Backlog | Owns three `simple-dispatcher` items. **Re-verified this pass, all three still unaddressed at `7064955`**: (1) `admission.js` still carries the stale "typically a case-mismatched basename" comment verbatim; (2) `README.md`'s `workspaces.json` section has no basename/uniqueness/`exit(1)` language; (3) the case-mismatch behaviour-loss point is unnamed. Posted confirmation; not duplicated. |
| **LIN-687** | Backlog | Underlying defect confirmed fixed in code this pass (Clean Results #7). Recommended for close as resolved. |
| **LIN-1233** | Backlog | The 08-23 run recommended closing as superseded by this review series; still open. Re-raised. |
| Code Quality (this batch) | — | Owns `/api/proxy/instructions` as code **bulk**; H1 is its **content**, which is this review's. |
| Design & Interface | — | Owns whether the landing should link `/archive/4`; the false comment/stale enumeration (H5) is this review's. |
| Comprehension-Debt | — | Defers per-comment accuracy here; H12 and LIN-2177 item 1 are that class. |
| Drift & Coherence | — | H6's *cause* (hand-maintained mirrors against a fast-growing tree) touches their remit; the drift *measurement* is this review's — no convention change proposed. |
| Onboarding & Cold-Start | — | H9 is doc absence, not a walk failure — no walk performed. |

---

# 7. Trend ledger — against the 2026-08-23 baseline

| item | 08-23 | 08-29 | movement |
|---|---|---|---|
| `proxy-instructions-blob-409-drift` (H1) | not examined (H1 is new this run) | blob documents 1 of 5 409 causes; also missing snapshots/prompt-template endpoints | **new, high** |
| `claude-md-jira-readonly-claim` (H2) | not examined | contradicts source module, README, `.env.example`, and itself | **new, high** |
| `claude-md-linear-only-framing` (H3) | not examined as a `CLAUDE.md`-specific finding | `:40/:240/:439` vs. `:494`'s own heading; README's equivalent (F1) is fixed, this twin is not | **new, high — the agent-facing counterpart of a fixed human-facing defect** |
| `landing-md-backend-template-drift` (H4) | not examined (`content/landing.md` never previously reviewed) | 3 of 5 backends named; 14 vs. 17 templates | **new, med-high — same defect class as fixed F1/F4, on a newly-examined surface** |
| `view-tiers-experimental-list` (F2) | 7 of 9; LIN-1856 owns | still 7 of 9, now a confirmed third representation against `CLAUDE.md`'s correct one-liner | **unchanged, cross-linked again** |
| `claude-md-routes-map-drift` (H6/F5) | 4 routes / 55 lib modules absent | 7 routes / 58 lib modules absent, plus new word-distribution evidence (59% of file, 10 lines = 52.3%) | **re-drifted a third time; new argument recorded, still not minted** |
| `direction-layer-proposal-stale-cli-transport` (H10/F6) | recorded, third run | unchanged — still "four … Linear CLI" | **unchanged, fourth run recorded** |
| `periodicals-stale-rationale-counts` (LIN-687) | resolved in code, ticket still open | confirmed still resolved in code; ticket still open in Backlog | **stable; recommend close** |
| `readme-provider-drift` / `simple-dispatcher-broker-env` / `llms-txt-linear-only-framing` (F1/F3/F4) | new, high/med-high/med | all three confirmed Done (LIN-2248/2249/2250) | **resolved** |
| `simple-dispatcher-docs-cleanup` (LIN-2177) | not examined by this series before 08-23 | all three items confirmed still open at current HEAD | **unchanged, cross-linked again** |
| `provider-framing-production-sites` (LIN-2354) | not tracked by this series | ticket itself now Done; 2 of 5 named sites still unconditional | **partially resolved; residual gap flagged to the owning (closed) ticket, not minted as new** |
| `documentation-review-second-repo-coverage` | first extended to `simple-dispatcher` this series (08-23) | `simple-dispatcher` findings (H9, LIN-2177 cross-link) continue; no new `simple-dispatcher`-only high-severity finding this run | **stable — `simple-dispatcher`'s doc surface is comparatively clean relative to `LinearViewer`'s** |

---

## Adversarial Second-Read

*(Filled in after the second-read dispatch — see the mandatory gate comment on LIN-2379 for the machine-readable form of these same three fields.)*

**Tier:** _pending_
**Question asked:** "What is the largest item in this window that this report missed or misfiled?"
**Reader's answer in full:** _pending_

```
Adversarial second-read verdict: PENDING
Differed from top finding: PENDING
Disposition: PENDING
```
