#!/usr/bin/env python3
"""Agreement and tallies for the two independent codings (LIN-4479).

  python3 -I agreement.py <dir>   # <dir> holds beyond-the-code-entries-{lv,sd}.json and -codes-{A,B}.json

Prints, per field: raw agreement and Cohen's kappa; then each coder's tally by section, and the
tally over entries both coders coded the same; then the cross-tabs the paper uses.
"""
import json, sys, collections, os
d = sys.argv[1] if len(sys.argv) > 1 else '.'
ent = json.load(open(os.path.join(d, 'beyond-the-code-entries-lv.json')))['entries'] + \
      json.load(open(os.path.join(d, 'beyond-the-code-entries-sd.json')))['entries']
A = {x['id']: x for x in json.load(open(os.path.join(d, 'beyond-the-code-codes-A.json')))}
B = {x['id']: x for x in json.load(open(os.path.join(d, 'beyond-the-code-codes-B.json')))}
assert len(A) == len(B) == len(ent) and all(e['id'] in A and e['id'] in B for e in ent)
FIELDS = ['kind', 'held', 'volatile', 'needs', 'home']

def kappa(pairs):
    n = len(pairs); po = sum(a == b for a, b in pairs) / n
    ca = collections.Counter(a for a, _ in pairs); cb = collections.Counter(b for _, b in pairs)
    pe = sum(ca[k] * cb[k] for k in set(ca) | set(cb)) / n / n
    return po, (po - pe) / (1 - pe) if pe < 1 else 1.0

print('== agreement (all entries, then Lessons, then Waiting)')
for f in FIELDS:
    row = [f]
    for sec in (None, 'Lessons', 'Waiting'):
        pairs = [(A[e['id']][f], B[e['id']][f]) for e in ent if sec is None or e['section'] == sec]
        po, k = kappa(pairs); row.append(f'{po:.2f}/κ{k:.2f} (n={len(pairs)})')
    print('  '.join(row))

for f in FIELDS:
    print(f'\n== {f}: A | B | both agree')
    for sec in ('Lessons', 'Waiting'):
        es = [e for e in ent if e['section'] == sec]
        ca = collections.Counter(A[e['id']][f] for e in es); cb = collections.Counter(B[e['id']][f] for e in es)
        cg = collections.Counter(A[e['id']][f] for e in es if A[e['id']][f] == B[e['id']][f])
        keys = sorted(set(ca) | set(cb), key=lambda k: -(ca[k] + cb[k]))
        print(f'  {sec} (n={len(es)}): ' + ', '.join(f'{k} {ca[k]}|{cb[k]}|{cg[k]}' for k in keys))

def cross(f1, f2, sec):
    print(f'\n== {sec}: {f1} x {f2}, A | B')
    es = [e for e in ent if e['section'] == sec]
    for C, name in ((A, 'A'), (B, 'B')):
        t = collections.Counter((C[e['id']][f1], C[e['id']][f2]) for e in es)
        print(f'  {name}: ' + ', '.join(f'{a}/{b} {n}' for (a, b), n in t.most_common()))
cross('kind', 'held', 'Lessons')
cross('kind', 'home', 'Waiting')
cross('needs', 'home', 'Waiting')
cross('kind', 'needs', 'Waiting')
# Both coders: Waiting needing a person; Lessons held yes; volatile yes
for sec, f, v in (('Waiting', 'needs', 'person'), ('Lessons', 'held', 'yes'), ('Lessons', 'held', 'no'),
                  ('Waiting', 'volatile', 'yes'), ('Lessons', 'volatile', 'yes'), ('Waiting', 'kind', 'defect')):
    es = [e for e in ent if e['section'] == sec]
    both = [e['id'] for e in es if A[e['id']][f] == v and B[e['id']][f] == v]
    either = [e['id'] for e in es if A[e['id']][f] == v or B[e['id']][f] == v]
    print(f'\n{sec} {f}={v}: both {len(both)}, either {len(either)}')
