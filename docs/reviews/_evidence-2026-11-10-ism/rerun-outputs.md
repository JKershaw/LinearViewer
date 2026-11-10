# Re-run outputs: Integration & Surface Maturity run 5 (LIN-4407)

Every bound this report rests on, re-run at the scoring pins, with the command and its verbatim output, so a reviewer
can reproduce each one. Scripts are not committed (task constraint); their full text is at the end of this file and
paths to them are shown as `<scratch>`. No command output here contains a credential: tracker reads went through the
local workspace proxy, whose address is omitted.

- LinearViewer pin: `9cf51ef7210f836c350d9d1d34e088a1bd850bcb`; simple-dispatcher pin: `5d8489e7fd8434f0e69af7df11a3746790abbe64`.
- Run-4 baseline: LinearViewer `c5694b68`, simple-dispatcher `bb1da78`; mint pin `f5b1f5efa`.
- Counting rules are run 4's (`_evidence-2026-10-21/integration-surface-maturity/rerun-outputs.md`, "Reproducibility notes") unless a query says otherwise.

### Q1. Pins and windows (LinearViewer)

- run at: `2026-11-10T11:51:18Z` · LinearViewer `9cf51ef72` · simple-dispatcher `5d8489e`

```bash
git rev-parse origin/main; git rev-list --count c5694b68..origin/main; git rev-list --count --no-merges c5694b68..origin/main; git rev-list --count 38760071..origin/main; git rev-list --count c5694b68..origin/main -- lib routes server.js; git rev-list --count 38760071..origin/main -- lib routes server.js
```

```text
9cf51ef7210f836c350d9d1d34e088a1bd850bcb
456
417
454
258
258
```

### Q2. Pins and window (simple-dispatcher)

- run at: `2026-11-10T11:51:18Z` · LinearViewer `9cf51ef72` · simple-dispatcher `5d8489e`

```bash
git -C /Users/autopilot/development/simple-dispatcher-workspaces/032b00de-2bf9-4190-8702-18d08c168be4/LinearViewer/../simple-dispatcher rev-parse origin/main; git -C /Users/autopilot/development/simple-dispatcher-workspaces/032b00de-2bf9-4190-8702-18d08c168be4/LinearViewer/../simple-dispatcher rev-list --count bb1da78..origin/main; git -C /Users/autopilot/development/simple-dispatcher-workspaces/032b00de-2bf9-4190-8702-18d08c168be4/LinearViewer/../simple-dispatcher diff --shortstat bb1da78 origin/main; git -C /Users/autopilot/development/simple-dispatcher-workspaces/032b00de-2bf9-4190-8702-18d08c168be4/LinearViewer/../simple-dispatcher diff --name-only bb1da78 origin/main | grep -c '^test/'; git -C /Users/autopilot/development/simple-dispatcher-workspaces/032b00de-2bf9-4190-8702-18d08c168be4/LinearViewer/../simple-dispatcher diff --diff-filter=A --name-only bb1da78 origin/main -- test | wc -l; git -C /Users/autopilot/development/simple-dispatcher-workspaces/032b00de-2bf9-4190-8702-18d08c168be4/LinearViewer/../simple-dispatcher log --no-merges --format=%s bb1da78..origin/main | grep -o 'LIN-[0-9]*' | sort -u | wc -l
```

```text
5d8489e7fd8434f0e69af7df11a3746790abbe64
67
 255 files changed, 47108 insertions(+), 3427 deletions(-)
208
     123
      55
```

### Q3. Drift since the mint pin f5b1f5efa

- run at: `2026-11-10T11:51:18Z` · LinearViewer `9cf51ef72` · simple-dispatcher `5d8489e`

```bash
git log --oneline f5b1f5efa..origin/main; git diff --name-only f5b1f5efa origin/main; git -C /Users/autopilot/development/simple-dispatcher-workspaces/032b00de-2bf9-4190-8702-18d08c168be4/LinearViewer/../simple-dispatcher log --oneline --since=2026-11-10T09:54:45Z origin/main | wc -l
```

```text
9cf51ef72 Merge pull request #2388 from JKershaw/chore/lin-4404-survey-fallback
284446e2b LIN-4404: post-deploy — drop survey script's pre-task-life /cost fallback
ecabd3d76 Merge pull request #2386 from JKershaw/feat/lin-4404-task-life-cost-read
fa0096c77 LIN-4404: close-out — alias test asserts identical bodies directly
d84b2b1db LIN-4404: leftovers — one load helper, the lineage cap at its owner
fa4bb76fb LIN-4404: whole-life task cost read (session timeline part 1, no UI)
docs/architecture/source-map.md
docs/areas/agent-api.md
docs/areas/areas.json
docs/passage-runner-prompt.md
docs/proxy-integration.md
lib/cost-read.js
lib/dispatch-store.js
lib/pipeline-loops.js
lib/proxy-instructions.js
lib/read-horizon.js
lib/task-cost-read.js
lib/task-page-loader.js
routes/proxy-compute.js
routes/proxy.js
routes/workspace-api-run-evidence.js
scripts/survey-effort-analyse.mjs
tests/fixtures/cost-replay/expected-changes.json
tests/fixtures/cost-replay/goldens-lin4197.json
tests/fixtures/cost-replay/lin4197-replay.js
tests/fixtures/cost-replay/record-lin4197.mjs
tests/unit/area-map-placement.test.js
tests/unit/cost-read-agreement.test.js
tests/unit/cost-read.test.js
tests/unit/lifetime-retention-contract-drift.test.js
tests/unit/lin-3384-redaction-census.test.js
tests/unit/lin-4201-cost-callers.test.js
tests/unit/lin-4404-task-life-cost-read.test.js
tests/unit/mongo-smoke.test.js
tests/unit/proxy-issue-cost-route.test.js
       0
```

### Q4. Sweep inputs: added/deleted/churn rows with area and full-path importers (base.py), then dispositions (dispose.py)

- run at: `2026-11-10T11:51:18Z` · LinearViewer `9cf51ef72` · simple-dispatcher `5d8489e`

```bash
python3 -I /private/tmp/claude-504/-Users-autopilot-development-simple-dispatcher-workspaces-032b00de-2bf9-4190-8702-18d08c168be4/032b00de-2bf9-4190-8702-18d08c168be4/scratchpad/scripts/base.py /Users/autopilot/development/simple-dispatcher-workspaces/032b00de-2bf9-4190-8702-18d08c168be4/LinearViewer /Users/autopilot/development/simple-dispatcher-workspaces/032b00de-2bf9-4190-8702-18d08c168be4/LinearViewer/../simple-dispatcher /private/tmp/claude-504/-Users-autopilot-development-simple-dispatcher-workspaces-032b00de-2bf9-4190-8702-18d08c168be4/032b00de-2bf9-4190-8702-18d08c168be4/scratchpad/out >/dev/null && python3 -c "import json;print(json.dumps(json.load(open('/private/tmp/claude-504/-Users-autopilot-development-simple-dispatcher-workspaces-032b00de-2bf9-4190-8702-18d08c168be4/032b00de-2bf9-4190-8702-18d08c168be4/scratchpad/out/base-summary.json')),indent=1))"; git diff --no-renames --diff-filter=A --name-only c5694b68 origin/main -- lib routes public | wc -l; git diff --no-renames --diff-filter=D --name-only c5694b68 origin/main -- lib routes public; python3 -I /private/tmp/claude-504/-Users-autopilot-development-simple-dispatcher-workspaces-032b00de-2bf9-4190-8702-18d08c168be4/032b00de-2bf9-4190-8702-18d08c168be4/scratchpad/scripts/dispose.py /private/tmp/claude-504/-Users-autopilot-development-simple-dispatcher-workspaces-032b00de-2bf9-4190-8702-18d08c168be4/032b00de-2bf9-4190-8702-18d08c168be4/scratchpad/out/base-rows.json /private/tmp/claude-504/-Users-autopilot-development-simple-dispatcher-workspaces-032b00de-2bf9-4190-8702-18d08c168be4/032b00de-2bf9-4190-8702-18d08c168be4/scratchpad/out/sweep-dispositions.csv; echo exit=$?
# Note: a first importer pass matched on '/<path below lib/>' and missed same-directory imports
# (e.g. lib/prompts/autopilot-precedence.js imported as './autopilot-precedence.js'); it was replaced
# by full-path resolution before any disposition was written.
```

```text
{
 "lv_head": "9cf51ef7210f836c350d9d1d34e088a1bd850bcb",
 "sd_head": "5d8489e7fd8434f0e69af7df11a3746790abbe64",
 "lv_commits": 456,
 "lv_commits_from_38760071": 454,
 "lv_commits_touching_code": 258,
 "sd_commits": 67,
 "sd_shortstat": "255 files changed, 47108 insertions(+), 3427 deletions(-)",
 "lv_renames": "",
 "sd_test_added": 123
}
     107
lib/next-run.js
lib/plan-fee-config.js
lib/render-next-run.js
lib/task-cost.js
public/chart.umd.min.js
public/marked.min.js
public/next-run.css
public/next-run.js
public/purify.min.js
routes/next-run.js
missing: []
LV added: 107 {'new id': 23, 'fold': 79, 'exclude': 5} | new ids: {'flow-as-asked-seal': 2, 'mod-model-routing': 17, 'flow-area-notes-leftover': 4}
folds into 19 carried ids: {'mod-render-layer': 31, 'flow-cost-telemetry': 12, 'mod-task-page': 6, 'flow-operator-decisions': 5, 'mod-prompt-template-system': 4, 'flow-dispatch-lifecycle': 3, 'mod-kpi-audit': 3, 'flow-run-evidence-closeout': 2, 'mod-library': 2, 'mod-task-edit': 2, 'api-openrouter': 1, 'flow-dispatch-halt': 1, 'flow-account-connection-workspace-credential': 1, 'flow-bootstrap-token-exchange': 1, 'mod-roadmap-trajectory': 1, 'flow-workspace-lifecycle': 1, 'mod-provider-abstraction': 1, 'mod-effort-readout': 1, 'mod-task-create': 1}
rows total 189 {('LinearViewer', 'new id'): 23, ('LinearViewer', 'fold'): 79, ('LinearViewer', 'exclude'): 5, ('LinearViewer', 'deleted'): 10, ('LinearViewer', 'modified (churn top-25)'): 25, ('simple-dispatcher', 'consumer'): 47}
dispositions naming no measured row: []
exit=0
```

### Q5. R7 Done-writer census: updateIssue/createIssue outside lib/providers, gate references, stateId lines

- run at: `2026-11-10T11:51:37Z` · LinearViewer `9cf51ef72` · simple-dispatcher `5d8489e`

```bash
git grep -n -E '\.(updateIssue|createIssue)\(' origin/main -- lib routes server.js ':!lib/providers' | cut -c1-170; echo '--- gate'; git grep -n checkPeriodicalReportGate origin/main -- lib routes server.js | cut -c1-140; echo '--- stateId'; git grep -n stateId origin/main -- routes server.js | cut -c1-140; echo '--- run-evidence chain'; grep -n 'settleDone\|closeOutSetsDone\|defaultMarkDone\|router.post' routes/workspace-api-run-evidence.js | cut -c1-140; echo '--- session PATCH'; grep -n -E "router\.patch|input\.stateId|updateIssue|recordPipelineMerge\(" routes/workspace-api-issue-write.js | cut -c1-140
```

```text
origin/main:lib/as-asked-seal.js:145:  const result = normalizeWritePayload(await provider.updateIssue(token, id, { description }), 'issue');
origin/main:lib/local-store.js:352:    for (const i of issues) storedIssues.push(await this.createIssue(scope, i));
origin/main:routes/proxy-writes.js:446:    const created = normalizeWritePayload(await provider.createIssue(token, input), 'issue');
origin/main:routes/proxy-writes.js:536:    const updated = normalizeWritePayload(await provider.updateIssue(token, issueId, input), 'issue');
origin/main:routes/proxy-writes.js:605:      const updated = normalizeWritePayload(await provider.updateIssue(token, req.params.issueId, { description: next }), 'issue');
origin/main:routes/test.js:1688:      const created = await provider.createIssue(req.query.urlKey || LOCAL_WS_URL_KEY, {
origin/main:routes/test.js:1842:      const created = await provider.createIssue({ repo: GITHUB_REPO, token: GITHUB_INSTALL_TOKEN }, {
origin/main:routes/workspace-api-feedback.js:518:      const created = normalizeWritePayload(await provider.createIssue(token, createInput), 'issue');
origin/main:routes/workspace-api-issue-write.js:801:      const created = answerIssueWrite(res, await provider.createIssue(token, input), 'Issue was not created');
origin/main:routes/workspace-api-issue-write.js:865:      const updated = answerIssueWrite(res, await provider.updateIssue(token, issueId, input), 'Issue was not updated'
origin/main:routes/workspace-api-run-evidence.js:60:  return provider.updateIssue(callScope, issueRef, { stateId: completedId || resolveStateRef(states, 'Done') });
--- gate
origin/main:lib/periodical-report-gate.js:115:export function checkPeriodicalReportGate({ description, comments, targetStateType } = {}) {
origin/main:routes/proxy-writes.js:54:import { checkPeriodicalReportGate } from '../lib/periodical-report-gate.js';
origin/main:routes/proxy-writes.js:468:    const gate = checkPeriodicalReportGate({
--- stateId
origin/main:routes/proxy-writes.js:368:    const { teamId, title, description, projectId, stateId, assigneeId, priority, priorityLevel, pare
origin/main:routes/proxy-writes.js:383:    // resolved id can also scope the symbolic stateId.
origin/main:routes/proxy-writes.js:424:    // converted (LIN-556: projectId / stateId accept symbolic names, state scoped
origin/main:routes/proxy-writes.js:433:      { name: 'stateId', key: 'stateId', value: stateId, present: Boolean, convert: (v) => resolveSta
origin/main:routes/proxy-writes.js:459:  async function refusedByPeriodicalGate(ctx, guard, teamId, stateId) {
origin/main:routes/proxy-writes.js:464:      targetStateType = (states || []).find(s => s.id === stateId)?.type || null;
origin/main:routes/proxy-writes.js:480:    const { title, description, stateId, assigneeId, priority, priorityLevel, projectId, parentId, cy
origin/main:routes/proxy-writes.js:493:    const updatable = [title, description, stateId, assigneeId, projectId, parentId, cycleId, priorit
origin/main:routes/proxy-writes.js:497:    // symbolic stateId needs (e.g. `done` -> the team's completed state).
origin/main:routes/proxy-writes.js:519:    // LIN-556: stateId / projectId accept symbolic names; assigneeId / parentId /
origin/main:routes/proxy-writes.js:521:    if (stateId) {
origin/main:routes/proxy-writes.js:522:      input.stateId = await resolveStateInput(provider, token, teamId, stateId);
origin/main:routes/proxy-writes.js:523:      if (await refusedByPeriodicalGate(ctx, guard, teamId, input.stateId)) return;
origin/main:routes/proxy-writes.js:542:    if (input.stateId) {
origin/main:routes/task-create.js:18: * landing also rejects a submitted-but-undeclared `stateId`/`priority` with 400 —
origin/main:routes/task-create.js:130:      const states = fields.includes('stateId') && !needsTeamFirst
origin/main:routes/workspace-api-issue-write.js:257:function issueCreateRefusal({ title, description, teamId, stateId, priority }, declared)
origin/main:routes/workspace-api-issue-write.js:265:  // LIN-1973: a stateId/priority the provider's createFields() does not declare
origin/main:routes/workspace-api-issue-write.js:267:  // explicit `stateId: ''` is still caught.
origin/main:routes/workspace-api-issue-write.js:268:  if (stateId !== undefined && !declared.includes('stateId')) return 'stateId is not sup
origin/main:routes/workspace-api-issue-write.js:766:    const { title, description, teamId, projectId, stateId, priority } = req.body || {};
origin/main:routes/workspace-api-issue-write.js:794:        ['stateId', stateId, (v) => resolveIssueStateRef(provider, token, scopeTeam, v)]
origin/main:routes/workspace-api-issue-write.js:832:    // v1 edit fields: title, description, state, priority. `stateId` is primary;
origin/main:routes/workspace-api-issue-write.js:835:    const stateRef = req.body?.stateId ?? req.body?.state ?? req.body?.status;
origin/main:routes/workspace-api-issue-write.js:861:      if (stateRef) input.stateId = await resolveIssueStateRef(provider, token, guard?.t
origin/main:routes/workspace-api-run-evidence.js:60:  return provider.updateIssue(callScope, issueRef, { stateId: completedId || resolveStat
--- run-evidence chain
14:import { closeOutSetsDone } from '../lib/run-closeout-state.js';
47:async function defaultMarkDone({ provider, callScope, issueIdentifier }) {
224:  async function settleDone({ workspace, provider, callScope, issueIdentifier, seam, mergedEvent }) {
230:      const written = await (seam.markDone || defaultMarkDone)({ provider, callScope, issueIdentifier });
233:      // re-fires. `defaultMarkDone` returns `{success, issue}`; the helper unwraps.
260:  router.post('/workspace/:urlKey/api/run-evidence/:issueIdentifier/check', workspaceFromUrl, json(), async (req, res) => {
300:        if (state.status === 'merged' && closeOutSetsDone({ prStatuses, prIndex, review: ledger, byPersonCheck: true })) {
301:          ({ mergedEvent, ...outcome } = await settleDone({ workspace, provider, callScope, issueIdentifier, seam, mergedEvent }));
326:  router.post('/workspace/:urlKey/api/run-evidence/:issueIdentifier/close-out-press', workspaceFromUrl, json(), async (req, res) => {
--- session PATCH
820:  router.patch('/workspace/:urlKey/api/issues/:issueId', workspaceFromUrl, json(), async (req, res) => {
827:    if (!provider.supports('updateIssue')) {
828:      return refuseCapability(res, provider.name, 'updateIssue', 'updating issues');
845:      // declared PROVIDER_SURFACE, so the `supports('updateIssue')` gate above
861:      if (stateRef) input.stateId = await resolveIssueStateRef(provider, token, guard?.team?.id || null, stateRef);
865:      const updated = answerIssueWrite(res, await provider.updateIssue(token, issueId, input), 'Issue was not updated');
882:          .then(() => recordPipelineMerge({ urlKey: req.workspace.urlKey, workspaceId: req.workspace.id, accountId: req.session.accountI
```

### Q6. Template drift: render every periodical and scan for minting wording; census patterns

- run at: `2026-11-10T11:51:37Z` · LinearViewer `9cf51ef72` · simple-dispatcher `5d8489e`

```bash
node -e "import('./lib/periodicals.js').then(m=>{console.log('registry',m.PERIODICALS.length);for(const p of m.PERIODICALS){const t=m.renderPeriodicalPrompt(p.id);console.log(p.id.padEnd(30),p.mode.padEnd(11),'mints-phrase(:303):',/whatever follow-up work this review mints/.test(t),' any-follow-up(:382):',/\(and any follow-up tasks\)/.test(t))}})"; sed -n '303p;382p;843p' lib/periodicals.js | cut -c1-160; sed -n '114,118p' lib/periodicals.js; sed -n '371,373p' tests/unit/periodicals.test.js | cut -c1-200
```

```text
registry 16
documentation-review           corrective  mints-phrase(:303): false  any-follow-up(:382): false
test-coverage-gap              corrective  mints-phrase(:303): false  any-follow-up(:382): false
security-review                corrective  mints-phrase(:303): false  any-follow-up(:382): false
api-quality                    corrective  mints-phrase(:303): false  any-follow-up(:382): false
code-quality                   corrective  mints-phrase(:303): false  any-follow-up(:382): false
drift-coherence                corrective  mints-phrase(:303): false  any-follow-up(:382): false
comprehension-debt             corrective  mints-phrase(:303): false  any-follow-up(:382): false
stability-review               advisory    mints-phrase(:303): true  any-follow-up(:382): true
dependency-supply-chain        corrective  mints-phrase(:303): false  any-follow-up(:382): false
recent-headwinds               advisory    mints-phrase(:303): true  any-follow-up(:382): true
design-review                  corrective  mints-phrase(:303): false  any-follow-up(:382): false
performance-scale              corrective  mints-phrase(:303): false  any-follow-up(:382): false
data-fetch-architecture        corrective  mints-phrase(:303): false  any-follow-up(:382): false
integration-surface-maturity   advisory    mints-phrase(:303): true  any-follow-up(:382): true
onboarding-journey             corrective  mints-phrase(:303): false  any-follow-up(:382): false
seams-tangles                  corrective  mints-phrase(:303): false  any-follow-up(:382): false
      : 'whatever follow-up work this review mints stays within its existing bound';
    const after = notes ? 'After the report and its area-note edits above are written' : 'After the report above (and any follow-up tasks) is written';
This review is a **portfolio/meta layer over the other periodicals**, not a fourteenth sibling review that re-inspects everything from scratch: most of its evid
//   - REPORTS TO A PERSON (the 3 advisory templates). They mint nothing and keep
//     the shared bullets' default wording (`handOffAdvisory`).
//
//   No Periodical mints a follow-up; the prompt census in
//   tests/unit/periodicals.test.js fails if minting wording comes back.
    test(`${template.title} gives no instruction to mint follow-up tasks`, () => {
      for (const re of [/Mint a bounded set of follow-up tasks/i, /into new Linear tasks yourself/i, /before minting a task/i, /top ~3 by severity/i, /follow-up tasks you minted/i]) {
        assert.doesNotMatch(prompt, re, `${template.id}: ${re}`);
```

### Q7. docs/reviews listing (sibling freshness; newest per family) and area-note sources

- run at: `2026-11-10T11:51:37Z` · LinearViewer `9cf51ef72` · simple-dispatcher `5d8489e`

```bash
git ls-tree --name-only origin/main docs/reviews/ | sed 's#docs/reviews/##' | grep -E '\.md$' | python3 -c "
import sys,re
fam={}
for f in sys.stdin.read().split():
  m=re.match(r'(.+?)-(2026-\d\d-\d\d)(-[a-z0-9-]+)?\.md$',f)
  if m: fam.setdefault(m.group(1),[]).append(m.group(2)+(m.group(3) or ''))
for k,v in sorted(fam.items()): print(k.ljust(40), len(v), sorted(v)[-1])"; echo '--- periodical-sourced area-note entries'; grep -h -o -E '\((Seams|Drift|Stability|Security|Code Quality|Documentation|Design|Comprehension|Test Coverage|API Quality|Dependency|Performance|Data|Onboarding|Recent)[^)]*\)' docs/areas/*.md /Users/autopilot/development/simple-dispatcher-workspaces/032b00de-2bf9-4190-8702-18d08c168be4/LinearViewer/../simple-dispatcher/docs/areas/*.md | cut -c1-40 | sort | uniq -c; echo '--- Survey tally entries'; grep -h -c 'Survey tally' docs/areas/*.md | paste -sd+ - | bc
```

```text
api-quality-review                       2 2026-10-23
capacity-levers-map                      1 2026-08-15
capacity-test-run-review                 1 2026-08-14
cheap-implementer-bakeoff                1 2026-09-13
code-quality-review                      8 2026-11-04
comprehension-debt-review                5 2026-11-05
context-efficiency-ceiling-review        1 2026-08-15
cost-tracking-review                     1 2026-11-02
data-fetch-architecture-review           1 2026-10-23
dependency-supply-chain-review           2 2026-10-23
design-interface-review                  9 2026-11-08
documentation-review                     6 2026-10-21
drift-coherence-review                   18 2026-11-10
integration-surface-maturity-review      4 2026-10-21
intra-session-efficiency-review          1 2026-08-14
lane-run-review                          1 2026-08-23
lin-4085-ab-run                          1 2026-11-01
lin-4345-per-sentence-replay             1 2026-11-07
lin-4345-upstream-cut-replay             1 2026-11-07
lin-4353-lin4085-review-replay           1 2026-11-07
lin-4369-size-replay                     1 2026-11-08
lin-4369-size-replay-arm2                1 2026-11-08
lin-4369-size-replay-arm3                1 2026-11-08
lin-4369-size-replay-arm4                1 2026-11-08
model-effort-routing-proposal            1 2026-09-11
onboarding-cold-start-review             3 2026-10-23
outward-validation-run                   1 2026-08-28
performance-scale-review                 1 2026-10-23
pre-ramp-harness-run                     1 2026-09-14
proposal-red-team                        1 2026-09-18
recent-headwinds-review                  9 2026-10-21
seams-tangles-review                     11 2026-11-10-run11
security-review                          3 2026-10-23
stability-review                         5 2026-11-08
test-coverage-gap                        2 2026-10-23
test-run-provenance-review               1 2026-11-02
--- periodical-sourced area-note entries
   8 (Design & Interface Review, 8 Nov 2026; 
   2 (Drift & Coherence Review, 10 Nov; `docs
   1 (Drift & Coherence Review, 10 Nov; the o
   2 (Seams & Tangles, 10 Nov.)
   2 (Seams & Tangles, 8 Nov.)
--- Survey tally entries
17
```

### Q8. C9 Arm A (run 4 Q24 query, verbatim) at HEAD

- run at: `2026-11-10T11:51:37Z` · LinearViewer `9cf51ef72` · simple-dispatcher `5d8489e`

```bash
git grep -n -i -E '\bdark\b|no consumer|not( yet)? wired|wired to (no|NO)|no read path|NO read path|no (production )?caller|nothing (reads|calls|consumes)|not yet consumed' origin/main -- lib routes server.js | cut -c1-200; echo "--- lines: $(git grep -n -i -E '\bdark\b|no consumer|not( yet)? wired|wired to (no|NO)|no read path|NO read path|no (production )?caller|nothing (reads|calls|consumes)|not yet consumed' origin/main -- lib routes server.js | wc -l | tr -d ' ')"
```

```text
origin/main:lib/call-budget.js:6: * the wire, so no caller keeps its own rule about which models reason.
origin/main:lib/chat-tools.js:34://     cache store was not wired into the catalog, the tool fails cleanly as
origin/main:lib/chat-tools.js:1203: *   `scopeByTier.fleet` entry would have no consumer. Omitting a tier (or the
origin/main:lib/connection-store.js:5: * {@link writeConnection} helper. NO read path is wired to it yet (LIN-3124
origin/main:lib/connection-store.js:224:   * `readConnection*` call. NO production caller — enforced by the static
origin/main:lib/consumer-poll-warning.js:7: * or the proxy response said that no consumer had ever polled that workspace.
origin/main:lib/consumer-poll-warning.js:98: * Distinguishes "never" (no consumer token has ever polled/taken in this
origin/main:lib/consumer-poll-warning.js:109:    return 'No consumer has ever polled this workspace — this dispatch was enqueued but may sit unclaimed until a runner starts.';
origin/main:lib/consumer-poll-warning.js:117:  return `No consumer has polled this workspace since ${consumerLastSeenAt} — this dispatch was enqueued but may sit unclaimed until a runner starts.`;
origin/main:lib/consumer-poll-warning.js:124: * up (or ended), so the warning is `null`, never a stale "no consumer has ever
origin/main:lib/db-indexes.js:416:  // retention policy (explicitly a follow-up, not wired here). Plain, non-TTL.
origin/main:lib/dispatch-entrance.js:2000:// so no caller ever supplies prompt text.
origin/main:lib/dispatch-factory.js:104: * budget: no caller sets it, no prompt or feed shows it.
origin/main:lib/dispatch-fields.js:164:  // createDispatchItem at enqueue time. null means "never" (no consumer token has
origin/main:lib/dispatch-store.js:40: *   consumerLastSeenAt: string, // Consumer poll-recency stamp (LIN-2885): the most recent `lastUsedAt` across the workspace's non-revoked consumer tokens (lib/di
origin/main:lib/dispatch-store.js:3049:   *   (LIN-3161); omitted → unbounded (no caller does this in production)
origin/main:lib/github-install-flow.js:816:      // `installationId` is deliberately NOT wired here — that is LIN-712 (surface 6),
origin/main:lib/harbour-feedback-tokens.js:78:   * 401 Unauthorized — no caller-facing distinction between failure modes
origin/main:lib/home-view.js:420: * last tie-break. `rankKeysOf` reads a root's keys and `compareRank` orders two of them. No caller keeps its own copy.
origin/main:lib/liveness-detectors.js:10: *  - Rule S, dispatcher silent: no consumer poll within NOBODY_LISTENING_MS
origin/main:lib/liveness-detectors.js:131: * Rule S. Fires when no consumer poll is within NOBODY_LISTENING_MS while at
origin/main:lib/observer-pass.js:19: * field; nothing reads it.)
origin/main:lib/observer-state-store.js:79: * `llm-call-log`/`prompt-trace-store.js` ship a `cleanup()` nothing calls)
origin/main:lib/observer-sweep.js:645:    // exists yet (see lib/workspace-store.js — constructed but wired to no
origin/main:lib/openrouter.js:1379: * `streamChatWithTools` unless the caller passed `allowPartial: true`, so no caller can
origin/main:lib/owner-mint-refusals.js:107: * consulting the seam, because the seam folds "no caller identity" into
origin/main:lib/periodical-runs.js:50: *     production caller today (no caller narrows `historyTtlMs`/`horizonMs`
origin/main:lib/plan-review-round-trips.js:631:  // there is no caller that passes this through unchecked: the only production
origin/main:lib/providers/interface.js:357:   * workspace binding (Linear, Local). Display-only; no consumer this ticket.
origin/main:lib/proxy-instructions.js:731:  → "dispatcher-silent" fires when no consumer has polled for >20 min while a queued/taken item exists; "stopped-or-circular-wait" fires when a parked [pendin
origin/main:lib/proxy-instructions.js:900:  → CONSUMER POLL WARNING (LIN-2885) — "consumerLastSeenAt" is the most recent lastUsedAt across the workspace's non-revoked consumer tokens, stamped once at 
origin/main:lib/proxy-tokens.js:124:   * LIN-3129 A3: a true ES private method, so no caller outside the class can
origin/main:lib/read-horizon.js:97: * bound means the 30-day window (`listInHorizon`). It returns a new `Date` on each call, so no caller can move
origin/main:lib/recommend-recurse.js:6: * resolved entirely server-side, before any dispatch, so no consumer ever receives
origin/main:lib/render-flight-companion.js:225:    // altogether (a caller that has not wired the route's data at all)
origin/main:lib/request-usage-intake.js:167:        // itemId and relabels to its current anchor (LIN-4212). Nothing reads by this stamp.
origin/main:lib/request-usage-loader.js:13: * dependency, the way the founder lookup reaches `collectKpiStats` (LIN-4178): no caller imports the store.
origin/main:lib/request-usage-store.js:5: * the runner and summed at read time by the cost read (piece 4). Nothing reads
origin/main:lib/request-usage-store.js:25: * `anchorOf` and never reads it from the request body). Nothing reads by it. A wake
origin/main:lib/workspace-change-log.js:28: * callback runs, so no caller's fallback write can be reached.
origin/main:lib/workspace-owner.js:16: *   { status: 'not-owner' } — a different account owns it, or no caller account
origin/main:lib/workspace-owner.js:70:  // No caller identity is never the owner (a grant-bearing document with a null
origin/main:lib/workspace-preferences.js:38: *   stored, and nothing reads it. The policy is built in (lib/size-of-move.js); no migration.
origin/main:lib/workspace-registry.js:3: * registry (LIN-3700, step 1 of LIN-3394). Write-only: nothing reads the row
origin/main:lib/workspace-token-refresh.js:496:  // ticket named IS closed — but nothing consumes it to gate expiry
origin/main:lib/workspace.js:411: * LIN-1887 close-out: that explicit-provider arm has no PRODUCTION caller yet —
origin/main:routes/dashboard.js:421:      // Skipped when the reader is not wired (tests, and any deployment without
origin/main:routes/jira-auth.js:420:   * with no Jira binding. It is inert — nothing reads a provider partition whose
origin/main:routes/test.js:95: * @param {Object|null} [options.commentDedupe] - In-process comment dedupe cache (LIN-3198 reset seam), or null when not wired
origin/main:routes/test.js:663:      if (!taskShareCollection) return res.status(500).json({ error: 'taskShareCollection not wired' })
origin/main:routes/test.js:675:      if (!kpiDailyRollupCollection) return res.status(500).json({ error: 'kpiDailyRollupCollection not wired' })
origin/main:routes/test.js:697:      if (!kpiDailyRollupCollection) return res.status(500).json({ error: 'kpiDailyRollupCollection not wired' })
origin/main:routes/test.js:938:  // first assertion. Resetting state must drop this too. No-op if not wired.
origin/main:routes/test.js:960:  // one worker cannot change another worker's assertion. No-op if not wired.
origin/main:routes/test.js:1508:      if (!localStore) throw new Error('localStore not wired into test routes');
origin/main:server.js:366:// is safe because nothing calls them until the server is handling requests.
origin/main:server.js:805:// the shared writeConnection helper; no read path wired yet (LIN-3124 owns the
--- lines: 57
```

### Q9. C9 Arm B (run 4 Q25 patterns, verbatim) at HEAD

- run at: `2026-11-10T11:51:38Z` · LinearViewer `9cf51ef72` · simple-dispatcher `5d8489e`

```bash
cnt(){ git grep -n "$@" origin/main -- lib routes server.js | wc -l | tr -d ' '; }; echo "literal cs $(cnt -E '(once|until|pending|awaiting) LIN-[0-9]+') | literal -i $(cnt -i -E '(once|until|pending|awaiting) LIN-[0-9]+') | wider A $(cnt -i -E '(once|until|pending|awaiting)[^.]{0,60}LIN-[0-9]+') | wider B $(cnt -i -E '(once|until|pending|awaiting|blocked on|not yet landed|lands)[^.]{0,80}LIN-[0-9]+')"; git grep -n -i -E '(once|until|pending|awaiting) LIN-[0-9]+' origin/main -- lib routes server.js | cut -c1-180
```

```text
literal cs 8 | literal -i 12 | wider A 73 | wider B 80
origin/main:lib/db-indexes.js:687:    reason: 'kept until LIN-4217 retires it: the lineage lookup LIN-4198 first ran; the read now runs on {urlKey, itemId} (LIN-4212)'
origin/main:lib/dispatch-store.js:2002:   *   `cancelled` / `expired`). Until LIN-2079 status was only ever a JS filter
origin/main:lib/effort-readout.js:89:// task-phase kinds as orchestration overhead (`bug` did, until LIN-1653 mapped it).
origin/main:lib/errors.js:440: * strictly more informative when it exists. (Until LIN-2363 the stated reason was
origin/main:lib/expire-ownerless-dispatch-tokens.js:4: * Until LIN-3618 nothing set `expiresAt`, so every dispatch token was permanent,
origin/main:lib/pricing-conformance-sweep.js:9: * Until LIN-4358 the invariant was "every hand-typed `MODEL_PRICING` row matches the
origin/main:lib/providers/interface.js:331:   *   until LIN-2819. A provider with no `entryCta` renders bind-only whatever
origin/main:lib/providers/jira/index.js:1398:   * Flip `newWorkspaceVerb: true` once LIN-2819 makes the route mint fresh.
origin/main:lib/proxy-instructions.js:991:  → Success: { "success": true, "entry": {...} } (the log entry). A 500 with code LOG_WRITE_FAILED means the change landed but its log ent
origin/main:lib/render-landing.js:58: * `STAGE_LABELS` map. Family names are typed as a fallback until LIN-3952 owns
origin/main:lib/workspace.js:96:// once LIN-2018 remaps Jira team ids to real project keys) with a membership
origin/main:routes/proxy.js:543:        // both 401 and were, until LIN-1985, distinguishable ONLY in Harbour's
```

### Q10. C9 member presence (run 4's 19 definite) and retirement provenance

- run at: `2026-11-10T11:51:38Z` · LinearViewer `9cf51ef72` · simple-dispatcher `5d8489e`

```bash
for c in lib/account-store.js:43 lib/account-workspace-store.js:28 lib/connection-store.js:5 lib/connection-store.js:60 lib/connection-store.js:71 lib/credential-invariant-sweep.js:20 lib/dispatch-store.js:583 lib/held-connection-entry.js:2 lib/kpi-daily-rollup.js:11 lib/periodicals.js:92 lib/prompts/collective-participant.js:126 lib/proxy-preamble.js:444 lib/proxy-preamble.js:692 routes/collective.js:116 server.js:696 server.js:705 server.js:4290 lib/effort-readout.js:597 lib/workspace.js:96 lib/agent-turn.js:585; do f=${c%%:*}; n=${c##*:}; old=$(git show c5694b68:$f | sed -n ${n}p | sed 's/^[[:space:]]*//'); hit=$(git show origin/main:$f | grep -n -F -- "$old" | head -1 | cut -d: -f1); echo "$c -> ${hit:-GONE}"; done; echo '--- provenance'; for pair in 'lib/account-store.js|wired to NO route' 'lib/held-connection-entry.js|dark: no consumer' 'lib/effort-readout.js|does not yet report a realised' 'lib/agent-turn.js|boot once LIN-2622'; do f=${pair%%|*}; s=${pair#*|}; echo "$f: $(git log --format='%h %s' -S"$s" c5694b68..origin/main -- $f | head -1 | cut -c1-90)"; done
```

```text
lib/account-store.js:43 -> GONE
lib/account-workspace-store.js:28 -> GONE
lib/connection-store.js:5 -> 5
lib/connection-store.js:60 -> GONE
lib/connection-store.js:71 -> GONE
lib/credential-invariant-sweep.js:20 -> GONE
lib/dispatch-store.js:583 -> GONE
lib/held-connection-entry.js:2 -> GONE
lib/kpi-daily-rollup.js:11 -> GONE
lib/periodicals.js:92 -> GONE
lib/prompts/collective-participant.js:126 -> GONE
lib/proxy-preamble.js:444 -> GONE
lib/proxy-preamble.js:692 -> GONE
routes/collective.js:116 -> GONE
server.js:696 -> GONE
server.js:705 -> 805
server.js:4290 -> 4372
lib/effort-readout.js:597 -> GONE
lib/workspace.js:96 -> 96
lib/agent-turn.js:585 -> GONE
--- provenance
lib/account-store.js: 343d34ec0 LIN-3827: retire stale landing-status comments (#2146)
lib/held-connection-entry.js: 343d34ec0 LIN-3827: retire stale landing-status comments (#2146)
lib/effort-readout.js: 8938a7ae0 LIN-2683: empty effort caption says what is true, not LIN-2567's status (#2208)
lib/agent-turn.js: a896f183b LIN-3779: disable remember on auto-wake and boot turns (#2053)
```

### Q11. C14 Arm 1 (run 4 Q34 regexes, verbatim) over c5694b68..origin/main

- run at: `2026-11-10T11:51:39Z` · LinearViewer `9cf51ef72` · simple-dispatcher `5d8489e`

```bash
python3 -I /private/tmp/claude-504/-Users-autopilot-development-simple-dispatcher-workspaces-032b00de-2bf9-4190-8702-18d08c168be4/032b00de-2bf9-4190-8702-18d08c168be4/scratchpad/scripts/c14.py /Users/autopilot/development/simple-dispatcher-workspaces/032b00de-2bf9-4190-8702-18d08c168be4/LinearViewer c5694b68 origin/main
```

```text
non-merge commits touching lib routes server.js public: 260
subject regex minus exclusion: 8 | body-marker additions: 17 | union: 25
S 722579ac0 2026-11-08 LIN-4358: area reads' leftovers noted; two one-line fixes; allowlist comment states John's ruling (#2373)
S 400d7890e 2026-11-08 LIN-4383 follow-up: one prefix for a degraded release; three Waiting entries from the operator's area read
S eb97e9968 2026-10-24 LIN-3857: effort is reported, not dropped, when the harness in force is opencode (PR 3/3) (#2101)
S 0e6cd32e1 2026-10-24 LIN-3857: runner kit posts a dropped subagent model/effort to the item; fable stays unmapped pending a recorded run (#2100)
S 48ae8d1dc 2026-10-24 LIN-3849: e2e seed claims ownership, queueToken seed, fix specs found by CI
S cada192e0 2026-10-23 LIN-3798: fix the two causes behind retry-hidden dispatch e2e failures (#2056)
S 9aa68bb82 2026-10-23 LIN-3795: prefix minted Harbour tokens; mask bare on public /t/ pages (#2055)
S 2a26c7b14 2026-10-23 LIN-3279: simple starter tickets (labelled fix ideas, stricter research/design skip guards) (#2038)
B b41f99ced 2026-11-08 LIN-4379: the area notes pointer asks the work to cite a note entry it used (beat 3/4)
B 526bca66c 2026-11-08 LIN-4371: area notes (1/3, LinearViewer): product-owned area registry, notes with guard test, seeds, grounding pointer (#2357)
B 9c2a378a0 2026-11-07 LIN-4367: simplify what PR #2351 left around the cut rule (size of the move 1/4) (#2354)
B 069585bb0 2026-11-05 LIN-4269: fake-DOM move: client suites onto loadWorld (census 55 -> 46) (#2306)
B 473cc865e 2026-11-05 LIN-4276: one posting-key list and one dispatch order in /cost (#2300)
B 6ff38cf5c 2026-11-05 LIN-4263: /cost reports each dispatch's own model and tokens inside its lineage (#2295)
B 00c6261b5 2026-11-03 LIN-4110: a reseed starts the worker key's held task facts over (#2255)
B 300c811fa 2026-11-03 LIN-4106: the opened task and the task page say one state, in one line (#2254)
B c3031ccc5 2026-10-31 LIN-1653: bucket bug and guard every prompt template against drift (#2218)
B 74ad4f4c9 2026-10-26 LIN-3975: task page moves the task on, stages link to runs, quiet empty brief/recap, task chat fold (PRs 2 and 3) (#2169)
B 273385fcf 2026-10-26 LIN-3977: Live Console lanes say what they are, lead to their runs, and leave experimental (#2164)
B c93e2d41b 2026-10-26 LIN-3980: Landing: say plainly what Harbour is, keep the glimpses true, and carry the look into sign-in (#2161)
B a444390bc 2026-10-25 LIN-3968: Home polish — style the opened task, offer the failed stage again, one-row stage strip, plain copy-first wording (#2157)
B 8cca0193b 2026-10-25 LIN-3906: stage selector: an approve means close-out; one PR in ordered commits is not a breakdown (#2156)
B d0b6aa007 2026-10-25 LIN-3907: one feedback image policy; the 413 arm is reachable (#2127)
B 4c36d557f 2026-10-25 LIN-3873: pin /api/image's missing-url, https-only, .., unparsable-URL, redirect and 10 MB guards (#2121)
B f6e6a0233 2026-10-24 LIN-3903: a post-deploy check close-out cannot run never holds the close; any DECISION: asks for every fact in one ruling (#2109)
```

### Q12. Citation re-points (strict + paragraph-local bare), content match, hand overlay

- run at: `2026-11-10T11:51:39Z` · LinearViewer `9cf51ef72` · simple-dispatcher `5d8489e`

```bash
python3 -I /private/tmp/claude-504/-Users-autopilot-development-simple-dispatcher-workspaces-032b00de-2bf9-4190-8702-18d08c168be4/032b00de-2bf9-4190-8702-18d08c168be4/scratchpad/scripts/cites.py /Users/autopilot/development/simple-dispatcher-workspaces/032b00de-2bf9-4190-8702-18d08c168be4/LinearViewer /Users/autopilot/development/simple-dispatcher-workspaces/032b00de-2bf9-4190-8702-18d08c168be4/LinearViewer/../simple-dispatcher /private/tmp/claude-504/-Users-autopilot-development-simple-dispatcher-workspaces-032b00de-2bf9-4190-8702-18d08c168be4/032b00de-2bf9-4190-8702-18d08c168be4/scratchpad/out/citation-repoints.csv && python3 -I /private/tmp/claude-504/-Users-autopilot-development-simple-dispatcher-workspaces-032b00de-2bf9-4190-8702-18d08c168be4/032b00de-2bf9-4190-8702-18d08c168be4/scratchpad/scripts/cites_resolve.py /private/tmp/claude-504/-Users-autopilot-development-simple-dispatcher-workspaces-032b00de-2bf9-4190-8702-18d08c168be4/032b00de-2bf9-4190-8702-18d08c168be4/scratchpad/out/citation-repoints.csv; echo exit=$?
```

```text
citations (groups): 264 | rows (per first line): 291
Counter({'MOVED': 149, 'UNCHANGED-FILE': 50, 'SAME-LINE': 36, 'MOVED-NEAREST': 31, 'CONTENT-GONE': 16, 'UNRESOLVED-PATH': 8, 'TRIVIAL-LINE': 1})
distinct strictly-cited code files: 91
of which changed since pin: 69
workspace-api.js anchors: 20 [41, 815, 1738, 2938, 2944, 3159, 3259, 3343, 3384, 3391, 3410, 3440, 3451, 3455, 3521, 3619, 3655, 3721, 3744, 3759]
Counter({'MOVED': 180, 'PASS': 86, 'MOVED-BY-HAND': 13, 'RETIRED': 6, 'REVERSED': 4, 'RULE-FALSE-POSITIVE': 1, 'SAME-LINE-BY-HAND': 1})
unresolved [] stale overlay keys []
exit=0
```

### Q13. Run-4 parse (52 rows, R1-R17; incomplete parse exits 1)

- run at: `2026-11-10T11:51:52Z` · LinearViewer `9cf51ef72` · simple-dispatcher `5d8489e`

```bash
python3 -I /private/tmp/claude-504/-Users-autopilot-development-simple-dispatcher-workspaces-032b00de-2bf9-4190-8702-18d08c168be4/032b00de-2bf9-4190-8702-18d08c168be4/scratchpad/scripts/run4.py /Users/autopilot/development/simple-dispatcher-workspaces/032b00de-2bf9-4190-8702-18d08c168be4/LinearViewer /private/tmp/claude-504/-Users-autopilot-development-simple-dispatcher-workspaces-032b00de-2bf9-4190-8702-18d08c168be4/032b00de-2bf9-4190-8702-18d08c168be4/scratchpad/out/run4-ledger.json; echo exit=$?
```

```text
rows 52 {'MOD': 21, 'API': 10, 'FLOW': 20, 'META': 1} recs 17 ['R7', 'R13', 'R1', 'R14', 'R2', 'R9', 'R16', 'R15', 'R3', 'R12', 'R8', 'R6', 'R11', 'R17', 'R5', 'R10', 'R4']
exit=0
```

### Q14. Carried-recommendation probes (R2, R8, R9, R11, R13, R14, R15, R17, R5, R10)

- run at: `2026-11-10T11:51:52Z` · LinearViewer `9cf51ef72` · simple-dispatcher `5d8489e`

```bash
echo '--- R2'; grep -n silentSince lib/dispatch-store.js | head -3; git grep -n silentSince origin/main -- lib routes server.js ':!lib/dispatch-store.js' | cut -c1-120; echo '--- R9'; grep -n 'function formatDispatchWatch' routes/proxy-dispatch.js; grep -n periodicalId routes/proxy-dispatch.js | cut -c1-120; echo '--- R8'; git grep -l observer-efficacy-signal origin/main -- lib routes server.js; grep -n '^export' lib/workspace-registry.js; git grep -l 'workspace-registry.js' origin/main -- lib routes server.js | wc -l; echo '--- R11'; git grep -n -A1 'scheduler.register(' origin/main -- server.js | grep name: ; git grep -n 'setInterval(' origin/main -- server.js | cut -c1-130; echo '--- R13'; grep -n OwnerCredentialStore server.js; echo '--- R14'; grep -n CONTRACT_SHA256 tests/unit/runner-kit-contract.test.js | head -2 | cut -c1-120; grep -n -E 'FIXTURE_SHA256 =|LV_COMMIT =' /Users/autopilot/development/simple-dispatcher-workspaces/032b00de-2bf9-4190-8702-18d08c168be4/LinearViewer/../simple-dispatcher/test/runner-contract.test.js; cmp lib/runner-kit/contract.json /Users/autopilot/development/simple-dispatcher-workspaces/032b00de-2bf9-4190-8702-18d08c168be4/LinearViewer/../simple-dispatcher/test/fixtures/runner-contract.json && echo byte-identical; ls .github/workflows /Users/autopilot/development/simple-dispatcher-workspaces/032b00de-2bf9-4190-8702-18d08c168be4/LinearViewer/../simple-dispatcher/.github/workflows; echo '--- R15'; git grep -n authStoppedWorkspaces origin/main -- lib routes public server.js | cut -c1-100; echo '--- R17'; grep -n -i alarm lib/hourly-cleanup.js | wc -l; sed -n '276p;285p' lib/liveness-alarm-store.js; echo '--- R5'; grep -n 'export function resolvePrecompute' lib/run-paragraph-hook.js; echo '--- R10 (run 3 query, non-review production hits)'; git grep -n -E 'LIN-2995|yet honor' origin/main -- 'lib/*.js' 'routes/*.js' 'public/*.js' server.js | cut -c1-120; echo '--- usage wiring (SD)'; grep -n 'request-records\|request-usage' /Users/autopilot/development/simple-dispatcher-workspaces/032b00de-2bf9-4190-8702-18d08c168be4/LinearViewer/../simple-dispatcher/opencode-runner.js /Users/autopilot/development/simple-dispatcher-workspaces/032b00de-2bf9-4190-8702-18d08c168be4/LinearViewer/../simple-dispatcher/hook.js /Users/autopilot/development/simple-dispatcher-workspaces/032b00de-2bf9-4190-8702-18d08c168be4/LinearViewer/../simple-dispatcher/dispatcher.js /Users/autopilot/development/simple-dispatcher-workspaces/032b00de-2bf9-4190-8702-18d08c168be4/LinearViewer/../simple-dispatcher/reapers.js | cut -c1-110; grep -n 'WORKER_USAGE_RELAY = ' /Users/autopilot/development/simple-dispatcher-workspaces/032b00de-2bf9-4190-8702-18d08c168be4/LinearViewer/../simple-dispatcher/config.js; grep -n "router.post('/api/dispatch/usage" routes/dispatch.js | cut -c1-90
```

```text
--- R2
2005:   * @param {Date} [options.silentSince] - Restrict to rows with NO feedback entry
2109:    const { limit, offset = 0, issueIdentifier, since, sessionId, sessionGroupId, rootItemId, followUpTo, status, silentSince, periodicalEvidenceRow, withLineage } = opts;
2127:      if (silentSince) query.$nor = [{ 'feedback.timestamp': { $gte: silentSince } }];
origin/main:lib/db-indexes.js:195:    // silentSince}` diagnostic read is a RESIDUAL filter on top of this index —
origin/main:lib/db-indexes.js:201:    reason: 'bounded newest-first history read — index-backs the sort+limit pushed int
--- R9
57:function formatDispatchWatch(item, meta = null, wakeShadow = null, liveConsumerLastSeenAt = null) {
272:   * `periodicalId` (LIN-1825/LIN-2385): optional periodical-template join key,
301:   * or the "+ Autopilot" variant when `autopilot: true`), stamps `periodicalId` so GET /periodicals
311:    await enterPeriodicalMint({ ...lane, req, res, endpoint: '/api/proxy/periodicals/:id/mint', periodicalId: req.pa
--- R8
origin/main:lib/observer-efficacy-signal.js
origin/main:lib/observer-shadow-log.js
19:export async function recordWorkspace(workspaceStore, workspace, { logger = console } = {}) {
      10
--- R11
origin/main:server.js-902-  name: 'observer-sweep',
origin/main:server.js-969-  name: 'observer-pass',
origin/main:server.js-999-  name: 'credential-invariant-sweep',
origin/main:server.js-1042-  name: 'pricing-conformance-sweep',
origin/main:server.js-1072-  name: 'liveness-alarm-sweep',
origin/main:server.js-1104-  name: 'ci-wake-sweep',
origin/main:server.js-1160-  name: 'kpi-daily-rollup',
origin/main:server.js:1034:  setInterval(() => { getModelCatalog().catch(() => {}) }, CATALOG_CACHE_TTL_MS / 2).unref()
origin/main:server.js:4696:  cleanupTimer = setInterval(runHourlyCleanup, CLEANUP_INTERVAL_MS)
--- R13
67:import { OwnerCredentialStore } from './lib/owner-credential-store.js'
801:const ownerCredentialStore = new OwnerCredentialStore({ collection: ownerCredentialsCollection })
--- R14
48:const CONTRACT_SHA256 = '602ab014062857bfba3e9aa543088472c3ba5dbc7cb0673da909e67ed727eb40';
330:    assert.equal(sha, CONTRACT_SHA256,
48:const LV_COMMIT = '3d2046ac80f02f31313d8aa7f1f0e22cbe483716'; // LinearViewer #2369 merge
50:const FIXTURE_SHA256 = '602ab014062857bfba3e9aa543088472c3ba5dbc7cb0673da909e67ed727eb40';
byte-identical
.github/workflows:
secret-scan-scheduled.yml
test.yml

<LinearViewer>/../simple-dispatcher/.github/workflows:
ci.yml
--- R15
origin/main:lib/consumer-heartbeat.js:34:  'authStoppedWorkspaces'
origin/main:lib/consumer-heartbeat.js:87:  authStoppedWorkspaces: (v) => Array.isArray(v) && v.lengt
--- R17
       0
   * Retention-agnostic cleanup hook used by the server's periodic cleanup
  async cleanup({ now = new Date(), retainMs = 30 * 24 * 60 * 60 * 1000 } = {}) {
--- R5
35:export function resolvePrecomputeCredential(env = process.env) {
--- R10 (run 3 query, non-review production hits)
origin/main:public/dispatch.js:772:// stored halt (LIN-2995, `lib/runner-kit/runner.mjs` `haltAction`) but only on
--- usage wiring (SD)
<LinearViewer>/..
<LinearViewer>/..
<LinearViewer>/..
<LinearViewer>/..
<LinearViewer>/..
<LinearViewer>/..
<LinearViewer>/..
<LinearViewer>/..
1345:const WORKER_USAGE_RELAY = envFlag('SD_WORKER_USAGE_RELAY', true);
1671:  router.post('/api/dispatch/usage/:itemId', feedbackLimiter, authenticateDispatchTok
```

### Q17. Configuration surface (added after the second read): feature switches at both pins, dispatch-switch references, consumer default flips

- run at: `2026-11-10T11:51:53Z` · LinearViewer `9cf51ef72` · simple-dispatcher `5d8489e`

```bash
for r in c5694b68 origin/main; do git show $r:lib/feature-defaults.js > /tmp/fd-$$.mjs; node -e "import('file:///tmp/fd-$$.mjs').then(m=>console.log('$r FEATURES keys:',Object.keys(m.FEATURES).length,Object.values(m.FEATURES).join(',')))"; done; rm -f /tmp/fd-$$.mjs; for c in d738a7678 00c3e081d 2c8366760 e336733ee; do git log -1 --format='%h %ad %s' --date=short $c | cut -c1-120; done; echo "FEATURES.DISPATCH refs: $(git grep -c FEATURES.DISPATCH c5694b68 -- lib routes server.js | wc -l | tr -d ' ') -> $(git grep -c FEATURES.DISPATCH origin/main -- lib routes server.js | wc -l | tr -d ' ') files"; git grep -l -E 'featureFlags|getFeatureFlags' origin/main -- 'lib/render*.js' 'lib/components/*.js' lib/run-controls.js | wc -l; grep -n -E "envFlag\('SD_(ASSISTANT_TEXT|WORKER_USAGE)_RELAY'" /Users/autopilot/development/simple-dispatcher-workspaces/032b00de-2bf9-4190-8702-18d08c168be4/LinearViewer/../simple-dispatcher/config.js; git -C /Users/autopilot/development/simple-dispatcher-workspaces/032b00de-2bf9-4190-8702-18d08c168be4/LinearViewer/../simple-dispatcher log -1 --format='%h %ad %s' --date=short a7e5173
```

```text
c5694b68 FEATURES keys: 21 linearMcp,dispatch,aiRecommendations,promptButtons,codeReview,codeReviewSelf,codeReviewCicd,codeReviewPr,proxy,roadmap,collective,taskChat,ship,nextRun,flightCompanion,passagePlanner,shipBiscuit,liveConsole,shipJourney,feedbackWidget,feedbackTriage
origin/main FEATURES keys: 10 roadmap,collective,taskChat,ship,flightCompanion,passagePlanner,shipBiscuit,liveConsole,shipJourney,feedbackWidget
d738a7678 2026-10-24 LIN-3848: remove the nine settings switches that do nothing or are superseded (#2082)
00c3e081d 2026-10-24 LIN-3849: read derived runControls/runSetup in renderers and client; remove proxy/dispatch flags
2c8366760 2026-10-25 LIN-3912: retire the Next run page, its flag and job, and delete prototypes/ (#2115)
e336733ee 2026-10-24 LIN-3849: e2e — member sees no halt buttons; the server still refuses a direct halt
FEATURES.DISPATCH refs: 1 -> 0 files
      34
1316:const ASSISTANT_TEXT_RELAY = envFlag('SD_ASSISTANT_TEXT_RELAY', true);
1345:const WORKER_USAGE_RELAY = envFlag('SD_WORKER_USAGE_RELAY', true);
a7e5173 2026-11-03 LIN-4165: send every assistant text reply to Harbour (relay on by default) (#302)
```

### Q15. Tracker states (workspace API, read 2026-11-10T11:17Z)

```text
LIN-446   Backlog                 Performance: address the un-cached full-workspace fetch across all views (class 
LIN-690   Done         2026-10-30 Unit-test dispatch-tokens store (consumer-auth boundary, cross-workspace isolati
LIN-1040  Backlog                 Add the Reliability / Resilience periodical (failure-mode)
LIN-1041  Backlog                 Add the Observability / Operability periodical (can we see it)
LIN-1410  Backlog                 Harbour: stop appending the OpenCode bootstrap in prompt text — deliver structur
LIN-1629  Todo                    Path P1.2 · Change-gated due-ness probe for periodicals
LIN-1933  Todo                    Periodicals: target-repo selection at dispatch (one / many / all → per-repo fan-
LIN-2120  Backlog                 Dispatch listing is structurally blind past its newest-N window — general pagina
LIN-2150  Todo                    Migration path off per-workspace credentials (urlKey preservation is the real co
LIN-2246  Done         2026-10-24 Decompose routes/workspace-api.js (4,388 lines, 36 endpoints, 24 in-closure help
LIN-2328  Todo                    Watch the first real periodical run after LIN-2323: live-mint hop, both report-g
LIN-2398  Backlog                 Decompose lib/dispatch-store.js (2,178 lines, 31 methods; addFeedback 288 lines 
LIN-2493  Backlog                 Harbour: workspace-scoped credential-health surfaces are blind to a provider-lan
LIN-2576  Todo                    Operating model · P1.5 · Widen the LIN-694 report gate to the session-auth issue
LIN-2683  Done         2026-10-31 Effort read-out: the empty-column caption still says LIN-2567 is in progress
LIN-2846  Backlog                 Two dispatch seams still stamp periodicalId caller-supplied only, so their perio
LIN-3074  Backlog                 LinearViewer: halt copy and runbook still say the runner does not honor a halt (
LIN-3394  Backlog                 urlKey global uniqueness backstop: workspaces as the registry, a unique index, a
LIN-3417  Backlog                 Spike: credential-level merge enforcement (a separate worker identity plus requi
LIN-3422  Backlog                 Spend caps: precompute bills the operator's key outside every cap (D4), the 50/h
LIN-3544  Backlog                 Decompose simple-dispatcher reapers.js runStallFailsafe (950-line plan/apply/log
LIN-3546  Backlog                 Decompose public/prompt-section.js init (822-line closure, doubled since 09-26)
LIN-3617  Done         2026-10-19 Logout leaves owner-away runners and /t/ links working
LIN-3618  Done         2026-10-19 Give new dispatch tokens a 90-day lifetime and expire the ownerless production t
LIN-3619  Done         2026-10-19 Involuntary workspace removals and single-binding unlink do not revoke tokens or
LIN-3642  Done         2026-10-18 Linear OAuth callback accepts a missing `state` (undefined === undefined): login
LIN-3649  Backlog                 Close-out readiness stage on the proxy, recommend and kickoff dispatch lanes (ad
LIN-3741  Backlog                 Decompose lib/runner-kit/runner.mjs runCommand + waitLoop (characterization test
LIN-3742  Done         2026-10-24 Rebuild: design-first rebuild of routes/dashboard.js createDashboardRoutes into 
LIN-3745  Done         2026-10-23 Docs: LIN-3300 residue — 8 live sites still describe the deleted meta-prompt / t
LIN-3771  Done         2026-10-23 Email sign-in is being used by a form-spam bot: rate-limit and challenge POST /a
LIN-3779  Done         2026-10-23 Security [Med]: Flight Companion remember stays on in auto-wake/boot turns, so t
LIN-3787  Done         2026-10-23 Vendored DOMPurify 3.2.4 → 3.4.17 and put vendored client libs under audit cover
LIN-3805  Done         2026-10-23 Dispatch/runner lane: a store fault must answer a retryable 503, never 404, 401 
LIN-3820  Todo                    Every LLM use, classed and routed from one place: design the model, then build i
LIN-3825  Done         2026-10-23 Comprehension-Debt Review (periodical run 4, first since 2026-07-01): did the de
LIN-3827  Done         2026-10-25 Retire stale landing-status comments ("INERT", "no production caller", "later be
LIN-3846  Done         2026-10-24 Settings: one page per area, built from three kinds of row, with Models inside (
LIN-3852  Done         2026-10-24 Model routing · 1 — Jobs: one registry of every LLM use, each with a group and a
LIN-3876  Done         2026-10-24 Move: the issue-write routes (POST /api/comments/:issueId, POST /api/issues, PAT
LIN-3962  Done         2026-10-25 One decision panel for Models and Home: the job's numbers, labelled harness, sug
LIN-4126  Done         2026-11-02 Costs, seed: map how Harbour tracks model usage and cost today, and recommend wh
LIN-4127  Done         2026-11-03 Runner: relay worker usage by default (SD_WORKER_USAGE_RELAY on unless set off)
LIN-4168  Done         2026-11-03 One reset for all of a workspace key's test state
LIN-4195  Done         2026-11-04 Costs rebuild 2: one record per model request, summed
LIN-4202  Done         2026-11-04 Costs rebuild 2 · piece 5: opencode and runner-kit post per-request records
LIN-4203  Done         2026-11-04 Costs rebuild 2 · piece 6: stop posting [usage] snapshots; remove the runner sna
LIN-4217  Backlog                 ensureIndexes has no drop mechanism: retire the request-usage {urlKey, rootItemI
LIN-4263  Done         2026-11-05 /cost reports each session's own model and tokens (a follow-up is not the chain'
LIN-4313  Done         2026-11-06 Proxy: mint a Periodical run by registry id (plain or + Autopilot), as the UI do
LIN-4317  Done         2026-11-06 LIN-4313 tidy-after: one rule for the periodical grant; the gate suites cover th
LIN-4347  Done         2026-11-08 After the merge: read it blind, ask the builder, tidy what it left
LIN-4349  Done         2026-11-08 The Periodicals run when work lands, and feed the look-first step
LIN-4353  Done         2026-11-07 As asked (C): stage prompts judge against the block; preamble, close-out prune, 
LIN-4358  Done         2026-11-08 Models from the catalog, not lists: what Harbour knows about a model comes from 
LIN-4362  Done         2026-11-07 As-asked tidy (C): one owner for the block's words and brief hint, reason commen
LIN-4371  Done         2026-11-08 Area notes (1/3, LinearViewer): product-owned area registry, notes with guard te
LIN-4372  Done         2026-11-08 Area notes (1/3, simple-dispatcher): same docs/areas/ registry, README and guard
LIN-4374  Done         2026-11-08 Review reads the leftovers, close-out writes the notes (3/3), and the post-deplo
LIN-4376  Done         2026-11-08 LIN-4347 tidy-after: one home for each leftover-step rule; the leftover time buc
LIN-4378 read failed
LIN-4379 read failed
LIN-4380 read failed
LIN-4381 read failed
LIN-4382 read failed
LIN-4384 read failed
LIN-4385 read failed
LIN-4389 read failed
LIN-4390 read failed
LIN-4404 read failed
```

### Q16. Generator: validate the ledger, render the report tables, confirm a second run changes nothing

```bash
python3 -I <scratch>/scripts/gen.py docs/reviews/_evidence-2026-11-10-ism/trend-ledger.json docs/reviews/_evidence-2026-11-10-ism/run4-ledger.json docs/reviews/integration-surface-maturity-review-2026-11-10.md --check
```

```text
regeneration diff: NONE
```

## Script sources (full text; not committed)

#### `base.py` (scratch, not committed)

```python
# Usage: python3 -I base.py <LV root> <SD root> <outdir>
# Measures both windows and emits added/deleted/churn lists with area slug and production importers.
import json, re, subprocess, sys, os, csv
LV, SD, OUT = sys.argv[1:4]
LV_BASE, SD_BASE = 'c5694b68', 'bb1da78'
LV_HEAD = subprocess.check_output(['git','-C',LV,'rev-parse','origin/main'],text=True).strip()
SD_HEAD = subprocess.check_output(['git','-C',SD,'rev-parse','origin/main'],text=True).strip()
def git(repo,*a): return subprocess.check_output(['git','-C',repo,*a],text=True)
def areas(repo, ref):
    try: d=json.loads(git(repo,'show',f'{ref}:docs/areas/areas.json'))
    except Exception: return []
    return [(a['slug'],[re.compile(m) for m in a['match']]) for a in d['areas']]
def area_of(ar, path):
    for slug,ms in ar:
        if any(m.search(path) for m in ms): return slug
    return '(none)'
def importers(repo, ref, path):
    """Production importers, resolved by full path: every ESM/CJS specifier ending in the file's basename is
    resolved against its importer's directory and kept only if it equals `path`. For public/ assets (served, not
    imported) a reference is a quoted '/<basename>' string in lib/, routes/ or server.js. Files under tests/,
    scripts/, docs/, experiments/ are not production."""
    base=os.path.basename(path)
    if path.startswith('public/'):
        try: out=git(repo,'grep','-l','-F',"/"+base,ref,'--','lib','routes','server.js')
        except subprocess.CalledProcessError: out=''
        return [l.split(':',1)[1] for l in out.split('\n') if l]
    try: out=git(repo,'grep','-n','-P',r"""['"][^'"]*/"""+re.escape(base)+r"""['"]""",ref,'--')
    except subprocess.CalledProcessError: out=''
    hits=set()
    for l in out.split('\n'):
        if not l: continue
        _,f,_,text=l.split(':',3)
        if re.match(r'^(tests?|scripts|docs|experiments|e2e)/',f) or f==path: continue
        for spec in re.findall(r"""(?:from|import\(|require\()\s*['"]([^'"]+)['"]""",text):
            if spec.startswith('.') and os.path.normpath(os.path.join(os.path.dirname(f),spec))==path: hits.add(f)
    return sorted(hits)
res={'lv_head':LV_HEAD,'sd_head':SD_HEAD}
res['lv_commits']=int(git(LV,'rev-list','--count',f'{LV_BASE}..origin/main'))
res['lv_commits_from_38760071']=int(git(LV,'rev-list','--count','38760071..origin/main'))
res['lv_commits_touching_code']=int(subprocess.check_output(f"git -C {LV} rev-list --count {LV_BASE}..origin/main -- lib routes server.js",shell=True,text=True))
res['sd_commits']=int(git(SD,'rev-list','--count',f'{SD_BASE}..origin/main'))
res['sd_shortstat']=git(SD,'diff','--shortstat',f'{SD_BASE}','origin/main').strip()
ar=areas(LV,'origin/main'); sar=areas(SD,'origin/main')
rows=[]
for st in ('A','D'):
    for p in git(LV,'diff','--no-renames',f'--diff-filter={st}','--name-only',LV_BASE,'origin/main','--','lib','routes','public').split():
        ref = 'origin/main'
        rows.append(dict(repo='LinearViewer',path=p,status=st,area=area_of(ar,p),
                         importers=';'.join(importers(LV,ref,p)) if st=='A' else ''))
# renames check
res['lv_renames']=git(LV,'diff','-M','--diff-filter=R','--name-status',LV_BASE,'origin/main','--','lib','routes','public').strip()
# churn top-25 existing non-test files (commits touching), existing at base
existing=set(git(LV,'ls-tree','-r','--name-only',LV_BASE).split())
cnt={}
for line in git(LV,'log','--format=','--name-only',f'{LV_BASE}..origin/main','--no-merges').split('\n'):
    if line and line in existing and not re.match(r'^(tests?/|docs/|scripts/|experiments/|plans/)',line) and not line.endswith(('.md','package-lock.json')):
        cnt[line]=cnt.get(line,0)+1
churn=sorted(cnt.items(),key=lambda x:-x[1])[:25]
for p,c in churn:
    ns=git(LV,'diff','--numstat',LV_BASE,'origin/main','--',p).split()
    rows.append(dict(repo='LinearViewer',path=p,status=f'M({c} commits,+{ns[0]}/-{ns[1]})',area=area_of(ar,p),importers=''))
# SD: every changed non-test file
for l in git(SD,'diff','--no-renames','--name-status',SD_BASE,'origin/main').split('\n'):
    if not l: continue
    st,p=l.split('\t',1)
    if re.match(r'^test/',p): continue
    imps=''
    if st=='A' and p.endswith('.js') and '/' not in p:
        try: out=git(SD,'grep','-l','-P',r"""(from|require\()\s*['"]\./"""+re.escape(p[:-3])+r"""(\.js)?['"]""",'origin/main','--')
        except subprocess.CalledProcessError: out=''
        imps=';'.join(x.split(':',1)[1] for x in out.split() if not x.split(':',1)[1].startswith('test/'))
    ns=git(SD,'diff','--numstat',SD_BASE,'origin/main','--',p).split()
    rows.append(dict(repo='simple-dispatcher',path=p,status=f'{st}(+{ns[0]}/-{ns[1]})',area=area_of(sar,p),importers=imps))
res['sd_test_added']=len([l for l in git(SD,'diff','--diff-filter=A','--name-only',SD_BASE,'origin/main','--','test').split() if l])
json.dump(rows,open(f'{OUT}/base-rows.json','w'),indent=1)
json.dump(res,open(f'{OUT}/base-summary.json','w'),indent=1)
from collections import Counter
print(json.dumps(res,indent=1))
print(Counter((r['repo'],r['status'][0]) for r in rows))
print('LV added by area',Counter(r['area'] for r in rows if r['repo']=='LinearViewer' and r['status']=='A'))
```

#### `dispose.py` (scratch, not committed)

```python
# Usage: python3 -I dispose.py <base-rows.json> <out.csv> — joins the measured rows with the review's dispositions; exits 1 unless every row has one and the counts balance.
import json, sys, csv, re
rows = json.load(open(sys.argv[1]))
NEW = {'mod-model-routing','flow-area-notes-leftover','flow-as-asked-seal'}
# ---- LinearViewer added (107): path -> (disposition, id or reason)
A = {}
def put(id_, *paths):
    for p in paths: A[p] = id_
put('flow-as-asked-seal','lib/as-asked.js','lib/as-asked-seal.js')
put('flow-area-notes-leftover','lib/dispatch-leftover.js','lib/dispatch-leftover-hook.js','lib/prompts/leftover-words.js','lib/prompts/area-registry-path.js')
put('mod-model-routing',*[f'lib/model-routing{s}.js' for s in ['','-edit','-harnesses','-history','-spend','-store','-summary','-validate']],
    'lib/llm-jobs.js','routes/proxy-model-routing.js','routes/settings-model.js','lib/components/decision-panel.js','lib/components/model-change-lines.js',
    'lib/components/dispatch-no-job.js','public/decision-panel.js','public/settings-models.js','lib/render-settings-models.js')
put('flow-cost-telemetry','lib/cost-format.js','lib/cost-read.js','lib/request-usage-fold.js','lib/request-usage-intake.js','lib/request-usage-loader.js',
    'lib/request-usage-store.js','lib/request-usage-vocabulary.js','lib/row-usage.js','lib/task-cost-read.js','lib/usage-snapshot-intake.js','public/cost-format.js','lib/catalog-rate.js')
put('api-openrouter','lib/call-budget.js')
put('mod-prompt-template-system','lib/size-of-move.js','lib/stage-writes.js','lib/recommendation-look-first.js','lib/prompts/autopilot-precedence.js')
put('flow-run-evidence-closeout','lib/close-out-merges.js','routes/workspace-api-run-evidence.js')
put('flow-dispatch-halt','lib/components/halt-controls.js')
put('flow-dispatch-lifecycle','lib/dispatch-lineage-status.js','lib/lineage-membership.js','lib/dispatch-session-read.js')
put('flow-account-connection-workspace-credential','lib/connection-secondary-remint.js')
put('flow-bootstrap-token-exchange','lib/harbour-token-format.js')
put('flow-operator-decisions','lib/ruling-settled.js','lib/ruling-standing.js','lib/live-anchor.js','routes/dashboard-rulings.js','routes/workspace-api-scan.js')
put('mod-task-page','lib/task-state.js','lib/subtree-index.js','lib/task-facts-holder.js','public/stage-track.css','routes/dashboard-session-state.js','lib/components/time.js')
put('mod-roadmap-trajectory','lib/task-order.js')
put('mod-kpi-audit','lib/workspace-kpis-cache.js','routes/dashboard-kpis.js','routes/workspace-api-audit.js')
put('mod-effort-readout','routes/dashboard-effort.js')
put('mod-library','routes/getting-started.js','lib/prompts/agent-onboarding.js')
put('mod-provider-abstraction','lib/workspace-issues-memo.js')
put('flow-workspace-lifecycle','lib/workspace-change-log.js')
put('mod-task-edit','routes/workspace-api-issue-write.js','routes/workspace-api-issue-read.js')
put('mod-task-create','routes/workspace-api-feedback.js')
put('mod-render-layer','lib/components/head-meta.js','lib/components/plain-page.js','lib/components/settings-ask.js','lib/components/settings-frame.js',
    'lib/components/settings-group.js','lib/components/settings-key-row.js','lib/components/settings-row.js','lib/components/settings-spend-bar.js','lib/components/tabs.js',
    'lib/render-settings-workspace.js','lib/render-settings-you.js','lib/settings-areas.js','lib/settings-copy-first-card.js','lib/settings-keys.js','routes/settings.js',
    'lib/home-pipeline.js','lib/home-row-states.js','lib/home-rows.js','lib/home-view.js','lib/waiting-section.js','lib/dashboard-refresh.js','public/home-placement.js',
    'lib/task-board-view.js','lib/run-controls.js','lib/vendor-assets.js','public/landing-copy.js','public/logo/og-image.png','public/run-control.css',
    'routes/dashboard-drilldown.js','routes/dashboard-feed.js','routes/dashboard-summaries.js')
EXCL = {'lib/pipeline-churn.js':'scripts-only analysis by design (scripts/pipeline-churn.mjs; header :3-8)',
        'lib/sample-data/fixture-parent.js':'test-mode / sample data (run-4 rule, cf. lib/sample-data/*)',
        'lib/key-state.js':'test-state registry: resets per-key holders on seed seams (header :1-5, LIN-4168); no production behaviour; new-FLOW test: owned by this module, fails',
        'lib/key-state-holders.js':'test-state registry (CLAUDE.md E2E pattern; tests/unit/key-state-census.test.js)',
        'routes/workspace-api-steps.js':'pure shared helpers of the workspace-api routers (header :1-8); behaviour lives in the routers it serves'}
# ---- deleted (10)
D = {'lib/next-run.js':'retired evidence (next-run lane retired; no run-4 id or cite depended on it)',
     'lib/render-next-run.js':'retired evidence (next-run lane)','routes/next-run.js':'retired evidence (next-run lane)',
     'public/next-run.js':'retired evidence (next-run lane)','public/next-run.css':'retired evidence (next-run lane)',
     'lib/task-cost.js':'flow-cost-telemetry definition re-pointed: replaced by request-usage-* / cost-read / row-usage (LIN-4195)',
     'lib/plan-fee-config.js':'flow-cost-telemetry definition re-pointed: plan-fee lane removed with the costs rebuild',
     'public/chart.umd.min.js':'moved: served from node_modules at the same URL by lib/vendor-assets.js (LIN-3787)',
     'public/marked.min.js':'moved: lib/vendor-assets.js (LIN-3787)','public/purify.min.js':'moved: lib/vendor-assets.js (LIN-3787)'}
# ---- LV churn top-25 -> carried id (status changed unless noted)
M = {'server.js':'wiring; mod-scheduler (R11 intervals) + every new mount','public/llms.txt':'mod-render-layer (agent-facing DOM doc)',
     'lib/proxy-instructions.js':'api-workspace-proxy','lib/dispatch-store.js':'mod-dispatch-queue (+R2, API Quality H1, D&F H1)',
     'public/prompt-section.js':'mod-task-page (Code Quality F-prompt-section HIGH)','lib/render.js':'mod-render-layer','public/style.css':'mod-render-layer',
     'routes/proxy-compute.js':'api-workspace-proxy','lib/task-page-loader.js':'mod-task-page','lib/prompt-template-defs.js':'mod-prompt-template-system',
     'lib/dispatch-entrance.js':'mod-dispatch-entrance','routes/workspace-api.js':'split 3,782 -> 916 lines + 7 new siblings; R7 #2/#3, R1, R4, R5 cites re-pointed',
     'routes/proxy.js':'api-workspace-proxy','public/common.js':'mod-render-layer','lib/render-styleguide.js':'mod-render-layer','routes/dispatch.js':'api-dispatch (+usage intake route)',
     'lib/render-task-page.js':'mod-task-page','public/app.js':'mod-render-layer','lib/periodicals.js':'mod-periodicals + META (R18 template drift)',
     'lib/db-indexes.js':'api-mongodb-storage','lib/run-view.js':'mod-task-page','lib/dispatch-factory.js':'mod-dispatch-entrance (+mod-model-routing resolution)',
     'routes/task-page.js':'mod-task-page','lib/completion-signals.js':'flow-dispatch-lifecycle','routes/test.js':'excluded: test-only routes'}
# ---- simple-dispatcher: every changed non-test file
S = {'request-usage.js':'consumer evidence: flow-cost-telemetry (LIN-4199)','request-usage-flush.js':'consumer evidence: flow-cost-telemetry (producer contract :10-16)',
     'opencode-request-records.js':'consumer evidence: flow-cost-telemetry (LIN-4202)','opencode-runner.js':'consumer evidence: flow-cost-telemetry (:91-93, relayRequestRecords :590) + flow-dispatch-lifecycle',
     'hook.js':'consumer evidence: flow-cost-telemetry (Stop flush :19-20) + flow-dispatch-lifecycle (LIN-4218 Stop relay table)','reapers.js':'consumer evidence: flow-cost-telemetry (detached flush) + flow-dispatch-lifecycle (LIN-3905, LIN-4172)',
     'dispatcher.js':'consumer evidence: flow-cost-telemetry (cancel flush :15) + flow-consumer-liveness (instance guard, LIN-796)','config.js':'consumer evidence: flow-cost-telemetry (WORKER_USAGE_RELAY default on :1345, LIN-4127)',
     'transcript.js':'consumer evidence: flow-cost-telemetry (walkUsage LIN-3229) + api-runner-kit (one DONE: rule, LIN-4385)','feedback.js':'consumer evidence: flow-dispatch-lifecycle (LIN-4199 feedback post)',
     'links.js':'consumer evidence: flow-run-evidence-closeout ([done] url is the session own PR, LIN-4375)','followup.js':'consumer evidence: flow-followup-resume (LIN-4079/4082 CANCELLED resume rules)',
     'queue.js':'consumer evidence: flow-dispatch-lifecycle (LIN-3047 malformed poll body)','heartbeat.js':'consumer evidence: flow-consumer-liveness (LIN-4030)',
     'resource-metrics.js':'consumer-internal (LIN-1819 bounded sink); unscored','instance-guard.js':'consumer evidence: flow-consumer-liveness (one dispatcher per host, LIN-796)',
     'env-flag.js':'consumer-internal (SD_* flag parser, LIN-4182); configuration evidence for flow-cost-telemetry','state-dir.js':'consumer-internal (state dir, LIN-4077); unscored',
     'harbour-token-mcp-server.js':'consumer evidence: flow-bootstrap-token-exchange (broker 429 back-off, LIN-4378) + api-runner-kit contract',
     'harnesses.js':'consumer evidence: mod-model-routing (LIN-3830 resume keeps model/effort; LIN-3857 opencode effort null)','executors.js':'consumer evidence: mod-model-routing (LIN-3857) + consumer-internal (LIN-2469, LIN-4171)',
     'terminal-driver.js':'consumer-internal (LIN-1453 launch diagnosis); unscored','phases.js':'consumer-internal (LIN-4172 reap split); unscored','format.js':'consumer-internal (LIN-2478 log line); unscored',
     'oplog.js':'consumer-internal (env-flag adoption); unscored','state-store.js':'consumer-internal (state dir); unscored','subscription.js':'consumer-internal (state dir); unscored',
     'signal-guard.js':'consumer-internal (LIN-4077 one-line); unscored','watch-restart.sh':'consumer-internal (LIN-796 guard wiring); unscored','e2e-smoke.js':'consumer test harness; unscored',
     'experiments/lin-4171-resume-timing.js':'experiment (LIN-4171 resume re-clone witness); excluded','experiments/lin-4171-resume-witness.js':'experiment (LIN-4171); excluded',
     'docs/areas/README.md':'consumer evidence: flow-area-notes-leftover (LIN-4372; points at Harbour LEFTOVER_RULE, LIN-4385)','docs/areas/areas.json':'consumer evidence: flow-area-notes-leftover (LIN-4372)',
     'docs/areas/launch-and-harnesses.md':'consumer evidence: flow-area-notes-leftover','docs/areas/state-and-config.md':'consumer evidence: flow-area-notes-leftover',
     'docs/areas/stop-hook-and-relay.md':'consumer evidence: flow-area-notes-leftover','docs/areas/test-harnesses.md':'consumer evidence: flow-area-notes-leftover',
     'CLAUDE.md':'consumer docs (area-notes pointer); unscored','README.md':'consumer docs; unscored','package.json':'consumer test scripts (test:baseline); unscored',
     'docs/deployment.md':'consumer docs; unscored','docs/full-system-test-plan.md':'consumer docs; unscored','docs/module-map.md':'consumer docs (names the runner contract, LIN-4378); unscored',
     'docs/session-lifecycle.md':'consumer docs (CANCELLED resume rules); evidence for flow-followup-resume','docs/substrate.md':'consumer docs; unscored','docs/testing-and-ci.md':'consumer docs (heavy-tier harness); unscored'}
out=[]; missing=[]
for r in rows:
    p=r['path']; st=r['status']
    if r['repo']=='LinearViewer' and st=='A':
        if p in A: d=('new id' if A[p] in NEW else 'fold'); tgt=A[p]
        elif p in EXCL: d='exclude'; tgt=EXCL[p]
        else: missing.append(p); continue
    elif r['repo']=='LinearViewer' and st=='D':
        if p not in D: missing.append(p); continue
        d='deleted'; tgt=D[p]
    elif r['repo']=='LinearViewer':
        if p not in M: missing.append(p); continue
        d='modified (churn top-25)'; tgt=M[p]
    else:
        if p not in S: missing.append(p); continue
        d='consumer'; tgt=S[p]
    out.append(dict(repo=r['repo'],path=p,git_status=st,area=r['area'],production_importers=r['importers'],disposition=d,target=tgt))
from collections import Counter
c=Counter((o['repo'],o['disposition']) for o in out)
lv_add=[o for o in out if o['repo']=='LinearViewer' and o['git_status']=='A']
cnt=Counter(o['disposition'] for o in lv_add)
newc=Counter(o['target'] for o in lv_add if o['disposition']=='new id'); foldc=Counter(o['target'] for o in lv_add if o['disposition']=='fold')
print('missing:',missing)
print('LV added:',len(lv_add),dict(cnt),'| new ids:',dict(newc))
print('folds into',len(foldc),'carried ids:',dict(sorted(foldc.items(),key=lambda x:-x[1])))
print('rows total',len(out),dict(c))
unused=[p for p in list(A)+list(EXCL)+list(D)+list(M)+list(S) if p not in {o['path'] for o in out}]
print('dispositions naming no measured row:',unused)
with open(sys.argv[2],'w',newline='') as fh:
    w=csv.DictWriter(fh,fieldnames=list(out[0])); w.writeheader(); w.writerows(out)
sys.exit(1 if missing or unused or len(lv_add)!=sum(cnt.values()) else 0)
```

#### `cites.py` (scratch, not committed)

```python
# Usage: python3 -I cites.py <LV root> <SD root> <out.csv>
# Extracts every run-4 code citation (strict path:line[,line][-line] + paragraph-local bare `:NNN`), reads the cited
# line's content at run 4's pin, and finds that content at HEAD (origin/main) by exact trimmed-line match. For a
# citation into routes/workspace-api.js the search spans workspace-api.js and its routes/workspace-api-*.js siblings.
import re, subprocess, sys, csv, os
LV, SD, OUT = sys.argv[1:4]
PIN_LV, PIN_SD = 'c5694b68', 'bb1da78'
REPORT = 'docs/reviews/integration-surface-maturity-review-2026-10-21.md'
def git(repo,*a):
    try: return subprocess.check_output(['git','-C',repo,*a],text=True,stderr=subprocess.DEVNULL)
    except subprocess.CalledProcessError: return None
text = git(LV,'show','origin/main:'+REPORT).split('\n')
PATH_RE = r'[A-Za-z0-9_./-]+\.(?:js|md|mjs|txt|json|css|yml)'
STRICT = re.compile(r'(' + PATH_RE + r'):([0-9]+(?:-[0-9]+)?(?:[,/][0-9]+(?:-[0-9]+)?)*)')
BARE = re.compile(r'`:([0-9]+(?:-[0-9]+)?(?:[,/][0-9]+(?:-[0-9]+)?)*)`')
PATHM = re.compile(PATH_RE)
# units: a table row is its own unit; otherwise blank-line-delimited blocks
units=[]; cur=[]
for i,l in enumerate(text,1):
    if l.startswith('|'):
        if cur: units.append(cur); cur=[]
        units.append([(i,l)])
    elif not l.strip():
        if cur: units.append(cur); cur=[]
    else: cur.append((i,l))
if cur: units.append(cur)
cites=[]  # (report_line, path, linespec, form)
for u in units:
    lastpath=None
    for i,l in u:
        # walk left to right, tracking the most recent path mention
        tokens=sorted([(m.start(),'S',m) for m in STRICT.finditer(l)]+[(m.start(),'B',m) for m in BARE.finditer(l)]+[(m.start(),'P',m) for m in PATHM.finditer(l)],key=lambda t:(t[0],t[1]!='S'))
        consumed=set()
        for pos,kind,m in tokens:
            if kind=='S':
                cites.append((i,m.group(1),m.group(2),'strict')); lastpath=m.group(1); consumed.add(m.start())
            elif kind=='P':
                if m.start() in consumed: continue
                lastpath=m.group(0)
            elif kind=='B':
                if lastpath: cites.append((i,lastpath,m.group(1),'bare'))
                else: cites.append((i,'(unresolved)',m.group(1),'bare'))
def resolve_path(p):
    """Map a cited name to (repo, repo-relative path) at the pin."""
    for repo,pin in ((LV,PIN_LV),(SD,PIN_SD)):
        if git(repo,'cat-file','-e',f'{pin}:{p}') is not None: return repo,pin,p
    # bare basename: find a unique match at the pin
    for repo,pin in ((LV,PIN_LV),(SD,PIN_SD)):
        files=[f for f in git(repo,'ls-tree','-r','--name-only',pin).split() if f.endswith('/'+p) or f==p]
        if len(files)==1: return repo,pin,files[0]
    return None,None,p
def first_line(spec):
    return [int(x.split('-')[0]) for x in re.split('[,/]',spec)]
rows=[]
for (rl,p,spec,form) in cites:
    repo,pin,rp = resolve_path(p)
    if repo is None:
        rows.append(dict(report_line=rl,cited=f'{p}:{spec}',form=form,repo='',pin_content='',status='UNRESOLVED-PATH',head_location='',note='no such file at either pin')); continue
    rname='LinearViewer' if repo==LV else 'simple-dispatcher'
    if rp.startswith('docs/reviews/') or rp.endswith('integration-surface-maturity-review-2026-10-21.md'):
        rows.append(dict(report_line=rl,cited=f'{rp}:{spec}',form=form,repo=rname,pin_content='',status='REPORT-LINE',head_location='',note='points at a report, not code')); continue
    old=git(repo,'show',f'{pin}:{rp}').split('\n')
    changed = git(repo,'diff','--quiet',pin,'origin/main','--',rp) is None
    headfiles=[rp]
    if rp=='routes/workspace-api.js':
        headfiles=[f for f in git(repo,'ls-tree','--name-only','origin/main','routes/').split() if re.match(r'routes/workspace-api(-[a-z-]+)?\.js$',f)]
    heads={f:(git(repo,'show','origin/main:'+f) or '').split('\n') for f in headfiles}
    exists_head = any(heads[f]!=[''] for f in headfiles)
    for ln in first_line(spec):
        content = old[ln-1].strip() if 0<ln<=len(old) else ''
        if not exists_head:
            rows.append(dict(report_line=rl,cited=f'{rp}:{ln}',form=form,repo=rname,pin_content=content[:120],status='RETIRED-FILE-DELETED',head_location='',note='')); continue
        if not changed and rp!='routes/workspace-api.js':
            rows.append(dict(report_line=rl,cited=f'{rp}:{ln}',form=form,repo=rname,pin_content=content[:120],status='UNCHANGED-FILE',head_location=f'{rp}:{ln}',note='')); continue
        if len(content)<4 or content in ('}','});','*/','/**','*',')',']'):
            rows.append(dict(report_line=rl,cited=f'{rp}:{ln}',form=form,repo=rname,pin_content=content[:120],status='TRIVIAL-LINE',head_location='',note='cited line too generic to match by content; read by hand')); continue
        hits=[(f,i+1) for f in headfiles for i,l in enumerate(heads[f]) if l.strip()==content]
        if len(hits)==1: st='MOVED' if hits[0]!=(rp,ln) else 'SAME-LINE'
        elif len(hits)>1:
            # prefer the hit nearest the old line in the same file
            same=[h for h in hits if h[0]==rp]
            st='AMBIGUOUS'; hits=sorted(same or hits,key=lambda h:abs(h[1]-ln))[:1] if same else hits[:3]
            if same: st='MOVED-NEAREST'
        else: st='CONTENT-GONE'
        rows.append(dict(report_line=rl,cited=f'{rp}:{ln}',form=form,repo=rname,pin_content=content[:120],status=st,head_location=';'.join(f'{f}:{n}' for f,n in hits),note=''))
with open(OUT,'w',newline='') as fh:
    w=csv.DictWriter(fh,fieldnames=['report_line','cited','form','repo','status','head_location','pin_content','note']); w.writeheader(); w.writerows(rows)
from collections import Counter
print('citations (groups):',len(cites),'| rows (per first line):',len(rows))
print(Counter(r['status'] for r in rows))
files={r['cited'].rsplit(':',1)[0] for r in rows if r['form']=='strict' and r['status'] not in ('UNRESOLVED-PATH','REPORT-LINE')}
print('distinct strictly-cited code files:',len(files))
ch=[f for f in files if (git(LV,'diff','--quiet',PIN_LV,'origin/main','--',f) is None if git(LV,'cat-file','-e',f'{PIN_LV}:{f}') is not None else git(SD,'diff','--quiet',PIN_SD,'origin/main','--',f) is None)]
print('of which changed since pin:',len(ch))
wa=sorted({int(r['cited'].rsplit(':',1)[1]) for r in rows if r['cited'].startswith('routes/workspace-api.js:')})
print('workspace-api.js anchors:',len(wa),wa)
```

#### `cites_resolve.py` (scratch, not committed)

```python
# Usage: python3 -I cites_resolve.py <citation-repoints.csv> — adds the hand resolution of every row the content match could not settle; exits 1 if any row stays unresolved.
import csv, sys
P = sys.argv[1]; rows = list(csv.DictReader(open(P)))
RE = 'routes/workspace-api-run-evidence.js'
H = {  # (report_line, cited) -> (resolution, head_location, note)
 ('125','tests/unit/runner-kit-contract.test.js:38'):('REVERSED','tests/unit/runner-kit-contract.test.js:42,48,330','reads its copy via CONTRACT_PATH; now also pins CONTRACT_SHA256 equal to SD FIXTURE_SHA256 (R14 improved)'),
 ('311','tests/unit/runner-kit-contract.test.js:38'):('REVERSED','tests/unit/runner-kit-contract.test.js:42,48,330','same as row 125 (R14)'),
 ('248','(unresolved):3695'):('MOVED-BY-HAND',f'{RE}:300','bare cite in R7 table row #3; path is routes/workspace-api.js by the row above; closeOutSetsDone call, same text'),
 ('248','(unresolved):3655'):('MOVED-BY-HAND',f'{RE}:260','run-evidence check route'),
 ('248','(unresolved):3619'):('MOVED-BY-HAND',f'{RE}:224','settleDone'),
 ('248','(unresolved):3696'):('MOVED-BY-HAND',f'{RE}:301','settleDone call, same text'),
 ('248','(unresolved):802-816'):('MOVED-BY-HAND',f'{RE}:47-61','defaultMarkDone'),
 ('248','(unresolved):815'):('MOVED-BY-HAND',f'{RE}:60','updateIssue({stateId}) in defaultMarkDone'),
 ('255','routes/workspace-api.js:3259'):('MOVED-BY-HAND','routes/workspace-api-feedback.js:518','feedback create, now normalizeWritePayload(...); still sends no stateId (not an R7 member)'),
 ('280','routes/auth.js:39'):('MOVED-BY-HAND','routes/auth.js:41','createAuthRoutes signature gained parameters; ownerCredentialStore still injected (R13)'),
 ('310','test/runner-contract.test.js:30'):('REVERSED','simple-dispatcher test/runner-contract.test.js:48,50','LV_COMMIT re-pinned 1d4aec6a -> 3d2046ac (LIN-4378); FIXTURE_SHA256 matches LV CONTRACT_SHA256'),
 ('332','lib/dispatch-store.js:1167'):('MOVED-BY-HAND','lib/dispatch-store.js:2048,2109,2127','listHistory(urlKey, opts); silentSince still has no production caller (R2)'),
 ('396','lib/held-connection-entry.js:2'):('RETIRED','lib/held-connection-entry.js:2-3','"dark: no consumer" rewritten; R12 member retired'),
 ('397','server.js:696'):('RETIRED','','owner-credentials "No read path" comment gone; R12 member retired (server.js:805 sibling persists)'),
 ('397','lib/proxy-preamble.js:444'):('RETIRED','','"Inert: no production caller" gone; R12 member retired'),
 ('397','lib/proxy-preamble.js:692'):('RETIRED','','"Inert: no production caller yet" gone; R12 member retired'),
 ('438','docs/architecture/source-map.md:189'):('MOVED-BY-HAND','docs/architecture/source-map.md:243','roster line; now records the LIN-4358 repurpose of pricing-conformance-sweep; still 7 jobs'),
 ('462','lib/run-paragraph-hook.js:30'):('MOVED-BY-HAND','lib/run-paragraph-hook.js:35','resolvePrecomputeApiKey renamed resolvePrecomputeCredential; residual precompute spend stands (LIN-3422 Backlog)'),
 ('720','lib/run-paragraph-hook.js:30'):('MOVED-BY-HAND','lib/run-paragraph-hook.js:35','same as row 462'),
 ('473','public/dispatch.js:99'):('RULE-FALSE-POSITIVE','','bare `:99` belongs to Documentation 2026-10-21, not public/dispatch.js; points at a report line'),
 ('476','runner.mjs:215-219'):('MOVED-BY-HAND','lib/runner-kit/runner.mjs:217-221','declared unknown-mode halt difference, same text (LIN-3630)'),
 ('688','lib/effort-readout.js:597'):('RETIRED','lib/effort-readout.js:621','stale "does not yet report" string replaced by an accurate one; R12 member retired'),
 ('707','adf.js:121,181,713'):('SAME-LINE-BY-HAND','lib/providers/jira/adf.js:121,181,713','same text at the same lines'),
 ('733','lib/guest-task-path.js:41'):('RETIRED','lib/guest-task-path.js:45','stale comment fixed (now says the routes exist)'),
 ('764','lib/observation-sessions-store.js:184'):('REVERSED','lib/observation-sessions-store.js:184','BUILDER_VERSION 18 -> 20'),
}
out=[]; un=[]
for r in rows:
    k=(r['report_line'],r['cited'])
    if r['status'] in ('UNRESOLVED-PATH','CONTENT-GONE','TRIVIAL-LINE'):
        if k not in H: un.append(k); r['resolution']='UNRESOLVED'
        else: r['resolution'],hl,r['note']=H[k]; r['head_location']=hl or r['head_location']
    else: r['resolution']={'UNCHANGED-FILE':'PASS (file unchanged)','SAME-LINE':'PASS (same line)','MOVED':'MOVED (unique content match)','MOVED-NEAREST':'MOVED (nearest of several identical lines in the same file)','REPORT-LINE':'RULE-FALSE-POSITIVE'}.get(r['status'],r['status'])
    out.append(r)
used=set((r['report_line'],r['cited']) for r in out)
stale=[k for k in H if k not in used]
with open(P,'w',newline='') as fh:
    w=csv.DictWriter(fh,fieldnames=['report_line','cited','form','repo','status','resolution','head_location','pin_content','note']); w.writeheader(); w.writerows(out)
from collections import Counter
print(Counter(r['resolution'].split(' ')[0] for r in out)); print('unresolved',un,'stale overlay keys',stale)
sys.exit(1 if un or stale else 0)
```

#### `run4.py` (scratch, not committed)

```python
# Usage: python3 -I run4.py <LV root> <out.json> — parses run 4's Trend Ledger (52 rows) and R-table (R1-R17); exits 1 if incomplete.
import re, subprocess, sys, json
LV, OUT = sys.argv[1:3]
t = subprocess.check_output(['git','-C',LV,'show','origin/main:docs/reviews/integration-surface-maturity-review-2026-10-21.md'],text=True)
led = t[t.index('## Trend Ledger'):t.index('**N/A justifications.**')]
rows=[]; typ=None
for l in led.split('\n'):
    m=re.match(r'### (MOD|API|FLOW|META) ',l)
    if m: typ=m.group(1); continue
    m=re.match(r'\| `([a-z0-9-]+)` \| (.*?) \| (.*?) \| (.*?) \| (.*?) \| (.*) \|$',l)
    if m: rows.append(dict(id=m.group(1),type=typ,what=m.group(2),chp=m.group(3).replace('*',''),cfg=m.group(4),confidence=m.group(5),delta=m.group(6)))
rt = t[t.index('## Ranked recommendations'):t.index('## Plain-language read')]
recs=[]
for l in rt.split('\n'):
    m=re.match(r'\| (R\d+) \| (.*?) \| (.*?) \| (.*?) \| (.*?) \| (\d+) \| (.*?) \| (.*?) \|$',l)
    if m: recs.append(dict(id=m.group(1),surface=m.group(2),dimension=m.group(3),impact=m.group(4),effort=m.group(5),priority=int(m.group(6)),status=m.group(7),owner=m.group(8)))
from collections import Counter
c=Counter(r['type'] for r in rows)
print('rows',len(rows),dict(c),'recs',len(recs),[r['id'] for r in recs])
ok = len(rows)==52 and c==Counter({'MOD':21,'API':10,'FLOW':20,'META':1}) and sorted(int(r['id'][1:]) for r in recs)==list(range(1,18))
json.dump(dict(rows=rows,recs=recs),open(OUT,'w'),indent=1)
sys.exit(0 if ok else 1)
```

#### `c14.py` (scratch, not committed)

```python
# Usage: python3 -I c14.py <LV root> <base> <head>   — run 4's C14 Arm 1 regexes, verbatim (rerun-outputs.md Q34)
import re, subprocess, sys
LV, BASE, HEAD = sys.argv[1:4]
SUBJECT_RE = re.compile(r'fix|leak|bypass|trust|dropped|silently|wrong|broken|regress|csrf|privacy', re.I)
EXCLUDE_RE = re.compile(r'review|close-out|docs|test', re.I)
BODY_RE = re.compile(r'class-\(a\)|behaviou?r fix|post-deploy|regression|\bbug\b', re.I)
out = subprocess.check_output(['git','-C',LV,'log','--no-merges','--format=%h%x1f%ad%x1f%s%x1f%b%x1e','--date=short',f'{BASE}..{HEAD}','--','lib','routes','server.js','public'],text=True)
commits=[c.strip('\n').split('\x1f') for c in out.split('\x1e') if c.strip()]
print('non-merge commits touching lib routes server.js public:',len(commits))
a=[c for c in commits if SUBJECT_RE.search(c[2]) and not EXCLUDE_RE.search(c[2])]
b=[c for c in commits if c not in a and BODY_RE.search(c[2]+'\n'+c[3])]
print(f'subject regex minus exclusion: {len(a)} | body-marker additions: {len(b)} | union: {len(a)+len(b)}')
for tag,lst in (('S',a),('B',b)):
    for c in lst: print(tag,c[0],c[1],c[2][:130])
```

#### `gen.py` (scratch, not committed)

```python
# Usage: python3 -I gen.py <trend-ledger.json> <run4-ledger.json> <report.md> [--check]
# Validates the ledger, then regenerates every table between <!-- gen:NAME --> markers in the report.
# --check: exit 1 if regeneration would change the report (no hand-maintained duplicate tables).
import json, sys, re
L = json.load(open(sys.argv[1])); R4 = json.load(open(sys.argv[2])); REPORT = sys.argv[3]; CHECK = '--check' in sys.argv
DIMS = L['dimensions']; LAB = dict(chp='CHP',err='ERR',res='RES',rl='RL',auth='AUTH',idem='IDEM',val='VAL',obs='OBS',sec='SEC',test='TEST',doc='DOC',cfg='CFG')
S = L['surfaces']; ids = {s['id'] for s in S}
errs = []
# --- validation
for r in R4['rows']:
    if r['id'] not in ids: errs.append(f"run-4 id missing: {r['id']}")
def num(v):
    if isinstance(v,(int,float)): return float(v)
    m = re.match(r'^(\d)(?: / (\d)(?:-(\d))?)?$', str(v))
    if not m: return None
    if m.group(2) is None: return float(m.group(1))
    lo = float(m.group(2)); hi = float(m.group(3) or m.group(2))
    return (float(m.group(1)) + (lo+hi)/2)/2
for s in S:
    for d in DIMS:
        v = s['scores'][d]
        if v == 'N/A':
            if d not in s['na']: errs.append(f"{s['id']}.{d}: N/A without justification")
            continue
        n = num(v)
        if n is None: errs.append(f"{s['id']}.{d}: bad score {v}"); continue
        r4 = s['run4']; changed = False
        if r4 and d in ('chp','cfg'):
            old = r4[d].replace('N/A*','N/A')
            changed = (str(v) != old)
            if changed and d not in s['cites']: errs.append(f"{s['id']}.{d}: changed {old}->{v} without citation")
        lo_hi = any(x in str(v).replace(' ','').split('/') for x in ('0','1','4')) or str(v).startswith(('0','1','4'))
        if lo_hi and d not in s['cites'] and not (r4 and d in ('chp','cfg') and not changed):
            errs.append(f"{s['id']}.{d}: score {v} needs a citation")
from collections import Counter
types = Counter(s['type'] for s in S)
if errs:
    print('VALIDATION FAILED'); print('\n'.join(errs)); sys.exit(1)
# --- helpers
def cell(v): return 'N' if v=='N/A' else str(v).replace(' ','')
def vec(s): return '·'.join(cell(s['scores'][d]) for d in DIMS)
def dchp(s):
    if not s['run4']: return 'new'
    o = s['run4']['chp'].replace('*',''); n = str(s['scores']['chp'])
    return '=' if o==n else f'{o}→{n}'
def dcfg(s):
    if not s['run4']: return 'new'
    o = s['run4']['cfg'].replace('N/A*','N/A'); n = str(s['scores']['cfg'])
    return '=' if o==n else f'{o}→{n}'
def comp(s): 
    n = num(s['scores']['chp']); return f"{n/4*100:.0f}%" if n is not None else '—'
gen = {}
# ledger tables
for typ in ('MOD','API','FLOW','META'):
    rows = [s for s in S if s['type']==typ]
    nc = sum(1 for s in rows if s['status']=='carried'); nn = len(rows)-nc
    out = [f"*{len(rows)} {typ} ids ({nc} carried, {nn} new). Scores in the order " + '·'.join(LAB[d] for d in DIMS) + "; N = N/A (justified below).*", '',
           '| id | scores | CHP Δ | CFG Δ | Sev | Complete | Confidence (run 4 → now) | Area(s) | Delta vs run 4 (citation) |', '|---|---|---|---|---|---|---|---|---|']
    for s in rows:
        conf = s['confidence'] if not s['run4'] or s['run4']['confidence']==s['confidence'] else f"{s['run4']['confidence']} → {s['confidence']}"
        out.append(f"| `{s['id']}` | `{vec(s)}` | {dchp(s)} | {dcfg(s)} | {s['severity']} | {comp(s)} | {conf} | {', '.join(s['areas'])} | {s['delta']} |")
    gen[f'ledger-{typ.lower()}'] = '\n'.join(out)
# citations for 0-1/4 and changed cells
out = ['| id | dimension | score | evidence |','|---|---|---|---|']
for s in S:
    for d in DIMS:
        if d in s['cites']: out.append(f"| `{s['id']}` | {LAB[d]} | {cell(s['scores'][d])} | {s['cites'][d]} |")
gen['cites'] = '\n'.join(out)
# N/A table: profile-level justifications + per-row exceptions
out = ['| id | N/A dimensions | justification |','|---|---|---|']
for s in S:
    groups = {}
    for d,t in s['na'].items(): groups.setdefault(t,[]).append(LAB[d])
    for t,ds in groups.items(): out.append(f"| `{s['id']}` | {', '.join(ds)} | {t} |")
gen['na'] = '\n'.join(out)
# N/A flips vs run 4 (CFG and CHP are the only run-4 per-surface dimensions)
flips = [f"`{s['id']}` {d.upper()} {s['run4'][d]} → {s['scores'][d]}" for s in S if s['run4'] for d in ('chp','cfg') if (s['run4'][d].startswith('N/A')) != (s['scores'][d]=='N/A')]
gen['na-flips'] = ('**N/A flips vs run 4: ' + (', '.join(flips) if flips else 'none') + '.** ') + f"CFG is N/A for {sum(1 for s in S if s['type']!='META' and s['scores']['cfg']=='N/A')} of {sum(1 for s in S if s['type']!='META')} scored ids (run 4: 30 of 51; the three new ids add 2)."
# completeness (CHP-based, comparable with run 4) + per-dimension means
sc = [s for s in S if s['type']!='META']
pts = sum(num(s['scores']['chp']) for s in sc); den = 4*len(sc)
car = [s for s in sc if s['status']=='carried']; cpts = sum(num(s['scores']['chp']) for s in car)
new = [s for s in sc if s['status']=='new']; npts = sum(num(s['scores']['chp']) for s in new)
gen['completeness'] = (f"Portfolio CHP completeness over **{len(sc)}** scored ids: **{pts/den*100:.1f}%** ({pts:g} of {den}). "
    f"The {len(car)} carried ids alone: **{cpts/(4*len(car))*100:.1f}%** ({cpts:g} of {4*len(car)}; run 4 over the same ids: 88.6%, 180.75 of 204). "
    f"The {len(new)} new ids enter at {npts:g} of {4*len(new)} (**{npts/(4*len(new))*100:.1f}%**).")
out = ['| Dimension | Scored ids | N/A | Mean (0-4) | Mean as % | Owner |','|---|---|---|---|---|---|']
OWN = dict(chp='this review (first-party)',err='Reliability — LIN-1040 (not built)',res='Reliability — LIN-1040 (not built)',rl='Reliability — LIN-1040 (not built)',auth='Security Review',idem='Reliability — LIN-1040 (not built)',val='API Quality Review',obs='Observability — LIN-1041 (not built)',sec='Security Review',test='Test Coverage Gap Review',doc='Documentation Review',cfg='this review + siblings')
means = {}
for d in DIMS:
    vals = [num(s['scores'][d]) for s in sc if s['scores'][d]!='N/A']
    m = sum(vals)/len(vals); means[d]=m
    out.append(f"| {LAB[d]} | {len(vals)} | {len(sc)-len(vals)} | {m:.2f} | {m/4*100:.1f}% | {OWN[d]} |")
gen['dim-means'] = '\n'.join(out)
# recommendations: derived priority
IMP = {'H':3,'M':2,'L-M':1.5,'L':1,'—':0}; EFF = {'L':1,'L-M':1.5,'M':2,'H':3,'—':2.5}
r4p = {r['id']:r['priority'] for r in R4['recs']}
def key(r):
    closed = r['impact']=='—'
    return (closed, -IMP[r['impact']], EFF[r['effort']], r4p.get(r['id'], 99), r['id'])
recs = sorted(L['recommendations'], key=key)
out = ['| priority | id | surface | dimension | impact | effort | status | owner |','|---|---|---|---|---|---|---|---|']
for i,r in enumerate(recs,1):
    out.append(f"| {i} | {r['id']} | `{r['surface']}` | {r['dimension']} | {r['impact']} | {r['effort']} | {r['status']} | {r['owner']} |")
gen['recs'] = '\n'.join(out)
top = [r['id'] for r in recs if r['impact']!='—'][:10]
gen['headline'] = 'Headline list (top 10 by derived priority: highest impact, then lowest effort, ties by run-4 rank): ' + ', '.join(top) + '.'
out = []
for i,r in enumerate(recs,1):
    out.append(f"- **{r['id']}** (priority {i}; `{r['surface']}`; {r['dimension']}; impact {r['impact']} · effort {r['effort']}; {r['status']}; owner: {r['owner']}). **Finding:** {r['finding']} **Action:** {r['action']}")
gen['rec-detail'] = '\n'.join(out)
# area cross-check
areas = Counter(); amap = {}
for s in S:
    for a in s['areas']: amap.setdefault(a,[]).append(s['id'])
out = ['| area | ids mapped |','|---|---|']
for a in sorted(amap): out.append(f"| `{a}` | {len(amap[a])}: " + ', '.join(f'`{i}`' for i in amap[a]) + ' |')
gen['areas'] = '\n'.join(out)
gen['shape'] = f"**{len(sc)} scored ids ({types['MOD']} MOD / {types['API']} API / {types['FLOW']} FLOW) + {types['META']} META = {len(S)} rows**; run 4's 52 rows are a strict subset; none retired; 3 new."
# --- splice
text = open(REPORT).read(); new_text = text
for name, body in gen.items():
    pat = re.compile(r'(<!-- gen:%s -->\n)(.*?)(<!-- /gen:%s -->)' % (re.escape(name), re.escape(name)), re.S)
    if not pat.search(new_text): print(f'marker missing: {name}'); sys.exit(1)
    new_text = pat.sub(lambda m: m.group(1)+body+'\n'+m.group(3), new_text)
if CHECK:
    print('regeneration diff:', 'NONE' if new_text==text else 'CHANGED'); sys.exit(0 if new_text==text else 1)
open(REPORT,'w').write(new_text)
print('ok', dict(types), f"completeness {pts/den*100:.1f}%", 'top', top)
print('means', {d: round(m,2) for d,m in means.items()})
```

#### `author_ledger.py` (scratch, not committed)

```python
# Authoring aid (scratch): writes trend-ledger.json, the review's one machine-readable state. Every judgement lives in the JSON it writes.
import json, sys
run4 = {r['id']: r for r in json.load(open(sys.argv[1]))['rows']}
OUT = sys.argv[2]
DIMS = ['chp','err','res','rl','auth','idem','val','obs','sec','test','doc','cfg']
N = 'N/A'
NA_TXT = {
 'res':  'no outbound I/O of its own: a pure function of what its caller hands it',
 'rl':   'returns no paged list and calls no rate-limited dependency of its own',
 'auth': 'holds and checks no credential; the route or lane that calls it does',
 'idem': 'pure and writes nothing, so a retry has no effect to double',
 'cfg':  None,  # carried per-row justification from run 4 or stated per row
}
PROFILES = {  # dims err..doc (10), first per-surface reading by class
 'render':  dict(err=3,res=N,rl=N,auth=N,idem=N,val=3,obs=2,sec=3,test=3,doc=3),
 'compute': dict(err=3,res=N,rl=N,auth=N,idem=N,val=3,obs=2,sec=3,test=3,doc=3),
 'store':   dict(err=2,res=2,rl=2,auth=N,idem=3,val=3,obs=2,sec=3,test=3,doc=3),
 'extapi':  dict(err=3,res=3,rl=3,auth=3,idem=3,val=3,obs=2,sec=3,test=3,doc=3),
 'exposed': dict(err=3,res=2,rl=3,auth=3,idem=2,val=3,obs=2,sec=3,test=3,doc=3),
 'flow':    dict(err=2,res=2,rl=N,auth=N,idem=2,val=3,obs=2,sec=3,test=3,doc=3),
 'flowauth':dict(err=2,res=2,rl=N,auth=3,idem=2,val=3,obs=2,sec=3,test=3,doc=3),
}
S = []
def add(id_, typ, status, what, areas, profile, chp, cfg, conf, delta_class, delta, over=None, cites=None, na_extra=None, recs=(), severity='—'):
    sc = dict(PROFILES[profile]); sc.update(over or {}); sc['chp']=chp; sc['cfg']=cfg
    na = {}
    for d in DIMS:
        if sc[d]==N:
            if d in (na_extra or {}): na[d]=na_extra[d]
            elif d=='cfg':
                na[d]='carried N/A* from run 4; not re-verified row by row this run (the second read showed one such carry was wrong, see `mod-render-layer`)' if status=='carried' else 'no environment variable or flag; behaviour is fixed in code'
            elif d=='chp': na[d]='a review methodology has no runtime happy path'
            else: na[d]=NA_TXT[d]
    r4 = run4.get(id_)
    S.append(dict(id=id_, type=typ, status=status, what=what, areas=areas, profile=profile, scores={d:sc[d] for d in DIMS},
        run4=(dict(chp=r4['chp'], cfg=r4['cfg'], confidence=r4['confidence']) if r4 else None), confidence=conf,
        delta_class=delta_class, delta=delta, cites=cites or {}, na=na, recs=list(recs), severity=severity))
U='unchanged'
# ---------------- MOD (21 carried + 1 new)
add('mod-provider-abstraction','MOD','carried','Name→instance registry decoupling provider specifics',['providers'],'compute','4',N,'Medium',U,
    '**confidence High→Medium**, score unchanged — Data & Fetch 2026-10-23 H3 `tracker-reads-no-read-through` (HIGH, LIN-446) sits on the provider read path, an open High finding on a CHP-4 surface (R16); `lib/workspace-issues-memo.js` (30 s issue-set memo) folds',
    cites={'chp':'`lib/providers/interface.js`, `lib/providers/index.js` registry (run-4 evidence, unchanged seam)'})
add('mod-periodicals','MOD','carried','Registry of recurring review templates (16)',['llm-and-prompts'],'compute','3','3','High',U,
    'unchanged scores — registry still 16 (`lib/periodicals.js:1015-1135`); corrective templates now feed area notes and mint nothing (LIN-4380, header `:110-118`); advisory templates still render minting wording (R18); 14 window commits, not filed unchanged blindly',
    over={'doc':2,'test':3}, cites={'doc':'`lib/periodicals.js:843` "not a fourteenth sibling" against 16 registry entries; `:303`, `:382` render minting wording in every advisory prompt (R18)'}, recs=['R18'], severity='M')
add('mod-prompt-template-system','MOD','carried','Deterministic recommendation system: stage router + one path for every recommendation (no model writes a prompt)',['llm-and-prompts','other-features'],'compute','4',N,'Medium',U,
    'unchanged — `8cca0193b` (LIN-3906) fixed two stage-selector misroutes (shipped defect, fixed: coverage caveat, R16); `lib/size-of-move.js`, `lib/stage-writes.js`, `lib/recommendation-look-first.js`, `lib/prompts/autopilot-precedence.js` fold; `lib/prompt-template-defs.js` #10 by churn (24 commits); the Survey became two read-only stage templates (LIN-4248) and code now runs the look-first sequence, Surveys before scoping, at both recommendation seams (LIN-4370, `recommendation-look-first.js`) — a routing behaviour change inside this id, not a new FLOW (one owner: the stage path)',
    cites={'chp':'`lib/stage-router.js` + `generatePrompt()` one-path invariant (CLAUDE.md Invariants); routing snapshots regenerated in `8cca0193b`'})
add('mod-roadmap-trajectory','MOD','carried','Velocity/execution-order/milestone layer',['llm-and-prompts','task-model'],'compute','3','3','Medium/Low',U,
    'unchanged — `lib/task-order.js` (task-model area) folds; no cited gain')
add('mod-render-layer','MOD','carried','Server-side page renderers, tiered; Home, Settings and dashboard route families',['front-end-pages','front-end-browser','web-routes','other-features'],'render','4 / 2-3','3','Medium/Low','changed-cfg',
    'unchanged score; **confidence Medium→Medium/Low** — the largest fold this run (31 files: Settings one-page-per-area LIN-3846, Home pipeline LIN-4118, dashboard split LIN-3742 Done, `run-controls` LIN-3849, `vendor-assets` LIN-3787) was dispositioned by header and importers, not read in depth; `lib/render.js` #6 and `public/app.js` #18 by churn; Home lane fails the new-FLOW test (owned by `lib/home-pipeline.js`). **CFG N/A → 3**: run 4\'s N/A* missed the feature-switch surface this layer reads, and this window cut it from 21 switches to 10 (LIN-3848/3849/3912); see cited cells',
    cites={'chp':'split score carried (run-2 convention): first-class pages 4, experimental tier 2-3','cfg':'**N/A → 3 (a reportable flip, caught by the second read)**: the user feature switches in `lib/feature-defaults.js` went from 21 to 10 in the window — LIN-3848 (`d738a7678`) removed nine that did nothing or were superseded, LIN-3849 (`00c3e081d`) replaced the `dispatch` and `proxy` switches with run controls derived from facts (`lib/run-controls.js`, `getFeatureFlags` at `:27,127`), LIN-3912 (`2c8366760`) retired `nextRun` with its page and job; 34 renderer, component and run-control files read the remaining flags (`rerun-outputs.md` Q17). Held at 3, not 4: the experimental tier still rides on per-user switches'})
add('mod-dispatch-queue','MOD','carried','Queue storage + wake propagation, TTL, loop guards',['runs-and-dispatch'],'store','4','4','High',U,
    'unchanged — three High sibling findings landed here and **all three were fixed in the window** (coverage caveats, R16): API Quality 2026-10-23 H1 (a store fault answered 404/401/empty 200) by `ec9eed17e` (LIN-3805: a retryable 503, `DispatchStoreFault`, `lib/dispatch-store.js:49,72-73`); Data & Fetch 2026-10-23 H1 (30-day window unindexed) by `f4289aa64` (LIN-3811: deferred window indexes built off the boot path, `lib/db-indexes.js:12-26`); Data & Fetch H2 / Performance H2 (full rows by default) by `fcab9f712` (LIN-3812: lean/digest default read). `lib/dispatch-store.js` #4 by churn (+1,906 lines; Code Quality 11-04 F-dispatch-store HIGH structural, LIN-2398)',
    over={'err':3,'rl':2}, cites={'chp':'run-4 evidence carried (`takeItem({targets})`, loop guards); no core defect this window','cfg':'run-4 CFG 4 carried (TTL/queue config, `lib/queue-config.js`)'},
    recs=['R2'], severity='M')
add('mod-observation-materializer','MOD','carried','Durable read-model store + materializer',['runs-and-dispatch'],'store','3',N,'Medium/Low',U,'unchanged — not read in depth this run either (Code Quality 11-04 F-observation MED-HIGH, LIN-4013, structural)')
add('mod-kpi-audit','MOD','carried','Public KPI aggregation + workspace audit',['reports-and-operator-tools','web-routes'],'compute','4 / 3',N,'Medium',U,
    'unchanged — `lib/workspace-kpis-cache.js`, `routes/dashboard-kpis.js`, `routes/workspace-api-audit.js` fold (split/extract, no behaviour declared)',
    cites={'chp':'run-4 evidence carried (`lib/kpi-stats.js` privacy boundary, CLAUDE.md Key Behaviors)'})
add('mod-live-console','MOD','carried','Ambient cross-workspace activity feed',['runs-and-dispatch'],'render','4',N,'Medium',U,
    'unchanged — LIN-3977 (`273385fcf`) left experimental and relabelled lanes (presentation, no defect)', cites={'chp':'`lib/live-console.js`; LIN-3977 promoted it out of the experimental tier'})
add('mod-scheduler','MOD','carried','Leader-safe CAS-lease job substrate (7 registered jobs + 1 bare hourly interval)',['platform-and-plumbing','wiring'],'store','4',N,'High',U,
    'unchanged — still 7 jobs (`server.js:901/968/998/1041/1071/1103/1159`); `pricing-conformance-sweep` repurposed by LIN-4358 (reports unmodelled catalog price gates; roster `docs/architecture/source-map.md:243`); hourly cleanup still bare (`server.js:4696`, R11); the new catalog warm interval (`server.js:1034`) is a per-process cache touch, not a job (R11)',
    over={'idem':4,'rl':N}, cites={'chp':'`lib/scheduler.js` CAS lease; roster census test `tests/unit/claude-md-scheduler-jobs-census.test.js`','idem':'non-upsert CAS lease per job (`docs/architecture/source-map.md:243`): a second instance cannot double-fire a tick'},
    na_extra={'rl':'schedules in-process jobs; no list or rate-limited call of its own'}, recs=['R11'], severity='L')
add('mod-observer-lane','MOD','carried','Observer signal modules',['runs-and-dispatch'],'compute','3',N,'Medium',U,'unchanged — `lib/observer-efficacy-signal.js` still 0 production importers (only a docblock mention, `lib/observer-shadow-log.js:128,138`; R8)', recs=['R8'])
add('mod-ship-journey','MOD','carried','Waypoint-trail derivation + playback view',['front-end-pages'],'render','4',N,'Medium',U,'unchanged', cites={'chp':'run-4 evidence carried'})
add('mod-passage-planner','MOD','carried','Kickoff-prompt copy view',['front-end-pages','llm-and-prompts'],'render','4',N,'Medium',U,'unchanged', cites={'chp':'run-4 evidence carried'})
add('mod-task-edit','MOD','carried','Task-edit drill-down and its session issue routes (`routes/workspace-api-issue-{read,write}.js`)',['front-end-pages','web-routes'],'render','4',N,'Medium',U,
    'unchanged score — the session issue routes now live in `routes/workspace-api-issue-write.js` (LIN-3876) and fold here; that file holds R7 writer #2 (`:820`→`:865`) and create c2 (`:794`→`:801`)',
    cites={'chp':'session PATCH `routes/workspace-api-issue-write.js:820`; R4 serve-side guards `routes/workspace-api-issue-read.js:240,246`'}, recs=['R7'], severity='H')
add('mod-task-create','MOD','carried','Task-create drill-down; the feedback intake folds here',['front-end-pages','web-routes'],'render','4',N,'Low/Medium',U,
    'unchanged — `d0b6aa007` (LIN-3907): the feedback route\'s 413 arm was unreachable over HTTP (shipped defect, fixed: coverage caveat, attributed through this run\'s fold of `routes/workspace-api-feedback.js`)',
    cites={'chp':'`lib/render-task-create.js`; feedback create `routes/workspace-api-feedback.js:518`'})
add('mod-effort-readout','MOD','carried','Per-kind effort × cost × duration read-out (route + renderer)',['runs-and-dispatch','web-routes'],'compute','4',N,'Medium',U,
    'unchanged — two shipped defects fixed (coverage caveats, R16): `eb97e9968` (LIN-3857, effort dropped when the harness in force is opencode) and `c3031ccc5` (LIN-1653, `bug` bucketed as orchestration overhead); run-4 R12 member `lib/effort-readout.js:597` retired (string now `:621`, accurate); `routes/dashboard-effort.js` folds',
    cites={'chp':'`lib/effort-readout.js:621` (the empty-column string now states the reason accurately)'})
add('mod-secret-scan','MOD','carried','Repo + served-public-page secret scan (CLI + CI)',['platform-and-plumbing'],'compute','3',N,'Low/Medium',U,'unchanged — LIN-3795 prefixes minted Harbour tokens so the scan can mask them bare (`lib/harbour-token-format.js`)')
add('mod-task-page','MOD','carried','Owner task page and its stored-data state endpoint; loader, view model and run-steps renderer',['front-end-pages','runs-and-dispatch','front-end-browser','web-routes','other-features'],'render','4',N,'High',U,
    'unchanged — 6 files fold (`lib/task-state.js`, `subtree-index`, `task-facts-holder`, `dashboard-session-state`); `public/prompt-section.js` #5 by churn, Code Quality 2026-11-04 F-prompt-section HIGH (structural, LIN-3546); `lib/task-page-loader.js` #9',
    cites={'chp':'`routes/task-page.js` → loader → `lib/render-task-page.js` (run-4 chain, 13 window commits on the route)'})
add('mod-dispatch-entrance','MOD','carried','Single decision seam for the enqueue lanes',['runs-and-dispatch'],'compute','3',N,'Medium',U,'unchanged — #11 by churn (24 commits); `lib/dispatch-factory.js` (13 commits) placed here; `lib/recommendation-look-first.js` imported at the seam')
add('mod-library','MOD','carried','Public `/library` catalogue; `/getting-started` agent onboarding guide',['llm-and-prompts','web-routes'],'render','4',N,'High',U,
    'unchanged — `routes/getting-started.js` and `lib/prompts/agent-onboarding.js` fold (LIN-4085)', cites={'chp':'mounted routes `routes/library.js`; onboarding guide served at `/getting-started` (`lib/prompts/agent-onboarding.js:1-8`)'})
add('mod-response-hardening','MOD','carried','Pinned public-origin resolver, HSTS, default `no-store`, hash-based CSP',['front-end-pages','auth-accounts-and-workspaces','wiring'],'render','4','3','High',U,
    'unchanged', over={'sec':4}, cites={'chp':'run-4 chain carried','sec':'`APP_CSP` script-src is self + hashes, no `unsafe-inline` (`lib/security-headers.js:63-65`)'})
add('mod-model-routing','MOD','new','Per-workspace model-routing table: job registry, harness/model/effort resolution, store, history, presets, Settings › Models and the proxy routes',['llm-and-prompts','agent-api','web-routes','front-end-pages','front-end-browser'],'store','3','3','Medium','new',
    'new — 17 files (LIN-3852/3853/3962, steps of LIN-3820 Todo): registry `lib/llm-jobs.js`, pure table `lib/model-routing.js` with a witness test proving it answers as the old resolvers did (`:20-22`), store, proxy routes with write scope (`routes/proxy-model-routing.js:189`), change log and undo (`:102`, `:213`); held at 3: the parent design LIN-3820 is still Todo and a blank row deliberately falls through to simple-dispatcher\'s `workspaces.json` (`lib/model-routing.js:14-15`), so model choice still has two sources; consumer evidence `harnesses.js` (LIN-3830 resumes keep model/effort). CFG 3: per-workspace defaults, no env flag',
    over={'res':N,'obs':3,'idem':3,'err':3}, recs=[])
# ---------------- API (10 carried)
add('api-linear-graphql','API','carried','Linear GraphQL client + retry/timeout',['providers'],'extapi','4','3','Medium',U,
    '**confidence High→Medium**, score unchanged — Performance 2026-10-23 H1 `stack-provider-fetch-linear-in-issues` (HIGH, 8.33 s median on 3,755 issues) is an open High finding on this surface (R16)',
    cites={'chp':'run-4 evidence carried (`lib/providers/linear/index.js`)'})
add('api-github-app','API','carried','GitHub App install→callback→link flow',['auth-accounts-and-workspaces','providers'],'extapi','3','4','Medium/High',U,
    'unchanged — `lib/connection-secondary-remint.js` (LIN-3774/3790) renews a secondary installation binding that used to expire silently after ~1h (credential lane, folded there)', cites={'cfg':'run-4 CFG 4 carried'})
add('api-openrouter','API','carried','LLM client + live model catalog; call budget from the catalog',['llm-and-prompts'],'extapi','4','4','High',U,
    'unchanged — LIN-4358 (Done): names, prices, tools and token budgets now come from the catalog (`lib/call-budget.js` folds; `lib/catalog-rate.js` replaces the hand rate card, filed under `flow-cost-telemetry`)',
    cites={'chp':'`lib/openrouter.js` one endpoint; `lib/call-budget.js:1-6`','cfg':'catalog-driven model facts (LIN-4358), keys from env'})
add('api-mongodb-storage','API','carried','Session/data storage, dual backend',['platform-and-plumbing'],'store','4','4','Medium',U,
    'unchanged — LIN-3394 (no unique `urlKey` index) still open High (Security 2026-10-23 #2); Data & Fetch 2026-10-23 H1/H2 landed here too and were fixed in the window (LIN-3811 deferred window indexes, LIN-3812 lean default read); `lib/db-indexes.js` 14 window commits',
    over={'idem':2,'rl':2}, cites={'chp':'run-4 evidence carried','cfg':'run-4 CFG 4 carried'})
add('api-yap-chat-client','API','carried','HTTP client for the experimental chat server',['llm-and-prompts'],'extapi','3','4','Medium/High',U,'unchanged — 0 window commits', cites={'cfg':'run-4 CFG 4 carried'})
add('api-egress-proxy-fetch','API','carried','Outbound HTTP proxy wrapper',['platform-and-plumbing'],'extapi','3','4','Medium/High',U,'unchanged — 0 window commits', cites={'cfg':'run-4 CFG 4 carried'})
add('api-workspace-proxy','API','carried',"Harbour's exposed source-neutral consumer API",['agent-api'],'exposed','4','4','High',U,
    'unchanged — `lib/proxy-instructions.js` #3, `routes/proxy-compute.js` #8, `routes/proxy.js` #13 by churn, none behaviour-declared as a defect fix; `routes/proxy-model-routing.js` filed under `mod-model-routing`; mint by registry id (LIN-4313/4317)',
    cites={'chp':'run-4 evidence carried','cfg':'run-4 CFG 4 carried'})
add('api-dispatch','API','carried',"Harbour's exposed Dispatch API (incl. the per-request usage intake)",['runs-and-dispatch'],'exposed','4','4','Medium',U,
    '**confidence High→Medium**, score unchanged — API Quality 2026-10-23 H1 was fixed in the window (LIN-3805, `ec9eed17e`); Test Coverage 2026-10-23 C1 is open by evidence: LIN-690 reads Done (2026-10-30) but a bounded search finds no test asserting the dispatch-token store\'s cross-workspace revoke or `tokenHash` exclusion (`tests/unit/dispatch-tokens.test.js` changed only by LIN-3795; the wrong-workspace revoke test is the proxy store\'s, `tests/unit/proxy-tokens.test.js:674`) (R16); new route `POST /api/dispatch/usage/:itemId` (`routes/dispatch.js:1671`); who may dispatch from the UI is no longer a per-user `dispatch` switch but derived from facts (owner + live runner key or queue token, `lib/run-controls.js`, LIN-3849) — CFG 4 held (the server-side gates did not change)',
    over={'test':2}, cites={'chp':'run-4 evidence carried; usage intake `routes/dispatch.js:1671`','cfg':'run-4 CFG 4 carried'})
add('api-jira-rest','API','carried','Jira Cloud provider — read-only MVP',['providers'],'extapi','4','4','High',U,'unchanged', cites={'chp':'run-4 evidence carried','cfg':'run-4 CFG 4 carried'})
add('api-runner-kit','API','carried','Runner kit served to user machines: kit JS, setup page, kickoff prompt, contract fixture shared with simple-dispatcher',['runs-and-dispatch'],'exposed','3','3','High','improved',
    'score unchanged, **R14 improved**: both repos now pin the same contract sha256 in CI-run suites (`tests/unit/runner-kit-contract.test.js:48,330`; SD `test/runner-contract.test.js:50`, LIN-4384/4385/4378); the copies are byte-identical (`cmp`); residual one-directional re-pin (SD `:42-44`). `0e6cd32e1` (LIN-3857) fixed a dropped subagent model/effort (coverage caveat, R16); `runCommand` cyc 136 (Code Quality 11-04, LIN-3741)',
    recs=['R14'], severity='M')
# ---------------- FLOW (20 carried + 2 new)
add('flow-dispatch-lifecycle','FLOW','carried','queue → take → feedback → terminal-marker',['runs-and-dispatch'],'flow','3',N,'High',U,
    'unchanged — R2 core gap open (`listHistory({silentSince})` has no production caller, `lib/dispatch-store.js:2109,2127`; LIN-2120 Backlog); consumer side changed (SD LIN-3905 re-ask before the failsafe, LIN-4218 one Stop relay table, LIN-4239 status posted last, LIN-3047 malformed poll body), none a Harbour crossing that changes the score',
    over={'rl':1}, cites={'rl':'LIN-2120 (Backlog) "Dispatch listing is structurally blind past its newest-N window — general pagination needed"'}, na_extra={}, recs=['R2'], severity='M')
add('flow-followup-resume','FLOW','carried','`followUpTo` resume; consumer owns liveness',['runs-and-dispatch'],'flow','4',N,'High',U,
    'unchanged — consumer evidence: SD LIN-4079 (a follow-up never resumes a CANCELLED session) and LIN-4082 (a person\'s force follow-up may), `followup.js`, `docs/session-lifecycle.md`; LIN-3437 (an abort wins over a late inject)',
    cites={'chp':'run-4 evidence carried (`lib/follow-up-dispatch.js`); consumer `followup.js` (LIN-4079/4082)'})
add('flow-autopilot-wake','FLOW','carried','subscription + `waitForFollowUps` up-chain wake',['runs-and-dispatch'],'flow','4','3','Medium',U,
    'unchanged — the leftover step holds a build\'s parent wake until its `leftover` row ends (`lib/dispatch-leftover.js:4-10`, filed under `flow-area-notes-leftover`); consumer LIN-3759/4027 (relay PENDING-EXTERNAL to a parked parent; leaf `[pending]` wake)',
    cites={'chp':'run-4 evidence carried'})
add('flow-oauth','FLOW','carried','Linear, GitHub App, OpenRouter PKCE, Jira',['auth-accounts-and-workspaces'],'flowauth','3','4','Medium',U,
    'unchanged — the brief\'s seed LIN-3642 was fixed before run 4\'s pin (`bc875ddc`) and was counted there; no new defect found this window', cites={'cfg':'run-4 CFG 4 carried'})
add('flow-bootstrap-token-exchange','FLOW','carried','Single-use bootstrap → working-token exchange',['agent-api','runs-and-dispatch'],'flowauth','4',N,'Medium',U,
    'unchanged — LIN-1410 still open High (Security 2026-10-23 #3, `lib/proxy-preamble.js:335-336`); tokens now carry a kind prefix (`lib/harbour-token-format.js`, LIN-3795); consumer broker passes on a 429 and backs off (SD `harbour-token-mcp-server.js`, LIN-4378)',
    over={'auth':2,'sec':2}, cites={'chp':'run-4 evidence carried','auth':'Security 2026-10-23 #3 (High, open): bootstrap token inline in prompt text for non-claude-code harnesses, LIN-1410','sec':'same finding (LIN-1410)'})
add('flow-recap-brief-cache','FLOW','carried','Hash-based staleness invalidation',['llm-and-prompts'],'flow','4','3','High',U,'unchanged', cites={'chp':'run-4 evidence carried'})
add('flow-free-tier-rate-limit','FLOW','carried','Quota check → use → footer → 429 (runs/day per account; hourly global cap)',['platform-and-plumbing'],'flowauth','3','4','Medium',U,
    'unchanged — residual precompute spend still open (`lib/run-paragraph-hook.js:35` `resolvePrecomputeCredential` resolves a server key; LIN-3422 Backlog); `lib/free-tier-store.js` single key builder holds', over={'rl':3}, cites={'cfg':'run-4 CFG 4 carried (`lib/plan-allowance.js`)'})
add('flow-periodicals-two-stage','FLOW','carried','Stage-1 mint → Stage-2 run → hand-off → close-out merge and Done (report gate)',['llm-and-prompts','agent-api','runs-and-dispatch'],'flow','3','3','High',U,
    'unchanged scores — R7 unchanged at a fifth cycle (3 update-path Done writers, 1 gated; 2 ungated creates); R1 improved (LIN-4390 hand-off contract, LIN-4381 landed due-state, LIN-4313 mint by id); R9 read side unchanged; template drift R18',
    over={'doc':2}, cites={'doc':'advisory prompts still say the run mints follow-ups (`lib/periodicals.js:303`, `:382`) while the header says none does (`:117-118`); LIN-4389 Todo'}, recs=['R7','R1','R9','R18'], severity='H')
add('flow-account-connection-workspace-credential','FLOW','carried','Account → Connection → binding → workspace credential (legacy owner-credential record still runs alongside)',['auth-accounts-and-workspaces'],'flowauth','3',N,'Medium',U,
    'unchanged — R13: `OwnerCredentialStore` still imported and instantiated (`server.js:67,801`), LIN-2150 Todo; `lib/connection-secondary-remint.js` (LIN-3774/3790) folds; two run-4 R12 members persist here (`lib/connection-store.js:5`, `server.js:805`)',
    over={'doc':2}, cites={'doc':'`lib/connection-store.js:5` and `server.js:805` still say no read path is wired while `lib/connection-credential.js` calls `readConnection*` (R12)'}, recs=['R13'], severity='H')
add('flow-cost-telemetry','FLOW','carried','Per-request usage ledger: runner and opencode post one record per model request → intake → store → loader → fold → cost read → one USD formatter; catalog rates (replaces the deleted task-cost/plan-fee lane)',['runs-and-dispatch','other-features','front-end-browser','llm-and-prompts'],'flowauth','3','4','Medium','changed-definition',
    '**definition re-pointed, CFG 3→4**, CHP held at 3 — the run-4 lane (`lib/task-cost.js`, `lib/plan-fee-config.js`) is deleted; LIN-4195 rebuilt it end to end and the "behind an unwired seam" claim (SD `765289d`) is retired: SD `opencode-runner.js:91-93`, `relayRequestRecords` `:590`; `hook.js:19-20`; `config.js:1345` default on → `POST /api/dispatch/usage/:itemId` (`routes/dispatch.js:1671`) and `/api/proxy/runner/usage/:id` → `lib/request-usage-intake.js` → store → loader (7 importers) → fold → `lib/cost-read.js` (12 importers). CHP held: the only sibling (cost-tracking 2026-11-02) predates the rebuild and production rows are unobserved; LIN-4263 fixed a dropped per-dispatch detail; LIN-4217 index retirement Backlog',
    over={'idem':3,'obs':3,'doc':2}, cites={'cfg':'`SD config.js:1341-1345` one parser, default on (LIN-4127/4182: a stray empty value cannot blind cost); rates read from the catalog (`lib/catalog-rate.js:1-6`, LIN-4358)','doc':'`lib/request-usage-store.js:5-6` "Nothing reads this collection yet except `listForAnchors`… a later piece" — the loader now has 7 importers (R12 new member)'},
    recs=['R12'], severity='L')
add('flow-operator-decisions','FLOW','carried','scan → task-decisions → unanswered → shelved → supersede; rulings feed',['runs-and-dispatch','other-features','web-routes'],'flow','4',N,'Medium',U,
    'unchanged — 5 files fold (`ruling-settled`, `ruling-standing`, `live-anchor`, `routes/dashboard-rulings.js`, `routes/workspace-api-scan.js`)', cites={'chp':'run-4 evidence carried'})
add('flow-account-merge','FLOW','carried','identity-conflict resolution lane',['auth-accounts-and-workspaces'],'flowauth','4',N,'High',U,'unchanged', cites={'chp':'run-4 evidence carried (`routes/account-merge.js`)'})
add('flow-flight-companion-turn','FLOW','carried','agent turn core → gate → transcripts → SSE stream',['llm-and-prompts'],'flow','4',N,'Medium',U,'unchanged', cites={'chp':'run-4 evidence carried'})
add('flow-dispatch-halt','FLOW','carried','operator halt request → store → consumer honouring',['runs-and-dispatch','front-end-pages'],'flow','3',N,'Medium',U,
    'unchanged — R10 still resolved in code (run 3\'s query: 0 stale production hits; `public/dispatch.js:772` accurate); LIN-3074 still Backlog; `lib/components/halt-controls.js` folds; LIN-3849 (`e336733ee`) shows halt buttons only to those the server lets halt (members see none; a direct halt is still refused)')
add('flow-run-evidence-closeout','FLOW','carried','PR evidence, review ledger and the close-out box for a run; merged close-out events for every Done write',['runs-and-dispatch','web-routes'],'flow','3',N,'High',U,
    'unchanged — routes moved to `routes/workspace-api-run-evidence.js` (R7 writer #3 `:260`→`:224`→`:47`/`:60`); `lib/close-out-merges.js` (LIN-3756/3863) records merged events for proxy and person Done writes; `f6e6a0233` (LIN-3903) fixed a post-deploy check that held the close (coverage caveat, R16); consumer LIN-4375 (the `[done]` url is the session\'s own PR)',
    over={'idem':3}, recs=['R7'], severity='H')
add('flow-email-identity','FLOW','carried','Email magic-link sign-in, account home, session options',['auth-accounts-and-workspaces'],'flowauth','4','4','Medium','improved',
    '**CHP 3→4** — run 4 held it at 3 for the in-memory per-IP limiter and the live spam bot; LIN-3771 (`c6c5585a8`, Done) and LIN-3789 added a per-address 24 h cap, a site-wide hourly alarm, a honeypot and a minimum form time (`lib/email-auth.js:41-58`, `routes/email-auth.js:97,141`). Per-IP stays per-process (`routes/email-auth.js:90-95`)',
    over={'rl':3}, cites={'chp':'`lib/email-auth.js:44-58` layered send defences (LIN-3771/3789); refusals logged without the address (`routes/email-auth.js:97`)','cfg':'run-4 CFG 4 carried (`lib/email-availability.js`)'})
add('flow-workspace-lifecycle','FLOW','carried','Workspace create/bind/remove, registry, settings change log, owner backfill, erasure',['auth-accounts-and-workspaces'],'flowauth','3',N,'Medium',U,
    'unchanged — registry still write-only (`lib/workspace-registry.js` exports only `recordWorkspace`, now 10 importing writers; R8); `lib/workspace-change-log.js` folds (LIN-3846)', recs=['R8'])
add('flow-consumer-liveness','FLOW','carried','Consumer heartbeat ingest/store and the advisory liveness-alarm sweep',['runs-and-dispatch'],'flow','3',N,'Medium',U,
    'unchanged — `authStoppedWorkspaces` still only validated and stored (`lib/consumer-heartbeat.js:34,87`, R15); alarm store `cleanup()` still uncalled (R17); consumer: one dispatcher per host (SD `instance-guard.js`, LIN-796)',
    over={'test':2,'doc':2}, cites={'test':'no e2e or contract test for heartbeat → alarm (run-4 finding, unchanged)','doc':'`lib/liveness-alarm-store.js:276` says the periodic cleanup calls `cleanup()`; nothing does (R17)'}, recs=['R15','R17'], severity='M')
add('flow-agent-grants','FLOW','carried','Proxy grant/scope vocabulary, `requireGrant`, owner-only gates',['agent-api'],'flowauth','4',N,'Medium',U,
    '**confidence Medium/High→Medium**, score unchanged — Test Coverage 2026-10-23 C1 (High): the dispatch-token store\'s cross-workspace revoke and `tokenHash` exclusion are unasserted; LIN-690 reads Done (2026-10-30) with no such test found (R16)',
    over={'test':2}, cites={'chp':'run-4 chain carried','test':'Test Coverage 2026-10-23 C1: `lib/dispatch-tokens.js:240-243` (revoke keyed only by `urlKey`) and `:205-220` (`listTokens` must not return `tokenHash`) are unasserted; LIN-690 reads Done but no such test was found'})
add('flow-task-share','FLOW','carried','Owner-minted `/t/:token` read-only guest task pages',['auth-accounts-and-workspaces','web-routes'],'flowauth','3',N,'Medium/High',U,
    'unchanged — LIN-3795 masks a minted token planted bare in a rendered `/t/` page; the run-4 stale comment `lib/guest-task-path.js:41-43` is fixed (now `:45`)', over={'rl':2})
add('flow-area-notes-leftover','FLOW','new','Area registry and notes (both repos) and the leftover step: a build\'s terminal `[done]` resumes its session to ask what it left; corrective periodicals feed Waiting/Lessons',['runs-and-dispatch','llm-and-prompts'],'flow','3',N,'Medium','new',
    'new — cross-repo (LIN-4347/4371/4372/4374/4376/4380): `server.js:1126-1133` builds the leftover step → `lib/dispatch-leftover.js` decides queue/hold/not-eligible (`:12-17`) with an idempotent wake release; `LEFTOVER_RULE` (`lib/prompts/leftover-words.js`) is what SD\'s notes README points to (LIN-4385); registries `docs/areas/areas.json` in both repos with guard tests. Held at 3: 18 added `lib/` files fell through the catch-all despite the README\'s same-change rule (R19), and only 3 corrective siblings (Seams & Tangles, Drift & Coherence, Design & Interface) have fed entries since LIN-4380',
    over={'idem':3}, recs=['R19'], severity='L')
add('flow-as-asked-seal','FLOW','new','The `## As asked` block: sealed on create (session, feedback, proxy) and first dispatch; proxy description writes keep it',['llm-and-prompts','other-features','agent-api'],'flow','3',N,'Medium','new',
    'new — `lib/as-asked.js` (25 importers) owns the shape; `lib/as-asked-seal.js` seals on the three create lanes and the first-dispatch seal (`lib/dispatch-factory.js`); the immutability check runs only on the proxy write (`routes/proxy-writes.js:317-337`). The session PATCH replaces the whole body with no check (`routes/workspace-api-issue-write.js:860`); whether person lanes are exempt by design is unconfirmed, so this is held at 3 as an open question, not a defect (R20)',
    over={'err':3,'idem':3}, recs=['R20'], severity='M')
# ---------------- META
add('meta-integration-surface-maturity-review','META','carried',"This review's own methodology",['llm-and-prompts'],'compute','3',N,'Medium',U,
    'unchanged at 3 — gains: scripted, balanced reconciliation (189 sweep rows, 291 citation rows), first full twelve-dimension reading, a JSON ledger. Losses: its own template still describes minting (R18), its top recommendation is at a fifth cycle with no route to owned work (R21), and 12 of 34 done/High ids were hit (R16). The Tier-2 second read found the window\'s largest configuration change (feature switches 21 → 10) missing and one carried N/A* note claiming a re-verification that was not done; both fixed in place. See Self-Audit',
    over={'err':N,'res':N,'rl':N,'auth':N,'idem':N,'val':N,'obs':N,'sec':N,'test':2,'doc':2},
    cites={'test':'`tests/unit/periodicals.test.js:371-372` census regexes miss both advisory minting phrases','doc':'method steps (five-pass sweep, area cross-check, scripted ledger) live only in ticket text, not in `generateIntegrationSurfaceMaturityPrompt` (`lib/periodicals.js:835`)'},
    na_extra={d:'a review methodology has no runtime surface for this dimension' for d in ['err','res','rl','auth','idem','val','obs','sec']}, recs=['R16','R18','R21'], severity='M')
# ---------- recommendations
R = [
 dict(id='R7',surface='flow-periodicals-two-stage',dimension='configuration/enforcement',impact='H',effort='L',status='open, carried — unchanged, 5th cycle',owner='this review → LIN-2576 (Todo)',
      finding='3 update-path Done writers, 1 gated: agent PATCH gated (`routes/proxy-writes.js:54,459,468,523`); session PATCH ungated (`routes/workspace-api-issue-write.js:820`→`:861`→`:865`, which also records a person close-out merge, `:880-882`); close-out check ungated (`routes/workspace-api-run-evidence.js:260`→`:300-301` `settleDone` `:224/230`→`defaultMarkDone` `:47`/`:60`). Creates c1 `routes/proxy-writes.js:433`→`:446`, c2 `routes/workspace-api-issue-write.js:794`→`:801` accept `stateId` ungated. LIN-4390 says the gate "fires on close-out\'s write" (`lib/periodicals.js:277-278`): true only when close-out writes through the agent PATCH.',
      action='Run `checkPeriodicalReportGate` in the session PATCH and in `defaultMarkDone` (both hold description and comments), or move it to one provider-write seam (R20). Close-out of this task: the gated agent PATCH only.'),
 dict(id='R21',surface='META',dimension='methodology / portfolio loop',impact='H',effort='L',status='open, **new**',owner='the human (a lane decision); this review',
      finding='The series ranks R7 #1 for a fifth run and R3 has not moved since the baseline; the advisory lane mints nothing and writes no notes (`lib/periodicals.js:114-115`), so a top finding has no route to owned work except a human reading the report. LIN-2576 has had zero commits across four ISM cycles. By contrast, the three High findings the corrective siblings filed against the dispatch store on 2026-10-23 were fixed within days (LIN-3805, LIN-3811, LIN-3812): the corrective lane converts findings to work and the advisory lane does not.',
      action='Decide a route out of the advisory lane for a finding that tops N runs (e.g. the review may name it for Up next, or close-out files it), or accept that R7 stays a standing note.'),
 dict(id='R13',surface='flow-account-connection-workspace-credential',dimension='core/happy-path, auth & credentials',impact='H',effort='—',status='open, carried — unchanged',owner='Security Review; LIN-2150 (Todo)',
      finding='`OwnerCredentialStore` still imported and built (`server.js:67,801`) beside the Connection seam; LIN-2150 Todo; `lib/connection-secondary-remint.js` (LIN-3774/3790) closed a silent 1 h secondary-binding expiry in the same lane. Security 2026-10-23 is the owning edition.',
      action='Pointer only: Security Review and LIN-2150.'),
 dict(id='R1',surface='flow-periodicals-two-stage',dimension='core/happy-path, configuration',impact='H',effort='M',status='open, carried — improved',owner='this review; LIN-3649 (Backlog)',
      finding='The Stage-2 end is now defined: the run hands off and close-out merges and sets Done (LIN-4390, Done); landed work makes a lane read due (LIN-4381, Done, overlaps but does not supersede LIN-1629 Todo, which also asks for ledger/coverage deltas); mint by registry id (LIN-4313/4317). Still open: the readiness re-check on the proxy, recommend and kickoff lanes (LIN-3649 Backlog).',
      action='LIN-3649; keep LIN-1629 open for its ledger half.'),
 dict(id='R18',surface='META / mod-periodicals',dimension='documentation (template), testing',impact='M',effort='L',status='open, **new**',owner='this review → LIN-4389 (Todo)',
      finding='All three advisory templates render minting wording at two shared sites: `lib/periodicals.js:303` ("whatever follow-up work this review mints") and `:382` ("(and any follow-up tasks)"); the census `tests/unit/periodicals.test.js:371-372` lists five other phrases and misses both. `:843` still says "fourteenth sibling" against 16 entries. The method this series relies on (five-pass sweep, area cross-check, scripted ledger, tiered second-read) lives only in ticket text.',
      action='LIN-4389, plus the two phrases in the census; fold the ticket-only method steps into `generateIntegrationSurfaceMaturityPrompt`.'),
 dict(id='R14',surface='api-runner-kit',dimension='testing (contract), configuration',impact='M',effort='L-M',status='open, carried — improved (partly resolved)',owner='this review (boundary)',
      finding='Both suites now pin the same sha256 and both run in CI (`tests/unit/runner-kit-contract.test.js:48,330`; SD `test/runner-contract.test.js:50`, `LV_COMMIT` `3d2046ac`); copies byte-identical. Residual: an LV edit re-pinned on LV alone passes until SD\'s next re-copy (SD `:42-44` says so).',
      action='A check that fetches the other side\'s pinned file, or accept the residual as declared.'),
 dict(id='R2',surface='flow-dispatch-lifecycle',dimension='core/happy-path',impact='M',effort='M',status='open, carried — unchanged',owner='this review → LIN-2120 (Backlog)',
      finding='`listHistory({silentSince})` still has no production caller (`lib/dispatch-store.js:2109,2127`; only `lib/db-indexes.js:195-201` mentions it); alarms remain alarm-only. A consumer that dies on an open ticket still leaves its item taken forever.',
      action='LIN-2120.'),
 dict(id='R9',surface='flow-periodicals-two-stage',dimension='configuration/data integrity',impact='M',effort='L',status='open, carried — unchanged (write side improved)',owner='this review → LIN-2846 (Backlog)',
      finding='`formatDispatchWatch` (`routes/proxy-dispatch.js:57`) still does not carry `periodicalId`; the registry-id mint now stamps it on write (`routes/proxy-dispatch.js:301,311`, LIN-4313).',
      action='LIN-2846.'),
 dict(id='R16',surface='META',dimension='methodology',impact='M',effort='L',status='open, carried — improved (14 → 12 ids; 40% → 35%)',owner='this review',
      finding='12 of 34 ids rated CHP 4 or High were hit by a real finding in the window. 6 only by defects or sibling Highs since fixed (mod-effort-readout, api-runner-kit, mod-task-create, mod-prompt-template-system, flow-run-evidence-closeout, and mod-dispatch-queue, where three 10-23 sibling Highs were fixed within days by LIN-3805/3811/3812); 6 by findings still open (api-dispatch and flow-agent-grants: Test Coverage C1, LIN-690 Done with no test found; api-linear-graphql and mod-provider-abstraction: LIN-446; api-mongodb-storage: LIN-3394; flow-bootstrap-token-exchange: LIN-1410).',
      action='This run applies run 4\'s action (confidence cut on open-High hits; fixed ones recorded as caveats). Next: let an open sibling High move a score cell, not only confidence, and check a Done ticket against its acceptance before counting a finding fixed.'),
 dict(id='R15',surface='flow-consumer-liveness',dimension='observability',impact='M',effort='L',status='open, carried — unchanged',owner='Observability — LIN-1041 (not built)',
      finding='`authStoppedWorkspaces` appears only in `lib/consumer-heartbeat.js:34,87`: validated and stored, shown nowhere.',action='Pointer only.'),
 dict(id='R20',surface='flow-as-asked-seal / flow-periodicals-two-stage',dimension='configuration/enforcement (structural)',impact='M',effort='M',status='open, **new**',owner='this review (pointer for the human)',
      finding='Three write rules are enforced per lane, not at the provider write seam: the Done gate (proxy only, R7), As-asked immutability (`checkAsAsked`, proxy only, `routes/proxy-writes.js:317-337`; the session PATCH replaces the body at `routes/workspace-api-issue-write.js:860`), and the close-out readiness re-check (session lane only; LIN-3649). Whether person lanes are exempt from As-asked by design is unconfirmed.',
      action='Decide per rule whether person lanes are exempt; where not, enforce at one provider-write seam so a new lane cannot skip it.'),
 dict(id='R3',surface='portfolio/META',dimension='error handling, resilience, rate limits, idempotency, observability',impact='H',effort='—',status='open, carried — unchanged (5th run)',owner='Reliability LIN-1040 / Observability LIN-1041 (both Backlog, unregistered)',
      finding='Neither is among the 16 registry entries. The clearest reliability finding this window (API Quality 2026-10-23 H1, store faults answered as final 4xx) was found and fixed (LIN-3805) under API Quality\'s contract-edge remit; resilience, idempotency and observability have no such proxy owner.',action='Pointer only.'),
 dict(id='R12',surface='portfolio/META',dimension='documentation',impact='L-M',effort='L',status='open, carried — improved (19 → 5)',owner='Documentation Review (newest 2026-10-21); acted on by Comprehension-Debt',
      finding='Run 4\'s C9 rule re-run verbatim: 15 of 19 definite members retired, 4 persist (`lib/connection-store.js:5`, `server.js:805`, `server.js:4372`, `lib/workspace.js:96`), 1 new (`lib/request-usage-store.js:5`). Arm A 60 → 57 lines; Arm B literal 10 → 12. 13 of the retirements are one commit, `343d34ec0` (LIN-3827), minted by the Comprehension-Debt Review (LIN-3825, 2026-10-23), not Documentation (newest 2026-10-21): an owner-map delta.',action='Documentation Review for the 5 left; note Comprehension-Debt now acts on this class.'),
 dict(id='R19',surface='flow-area-notes-leftover',dimension='documentation/configuration (area registry)',impact='L',effort='L',status='open, **new**',owner='area registry owner (`docs/areas/README.md`, LIN-4371)',
      finding='18 `lib/` files fall through to the `^lib/` catch-all (Other features), all added in this window, although `docs/areas/README.md` says a falling-through file gets a home in the same change; `lib/as-asked-seal.js` is homeless by a deliberate pin (`tests/unit/area-map-placement.test.js`). Nothing fails when a new file lands in the catch-all.',
      action='A guard that fails on a new catch-all file, or accept the catch-all as a holding area.'),
 dict(id='R8',surface='portfolio/META',dimension='cross-surface (landed-but-unconsumed)',impact='M',effort='—',status='open, carried — unchanged (mixed)',owner='this review',
      finding='`lib/observer-efficacy-signal.js` 0 production importers; `lib/workspace-registry.js` still write-only (one export, 10 writers). No new instance among the 107 added files: the two 0-importer adds are scripts-only by design (`lib/pipeline-churn.js`) or a deliberate counter (`lib/usage-snapshot-intake.js`, LIN-4203 D8).',action='Pointer only.'),
 dict(id='R6',surface='portfolio/META',dimension='sibling review cadence',impact='M',effort='—',status='open, carried — improved',owner='scheduling call',
      finding='Every registered sibling has now run at least once (first Performance/Scale and Data & Fetch editions 2026-10-23). Oldest at the listing: Documentation and Recent Headwinds (2026-10-21).',action='Scheduling call.'),
 dict(id='R11',surface='mod-scheduler',dimension='configuration',impact='L',effort='L',status='open, carried — unchanged',owner='this review',
      finding='Hourly cleanup still a bare `setInterval` (`server.js:4696`). The new catalog warm (`server.js:1034`, LIN-3882) is a per-process cache touch every instance must run, so it is not counted.',action='Lease the hourly cleanup or record why every instance should run it.'),
 dict(id='R17',surface='flow-consumer-liveness',dimension='core/happy-path (retention), documentation',impact='L',effort='L',status='open, carried — unchanged',owner='this review (pointer)',
      finding='`lib/liveness-alarm-store.js:276` still claims the periodic cleanup calls `cleanup()` (`:285`); `lib/hourly-cleanup.js` does not.',action='Pointer only.'),
 dict(id='R5',surface='flow-free-tier-rate-limit',dimension='testing',impact='—',effort='—',status='**resolved**, carried (residual precompute: LIN-3422)',owner='—',finding='No regression; residual precompute spend open (LIN-3422 Backlog).',action='—'),
 dict(id='R10',surface='flow-dispatch-halt',dimension='documentation',impact='—',effort='L',status='**resolved in code**, carried (LIN-3074 still Backlog)',owner='Documentation Review',finding='Run 3\'s query: 0 stale production hits.',action='Close LIN-3074.'),
 dict(id='R4',surface='feedback/image handling',dimension='security',impact='—',effort='—',status='**closed/resolved**, carried',owner='—',finding='Serve-side sniff and `nosniff` re-pointed to `routes/workspace-api-issue-read.js:240,246`; no regression.',action='—'),
]
json.dump(dict(schema='ism-trend-ledger/1', run=5, task='LIN-4407', scoring_pins=dict(LinearViewer='9cf51ef7210f836c350d9d1d34e088a1bd850bcb', **{'simple-dispatcher':'5d8489e7fd8434f0e69af7df11a3746790abbe64'}),
    baseline=dict(report='docs/reviews/integration-surface-maturity-review-2026-10-21.md', LinearViewer='c5694b68', **{'simple-dispatcher':'bb1da78'}),
    dimensions=DIMS, profiles=PROFILES, na_text=NA_TXT, surfaces=S, recommendations=R), open(OUT,'w'), indent=1, ensure_ascii=False)
print(len(S),'surfaces', len(R),'recs')
```

#### `build_rerun.sh` (scratch, not committed)

```bash
#!/bin/bash
# Builds rerun-outputs.md: runs every bound query at the pins and records command + verbatim output.
set -u
LV="$1"; SD="$2"; SPS="$3"; OUT="$4"
cd "$LV"
P=origin/main
q(){ # title, command
  echo; echo "### $1"; echo; echo "- run at: \`$(date -u +%FT%TZ)\` · LinearViewer \`$(git rev-parse --short=9 $P)\` · simple-dispatcher \`$(git -C "$SD" rev-parse --short $P)\`"; echo; echo '```bash'; echo "$2"; echo '```'; echo; echo '```text'; bash -c "$2" 2>&1 | sed -E "s#$SPS#<scratch>#g; s#$LV#<LinearViewer>#g; s#$SD#<simple-dispatcher>#g"; echo '```'; }
src(){ echo; echo "#### \`$1\` (scratch, not committed)"; echo; echo '```'"$2"; cat "$SPS/scripts/$1"; echo '```'; }
{
cat <<'HDR'
# Re-run outputs: Integration & Surface Maturity run 5 (LIN-4407)

Every bound this report rests on, re-run at the scoring pins, with the command and its verbatim output, so a reviewer
can reproduce each one. Scripts are not committed (task constraint); their full text is at the end of this file and
paths to them are shown as `<scratch>`. No command output here contains a credential: tracker reads went through the
local workspace proxy, whose address is omitted.

- LinearViewer pin: `9cf51ef7210f836c350d9d1d34e088a1bd850bcb`; simple-dispatcher pin: `5d8489e7fd8434f0e69af7df11a3746790abbe64`.
- Run-4 baseline: LinearViewer `c5694b68`, simple-dispatcher `bb1da78`; mint pin `f5b1f5efa`.
- Counting rules are run 4's (`_evidence-2026-10-21/integration-surface-maturity/rerun-outputs.md`, "Reproducibility notes") unless a query says otherwise.
HDR
q "Q1. Pins and windows (LinearViewer)" "git rev-parse origin/main; git rev-list --count c5694b68..origin/main; git rev-list --count --no-merges c5694b68..origin/main; git rev-list --count 38760071..origin/main; git rev-list --count c5694b68..origin/main -- lib routes server.js; git rev-list --count 38760071..origin/main -- lib routes server.js"
q "Q2. Pins and window (simple-dispatcher)" "git -C $SD rev-parse origin/main; git -C $SD rev-list --count bb1da78..origin/main; git -C $SD diff --shortstat bb1da78 origin/main; git -C $SD diff --name-only bb1da78 origin/main | grep -c '^test/'; git -C $SD diff --diff-filter=A --name-only bb1da78 origin/main -- test | wc -l; git -C $SD log --no-merges --format=%s bb1da78..origin/main | grep -o 'LIN-[0-9]*' | sort -u | wc -l"
q "Q3. Drift since the mint pin f5b1f5efa" "git log --oneline f5b1f5efa..origin/main; git diff --name-only f5b1f5efa origin/main; git -C $SD log --oneline --since=2026-11-10T09:54:45Z origin/main | wc -l"
q "Q4. Sweep inputs: added/deleted/churn rows with area and full-path importers (base.py), then dispositions (dispose.py)" "python3 -I $SPS/scripts/base.py $LV $SD $SPS/out >/dev/null && python3 -c \"import json;print(json.dumps(json.load(open('$SPS/out/base-summary.json')),indent=1))\"; git diff --no-renames --diff-filter=A --name-only c5694b68 origin/main -- lib routes public | wc -l; git diff --no-renames --diff-filter=D --name-only c5694b68 origin/main -- lib routes public; python3 -I $SPS/scripts/dispose.py $SPS/out/base-rows.json $SPS/out/sweep-dispositions.csv; echo exit=\$?
# Note: a first importer pass matched on '/<path below lib/>' and missed same-directory imports
# (e.g. lib/prompts/autopilot-precedence.js imported as './autopilot-precedence.js'); it was replaced
# by full-path resolution before any disposition was written."
q "Q5. R7 Done-writer census: updateIssue/createIssue outside lib/providers, gate references, stateId lines" "git grep -n -E '\.(updateIssue|createIssue)\(' origin/main -- lib routes server.js ':!lib/providers' | cut -c1-170; echo '--- gate'; git grep -n checkPeriodicalReportGate origin/main -- lib routes server.js | cut -c1-140; echo '--- stateId'; git grep -n stateId origin/main -- routes server.js | cut -c1-140; echo '--- run-evidence chain'; grep -n 'settleDone\|closeOutSetsDone\|defaultMarkDone\|router.post' routes/workspace-api-run-evidence.js | cut -c1-140; echo '--- session PATCH'; grep -n -E \"router\.patch|input\.stateId|updateIssue|recordPipelineMerge\(\" routes/workspace-api-issue-write.js | cut -c1-140"
q "Q6. Template drift: render every periodical and scan for minting wording; census patterns" "node -e \"import('./lib/periodicals.js').then(m=>{console.log('registry',m.PERIODICALS.length);for(const p of m.PERIODICALS){const t=m.renderPeriodicalPrompt(p.id);console.log(p.id.padEnd(30),p.mode.padEnd(11),'mints-phrase(:303):',/whatever follow-up work this review mints/.test(t),' any-follow-up(:382):',/\(and any follow-up tasks\)/.test(t))}})\"; sed -n '303p;382p;843p' lib/periodicals.js | cut -c1-160; sed -n '114,118p' lib/periodicals.js; sed -n '371,373p' tests/unit/periodicals.test.js | cut -c1-200"
q "Q7. docs/reviews listing (sibling freshness; newest per family) and area-note sources" "git ls-tree --name-only origin/main docs/reviews/ | sed 's#docs/reviews/##' | grep -E '\.md\$' | python3 -c \"
import sys,re
fam={}
for f in sys.stdin.read().split():
  m=re.match(r'(.+?)-(2026-\d\d-\d\d)(-[a-z0-9-]+)?\.md\$',f)
  if m: fam.setdefault(m.group(1),[]).append(m.group(2)+(m.group(3) or ''))
for k,v in sorted(fam.items()): print(k.ljust(40), len(v), sorted(v)[-1])\"; echo '--- periodical-sourced area-note entries'; grep -h -o -E '\((Seams|Drift|Stability|Security|Code Quality|Documentation|Design|Comprehension|Test Coverage|API Quality|Dependency|Performance|Data|Onboarding|Recent)[^)]*\)' docs/areas/*.md $SD/docs/areas/*.md | cut -c1-40 | sort | uniq -c; echo '--- Survey tally entries'; grep -h -c 'Survey tally' docs/areas/*.md | paste -sd+ - | bc"
q "Q8. C9 Arm A (run 4 Q24 query, verbatim) at HEAD" "git grep -n -i -E '\bdark\b|no consumer|not( yet)? wired|wired to (no|NO)|no read path|NO read path|no (production )?caller|nothing (reads|calls|consumes)|not yet consumed' origin/main -- lib routes server.js | cut -c1-200; echo \"--- lines: \$(git grep -n -i -E '\bdark\b|no consumer|not( yet)? wired|wired to (no|NO)|no read path|NO read path|no (production )?caller|nothing (reads|calls|consumes)|not yet consumed' origin/main -- lib routes server.js | wc -l | tr -d ' ')\""
q "Q9. C9 Arm B (run 4 Q25 patterns, verbatim) at HEAD" "cnt(){ git grep -n \"\$@\" origin/main -- lib routes server.js | wc -l | tr -d ' '; }; echo \"literal cs \$(cnt -E '(once|until|pending|awaiting) LIN-[0-9]+') | literal -i \$(cnt -i -E '(once|until|pending|awaiting) LIN-[0-9]+') | wider A \$(cnt -i -E '(once|until|pending|awaiting)[^.]{0,60}LIN-[0-9]+') | wider B \$(cnt -i -E '(once|until|pending|awaiting|blocked on|not yet landed|lands)[^.]{0,80}LIN-[0-9]+')\"; git grep -n -i -E '(once|until|pending|awaiting) LIN-[0-9]+' origin/main -- lib routes server.js | cut -c1-180"
q "Q10. C9 member presence (run 4's 19 definite) and retirement provenance" "for c in lib/account-store.js:43 lib/account-workspace-store.js:28 lib/connection-store.js:5 lib/connection-store.js:60 lib/connection-store.js:71 lib/credential-invariant-sweep.js:20 lib/dispatch-store.js:583 lib/held-connection-entry.js:2 lib/kpi-daily-rollup.js:11 lib/periodicals.js:92 lib/prompts/collective-participant.js:126 lib/proxy-preamble.js:444 lib/proxy-preamble.js:692 routes/collective.js:116 server.js:696 server.js:705 server.js:4290 lib/effort-readout.js:597 lib/workspace.js:96 lib/agent-turn.js:585; do f=\${c%%:*}; n=\${c##*:}; old=\$(git show c5694b68:\$f | sed -n \${n}p | sed 's/^[[:space:]]*//'); hit=\$(git show origin/main:\$f | grep -n -F -- \"\$old\" | head -1 | cut -d: -f1); echo \"\$c -> \${hit:-GONE}\"; done; echo '--- provenance'; for pair in 'lib/account-store.js|wired to NO route' 'lib/held-connection-entry.js|dark: no consumer' 'lib/effort-readout.js|does not yet report a realised' 'lib/agent-turn.js|boot once LIN-2622'; do f=\${pair%%|*}; s=\${pair#*|}; echo \"\$f: \$(git log --format='%h %s' -S\"\$s\" c5694b68..origin/main -- \$f | head -1 | cut -c1-90)\"; done"
q "Q11. C14 Arm 1 (run 4 Q34 regexes, verbatim) over c5694b68..origin/main" "python3 -I $SPS/scripts/c14.py $LV c5694b68 origin/main"
q "Q12. Citation re-points (strict + paragraph-local bare), content match, hand overlay" "python3 -I $SPS/scripts/cites.py $LV $SD $SPS/out/citation-repoints.csv && python3 -I $SPS/scripts/cites_resolve.py $SPS/out/citation-repoints.csv; echo exit=\$?"
q "Q13. Run-4 parse (52 rows, R1-R17; incomplete parse exits 1)" "python3 -I $SPS/scripts/run4.py $LV $SPS/out/run4-ledger.json; echo exit=\$?"
q "Q14. Carried-recommendation probes (R2, R8, R9, R11, R13, R14, R15, R17, R5, R10)" "echo '--- R2'; grep -n silentSince lib/dispatch-store.js | head -3; git grep -n silentSince origin/main -- lib routes server.js ':!lib/dispatch-store.js' | cut -c1-120; echo '--- R9'; grep -n 'function formatDispatchWatch' routes/proxy-dispatch.js; grep -n periodicalId routes/proxy-dispatch.js | cut -c1-120; echo '--- R8'; git grep -l observer-efficacy-signal origin/main -- lib routes server.js; grep -n '^export' lib/workspace-registry.js; git grep -l 'workspace-registry.js' origin/main -- lib routes server.js | wc -l; echo '--- R11'; git grep -n -A1 'scheduler.register(' origin/main -- server.js | grep name: ; git grep -n 'setInterval(' origin/main -- server.js | cut -c1-130; echo '--- R13'; grep -n OwnerCredentialStore server.js; echo '--- R14'; grep -n CONTRACT_SHA256 tests/unit/runner-kit-contract.test.js | head -2 | cut -c1-120; grep -n -E 'FIXTURE_SHA256 =|LV_COMMIT =' $SD/test/runner-contract.test.js; cmp lib/runner-kit/contract.json $SD/test/fixtures/runner-contract.json && echo byte-identical; ls .github/workflows $SD/.github/workflows; echo '--- R15'; git grep -n authStoppedWorkspaces origin/main -- lib routes public server.js | cut -c1-100; echo '--- R17'; grep -n -i alarm lib/hourly-cleanup.js | wc -l; sed -n '276p;285p' lib/liveness-alarm-store.js; echo '--- R5'; grep -n 'export function resolvePrecompute' lib/run-paragraph-hook.js; echo '--- R10 (run 3 query, non-review production hits)'; git grep -n -E 'LIN-2995|yet honor' origin/main -- 'lib/*.js' 'routes/*.js' 'public/*.js' server.js | cut -c1-120; echo '--- usage wiring (SD)'; grep -n 'request-records\|request-usage' $SD/opencode-runner.js $SD/hook.js $SD/dispatcher.js $SD/reapers.js | cut -c1-110; grep -n 'WORKER_USAGE_RELAY = ' $SD/config.js; grep -n \"router.post('/api/dispatch/usage\" routes/dispatch.js | cut -c1-90"
q "Q17. Configuration surface (added after the second read): feature switches at both pins, dispatch-switch references, consumer default flips" "for r in c5694b68 origin/main; do git show \$r:lib/feature-defaults.js > /tmp/fd-\$\$.mjs; node -e \"import('file:///tmp/fd-\$\$.mjs').then(m=>console.log('\$r FEATURES keys:',Object.keys(m.FEATURES).length,Object.values(m.FEATURES).join(',')))\"; done; rm -f /tmp/fd-\$\$.mjs; for c in d738a7678 00c3e081d 2c8366760 e336733ee; do git log -1 --format='%h %ad %s' --date=short \$c | cut -c1-120; done; echo \"FEATURES.DISPATCH refs: \$(git grep -c FEATURES.DISPATCH c5694b68 -- lib routes server.js | wc -l | tr -d ' ') -> \$(git grep -c FEATURES.DISPATCH origin/main -- lib routes server.js | wc -l | tr -d ' ') files\"; git grep -l -E 'featureFlags|getFeatureFlags' origin/main -- 'lib/render*.js' 'lib/components/*.js' lib/run-controls.js | wc -l; grep -n -E \"envFlag\\('SD_(ASSISTANT_TEXT|WORKER_USAGE)_RELAY'\" $SD/config.js; git -C $SD log -1 --format='%h %ad %s' --date=short a7e5173"
echo; echo '### Q15. Tracker states (workspace API, read 2026-11-10T11:17Z)'; echo; echo '```text'; cat "$SPS/out/tracker-states.txt"; echo '```'
echo; echo '### Q16. Generator: validate the ledger, render the report tables, confirm a second run changes nothing'; echo; echo '```bash'; echo 'python3 -I <scratch>/scripts/gen.py docs/reviews/_evidence-2026-11-10-ism/trend-ledger.json docs/reviews/_evidence-2026-11-10-ism/run4-ledger.json docs/reviews/integration-surface-maturity-review-2026-11-10.md --check'; echo '```'; echo; echo '```text'; python3 -I "$SPS/scripts/gen.py" docs/reviews/_evidence-2026-11-10-ism/trend-ledger.json docs/reviews/_evidence-2026-11-10-ism/run4-ledger.json docs/reviews/integration-surface-maturity-review-2026-11-10.md --check 2>&1; echo '```'
echo; echo '## Script sources (full text; not committed)'
src base.py python; src dispose.py python; src cites.py python; src cites_resolve.py python; src run4.py python; src c14.py python; src gen.py python; src author_ledger.py python; src build_rerun.sh bash
} > "$OUT"
```
