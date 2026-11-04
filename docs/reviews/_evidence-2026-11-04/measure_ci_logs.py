#!/usr/bin/env python3
"""LIN-4206: per-test time by runner region, from the Unit tests job logs of sampled main runs.
Usage: python3 measure_ci_logs.py ci-main-runs-2026-11-04.json <out.tsv>
Samples up to 2 successful main runs per day (first and last by startedAt) from 2026-10-01.
Reads `Region:` (runner pool), `ℹ tests N` and `ℹ duration_ms X` per arm (hermetic, proxy, keyed).
Requires gh auth. Logs are not committed (88k lines each); the parsed TSV is the evidence."""
import json, re, subprocess, sys
from collections import defaultdict
runs = [r for r in json.load(open(sys.argv[1])) if r['conclusion'] == 'success' and r['startedAt'][:10] >= '2026-10-01']
by_day = defaultdict(list)
for r in sorted(runs, key=lambda r: r['startedAt']):
    by_day[r['startedAt'][:10]].append(r)
sample = []
for day, rs in sorted(by_day.items()):
    sample += [rs[0]] if len(rs) == 1 else [rs[0], rs[-1]]
rows = []
for r in sample:
    rid = r['databaseId']
    jobs = json.loads(subprocess.run(['gh', 'api', f'repos/JKershaw/LinearViewer/actions/runs/{rid}/jobs'],
                                     capture_output=True, text=True, check=True).stdout)['jobs']
    jid = next((j['id'] for j in jobs if j['name'] == 'Unit tests'), None)
    if jid is None:
        continue
    log = subprocess.run(['gh', 'api', f'repos/JKershaw/LinearViewer/actions/jobs/{jid}/logs'],
                         capture_output=True, text=True).stdout
    region = (re.search(r'Region: (\S+)', log) or [None, None])[1]
    tests = [int(x) for x in re.findall(r'ℹ tests (\d+)', log)]
    durs = [float(x) for x in re.findall(r'ℹ duration_ms ([\d.]+)', log)]
    rows.append((r['startedAt'], rid, r['headSha'][:8], region, tests, durs))
    print(r['startedAt'][:16], rid, region, tests, [round(d) for d in durs], flush=True)
with open(sys.argv[2], 'w') as f:
    f.write('started\trun_id\thead\tregion\ttests_per_arm\tduration_ms_per_arm\tms_per_test_per_arm\n')
    for s, rid, h, reg, t, d in rows:
        per = [round(a / b, 2) for a, b in zip(d, t) if b]
        f.write(f"{s}\t{rid}\t{h}\t{reg}\t{','.join(map(str, t))}\t{','.join(str(round(x)) for x in d)}\t{','.join(map(str, per))}\n")
print('rows', len(rows))
