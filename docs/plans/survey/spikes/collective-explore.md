# Spike: what Collective is today (LIN-450)

Read-only, against Harbour origin/main `5c33e4415` (25 Nov). Nothing was queried in production. **[unconfirmed]** marks anything I could not check.

## 1. What it does for a person
- It is a page, not a set of prompts: `/workspace/:urlKey/collective` (`routes/collective.js:101`). You pick "characters": a connected repo plus five persona fields (role, lens, objective, brings, disposition). You can also load one of 6 built-in "preset meetings" (Standup, Design crit, Architecture review, Pre-mortem and two more; `lib/collective-preset-defs.js:121-273`). Then you name a Yap chat channel, give a topic and press Start (`lib/render-collective.js:157-214`).
- Start sends one full Claude Code session (`cli`/`web` only) into each character's workspace queue. Each session gets a participant or facilitator prompt that tells it to join the Yap channel and discuss the topic (`routes/collective.js:154-471`; prompts in `lib/prompts/collective-participant.js`, 665 lines). The page then shows the live channel by polling Yap and has a box where you can post into it (`:579-645`).
- What it is for: to automate John's hand-run cross-project discussions. Write-ups: `docs/collective-session-2026-06-12.md` (held in `#Collective`) and `docs/collective-session-2026-07-03.md`.
- How far it got: **built and working as a V1, then frozen.** The feature was built in two bursts. V1 landed on 13 Jun (`2b7ad9398`, `8d48dfe59`). Characters, facilitator and presets followed on 5-6 Jul (`b6359193d`, `f81d6171e`, `f9ca9276c`, `de23691b3`). Some pieces were never built. The ticket's own deferred list (`docs/architecture/experiments.md:13`) names recaps, a lasting transcript, an automatic cadence and a within-one-project variant. There is no form for writing your own presets: the CRUD routes exist "for a future feature (e.g. LIN-1051)" (`routes/collective.js:474-480`). Side effects are limited only by the prompt, which tells participants to ask John first; no code enforces it, and this is a named gap (`experiments.md:10`).
- "Just the kickoff prompts" is not quite right. The prompts are about 665 of the roughly 3,450 production lines.

## 2. Size and what names it
- **Production: 9 files, 3,450 lines.**

  | File | Lines |
  |---|---|
  | `routes/collective.js` | 648 |
  | `lib/prompts/collective-participant.js` | 665 |
  | `public/collective.js` | 492 |
  | `lib/collective-preset-defs.js` | 388 |
  | `public/collective.css` | 317 |
  | `lib/collective-characters-store.js` | 280 |
  | `lib/yap-client.js` | 244 |
  | `lib/render-collective.js` | 230 |
  | `lib/collective-presets-store.js` | 186 |

- **Tests:**
  - 14 unit files (3,011 lines) plus `tests/e2e/collective.spec.js` (380 lines) and 2 prompt fixtures (244 lines), about 218 test cases.
  - 47 other test files also mention it, mostly the census tests (for example `lin-3383-runner-enqueue-census`, `lin-2354-session-lane-no-provider`) and visual baselines.
- **Routes:** 7 in total.
  - The page; POST `start`, `preview` and `presets`; DELETE `presets/:id`; GET `api/collective/state`; POST `api/collective/say`.
  - `experiments.md:15-20` and `public/llms.txt:348-352` list only 5. The llms.txt `start` body is stale: it still says `workspaceUrlKeys[]` where the route now takes `characters`.
- **Storage:** 2 Mongo collections, `collective-characters` and `collective-presets` (`server.js:428-442`). Both are on the erasure list (`lib/account-erasure.js:169-170`).
- **Flags and settings:** one per-user flag, `collective`, off by default (`lib/feature-defaults.js:24,58,75,93,131`). It has a switch in Settings (`lib/render-settings-you.js:158,194`). When it is on, the side rail shows "Collective" under Views (`lib/places.js:45,69-70`). That means `experiments.md:5` ("surfaced only via a link in Settings") is stale. Env: `YAP_BASE_URL` and `YAP_PASSWORD` (`.env.example:119-125`, `docs/architecture/configuration.md:34-35`).
- **Other places that name it:**
  - `server.js:44-45,194,218,3341-3344`
  - The legal page lists Yap as a processor (`lib/render-legal.js:70-71`).
  - Test seams (`routes/test.js:147-182,1083-1140`), `lib/key-state-holders.js:155`, `playwright.config.js:16,48`.
  - CLAUDE.md:96 points to experiments.md. `docs/architecture/source-map.md` (5 entries), `views.md`, `view-tiers.md:66`, `llms.txt:327-352`, `lib/library-metadata.js:80` (the 06-12 write-up is in the Library).
  - Comment-only mentions in about 25 lib/route files, for example `dispatch-factory.js`, `proxy-tokens.js` and `dispatch-presets-store.js` ("modelled on" the presets store).
  - The shared chat CSS has Collective-only variants: the log-style layout and the say bar (`public/chat.css:57,215`).
  - It is not in any stage prompt or the router.

## 3. What it needs, and what happens on hosted
- It needs four things:
  - The flag switched on.
  - For each character, a connected workspace you own. A seat in a workspace you don't own is refused (LIN-3383, `routes/collective.js:297-307`).
  - A runner (cli/web consumer) draining each of those workspaces' queues.
  - A reachable Yap server.
- On hosted it is not hidden by config and does not error. It is hidden only by the flag, which any user can switch on (`render-legal.js:71`).
  - **Flag off (the default):** no rail item; the page redirects to Settings (`routes/collective.js:106-108`); POSTs return 403.
  - **Flag on:** the page renders and works. A Yap client is **always** built, because `yapClientFromEnv` falls back to `https://yap.jkershaw.com` (`lib/yap-client.js:161-163`). So `yapConfigured` is always true, and the "Yap not configured" warning (`render-collective.js:157-159`) can only appear in tests.
- A missing `YAP_PASSWORD` alone breaks nothing. Without it, Harbour sends no Bearer header and the prompts say "needs no password" (`collective-participant.js:468-470`). The Yap service had "no environment variables" (`docs/incidents/2026-10-22-railway-security-disclosure.md:58`), so it most likely has no password either. **[inferred]**
- **The real risk is Yap itself.** John took yap offline on 22 Oct (incident doc `:29`). I found no record that it came back. **[unconfirmed]**
- If Yap is down:
  - The poll returns 502 and the page shows "● disconnected" (`public/collective.js:279,293`).
  - Start still returns 201 and queues full sessions whose prompts point at a dead chat server.
  - On hosted, then, it is most likely a working page with nothing behind it. **[unconfirmed]**
- Two smaller findings:
  - `state` and `say` don't check the flag (`routes/collective.js:579-645`). Any signed-in user can relay messages to Yap through Harbour.
  - `preview` and `start` put `YAP_PASSWORD` into prompt text (`:217,567,574`). This was already noted in the 10 Nov security review (`gate-2026-11-14.md:25`). It doesn't matter while the variable is unset.

## 4. When it was last worked on, and signs of use
- 50 commits touch the 9 production files. 25 of them were made by 12 Jul. The last change to its behaviour was LIN-1050 presets on 6 Jul (`de23691b3`); LIN-1298 unified the chat UI on 12 Jul (`f39eea4b1`).
- Since then the commits are only sweeps across the whole codebase: tokens (LIN-1173/1376/1582), the owner gate (LIN-3383), errors, origin (LIN-3931), and the rail/Settings rebuild (LIN-4564/4566/4568, 25 Nov). The 25 Nov change to `routes/collective.js` is a single comment word (`82d5d9cc2`).
- Use: the 07-03 session ran in `#lively-vale-2026-07-03-B`, which is the page's random-name format (`yap-client.js:200-221`) with "-B" added. LIN-972 (`8c4ba377c`, 3 Jul) changed the participant prompt from that session's lessons, including "the prompt mixed two Yap hosts" (`collective-session-2026-07-03.md:158-159`). So it was most likely used at least once, on 3 Jul. **[inferred]**
- There is no third session write-up and no later sign of use in git. Whether any user has the flag on, or has `collective-participant` dispatch rows, would need a production query. **[unconfirmed]**
- Unrelated: the survey's "Yap" walks (walks 7 and 8) use the Yap *repo* as test data. They don't use Collective.

## 5. swim-lanes / swim-graph, and other modules nothing imports
- **Confirmed: no production code imports them**, and none ever has. They are 957 lines, not about 1,500 (`swim-lanes.js` 816, `swim-graph.js` 141). Only `tests/unit/swim-lanes.test.js` and `swim-graph.test.js` import them.
- What they were for: server-side, testable versions of the Swim layout. The lane/segment grid came first (`0a6f6cecd`, 16 Mar). The Flow side-rail graph and path cover came next (`98756f3e9`, 29 May).
- Nothing replaced them. The live Swim view runs a hand-copied browser version in `public/swim.js` (2,971 lines; "client-side copy of lib/swim-lanes.js algorithm", `:9,24-27`, with `assignLanes` at `:29` and `flowPathCover` at `:892`), because there is no build step. So the tests cover the copy that doesn't run, and the copy that runs has no unit tests.
- I checked reachability from `server.js` and all `scripts/` entry points. These are the other lib modules that only tests import:
  - `lib/bash-tool.js` (164 lines): a 12 Apr HAR-208 import, never wired in.
  - `lib/observer-efficacy-signal.js` (404 lines): LIN-2133 instrumentation that feeds nothing.
  - `lib/prompts/survey-words.js` (9 lines): its header says only tests read it (LIN-4535).
  - `lib/prompts/area-note-format.js` (50 lines): a test-guard helper.
- `lib/prompts/worker-lane-kickoff.js` (60 lines) is reached only by the size script `scripts/steady-base-render.mjs:48`.
- Reached only by `scripts/`: `account-erasure`, `drop-*`, `expire-ownerless-dispatch-tokens`, `pipeline-churn`, `scan-public-pages`, `transcript-spend` and `stage-catalogue`. They work as operator tools, so I don't count them as dead.
- With swim, that is about 1,580 lines of dead production code, which matches the reported figure.
- `public/*.js`: every file is named somewhere outside itself. I did not check those mentions any further. **[not exhaustive]**

## 6. What clean removal would touch
- The 9 production files and the 15 test files (plus fixtures and visual baselines).
- In code: the `server.js` wiring, the flag entries in `feature-defaults.js`, `places.js` and `render-settings-you.js`, and the test seams in `routes/test.js` and `playwright.config.js`.
- In docs: the legal page's Yap processor line, `.env.example` and `configuration.md`, `experiments.md` plus CLAUDE.md:96 (the CLAUDE.md citation invariant), `source-map.md` and `llms.txt`.
- Leftovers: the 47 census tests that name it need re-pinning, and the two Mongo collections stay in the database until someone decides to drop them.
