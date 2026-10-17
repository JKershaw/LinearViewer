TITLE: Rebuild the dispatch-entrance authority (lib/dispatch-entrance.js) design-first: the same behaviour on all four entrances, cleaner code, checked by a replay against today's authority

PARENT: LIN-3549 · PROJECT: Quality, Periodicals & Measurement · PRIORITY: High · STATE: Todo

**Repository: `JKershaw/LinearViewer` (Harbour).** Every path in this ticket is relative to its root. Branch from a freshly fetched `origin/main`. Nothing in `simple-dispatcher` or any other repository changes.

**Goal.** Rebuild `lib/dispatch-entrance.js` as a whole, in one change, with every entrance's behaviour held exactly.
* Keep its file name, its eight exports and their signatures: `enterSessionDispatch`, `enterProxyDispatch`, `enterRecommendDispatch`, `enterKickoff`, `firstFailure`, `opaqueFieldError`, `refuseWithoutStore`, `rejectAudited`.
* Import only from modules it imports today, plus the optional helper below.
* Touch `lib/dispatch-validation.js`'s `executionFieldError` (`lib/dispatch-validation.js:200`, used at `lib/dispatch-entrance.js:247`) only if your design needs it.

Merge as normal. The aim is code that does what today's does and is cognitively simpler, with less room for bugs and easier to maintain.

**Check your base first.** Check that origin/main contains 47d87055 (LIN-3604); lib/dispatch-entrance.js should be about 1,677 lines — if it's 45, you're on the wrong base. (`git merge-base --is-ancestor 47d87055 HEAD` must succeed.) If the check fails, fetch and branch again from `origin/main`. Every file:line below is at `47d87055`; `675c0d33` (LIN-3605, #1914) changed none of the cited files.

**Why.**
* LIN-3601 (PR #1912) turned the location pins on the dispatch entrances into behaviour sweeps.
* LIN-3604 (PR #1913, merged as `47d87055`) then made `lib/dispatch-entrance.js` the one authority for the decisions the four POST handlers share: 1,677 lines, 878 of them code and 704 comment lines. The three route files are now thin forwarders.
* The last rebuild of this code, LIN-3592 (PR #1906), came before both. It kept 86% of its lines verbatim, which makes it an edit, because tests pinned the code by the route it sat in.

This ticket asks whether, with the decisions in one place and those pins gone, a design-first rebuild simplifies further. Today's shape (`experiments/rebuild-exp1/kit/shape.mjs`): the authority has 268 decision points and 106 functions. The worst function is `enterRecommendDispatch` at 29 (`:1200-1494`), then `failure` at 28 (`:804-934`).

**Decision.**

**This is one PR. Don't split it into child tickets.**

* **Keep the operator's laptop usable.** Don't start parallel forks or background sub-agents; do the parts one at a time. While iterating, run the unit tests for the files you change; run the full unit suite once before opening the PR. Leave e2e to CI; run it locally only to reproduce a CI failure.
  * "The unit tests for the files you change" means `tests/unit/dispatch-entrance-*.test.js` plus the test files named under A and C below.
  * The full unit suite is `npm run test:unit`.
* **Keep the reasons.** Keep every ticket reference and reason comment beside the code it governs. Drop one only if its code is gone, and list those in the PR.
  * No test requires any of the authority's comments: blanking every comment fails nothing. So this rule alone keeps them.
  * But the C4–C6 and A4 scans below read comments. A kept or new comment must not contain `mintGrantBootstrap`, `grantDeclaration`, `grantRefusal`, `rateLimit(` or `declaredGrants`.
* **Work design-first, in this order.** No production line changes before step 3 is done.
  1. **Requirements.** Write the authority's contract into the PR description as one list, per lane: S (session dispatch), P (proxy dispatch), Ro and Rl (recommend-and-dispatch's verb-override and LLM arms), and K (kickoff). For each lane give:
     * the ordered check list (`SESSION_AFTER_GATE`, `PROXY_DISPATCH_STEPS`, `RECOMMEND_STEPS` and `KICKOFF_STEPS`, `:276-281`), with S's `SHAPE` ahead of its owner gate (`:986-994`);
     * every dependency read and write, in order, with its arguments;
     * the credential path: the follow-up gate, the launch attach, the declared sites M1 and M2 (`:722-736`), `unchangedPromptFails` and `tagLaunchRefusal`;
     * the `addItem` argument's key set per lane (`ROW_KEYS`, `:387-392`);
     * the 201 layout and its key order (`receiptFor`, `:408-466`);
     * the failure mapping, in order (`failure`, `:804-934`);
     * every `logEvent` status and note;
     * keepalive and hang-up behaviour (Ro, Rl);
     * console output.

     Take it from the code, the forwarders (`routes/dispatch.js:422-472`, `routes/proxy-dispatch.js:315-357`, `routes/proxy-kickoff.js:102-124`), `docs/architecture/dispatch-and-proxy.md` and the unit tests.
  2. **Design.** Write the design into the PR description, working from that list: the simplest structure that serves all five lanes, with its data flow, its functions and the single responsibility of each.
     * Decide the structure (the check pipeline, the credential path, the row, the reply and the failure mapping) before you open the old code again.
     * Carry over only lines that a kept constraint below requires, and lines the design genuinely needs.
     * Where part of today's structure is genuinely the simplest, say why.
  3. **Conversions your design needs.** Do each one by the conversion rule below, in its own commits.
  4. **Build.** Write the authority from the design, replacing the file as a whole. Don't copy functions or blocks from the old file. Reason comments, and lines a kept constraint requires, are exempt.
  5. **Replay, then seams and shape** (below).
* **An optional helper module**, only if the design needs one, imported only by the authority: `lib/dispatch-entrance-<name>.js`. That name falls in Runs & dispatch under the area guide's `dispatch-[^/]*` pattern. A helper sits outside every test's list of entrance files (A6), so adding one means doing A6 in step 3. Not adding one is cheaper.
* **Classify each difference your replay finds:**
  * **(a) A fix:** none is expected. Behaviour is held, so a bug you find is not fixed here; write it up as (d). Comment corrections need no class.
  * **(b) A regression:** any difference on a never-(c) channel below, for a request a caller could really make. Fix it.
  * **(c) Bounded fuzz.** Only these qualify; list each with a one-line reason:
    1. console wording that adds no credential or upstream text;
    2. an input no caller can produce, over HTTP or through the forwarders' `ctx`, where every never-(c) channel is the same.

    **These are never (c):**
    * status codes;
    * body bytes, key order included (and so the weak ETag);
    * credential mints and grants: which token-store call, and every argument (label, harness, `createdBy`, `declaredGrants`, `declaredSite`, the grant owner and workspace), on the launch arm and the follow-up arm;
    * gate order:
      * S's owner gate after `SHAPE` and before every other check, store read, provider call, run gate, mint, cascade expansion or write;
      * the session lane throwing when `ctx.ownerGate` is not a function (`:969-971`);
      * each lane's first-failure order and dependency-read order;
    * store writes: the `addItem` argument (key set and values), `expandCascadeAborts`, and the kickoff's `getItemStatus` read;
    * `logEvent` statuses and notes, the headers (`Retry-After`, content type), keepalive frames and the hang-up checks.

    Where unsure whether a difference is (c), it is (b).
  * **(d) Unclear:** keep today's behaviour and write it up in the PR under **Open questions**. Never end the run BLOCKED and never emit a `DECISION:` line for one.
* **LIN-3604's open questions stay open.** Behaviour is held. Carry the eight from PR #1913 into this PR's Open questions as they stand. Each recommendation is not applied:
  1. M3 — the P/R launch arms stay undeclared. No live ticket tracks it. The ticket and docs/worker-lane-prompt.md:69 cite LIN-3099 as M3's home, but LIN-3099 is "Passage: V1 end to end, maintenance first" (Done, unrelated). Needs a human to file one. — not applied in this PR.
  2. Field acceptance per verb. P ignores presetId, stopAt, variant, attachProxy, entryRung, surface, composedRunMarker; R and K take no terminal; no proxy verb type-checks appendProxyContext. Recommendation: keep, and in the design-first rebuild add the appendProxyContext type check to all three proxy verbs. — not applied in this PR.
  3. S and P only length-cap issueIdentifier; R and K require isValidIssueId. Recommendation: tighten S/P to isValidIssueId in the rebuild (a behaviour change). — not applied in this PR.
  4. S stamps issueSource on an issue-naming abort; P doesn't. Recommendation: stamp on neither; kept as the stampsOnAbort lane value until then. — not applied in this PR.
  5. P resolves a provider for a repo-only dispatch (a LIN-2886 leftover). Recommendation: drop the `|| repo` arm. — not applied in this PR.
  6. S's plan block reads through the active provider, not the issue's source. Recommendation: resolve the plan read the way the referent guard does. — not applied in this PR.
  7. K answers a transient OWNER_CHECK_UNAVAILABLE launch with the token-rate-limit 503; S and M4 give the owner text; tests/unit/lin-3136-m1-kickoff-declared.test.js:215-221 pins K's answer. Recommendation: give K the owner text. — not applied in this PR.
  8. R and K return different upstream-auth envelopes. Recommendation: K's for both. — not applied in this PR.

  At `47d87055` they sit at:
  1. `:714-721`, with `declare: null` at `:1154` and `:1233`;
  2. `:278-281`, `:387-392`;
  3. `:237` against `:157-161`;
  4. `:383`, `:1086`;
  5. `:1135-1137`;
  6. `:1068-1082`;
  7. `:850-853` before `:854-866`;
  8. `:873-883` against `:895-933`.

  Give this PR's file:line for each. PR #1913's body is the authority on the list. `lin-3136-m1-kickoff-declared.test.js` stays green.
* **Tests are part of the seam.** Some tests pin the authority's text or location rather than its behaviour, so a rewrite with the same behaviour fails them. A text-sensitivity probe at `47d87055` found which. Start from this inventory and confirm it on your base.
  * **The conversion rule (class A).** For each conversion:
    1. Land the replacement, green on unchanged code: a behaviour test, or a location-free check that still catches the same planted mutation.
    2. Show it failing on a scratch copy with the guarded behaviour removed, and paste that output in the PR.
    3. Only then loosen or remove the old pin, in its own commit.

    Never weaken what a pin catches. A conversion replaces how a property is checked, not how strongly. Convert only what your design needs, and for each pin you keep, say why it costs the design nothing.
  * **A, convertible.** A1, A2 and A4 share lin-3134's planted-mutation tests: whether those tests survive depends on all three, so settle them together in the plan (item 3).
    * **A1. The gate anchor.** `tests/unit/lin-3134-declared-mint-census.test.js:638` `POST_DISPATCH_GATE` is the exact two-line text at `lib/dispatch-entrance.js:675-676`, indentation included. It anchors three mutation tests: mutation 1 (iii c) at `:700`, mutation 4 at `:722` and mutation 1 (v) at `:782`.
      * Replacement: plant those mutations by position, using the file's own `scanDispatchCalls` (`:354`). Show each re-planted mutation still caught by its census.
      * Behaviour cover is the mint sweep's M1 and M2 rows (`tests/unit/dispatch-entrance-mint-sweep.test.js:195`, `:206`). At `47d87055`, with the gate rewritten to `if (prompt) {`, `:195` and `:206` fail (the probe also saw the composer row `:448` fail).
    * **A2. The gate spelling.** `lin-3134…:405-407` (`E_GATE_PREDICATES`), `:417-438` and `:485-489` require the follow-up gate to be spelled `if (isFollowUp) {` or `(followUpTo ? {` inside the text of the `createDispatchItem(` call. Do one of these:
      * **(i) Define the new rule precisely and keep the mutation tests.** Inside E, the call's first `provisionResumeCredential(` must sit inside an `if (<name>) {` block or a `<name> ?` branch, and some line in E must assign `<name>` (`const <name> =`, `let <name> =` or `<name> =`) from an expression that reads `followUpTo`. Today `const isFollowUp = followUpTo !== undefined && followUpTo !== null;` (`:326`) satisfies this. The scanner finds that assignment by the name and checks it. Re-planted under A1, `if (prompt) {` still fails this rule (`prompt` is a body field, not bound from `followUpTo`).
      * **(ii) Retire the spelling rule for E and the two mutation tests that depend on it**, mutations 1 (`:700`) and 1 (v) (`:782`), in the commit that loosens the rule. Their witness becomes the mint sweep's M1 and M2 rows (`:195`, `:206`). Before that commit, show both rows failing under `if (prompt) {`.

      Either way the replacement comes first. The two sites outside E (`:393-396`) keep their rows unchanged.
    * **A3. The inline `fields` literal.** `lin-3134…:354-384`, `:479-480`: only a `createDispatchItem({` literal whose `fields:` is an inline, spread-free object is accepted (today `lib/dispatch-entrance.js:759-782`).
      * Replacement: one behaviour test per lane. Post every accepted field plus a canary key, and assert that the `addItem` argument's key set equals the lane's, with the canary absent.
      * Show it failing with a `...body` spread planted into the call. Calls outside E keep (ii).
    * **A4. The declared-grant count.** `lin-3134…:133`, `:141-145`, tests `:155-198`: E holds exactly two lines containing `declaredGrants`, each exactly `declaredGrants: ['dispatch'],` (`lib/dispatch-entrance.js:724`, `:731`). The scan reads raw lines, comments included (`:67-79`).
      * Then loosen E's F3 row from exact text to count: E's code, with comments stripped, mentions `declaredGrants` exactly as many times as it has declared sites (M1, M2), in any formatting.
      * Mutation 4 (`:721-724`) must still fail under the loosened row, and so must the existing extra-literal and removed-literal witnesses (`:181-191`).
      * Keep the unlisted-writer rule outside E, and the M4 row.
      * The mint sweep's World N (`:195`, `:206`, `:217`, `:236`) is the behaviour cover. Show it failing with K's `declare: 'M1'` set to `null`.
    * **A5. The `resolveProviderAccess` line.** `tests/unit/proxy-credential-fingerprint-stamping.test.js:144`, `:157-165`: E holds at least one exact line `const { token: accessToken, reason, provider } = await resolveProviderAccess(req.proxyUrlKey, req.proxyCreatedBy, req(, {…})?);` (today `:554`).
      * Replacement: assert on P, R and K that the fake `resolveProviderAccess` receives the request object itself as its third argument, and that the reply's provider names come from the `provider` the fake returned (the pinned line exists to destructure it, LIN-2044, `:125`). Put this beside `dispatch-entrance-no-token.test.js`.
      * Show it failing with `{}` passed instead of the request.
      * Then drop the E half of the exact-line count (`:157-165`). `routes/proxy-compute.js`'s 7 and `routes/proxy.js`'s 0 stay.
    * **A6. The entrance-file lists (only with a helper).** Moving the whole authority to a sibling file fails 21 tests across seven of these files. Add the helper by name to each list, and show each census's own planted-mutation witness still failing for the helper file:
      * `lin-3134…:95`;
      * `tests/unit/lin-3130-create-dispatch-item-proxy-token-store-pin.test.js:39`;
      * `tests/unit/lin-3136-enqueue-census.test.js:33`, `:44`;
      * `tests/unit/lin-3383-runner-enqueue-census.test.js:148`;
      * `tests/unit/lin-3384-redaction-census.test.js:161-162`;
      * `tests/unit/run-limit-gating.test.js:236-243`;
      * `proxy-credential-fingerprint-stamping.test.js:62`;
      * `tests/unit/lin-2534-tokens-admin-extraction.test.js:119-127`.
    * **A7. The object-literal call.** `lin-3130…:154`, `:188-189`: each `createDispatchItem(` takes an object literal with a direct `proxyTokenStore` key. Recommended: keep it; it costs a design nothing.
  * **C, keep as written:**
    * `lin-3383…:70`, `:149-158`: no unlisted sink kind in E (no direct `.addItem(`), and `createDispatchItem(` and `expandCascadeAborts(` still occur in E.
    * `lin-3384…:165-190`: no new dispatch-store reader kind and no raw `historyCollection` read, and every listed reader kind (`getItemStatus` among them) still occurs in E.
    * `lin-3136-enqueue-census.test.js:50-70`.
    * C4: `tests/unit/proxy-tokens-private-mint-source-pin.test.js:89-95`: the word `mintGrantBootstrap` appears nowhere in `lib/` or `routes/` except its two files, comments included.
    * C5: `lin-3134…:82`: no `grantDeclaration` or `grantRefusal`, comments included.
    * C6: `lin-2534…:113-134`: no `rateLimit(` in the authority, comments included. (The test allows a `= rateLimit(` declaration; the authority needs none.)
    * `run-limit-gating.test.js:243-262`: some E file passes `runGate` to `createDispatchItem` and relays the refusal.
    * `tests/unit/interactive-openrouter-chain-byte-identity.test.js:139`, `:217-225`.
    * The whole-tree scans `tests/unit/urlkey-holders.test.js`, `tests/unit/lin-3382-urlkey-class-guard.test.js`, `tests/unit/email-import-boundary.test.js` and `tests/unit/proxy-scopes-source-pin.test.js:43-57`.
    * C10: `lin-3134…:573-577`: E keeps each arm | helper kind. C10's "follow-up" is as the converted A2 rule defines it.
  * **Unmodified and green:**
    * LIN-3601's sweeps (PR #1912), `tests/unit/dispatch-entrance-*.test.js` and `tests/unit/lib/entrance-route-sweep.js`. A conversion's replacement goes in new test files only; no edits to the existing files.
    * LIN-3592's `tests/unit/dispatch-entrance-pins.test.js`.
    * LIN-3604's owner-gate fail-closed test, `tests/unit/dispatch-entrance-owner-gate-fail-closed.test.js`.
      * It imports `enterSessionDispatch` (`:14`). It expects a rejection matching `/ownerGate/` before any dependency is touched (`:50`, `:58`).
      * The gate is called once, with `target ?? 'cli'` (`:69`, `:79`).
      * It also drives S to a 201 (`:100-106`) with only these `ctx` keys: `req` (`body`, `session`, `protocol`, `get`), `res` (`status`, `json`, `set`), `workspace`, `dispatchQueueStore` (`addItem`, `expandCascadeAborts`, `getItemStatus`), `dispatchTokenStore` (`listTokens`), `dispatchPresetsStore` (`get`), `afterEnqueue` and `ownerGate`. It passes no `logEvent` and no proxy token store. S's success path must need no other key and answer only through those methods.
  * **Stale, report only.** Fix one only inside an A conversion of the same test:
    * `lin-3384…:132`: the `parentRun` row names code that moved in PR #1913; it is never checked (`:185`).
    * `lin-3134…:405-406`: the `(followUpTo ? {` form, which no E call uses.
    * `lin-3134…:681-683`: the call counts it names.
    * `proxy-credential-fingerprint-stamping.test.js:125`, `:227`, `:232`: the titles say "9 direct sites".
  * Any other test change needs its reason in the PR.
* **Your own replay.** Drive the four entrances over HTTP, old against new, on one seed, not coverage-guided.
  * Load the old side from a `git archive` of your merge base into a temporary folder outside the repository.
  * You may reuse `experiments/lin-3604-entrance-replay/`; its README gives the commands. Its seed-3604 stream builds about 2,455 inputs (S 803, P 641, Ro 378, Rl 250, K 383), and that is fine. A harness of your own needs at least about 1,000 over the same classes:
    * every single fault, and every ordered pair of check steps;
    * a valid issue without `dispatch` on R and K;
    * keepalive and hang-up cases;
    * the vacuity guard.
  * Compare:
    * status;
    * body bytes, key order included;
    * the headers that matter;
    * every dependency call, with its arguments, in order (the `addItem` argument included);
    * token-store calls;
    * `logEvent`;
    * console.
  * Freeze the clock and set TZ=UTC.
  * Expect 0 differences, and explain any by its class. Paste the output in the PR.
  * A separate independent replay checks the merged result.
* **Seams.** Commit first, then run `node scripts/code-shape/seams.mjs . $(git merge-base HEAD origin/main)` and `node scripts/code-shape/seams.mjs . HEAD`. Paste the pairs and the largest group of each.
  * Compare against the origin/main you branched from. At `47d87055` there are 18 pairs and one group of 9 (also 18 and 9 at `675c0d33`, #1914).
  * A new pair, or a larger group, is not acceptable. If one appears, find the import that causes it and undo it.
  * No edits to `scripts/code-shape/areas.json`.
* **Shape.** Run `node experiments/rebuild-exp1/kit/shape.mjs <file>` on these files, at the merge base and on your branch:
  * `lib/dispatch-entrance.js`, plus any helper, and `lib/dispatch-validation.js` if touched;
  * the three route files.

  Report each file's code lines, decision points and worst function, before and after.
* **Scope.** Change only:
  * `lib/dispatch-entrance.js`, the optional helper, and `executionFieldError` if the design needs it;
  * the A-conversion tests and their replacements;
  * the route forwarders, only as far as the design needs. They stay thin forwarders and keep their registrations, middleware chains (`requireGrant('dispatch')` included), limiters, factory signatures, endpoint tag literals and the block-bodied forwarder form `tests/unit/lin-3136-dispatch-gate.test.js:165-178` requires;
  * the authority's entries in `docs/architecture/source-map.md` and `docs/architecture/dispatch-and-proxy.md`, where they describe its internals.

  No new mechanism in the repository beyond the optional helper.
* No live checks; no paid model calls.

**What the plan must contain.** Before writing code, post a plan with these six items; nothing more is needed.
1. The requirements list (step 1 above), per lane.
2. The design: the authority's functions, one line each, with the decisions each owns, and for each lane where each gate runs ("before X").
3. The conversions you will make. For each:
   * the A id and the replacement test;
   * the scratch mutation that shows the replacement failing;
   * how the old pin is loosened.

   Include the choice for A2 ((i) or (ii)) and what happens to lin-3134's three mutation tests (`:700`, `:722`, `:782`). List the A pins you keep, and why.
4. The order of commits: conversions (replacement, then loosening, one pin at a time), then the rebuild, then any docs.
5. How behaviour is shown unchanged:
   * the replay's input classes and the channels it compares;
   * the full unit suite;
   * LIN-3601's sweeps and the owner-gate test, unmodified;
   * seams.
6. What is out of scope (below), and any (d) item you already expect.

The plan reviewer approves a plan that covers 1–6 and breaks no constraint in this ticket. Helper names, parameter shapes and line-level design are for PR review.

**Done when.** The rebuilt authority is merged as normal, with `ci-success` green and no second copy.

Report the share of the new file's non-trivial lines that appear verbatim in the old file, computed as follows:
* Use `experiments/verbatim/verbatim.mjs`'s rule: trimmed lines; ignore blank lines, lines made only of `{}[]();,` and whitespace, comments, and imports; match as a multiset.
* The old side is the merge base's `lib/dispatch-entrance.js`, plus `lib/dispatch-validation.js` if you touched it. The new side is your branch's `lib/dispatch-entrance.js`, any helper, and `lib/dispatch-validation.js` if touched.
* Normalise trailing semicolons: drop each line's one trailing `;` on both sides before matching.
* `verbatim.mjs` measures only the merged tickets it lists, so don't run it; it also rewrites the tracked `experiments/verbatim/verbatim.md`. Instead, copy its `stripImports`, `TRIVIAL` and `nonTrivialLines` (`:39-51`) into a throwaway script outside the repository. Read both sides with `git show <merge-base>:<path>` and `git show HEAD:<path>`.
* Report the normalised share and the raw one, and say how you computed them.

A design-first rebuild typically lands at 37–55%. Above about 60%, explain why in the PR or treat the run as an edit and redo the design.

The PR also shows:
* the shape before and after;
* each conversion, with its failing-then-passing evidence;
* the replay result;
* seams before and after, with no new knot;
* the requirements list and the design;
* the Open questions: PR #1913's eight, carried forward, and any new (d);
* any reason comments or ticket references dropped with their code.

**Out of scope.**
* The route files beyond what the design needs. They stay thin forwarders, keeping their registrations, middleware chains, limiters and the block-bodied forwarder form.
* The GET, DELETE and PATCH routes, the refire broker and the token routes.
* `routes/proxy.js`, `server.js`, `lib/dispatch-factory.js`, `lib/dispatch-store.js` and `lib/dispatch-fields.js`.
* Behaviour changes, including any fix.
* The open questions.

**References.**
* LIN-3604 (PR #1913): the consolidation this rebuilds.
* LIN-3601 (PR #1912): the sweeps.
* LIN-3592 (PR #1906): the control rebuild.
* LIN-3596 (PR #1908): the verbatim Done-when line.
* LIN-3549: the parent.
