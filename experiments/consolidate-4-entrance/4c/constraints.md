# #4c constraints: what still holds `lib/dispatch-entrance.js` to its current text

Grounded at LinearViewer origin/main `47d87055` (LIN-3604, PR #1913). Every file:line below is at that commit
(read from `git archive 47d87055` in `tree/`). Revised before launch after the fresh-reader check (`fresh-reader.md`): origin/main is now `675c0d33` (LIN-3605, #1914), which touched none of the cited files.

## How this was found

1. **Reading.** Every unit test that reads `lib/dispatch-entrance.js` or the three entrance route files as text, or
   walks `lib/` and `routes/` (the `E_FILES`-style sets and the whole-tree scans).
2. **A text-sensitivity probe.** Nine rewrites of `lib/dispatch-entrance.js` that change its text but not its
   behaviour (`probe/perturb.cjs`), each run against the full unit suite with non-loopback sockets blocked
   (`probe/run-suite.sh`, `probe/block-net.mjs`; 17,432 tests, about 2–3.5 minutes a run). The baseline fails 6
   tests, all in `task-page-links.test.js`, which needs a git checkout. The same 6 fail in every run and are left
   out of the table below. In no run did a behaviour test fail, so each rewrite really is behaviour-neutral as far as
   the suite can tell. The replay's equivalent mutant `eq-fields-row` checks the `fields` rewrite separately
   (`replay-4c.md`).

| Rewrite | What changed | Unit failures beyond baseline | Tests that failed |
|---|---|---|---|
| `indent` | every line indented 2 more spaces | 3 | lin-3134 (mutation 1 (iii c), mutation 1 (v), mutation 4): the `POST_DISPATCH_GATE` anchor |
| `nocomment` | every comment blanked | **0** | none: no test *requires* any of the authority's comments (the reason comments are kept by the ticket's rule, not by a test). Some scans do read comments for forbidden words (C4–C6, A4): blanking cannot trip them, but a new comment can |
| `rename` | `isFollowUp`, `createKit`, `kit`, `STEPS`, `ROW_FIELDS`, `receiptFor`, `parentRun`, `proxyContextPolicy`, `rowFor` renamed | 8 | lin-3134 C2 (i)–(v): the gate is only recognised as `if (isFollowUp) {` |
| `fields` | `fields: row` in place of the 22-key inline literal | 2 | lin-3134 C2 (i)/(ii): `fields` must be an inline, spread-free object |
| `callshape` | the factory argument built first, then `createDispatchItem(factoryArgs)` | 9 | lin-3130 (object literal with a direct `proxyTokenStore` key); lin-3134 C2 (all of it: the scanner only sees `createDispatchItem({`) |
| `declared` | one `declaration(site, …)` builder in place of the two M1/M2 literals | 4 | lin-3134 F3: exactly 2 `declaredGrants: ['dispatch'],` lines in E |
| `access` | `resolveProviderAccess(who.urlKey, req.proxyCreatedBy, req, { source })` | 1 | proxy-credential-fingerprint-stamping: the exact destructure line |
| `gate` | `if (policyIsFollowUp(isFollowUp)) {` | 8 | lin-3134 C2, as `rename` |
| `split` | the whole file moved to `lib/dispatch-entrance-core.js`, re-exported (`export *`) | 21 | lin-3130, lin-3134, lin-3136-enqueue-census, lin-3383, lin-3384, proxy-credential-fingerprint-stamping, run-limit-gating: each lists the entrance files by name |

Counts are failing leaf tests (`probe/r-<name>.tap`; `probe/fails2.sh` lists them with their suites).

## Classes

* **A**: pins text or location. A rebuild may convert it, but only in this order: the replacement lands first
  (a behaviour test, or a location-free check that still catches the same planted mutation), green on unchanged code;
  it is shown failing on a scratch copy with the guarded behaviour removed; only then is the old pin loosened or
  removed, in its own commit.
* **C**: a property only text can see, or a security vocabulary rule that costs a design nothing to satisfy. Keep,
  and satisfy as written.
* **S**: stale or vacuous: checks nothing today. Report it. Fix it only inside an A conversion of the same test.
* **B**: a behaviour test that binds the authority's API (exports, `ctx` names, error text). Stays unmodified.

## A: convertible (they constrain the design)

| Id | Test, file:line | What it pins | Tripped by | Replacement, and the guard to remove when showing it failing |
|---|---|---|---|---|
| A1 | `tests/unit/lin-3134-declared-mint-census.test.js:638` `POST_DISPATCH_GATE`, used by mutation 1 (iii c) `:700`, mutation 4 `:722` and mutation 1 (v) `:782` | The exact two-line text `"          if (isFollowUp) {\n            return provisionResumeCredential({"`, ten- and twelve-space indentation included (`lib/dispatch-entrance.js:675-676`). `plantInE` (`:103-114`) fails loudly when the anchor is missing | `indent`, `rename`, `gate`, `split` | Plant the three mutations by position, not by text: find the first `provisionResumeCredential(` inside an E `createDispatchItem({…})` call with the scanner the file already has (`scanDispatchCalls` `:354`, `indicesOf` `:409`), and rewrite the `if (…)` that guards it. Show each re-planted mutation still caught. A2 and A4 decide whether these three tests survive, so settle A1, A2 and A4 together. Behaviour cover already exists: `dispatch-entrance-mint-sweep.test.js:245` (a launch never reads a declaration) and `:195`, `:206` (M1 and M2 each mint one declared credential). With the gate shared across lanes since #1913, the gate-to-`prompt` mutation is now behaviour-visible: it sends the M1 and M2 launches down the resume path, which declares nothing. Checked at `47d87055` on a scratch copy with the gate rewritten to `if (prompt) {`: the mint sweep fails 3 tests (M1 `:195`, M2 `:206`, and the composer row `:448`; `probe/gate-to-prompt-mintsweep.tap`), and the replay mutant `gate-to-prompt` differs on K and S (`replay-4c.md`) |
| A2 | `lin-3134…:405-407` `E_GATE_PREDICATES = ['isFollowUp', 'followUpTo']`; `findGate` `:417-427`, `findEntranceGate` `:430-438`; the (iii c) rule at `:485-489` | The follow-up gate must be written `if (isFollowUp) {` or `(followUpTo ? {` inside the text of the `createDispatchItem(` call's argument | `rename`, `gate` | The property: only a follow-up reaches the resume helper. Security strength must not drop, so the ticket offers exactly two ways. (i) A precise rule: inside E, the call's first `provisionResumeCredential(` sits inside an `if (<name>) {` block or a `<name> ?` branch, and some E line assigns `<name>` from an expression that reads `followUpTo`. Today that line is `const isFollowUp = …followUpTo…` at `lib/dispatch-entrance.js:326`. The re-planted `if (prompt)` mutations still fail under it. (ii) Retire the E spelling rule and mutations 1 (`:700`) and 1 (v) (`:782`) in the loosening commit. Their witness becomes the mint sweep's M1 and M2 rows (`:195`, `:206`), shown failing under `if (prompt) {` first. Both are verified at `47d87055`: `probe/gate-to-prompt-mintsweep.tap`. The two sites outside E (`FOLLOWUP_SITES` `:393-396`, `predicate: null`) keep their rows unchanged. (Fresh-reader H2 showed that "under some `if`", this file's first wording, would no longer catch `if (prompt)`.) |
| A3 | `lin-3134…:354-384` `scanDispatchCalls` (only `createDispatchItem({` is seen, `:358`); (ii) `:479-480`; test `:641-650` | Every E call is an object literal whose `fields:` is an inline, spread-free `{…}` (today `lib/dispatch-entrance.js:759-782`) | `fields`, `callshape`, `split` | The property is that no body key reaches the row unless the lane names it. New behaviour test, one per lane (S, P, Ro, Rl, K): post a body carrying every accepted field plus a canary key, and assert the `addItem` argument's key set equals that lane's set (today `ROW_KEYS`, `lib/dispatch-entrance.js:387-392`, plus the factory's keys), with the canary absent. Show it failing with a `...body` spread planted into the factory call. Then exempt E calls from (ii). Calls outside E keep (ii) |
| A4 | `lin-3134…:133` F3 row `{ site: 'M1+M2', unit: 'E', count: 2, text: "declaredGrants: ['dispatch']," }`; `checkF3` `:141-145`; tests `:155-198`; `scanTokens` reads raw lines, comments included (`:67-79`) | E holds exactly two lines containing `declaredGrants`, each exactly `declaredGrants: ['dispatch'],` (`lib/dispatch-entrance.js:724`, `:731`). Any other mention, even in a comment, is an "unlisted writer" | `declared`, `split` | Loosen from exact text to a count, at the same strength: E's code, with comments stripped, mentions `declaredGrants` exactly as many times as E has declared sites (M1, M2), in any formatting. Mutation 4 (`:721-724`, a dead literal in E) and the extra- and removed-literal witnesses (`:181-191`) must still fail under the loosened row. The unlisted-writer rule outside E and the M4 row stay. Behaviour cover is the mint sweep's World N: M1 and M2 declare (`:195`, `:206`), the proxy-dispatch launches stay grant-less (`:236`), and a non-orchestrator session launch is grant-less (`:217`). Show it failing with `declare: 'M1'` → `null` (also the replay mutant `m-declare`). (This file's first wording, "at least one writer, any form", was weaker than the pin; fresh-reader H2.) |
| A5 | `tests/unit/proxy-credential-fingerprint-stamping.test.js:144` (pattern), `:157-165` (at least 1 in E) | E holds at least one line `const { token: accessToken, reason, provider } = await resolveProviderAccess(req.proxyUrlKey, req.proxyCreatedBy, req(, {…})?);` (today `lib/dispatch-entrance.js:554`). The `req`-third-argument rule (`:108-122`) is satisfied by any call that passes `req` | `access`, `split` | Behaviour: R and K hand `resolveProviderAccess` the request object as its third argument, and answer a null token with the 503 and nothing further (`dispatch-entrance-no-token.test.js`). Add an assertion that the fake receives `req` itself (identity) on P, R and K. Show it failing with `req` replaced by `{}`. Then drop the E half of the exact-line count; `routes/proxy-compute.js`'s 7 and `routes/proxy.js`'s 0 stay |
| A6 | The entrance file lists: `lin-3134…:95` `E_FILES`; `lin-3130-create-dispatch-item-proxy-token-store-pin.test.js:39`; `lin-3136-enqueue-census.test.js:33`, `:44`; `lin-3383-runner-enqueue-census.test.js:148`; `lin-3384-redaction-census.test.js:161-162`; `run-limit-gating.test.js:236-243`; `proxy-credential-fingerprint-stamping.test.js:62`; `lin-2534-tokens-admin-extraction.test.js:119-127` | The authority is exactly `lib/dispatch-entrance.js`. A helper module beside it holds sinks, mints and reads "outside E" | `split` (21 failures) | Only needed if the design adds a helper. Extend each list to the helper by name (one line each; still exact, not a glob). Show each census still catching its planted mutation in the helper file (each already has an `appendToE`-style witness per E file, e.g. `lin-3134…:188-191`, `:664-669`; `lin-3384…:235-240`). Behaviour is the #4a sweeps', which drive the routes whatever file holds the code. The cheaper path is no helper |
| A7 | `lin-3130…:154` and `:188-189` | Each `createDispatchItem(` call takes an object literal with a direct `proxyTokenStore` key; 5 outside E, at least 1 in E | `callshape`, `split` | Satisfying it costs a design nothing: one call, an object literal, `proxyTokenStore` named in it. **Recommend: keep as written** (convert only with A3, the same way) |

## C: keep as written

| Id | Test, file:line | Rule for the authority |
|---|---|---|
| C1 | `lin-3383-runner-enqueue-census.test.js:70` `SINK_RE`, `:149-158` `E_MEMBERS`, `:225-243` | The only enqueue sinks in E are the listed kinds; no direct `.addItem(` (an unlisted kind). Each listed kind still occurs in E (`createDispatchItem(` and `expandCascadeAborts(` are the authority's, `lib/dispatch-entrance.js:540`, `:640`) |
| C2 | `lin-3384-redaction-census.test.js:165` `E_READER_KINDS`, `check` `:168-190` | No new dispatch-store reader kind in E, and no raw `historyCollection` read; every listed reader kind still occurs in E. Today the authority's only reader is `getItemStatus` (`lib/dispatch-entrance.js:1573-1574`) |
| C3 | `lin-3136-enqueue-census.test.js:50-70` | Proxy enqueue sinks sit only in E (or under a gated POST) |
| C4 | `proxy-tokens-private-mint-source-pin.test.js:89-95` | The word `mintGrantBootstrap` appears nowhere in `lib/` or `routes/` except `lib/proxy-preamble.js` and `routes/proxy-tokens-admin.js`, comments included |
| C5 | `lin-3134…:82` `scanC4` | No `grantDeclaration` or `grantRefusal` anywhere, comments included. The F3 scan (`:81`) also counts every `declaredGrants` mention (A4) |
| C6 | `lin-2534-tokens-admin-extraction.test.js:113-134` | `rateLimit(` in the authority only as a `= rateLimit(` declaration, comments included. The test allows a declaration; the authority needs none (today: none) |
| C7 | `run-limit-gating.test.js:243-262` | Some E file passes `runGate` to `createDispatchItem` and holds `mapDispatchRefusal(`, `relayDispatchRefusal(` or `err.runLimit` |
| C8 | `interactive-openrouter-chain-byte-identity.test.js:139`, `:217-225` | No `checkFreeTierGate(` in `lib/`; never the shared chain expression `sessionApiKey \|\| getPaidEnvKey() \|\| freeTierKey` |
| C9 | whole-tree scans: `urlkey-holders.test.js:183`, `lin-3382-urlkey-class-guard.test.js:44`, `email-import-boundary.test.js`, `proxy-scopes-source-pin.test.js:43-57` | No `collection('…')` literals, no email imports, no new urlKey class holders. `READ_WRITE` stays imported and used somewhere in E (today in `routes/dispatch.js`, the refire broker) |
| C10 | `lin-3134…:573-577` `E_MINT_ROWS` | E keeps at least one `follow-up \| provisionResumeCredential`, one `- \| provisionResumeCredential` (the refire broker, in `routes/dispatch.js`) and one `launch \| attachProxyContext`. After A2, "follow-up" is as the converted rule defines it |

## B: behaviour tests that bind the authority's API (unmodified)

* `tests/unit/dispatch-entrance-owner-gate-fail-closed.test.js:14` imports `enterSessionDispatch` from
  `lib/dispatch-entrance.js`. It passes `ctx.ownerGate`, `ctx.afterEnqueue`, `ctx.workspace`, the stores and
  `req`/`res`, and expects a rejection matching `/ownerGate/` (`:50`, `:58`) before any dependency is touched. So
  the export name, those `ctx` names and the word `ownerGate` in the thrown message are fixed.
* The four route forwarders import `enterSessionDispatch`, `opaqueFieldError` (`routes/dispatch.js:32`),
  `enterProxyDispatch`, `enterRecommendDispatch`, `refuseWithoutStore`, `rejectAudited`
  (`routes/proxy-dispatch.js:18`) and `enterKickoff` (`routes/proxy-kickoff.js:13`). `firstFailure` is also
  exported. Keep the eight exports and their signatures (the replay's direct class compares them:
  `enter*` arity 1, `opaqueFieldError` 3).
* The #4a sweeps (`tests/unit/dispatch-entrance-*.test.js`, `tests/unit/lib/entrance-route-sweep.js`) and
  `dispatch-entrance-pins.test.js` (LIN-3592's fixes). The rebuild leaves them unmodified, except where an A
  conversion adds its replacement next to them, additions only.

## Route-file constraints (out of scope for the rebuild, listed so the design does not trip them)

* `lin-3136-dispatch-gate.test.js:165-178`: each proxy POST registration line reads, after the path,
  `proxyLimiter, authenticateProxyToken, requireWriteScope, requireGrant('dispatch'), async (req, res) =>`,
  optionally followed by ` {` (`:173`). That is the block-bodied forwarder at `routes/proxy-dispatch.js:315`,
  `:356` and `routes/proxy-kickoff.js:102`.
* `proxy-tokens-private-mint-source-pin.test.js:148-149`: `requireGrant('dispatch')` is mounted on exactly those
  three POSTs.
* `lin-2534…:113-134`: the module-scope limiter declarations (`routes/dispatch.js:74`, `:89`, `:100`).
* `tests/unit/lib/proxy-di-witness.js:191-210`: the factory signatures against the composer's mounts.
* `proxy-credential-fingerprint-stamping.test.js:79-88`, `:232-242`: each endpoint tag literal stays in its own
  route file (`routes/proxy-kickoff.js:106`, `routes/proxy-dispatch.js:316`, `:357`).
* `lin-3134…:840` `BROKER_HELPER_CALL`: an indentation-exact anchor into the refire broker in
  `routes/dispatch.js`. It is the same kind of pin as A1, but it is not the authority's, so leave it.

## S: stale or vacuous (report; fix only inside an A conversion of the same test)

* `lin-3384-redaction-census.test.js:132`: the row `'routes/proxy-kickoff.js :: parentRun': [SRV, 1]` names code
  that moved to `lib/dispatch-entrance.js:1573` in #1913. The stale-row check skips E route files (`:185`), so
  the row is never checked. The `rename` run renamed `parentRun` with no failure.
* `lin-3134…:405-406`: the `(followUpTo ? {` predicate form ("the session route"). Since #1913, no E call uses it.
* `lin-3134…:681-683`: "3 x routes/proxy-dispatch.js and 1 x routes/dispatch.js today". There is one E call now,
  `lib/dispatch-entrance.js:640`.
* `proxy-credential-fingerprint-stamping.test.js:125`, `:227`, `:232`: the titles still say "the 9 direct … sites".
  E plus 1.

## Owner-gate test, in full (fresh-reader M2)

`dispatch-entrance-owner-gate-fail-closed.test.js` also drives S to a 201 (`:100-106`) with only these `ctx` keys: `req` (`body`, `session`, `protocol`, `get`), `res` (`status`, `json`, `set`), `workspace`, `dispatchQueueStore` (`addItem`, `expandCascadeAborts`, `getItemStatus`), `dispatchTokenStore` (`listTokens`), `dispatchPresetsStore` (`get`), `afterEnqueue` and `ownerGate`. It passes no `logEvent` and no proxy token store. It also checks that the gate is called once, with `target ?? 'cli'` (`:69`, `:79`). S's success path must need no other key.

## What this leaves the design

With A1–A4 converted (and A6 only if a helper is added), the authority can be rewritten with any indentation,
names, gate form, factory-argument construction and declaration form. What stays fixed: the eight exports, the B
test's `ctx` names and its `/ownerGate/` text, the C vocabulary rules, the exact-line `resolveProviderAccess`
destructure (unless A5 is converted), and an object-literal factory call naming `proxyTokenStore` (A7). The probe
shows that the authority's comments are pinned by nothing, so keeping them is the ticket's rule alone.
