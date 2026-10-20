# Incident — MongoDB 8.0 refuses to start on Linux kernel 6.19+ (CI)

**Opened:** 19 Oct 2026, 18:15Z, by the operator
**Status:** CLOSED (20 Oct 2026). CI was fixed on main on 19 Oct at 20:05Z (#1990). Production is unaffected on its current host. The remaining risk, a host kernel moving into the affected range, is tracked in LIN-3698.
**Severity:** CI is degraded for every Harbour PR, and some unit-test runs fail. Production is up, with a latent risk if it restarts.

## Summary

The `mongo:8.0` service container in Harbour's GitHub CI exits at start-up on some runners:

> MongoDB cannot start: Linux kernel versions 6.19 and newer has a known incompatibility with this version of MongoDB. See https://jira.mongodb.org/browse/SERVER-121912

When a job lands on such a runner, "Unit tests" fails in about 12 seconds before any test runs, so `ci-success` cannot go green. Public reports say MongoDB 8.x refuses kernels 6.19 to 7.0.13 on purpose: TCMalloc's rseq use breaks on those kernels, and the refusal is MongoDB's guard against memory corruption. The same failure is reported on Railway hosts, which is where production MongoDB runs.

## Impact

- **CI:** Unit-test jobs that land on a new-kernel runner fail. The fleet looks mixed (see the timeline), so failures are intermittent. A green run on one PR is not proof the problem has gone away.
- **Pipeline:** Workers whose PR hits the failure stop at "blocked". LIN-3632 has (PR #1989); its code and production step are otherwise done.
- **Production:** No impact. Host kernel 6.12.22 is not affected (LIN-3697). MongoDB-harbour served LIN-3632's production step at about 18:1xZ. Risk: if it runs 8.x and Railway restarts or redeploys it onto a 6.19+ host, it may not come back. That would take Harbour down. The version and kernel are not yet known (LIN-3697).

## Timeline (UTC, 19 Oct)

| Time | Event |
|---|---|
| 10:57 | Last green run on main (run 39241186373, `mongo:8.0`). |
| 18:07:59 | PR #1988 (LIN-3689): "Initialize containers" succeeds and Unit tests pass. That runner was fine. Its later failure is E2E shard 4/4, which is unrelated and being handled by its own run. |
| 18:12:48 | PR #1989 (LIN-3632), job 118224463438: the mongo container refuses to start (SERVER-121912). Unit tests fail. |
| 18:13:34 | LIN-3632's run reports blocked and names the CI cause. Its production drop was already verified. |
| ~18:15 | Operator reads the job log, confirms the cause, and researches workarounds. |
| 18:17 | **LIN-3694** (P1) launched: CI fix. Try (a) `GLIBC_TUNABLES=glibc.pthread.rseq=1` on `mongo:8.0`, then (b) pin `mongo:7.0`, and stop at the first that works. |
| ~18:20 | Production risk flagged to John. John: "Oh wow, good catch! Happy to go with your recommendations." |
| 18:22 | **LIN-3697** (P1) launched: one read-only production check of `buildInfo.version` and the host kernel from `hostInfo`. No writes, no restarts. |
| 18:25 | Correction. The first report said #1988 failed the same way. It did not, and its unit job passed. Follow-up sent to LIN-3694: print `uname -r` and prove the fix on a 6.19+ runner (up to 3 attempts). |
| 18:27 | Duplicate found. LIN-3632's run had already filed **LIN-3693** (18:15) for the same fix, and LIN-3632 is waiting on it. **LIN-3694 canceled** and its run cascade-aborted. The operator's guidance (try order, `uname -r`, mixed fleet, a comment beside the image line) was sent to LIN-3693's run instead. |
| ~18:35 | John: "Prod runs 8.0.32". That is at or above 8.0.30, so per the upstream note it still refuses kernels 6.19 to 7.0.13 and starts on 7.0.14+. LIN-3693 told to prefer `mongo:8.0.32` plus `GLIBC_TUNABLES=glibc.pthread.rseq=1`, which mirrors production, and to record whether that starts on a 6.19+ runner. That is the evidence for a production fix. LIN-3697 refocused on the host kernel. |
| 18:28 to 18:31 | **Operator probe** (run 39302841645, 9 runners, on the operator's branch, since reverted). The runner fleet is mixed: kernels 6.8 (3), 6.17 (4) and 7.0.0-1017-azure (2). On 7.0.0, mongo 8.0.32, 8.0.34 and 8.3.13 refuse with no tunable and with `rseq=0`, and **start and pass a 20k-insert load with `GLIBC_TUNABLES=glibc.pthread.rseq=1`**. 8.2.12 and 7.0.45 start everywhere. Results: [the community answer's evidence table](../community-answers/2026-10-19-railway-mongodb-kernel-6-19.md#evidence). |
| 18:29 | LIN-3697 read: production is **8.0.32 in an Ubuntu 24.04 container**. The host kernel was not in the approved fields. Ruling answered by John; re-run with `hostInfo.extra.kernelVersion` in progress. |
| 18:40 | Probe results sent to LIN-3693: use `mongo:8.0.32` plus `rseq=1`, not `rseq=0`. |
| 18:32 | LIN-3697 second read (with John's approval): production host kernel **6.12.22+bpo-cloud-amd64**, below 6.19, so a restart starts today. Risk is only future host drift; **LIN-3698** (High) filed for it. |
| 18:45 | John posted the operator's answer on the Railway bounty thread. Answer and evidence being committed as `docs/community-answers/2026-10-19-railway-mongodb-kernel-6-19.md`. |
| 19:23 | #1990 green. All 4 unit attempts landed on 6.17 runners, so kernel 7.0 is covered by the operator probe. New: with `rseq=1`, mongod logs warning 8718500 ("critical performance implications"). Production advice changed: set the variable only if the host kernel moves into the range. |
| ~19:45 | Separate issue: OpenRouter credits ran low (402 `weight_exceeds_budget`). LIN-3423 parked; others retried through. John topped up at ~19:55. |
| ~20:05 | **#1990 merged** (272af5c9): `mongo:8.0.32` plus `GLIBC_TUNABLES=glibc.pthread.rseq=1`, and a `uname -r` step. CI mitigated. LIN-3618 (#1992) also merged. |

## Resolution

1. **CI:** #1990 pinned `mongo:8.0.32` and set `GLIBC_TUNABLES=glibc.pthread.rseq=1`, with a `uname -r` step. Every Harbour PR since has gone green, including the 20 Oct runs on mixed runners.
2. **Production:** a read-only check (LIN-3697) found MongoDB 8.0.32 on host kernel 6.12.22, which is outside the affected range. No change was made.
3. **Held work:** the held launches resumed after #1990 merged, and LIN-3632 and LIN-3689 completed.
4. **Residual risk:** LIN-3698. If Railway ever moves MongoDB-harbour to a host on kernel 6.19 to 7.0.13, set the same variable at a planned redeploy, after a backup. MongoDB warns the variable has a performance cost (id 8718500), so it is not set ahead of time.
5. **Write-up:** `docs/community-answers/2026-10-19-railway-mongodb-kernel-6-19.md` (#1991). The answer was posted on the Railway forum.

## Decisions and pending

- **Any production change** (pinning the image, setting `GLIBC_TUNABLES` on MongoDB-harbour) restarts the database, which is the risky moment. The operator will bring John one exact step to approve, based on LIN-3697's output, and will not act on the general approval alone.
- **Production version:** 8.0.32 (John). The risk depends on the host kernel, which LIN-3697 reports. **Measured:** `GLIBC_TUNABLES=glibc.pthread.rseq=1` gets 8.0.32 past the refusal on kernel 7.0.0, and it is harmless on 6.8 and 6.17. `rseq=0` does not work. Likely production fix: set that variable on MongoDB-harbour and redeploy once, at a quiet time and after a backup. That needs John's yes on the exact step.
- **Open:** whether Railway can pin a host or kernel. Whether a backup or snapshot exists before any restart; check this before a change.

## Lessons

- A floating image tag (`mongo:8.0`) took in an upstream behaviour change. A pin with its reason recorded beside it would have made the change visible.
- The first triage read one failed run and generalised from it. Check a second instance before stating a pattern.
- The operator filed a fix without first checking whether a running worker had already filed one, and it had, two minutes earlier. Before filing for a cross-cutting failure, list the tickets created in the last 30 minutes.

## Sources

- MongoDB SERVER-121912: https://jira.mongodb.org/browse/SERVER-121912
- docker-library/mongo#765: https://github.com/docker-library/mongo/issues/765
- Railway thread: https://station.railway.com/questions/mongo-db-8-0-fails-to-start-on-kernel-6-1-95346827
