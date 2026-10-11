import json, glob, sys
S = sys.argv[1]
A = {}
for f in glob.glob(f'{S}/composition/codes-A-*.json'):
    for x in json.load(open(f)): A[x['id']] = x
B = {x['id']: x for x in json.load(open(f'{S}/composition/codes-B-second.json'))}
ids = [i for i in B if i in A]
print('overlap', len(ids))
def kappa(a, b):
    cats = sorted(set(a) | set(b), key=str); n = len(a)
    po = sum(x == y for x, y in zip(a, b)) / n
    pe = sum((a.count(c) / n) * (b.count(c) / n) for c in cats)
    return po, (po - pe) / (1 - pe) if pe < 1 else 1.0
for k in ['origin', 'what_decided', 'open_behaviour', 'how_prescribed', 'decisions', 'asserted_facts', 'acceptance', 'work_type', 'size_guess']:
    a = [A[i][k] for i in ids]; b = [B[i][k] for i in ids]
    po, kp = kappa(a, b)
    near = ''
    if isinstance(a[0], int): near = f" within1 {sum(abs(x-y)<=1 for x,y in zip(a,b))}/{len(ids)}"
    print(f'{k:16s} agree {po*100:.0f}% kappa {kp:.2f}{near}')
for i in ids:
    if A[i]['open_behaviour'] != B[i]['open_behaviour'] or A[i]['what_decided'] != B[i]['what_decided']:
        print(' ', i, 'A', A[i]['what_decided'], A[i]['open_behaviour'], '| B', B[i]['what_decided'], B[i]['open_behaviour'])
