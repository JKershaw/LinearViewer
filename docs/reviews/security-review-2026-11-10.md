# Security review, delta vs 23 Oct 2026 (LIN-4411)

**Reviewed at HEAD `4d23fa15`** (`origin/main`, 10 Nov), **474 commits** after the 23 Oct review (`c6c5585a`). The ticket was seeded at `008d38bb` (470 commits). The four commits between the seed and this HEAD are the LIN-4412 Dependency review's docs only (`git diff --name-only 008d38bb..4d23fa15` names nothing outside `docs/`), so no cited code moved. The PR was then rebased onto `80f4c7c8`; the commits it adds (LIN-4406, the Documentation review) are also docs only, so the measured code is unchanged. Every `file:line` below was re-read at `4d23fa15`. simple-dispatcher (SD) was read at `5d8489e`.

**Baseline:** `docs/reviews/security-review-2026-10-23.md` (LIN-3776). **Remit:** `generateSecurityReviewPrompt`, `lib/periodicals.js` (`id: 'security-review'`).
**Mode:** review only. This PR changes this report and six area notes, nothing else. No live or mutating call was made, and no `npm audit`. **No secret value appears in this report**: credential hits are described by shape, and every injection mechanism is described by its route, never as a reusable payload. On the SD host only file metadata was read (`stat`/`find`), never file contents, and no credential was exchanged.

A research pass (ticket comment, 10 Nov, five fresh read-only sub-agents) supplied the provisional verdicts. This run re-read every load-bearing citation at HEAD. It also did the work research did not: the nine roadmap and Ship's Biscuit prompt builders, one row per added or moved route, the sanitiser call sites, the Dependency 11-10 report and the Railway incident record, and a fresh credential scan of tree and full history. Mutation counts marked *(research)* are quoted from that pass and were reverted there. Counts marked *(this run)* were measured here, and each mutation was reverted before commit.

## Verdict

**No Critical. No cross-workspace read or write on either Harbour lane** (session or proxy) in the window. **No live secret in the tracked tree or any commit.** One cross-workspace path *does* exist, on the SD host, beside Harbour's lanes rather than on them (row 2).

The top-ranked open item is still **LIN-3386, forged authority marks (High, existing ticket)**. It has grown again, from 7 members to **11 in code plus 4 in prompts**, and one new member (the As-asked block and size record, row 7) now has a server guard that *protects* a forgery once it is in place.

**Ranked second, and raised by the second read:** SD's credential broker (row 2, High where one SD host runs sessions for more than one workspace). Each session's broker listens on a loopback TCP port. It injects that session's working token into any `/api/proxy/*` request, and never asks who is calling. Any process on the host can therefore act as any live session, in any workspace that host serves. This sits on the SD side, so it goes to the person.

The largest new item **on the Harbour side** is the **area notes**: they have become a persistent, cross-task prompt surface (row 2a, Medium-High; High wherever a workspace bound to a public repo runs close-out or autopilot). Prompts tell every builder that "Lessons bind how you work". The guard checks shape, not content. Close-out writes review-worded entries to main and is told no one reviews what it changes after the approval. Which comment counts as "the review" is decided by text, which is LIN-3386 again.

Six more Mediums are new or newly assessed:

* the Jira escaping that defeats `/t/` masking (row 5);
* SD's bootstrap files, never deleted (row 6, the file half of row 2);
* the As-asked and size-record forgery (row 7);
* the Collective preview returning `YAP_PASSWORD` (row 8);
* N4, never fixed (row 9);
* LIN-3789's partial fix (row 10).

Most of the window's closure claims hold as an attacker would test them (fix-claim table). LIN-3772 changed docs only. LIN-3643 never touched the 301. **LIN-4215 rates Low**: member keys carry no grants, so they make existing member power portable without widening it.

## Remit decisions

* **SD runner contract: widened from "contract input" to read-and-report** for bootstrap delivery and the broker: SD `harnesses.js` `writeClaudeMcpConfig` and `harbour-token-mcp-server.js`. The reasons are a host-verified exposure (row 6) and the broker's loopback listener (row 2). No SD file was changed, and no file contents were read. SD findings have no LinearViewer area file to cite, so they go to the person in the closing comment.
* **The vendored libraries.** The ask keeps "the vendored `public/*.min.js` (DOMPurify, marked, Chart.js), which sit outside `package.json`" with this review. That premise no longer holds. LIN-3787 (`d81aebd2`) deleted those files. All three are now declared in `package.json` and served from `node_modules` by `lib/vendor-assets.js` at the old URLs, and Dependency 11-10 F4 verifies the bytes served. The ask kept them here so that browser libraries are not left running unaudited. This run serves that purpose with the half no sibling owns, **how the sanitiser is called** (see "New surface", sanitiser verdict). Provenance and advisories for the bundles now sit with Dependency and LIN-620. Old row #20 closes.
* **The CVE seam.** The two documents point at each other. `lib/periodicals.js` gives known CVEs to the Dependency review (and so does this ticket). Dependency 11-10 §5 says "Generic CVE scope belongs to the Security Review". This run carries advisory triage by pointer to LIN-620 and takes only the **abuse half**: two advisories that bear on controls this report reasons about (rows 10 and 11). The ownership wording goes to the person, and there is no area file to cite for it.
* **Integration 11-10 R13 / LIN-2150** (`OwnerCredentialStore` still built beside the Connection seam) names this review as owner. It is a **pointer only**, not re-traced.
* **Seams have no full home in the notes yet.** A cross-area finding is filed under the area a change would start from, naming the other side (row 5: masking, with providers).

## Severity-ranked findings (delta vs 2026-10-23)

| # | Sev | Delta | Finding | Ticket |
|---|---|---|---|---|
| 1 | **High** | **unchanged, grown (7 → 11 code + 4 prompt)** | **Forged authority marks.** Carried members: review and ledger match by title plus verdict word (`lib/run-ledger.js:49-56`); the ruling suffix (`lib/recommendation-facts.js:46`); PR links from any comment (`lib/run-evidence.js:37-61`); the selector's ruling label; close-out readiness (`lib/close-out-readiness.js:78`); CI-wake PR resolution (`lib/ci-wake-sweep.js:69`); the revision brief's latest review (`lib/prompts/revision-brief.js:62`). **New:** look-first counts any comment whose first line is the Survey heading as attempted (`lib/recommendation-look-first.js:95-100`), and holds the route on a "person comment" judged by text shape (`:133-142`); the size record's `Decided by`, read from description text (`lib/size-of-move.js:169-181`), feeds the selector (`lib/recommendation-facts.js:581`) and look-first (`lib/recommendation-look-first.js:158`); `readFact` (`lib/as-asked.js:231`). Prompt grants: `lib/prompt-template-defs.js:603`, `:925`, `:982`, `:1039`. On a public-repo workspace the author is anyone with a GitHub account. | LIN-3386 |
| 2 | **High** where one SD host runs sessions for more than one workspace (the normal setup: SD loads several workspaces from `workspaces.json`); Medium-High otherwise | **new to this series (SD side); raised by the second read** | **SD's broker serves any local caller as the session.** `harbour-token-mcp-server.js` binds a loopback TCP port for each session (SD `5d8489e`, `:425`, fallback `:420`). It forwards every `/api/proxy/*` request with that session's working token injected (`:286`). It checks no caller: no per-session secret, no peer check, no Host check. Its only gate is the `X-Harbour-Intent: write` header (`:253-254`), which any caller can add. Any process on the host, under any OS user, can find a live session's port (scan the ports, or read it from the session's config file, row 6) and act with that session's 48 h readWrite credential, in that session's workspace. If the session also holds `dispatch` (an autopilot or kickoff child), the caller can enqueue too. The port is live for the whole session, so this does not need an unconsumed bootstrap. Harbour's own runner broker shows the fix: a Unix socket, with the bootstrap passed on stdin (`lib/runner-kit/broker.mjs`). See §C. | none: person |
| 2a | **Medium-High** (High where a public-repo workspace runs close-out or autopilot) | **new** | **Area notes are a persistent, cross-task prompt surface.** See §A. | none: note + report |
| 3 | High | unchanged | `workspaces {urlKey:1}` is not unique (`lib/db-indexes.js:529-533`, `options: {}`). Old row #16 stays dormant. | LIN-3394 |
| 4 | High | unchanged | Bootstrap token inline in prompt text for explicit non-`claude-code` harnesses (`lib/proxy-preamble.js:427-428`). | LIN-1410 |
| 5 | **Medium** | **new** | **Jira text defeats `/t/` masking.** See §B. | none: note |
| 6 | **Medium** | **new to this series (SD side; host-verified)** | **SD writes each session's bootstrap (and broker port) to a file it never deletes.** It is the file half of row 2. See §C. | none: person |
| 7 | **Medium** | **new mechanism; class of LIN-3386, report-only** | **The As-asked block and size record can be forged off the proxy lane, and the proxy guard then protects the forgery.** See §D. | LIN-3386 (member) |
| 8 | **Medium** | **new to this series (predates window)** | **The Collective preview returns the server's `YAP_PASSWORD` to any signed-in member.** See §E. | none: note |
| 9 | Medium | **N4 unaddressed, grown** | Any dispatch holder's kickoff `goal` is rendered as "Goal from the human" (`lib/prompts/autopilot-kickoff.js:733`, `:740-741`, byte-identical to `c6c5585a`), and `lib/prompts/autopilot-precedence.js:33` now ranks "an explicit goal from the human" **first**. New in the same class: the periodical mint `note` (`routes/proxy-dispatch.js:310`, dispatch grant) is JSON-quoted, single-line and at most 500 characters, but it is attributed to "The operator who minted this run". Stage 1 is told to copy it verbatim into the new task's description (`lib/periodicals.js:1356`), where later stages read it unquoted. This ticket's own first line is such a note. On its own it is Low-Medium, because a dispatch holder can already send any prompt; the harm is the human or operator *attribution*. LIN-1374 was closed on 30 Oct on other phrases. | none (LIN-1374 Done): note |
| 10 | Medium while email sign-in is on; **latent while `EMAIL_TRANSPORT=off`** | **partial fix** | **LIN-3789.** See §F. | none: note |
| 11 | Medium | unchanged | **LIN-3778:** the runner token sits at `~/.harbour-runner/<urlKey>/runner.token` (`lib/runner-kit/runner.mjs:821-825`), and the prompt still says "You never hold a token" (`:964`). **LIN-3402 / LIN-3417** unchanged. **LIN-620** by pointer: Dependency 11-10 F1 counts 15 advisories. Abuse half: `body-parser` GHSA-27r3 is reachable **before authentication** through every inflating parser. The `uncaughtException` backstop in `server.js` absorbs the termination, and LIN-4412 review re-ran the trigger on Node 24.22.2 with the process staying alive, but no test pins that backstop. | LIN-3778, LIN-3402, LIN-3417, LIN-620 |
| 12 | Low-Medium | **new** | **Proxy model-routing writes** (`routes/proxy-model-routing.js:189-213`). Once any member turns on `modelRoutingProxyWrites` (default off, `lib/feature-defaults.js:202`; no owner gate, `routes/settings.js:418`), **every** readWrite key, including each leaf worker's 48 h key, can re-route jobs, groups and presets workspace-wide. OpenRouter ids are shape-checked only, and the proxy lane skips the Settings runnable check. **Amplification (second read):** `harness` is a writable field on the agent-session surface (`lib/model-routing.js:47`), and the table's harness feeds dispatch (`lib/dispatch-factory.js:621-625`). Any value other than `claude-code` switches to prose delivery (`lib/proxy-preamble.js:32-34`). So a readWrite leaf key can route every later dispatch in the workspace onto the LIN-1410 inline-bootstrap path. Each write is logged, needs a reason and can be undone. Scoped to the token's own `urlKey` (`:161`). The switch is off by default, which is why the row stays Low-Medium. | none: note |
| 13 | Low-Medium | re-rated down | LIN-3422: D4 closed **for the free key** (fix-claim table). The paid-key branch is uncapped like every other paid spender. No census test checks gating. | LIN-3422 |
| 14 | Low-Medium | **wider** | LIN-3273 has a second unbudgeted member: `routes/workspace-api-run-evidence.js:166`, `:182` pass `seam.readPrStatus`, which is set only in tests, so production falls back to `readPrStatusFailOpen` *(research)*. LIN-684 unchanged. | LIN-3273, LIN-684 |
| 15 | Low | **new** | **`NODE_ENV` is the only production signal** for seven controls: the `SESSION_SECRET` refusal; both secure cookies (`lib/session-options.js:78`, `lib/user-preferences.js:504`); `trust proxy` (`server.js:1208-1210`); the HTTPS 301 (`:1213-1218`); HSTS; the console-email refusal (`lib/email-transport.js:83`). If `NODE_ENV` is unset, each fails open silently. Without `trust proxy`, every per-IP limiter collapses into one global bucket, which brings back a LIN-3771-style lockout as a 429. Test routes check `==='test'` and stay unmounted. | none: note |
| 16 | Low | **new** | **Public `GET /t/:token/timeline`** (`routes/task-share.js:298-312`). Token checks, `no-store` and spend stripping are present. It still shows model names, dispatch item ids and, for a lineage founded elsewhere, that task's identifier (`lib/render-task-timeline.js`), against the route's own "no identifier outside the shared task" comment. **No test pins the mask: removing `maskFragment` from the route fails 0 of 84 tests** across the five task-share and timeline files *(this run)*. Same workspace only. | none: note |
| 17 | Low | **new** | **Scanner residuals** outside LIN-2853's four. Quoted dotenv, YAML/JSON-form assignments, env values containing `/`, and credentialed `postgres` URIs gave **0 scanner hits each** *(this run, synthetic strings built at run time)*. Also missed *(research)*: a truncated PEM inside a blockquote or a JSON string, and PuTTY keys; Slack tokens are only partly masked. **No mint-site census**, so a new raw random credential would mint unprefixed and the scanner would not know its shape. Magic links (`lib/email-auth.js`, 15 min, single use) and `/t/` share tokens stay unprefixed. | none: note |
| 18 | Low | residual | LIN-3779 residual: a *human* Flight Companion turn can still read tracker text through `get_comments`/`get_brief` and `remember` it into `## Playbook` (`lib/prompts/flight-companion-brief.js:418-419`). Auto-wake and boot turns are closed (`lib/agent-turn.js:273`). | none (report) |
| 19 | Low | **first assessment** | **LIN-4215.** See §G. **Recommend closing as accepted.** Optional hardening: a shorter TTL for member-minted keys, and a membership recheck at use. | LIN-4215 |
| 20 | Low | **new** | **Saved roadmap prose is re-served to agents.** `POST /workspace/:urlKey/api/roadmap/reports` (`routes/workspace-api-roadmap.js:184-216`) stores whatever `narrative` object the client sends (no check that it is model output). `GET /api/proxy/north-star` (`routes/proxy-compute.js:771`) then serves the digest, the reading and the gap (each capped at 4,000 characters) to any token, and `lib/proxy-instructions.js:421` advertises that route to dispatched agents. The roadmap layers also paste tracker text unfenced, and the gap layer calls it "the source of truth" (`lib/prompts/roadmap-gap-template.js:70`), so public-repo text can be laundered into a field labelled as a reading. A member could write the same text into an issue, so this adds no power. It is the LIN-3402 stance problem (text arrives without a data frame), and is reported only. | LIN-3402 (class) |
| 21 | Low | **new** | **Test gaps on security controls:** the `proxyLimiter` `PROVEN_CREDENTIALS_CAP` eviction (0/3 *(research)*); SD broker's `127.0.0.1` bind (0/132 bound to all interfaces *(research)*); `urlKey` in model-routing preset/undo filters (0/158) and in the usage-intake filter (0/81) *(research)*; write scope on description/below, append and issue PATCH individually, where only the shared `writeAuth` is pinned. `POST /api/proxy/runner/usage/:id` is `take`-gated without write scope, as are its runner siblings. Runner usage `costUsd` has no upper bound (`lib/request-usage-intake.js:78-85`), so a take holder can inflate its own items' recorded cost. | none (report) |
| 22 | Low | carried (+3 new members) | #12 the 301 from `req.hostname` (`server.js:1213-1218`, untouched since January; LIN-3643 did not change it). #13 the `local` spawn has no owner gate, because `isRunnerTarget('local')` is false (`lib/runner-owner-gate.js:24-26`); `app.listen(PORT)` binds all interfaces, `server.js:4674`. #14 `/kpis` small counts. #18 `lib/render.js:1119` `issue.url`, **plus a missed member at `:489`** (`project.url`/`linkText`, unescaped; CSP backs both); custom templates raw; `lib/bash-tool.js` still has no importers; `lib/harbour-spawn.js` `clone` without `--`. **New members:** the session transcript link puts an agent-supplied `url` in `href` with HTML escaping but no scheme check (`public/session.js:132`; none in `lib/dispatch-feedback-validation.js`; the CSP's `script-src` without `'unsafe-inline'` should stop it running). `POST /auth/openrouter/consent/clear` has no CSRF token and relies on `sameSite:'lax'`, like its siblings. The run-summary, session-summary and scan POSTs spend LLM calls with no limiter, gated only by the free-tier check (moved, behaviour unchanged). Also LIN-676, LIN-3616/3617 (decided), LIN-3281, LIN-2530, LIN-2642, LIN-1912, LIN-3425, LIN-3836, LIN-3770, LIN-2850, LIN-2853: all carried, none re-rated. | as listed; else report |
| 23 | Info | **new** | `docs/reviews/_evidence-2026-11-08/authenticated/lighthouse-*.json` (6 files) commit session cookies minted on `localhost:3199`. They are dead local artifacts, but this is the **second** evidence dir to do it (after `_evidence-2026-10-21`, also 6). `/getting-started(.md)` is a new public page, but it is not in `BASE_PUBLIC_PAGES` (`lib/scan-public-pages.js:21-26`). Dispatch-token usage matches legacy rows by token label (`ownershipFilterOf`, `lib/dispatch-store.js`) when no token id was recorded. | none: person |
| closed / improved | n/a | n/a | Old #20 vendored libs (remit decision above). Old #15 mostly closed: only `docs/operator-execution.md` carries `MONGO_PUBLIC_URL` commands, under its history banner. **LIN-737 is mitigated in code** (`routes/proxy-reads.js:613-615`: always `application/octet-stream`, `attachment`, `nosniff`), so it is a **candidate to close**. **LIN-3593 is tested** (mutation 1 of 1,542, `tests/unit/authenticated-pr-reads.test.js` *(research)*), also a **candidate to close**. Old #17: erasure covers 59 of 59 collections, new ones included. HSTS without `includeSubDomains` is a recorded decision (`lib/response-headers.js:7-8`, for `os.harbour.cat`), not a finding. | n/a |

### §A. Area notes as a persistent prompt surface (row 2a)

* **How notes reach a prompt.** Notes are pointed at, not inlined. `formatAreaNotesPointer` (`lib/prompt-formatters.js:603-605`) says "Lessons bind how you work". `GROUNDING_BY_KIND` (`:634-645`) gives it to implementation, bug, plan, research, design, spike, review and scoping. This prompt's own text carried that sentence.
* **Writers (4).**
  * The builder's leftover step (`lib/dispatch-leftover.js:128-147`), which runs after the builder has read tracker text.
  * Review, told to word note entries (`lib/prompt-template-defs.js:925`).
  * Close-out, which **writes review's entries on the PR branch and merges**. Its authority is "a recorded review Approve" (`:1034`), and its prompt says "Nobody reviews what you change after the approval" (`:1039`). Which comment counts as the review is decided by title text and a verdict word (`lib/run-ledger.js:49-56`), so on a public repo a single forged comment can carry an entry onto main.
  * Periodical Stage 2 (`lib/periodicals.js:346`), which is this report's own path.
* **The guard is structural only.** `tests/unit/area-notes.test.js` checks the slug, that cited paths exist, the first Waiting path's area, and the 6,144-byte cap. A Lesson needs no path. Research appended a Lesson instructing builders to run a remote script and post the environment, attributed to an "operator ruling", and `checkAreaNotes` returned no failures. That is described here by shape only. There is no CODEOWNERS file.
* **Blast radius.** Every later builder in that area reads the entry, across tasks and across every workspace bound to the repo. Those builders hold 48 h readWrite tokens, and on runner hosts a shell with the owner's `git` and `gh`. The notes survive database resets. N2 / LIN-3779 reached one workspace's Flight Companion; this reaches every builder in a codebase area.
* **Mitigations.** Entries show in git diffs, the cap is about 6 KB per note, and a model has to choose to write one. The team already names the hazard: "notes are prompt input" (`docs/areas/llm-and-prompts.md`, LIN-4390).
* **Why not High outright.** It needs either a forged review comment (LIN-3386) or a builder that obeys injected text and writes it as a Lesson. Which production workspaces bind public repos is unverified.

### §B. Jira text defeats `/t/` masking (row 5)

* **Mechanism.** `lib/providers/jira/adf.js` escapes every prose `_` to `\_`, unconditionally and by design (its comment at `:169-195`). Descriptions and comments come through `adfToMarkdown` (`lib/providers/jira/index.js:484`, `:873`, `:924`; confirmed this run: a paragraph with underscores reads back with `\_`). The `/t/` page then masks the escaped text (`maskSecretsInHtml`, `routes/task-share.js`).
* **Probe** *(this run; synthetic values built at run time, never written down)*. Plain text: all six shapes masked. Jira-escaped text: Resend, Harbour-prefixed, Linear, GitHub and env-style were **not** masked; OpenRouter was. *(research)* adds `github_pat_` and `sk_live` among the misses, with Mongo, Atlassian and PEM caught. Code spans are not escaped (LIN-3564), so a token inside backticks is still masked.
* **Reach.** `/t/` supports Jira bindings (`tests/unit/task-share-access.test.js:31`). The page is unauthenticated, so this reaches anyone holding a share link on a Jira workspace, and it undoes LIN-3795's prefix work there.
* **Fix direction.** Strip CommonMark backslash escapes, keeping a position map, before `findSecretMatches`.
* **Unverified.** Whether Linear's Markdown also escapes `_` (needs the network).

### §C. SD broker and bootstrap files (rows 2 and 6)

* **The listener (row 2).** Set out in row 2. The draft of this report framed the SD side as file modes; the second read showed the live listener is the larger channel. Mode `0600` does nothing against an agent running as the same OS user, and loopback TCP is open to every user on the host. So "delete the file" closes row 6 and leaves row 2 open.
* **The write.** SD `harnesses.js` `writeClaudeMcpConfig` puts `HARBOUR_BOOTSTRAP_TOKEN` into `state/claude-mcp/<sessionId>/.sd-claude-mcp.json` with `mkdirSync` and `writeFileSync` at default modes, and never unlinks it (SD `5d8489e`, `harnesses.js:363`, `:381-382`).
* **Why it matters.** The broker exchanges lazily, on the first proxied request, and a bootstrap lives 48 h (`lib/proxy-tokens.js:62`). An agent running as the same OS user can read **any** session's file and exchange a not-yet-consumed bootstrap first. That yields a raw 48 h readWrite working token, usable off the host and without the intent header.
* **Host metadata, this run (no contents read):** 2,916 session directories; 146 config files younger than 48 h; every one `-rw-r--r--` under a `drwxr-xr-x` directory. Research had measured 2,912 and 150.
* **Unverified.** Whether any of those files is unconsumed. Checking would mean using a secret, which this run did not do.
* **Class.** Same as LIN-3778 (the same-user boundary), but it crosses sessions, and possibly workspaces, on a shared host.
* **Fix direction (SD).** For the listener, serve on a per-session Unix socket the agent alone can open, or require a per-session secret on every call, as Harbour's runner broker does. For the file, exchange eagerly at broker start, then delete the file and drop the variable. Pin the bind in a test.

### §D. As-asked block and size-record forgery (row 7; LIN-3386 member)

* **Where `AS_ASKED_IMMUTABLE` holds:** the proxy PATCH (`routes/proxy-writes.js:512-513`), `editDescription` for append, replace, below and the description-target attachment (`:601-602`), and proxy create, which refuses any marker line (`:395-396`).
* **Where it does not, by design:** the session-lane PATCH, the Linear and GitHub UIs, and `gh issue edit` from a runner shell (`:320-326`).
* **Mechanism.** On a public-repo workspace the issue author hand-writes the block, plus a size section whose `Decided by` names a ruling.
  * The first-dispatch seal skips a description that already has a marker line, but `splitAsAsked` still finds the block.
  * `readSizeRecord` (`lib/size-of-move.js:169-181`) returns the forged record. Look-first then stands aside (`lib/recommendation-look-first.js:158`), and the selector sees a size chosen by a ruling (`lib/recommendation-facts.js:581`).
  * An agent that tries to remove the forgery through the proxy gets a 422.
  * The brief serves it as "the person's words … no step may change them" (`BRIEF_HINT`, `lib/as-asked.js:296`).
* **Answer to the ask's question:** server-side immutability is a technical boundary **on the proxy lane only**. Off that lane it is prose, and on a public repo "the person" is whoever filed the issue. This is reported as a LIN-3386 member, with no separate note entry (one home per leftover).

### §E. Collective preview password (row 8)

* **The leak.** `POST /workspace/:urlKey/collective/preview` (`routes/collective.js:530`) builds the participant prompt with `yapPassword: process.env.YAP_PASSWORD` (`:567`). The proxy token beside it is a placeholder (`:570`). `buildYapBlock` renders the password as a Bearer instruction (`lib/prompts/collective-participant.js:468-469`) and returns it to the caller.
* **Gate.** `workspaceFromUrl` plus the per-user `collective` flag, which any user can turn on (`server.js` `POST /workspace/:urlKey/settings/features`). Research reproduced it with a fake password.
* **No tenant isolation.** Collective channels on one Yap server are shared across tenants, and the prompt grants authority by nick ("John … highest-priority steer", `:354-364`) while saying nicks are unauthenticated (`:470`).
* **Origin and reach.** The password path dates from LIN-450 (`8d48dfe5`, June), so it predates the window. Dependency 11-10 F6 records the Yap host. Whether production sets `YAP_PASSWORD` is unverified.

### §F. LIN-3789 email limits (row 10)

* **What is left.** The global ceiling is now an alarm only (`EMAIL_SEND_ALARM_PER_HOUR`, `lib/email-auth.js:56`; `routes/email-auth.js:171`, `:528`). Per address: 3 per 15 min and 20 per day (`lib/email-auth.js:41`, `:54`). Per IP: 10 per 15 min, in memory, per instance (`routes/email-auth.js:86-105`).
* **Per-IP key under `trust proxy`.** It is safe under `trust proxy 1` **if** Railway is a single hop: Express takes the rightmost `X-Forwarded-For`. Conditioned by `express-rate-limit` **GHSA-46wh** (IPv4-mapped IPv6 bypass, Dependency 11-10 F1): if production `req.ip` arrives `::ffff:`-mapped, one client can throttle all IPv4 users. The same condition applies to the IP fallback bucket in LIN-4378.
* **Gaps.**
  * `normalizeEmail` only trims and lowercases (`lib/email-auth.js:89-94`), so plus and dot aliases of one inbox each get a fresh per-address budget.
  * Spraying non-existent addresses raises the bounce rate, which risks the Resend account.
  * Provider refusals (quota, suspension) are logged by error name only (`routes/email-auth.js:541`), and the visitor still sees "check your inbox". **The LIN-3771 silent lockout returns at Resend's limit.**
  * There is no enumeration oracle.
* **State.** The Railway incident record says email sign-in was switched off with `EMAIL_TRANSPORT=off` on 23 Oct. If that still holds, the row is latent (unverified in production).

### §G. LIN-4215, member token mint (row 19)

* **The mint.** `POST /workspace/:urlKey/api/proxy/tokens` (`routes/proxy-tokens-admin.js:138`) mints read and readWrite keys for any member, with grants empty. Grant-carrying purposes go through the owner-checked mint, and a client-supplied `grants` field is refused outright (`:152`).
* **What LIN-3849 removed.** The per-user `proxy` flag, which had been default-on since LIN-2944 and could be turned on by the user. So no power was added.
* **What a member key can do.** Every issue write (Done included), comments, labels, relations, agent-status, ruling suggestions, recap, brief and Flight Companion spend, and model-routing writes if that switch is on.
* **What it cannot do.** Dispatch, enqueue, kickoff, mint periodicals, runner poll, take or usage, halt or resume.
* **Lifetime and revocation.** The TTL is 90 days (`lib/proxy-tokens.js:53`). Keys are revoked on self-removal, refresh-drop and unlink. **There is no membership recheck at use** *(research)*.
* **Verdict:** Low, accept. The residual is a removed member's key living until revocation runs.

## Fix-claim table

| Ticket | At HEAD | Mutation (failed / tests in that file) |
|---|---|---|
| LIN-3780 / LIN-3794 | **Holds.** Rules for Resend, ATATT3/ATCTT3, ATOA, Mongo URI with password, GitHub and Linear client secrets, `ghr_`, env-style assignments, encrypted and truncated PEM (`lib/secret-scan.js:320-386`). Residuals: row 17; Jira bypass: row 5. | each rule broken: 1–2/98; truncated-PEM off: 21/98 *(research)* |
| LIN-3795 `9aa68bb8` | **Holds.** `hbp_`/`hbd_`/`hbf_` are masked bare (`lib/secret-scan.js:247-256`). Bootstrap, runner and periodical mints route through those stores. 0 prefixed tokens in tree or history (this run). | scanner branch broken: 2/15; mint drops prefix: 5/15 *(research)* |
| LIN-3796 / LIN-3818 | **Holds at unit level.** Route-level gap: row 16. | flush off: 11/52; `task-share-route` 0/33 *(research)* |
| LIN-2852 `7d8953a1` / LIN-2851 `e7d75987` | **Hold.** Residual: `**/tests/fixtures/**` is path-allowlisted at any depth. | swallowed errors: 1/98 each; tracked `.env`/`data/` skipped: 4/98 *(research)* |
| LIN-2850 (open) | **Still true.** The zero-script check is global (`lib/scan-public-pages.js:228-231`), and HTML bodies are never scanned. | probe *(research)* |
| LIN-619 `b4c7bb97` | **Holds as written.** Refuses unset, blank, or one of 7 published examples (`lib/session-options.js:22-30`). No length check. "Production" is `NODE_ENV` only (row 15). | published list off: 2/14 *(research)* |
| LIN-3779 | **Holds** for auto-wake and boot (`lib/agent-turn.js:273`; turn kind is server-derived). Human-turn residual: row 18. | 2/58 *(research)* |
| LIN-3772 `517a44d1` | **Docs and runbook only** (`docs/runbooks/mongodb-app-user.md`). The cutover is the operator's call. **`lin3014_read` stays open**: the runbook says it may still exist, and `scripts/lin3014/lib/guard.mjs` still expects it. 2026-10-23 N5 does not close. | n/a |
| LIN-3789 `c93f8792` | **Partial** (row 10, §F). | daily cap off: 1/12; per-IP off: 1/12 *(research)* |
| LIN-3699 | **Holds.** Store faults return a retryable 503; the exchange rethrows only before the bootstrap is consumed. | 3/14 *(research)* |
| LIN-3346 | **Holds.** One predicate (`lib/guest-task-path.js`). The exemption only skips minting and refresh, so path tricks reach nothing protected. | no lowercase: 14/107 *(research)* |
| LIN-3875 / LIN-3856 | **Hold.** Precompute is charged to the free-tier gate and fails closed (`lib/run-paragraph-hook.js`). **LIN-3422 D4 closes for the free key.** Still no census test of gating. | 3/11 *(research)* |
| LIN-4378 `f7d1923e` | **Holds.** The key is sha256 of the presented bearer, and counts as a credential key only once `validateToken` has proved it (`routes/proxy.js:239-252`). Junk bearers fall to the IP bucket, and nobody can drain another credential's bucket without holding the whole token. All 69 proxy routes carry `proxyLimiter`. Exchange is always IP-keyed. Gap: the 10k LRU cap is untested (row 21); the IP-fallback bucket is conditioned by GHSA-46wh (§F). | key any bearer: 3/3; LRU cap removed: 0/3 *(research)* |
| LIN-3849 → LIN-4215 | **Low** (§G). | member grant refused: tested |
| LIN-3643 | **Did not touch the 301** (`server.js:1213-1218`). Research confirmed locally that Express takes the leftmost `X-Forwarded-Host` for `req.hostname`. The redirect also runs before `no-store`. Old #12 stays Low; edge behaviour is unverified. | n/a |
| LIN-1374 (Done 30 Oct) | **Closed for its own phrases only.** N4 was not addressed (row 9). | n/a |
| LIN-737 / LIN-3593 (open) | **Candidates to close** (closed/improved row). | 1/1,542 for LIN-3593 *(research)* |

## New surface since `c6c5585a`

**Routes (one row each).** The bound is a diff grep of route registrations over `server.js`, `routes/` and `lib/`, including template-literal and constant-built paths. Result: **17 new proxy, dispatch, public and test routes, plus 3 vendor GETs; 14 new session-lane routes; 42 moved across files and 4 re-registered in place**. That is 80 in all. Research counted 19 / 13 / 36; the difference is the five ruling writes built from `spec.path`, plus `copy-first-card` in `lib/`. **No non-test handler takes a `urlKey` from params, query or body without session validation.**

| Route | Auth | Own workspace | Limiter |
|---|---|---|---|
| `POST /api/proxy/periodicals/:id/mint` (`routes/proxy-dispatch.js:310`) | bearer + write + `dispatch` | token | proxyLimiter |
| `GET /api/proxy/model-routing`, `/presets`, `/log` (`routes/proxy-model-routing.js:92-102`) | bearer | token `urlKey` | proxyLimiter |
| `POST …/model-routing/jobs/:jobId`, `/groups/:group`, `/presets/:presetId/apply`, `/log/:entryId/undo` (`:191-213`) | bearer + write + workspace switch | token; store filters `urlKey` (row 12) | proxyLimiter |
| `POST /api/proxy/runner/usage/:id` (`routes/proxy-runner.js`) | bearer + `take` (no write scope, like its siblings) | `urlKey` + `takenByTokenId` | proxyLimiter |
| `POST /api/proxy/issues/:issueId/description/below` (`routes/proxy-writes.js`) | bearer + write; As-asked guard | token | proxyLimiter |
| `POST /api/dispatch/usage/:itemId` (`routes/dispatch.js`) | dispatch token | `urlKey` + taker | feedbackLimiter |
| `GET /getting-started`, `/getting-started.md` (`routes/getting-started.js`) | public; library and sandboxed Markdown CSP; server-side marked escapes raw HTML | n/a | none |
| `POST /auth/openrouter/consent/clear` (`routes/openrouter-auth.js:275`) | session; `sameSite:'lax'` only | own account | none |
| `GET /t/:token/timeline` (`routes/task-share.js:298`) | share token | record `urlKey`; spend stripped; masked (rows 5, 16) | none, by ruling |
| `GET /purify.min.js`, `/marked.min.js`, `/chart.umd.min.js` (`lib/vendor-assets.js`) | public static | n/a | none |
| `POST /test/model-routing`, `/test/create-runner-key` (`routes/test.js`) | mounted only under `NODE_ENV==='test'` | body or query | none |
| Session lane, new (14): dispatch `preview` and `decision-panel`; `settings/models/changes`, `presets`, `presets/:presetId/apply`; `settings/:area`; `settings/running/halt` (owner); `settings/change-log/:source/:id/undo` (halt undo owner-only); task `proposals` (owner) and `timeline`; `backlog`; `home-rows`; `home-waiting`; `settings/copy-first-card` | `workspaceFromUrl` | `req.workspace.urlKey` | none |
| Moved (42), all `workspaceFromUrl`: dashboard split (observation, sessions, loops, rulings and 5 ruling writes, escalation-kpis, effort-readout, run and session summaries, session-context, **hydrate**); workspace-api split (audit, prompts, issue read and write, run evidence, scan, feedback); settings | session | own; **hydrate's second `:wsUrlKey` 403s unless it is in the session** (`routes/dashboard-drilldown.js:122-123`) | feedbackSubmitLimiter on feedback; else none (row 22) |
| Re-registered (4): `collective/preview` (row 8), `live-console`, `passage-planner`, `task-chat` | session | own | none |

New middleware: `app.use('/workspace/:urlKey', …)` (`server.js:1665`). It checks the key against the session and then refreshes only the caller's own credentials.

**Prompt builders never reached in depth.** All nine use plain `streamChat`: **no tools, no writes, no shell**. Tracker text enters raw through `summarizeRoadmapModel` (`lib/prompts/roadmap-narrative-template.js:78-198`), with section headers as the only separation.

| Builder | Verdict |
|---|---|
| `roadmap-narrative-template.js` | Raw tracker text; it calls the description a "possibly-stale seed". Output shown via `textContent`. **Feeds layers 2, 3a, 3b and the digest.** Low |
| `roadmap-product-template.js` | Tracker text plus layer-1 output, raw. Low |
| `roadmap-trajectory-template.js` | Tracker text plus layers 1–2; output saved and re-fed. Low |
| `roadmap-north-star-template.js` | The signed-in user's north star; earlier layers labelled "descriptive context only". Low |
| `roadmap-gap-template.js` | **Calls the tracker block "the source of truth"** (`:70`); output saved and re-fed. Low-Medium on its own; feeds row 20 |
| `roadmap-digest-template.js` | The end of a model-output chain, labelled sections; saved and re-served (row 20). Low-Medium |
| `roadmap-orientation-template.js` | Task titles raw; bearings checked against a fixed list; free-text reason shown via `textContent`. Low |
| `roadmap-chat-template.js` | `roadmapModel` and history are taken from the request body. The person can only shape their own session; nothing saved. Info |
| `ship-biscuit-editor.js` | Raw tracker text and model slices; section and `sourceRefs` checked against real ids; output escaped client- and server-side; saved but never re-fed. Low |

All nine are gated by `workspaceFromUrl`, a default-off flag (`roadmap`, `shipBiscuit`) and the free-tier gate. The one path from them to an agent with tools is row 20, through the proxy `north-star` read, not through a builder. `collective-participant` was covered by research (row 8).

**Whole-life cost and timeline reads across a lineage** (LIN-4404, LIN-4405, LIN-4263). Clean: `lib/task-cost-read.js` and `lib/task-timeline.js` filter every query by the caller's `urlKey`, and the lineage walk follows dispatch rows, never account merges. The second read confirmed this.

**Sanitiser verdict (browser).** `public/common.js:553-556` is the **only** `marked.parse` and `DOMPurify.sanitize` call in `public/`. Every markdown caller goes through it, with `FORBID_TAGS: ['form']` and DOMPurify's default URI allow-list. If DOMPurify is missing it falls back to `escapeHtml`, never to raw marked output. Server-rendered fragments (`data.html`, `trackHtml`, `timelineHtml`) rely on server escaping. The enforced CSP (`lib/security-headers.js:62-72`) has `script-src 'self'` plus hashes, no `'unsafe-inline'`, and `object-src 'none'`. **No path reaches the DOM with unsanitised marked output.** The one gap found is row 22's transcript `href` scheme.

## Classes and how each was bounded

| Class | Bound | Members |
|---|---|---|
| Authority read from comment or description text (LIN-3386) | comment-body readers in `lib/` (20 files vs 19), description-authority readers, prompt grants | 11 code + 4 prompt (row 1) |
| Area-note writers | prompt grep for `docs/areas` plus `LEFTOVER_RULE` renders | 4 (§A) |
| Description write paths vs `AS_ASKED_IMMUTABLE` | route grep for description writes, plus provider UIs | Enforced: proxy PATCH, append, replace, below, attachment-description, create. Not enforced: session PATCH, Linear UI, GitHub UI, `gh` CLI, first-dispatch seal |
| Secret-scanner consumers | grep `findSecretMatches`/`maskSecrets*` | 5, unchanged |
| Token mint sites | `git grep randomBytes\|randomUUID\|mintHarbourToken` | 3 prefixed stores (proxy, dispatch, feedback; bootstrap, runner and periodicals route through them); 4 unprefixed (magic link, `/t/` share, 2 session nonces). No census test |
| Proxy write routes | `router.(post\|put\|patch\|delete)(` over `routes/proxy*.js` | 36 (29 at baseline); 34 on the bearer lane: 26 `requireWriteScope` (4 also `dispatch`), 4 `take`, 4 scope-less from before the window |
| Proxy routes behind `proxyLimiter` | route grep plus chain constants | 69/69 |
| Routes added or moved | diff grep including template literals and `spec.path` | 80 (table above) |
| New public routes | same | `/t/:token/timeline`, `/getting-started`, `/getting-started.md`, 3 vendor GETs |
| Prompt builders not reached last run | the nine files above | 9; no tools; 1 path to a tool-holding agent (row 20) |
| Browser sanitiser sites | grep `marked`/`DOMPurify`/`innerHTML` in `public/` | 1 sanitiser; 0 unsanitised marked paths |
| Free-tier spenders | `resolveChatCredential(\|getFreeTierKey` | 29 + precompute; 0 ungated (per file); no census |
| Model-routing write surfaces | grep | 7 (session 4, proxy 4 in 3 shapes); all filter `urlKey`; proxy has no runnable check |
| Controls keyed on `NODE_ENV==='production'` | grep | 8 sites, 7 controls (row 15) |
| Rate limiters | `rateLimit({` | 12, all in memory |
| OAuth callbacks | read each | 5: 4 check `state`; OpenRouter is PKCE only (LIN-676) |
| Session and cookie lifetime | diff `c6c5585a..4d23fa15` of `lib/session-options.js` and `lib/user-preferences.js` for `maxAge`/`expires`/`rolling` | unchanged in window; only LIN-619's secret refusal changed |
| Outbound, shell, HTML and Mongo sinks added | diff greps (`fetch(`, `spawn\|exec`, `innerHTML`/`${}`, `req.*` in queries) | 6 fetches, none to a user URL; 2 shell, both argv-form; about 21 client and 230 server interpolations, with no new member beyond row 22; 3 Mongo sites, all `Array.find` *(research)* |
| Mongo collections vs erasure | literal and constant `collection(` | 59/59 |
| **Could not bound** | n/a | Which production workspaces bind public repos (decides rows 1, 2a, 7). Whether any SD bootstrap file is unconsumed (live secret state) |

## Credentials (tracked tree and full history)

Built-in `git` only, with no scanner dependency, read by a short local script whose output prints a 6-character prefix, the length and a hash per value, never the value.

* **Tree** (`git ls-files` at `4d23fa15`): 8,675 tracked files, 8,011 of them text.
* **History:** `git log --all -p -U0 --cc` over **7,651 commits** (6,469 non-merge and 1,182 merge) on every ref; the 5 unreachable commits (`git fsck --unreachable`); 0 stashes. That covers `008d38bb..HEAD` and everything before it.

**Patterns, derived at run time:** the `lib/secret-scan.js` set; Harbour's prefixes (`hbp_`, `hbd_`, `hbf_`); Linear (`lin_api_`, `lin_oauth_`); GitHub (`gh[pousr]_`, `github_pat_`); OpenRouter (`sk-or-v1-`); Anthropic and OpenAI shapes; Atlassian (`ATATT3`, `ATCTT3`, `ATOA`); Resend (`re_`); Mongo and other database URIs with a password; PEM headers; PuTTY; AWS (`AKIA`, `ASIA`), Google (`AIza`), Slack (`xox`), Stripe live, npm, JWT; generic `*KEY=`/`*SECRET=`/`*PASSWORD=`/`*TOKEN=` assignments; client-secret assignments; session cookies.

**Result: no live secret in the tree, in any commit, or in the unreachable commits.**

* Every cloud, provider and Harbour-prefix pattern: **0 values**, in both tree and history.
* PEM headers: 5 distinct, all in the scanner's own rule and tests (`lib/secret-scan.js`, `tests/unit/secret-scan.test.js`, `tests/fixtures/secret-scan-fixtures.js`).
* Mongo URI with password: 1, a scanner-test fixture.
* Env-style assignments: 125 in the tree and 143 in history. Each was classified, privately and by shape. All are placeholders (`dummy`, `test-secret`, `your-…`), urlKeys, storage-key names, regex sources or test fixtures, and the history-only values are CI dummies.
* Session cookies: 12, all in `docs/reviews/_evidence-2026-10-21/` and `_evidence-2026-11-08/` Lighthouse captures of `localhost:3199`. They are dead local artifacts (row 23).

**Nothing to rotate or remove on the strength of this scan, and no history rewrite is proposed.** The caveat from last time stands: a scan finds only the shapes it knows (row 17).

**Railway incident** (`docs/incidents/2026-10-22-railway-security-disclosure.md`; Dependency 11-10 F0). Every Railway variable was treated as exposed and rotated on 23 Oct, including the GitHub App private key and client secret and the Resend key, and email sign-in was switched off. **Still open:** the account-level check of the Harbour GitHub App's installations and recent deliveries for 20–23 Oct. A leaked App key can mint installation tokens for every account that installed the app. This cannot be settled from the repository, so it goes to the person.

## Not verified (needs production, network, a browser or a secret)

* Production `NODE_ENV` (row 15), and whether `EMAIL_TRANSPORT=off` still holds (row 10).
* Railway hop count and its handling of `X-Forwarded-For`/`X-Forwarded-Host` (decides old #12 and the per-IP claims), and whether `req.ip` arrives IPv4-mapped (GHSA-46wh).
* Resend quota and suspension thresholds.
* Whether production sets `YAP_PASSWORD` or `YAP_BASE_URL` (row 8).
* Whether any workspace has `modelRoutingProxyWrites` on (row 12).
* Whether `lin3014_read` exists, and which Mongo user the app runs as (LIN-3772).
* Whether any SD bootstrap file is unconsumed (row 6).
* Which production workspaces bind public GitHub repos (rows 1, 2a, 7).
* How many workspaces each SD host serves, and whether SD hosts are shared between OS users (decides row 2's High).
* Whether Linear's Markdown escapes `_` (decides whether row 5 also reaches Linear).
* `npm audit` online (owned by Dependency and LIN-620).
* The live CSP in a browser.
* Branch protection and required checks, and who clicks merge on `docs/areas` PRs (row 2a).
* The GitHub App installation check (Railway incident).

## Area-note edits (this PR)

Rules: `docs/areas/README.md`. Guard: `tests/unit/area-notes.test.js`, cap 6,144 B. Each entry cites the area's file first and this report second. Open-ticket findings stay in this report only.

| Note | Change |
|---|---|
| `llm-and-prompts.md` (6,113 B at `80f4c7c8`, at the cap) | Two Waiting entries: `lib/prompt-formatters.js` (row 2a) and `lib/prompts/autopilot-kickoff.js` (row 9). Room was made by distilling wording only, now 6,136 B. **No entry was removed:** each was checked at HEAD and still holds. Two Documentation-review entries with one source were merged into one (a ceiling for Periodical prompts; an index for `docs/reviews/`). |
| `front-end-pages.md` | Waiting `lib/mask-secrets-in-html.js` (row 5). A seam: the other side is `lib/providers/jira/adf.js`, and providers has no note. |
| `platform-and-plumbing.md` | Waiting `lib/secret-scan.js` (row 17, and the missing mint-site census). The Dependency 11-10 Lesson is kept. |
| `web-routes.md` | Waiting `routes/task-share.js` (row 16) and `routes/collective.js` (row 8). |
| `agent-api.md` (6,040 B at `80f4c7c8`) | Waiting `routes/proxy-model-routing.js` (row 12, with the harness amplification). Room was made by distilling the wording of existing entries, nothing removed; now 6,124 B. The `PROVEN_CREDENTIALS_CAP` test gap stays report-only (row 21), because the note had no room for it without cutting facts. |
| `auth-accounts-and-workspaces.md` | New `## Waiting`: `lib/email-auth.js` (row 10) and `lib/session-options.js` (row 15). |
| `runs-and-dispatch.md` | Nothing. The `costUsd` bound stays report-only. |

**To the person, not a note** (no area file to cite): the SD broker's loopback listener (row 2) and its bootstrap files (row 6); the GitHub App installation check; session cookies in evidence dirs (row 23); `lin3014_read` and the production Mongo user; the production checks above; LIN-737 and LIN-3593 as candidates to close; LIN-4215 acceptance; N4 open despite LIN-1374 being Done; LIN-3386's growth, including the As-asked forgery; the CVE-ownership wording seam.

## Departures from the periodical template

* The research pass (ticket comment, 10 Nov) was done before this run. Its mutation counts are quoted and marked *(research)*. This run re-read every cited line, and re-measured the credential scan, the Jira masking probe, the scanner-residual probe, the timeline-mask mutation and the SD host metadata.
* SD's bootstrap delivery was brought into remit (remit decisions).
* The second read is Tier 2 (below). It raised the SD listener, which this run then verified and ranked at row 2.

## Adversarial Second-Read

**Tier: 2.** A fresh-context sub-agent with no memory of the report-writing turn. It was given only the ask (the `## As asked` block), this report's path, the measured HEAD and the window. It was not given the research or any draft. It read the code at HEAD itself and spot-checked about 30 cited lines. It made no edits and no network calls.

**Question:** What is the largest item in this window that this report missed or misfiled?

**Reader's answer** (verbatim):

1. **The largest item this report missed or misfiled is the SD credential broker's unauthenticated loopback listener. I'd rate it High where one SD host runs sessions for more than one workspace, and Medium-High otherwise.**

   Row 6 / §C treats the SD side as a file problem: bootstrap files that are world-readable and never deleted. The bigger channel is the broker process those files feed.

   - **Bind:** `../simple-dispatcher/harbour-token-mcp-server.js:425` (and the fallback at `:420`) binds `127.0.0.1` over TCP. `createBrokerServer` at `:330-347` forwards every `/api/proxy/*` request with the session's working token injected at `:286`.
   - **No caller check:** the broker never checks who is calling. There is no per-session secret, no peer check and no Host check. The only gate is the `X-Harbour-Intent: write` header (`:253-254`), which any caller can add.
   - **Reach:** any process on the host, under any OS user, can connect to any live session's port and act with that session's 48 h readWrite credential. That includes a prompt-injected agent from another workspace. If the victim session holds `dispatch` (an autopilot or kickoff child), the attacker can also enqueue.
   - **Lifetime:** the port is live for the whole session, so it does not depend on an unconsumed bootstrap, which is §C's own "unverified" condition.
   - **Multi-workspace hosts are normal:** SD runs several workspaces per host (`../simple-dispatcher/config.js:983` loads `workspaces.json`; the comment at `:843` assumes "3 workspaces").
   - **The ask named this process:** it named `harbour-token-mcp-server.js` and its LIN-4378 change explicitly. The report mentions the bind only as a test gap in row 21.
   - **Harbour's own design shows the fix:** its runner broker (`lib/runner-kit/broker.mjs:223`) listens on a Unix socket and takes the bootstrap on stdin. SD's broker uses a TCP port and keeps the bootstrap in its env (`:403`).
   - **The report's fix direction does not close it:** §C's "exchange eagerly, then delete or 0600" closes the file vector only. Mode `0600` does nothing against a same-user agent, and nothing in the fix touches the port.
   - **It contradicts the verdict:** the verdict says "No cross-workspace read or write on either lane". §C itself says "possibly workspaces". This channel makes the cross-workspace path concrete.

   I would rank it High at row 2, above the area notes. It still routes to the person, since there is no LinearViewer area file to cite.

2. **DISAGREE** with the ranking overall, narrowly. LIN-3386 at row 1 is defensible and its citations hold. But the SD runner-contract item is under-ranked at Medium, framed around file modes rather than the live listener, and its fix is incomplete. **Differed from top finding: YES.**

3. **Cited claims spot-checked.** I checked about 30. Almost all hold at HEAD:
   - Row 1: `lib/run-ledger.js:49-56`, `lib/recommendation-look-first.js:95-100`, `lib/size-of-move.js:169-181`, `lib/as-asked.js:231`.
   - Row 1 prompt grants: `lib/prompt-template-defs.js:1034` and `:1039` (the "Nobody reviews what you change after the approval" text is on 1039).
   - Rows 3, 4, 8, 9, 11: `lib/db-indexes.js:529-533`, `lib/proxy-preamble.js:427-428`, `routes/collective.js:567`, `lib/periodicals.js:1354-1356`, `lib/prompts/autopilot-precedence.js:33`, `lib/runner-kit/runner.mjs:821-825` and `:964`.
   - Rows 15, 22 and the closed/improved row: `server.js:1208-1218` and `:4674`, `routes/proxy-reads.js:613-615`, `public/common.js:553-556`.
   - Rows 10, 12, 18, 19: `lib/email-auth.js:89-94`, `lib/feature-defaults.js:202`, `routes/settings.js:418`, `lib/agent-turn.js:273`, `routes/proxy-tokens-admin.js:138` and `:152`.
   - The hydrate 403 at `routes/dashboard-drilldown.js:122-123`.

   Minor problems:
   - `lib/runner-owner-gate.js:24-26` (row 22, "`local` spawn has no owner gate") is `isRunnerTarget`. It is the predicate the claim rests on, not the missing gate itself, so it is loosely cited.
   - §C's "world-readable" emphasis is a misleading lens. File mode only matters across OS users, and the report's own threat is a same-user agent.

4. **Other material points**
   - **Row 12 misses an amplification.** `harness` is a writable field on the agent-session surface (`lib/model-routing.js:47`, accepted by `routes/proxy-model-routing.js:191`). The table's harness feeds dispatch (`lib/dispatch-factory.js:623`), and any value other than `claude-code` switches to prose delivery (`lib/proxy-preamble.js:32-34`, `:751`, `:773`). So with `modelRoutingProxyWrites` on, any readWrite leaf key can put the bootstrap token inline in every later dispatch prompt in the workspace (the LIN-1410 path) by setting the harness to `opencode`. The switch is default-off, so this stays Low-Medium, but the row should name it.
   - **Cross-workspace reads within a lineage, which the ask asked about, check out clean.** `lib/task-cost-read.js:68-96` and `lib/task-timeline.js:422-497` are keyed by `urlKey` throughout. The report never says so explicitly, though; it is only implied by row 16's "Same workspace only".
   - **The GitHub install flow verifies `installation_id` against `/user/installations`** (`lib/github-install-flow.js:637-678`), so a public repo does not make anyone a member.

I made no edits, ran no network calls, and copied no secret values.

**Response.** The listener was verified against SD source and adopted:

* New row 2 (High, conditional), placed below LIN-3386 as the reader suggested. The area-notes row is renumbered 2a.
* The verdict is qualified to "either Harbour lane", with the SD cross-workspace path named.
* §C is reframed around the listener, and the fix direction extended to cover it.
* Row 6 is now described as the file half of row 2.
* Row 12 gains the harness amplification (verified: `lib/model-routing.js:47`, `lib/dispatch-factory.js:621-625`, `lib/proxy-preamble.js:32-34`), and the `agent-api.md` entry says so without naming the ticket.
* Row 22's `local` citation is reworded.
* The lineage-read verdict is now stated.

Adversarial second-read verdict: DISAGREE
Differed from top finding: YES
Disposition: fixed in place
