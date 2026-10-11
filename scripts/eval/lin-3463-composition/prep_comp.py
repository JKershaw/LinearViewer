import json, sys, os, random
S = sys.argv[1]; lo = int(sys.argv[2]); hi = int(sys.argv[3])
rows = json.load(open(f'{S}/table.json'))
mp = json.load(open(f'{S}/composition/map.json')) if os.path.exists(f'{S}/composition/map.json') else {}
elig = sorted([r for r in rows.values() if r['desc0'] and r['lineages'] and lo <= r['n'] <= hi and r['id'] not in mp.values()], key=lambda r: r['n'])
random.seed(len(mp) + 7); random.shuffle(elig)
start = len(mp)
for k, r in enumerate(elig):
    cid = f'C{start + k + 1:03d}'; mp[cid] = r['id']
    json.dump({'id': cid, 'title': r['title'], 'has_parent': bool(r['parent']), 'description': r['desc0']}, open(f'{S}/composition/{cid}.json', 'w'), indent=1)
json.dump(mp, open(f'{S}/composition/map.json', 'w'), indent=1)
print('new', len(elig), 'total', len(mp), 'ids', f'C{start+1:03d}..C{len(mp):03d}')
