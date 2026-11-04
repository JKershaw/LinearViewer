#!/usr/bin/env python3
"""LIN-4206: CI wall time on LV main, from `gh run list --workflow test.yml --branch main --limit 1000`.
Usage: python3 measure_ci.py ci-main-runs-2026-11-04.json
Wall time = updatedAt - startedAt, successful runs only (run-3 method)."""
import json, statistics, sys
from collections import defaultdict, Counter
from datetime import datetime
runs = json.load(open(sys.argv[1]))
def t(s): return datetime.fromisoformat(s.replace('Z', '+00:00'))
ok = [r for r in runs if r['conclusion'] == 'success']
print('runs', len(runs), 'success', len(ok), 'non-success', Counter(r['conclusion'] for r in runs))
byday = defaultdict(list)
for r in ok:
    mins = (t(r['updatedAt']) - t(r['startedAt'])).total_seconds() / 60
    byday[r['startedAt'][:10]].append(mins)
for day in sorted(byday):
    v = byday[day]
    print(day, 'n=%d' % len(v), 'median=%.2f' % statistics.median(v))
def med(lo, hi):
    v = [(t(r['updatedAt']) - t(r['startedAt'])).total_seconds() / 60 for r in ok if lo <= r['startedAt'][:10] < hi]
    return (len(v), round(statistics.median(v), 2) if v else None)
for name, lo, hi in [('Sep', '2026-09-01', '2026-10-01'), ('10-01..10-17', '2026-10-01', '2026-10-18'),
                     ('10-18..10-20', '2026-10-18', '2026-10-21'), ('10-21..10-25', '2026-10-21', '2026-10-26'),
                     ('10-26..11-01', '2026-10-26', '2026-11-02'), ('11-02..11-04', '2026-11-02', '2026-11-05')]:
    print(name, med(lo, hi))
print('window 10-21..11-04 (run-4 window):', med('2026-10-21', '2026-11-05'))
print('run3 window 10-12..10-21 (startedAt):', med('2026-10-12', '2026-10-21'))
