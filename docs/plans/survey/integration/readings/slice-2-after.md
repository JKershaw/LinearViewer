# Slice 2 (LIN-4499): after readings

*Measured 20 Nov 2026, 23:25 to 23:35 UTC. These readings report. They never gate.*

- **LinearViewer `origin/main`:** `bc0535b5cf41a6942568b5614f7f27b1fbfc9389` (committed 2026-11-20T23:04:07Z, "Merge pull request #2478 from JKershaw/fix/lin-4499-close-out"). Fetched with `git fetch -q origin` and read from git objects. The checked-out branch was not changed.
- **Slice 2 has landed.** PR #2478 (LIN-4499's close-out fixes) merged at 23:04:07Z; its merge commit `bc0535b5c` is main's head. CI ("Tests", run 44833984934) on `bc0535b5c` completed `success`. LIN-4499 and LIN-4501 to LIN-4506 all read `Done`.
- **simple-dispatcher `origin/main`:** `4dc83d1e582f00fcb644ef9cf2913ba5db28054f` (2026-11-14T11:09:44Z), the same head as both slice 1 readings.
- **Between the readings** (`0d56aabdf..bc0535b5c`), slice 2's six tickets and LIN-4500 landed. LIN-4505 ran the Waiting import on the live store.
- **Harbour calls:** GETs only, to `https://harbour.cat`.

## Summary

| Reading | Slice 1 before (19 Nov, `bf2d1575f`) | Slice 1 after (20 Nov 01:25, `0d56aabdf`) | Slice 2 after (20 Nov 23:29, `bc0535b5c`) | 13–14 Nov baseline |
|---|---|---|---|---|
| Notes bytes, LinearViewer | 95,485 B (12 notes) | 42,715 B (13 notes) | **44,082 B** (13 notes) | 88,856 B at `302edafc3` (14 Nov) |
| Notes bytes, simple-dispatcher | 9,963 B (5 notes) | 9,963 B | **9,963 B** (unchanged) | 9,130 B at `7d5fe7d` (14 Nov) |
| Waiting entries, LinearViewer | 117 | 0 (lists removed) | **0** in the notes; the lists were imported as records (see §2) | 111 |
| Waiting entries, simple-dispatcher | 13 | 13 | **13** | 12 |
| Records, all kinds | not read | not read (403) | **1,919** (1,636 open) | none |
| Findings | not applicable | not read (403) | **342** (228 open) | none |
| Sessions per task (median) | 8 (6 tasks) | 9 (LIN-4492–4496) | **8.5** (LIN-4501–4506, 6 tasks); LIN-4499: 13 | 8 (14 Nov); 7 (13 Nov) |
| Cost per task (median) | $18.17 (6 tasks) | $24.98 (LIN-4492–4496) | **$31.30** (LIN-4501–4506); LIN-4499: $49.76 | $15.25 (14 Nov); $16.70 (13 Nov) |
| Slice total | not applicable | $139.91 (LIN-4492–4496; parent not counted) | **$271.91** (LIN-4499 and LIN-4501–4506) | not applicable |
| Brief size | 11,338 B (LIN-4491 plan); 16,460 B (plan-review) | pending: from slice 2's live stages | **pending: from slice 3's live stages** | not recorded |

## 1. Notes bytes

**Method: the same as before.** Area notes are `docs/areas/<slug>.md`, with `README.md` and `areas.json` left out. Bytes are raw blob bytes (`git cat-file -s`), summed:

```
for f in $(git -C $R ls-tree --name-only $REF:docs/areas | grep '\.md$' | grep -v '^README.md$'); do git -C $R cat-file -s $REF:docs/areas/$f; done | paste -sd+ | bc
```

Per note, LV now: records 6,856; runs-and-dispatch 6,243; llm-and-prompts 6,228; agent-api 5,597; front-end-browser 5,594; reports-and-operator-tools 5,348; providers 2,192; platform-and-plumbing 1,653; front-end-pages 1,652; web-routes 962; wiring 795; auth-accounts-and-workspaces 577; other-features 385. Against slice 1 after (+1,367 B): web-routes +850, wiring +715, reports-and-operator-tools +698, platform-and-plumbing +386, llm-and-prompts +13, records −194, providers −1,101; the other six are unchanged. LV's README is 3,780 B (unchanged) and is not counted.

SD is unchanged, note for note: stop-hook-and-relay 5,486; loop-and-routing 1,230; state-and-config 1,223; launch-and-harnesses 1,087; test-harnesses 937.

## 2. Waiting count

**Method: the same as before.** The self-contained copy of `parseNote` from `slice-1-before.md`: one entry is one top-level `- ` bullet under a `## Waiting` heading.

| Repo / ref | Count |
|---|---|
| LV at main `bc0535b5c` | **0**. No note has a `## Waiting` heading |
| SD at `4dc83d1` | **13** (unchanged) |

**What is there now.** LIN-4505 ran the import on production (its comment `6ada7a49`, 20 Nov 13:20Z): notes at `5664cbe47` (124 entries), a dry run, then apply. It reports 125 records created (117 findings and 7 Security Review tasks under one parent), 0 refused, plus 15 from the parked-ticket manifest, and a re-run that found all present. The import code was then removed. This reading did not separate imported findings from others: the documented records query has no provenance filter. The 342 findings below are all findings, from any source.

## 3. Records by kind

**Method:** `GET https://harbour.cat/api/proxy/records?kind=<kind>&count=1`, and the same with `&state=open`, at 23:29:58 to 23:30:04Z. The kinds are the ones the proxy docs list, plus `run`. They sum to the unfiltered `GET /api/proxy/records?count=1` (1,919). An unknown kind returns `{"count":0}`, not a refusal, so a 0 here is only as good as the kind's spelling.

| Kind | Count | Open |
|---|---|---|
| task | 1,432 | 1,402 |
| finding | 342 | 228 |
| run | 115 | 4 |
| plan | 23 | 0 |
| verdict | 3 | 0 |
| question | 2 | 1 |
| decision | 1 | 0 |
| change | 1 | 1 |
| lesson | 0 | 0 |
| **all** | **1,919** | **1,636** |

Slice 1 after could not read these (`403`, "this credential predates run identity"). There is no earlier figure to set them against.

## 4. Brief bytes

Pending: from slice 3's live stages. Not read here. LIN-4506's own brief readings are quoted in §6.

## 5. Sessions and cost per task

**Method: the same as slice 1 after.** `GET https://harbour.cat/api/proxy/issues/<id>/cost` for each task, at 23:29Z. "Sessions" is the length of `workerSessions` (dispatch lineages). "Cost" is `totalUsd`. Tasks are named directly; `scripts/stability-measures.mjs` was not run.

| Task | Sessions | `totalUsd` | First → last dispatch (20 Nov) |
|---|---|---|---|
| LIN-4501 | 8 | $42.26 | 11:02 → 15:10 |
| LIN-4502 | 9 | $54.65 | 15:12 → 17:33 |
| LIN-4503 | 8 | $20.34 | 11:02 → 12:38 |
| LIN-4504 | 13 | $74.45 | 15:12 → 21:06 |
| LIN-4505 | 8 | $16.06 | 11:02 → 13:51 |
| LIN-4506 | 10 | $14.40 | 21:07 → 21:55 |
| **LIN-4501–4506** | **median 8.5, mean 9.33** | **median $31.30, mean $37.02** (total $222.15) | |
| LIN-4499 (parent) | 13 | $49.76 | 01:37 → 23:12 |
| **Slice total** | 69 | **$271.91** | |

Every figure is fully priced: `totalUsd` is non-null, `noLineage` false, no unpriced models, no missing or unreadable telemetry, no lineage with a null cost. App-side (OpenRouter) calls are $0.13–$0.86 per task and are included.

## 6. LIN-4506's production readings

LIN-4506 (P6) reported production readings in comment `d9d8c372`, posted 20 Nov 21:36:53Z. That comment sits on **LIN-4499**, not on LIN-4506; LIN-4506's own comments cite it there. It was read through `railway ssh` into `harbour-cat` (build of 20:48), read-only, with `scripts/records-readings.mjs` and `heldRunReading`. LIN-4499 comment `02b34786` (21:47Z) restates it with method. Quoted figures:

- **Held-run sit times** (records addressed to a held run's stage or task, time before first read): all, 24 records, 21 read, median sit **1.0 h**, 3 unread. To LIN-4499's task, 16 records, 13 read, median 1.0 h (0.1 to 1.44 h). To `implementation`, 8 records, 8 read, median **17.2 h** (0.58 h, 15.13 h, and six at 17.22 h). 5 runs were held.
- **Taskless runs (`task-missing-at-take`):** 0 of 21 runs opened since 2026-11-20T15:02:33Z (P1's merge, used in place of its deploy time) had no task.
- **Copied-count drift, trace-6 parent (LIN-4448):** the Waiting count retold as 26 (description; 13 Nov 13:19, 13:24), 25 (13 Nov 15:49, 15:55; LIN-4464 15:58), 23 (13 Nov 20:34), 22 (14 Nov 09:18, 10:54; LIN-4470) and 12 (LIN-4470, 14 Nov 09:57). The comment says some steps from 26 to 22 are settling, not drift. After side: production held 23 plan records and no child task with a `piece`, so there was no live after count. The proxy replay (PR #2477) shows 0 piece text in child tickets and child briefs.
- **Other rows at the same time:** open to project 162 of 243; open to a stage 35 of 243; open records' sit median 8.5 h, mean 11.2 h; stale open runs 1 of 6.

## Notes

- Six tasks from one slice are a small sample, as slice 1's five were.
- LIN-4504's $74.45 includes one `custom` lineage of $46.75; LIN-4502's $54.65 includes one implementation lineage of $43.43. LIN-4499's $49.76 includes its autopilot lineage of $27.22.
- LIN-4499's last dispatch (23:12:37Z) is after its `completedAt` (23:12:25Z), so its figure may still move a little.
- Slice 1's parent, LIN-4491, still reads In Progress; its `/cost` at 23:30Z was 13 sessions, $36.66. Slice 1's $139.91 does not include it.
- The LV notes grew by 1,367 B over slice 2. The Waiting lists stay out of the notes; their entries are now findings and tasks in the records store.
