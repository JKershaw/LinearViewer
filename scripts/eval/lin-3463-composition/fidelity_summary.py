import json, glob, sys
from collections import Counter
D = sys.argv[1]
A = {}
for f in sorted(glob.glob(D + '/codes-A-*.json')):
    for x in json.load(open(f)): A[x['pair']] = x
Bc = {x['pair']: x for x in json.load(open(D + '/codes-B-second.json'))}
idx = {x['pair']: x for x in json.load(open(D + '/index.json'))}
print('pairs coded', len(A))
v = Counter(x['verdict'] for x in A.values()); print('verdicts', dict(v))
fates = Counter(); ftype = Counter(); add = Counter(); unit_types = Counter()
for x in A.values():
    for u in x['units']:
        fates[u['fate']] += 1; unit_types[u['type']] += 1; ftype[(u['type'], u['fate'])] += 1
    for a in x['additions']: add[a['type']] += 1
print('fates', dict(fates)); print('additions', dict(add), 'pairs with any addition', sum(1 for x in A.values() if x['additions']))
for t in ['WHAT', 'DONE', 'HOW', 'OPEN', 'BOUND', 'WHY']:
    n = unit_types[t]; d = ftype[(t, 'dropped')]; ch = sum(ftype[(t, f)] for f in ('strengthened', 'weakened', 'narrowed', 'broadened'))
    print(f'  {t}: n={n} dropped={d} ({100*d/max(n,1):.0f}%) altered={ch} ({100*ch/max(n,1):.0f}%)')
print('source_prescribes_how', Counter(x['source_prescribes_how'] for x in A.values()))
for h in ('none', 'light', 'heavy'):
    xs = [x for x in A.values() if x['source_prescribes_how'] == h]
    print(' ', h, len(xs), Counter(x['verdict'] for x in xs))
# by source length
import statistics as st
mat = [idx[p]['desc_chars'] for p, x in A.items() if x['verdict'] == 'material']
oth = [idx[p]['desc_chars'] for p, x in A.items() if x['verdict'] != 'material']
print('desc chars median: material', st.median(mat), 'other', st.median(oth))
# agreement
agree = sum(1 for p in Bc if Bc[p]['verdict'] == A[p]['verdict']); mat_agree = sum(1 for p in Bc if (Bc[p]['verdict'] == 'material') == (A[p]['verdict'] == 'material'))
print('agreement on 15: exact', agree, 'material-vs-not', mat_agree)
for p in sorted(Bc): print('  ', p, A[p]['verdict'], Bc[p]['verdict'])
print('B verdicts', Counter(x['verdict'] for x in Bc.values()))
