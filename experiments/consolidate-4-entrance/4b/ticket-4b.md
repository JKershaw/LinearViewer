TITLE: Dispatch entrance: one authority per entrance decision in lib/dispatch-entrance.js, reached by all three entrance files; delete the per-route copies

PARENT: LIN-3549 · PROJECT: Quality, Periodicals & Measurement · PRIORITY: High · STATE: Todo

**Goal.** Four enqueue handlers each make the same decisions today: session dispatch, proxy dispatch, recommend-and-dispatch and autopilot kickoff. Those decisions are to check the body, resolve the issue's credential, build and enqueue the row, mint the credential, shape the 201 and map a failure. After this PR each of them is made in one place, `lib/dispatch-entrance.js`. Every entrance reaches it, and the copies in the route files are deleted. Behaviour does not change; the only fixes are the comment corrections listed below.

**Why.**
* **Rung 5c kept the copies.** LIN-3592 (#1906) rebuilt the three entrance files and added shared pure helpers in `lib/dispatch-entrance.js`. The helper's header says each entrance keeps its own reads, enqueues, mints, gates and replies, "because the source-text censuses pin them by the route they sit in" (`lib/dispatch-entrance.js:10-12`). The result was 86.7% verbatim (`experiments/rebuild-rung5c/arm/score.md` §3; `docs/papers/harbour/rebuild-round.md:36`).
* **The decision is the unit.** `docs/papers/harbour/one-job-many-paths.md:26-27`: "The useful unit of consolidation is not the file or the endpoint, but the decision: one authority, reached by every caller."
  * Several entrances are fine. A session and a proxy token need different authentication, but "a copied rule or independently maintained fact" is a second authority (`:37-40`).
  * "A new helper counts as consolidation only when callers stop making the old decision" (`:208-209`).
* **LIN-3601 (#1912) freed the seam.**
  * The location pins became behaviour sweeps (`tests/unit/dispatch-entrance-session-owner-sweep.test.js`, `-proxy-grant-sweep`, `-redaction-canary-sweep`, `-mint-sweep`, `-mint-limiter-order`, `-no-token`, `-proxy-key-sets`).
  * The B censuses now judge `routes/dispatch.js`, `routes/proxy-dispatch.js`, `routes/proxy-kickoff.js` and `lib/dispatch-entrance.js` as one unit, E (for example `tests/unit/lin-3383-runner-enqueue-census.test.js:148`, `tests/unit/lin-3134-declared-mint-census.test.js:95`).
  * What still pins location (the C pins): the registrations with their middleware chains, including `requireGrant('dispatch')`; the factory signatures; and the module-scope `rateLimit` declarations. All of these stay in the three route files.

**Decision.**

*The starting map.* It was checked at origin/main `15191460`. Treat it as a list to verify, not to trust. Line numbers are at that commit.

The entrances:
* **S**: `routes/dispatch.js:483-999`.
* **P**: `routes/proxy-dispatch.js:411-727`.
* **R**: `routes/proxy-dispatch.js:766-1382`. Its arms are Ro, the verb override (`:891-1094`), and Rl, the LLM descent (`:1096-1372`).
* **K**: `routes/proxy-kickoff.js:206-544`, with `kickoffBodyFailure` at `:116-174`.

The 24 decisions made by two or more entrances, with their sites (96 in all):

| # | Decision | Sites |
|---|---|---|
| D1 | store missing → 503 | `proxy-dispatch.js:352-357` (P `:412`, R `:767`); K `proxy-kickoff.js:207-210` |
| D2 | `req.body \|\| {}` | S `dispatch.js:487`; P `:415`; R `:770`; K `:213` |
| D3 | verb shape, prompt required, target | S `dispatch.js:493,498-502`; P `proxy-dispatch.js:420,423-426` |
| D4 | abort/cascade/kind/periodical/run-field list | S `dispatch.js:552-582,599`; P `proxy-dispatch.js:431-466` |
| D5 | presetId shape + lookup | S `dispatch.js:587-592`; K `proxy-kickoff.js:161-166` |
| D6 | model/harness/effort + unknown-effort warning | `lib/dispatch-validation.js:228-237` (S, P); R `proxy-dispatch.js:792-801`; K `proxy-kickoff.js:142-156` |
| D7 | issueIdentifier and sessionId rules | `lib/dispatch-validation.js:179,277` (S, P); R `:775-776,825`; K `:128,137` |
| D8 | audited 400 | `proxy-dispatch.js:360-363`; `proxy-kickoff.js:76-79`; S `dispatch.js:503,619` (no audit) |
| D10 | `subscription ?? DEFAULT_SUBSCRIPTION` | S `dispatch.js:879`; P `:491`; R `:848`; K `:227` |
| D11 | cascade expansion | S `dispatch.js:627-633`; P `proxy-dispatch.js:500-507` |
| D12 | persisted `issueSource` | S `dispatch.js:639-641`; P `:537-539`; R `:877-879`; K `:238,266` |
| D13 | resolve the issue's credential | R `proxy-dispatch.js:862-873`; K `proxy-kickoff.js:242-250`; P `proxy-dispatch.js:524-531` |
| D14 | issue context or 404 | Ro `proxy-dispatch.js:902-915`; K `proxy-kickoff.js:251-264` |
| D15 | dangling-referent 422 | S `dispatch.js:654-662`; P `proxy-dispatch.js:541-550` |
| D16 | `repo \|\| null` | S `dispatch.js:869`; P `:556`; Ro `:944`; Rl `:1204`; K `:234` |
| D17 | proxy-context append policy | `proxy-dispatch.js:141-148` (P `:561`, R `:856`); K `proxy-kickoff.js:359`; S `dispatch.js:537` (opt-in) |
| D18 | free-tier key + run gate | S `dispatch.js:689-695`; P `proxy-dispatch.js:572-574`; Ro `:895-896,962`; Rl `:1096-1100,1226`; K `proxy-kickoff.js:335-344`; `runGateFor` `proxy-dispatch.js:395-400` |
| D19 | plan block | S `dispatch.js:717-733`; P `proxy-dispatch.js:592-599`; Ro `:976`; Rl `:1245-1250` |
| D20 | base URL | S `dispatch.js:684`; P `proxy-dispatch.js:601`; Ro `:987,1005`; Rl `:1261,1279`; K `proxy-kickoff.js:229` |
| D21 | the `createDispatchItem` call | S `dispatch.js:696`; P `proxy-dispatch.js:575`; Ro `:963`; Rl `:1227`; K `proxy-kickoff.js:345` |
| D22 | credential mint (follow-up gate, launch attach, plain return) | S `dispatch.js:767-860`; P `proxy-dispatch.js:600-681`; Ro `:977-1029`; Rl `:1251-1303`; K `proxy-kickoff.js:358-398` |
| D23 | row fields | S `dispatch.js:861-893`; P `proxy-dispatch.js:682-710`; Ro `:1030-1066`; Rl `:1304-1344`; K `proxy-kickoff.js:399-434` |
| D25 | the 201 | S `dispatch.js:930-945`; `receiptFor` `proxy-dispatch.js:161-179` (P `:714`, Ro `:1075`, Rl `:1352`); K `proxy-kickoff.js:440-459` |
| D26 | map an enqueue failure | S `dispatch.js:946-998`; `relayEnqueueFailure` `proxy-dispatch.js:374-390` (P `:719-726`, Ro `:1076-1093`, Rl `:1357-1372`, R outer `:1373-1381`); K `proxy-kickoff.js:460-543` |

Four decisions belong to one lane and stay where they are:
* D9, who may enqueue: S's owner gate at `dispatch.js:510-516`, and `requireGrant('dispatch')` in the P/R/K registrations;
* D24, S's task-mode record and Harbour OS spawn (`dispatch.js:900-923`);
* D27, the proxy lane's `logEvent` on every exit;
* D28, R's keepalive and client-gone handling.

*One authority per decision, reached by every entrance.*
* **Home: `lib/dispatch-entrance.js`** (area "Runs & dispatch").
  * It owns the dispatch contract, beside `lib/dispatch-factory.js`, `lib/dispatch-validation.js`, `lib/dispatch-fields.js` and `lib/dispatch-refusal.js`.
  * Every census already counts it as part of E. A second authority file would have to be added to the E set in 8 test files, so use one module.
  * The proxy-lane closures (`logEvent`, `relayDispatchRefusal`, `resolveProviderAccess`, `workspaceUnavailable`, `denyIfUnsupported`, `graphqlErrorStatus`, the keepalive) stay owned by the Agent API. Pass them in as the factories receive them today.
  * If you find a better home by the rule "code belongs to the area that would have to change if its rule changed", say why in the PR.
* **What the route files keep:**
  * the registration lines and middleware chains, unchanged;
  * on each of the three proxy POSTs, a **block-bodied** `async (req, res) => {` forwarder on the registration line. `tests/unit/lin-3136-dispatch-gate.test.js:164-172` (a C pin) requires the text after the path to be exactly `proxyLimiter, authenticateProxyToken, requireWriteScope, requireGrant('dispatch'), async (req, res) =>`, optionally followed by ` {`. An expression-bodied `async (req, res) => handler(req, res)` or a bare handler reference fails it. The independent score of #4a moved recommend-and-dispatch's handler into `lib/dispatch-entrance.js`: the full suite stayed green only with this form;
  * the factory signatures (`proxy-di-witness`);
  * the module-scope `= rateLimit(` declarations (`dispatch.js:87,102,113`);
  * the GET/DELETE/PATCH routes;
  * a thin POST handler per entrance that builds the lane context and calls the authority.
* **Deleting the losing copies is part of done.** After the PR, no route file should still make any of D1–D8 or D10–D26 itself.
* **Constraints the censuses put on the authority's shape.** Read each test before relying on this list.
  * Exactly two lines `declaredGrants: ['dispatch'],` in E (M1, M2), and no other line in E containing `declaredGrants`, comments included (`lin-3134-declared-mint-census.test.js:132-135`).
  * Every `createDispatchItem({` call in E:
    * has `proxyTokenStore` as a direct key (`lin-3130-create-dispatch-item-proxy-token-store-pin.test.js`);
    * has an inline, spread-free `fields` object;
    * if it carries `followUpTo`, puts its first `provisionResumeCredential(` under `if (isFollowUp) {` or `...(followUpTo ? {`, passes `attach:`, and has no direct `attachProxyContext(` before the gate's end.
  * A mint helper call in E that sits in no `createDispatchItem({…})` call is keyed `E | - | <fn>`. Only the broker's `provisionResumeCredential` may be (`lin-3134-declared-mint-census.test.js:573-577`). So the follow-up gate and the launch attach live inside the one call, not in a separate helper.
  * At least one statement `const { token: accessToken, reason, provider } = await resolveProviderAccess(req.proxyUrlKey, req.proxyCreatedBy, req, { … });` in E. Every `resolveProviderAccess(` in E passes `req` third (`proxy-credential-fingerprint-stamping.test.js:108-168`).
  * No `.addItem(` or `mintGrantBootstrap(` in E, and no `grantDeclaration` or `grantRefusal` mention.
  * A `router.` mention in a comment in `routes/proxy-*.js` changes `proxy-endpoint-inventory-witness`'s count.
  * Each endpoint tag literal stays in its own route file.
* **Keep each entrance's observable order:**
  * the first-failure order of its checks (each verb keeps its own ordered list, built from shared check groups);
  * the order of its dependency reads (the free-tier key is read at a different point in P `:572`, Ro `:895`, Rl `:1096` and K `:335`);
  * every `logEvent` status and note;
  * the 201's bytes, key order included (5c's replay caught a key-order change, `experiments/rebuild-rung5c/arm/score.md` §1);
  * the key set of each `addItem` argument (unit tests `deepEqual` it).
* **Classify each divergence:**
  * (a) one copy is a bug: fix it, with a test. Fix only a bug that involves no product choice.
  * (b) deliberate variation: keep it as a named parameter of the authority, with its reason beside it.
  * (c) bounded fuzz: unreachable or harmless; say why.
  * (d) unclear: keep today's behaviour and write it up in the PR body under **Open questions**: the question, the options and your recommendation. Never end the run BLOCKED and never emit a `DECISION:` line for one.

  The starting classes, to verify:
  * **(a), comment fixes only:**
    * `dispatch.js:594-596` cites "routes/proxy.js's kickoff-seam rule";
    * `dispatch.js:712-714` says the plan block uses the referent guard's provider pair (it has not since LIN-3335, `:655`);
    * `proxy-dispatch.js:509-516` and `:690-691` describe the LIN-2886 repo guard that LIN-3333 removed (`:552-555`);
    * `proxy-kickoff.js:231-232` says "inherit the project repo";
    * `proxy-dispatch.js:405-406` says "same body shape and validation";
    * `proxy-kickoff.js:187`'s body list is incomplete.
  * **(b):**
    * the target sets;
    * the owner gate against the grant middleware;
    * audit against none;
    * S's opt-in attach (LIN-1162), against the proxy lanes' default-on attach;
    * S treating an unchanged prompt as an attach failure (LIN-525, `dispatch.js:852-856`);
    * the attach-failed text (`dispatch.js:972` against `routes/proxy.js:305`);
    * the credential sources per lane;
    * the declared sites: M1 (`proxy-kickoff.js:378-381`), M2 (`dispatch.js:830-837`), and none for P/R (M3 is deferred to LIN-3099);
    * the `kickoff-bootstrap` label;
    * `applyDefaultHarness: false` (`dispatch.js:702`, LIN-1111);
    * K's `waitForFollowUps: true` (`:411`, LIN-826);
    * K's `sessionId: item._id` (`:446`, LIN-591);
    * the 201 layouts;
    * R's keepalive;
    * P's permissive credential path (LIN-1948, `proxy-dispatch.js:517-523`);
    * each entrance's read order.
  * **(c):**
    * `req.body \|\| {}`;
    * P's `!!prompt` in its follow-up mint (`:621`);
    * `dispatchedAt?.toISOString?.()`;
    * `consumerLastSeenAt \|\| null`;
    * K's raw `maxTasks` (`:455`);
    * K's guard on `getWorkspaceOpenRouterKey` (`:335-337`; `routes/proxy.js:1576` always passes it);
    * K's missing plan block (the pilot is implementation-only, `lib/dispatch-factory.js:687`);
    * K's hard-coded `retryable: false` on structural refusals (`:483`).
  * **(d), keep and write up:**
    * Field acceptance per verb. P ignores `presetId`, `stopAt`, `variant`, `attachProxy`, `entryRung`, `surface` and `composedRunMarker`; R and K take no `terminal`; nothing type-checks `appendProxyContext`.
    * S and P only length-cap `issueIdentifier` (`lib/dispatch-validation.js:179`), where R and K require `isValidIssueId`.
    * S stamps `issueSource` on an issue-naming abort (`dispatch.js:639`) and P does not (`proxy-dispatch.js:537`).
    * P resolves a provider for a repo-only dispatch (`proxy-dispatch.js:525`, a LIN-2886 leftover).
    * S's plan block reads through the active provider, not the issue's source (`dispatch.js:719,726` against `:655`).
    * K answers a transient `OWNER_CHECK_UNAVAILABLE` launch with the token-rate-limit 503 (`proxy-kickoff.js:472` before `:480`). S and M4 give the owner text (`dispatch.js:967-970`, `routes/workspace-api.js:3098-3101`), and `tests/unit/lin-3136-m1-kickoff-declared.test.js:215-221` pins K's answer.
    * R and K return different upstream-auth envelopes (`proxy-dispatch.js:1087-1090` against `proxy-kickoff.js:500-539`).
* **Out of scope here:** the store's run-field normalisers (`lib/dispatch-fields.js:48-170`) duplicate several D23 normalisers. Write each normaliser once in the authority's `fields` and leave the store alone.
* No edits to `scripts/code-shape/areas.json`.
* **Comments.** Keep every ticket reference and reason comment beside the code it governs, and move it with that code. Correct the (a) comments rather than copying them.
* **Security.** Never weaken a security guard.
  * The #4a sweeps must stay green and unmodified: `tests/unit/dispatch-entrance-*.test.js` and `tests/unit/lib/entrance-route-sweep.js`.
  * Any other test change needs its reason in the PR.
  * **Risk: a known gap in the sweeps.** For recommend-and-dispatch and kickoff, the proxy-grant sweep's "reaches no sink" checks pass vacuously: their fixtures stop at a 404 issue lookup. Only the explicit 403 `DISPATCH_GRANT_REQUIRED` checks would catch a dropped grant on those two routes. The gate stays on the registration line, which helps, but check it anyway.
    * In your replay, include requests with a valid issue and a token lacking `dispatch`, and show they reach no enqueue on R and K.
    * You may strengthen that sweep's fixture so a valid issue reaches the enqueue point. Give the reason in the PR, and loosen nothing.
* **Your own replay.**
  * Drive the four entrances over HTTP, old against new, on about 1,000 seeded inputs with one seed. Cover every body field, auth state, grant, target, cascade/followUpTo/abort shape and error path.
  * Freeze the clock and set TZ=UTC.
  * Compare: status; body bytes, key order included; the headers that matter (`Retry-After`, `RateLimit-*`, content-type); store writes; token-store calls and their arguments; provider calls; `logEvent`; console.
  * Expect 0 differences. Explain any you see by its divergence class.
  * Keep the replay out of `tests/unit` and out of the PR, or put it under `experiments/`. Paste its output in the PR.
* **Seams.** After committing, run `node scripts/code-shape/seams.mjs . origin/main` (the origin/main you branched from) and `node scripts/code-shape/seams.mjs . HEAD`, and paste the knot count for each.
  * At `15191460` there are 18 pairs and one group of 9.
  * A new pair, or a larger group, is not acceptable.
* **Report** the sites per decision before and after (the table above, re-counted on your branch).
* No live checks; no paid model calls.
* Don't start parallel forks or background sub-agents; do the parts one at a time. While iterating, run the unit tests for the files you change; run the full unit suite once before opening the PR. Leave e2e to CI; run it locally only to reproduce a CI failure.

**This is one PR. Don't split it into child tickets.**

**Done when.** Merged with `ci-success` green. The PR shows:
* the sites per decision before and after;
* each divergence with its class, and the (d) items under Open questions;
* seams before and after, with no new knot;
* the #4a sweeps untouched and green;
* the replay output.

**Out of scope.**
* The design-first rebuild of the authority (the next ticket).
* Other routes: the GET/DELETE/PATCH routes in these files, the broker and token routes in `routes/dispatch.js`, the feedback lanes in `routes/workspace-api.js`, `routes/collective.js`, `lib/follow-up-dispatch.js` and `lib/chat-tools.js`.
* Changing any (d) behaviour.
* Retiring the entrance normalisers in favour of `lib/dispatch-fields.js`.
