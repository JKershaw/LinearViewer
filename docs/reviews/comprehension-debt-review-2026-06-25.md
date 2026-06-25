# Comprehension-Debt Review — run of 2026-06-25

**Grounding:** reviewed at HEAD = `8de7da5` (LIN-666 Recent Headwinds report, 2026-06-25). Periodical LIN-370, run task **LIN-674**. Prior runs: the **baseline of 2026-06-12** (`docs/reviews/comprehension-debt-review-2026-06-12.md`, run LIN-439, grounded at HEAD `f746725`). The intervening Stage-2 task LIN-485 was **Canceled without running**, so the baseline is the entire prior ledger and this is effectively the first run *since* `f746725` — a HEAD that has moved ~107 files / ~16k insertions past the baseline. Everything new or changed since `f746725` was treated as fresh territory; the baseline's clean list was reaffirmed by spot-check, not re-derived.

**Altitude reminder (LIN-370):** this review asks whether a *cold reader* can reconstruct *why a module is shaped the way it is* from the code + nearby docs alone. It is distinct from the Documentation Review's per-comment hygiene — a single missing why-comment is that review's to own; here a *module whose load-bearing rationale is unrecoverable* is the finding. Rationale-inflation (manufactured explanation for self-evident code) is itself a finding, so a clean, legible module is recorded as a genuine pass, never padded.

---

## Headline

**The codebase's rationale-comment culture continues to hold under heavy churn.** Despite the provider-binding keystone (LIN-562/581), the GitHub adapter (LIN-178/541), the source-neutral wire + ID resolver (LIN-310/556), the attachment relay (LIN-649/650), and the whole session-telemetry/summary machinery landing since the baseline, the central debt signal this review hunts — a bare `LIN-###`/PR reference beside non-obvious code whose *why* lives only offsite — remains **largely absent**. New critical-path modules paraphrase their load-bearing constraints in-code at the ticket tag (e.g. `lib/proxy-ref-resolver.js` spells out the Linear-only input-namespace gate and its LIN-544/581 sequencing split; `lib/proxy-wire.js` states the no-deep-link / opaque-handle policy; `lib/workspace.js` states the `(provider, scope)` binding-key invariant; `lib/task-snapshot-store.js` states why capture is hash-gated and why there is deliberately no TTL).

Four module clusters were walked at HEAD: (A) the consumer API proxy critical path, (B) the provider abstraction layer, (C) session telemetry + run/session summary, (D) stores / graph builders / goal generator. Clusters A and D came back **clean**. Clusters B and C surfaced findings.

**Baseline ledger reconciliation:**

- **F1 `proxy-dedupe-key-nul-separator`** — **RESOLVED** (promoted as the baseline's F1, landed under **LIN-440**). Confirmed at HEAD: the trailing literal NUL is gone (`lib/proxy-dedupe.js:40` is now `hash.update(\`${str.length}:${str}\`)`), the constraint is paraphrased in-code (lines 29–34: "The length-prefix is the *whole* collision guarantee … An earlier revision appended a trailing separator here, a literal NUL … it was redundant … dropped — see LIN-440"), and the file **no longer classifies as binary** to grep/diff (verified: `git grep` sees its content; no `\x00` byte remains). Loop closed.
- **F2 `composite-sort-key-magnitude-invariant`** — **still open, unchanged at HEAD.** `lib/swim-graph.js:113` (`* 100000`) and `lib/swim-lanes.js:279` (`* 1000000`) still pack `primary * BIG + secondary` with the magnitude-must-exceed-max-in-set-index invariant unstated and the two magnitudes still divergent. The idiom has **not** leaked into other ranking/sort code (checked `lib/render-swipe.js`, `lib/roadmap.js` — no `primary * BIG + secondary` packing). Re-assessed: still **Low**, still does not clear the promotion bar (layout-only path, mis-ordering not corruption, triggers only at implausible 10⁵–10⁶ set sizes). **Left in the ledger again, not promoted** — per the under-create discipline.

One **new** finding clears the promotion bar this run (**F3**, Medium). Three further new observations are recorded but **not promoted** (F4–F6, all Low). Per the ~3 cap and the err-toward-under-creating rule, **one** follow-up is minted (F3).

---

## Findings (severity-ranked)

### F3 — `provider-label-capability-method-not-execution-path` — **Medium** — *new*

**Where:**
- Capability/standalone methods: `lib/providers/linear/index.js:1876-1877` (instance wrappers) over the free functions at `:1705` / `:1731`; `lib/providers/local/index.js:578-585`; `lib/providers/github/index.js:472-479`.
- Capability derivation: `lib/providers/interface.js:134` — `caps[method] = typeof this[method] === 'function' && this[method] !== base[method]`.
- Execution path: `routes/proxy.js:2323` / `:2383` (the gate) → `:2343`+`:2359` / `:2397`+`:2415` (the actual write).

**Non-obvious behavior + missing rationale.** Each provider implements first-class `addLabel`/`removeLabel` methods, and these are what register the `labels`-family capability bit — because the capability descriptor is **reflection-based**: a method counts as supported only when the subclass *overrides* the base throwing stub (`interface.js:134`). The consumer proxy's label endpoints gate on that bit (`denyIfUnsupported(provider, 'addLabel', …)`, `proxy.js:2323`) — **but never call `provider.addLabel()`**. After the gate passes, the proxy performs the read-modify-write itself through the *off-surface* `provider.issueLabels()` + `provider.updateIssueLabels()` (`proxy.js:2343/2359`). A repo-wide grep confirms **no caller** of the `provider.addLabel`/`removeLabel` instance methods on any execution path. So the method that *gates* the capability and the method that *performs* the write are different functions, and the gating method looks like dead code. Worse, the gated methods have **divergent signatures across providers** — Linear's `addLabel(apiKey, issueId, labelId)` takes a label **ID** and runs its *own* full RMW (`linear/index.js:1705-1720`), duplicating exactly what `updateIssueLabels` + the proxy already do, while Local/GitHub's `addLabel(token, issueId, label)` take a label **name** and delegate. Nothing at any of the three method sites says "this exists to register the `supports('addLabel')` bit; the proxy executes label writes elsewhere."

**Cold-hand-off test:** **fails.** A cold reader cleaning up `provider.addLabel`/`removeLabel` as un-called dead code — or trying to unify their divergent signatures, or pointing the proxy at them to remove the "duplicate" RMW — would silently flip the `labels` capability bit off (reflection sees the base stub again), turning every consumer label write into a `422 CAPABILITY_NOT_SUPPORTED`, with no code that actually writes labels having been touched. The mechanism (`interface.js:130-141`) documents reflection-derivation in general; the *specific* trap — these particular overrides are gate-only and the execution lives in `issueLabels`/`updateIssueLabels` — is unrecoverable at the sites.

**Minimal fix (constraint-note, not net-new prose):** one line on the Linear `addLabel`/`removeLabel` instance wrappers (with a back-reference on Local/GitHub), e.g. `// The consumer proxy does NOT call this — it gates on supports('addLabel') then executes the RMW via issueLabels()+updateIssueLabels(). This override exists to register the capability bit (and is the standalone-API entry). Do not delete it (the proxy's label endpoints would 422) and note the signature differs per provider (Linear: labelId; Local/GitHub: name).` **No behavior change intended.**

> **Promoted to a follow-up this run** (highest-severity finding; sits on the write capability gate, the failure is a silent consumer-facing 422, and the "un-called dead code" deletion is a plausible cold-hand-off edit compounded by cross-provider signature divergence).

### F4 — `telemetry-heartbeat-state-vocabulary-unstated` — **Low** — *new*

**Where:** `lib/session-telemetry.js:145-147`:

```js
let state = null;
if (/running/i.test(message)) state = 'running';
else if (noTools) state = 'idle';
```

**Non-obvious behavior + missing rationale.** `state` is `'running'` only when the literal word "running" appears, `'idle'` only on a no-tool beat, and `null` otherwise — so the canonical compact heartbeat the module header itself cites (`[working] N tools/Ms · alive`) yields `state: null`, not `'running'`. The vocabulary that drives the field is not stated next to the block. **Mitigant that keeps this Low:** the JSDoc return type at `:124` explicitly lists `state: ('running'|'idle'|null)`, so `null` is a *documented* tri-state value, not an apparent oversight; and the per-heartbeat `state` field is **not consumed by any UI** (the Observation page's live/running logic keys off a different field, `r.agentState`, at `public/observation.js:138`). Real but minor; a cold editor extending the vocabulary has the tri-state contract in the JSDoc.

**Cold-hand-off test:** passes narrowly (JSDoc documents the tri-state; no downstream consumer to break). **Not promoted.** A one-line note above the block naming the driving vocabulary would still help; recorded for the next run.

### F5 — `telemetry-runtime-crosscheck-policy-unstated` — **Low** — *new*

**Where:** `lib/session-telemetry.js:84-103` (the `crossCheck` field).

**Non-obvious behavior + missing rationale.** `crossCheck` (the stated-duration parse from a terminal marker) is computed, attached, and — within this module — never read. The header (`:86`) and the field comment correctly state it is "verification-only, never the source of truth" (so `ms` comes from `dispatchedAt→completedAt` timestamps). What is *not* stated is what a divergence between `ms` and `crossCheck.ms` should *mean* (informational drift vs. an error) and that it is intentionally surfaced-but-unconsumed here. The ambiguity invites two opposite wrong edits (delete as dead code; or build reconciliation the design never intended). The existing "verification-only" phrasing largely covers intent, which keeps this **Low**.

**Cold-hand-off test:** passes narrowly. **Not promoted.** Recommended note: "surfaced for downstream/operator divergence inspection only; a mismatch is informational, not an error."

### F6 — `github-recommendation-context-opts-shape` — **Low** — *new*

**Where:** `lib/providers/github/index.js:260` — `async fetchRecommendationContext(repo, issueId, _opts = {})`.

**Non-obvious behavior + missing rationale.** GitHub ignores its third arg and always returns leaf context; the Linear (`{ signal, noDescend }`, `linear/index.js:904`) and Local (`{ noDescend }`, `local/index.js:271`) implementations honor a structured options object. The doc here *does* explain why GitHub ignores it ("always the leaf case … regardless of noDescend (Mirrors the Local provider's leaf branch)"), so the gap is only that the **shared `{ signal, noDescend }` object shape** isn't named as a cross-provider contract at this site. Borderline — the rationale is largely present already.

**Cold-hand-off test:** passes. **Not promoted.** Optional tidy: destructure the shared shape (`{ noDescend } = {}`) with a one-line "shape is the cross-provider contract; GitHub honors none of it (always leaf)" note.

---

## Modules walked and judged clean (cold reader can safely modify; no offsite-only rationale)

**Cluster A — proxy critical path (clean):** `routes/proxy.js` provider-selection seam (`resolveProviderAccess`, LIN-581 per-workspace + Linear-legacy-default byte-identical guarantee + both narrow test/local seams stated at `:642-671`); the capability gate `denyIfUnsupported` (`:687`, "never 500 / decline cleanly" contract stated); the attachment relay (`:1744-1865`, full SSRF guard chain + `redirect:'error'` rationale + `att:`-deferred-422 gap stated, mirroring the `/api/image` model named at `:1755-1759`); `graphqlErrorStatus`/`graphqlErrorDetail` (`:725-776`, the error-bucket split documented); the comment dedupe wiring (`:256-260`, `:2202-2217`, LIN-399 + `deduped`/HTTP-200 contract). `lib/proxy-ref-resolver.js` (two-layer resolver, the Linear-only namespace gate + LIN-544/581 split fully stated at `:32-38`). `lib/proxy-wire.js` (opaque-handle / no-deep-link policy + `att:`/`md:` forms + `flattenIssue` byte-identical-parity gate). `lib/proxy-dedupe.js` (F1 now resolved).

**Cluster B — provider layer (clean apart from F3):** `lib/providers/interface.js` (throw-vs-sentinel, 422-not-501, the reflection-derived capability descriptor, and the critical `ui.write ← getCreateTaskUrl` decoupling all rationalized — note this is the very module whose mechanism F3 hangs off; the mechanism is documented, the per-site trap is not); `registry.js` (self-registration lifecycle + `LEGACY_DEFAULT_PROVIDER='linear'` fallback); `models.js` / `state-map.js` (use-Linear's-real-enum decision, `getStateOrder→undefined` fallback contract); `lib/providers/linear/index.js` (slim/full fragment split LIN-442, deep child-depth query LIN-444, API-vs-dashboard query separation LIN-308, `createRelation` inverse-`blocks` sugar); `lib/providers/local/index.js` (token-as-partition-key, partial capability profile, `labels` flat-array shape LIN-406); `lib/providers/github/{index,client,fake-client}.js` (hostile-foreign-schema framing, binary-state→canonical mapping with the "would be a lie" rationale, milestone→project / number→id impedance, PR-filtering on issue lists).

**Cluster C — telemetry/summary (clean apart from F4/F5):** `lib/dispatch-terminal.js` (marker set + last-match-wins + `deriveCompletedAt`-vs-`resolvedAt` LIN-400 rationale); `lib/session-telemetry.js` parsing primitives (`parseDurationToSeconds`, `BREAKDOWN_RE` `×`-not-`x` guard, `parseModel` omitted-until-emitted rationale, `parseEvidenceArtifacts` dedupe-first-wins); `lib/run-summary.js` + `run-summary-cache.js` (recap.js lineage, `${workspaceId}:${loopId}` key + immutable-completed-run rationale + 30-day-TTL=Loop-window match + `inputHash` defence-in-depth); `lib/session-summary.js` + `session-summary-cache.js` (one-LLM-call cost contract, `maxTokens:150` "never truncates into a silent EMPTY_SUMMARY (LIN-632)", ordered-child-hash composition); `lib/sessions-feed-cache.js` (stale-while-revalidate, caches feed output not store reads to preserve the LIN-615 truncation guard, delete-on-error); `lib/sessions-view.js` (pure, deliberate omissions stated).

**Cluster D — stores / graph / goal generator (clean):** `lib/task-snapshot-store.js` (why hash-gated, why deliberately no TTL, read-time-diff-not-stored, `seq` tiebreak, the recap-hash-vs-snapshot-slice divergence pre-empted at `:63-67`); `lib/context-graph.js` (forward+inverse edge de-dupe, both blocking dimensions from one `blocks` edge set, BFS cap with explicit `truncated` counter, `spun-off`-vs-`descended` provenance disambiguation at `:289-306`, cycle-safe `_seedHierarchy`); `lib/next-run.js` (the both-paths-parity *exemption* rationale stated in-code at `:8-10`, XL-reserved-for-open-option, always-appended continue option, dropped-hallucinated-`referencedTaskIds` LIN-644); `lib/tree.js` `selectFocusSubtask` (re-walked after ~184-line churn — LIN-444 transitive dead-end frontier guard, degrade-to-identifier-order, picker-single-source-of-truth, LIN-544 source-qualified keying all annotated); `lib/workspace.js` (the LIN-562 `(provider, scope)` binding-key model, scalar-mirror-reflects-a-real-binding invariant, legacy synthesis, no-arg byte-identical `getWorkspaceToken` contract).

**Baseline clean list reaffirmed by spot-check** (unchanged or only lightly touched since `f746725`): `lib/recommend-recurse.js`, `lib/recommendation-facts.js`, `lib/graph-features.js`, `lib/kpi-stats.js`, `lib/ship-layout.js`, `lib/swim-lanes.js` / `lib/swim-graph.js` (except the F2 sites), `lib/pipeline-loops.js`, `lib/periodicals.js`, `lib/trashed-signal.js`, and the proxy trash path. `lib/tree.js` and `lib/providers/local/index.js` were *re-walked* (not just spot-checked) because they churned, and both remain clean.

---

## Notes for the next run

- **F3** is the actionable item this cycle; if its constraint-note lands, confirm it at the three provider sites and close the loop here. The deeper design smell behind F3 (a capability bit registered by a method the execution path never calls) may recur for any future capability whose gate-method and write-method differ — watch `createRelation`/`deleteRelation` and `uploadFile` for the same gate-vs-execute split as the provider surface grows.
- **F2** has now survived two cycles unpromoted. If the swim/flow modules churn again, or the `primary * BIG + secondary` idiom leaks into a non-layout (correctness/ordering-sensitive) path, promote it then; otherwise it can keep waiting — the risk is genuinely layout-only.
- **F4/F5/F6** are all Low and self-mitigated by adjacent JSDoc/intent comments; promote only if `lib/session-telemetry.js` or the GitHub provider grows a consumer that makes the unstated policy load-bearing.
- The strongest signal this run is a **negative** one: ~16k lines of net-new critical-path code (provider binding, foreign backend, wire neutralization, telemetry) landed with its rationale paraphrased in-code. The paraphrase-next-to-the-tag culture is holding; reaffirm by spot-check next cycle rather than re-walking these.

---

### Trend ledger

| Finding | Severity | Sites | Delta vs baseline | Promoted? |
|---|---|---|---|---|
| `proxy-dedupe-key-nul-separator` (F1) | Low–Medium | `lib/proxy-dedupe.js:40` | **resolved** (LIN-440) | was F1 → now closed |
| `composite-sort-key-magnitude-invariant` (F2) | Low | `lib/swim-graph.js:113`, `lib/swim-lanes.js:279` | unchanged, still open | no (2nd cycle) |
| `provider-label-capability-method-not-execution-path` (F3) | **Medium** | `lib/providers/linear/index.js:1876`, `local/index.js:578`, `github/index.js:472`, gated at `routes/proxy.js:2323`/`2383`, derived at `interface.js:134` | new | **yes — F3 follow-up** |
| `telemetry-heartbeat-state-vocabulary-unstated` (F4) | Low | `lib/session-telemetry.js:145` | new | no |
| `telemetry-runtime-crosscheck-policy-unstated` (F5) | Low | `lib/session-telemetry.js:84-103` | new | no |
| `github-recommendation-context-opts-shape` (F6) | Low | `lib/providers/github/index.js:260` | new | no |

*Run of 2026-06-25 for the Comprehension-Debt Review (LIN-370 / run LIN-674). Grounded against source at HEAD `8de7da5`, not prior prose. Baseline: `comprehension-debt-review-2026-06-12.md` at `f746725`.*
