# Documentation Review — 2026-08-23 (periodical run, drift-first, provider-generalisation era)

> **Provenance note (LIN-694).** This report was persisted retroactively on 2026-08-23. The
> review itself ran the same day, under session `voyage-advisory-reviews-2026-08-23`, but a
> conflicting operator instruction ("do NOT edit, create, or delete any file in either repo")
> prevented the file from being written at the time — the review instead posted its full
> report as a Linear comment on **LIN-1922**, exactly as its own text below anticipated
> ("A future lane can commit this verbatim"). This file is that verbatim commit. Nothing
> below has been re-derived, re-judged, or edited for content.

*Review-only: no code, docs, config or secrets changed. Severity-ranked, uncapped; follow-ups capped at 3.*

**Session** `voyage-advisory-reviews-2026-08-23`. **HEAD** `LinearViewer` @ `0e8a1461` (= `origin/main`) · `simple-dispatcher` @ `05751b28` (= `origin/main`). HEAD moved during the run (sibling lanes landed `#1211`–`#1214`); all citations are at those SHAs.

**Report artefact — the unrun step, named.** Convention is `docs/reviews/documentation-review-YYYY-MM-DD.md`. This session ran under a **hard no-file-write / no-PR constraint** (six sibling lanes through this repo today, two live in it now), so the report is **this comment, in full**. **Unrun: landing `docs/reviews/documentation-review-2026-08-23.md`.** A future lane can commit this verbatim. Everything else in the ticket's definition of done is complete.

**Prior runs read first:** `docs/reviews/documentation-review-2026-06-25.md` (which builds on `2026-06-22`). **LIN-1233** (the 2026-07-10 task that sat in Backlog unrun) is superseded by this ticket — see §5.

**Every seed re-verified, and two were wrong.** The ticket's seeds came from a different HEAD (`9ece231f`, 2026-08-07). Two did not survive verification and are corrected below rather than repeated — see §4.

---

# Findings, severity-ranked

## F1 · **HIGH** — `README.md` describes a Linear-only product, contradicts a sibling doc, and advertises a view that does not exist

**What.** At HEAD, `LinearViewer/README.md` contains:

| term | occurrences |
|---|---|
| `provider` | **0** |
| `Jira` | **0** |
| `source-neutral` | **0** |

Against a codebase where `lib/providers/` holds **five** adapters — `linear/`, `jira/`, `github/`, `github-projects/`, `local/` — plus `registry.js`, `interface.js`, `state-map.js`, and `routes/` carries `jira-auth.js`, `github-auth.js`, `github-projects-auth.js` alongside `auth.js`.

Three specific defects:

**(a) It contradicts `docs/proxy-integration.md` directly.**
- `README.md:50` — *"**Linear API Proxy** — Token-scoped REST-like access to the **Linear** workspace"*, echoed at `README.md:178` (*"Linear API Proxy consumer guide"*).
- `docs/proxy-integration.md:9` — *"The API is **source-neutral**: it exposes one provider-backed contract (flat shapes, no provider-specific URLs) rather than a passthrough to any single backend."*

Two first-class docs, opposite claims about the same API. A consumer reading README codes to Linear specifics; the proxy guide exists to tell them not to.

**(b) `## Authentication` contradicts its own README.** `README.md:53-59` states *"**Three ways to sign in:**"* and lists Linear OAuth / PAT / OpenRouter. Ninety lines later, `README.md:144-161` documents **"GitHub OAuth (optional)"** — GitHub login and adding a GitHub repository as a workspace source — in full, with env vars and callback URLs. The authentication section undercounts a surface its own document describes. *(This corrects the ticket's seed, which stated README omits GitHub login entirely — see §4.)* Jira sign-in (`routes/jira-auth.js`, `renderJiraLinkForm`) appears nowhere in either place.

**(c) The Features list advertises a view a user cannot reach.** `README.md:28` — *"**Pipeline** — Floor view reconstructing work loops from activity."* There is **no `pipeline` key in `FEATURES`** (`lib/feature-defaults.js:22-44`), no `/pipeline` route in `server.js` or `routes/*.js`, and no footer or nav entry. The only survivor of the name is the internal module `lib/pipeline-loops.js`. Per `CLAUDE.md:266`, the pipeline/autopilot dashboard was **promoted to the first-class Observation page** and its flag retired by LIN-595; `/dashboard` now 302s to `/observation`. README's six-item flat list also omits Observation — the promoted, first-class view — along with the nine experimental views, `/templates` and `/kpis`.

**Why it matters.** README is the cold-start document for both audiences this review serves. A human evaluating Harbour reads "Linear projects and issues" (`README.md:3`) and concludes it does not support their Jira board — which it does. An agent grounding itself on README will not discover the provider layer at all, and will encounter `data-source="github"` selectors (`public/llms.txt:76`) with no model for them. And a reader who clicks looking for "Pipeline" finds nothing: a doc that names a non-existent feature is worse than one that omits a real one, because it costs the reader a search before they conclude the doc is unreliable — and once they conclude that, the accurate 90% stops being load-bearing too.

**What I would do.** Three edits, all subtractive-or-corrective, no net-new prose:
1. `README.md:3`, `:50`, `:178` — "Linear" → "your task source" / "workspace"; point the proxy bullet at the source-neutral wording `proxy-integration.md:9` already owns.
2. `README.md:55` — "Three ways to sign in" → the real set, with GitHub (already written at `:144`) and Jira folded into the Authentication section rather than stranded under Setup.
3. `README.md:28` — delete the Pipeline bullet; add Observation. Replace the flat list with a pointer to `docs/view-tiers.md` rather than a second hand-maintained inventory *(conditional on F2 landing — as it stands, that doc is stale too)*.

**Confidence: verified at HEAD** — every count and line reference re-read at `0e8a1461`.

---

## F2 · **HIGH** — `docs/view-tiers.md` claims to mirror a code constant "in order" and is missing 2 of 9, and a sibling review is now formally instructed to distrust it

**What.** `docs/view-tiers.md` introduces its experimental section as *"Members (the shared `EXPERIMENTAL_VIEWS` list, **in order**)"* — an explicit promise to mirror `lib/feature-defaults.js:166-176`. At HEAD:

| `EXPERIMENTAL_VIEWS` (`lib/feature-defaults.js:166`) | in `docs/view-tiers.md` |
|---|---|
| `collective` | ✓ |
| `task-chat` | ✓ |
| `ship` | ✓ |
| `next-run` | ✓ |
| `flight-companion` | ✓ |
| **`passage-planner`** | **absent** |
| `ship-biscuit` | ✓ |
| **`live-console`** | **absent** |
| `ship-journey` | ✓ |

**7 of 9**, and the doc's ordering does not match the constant's either (it lists shipBiscuit before shipJourney with the two missing entries simply dropped, so the "in order" claim fails independently of the omissions).

**Why it matters — and why this outranks an ordinary stale list.** The consequence has already materialised **in this same batch of review tickets**: LIN-1924 (Design & Interface Review) carries a standing instruction — *"⚠️ `docs/view-tiers.md` **is a stale inventory** — its experimental-tier list omits `passagePlanner` and `liveConsole`, both of which are live members of `EXPERIMENTAL_VIEWS`. **Trust the code, not the doc.**"* A document that other reviews must be explicitly told to route around has negative value: it costs maintenance, and every consumer has to independently rediscover that it lies. Both omitted views are also user-facing surfaces with their own stylesheets, so anyone using this doc to enumerate the UI misses two whole pages.

**What I would do.** **Nothing new — [LIN-1856](https://linear.app/issue/LIN-1856) already owns this**, filed when the gap was 6-of-7. **Not minted; the updated table above is posted to LIN-1856** so it carries the current measurement (the gap has since widened to 7-of-9). LIN-1856's own scope note already proposes the durable fix and it is the right one: **stop hand-maintaining the list** — document `EXPERIMENTAL_VIEWS` as the single source of truth and have the doc point at it, rather than mirroring it a fourth time. Three consecutive experimental-view landings (`04df53b9`, `574871b6`, `5fb198a3`) touched the constant and not the doc; there is no precedent for the mirror surviving.

**Confidence: verified at HEAD.**

---

## F3 · **MED-HIGH** — `simple-dispatcher`'s `.env` documentation omits the credential broker entirely, and 45 of 68 env vars appear in no document at all

**The repo this series has never reviewed.** Every prior Documentation Review report covers `LinearViewer/` only. `simple-dispatcher/` ships its own `README.md` (217 lines), `CLAUDE.md` (530 lines) and `docs/`, is tracked on this board, and sibling periodicals already treat it as in scope. Folding it in was the largest single scope widening this run made, and it produced the finding below.

**What.** `simple-dispatcher/README.md:36` opens the configuration section with *"Create a `.env` file:"* and a fenced block — framing itself as the operator's complete configuration surface. Measured at HEAD:

| | count |
|---|---|
| env vars read by the code (`process.env.X`, excluding `test/` and `node_modules/`) | **68** |
| documented in `README.md` | 16 |
| **absent from `README.md`** | **52** |
| **absent from `README.md` *and* `CLAUDE.md` *and* `docs/`** | **45** |

**The seven that are in `CLAUDE.md` but not `README.md` are the ones that matter most.** They include the whole credential-broker triad:

```
HARBOUR_BOOTSTRAP_TOKEN     harbour-token-mcp-server.js:341
HARBOUR_PROXY_BASE          harbour-token-mcp-server.js:342, :348
HARBOUR_LOCAL_PORT          harbour-token-mcp-server.js:347
```

`README.md` mentions `HARBOUR_` exactly once, at `:211` — inside a quoted example of a *prompt*, not as configuration.

Of the 45 in no doc at all, most are timing knobs (`LAUNCH_*_MS`, `OPENCODE_*_MS`, `HEARTBEAT_TRANSCRIPT_SCAN_*`) where silence is a defensible choice and I am not counting them as a finding. About ten are not: **`SD_STATE_FILE`, `SD_OPLOG_FILE`, `SD_SESSION_TMP_ROOT`, `SD_RESOURCE_METRICS_FILE`** (where durable state and logs land on disk), **`WORKSPACE_CLONE_ROOT`, `SD_CLONE_STRATEGY`** (`config.js:318` — where it clones repos, and how), **`LAUNCH_MAX_WINDOWS`** (the concurrency bound), **`MAX_PENDING_EXTERNAL_REFIRES`**, **`SD_ZERO_TOOL_DONE_GUARD`**, and the `SD_*_RELAY` family.

**Why it matters.** An operator standing up a dispatcher from `README.md` cannot configure a broker-armed launch — the mechanism `CLAUDE.md:295-303` describes as carrying *"the dispatch's single-use"* credential, and the path built in direct response to the 2026-07-07 prompt-injection break. They also cannot find where their state file or clone root lives without reading `config.js` (753 lines, 85 `process.env` reads). The information is not missing from the repo; it is **only in the agent-facing document**, so the human entry point is the one that fails. That inversion is the same recurrence class the 06-22 and 06-25 runs both flagged — a first-class configuration surface lands in code and never reaches the entry-point doc — appearing for the first time in the second repo.

**What I would do.** Add a `## Broker / Harbour connection` subsection to `README.md`'s env block covering the three `HARBOUR_*` vars, and a short "Paths and limits" block for the ~10 operationally significant `SD_*` vars, each one line. Alternatively, point `README.md` at `CLAUDE.md`'s existing broker section rather than restating it — but the pointer must exist, because today there is none. **Minted: see §5.** Related, same file, different gap: **LIN-2177** item 2 (README omits LIN-2172's hard startup requirement) — cross-linked, not duplicated.

**Confidence: verified at HEAD.**

---

## F4 · **MED** — `public/llms.txt` opens by telling agents the product is Linear-only, then spends 400 lines proving otherwise

**What.** `public/llms.txt` is the agent-facing entry document. Its first seven lines:

```
:3   > A minimal web app that displays Linear projects and issues as a collapsible tree…
:7   - Syncs with Linear via OAuth
```

Its body is thoroughly provider-aware and current:

```
:51   .detail-link  — "View in {provider} →" link (provider name is dynamic…)
:76   [data-testid="issue-source"] — per-task source flag, e.g. data-source="github"
      (present only in a multi-provider workspace; absent for single-source/Linear-only)
:96   [data-testid="task-create-form"] holds EXACTLY the provider's declared createFields()
      — never a fixed set — so which of these appear varies by provider
:97   [data-testid="issue-edit-link"] — only when the provider supports in-app edit (ui.inlineEdit)
```

**Why it matters.** The file's own format convention puts the summary blockquote at the top precisely so a consumer can orient from the first lines. An agent that reads `:3` and `:7` and stops — the normal behaviour for a summary block — builds a Linear-only model and then hits `data-source="github"` and per-provider `createFields()` with no framework for them. This is the *only* doc in the tree written specifically for the agent audience this review serves, and the two lines a cold agent is most likely to read are the two that are wrong.

**What I would do.** Two-line edit: `:3` → *"…displays your task sources' projects and issues…"*; `:7` → *"Syncs with Linear, Jira, GitHub and GitHub Projects via OAuth or API token."* Nothing else in the file needs to change — the body is already correct. **Minted: see §5.**

**Confidence: verified at HEAD.**

---

## F5 · **MED** — `CLAUDE.md`'s file map has re-drifted on three axes, and hand-maintenance is the pattern, not the incident

**What.** `CLAUDE.md` presents an exhaustive file-by-file map (every `lib/` module listed with a description). At HEAD it has drifted on three axes at once:

| axis | doc | code | gap |
|---|---|---|---|
| `lib/components/` block (`CLAUDE.md:181`) | **3** entries (`navbar.js`, `footer.js`, `landing-hero.js`) | **20** files | 17 absent |
| `routes/*.js` map | 18 of 22 named | 22 files | **4 absent**: `flight-companion.js`, `github-projects-auth.js`, `ship-biscuit.js`, `task-create.js` |
| `lib/*.js` map | 113 of 168 named | 168 modules | **55 absent (33%)** |

The 17 missing components are the entire primitive layer: `button`, `card`, `disclosure`, `empty-state`, `field`, `icon`, `icon-button`, `page`, `page-header`, `section`, `segment-bar`, `status-pill`, `surface`, `tag`, `view-nav`, `wordmark`, `accent-bar`.

**Why it matters, and why I am *not* promoting it.** The seed named one missing route (`github-projects-auth.js`); it is four. The seed recorded the components gap as "was 2-of-9, now 3-of-20"; confirmed at 3-of-20. So the drift is real and widening on every axis.

But **this exact finding has now been filed and fixed twice** — LIN-601 and LIN-664, both Done, both Documentation Review runs, both against this same map. It has re-drifted both times, and this run's measurement shows it drifting faster as `lib/` grew to 168 modules. **Filing a third "backfill the map" ticket would produce a third temporary fix.** The finding here is not the 55 missing entries; it is that **a hand-maintained exhaustive file map cannot survive a repo adding ~40 modules a month**, and every run that backfills it is buying a few weeks.

**What I would do — a human decision, not a ticket.** Pick one:
- **(a)** Keep the map exhaustive and generate it (a `scripts/` pass emitting the file list, with hand-written descriptions kept in a sidecar for the modules that need one), or
- **(b)** Stop claiming exhaustiveness: cut the map to the ~30 load-bearing modules, say so explicitly at the top, and let the rest be discovered from the tree.

Both are cheap; the current middle position — an exhaustive-looking map that is 67% complete — is the expensive one, because a reader cannot tell absence-means-doesn't-exist from absence-means-not-yet-written. **Not minted:** the choice is architectural and belongs to a human, and the two prior tickets prove that minting the mechanical version does not hold.

**Confidence: verified at HEAD.**

---

## F6 · **LOW-MED** — `docs/direction-layer-proposal.md:21` still counts a transport layer that was deleted

**What.** `docs/direction-layer-proposal.md:21`: *"There are **four** transport layers for getting prompts to agents (dispatch queue, proxy API, **Linear CLI**, llms.txt + data attributes), at four different coupling levels."*

`lib/linear-cli.js` does not exist at HEAD — deleted by LIN-580. There are **three**.

**Why it matters, at its true grade.** This is a *proposal* document, not a contract or an entry point, and the sentence is descriptive prose about methodology rather than an instruction anyone follows. Its cost is that the number "four" is load-bearing in the argument the paragraph makes (*"at four different coupling levels"*), so a reader reconstructing the design rationale reconstructs it wrongly — and it is cited as prior art by the direction-layer work still open on the board (LIN-1647, LIN-1648).

**What I would do.** One-line edit: "four" → "three", drop "Linear CLI", adjust "four different coupling levels". Recorded, not minted — below the cap and below F1–F4 on consequence. *(Carried forward from the previous run's recorded-but-never-promoted list; still true, still unfixed, third run to record it.)*

**Confidence: verified at HEAD.**

---

## 3. Clean results — checked, and genuinely fine

Reported because a clean result is an outcome, and because two of these were seeds I expected to fail:

- **`docs/dispatch-protocol.md` has zero provider mentions, and that is correct.** The seed flags this as drift. It is not: `:1-9` declare the file *"the inter-agent communication contract … It defines **behaviour**, not implementation — any conformant dispatcher … can be built against it"*, with RFC-2119 keywords. It governs dispatcher↔session-node messaging, a layer that has no task-source dimension. Adding provider language would make it worse. **Explicitly not flagged.**
- **`simple-dispatcher`'s harness/target contract is well documented and accurate.** `README.md:13-29` covers both axes properly: `cli` vs `web` (*"`web` is literally `cli` plus the `--remote-control` launch flag"*), `claude-code` vs `opencode`, the hook-substrate difference, the sentinel-file completion mechanism, the resolution precedence chain (payload > `workspaces.json` > `DEFAULT_HARNESS`), and the rejected combination (`opencode` + `web`) with its reason. Verified against `harnesses.js` / `targets.js` / `config.js`. This is the highest-quality doc surface I read in either repo. Not a finding.
- **`CLAUDE_CODE_BUBBLEWRAP` in `simple-dispatcher/README.md:89` is accurate, not stale.** A mechanical env-var diff flags it as documented-but-never-read. Reading it: `:86-92` names it only to say what `SD_ALLOW_ROOT` deliberately does **not** mirror, and `config.js:256` carries the matching comment. Correct as written; **would have been a false finding.**
- **`periodicals-stale-rationale-counts` — confirmed fixed, not re-flagged.** `lib/periodicals.js:49-50` reads *"12 corrective … 3 advisory"* and `:61` *"the fifteen"*, against a registry of exactly **15** entries. Closed as the seed says.
- **LIN-685 / LIN-686 confirmed Done and left alone**, per instruction.
- **`docs/proxy-integration.md:9`'s "currently backed by Linear"** — kept as accurate. Jira and GitHub-Projects adapters exist in `lib/providers/`, but the sentence is scoped to *"Workspaces are **currently** backed by Linear"* and hedged by the source-neutral instruction that follows it. Borderline, and I am calling it fine rather than manufacturing a finding; F1 makes README match this file, not the reverse.

---

## 4. Seeds corrected — supersession, not silent edit

Two of this ticket's seeds did not survive verification at HEAD. Recording the corrections rather than quietly working around them:

1. **"`README.md` … omitting GitHub login (which CLAUDE.md documents)."** — **Partly wrong.** `README.md:144-161` documents GitHub OAuth in full, including scopes, env vars and callback URLs. The real defect is narrower and different in kind: `README.md:55`'s *"Three ways to sign in"* contradicts `README.md:144` within the same document. Restated as F1(b).
2. **"`docs/dispatch-protocol.md` has no provider mentions at all"** (listed among agent-facing drift) — **not a defect.** See §3. Removed from the finding set.

Both seeds were explicitly labelled *"a starting point … not the truth"* by the ticket, and both were re-checked before use, exactly as instructed.

---

## 5. Follow-ups minted — 3, at the cap

| ticket | finding | why promoted |
|---|---|---|
| **LIN-2248** | **F1** — README: provider generalisation, the self-contradicting auth section, and the phantom "Pipeline" view | The cold-start doc for both audiences, contradicting a sibling doc and naming a view that does not exist |
| **LIN-2249** | **F3** — `simple-dispatcher/README.md`: broker env vars + the operationally significant `SD_*` set | Credential-broker configuration is undiscoverable from the human entry point; first finding ever raised against this repo by this series |
| **LIN-2250** | **F4** — `public/llms.txt:3,7` provider framing | Two-line fix on the only doc written for the agent audience; the two lines a cold agent reads first |

**Not minted, deliberately:** F2 (**LIN-1856 already owns it** — updated measurement posted there), F5 (architectural choice for a human; two prior tickets prove the mechanical fix does not hold), F6 (recorded, third run).

**Superseded:** **LIN-1233** — the 2026-07-10 Documentation Review task that sat in Backlog unrun. Its seeds predate the provider layer and are ~6 weeks stale; everything in it is folded into this run. Recommended for close as superseded — I have not changed its state, since closing another review's ticket is not this review's call.

---

## 6. Sibling seams — deferred, and said so

- **Comprehension-Debt** works at module/system altitude and defers per-comment accuracy to this review. I read inline comments throughout both repos as part of the drift pass and found the density and quality unusually high — several leads (§3's `CLAUDE_CODE_BUBBLEWRAP`, the two nested `:root` blocks in `style.css`) resolved to non-findings *because* the code carried its own rationale. **No inline-comment findings.**
- **API Quality / Design & Interface** own API and UI *design*; this review owns whether the contracts are documented and current. F1(a) is a documentation contradiction, not an API-shape judgement.
- **Onboarding & Cold-Start** reports only where following an instruction failed mid-walk. F1 and F3 are doc-vs-source drift, not walk failures — I did not walk either setup.
- **Drift & Coherence** owns cross-artifact coherence. F5's *cause* (a hand-maintained map against a fast-growing tree) touches their remit; the *drift measurement* is mine, and I have not proposed a convention change.
- **Code Quality (LIN-1920, this batch)** owns the fact that `/api/proxy/instructions` is a 678-line documentation blob living inside `routes/proxy.js` — treated there as code bulk. Its **content** is a doc surface and is mine: I checked it against the live endpoint list and found it current, including the newest additions (`/periodicals`, `/passage-runner/prompt`, the bootstrap-token exchange). **No finding.**

---

## 7. Trend ledger — against the 2026-06-25 baseline

| item | 06-25 | 08-23 | movement |
|---|---|---|---|
| `readme-provider-drift` | — | 0 provider/Jira mentions; contradicts `proxy-integration.md:9` | **new, high** |
| `readme-phantom-pipeline-view` | — | `README.md:28` names a view with no flag and no route | **new, high** |
| `readme-omits-view-tiers` | recorded, unpromoted | still flat, and now stale in name | **worsened → folded into F1** |
| `view-tiers-experimental-list` | — | 7 of 9; a sibling review told to distrust the doc | **new, high (LIN-1856 owns)** |
| `simple-dispatcher-env-undocumented` | never reviewed | 52 of 68 absent from README; broker triad absent | **new baseline, med-high** |
| `llms-txt-linear-only-framing` | — | `:3`, `:7` vs provider-aware body | **new, med** |
| `claude-md-components-undercount` | 2 of 9 | **3 of 20** | **worsened** |
| `claude-md-routes-map-drift` | fixed twice (LIN-601, LIN-664) | 4 routes absent, 55 of 168 lib modules absent | **re-drifted, third occurrence** |
| `direction-layer-proposal-stale-cli-transport` | recorded | unchanged — still "four … Linear CLI" | **unchanged, third run recorded** |
| `periodicals-stale-rationale-counts` | flagged | 12/3/fifteen vs 15-entry registry | **resolved** |
| `proxy-error-list-exhaustiveness` (LIN-686) | flagged | Done | **resolved** |
| `claude-md-github-auth-surface` (LIN-685) | flagged | Done | **resolved** |
| `dispatch-protocol-provider-silence` | — | checked; correct by design | **non-finding** |
| `simple-dispatcher-harness-contract` | never reviewed | accurate and complete | **clean baseline** |
