# CI census, 11 Nov 2026 (LIN-4418)

Repo `JKershaw/LinearViewer`, workflow `test.yml`. Window: runs created at or after `0b5afa6f`'s commit time (2026-10-23T12:43:30Z) up to the listing time (last run 2026-11-11T22:32Z).

## Listing (date-sliced, so the 1,000-run cap cannot truncate it)

```
for r in 2026-10-23..2026-10-25 2026-10-26..2026-10-28 2026-10-29..2026-10-31 2026-11-01..2026-11-03 \
         2026-11-04..2026-11-06 2026-11-07..2026-11-09 2026-11-10..2026-11-12; do
  gh run list -R JKershaw/LinearViewer --workflow test.yml --created "$r" --limit 1000 \
    --json databaseId,conclusion,createdAt,attempt,headSha,headBranch,event,status
done
```

Slice sizes: 405, 75, 139, 137, 252, 162, 48 (1,218 listed; 1,188 in the window).

| | runs |
|---|---|
| in window | 1188 |
| success | 1125 |
| failure | 63 |
| `run_attempt > 1` | 16 |
| before research's listing began (2026-10-24T19:19Z) | 188 |
| of those, after LIN-3798's merge (2026-10-23T17:21:54Z) | 154 |

## Sample

Drawn separately in the gap slice (before 2026-10-24T19:19Z) and after it: every fourth first-attempt green run (in creation order), plus every failed run and every run with `run_attempt > 1`. For each sampled run, the E2E shard and unit job logs of every attempt were fetched (`gh api repos/JKershaw/LinearViewer/actions/jobs/<id>/logs`) and filtered to the `✘`, `N flaky`, error, expectation and summary lines.

| | sampled | complete log set | green | green with a retry rescue |
|---|---|---|---|---|
| gap slice | 56 | 56 | 46 | 4 |
| after | 299 | 299 | 246 | 81 |
| total | 355 | 355 | 292 | 85 (29.1%) |

A "retry rescue" is a green run whose E2E log has a first-attempt `✘` line. Granularity is the Playwright `list` reporter only; `test-results/` is uploaded only on failure.

## Rescued sites in green runs

| runs | site (as reported at the run's sha) | first..last | test |
|---|---|---|---|
| 16 | `tests/e2e/task-page.spec.js:379` | 2026-11-07..2026-11-11 | Task page, owner view (LIN-3329) › layout: one calm column on a phone (answer, stages, PR) |
| 14 | `tests/e2e/task-page.spec.js:376` | 2026-11-02..2026-11-06 | Task page, owner view (LIN-3329) › layout: one calm column on a phone (answer, stages, PR) |
| 10 | `tests/e2e/session-proposals.spec.js:64` | 2026-11-04..2026-11-11 | Run page: chat about this run → proposals (LIN-3254) › proposes, applies once, and decline |
| 9 | `tests/e2e/lin-3833-home-first-page.spec.js:98` | 2026-10-25..2026-10-25 | Home first page — the Change panel is a full-screen sheet on a phone (LIN-3833) › Change c |
| 6 | `tests/e2e/detail-nonactive-binding.spec.js:118` | 2026-10-25..2026-10-25 | Sibling id-scoped routes on a non-active (Jira) binding (LIN-1904) › prompt and comments r |
| 6 | `tests/e2e/detail-nonactive-binding.spec.js:390` | 2026-10-25..2026-10-25 | Recap / Brief / Recommend / Task Chat on a non-active (Jira) binding (LIN-1910) › AI sugge |
| 6 | `tests/e2e/lin-4010-home-opened-task.spec.js:230` | 2026-11-02..2026-11-08 | Change is a drawer at desktop width, and Escape closes it (LIN-4010) › the drawer sits at  |
| 5 | `tests/e2e/local-provider.spec.js:305` | 2026-10-24..2026-10-25 | Local provider (no test-token mock) › description Preview renders real Markdown, styles it |
| 3 | `tests/e2e/proxy.spec.js:58` | 2026-10-24..2026-10-24 | Proxy Page › can create and revoke proxy tokens via UI (retry #2) |
| 3 | `tests/e2e/dispatch-page.spec.js:1142` | 2026-10-24..2026-10-25 | Dispatch Page › Token Management › can revoke token |
| 3 | `tests/e2e/local-provider.spec.js:246` | 2026-10-25..2026-10-26 | Local provider (no test-token mock) › description Preview renders live and saving round-tr |
| 3 | `tests/e2e/proxy.spec.js:59` | 2026-10-25..2026-10-26 | Proxy Page › can create and revoke proxy tokens via UI |
| 3 | `tests/e2e/task-page.spec.js:374` | 2026-10-29..2026-10-31 | Task page, owner view (LIN-3329) › layout: one calm column on a phone (answer, stages, PR) |
| 3 | `tests/e2e/lin-4010-home-opened-task.spec.js:227` | 2026-10-30..2026-11-01 | Change is a drawer at desktop width, and Escape closes it (LIN-4010) › the drawer sits at  |
| 2 | `tests/e2e/dispatch.spec.js:604` | 2026-10-23..2026-10-23 | Dispatch API › GET /api/dispatch lists queue items |
| 2 | `tests/e2e/ship.spec.js:332` | 2026-10-25..2026-10-25 | Ship Page › layout is deterministic across reloads |
| 2 | `tests/e2e/lin-4010-home-opened-task.spec.js:342` | 2026-11-02..2026-11-04 | the review-shaped Home at 1280px, dark (LIN-4010 review) › one running box with Stop in vi |
| 2 | `tests/e2e/observation.spec.js:519` | 2026-11-06..2026-11-07 | Autopilot Observation page (first-class) › Running-collapsed livebar shimmer (LIN-933) › a |
| 1 | `tests/e2e/live-console.spec.js:3215` | 2026-11-02..2026-11-02 | Live Console (experimental) › LIN-4035: activity collapsed, one link rule, the title on th |
| 1 | `tests/e2e/look-alike-controls.spec.js:209` | 2026-11-03..2026-11-03 | Look-alike controls in ticket text answer nothing (LIN-3385) › task page: a look-alike in  |
| 1 | `tests/e2e/task-page.spec.js:817` | 2026-11-05..2026-11-05 | Task page, owner view (LIN-3329) › LIN-3634: a head that moves after the page loaded is re |
| 1 | `tests/e2e/observation.spec.js:543` | 2026-11-06..2026-11-06 | Autopilot Observation page (first-class) › Running-collapsed livebar shimmer (LIN-933) › r |
| 1 | `tests/e2e/observation-rulings.spec.js:1148` | 2026-11-08..2026-11-08 | Bulk-agree suggested rulings (LIN-2444 Phase 5) — e2e › two loops sharing one decision_id  |
| 1 | `tests/e2e/observation-rulings.spec.js:1275` | 2026-11-08..2026-11-08 | Bulk-agree progress / Stop / completion summary (LIN-2758) — e2e › a full 3-row run shows  |
| 1 | `tests/e2e/lin-3968-home-next-step.spec.js:332` | 2026-11-10..2026-11-10 | Home: the stage strip is one row and styled (LIN-3968) › every chip sits on one row, and t |

## Every sampled run

| run id | created | conclusion | attempt | complete logs | first-attempt E2E `✘` sites |
|---|---|---|---|---|---|
| 39955491509 | 2026-10-23T12:43:34Z | success | 1 | yes |  |
| 39957280849 | 2026-10-23T12:57:26Z | success | 1 | yes | dispatch.spec.js:604 |
| 39957933192 | 2026-10-23T13:02:21Z | failure | 1 | yes | library.spec.js:170 |
| 39959928327 | 2026-10-23T13:17:07Z | success | 1 | yes |  |
| 39963062070 | 2026-10-23T13:39:47Z | success | 1 | yes |  |
| 39965381740 | 2026-10-23T13:56:25Z | success | 1 | yes |  |
| 39966503721 | 2026-10-23T14:04:18Z | success | 1 | yes |  |
| 39968202146 | 2026-10-23T14:16:19Z | success | 1 | yes | dispatch.spec.js:604 |
| 39990280674 | 2026-10-23T16:51:47Z | success | 1 | yes |  |
| 39993758447 | 2026-10-23T17:16:45Z | success | 1 | yes |  |
| 39997507866 | 2026-10-23T17:44:12Z | success | 1 | yes |  |
| 40001268314 | 2026-10-23T18:11:29Z | success | 1 | yes |  |
| 40003258519 | 2026-10-23T18:26:13Z | success | 1 | yes |  |
| 40006511669 | 2026-10-23T18:49:50Z | success | 1 | yes |  |
| 40008614138 | 2026-10-23T19:05:20Z | success | 1 | yes |  |
| 40009756758 | 2026-10-23T19:13:56Z | success | 1 | yes |  |
| 40015491364 | 2026-10-23T19:57:42Z | success | 1 | yes |  |
| 40020554098 | 2026-10-23T20:36:41Z | success | 1 | yes |  |
| 40021730377 | 2026-10-23T20:45:55Z | success | 1 | yes |  |
| 40025533275 | 2026-10-23T21:16:21Z | success | 1 | yes |  |
| 40027291164 | 2026-10-23T21:30:36Z | success | 1 | yes |  |
| 40028475397 | 2026-10-23T21:40:29Z | success | 1 | yes |  |
| 40033080882 | 2026-10-23T22:21:32Z | success | 1 | yes |  |
| 40035590291 | 2026-10-23T22:45:00Z | failure | 1 | yes | dispatch-page.spec.js:1261, dispatch.spec.js:2561 |
| 40037686565 | 2026-10-23T23:05:59Z | success | 1 | yes |  |
| 40041756627 | 2026-10-23T23:49:05Z | success | 1 | yes |  |
| 40043799400 | 2026-10-24T00:12:19Z | success | 1 | yes |  |
| 40051600931 | 2026-10-24T01:50:31Z | success | 2 | yes |  |
| 40060390678 | 2026-10-24T03:57:10Z | success | 1 | yes |  |
| 40062439209 | 2026-10-24T04:27:57Z | failure | 1 | yes |  |
| 40074129578 | 2026-10-24T07:26:21Z | success | 1 | yes |  |
| 40077475119 | 2026-10-24T08:17:44Z | success | 1 | yes |  |
| 40078986177 | 2026-10-24T08:40:55Z | success | 1 | yes |  |
| 40079955342 | 2026-10-24T08:55:59Z | success | 1 | yes |  |
| 40080741511 | 2026-10-24T09:07:59Z | success | 1 | yes |  |
| 40081847646 | 2026-10-24T09:24:49Z | success | 1 | yes |  |
| 40084288356 | 2026-10-24T10:01:56Z | success | 1 | yes |  |
| 40084503168 | 2026-10-24T10:05:07Z | failure | 1 | yes | dispatch-page-preset-picker.spec.js:269, dispatch-page.spec.js:1166, dispatch-page.spec.js:1174, dispatch-page.spec.js:1204, dispatch-page.spec.js:1225, dispatch-page.spec.js:1255, dispatch-page.spec.js:1290, dispatch-page.spec.js:1330, dispatch-page.spec.js:1396, dispatch-page.spec.js:1418, dispatch-page.spec.js:1474, dispatch-page.spec.js:1489, dispatch-page.spec.js:157, dispatch-page.spec.js:176, dispatch-page.spec.js:192, dispatch-page.spec.js:208, dispatch-page.spec.js:520, dispatch-page.spec.js:619, dispatch-page.spec.js:642, dispatch-page.spec.js:659, dispatch-page.spec.js:674, dispatch-page.spec.js:96, dispatch.spec.js:1504, dispatch.spec.js:1533, dispatch.spec.js:1556, dispatch.spec.js:1579, dispatch.spec.js:1604, dispatch.spec.js:2480, dispatch.spec.js:2490, flight-companion.spec.js:172, header-nav.spec.js:124, header-nav.spec.js:159, header-nav.spec.js:174, header-nav.spec.js:218, header-nav.spec.js:258, header-nav.spec.js:285, header-nav.spec.js:316, header-nav.spec.js:343, header-nav.spec.js:401, header-nav.spec.js:425, header-nav.spec.js:520, header-nav.spec.js:558, header-nav.spec.js:603, header-nav.spec.js:645, header-nav.spec.js:670, header-nav.spec.js:82, look-alike-controls.spec.js:206, look-alike-controls.spec.js:247, look-alike-dashboard-controls.spec.js:68, observation-rulings.spec.js:1723, opened-task-first-screen.spec.js:1039, opened-task-first-screen.spec.js:459, opened-task-first-screen.spec.js:976, periodicals.spec.js:112, periodicals.spec.js:58, streaming.spec.js:325, swipe-nonactive-binding.spec.js:90 |
| 40084958390 | 2026-10-24T10:12:02Z | failure | 1 | yes | dispatch-page-preset-picker.spec.js:269, dispatch-page.spec.js:1174, dispatch-page.spec.js:1330, dispatch-page.spec.js:1418, dispatch-page.spec.js:157, dispatch-page.spec.js:176, dispatch-page.spec.js:192, dispatch-page.spec.js:208, dispatch-page.spec.js:520, dispatch-page.spec.js:619, dispatch-page.spec.js:642, dispatch-page.spec.js:659, dispatch-page.spec.js:674, dispatch-page.spec.js:96, dispatch.spec.js:1504, dispatch.spec.js:1533, dispatch.spec.js:1556, dispatch.spec.js:1579, dispatch.spec.js:1604, dispatch.spec.js:2480, dispatch.spec.js:2490, flight-companion.spec.js:172, observation-rulings.spec.js:1723, opened-task-first-screen.spec.js:459 |
| 40084985886 | 2026-10-24T10:12:25Z | failure | 1 | yes | dispatch-page-preset-picker.spec.js:269, dispatch-page.spec.js:1178, dispatch-page.spec.js:1334, dispatch-page.spec.js:1422, dispatch-page.spec.js:161, dispatch-page.spec.js:180, dispatch-page.spec.js:196, dispatch-page.spec.js:212, dispatch-page.spec.js:524, dispatch-page.spec.js:623, dispatch-page.spec.js:646, dispatch-page.spec.js:663, dispatch-page.spec.js:678, dispatch.spec.js:1504, dispatch.spec.js:1533, dispatch.spec.js:1556, dispatch.spec.js:1579, dispatch.spec.js:1604, dispatch.spec.js:2489, flight-companion.spec.js:172, observation-rulings.spec.js:1723, opened-task-first-screen.spec.js:459 |
| 40085430657 | 2026-10-24T10:19:09Z | failure | 1 | yes | dispatch-page.spec.js:1189, dispatch-page.spec.js:1346, dispatch-page.spec.js:1434, dispatch-page.spec.js:216, dispatch.spec.js:1579, dispatch.spec.js:2489 |
| 40085964239 | 2026-10-24T10:27:10Z | success | 1 | yes |  |
| 40087568494 | 2026-10-24T10:51:29Z | failure | 1 | yes | dispatch-runner-owner-gate-ui.spec.js:39 |
| 40089947307 | 2026-10-24T11:27:00Z | success | 1 | yes |  |
| 40092128602 | 2026-10-24T12:00:11Z | success | 1 | yes |  |
| 40095617212 | 2026-10-24T12:50:44Z | success | 1 | yes |  |
| 40098870582 | 2026-10-24T13:36:31Z | success | 1 | yes |  |
| 40101277404 | 2026-10-24T14:09:57Z | success | 1 | yes |  |
| 40108144752 | 2026-10-24T15:41:42Z | failure | 1 | yes |  |
| 40108330899 | 2026-10-24T15:44:11Z | success | 1 | yes |  |
| 40109892317 | 2026-10-24T16:04:50Z | failure | 1 | yes | dispatch-defaults.spec.js:164 |
| 40113916434 | 2026-10-24T16:57:26Z | success | 1 | yes |  |
| 40115733609 | 2026-10-24T17:21:16Z | success | 1 | yes | proxy.spec.js:58 |
| 40118457584 | 2026-10-24T17:57:11Z | success | 1 | yes |  |
| 40122590464 | 2026-10-24T18:50:59Z | success | 1 | yes | local-provider.spec.js:305, proxy.spec.js:58 |
| 40124695044 | 2026-10-24T19:18:31Z | success | 1 | yes |  |
| 40124793889 | 2026-10-24T19:19:50Z | success | 1 | yes |  |
| 40126931554 | 2026-10-24T19:48:03Z | success | 1 | yes |  |
| 40127090623 | 2026-10-24T19:50:11Z | success | 2 | yes | proxy.spec.js:58 |
| 40128666753 | 2026-10-24T20:11:24Z | success | 1 | yes | local-provider.spec.js:305 |
| 40132188021 | 2026-10-24T20:58:57Z | success | 1 | yes |  |
| 40138402919 | 2026-10-24T22:24:12Z | success | 1 | yes | dispatch-page.spec.js:1142 |
| 40144045877 | 2026-10-24T23:45:47Z | success | 1 | yes |  |
| 40144412370 | 2026-10-24T23:51:22Z | failure | 1 | yes |  |
| 40150414927 | 2026-10-25T01:23:06Z | success | 1 | yes | local-provider.spec.js:246 |
| 40152161682 | 2026-10-25T01:50:13Z | failure | 1 | yes | opened-task-first-screen.spec.js:128 |
| 40155715110 | 2026-10-25T02:46:13Z | failure | 1 | yes | proxy-runner.spec.js:126, proxy-runner.spec.js:78, settings-areas.spec.js:166, settings.spec.js:298 |
| 40170183752 | 2026-10-25T06:44:41Z | failure | 2 | yes | look-alike-dashboard-controls.spec.js:68 |
| 40171070488 | 2026-10-25T06:59:11Z | success | 1 | yes |  |
| 40172958797 | 2026-10-25T07:29:33Z | success | 1 | yes |  |
| 40173845833 | 2026-10-25T07:43:24Z | failure | 1 | yes |  |
| 40174431890 | 2026-10-25T07:52:31Z | success | 1 | yes |  |
| 40175464964 | 2026-10-25T08:08:42Z | success | 1 | yes | local-provider.spec.js:305 |
| 40176452863 | 2026-10-25T08:23:56Z | success | 1 | yes | dispatch-page.spec.js:1142 |
| 40178414021 | 2026-10-25T08:53:26Z | success | 1 | yes | local-provider.spec.js:246 |
| 40179919037 | 2026-10-25T09:15:51Z | success | 1 | yes | proxy.spec.js:59 |
| 40181477546 | 2026-10-25T09:38:26Z | success | 1 | yes | local-provider.spec.js:305 |
| 40184429218 | 2026-10-25T10:21:22Z | success | 1 | yes |  |
| 40185859349 | 2026-10-25T10:42:12Z | success | 1 | yes |  |
| 40187844372 | 2026-10-25T11:11:49Z | success | 1 | yes |  |
| 40189121107 | 2026-10-25T11:30:08Z | success | 1 | yes | local-provider.spec.js:305 |
| 40190498780 | 2026-10-25T11:49:48Z | success | 1 | yes |  |
| 40191210326 | 2026-10-25T12:00:09Z | failure | 1 | yes | detail-nonactive-binding.spec.js:118, detail-nonactive-binding.spec.js:390 |
| 40192574252 | 2026-10-25T12:19:10Z | failure | 1 | yes |  |
| 40192681231 | 2026-10-25T12:20:38Z | failure | 1 | yes | local-provider.spec.js:246 |
| 40193147281 | 2026-10-25T12:27:00Z | success | 1 | yes | dispatch-page.spec.js:1142, proxy.spec.js:59 |
| 40193257183 | 2026-10-25T12:28:30Z | failure | 1 | yes |  |
| 40194022173 | 2026-10-25T12:38:45Z | success | 1 | yes |  |
| 40196507407 | 2026-10-25T13:11:52Z | success | 1 | yes |  |
| 40197394116 | 2026-10-25T13:23:33Z | failure | 1 | yes | lin-3833-home-first-page.spec.js:98 |
| 40198077633 | 2026-10-25T13:32:29Z | success | 1 | yes |  |
| 40199547251 | 2026-10-25T13:51:39Z | success | 1 | yes |  |
| 40200835097 | 2026-10-25T14:08:28Z | success | 1 | yes |  |
| 40202693140 | 2026-10-25T14:32:09Z | success | 1 | yes |  |
| 40207421415 | 2026-10-25T15:32:25Z | success | 1 | yes | ship.spec.js:332 |
| 40209788725 | 2026-10-25T16:02:40Z | success | 1 | yes |  |
| 40212693189 | 2026-10-25T16:39:06Z | success | 1 | yes |  |
| 40215426428 | 2026-10-25T17:13:33Z | success | 1 | yes |  |
| 40217093532 | 2026-10-25T17:34:06Z | success | 1 | yes |  |
| 40217951349 | 2026-10-25T17:44:57Z | success | 1 | yes | lin-3833-home-first-page.spec.js:98 |
| 40218714734 | 2026-10-25T17:54:30Z | failure | 1 | yes | detail-nonactive-binding.spec.js:118, detail-nonactive-binding.spec.js:390, lin-3833-home-first-page.spec.js:98 |
| 40218854072 | 2026-10-25T17:56:19Z | success | 3 | yes | detail-nonactive-binding.spec.js:118, detail-nonactive-binding.spec.js:390, lin-3833-home-first-page.spec.js:98 |
| 40219275871 | 2026-10-25T18:01:41Z | success | 2 | yes | detail-nonactive-binding.spec.js:118, detail-nonactive-binding.spec.js:390, lin-3833-home-first-page.spec.js:98 |
| 40219529598 | 2026-10-25T18:04:51Z | failure | 2 | yes | detail-nonactive-binding.spec.js:118, detail-nonactive-binding.spec.js:390, lin-3833-home-first-page.spec.js:98 |
| 40220361851 | 2026-10-25T18:15:16Z | failure | 1 | yes | lin-3833-home-first-page.spec.js:133, lin-3833-home-first-page.spec.js:98 |
| 40220867169 | 2026-10-25T18:21:38Z | success | 1 | yes | lin-3833-home-first-page.spec.js:98 |
| 40221330398 | 2026-10-25T18:27:27Z | success | 2 | yes | lin-3833-home-first-page.spec.js:98 |
| 40221398722 | 2026-10-25T18:28:19Z | failure | 2 | yes | detail-nonactive-binding.spec.js:118, detail-nonactive-binding.spec.js:390, lin-3833-home-first-page.spec.js:98 |
| 40221635905 | 2026-10-25T18:31:14Z | success | 2 | yes | detail-nonactive-binding.spec.js:118, detail-nonactive-binding.spec.js:390, lin-3833-home-first-page.spec.js:98, ship.spec.js:332 |
| 40221965074 | 2026-10-25T18:35:20Z | failure | 1 | yes |  |
| 40222608132 | 2026-10-25T18:43:33Z | success | 2 | yes | detail-nonactive-binding.spec.js:118, detail-nonactive-binding.spec.js:390 |
| 40223399303 | 2026-10-25T18:53:31Z | success | 2 | yes | detail-nonactive-binding.spec.js:118, detail-nonactive-binding.spec.js:390, lin-3833-home-first-page.spec.js:98 |
| 40223751015 | 2026-10-25T18:58:04Z | success | 1 | yes | lin-3833-home-first-page.spec.js:98 |
| 40224958448 | 2026-10-25T19:12:58Z | success | 2 | yes | detail-nonactive-binding.spec.js:118, detail-nonactive-binding.spec.js:390, lin-3833-home-first-page.spec.js:98 |
| 40225676611 | 2026-10-25T19:21:52Z | failure | 1 | yes | lin-3833-home-first-page.spec.js:133, lin-3833-home-first-page.spec.js:98 |
| 40228212736 | 2026-10-25T19:54:05Z | success | 1 | yes |  |
| 40231800146 | 2026-10-25T20:39:36Z | success | 2 | yes |  |
| 40234907857 | 2026-10-25T21:18:57Z | success | 1 | yes |  |
| 40236576447 | 2026-10-25T21:40:18Z | success | 1 | yes |  |
| 40239423309 | 2026-10-25T22:16:34Z | failure | 1 | yes | live-console.spec.js:945, live-console.spec.js:964 |
| 40239462630 | 2026-10-25T22:17:04Z | failure | 1 | yes | landing.spec.js:236 |
| 40240728698 | 2026-10-25T22:33:10Z | success | 1 | yes |  |
| 40244635660 | 2026-10-25T23:24:39Z | failure | 1 | yes | lin-3833-home-first-page.spec.js:143, lin-3833-home-first-page.spec.js:208 |
| 40245356405 | 2026-10-25T23:34:08Z | success | 1 | yes |  |
| 40245695449 | 2026-10-25T23:38:46Z | failure | 1 | yes |  |
| 40249204569 | 2026-10-26T00:24:25Z | success | 1 | yes |  |
| 40250929188 | 2026-10-26T00:45:56Z | success | 1 | yes |  |
| 40251525217 | 2026-10-26T00:53:34Z | success | 2 | yes |  |
| 40252081163 | 2026-10-26T01:00:35Z | success | 1 | yes |  |
| 40253767032 | 2026-10-26T01:20:45Z | success | 1 | yes |  |
| 40254277080 | 2026-10-26T01:27:06Z | failure | 1 | yes | settings-models.spec.js:100, settings-models.spec.js:111, settings-models.spec.js:127, settings-models.spec.js:141, settings-models.spec.js:167, settings-models.spec.js:180, settings-models.spec.js:205, settings-models.spec.js:46, settings-models.spec.js:61, settings-models.spec.js:86, settings.spec.js:25, workspace.spec.js:123 |
| 40255663575 | 2026-10-26T01:44:12Z | failure | 1 | yes | settings-models.spec.js:107, settings-models.spec.js:118, settings-models.spec.js:134, settings-models.spec.js:148, settings-models.spec.js:174, settings-models.spec.js:187, settings-models.spec.js:236, settings-models.spec.js:242, settings-models.spec.js:265, settings-models.spec.js:53, settings-models.spec.js:68, settings-models.spec.js:93 |
| 40257794806 | 2026-10-26T02:10:38Z | failure | 1 | yes | settings-models.spec.js:136, settings-models.spec.js:150, settings-models.spec.js:55, settings-models.spec.js:70, settings-models.spec.js:95 |
| 40257873252 | 2026-10-26T02:11:33Z | success | 1 | yes |  |
| 40258109048 | 2026-10-26T02:14:22Z | failure | 1 | yes |  |
| 40259434090 | 2026-10-26T02:30:30Z | success | 1 | yes |  |
| 40259522315 | 2026-10-26T02:31:32Z | failure | 1 | yes | settings-models.spec.js:150, settings-models.spec.js:95 |
| 40265633784 | 2026-10-26T03:45:29Z | success | 2 | yes |  |
| 40267972094 | 2026-10-26T04:13:45Z | success | 1 | yes | proxy.spec.js:59 |
| 40276414778 | 2026-10-26T05:50:32Z | success | 1 | yes |  |
| 40280622746 | 2026-10-26T06:34:29Z | success | 1 | yes | local-provider.spec.js:246 |
| 40290776289 | 2026-10-26T08:13:30Z | success | 1 | yes |  |
| 40299264048 | 2026-10-26T09:24:13Z | success | 1 | yes |  |
| 40303022465 | 2026-10-26T09:53:08Z | success | 1 | yes |  |
| 40318841882 | 2026-10-26T11:57:03Z | success | 1 | yes |  |
| 40327462162 | 2026-10-26T13:04:19Z | failure | 1 | yes | task-page.spec.js:247, task-page.spec.js:436 |
| 40339475740 | 2026-10-26T14:25:12Z | failure | 1 | yes |  |
| 40340482470 | 2026-10-26T14:32:09Z | success | 1 | yes |  |
| 40342859904 | 2026-10-26T14:46:56Z | failure | 1 | yes |  |
| 40353078647 | 2026-10-26T15:49:18Z | success | 1 | yes |  |
| 40376468152 | 2026-10-26T18:17:47Z | success | 1 | yes |  |
| 40852298590 | 2026-10-29T09:46:45Z | success | 1 | yes |  |
| 40876665705 | 2026-10-29T12:50:47Z | success | 1 | yes |  |
| 40895270244 | 2026-10-29T14:49:06Z | failure | 1 | yes | lin-4010-home-opened-task.spec.js:195 |
| 40896715741 | 2026-10-29T14:57:48Z | failure | 1 | yes | lin-4010-home-opened-task.spec.js:195 |
| 40904007525 | 2026-10-29T15:40:49Z | failure | 1 | yes | lin-3987-decision-panel.spec.js:130, lin-3987-decision-panel.spec.js:164, lin-3987-decision-panel.spec.js:175, lin-3987-decision-panel.spec.js:186, lin-3987-decision-panel.spec.js:200, lin-3987-decision-panel.spec.js:217, lin-3987-decision-panel.spec.js:233 |
| 40909047412 | 2026-10-29T16:11:07Z | success | 1 | yes |  |
| 40931651134 | 2026-10-29T18:31:41Z | failure | 1 | yes | lin-3968-home-next-step.spec.js:152, lin-4009-shared-look.spec.js:199 |
| 40932361661 | 2026-10-29T18:36:12Z | success | 1 | yes |  |
| 40935402689 | 2026-10-29T18:55:55Z | success | 1 | yes |  |
| 40948121557 | 2026-10-29T20:20:20Z | success | 1 | yes |  |
| 40965968183 | 2026-10-29T22:27:08Z | failure | 1 | yes | lin-3987-decision-panel.spec.js:135, lin-4010-home-opened-task.spec.js:404 |
| 40971074004 | 2026-10-29T23:08:45Z | success | 1 | yes | task-page.spec.js:374 |
| 40971146104 | 2026-10-29T23:09:22Z | failure | 1 | yes | lin-3987-decision-panel.spec.js:135 |
| 40974411672 | 2026-10-29T23:37:34Z | success | 1 | yes |  |
| 40979313856 | 2026-10-30T00:22:49Z | success | 1 | yes |  |
| 41032634679 | 2026-10-30T09:19:53Z | success | 1 | yes |  |
| 41040303159 | 2026-10-30T10:22:46Z | success | 1 | yes |  |
| 41045505071 | 2026-10-30T11:05:17Z | success | 1 | yes |  |
| 41047821837 | 2026-10-30T11:24:08Z | success | 1 | yes |  |
| 41050632042 | 2026-10-30T11:47:41Z | failure | 1 | yes |  |
| 41057969354 | 2026-10-30T12:47:07Z | success | 1 | yes |  |
| 41071695736 | 2026-10-30T14:27:53Z | success | 1 | yes |  |
| 41080381668 | 2026-10-30T15:24:11Z | success | 1 | yes | task-page.spec.js:374 |
| 41095718433 | 2026-10-30T17:05:20Z | success | 1 | yes |  |
| 41101318422 | 2026-10-30T17:45:36Z | success | 1 | yes | lin-4010-home-opened-task.spec.js:227 |
| 41138312615 | 2026-10-30T22:28:05Z | failure | 1 | yes |  |
| 41139638163 | 2026-10-30T22:40:12Z | success | 1 | yes |  |
| 41146143147 | 2026-10-30T23:43:30Z | success | 1 | yes |  |
| 41159872028 | 2026-10-31T02:24:34Z | success | 1 | yes |  |
| 41163297794 | 2026-10-31T03:11:45Z | success | 1 | yes |  |
| 41169074365 | 2026-10-31T04:33:45Z | success | 1 | yes | task-page.spec.js:374 |
| 41172962480 | 2026-10-31T05:31:55Z | success | 1 | yes |  |
| 41175305614 | 2026-10-31T06:07:38Z | success | 1 | yes |  |
| 41185288654 | 2026-10-31T08:36:18Z | success | 1 | yes |  |
| 41186141669 | 2026-10-31T08:49:14Z | success | 1 | yes |  |
| 41186741065 | 2026-10-31T08:58:28Z | failure | 1 | yes | lin-4010-home-opened-task.spec.js:227 |
| 41187129284 | 2026-10-31T09:03:58Z | failure | 1 | yes | task-page.spec.js:374 |
| 41187700129 | 2026-10-31T09:11:58Z | success | 1 | yes |  |
| 41188517209 | 2026-10-31T09:23:38Z | success | 1 | yes |  |
| 41189659953 | 2026-10-31T09:40:39Z | success | 1 | yes |  |
| 41190137866 | 2026-10-31T09:47:48Z | success | 1 | yes |  |
| 41190807647 | 2026-10-31T09:58:08Z | success | 1 | yes | lin-4010-home-opened-task.spec.js:227 |
| 41322406766 | 2026-11-01T15:40:23Z | failure | 1 | yes | lin-3975-task-run.spec.js:108, lin-3975-task-run.spec.js:302, task-page.spec.js:303 |
| 41322524665 | 2026-11-01T15:41:49Z | success | 1 | yes | lin-4010-home-opened-task.spec.js:227 |
| 41323197563 | 2026-11-01T15:49:55Z | failure | 1 | yes | lin-3975-task-run.spec.js:108, lin-3975-task-run.spec.js:302, look-alike-controls.spec.js:209, task-page.spec.js:303 |
| 41326065238 | 2026-11-01T16:23:12Z | success | 1 | yes |  |
| 41334564230 | 2026-11-01T18:03:02Z | success | 1 | yes |  |
| 41342403005 | 2026-11-01T19:34:20Z | success | 1 | yes |  |
| 41352552909 | 2026-11-01T21:32:47Z | success | 1 | yes |  |
| 41359024039 | 2026-11-01T22:49:07Z | success | 1 | yes |  |
| 41369837425 | 2026-11-02T00:56:32Z | success | 1 | yes | task-page.spec.js:376 |
| 41382273465 | 2026-11-02T03:17:28Z | failure | 1 | yes | assignee-filter.spec.js:87, dashboard.spec.js:31, error-handling.spec.js:118, jira-provider.spec.js:27, lin-4010-home-opened-task.spec.js:230, opened-task-first-screen.spec.js:718, prompts.spec.js:41, prompts.spec.js:50, prompts.spec.js:58, prompts.spec.js:65, prompts.spec.js:76, prompts.spec.js:90, prompts.spec.js:99 |
| 41384955813 | 2026-11-02T03:47:16Z | success | 1 | yes | task-page.spec.js:376 |
| 41389864166 | 2026-11-02T04:41:28Z | success | 1 | yes |  |
| 41407597886 | 2026-11-02T07:38:22Z | success | 1 | yes |  |
| 41418882213 | 2026-11-02T09:13:26Z | success | 1 | yes | lin-4010-home-opened-task.spec.js:230 |
| 41420314156 | 2026-11-02T09:24:00Z | failure | 1 | yes | lin-4115-home-halt-banner.spec.js:185, look-alike-controls.spec.js:209 |
| 41423323114 | 2026-11-02T09:46:02Z | failure | 1 | yes | lin-4119-backlog-page.spec.js:319, look-alike-controls.spec.js:213 |
| 41424293833 | 2026-11-02T09:53:19Z | failure | 1 | yes | error-handling.spec.js:249, lin-4115-home-halt-banner.spec.js:189, look-alike-controls.spec.js:213 |
| 41428036700 | 2026-11-02T10:20:36Z | failure | 1 | yes | lin-4115-home-halt-banner.spec.js:189, live-console.spec.js:3215, look-alike-controls.spec.js:213 |
| 41432220705 | 2026-11-02T10:52:11Z | success | 1 | yes |  |
| 41439541701 | 2026-11-02T11:47:18Z | success | 1 | yes |  |
| 41443890623 | 2026-11-02T12:20:29Z | success | 1 | yes |  |
| 41447527898 | 2026-11-02T12:47:14Z | success | 1 | yes |  |
| 41457381786 | 2026-11-02T13:56:50Z | success | 1 | yes |  |
| 41468271435 | 2026-11-02T15:06:11Z | success | 1 | yes | live-console.spec.js:3215 |
| 41481177500 | 2026-11-02T16:24:38Z | success | 1 | yes |  |
| 41488855513 | 2026-11-02T17:11:58Z | success | 1 | yes |  |
| 41494462594 | 2026-11-02T17:47:29Z | success | 1 | yes |  |
| 41504774760 | 2026-11-02T18:53:18Z | success | 1 | yes | lin-4010-home-opened-task.spec.js:342 |
| 41521276441 | 2026-11-02T20:39:55Z | success | 1 | yes | lin-4010-home-opened-task.spec.js:230 |
| 41524852466 | 2026-11-02T21:03:40Z | success | 1 | yes |  |
| 41543054356 | 2026-11-02T23:08:32Z | success | 1 | yes |  |
| 41593231553 | 2026-11-03T06:58:21Z | success | 1 | yes |  |
| 41597478878 | 2026-11-03T07:36:49Z | success | 1 | yes |  |
| 41599762955 | 2026-11-03T07:57:25Z | success | 1 | yes |  |
| 41600882212 | 2026-11-03T08:06:52Z | success | 2 | yes | look-alike-controls.spec.js:209 |
| 41638750382 | 2026-11-03T12:47:59Z | failure | 1 | yes | legal.spec.js:210, lin-3987-decision-panel.spec.js:172, observation-rulings.spec.js:1821, observation-rulings.spec.js:1998 |
| 41645305849 | 2026-11-03T13:32:57Z | success | 1 | yes | task-page.spec.js:376 |
| 41683760998 | 2026-11-03T17:23:20Z | failure | 1 | yes | opened-task-first-screen.spec.js:430, opened-task-first-screen.spec.js:638 |
| 41686160584 | 2026-11-03T17:38:13Z | success | 1 | yes |  |
| 41693805199 | 2026-11-03T18:26:17Z | success | 1 | yes |  |
| 41711404990 | 2026-11-03T20:18:49Z | success | 1 | yes |  |
| 41734385469 | 2026-11-03T22:51:31Z | success | 1 | yes |  |
| 41747957336 | 2026-11-04T00:35:24Z | success | 1 | yes | session-proposals.spec.js:64 |
| 41761203832 | 2026-11-04T02:30:36Z | success | 1 | yes |  |
| 41776718575 | 2026-11-04T05:01:51Z | success | 1 | yes | task-page.spec.js:376 |
| 41797321425 | 2026-11-04T08:09:16Z | success | 1 | yes |  |
| 41798922939 | 2026-11-04T08:21:53Z | success | 1 | yes |  |
| 41800030296 | 2026-11-04T08:30:29Z | success | 1 | yes | lin-4010-home-opened-task.spec.js:342, task-page.spec.js:376 |
| 41801874515 | 2026-11-04T08:44:52Z | success | 1 | yes |  |
| 41830363924 | 2026-11-04T12:33:56Z | failure | 1 | yes | task-page.spec.js:376 |
| 41831795810 | 2026-11-04T12:43:54Z | success | 1 | yes | task-page.spec.js:376 |
| 41873338280 | 2026-11-04T17:01:08Z | success | 1 | yes |  |
| 41888288210 | 2026-11-04T18:33:17Z | failure | 1 | yes |  |
| 41891505130 | 2026-11-04T18:53:07Z | success | 1 | yes |  |
| 41896714676 | 2026-11-04T19:24:59Z | success | 1 | yes |  |
| 41929130326 | 2026-11-04T22:53:15Z | success | 1 | yes |  |
| 41932205980 | 2026-11-04T23:15:06Z | success | 1 | yes |  |
| 41938153136 | 2026-11-05T00:01:07Z | success | 1 | yes |  |
| 41949389693 | 2026-11-05T01:34:04Z | success | 1 | yes | session-proposals.spec.js:64 |
| 41960255661 | 2026-11-05T03:13:45Z | success | 1 | yes |  |
| 41968705511 | 2026-11-05T04:35:04Z | success | 1 | yes | task-page.spec.js:376 |
| 41977546436 | 2026-11-05T06:00:27Z | success | 1 | yes |  |
| 41994115026 | 2026-11-05T08:23:42Z | failure | 1 | yes | lin-3833-home-first-page.spec.js:278, templates.spec.js:17 |
| 41996153629 | 2026-11-05T08:39:24Z | success | 1 | yes | session-proposals.spec.js:64 |
| 42009059529 | 2026-11-05T10:14:33Z | success | 1 | yes |  |
| 42012891607 | 2026-11-05T10:42:08Z | success | 1 | yes |  |
| 42016457324 | 2026-11-05T11:08:08Z | success | 1 | yes | task-page.spec.js:376 |
| 42021226134 | 2026-11-05T11:43:08Z | success | 1 | yes |  |
| 42027922616 | 2026-11-05T12:31:55Z | success | 1 | yes |  |
| 42031367546 | 2026-11-05T12:56:24Z | success | 1 | yes | task-page.spec.js:376 |
| 42034552106 | 2026-11-05T13:18:05Z | success | 1 | yes |  |
| 42039930537 | 2026-11-05T13:54:22Z | success | 1 | yes |  |
| 42042760395 | 2026-11-05T14:12:30Z | success | 1 | yes |  |
| 42049292932 | 2026-11-05T14:52:47Z | success | 1 | yes | lin-4010-home-opened-task.spec.js:230 |
| 42051482912 | 2026-11-05T15:05:54Z | success | 1 | yes |  |
| 42055092773 | 2026-11-05T15:27:03Z | success | 1 | yes | task-page.spec.js:376 |
| 42056839523 | 2026-11-05T15:37:22Z | success | 1 | yes |  |
| 42060683751 | 2026-11-05T16:00:24Z | success | 1 | yes |  |
| 42061436439 | 2026-11-05T16:07:06Z | success | 1 | yes |  |
| 42063365419 | 2026-11-05T16:20:17Z | success | 1 | yes | task-page.spec.js:376 |
| 42064401704 | 2026-11-05T16:26:09Z | success | 1 | yes | task-page.spec.js:376 |
| 42065802938 | 2026-11-05T16:34:17Z | success | 1 | yes |  |
| 42067622099 | 2026-11-05T16:44:56Z | success | 1 | yes | task-page.spec.js:817 |
| 42070606459 | 2026-11-05T17:02:16Z | success | 1 | yes |  |
| 42081545679 | 2026-11-05T18:09:37Z | success | 1 | yes |  |
| 42088715606 | 2026-11-05T18:54:14Z | success | 1 | yes |  |
| 42098745897 | 2026-11-05T19:57:04Z | success | 1 | yes | session-proposals.spec.js:64 |
| 42100330946 | 2026-11-05T20:07:01Z | success | 1 | yes |  |
| 42101516844 | 2026-11-05T20:14:25Z | success | 1 | yes |  |
| 42108814416 | 2026-11-05T21:01:43Z | success | 1 | yes |  |
| 42116356257 | 2026-11-05T21:51:12Z | success | 1 | yes | task-page.spec.js:376 |
| 42185714190 | 2026-11-06T08:09:52Z | failure | 1 | yes | task-page.spec.js:376 |
| 42187662151 | 2026-11-06T08:26:14Z | success | 1 | yes |  |
| 42190887139 | 2026-11-06T08:53:09Z | success | 1 | yes |  |
| 42193963431 | 2026-11-06T09:17:49Z | success | 1 | yes |  |
| 42198071444 | 2026-11-06T09:50:35Z | success | 1 | yes |  |
| 42200648410 | 2026-11-06T10:10:43Z | success | 1 | yes |  |
| 42203000295 | 2026-11-06T10:29:00Z | success | 1 | yes |  |
| 42207708317 | 2026-11-06T11:06:16Z | success | 1 | yes |  |
| 42211067468 | 2026-11-06T11:32:56Z | success | 1 | yes | task-page.spec.js:376 |
| 42212954257 | 2026-11-06T11:48:28Z | success | 1 | yes |  |
| 42215483316 | 2026-11-06T12:09:13Z | success | 1 | yes |  |
| 42227655404 | 2026-11-06T13:42:23Z | success | 1 | yes |  |
| 42233703545 | 2026-11-06T14:24:57Z | success | 1 | yes |  |
| 42242913674 | 2026-11-06T15:25:30Z | success | 1 | yes | observation.spec.js:519, observation.spec.js:543 |
| 42248785598 | 2026-11-06T16:03:31Z | success | 1 | yes |  |
| 42280281836 | 2026-11-06T19:30:54Z | success | 1 | yes |  |
| 42301821057 | 2026-11-06T22:04:24Z | success | 1 | yes |  |
| 42357329216 | 2026-11-07T08:52:48Z | success | 1 | yes |  |
| 42367308675 | 2026-11-07T11:14:03Z | failure | 1 | yes | task-page.spec.js:376 |
| 42369684928 | 2026-11-07T11:47:54Z | success | 1 | yes | session-proposals.spec.js:64 |
| 42374342068 | 2026-11-07T12:51:49Z | failure | 1 | yes | task-page.spec.js:376, task-page.spec.js:662 |
| 42383113503 | 2026-11-07T14:45:50Z | success | 1 | yes | session-proposals.spec.js:64 |
| 42391774796 | 2026-11-07T16:32:08Z | success | 1 | yes |  |
| 42395118529 | 2026-11-07T17:12:00Z | success | 1 | yes | observation.spec.js:519 |
| 42401293444 | 2026-11-07T18:26:20Z | success | 1 | yes | session-proposals.spec.js:64 |
| 42405930070 | 2026-11-07T19:22:53Z | success | 1 | yes |  |
| 42410131286 | 2026-11-07T20:14:59Z | success | 1 | yes | lin-4010-home-opened-task.spec.js:230 |
| 42413725160 | 2026-11-07T21:00:11Z | success | 1 | yes | task-page.spec.js:379 |
| 42422946104 | 2026-11-07T22:56:44Z | success | 1 | yes | task-page.spec.js:379 |
| 42426832969 | 2026-11-07T23:47:32Z | success | 1 | yes |  |
| 42430510955 | 2026-11-08T00:36:25Z | success | 1 | yes |  |
| 42433622451 | 2026-11-08T01:17:42Z | success | 1 | yes |  |
| 42437965493 | 2026-11-08T02:18:22Z | success | 1 | yes |  |
| 42444183013 | 2026-11-08T03:47:43Z | success | 1 | yes | task-page.spec.js:379 |
| 42446933997 | 2026-11-08T04:28:07Z | success | 1 | yes | task-page.spec.js:379 |
| 42451236010 | 2026-11-08T05:33:25Z | success | 1 | yes |  |
| 42455219719 | 2026-11-08T06:33:11Z | success | 1 | yes | task-page.spec.js:379 |
| 42459939609 | 2026-11-08T07:43:20Z | success | 1 | yes |  |
| 42463370569 | 2026-11-08T08:32:29Z | success | 1 | yes |  |
| 42465399697 | 2026-11-08T09:01:41Z | success | 1 | yes |  |
| 42471241791 | 2026-11-08T10:23:38Z | success | 1 | yes |  |
| 42471821434 | 2026-11-08T10:32:00Z | success | 1 | yes | observation-rulings.spec.js:1148 |
| 42472306303 | 2026-11-08T10:38:53Z | success | 1 | yes |  |
| 42473294800 | 2026-11-08T10:52:59Z | success | 1 | yes | lin-4010-home-opened-task.spec.js:230, session-proposals.spec.js:64 |
| 42474570018 | 2026-11-08T11:10:27Z | success | 1 | yes | session-proposals.spec.js:64, task-page.spec.js:379 |
| 42477078267 | 2026-11-08T11:44:41Z | success | 1 | yes |  |
| 42478642932 | 2026-11-08T12:05:54Z | success | 1 | yes | task-page.spec.js:379 |
| 42479471805 | 2026-11-08T12:16:39Z | success | 1 | yes |  |
| 42480948039 | 2026-11-08T12:35:08Z | success | 1 | yes | lin-4010-home-opened-task.spec.js:230, task-page.spec.js:379 |
| 42481914411 | 2026-11-08T12:47:55Z | success | 1 | yes |  |
| 42483082415 | 2026-11-08T13:03:06Z | success | 1 | yes |  |
| 42484132187 | 2026-11-08T13:16:05Z | success | 1 | yes |  |
| 42486836238 | 2026-11-08T13:50:10Z | success | 1 | yes | task-page.spec.js:379 |
| 42490104170 | 2026-11-08T14:30:10Z | success | 1 | yes |  |
| 42492945761 | 2026-11-08T15:04:42Z | success | 1 | yes |  |
| 42494270680 | 2026-11-08T15:20:05Z | success | 1 | yes |  |
| 42497386865 | 2026-11-08T15:57:19Z | success | 1 | yes | task-page.spec.js:379 |
| 42500431248 | 2026-11-08T16:32:44Z | success | 1 | yes |  |
| 42503639935 | 2026-11-08T17:10:39Z | success | 1 | yes | observation-rulings.spec.js:1275 |
| 42781483236 | 2026-11-10T08:17:33Z | success | 1 | yes | task-page.spec.js:379 |
| 42787217002 | 2026-11-10T09:01:25Z | success | 1 | yes | lin-3968-home-next-step.spec.js:332 |
| 42798091572 | 2026-11-10T10:18:58Z | success | 1 | yes | task-page.spec.js:379 |
| 42804039178 | 2026-11-10T11:01:38Z | success | 1 | yes | task-page.spec.js:379 |
| 42810586726 | 2026-11-10T11:49:22Z | success | 1 | yes | task-page.spec.js:379 |
| 42812011032 | 2026-11-10T11:59:58Z | success | 1 | yes |  |
| 42815314141 | 2026-11-10T12:23:18Z | success | 1 | yes |  |
| 42818052666 | 2026-11-10T12:42:32Z | success | 1 | yes |  |
| 42830193352 | 2026-11-10T14:03:01Z | success | 1 | yes |  |
| 42834462229 | 2026-11-10T14:28:39Z | success | 1 | yes |  |
| 43106596584 | 2026-11-11T21:50:36Z | success | 1 | yes | task-page.spec.js:379 |
| 43110363169 | 2026-11-11T22:16:28Z | success | 1 | yes | session-proposals.spec.js:64, task-page.spec.js:379 |

## Unit failures on attempt 1 of re-runs that ended green

From the full attempt-1 unit job logs of the 16 `run_attempt > 1` runs (5 had a failing unit job on attempt 1 and a green final attempt):

| run id | created | event / branch | failing test (as reported at that sha) |
|---|---|---|---|
| 40051600931 | 2026-10-24T01:50Z | push / main | `tests/unit/task-share-route.test.js:513` "a minted Harbour token planted bare … is masked" (assertion "dispatch token tail reached the body") |
| 40221330398 | 2026-10-25T18:27Z | push / main | `tests/unit/db-indexes.test.js` "deferred index tier (LIN-3811)" › "a spec whose key already exists under another name is not rebuilt" |
| 40231800146 | 2026-10-25T20:39Z | pull_request / feat/lin-3962-decision-panel | same db-indexes test |
| 40251525217 | 2026-10-26T00:53Z | pull_request / feat/lin-3980-landing-plain-sign-in | `tests/unit/scheduler.test.js:265` "(e) error containment" ("expected the interval to keep ticking past the first throw (at least 2 calls), got 1") |
| 40265633784 | 2026-10-26T03:45Z | pull_request / feat/lin-3975-task-page-move | same db-indexes test |

The db-indexes test was fixed by LIN-3985 (`96efd1fe6`, 2026-10-31, "tests await the deferred index build instead of a budget of turns"); no later re-run rescue.

## Live GitHub egress

`Bad credentials` lines (REST `repos/octo/repo/issues`, `repos/octo/repo/milestones`, and GraphQL) appear in the E2E logs of 127 of the 355 sampled runs. Only calls that log an error are visible, so this does not bound the egress population.
