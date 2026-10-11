import json, sys, statistics as st
S = sys.argv[1]
T = json.load(open(f'{S}/joined.json')); AF = json.load(open(f'{S}/autofeatures.json'))
P = [x for x in T if x['state'] == 'Done' and x['work_type'] in ('bug', 'feature', 'refactor', 'ops', 'other') and AF[x['ticket']]['pr_lines']]
for x in P: x['pl'] = AF[x['ticket']]['pr_lines']
P.sort(key=lambda x: x['pl']); n = len(P)
bands = [('small', P[:n//3]), ('mid', P[n//3:2*n//3]), ('large', P[2*n//3:])]
def line(xs, lab):
    if not xs: return f'    {lab}: n=0'
    s = [x['sessions'] for x in xs]
    return f"    {lab:22s} n={len(xs):3d} med {st.median(s):5.1f} mean {st.mean(s):5.1f} split {100*sum(x['split'] for x in xs)/len(xs):3.0f}% PR>=2 {100*sum(x['plan_reviews']>=2 for x in xs)/len(xs):3.0f}%"
for lab, B in bands:
    print(f'{lab} PR lines {B[0]["pl"]}-{B[-1]["pl"]}')
    one = lambda x: x['decisions'] == 1 and x['open_behaviour'] == 'no'
    print(line([x for x in B if one(x)], 'one decision, settled'))
    print(line([x for x in B if not one(x)], 'otherwise'))
    print(line([x for x in B if x['open_behaviour'] == 'yes'], 'behaviour open'))
    print(line([x for x in B if x['how_prescribed'] >= 3], 'how=3 program'))
    print(line([x for x in B if x['how_prescribed'] <= 1], 'how<=1'))
# does composition predict size?
for k in ('decisions', 'open_behaviour', 'how_prescribed'):
    vals = sorted({x[k] for x in P}, key=str)
    print(k, {v: st.median([x['pl'] for x in P if x[k] == v]) for v in vals})
