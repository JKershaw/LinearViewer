# Slice 1 (LIN-4491): after readings

*Measured 20 Nov 2026, 01:25 to 01:35 UTC. These readings report. They never gate.*

- **LinearViewer `origin/main`:** `0d56aabdfced1257ed38da656dbe25096980d9c5` (committed 2026-11-20T01:19:10Z, "LIN-4496: walk 8 replays through the proxy; a task written with a ticket ref claims it (#2469)"). Fetched with `git fetch -q origin` and read from git objects. The checked-out branch was not changed.
- **simple-dispatcher `origin/main`:** `4dc83d1e582f00fcb644ef9cf2913ba5db28054f` (2026-11-14T11:09:44Z), the same head as the before reading. SD has had no landing since 14 Nov.
- **Between the readings** (`bf2d1575f..0d56aabdf`), slice 1's five tickets and LIN-4497 landed. LIN-4495 (PR #2468) removed the `## Waiting` sections from every LV note.
- **Harbour calls:** GETs only, to `https://harbour.cat`.

## Summary

| Reading | Before (19 Nov, `bf2d1575f`) | After (20 Nov, `0d56aabdf`) | 13–14 Nov baseline |
|---|---|---|---|
| Notes bytes, LinearViewer | 95,485 B (12 notes) | **42,715 B** (13 notes) | 88,856 B at `302edafc3` (14 Nov) |
| Notes bytes, simple-dispatcher | 9,963 B (5 notes) | **9,963 B** (5 notes, unchanged) | 9,130 B at `7d5fe7d` (14 Nov) |
| Waiting entries, LinearViewer | 117 | **0** (the lists are gone; see §2) | 111 |
| Waiting entries, simple-dispatcher | 13 | **13** | 12 |
| Imported findings (`find --count`) | not applicable | **not read**: the import has not run, and the token is refused (see §2) | none |
| Sessions per task (median) | 8 (6 tasks, window `fb358dbda..bf2d1575f`) | **9** (LIN-4492–4496, 5 tasks); LIN-4497: 13 | 8 (14 Nov); 7 (13 Nov) |
| Cost per task (median) | $18.17 (6 tasks) | **$24.98** (LIN-4492–4496); LIN-4497: $20.19 | $15.25 (14 Nov); $16.70 (13 Nov) |
| Brief size | 11,338 B (LIN-4491 plan); 16,460 B (plan-review) | **pending: from slice 2's live stages** | not recorded |

## 1. Notes bytes

**Method: the same as before.** Area notes are `docs/areas/<slug>.md`, with `README.md` and `areas.json` left out. Bytes are raw blob bytes (`git cat-file -s`), summed:

```
for f in $(git -C $R ls-tree --name-only $REF:docs/areas | grep '\.md$' | grep -v '^README.md$'); do git -C $R cat-file -s $REF:docs/areas/$f; done | paste -sd+ | bc
```

**Difference:** LV now has 13 notes, not 12. `records.md` was added by slice 1 (LIN-4493/4494) and is counted, as the method counts every note. Without it, the 12 notes measured before total 35,665 B.

Per note, LV now: records 7,050; runs-and-dispatch 6,243; llm-and-prompts 6,215; agent-api 5,597; front-end-browser 5,594; reports-and-operator-tools 4,650; providers 3,293; front-end-pages 1,652; platform-and-plumbing 1,267; auth-accounts-and-workspaces 577; other-features 385; web-routes 112; wiring 80. Every LV note now has only a `## Lessons` section, except `web-routes` and `wiring`, which have no section heading. LV's README is 3,780 B (6,330 B before) and is not counted.

SD is unchanged, note for note: stop-hook-and-relay 5,486; loop-and-routing 1,230; state-and-config 1,223; launch-and-harnesses 1,087; test-harnesses 937.

## 2. Waiting count

**Method: the same as before.** The self-contained copy of `parseNote` from the before file: one entry is one top-level `- ` bullet under a `## Waiting` heading.

| Repo / ref | Count |
|---|---|
| LV at main `0d56aabdf` | **0**. No note has a `## Waiting` heading |
| LV at `5664cbe47` (19 Nov 19:00, the last commit before the cutover `81b590183`) | 124 |
| LV at `bf2d1575f` (the before reading) | 117 |
| SD at `4dc83d1` | **13** (unchanged) |

**What the 0 means.** It does not mean 124 entries were settled. The cutover deleted the lists. Their entries are meant to become findings in the records store, through the one-off importer `scripts/records-import.mjs`. That import has not run on the live store; it is left for John. Until it runs, the entries exist only in git history (and in the importer's test fixture, `tests/fixtures/records-import/baseline-bf2d1575f/`, a copy of the notes at the before reading).

**What the import would bring in.** `planImport` (`lib/records/waiting-import.js`, pure, run locally with no database) reads, at `5664cbe47`: 124 entries, of which 117 findings and 7 Security Review entries (which become task records) across 5 notes, 0 malformed. At `bf2d1575f` it reads 117 entries: 110 findings and 7 security. Which ref the live import uses is chosen by whoever runs it; the script takes it as an argument.

**`find --count` was not read.** `GET /api/proxy/records?...&count` returned `403 {"error":"this credential predates run identity; mint a new one"}` for every query tried (all records; findings; open findings; open findings to `project`; tasks; runs). Reading it needs a token minted after LIN-4492. Even with one, the count would not yet include the import.

## 3. Brief bytes

Pending: from slice 2's live stages. Not read here.

## 4. Sessions and cost per task

**Method:** `GET https://harbour.cat/api/proxy/issues/<id>/cost` for each task, at 01:32Z. "Sessions" is the length of `workerSessions` (dispatch lineages). "Cost" is `totalUsd`. These are the same fields the before reading used.

**Difference in method:** the before reading selected its tasks with `scripts/stability-measures.mjs` over a commit window (tasks Done inside the window). This reading names the tasks directly: slice 1's five tickets, and LIN-4497 on its own. The tool was not run. All six tickets read `Done` at 01:32Z.

| Task | Sessions | `totalUsd` | First → last dispatch |
|---|---|---|---|
| LIN-4492 | 7 | $18.52 | 19 Nov 12:36 → 13:31 |
| LIN-4493 | 10 | $33.38 | 13:52 → 16:14 |
| LIN-4494 | 9 | $24.98 | 16:33 → 18:16 |
| LIN-4495 | 9 | $40.16 | 18:36 → 21:14 |
| LIN-4496 | 13 | $22.87 | 23:01 → 20 Nov 01:10 |
| **LIN-4492–4496** | **median 9, mean 9.6** | **median $24.98, mean $27.98** (total $139.91) | |
| LIN-4497 (separate) | 13 | $20.19 | 19 Nov 15:15 → 16:18 |

Every figure is fully priced: `totalUsd` is non-null, with `noLineage` false, no unpriced models, no missing or unreadable telemetry and no incomplete lineage. App-side (OpenRouter) calls are $0.21–$0.48 per task and are included in `totalUsd`.

## Notes

- Five tasks, all from one slice, are a small and unusual sample. The before row was six tasks of another mix, and the 13–14 Nov rows were 25 and 33 tasks.
- LIN-4495's $40.16 includes one implementation lineage of $25.49. LIN-4496's 13 sessions include four implementation and four review lineages.
- LIN-4491 (the slice's parent) is still In Progress and is not counted.
- The LV notes bytes fell mostly because the Waiting sections were removed, which before held 59,907 B. The Waiting entries were moved out of the notes, not resolved, and the import is still to run.
