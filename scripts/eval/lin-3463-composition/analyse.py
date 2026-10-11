import json, glob, sys, statistics as st
from collections import Counter, defaultdict
S = sys.argv[1]
rows = json.load(open(f'{S}/table.json'))
mp = json.load(open(f'{S}/composition/map.json'))
codes = {}
for f in glob.glob(f'{S}/composition/codes-A-*.json'):
    for x in json.load(open(f)): codes[x['id']] = x
T = []
for cid, c in codes.items():
    r = rows[mp[cid]]; k = r['kinds']
    T.append({**c, 'ticket': r['id'], 'state': r['state'], 'sessions': r['sessions_total'], 'own': r['lineages'], 'split': r['split'],
              'plan_reviews': k.get('plan-review', 0), 'reviews': k.get('review', 0), 'plans': k.get('plan', 0),
              'words0': len((r['desc0'] or '').split()), 'aborted': r['aborted'], 'is_child': bool(r['parent']),
              'hours': r['dur_ms'] / 3.6e6})
json.dump(T, open(f'{S}/joined.json', 'w'))
def summ(xs, label):
    if not xs: return f'{label}: n=0'
    s = [x['sessions'] for x in xs]
    return (f"{label}: n={len(xs)} sessions med {st.median(s):.0f} mean {st.mean(s):.1f} p75 {sorted(s)[int(.75*(len(s)-1))]}"
            f" | split {100*sum(x['split'] for x in xs)/len(xs):.0f}% | plan-review>=2 {100*sum(x['plan_reviews']>=2 for x in xs)/len(xs):.0f}%"
            f" | review>=2 {100*sum(x['reviews']>=2 for x in xs)/len(xs):.0f}% | done {100*sum(x['state']=='Done' for x in xs)/len(xs):.0f}%")
pop = [x for x in T if x['state'] in ('Done', 'Canceled', 'Duplicate')] if '--terminal' in sys.argv else T
print('population', len(pop), Counter(x['state'] for x in pop))
for key in ['origin', 'what_decided', 'open_behaviour', 'how_prescribed', 'decisions', 'asserted_facts', 'acceptance', 'size_guess', 'work_type', 'is_child']:
    print(f'== {key}')
    g = defaultdict(list)
    for x in pop: g[x[key]].append(x)
    for v in sorted(g, key=str): print('  ', summ(g[v], str(v)))
