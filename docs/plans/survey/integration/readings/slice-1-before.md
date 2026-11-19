# Slice 1 (LIN-4491): before readings

*Measured 19 Nov 2026, 11:55 to 12:21 UTC. These readings report. They never gate.*

- **LinearViewer `origin/main`:** `bf2d1575ff19cce99fefa0307b556d0a3f625726` (committed 2026-11-19T11:45:42Z, "Essay: After the Peak (archive version 3) (#2463)"). Fetched with `git fetch origin main` and read from git objects. The checked-out branch was not changed.
- **simple-dispatcher `origin/main`:** `4dc83d1e582f00fcb644ef9cf2913ba5db28054f` (2026-11-14T11:09:44Z). It has had no landing since 14 Nov.
- **Since the 14 Nov baselines,** one commit has touched LV's notes: `68b5d8f3a` (LIN-4487, 18 Nov). The fleet has been mostly paused. So most of the change from the baselines comes from 14 Nov itself.

## 1. Notes bytes

These are the area notes: `docs/areas/<slug>.md`, with `README.md` and `areas.json` left out. The bytes are raw blob bytes (`git cat-file -s`).

| Repo | Now | Baseline | Source of baseline |
|---|---|---|---|
| LinearViewer (12 notes) | **95,485 B** | 10,630 B at `526bca66c` (8 Nov 02:29, the first notes commit) → 88,856 B at `302edafc3` (14 Nov 00:51) | "10.6 KB … → 88.8 KB" (`log.md:3909`, 14 Nov ~10:40). I reproduced both figures to the byte with the method below. Decimal KB, truncated |
| LinearViewer, later on 14 Nov | (same) | 85,804 B at `fb358dbda` (09:49, after LIN-4470) → 95,589 B at `f0d19bdf1` (11:09, after the Drift and Seams runs) | Computed here, to show where the 14 Nov figure moved during the day |
| simple-dispatcher (5 notes) | **9,963 B** | 9,130 B at `7d5fe7d` (14 Nov, the stability review's SD head) | Computed here. The 88.8 KB figure is **LV only**, so SD was not part of it |

Per note, LV now: runs-and-dispatch 19,853; llm-and-prompts 14,375; front-end-browser 12,971; agent-api 9,761; reports-and-operator-tools 9,066; front-end-pages 8,285; providers 6,640; platform-and-plumbing 4,327; other-features 4,007; web-routes 2,693; auth-accounts-and-workspaces 2,466; wiring 1,041. SD now: stop-hook-and-relay 5,486; loop-and-routing 1,230; state-and-config 1,223; launch-and-harnesses 1,087; test-harnesses 937. The READMEs are 6,330 B (LV) and 6,047 B (SD) and are not counted.

Of LV's 95,485 B, the bullets under `## Waiting` hold 59,907 B and the bullets under `## Lessons` hold 32,076 B, with the bullet text joined as `notes-history.mjs` does. At `302edafc3` the split was 54,627 B and 31,015 B.

## 2. Waiting count

**Entry syntax:** one entry is one top-level `- ` bullet under a `## Waiting` heading, with indented continuation lines joined to it. This is `parseNote` / `countWaiting` in `lib/prompts/area-note-format.js` at main. The notes guard and `scripts/stability-measures.mjs` (`waiting.harbour`) count the same way. Every entry counts as open, because a settled entry is removed from the list (`docs/areas/README.md`).

| Repo | Now | Baseline | Source of baseline |
|---|---|---|---|
| LinearViewer | **117** | **111** ("111 Waiting entries are open", `integration/design.md:13,162`; `integration/tickets.md:11,41,57`) | The design does not record its method or commit. Counting LV only with `countWaiting`, 111 matches main at `0a1adcf9b` (14 Nov 11:00). It also matches several 13 Nov commits. |
| LinearViewer, cross-checks | | 118 at `302edafc3` (the 88.8 KB commit; with 85 Lessons, that is the "203 entries" of `log.md:3909`); 108 at `fb358dbda` | 108 matches the 14 Nov stability review's `waiting.harbour 98 → 108` (`docs/reviews/stability-review-2026-11-14.md`) |
| simple-dispatcher | **13** | 12 at `7d5fe7d` (14 Nov) | Matches that review's `waiting.runner 12 → 12` |

Per note, LV now: runs-and-dispatch 24; front-end-pages 14; llm-and-prompts 14; agent-api 12; front-end-browser 12; reports-and-operator-tools 9; platform-and-plumbing 7; web-routes 7; other-features 6; providers 6; auth-accounts-and-workspaces 4; wiring 2. SD now: stop-hook-and-relay 5, and 2 each in the other four notes. LV has 88 Lessons bullets now (85 at `302edafc3`). SD has 6.

The tool's own reading over `fb358dbda..bf2d1575f` gives `waiting.harbour 108 → 117`. Its `waiting.runner` row reads `not measured` because the SD checkout is on a session branch. The SD count above was read directly from SD's `origin/main`.

## 3. Brief bytes

**What was read:** `GET https://harbour.cat/api/proxy/brief/<id>?noRefresh=1`. This is the alias of `/api/proxy/issues/<id>/brief` (`routes/proxy-compute.js:1332` at main). It is the brief a stage's preamble points it to ("Start from the distilled brief", `lib/proxy-preamble.js`). The size is the UTF-8 byte length of the response's `brief` field.

**Why `noRefresh=1`:** without it, a stale cache makes the GET regenerate the brief. That is an OpenRouter call billed to the token creator, and it overwrites the cached brief, so it is not read-only. With `noRefresh=1`, a stale or missing brief comes back **without its text** (`proxy-compute.js`, the `noRefresh` branch). A brief can only be measured read-only while its cache is fresh. Note that every GET of this route also records a task snapshot when the ticket's inputs changed (`captureTaskSnapshot`). That is a side effect of the route, not something the caller chooses.

| Issue | Now | Status, generatedAt | Baseline |
|---|---|---|---|
| LIN-4491, plan stage | **11,338 B** | fresh, generated 2026-11-19T12:09:11.847Z, 36 s after plan dispatch `8f90d445` (12:08:35) | None: the task did not exist on 13–14 Nov |
| LIN-4491, plan-review stage | **16,460 B** | fresh, generated 2026-11-19T12:15:02.987Z, 54 s after plan-review dispatch `514a49b4` (12:14:08) | None |
| LIN-4450 | **not measurable read-only** | stale, generated 2026-11-13T15:22:35Z | No 13–14 Nov served-brief size is recorded (see below) |
| LIN-4446 | **not measurable read-only** | stale, generated 2026-11-13T15:15:36Z | same |
| LIN-4469 | **not measurable read-only** | stale, generated 2026-11-13T23:27:40Z | same |
| LIN-4448, LIN-4470, LIN-4487 | **not measurable read-only** | stale (generated 14 Nov 10:33, 14 Nov 09:41, 18 Nov 14:03) | |
| LIN-4489 | **not measurable read-only** | missing | |

**About LIN-4491:** the task was running while this was measured (survey-task 11:59, survey-place 12:02, scoping 12:06, plan 12:08, plan-review 12:14). Its cache goes stale with each stage's comment and is rebuilt when the next stage reads it. So the cache was polled every 10 s from 12:08 to 12:21Z, and each fresh copy was kept. Each size is assigned to a stage by timing: it is the first regeneration after that stage's dispatch. Both briefs have the same sections: As asked; As asked on the parent, LIN-4490; Current; Constraints; Open questions; Changelog. One earlier read at about 12:02 was also fresh (probably the survey-place brief), but its size was not kept. For the after reading, poll the same stages of a slice-1 task.

**The baseline is not recorded.** `integration/design.md:90` says brief bytes are reported "against today's brief (13–14 Nov) and walk 8's". I found no number for Harbour's served brief on 13–14 Nov in the gate, `A-facts.md`, `B-capacity.md`, `log.md` or the walks. The byte tables in `layer/walks/3/results.md` and `layer/walks/5/results.md` are the *model* briefs, set beside Harbour's ticket snapshot. Walk 8 reports its brief sizes against walk 7's (`layer/walks/8/results.md:20`), not as absolute figures.

**For the after reading:** to get finished tasks' briefs, someone has to accept one regeneration GET per task (no `noRefresh`). It costs a few cents of OpenRouter and overwrites the cache. Otherwise, take the reading for a live task while its cache is fresh, as was done for LIN-4491 here.

## 4. Sessions and cost per task

**Method, the same as the baseline:** the committed tool `scripts/stability-measures.mjs` at main `bf2d1575f`. Its window starts at the 14 Nov review's head pin `fb358dbda`, so it neither overlaps that window nor leaves a gap. The tool counts a task as finished when its ticket landed in the window or in the 3-day lookback and was Done inside the window. "Sessions" are `/cost`'s `workerSessions` (dispatch lineages). "Cost" is `/cost`'s `totalUsd`. The run was all GETs, at 12:03–12:08Z.

| Window | Tasks finished | Sessions per task | $ per task | Minutes, first dispatch → last landing | Source |
|---|---|---|---|---|---|
| **Now: `fb358dbda..bf2d1575f`** (14 Nov 09:49 → 19 Nov 11:45, 13 landings) | **6** | **median 8, mean 8.17** | **median $18.17, mean $21.36** (6 of 6 priced) | median 72.5, mean 355.8 | This run |
| 14 Nov reading: `163efc069..fb358dbda` (12 Nov 23:17 → 14 Nov 09:49) | 25 | median 8, mean 8.04 | median $15.25, mean $17.17 | median 69.5, mean 93.7 | `docs/reviews/stability-review-2026-11-14.md`; `B-capacity.md:9` |
| 13 Nov reading (8–12 Nov) | 33 | median 7 | median $16.70, mean $18.34 | median 86.5 | `gate-2026-11-13.md:79,81`; `B-capacity.md:10` |
| 8 Nov reference (4–8 Nov) | 106 | median 5, mean 5.61 | median $9.53, mean $14.29 | median 56.3 | the tool's reference row |

The tasks now are LIN-4448 ($37.70, 11 sessions), LIN-4470 ($15.21, 7), LIN-4481 ($34.11, 6), LIN-4482 ($21.13, 6), LIN-4483 ($10.84, 10) and LIN-4487 ($9.15, 9).

**Be careful with this comparison.** It is six tasks, and they are not the usual mix. LIN-4448 and LIN-4470 are the two tidy lanes, with most of their work before 14 Nov. LIN-4481, LIN-4482 and LIN-4483 are Periodicals. LIN-4487 is the only ordinary product change. Seven more tickets landed in the window but are not Done (the papers LIN-4478–4480 and LIN-4484–4486, and LIN-4489), so they are not counted.

**Repeatability check:** `/cost` for LIN-4450, LIN-4446 and LIN-4469, re-read at 12:08Z, gives totals of $16.03, $17.98 and $13.10 and 7, 12 and 6 sessions. That is identical to the 14 Nov reading's per-task figures (`_evidence-2026-11-14-stability/reading.json`). So a finished task's figure does not drift. LIN-4491 itself had 4 sessions and $3.16 priced (`totalUsd` null) at 12:08Z, early in its run.

## How to repeat exactly

From the LinearViewer root, with `R=<repo>` and `REF=<sha of origin/main>`:

1. **Notes bytes.**

   ```
   for f in $(git -C $R ls-tree --name-only $REF:docs/areas | grep '\.md$' | grep -v '^README.md$'); do git -C $R cat-file -s $REF:docs/areas/$f; done | paste -sd+ | bc
   ```

   Run it for `R=.` and for `R=../simple-dispatcher`. If slice 1 removes or empties the notes, report what is left the same way. Report a missing directory as 0, and say so.

2. **Waiting count.** Use this self-contained copy of `parseNote`, so that it still works if slice 1 deletes `area-note-format.js`:

   ```
   node -e "const {execFileSync:x}=require('child_process');const [r,ref]=process.argv.slice(1);const g=(...a)=>x('git',['-C',r,...a],{encoding:'utf8'});let n=0;for(const f of g('ls-tree','--name-only',ref+':docs/areas').trim().split('\n').filter(f=>f.endsWith('.md')&&f!=='README.md')){let s=null;for(const l of g('show',ref+':docs/areas/'+f).split('\n')){const h=/^## (.*)$/.exec(l);if(h){s=h[1].trim();continue}if(s==='Waiting'&&l.startsWith('- '))n++}}console.log(n)" . $REF
   ```

   After the slice, also count the imported findings (`find --count`, `design.md` §8) and report the two side by side.

3. **Brief bytes.**

   ```
   curl -sS -H @<(printf 'Authorization: Bearer %s\n' "$TOK") 'https://harbour.cat/api/proxy/brief/<id>?noRefresh=1'
   ```

   Take `Buffer.byteLength(body.brief)` when `status` is `fresh`, and record `status` and `generatedAt` either way. Never pass the token on the command line or print it. After slice 1, add `?run=<run>` if the route then requires it (`design.md` §3).

4. **Sessions and cost.** Use the tool from a main checkout, with base = this reading's head `bf2d1575f`. The proxy needs a bearer, which the tool's client doesn't send, so this reading added it with a GET-only preload. The preload wraps `fetch`, adds `Authorization` for `https://harbour.cat` and refuses any other method. Then run:

   ```
   NODE_USE_ENV_PROXY=1 HARBOUR_LOCAL_BASE=https://harbour.cat node --import <preload.mjs> scripts/stability-measures.mjs . bf2d1575f <head> --runner ../simple-dispatcher --reference docs/reviews/stability-measures/reference-2026-11-08.json > reading.json 2> table.txt
   ```

   Read rows 3 (`tasks`, `speed`) and 5 (`cost`). The run took about 5 minutes. If the session runs the broker, `HARBOUR_LOCAL_BASE` alone works without the preload.
