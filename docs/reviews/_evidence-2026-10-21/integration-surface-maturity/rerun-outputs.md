# Re-run outputs: Integration & Surface Maturity run 4 (LIN-3766, beat 1)

Every bound in LIN-3766's class table, re-run at the pinned SHAs, with the query, the SHA, the timestamp and the verbatim output, so the fresh-eyes reviewer (LIN-3767) can reproduce each one.

- LinearViewer pin: `c5694b686f3302029d1c10a5f19dc9e4e96a06bd` (`c5694b68`), the `origin/main` HEAD at fetch.
- simple-dispatcher pin: `bb1da78e29a99940dc5aa37cf7e826992db097f5` (`bb1da78`), the `origin/main` HEAD at fetch.
- Run-3 baseline: `e69e2cc9` (LinearViewer), `3b1e734` (simple-dispatcher).
- Every query reads the pinned SHA with `git grep <sha> -- <paths>`, `git show <sha>:<path>` or `git log <range>`. None reads the working tree.

## Reproducibility notes (counting rules, written down)

These answer plan-review notes N1, N2, N3, N4, N6 and N7. Where a figure in the plan does not reproduce, the section says so and gives the figure this re-run does produce.

- **Line counts** are `git grep -n` lines, not files, unless a query says `-l` or "files". `git grep` is run with `-E` and a literal pattern, shown verbatim.
- **C9 Arm A** counts every line returned by the single query in the C9 section, comments and runtime strings together (60). The plan's "51 comments, 9 runtime/user strings excluded" is a read-and-judge split of those 60 lines and is not a second query.
- **C9 Arm B** has no written query in the plan. The literal form `(once|until|pending|awaiting) LIN-N` returns 7 lines case-sensitive and 10 case-insensitive; two wider forms return 50 and 55. The plan's "73 lines over 61 tickets" does **not** reproduce under any pattern written down here. Arm B members are chosen by reading each line, so the count is not load-bearing; the members are (`c9-members.md`). **Runtime strings are included in Arm B**, which is why `lib/effort-readout.js:597` counts there although Arm A excludes runtime strings.
- **C10 paragraph rule.** A "unit" is one table row, or one blank-line-delimited block of non-table lines. A bare `` `:NNN` `` cite resolves to the nearest preceding path mention (any `name.ext`, backticked or not) inside the same unit, searching the same line left of the cite first. The script, its output and the group count are in the C10 section.
- **C10 group count.** The plan says 143 groups. This re-run's script gives **137**. The 143 does not reproduce under the written rule, and 137 is the count the dispositions will use.
- **C11 counting rule.** A simple-dispatcher non-merge commit "crosses" if a `LIN-<n>` id in its subject or body also appears in the subject or body of a LinearViewer non-merge commit in `e69e2cc9..c5694b68`. Squash-PR numbers come from the `(#NNNN)` in the LinearViewer commit subject. Six ids have such a PR, and seven PR numbers.
- **C14 Arm 1.** The plan's subject regex and exclusion list were never written down. The regexes this re-run uses are printed in the C14 section; they give 28 + 26 = 54, not 45 + 22 = 67. The count is not load-bearing; the 13 kept members are named commits, each checked by hand.
- **Importer grep (N7).** `from '.*/<name>.js'` matches on basenames, so it collides for the three duplicate basenames (`email-auth`, `library`, `milestone-funnel`). Importer queries for those rows use the full relative path (`from '.*/routes/email-auth.js'`).

### Q1. Fetch, pins and HEAD timestamps (LinearViewer)

- repo: `LinearViewer` · SHA: `origin/main` · run at: `2026-10-21T12:05:24Z`

```bash
git fetch origin 2>&1 | tail -2; echo "fetched: $(date -u +%Y-%m-%dT%H:%M:%SZ)"; git rev-parse origin/main; git log -1 --format="%H committed %cI (%cd)" --date=iso-strict origin/main; git rev-parse --short=8 c5694b68
```

```text
fetched: 2026-10-21T12:05:24Z
c5694b686f3302029d1c10a5f19dc9e4e96a06bd
c5694b686f3302029d1c10a5f19dc9e4e96a06bd committed 2026-10-21T11:16:46+01:00 (2026-10-21T11:16:46+01:00)
c5694b68
```

### Q2. Fetch, pins and HEAD timestamps (simple-dispatcher)

- repo: `simple-dispatcher` · SHA: `origin/main` · run at: `2026-10-21T12:05:24Z`

```bash
git fetch origin 2>&1 | tail -2; echo "fetched: $(date -u +%Y-%m-%dT%H:%M:%SZ)"; git rev-parse origin/main; git log -1 --format="%H committed %cI" origin/main
```

```text
fetched: 2026-10-21T12:05:25Z
bb1da78e29a99940dc5aa37cf7e826992db097f5
bb1da78e29a99940dc5aa37cf7e826992db097f5 committed 2026-10-19T22:38:59+01:00
```

### Q3. Drift since the plan-review timestamps (both repos, whole-repo, so also every cited path)

- repo: `LinearViewer` · SHA: `origin/main` · run at: `2026-10-21T12:05:25Z`

```bash
for s in 2026-10-21T10:57:26.014Z 2026-10-21T10:22:07Z; do echo "LinearViewer --since=$s: $(git log origin/main --since=$s --format=%h | wc -l | tr -d " ") commits"; echo "simple-dispatcher --since=$s: $(git -C ../simple-dispatcher log origin/main --since=$s --format=%h | wc -l | tr -d " ") commits"; done; echo "LinearViewer commits after the pin: $(git rev-list --count c5694b68..origin/main)"; echo "simple-dispatcher commits after the pin: $(git -C ../simple-dispatcher rev-list --count bb1da78..origin/main)"
```

```text
LinearViewer --since=2026-10-21T10:57:26.014Z: 0 commits
simple-dispatcher --since=2026-10-21T10:57:26.014Z: 0 commits
LinearViewer --since=2026-10-21T10:22:07Z: 0 commits
simple-dispatcher --since=2026-10-21T10:22:07Z: 0 commits
LinearViewer commits after the pin: 0
simple-dispatcher commits after the pin: 0
```

### Q4. Window commits (C1 context)

- repo: `LinearViewer` · SHA: `c5694b68` · run at: `2026-10-21T12:05:25Z`

```bash
git rev-list --count e69e2cc9..c5694b68; echo "touching lib/routes/server.js:"; git rev-list --count e69e2cc9..c5694b68 -- lib routes server.js
```

```text
1158
touching lib/routes/server.js:
577
```

### Q5. C1 added files under lib/routes (list + counts)

- repo: `LinearViewer` · SHA: `c5694b68` · run at: `2026-10-21T12:05:25Z`

```bash
git diff --diff-filter=A --name-only e69e2cc9..c5694b68 -- lib routes | tee /dev/stderr | wc -l; echo "(lib/ : $(git diff --diff-filter=A --name-only e69e2cc9..c5694b68 -- lib | wc -l | tr -d " "), routes/ : $(git diff --diff-filter=A --name-only e69e2cc9..c5694b68 -- routes | wc -l | tr -d " "))"; echo "renamed (-M --diff-filter=R): $(git diff -M --diff-filter=R --name-only e69e2cc9..c5694b68 -- lib routes | wc -l | tr -d " ")"
```

```text
lib/account-erasure.js
lib/account-group.js
lib/action-kind.js
lib/ci-wake-sweep.js
lib/close-out-events-store.js
lib/close-out-readiness.js
lib/components/runner-link.js
lib/connection-access.js
lib/connection-binding.js
lib/connection-credential.js
lib/connection-lifecycle.js
lib/connection-store.js
lib/consumer-heartbeat-ingest.js
lib/consumer-heartbeat-store.js
lib/consumer-heartbeat.js
lib/dispatch-entrance.js
lib/dispatch-feedback-format.js
lib/dispatch-feedback-validation.js
lib/dispatch-fields.js
lib/dispatch-lineage.js
lib/dispatch-refusal.js
lib/dispatch-session-redaction.js
lib/dispatch-targets.js
lib/drop-shares-collection.js
lib/email-auth.js
lib/email-availability.js
lib/email-transport.js
lib/expire-ownerless-dispatch-tokens.js
lib/file-pointer.js
lib/flight-companion-census-seed.js
lib/follow-up-dispatch.js
lib/github-pr-files.js
lib/github-pr-status.js
lib/guest-task-path.js
lib/held-connection-entry.js
lib/hourly-cleanup.js
lib/kpi-daily-rollup.js
lib/kpi-page.js
lib/library-metadata.js
lib/library.js
lib/lineage-closure.js
lib/liveness-alarm-store.js
lib/liveness-alarm-sweep.js
lib/liveness-detectors.js
lib/loose-json.js
lib/mask-secrets-in-html.js
lib/milestone-funnel.js
lib/owner-backfill.js
lib/owner-mint-refusals.js
lib/persist-binding.js
lib/plan-allowance.js
lib/poll-halt.js
lib/pr-state-copy.js
lib/pr-state-store.js
lib/prompt-contract.js
lib/prompts/revision-brief.js
lib/prompts/runner-kickoff.js
lib/prompts/stage-intent.js
lib/providers/github/installation-pages.js
lib/proxy-scopes.js
lib/public-origin.js
lib/question-card.js
lib/read-horizon.js
lib/recent-runs.js
lib/recommendation-input.js
lib/render-account-home.js
lib/render-email-auth.js
lib/render-library.js
lib/render-prompt-opts.js
lib/render-run-evidence.js
lib/render-run-steps.js
lib/render-runner-setup.js
lib/render-task-page.js
lib/render-workspace-kpis.js
lib/require-grant.js
lib/response-headers.js
lib/run-closeout-state.js
lib/run-evidence.js
lib/run-ledger.js
lib/run-loop-state.js
lib/run-paragraph-hook.js
lib/run-paragraph-store.js
lib/run-paragraph.js
lib/run-proposals-store.js
lib/run-view.js
lib/runner-kit/broker.mjs
lib/runner-kit/contract.json
lib/runner-kit/runner.mjs
lib/runner-owner-gate.js
lib/sample-data/mock-data.js
lib/sample-data/ship-dense-sample-data.js
lib/sample-data/swim-sample-data.js
lib/security-headers.js
lib/session-materializer-precompute.js
lib/session-options.js
lib/session-row-live.js
lib/settings-proxy-default.js
lib/should-mock-ai.js
lib/stage-router.js
lib/starter-seed.js
lib/superseded-selection.js
lib/task-mode-store.js
lib/task-page-href.js
lib/task-page-loader.js
lib/task-run-facts.js
lib/task-share-access.js
lib/task-share-store.js
lib/ticket-close-closer.js
lib/unpriced-models.js
lib/urlkey-holders.js
lib/utils/time.js
lib/wake-credential.js
lib/wake-shadow.js
lib/workspace-api-mocks.js
lib/workspace-kpi-stats.js
lib/workspace-lookup.js
lib/workspace-owner.js
lib/workspace-registry.js
lib/workspace-removal-revocation.js
lib/workspace-urlkey.js
routes/email-auth.js
routes/held-connection.js
routes/library.js
routes/milestone-funnel.js
routes/provider-auth-routers.js
routes/proxy-alarms.js
routes/proxy-runner-prompt.js
routes/proxy-runner.js
routes/runner-kit.js
routes/runner-setup.js
routes/task-mode.js
routes/task-page.js
routes/task-share.js
routes/workspace-kpis.js
     134
(lib/ : 120, routes/ : 14)
renamed (-M --diff-filter=R): 0
```

### Q6. C2 deleted files under lib/routes, and repo-wide

- repo: `LinearViewer` · SHA: `c5694b68` · run at: `2026-10-21T12:05:26Z`

```bash
git diff --diff-filter=D --name-only e69e2cc9..c5694b68 -- lib routes; echo "--- repo-wide:"; git diff --diff-filter=D --name-only e69e2cc9..c5694b68 | tee /dev/stderr | wc -l; echo "--- deleted files cited by run 3 (line numbers):"; git show c5694b68:docs/reviews/integration-surface-maturity-review-2026-09-26.md | grep -n -E "dispatch-repo-guard|workspace-repos|meta-prompt-template" | cut -c1-120
```

```text
lib/dispatch-repo-guard.js
lib/prompts/meta-prompt-template.js
lib/workspace-repos.js
--- repo-wide:
lib/dispatch-repo-guard.js
lib/prompts/meta-prompt-template.js
lib/workspace-repos.js
scripts/eval-plan-review.mjs
scripts/eval-prompt-scaling.mjs
scripts/eval/assessment-scaffold-spike.mjs
scripts/eval/lin-263-spike.mjs
scripts/eval/lin-263-spike2.mjs
scripts/eval/lin-263-spike3.mjs
scripts/eval/lin-263-spike5.mjs
scripts/eval/lin-263-spike5b.mjs
scripts/eval/phase4-distillation-probe.mjs
tests/unit/dispatch-repo-guard.test.js
tests/unit/dispatch-watch-max-sessions-per-task-field.test.js
tests/unit/proxy-dispatch-repo-guard.test.js
tests/unit/proxy-known-repos.test.js
tests/unit/resolve-dispatch-repo.test.js
tests/unit/workspace-repos.test.js
      18
--- deleted files cited by run 3 (line numbers):
80:  `lib/workspace-repos.js` **now has production importers** (`lib/dispatch-repo-guard.js:25`,
283:- **Resolved:** `lib/workspace-repos.js` (LIN-1935) **now has production importers** —
284:  `lib/dispatch-repo-guard.js:25` and `lib/chat-tools.js:119` (run 2 recorded zero).
367:- `lib/dispatch-repo-guard.js` → `api-workspace-proxy` (importers `routes/proxy-reads.js`,
408:| 7 | `routes/proxy-reads.js` | fold → `api-workspace-proxy` | mounted `routes/proxy.js:1328`; imports `dispatch-rep
426:| 25 | `lib/dispatch-repo-guard.js` | fold → `api-workspace-proxy` | `proxy-reads`, `proxy-dispatch` |
457:`logEvent` sites) and gains CFG evidence (`dispatch-repo-guard.js`, `proxy-graphql-errors.js`,
541:  still drops `periodicalId`). **R3 — no** (both tracking tickets Backlog). **R8 — mixed** (`workspace-repos`
612:| `api-workspace-proxy` | Harbour's exposed source-neutral consumer API | 4 | 4 | High | unchanged — router decompos
```

### Q7. Deleting commits (C2)

- repo: `LinearViewer` · SHA: `c5694b68` · run at: `2026-10-21T12:05:26Z`

```bash
for f in lib/dispatch-repo-guard.js lib/workspace-repos.js lib/prompts/meta-prompt-template.js; do git log --diff-filter=D --format="%h %s" -1 e69e2cc9..c5694b68 -- $f | cut -c1-130; done
```

```text
e1a80856 LIN-3333: retire repo= lines on projects
e1a80856 LIN-3333: retire repo= lines on projects
19d7198a LIN-3300: one path for every recommendation
```

### Q8. simple-dispatcher window 3b1e734..bb1da78

- repo: `simple-dispatcher` · SHA: `bb1da78` · run at: `2026-10-21T12:05:26Z`

```bash
echo "all commits: $(git rev-list --count 3b1e734..bb1da78)"; echo "non-merge: $(git rev-list --count --no-merges 3b1e734..bb1da78)"; git diff --shortstat 3b1e734..bb1da78
```

```text
all commits: 61
non-merge: 48
 110 files changed, 10956 insertions(+), 946 deletions(-)
```

### Q9. Evidence subfolder still free? (docs/reviews directories, and any integration-surface / isml-4 file in _evidence-2026-10-21)

- repo: `LinearViewer` · SHA: `origin/main` · run at: `2026-10-21T12:05:26Z`

```bash
git ls-tree -d --name-only origin/main docs/reviews/; echo "files under _evidence-2026-10-21: $(git ls-tree -r --name-only origin/main docs/reviews/_evidence-2026-10-21 | wc -l | tr -d " ")"; echo "matching integration-surface or isml-4: $(git ls-tree -r --name-only origin/main docs/reviews/_evidence-2026-10-21 | grep -c -i -E "integration-surface|isml-4")"; git check-ignore -v docs/reviews/_evidence-2026-10-21/integration-surface-maturity/rerun-outputs.md docs/reviews/integration-surface-maturity-review-2026-10-21.md; echo "check-ignore exit (1 = neither path ignored): $?"
```

```text
docs/reviews/_evidence-2026-06-20-lin568
docs/reviews/_evidence-2026-06-20
docs/reviews/_evidence-2026-06-25
docs/reviews/_evidence-2026-07-03
docs/reviews/_evidence-2026-08-29
docs/reviews/_evidence-2026-09-26
docs/reviews/_evidence-2026-10-13
docs/reviews/_evidence-2026-10-20
docs/reviews/_evidence-2026-10-21
docs/reviews/v1-passage-debrief-2026-10-10
files under _evidence-2026-10-21: 845
matching integration-surface or isml-4: 0
check-ignore exit (1 = neither path ignored): 1
```

### Q10. docs/reviews top-level files at the pin (C12 / R6 sibling-freshness input; newest edition per family)

- repo: `LinearViewer` · SHA: `origin/main` · run at: `2026-10-21T12:05:26Z`

```bash
git ls-tree --name-only origin/main docs/reviews/ | grep "\.md$" | sed "s#docs/reviews/##" | sort; echo "---- total md: $(git ls-tree --name-only origin/main docs/reviews/ | grep -c "\.md$")"; echo "---- files dated after run 3 (2026-09-26): $(git ls-tree --name-only origin/main docs/reviews/ | grep "\.md$" | grep -E "2026-(09-2[7-9]|09-30|10-)" | wc -l | tr -d " ")"
```

```text
api-quality-review-2026-06-25.md
capacity-levers-map-2026-08-15.md
capacity-test-run-review-2026-08-14.md
cheap-implementer-bakeoff-2026-09-13.md
code-quality-review-2026-06-25.md
code-quality-review-2026-08-23.md
code-quality-review-2026-08-29.md
code-quality-review-2026-09-26.md
code-quality-review-2026-10-12-tests.md
code-quality-review-2026-10-12.md
code-quality-review-2026-10-20.md
comprehension-debt-review-2026-06-12.md
comprehension-debt-review-2026-06-25.md
comprehension-debt-review-2026-07-01.md
context-efficiency-ceiling-review-2026-08-15.md
dependency-supply-chain-review-2026-06-25.md
design-interface-review-2026-06-20-lin568.md
design-interface-review-2026-06-20.md
design-interface-review-2026-06-25.md
design-interface-review-2026-07-03.md
design-interface-review-2026-08-23.md
design-interface-review-2026-08-29.md
design-interface-review-2026-09-26.md
design-interface-review-2026-10-21.md
documentation-review-2026-06-22.md
documentation-review-2026-06-25.md
documentation-review-2026-08-23.md
documentation-review-2026-08-29.md
documentation-review-2026-09-26.md
documentation-review-2026-10-21.md
drift-coherence-review-2026-06-10.md
drift-coherence-review-2026-06-11.md
drift-coherence-review-2026-06-25.md
drift-coherence-review-2026-08-29.md
drift-coherence-review-2026-09-26.md
drift-coherence-review-2026-10-11-post-batch.md
drift-coherence-review-2026-10-11.md
drift-coherence-review-2026-10-12.md
drift-coherence-review-2026-10-18.md
drift-coherence-review-2026-10-19.md
integration-surface-maturity-review-2026-07-17.md
integration-surface-maturity-review-2026-08-29.md
integration-surface-maturity-review-2026-09-26.md
intra-session-efficiency-review-2026-08-14.md
lane-run-review-2026-08-23.md
model-effort-routing-proposal-2026-09-11.md
onboarding-cold-start-review-2026-08-29.md
onboarding-cold-start-review-2026-09-26.md
outward-validation-run-2026-08-28.md
pre-ramp-harness-run-2026-09-14.md
proposal-red-team-2026-09-18.md
recent-headwinds-review-2026-06-18.md
recent-headwinds-review-2026-06-25.md
recent-headwinds-review-2026-07-02.md
recent-headwinds-review-2026-07-09.md
recent-headwinds-review-2026-08-03.md
recent-headwinds-review-2026-08-23.md
recent-headwinds-review-2026-08-29.md
recent-headwinds-review-2026-09-26.md
recent-headwinds-review-2026-10-21.md
seams-tangles-review-2026-10-13.md
seams-tangles-review-2026-10-20.md
security-review-2026-06-25.md
security-review-2026-10-18.md
stability-review-2026-06-25.md
stability-review-2026-10-12.md
stability-review-2026-10-21.md
test-coverage-gap-2026-06-25.md
---- total md: 68
---- files dated after run 3 (2026-09-26): 16
```

### Q11. C3 churn: top 25 non-test modified files (numstat, adds+dels, adds, dels, path)

- repo: `LinearViewer` · SHA: `c5694b68` · run at: `2026-10-21T12:05:26Z`

```bash
git diff --numstat --diff-filter=M e69e2cc9..c5694b68 | grep -v -E "\t(tests?|docs|experiments|prototypes)/|\.test\.|\.spec\.|^-" | awk "{print \$1+\$2\"\t\"\$1\"\t\"\$2\"\t\"\$3}" | sort -rn | head -25 | nl
```

```text
     1	4722	2135	2587	routes/workspace-api.js
     2	2255	764	1491	lib/pipeline-loops.js
     3	2025	1056	969	lib/kpi-stats.js
     4	2013	873	1140	lib/render-settings.js
     5	1595	915	680	lib/dispatch-factory.js
     6	1519	613	906	routes/proxy-writes.js
     7	1449	222	1227	routes/proxy-dispatch.js
     8	1443	565	878	routes/dispatch.js
     9	1429	735	694	lib/providers/jira/adf.js
    10	1325	478	847	lib/render.js
    11	1256	914	342	server.js
    12	1192	821	371	lib/dispatch-store.js
    13	1123	1005	118	public/prompt-section.js
    14	1119	350	769	public/app.js
    15	1055	435	620	routes/proxy-reads.js
    16	926	349	577	lib/render-session.js
    17	850	648	202	routes/dashboard.js
    18	838	766	72	public/common.js
    19	762	378	384	lib/render-swipe.js
    20	761	383	378	lib/render-roadmap.js
    21	684	244	440	lib/render-kpis.js
    22	665	362	303	lib/openrouter.js
    23	629	520	109	lib/github-install-flow.js
    24	611	486	125	public/flight-companion.js
    25	610	235	375	public/kpis.js
```

### Q12. C3 rebuild commits (since 2026-10-14, subject or body matches rebuild, minus Papers: essays)

- repo: `LinearViewer` · SHA: `c5694b68` · run at: `2026-10-21T12:05:27Z`

```bash
echo "rebuild commits: $(git log --oneline --since=2026-10-14 --grep=rebuild -i --no-merges e69e2cc9..c5694b68 | wc -l | tr -d " ")"; echo "of which Papers: essays: $(git log --oneline --since=2026-10-14 --grep=rebuild -i --no-merges e69e2cc9..c5694b68 | grep -c "Papers:")"; echo "minus essays: $(git log --oneline --since=2026-10-14 --grep=rebuild -i --no-merges e69e2cc9..c5694b68 | grep -vc "Papers:")"; git log --oneline --since=2026-10-14 --grep=rebuild -i --no-merges e69e2cc9..c5694b68 | grep -v "Papers:" | cut -c1-120
```

```text
rebuild commits: 21
of which Papers: essays: 5
minus essays: 16
0eb4a2d1 LIN-3706: rebuild the free-tier plan and allowance as one seam (design-first) (#1999)
a9f81290 LIN-3703: rebuild the public /kpis page design-first, with a small-count floor (#1995)
2e8cba6e LIN-3611: rebuild the dispatch-entrance authority design-first (#1917)
603853c5 LIN-3596: rebuild the workspace API router design-first (#1908)
91fca7dd LIN-3591: rebuild the KPI statistics collector design-first, fix the free-tier count leak (#1907)
d2d7d818 LIN-3592: rebuild the dispatch entrance design-first (#1906)
16e7ae77 LIN-3590: rebuild the task page loader design-first (#1905)
b3bdccaf LIN-3580: rebuild the dispatch factory and validation design-first (#1904)
1f8010a0 LIN-3579: rebuild the page renderer cluster design-first (render, render-session, render-swipe, render-settings
4ee0a2c7 LIN-3578: rebuild lib/pipeline-loops.js design-first (rung 5); lean abort now reaches a digest-less target (#19
350242d5 LIN-3573: rebuild the Agent API write and rulings routes design-first (LIN-3575 + LIN-3576) (#1899)
06ec62b7 LIN-3569: rebuild the Agent API read routes design-first (#1897)
65969467 LIN-3566: rebuild the roadmap page renderer design-first (#1896)
74e5e2ca LIN-3565: clean-room rebuild of the Jira ADF codec, experiment 2b (#1895)
e7f7bd57 LIN-3557: clean-room rebuild of the Jira ADF↔Markdown codec (#1892)
269a6189 LIN-3556: rebuild Jira ADF↔Markdown codec as a whole (same behaviour, cleaner code) (#1891)
```

### Q13. C3 behaviour-fix commits named by the plan

- repo: `LinearViewer` · SHA: `c5694b68` · run at: `2026-10-21T12:05:27Z`

```bash
for k in 91fca7dd 1f8010a0 4ee0a2c7 350242d5 65969467 d2d7d818 9ee09ae9; do git log -1 --format="%h %ad %s" --date=short $k | cut -c1-150; done
```

```text
91fca7dd 2026-10-17 LIN-3591: rebuild the KPI statistics collector design-first, fix the free-tier count leak (#1907)
1f8010a0 2026-10-16 LIN-3579: rebuild the page renderer cluster design-first (render, render-session, render-swipe, render-settings) (#1903)
4ee0a2c7 2026-10-16 LIN-3578: rebuild lib/pipeline-loops.js design-first (rung 5); lean abort now reaches a digest-less target (#1901)
350242d5 2026-10-16 LIN-3573: rebuild the Agent API write and rulings routes design-first (LIN-3575 + LIN-3576) (#1899)
65969467 2026-10-16 LIN-3566: rebuild the roadmap page renderer design-first (#1896)
d2d7d818 2026-10-17 LIN-3592: rebuild the dispatch entrance design-first (#1906)
9ee09ae9 2026-10-19 LIN-3680 + LIN-3678: swim labels say Cancelled; roadmap glyph from getStateDisplay (#1985)
```

### Q14. C3 / N5: lib/openrouter.js churn rank and commit count; api-openrouter commits named by review

- repo: `LinearViewer` · SHA: `c5694b68` · run at: `2026-10-21T12:05:27Z`

```bash
echo "commits touching lib/openrouter.js in window: $(git rev-list --count e69e2cc9..c5694b68 -- lib/openrouter.js)"; for k in 3ee41011 279258c9 a89c43b7 8c41aa19; do git log -1 --format="%h %s" $k | cut -c1-140; done
```

```text
commits touching lib/openrouter.js in window: 31
3ee41011 LIN-2854: getRecommendationStream/getRecommendation fail fast on an already-aborted signal (#1859)
279258c9 LIN-3362: streamChatWithTools hop-text frame and concurrent read batches
a89c43b7 LIN-3359: Flight Companion — bare 4000 cap, length/reasoning telemetry, cut-off note
8c41aa19 LIN-3294: give a reasoning writer room to think and write; ship only finished replies
```

### Q15. C4 state-capable writers: every createIssue/updateIssue caller outside lib/providers (routes, server.js, lib)

- repo: `LinearViewer` · SHA: `c5694b68` · run at: `2026-10-21T12:05:27Z`

```bash
git grep -n -E "\.(updateIssue|createIssue)\(|issueUpdate|issueCreate" c5694b68 -- routes server.js lib ":!lib/providers" ":!lib/local-store.js" | cut -c1-170
```

```text
c5694b68:routes/proxy-writes.js:352:    const created = normalizeWritePayload(await provider.createIssue(token, input), 'issue');
c5694b68:routes/proxy-writes.js:429:    const updated = normalizeWritePayload(await provider.updateIssue(token, issueId, input), 'issue');
c5694b68:routes/proxy-writes.js:475:      const updated = normalizeWritePayload(await provider.updateIssue(token, req.params.issueId, { description: next }), 'issue');
c5694b68:routes/test.js:1510:      const created = await provider.createIssue(req.query.urlKey || LOCAL_WS_URL_KEY, {
c5694b68:routes/test.js:1661:      const created = await provider.createIssue({ repo: GITHUB_REPO, token: GITHUB_INSTALL_TOKEN }, {
c5694b68:routes/workspace-api.js:529:function issueCreateRefusal({ title, description, teamId, stateId, priority }, declared) {
c5694b68:routes/workspace-api.js:547:function issueUpdateRefusal({ title, description, priority, stateRef }) {
c5694b68:routes/workspace-api.js:815:  return provider.updateIssue(callScope, issueRef, { stateId: completedId || resolveStateRef(states, 'Done') });
c5694b68:routes/workspace-api.js:3259:      const created = await provider.createIssue(token, createInput);
c5694b68:routes/workspace-api.js:3357:    const refusal = issueCreateRefusal(req.body || {}, declared);
c5694b68:routes/workspace-api.js:3391:      const created = answerIssueWrite(res, await provider.createIssue(token, input), 'Issue was not created');
c5694b68:routes/workspace-api.js:3427:    const refusal = issueUpdateRefusal({ title, description, priority, stateRef });
c5694b68:routes/workspace-api.js:3455:      const updated = answerIssueWrite(res, await provider.updateIssue(token, issueId, input), 'Issue was not updated');
```

### Q16. C4 content check of the cited lines (proxy-writes.js)

- repo: `LinearViewer` · SHA: `c5694b68` · run at: `2026-10-21T12:05:27Z`

```bash
for r in 339,340 352,352 365,366 374,374 383,384 416,416 429,429 475,475; do echo "== routes/proxy-writes.js:$r"; git show c5694b68:routes/proxy-writes.js | sed -n "${r}p" | cut -c1-170; done
```

```text
== routes/proxy-writes.js:339,340
      { name: 'stateId', key: 'stateId', value: stateId, present: Boolean, convert: (v) => resolveStateInput(provider, token, resolvedTeamId, v) },
      { name: 'assigneeId', key: 'assigneeId', value: assigneeId, present: isUuid },
== routes/proxy-writes.js:352,352
    const created = normalizeWritePayload(await provider.createIssue(token, input), 'issue');
== routes/proxy-writes.js:365,366
  async function refusedByPeriodicalGate(ctx, guard, teamId, stateId) {
    if (!extractPeriodicalGateId(guard?.description)) return false;
== routes/proxy-writes.js:374,374
    const gate = checkPeriodicalReportGate({
== routes/proxy-writes.js:383,384
  router.patch('/api/proxy/issues/:issueId', ...writeAuth, guarded(SPEC.updateIssue, async (ctx) => {
    const { req, res, endpoint, token, provider } = ctx;
== routes/proxy-writes.js:416,416
      if (await refusedByPeriodicalGate(ctx, guard, teamId, input.stateId)) return;
== routes/proxy-writes.js:429,429
    const updated = normalizeWritePayload(await provider.updateIssue(token, issueId, input), 'issue');
== routes/proxy-writes.js:475,475
      const updated = normalizeWritePayload(await provider.updateIssue(token, req.params.issueId, { description: next }), 'issue');
```

### Q17. C4 content check of the cited lines (workspace-api.js)

- repo: `LinearViewer` · SHA: `c5694b68` · run at: `2026-10-21T12:05:27Z`

```bash
for r in 802,803 815,815 3259,3259 3343,3343 3384,3384 3391,3391 3410,3411 3442,3443 3455,3455 3655,3656 3695,3695; do echo "== routes/workspace-api.js:$r"; git show c5694b68:routes/workspace-api.js | sed -n "${r}p" | cut -c1-170; done
```

```text
== routes/workspace-api.js:802,803
async function defaultMarkDone({ provider, callScope, issueIdentifier }) {
  const { issue } = await provider.fetchIssueContext(callScope, issueIdentifier);
== routes/workspace-api.js:815,815
  return provider.updateIssue(callScope, issueRef, { stateId: completedId || resolveStateRef(states, 'Done') });
== routes/workspace-api.js:3259,3259
      const created = await provider.createIssue(token, createInput);
== routes/workspace-api.js:3343,3343
  router.post('/workspace/:urlKey/api/issues', workspaceFromUrl, json(), async (req, res) => {
== routes/workspace-api.js:3384,3384
        ['stateId', stateId, (v) => resolveIssueStateRef(provider, token, scopeTeam, v)]
== routes/workspace-api.js:3391,3391
      const created = answerIssueWrite(res, await provider.createIssue(token, input), 'Issue was not created');
== routes/workspace-api.js:3410,3411
  router.patch('/workspace/:urlKey/api/issues/:issueId', workspaceFromUrl, json(), async (req, res) => {
    // LIN-1904: the issue's own binding via `source` (threaded from the edit-link
== routes/workspace-api.js:3442,3443
      const { issueId } = req.params;
      const guard = await provider.issueWriteGuard(token, issueId);
== routes/workspace-api.js:3455,3455
      const updated = answerIssueWrite(res, await provider.updateIssue(token, issueId, input), 'Issue was not updated');
== routes/workspace-api.js:3655,3656
  router.post('/workspace/:urlKey/api/run-evidence/:issueIdentifier/check', workspaceFromUrl, json(), async (req, res) => {
    if (refusedCloseOutRequest(req, res, 'check')) return;
== routes/workspace-api.js:3695,3695
        if (state.status === 'merged' && closeOutSetsDone({ prStatuses, prIndex, review: ledger, byPersonCheck: true })) {
```

### Q18. C5 periodical-report-gate callers (every reference)

- repo: `LinearViewer` · SHA: `c5694b68` · run at: `2026-10-21T12:05:27Z`

```bash
git grep -n -E "checkPeriodicalReportGate|refusedByPeriodicalGate" c5694b68 -- lib routes server.js
```

```text
c5694b68:lib/periodical-report-gate.js:113:export function checkPeriodicalReportGate({ description, comments, targetStateType } = {}) {
c5694b68:routes/proxy-writes.js:46:import { checkPeriodicalReportGate } from '../lib/periodical-report-gate.js';
c5694b68:routes/proxy-writes.js:365:  async function refusedByPeriodicalGate(ctx, guard, teamId, stateId) {
c5694b68:routes/proxy-writes.js:374:    const gate = checkPeriodicalReportGate({
c5694b68:routes/proxy-writes.js:416:      if (await refusedByPeriodicalGate(ctx, guard, teamId, input.stateId)) return;
```

### Q19. C6 scheduler.register sites and setInterval sites

- repo: `LinearViewer` · SHA: `c5694b68` · run at: `2026-10-21T12:05:27Z`

```bash
git grep -n "scheduler.register(" c5694b68 -- server.js lib routes; echo "--- setInterval:"; git grep -n "setInterval" c5694b68 -- server.js lib routes; echo "--- counts: registered=$(git grep -c "scheduler.register(" c5694b68 -- server.js | cut -d: -f3)"
```

```text
c5694b68:lib/observer-sweep.js:590: * `server.js`'s `scheduler.register(...)` call, where nothing could reach it:
c5694b68:server.js:801:scheduler.register({
c5694b68:server.js:868:scheduler.register({
c5694b68:server.js:898:scheduler.register({
c5694b68:server.js:928:scheduler.register({
c5694b68:server.js:948:scheduler.register({
c5694b68:server.js:980:scheduler.register({
c5694b68:server.js:1009:scheduler.register({
--- setInterval:
c5694b68:lib/hourly-cleanup.js:4: * `setInterval(run, CLEANUP_INTERVAL_MS)` and holds the timer for shutdown.
c5694b68:lib/http-keepalive.js:83:    state.interval = setInterval(() => writeQuietly(res, ' '), intervalMs);
c5694b68:lib/http-keepalive.js:112:  const interval = setInterval(() => writeQuietly(res, ': keepalive\n\n'), intervalMs);
c5694b68:lib/runner-kit/broker.mjs:530:    timer = setInterval(() => { broker.tick(); }, checkIntervalMs);
c5694b68:lib/scheduler.js:5: * per named job, never a bare `setInterval`.
c5694b68:lib/scheduler.js:129:      const timer = setInterval(() => {
c5694b68:server.js:4599:  cleanupTimer = setInterval(runHourlyCleanup, CLEANUP_INTERVAL_MS)
--- counts: registered=7
```

### Q20. C6 roster in docs/architecture/source-map.md (hand-written roster)

- repo: `LinearViewer` · SHA: `c5694b68` · run at: `2026-10-21T12:05:27Z`

```bash
git grep -n -i -E "scheduler.register|observer-sweep|kpi-daily-rollup|ci-wake-sweep|liveness-alarm-sweep" c5694b68 -- docs/architecture/source-map.md | cut -c1-200
```

```text
c5694b68:docs/architecture/source-map.md:112:  kpi-stats.js         Instance KPI aggregation (privacy boundary for public /kpis). `toPublicKpis(stats)` is the public view and applies `PUBLIC_COUNT_FLO
c5694b68:docs/architecture/source-map.md:113:  kpi-daily-rollup.js  KPI daily rollup, part A (LIN-3724, design LIN-3712): the `kpi-daily-rollup` collection (`{ urlKey, day, done, failed, aborted, disp
c5694b68:docs/architecture/source-map.md:114:  workspace-kpi-stats.js  `collectWorkspaceKpis` (LIN-3689): the six `urlKey`-filtered reads behind the workspace KPIs page, reduced with kpi-stats.js's ow
c5694b68:docs/architecture/source-map.md:189:  scheduler.js          Leader-safe scheduler substrate (LIN-2128): a recurring-job runner using a non-upsert CAS lease on one `scheduler-locks` doc per na
c5694b68:docs/architecture/source-map.md:190:  observer-state-store.js  Durable observer-instance state (LIN-2129, P1-2 of the LIN-2114 observer-harness epic): one current, CAS-versioned (`rev`) docum
c5694b68:docs/architecture/source-map.md:191:  observer-sweep.js     Deterministic observer census sweep (LIN-2131, P1-3): the `observer-sweep` scheduler job (60s). One tick classifies the whole fleet
c5694b68:docs/architecture/source-map.md:192:  observer-pass.js      Cloud observer LLM judgement pass (LIN-2395, P2-1): the `observer-pass` scheduler job (15min), a second and independently-scheduled
c5694b68:docs/architecture/source-map.md:194:  observer-shadow-log.js  Read-only shadow action log (LIN-2132, P1-5): computes what observer-sweep.js's diagnosis WOULD have relayed (in the incumbent's 
c5694b68:docs/architecture/source-map.md:197:  liveness-alarm-sweep.js  The `liveness-alarm-sweep` scheduler job (LIN-3258, 10min/5min): one tick per workspace with live dispatches, Rule S first and R
c5694b68:docs/architecture/source-map.md:198:  ci-wake-sweep.js  The `ci-wake-sweep` scheduler job (LIN-3661, 5min/2min): wakes a worker parked `[pending]` on its PR's CI with ONE follow-up to its own
```

### Q21. C7 free-tier spend sites (gate and spend call sites)

- repo: `LinearViewer` · SHA: `c5694b68` · run at: `2026-10-21T12:05:27Z`

```bash
git grep -n -E "checkFreeTierGate|chargeFreeTierOrReject|freeTierStore\.(tryUse|recordUsage)|resolveChatCredential" c5694b68 -- lib routes server.js | grep -v -E "^c5694b68:lib/free-tier-store.js" | cut -c1-170; echo "--- precompute residual:"; git show c5694b68:lib/run-paragraph-hook.js | sed -n "28,38p"
```

```text
c5694b68:lib/chat-request.js:33: * Who is on the free tier (LIN-3658): `resolveChatCredential` (the prompt
c5694b68:lib/chat-request.js:105: * `isFlagFreeTier`) — `resolveChatCredential` deliberately never reads it, so
c5694b68:lib/chat-request.js:131: * `resolveChatCredential().isFreeTier` is a superset of the other, so they are
c5694b68:lib/chat-request.js:145: * `checkFreeTierGate` denial record — only these four fields, in this order
c5694b68:lib/chat-request.js:172:export function resolveChatCredential({ sessionApiKey }) {
c5694b68:lib/chat-request.js:186: * @param {{available: boolean}} p.credential - a `resolveChatCredential` result
c5694b68:lib/chat-request.js:202: * On a denial, returns `freeTierStore.tryUse`'s own
c5694b68:lib/chat-request.js:213:export async function checkFreeTierGate({ isFreeTier, urlKey, freeTierStore }) {
c5694b68:lib/chat-request.js:215:  const check = await freeTierStore.tryUse(urlKey);
c5694b68:lib/chat-request.js:222: * (LIN-3238). Mirrors `checkFreeTierGate`'s "one small shared helper" posture:
c5694b68:lib/dispatch-entrance.js:64:import { buildRunGate, resolveChatCredential, isAiUnavailable } from './chat-request.js';
c5694b68:lib/dispatch-entrance.js:888:const gateByKey = (run, sessionApiKey) => gateByTier(run, resolveChatCredential({ sessionApiKey }).isFreeTier);
c5694b68:lib/dispatch-entrance.js:1383: *   (computeRecommendation, chargeFreeTierOrReject, recommendErrorResponse,
c5694b68:lib/dispatch-entrance.js:1486:  const credential = resolveChatCredential({ sessionApiKey });
c5694b68:lib/dispatch-entrance.js:1498:  const rejection = isFreeTier ? await ctx.chargeFreeTierOrReject(req, endpoint) : null;
c5694b68:lib/plan-allowance.js:276: * `checkFreeTierGate` denial record — only these four fields, in this order
c5694b68:lib/render-observation.js:51:// `freeTierStore.tryUse` check at :2472-2477, never the AI-configured gate
c5694b68:routes/dashboard.js:77:import { resolveChatCredential, checkFreeTierGate, freeTierRefusalBlock } from '../lib/chat-request.js';
c5694b68:routes/dashboard.js:2686:    const { apiKey, isFreeTier } = resolveChatCredential({ sessionApiKey: req.session.openRouterApiKey });
c5694b68:routes/dashboard.js:2693:      const check = await checkFreeTierGate({ isFreeTier, urlKey: workspace.urlKey, freeTierStore });
c5694b68:routes/dashboard.js:2873:    const { apiKey, isFreeTier } = resolveChatCredential({ sessionApiKey: req.session.openRouterApiKey });
c5694b68:routes/dashboard.js:2880:      const check = await checkFreeTierGate({ isFreeTier, urlKey: workspace.urlKey, freeTierStore });
c5694b68:routes/flight-companion.js:107:import { resolveChatCredential, checkFreeTierGate, CHAT_MESSAGE_MAX_LENGTH, freeTierRefusalBlock } from '../lib/chat-request.js';
c5694b68:routes/flight-companion.js:419:      const { apiKey: resolvedApiKey, isFreeTier } = resolveChatCredential({ sessionApiKey: req.session.openRouterApiKey });
c5694b68:routes/flight-companion.js:535:    const { apiKey: apiKeyToUse, isFreeTier } = resolveChatCredential({ sessionApiKey: req.session.openRouterApiKey });
c5694b68:routes/flight-companion.js:608:          const gate = await checkFreeTierGate({ isFreeTier, urlKey: workspace.urlKey, freeTierStore });
c5694b68:routes/flight-companion.js:717:    const { apiKey: apiKeyToUse, isFreeTier } = resolveChatCredential({ sessionApiKey: req.session.openRouterApiKey });
c5694b68:routes/flight-companion.js:767:          const gate = await checkFreeTierGate({ isFreeTier, urlKey: workspace.urlKey, freeTierStore });
c5694b68:routes/next-run.js:27:import { resolveChatCredential, checkFreeTierGate, freeTierRefusalBlock } from '../lib/chat-request.js';
c5694b68:routes/next-run.js:138:      const aiConfigured = resolveChatCredential({ sessionApiKey: req.session.openRouterApiKey }).available;
c5694b68:routes/next-run.js:178:    const { apiKey: apiKeyToUse, isFreeTier } = resolveChatCredential({ sessionApiKey: req.session.openRouterApiKey });
c5694b68:routes/next-run.js:185:      const check = await checkFreeTierGate({ isFreeTier, urlKey: workspace.urlKey, freeTierStore });
c5694b68:routes/proxy-compute.js:12:import { resolveChatCredential, isAiUnavailable } from '../lib/chat-request.js';
c5694b68:routes/proxy-compute.js:55: * @param {Function} deps.chargeFreeTierOrReject - Free-tier metering choke point (closure-local; relocated in routes/proxy.js by G1, 
c5694b68:routes/proxy-compute.js:87:  chargeFreeTierOrReject,
c5694b68:routes/proxy-compute.js:386:      const credential = resolveChatCredential({ sessionApiKey });
c5694b68:routes/proxy-compute.js:423:        const rejection = await chargeFreeTierOrReject(req, '/api/proxy/recommend');
c5694b68:routes/proxy-compute.js:1104:        const credential = resolveChatCredential({ sessionApiKey });
c5694b68:routes/proxy-compute.js:1118:          const rejection = await chargeFreeTierOrReject(req, '/api/proxy/recap');
c5694b68:routes/proxy-compute.js:1211:      const credential = resolveChatCredential({ sessionApiKey });
c5694b68:routes/proxy-compute.js:1224:        const rejection = await chargeFreeTierOrReject(req, '/api/proxy/recap');
c5694b68:routes/proxy-compute.js:1388:        const credential = resolveChatCredential({ sessionApiKey });
c5694b68:routes/proxy-compute.js:1402:          const rejection = await chargeFreeTierOrReject(req, '/api/proxy/brief');
c5694b68:routes/proxy-compute.js:1494:      const credential = resolveChatCredential({ sessionApiKey });
c5694b68:routes/proxy-compute.js:1507:        const rejection = await chargeFreeTierOrReject(req, '/api/proxy/brief');
c5694b68:routes/proxy-dispatch.js:214: * @param {Function} deps.chargeFreeTierOrReject - Free-tier quota gate for a recommendation-style call (closure-local)
c5694b68:routes/proxy-dispatch.js:241:  chargeFreeTierOrReject,
c5694b68:routes/proxy-dispatch.js:295:    chargeFreeTierOrReject,
c5694b68:routes/proxy-flight-companion.js:26: * (`getWorkspaceOpenRouterKey` + `resolveChatCredential`, exactly as recap/brief
c5694b68:routes/proxy-flight-companion.js:41:import { CHAT_MESSAGE_MAX_LENGTH, resolveChatCredential, isAiUnavailable } from '../lib/chat-request.js';
c5694b68:routes/proxy-flight-companion.js:48:// `resolveChatCredential` as `sessionApiKey` (LIN-2427).
c5694b68:routes/proxy-flight-companion.js:131: * @param {Function} deps.chargeFreeTierOrReject - Free-tier metering choke point (closure-local, shared with compute/dispat
c5694b68:routes/proxy-flight-companion.js:158:  chargeFreeTierOrReject,
c5694b68:routes/proxy-flight-companion.js:200:      const credential = resolveChatCredential({ sessionApiKey });
c5694b68:routes/proxy-flight-companion.js:269:            const check = await chargeFreeTierOrReject(req, ENDPOINT);
c5694b68:routes/proxy-flight-companion.js:317:          // LIN-3665: the freeTier block chargeFreeTierOrReject already built,
c5694b68:routes/proxy.js:69:import { resolveChatCredential, freeTierRefusalBlock } from '../lib/chat-request.js';
c5694b68:routes/proxy.js:1015:   * resolveChatCredential's own return values prove: it does NOT claim a split
c5694b68:routes/proxy.js:1345:  // reached when resolveChatCredential already selected free tier, i.e. neither the
c5694b68:routes/proxy.js:1348:  // observable HERE (not inside resolveChatCredential, which runs per descent hop and
c5694b68:routes/proxy.js:1355:  async function chargeFreeTierOrReject(req, endpoint) {
c5694b68:routes/proxy.js:1363:    const check = await freeTierStore.tryUse(req.proxyUrlKey);
c5694b68:routes/proxy.js:1469:    const { apiKey: resolvedApiKey, isFreeTier } = resolveChatCredential({ sessionApiKey });
c5694b68:routes/proxy.js:1546:  router.use(createComputeRoutes({ recapCacheStore, briefCacheStore, taskSnapshotStore, dispatchQueueStore, llmCallLogStore, getWorkspaceOpe
c5694b68:routes/proxy.js:1582:  router.use(createDispatchRoutes({ authenticateProxyToken, chargeFreeTierOrReject, computeRecommendation, denyIfUnsupported, dispatchQueueS
c5694b68:routes/proxy.js:1611:  router.use(createProxyFlightCompanionRoutes({ proxyLimiter, authenticateProxyToken, resolveProviderAccess, workspaceUnavailable, logEvent,
c5694b68:routes/ship-biscuit.js:33:import { resolveChatCredential, checkFreeTierGate, freeTierRefusalBlock } from '../lib/chat-request.js';
c5694b68:routes/ship-biscuit.js:94:      const aiConfigured = resolveChatCredential({ sessionApiKey: req.session.openRouterApiKey }).available;
c5694b68:routes/ship-biscuit.js:130:    const { apiKey: apiKeyToUse, isFreeTier } = resolveChatCredential({ sessionApiKey: req.session.openRouterApiKey });
c5694b68:routes/ship-biscuit.js:186:          const check = await checkFreeTierGate({ isFreeTier, urlKey: workspace.urlKey, freeTierStore });
c5694b68:routes/task-chat.js:37:import { resolveChatCredential, checkFreeTierGate, CHAT_MESSAGE_MAX_LENGTH, freeTierRefusalBlock } from '../lib/chat-request.js';
c5694b68:routes/task-chat.js:265:      const aiConfigured = resolveChatCredential({ sessionApiKey: req.session.openRouterApiKey }).available;
c5694b68:routes/task-chat.js:443:    const { apiKey: apiKeyToUse, isFreeTier } = resolveChatCredential({ sessionApiKey: req.session.openRouterApiKey });
c5694b68:routes/task-chat.js:450:      const gate = await checkFreeTierGate({ isFreeTier, urlKey: workspace.urlKey, freeTierStore });
c5694b68:routes/test.js:1216:        await freeTierStore.recordUsage(urlKey)
c5694b68:routes/workspace-api-roadmap.js:28:import { resolveChatCredential, checkFreeTierGate, CHAT_MESSAGE_MAX_LENGTH, freeTierRefusalBlock } from '../lib/chat-request.j
c5694b68:routes/workspace-api-roadmap.js:284:    const { apiKey, isFreeTier } = resolveChatCredential({ sessionApiKey: req.session.openRouterApiKey });
c5694b68:routes/workspace-api-roadmap.js:313:    return freeTierStore.tryUse(req.workspace.urlKey);
c5694b68:routes/workspace-api-roadmap.js:797:    const { apiKey: apiKeyToUse, isFreeTier } = resolveChatCredential({ sessionApiKey: req.session.openRouterApiKey });
c5694b68:routes/workspace-api-roadmap.js:803:    const gate = await checkFreeTierGate({ isFreeTier, urlKey: req.workspace.urlKey, freeTierStore });
c5694b68:routes/workspace-api.js:16: * The AI pre-flight calls (`resolveChatCredential`, `checkFreeTierGate`, the
c5694b68:routes/workspace-api.js:38:import { resolveChatCredential, isAiUnavailable, checkFreeTierGate, buildRunGate, isFlagFreeTier, freeTierRefusalBlock } from '../lib/
c5694b68:routes/workspace-api.js:840:    const check = await freeTierStore.tryUse(workspace.urlKey);
c5694b68:routes/workspace-api.js:1358:    const credential = resolveChatCredential({ sessionApiKey: req.session.openRouterApiKey });
c5694b68:routes/workspace-api.js:1370:      const check = await checkFreeTierGate({ isFreeTier: surfaceFreeTier, urlKey: workspace.urlKey, freeTierStore });
c5694b68:routes/workspace-api.js:1481:    const credential = resolveChatCredential({ sessionApiKey: req.session.openRouterApiKey });
c5694b68:routes/workspace-api.js:1507:      const check = await checkFreeTierGate({ isFreeTier: surfaceFreeTier, urlKey: workspace.urlKey, freeTierStore });
c5694b68:routes/workspace-api.js:2152:    const credential = resolveChatCredential({ sessionApiKey: req.session.openRouterApiKey });
c5694b68:routes/workspace-api.js:2160:      const check = await checkFreeTierGate({ isFreeTier, urlKey: workspace.urlKey, freeTierStore });
c5694b68:routes/workspace-api.js:2243:    const credential = resolveChatCredential({ sessionApiKey: req.session.openRouterApiKey });
c5694b68:routes/workspace-api.js:2251:      const check = await checkFreeTierGate({ isFreeTier, urlKey: workspace.urlKey, freeTierStore });
c5694b68:routes/workspace-api.js:2398:    const credential = resolveChatCredential({ sessionApiKey: req.session.openRouterApiKey });
c5694b68:routes/workspace-api.js:2406:      const check = await checkFreeTierGate({ isFreeTier, urlKey: workspace.urlKey, freeTierStore });
c5694b68:routes/workspace-api.js:2591:    const credential = resolveChatCredential({ sessionApiKey: req.session.openRouterApiKey });
c5694b68:routes/workspace-api.js:2598:      const check = await checkFreeTierGate({ isFreeTier, urlKey: workspace.urlKey, freeTierStore });
c5694b68:routes/workspace-api.js:3135:  // free-tier net (`checkFreeTierGate`) when it would bill the shared key; a
c5694b68:routes/workspace-api.js:3148:    const { apiKey: aiApiKey, isFreeTier } = resolveChatCredential({ sessionApiKey: req.session?.openRouterApiKey });
c5694b68:routes/workspace-api.js:3159:          const check = await checkFreeTierGate({ isFreeTier, urlKey: workspace.urlKey, freeTierStore });
c5694b68:routes/workspace-api.js:3275:      const { isFreeTier: feedbackIsFreeTier } = resolveChatCredential({ sessionApiKey: req.session?.openRouterApiKey });
--- precompute residual:
 * @returns {string|null}
 */
export function resolvePrecomputeApiKey(env = process.env) {
  if (env.NODE_ENV === 'test') return null;
  // LIN-3664: trim the paid key like getPaidEnvKey does (LIN-961), so a blank one
  // falls through to the free-tier key instead of being spent upstream. Env-param
  // driven, so not getPaidEnvKey() (that reads process.env).
  const paid = typeof env.OPENROUTER_API_KEY === 'string' ? env.OPENROUTER_API_KEY.trim() : '';
  const free = getFreeTierKey(env);
  return paid || (isFreeFor('keyed', { hasSessionKey: false, hasPaidEnvKey: !!paid, hasFreeKey: !!free }) ? free : null);
}
```

### Q22. C8 halt-copy: run 3's exact query

- repo: `LinearViewer` · SHA: `c5694b68` · run at: `2026-10-21T12:05:27Z`

```bash
git grep -n -E "LIN-2995|yet honor" c5694b68 -- "*.js" "*.md" | cut -c1-200; echo "--- hits: $(git grep -n -E "LIN-2995|yet honor" c5694b68 -- "*.js" "*.md" | wc -l | tr -d " "), files: $(git grep -l -E "LIN-2995|yet honor" c5694b68 -- "*.js" "*.md" | wc -l | tr -d " ")"; echo "--- files:"; git grep -l -E "LIN-2995|yet honor" c5694b68 -- "*.js" "*.md"
```

```text
c5694b68:docs/incidents/2026-09-22-harbour-db-reads-hang.md:148:| LIN-2995 | Backlog | Runner-local halt / auto-pause, independent of Harbour |
c5694b68:docs/papers/harbour/proportional-process-backtest.md:212:    - LIN-2995 (runner). Plan review found five faults: a stop sweep that missed held sessions
c5694b68:docs/papers/harbour/proportional-process-backtest.md:357:  - A parent ticket whose code landed under its children looks docs-only (LIN-2994, LIN-2995).
c5694b68:docs/papers/harbour/survey-check-7.md:172:  D. D found 30 on LIN-2995 where A found 19.
c5694b68:docs/papers/harbour/survey-check-7.md:311:  LIN-2458, LIN-3129 and LIN-2995. The draw was fixed before any code was read. Each reader was
c5694b68:docs/papers/harbour/survey-check-7.md:312:  split across three agents (LIN-2995 alone; four and four), D in reverse order and LIN-2995 read
c5694b68:docs/papers/harbour/survey-check-7.md:333:  ticket, LIN-2995. The direction is consistent across three readers; the size is not a population
c5694b68:docs/papers/harbour/where-judgement-happens.md:157:one red attempt in 84 CI runs on the 44 merged PRs: simple-dispatcher PR #255 (LIN-2995), re-run
c5694b68:docs/papers/harbour/where-judgement-happens.md:202:| 3 | **Run close-out at a cheaper tier, keeping a frontier step for the open questions** | 2–5% of ticket cost (close-out is 6%; a mid tier
c5694b68:docs/papers/harbour/which-rules-pay.md:372:- **Parent tickets are thin.** LIN-3134 and LIN-2995 had their code land under their children
c5694b68:docs/reviews/_evidence-2026-09-26/visual-pass.md:40:- **V7:** internal ticket IDs and doc paths appear in user-facing copy. Examples: Dispatch "(pending LIN-2995)", effort-readout "LIN-2566 §
c5694b68:docs/reviews/_evidence-2026-09-26/visual-pass.md:93:| `dispatch--light--1400px--fp` *(PNG pruned impl beat 2 — superseded by its settled capture; JSON kept)* | light · 1400 · fullPage | confi
c5694b68:docs/reviews/_evidence-2026-09-26/visual-pass.md:94:| `dispatch--light--390px--fp` *(PNG pruned impl beat 2 — superseded by its settled capture; JSON kept)* | light · 390 · fullPage | confirm
c5694b68:docs/reviews/design-interface-review-2026-09-26.md:231:| A10 | **Internal references in user copy:** "(pending LIN-2995)", "LIN-2566 §5", "LIN-2567", "docs/escalation-philosophy.md §7". | `di
c5694b68:docs/reviews/documentation-review-2026-09-26.md:17:> **Adversarial second-read correction (see the appendix below).** The Tier-1 reader found one genuinely missed class — the stale "the runne
c5694b68:docs/reviews/documentation-review-2026-09-26.md:19:## H13 · **HIGH** — operator/agent docs still say the runner ignores a halt, but LIN-2995 is Done and `simple-dispatcher` honors halts — **e
c5694b68:docs/reviews/documentation-review-2026-09-26.md:21:**What.** Harbour's halt copy is uniformly framed as "a request only — the runner does not yet honor it (pending LIN-2995)". That framing is
c5694b68:docs/reviews/documentation-review-2026-09-26.md:24:- `simple-dispatcher/README.md:231` — a `## Halts (pause / stop)` section: "*A halt stops new work being claimed, using the same `pause` / `
c5694b68:docs/reviews/documentation-review-2026-09-26.md:25:- Linear: `LIN-2995` **Done**, `LIN-2994` **Done**, `LIN-3045` **Done** (via `/api/proxy/search` and `/api/proxy/issues/LIN-2995`).
c5694b68:docs/reviews/documentation-review-2026-09-26.md:34:- `docs/runbooks/harbour-degraded.md:6`, `:24`, `:28`, `:32`, `:60`, `:204`, `:207` (including `[unbuilt: LIN-2995]`)
c5694b68:docs/reviews/documentation-review-2026-09-26.md:45:Point-in-time, not a member: `docs/incidents/2026-09-22-harbour-db-reads-hang.md:148` lists LIN-2995 as Backlog in a dated incident table (a
c5694b68:docs/reviews/documentation-review-2026-09-26.md:403:| **H13** halt "pending LIN-2995" copy (~26 non-test sites, LinearViewer only) | HIGH | **existing: LIN-3074 — comment** (found by the adve
c5694b68:docs/reviews/documentation-review-2026-09-26.md:542:| `halt-pending-LIN-2995-copy` (H13) | not examined by this run until the adversarial second-read | **new**: ~26 non-test LinearViewer site
c5694b68:docs/reviews/documentation-review-2026-09-26.md:575:> DONE: The read-only Tier-1 second-read of LIN-3102 is finished and verified against source. The largest miss is 21 Harbour sites that sti
c5694b68:docs/reviews/documentation-review-2026-09-26.md:577:*(The reader's answer reached the owning session as a single final dispatch feedback entry; its supporting working notes are not separately
c5694b68:docs/reviews/drift-coherence-review-2026-10-19.md:235:- **LIN-3074 looks obsolete.** The "does not yet honor / pending LIN-2995" copy has 0 production hits, and `dispatch-integration.md:136` 
c5694b68:docs/reviews/drift-coherence-review-2026-10-19.md:780:**Updated rather than minted** (each already names the decision; one comment each, from this run): **LIN-2150 / LIN-2188** (writer repro 
c5694b68:docs/reviews/integration-surface-maturity-review-2026-09-26.md:121:4. **A second new instance of stalled contract text.** The consumer now honours a halt (**LIN-2995 is
c5694b68:docs/reviews/integration-surface-maturity-review-2026-09-26.md:122:   `Done`**), but Harbour's operator-facing text still says "the runner does not yet honor it (pending
c5694b68:docs/reviews/integration-surface-maturity-review-2026-09-26.md:123:   LIN-2995)" in fourteen files. This is the **halt-copy stale-contract class**, owned by **LIN-3074**
c5694b68:docs/reviews/integration-surface-maturity-review-2026-09-26.md:247:`resolveEffectiveHalt` (`simple-dispatcher/halt.js:219`) into `runOnce`, and **LIN-2995 is `Done`**. Harbour's
c5694b68:docs/reviews/integration-surface-maturity-review-2026-09-26.md:248:operator-facing text still asserts the opposite — "the runner does not yet honor it (pending LIN-2995)" — in
c5694b68:docs/reviews/integration-surface-maturity-review-2026-09-26.md:250:wording at run 2; with LIN-2995 shipped it is now **contract drift**, and it is operator-visible
c5694b68:docs/reviews/integration-surface-maturity-review-2026-09-26.md:349:| `flow-dispatch-halt` | FLOW | `lib/workspace-halt.js` (+ `routes/proxy-halt.js`) | `workspace-halt.js` ← `routes/dispatch.
c5694b68:docs/reviews/integration-surface-maturity-review-2026-09-26.md:654:grep -rn "LIN-2995\|yet honor" --include='*.js' --include='*.md' .
c5694b68:docs/reviews/integration-surface-maturity-review-2026-09-26.md:659:(`| LIN-2995 | Backlog | … |`), not contract prose — gives **34 hits across 14 files**. A count of **27** is
c5694b68:docs/reviews/integration-surface-maturity-review-2026-09-26.md:663:**Why it is drift now, not just stale wording:** LIN-2995 is **`Done`** — the consumer honours a halt
c5694b68:docs/reviews/integration-surface-maturity-review-2026-09-26.md:669:`docs/runbooks/harbour-degraded.md:60` ("once LIN-2995 lands, `stop` flows abort → error").
c5694b68:docs/reviews/recent-headwinds-review-2026-09-26.md:88:**What.** The runner-substrate repair class is **23 tickets** in the window cohort (`LIN ≥ 2384`): **12 Done, 11 open** (10 Backlog, 1 To
c5694b68:docs/reviews/recent-headwinds-review-2026-09-26.md:110:- **Incident/halt program — deliberate incident response, now closed.** The 2026-09-22 database-reads incident (`docs/incidents/2026-09-
c5694b68:docs/reviews/recent-headwinds-review-2026-09-26.md:201:- **The 2026-09-22 incident was handled well.** A real production fault (degraded EU↔US-East DB link) was diagnosed, structurally fixed 
c5694b68:public/dispatch.js:771:// stored halt (LIN-2995, `lib/runner-kit/runner.mjs` `haltAction`) but only on
c5694b68:tests/e2e/dispatch-halt.spec.js:11: * honours a dashboard halt on its next poll (LIN-2995). These specs only pin
c5694b68:tests/e2e/dispatch-halt.spec.js:128:    await expect(halt.status()).not.toContainText('does not yet honor');
c5694b68:tests/fixtures/run-ledger-comments.js:23:      "body": "## Review: S3 (PR #1621)\nVerdict: Approve — conditional\n\nI'm an independent reviewer and I didn't write this PR. I checked `lin-3098
c5694b68:tests/unit/dispatch-route-halt.test.js:13: * Setting a halt stores a request the runner honours (LIN-2995); set and clear
c5694b68:tests/unit/render-dispatch-exec-controls.test.js:42:// LIN-3027 L1 / LIN-3398 — the Integration Guide's halt note: LIN-2995 shipped
c5694b68:tests/unit/render-dispatch-exec-controls.test.js:43:// the runner's halt, so the old "does not yet honor it (pending LIN-2995)"
c5694b68:tests/unit/render-dispatch-exec-controls.test.js:52:  assert.ok(!/does not yet honor|pending LIN-2995/.test(noteText),
c5694b68:tests/unit/render-dispatch-exec-controls.test.js:53:    'guide-halt-note no longer carries the stale pending-LIN-2995 claim');
c5694b68:tests/unit/runner-kickoff.test.js:109:  test('halts are binding; the stale "does not yet honor" claim is gone from /instructions and the prompt', () => {
c5694b68:tests/unit/runner-kickoff.test.js:110:    assert.doesNotMatch(prompt, /does not yet honor/);
--- hits: 52, files: 17
--- files:
c5694b68:docs/incidents/2026-09-22-harbour-db-reads-hang.md
c5694b68:docs/papers/harbour/proportional-process-backtest.md
c5694b68:docs/papers/harbour/survey-check-7.md
c5694b68:docs/papers/harbour/where-judgement-happens.md
c5694b68:docs/papers/harbour/which-rules-pay.md
c5694b68:docs/reviews/_evidence-2026-09-26/visual-pass.md
c5694b68:docs/reviews/design-interface-review-2026-09-26.md
c5694b68:docs/reviews/documentation-review-2026-09-26.md
c5694b68:docs/reviews/drift-coherence-review-2026-10-19.md
c5694b68:docs/reviews/integration-surface-maturity-review-2026-09-26.md
c5694b68:docs/reviews/recent-headwinds-review-2026-09-26.md
c5694b68:public/dispatch.js
c5694b68:tests/e2e/dispatch-halt.spec.js
c5694b68:tests/fixtures/run-ledger-comments.js
c5694b68:tests/unit/dispatch-route-halt.test.js
c5694b68:tests/unit/render-dispatch-exec-controls.test.js
c5694b68:tests/unit/runner-kickoff.test.js
```

### Q23. C8 production hit content check (public/dispatch.js:771)

- repo: `LinearViewer` · SHA: `c5694b68` · run at: `2026-10-21T12:05:28Z`

```bash
git show c5694b68:public/dispatch.js | sed -n "769,773p"
```

```text
//
// Decision-4 best-effort surface: this is a REQUEST only. The runner honours a
// stored halt (LIN-2995, `lib/runner-kit/runner.mjs` `haltAction`) but only on
// its next poll, so the status copy always says "requested", never
// "paused"/"stopped". Its own small client-side read; no server-render-path
```

### Q24. C9 Arm A: wiring / consumer-absence claims (single query, 60 lines)

- repo: `LinearViewer` · SHA: `c5694b68` · run at: `2026-10-21T12:05:28Z`

```bash
git grep -n -i -E "\bdark\b|no consumer|not( yet)? wired|wired to (no|NO)|no read path|NO read path|no (production )?caller|nothing (reads|calls|consumes)|not yet consumed" c5694b68 -- lib routes server.js | cut -c1-210; echo "--- lines: $(git grep -n -i -E "\bdark\b|no consumer|not( yet)? wired|wired to (no|NO)|no read path|NO read path|no (production )?caller|nothing (reads|calls|consumes)|not yet consumed" c5694b68 -- lib routes server.js | wc -l | tr -d " ")"
```

```text
c5694b68:lib/account-store.js:43: * Phase A only: this store is constructed in server.js but wired to NO route —
c5694b68:lib/account-workspace-store.js:28: * Phase B only: constructed in server.js but wired to NO route until LIN-1329
c5694b68:lib/account-workspace-store.js:139:   *   (machines) and workspace sharing. LIN-1892 adds no production caller;
c5694b68:lib/chat-tools.js:34://     cache store was not wired into the catalog, the tool fails cleanly as
c5694b68:lib/chat-tools.js:1201: *   `scopeByTier.fleet` entry would have no consumer. Omitting a tier (or the
c5694b68:lib/connection-store.js:5: * {@link writeConnection} helper. NO read path is wired to it yet (LIN-3124
c5694b68:lib/connection-store.js:224:   * `readConnection*` call. NO production caller — enforced by the static
c5694b68:lib/consumer-poll-warning.js:7: * or the proxy response said that no consumer had ever polled that workspace.
c5694b68:lib/consumer-poll-warning.js:98: * Distinguishes "never" (no consumer token has ever polled/taken in this
c5694b68:lib/consumer-poll-warning.js:109:    return 'No consumer has ever polled this workspace — this dispatch was enqueued but may sit unclaimed until a runner starts.';
c5694b68:lib/consumer-poll-warning.js:117:  return `No consumer has polled this workspace since ${consumerLastSeenAt} — this dispatch was enqueued but may sit unclaimed until a runner starts.`;
c5694b68:lib/consumer-poll-warning.js:124: * up (or ended), so the warning is `null`, never a stale "no consumer has ever
c5694b68:lib/credential-invariant-sweep.js:20: * (lib/workspace-store.js) is Phase B, wired to no route, so it holds no
c5694b68:lib/db-indexes.js:342:  // retention policy (explicitly a follow-up, not wired here). Plain, non-TTL.
c5694b68:lib/dispatch-factory.js:98: * budget: no caller sets it, no prompt or feed shows it.
c5694b68:lib/dispatch-fields.js:163:  // createDispatchItem at enqueue time. null means "never" (no consumer token has
c5694b68:lib/dispatch-store.js:40: *   consumerLastSeenAt: string, // Consumer poll-recency stamp (LIN-2885): the most recent `lastUsedAt` across the workspace's non-revoked consumer tokens (lib/dispatch-tokens
c5694b68:lib/dispatch-store.js:583:   * Decisions 2, 8, 10). Inert: no production caller yet.
c5694b68:lib/dispatch-store.js:2015:   *   (LIN-3161); omitted → unbounded (no caller does this in production)
c5694b68:lib/github-install-flow.js:819:      // `installationId` is deliberately NOT wired here — that is LIN-712 (surface 6),
c5694b68:lib/harbour-feedback-tokens.js:76:   * 401 Unauthorized — no caller-facing distinction between failure modes
c5694b68:lib/held-connection-entry.js:2: * LIN-3125 Phase 1 — the held-connection entry seam (dark: no consumer).
c5694b68:lib/kpi-daily-rollup.js:11: * backfill for days that have left the horizon. Nothing reads the collection
c5694b68:lib/liveness-detectors.js:10: *  - Rule S, dispatcher silent: no consumer poll within NOBODY_LISTENING_MS
c5694b68:lib/liveness-detectors.js:131: * Rule S. Fires when no consumer poll is within NOBODY_LISTENING_MS while at
c5694b68:lib/observer-state-store.js:79: * `llm-call-log`/`prompt-trace-store.js` ship a `cleanup()` nothing calls)
c5694b68:lib/observer-sweep.js:645:    // exists yet (see lib/workspace-store.js — constructed but wired to no
c5694b68:lib/owner-mint-refusals.js:99: * consulting the seam, because the seam folds "no caller identity" into
c5694b68:lib/periodical-runs.js:42: *     production caller today (no caller narrows `historyTtlMs`/`horizonMs`
c5694b68:lib/periodicals.js:92://   recommend/loop. (Autopilot is not yet wired to dispatch periodicals; that
c5694b68:lib/plan-review-round-trips.js:589:  // there is no caller that passes this through unchecked: the only production
c5694b68:lib/prompt-template-defs.js:242:        'If a Surface Assessment in prior research comments declares `refactor required` and names the cause it removes or the line in this task that consumes it, encode
c5694b68:lib/prompts/collective-participant.js:126: *   block. This is the seam for LIN-820 — no production caller passes a custom
c5694b68:lib/providers/interface.js:356:   * workspace binding (Linear, Local). Display-only; no consumer this ticket.
c5694b68:lib/providers/interface.js:366:   * for jira). `null` on the base class. Display-only; no consumer this
c5694b68:lib/proxy-instructions.js:650:  → "dispatcher-silent" fires when no consumer has polled for >20 min while a queued/taken item exists; "stopped-or-circular-wait" fires when a parked [pending] wait has s
c5694b68:lib/proxy-instructions.js:806:  → CONSUMER POLL WARNING (LIN-2885) — "consumerLastSeenAt" is the most recent lastUsedAt across the workspace's non-revoked consumer tokens, stamped once at enqueue; null
c5694b68:lib/proxy-preamble.js:444:  // ── Declared branch (LIN-3138). Inert: no production caller passes a
c5694b68:lib/proxy-preamble.js:692: * 2, 3, 7's helper attach mode, 10). Inert: no production caller yet.
c5694b68:lib/proxy-tokens.js:119:   * LIN-3129 A3: a true ES private method, so no caller outside the class can
c5694b68:lib/recommend-recurse.js:6: * resolved entirely server-side, before any dispatch, so no consumer ever receives
c5694b68:lib/render-flight-companion.js:226:    // altogether (a caller that has not wired the route's data at all)
c5694b68:lib/unanswered-decisions.js:122: * Branch 4's `null` is therefore reachable only when no caller injects the
c5694b68:lib/workspace-owner.js:16: *   { status: 'not-owner' } — a different account owns it, or no caller account
c5694b68:lib/workspace-owner.js:70:  // No caller identity is never the owner (a grant-bearing document with a null
c5694b68:lib/workspace-registry.js:3: * registry (LIN-3700, step 1 of LIN-3394). Write-only: nothing reads the row
c5694b68:lib/workspace-token-refresh.js:496:  // ticket named IS closed — but nothing consumes it to gate expiry
c5694b68:lib/workspace.js:411: * LIN-1887 close-out: that explicit-provider arm has no PRODUCTION caller yet —
c5694b68:routes/collective.js:116:      // Not yet consumed by the renderer — wiring the picker UI is the next beat;
c5694b68:routes/dashboard.js:1304:      // Skipped when the reader is not wired (tests, and any deployment without
c5694b68:routes/jira-auth.js:423:   * with no Jira binding. It is inert — nothing reads a provider partition whose
c5694b68:routes/test.js:57: * @param {Object|null} [options.commentDedupe] - In-process comment dedupe cache (LIN-3198 reset seam), or null when not wired
c5694b68:routes/test.js:537:      if (!taskShareCollection) return res.status(500).json({ error: 'taskShareCollection not wired' })
c5694b68:routes/test.js:549:      if (!kpiDailyRollupCollection) return res.status(500).json({ error: 'kpiDailyRollupCollection not wired' })
c5694b68:routes/test.js:570:      if (!kpiDailyRollupCollection) return res.status(500).json({ error: 'kpiDailyRollupCollection not wired' })
c5694b68:routes/test.js:803:  // first assertion. Resetting state must drop this too. No-op if not wired.
c5694b68:routes/test.js:825:  // one worker cannot change another worker's assertion. No-op if not wired.
c5694b68:routes/test.js:1363:      if (!localStore) throw new Error('localStore not wired into test routes');
c5694b68:server.js:696:// (routes/auth.js). No read path is wired to it yet — that is Session 2
c5694b68:server.js:705:// the shared writeConnection helper; no read path wired yet (LIN-3124 owns the
--- lines: 60
```

### Q25. C9 Arm B: pending-ticket claims. Literal and wider forms, with counts (N1)

- repo: `LinearViewer` · SHA: `c5694b68` · run at: `2026-10-21T12:05:28Z`

```bash
bash /private/tmp/claude-503/-Users-work-development-simple-dispatcher-workspaces-062f8a83-e50a-4be7-8b41-c150a9440683/062f8a83-e50a-4be7-8b41-c150a9440683/scratchpad/scripts/armb.sh
```

```text
literal, case-sensitive      (once|until|pending|awaiting) LIN-[0-9]+                         : 7
literal, -i                  (once|until|pending|awaiting) LIN-[0-9]+                         : 10
wider A, -i                  (once|until|pending|awaiting)[^.]{0,60}LIN-[0-9]+                : 50
wider B, -i                  (once|until|pending|awaiting|blocked on|not yet landed|lands)[^.]{0,80}LIN-[0-9]+ : 55
--- literal -i lines:
c5694b68:lib/account-workspace-store.js:28: * Phase B only: constructed in server.js but wired to NO route until LIN-1329
c5694b68:lib/agent-turn.js:585: * never touches `companionAdvance` (user-initiated today; boot once LIN-2622
c5694b68:lib/dispatch-store.js:1122:   *   `cancelled` / `expired`). Until LIN-2079 status was only ever a JS filter
c5694b68:lib/effort-readout.js:597:        : "The effort column is empty by design: this workspace's runner does not yet report a realised effort value per run (LIN-2567, tracked separately, in progre
c5694b68:lib/errors.js:281: * strictly more informative when it exists. (Until LIN-2363 the stated reason was
c5694b68:lib/expire-ownerless-dispatch-tokens.js:4: * Until LIN-3618 nothing set `expiresAt`, so every dispatch token was permanent,
c5694b68:lib/providers/interface.js:330:   *   until LIN-2819. A provider with no `entryCta` renders bind-only whatever
c5694b68:lib/providers/jira/index.js:1379:   * Flip `newWorkspaceVerb: true` once LIN-2819 makes the route mint fresh.
c5694b68:lib/workspace.js:96:// once LIN-2018 remaps Jira team ids to real project keys) with a membership
c5694b68:routes/proxy.js:550:        // both 401 and were, until LIN-1985, distinguishable ONLY in Harbour's
```

**Arm B script source (scratch, not committed):**

```bash
#!/bin/bash
P=c5694b68
cnt(){ git grep -n "$@" $P -- lib routes server.js | wc -l | tr -d ' '; }
printf '%s\n' "literal, case-sensitive      (once|until|pending|awaiting) LIN-[0-9]+                         : $(cnt -E '(once|until|pending|awaiting) LIN-[0-9]+')"
printf '%s\n' "literal, -i                  (once|until|pending|awaiting) LIN-[0-9]+                         : $(cnt -i -E '(once|until|pending|awaiting) LIN-[0-9]+')"
printf '%s\n' "wider A, -i                  (once|until|pending|awaiting)[^.]{0,60}LIN-[0-9]+                : $(cnt -i -E '(once|until|pending|awaiting)[^.]{0,60}LIN-[0-9]+')"
printf '%s\n' "wider B, -i                  (once|until|pending|awaiting|blocked on|not yet landed|lands)[^.]{0,80}LIN-[0-9]+ : $(cnt -i -E '(once|until|pending|awaiting|blocked on|not yet landed|lands)[^.]{0,80}LIN-[0-9]+')"
echo '--- literal -i lines:'
git grep -n -i -E '(once|until|pending|awaiting) LIN-[0-9]+' $P -- lib routes server.js | cut -c1-200
```

### Q26. C9 member existence check: each of the 19 definite and 3 borderline cites, by content at the pin

- repo: `LinearViewer` · SHA: `c5694b68` · run at: `2026-10-21T12:05:29Z`

```bash
chk(){ f=$1; l=$2; echo "== $f:$l"; git show c5694b68:$f | sed -n "${l}p" | cut -c1-190; }; for m in lib/account-store.js:43 lib/account-workspace-store.js:28 lib/connection-store.js:5 lib/connection-store.js:60 lib/connection-store.js:71 lib/credential-invariant-sweep.js:20 lib/dispatch-store.js:583 lib/held-connection-entry.js:2 lib/kpi-daily-rollup.js:11 lib/periodicals.js:92 lib/prompts/collective-participant.js:126 lib/proxy-preamble.js:444 lib/proxy-preamble.js:692 routes/collective.js:116 server.js:696 server.js:705 server.js:4290 lib/effort-readout.js:597 lib/workspace.js:96 lib/agent-turn.js:585 lib/account-workspace-store.js:139 lib/observer-sweep.js:645 lib/superseded-selection.js:16 lib/liveness-alarm-store.js:276; do chk ${m%%:*} ${m##*:}; done
```

```text
== lib/account-store.js:43
 * Phase A only: this store is constructed in server.js but wired to NO route —
== lib/account-workspace-store.js:28
 * Phase B only: constructed in server.js but wired to NO route until LIN-1329
== lib/connection-store.js:5
 * {@link writeConnection} helper. NO read path is wired to it yet (LIN-3124
== lib/connection-store.js:60
 *     delete path (LIN-3124 not yet landed) would be a security-boundary
== lib/connection-store.js:71
 *     LIN-3124 lands deletion.
== lib/credential-invariant-sweep.js:20
 * (lib/workspace-store.js) is Phase B, wired to no route, so it holds no
== lib/dispatch-store.js:583
   * Decisions 2, 8, 10). Inert: no production caller yet.
== lib/held-connection-entry.js:2
 * LIN-3125 Phase 1 — the held-connection entry seam (dark: no consumer).
== lib/kpi-daily-rollup.js:11
 * backfill for days that have left the horizon. Nothing reads the collection
== lib/periodicals.js:92
//   recommend/loop. (Autopilot is not yet wired to dispatch periodicals; that
== lib/prompts/collective-participant.js:126
 *   block. This is the seam for LIN-820 — no production caller passes a custom
== lib/proxy-preamble.js:444
  // ── Declared branch (LIN-3138). Inert: no production caller passes a
== lib/proxy-preamble.js:692
 * 2, 3, 7's helper attach mode, 10). Inert: no production caller yet.
== routes/collective.js:116
      // Not yet consumed by the renderer — wiring the picker UI is the next beat;
== server.js:696
// (routes/auth.js). No read path is wired to it yet — that is Session 2
== server.js:705
// the shared writeConnection helper; no read path wired yet (LIN-3124 owns the
== server.js:4290
// find-or-create branch) is blocked on LIN-541/544 and only scaffolded here.
== lib/effort-readout.js:597
        : "The effort column is empty by design: this workspace's runner does not yet report a realised effort value per run (LIN-2567, tracked separately, in progress). It reads the SAME te
== lib/workspace.js:96
// once LIN-2018 remaps Jira team ids to real project keys) with a membership
== lib/agent-turn.js:585
 * never touches `companionAdvance` (user-initiated today; boot once LIN-2622
== lib/account-workspace-store.js:139
   *   (machines) and workspace sharing. LIN-1892 adds no production caller;
== lib/observer-sweep.js:645
    // exists yet (see lib/workspace-store.js — constructed but wired to no
== lib/superseded-selection.js:16
 * temporary seam to be deleted once the LIN-3124 single-source cutover lands.
== lib/liveness-alarm-store.js:276
   * Retention-agnostic cleanup hook used by the server's periodic cleanup
```

### Q27. C9 provenance by git blame: commit that last wrote each member line, and whether it predates run 3 pin b5c528c4 (plan: 11 predate, 8 newer, over the 19 definite)

- repo: `LinearViewer` · SHA: `c5694b68 (blame) vs b5c528c4 (ancestry)` · run at: `2026-10-21T12:05:29Z`

```bash
bash /private/tmp/claude-503/-Users-work-development-simple-dispatcher-workspaces-062f8a83-e50a-4be7-8b41-c150a9440683/062f8a83-e50a-4be7-8b41-c150a9440683/scratchpad/scripts/c9prov.sh
```

```text
lib/account-store.js:43                          df584743 2026-07-14  predates run 3 pin
lib/account-workspace-store.js:28                7495ce97 2026-07-14  predates run 3 pin
lib/connection-store.js:5                        9ba51b39 2026-09-27  NEWER than run 3 pin
lib/connection-store.js:60                       9ba51b39 2026-09-27  NEWER than run 3 pin
lib/connection-store.js:71                       9ba51b39 2026-09-27  NEWER than run 3 pin
lib/credential-invariant-sweep.js:20             edbe5e7e 2026-08-23  predates run 3 pin
lib/dispatch-store.js:583                        581dc1bd 2026-09-29  NEWER than run 3 pin
lib/held-connection-entry.js:2                   c465178a 2026-10-01  NEWER than run 3 pin
lib/kpi-daily-rollup.js:11                       d2da45a3 2026-10-20  NEWER than run 3 pin
lib/periodicals.js:92                            4b1592cf 2026-06-11  predates run 3 pin
lib/prompts/collective-participant.js:126        481ec515 2026-07-05  predates run 3 pin
lib/proxy-preamble.js:444                        f62a9661 2026-09-29  NEWER than run 3 pin
lib/proxy-preamble.js:692                        4043c0f0 2026-09-29  NEWER than run 3 pin
routes/collective.js:116                         de23691b 2026-07-06  predates run 3 pin
server.js:696                                    1804816d 2026-07-21  predates run 3 pin
server.js:705                                    9ba51b39 2026-09-27  NEWER than run 3 pin
server.js:4290                                   a0a16dc5 2026-06-25  predates run 3 pin
lib/effort-readout.js:597                        cf53c824 2026-09-05  predates run 3 pin
lib/workspace.js:96                              8b44ee26 2026-08-10  predates run 3 pin
lib/agent-turn.js:585                            321848e1 2026-09-05  predates run 3 pin
lib/account-workspace-store.js:139               e35c1f0c 2026-09-27  NEWER than run 3 pin
lib/observer-sweep.js:645                        bea1f38a 2026-08-29  predates run 3 pin
lib/superseded-selection.js:16                   99179122 2026-10-01  NEWER than run 3 pin
```

**Tally (19 definite members; `connection-store.js:60/71` is one member and `connection-store.js:5` another).** Predate the run 3 pin: 11 (`account-store`, `account-workspace-store:28`, `credential-invariant-sweep`, `periodicals`, `collective-participant`, `routes/collective`, `server.js:696`, `server.js:4290`, `effort-readout`, `workspace`, `agent-turn`). Newer: 8 (`connection-store:5`, `connection-store:60/71`, `dispatch-store`, `held-connection-entry`, `kpi-daily-rollup`, `proxy-preamble:444`, `proxy-preamble:692`, `server.js:705`). Of the three borderline members, `account-workspace-store:139` and `superseded-selection:16` are newer and `observer-sweep:645` predates. This reproduces the plan's "11 of the 19 had their text before it, 8 are newer".

**Blame script source (scratch, not committed):**

```bash
#!/bin/bash
# For each C9 definite member line at c5694b68, the commit that last wrote it (git blame) and whether that commit is an ancestor of run 3's scoring pin b5c528c4.
P=c5694b68; R3=b5c528c4
pre=0; post=0
for m in lib/account-store.js:43 lib/account-workspace-store.js:28 lib/connection-store.js:5 lib/connection-store.js:60 lib/connection-store.js:71 lib/credential-invariant-sweep.js:20 lib/dispatch-store.js:583 lib/held-connection-entry.js:2 lib/kpi-daily-rollup.js:11 lib/periodicals.js:92 lib/prompts/collective-participant.js:126 lib/proxy-preamble.js:444 lib/proxy-preamble.js:692 routes/collective.js:116 server.js:696 server.js:705 server.js:4290 lib/effort-readout.js:597 lib/workspace.js:96 lib/agent-turn.js:585 lib/account-workspace-store.js:139 lib/observer-sweep.js:645 lib/superseded-selection.js:16; do
  f=${m%%:*}; l=${m##*:}
  c=$(git blame -L $l,$l --porcelain $P -- $f | head -1 | cut -d' ' -f1)
  d=$(git log -1 --format=%cs $c)
  if git merge-base --is-ancestor $c $R3; then s="predates run 3 pin"; else s="NEWER than run 3 pin"; fi
  printf '%-48s %s %s  %s\n' "$m" "${c:0:8}" "$d" "$s"
done
```

### Q28. C10 strict rule on the run-3 report: raw matches, unique groups

- repo: `LinearViewer` · SHA: `c5694b68` · run at: `2026-10-21T12:05:30Z`

```bash
git show c5694b68:docs/reviews/integration-surface-maturity-review-2026-09-26.md | grep -noE "[A-Za-z0-9_./-]+\.(js|md|mjs|txt|json):[0-9]+(-[0-9]+)?(,[0-9]+(-[0-9]+)?)*" | wc -l; echo "(raw above; unique below)"; git show c5694b68:docs/reviews/integration-surface-maturity-review-2026-09-26.md | grep -oE "[A-Za-z0-9_./-]+\.(js|md|mjs|txt|json):[0-9]+(-[0-9]+)?(,[0-9]+(-[0-9]+)?)*" | sort -u | wc -l
```

```text
     132
(raw above; unique below)
      98
```

### Q29. C10 bare and slash forms: script (paragraph rule), output

- repo: `LinearViewer` · SHA: `c5694b68` · run at: `2026-10-21T12:05:30Z`

```bash
python3 -I /private/tmp/claude-503/-Users-work-development-simple-dispatcher-workspaces-062f8a83-e50a-4be7-8b41-c150a9440683/062f8a83-e50a-4be7-8b41-c150a9440683/scratchpad/scripts/c10.py /private/tmp/claude-503/-Users-work-development-simple-dispatcher-workspaces-062f8a83-e50a-4be7-8b41-c150a9440683/062f8a83-e50a-4be7-8b41-c150a9440683/scratchpad/run3.md /private/tmp/claude-503/-Users-work-development-simple-dispatcher-workspaces-062f8a83-e50a-4be7-8b41-c150a9440683/062f8a83-e50a-4be7-8b41-c150a9440683/scratchpad/c10.json
```

```text
strict raw 132 unique 98
bare raw 70 resolved raw 70 unresolved 0 []
bare unique resolved 53 new vs strict 36
slash raw 4 unique 4 new vs others 3
total unique groups 137
```

**C10 script source (scratch, not committed; reproduced here so the rule is unambiguous):**

```python
import re,sys,json
lines=open(sys.argv[1]).read().split('\n')
PATH=r'[A-Za-z0-9_./-]+\.(?:js|md|mjs|txt|json)'
LN=r'[0-9]+(?:-[0-9]+)?(?:,[0-9]+(?:-[0-9]+)?)*'
strict=re.compile(r'('+PATH+r'):('+LN+')')
bare=re.compile(r'(?<![A-Za-z0-9_./-]):('+LN+')')
anypath=re.compile(PATH)
slash=re.compile(r'(server\.js):((?:[0-9]+/)+[0-9]+)')
# units: table row = own unit; otherwise blank-line-delimited block
unit=[];u=0;prev_blank=True
for i,l in enumerate(lines):
    if l.strip()=='' : u+=1; unit.append(-1); continue
    if l.lstrip().startswith('|'): u+=1; unit.append(u); u+=1; continue
    unit.append(u)
strict_raw=[];bare_raw=[];slash_raw=[];unres=[]
for i,l in enumerate(lines):
    for m in strict.finditer(l): strict_raw.append((i+1,m.group(1),m.group(2)))
    for m in slash.finditer(l):
        for n in m.group(2).split('/'): slash_raw.append((i+1,m.group(1),n))
    for m in bare.finditer(l):
        # skip if this ':NNN' is the tail of a strict cite or slash form
        # resolve: nearest preceding path mention within same unit, else earlier on same line
        cand=None
        for j in range(i,-1,-1):
            if unit[j]!=unit[i]: break
            txt=l[:m.start()] if j==i else lines[j]
            ps=list(anypath.finditer(txt))
            if ps: cand=ps[-1].group(0); break
        if cand is None: unres.append((i+1,m.group(1)))
        else: bare_raw.append((i+1,cand,m.group(1)))
sg=sorted(set((p,r) for _,p,r in strict_raw))
bg=sorted(set((p,r) for _,p,r in bare_raw))
slg=sorted(set((p,r) for _,p,r in slash_raw))
allg=set(sg)|set(bg)|set(slg)
new_bare=set(bg)-set(sg)
print('strict raw',len(strict_raw),'unique',len(sg))
print('bare raw',len(bare_raw)+len(unres),'resolved raw',len(bare_raw),'unresolved',len(unres),unres)
print('bare unique resolved',len(bg),'new vs strict',len(new_bare))
print('slash raw',len(slash_raw),'unique',len(slg),'new vs others',len(set(slg)-set(sg)-set(bg)))
print('total unique groups',len(allg))
json.dump({'strict':sg,'bare':bg,'slash':slg,'unresolved':unres},open(sys.argv[2],'w'))
```

### Q30. C11 crossings: script and output

- repo: `LinearViewer` · SHA: `LinearViewer c5694b68 / simple-dispatcher bb1da78` · run at: `2026-10-21T12:05:30Z`

```bash
python3 -I /private/tmp/claude-503/-Users-work-development-simple-dispatcher-workspaces-062f8a83-e50a-4be7-8b41-c150a9440683/062f8a83-e50a-4be7-8b41-c150a9440683/scratchpad/scripts/c11.py /Users/work/development/simple-dispatcher-workspaces/062f8a83-e50a-4be7-8b41-c150a9440683/LinearViewer /Users/work/development/simple-dispatcher-workspaces/062f8a83-e50a-4be7-8b41-c150a9440683/simple-dispatcher
```

```text
simple-dispatcher non-merge commits in 3b1e734..bb1da78: 48
rule: LIN-<n> ids in subject+body of an sd commit that also appear in subject+body of a LinearViewer non-merge commit in e69e2cc9..c5694b68
crossing commits: 19  shared ids: 10 ['1952', '3135', '3136', '3197', '3208', '3358', '3438', '3451', '3630', '3670']
  1fd64ba ['3670'] LIN-3670: re-pin runner contract to LinearViewer #1969 (stop + no-session follow
  b43fdca ['3630'] LIN-3630: read an unknown Harbour halt mode as pause (do not merge) (#275)
  4c9fb76 ['1952'] LIN-1952: consumer heartbeat sender (SD PR 2 of 2) - do not merge before Harbour
  55cb461 ['3451'] LIN-3451: pin SD to the runner contract table (tests only; do not merge) (#273)
  782ce05 ['3438'] LIN-3438: keep abort characterization tests (F17) and the plain-abort wire row
  eb7e123 ['3358'] Revert "LIN-3430: SD ifParked abort and if-parked consumer capability (LIN-3358 
  a81d490 ['3358'] LIN-3430: SD ifParked abort and if-parked consumer capability (LIN-3358 slice F)
  5a6815f ['3358'] LIN-3431 R1+R3: end dead OpenCode runners; bound the BLOCKED-child shield
  3715654 ['3208'] LIN-3431 N1: terminal-phase guard on the opencode runner's three post-sentinel c
  1932eaa ['3197'] LIN-3199 review fixes F1-F5 (PR #258)
  9784bf0 ['3208'] LIN-3208: correct EXECUTING-flip line reference in hold-beat comments (:872 -> :
  8354873 ['3208'] LIN-3208 review fixes F1-F5 (PR #259)
  4dad29b ['3208'] LIN-3208: reaper per-pass retry budget (C3) + dispatcher default-dep wrap + boun
  4bc5939 ['3208'] LIN-3208: opencode C2 opt-in retry with R1 exclusions + race test
  21e23cb ['3208'] LIN-3208: hook DONE lane opt-in retry, marker gate, and closeOnDone gate
  4a9c2aa ['3208'] LIN-3208: opt-in bounded retry for terminal feedback posts + config knobs
  f305bf6 ['3135', '3136'] LIN-3135: system harness mints the enqueue writer via the driver copy
  c0eafbd ['3135'] LIN-3135: send the live row's { itemId } on the broker-token mint
  3d9ab9b ['3135'] LIN-3135: failing tests for the broker-token { itemId } hand-back
```

### Q31. C11 LinearViewer squash PRs for the shared ids

- repo: `LinearViewer` · SHA: `c5694b68` · run at: `2026-10-21T12:05:30Z`

```bash
for i in 3670 3630 1952 3451 3438 3358 3208 3197 3135 3136; do echo "LIN-$i: $(git log --no-merges --format="%h %s" --grep="LIN-$i" e69e2cc9..c5694b68 | head -8 | grep -oE "^[0-9a-f]+|\(#[0-9]+\)" | tr "\n" " ")"; done
```

```text
LIN-3670: 1d4aec6a (#1969) 
LIN-3630: d947d2dc (#1941) 
LIN-1952: e2cc2ef0 (#1930) 
LIN-3451: 251ef022 (#1923) 
LIN-3438: ce3c4ee8 (#1817) 159b6822 (#1816) 
LIN-3358: 711c8263 (#1805) 
LIN-3208: a564824b 
LIN-3197: 4c1df617 
LIN-3135: 3dc572aa ea5ff40f 9e86e50c 
LIN-3136: 0958d2fe f66edabc a9154efd c9eb2e71 4723e449 
```

**C11 script source (scratch, not committed):**

```python
import subprocess,re,sys
LV,SD=sys.argv[1],sys.argv[2]
def log(repo,rng):
    out=subprocess.run(['git','-C',repo,'log','--no-merges','--format=%H%x1f%s%x1f%b%x1e',rng],capture_output=True,text=True).stdout
    r=[]
    for e in out.split('\x1e'):
        e=e.strip('\n')
        if not e: continue
        h,s,b=e.split('\x1f',2); r.append((h,s,b))
    return r
sd=log(SD,'3b1e734..bb1da78'); lv=log(LV,'e69e2cc9..c5694b68')
ids=lambda t:set(re.findall(r'LIN-(\d+)',t))
lvids={}
for h,s,b in lv:
    for i in ids(s+'\n'+b): lvids.setdefault(i,[]).append(h[:8])
cross=[];shared=set()
for h,s,b in sd:
    x=ids(s+'\n'+b)&set(lvids)
    if x: cross.append((h[:7],s[:80],sorted(x,key=int))); shared|=x
print('simple-dispatcher non-merge commits in 3b1e734..bb1da78:',len(sd))
print('rule: LIN-<n> ids in subject+body of an sd commit that also appear in subject+body of a LinearViewer non-merge commit in e69e2cc9..c5694b68')
print('crossing commits:',len(cross),' shared ids:',len(shared),sorted(shared,key=int))
for c in cross: print(' ',c[0],c[2],c[1])
```

### Q32. C12 registry entries in lib/periodicals.js

- repo: `LinearViewer` · SHA: `c5694b68` · run at: `2026-10-21T12:05:31Z`

```bash
git show c5694b68:lib/periodicals.js | grep -n -E "^ {2,6}id: ." ; c=$(git show c5694b68:lib/periodicals.js | grep -c -E "^ {2,6}id: ."); echo "--- entries: $c"; git show c5694b68:lib/periodicals.js | sed -n "984,992p"
```

```text
882:    id: 'documentation-review',
890:    id: 'test-coverage-gap',
898:    id: 'security-review',
906:    id: 'api-quality',
914:    id: 'code-quality',
922:    id: 'drift-coherence',
930:    id: 'comprehension-debt',
938:    id: 'stability-review',
946:    id: 'dependency-supply-chain',
954:    id: 'recent-headwinds',
962:    id: 'design-review',
970:    id: 'performance-scale',
978:    id: 'data-fetch-architecture',
986:    id: 'integration-surface-maturity',
994:    id: 'onboarding-journey',
1002:    id: 'seams-tangles',
--- entries: 16
  },
  {
    id: 'integration-surface-maturity',
    title: 'Integration & Surface Maturity',
    mode: 'advisory',
    scope: 'repo',
    cadence: 'weekly',
    generatePrompt: generateIntegrationSurfaceMaturityPrompt
  },
```

### Q33. C13 timestamped dispatch sample (not boundable from source)

- source: this workspace's own dispatch API, `GET /api/proxy/dispatch` and `GET /api/proxy/dispatch/{id}` · run at: `2026-10-21T12:05:31Z`

```text
total 17780 | truncated True | rows returned 20
status counts in the returned rows: {'taken': 3, 'closed': 11, 'done': 6}
taken ffcadeb6 LIN-3766 age 0.13 h
taken 692b69de LIN-3766 age 0.14 h
taken 06dcd47e LIN-3766 age 0.16 h
periodicalId key in list row: False
periodicalId key in GET /dispatch/{id}: False
```

Illustration only; no decision depends on it. The taken rows are this workspace's own LIN-3766 dispatches. Production populations (taken-forever items, stored `periodicalId`, `authStoppedWorkspaces` heartbeat rows, provider-side Done automations) stay recorded as unbounded.

### Q34. C14 Arm 1: defect-commit regexes (reconstructed; plan counts 45 + 22 = 67 do not reproduce)

- repo: `LinearViewer` · SHA: `c5694b68` · run at: `2026-10-21T12:05:32Z`

```bash
python3 -I /private/tmp/claude-503/-Users-work-development-simple-dispatcher-workspaces-062f8a83-e50a-4be7-8b41-c150a9440683/062f8a83-e50a-4be7-8b41-c150a9440683/scratchpad/scripts/c14.py /Users/work/development/simple-dispatcher-workspaces/062f8a83-e50a-4be7-8b41-c150a9440683/LinearViewer
```

```text
non-merge commits e69e2cc9..c5694b68 touching lib routes server.js public: 547
SUBJECT_RE = fix|leak|bypass|trust|dropped|silently|wrong|broken|regress|csrf|privacy (case-insens, on subject)
EXCLUDE_RE = review|close-out|docs|test (case-insens, on subject)
BODY_RE    = class-\(a\)|behaviou?r fix|post-deploy|regression|\bbug\b (case-insens, on subject+body)
subject regex minus exclusion: 28 | body-marker additions: 26 | union: 54
plan/review figures were 45 / +22 / 67; regexes were not written down, so those counts are NOT reproduced here.
```

### Q35. C14 Arm 1: the 13 kept commits and the 4 uncounted borderline commits (subject lines)

- repo: `LinearViewer` · SHA: `c5694b68` · run at: `2026-10-21T12:05:32Z`

```bash
echo "kept:"; for k in 4563046c bf6f7507 4ee0a2c7 5bcd09be 91fca7dd d2d7d818 1f8010a0 350242d5 0152606d 5c1e85ac dbf3ecb8 ea6f0c37 1290ef75; do git log -1 --format="  %h %ad %s" --date=short $k | cut -c1-140; done; echo "uncounted borderline:"; for k in ca5c902f 5388ce40 c09e2d19 2469ac2b; do git log -1 --format="  %h %ad %s" --date=short $k | cut -c1-140; done; echo "in window (e69e2cc9..c5694b68)? "; for k in 4563046c bf6f7507 4ee0a2c7 5bcd09be 91fca7dd d2d7d818 1f8010a0 350242d5 0152606d 5c1e85ac dbf3ecb8 ea6f0c37 1290ef75; do git merge-base --is-ancestor $k c5694b68 && git merge-base --is-ancestor e69e2cc9 $k && echo "  $k in-window: yes (descendant of e69e2cc9, ancestor of pin)"; done
```

```text
kept:
  4563046c 2026-10-10 fix: accept GitHub issue ids in dispatch validation (LIN-3440) (#1814)
  bf6f7507 2026-10-15 LIN-3561: fix Jira href brackets and pin the codec's user-visible outputs (#1893)
  4ee0a2c7 2026-10-16 LIN-3578: rebuild lib/pipeline-loops.js design-first (rung 5); lean abort now reaches a digest-less target (#1901)
  5bcd09be 2026-09-30 LIN-3163: match paged-list index keys to their sort keys (post-deploy fix)
  91fca7dd 2026-10-17 LIN-3591: rebuild the KPI statistics collector design-first, fix the free-tier count leak (#1907)
  d2d7d818 2026-10-17 LIN-3592: rebuild the dispatch entrance design-first (#1906)
  1f8010a0 2026-10-16 LIN-3579: rebuild the page renderer cluster design-first (render, render-session, render-swipe, render-settings) (#190
  350242d5 2026-10-16 LIN-3573: rebuild the Agent API write and rulings routes design-first (LIN-3575 + LIN-3576) (#1899)
  0152606d 2026-10-03 LIN-3293: a hang-up is noticed whenever it happened, and recorded as the client leaving
  5c1e85ac 2026-09-30 LIN-3158: clear withTimeout's timer on settle so four live-path unit files stop idling ~25s
  dbf3ecb8 2026-10-09 LIN-3378: fix the four measured selector misroutes (LIN-3372 b, c, d, g) (#1799)
  ea6f0c37 2026-10-06 LIN-3323: a Connection-resolved owner login reports reason 'ok'
  1290ef75 2026-10-03 LIN-3278: serve the connection owner record, not the stale row mirror
uncounted borderline:
  ca5c902f 2026-10-19 LIN-3677: followUpTarget refuses unknown targets (#1983)
  5388ce40 2026-09-29 LIN-1892 S3: merge paths — stale re-proof, null-workspace merge, in-window offer
  c09e2d19 2026-10-02 LIN-3241 (B)(C)(D): ISSUE/selector cache bypass, refusal -> 422, dispatch referent branch
  2469ac2b 2026-10-12 LIN-3446: Go never dispatches on a live task (#1853)
in window (e69e2cc9..c5694b68)? 
  4563046c in-window: yes (descendant of e69e2cc9, ancestor of pin)
  bf6f7507 in-window: yes (descendant of e69e2cc9, ancestor of pin)
  4ee0a2c7 in-window: yes (descendant of e69e2cc9, ancestor of pin)
  5bcd09be in-window: yes (descendant of e69e2cc9, ancestor of pin)
  91fca7dd in-window: yes (descendant of e69e2cc9, ancestor of pin)
  d2d7d818 in-window: yes (descendant of e69e2cc9, ancestor of pin)
  1f8010a0 in-window: yes (descendant of e69e2cc9, ancestor of pin)
  350242d5 in-window: yes (descendant of e69e2cc9, ancestor of pin)
  0152606d in-window: yes (descendant of e69e2cc9, ancestor of pin)
  5c1e85ac in-window: yes (descendant of e69e2cc9, ancestor of pin)
  dbf3ecb8 in-window: yes (descendant of e69e2cc9, ancestor of pin)
  ea6f0c37 in-window: yes (descendant of e69e2cc9, ancestor of pin)
  1290ef75 in-window: yes (descendant of e69e2cc9, ancestor of pin)
```

**C14 Arm 2 editions (N3).** Sibling editions dated after 2026-09-26 at the pin are listed in the `docs/reviews` listing above (count printed there). Arm 2 reads the High-severity rows of: `security-review-2026-10-18`, `seams-tangles-review-2026-10-13` and `-10-20`, `code-quality-review-2026-10-20` (F-dashboard, High structural, maps only to ids already members; F-runner-kit is about `api-runner-kit`, outside the run-3 population). The per-edition read and the F-dashboard disposition are recorded in `c14-members.md` in a later beat; this file records only the re-runnable bound.

### Q36. C-plan-1 docs-test touchpoints for a new docs/reviews file

- repo: `LinearViewer` · SHA: `c5694b68` · run at: `2026-10-21T12:05:33Z`

```bash
git grep -l "docs/reviews" c5694b68 -- tests scripts .github package.json; echo "--- files: $(git grep -l "docs/reviews" c5694b68 -- tests scripts .github package.json | wc -l | tr -d " ")"; echo "--- anchor-resolver skip:"; git show c5694b68:tests/unit/docs-architecture-anchor-resolver.test.js | sed -n "90,94p"; echo "--- survey reader:"; git show c5694b68:scripts/survey-hides-periodicals.mjs | sed -n "53,57p"
```

```text
c5694b68:scripts/eval/fixtures-widened/LIN-1084.json
c5694b68:scripts/eval/fixtures-widened/_source/LIN-1084.json
c5694b68:scripts/eval/fixtures/recommend/_source/large-dense.json
c5694b68:scripts/eval/fixtures/recommend/large-dense.json
c5694b68:scripts/eval/fixtures/recommend/next-stage-choice.json
c5694b68:scripts/survey-hides-periodicals.mjs
c5694b68:tests/e2e/archive.spec.js
c5694b68:tests/unit/auth-route.test.js
c5694b68:tests/unit/claude-md-scheduler-jobs-census.test.js
c5694b68:tests/unit/docs-architecture-anchor-resolver.test.js
c5694b68:tests/unit/github-auth.test.js
c5694b68:tests/unit/lin-688-undici-not-a-dependency.test.js
c5694b68:tests/unit/periodical-report-gate.test.js
c5694b68:tests/unit/periodical-runs.test.js
c5694b68:tests/unit/proxy-periodical-report-gate-route.test.js
--- files: 15
--- anchor-resolver skip:
// a flat `docs/*.md` predicate is exactly what let docs/papers/harbour/ (a
// nested, NON-denylisted directory) slip through a real sweep once already.
const DENYLIST_DIRS = ['docs/reviews', 'docs/archive', 'plans', 'scripts/eval'];
const SKIP_DIR_NAMES = new Set(['node_modules', '.git']);
// `.txt`/`.html` are in the set because they were not, and a citation in
--- survey reader:

const reportsDir = 'docs/reviews';
const reports = readdirSync(reportsDir).filter((f) => /-2026-\d\d-\d\d(?:-[a-z0-9]+)?\.md$/.test(f) && TEMPLATES.some((t) => f.startsWith(t)) && f >= '' )
  .map((f) => {
    const date = f.match(/(2026-\d\d-\d\d)/)[1]; const template = TEMPLATES.find((t) => f.startsWith(t));
```

### Q37. C-plan-2 stage-router fold importers (production)

- repo: `LinearViewer` · SHA: `c5694b68` · run at: `2026-10-21T12:05:33Z`

```bash
for f in stage-router action-kind recent-runs recommendation-input; do echo "== $f"; git grep -n "from ..*/$f.js." c5694b68 -- lib routes server.js | cut -c1-140; done; echo "--- line counts:"; for f in stage-router action-kind recent-runs recommendation-input; do echo "$f: $(git show c5694b68:lib/$f.js | wc -l | tr -d " ")"; done
```

```text
== stage-router
c5694b68:lib/audit.js:19:import { buildRouterPrompt } from './stage-router.js';
c5694b68:lib/openrouter.js:13:import { buildRouterPrompt, routeStage, parseRecommendedAction, parseDeferTo } from './stage-router.js';
== action-kind
c5694b68:lib/stage-router.js:11:import { rejectExcludedKind } from './action-kind.js';
== recent-runs
c5694b68:lib/openrouter.js:20:import { formatRecentRuns } from './recent-runs.js';
c5694b68:lib/recommendation-input.js:20:import { loadRecentRuns } from './recent-runs.js';
== recommendation-input
c5694b68:routes/proxy.js:70:import { prepareRecommendationInput } from '../lib/recommendation-input.js';
c5694b68:routes/workspace-api.js:41:import { prepareRecommendationInput } from '../lib/recommendation-input.js';
--- line counts:
stage-router: 152
action-kind: 22
recent-runs: 84
recommendation-input: 36
```

### Q38. N7 duplicate basenames in the 134 added files (full-path importer resolution required)

- repo: `LinearViewer` · SHA: `c5694b68` · run at: `2026-10-21T12:05:33Z`

```bash
git diff --diff-filter=A --name-only e69e2cc9..c5694b68 -- lib routes | sed "s#.*/##" | sort | uniq -d; echo "--- importers by full relative path:"; for f in routes/email-auth lib/email-auth routes/library lib/library lib/milestone-funnel routes/milestone-funnel; do echo "== $f"; git grep -n "from ..*/$f.js." c5694b68 -- lib routes server.js | cut -c1-140; done
```

```text
email-auth.js
library.js
milestone-funnel.js
--- importers by full relative path:
== routes/email-auth
c5694b68:server.js:121:import { createEmailAuthRoutes, accountHomeRedirect } from './routes/email-auth.js'
== lib/email-auth
c5694b68:routes/email-auth.js:38:} from '../lib/email-auth.js';
c5694b68:server.js:123:import { MagicLinkStore, MAGIC_LINK_COLLECTION } from './lib/email-auth.js'
== routes/library
c5694b68:server.js:168:import { createLibraryRouter } from './routes/library.js'
== lib/library
c5694b68:routes/library.js:27:import { DEFAULT_DOCS_ROOT, FIGURE_TYPES, loadLibrary } from '../lib/library.js';
== lib/milestone-funnel
c5694b68:routes/milestone-funnel.js:26:import { stepsForAccountGroup } from '../lib/milestone-funnel.js';
== routes/milestone-funnel
c5694b68:server.js:131:import { createMilestoneFunnelRoutes } from './routes/milestone-funnel.js'
```

### Q39. BUILDER_VERSION, proxy router mounts, 14 vs 11

- repo: `LinearViewer` · SHA: `c5694b68` · run at: `2026-10-21T12:05:33Z`

```bash
git grep -n "BUILDER_VERSION =" c5694b68 -- lib; echo "--- router.use(create*Routes( in routes/proxy.js:"; git show c5694b68:routes/proxy.js | grep -n -E "^\s*router\.use\(create[A-Za-z]+Routes\(" | cut -c1-90; echo "mounts: $(git show c5694b68:routes/proxy.js | grep -c -E "^\s*router\.use\(create[A-Za-z]+Routes\(")"
```

```text
c5694b68:lib/observation-sessions-store.js:184:export const BUILDER_VERSION = 18;
--- router.use(create*Routes( in routes/proxy.js:
1277:  router.use(createTokensAdminRoutes({ proxyTokenStore, proxyEventStore, workspaceFro
1329:  router.use(createTokenExchangeRoutes({ proxyTokenStore, proxyEventStore, proxyLimit
1333:  router.use(createReadRoutes({ proxyLimiter, authenticateProxyToken, resolveProvider
1337:  router.use(createProxyWriteRoutes({ onTicketWrite, proxyLimiter, commentDedupe, com
1546:  router.use(createComputeRoutes({ recapCacheStore, briefCacheStore, taskSnapshotStor
1551:  router.use(createAgentStatusRoutes({ agentStatusStore, proxyLimiter, authenticatePr
1560:  router.use(createProxyHaltRoutes({ workspaceHaltStore, workspaceOwnerCheck, proxyLi
1566:  router.use(createProxyAlarmRoutes({ livenessAlarmStore, proxyLimiter, authenticateP
1574:  router.use(createRulingsRoutes({ proxyLimiter, authenticateProxyToken, requireWrite
1578:  router.use(createKickoffRoutes({ proxyLimiter, authenticateProxyToken, requireWrite
1582:  router.use(createDispatchRoutes({ authenticateProxyToken, chargeFreeTierOrReject, c
1596:  router.use(createProxyRunnerPromptRoutes({ proxyLimiter, authenticateProxyToken, re
1598:  router.use(createProxyRunnerRoutes({ proxyLimiter, authenticateProxyToken, requireG
1611:  router.use(createProxyFlightCompanionRoutes({ proxyLimiter, authenticateProxyToken,
mounts: 14
```

### Q40. Observer-efficacy wiring (mint error 1), R8 inputs

- repo: `LinearViewer` · SHA: `c5694b68` · run at: `2026-10-21T12:05:33Z`

```bash
echo "importers of observer-efficacy-signal:"; git grep -n "observer-efficacy-signal" c5694b68 -- lib routes server.js | cut -c1-160; echo "--- observer-shadow-log imports:"; git show c5694b68:lib/observer-shadow-log.js | grep -n "^import" | cut -c1-120
```

```text
importers of observer-efficacy-signal:
c5694b68:lib/observer-efficacy-signal.js:2: * lib/observer-efficacy-signal.js
c5694b68:lib/observer-efficacy-signal.js:216: * tests/unit/observer-efficacy-signal.test.js.
c5694b68:lib/observer-shadow-log.js:128: * `lib/observer-efficacy-signal.js`'s `computeNewHarnessSignal` reads
c5694b68:lib/observer-shadow-log.js:138: * tests/unit/observer-efficacy-signal.test.js.
--- observer-shadow-log imports:
53:import crypto from 'crypto';
```

### Q41. Run-3 Trend Ledger id extraction (ledger seed bound: 41 ids, verbatim rows)

- repo: `LinearViewer` · SHA: `c5694b68` · run at: `2026-10-21T12:05:33Z`

```bash
git show c5694b68:docs/reviews/integration-surface-maturity-review-2026-09-26.md | sed -n "573,650p" | grep -oE "^\| .(mod|api|flow|meta)-[a-z0-9-]+." | tr -d "| ." | sort -u | wc -l; for p in mod api flow meta; do echo "$p: $(git show c5694b68:docs/reviews/integration-surface-maturity-review-2026-09-26.md | sed -n "573,650p" | grep -cE "^\| .$p-")"; done
```

```text
      41
mod: 17
api: 9
flow: 14
meta: 1
```

### Q42. Writer-time re-run of the headline bounds at the PR head (plan step 7 (i)) and the R-verdict re-derivations (plan step 6)

- repo: `LinearViewer` · SHA: `c5694b68` (code) and `origin/main` = `8e59ed62` (docs-only drift) · run at: `2026-10-23T09:49:45Z`

```text
window commits e69e2cc9..c5694b68:                1158   (lib/routes/server.js: 577)
added lib/routes files:                      134
deleted lib/routes files:                    lib/dispatch-repo-guard.js lib/prompts/meta-prompt-template.js lib/workspace-repos.js 
C8 run-3 query hits/files at pin:            52 / 17
C8 at origin/main:                           52
code diff pin..origin/main (lib routes server.js public): 0 files
scheduler.register sites in server.js:       7
checkPeriodicalReportGate( call sites:       1  -> routes/proxy-writes.js:374:    const gate = checkPeriodicalReportGate({
OwnerCredentialStore module imports:         server.js:64:import { OwnerCredentialStore } from './lib/owner-credential-store.js'
periodicalId in routes/proxy-dispatch.js:    routes/proxy-dispatch.js:335:   * `periodicalId` (LIN-1825/LIN-2385): optional p
workspace-registry exports:                  19:export async function recordWorkspace(workspaceStore, workspace, { logger = console } = {}) {
observer-efficacy-signal prod importers:     0
free-tier key builder:                       lib/free-tier-store.js:97:  _getGlobalHourKey(hour = this._getHourKey()) { lib/free-tier-store.js:149:    const hourKey = this._getGlobalHourKey(hour); lib/free-tier-store.js:225:    const globalId = this._getGlobalHourKey(hour); 
hourly cleanup bare interval:                server.js:4599:  cleanupTimer = setInterval(runHourlyCleanup, CLEANUP_INTERVAL_MS)
tracker states read 2026-10-23T09:37Z via the workspace API: LIN-2576 Todo; 2846 Backlog; 1629 Todo; 2328 Todo; 1933 Todo; 3634 Done; 3649 Backlog; 3417 Backlog; 2120 Backlog; 1040 Backlog; 1041 Backlog; 3700 Done; 3394 Backlog; 3074 Backlog; 3745 Backlog; 2150 Todo; 2493/2287/1900/2609/2188 Backlog; 3741 Backlog; 3635/3642/3404 Done; 1410 Backlog; 3238/3239/3269/3706/2955 Done
```

Census test on the PR branch: `node --test tests/unit/claude-md-scheduler-jobs-census.test.js` -> tests 5, pass 5, fail 0 (run 2026-10-23, before opening the PR).
