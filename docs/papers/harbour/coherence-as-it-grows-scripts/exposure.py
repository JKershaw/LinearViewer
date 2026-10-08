#!/usr/bin/env python3 -I
"""Per-PR exposure to multi-authority sites, and git-only cost measures.
Reads: data/prs.json (per merged PR), data/admissions-<sha>.json + admissions-head-codes.json (declared twins),
data/clones/<sha8>/summary.json (jscpd cross-file pairs). Writes data/exposure.json and prints tables."""
import json, collections, statistics, re, subprocess, os, sys
D = os.environ.get('COHERENCE_DATA', os.path.join(os.getcwd(), 'data'))  # run from the repo root; outputs of coherence-census.mjs live here
prs = json.load(open(D + '/prs.json'))
codes = json.load(open(D + '/admissions-head-codes.json'))
bytext = {h['text']: h['class'] for h in codes['hits']}
snaps = [('2026-01', '6c959c2bb996b7120d2421022c4bff467e119146'), ('2026-02', 'cd20df11b9cb6a375e1d1a8223cc4de5cc3e5ea5'), ('2026-03', 'abde98e753446b3fb6ac7636f24c75f4bd91613b'), ('2026-04', '8298af180343c3d0c1564d68604394f59500386f'), ('2026-05', '05d33f51190e0aca14207e3e985dd64f387e8199'), ('2026-06', '462ecafd44a0e85482f3b566add883b42a316051'), ('2026-07', 'a208d6b3a9708a6f348e6028edd03687414b34e6'), ('2026-08', '8b2be4242af92c3fde664da7bac8359854332b6d'), ('2026-09', '982fc662fcb4e85413e114529b23ec2ef8e8b46d'), ('2026-10', 'd61903f39f757ec84f989f541f0552dd86c8b26f')]
# Per snapshot: the set of production files that hold a declared twin (T) or sit in a cross-file clone pair.
twinFiles = {}; cloneFiles = {}; cloneDecisionFiles = {}
cloneCodes = json.load(open(D + '/clones-head-codes.json'))
cloneClassByPair = {(p['a'], p['b']): p['class'] for p in cloneCodes['pairs']}
for m, sha in snaps:
    a = json.load(open(f'{D}/admissions-{sha}.json'))
    tf = set()
    for h in a['hits']:
        k = bytext.get(h['text'])
        if k == 'T':
            tf.add(h['file'])
            # the partner named in the comment, if any
            for mm in re.findall(r'(?:lib|public|routes)/[\w./-]+\.js', h['text']): tf.add(mm)
    twinFiles[m] = tf
    c = json.load(open(f'{D}/clones/{sha[:8]}/summary.json'))
    cf = set(); cdf = set()
    for p in c['pairList']:
        if p['sameFile']: continue
        cf.add(p['a']); cf.add(p['b'])
        if cloneClassByPair.get((p['a'], p['b'])) in ('D', 'F'): cdf.add(p['a']); cdf.add(p['b'])
    cloneFiles[m] = cf; cloneDecisionFiles[m] = cdf
# A PR is exposed if it touches a file that, at the last snapshot BEFORE its month, held a twin or a clone.
prev = {snaps[i][0]: snaps[i - 1][0] for i in range(1, len(snaps))}
rows = []
for r in prs:
    m = r['day'][:7]
    if m not in prev: continue
    pm = prev[m]
    files = set(r['prodFiles'])
    size = r['prodAdded'] + r['prodDeleted']
    rows.append({**r, 'month': m, 'size': size, 'twin': bool(files & twinFiles[pm]), 'clone': bool(files & cloneFiles[pm]), 'cloneDecision': bool(files & cloneDecisionFiles[pm]), 'exposed': bool(files & (twinFiles[pm] | cloneFiles[pm])), 'span': (__import__('datetime').date.fromisoformat(r['day']) - __import__('datetime').date.fromisoformat(r['firstDay'])).days})
json.dump(rows, open(D + '/exposure.json', 'w'))
def med(xs): return statistics.median(xs) if xs else None
def band(s): return '1-49' if s < 50 else '50-299' if s < 300 else '300+'
fleet = [r for r in rows if r['day'] >= '2026-06-01' and r['size'] > 0]
print('PRs since June with production lines:', len(fleet))
for key in ['twin', 'clone', 'cloneDecision', 'exposed']:
    g = collections.defaultdict(list)
    for r in fleet: g[(band(r['size']), r[key])].append(r)
    print(f'\n== {key}: size band | n (exposed/not) | median commits | mean commits | median span days | share multi-commit | median prod files')
    for b in ['1-49', '50-299', '300+']:
        for v in [True, False]:
            xs = g[(b, v)]
            if not xs: continue
            print(f'{b:7} {str(v):5} n={len(xs):4} medCommits={med([x["commits"] for x in xs])} meanCommits={statistics.mean([x["commits"] for x in xs]):.2f} medSpan={med([x["span"] for x in xs])} multi={sum(x["commits"]>1 for x in xs)/len(xs):.0%} medFiles={med([len(x["prodFiles"]) for x in xs])} medSize={med([x["size"] for x in xs])}')
# by month: exposed share and commits per PR
print('\n== by month: PRs, exposed share, mean commits exposed vs not, mean size')
for m in sorted(set(r['month'] for r in fleet)):
    xs = [r for r in fleet if r['month'] == m]
    e = [r for r in xs if r['exposed']]; n = [r for r in xs if not r['exposed']]
    print(m, len(xs), f'{len(e)/len(xs):.0%}', f'{statistics.mean([r["commits"] for r in e]) if e else 0:.2f}', f'{statistics.mean([r["commits"] for r in n]) if n else 0:.2f}', f'{med([r["size"] for r in e])} {med([r["size"] for r in n])}')

# Co-change of named file pairs by month (finding 3): PRs touching both / touching the first / touching the second.
PAIRS = [('lib/prompt-template-defs.js', 'lib/prompts/meta-prompt-template.js'), ('routes/proxy.js', 'routes/workspace-api.js'), ('routes/dashboard.js', 'public/observation.js'), ('lib/ship-layout.js', 'public/ship.js'), ('lib/swim-lanes.js', 'public/swim.js'), ('lib/timeline-zoom.js', 'public/common.js'), ('routes/github-auth.js', 'routes/github-projects-auth.js')]
print('\n== co-change of named pairs by month: both / first / second')
months_all = sorted(set(r['day'][:7] for r in prs))
for a, b in PAIRS:
    cells = {m: [0, 0, 0] for m in months_all}
    for r in prs:
        fs = set(r['prodFiles']); c = cells[r['day'][:7]]
        if a in fs and b in fs: c[0] += 1
        if a in fs: c[1] += 1
        if b in fs: c[2] += 1
    print(a, '<->', b, ' '.join(f"{m[2:]}:{c[0]}/{c[1]}/{c[2]}" for m, c in cells.items()))
