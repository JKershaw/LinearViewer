#!/usr/bin/env python3
"""Paced, resumable, read-only census fetch for unwedge-or-breakdown.md.

Usage: python3 -I fetch.py <cache-dir> <lo> <hi> [budget-seconds]

For every LIN-n in [lo, hi] it caches GET /issues/LIN-n and GET /cost/LIN-n from the
Workspace API Proxy ($HARBOUR_LOCAL_BASE/api/proxy). Nothing is written to the
Workspace; GET is the only verb used. The cache is outside the repository and is
not committed; census.mjs reads it and writes the committed derived table.

Pacing is 1.12 s per call (the proxy allows 60 a minute). A run stops after
budget-seconds, so a foreground call stays under the tool timeout; a re-run skips
every ticket already cached.
"""
import json, os, sys, time, urllib.request, urllib.error

BASE = os.environ['HARBOUR_LOCAL_BASE'].rstrip('/') + '/api/proxy'
CACHE, LO, HI = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
BUDGET = float(sys.argv[4]) if len(sys.argv) > 4 else 480.0
os.makedirs(CACHE, exist_ok=True)
last = [0.0]


def get(path):
    for _ in range(6):
        wait = 1.12 - (time.time() - last[0])
        if wait > 0:
            time.sleep(wait)
        last[0] = time.time()
        try:
            with urllib.request.urlopen(BASE + path, timeout=120) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            if e.code == 429:
                time.sleep(30)
                continue
            if e.code == 404:
                return {'_error': 404}
            if e.code >= 500:
                time.sleep(5)
                continue
            return {'_error': e.code, '_body': e.read()[:300].decode('utf8', 'replace')}
        except Exception:
            time.sleep(5)
    return {'_error': 'gave-up'}


started = time.time()
done = skipped = 0
for n in range(LO, HI + 1):
    if time.time() - started > BUDGET:
        break
    f = os.path.join(CACHE, f'LIN-{n}.json')
    if os.path.exists(f):
        skipped += 1
        continue
    rec = {'issue': get(f'/issues/LIN-{n}')}
    if '_error' not in rec['issue']:
        rec['cost'] = get(f'/cost/LIN-{n}')
    tmp = f + '.tmp'
    with open(tmp, 'w') as out:
        json.dump(rec, out)
    os.replace(tmp, f)
    done += 1
print(json.dumps({'fetched': done, 'already_cached': skipped, 'next_unfetched_hint': min(HI, LO + skipped + done)}))
