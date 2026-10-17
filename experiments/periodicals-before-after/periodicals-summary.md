# Periodicals that bear on code shape: what each measures, how to run it, latest reading

**Registry.** The registry is `lib/periodicals.js` at `origin/main` `91fca7dd`. It holds 16 templates, each `{id, title, mode, scope, cadence: 'weekly', generatePrompt}`. The workspace view shows them behind the `periodicals` flag.
- **Stage 1:** a dispatch mints one review task, grounded in the repo.
- **Stage 2:** that task writes a report to `docs/reviews/<slug>-<date>.md`, mints at most 3 follow-ups (advisory reviews mint none), comments and self-closes.
- **Trend-aware reviews** (`priorRunsTrend`) re-measure the previous report's commit with the same method.

**Seams & Tangles** (`seams-tangles`, corrective, LIN-3550)
- **Measures** how areas import each other, as facts:
  - links: distinct cross-area importer→imported file pairs;
  - knots: two-way area pairs, plus the cycle groups (strongly connected components) they form;
  - entry files per area;
  - scope counts: parse failures, unresolved imports, non-literal dynamic imports, unmapped files.
- **Judgement** (wrong-way edges, hubs, readiness, guide edits) is the reviewer's prose.
- **Run:** `node scripts/code-shape/seams.mjs <repoDir> <commit> scripts/code-shape/areas.json`. It reads the git object store and needs no checkout. Pass the same guide at both commits.
- **Latest reading:** `docs/reviews/seams-tangles-review-2026-10-13.md` (LIN-3552, baseline, at `6597d6e0`).
  - 429 files; 63 link rows; 897 cross-area imports; 19 two-way pairs; one 9-area knot group.
  - Heaviest pairs: Agent API↔Runs 44/7 and Agent API↔LLM 35/4, mostly the guide mixing route and lib layers.
  - Promoted follow-ups F-A (`deriveFollowUpDispatch` out of `chat-tools`), F-B (ordering out of `render-swipe`) and F-C (`RefResolutionError` out of the Agent API).
- **Altitude:** decisions in several places belong to Drift, function size to Code Quality, churn to Stability.

**Code Quality Review** (`code-quality`, corrective, LIN-354)
- **Measures** complexity hotspots (long functions, nesting, branch points), duplication and convention drift, weighted by risk × churn.
- **No committed tool:** the run uses "lightweight built-in signals", with churn as `wc -l` × 90-day touches.
- **Run:** dispatch the periodical.
- **Latest reading:** `docs/reviews/code-quality-review-2026-10-12.md` (LIN-3543, at `1ef562ce`).
  - The big units kept growing (about +3,000 lines since 09-26).
  - Promoted (LIN-3544/45/46): `runStallFailsafe` (SD, 950 lines, 145 branch points), `createDispatchItem` (625 → 913), the POST dispatch handler (479 → 683) and `prompt-section.js init` (390 → 822).
  - "Gets simpler as it goes" does not hold on the complexity axis.
- **Test-estate edition:** `code-quality-review-2026-10-12-tests.md` (LIN-3517).
- **Closest committed function-size definitions:** `experiments/rebuild-exp1/kit/lib/shape-core.mjs` on branch `claude/jolly-knuth-dgn3m1`, the measure `rebuild-ladder.md` uses.

**Drift & Coherence Review** (`drift-coherence`, corrective, trend-aware, LIN-369)
- **Measures** decisions held in several places ("places per decision"), convention fragmentation and dependency direction.
- **Method:** hand ledger plus old-command / shape-count pairs; Tarjan over file imports.
- **Latest reading:** `drift-coherence-review-2026-10-12.md` (at `e24f8d12`).
  - 23 distinct decisions held in more than one place (1 High, the runner contract).
  - 13/13 batch-3 decisions reach one authority.
  - 0 file-level cycles (393 nodes / 1,476 edges).
- **Scriptable sibling:** `coherence-as-it-grows-scripts/known-decisions.sh` (11 named decisions) and `coherence-census.mjs admissions` (declared twins).

**Stability Review** (`stability-review`, advisory, LIN-453)
- **Measures** whether the relative rate of change converges: churn hotspots, trend, change-coupling.
- **Output:** a read for a human; it mints nothing.
- **Latest reading:** `stability-review-2026-10-12.md` (LIN-3547).
  - LinearViewer is "not spiralling", but "direction [is] changing faster than the build": six build-then-remove episodes in 10 days, and the three hub surfaces are entangling.
  - SD is converging.

**Comprehension-Debt Review** (`comprehension-debt`) covers module-level rationale. Latest reading: 2026-07-01. It is not a shape count.
