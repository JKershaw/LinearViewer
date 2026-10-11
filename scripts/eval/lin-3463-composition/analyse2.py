import json, sys, statistics as st
from collections import defaultdict
S = sys.argv[1]
T = json.load(open(f'{S}/joined.json'))
work = [x for x in T if x['work_type'] in ('bug', 'feature', 'refactor', 'ops', 'other') and x['state'] in ('Done', 'Canceled')]
def line(xs, label):
    if not xs: return f'  {label}: n=0'
    s = [x['sessions'] for x in xs]
    return f"  {label:28s} n={len(xs):3d} sessions med {st.median(s):4.1f} mean {st.mean(s):5.1f} | split {100*sum(x['split'] for x in xs)/len(xs):3.0f}% | PR>=2 {100*sum(x['plan_reviews']>=2 for x in xs)/len(xs):3.0f}% | RV>=2 {100*sum(x['reviews']>=2 for x in xs)/len(xs):3.0f}% | canceled {100*sum(x['state']=='Canceled' for x in xs)/len(xs):3.0f}%"
for grp, sel in [('AUTHORED (not breakdown)', lambda x: x['origin'] != 'breakdown'), ('BREAKDOWN children', lambda x: x['origin'] == 'breakdown')]:
    P = [x for x in work if sel(x)]
    print(f'== {grp}: {len(P)} terminal work tickets')
    for key in ['what_decided', 'open_behaviour', 'how_prescribed', 'decisions', 'asserted_facts', 'size_guess']:
        g = defaultdict(list)
        for x in P: g[x[key]].append(x)
        print(f' {key}')
        for v in sorted(g, key=str): print(line(g[v], str(v)))
    # prescription within settled + no open behaviour
    print(' how_prescribed among what_decided=2 & open_behaviour=no')
    g = defaultdict(list)
    for x in P:
        if x['what_decided'] == 2 and x['open_behaviour'] == 'no': g[x['how_prescribed']].append(x)
    for v in sorted(g): print(line(g[v], str(v)))
    print(' open_behaviour within size')
    for sz in 'SML':
        for ob in ('no', 'yes'):
            print(line([x for x in P if x['size_guess'] == sz and x['open_behaviour'] == ob], f'{sz} open={ob}'))
