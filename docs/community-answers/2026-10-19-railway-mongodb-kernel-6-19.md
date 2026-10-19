# MongoDB 8.0 refuses to start on Linux kernel 6.19+

**Question:** [MongoDB 8.0 fails to start on kernel 6.19+ (europe-west4-drams3a)](https://station.railway.com/questions/mongo-db-8-0-fails-to-start-on-kernel-6-1-95346827), Railway Central Station, asked 20 May 2026. It had a bounty.
**Answered:** 19 Oct 2026. The operator drafted the answer from a test run, and John posted it on the thread.
**Why we looked:** the same failure broke Harbour's CI that evening (LIN-3693), and Harbour's production database runs MongoDB 8.0.32 on Railway.

## The question, in short

A Railway MongoDB service using the `mongo:8.0` image crashed on every start, logging:

> MongoDB cannot start: Linux kernel versions 6.19 and newer has a known incompatibility with this version of MongoDB. See https://jira.mongodb.org/browse/SERVER-121912 for more information.

Restarting didn't help. A moderator suggested moving the service to another region, and nobody confirmed whether that fixed it.

## The answer, as drafted for the forum

This isn't a Railway fault, and restarting won't fix it. It's MongoDB's own start-up guard. TCMalloc in MongoDB 8.x is broken on Linux kernels **6.19 to 7.0.13** (SERVER-121912), so `mongod` exits on purpose when it sees one of those kernels. Even `mongod --version` refuses. Moving region only helps while that region's hosts run an older kernel.

**Fix that worked (tested today):** add one variable to the MongoDB service and redeploy:

```
GLIBC_TUNABLES=glibc.pthread.rseq=1
```

**How I tested it:** 9 GitHub-hosted runners on kernels 6.8, 6.17 and 7.0.0, with the official images. Each image had to start, then take a 20,000-document insert load.

| Image | Kernel 6.8 / 6.17 | Kernel 7.0.0, no variable | 7.0.0 + `rseq=0` | 7.0.0 + `rseq=1` |
|---|---|---|---|---|
| mongo:8.0.32, mongo:8.0 (8.0.34) | starts | refused | refused | **starts, load OK** |
| mongo:8.3 (8.3.13) | starts | refused | refused | **starts, load OK** |
| mongo:8.2 (8.2.12) | starts | starts | starts | starts |
| mongo:7.0 (7.0.45) | starts | starts | starts | starts |

Notes:
- **Not `rseq=0`.** It's often suggested, but it was refused on every 8.0 and 8.3 run.
- **The variable is harmless on unaffected kernels.** With it set, every image also started on 6.8 and 6.17, so you can leave it set and stop caring which host you land on.
- **Other options I tested less:** `mongo:8.2` started everywhere without the variable. Check MongoDB's upgrade notes before moving existing 8.0 data onto it, because I didn't test an in-place upgrade. Don't point an 8.0 data volume at `mongo:7.0` without lowering `featureCompatibilityVersion` first.
- **To see your host's kernel:** run `db.hostInfo().extra.kernelVersion` in mongosh. Note that `os.version` is the distro release, not the kernel.
- **Caveat:** I measured that the variable works. I haven't confirmed why, or whether it costs allocator performance under heavy load. The load test was short.

Test run (public logs): https://github.com/JKershaw/LinearViewer/actions/runs/39302841645

## Since posting

- **The variable has a stated cost.** With `GLIBC_TUNABLES=glibc.pthread.rseq=1`, mongod 8.0.32 logs warning id 8718500 at start-up: "Your system has glibc support for rseq built in, which is not yet supported by tcmalloc-google and has critical performance implications. Please set the environment variable GLIBC_TUNABLES=glibc.pthread.rseq=0". On kernels 6.19 to 7.0.13, `rseq=0` is the setting that refuses to start. So `rseq=1` gets past the refusal, and MongoDB itself says it costs allocator performance. Treat it as a stopgap until the host kernel is 7.0.14 or newer, or an 8.x release fixes TCMalloc, rather than as a free fix. (Seen in Harbour's CI, run 39306927693, PR #1990.)
- **Not yet witnessed:** minutes-long stability under sustained load on a 7.0 kernel. The probe below ran a short insert burst only.

## Evidence

The test was GitHub Actions run 39302841645 on this repository, 19 Oct 2026, 18:28 to 18:31 UTC. It ran 9 jobs: `ubuntu-latest`, `ubuntu-24.04` and `ubuntu-22.04`, three replicas each. Each job tried every image tag with each `GLIBC_TUNABLES` setting.

- **Started** means `db.adminCommand({ping:1})` answered within 30 seconds.
- **Load OK** means the container then took 20 batches of 1,000 inserts, counted 20,000 documents, and was still running two seconds later.
- **Refused** means the container exited at start-up with the SERVER-121912 message, log id 12257600. No other failure mode was seen.

| Kernel | Runners | 8.0.32 | 8.0 (8.0.34) | 8.2 (8.2.12) | 8.3 (8.3.13) | 7.0 (7.0.45) |
|---|---|---|---|---|---|---|
| 6.8.0-1064-azure | 2 (22.04) | ok / ok / ok | ok / ok / ok | ok / ok / ok | ok / ok / ok | ok / ok / ok |
| 6.8.0-1070-azure | 1 (22.04) | ok / ok / ok | ok / ok / ok | ok / ok / ok | ok / ok / ok | ok / ok / ok |
| 6.17.0-1022-azure | 4 (24.04, latest) | ok / ok / ok | ok / ok / ok | ok / ok / ok | ok / ok / ok | ok / ok / ok |
| 7.0.0-1017-azure | 2 (24.04, latest) | refused / refused / **ok** | refused / refused / **ok** | ok / ok / ok | refused / refused / **ok** | ok / ok / ok |

Each cell reads: no variable / `glibc.pthread.rseq=0` / `glibc.pthread.rseq=1`. Runners that shared a kernel agreed in every cell.

Three things the data shows:
- **The fleet is mixed.** The kernel doesn't follow the runner label. `ubuntu-latest` and `ubuntu-24.04` each landed on 6.17 and on 7.0.0. A green CI run on one runner says nothing about the next one.
- **The refusal is a guard, not a crash.** On 7.0.0 the refused images print the message and exit before doing anything, even for `mongod --version`.
- **8.2.12 doesn't have the guard,** at least on 7.0.0.

### Reproducing it

The probe was a temporary workflow on the operator's branch, removed once the results were in. Its job step, for a runner with Docker:

```sh
K=$(uname -r)
for tag in 8.0.32 8.0 8.2 8.3 7.0; do
  docker pull -q mongo:$tag >/dev/null
  for tun in none glibc.pthread.rseq=0 glibc.pthread.rseq=1; do
    n=m$RANDOM
    if [ "$tun" = none ]; then docker run -d --name $n mongo:$tag >/dev/null
    else docker run -d --name $n -e GLIBC_TUNABLES=$tun mongo:$tag >/dev/null; fi
    res=refused-or-crashed
    for i in $(seq 1 30); do
      [ "$(docker inspect -f '{{.State.Running}}' $n)" != true ] && break
      if docker exec $n mongosh --quiet --eval 'db.adminCommand({ping:1}).ok' 2>/dev/null | grep -q '^1$'; then res=started; break; fi
      sleep 1
    done
    if [ "$res" = started ]; then
      cnt=$(docker exec $n mongosh --quiet --eval 'const t=db.getSiblingDB("p").t; for(let j=0;j<20;j++){t.insertMany(Array.from({length:1000},(_,i)=>({j,i,s:"x".repeat(200)})))}; print(t.countDocuments())' 2>/dev/null | tail -1)
      sleep 2
      if [ "$(docker inspect -f '{{.State.Running}}' $n)" = true ] && [ "$cnt" = 20000 ]; then res=started+load-ok; else res="started-then-failed(count=$cnt)"; fi
    fi
    echo "kernel=$K tag=$tag tunables=$tun result=$res"
    docker rm -f $n >/dev/null
  done
done
```

To check a host whose kernel is in the affected range, run it on a 6.19 to 7.0.13 machine. Only some GitHub runners are; print `uname -r` to see which kind you got.

## What it meant for Harbour

- **CI.** Harbour's unit job starts `mongo:8.0` as a service, so it failed whenever a job landed on a 7.0.0 runner. The fix follows the data: `mongo:8.0.32` (production's version) plus `GLIBC_TUNABLES=glibc.pthread.rseq=1` on the service (LIN-3693).
- **Production.** A read-only check (LIN-3697) found MongoDB 8.0.32 on host kernel 6.12.22, below the affected range, so a restart there would start today. The risk is Railway later moving the service to a host on 6.19 to 7.0.13. LIN-3698 tracks that. The measured guard is the same variable on the MongoDB service, set at a planned redeploy, after a backup. Its performance warning (above) is a reason to set it only if the host kernel actually moves into the affected range, not ahead of time.

## Sources

- MongoDB SERVER-121912: https://jira.mongodb.org/browse/SERVER-121912
- docker-library/mongo#765: https://github.com/docker-library/mongo/issues/765. It reports `rseq=1` working, and that 8.0.30 and 8.3.9 lift the refusal only on kernels 7.0.14 and newer. The run above agrees: kernel 7.0.0 is below that line, and 8.0.32, 8.0.34 and 8.3.13 all refused there.
