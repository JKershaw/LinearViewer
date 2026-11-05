# Compare the 11-05 reading (W: 2eb73ae0 vs d7ceb373) with the 11-04 run 2 reading (prior W1: d7ceb373 vs 5334c81a), one guide (sha256 e3194f52...).
# Join groups on (detector, decision, files). Usage: python3 -I census-compare.py <W.json> <priorW1.json>
import json, sys, collections
W = json.load(open(sys.argv[1])); P = json.load(open(sys.argv[2]))
key = lambda g: (g['detector'], g['decision'], tuple(g['files']))
kd = lambda g: (g['detector'], g['decision'])
pw = {key(g): g for g in P['groups']}; pd = collections.defaultdict(list)
for g in P['groups']: pd[kd(g)].append(g)
print('W counts', W['counts']); print('prior counts', P['counts'])
print('W status', collections.Counter(g['status'] for g in W['groups']))
print('W gone:', [(g['id'], g['decision'][:120], g['files']) for g in W['gone']])
print('\n== groups whose status is not unchanged')
for g in W['groups']:
    if g['status'] != 'unchanged':
        print(g['id'], g['status'], 'mustRule' if g['mustRule'] else ('table' if g['table'] else '-'), g['detector'], '|', g['decision'][:140], '|', g['files'])
mW = {key(g): g for g in W['groups'] if g['mustRule']}; mP = {key(g): g for g in P['groups'] if g['mustRule']}
print('\n== mustRule: left the set', len(set(mP) - set(mW)))
for k in set(mP) - set(mW):
    g = mP[k]; now = [x for x in W['groups'] if kd(x) == kd(g)]
    print(' prior', g['id'], g['decision'][:140], g['files'], g['areaCount'], '-> now', [(x['id'], x['status'], x['mustRule'], x['table'], x['files'], x['areaCount']) for x in now])
print('== mustRule: joined the set', len(set(mW) - set(mP)))
for k in set(mW) - set(mP):
    g = mW[k]; before = pd.get(kd(g), [])
    print(' now', g['id'], g['status'], g['decision'][:140], g['files'], '<- prior', [(x['id'], x['mustRule'], x['files']) for x in before])
same = set(mW) & set(mP); ident = sum(1 for k in same if mW[k]['sites'] == mP[k]['sites'])
print('== mustRule kept (same detector/decision/files):', len(same), 'identical sites:', ident, 'lines shifted:', len(same) - ident)
tW = {key(g) for g in W['groups'] if g['table']}; tP = {key(g) for g in P['groups'] if g['table']}
print('\n== table: left', len(tP - tW), '; joined', len(tW - tP))
for k in tP - tW: print(' -', k[0], k[1][:140], k[2])
for k in tW - tP: print(' +', k[0], k[1][:140], k[2])
